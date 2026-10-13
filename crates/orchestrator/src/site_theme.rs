//! The web designer's jobs (ADR-0093, FEAT-115): the site's design rendered as its
//! WordPress theme, checked template by template, written on a branch of its own and merged
//! only at the CEO's word.
//!
//! ```text
//! DesignReceived{version}             the host logs it when the design store has a new version
//! SiteTheme (Draft, SiteTheme item)   brief_ref = the design version
//!   → Gateway::site_design(version): {manifest, design}  (the design store)
//!   → the site (`context.site`: theme_designer::SiteContext; the binding's name without it)
//!   → theme_designer::plan: global styles, fonts, menus (deterministic), one task per
//!     template and part
//!   → per task: one structured call `web design template` → check_template → next_step:
//!       Repair{issues} → `web design template fix` → check … (theme_designer::MAX_REPAIR_ROUNDS)
//!       GiveUp → a status post with the issues, JobFailed{InvalidOutput} (rule 11)
//!   → assemble + check_theme (shape, required templates, licences, global pairs)
//!       errors → a status post, JobFailed{InvalidOutput}
//!   → the artifact: SiteThemeRecord{theme data, per-task outcome, notes} (store text, rule 2)
//!   → Gateway::put_theme_data on `design-v{version}` (the WordPress engine writes it over
//!     REST onto the neutral base theme; a change request into live)
//!   → an `artifact` post with the summary
//!   → JobCompleted{ok, score: the share of tasks right first time (0–10), words: tasks,
//!     qa_defects: issues repaired, artifact_sha: the theme data's hash}
//!   a model failure → a status post, JobFailed (never a fake success, rule 11)
//! Publish (after Approve)             the change request merged into live (Gateway::merge_as);
//!   the export and deploy follow the merge → JobCompleted{ok, artifact_sha: the merge}
//! ```
//!
//! The visual comparison of the design's pages and the branch's (a pixel and structure score
//! per page) needs a browser: it runs outside the job, as the runner's step
//! (`apps/game/e2e/theme-visual.mts`), and is not part of the digest yet.

use std::collections::BTreeMap;

use agents::design::{answer_schema, fix_prompt, template_prompt, TemplateInput, TEMPLATE_ANSWER};
use agents::prompts::templates;
use agents::{LlmError, RepairFailed};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use site_design::bundle::BundleManifest;
use site_design::{SiteDesign, ThemeData};
use theme_designer::plan::prompt_context;
use theme_designer::{
    assemble, check_template, check_theme, next_step, plan, Issue, SiteContext, Step,
    MAX_REPAIR_ROUNDS,
};

use crate::run::{corrupt, invalid, Orchestrator, Result};
use crate::staged::stage_hash;
use crate::store::{ArtifactRecord, Store};
use crate::structure::failure;
use crate::{Digest, Gateway, JobRequest, Outcome, ProgressState, StaffRef};

/// `SiteThemeRecord.kind`.
pub const SITE_THEME_KIND: &str = "site-theme";

/// How one template or part came out.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TaskOutcome {
    /// `template front-page`, `part header`.
    pub task: String,
    /// Repair rounds it took (0: right first time).
    pub rounds: u8,
    /// The issues the repairs fixed, as the checker named them.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub repaired: Vec<String>,
}

/// The web designer's artifact: what the CEO approves and the Publish job merges.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SiteThemeRecord {
    /// [`SITE_THEME_KIND`].
    pub kind: String,
    pub design_version: u32,
    /// The design bundle's hash.
    pub design: String,
    /// `design-v{version}`.
    pub branch: String,
    /// The branch's change request (pull request) into live.
    pub pr_number: u64,
    pub head_sha: String,
    /// Set once merged; publishing again is a no-op.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub merged_sha: Option<String>,
    pub theme: ThemeData,
    pub tasks: Vec<TaskOutcome>,
    /// What the deterministic part and the design's rules noted (not errors).
    #[serde(default)]
    pub notes: Vec<Issue>,
    /// One line for the CEO.
    pub summary: String,
    /// The digest's score.
    pub score: u8,
}

/// The branch a design version's theme is written on.
pub fn theme_branch(version: u32) -> String {
    format!("design-v{version}")
}

fn lines(issues: &[Issue]) -> Vec<String> {
    issues.iter().map(Issue::line).collect()
}

fn invalid_answer(errors: Vec<String>) -> RepairFailed {
    RepairFailed {
        error: LlmError::InvalidOutput {
            errors,
            answer: None,
        },
        calls: 0,
        repairs: 0,
        no_progress: false,
    }
}

