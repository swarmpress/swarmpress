//! The staged Draft and Review jobs (ADR-0058; `docs/design/mvp-pipeline.md`
//! §1, increments P2, P3 and P5).
//!
//! One bounded local model cannot write or read a whole article in one call.
//! Inside the sim's Draft and Review jobs (no new job kinds, no golden change)
//! the work runs in stages, each one model call that fits the context
//! ([`LlmProfile`]):
//!
//! ```text
//! Draft, revision 0:  context#0 (no model) → outline#0 → section#0 (intro) → section#1…N
//!                     → closing#0 → assemble → validate → fix#i (the failing part only) → commit
//! Draft, revision n:  retitle#0 (title named) and revise#i (only the parts the review
//!                     and the CEO's send-back note name) → assemble → validate → fix#i → commit
//! Review:             review#0 (one call when it fits REVIEW_SINGLE_TOKENS), else
//!                     review_section#0…N+1 → review_summary#0
//! ```
//!
//! - **Stage store.** Every stage result is stored by `(company, job, stage,
//!   index)` with the hash of its input ([`stage_hash`]); first write wins. A
//!   re-run job reuses what is stored and calls the model only for what is
//!   missing; a retried phase (a new job id) adopts the rows of its
//!   predecessor (`ArtifactRecord.last_job`) whose input hash matches.
//! - **Repairs.** Each call goes through `agents::structured_with_repair`
//!   with the part's own checks: at most [`SECTION_REPAIRS`] per part and
//!   [`JOB_REPAIRS`] per job (a page-level fix counts too). A section cut off
//!   at its token limit is written again in two halves.
//! - **Posts** carry a dedupe key, so a re-run posts nothing twice.
//! - **Progress.** Every stage is reported as counts ([`ProgressEvent`]).

use std::collections::BTreeSet;

use agents::article::{
    assemble_page, check_closing, check_outline, check_section, closing_schema, closing_words,
    intro_words, normalize_outline_words, outline_schema, reading_text, resolve_aliases,
    review_schema, section_ids, section_schema, ArticleInput, ArticleParts, Closing, Outline,
    ReviewIssue, SectionBudget, SectionDraft, SectionId, SectionedReview, THEME_LANGUAGES,
};
use agents::article_prompts::{
    closing_prompt, digest_of, fix_prompt, last_paragraph, outline_prompt, retitle_prompt,
    retitle_schema, review_prompt, review_section_prompt, review_summary_prompt, revise_prompt,
    section_prompt, section_review_schema, section_text, OutlineContext, Retitle, ReviewFrame,
    RevisionNote, SectionNeighbours, SectionReview, SectionSpec, StagePrompt,
};
use agents::llm::{structured_with_repair, RepairFailed, SemanticCheck};
use agents::pipeline::{Brief, ReviewDecision};
use agents::prompts::{templates, Vars};
use agents::{CallProfile, LlmError, Role};
use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::{json, Value};

use crate::article::{article_context, ArticleContext};
use crate::gateway::Gateway;
use crate::run::{corrupt, invalid, persona, Orchestrator, OrchestratorError, Result};
use crate::store::{ArtifactRecord, StageRow, Store, StoredParts};
use crate::{
    Digest, JobFailure, JobKind, JobRequest, Outcome, ProgressState, SiteBinding, StaffRef,
};

/// Repair turns one part may use.
pub const SECTION_REPAIRS: u32 = 2;
/// Repair turns (and page-level fixes) one job may use.
pub const JOB_REPAIRS: u32 = 4;
/// Times a stage's model call is made again after it ran past its wall-clock
/// limit (`LlmError::Timeout` from the browser bridge, P6); after that the job
/// fails with `JobFailed{Timeout}` and keeps the stages it completed.
pub const STAGE_TIMEOUT_RETRIES: u32 = 1;
/// A review whose reading text and checks are estimated at no more than this
/// many tokens is one call (the binding's `review_single_tokens`).
pub const REVIEW_SINGLE_TOKENS: u32 = 3000;

/// The input hash of a stage: xxh3 over its parts, hex.
pub fn stage_hash(parts: &[&str]) -> String {
    let mut buf = Vec::new();
    for p in parts {
        buf.extend_from_slice(p.as_bytes());
        buf.push(0);
    }
    format!("{:016x}", xxhash_rust::xxh3::xxh3_64(&buf))
}

/// Why a staged job stops short of its outcome.
#[derive(Debug)]
pub(crate) enum Halt {
    /// A model call failed (refusal, backend, truncation that could not be
    /// split).
    Llm(LlmError),
    /// A part (or the page) is still invalid after the repairs allowed.
    Invalid { stage: String, errors: Vec<String> },
    /// The closed world has no image for the brief (rule 5).
    NeedsMedia,
    /// A stage's model call ran past its limit again after its retry
    /// ([`STAGE_TIMEOUT_RETRIES`]).
    Timeout(String),
    /// The host cancelled the job ([`crate::CancelToken`]).
    Cancelled(JobFailure),
    /// The model is gone: not a job failure, the run errs and is repeated.
    Unavailable(String),
}

type Step<T> = std::result::Result<T, Halt>;

/// What a failed call reports in its progress event.
#[inline(never)]
fn failure_detail(f: &RepairFailed) -> Value {
    json!({"error": f.error.to_string(), "calls": f.calls, "no_progress": f.no_progress})
}

impl Halt {
    /// A short label for the job's failed event.
    fn label(&self) -> &'static str {
        match self {
            Halt::Llm(_) => "model",
            Halt::Invalid { .. } => "invalid-output",
            Halt::NeedsMedia => "needs-media",
            Halt::Timeout(_) => "timeout",
            Halt::Cancelled(JobFailure::Timeout) => "timeout",
            Halt::Cancelled(_) => "cancelled",
            Halt::Unavailable(_) => "unavailable",
        }
    }
}

/// The failure of a cancelled call, before it was made.
fn cancelled_call() -> RepairFailed {
    RepairFailed {
        error: LlmError::Timeout("the job was cancelled".into()),
        calls: 0,
        repairs: 0,
        no_progress: false,
    }
}

/// One job's frame: who works, under which system prompt, and whose stages
/// a retried phase may adopt.
pub(crate) struct Cx<'a> {
    req: &'a JobRequest,
    item: &'a str,
    worker: StaffRef,
    predecessor: Option<u64>,
    system: String,
    call: CallProfile,
}

/// A stage key and its input hash.
struct Key {
    stage: &'static str,
    index: u32,
    total: u32,
    hash: String,
}

impl Key {
    #[inline(never)]
    fn new(stage: &'static str, index: u32, total: u32, input: &[&str]) -> Self {
        let index_text = index.to_string();
        let mut parts = vec![stage, index_text.as_str()];
        parts.extend_from_slice(input);
        Self {
            stage,
            index,
            total,
            hash: stage_hash(&parts),
        }
    }

    #[inline(never)]
    fn of(
        stage: &'static str,
        index: u32,
        total: u32,
        prompt: &StagePrompt,
        schema: &Value,
    ) -> Self {
        let schema_text = schema.to_string();
        let budget = format!("{}+{}", prompt.max_tokens, prompt.reasoning_tokens);
        Self::new(stage, index, total, &[&prompt.user, &schema_text, &budget])
    }
}

