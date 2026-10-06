//! [`Orchestrator::run`]: one sim job request → agent work → outcomes.

use std::sync::Arc;

use agents::article_prompts::{LlmProfile, STAGE_BLOCK_DOCS};
use agents::prompts::{resolve, PromptLayer, SiteContext, Vars};
use agents::{CompanyPrompt, Llm, LlmError, Persona, Role};
use serde_json::{json, Value};

use crate::article::SiteValidatorV2;
use crate::gateway::{Attribution, DeployState, Gateway, GatewayError};
use crate::site::{ConfigSource, SiteKnowledge};
use crate::store::{ArtifactRecord, BriefRecord, Store, StoreError};
use crate::{Digest, JobFailure, JobKind, JobRequest, Outcome, Progress, StaffRef};

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
    /// The model is gone (`LlmError::Unavailable`: the GPU device was lost
    /// more often than the runtime retries a call). Not the job's failure:
    /// the host waits for the model and runs the same job again, which
    /// resumes from its stored stages (ADR-0058, P6).
    #[error("model unavailable: {0}")]
    Unavailable(String),
}

/// Stops running jobs between stages (P6). The host cancels a job that ran
/// past its wall-clock limit (`reason` [`JobFailure::Timeout`]) or that is no
/// longer wanted ([`JobFailure::Cancelled`]); the job checks before each model
/// call and before its repo write, and ends with `JobFailed{reason}`. Stages it
/// completed stay stored, so a retried phase adopts them.
///
/// Keyed by job id: a cancel never reaches another job, and a job's entry is
/// dropped when its run returns.
#[derive(Debug, Clone, Default)]
pub struct CancelToken(Arc<std::sync::Mutex<std::collections::BTreeMap<u64, JobFailure>>>);

impl CancelToken {
    fn lock(&self) -> std::sync::MutexGuard<'_, std::collections::BTreeMap<u64, JobFailure>> {
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Asks job `job_id` to stop; the first reason given wins.
    pub fn cancel(&self, job_id: u64, reason: JobFailure) {
        self.lock().entry(job_id).or_insert(reason);
    }

    /// Why job `job_id` was cancelled, if it was.
    pub fn reason(&self, job_id: u64) -> Option<JobFailure> {
        self.lock().get(&job_id).copied()
    }

    pub(crate) fn clear(&self, job_id: u64) {
        self.lock().remove(&job_id);
    }
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
    /// The staged article's validator (`site_validator_v2`): schema v2,
    /// article profile, house style and the closed world of
    /// [`Self::knowledge`]. `None` without a knowledge pack.
    pub validator_v2: Option<Arc<SiteValidatorV2>>,
    /// The model's budget: every staged call fits its context (ADR-0058).
    pub llm: LlmProfile,
    /// A review whose reading text and checks are estimated at no more than
    /// this many tokens is one call; a longer one is read part by part.
    pub review_single_tokens: u32,
    /// After `" | "` in an article's `seo.title`: the binding's own, else
    /// what the site's existing articles use, else the blog's name, else the
    /// brand ([`Self::seo_suffix_source`]).
    pub seo_suffix: String,
    /// Where [`Self::seo_suffix`] came from.
    pub seo_suffix_source: crate::site::SeoSuffixSource,
    /// Who runs the jobs, as the `Executor` of a commit's provenance
    /// (ADR-0045 wording: `browser <device> epoch <n>`). `None`: the central
    /// gateway names the lease holder itself.
    pub executor: Option<String>,
    /// The site's guidance for articles (`writer-prompt.json`
    /// `page_prompts.blog_article.writing_prompt`), given to the outline.
    pub article_guidance: Option<String>,
    /// Approval bar (the sim applies it; also shown to the editor).
    pub quality_bar: u8,
    /// Test and dev: report `DeployLanded` right after the merge instead of
    /// waiting for the site repo's `deployment_status` webhook.
    pub simulate_deploy: bool,
    /// Speaking turns of the moderated meeting of ADR-0012. The standup is a
    /// pitch round (ADR-0062, `crate::standup`) and does not read it.
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
    pub(crate) cancel: CancelToken,
}

