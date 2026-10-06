//! The orchestrator: turns sim job requests into agent work, repo changes and
//! plan posts, and reports outcomes back (docs/mvp.md, ADR-0011, ADR-0038).
//!
//! The sim owns every state transition (ADR-0011). The orchestrator never
//! decides what happens next to a work item; it runs exactly the job it is
//! given and reports a typed [`Outcome`] that the caller turns into a
//! `ServerCommand` for the sim.
//!
//! It is decoupled from any runtime or database so that it compiles to
//! `wasm32-unknown-unknown` and runs in the browser (ADR-0038):
//!
//! - [`Store`] holds text: briefs, artifacts, transcripts and the plan thread.
//!   [`MemStore`] is the in-memory implementation; the browser plugs in its
//!   Turso/sqlite-wasm store through the JS bridge (`crates/orchestrator-wasm`),
//!   the server a SQLite one.
//! - [`Gateway`] performs repo operations: open a draft PR, merge it.
//!   [`FakeGateway`] is in-memory; [`GithubGateway`] (native only) wraps
//!   `github::ContentRepo`; the browser uses an HTTP gateway to the central
//!   service.
//! - The LLM is the agents crate's [`agents::Llm`].
//! - [`Progress`] (optional) hears what a job is doing, stage by stage
//!   ([`ProgressEvent`]): the browser's HUD and activity log (ADR-0058).
//! - [`CancelToken`] stops a running job between stages (P6): the host
//!   cancels a job past its wall-clock limit; it ends with `JobFailed`.
//!
//! Repo writes carry an [`Attribution`] (ADR-0056 decision 8, as narrowed by
//! ADR-0058 decision 10): the draft commit names the writer's persona, the
//! squash commit the writer, the editor and the approver.
//!
//! The Draft and Review jobs run in bounded stages (ADR-0058, `staged`):
//! each stage is one model call that fits the model's context
//! ([`agents::article_prompts::LlmProfile`]) and is stored by
//! `(company, job, stage, index)`, so a re-run job repeats no completed call.
//!
//! Async traits are `Send` on native targets and `?Send` on wasm32, matching
//! [`agents::Llm`] (see [`agents::MaybeSendSync`]).

mod analysis;
mod article;
mod board;
pub mod eval;
mod gateway;
mod maintain;
mod run;
mod site;
mod staged;
mod standup;
mod store;

pub use agents::article_prompts::LlmProfile;
pub use analysis::{performance_score, PageNumbers, PerformanceContext};
pub use article::{
    article_context, article_schema, blog_categories, brief_entities, brief_ref_for, entity_facts,
    hero_shortlist, link_shortlist, related_titles, site_validator, site_validator_v2, slugify,
    used_hero_images, word_count, ArticleContext, SiteValidatorV2, ARTICLE_BLOCK_DOCS,
    ENTITY_FACTS, HERO_SHORTLIST, LINK_SHORTLIST, RELATED_TITLES,
};
pub use board::{
    workstream_ref_for, BoardContext, BrokenPage, SiteHealth, StalePage, PLAN_REPAIRS,
};
#[cfg(not(target_arch = "wasm32"))]
pub use gateway::GithubGateway;
pub use gateway::{
    Attribution, DeployState, DraftPr, FakeGateway, FakePr, Gateway, GatewayError, PageFile,
    Redeploy,
};
pub use run::{CancelToken, Orchestrator, OrchestratorError, SiteBinding};
pub use site::{
    ConfigSource, SeoSuffixSource, SiteKnowledge, STYLE_GUIDE_PATH, WRITER_PROMPT_PATH,
};
pub use staged::{
    measured_checks, send_back_issues, stage_hash, JOB_REPAIRS, REVIEW_SINGLE_TOKENS,
    SECTION_REPAIRS,
};
pub use standup::{
    context_pack, ContextPack, InFlight, StandupContext, Wip, CONTEXT_PACK_TOKENS, PITCH_REPAIRS,
    TOPIC_OVERLAP,
};
pub use store::{
    ArtifactRecord, BriefRecord, MemStore, StageRow, Store, StoreError, StoredParts, StoredSection,
    PLAN_POSTS_PER_ITEM, POST_TYPES,
};

use agents::MaybeSendSync;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// The jobs of the MVP article loop.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum JobKind {
    Standup,
    Draft,
    Review,
    Publish,
    /// The weekly editorial board (ADR-0069).
    Board,
    /// The data scientist's follow-up of a published item (ADR-0071).
    Performance,
    /// The data scientist's weekly KPI report (ADR-0071).
    KpiReport,
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
    /// Company id (opaque to the orchestrator; used to key the store).
    pub company_id: String,
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
    /// The meeting a standup runs (`meeting-3`, the sim's
    /// `Effect::RequestJob.meeting`): its turns become the meeting's
    /// `Utterance`s in the browser (the `turn` progress event carries it).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub meeting: Option<String>,
    /// What the host knows that the sim's request does not carry: for a
    /// standup, [`StandupContext`] (work in progress, items in flight, the
    /// wall-clock date, measured throughput). `null` without.
    #[serde(default, skip_serializing_if = "Value::is_null")]
    pub context: Value,
    /// Publish jobs: who approved the publish at the CEO's gate (ADR-0059),
    /// as the `Approved-by` of the squash commit. Never from the sim (its
    /// effects carry no names): the host fills it in at job time from the
    /// answered `PublishApproval` ticket and the signed-in CEO
    /// (`apps/game/src/orchestration/approver.ts`). Absent when nobody
    /// approved (an autonomous policy) or the host does not know.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub approved_by: Option<String>,
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