/// Position of a part in stage indexes: intro 0, `sN` N, closing N+1.
fn part_index(id: SectionId, sections: usize) -> u32 {
    match id {
        SectionId::Intro | SectionId::Title | SectionId::Whole => 0,
        SectionId::Section(n) => u32::from(n),
        SectionId::Closing => u32::try_from(sections + 1).unwrap_or(u32::MAX),
    }
}

fn errors_of(errs: Vec<agents::article::SectionError>) -> std::result::Result<(), Vec<String>> {
    if errs.is_empty() {
        Ok(())
    } else {
        Err(errs.iter().map(ToString::to_string).collect())
    }
}

fn parse<T: DeserializeOwned>(v: &Value) -> std::result::Result<T, Vec<String>> {
    serde_json::from_value(v.clone()).map_err(|e| vec![e.to_string()])
}

/// The issues a CEO's send-back note stands for (`apps/game/src/ui`,
/// `payload.ui_type: 'send-back-note'`). A line that starts with a part's
/// tag (`s2:`, `[s2]`, `intro:`, `title:`, `closing:`) is about that part;
/// everything else is one `whole` issue.
pub fn send_back_issues(note: &str) -> Vec<ReviewIssue> {
    let mut tagged = Vec::new();
    let mut rest = Vec::new();
    for line in note.lines().map(str::trim).filter(|l| !l.is_empty()) {
        let (tag, text) = if let Some(inner) = line.strip_prefix('[') {
            match inner.split_once(']') {
                Some((t, r)) => (Some(t.trim()), r.trim_start_matches(':').trim()),
                None => (None, line),
            }
        } else {
            match line.split_once(':') {
                Some((t, r)) if !t.contains(' ') => (Some(t.trim()), r.trim()),
                _ => (None, line),
            }
        };
        match tag.and_then(|t| t.parse::<SectionId>().ok()) {
            Some(section) if !text.is_empty() => tagged.push(ReviewIssue {
                section,
                problem: format!("The CEO sent it back: {text}"),
                fix: text.to_string(),
            }),
            _ => rest.push(line.to_string()),
        }
    }
    if !rest.is_empty() {
        let text = rest.join(" ");
        tagged.push(ReviewIssue {
            section: SectionId::Whole,
            problem: format!("The CEO sent it back: {text}"),
            fix: text,
        });
    }
    tagged
}

/// The measured checks the editor reads beside the text and the CEO sees
/// beside the review: counted, never an opinion.
pub fn measured_checks(
    site: &SiteBinding,
    brief: &Brief,
    page: &Value,
    parts: Option<&ArticleParts>,
) -> Vec<String> {
    let words = parts.map_or_else(|| crate::article::word_count(page), ArticleParts::words);
    let target = brief.target_words.max(1);
    let mut out = vec![format!(
        "Words: {words} of {} target ({}%)",
        brief.target_words,
        u64::from(words) * 100 / u64::from(target)
    )];
    if let Some(p) = parts {
        out.push(format!(
            "Parts: intro, {} sections, closing note",
            p.sections.len()
        ));
    }
    match site.validator_v2.as_ref() {
        Some(v) => {
            let issues = v.check(page);
            if issues.is_empty() {
                out.push(
                    "Site checks (schema, article profile, house style, links, media): no problems"
                        .into(),
                );
            } else {
                out.push(format!("Site checks: {} problems", issues.len()));
                out.extend(issues.iter().take(5).map(|i| format!("  {i}")));
            }
        }
        None => {
            let hits = site.context.style_guide.banned_phrase_errors(page);
            out.push(format!("Banned phrases: {}", hits.len()));
        }
    }
    let links = page["body"]
        .as_array()
        .and_then(|b| b.last())
        .and_then(|b| b["actions"].as_array())
        .map_or(0, Vec::len);
    out.push(format!("Links at the end: {links}"));
    out
}

impl<S: Store, G: Gateway> Orchestrator<S, G> {
    // ------------------------------------------------------------ progress

    #[inline(never)]
    fn emit(
        &self,
        cx: &Cx<'_>,
        stage: &str,
        index: u32,
        total: u32,
        state: ProgressState,
        detail: Value,
    ) {
        self.report(cx.req, Some(&cx.worker), stage, index, total, state, detail);
    }

    #[inline(never)]
    fn emit_job(&self, cx: &Cx<'_>, state: ProgressState, detail: Value) {
        self.emit(cx, "job", 0, 1, state, detail);
    }

    // ------------------------------------------------------------ stage store

    /// The stored result of a stage, from this job or adopted from its
    /// predecessor; `None` when it must run.
    async fn reuse<T: DeserializeOwned>(&self, cx: &Cx<'_>, key: &Key) -> Result<Option<T>> {
        self.reuse_value(cx, key)
            .await?
            .map(|v| serde_json::from_value(v).map_err(corrupt))
            .transpose()
    }

    /// [`Self::reuse`] without the type (one copy of the store logic in the
    /// wasm module, not one per stage type).
    async fn reuse_value(&self, cx: &Cx<'_>, key: &Key) -> Result<Option<Value>> {
        let company = &cx.req.company_id;
        let mut found = None;
        if let Some(row) = self
            .store
            .get_stage(company, cx.req.job_id, key.stage, key.index)
            .await?
        {
            if row.input_hash == key.hash {
                found = Some((row, None));
            }
        }
        if found.is_none() {
            if let Some(pred) = cx.predecessor {
                if let Some(row) = self
                    .store
                    .get_stage(company, pred, key.stage, key.index)
                    .await?
                {
                    if row.input_hash == key.hash {
                        let row = self
                            .store
                            .put_stage(company, cx.req.job_id, key.stage, key.index, row)
                            .await?;
                        found = Some((row, Some(pred)));
                    }
                }
            }
        }
        let Some((row, adopted)) = found else {
            return Ok(None);
        };
        self.emit(
            cx,
            key.stage,
            key.index,
            key.total,
            ProgressState::Reused,
            json!({"adopted_from": adopted}),
        );
        Ok(Some(row.value))
    }

    /// Stores a stage result (first write wins) and reports it done.
    async fn keep<T: Serialize>(
        &self,
        cx: &Cx<'_>,
        key: &Key,
        value: &T,
        detail: Value,
    ) -> Result<()> {
        let value = serde_json::to_value(value).map_err(corrupt)?;
        self.keep_value(cx, key, value, detail).await
    }

    async fn keep_value(&self, cx: &Cx<'_>, key: &Key, value: Value, detail: Value) -> Result<()> {
        let row = StageRow {
            input_hash: key.hash.clone(),
            value,
        };
        self.store
            .put_stage(&cx.req.company_id, cx.req.job_id, key.stage, key.index, row)
            .await?;
        self.emit(
            cx,
            key.stage,
            key.index,
            key.total,
            ProgressState::Done,
            detail,
        );
        Ok(())
    }

    /// Why a call failed, as the job sees it: a cancelled job is cancelled
    /// whatever the aborted call said.
    fn halt_of(&self, cx: &Cx<'_>, f: RepairFailed, stage: &str) -> Halt {
        if let Some(reason) = self.cancelled(cx.req) {
            return Halt::Cancelled(reason);
        }
        match f.error {
            LlmError::InvalidOutput { errors, .. } => Halt::Invalid {
                stage: stage.to_string(),
                errors,
            },
            LlmError::Timeout(msg) => Halt::Timeout(msg),
            LlmError::Unavailable(msg) => Halt::Unavailable(msg),
            other => Halt::Llm(other),
        }
    }

