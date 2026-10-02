//! GitHub integration for swarm.press.
//!
//! One repo per player company: page/collection JSON under `content/`, the
//! agent-authored theme under `theme/`, deployed by the repo's own GitHub
//! Actions to Pages. This crate is the only thing in swarm.press that talks
//! to GitHub.
//!
//! * [`auth`] — GitHub App JWT → cached installation tokens; static-token dev mode.
//! * [`RepoApi`] — the async trait for every repo operation, implemented by
//!   [`HttpGitHub`] (raw REST over reqwest) and [`FakeGitHub`] (in-memory).
//! * [`GuardedRepo`] / [`PathPolicy`] — who may write which paths/branches.
//! * [`ratelimit`] — per-installation token bucket + GitHub rate-limit feedback.
//! * [`webhooks`] — HMAC verification, typed events, delivery dedupe.
//! * [`ContentRepo`] — idempotent draft/merge/theme-branch flows.
//! * [`snapshot`] — all text files under a prefix at one commit, as a
//!   [`knowledge::SiteSource`] (the knowledge pack is built from it).
//! * [`revert`] — open a revert PR for a squash commit (rollback path).

pub mod api;
pub mod auth;
pub mod clock;
pub mod content;
pub mod error;
pub mod fake;
pub mod http;
pub mod policy;
pub mod ratelimit;
pub mod revert;
pub mod snapshot;
pub mod types;
pub mod webhooks;

pub use api::RepoApi;
pub use auth::{AppAuth, InstallationToken, StaticToken, TokenProvider};
pub use clock::{Clock, ManualClock, RecordingSleeper, Sleeper, SystemClock, TokioSleeper};
pub use content::{ContentRepo, DraftPr, VersionedJson};
pub use error::{GitHubError, Result};
pub use fake::{git_blob_sha, FakeGitHub};
pub use http::{HttpGitHub, DEFAULT_API_BASE};
pub use policy::{ActorKind, GuardedRepo, PathPolicy};
pub use ratelimit::{Governor, GovernorConfig, GovernorPool, RateLimitInfo};
pub use revert::open_revert_pr;
pub use snapshot::{Snapshot, SnapshotLimits};
pub use types::*;