/// A brief agreed in a standup, as the sim needs it to create a work item.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BriefOut {
    pub brief_ref: u64,
    pub writer: String,
    pub editor: String,
}

/// Alias used by the sim-side contract (docs/mvp.md).
pub type BriefStub = BriefOut;

/// Why a job failed (`ServerCommand::JobFailed`; the names are the sim's
/// `JobFailure`, which also accepts the kebab-case slugs). The executor's
/// error text stays outside the sim.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum JobFailure {
    Model,
    InvalidOutput,
    /// The closed world has no media for the job (rule 5): an empty hero
    /// shortlist.
    NeedsMedia,
    NeedsPage,
    Timeout,
    Cancelled,
    Infrastructure,
}

/// What a job reports; each becomes a `ServerCommand` for the sim.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum Outcome {
    MeetingOutcome {
        job_id: u64,
        briefs: Vec<BriefOut>,
    },
    JobCompleted {
        job_id: u64,
        digest: Digest,
    },
    /// The job cannot finish; the sim blocks the item with the ticket the
    /// reason calls for (`NeedsMedia`, `NeedsPage`, else `Escalation`).
    JobFailed {
        job_id: u64,
        reason: JobFailure,
    },
    DeployLanded {
        work_item: String,
    },
    /// The editorial board's plan (ADR-0069): `workstreams` are store refs
    /// whose titles are plan text under `workstream:<ref>`; items name them
    /// by index.
    BoardOutcome {
        job_id: u64,
        workstreams: Vec<u64>,
        items: Vec<PlannedOut>,
    },
}

fn article_kind() -> String {
    "Article".into()
}

/// One item the board planned, in the sim's `PlannedStub` field names (its
/// `kind` defaults to an article; `priority` is the sim's variant name).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlannedOut {
    /// `Article`, `Refresh` or `Fix` (the sim's `WorkItemKind`, ADR-0070).
    #[serde(default = "article_kind")]
    pub kind: String,
    pub brief_ref: u64,
    /// Who reviews and owns it (a staff id); the writer is the sim's choice.
    pub editor: String,
    pub priority: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workstream: Option<u8>,
    pub start_offset: u8,
    pub publish_offset: u8,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub depends_on: Vec<u8>,
}

/// Where a stage is ([`ProgressEvent::state`]).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProgressState {
    /// The stage (or the job, `stage: "job"`) began.
    Started,
    /// Finished; `detail` says what came out.
    Done,
    /// Taken from the stage store: no model call.
    Reused,
    Failed,
}

/// What a job is doing, as counts (ADR-0058 decision 8: "writing section 3
/// of 5", never a percentage).
///
/// `stage` is `job` for the job as a whole, else one of `context`,
/// `outline`, `section` (index 0 is the intro, 1…`total` the body
/// sections), `closing`, `fix`, `retitle`, `revise`, `review`,
/// `review_section`, `review_summary` or `commit`; a standup's are
/// `opening`, `pitch` (1…`total`, one per free writer) and `commission`.
/// `index`/`total` count within the stage. `detail` carries what an
/// activity record keeps: words, repairs, errors, score, PR, branch, sha.
///
/// `turn` is not a stage but a meeting turn just written to the transcript
/// (`TurnFinished`, ADR-0062 decision 8): `state` is `done`, `staff` the
/// speaker, `index` the transcript seq and `detail`
/// `{seq, speaker, chars, meeting}`. The browser turns it into an
/// `Utterance` command; the text stays in the store.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProgressEvent {
    pub job_id: u64,
    pub kind: JobKind,
    pub revision: u8,
    pub work_item: Option<String>,
    /// Sim id of who does the stage.
    pub staff: Option<String>,
    pub persona: Option<String>,
    pub role: Option<String>,
    pub stage: String,
    pub index: u32,
    pub total: u32,
    pub state: ProgressState,
    #[serde(default)]
    pub detail: Value,
}

/// Hears [`ProgressEvent`]s ([`Orchestrator::with_progress`]).
pub trait Progress: MaybeSendSync {
    fn report(&self, event: &ProgressEvent);
}

impl<F: Fn(&ProgressEvent) + MaybeSendSync> Progress for F {
    fn report(&self, event: &ProgressEvent) {
        self(event)
    }
}
