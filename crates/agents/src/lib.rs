//! swarm.press agent layer.
//!
//! Design rules (plan "Lessons"): LLMs never drive state transitions; the
//! orchestrator owns them and LLMs return artifacts. Stubs fail loudly.
//!
//! - [`roles`]: roles, seniority, traits, tiers, [`JobKind`] executor
//!   policies and the role → Claude model/effort table (`config/roles.toml`).
//! - [`models`]: browser LLM registry (`config/models.toml`).
//! - [`personas`]: the persona catalog (staff + hiring pool, schema v2) and
//!   prompt formatters; [`routing`]: topic-affinity work routing.
//! - [`plan`]: the publishing plan as agents see it (`PlanContext`,
//!   `PlanOp`, RBAC validation).
//! - [`jobs`]: structured organization jobs (CFO, Secretary, Strategy,
//!   Data Science, Photo, Web, IT, SEO & Marketing, hiring).
//! - [`prompts`]: company → site → agent prompt layering and templates.
//! - [`house_style`]: a site's style guide, formatted for prompts and used as
//!   a banned-phrase validator.
//! - [`state`]: ContentItem / Task / QuestionTicket state machines.
//! - [`llm`]: the [`Llm`] trait with Claude and fake backends.
//! - [`meetings`]: moderated multi-agent meetings, and the standup's pitch
//!   round (ADR-0062): its cap, schemas and prompts.
//! - [`pipeline`]: the editorial pipeline.
//! - [`article`]: the staged article (ADR-0058): stage schemas and typed
//!   results, plain-text rules, per-section checks, deterministic assembly
//!   of the page and the editor's reading text.
//! - [`article_prompts`]: the stage prompts of the staged article, built to
//!   fit the model's context ([`article_prompts::LlmProfile`]).
//! - [`fake_writer`]: a deterministic, brief-driven stand-in for the model
//!   in the staged article (tests and the harness).
//! - [`qa`]: the QA coherence review.

#![recursion_limit = "256"]

pub mod analysis;
pub mod article;
pub mod article_prompts;
pub mod fake_writer;
pub mod house_style;
pub mod jobs;
pub mod llm;
pub mod meetings;
pub mod models;
pub mod personas;
pub mod pipeline;
pub mod plan;
pub mod prompts;
pub mod qa;
pub mod research;
pub mod roles;
pub mod routing;
pub mod state;

pub use house_style::StyleGuide;
pub use llm::normalize_source_url;
pub use llm::{
    strip_reasoning, structured_with_repair, CallProfile, ClaudeLlm, FakeLlm, FakeReply, Llm,
    LlmError, LlmMessage, LlmRequest, MaybeSendSync, RepairFailed, Repaired, Researched,
};
pub use meetings::{
    run_meeting, MeetingEvent, MeetingOutcome, MeetingResult, MeetingSpec, Participant,
};
pub use models::{ModelEntry, ModelRegistry};
pub use personas::{catalog_json, Catalog, Persona};
pub use pipeline::{
    run_editorial_pipeline, Brief, EditorReview, PageValidator, PipelineConfig, PipelineOutcome,
    PipelineRun, Repo, Staffing,
};
pub use plan::{validate_plan_ops, PlanContext, PlanOp};
pub use prompts::{resolve, CompanyPrompt, PromptLayer, ResolvedPrompt, SiteContext};
pub use roles::{
    ClaudeProfile, Department, Executor, JobKind, Role, RolesConfig, Route, Seniority, Tier, Traits,
};
pub use routing::best_writer_for;
pub use state::{
    Actor, ContentEvent, ContentState, StateMachine, TaskEvent, TaskState, TicketEvent, TicketState,
};