fn content_of(v: &Value) -> String {
    v["content"].as_str().unwrap_or("").to_string()
}

impl<S: Store, G: Gateway> Orchestrator<S, G> {
    /// A theme that could not be made: the issues in the item's thread, the job failed.
    async fn site_theme_failed(
        &self,
        req: &JobRequest,
        item: &str,
        who: &StaffRef,
        f: &RepairFailed,
        why: &str,
    ) -> Result<Vec<Outcome>> {
        if let Some(reason) = self.cancelled(req) {
            return Ok(self.failed(req, reason));
        }
        let reason = failure(f)?;
        let errors = f.errors();
        let mut text = format!("The theme could not be made: {why}.");
        if !errors.is_empty() {
            text.push('\n');
            text.push_str(
                &errors
                    .iter()
                    .take(12)
                    .map(|e| format!("- {}", e.trim_start_matches("- ")))
                    .collect::<Vec<_>>()
                    .join("\n"),
            );
        }
        self.system_post(
            req,
            item,
            "status",
            0,
            &text,
            json!({"site_theme": "failed", "errors": errors}),
        )
        .await?;
        self.report_job(req, Some(who), ProgressState::Failed, json!({"error": why}));
        Ok(self.failed(req, reason))
    }

    /// The design version, the design and its manifest, and the site of a theme job.
    async fn site_theme_inputs(
        &self,
        req: &JobRequest,
    ) -> Result<(u32, SiteDesign, BundleManifest, SiteContext)> {
        let version = req
            .brief_ref
            .and_then(|v| u32::try_from(v).ok())
            .filter(|v| *v > 0)
            .ok_or_else(|| invalid(format!("job {} names no design version", req.job_id)))?;
        let answer = self.gateway.site_design(version).await?;
        let design: SiteDesign = serde_json::from_value(answer["design"].clone())
            .map_err(|e| invalid(format!("design version {version}: {e}")))?;
        let manifest: BundleManifest = serde_json::from_value(answer["manifest"].clone())
            .map_err(|e| invalid(format!("design version {version}'s manifest: {e}")))?;
        let site = match req.context.get("site").filter(|v| !v.is_null()) {
            Some(v) => serde_json::from_value(v.clone())
                .map_err(|e| invalid(format!("the site of job {}: {e}", req.job_id)))?,
            None => SiteContext {
                name: self.site().brand_name.clone(),
                languages: vec![self.site().language.clone()],
                links: Vec::new(),
                collections: Vec::new(),
            },
        };
        Ok((version, design, manifest, site))
    }

