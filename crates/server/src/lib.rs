//! swarm.press central server (local-first, ADR-0038; SQLite, ADR-0039).
//!
//! The company itself (sim, plan, orchestrator, local LLM staff) runs in the
//! player's browser. This server keeps only what must be shared, secret or
//! trusted:
//!
//! - [`auth`]: GitHub OAuth, the development login and cookie sessions
//! - [`companies`]: one company per player, its site-repo binding and the
//!   device lease
//! - [`gateway`]: content PRs on the player's behalf (`PathPolicy`)
//! - [`site_knowledge`]: the knowledge pack of a company's site
//!   (`GET /api/gateway/knowledge`) and its cache, which the gateway's
//!   closed-world draft check reads
//! - [`article`]: the blog-article profile the gateway enforces on drafts
//! - [`finalize`]: what a merge adds to an article: the published page and
//!   its entry in the story list
//! - [`events`]: the offline event inbox (poll + WebSocket push)
//! - [`webhooks`]: GitHub `deployment_status` → `DeployLanded` / `DeployFailed`
//! - [`deploys`]: what became of a merge: the poller for servers without a
//!   public address, the "at or before" rule, `GET /api/gateway/deploy-status`
//! - [`sync`]: command-log segments and snapshots (backup / new device)
//! - [`web`]: the fetch proxy (SSRF-guarded) and the Firecrawl stub
//! - [`tracker`]: first-party analytics collector, rollup, retention, signals
//! - [`db`]: every SQL statement (SQLite, single writer + readers)
//! - [`app`]: state, routes, background tasks

pub mod app;
pub mod article;
pub mod auth;
pub mod companies;
pub mod config;
pub mod db;
pub mod deploys;
pub mod error;
pub mod events;
pub mod finalize;
pub mod gateway;
pub mod site_knowledge;
pub mod sync;
pub mod tracker;
pub mod web;
pub mod webhooks;

pub use app::{router, serve, AppState};
pub use config::Config;