    /// One structured call with repairs, within the job's repair budget.
    ///
    /// The cancel flag is checked first (between stages, P6). A call that ran
    /// past its wall-clock limit (`LlmError::Timeout`) is made once more
    /// ([`STAGE_TIMEOUT_RETRIES`]) unless the job was cancelled meanwhile.
    async fn call(
        &self,
        cx: &Cx<'_>,
        prompt: &StagePrompt,
        schema: &Value,
        check: &SemanticCheck<'_>,
        budget: &mut u32,
    ) -> std::result::Result<agents::llm::Repaired, RepairFailed> {
        let req = prompt.request(cx.call.clone(), &cx.system);
        let mut timeouts = 0;
        loop {
            if self.cancelled(cx.req).is_some() {
                return Err(cancelled_call());
            }
            let max = SECTION_REPAIRS.min(*budget);
            let r = structured_with_repair(self.llm.as_ref(), &req, schema, check, max).await;
            let used = match &r {
                Ok(x) => x.repairs,
                Err(e) => e.repairs,
            };
            *budget = budget.saturating_sub(used);
            match r {
                Err(f)
                    if matches!(f.error, LlmError::Timeout(_))
                        && timeouts < STAGE_TIMEOUT_RETRIES
                        && self.cancelled(cx.req).is_none() =>
                {
                    timeouts += 1;
                }
                r => return r,
            }
        }
    }

    /// A structured stage: reused when stored, else one call (with repairs),
    /// then stored.
    #[allow(clippy::too_many_arguments)]
    async fn structured_stage<T: DeserializeOwned>(
        &self,
        cx: &Cx<'_>,
        stage: &'static str,
        index: u32,
        total: u32,
        prompt: &StagePrompt,
        schema: &Value,
        check: &SemanticCheck<'_>,
        budget: &mut u32,
    ) -> Result<Step<T>> {
        Ok(
            match self
                .structured_value(cx, stage, index, total, prompt, schema, check, budget)
                .await?
            {
                Ok(v) => Ok(serde_json::from_value(v).map_err(corrupt)?),
                Err(h) => Err(h),
            },
        )
    }

    /// [`Self::structured_stage`] without the type: the answer as it passed
    /// its schema and checks.
    #[allow(clippy::too_many_arguments)]
    async fn structured_value(
        &self,
        cx: &Cx<'_>,
        stage: &'static str,
        index: u32,
        total: u32,
        prompt: &StagePrompt,
        schema: &Value,
        check: &SemanticCheck<'_>,
        budget: &mut u32,
    ) -> Result<Step<Value>> {
        let key = Key::of(stage, index, total, prompt, schema);
        if let Some(v) = self.reuse_value(cx, &key).await? {
            return Ok(Ok(v));
        }
        self.emit(cx, stage, index, total, ProgressState::Started, json!({}));
        match self.call(cx, prompt, schema, check, budget).await {
            Ok(r) => {
                self.keep_value(
                    cx,
                    &key,
                    r.value.clone(),
                    json!({"calls": r.calls, "repairs": r.repairs, "dropped": prompt.dropped}),
                )
                .await?;
                Ok(Ok(r.value))
            }
            Err(f) => {
                self.emit(
                    cx,
                    stage,
                    index,
                    total,
                    ProgressState::Failed,
                    failure_detail(&f),
                );
                Ok(Err(self.halt_of(cx, f, stage)))
            }
        }
    }

    /// A body section or the intro (`section#i`): checked before the next
    /// one starts; cut off at its token limit, it is written in two halves.
    #[allow(clippy::too_many_arguments)]
    async fn section_stage(
        &self,
        cx: &Cx<'_>,
        index: u32,
        total: u32,
        spec: &SectionSpec,
        earlier: &[String],
        budget: &mut u32,
        make: &(dyn Fn(&SectionSpec, Option<&str>) -> StagePrompt + Sync),
    ) -> Result<Step<SectionDraft>> {
        let style = &self.site.context.style_guide;
        let schema = section_schema();
        let prompt = make(spec, None);
        let key = Key::of("section", index, total, &prompt, &schema);
        if let Some(v) = self.reuse(cx, &key).await? {
            return Ok(Ok(v));
        }
        self.emit(
            cx,
            "section",
            index,
            total,
            ProgressState::Started,
            json!({}),
        );
        let check_for = |s: &SectionSpec, extra: Vec<String>| {
            let section = s.id;
            let words = s.words;
            let mut seen = earlier.to_vec();
            seen.extend(extra);
            move |v: &Value| -> std::result::Result<(), Vec<String>> {
                let draft: SectionDraft = parse(v)?;
                let budget = SectionBudget {
                    section,
                    words,
                    earlier: &seen,
                };
                errors_of(check_section(&draft, &budget, style))
            }
        };
        let fail = |f: RepairFailed| {
            self.emit(
                cx,
                "section",
                index,
                total,
                ProgressState::Failed,
                failure_detail(&f),
            );
            self.halt_of(cx, f, "section")
        };
        let whole = check_for(spec, Vec::new());
        let draft = match self.call(cx, &prompt, &schema, &whole, budget).await {
            Ok(r) => serde_json::from_value::<SectionDraft>(r.value).map_err(corrupt)?,
            Err(f) if matches!(f.error, LlmError::Truncated { .. }) && spec.part.is_none() => {
                // Cut off: the same part in two halves (concept document §18).
                let half = |i: u8, points: Vec<String>, words: u32| SectionSpec {
                    points,
                    words,
                    part: Some((i, 2)),
                    ..spec.clone()
                };
                let mid = spec.points.len().div_ceil(2);
                let first_points = spec.points[..mid].to_vec();
                let second_points = if spec.points.len() > 1 {
                    spec.points[mid..].to_vec()
                } else {
                    spec.points.clone()
                };
                let first_spec = half(1, first_points, spec.words / 2);
                let second_spec = half(2, second_points, spec.words - spec.words / 2);
                let first_check = check_for(&first_spec, Vec::new());
                let first = match self
                    .call(cx, &make(&first_spec, None), &schema, &first_check, budget)
                    .await
                {
                    Ok(r) => serde_json::from_value::<SectionDraft>(r.value).map_err(corrupt)?,
                    Err(f) => return Ok(Err(fail(f))),
                };
                let end = last_paragraph(&first);
                let second_check = check_for(&second_spec, first.paragraphs());
                let second = match self
                    .call(
                        cx,
                        &make(&second_spec, Some(&end)),
                        &schema,
                        &second_check,
                        budget,
                    )
                    .await
                {
                    Ok(r) => serde_json::from_value::<SectionDraft>(r.value).map_err(corrupt)?,
                    Err(f) => return Ok(Err(fail(f))),
                };
                let mut blocks = first.blocks;
                blocks.extend(second.blocks);
                let joined = SectionDraft { blocks };
                if let Err(errors) = whole(&serde_json::to_value(&joined).map_err(corrupt)?) {
                    self.emit(
                        cx,
                        "section",
                        index,
                        total,
                        ProgressState::Failed,
                        json!({"errors": errors}),
                    );
                    return Ok(Err(Halt::Invalid {
                        stage: "section".into(),
                        errors,
                    }));
                }
                joined
            }
            Err(f) => return Ok(Err(fail(f))),
        };
        self.keep(
            cx,
            &key,
            &draft,
            json!({"words": draft.words(), "dropped": prompt.dropped}),
        )
        .await?;
        Ok(Ok(draft))
    }

