//! The orchestrator: turns sim job requests into agent work, repo changes and
//! plan posts, and reports outcomes back (docs/mvp.md).
//!
//! The sim owns every state transition (ADR-0011). This module never decides
//! what happens next to a work item; it runs exactly the job it is given and
//! reports a typed [`Outcome`] that the company actor turns into a server
//! command for the sim. Text (briefs, pages, reviews, transcripts) lives in
//! Postgres keyed by sim ids; content goes to the site repo through
//! `github::ContentRepo` (drafts are PR branches, merge is the publish step).

use std::sync::Arc;

use agents::pipeline::{
    draft_step, review_step, DraftInput, DraftStep, EditorReview, PageValidator, PipelineConfig,
};
use agents::prompts::{resolve, templates, PromptLayer, SiteContext, Vars};
use agents::{
    run_meeting, Brief, Llm, LlmError, MeetingEvent, MeetingSpec, Participant, Persona, Role,
    Staffing,
};
use anyhow::{anyhow, bail, Context, Result};
use github::{ContentRepo, RepoApi, RepoId};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::PgPool;
use uuid::Uuid;

use crate::plan::PlanService;

/// The jobs of the MVP article loop.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum JobKind {
    Standup,
    Draft,
    Review,
    Publish,
}

/// Someone taking part in a job, as the sim knows them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StaffRef {
    /// Sim id, e.g. "staff-1".
    pub id: String,
    /// Persona catalog slug, e.g. "giulia".
    pub persona: String,
    /// Kebab-case role, e.g. "writer", "editor", "editor-in-chief".
    pub role: String,
}

/// One `Effect::RequestJob` from the sim, resolved to names.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct JobRequest {
    pub company_id: Uuid,
    pub job_id: u64,
    pub kind: JobKind,
    /// Sim project id, e.g. "project-1".
    pub project: String,
    /// Sim work item id (absent for standups).
    pub work_item: Option<String>,
    pub brief_ref: Option<u64>,
    /// 0 for the first draft; n for the nth revision (and the review of it).
    pub revision: u8,
    pub staff: Vec<StaffRef>,
}

/// What a finished job reports back to the sim.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Digest {
    pub ok: bool,
    pub score: u8,
    pub words: u32,
    pub qa_defects: u16,
    /// Commit sha of the artifact (hex), if any.
    pub artifact_sha: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BriefOut {
    pub brief_ref: u64,
    pub writer: String,
    pub editor: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum Outcome {
    MeetingOutcome { job_id: u64, briefs: Vec<BriefOut> },
    JobCompleted { job_id: u64, digest: Digest },
    DeployLanded { work_item: String },
}

/// How one project's site is wired.
pub struct SiteBinding {
    pub site_id: String,
    pub brand_name: String,
    pub repo: RepoId,
    pub base_branch: String,
    pub language: String,
    pub context: SiteContext,
    pub validator: Arc<dyn PageValidator>,
    /// Approval bar (the sim applies it; also shown to the editor).
    pub quality_bar: u8,
    /// Test and dev: report `DeployLanded` right after the merge instead of
    /// waiting for the site repo's `deployment_status` webhook.
    pub simulate_deploy: bool,
    pub standup_max_turns: u32,
}

pub struct Orchestrator {
    pool: PgPool,
    llm: Arc<dyn Llm>,
    repo_api: Arc<dyn RepoApi>,
    plan: Arc<PlanService>,
    site: SiteBinding,
}

/// The block subset writers use in the MVP. Every block here is a core block
/// of the canonical page schema, so pages validate against content-schema.
pub fn article_schema() -> Value {
    let text = json!({"type": "string", "minLength": 1});
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["id", "slug", "title", "page_type", "seo", "body"],
        "properties": {
            "id": text,
            "slug": {"type": "object", "additionalProperties": false, "required": ["en"], "properties": {"en": text}},
            "title": {"type": "object", "additionalProperties": false, "required": ["en"], "properties": {"en": text}},
            "page_type": {"type": "string", "enum": ["blog-article"]},
            "seo": {"type": "object", "additionalProperties": false, "required": ["title", "description"],
                    "properties": {"title": text, "description": text}},
            "body": {"type": "array", "minItems": 3, "items": {"anyOf": [
                {"type": "object", "additionalProperties": false, "required": ["type", "markdown"],
                 "properties": {"type": {"const": "paragraph"}, "markdown": text}},
                {"type": "object", "additionalProperties": false, "required": ["type", "level", "text"],
                 "properties": {"type": {"const": "heading"}, "level": {"type": "integer", "enum": [2, 3, 4]}, "text": text}},
                {"type": "object", "additionalProperties": false, "required": ["type", "text"],
                 "properties": {"type": {"const": "quote"}, "text": text, "attribution": {"type": "string"}}},
                {"type": "object", "additionalProperties": false, "required": ["type", "ordered", "items"],
                 "properties": {"type": {"const": "list"}, "ordered": {"type": "boolean"},
                                "items": {"type": "array", "minItems": 1, "items": text}}},
                {"type": "object", "additionalProperties": false, "required": ["type", "style", "content"],
                 "properties": {"type": {"const": "callout"}, "style": {"type": "string", "enum": ["info", "warning", "success", "error"]},
                                "title": {"type": "string"}, "content": text}},
                {"type": "object", "additionalProperties": false, "required": ["type", "items"],
                 "properties": {"type": {"const": "faq"}, "items": {"type": "array", "minItems": 1, "items": {
                     "type": "object", "additionalProperties": false, "required": ["question", "answer"],
                     "properties": {"question": text, "answer": text}}}}}
            ]}}
        }
    })
}

