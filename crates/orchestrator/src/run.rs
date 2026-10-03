//! [`Orchestrator::run`]: one sim job request → agent work → outcomes.

use std::sync::Arc;

use agents::article_prompts::{LlmProfile, STAGE_BLOCK_DOCS};
use agents::pipeline::PageValidator;
use agents::prompts::{resolve, templates, PromptLayer, SiteContext, Vars};
use agents::{
    run_meeting, Brief, CompanyPrompt, Llm, LlmError, MeetingEvent, MeetingSpec, Participant,
    Persona, Role,
};
use serde_json::{json, Value};

use crate::article::{brief_ref_for, slugify, SiteValidatorV2};
use crate::gateway::{Gateway, GatewayError};
use crate::site::{ConfigSource, SiteKnowledge};
use crate::store::{ArtifactRecord, BriefRecord, Store, StoreError};
use crate::{BriefOut, Digest, JobKind, JobRequest, Outcome, Progress, StaffRef};

/// Infrastructure failures. Agent failures (refusals, invalid output) are not
/// errors: they come back as `ok: false` digests with a `status` post.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum OrchestratorError {
    #[error(transparent)]
    Store(#[from] StoreError),
    #[error(transparent)]
    Gateway(#[from] GatewayError),
    /// The request doesn't fit the stored state (unknown brief, missing work
    /// item, revision without a previous draft, ...).
    #[error("invalid job: {0}")]
    Invalid(String),
    /// Prompt layering failed (missing variables, unknown persona).
    #[error("prompt: {0}")]
    Prompt(String),
    /// A stored record didn't deserialize.
    #[error("corrupt record: {0}")]
    Corrupt(String),
}

pub(crate) type Result<T> = std::result::Result<T, OrchestratorError>;

pub(crate) fn invalid(msg: impl Into<String>) -> OrchestratorError {
    OrchestratorError::Invalid(msg.into())
}

pub(crate) fn corrupt(e: serde_json::Error) -> OrchestratorError {
    OrchestratorError::Corrupt(e.to_string())
}

/// How one project's site is wired (repo access lives in the [`Gateway`]).
///
/// The browser and the runner build it from JSON ([`SiteBinding::from_json`],
/// `crate::site`): with the site's knowledge pack, the style guide and the
/// writer prompt are the site's own files and [`Self::knowledge`] holds the
/// loaded closed world.
pub struct SiteBinding {
    pub site_id: String,
    pub brand_name: String,
    pub language: String,
    pub context: SiteContext,
    /// The schema-v1 page validator of the single-call draft (kept for the
    /// legacy pipeline; the staged Draft job uses [`Self::validator_v2`]).
    pub validator: Arc<dyn PageValidator>,
    /// The staged article's validator (`site_validator_v2`): schema v2,
    /// article profile, house style and the closed world of
    /// [`Self::knowledge`]. `None` without a knowledge pack.
    pub validator_v2: Option<Arc<SiteValidatorV2>>,
    /// The model's budget: every staged call fits its context (ADR-0058).
    pub llm: LlmProfile,
    /// A review whose reading text and checks are estimated at no more than
    /// this many tokens is one call; a longer one is read part by part.
    pub review_single_tokens: u32,
    /// After `" | "` in an article's `seo.title`.
    pub seo_suffix: String,
    /// The site's guidance for articles (`writer-prompt.json`
    /// `page_prompts.blog_article.writing_prompt`), given to the outline.
    pub article_guidance: Option<String>,
    /// Approval bar (the sim applies it; also shown to the editor).
    pub quality_bar: u8,
    /// Test and dev: report `DeployLanded` right after the merge instead of
    /// waiting for the site repo's `deployment_status` webhook.
    pub simulate_deploy: bool,
    pub standup_max_turns: u32,
    /// The site's knowledge pack, loaded (ADR-0061). The staged Draft job
    /// builds its `context#0` from it ([`crate::article_context`]) and
    /// validates against it; without a pack a Draft job is an invalid job.
    pub knowledge: Option<SiteKnowledge>,
    /// Where [`SiteContext::style_guide`] came from.
    pub style_source: ConfigSource,
    /// Where the writer-prompt layer of [`Self::context`] came from.
    pub writer_prompt_source: ConfigSource,
}

/// Runs sim jobs. Generic over where text lives ([`Store`]) and how the repo
/// is reached ([`Gateway`]); the LLM is the agents crate's [`Llm`].
pub struct Orchestrator<S: Store, G: Gateway> {
    pub(crate) store: S,
    pub(crate) gateway: G,
    pub(crate) llm: Arc<dyn Llm>,
    pub(crate) site: SiteBinding,
    pub(crate) progress: Option<Arc<dyn Progress>>,
}

fn role_of(r: &str) -> Option<Role> {
    match r {
        "writer" => Some(Role::Writer),
        "editor" => Some(Role::Editor),
        "editor-in-chief" => Some(Role::EditorInChief),
        _ => None,
    }
}

/// Builtin persona by catalog slug ("giulia") or name ("Giulia").
pub(crate) fn persona(slug: &str) -> Result<Persona> {
    let mut chars = slug.chars();
    let name: String = chars
        .next()
        .map(|c| c.to_uppercase().chain(chars).collect())
        .unwrap_or_default();
    Persona::builtin(slug)
        .or_else(|| Persona::builtin(&name))
        .ok_or_else(|| OrchestratorError::Prompt(format!("unknown persona {slug}")))
}

pub(crate) fn failed(job_id: u64) -> Outcome {
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

impl<S: Store, G: Gateway> Orchestrator<S, G> {
    pub fn new(store: S, gateway: G, llm: Arc<dyn Llm>, site: SiteBinding) -> Self {
        Self {
            store,
            gateway,
            llm,
            site,
            progress: None,
        }
    }

    /// Reports every stage of every job to `progress` ([`crate::ProgressEvent`]).
    pub fn with_progress(mut self, progress: Arc<dyn Progress>) -> Self {
        self.progress = Some(progress);
        self
    }

    pub fn store(&self) -> &S {
        &self.store
    }

    pub fn gateway(&self) -> &G {
        &self.gateway
    }

    pub fn site(&self) -> &SiteBinding {
        &self.site
    }

    /// Runs one job. Errors are infrastructure failures (store, gateway) or
    /// requests that don't fit the stored state; the caller may retry. Agent
    /// failures are reported as `ok: false`.
    pub async fn run(&self, req: &JobRequest) -> Result<Vec<Outcome>> {
        match req.kind {
            JobKind::Standup => self.standup(req).await,
            JobKind::Draft => self.staged_draft(req).await,
            JobKind::Review => self.staged_review(req).await,
            JobKind::Publish => self.publish(req).await,
        }
    }

    // ------------------------------------------------------------ prompts

    pub(crate) fn system_prompt(
        &self,
        company: &CompanyPrompt,
        p: &Persona,
        extra: Vars,
    ) -> Result<String> {
        let agent = PromptLayer::from_persona(p, &self.site.language);
        let mut runtime = Vars::new();
        runtime.insert("brand_name".into(), json!(self.site.brand_name));
        runtime.insert("approve_threshold".into(), json!(self.site.quality_bar));
        runtime.insert("block_docs".into(), json!(STAGE_BLOCK_DOCS));
        runtime.extend(extra);
        let site = self.site.context.variables_only();
        let layer = if company.id == "writer" {
            &self.site.context.layer
        } else {
            &site
        };
        resolve(company, Some(layer), Some(&agent), &runtime)
            .map(|r| r.text)
            .map_err(|e| OrchestratorError::Prompt(e.to_string()))
    }

    fn participant(
        &self,
        s: &StaffRef,
        company: &CompanyPrompt,
        extra: Vars,
    ) -> Result<Participant> {
        let p = persona(&s.persona)?;
        Ok(Participant {
            id: s.id.clone(),
            name: p.name.clone(),
            role: role_of(&s.role).unwrap_or(Role::Writer),
            seniority: Some(p.seniority),
            system_prompt: self.system_prompt(company, &p, extra)?,
        })
    }

    // ------------------------------------------------------------ lookups

    fn find<'a>(&self, req: &'a JobRequest, role: &str) -> Option<&'a StaffRef> {
        req.staff.iter().find(|s| s.role == role)
    }

    /// Staff member `id` from the job, else as recorded with the brief, else
    /// anyone in the job with `fallback_role`.
    pub(crate) fn staff_by_id(
        &self,
        req: &JobRequest,
        rec: &BriefRecord,
        id: &str,
        fallback_role: &str,
    ) -> Result<StaffRef> {
        req.staff
            .iter()
            .find(|s| s.id == id)
            .or_else(|| rec.staff.iter().find(|s| s.id == id))
            .or_else(|| self.find(req, fallback_role))
            .cloned()
            .ok_or_else(|| invalid(format!("job {} has no {fallback_role}", req.job_id)))
    }

    pub(crate) fn work_item<'a>(&self, req: &'a JobRequest) -> Result<&'a str> {
        req.work_item
            .as_deref()
            .ok_or_else(|| invalid(format!("job {} has no work item", req.job_id)))
    }

    pub(crate) async fn load_brief(&self, req: &JobRequest) -> Result<BriefRecord> {
        let brief_ref = req
            .brief_ref
            .ok_or_else(|| invalid(format!("job {} has no brief_ref", req.job_id)))?;
        let v = self
            .store
            .get_brief(&req.company_id, brief_ref)
            .await?
            .ok_or_else(|| invalid(format!("unknown brief_ref {brief_ref}")))?;
        serde_json::from_value(v).map_err(corrupt)
    }

    pub(crate) async fn load_artifact(
        &self,
        req: &JobRequest,
        item: &str,
    ) -> Result<Option<ArtifactRecord>> {
        self.store
            .get_artifact(&req.company_id, item)
            .await?
            .map(|v| serde_json::from_value(v).map_err(corrupt))
            .transpose()
    }

    pub(crate) async fn save_artifact(
        &self,
        req: &JobRequest,
        item: &str,
        a: &ArtifactRecord,
    ) -> Result<()> {
        let v = serde_json::to_value(a).map_err(corrupt)?;
        Ok(self.store.put_artifact(&req.company_id, item, v).await?)
    }

    // ------------------------------------------------------------ plan posts

    /// Appends a post. `dedupe` names it within the company: a re-run job
    /// that posts it again writes nothing ([`Store::append_post`]).
    #[allow(clippy::too_many_arguments)]
    pub(crate) async fn post(
        &self,
        req: &JobRequest,
        item: &str,
        kind: &str,
        author: &str,
        to: Option<&str>,
        text: &str,
        payload: Value,
        dedupe: Option<&str>,
    ) -> Result<String> {
        let mut post = json!({"type": kind, "author": author, "text": text, "payload": payload, "job_id": req.job_id});
        if let Some(to) = to {
            post["to"] = json!(to);
        }
        if let Some(key) = dedupe {
            post["dedupe"] = json!(key);
        }
        Ok(self.store.append_post(&req.company_id, item, post).await?)
    }

    /// A `system` post, deduplicated by `"{job}:{kind}:{n}"`.
    pub(crate) async fn system_post(
        &self,
        req: &JobRequest,
        item: &str,
        kind: &str,
        n: u32,
        text: &str,
        payload: Value,
    ) -> Result<String> {
        let key = format!("{}:{kind}:{n}", req.job_id);
        self.post(req, item, kind, "system", None, text, payload, Some(&key))
            .await
    }

    pub(crate) async fn report_llm_failure(
        &self,
        req: &JobRequest,
        item: &str,
        error: &LlmError,
    ) -> Result<()> {
        self.system_post(
            req,
            item,
            "status",
            0,
            "A model call failed; the item is blocked until the CEO decides.",
            json!({"error": error.to_string()}),
        )
        .await
        .map(|_| ())
    }

    // ------------------------------------------------------------ jobs

    async fn standup(&self, req: &JobRequest) -> Result<Vec<Outcome>> {
        let moderator = self
            .find(req, "editor-in-chief")
            .or_else(|| self.find(req, "editor"))
            .ok_or_else(|| invalid("standup without an editor-in-chief or editor"))?;
        let editor = self.find(req, "editor").unwrap_or(moderator);
        let others: Vec<&StaffRef> = req.staff.iter().filter(|s| s.id != moderator.id).collect();

        let mut agenda = Vars::new();
        agenda.insert(
            "agenda".into(),
            json!(format!(
                "Daily standup for {}: what we publish next.",
                self.site.brand_name
            )),
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
        let Ok(result) = run_meeting(self.llm.as_ref(), &spec, &mut on_event).await else {
            // A failed standup ends without briefs; the sim tries again tomorrow.
            return Ok(vec![Outcome::MeetingOutcome {
                job_id: req.job_id,
                briefs: vec![],
            }]);
        };

        for u in &result.transcript {
            self.store
                .append_transcript(&req.company_id, req.job_id, u.seq, &u.speaker, &u.text)
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
                .ok_or_else(|| invalid("standup produced a brief but the team has no writer"))?;
            let brief_ref = brief_ref_for(&req.company_id, req.job_id, i);
            let record = BriefRecord {
                job_id: req.job_id,
                brief: Brief {
                    content_id: format!("content-{brief_ref:x}"),
                    title: b.title.clone(),
                    slug: slugify(&b.title),
                    angle: b.angle.clone(),
                    keywords: b.keywords.clone(),
                    target_words: b.target_words,
                    language: self.site.language.clone(),
                    notes: String::new(),
                },
                writer: writer.id.clone(),
                editor: editor.id.clone(),
                minutes: minutes.clone(),
                work_item: None,
                staff: vec![writer.clone(), editor.clone()],
            };
            self.store
                .put_brief(
                    &req.company_id,
                    brief_ref,
                    serde_json::to_value(&record).map_err(corrupt)?,
                )
                .await?;
            briefs.push(BriefOut {
                brief_ref,
                writer: writer.id.clone(),
                editor: editor.id.clone(),
            });
        }
        Ok(vec![Outcome::MeetingOutcome {
            job_id: req.job_id,
            briefs,
        }])
    }

    async fn publish(&self, req: &JobRequest) -> Result<Vec<Outcome>> {
        let item = self.work_item(req)?.to_string();
        let mut art = self
            .load_artifact(req, &item)
            .await?
            .ok_or_else(|| invalid(format!("publish of {item} without a PR")))?;
        let (merged_sha, fresh) = match art.merged_sha.clone() {
            Some(sha) => (sha, false), // idempotent retry: no second merge, no second post
            None => {
                let pr = art
                    .pr_number
                    .ok_or_else(|| invalid(format!("publish of {item} without a PR")))?;
                let head = art
                    .head_sha
                    .clone()
                    .ok_or_else(|| invalid(format!("publish of {item} without a head sha")))?;
                let sha = self.gateway.merge(pr, &head).await?;
                art.merged_sha = Some(sha.clone());
                self.save_artifact(req, &item, &art).await?;
                self.system_post(
                    req,
                    &item,
                    "artifact",
                    0,
                    &format!("PR #{pr} merged ({})", &sha[..sha.len().min(7)]),
                    json!({"pr": pr, "merged_sha": sha}),
                )
                .await?;
                (sha, true)
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
            if fresh {
                self.system_post(req, &item, "status", 0, "Deployed (simulated).", json!({}))
                    .await?;
            }
            out.push(Outcome::DeployLanded { work_item: item });
        }
        Ok(out)
    }
}