pub(crate) fn role_of(r: &str) -> Option<Role> {
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

/// The display name of a persona, or its slug when the catalog has none.
pub(crate) fn display_name(slug: &str) -> String {
    persona(slug).map_or_else(|_| slug.to_string(), |p| p.name)
}

impl<S: Store, G: Gateway> Orchestrator<S, G> {
    pub fn new(store: S, gateway: G, llm: Arc<dyn Llm>, site: SiteBinding) -> Self {
        Self {
            store,
            gateway,
            llm,
            site,
            progress: None,
            cancel: CancelToken::default(),
        }
    }

    /// The token that cancels this orchestrator's running jobs (P6).
    pub fn cancel_token(&self) -> CancelToken {
        self.cancel.clone()
    }

    /// Asks job `job_id` to stop at its next stage boundary
    /// ([`CancelToken::cancel`]).
    pub fn cancel(&self, job_id: u64, reason: JobFailure) {
        self.cancel.cancel(job_id, reason);
    }

    /// Why job `req` was cancelled, if it was.
    pub(crate) fn cancelled(&self, req: &JobRequest) -> Option<JobFailure> {
        self.cancel.reason(req.job_id)
    }

    /// Who did the work of `req`: `who`'s persona as the author, and the job.
    /// The model is the backend's, the executor the binding's.
    pub(crate) fn attribution(&self, req: &JobRequest, who: &StaffRef, kind: &str) -> Attribution {
        Attribution {
            persona: Some(who.persona.clone()),
            role: Some(who.role.clone()),
            job_id: Some(req.job_id),
            job_kind: Some(kind.to_string()),
            revision: Some(req.revision),
            work_item: req.work_item.clone(),
            model: self.llm.model_id(),
            executor: self.site.executor.clone(),
            ..Attribution::new(who.id.clone(), display_name(&who.persona))
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
        let out = self.run_kind(req).await;
        // A cancel is for this run: a later run of the same job (a reload) starts afresh.
        self.cancel.clear(req.job_id);
        out
    }

    async fn run_kind(&self, req: &JobRequest) -> Result<Vec<Outcome>> {
        match req.kind {
            JobKind::Standup => {
                let who = self
                    .find(req, "editor-in-chief")
                    .or_else(|| self.find(req, "editor"));
                self.report_job(req, who, crate::ProgressState::Started, json!({}));
                let out = self.standup(req).await;
                self.report_outcome(req, who, &out);
                out
            }
            JobKind::Board => {
                let who = self
                    .find(req, "strategist")
                    .or_else(|| self.find(req, "editor-in-chief"));
                self.report_job(req, who, crate::ProgressState::Started, json!({}));
                let out = self.board(req).await;
                self.report_outcome(req, who, &out);
                out
            }
            JobKind::Draft => self.staged_draft(req).await,
            JobKind::Review => self.staged_review(req).await,
            JobKind::Publish => {
                let who = req.staff.first();
                self.report_job(req, who, crate::ProgressState::Started, json!({}));
                let out = self.publish(req).await;
                self.report_outcome(req, who, &out);
                out
            }
        }
    }

    /// The job-level progress event of a job without stages (standup, publish).
    fn report_outcome(&self, req: &JobRequest, who: Option<&StaffRef>, out: &Result<Vec<Outcome>>) {
        let (state, detail) = match out {
            Ok(o) => {
                let detail = match o.first() {
                    Some(Outcome::MeetingOutcome { briefs, .. }) => json!({"briefs": briefs.len()}),
                    Some(Outcome::BoardOutcome { items, .. }) => json!({"items": items.len()}),
                    Some(Outcome::JobCompleted { digest, .. }) => {
                        json!({"ok": digest.ok, "merged_sha": digest.artifact_sha})
                    }
                    _ => json!({}),
                };
                (crate::ProgressState::Done, detail)
            }
            Err(e) => (
                crate::ProgressState::Failed,
                json!({"error": e.to_string()}),
            ),
        };
        self.report_job(req, who, state, detail);
    }

    pub(crate) fn report_job(
        &self,
        req: &JobRequest,
        who: Option<&StaffRef>,
        state: crate::ProgressState,
        detail: Value,
    ) {
        self.report(req, who, "job", 0, 1, state, detail);
    }

    /// Hands one [`crate::ProgressEvent`] to the progress sink, if any.
    #[inline(never)]
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn report(
        &self,
        req: &JobRequest,
        who: Option<&StaffRef>,
        stage: &str,
        index: u32,
        total: u32,
        state: crate::ProgressState,
        detail: Value,
    ) {
        if let Some(p) = self.progress.as_ref() {
            p.report(&crate::ProgressEvent {
                job_id: req.job_id,
                kind: req.kind,
                revision: req.revision,
                work_item: req.work_item.clone(),
                staff: who.map(|s| s.id.clone()),
                persona: who.map(|s| s.persona.clone()),
                role: who.map(|s| s.role.clone()),
                stage: stage.to_string(),
                index,
                total,
                state,
                detail,
            });
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

    // ------------------------------------------------------------ lookups

    pub(crate) fn find<'a>(&self, req: &'a JobRequest, role: &str) -> Option<&'a StaffRef> {
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
        let mut rec: BriefRecord = serde_json::from_value(v).map_err(corrupt)?;
        if rec.writer.is_empty() {
            self.board_writer(req, &mut rec, brief_ref).await?;
        }
        Ok(rec)
    }

    /// A board brief has no writer (ADR-0069): the sim staffs its first
    /// draft, whose writer is kept in the item's artifact record for the
    /// review and the publish attribution.
    async fn board_writer(
        &self,
        req: &JobRequest,
        rec: &mut BriefRecord,
        brief_ref: u64,
    ) -> Result<()> {
        let Some(item) = req.work_item.as_deref() else {
            return Ok(());
        };
        let mut art = self.load_artifact(req, item).await?.unwrap_or_default();
        let writer = match art.writer.clone() {
            Some(w) => w,
            None if req.kind == JobKind::Draft => {
                let Some(w) = req.staff.first().cloned() else {
                    return Ok(());
                };
                if art.brief_ref == 0 {
                    art.brief_ref = brief_ref;
                }
                art.writer = Some(w.clone());
                self.save_artifact(req, item, &art).await?;
                w
            }
            None => return Ok(()),
        };
        rec.writer = writer.id.clone();
        if !rec.staff.iter().any(|s| s.id == writer.id) {
            rec.staff.push(writer);
        }
        Ok(())
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
    // (the standup is the pitch round of `crate::standup`; the Draft and
    // Review jobs are staged, `crate::staged`)

    /// The squash commit's provenance: the article's writer as author (the
    /// `Co-authored-by`), the publish job, the model that wrote the text, the
    /// editor as `Reviewed-by` and the CEO who approved it as `Approved-by`
    /// (the job request's `approved_by`, filled in by the host).
    async fn publish_attribution(
        &self,
        req: &JobRequest,
        art: &ArtifactRecord,
    ) -> Result<Attribution> {
        let rec = self.load_brief(req).await?;
        let writer = self.staff_by_id(req, &rec, &rec.writer, "writer")?;
        let editor = self.staff_by_id(req, &rec, &rec.editor, "editor")?;
        let mut who = self.attribution(req, &writer, "publish");
        who.revision = Some(art.revision);
        who.model = art.model.clone().or(who.model);
        who.reviewed_by = Some(display_name(&editor.persona));
        who.approved_by = req.approved_by.clone().filter(|a| !a.trim().is_empty());
        Ok(who)
    }

    /// A publish job for an item already merged: when the gateway reports
    /// that the merge's deployment failed, ask it to deploy again
    /// ([`Gateway::redeploy`]); the job then completes and the sim waits for
    /// `DeployLanded` (or a new `DeployFailed`) as after a merge. The signal
    /// is the server's deploy state, not anything in the sim: a run again
    /// after a reload finds the merge `pending` (or `landed`) and calls
    /// nothing. A refused redeploy is an error (the host retries, then
    /// reports `JobFailed{Infrastructure}`: the item stays blocked with a
    /// ticket) and is posted to the item's thread with the server's reason.
    /// `Some` is the job's outcome when it was cancelled before the call.
    async fn redeploy_if_failed(
        &self,
        req: &JobRequest,
        item: &str,
        art: &ArtifactRecord,
    ) -> Result<Option<Outcome>> {
        let Some(pr) = art.pr_number else {
            return Ok(None);
        };
        if self.gateway.deploy_state(pr).await? != Some(DeployState::Failed) {
            return Ok(None);
        }
        if let Some(reason) = self.cancelled(req) {
            return Ok(Some(Outcome::JobFailed {
                job_id: req.job_id,
                reason,
            }));
        }
        match self.gateway.redeploy(pr).await {
            Ok(r) => {
                let text = if r.requested {
                    format!("PR #{pr}: its deploy failed; deploying it again.")
                } else {
                    format!("PR #{pr}: its deploy is already running again.")
                };
                self.system_post(
                    req,
                    item,
                    "status",
                    1,
                    &text,
                    json!({"pr": pr, "redeploy": r}),
                )
                .await?;
                Ok(None)
            }
            Err(e) => {
                self.system_post(
                    req,
                    item,
                    "status",
                    2,
                    &format!("PR #{pr}: the deploy could not be run again: {}", e.0),
                    json!({"pr": pr, "error": e.0}),
                )
                .await?;
                Err(e.into())
            }
        }
    }

    async fn publish(&self, req: &JobRequest) -> Result<Vec<Outcome>> {
        let item = self.work_item(req)?.to_string();
        let mut art = self
            .load_artifact(req, &item)
            .await?
            .ok_or_else(|| invalid(format!("publish of {item} without a PR")))?;
        let (merged_sha, fresh) = match art.merged_sha.clone() {
            // Merged already: no second merge, no second post. This is a run
            // again after a reload, or the CEO's Retry on a `DeployFailed`
            // ticket: then the deploy is run again (FEAT-085).
            Some(sha) => {
                if let Some(failed) = self.redeploy_if_failed(req, &item, &art).await? {
                    return Ok(vec![failed]);
                }
                (sha, false)
            }
            None => {
                if let Some(reason) = self.cancelled(req) {
                    return Ok(vec![Outcome::JobFailed {
                        job_id: req.job_id,
                        reason,
                    }]);
                }
                let pr = art
                    .pr_number
                    .ok_or_else(|| invalid(format!("publish of {item} without a PR")))?;
                let head = art
                    .head_sha
                    .clone()
                    .ok_or_else(|| invalid(format!("publish of {item} without a head sha")))?;
                let who = self.publish_attribution(req, &art).await?;
                let sha = self.gateway.merge_as(pr, &head, Some(&who)).await?;
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
