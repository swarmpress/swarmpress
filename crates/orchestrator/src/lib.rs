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
//!
//! Async traits are `Send` on native targets and `?Send` on wasm32, matching
//! [`agents::Llm`] (see [`agents::MaybeSendSync`]).

mod article;
mod gateway;
mod run;
mod store;

pub use article::{
    article_schema, brief_ref_for, site_validator, slugify, word_count, ARTICLE_BLOCK_DOCS,
};
#[cfg(not(target_arch = "wasm32"))]
pub use gateway::GithubGateway;
pub use gateway::{DraftPr, FakeGateway, FakePr, Gateway, GatewayError};
pub use run::{Orchestrator, OrchestratorError, SiteBinding};
pub use store::{
    ArtifactRecord, BriefRecord, MemStore, Store, StoreError, PLAN_POSTS_PER_ITEM, POST_TYPES,
};

use serde::{Deserialize, Serialize};

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

/// What a job reports; each becomes a `ServerCommand` for the sim.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum Outcome {
    MeetingOutcome { job_id: u64, briefs: Vec<BriefOut> },
    JobCompleted { job_id: u64, digest: Digest },
    DeployLanded { work_item: String },
}