    /// The `SiteTheme` job (module docs).
    pub(crate) async fn site_theme(&self, req: &JobRequest) -> Result<Vec<Outcome>> {
        let item = self.work_item(req)?.to_string();
        let who = req
            .staff
            .first()
            .ok_or_else(|| invalid(format!("job {} has nobody to do it", req.job_id)))?
            .clone();
        self.report_job(req, Some(&who), ProgressState::Started, json!({}));
        let (version, design, manifest, site) = self.site_theme_inputs(req).await?;
        let title = format!("Theme: {} (design v{version})", design.title.trim());
        self.store
            .set_item_text(&req.company_id, &item, Some(&title), None)
            .await?;
        let p = plan(&design, &manifest, &site);
        let mut design_errors: Vec<Issue> =
            p.notes.iter().filter(|n| n.is_error()).cloned().collect();
        design_errors.extend(p.font_licences());
        if !design_errors.is_empty() {
            let f = invalid_answer(lines(&design_errors));
            return self
                .site_theme_failed(req, &item, &who, &f, "the design itself does not pass")
                .await;
        }
        let context = prompt_context(&p, &design);
        let parts = p.part_slugs();
        let ctx = p.context(&parts);
        let template = templates::web_designer();
        let schema = answer_schema();
        let has_content = |v: &Value| {
            if content_of(v).trim().is_empty() {
                Err(vec!["/content: the markup is empty".to_string()])
            } else {
                Ok(())
            }
        };
        let total = u32::try_from(p.tasks.len()).unwrap_or(u32::MAX);
        let mut markup: BTreeMap<String, String> = BTreeMap::new();
        let mut outcomes = Vec::new();
        for (index, task) in p.tasks.iter().enumerate() {
            let index = u32::try_from(index).unwrap_or(u32::MAX);
            let label = task.label();
            let key = label.replace(' ', ":");
            if let Some(reason) = self.cancelled(req) {
                return Ok(self.failed(req, reason));
            }
            self.report(
                req,
                Some(&who),
                "template",
                index,
                total,
                ProgressState::Started,
                json!({"task": label}),
            );
            let input = TemplateInput {
                task,
                presets: &p.presets,
                context: &context,
            };
            let answer = self
                .propose(
                    req,
                    &who,
                    &template,
                    agents::JobKind::WebDesign,
                    &format!("web_design:{key}"),
                    template_prompt(&input),
                    TEMPLATE_ANSWER,
                    &schema,
                    &has_content,
                )
                .await?;
            let mut current = match answer {
                Ok((v, _)) => content_of(&v),
                Err(f) => {
                    let why = format!("the model gave no markup for the {label}");
                    return self.site_theme_failed(req, &item, &who, &f, &why).await;
                }
            };
            let mut round = 0u8;
            let mut repaired = Vec::new();
            loop {
                if let Some(reason) = self.cancelled(req) {
                    return Ok(self.failed(req, reason));
                }
                let issues = check_template(task, &current, &ctx);
                match next_step(&issues, round, MAX_REPAIR_ROUNDS) {
                    Step::Done => break,
                    Step::GiveUp { reason, issues } => {
                        let f = invalid_answer(lines(&issues));
                        let why = format!("the {label} does not pass ({reason})");
                        return self.site_theme_failed(req, &item, &who, &f, &why).await;
                    }
                    Step::Repair(task_fix) => {
                        self.report(
                            req,
                            Some(&who),
                            "fix",
                            u32::from(task_fix.round),
                            u32::from(MAX_REPAIR_ROUNDS),
                            ProgressState::Started,
                            json!({"task": label, "issues": task_fix.issues.len()}),
                        );
                        repaired.extend(lines(&task_fix.issues));
                        let user = fix_prompt(&input, &current, &task_fix.prompt());
                        let answer = self
                            .propose(
                                req,
                                &who,
                                &template,
                                agents::JobKind::WebDesign,
                                &format!("web_design_fix:{key}:{}", task_fix.round),
                                user,
                                TEMPLATE_ANSWER,
                                &schema,
                                &has_content,
                            )
                            .await?;
                        current = match answer {
                            Ok((v, _)) => content_of(&v),
                            Err(f) => {
                                let why = format!("the model gave no fix for the {label}");
                                return self.site_theme_failed(req, &item, &who, &f, &why).await;
                            }
                        };
                        round = task_fix.round;
                    }
                }
            }
            self.report(
                req,
                Some(&who),
                "template",
                index,
                total,
                ProgressState::Done,
                json!({"task": label, "repairs": round}),
            );
            markup.insert(label.clone(), current);
            outcomes.push(TaskOutcome {
                task: label,
                rounds: round,
                repaired,
            });
        }

        // The whole theme, before anything is written.
        let data = assemble(&p, &markup);
        let errors: Vec<Issue> = check_theme(&data, &p)
            .into_iter()
            .filter(Issue::is_error)
            .collect();
        if !errors.is_empty() {
            let f = invalid_answer(lines(&errors));
            return self
                .site_theme_failed(req, &item, &who, &f, "the theme as a whole does not pass")
                .await;
        }
        let mut notes = p.notes.clone();
        notes.extend(theme_designer::check::guidance(&p));

        if let Some(reason) = self.cancelled(req) {
            return Ok(self.failed(req, reason));
        }
        let branch = theme_branch(version);
        let n = outcomes.len();
        let first = outcomes.iter().filter(|o| o.rounds == 0).count();
        let repaired: usize = outcomes.iter().map(|o| o.repaired.len()).sum();
        let score = u8::try_from((first * 10).checked_div(n).unwrap_or(0)).unwrap_or(10);
        let summary = format!(
            "{} (design v{version}): {} templates and {} parts on {branch}; {first} of {n} right first time, {repaired} issues repaired; {} fonts, {} menus.",
            design.title.trim(),
            data.templates.len(),
            data.template_parts.len(),
            data.fonts.len(),
            data.navigation.len()
        );
        let message = format!("Theme from design v{version} ({item}, job {})", req.job_id);
        let who_attr = self.attribution(req, &who, "site-theme");
        let pr = self
            .gateway
            .put_theme_data(&branch, &data, &message, Some(&who_attr))
            .await?;
        let record = SiteThemeRecord {
            kind: SITE_THEME_KIND.into(),
            design_version: version,
            design: design.bundle.clone(),
            branch: pr.branch.clone(),
            pr_number: pr.number,
            head_sha: pr.head_sha.clone(),
            merged_sha: None,
            theme: data,
            tasks: outcomes,
            notes,
            summary: summary.clone(),
            score,
        };
        let sha = stage_hash(&[&serde_json::to_string(&record.theme).map_err(corrupt)?]);
        let mut art = self.load_artifact(req, &item).await?.unwrap_or_default();
        art.brief_ref = req.brief_ref.unwrap_or(art.brief_ref);
        art.revision = req.revision;
        art.model = self.llm.model_id().or(art.model);
        art.branch = Some(pr.branch.clone());
        art.pr_number = Some(pr.number);
        art.head_sha = Some(pr.head_sha.clone());
        art.site_theme = Some(record.clone());
        self.save_artifact(req, &item, &art).await?;
        let mut text = summary.clone();
        let shown: Vec<&Issue> = record.notes.iter().take(8).collect();
        if !shown.is_empty() {
            text.push_str("\n\nWorth knowing:\n");
            text.push_str(
                &shown
                    .iter()
                    .map(|i| format!("- {}: {}", i.at, i.message))
                    .collect::<Vec<_>>()
                    .join("\n"),
            );
        }
        let key = format!("{}:artifact:0", req.job_id);
        self.post(
            req,
            &item,
            "artifact",
            &who.id,
            None,
            &text,
            json!({"site_theme": {
                "design_version": version,
                "branch": record.branch,
                "pr": record.pr_number,
                "templates": record.theme.templates.iter().map(|t| t.slug.clone()).collect::<Vec<_>>(),
                "parts": record.theme.template_parts.iter().map(|t| t.slug.clone()).collect::<Vec<_>>(),
                "tasks": record.tasks,
                "notes": lines(&record.notes),
                "score": score,
            }}),
            Some(&key),
        )
        .await?;
        self.report_job(
            req,
            Some(&who),
            ProgressState::Done,
            json!({"templates": n, "repairs": repaired, "branch": record.branch}),
        );
        Ok(vec![Outcome::JobCompleted {
            job_id: req.job_id,
            digest: Digest {
                ok: true,
                score,
                words: u32::try_from(n).unwrap_or(u32::MAX),
                qa_defects: u16::try_from(repaired).unwrap_or(u16::MAX),
                artifact_sha: Some(sha),
            },
        }])
    }