    // ------------------------------------------------------------ job frame

    /// Records this job as the latest of its kind on the item and returns the
    /// artifact record and the predecessor whose stages may be adopted.
    async fn begin(
        &self,
        req: &JobRequest,
        item: &str,
        kind: &str,
        brief_ref: u64,
    ) -> Result<(ArtifactRecord, Option<u64>)> {
        let mut art = self.load_artifact(req, item).await?.unwrap_or_default();
        let predecessor = art.last_job.get(kind).copied().filter(|j| *j != req.job_id);
        if art.last_job.get(kind) != Some(&req.job_id) {
            if art.brief_ref == 0 {
                art.brief_ref = brief_ref;
            }
            art.last_job.insert(kind.to_string(), req.job_id);
            self.save_artifact(req, item, &art).await?;
        }
        Ok((art, predecessor))
    }

    /// The heroes (media ids and URLs) of the company's other articles that
    /// are drafted and not merged yet: `article_context`'s `heroes_in_flight`.
    /// Merged articles are in the site's own indexes already.
    async fn heroes_in_flight(&self, req: &JobRequest, item: &str) -> Result<BTreeSet<String>> {
        let mut out = BTreeSet::new();
        for (other, record) in self.store.artifacts(&req.company_id).await? {
            if other == item {
                continue;
            }
            let art: ArtifactRecord = serde_json::from_value(record).map_err(corrupt)?;
            out.extend(art.hero_in_flight().into_iter().flatten());
        }
        Ok(out)
    }

    /// The first draft attaches the brief to its item: title, angle and the
    /// standup minutes (posted once per brief).
    async fn attach_brief(
        &self,
        req: &JobRequest,
        item: &str,
        rec: &crate::store::BriefRecord,
        brief_ref: u64,
    ) -> Result<()> {
        let claimed = self
            .store
            .claim_brief(&req.company_id, brief_ref, item)
            .await?;
        if !claimed && req.revision > 0 {
            return Ok(());
        }
        let brief = &rec.brief;
        self.store
            .set_item_text(
                &req.company_id,
                item,
                Some(&brief.title),
                Some(&brief.angle),
            )
            .await?;
        let excerpt: Vec<String> = rec
            .minutes
            .iter()
            .filter_map(|u| {
                Some(format!(
                    "{}: {}",
                    u.get("speaker")?.as_str()?,
                    u.get("text")?.as_str()?
                ))
            })
            .take(12)
            .collect();
        let key = format!("brief-{brief_ref}:minutes:0");
        self.post(
            req,
            item,
            "minutes",
            "system",
            None,
            &excerpt.join("\n"),
            json!({"job": rec.job_id, "brief": brief}),
            Some(&key),
        )
        .await?;
        Ok(())
    }

    /// A job that stopped short: a status post, then `JobFailed` with the
    /// reason (the sim blocks the item with the ticket the reason calls for:
    /// `NeedsMedia`, else an escalation). Stages it completed stay stored. A
    /// lost model is not a failure: the run errs, and the host runs the job
    /// again once the model is back.
    async fn halted(&self, cx: &Cx<'_>, halt: Halt) -> Result<Vec<Outcome>> {
        let (req, item) = (cx.req, cx.item);
        let failed = |reason| Outcome::JobFailed {
            job_id: req.job_id,
            reason,
        };
        let outcome = match &halt {
            Halt::Unavailable(msg) => {
                self.emit_job(cx, ProgressState::Failed, json!({"halt": halt.label()}));
                return Err(OrchestratorError::Unavailable(msg.clone()));
            }
            Halt::Llm(error) => {
                self.report_llm_failure(req, item, error).await?;
                failed(JobFailure::Model)
            }
            Halt::Timeout(msg) => {
                self.system_post(
                    req,
                    item,
                    "status",
                    0,
                    "A model call ran past its time limit twice; the item is blocked until the CEO decides. The finished stages are kept.",
                    json!({"failure": "timeout", "error": msg}),
                )
                .await?;
                failed(JobFailure::Timeout)
            }
            Halt::Cancelled(reason) => {
                let text = if *reason == JobFailure::Timeout {
                    "The job ran past its time limit and was stopped; the item is blocked until the CEO decides. The finished stages are kept."
                } else {
                    "The job was cancelled; the finished stages are kept."
                };
                let slug = if *reason == JobFailure::Timeout {
                    "timeout"
                } else {
                    "cancelled"
                };
                self.system_post(req, item, "status", 0, text, json!({"failure": slug}))
                    .await?;
                failed(*reason)
            }
            Halt::Invalid { stage, errors } => {
                let what = if req.kind == JobKind::Review {
                    "The review could not be made valid; escalating."
                } else {
                    "The draft could not be made valid; escalating."
                };
                self.system_post(
                    req,
                    item,
                    "status",
                    0,
                    what,
                    json!({"stage": stage, "errors": errors}),
                )
                .await?;
                failed(JobFailure::InvalidOutput)
            }
            Halt::NeedsMedia => {
                self.system_post(
                    req,
                    item,
                    "status",
                    0,
                    "No image in the site's media index fits this brief (NEEDS_MEDIA); the item waits for the CEO.",
                    json!({"failure": "needs-media"}),
                )
                .await?;
                failed(JobFailure::NeedsMedia)
            }
        };
        self.emit_job(cx, ProgressState::Failed, json!({"halt": halt.label()}));
        Ok(vec![outcome])
    }