/// Writer-facing docs for [`article_schema`] (generated docs for the full
/// catalogue come with the site-kit, ADR-0014).
pub const ARTICLE_BLOCK_DOCS: &str = "\
- `paragraph` { markdown }: one idea per paragraph; plain text with **bold**/_italic_ only.
- `heading` { level: 2|3|4, text }: sentence-case section headings.
- `quote` { text, attribution? }: only real, attributable quotes from the material you were given.
- `list` { ordered, items[] }: practical steps or options.
- `callout` { style: info|warning|success|error, title?, content }: tips, warnings, closures.
- `faq` { items[{ question, answer }] }: reader questions with short, true answers.
The page is { id, slug: { en: \"/en/blog/<slug>\" }, title: { en }, page_type: \"blog-article\", seo: { title, description }, body: [blocks] }.";

/// A validator that checks the canonical schema and then the site's house
/// style (banned phrases); errors go back to the writer verbatim.
pub fn site_validator(context: &SiteContext) -> Arc<dyn PageValidator> {
    let style = context.style_guide.clone();
    Arc::new(move |page: &Value| -> Result<(), Vec<String>> {
        content_schema::validate_page(page)?;
        style.validate(page)
    })
}

fn slugify(title: &str) -> String {
    let mut out = String::new();
    let mut dash = false;
    for c in title.chars().flat_map(|c| c.to_lowercase()) {
        let c = match c {
            'à' | 'á' | 'â' | 'ä' => 'a',
            'è' | 'é' | 'ê' | 'ë' => 'e',
            'ì' | 'í' | 'î' | 'ï' => 'i',
            'ò' | 'ó' | 'ô' | 'ö' => 'o',
            'ù' | 'ú' | 'û' | 'ü' => 'u',
            c => c,
        };
        if c.is_ascii_alphanumeric() {
            out.push(c);
            dash = false;
        } else if !dash && !out.is_empty() {
            out.push('-');
            dash = true;
        }
    }
    let out = out.trim_end_matches('-');
    out.chars().take(80).collect::<String>().trim_end_matches('-').to_string()
}

fn brief_ref_for(company: Uuid, job_id: u64, index: usize) -> u64 {
    let mut buf = Vec::with_capacity(32);
    buf.extend_from_slice(company.as_bytes());
    buf.extend_from_slice(&job_id.to_le_bytes());
    buf.extend_from_slice(&(index as u64).to_le_bytes());
    // Postgres BIGINT is signed: keep it positive.
    xxhash_rust::xxh3::xxh3_64(&buf) & (i64::MAX as u64)
}

fn page_text(page: &Value) -> String {
    let mut out = String::new();
    fn walk(v: &Value, out: &mut String) {
        match v {
            Value::String(s) => {
                out.push_str(s);
                out.push(' ');
            }
            Value::Array(a) => a.iter().for_each(|x| walk(x, out)),
            Value::Object(o) => o
                .iter()
                .filter(|(k, _)| k.as_str() != "type")
                .for_each(|(_, x)| walk(x, out)),
            _ => {}
        }
    }
    if let Some(body) = page.get("body") {
        walk(body, &mut out);
    }
    out
}

fn word_count(page: &Value) -> u32 {
    page_text(page).split_whitespace().count() as u32
}

fn role_of(r: &str) -> Option<Role> {
    match r {
        "writer" => Some(Role::Writer),
        "editor" => Some(Role::Editor),
        "editor-in-chief" => Some(Role::EditorInChief),
        _ => None,
    }
}

fn persona(slug: &str) -> Result<Persona> {
    Persona::builtin(slug).ok_or_else(|| anyhow!("unknown persona {slug}"))
}

impl Orchestrator {
    pub fn new(
        pool: PgPool,
        llm: Arc<dyn Llm>,
        repo_api: Arc<dyn RepoApi>,
        plan: Arc<PlanService>,
        site: SiteBinding,
    ) -> Self {
        Self {
            pool,
            llm,
            repo_api,
            plan,
            site,
        }
    }

    fn content_repo(&self) -> ContentRepo {
        ContentRepo::new(
            self.repo_api.clone(),
            self.site.repo.clone(),
            self.site.base_branch.clone(),
        )
    }

    fn system_prompt(&self, company: &agents::CompanyPrompt, p: &Persona, extra: Vars) -> Result<String> {
        let agent = PromptLayer::from_persona(p, &self.site.language);
        let mut runtime = Vars::new();
        runtime.insert("brand_name".into(), json!(self.site.brand_name));
        runtime.insert("approve_threshold".into(), json!(self.site.quality_bar));
        runtime.insert("block_docs".into(), json!(ARTICLE_BLOCK_DOCS));
        runtime.extend(extra);
        let site = self.site.context.variables_only();
        let layer = if company.id == "writer" {
            &self.site.context.layer
        } else {
            &site
        };
        Ok(resolve(company, Some(layer), Some(&agent), &runtime)?.text)
    }

    fn participant(&self, s: &StaffRef, company: &agents::CompanyPrompt, extra: Vars) -> Result<Participant> {
        let p = persona(&s.persona)?;
        Ok(Participant {
            id: s.id.clone(),
            name: p.name.clone(),
            role: role_of(&s.role).unwrap_or(Role::Writer),
            seniority: Some(p.seniority),
            system_prompt: self.system_prompt(company, &p, extra)?,
        })
    }

    fn staffing(&self, writer: &StaffRef, editor: &StaffRef) -> Result<Staffing> {
        let w = persona(&writer.persona)?;
        let e = persona(&editor.persona)?;
        Ok(Staffing {
            writer_id: writer.id.clone(),
            writer_seniority: Some(w.seniority),
            writer_system: self.system_prompt(&templates::writer(), &w, Vars::new())?,
            editor_id: editor.id.clone(),
            editor_seniority: Some(e.seniority),
            editor_system: self.system_prompt(&templates::editor(), &e, Vars::new())?,
        })
    }

    fn pipeline_config(&self) -> PipelineConfig {
        let mut cfg = PipelineConfig::new(article_schema());
        cfg.approve_threshold = self.site.quality_bar;
        cfg
    }

    /// Runs one job. Errors are infrastructure failures (DB, GitHub): the job
    /// queue retries them. Agent failures are reported as `ok: false`.
    pub async fn run(&self, req: &JobRequest) -> Result<Vec<Outcome>> {
        match req.kind {
            JobKind::Standup => self.standup(req).await,
            JobKind::Draft => self.draft(req).await,
            JobKind::Review => self.review(req).await,
            JobKind::Publish => self.publish(req).await,
        }
    }

    fn find<'a>(&self, req: &'a JobRequest, role: &str) -> Option<&'a StaffRef> {
        req.staff.iter().find(|s| s.role == role)
    }

    async fn standup(&self, req: &JobRequest) -> Result<Vec<Outcome>> {
        let moderator = self
            .find(req, "editor-in-chief")
            .or_else(|| self.find(req, "editor"))
            .ok_or_else(|| anyhow!("standup without an editor-in-chief or editor"))?;
        let editor = self.find(req, "editor").unwrap_or(moderator);
        let others: Vec<&StaffRef> = req.staff.iter().filter(|s| s.id != moderator.id).collect();

        let mut agenda = Vars::new();
        agenda.insert(
            "agenda".into(),
            json!(format!("Daily standup for {}: what we publish next.", self.site.brand_name)),
        );
        agenda.insert("max_turns".into(), json!(self.site.standup_max_turns));
        agenda.insert(
            "participants".into(),
            json!(others
                .iter()
                .map(|s| format!("{} ({}, {})", s.id, s.persona, s.role))
                .collect::<Vec<_>>()
                .join(", ")),
        );
        let spec = MeetingSpec {
            id: format!("job-{}", req.job_id),
            topic: format!("{} standup", self.site.brand_name),
            moderator: self.participant(moderator, &templates::editor_in_chief(), agenda)?,
            participants: others
                .iter()
                .map(|s| self.participant(s, &templates::meeting_speaker(), Vars::new()))
                .collect::<Result<_>>()?,
            max_turns: self.site.standup_max_turns,
            max_tokens_per_turn: 600,
            max_tokens_outcome: 2000,
        };
        let mut on_event = |_: MeetingEvent| {};
        let result = match run_meeting(self.llm.as_ref(), &spec, &mut on_event).await {
            Ok(r) => r,
            Err(e) => {
                tracing::warn!(job = req.job_id, error = %e, "standup failed; ending without briefs");
                return Ok(vec![Outcome::MeetingOutcome {
                    job_id: req.job_id,
                    briefs: vec![],
                }]);
            }
        };

        let mut tx = self.pool.begin().await?;
        for u in &result.transcript {
            sqlx::query(
                "INSERT INTO transcripts (company_id, job_id, seq, speaker, text) VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT DO NOTHING",
            )
            .bind(req.company_id)
            .bind(req.job_id as i64)
            .bind(u.seq as i32)
            .bind(&u.speaker)
            .bind(&u.text)
            .execute(&mut *tx)
            .await?;
        }
        let minutes: Vec<Value> = result
            .transcript
            .iter()
            .map(|u| json!({"seq": u.seq, "speaker": u.speaker, "text": u.text}))
            .collect();

        let mut briefs = Vec::new();
        for (i, b) in result.outcome.briefs.iter().enumerate() {
            let writer = req
                .staff
                .iter()
                .find(|s| s.id == b.assignee && s.role == "writer")
                .or_else(|| self.find(req, "writer"))
                .ok_or_else(|| anyhow!("standup produced a brief but the team has no writer"))?;
            let brief_ref = brief_ref_for(req.company_id, req.job_id, i);
            let slug = slugify(&b.title);
            let brief = Brief {
                content_id: format!("content-{brief_ref:x}"),
                title: b.title.clone(),
                slug,
                angle: b.angle.clone(),
                keywords: b.keywords.clone(),
                target_words: b.target_words,
                language: self.site.language.clone(),
                notes: String::new(),
            };
            sqlx::query(
                "INSERT INTO briefs (company_id, brief_ref, job_id, brief, writer, editor, minutes)
                 VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING",
            )
            .bind(req.company_id)
            .bind(brief_ref as i64)
            .bind(req.job_id as i64)
            .bind(serde_json::to_value(&brief)?)
            .bind(&writer.id)
            .bind(&editor.id)
            .bind(Value::Array(minutes.clone()))
            .execute(&mut *tx)
            .await?;
            briefs.push(BriefOut {
                brief_ref,
                writer: writer.id.clone(),
                editor: editor.id.clone(),
            });
        }
        tx.commit().await?;
        Ok(vec![Outcome::MeetingOutcome {
            job_id: req.job_id,
            briefs,
        }])
    }

    async fn load_brief(&self, req: &JobRequest) -> Result<(Brief, String, String, Value)> {
        let brief_ref = req.brief_ref.ok_or_else(|| anyhow!("job {} has no brief_ref", req.job_id))?;
        let row: Option<(Value, String, String, Value)> = sqlx::query_as(
            "SELECT brief, writer, editor, minutes FROM briefs WHERE company_id = $1 AND brief_ref = $2",
        )
        .bind(req.company_id)
        .bind(brief_ref as i64)
        .fetch_optional(&self.pool)
        .await?;
        let (brief, writer, editor, minutes) =
            row.ok_or_else(|| anyhow!("unknown brief_ref {brief_ref}"))?;
        Ok((serde_json::from_value(brief)?, writer, editor, minutes))
    }

    fn staff_by_id<'a>(&self, req: &'a JobRequest, id: &str, fallback_role: &str) -> Result<&'a StaffRef> {
        req.staff
            .iter()
            .find(|s| s.id == id)
            .or_else(|| self.find(req, fallback_role))
            .ok_or_else(|| anyhow!("job {} has no {fallback_role}", req.job_id))
    }

    fn work_item<'a>(&self, req: &'a JobRequest) -> Result<&'a str> {
        req.work_item
            .as_deref()
            .ok_or_else(|| anyhow!("job {} has no work item", req.job_id))
    }

    async fn draft(&self, req: &JobRequest) -> Result<Vec<Outcome>> {
        let item = self.work_item(req)?;
        let (brief, writer_id, editor_id, minutes) = self.load_brief(req).await?;
        let writer = self.staff_by_id(req, &writer_id, "writer")?;
        let editor = self.staff_by_id(req, &editor_id, "editor")?;
        let staffing = self.staffing(writer, editor)?;
        let cfg = self.pipeline_config();

        // First time this item is seen: attach the brief to it in the plan.
        let first = sqlx::query(
            "UPDATE briefs SET work_item = $3 WHERE company_id = $1 AND brief_ref = $2 AND work_item IS NULL",
        )
        .bind(req.company_id)
        .bind(req.brief_ref.unwrap_or_default() as i64)
        .bind(item)
        .execute(&self.pool)
        .await?
        .rows_affected()
            == 1;
        if first {
            self.plan
                .set_item_text(req.company_id, item, Some(&brief.title), Some(&brief.angle))
                .await?;
            let excerpt: Vec<String> = minutes
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|u| Some(format!("{}: {}", u.get("speaker")?.as_str()?, u.get("text")?.as_str()?)))
                .take(12)
                .collect();
            self.plan
                .append_system_post(
                    req.company_id,
                    item,
                    "minutes",
                    &excerpt.join("\n"),
                    &json!({"job": req.job_id, "brief": brief}),
                )
                .await?;
        }

        let previous: Option<(Option<Value>, Option<Value>)> = sqlx::query_as(
            "SELECT page, review FROM work_item_artifacts WHERE company_id = $1 AND work_item = $2",
        )
        .bind(req.company_id)
        .bind(item)
        .fetch_optional(&self.pool)
        .await?;
        let input = match (req.revision, previous) {
            (0, _) => DraftInput::Fresh,
            (_, Some((Some(page), Some(review)))) => DraftInput::Revision {
                page,
                review: serde_json::from_value(review)?,
            },
            (n, _) => bail!("revision {n} of {item} without a previous page and review"),
        };

        let step = draft_step(
            self.llm.as_ref(),
            self.site.validator.as_ref(),
            &brief,
            &staffing,
            &cfg,
            &input,
        )
        .await;
        let mut page = match step {
            DraftStep::Ok { page, .. } => page,
            DraftStep::Invalid { errors, .. } => {
                self.plan
                    .append_system_post(
                        req.company_id,
                        item,
                        "status",
                        "The draft could not be made valid; escalating.",
                        &json!({"errors": errors}),
                    )
                    .await?;
                return Ok(vec![failed(req.job_id)]);
            }
            DraftStep::Failed { error, .. } => {
                self.report_llm_failure(req, item, &error).await?;
                return Ok(vec![failed(req.job_id)]);
            }
        };
        // The orchestrator owns ids and routes: the page lives at its real path.
        page["id"] = json!(brief.content_id);
        page["slug"] = json!({ self.site.language.clone(): format!("/{}/blog/{}", self.site.language, brief.slug) });
        page["status"] = json!("draft");

        let path = brief.page_path();
        let message = if req.revision == 0 {
            format!("Draft: {}", brief.title)
        } else {
            format!("Revision {}: {}", req.revision, brief.title)
        };
        let pr = self
            .content_repo()
            .open_draft(&brief.content_id, &path, &page, &message)
            .await
            .map_err(|e| anyhow!("open draft PR: {e}"))?;
        let head = pr.pr.head_sha.clone();
        sqlx::query(
            "INSERT INTO work_item_artifacts (company_id, work_item, brief_ref, page, revision, path, branch, pr_number, head_sha, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
             ON CONFLICT (company_id, work_item) DO UPDATE SET
               page = EXCLUDED.page, revision = EXCLUDED.revision, path = EXCLUDED.path, branch = EXCLUDED.branch,
               pr_number = EXCLUDED.pr_number, head_sha = EXCLUDED.head_sha, updated_at = now()",
        )
        .bind(req.company_id)
        .bind(item)
        .bind(req.brief_ref.unwrap_or_default() as i64)
        .bind(&page)
        .bind(i32::from(req.revision))
        .bind(&path)
        .bind(&pr.branch)
        .bind(pr.pr.number as i64)
        .bind(&head)
        .execute(&self.pool)
        .await?;

        let words = word_count(&page);
        self.plan
            .append_system_post(
                req.company_id,
                item,
                "artifact",
                &format!("PR #{} on {} ({} words)", pr.pr.number, pr.branch, words),
                &json!({"pr": pr.pr.number, "branch": pr.branch, "path": path, "sha": head, "revision": req.revision}),
            )
            .await?;
        self.plan
            .apply_agent_ops(
                req.company_id,
                item,
                &writer.id,
                &[json!({"op": "handoff", "to": editor.id, "text": if req.revision == 0 {
                    format!("First draft of \"{}\" is in PR #{} for review.", brief.title, pr.pr.number)
                } else {
                    format!("Revision {} addresses the review; PR #{} updated.", req.revision, pr.pr.number)
                }})],
            )
            .await?;
        Ok(vec![Outcome::JobCompleted {
            job_id: req.job_id,
            digest: Digest {
                ok: true,
                score: 0,
                words,
                qa_defects: 0,
                artifact_sha: Some(head),
            },
        }])
    }

    async fn review(&self, req: &JobRequest) -> Result<Vec<Outcome>> {
        let item = self.work_item(req)?;
        let (brief, writer_id, editor_id, _) = self.load_brief(req).await?;
        let writer = self.staff_by_id(req, &writer_id, "writer")?;
        let editor = self.staff_by_id(req, &editor_id, "editor")?;
        let staffing = self.staffing(writer, editor)?;
        let (page,): (Option<Value>,) = sqlx::query_as(
            "SELECT page FROM work_item_artifacts WHERE company_id = $1 AND work_item = $2",
        )
        .bind(req.company_id)
        .bind(item)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| anyhow!("review of {item} before any draft"))?;
        let page = page.ok_or_else(|| anyhow!("review of {item} without a page"))?;

        let review: EditorReview = match review_step(
            self.llm.as_ref(),
            &brief,
            &staffing,
            &self.pipeline_config(),
            &page,
            req.revision as usize,
        )
        .await
        {
            Ok(r) => r,
            Err(error) => {
                self.report_llm_failure(req, item, &error).await?;
                return Ok(vec![failed(req.job_id)]);
            }
        };
        sqlx::query("UPDATE work_item_artifacts SET review = $3, updated_at = now() WHERE company_id = $1 AND work_item = $2")
            .bind(req.company_id)
            .bind(item)
            .bind(serde_json::to_value(&review)?)
            .execute(&self.pool)
            .await?;
        let verdict = match review.decision {
            agents::pipeline::ReviewDecision::Approve if review.score >= self.site.quality_bar => "approve",
            agents::pipeline::ReviewDecision::Reject => "reject",
            _ => "changes",
        };
        let mut text = review.notes.clone();
        for i in &review.issues {
            text.push_str(&format!("\n- {i}"));
        }
        self.plan
            .apply_agent_ops(
                req.company_id,
                item,
                &editor.id,
                &[json!({"op": "review", "verdict": verdict, "score": review.score, "text": text})],
            )
            .await?;
        // High-risk flags and rejections are reported as not-ok: the sim blocks
        // the item and opens a ticket for the CEO.
        let ok = review.high_risk.is_empty() && review.decision != agents::pipeline::ReviewDecision::Reject;
        Ok(vec![Outcome::JobCompleted {
            job_id: req.job_id,
            digest: Digest {
                ok,
                score: review.score,
                words: word_count(&page),
                qa_defects: review.issues.len().min(u16::MAX as usize) as u16,
                artifact_sha: None,
            },
        }])
    }

    async fn publish(&self, req: &JobRequest) -> Result<Vec<Outcome>> {
        let item = self.work_item(req)?.to_string();
        let row: Option<(Option<i64>, Option<String>, Option<String>)> = sqlx::query_as(
            "SELECT pr_number, head_sha, merged_sha FROM work_item_artifacts WHERE company_id = $1 AND work_item = $2",
        )
        .bind(req.company_id)
        .bind(&item)
        .fetch_optional(&self.pool)
        .await?;
        let (pr, head, merged) = row.ok_or_else(|| anyhow!("publish of {item} without a PR"))?;
        let merged_sha = match merged {
            Some(sha) => sha, // idempotent retry
            None => {
                let pr = pr.ok_or_else(|| anyhow!("publish of {item} without a PR"))?;
                let head = head.ok_or_else(|| anyhow!("publish of {item} without a head sha"))?;
                let result = self
                    .content_repo()
                    .merge_draft(pr as u64, &head)
                    .await
                    .map_err(|e| anyhow!("merge PR #{pr}: {e}"))?;
                sqlx::query("UPDATE work_item_artifacts SET merged_sha = $3, updated_at = now() WHERE company_id = $1 AND work_item = $2")
                    .bind(req.company_id)
                    .bind(&item)
                    .bind(&result.sha)
                    .execute(&self.pool)
                    .await?;
                self.plan
                    .append_system_post(
                        req.company_id,
                        &item,
                        "artifact",
                        &format!("PR #{pr} merged ({})", &result.sha[..result.sha.len().min(7)]),
                        &json!({"pr": pr, "merged_sha": result.sha}),
                    )
                    .await?;
                result.sha
            }
        };
        let mut out = vec![Outcome::JobCompleted {
            job_id: req.job_id,
            digest: Digest {
                ok: true,
                score: 0,
                words: 0,
                qa_defects: 0,
                artifact_sha: Some(merged_sha),
            },
        }];
        if self.site.simulate_deploy {
            self.plan
                .append_system_post(req.company_id, &item, "status", "Deployed (simulated).", &json!({}))
                .await?;
            out.push(Outcome::DeployLanded { work_item: item });
        }
        Ok(out)
    }

    async fn report_llm_failure(&self, req: &JobRequest, item: &str, error: &LlmError) -> Result<()> {
        self.plan
            .append_system_post(
                req.company_id,
                item,
                "status",
                "A model call failed; the item is blocked until the CEO decides.",
                &json!({"error": error.to_string()}),
            )
            .await
            .map(|_| ())
            .context("record llm failure")
    }
}