    /// The Publish job of a `SiteTheme` item (after the CEO's Approve): the branch's change
    /// request merged into live; the export and deploy follow the merge.
    pub(crate) async fn apply_site_theme(
        &self,
        req: &JobRequest,
        item: &str,
        mut art: ArtifactRecord,
    ) -> Result<Vec<Outcome>> {
        let mut rec = art
            .site_theme
            .clone()
            .ok_or_else(|| invalid(format!("{item} has no theme")))?;
        let completed = |sha: String| {
            vec![Outcome::JobCompleted {
                job_id: req.job_id,
                digest: Digest {
                    ok: true,
                    score: rec.score,
                    words: 0,
                    qa_defects: 0,
                    artifact_sha: Some(sha),
                },
            }]
        };
        // Merged already: a run again after a reload merges nothing.
        if let Some(sha) = rec.merged_sha.clone() {
            return Ok(completed(sha));
        }
        if let Some(reason) = self.cancelled(req) {
            return Ok(self.failed(req, reason));
        }
        let who = req
            .staff
            .first()
            .ok_or_else(|| invalid(format!("job {} has nobody to do it", req.job_id)))?;
        let mut attribution = self.attribution(req, who, "publish");
        attribution.approved_by = req.approved_by.clone().filter(|a| !a.trim().is_empty());
        let sha = self
            .gateway
            .merge_as(rec.pr_number, &rec.head_sha, Some(&attribution))
            .await?;
        rec.merged_sha = Some(sha.clone());
        art.merged_sha = Some(sha.clone());
        art.site_theme = Some(rec.clone());
        self.save_artifact(req, item, &art).await?;
        self.system_post(
            req,
            item,
            "artifact",
            0,
            &format!(
                "The theme of design v{} is live ({}): {} templates, {} parts.",
                rec.design_version,
                &sha[..sha.len().min(7)],
                rec.theme.templates.len(),
                rec.theme.template_parts.len()
            ),
            json!({"site_theme": "merged", "design_version": rec.design_version, "merged_sha": sha}),
        )
        .await?;
        Ok(completed(sha))
    }
}
