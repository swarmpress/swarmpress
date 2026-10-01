//! SimPress central server.
//!
//! - [`app`]: state, HTTP routes, bootstrap
//! - [`auth`]: GitHub OAuth + cookie sessions
//! - [`actor`]: per-company authoritative sim actors and their registry
//! - [`store`]: command log + snapshots (Postgres, in-memory for tests)
//! - [`ws`]: lockstep WebSocket + browser job worker
//! - [`wire`]: postcard frames spoken on `/ws`
//! - [`jobs`]: Postgres job queue, notifier, reaper, Claude pool, artifact validation
//! - [`sim`]: the [`sim::Simulation`] seam over sim-core
//! - [`plan`]: publishing-plan text store, CEO REST, agent plan ops, `PlanPost` fan-out
//! - [`tracker`]: first-party analytics collector, rollup, retention, nightly signals

pub mod actor;
pub mod app;
pub mod auth;
pub mod config;
pub mod db;
pub mod error;
pub mod jobs;
pub mod plan;
pub mod sim;
pub mod store;
pub mod tracker;
pub mod wire;
pub mod ws;

pub use app::{router, serve, AppState};
pub use config::Config;
