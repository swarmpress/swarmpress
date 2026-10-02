//! SimPress agent layer.
//!
//! Design rules (plan "Lessons"): LLMs never drive state transitions; the
//! orchestrator owns them and LLMs return artifacts. Stubs fail loudly.
//!
//! - [`roles`]: roles, seniority, traits, tiers, [`JobKind`] executor
//!   policies and the role → Claude model/effort table (`config/roles.toml`).
//! - [`models`]: browser LLM registry (`config/models.toml`).
//! - [`personas`]: the six legacy personas plus prompt formatters.
//! - [`prompts`]: company → site → agent prompt layering and templates.
//! - [`house_style`]: a site's style guide, formatted for prompts and used as
//!   a banned-phrase validator.
//! - [`state`]: ContentItem / Task / QuestionTicket state machines.
//! - [`llm`]: the [`Llm`] trait with Claude and fake backends.
//! - [`meetings`]: moderated multi-agent meetings.
//! - [`pipeline`]: the editorial pipeline.
//! - [`qa`]: the QA coherence review.

pub mod house_style;
pub mod llm;
pub mod meetings;
pub mod models;
pub mod personas;
pub mod pipeline;
pub mod prompts;
pub mod qa;
pub mod roles;
pub mod state;

pub use house_style::StyleGuide;
pub use llm::{
    CallProfile, ClaudeLlm, FakeLlm, FakeReply, Llm, LlmError, LlmMessage, LlmRequest,
    MaybeSendSync,
};
pub use meetings::{
    run_meeting, MeetingEvent, MeetingOutcome, MeetingResult, MeetingSpec, Participant,
};
pub use models::{ModelEntry, ModelRegistry};
pub use personas::Persona;
pub use pipeline::{
    run_editorial_pipeline, Brief, EditorReview, PageValidator, PipelineConfig, PipelineOutcome,
    PipelineRun, Repo, Staffing,
};
pub use prompts::{resolve, CompanyPrompt, PromptLayer, ResolvedPrompt, SiteContext};
pub use roles::{
    ClaudeProfile, Executor, JobKind, Role, RolesConfig, Route, Seniority, Tier, Traits,
};
pub use state::{
    Actor, ContentEvent, ContentState, StateMachine, TaskEvent, TaskState, TicketEvent, TicketState,
};
