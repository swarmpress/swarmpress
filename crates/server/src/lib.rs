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
//! - [`article`]: the blog-article profile the gateway enforces on drafts
//! - [`events`]: the offline event inbox (poll + WebSocket push)
//! - [`webhooks`]: GitHub `deployment_status` → `DeployLanded`
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
pub mod error;
pub mod events;
pub mod gateway;
pub mod sync;
pub mod tracker;
pub mod web;
pub mod webhooks;

pub use app::{router, serve, AppState};
pub use config::Config;