fn failed(job_id: u64) -> Outcome {
    Outcome::JobCompleted {
        job_id,
        digest: Digest {
            ok: false,
            score: 0,
            words: 0,
            qa_defects: 0,
            artifact_sha: None,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugs_are_url_safe() {
        assert_eq!(slugify("Harvest week in Manarola!"), "harvest-week-in-manarola");
        assert_eq!(slugify("Più vino, più città"), "piu-vino-piu-citta");
        assert_eq!(slugify("  --  "), "");
    }

    #[test]
    fn brief_refs_are_stable_positive_and_distinct() {
        let c = Uuid::nil();
        let a = brief_ref_for(c, 7, 0);
        assert_eq!(a, brief_ref_for(c, 7, 0));
        assert_ne!(a, brief_ref_for(c, 7, 1));
        assert!(a <= i64::MAX as u64);
    }

    #[test]
    fn article_schema_pages_pass_the_canonical_schema() {
        let page = json!({
            "id": "content-1", "slug": {"en": "/en/blog/x"}, "title": {"en": "X"},
            "page_type": "blog-article", "seo": {"title": "X", "description": "d"},
            "body": [
                {"type": "heading", "level": 2, "text": "Setting out"},
                {"type": "paragraph", "markdown": "We left Monterosso early."},
                {"type": "faq", "items": [{"question": "Is it steep?", "answer": "Yes."}]}
            ]
        });
        let validator = jsonschema::validator_for(&article_schema()).unwrap();
        assert!(validator.is_valid(&page));
        content_schema::validate_page(&page).unwrap();
        assert_eq!(word_count(&page), 12);
    }
}