    fn writer_cx<'a>(
        &self,
        req: &'a JobRequest,
        item: &'a str,
        writer: StaffRef,
        predecessor: Option<u64>,
    ) -> Result<Cx<'a>> {
        let p = persona(&writer.persona)?;
        let system = self.system_prompt(&templates::writer(), &p, Vars::new())?;
        let call = CallProfile {
            job: if req.revision == 0 {
                agents::JobKind::Draft
            } else {
                agents::JobKind::Revise
            },
            role: Role::Writer,
            seniority: Some(p.seniority),
            staff_id: Some(writer.id.clone()),
        };
        Ok(Cx {
            req,
            item,
            worker: writer,
            predecessor,
            system,
            call,
        })
    }

    // ------------------------------------------------------------ Draft

    pub(crate) async fn staged_draft(&self, req: &JobRequest) -> Result<Vec<Outcome>> {
        let item = self.work_item(req)?;
        let rec = self.load_brief(req).await?;
        let brief = rec.brief.clone();
        let writer = self.staff_by_id(req, &rec, &rec.writer, "writer")?;
        let editor = self.staff_by_id(req, &rec, &rec.editor, "editor")?;
        let brief_ref = req.brief_ref.unwrap_or_default();
        if req.revision == 0 && self.site.knowledge.is_none() {
            return Err(invalid(format!(
                "job {}: the staged draft needs the site's knowledge pack",
                req.job_id
            )));
        }
        self.attach_brief(req, item, &rec, brief_ref).await?;
        let (mut art, predecessor) = self.begin(req, item, "draft", brief_ref).await?;
        let cx = self.writer_cx(req, item, writer.clone(), predecessor)?;
        self.emit_job(
            &cx,
            ProgressState::Started,
            json!({"predecessor": predecessor}),
        );

        let written = if req.revision == 0 {
            self.write_fresh(&cx, &brief, brief_ref).await?
        } else {
            self.write_revision(&cx, &brief, &art).await?
        };
        let (parts, page) = match written {
            Ok(x) => x,
            Err(halt) => return self.halted(&cx, halt).await,
        };
        // The last stage boundary before the repo write.
        if let Some(reason) = self.cancelled(req) {
            return self.halted(&cx, Halt::Cancelled(reason)).await;
        }

        self.emit(&cx, "commit", 0, 1, ProgressState::Started, json!({}));
        let path = brief.page_path();
        let message = if req.revision == 0 {
            format!("Draft: {}", brief.title)
        } else {
            format!("Revision {}: {}", req.revision, brief.title)
        };
        // The writer's persona is the commit's author (ADR-0058 decision 10).
        let who = self.attribution(req, &writer, "draft");
        let pr = self
            .gateway
            .open_draft_as(&brief.content_id, &path, &page, &message, Some(&who))
            .await?;
        art.model = who.model.clone();
        let words = parts.to_parts().words();
        art.brief_ref = brief_ref;
        art.page = Some(page.clone());
        art.parts = Some(parts);
        art.revision = req.revision;
        art.path = Some(path.clone());
        art.branch = Some(pr.branch.clone());
        art.pr_number = Some(pr.number);
        art.head_sha = Some(pr.head_sha.clone());
        self.save_artifact(req, item, &art).await?;
        let detail = json!({"pr": pr.number, "branch": pr.branch, "sha": pr.head_sha, "path": path, "words": words});
        self.emit(&cx, "commit", 0, 1, ProgressState::Done, detail.clone());

        self.system_post(
            req,
            item,
            "artifact",
            0,
            &format!("PR #{} on {} ({} words)", pr.number, pr.branch, words),
            json!({"pr": pr.number, "branch": pr.branch, "path": path, "sha": pr.head_sha, "revision": req.revision}),
        )
        .await?;
        let handoff = if req.revision == 0 {
            format!(
                "First draft of \"{}\" is in PR #{} for review.",
                brief.title, pr.number
            )
        } else {
            format!(
                "Revision {} addresses the review; PR #{} updated.",
                req.revision, pr.number
            )
        };
        let key = format!("{}:handoff:0", req.job_id);
        self.post(
            req,
            item,
            "handoff",
            &writer.id,
            Some(&editor.id),
            &handoff,
            json!({}),
            Some(&key),
        )
        .await?;
        self.emit_job(&cx, ProgressState::Done, detail);
        Ok(vec![Outcome::JobCompleted {
            job_id: req.job_id,
            digest: Digest {
                ok: true,
                score: 0,
                words,
                qa_defects: 0,
                artifact_sha: Some(pr.head_sha),
            },
        }])
    }

    /// Revision 0: context, outline, intro, sections, closing, then the page.
    async fn write_fresh(
        &self,
        cx: &Cx<'_>,
        brief: &Brief,
        brief_ref: u64,
    ) -> Result<Step<(StoredParts, Value)>> {
        let knowledge = self
            .site
            .knowledge
            .as_ref()
            .ok_or_else(|| invalid("the staged draft needs the site's knowledge pack"))?;
        let profile = &self.site.llm;
        let style = &self.site.context.style_guide;
        let brief_text = serde_json::to_string(brief).map_err(corrupt)?;

        // context#0: no model.
        let key = Key::new("context", 0, 1, &[&brief_text]);
        let ctx: ArticleContext = match self.reuse(cx, &key).await? {
            Some(c) => c,
            None => {
                self.emit(cx, "context", 0, 1, ProgressState::Started, json!({}));
                // Two open articles never share a hero: the other drafts' heroes are left out.
                let in_flight = self.heroes_in_flight(cx.req, cx.item).await?;
                let c = article_context(
                    &knowledge.kb,
                    brief,
                    knowledge.blog_index.as_ref(),
                    &in_flight,
                );
                if c.heroes.is_empty() {
                    self.emit(
                        cx,
                        "context",
                        0,
                        1,
                        ProgressState::Failed,
                        json!({"error": "no hero image"}),
                    );
                    return Ok(Err(Halt::NeedsMedia));
                }
                let detail = json!({"heroes": c.heroes.len(), "links": c.links.len(), "facts": c.facts.len()});
                self.keep(cx, &key, &c, detail).await?;
                c
            }
        };

        let mut budget = JOB_REPAIRS;
        // outline#0
        let prompt = outline_prompt(
            profile,
            &cx.system,
            brief,
            &OutlineContext {
                heroes: &ctx.heroes,
                links: &ctx.links,
                facts: &ctx.facts,
                related: &ctx.related,
                categories: &ctx.categories,
                guidance: self.site.article_guidance.as_deref(),
            },
        );
        let schema = outline_schema(&ctx.hero_aliases(), &ctx.link_aliases(), &ctx.categories);
        let outline_check = |v: &Value| -> std::result::Result<(), Vec<String>> {
            let o: Outline = parse(v)?;
            errors_of(check_outline(&o, style))
        };
        let outline: Outline = match self
            .structured_stage(
                cx,
                "outline",
                0,
                1,
                &prompt,
                &schema,
                &outline_check,
                &mut budget,
            )
            .await?
        {
            Ok(o) => normalize_outline_words(&o, brief.target_words),
            Err(h) => return Ok(Err(h)),
        };

        // section#0 (the intro) and section#1…N
        let n = outline.sections.len();
        let total = u32::try_from(n).unwrap_or(u32::MAX);
        let mut digests: Vec<(SectionId, String)> = Vec::new();
        let mut earlier: Vec<String> = Vec::new();
        let mut previous_end: Option<String> = None;
        let mut drafts: Vec<SectionDraft> = Vec::new();
        let mut intro: Option<SectionDraft> = None;
        for i in 0..=n {
            let spec = if i == 0 {
                SectionSpec {
                    id: SectionId::Intro,
                    total: n,
                    heading: String::new(),
                    points: Vec::new(),
                    words: intro_words(brief.target_words),
                    part: None,
                }
            } else {
                let o = &outline.sections[i - 1];
                SectionSpec {
                    id: SectionId::Section(u8::try_from(i).unwrap_or(u8::MAX)),
                    total: n,
                    heading: o.heading.clone(),
                    points: o.points.clone(),
                    words: o.words,
                    part: None,
                }
            };
            let earlier_digests = digests.clone();
            let end = previous_end.clone();
            let make = |s: &SectionSpec, prev: Option<&str>| {
                section_prompt(
                    profile,
                    &cx.system,
                    brief,
                    &outline,
                    s,
                    &SectionNeighbours {
                        earlier: earlier_digests.clone(),
                        previous_end: prev.map(String::from).or_else(|| end.clone()),
                        facts: &ctx.facts,
                    },
                )
            };
            let index = u32::try_from(i).unwrap_or(u32::MAX);
            let draft = match self
                .section_stage(cx, index, total, &spec, &earlier, &mut budget, &make)
                .await?
            {
                Ok(d) => d,
                Err(h) => return Ok(Err(h)),
            };
            earlier.extend(draft.paragraphs());
            digests.push((spec.id, digest_of(&outline, spec.id, &draft)));
            previous_end = Some(last_paragraph(&draft));
            if i == 0 {
                intro = Some(draft);
            } else {
                drafts.push(draft);
            }
        }

        // closing#0
        let prompt = closing_prompt(
            profile,
            &cx.system,
            brief,
            &outline,
            closing_words(brief.target_words),
            &digests,
        );
        let closing_check = |v: &Value| -> std::result::Result<(), Vec<String>> {
            let c: Closing = parse(v)?;
            errors_of(check_closing(&c, style))
        };
        let closing: Closing = match self
            .structured_stage(
                cx,
                "closing",
                0,
                1,
                &prompt,
                &closing_schema(),
                &closing_check,
                &mut budget,
            )
            .await?
        {
            Ok(c) => c,
            Err(h) => return Ok(Err(h)),
        };

        let parts = ArticleParts {
            outline,
            intro: intro.unwrap_or(SectionDraft { blocks: Vec::new() }),
            sections: drafts,
            closing,
        };
        self.finish(cx, brief, brief_ref, parts, ctx, &mut budget)
            .await
    }

    /// The writer's byline: the persona's name.
    fn author(&self, cx: &Cx<'_>) -> String {
        persona(&cx.worker.persona).map_or_else(|_| cx.worker.persona.clone(), |p| p.name)
    }

    fn assemble(
        &self,
        cx: &Cx<'_>,
        brief: &Brief,
        brief_ref: u64,
        parts: &ArticleParts,
        ctx: &ArticleContext,
    ) -> std::result::Result<Value, agents::article::AssembleError> {
        let author = self.author(cx);
        assemble_page(&ArticleInput {
            brief,
            brief_ref,
            author: &author,
            brand_suffix: &self.site.seo_suffix,
            languages: &THEME_LANGUAGES,
            parts,
            heroes: &ctx.heroes,
            links: &ctx.links,
            inline_image: true,
        })
    }

    /// Assemble, validate, and fix the failing part only (`fix#i`), within
    /// the job's repairs; each part is fixed at most once.
    async fn finish(
        &self,
        cx: &Cx<'_>,
        brief: &Brief,
        brief_ref: u64,
        mut parts: ArticleParts,
        ctx: ArticleContext,
        budget: &mut u32,
    ) -> Result<Step<(StoredParts, Value)>> {
        let validator = self
            .site
            .validator_v2
            .clone()
            .ok_or_else(|| invalid("the staged draft needs the site's knowledge pack"))?;
        let profile = &self.site.llm;
        let style = &self.site.context.style_guide;
        let n = parts.sections.len();
        let mut fixed: BTreeSet<SectionId> = BTreeSet::new();
        loop {
            let page = match self.assemble(cx, brief, brief_ref, &parts, &ctx) {
                Ok(p) => p,
                Err(e) => {
                    return Ok(Err(Halt::Invalid {
                        stage: "assemble".into(),
                        errors: vec![e.to_string()],
                    }))
                }
            };
            let issues = validator.check(&page);
            if issues.is_empty() {
                let (hero, _) = resolve_aliases(&parts.outline, &ctx.heroes, &ctx.links)
                    .map_err(|e| invalid(e.to_string()))?;
                let hero = hero.clone();
                return Ok(Ok((StoredParts::new(&parts, hero, ctx), page)));
            }
            let fixable = issues.iter().filter_map(|i| i.section).find(|s| {
                matches!(
                    s,
                    SectionId::Intro | SectionId::Section(_) | SectionId::Closing
                ) && !fixed.contains(s)
            });
            let Some(target) = fixable.filter(|_| *budget > 0) else {
                return Ok(Err(Halt::Invalid {
                    stage: "validate".into(),
                    errors: issues.iter().map(ToString::to_string).collect(),
                }));
            };
            fixed.insert(target);
            *budget -= 1;
            let problems: Vec<String> = issues
                .iter()
                .filter(|i| i.section == Some(target))
                .map(|i| format!("{}: {}", i.pointer, i.message))
                .collect();
            let index = part_index(target, n);
            let total = u32::try_from(n).unwrap_or(u32::MAX);
            match target {
                SectionId::Closing => {
                    let spec = SectionSpec {
                        id: SectionId::Closing,
                        total: n,
                        heading: parts.outline.closing_title.clone(),
                        points: Vec::new(),
                        words: closing_words(brief.target_words),
                        part: None,
                    };
                    let prompt = fix_prompt(
                        profile,
                        &cx.system,
                        brief,
                        &spec,
                        &parts.closing.content,
                        &problems,
                    );
                    let check = |v: &Value| -> std::result::Result<(), Vec<String>> {
                        let c: Closing = parse(v)?;
                        errors_of(check_closing(&c, style))
                    };
                    match self
                        .structured_stage::<Closing>(
                            cx,
                            "fix",
                            index,
                            total,
                            &prompt,
                            &closing_schema(),
                            &check,
                            budget,
                        )
                        .await?
                    {
                        Ok(c) => parts.closing = c,
                        Err(h) => return Ok(Err(h)),
                    }
                }
                id => {
                    let spec = self.spec_of(&parts.outline, id, brief);
                    let current = parts
                        .section(id)
                        .cloned()
                        .unwrap_or(SectionDraft { blocks: Vec::new() });
                    let others = other_paragraphs(&parts, id);
                    let prompt = fix_prompt(
                        profile,
                        &cx.system,
                        brief,
                        &spec,
                        &section_text(&current),
                        &problems,
                    );
                    let words = spec.words;
                    let check = |v: &Value| -> std::result::Result<(), Vec<String>> {
                        let d: SectionDraft = parse(v)?;
                        errors_of(check_section(
                            &d,
                            &SectionBudget {
                                section: id,
                                words,
                                earlier: &others,
                            },
                            style,
                        ))
                    };
                    match self
                        .structured_stage::<SectionDraft>(
                            cx,
                            "fix",
                            index,
                            total,
                            &prompt,
                            &section_schema(),
                            &check,
                            budget,
                        )
                        .await?
                    {
                        Ok(d) => set_part(&mut parts, id, d),
                        Err(h) => return Ok(Err(h)),
                    }
                }
            }
        }
    }

    fn spec_of(&self, outline: &Outline, id: SectionId, brief: &Brief) -> SectionSpec {
        let n = outline.sections.len();
        match id {
            SectionId::Section(k) => {
                let o =
                    &outline.sections[usize::from(k).saturating_sub(1).min(n.saturating_sub(1))];
                SectionSpec {
                    id,
                    total: n,
                    heading: o.heading.clone(),
                    points: o.points.clone(),
                    words: o.words,
                    part: None,
                }
            }
            SectionId::Closing => SectionSpec {
                id,
                total: n,
                heading: outline.closing_title.clone(),
                points: Vec::new(),
                words: closing_words(brief.target_words),
                part: None,
            },
            _ => SectionSpec {
                id: SectionId::Intro,
                total: n,
                heading: String::new(),
                points: Vec::new(),
                words: intro_words(brief.target_words),
                part: None,
            },
        }
    }

    // ------------------------------------------------------------ Revision (P3)

    /// The newest send-back note of the CEO on the item that came after the
    /// last committed draft (`payload.ui_type: 'send-back-note'`).
    async fn send_back_note(&self, cx: &Cx<'_>) -> Result<Option<String>> {
        let plan = self.store.plan_json(&cx.req.company_id).await?;
        let Some(posts) = plan["posts"][cx.item].as_array() else {
            return Ok(None);
        };
        let last_draft = posts
            .iter()
            .rposition(|p| p["type"] == "artifact" && p["payload"]["revision"].is_number());
        Ok(posts
            .iter()
            .enumerate()
            .rev()
            .find(|(i, p)| {
                p["payload"]["ui_type"] == "send-back-note" && last_draft.is_none_or(|d| *i > d)
            })
            .and_then(|(_, p)| p["text"].as_str())
            .map(String::from)
            .filter(|t| !t.trim().is_empty()))
    }

    /// Revision n: only the parts the review (and the CEO's note) name are
    /// rewritten; the others are assembled from the stored parts unchanged.
    async fn write_revision(
        &self,
        cx: &Cx<'_>,
        brief: &Brief,
        art: &ArtifactRecord,
    ) -> Result<Step<(StoredParts, Value)>> {
        let req = cx.req;
        let stored = art.parts.clone().ok_or_else(|| {
            invalid(format!(
                "revision {} of {} without the parts of a previous draft",
                req.revision, cx.item
            ))
        })?;
        // Stored parts come with a staged review (its issues tagged by part).
        let review = art.sectioned_review.clone().ok_or_else(|| {
            invalid(format!(
                "revision {} of {} without a review of its parts",
                req.revision, cx.item
            ))
        })?;
        let mut issues = review.issues.clone();
        if let Some(note) = self.send_back_note(cx).await? {
            issues.extend(send_back_issues(&note));
        }
        if issues.is_empty() {
            issues.push(ReviewIssue {
                section: SectionId::Whole,
                problem: if review.notes.trim().is_empty() {
                    "The editor asked for changes.".into()
                } else {
                    review.notes.clone()
                },
                fix: String::new(),
            });
        }
        let n = stored.outline.sections.len();
        let total = u32::try_from(n).unwrap_or(u32::MAX);
        let all = SectionedReview {
            issues: issues.clone(),
            ..review
        };
        let targets = all.revision_targets(n);
        // At most one `whole` issue is honoured.
        let whole = issues
            .iter()
            .find(|i| i.section == SectionId::Whole)
            .cloned();
        let notes_for = |id: SectionId| -> Vec<RevisionNote> {
            issues
                .iter()
                .filter(|i| i.section == id)
                .chain(whole.iter())
                .map(|i| RevisionNote {
                    problem: i.problem.clone(),
                    fix: i.fix.clone(),
                })
                .collect()
        };
        let profile = &self.site.llm;
        let style = &self.site.context.style_guide;
        let mut parts = stored.to_parts();
        let mut budget = JOB_REPAIRS;

        if issues.iter().any(|i| i.section == SectionId::Title) {
            let notes: Vec<RevisionNote> = issues
                .iter()
                .filter(|i| i.section == SectionId::Title)
                .map(|i| RevisionNote {
                    problem: i.problem.clone(),
                    fix: i.fix.clone(),
                })
                .collect();
            let prompt = retitle_prompt(profile, &cx.system, brief, &parts.outline, &notes);
            let check = |v: &Value| -> std::result::Result<(), Vec<String>> {
                let r: Retitle = parse(v)?;
                let mut o = stored.outline.clone();
                o.title = r.title;
                o.dek = r.dek;
                errors_of(
                    check_outline(&o, style)
                        .into_iter()
                        .filter(|e| e.section == SectionId::Title)
                        .collect(),
                )
            };
            match self
                .structured_stage::<Retitle>(
                    cx,
                    "retitle",
                    0,
                    1,
                    &prompt,
                    &retitle_schema(),
                    &check,
                    &mut budget,
                )
                .await?
            {
                Ok(r) => {
                    parts.outline.title = r.title;
                    parts.outline.dek = r.dek;
                }
                Err(h) => return Ok(Err(h)),
            }
        }

        let digests: Vec<(SectionId, String)> = stored
            .sections
            .iter()
            .map(|s| (s.id, s.digest.clone()))
            .collect();
        for id in targets.iter().copied().filter(|t| *t != SectionId::Title) {
            let index = part_index(id, n);
            let spec = self.spec_of(&parts.outline, id, brief);
            let neighbours: Vec<(SectionId, String)> =
                digests.iter().filter(|(d, _)| *d != id).cloned().collect();
            let notes = notes_for(id);
            if id == SectionId::Closing {
                let prompt = revise_prompt(
                    profile,
                    &cx.system,
                    brief,
                    &parts.outline,
                    &spec,
                    &parts.closing.content,
                    &notes,
                    &neighbours,
                );
                let check = |v: &Value| -> std::result::Result<(), Vec<String>> {
                    let c: Closing = parse(v)?;
                    errors_of(check_closing(&c, style))
                };
                match self
                    .structured_stage::<Closing>(
                        cx,
                        "revise",
                        index,
                        total,
                        &prompt,
                        &closing_schema(),
                        &check,
                        &mut budget,
                    )
                    .await?
                {
                    Ok(c) => parts.closing = c,
                    Err(h) => return Ok(Err(h)),
                }
                continue;
            }
            let current = parts.section(id).map(section_text).unwrap_or_default();
            let prompt = revise_prompt(
                profile,
                &cx.system,
                brief,
                &parts.outline,
                &spec,
                &current,
                &notes,
                &neighbours,
            );
            let others = other_paragraphs(&parts, id);
            let words = spec.words;
            let check = |v: &Value| -> std::result::Result<(), Vec<String>> {
                let d: SectionDraft = parse(v)?;
                errors_of(check_section(
                    &d,
                    &SectionBudget {
                        section: id,
                        words,
                        earlier: &others,
                    },
                    style,
                ))
            };
            match self
                .structured_stage::<SectionDraft>(
                    cx,
                    "revise",
                    index,
                    total,
                    &prompt,
                    &section_schema(),
                    &check,
                    &mut budget,
                )
                .await?
            {
                Ok(d) => set_part(&mut parts, id, d),
                Err(h) => return Ok(Err(h)),
            }
        }
        self.finish(
            cx,
            brief,
            art.brief_ref,
            parts,
            stored.context.clone(),
            &mut budget,
        )
        .await
    }

    // ------------------------------------------------------------ Review (P3)

    pub(crate) async fn staged_review(&self, req: &JobRequest) -> Result<Vec<Outcome>> {
        let item = self.work_item(req)?;
        let rec = self.load_brief(req).await?;
        let brief = rec.brief.clone();
        let editor = self.staff_by_id(req, &rec, &rec.editor, "editor")?;
        let mut art = self
            .load_artifact(req, item)
            .await?
            .ok_or_else(|| invalid(format!("review of {item} before any draft")))?;
        let page = art
            .page
            .clone()
            .ok_or_else(|| invalid(format!("review of {item} without a page")))?;
        let (_, predecessor) = self
            .begin(req, item, "review", req.brief_ref.unwrap_or_default())
            .await?;
        art.last_job.insert("review".into(), req.job_id);

        let p = persona(&editor.persona)?;
        let system = self.system_prompt(&templates::editor(), &p, Vars::new())?;
        let cx = Cx {
            req,
            item,
            worker: editor.clone(),
            predecessor,
            system,
            call: CallProfile {
                job: agents::JobKind::EditReview,
                role: Role::Editor,
                seniority: Some(p.seniority),
                staff_id: Some(editor.id.clone()),
            },
        };
        self.emit_job(
            &cx,
            ProgressState::Started,
            json!({"predecessor": predecessor}),
        );

        // The editor reads the parts of a staged draft (a page from before
        // ADR-0058 has none, and could not be revised either).
        let stored = art.parts.clone().ok_or_else(|| {
            invalid(format!(
                "review of {item} without the parts of a staged draft"
            ))
        })?;
        let parts = stored.to_parts();
        let (reading, n) = (reading_text(&parts), parts.sections.len());
        let ids = section_ids(n);
        let checks = measured_checks(&self.site, &brief, &page, Some(&parts));
        let frame = ReviewFrame {
            brief: &brief,
            revision: req.revision,
            bar: self.site.quality_bar,
            checks: &checks,
        };
        let profile = &self.site.llm;
        let estimate = profile.tokens(&reading) + profile.tokens(&checks.join("\n"));
        let mut budget = JOB_REPAIRS;
        let ok = |_: &Value| -> std::result::Result<(), Vec<String>> { Ok(()) };
        let schema = review_schema(&ids);

        let review: SectionedReview = if estimate > self.site.review_single_tokens {
            // review_section#i for the intro, each section and the closing, then the summary.
            let total = u32::try_from(n).unwrap_or(u32::MAX);
            let mut list: Vec<(SectionId, String, String)> = Vec::new();
            for s in &stored.sections {
                let draft = SectionDraft {
                    blocks: s.blocks.clone(),
                };
                let heading = if s.id == SectionId::Intro {
                    "Introduction".to_string()
                } else {
                    s.heading.clone()
                };
                list.push((s.id, heading, section_text(&draft)));
            }
            list.push((
                SectionId::Closing,
                parts.outline.closing_title.clone(),
                parts.closing.content.clone(),
            ));
            let mut scores: Vec<(SectionId, u8)> = Vec::new();
            let mut tagged: Vec<ReviewIssue> = Vec::new();
            let section_schema = section_review_schema();
            for (id, heading, text) in &list {
                let prompt =
                    review_section_prompt(profile, &cx.system, &frame, *id, n, heading, text);
                let index = part_index(*id, n);
                match self
                    .structured_stage::<SectionReview>(
                        cx_ref(&cx),
                        "review_section",
                        index,
                        total,
                        &prompt,
                        &section_schema,
                        &ok,
                        &mut budget,
                    )
                    .await?
                {
                    Ok(r) => {
                        scores.push((*id, r.score));
                        tagged.extend(r.issues.into_iter().map(|i| ReviewIssue {
                            section: *id,
                            problem: i.problem,
                            fix: i.fix,
                        }));
                    }
                    Err(h) => return self.halted(&cx, h).await,
                }
            }
            let digests: Vec<(SectionId, String)> = stored
                .sections
                .iter()
                .map(|s| (s.id, s.digest.clone()))
                .collect();
            let prompt = review_summary_prompt(profile, &cx.system, &frame, &digests, &scores);
            let mut summary: SectionedReview = match self
                .structured_stage(
                    cx_ref(&cx),
                    "review_summary",
                    0,
                    1,
                    &prompt,
                    &schema,
                    &ok,
                    &mut budget,
                )
                .await?
            {
                Ok(r) => r,
                Err(h) => return self.halted(&cx, h).await,
            };
            for issue in tagged {
                if !summary
                    .issues
                    .iter()
                    .any(|i| i.section == issue.section && i.problem == issue.problem)
                {
                    summary.issues.push(issue);
                }
            }
            summary.issues.sort_by_key(|i| i.section);
            // Any part far under the bar forces changes, whatever the summary says.
            let floor = self.site.quality_bar.saturating_sub(2);
            if scores.iter().any(|(_, s)| *s < floor) {
                summary.decision = ReviewDecision::NeedsChanges;
                summary.score = summary.score.min(self.site.quality_bar.saturating_sub(1));
            }
            summary
        } else {
            let prompt = review_prompt(profile, &cx.system, &frame, &reading);
            match self
                .structured_stage(
                    cx_ref(&cx),
                    "review",
                    0,
                    1,
                    &prompt,
                    &schema,
                    &ok,
                    &mut budget,
                )
                .await?
            {
                Ok(r) => r,
                Err(h) => return self.halted(&cx, h).await,
            }
        };

        let flat = review.to_editor_review();
        art.sectioned_review = Some(review.clone());
        art.review = Some(flat.clone());
        self.save_artifact(req, item, &art).await?;

        let verdict = match review.decision {
            ReviewDecision::Approve if review.score >= self.site.quality_bar => "approve",
            ReviewDecision::Reject => "reject",
            _ => "changes",
        };
        let mut text = review.notes.clone();
        for i in &flat.issues {
            text.push_str(&format!("\n- {i}"));
        }
        let key = format!("{}:review:0", req.job_id);
        let issues_json = serde_json::to_value(&review.issues).map_err(corrupt)?;
        self.post(
            req,
            item,
            "review",
            &editor.id,
            None,
            &text,
            json!({"verdict": verdict, "score": review.score, "issues": issues_json}),
            Some(&key),
        )
        .await?;
        let words = parts.words();
        self.emit_job(
            &cx,
            ProgressState::Done,
            json!({"score": review.score, "verdict": verdict, "issues": review.issues.len()}),
        );
        // High-risk flags and rejections are reported as not-ok: the sim blocks
        // the item and opens a ticket for the CEO.
        let ok = review.high_risk.is_empty() && review.decision != ReviewDecision::Reject;
        Ok(vec![Outcome::JobCompleted {
            job_id: req.job_id,
            digest: Digest {
                ok,
                score: review.score,
                words,
                qa_defects: u16::try_from(review.issues.len()).unwrap_or(u16::MAX),
                artifact_sha: None,
            },
        }])
    }
}

fn cx_ref<'a, 'b>(cx: &'a Cx<'b>) -> &'a Cx<'b> {
    cx
}

/// Paragraphs of every part but `id`, for the near-duplicate check of a part
/// written again.
fn other_paragraphs(parts: &ArticleParts, id: SectionId) -> Vec<String> {
    let mut out = Vec::new();
    if id != SectionId::Intro {
        out.extend(parts.intro.paragraphs());
    }
    for (i, d) in parts.sections.iter().enumerate() {
        if id != SectionId::Section(u8::try_from(i + 1).unwrap_or(u8::MAX)) {
            out.extend(d.paragraphs());
        }
    }
    out
}

fn set_part(parts: &mut ArticleParts, id: SectionId, draft: SectionDraft) {
    match id {
        SectionId::Intro => parts.intro = draft,
        SectionId::Section(n) => {
            if let Some(slot) = parts.sections.get_mut(usize::from(n).saturating_sub(1)) {
                *slot = draft;
            }
        }
        _ => {}
    }
}
