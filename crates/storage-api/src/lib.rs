//! The governed layer's storage API for the WordPress fork (ADR-0084 §3).
//!
//! The fork's `wpdb` seam sends every statement as WordPress wrote it, in
//! MySQL. This crate is the governed side:
//!
//! - [`translate`] turns a statement into SQLite (or into an introspection
//!   or session answer);
//! - [`classify`] says whether a write is **governed** (it becomes part of a
//!   commit), **scratch** (disposable: transients, sessions, cron, locks) or
//!   **unknown** (refused once the classifier is enforced);
//! - [`projection`] runs the result on a branch's relational projection.
//!
//! This is the M0 spike of the build plan (`docs/design/wordpress-site-engine.md`).
//! It is measured by replaying a corpus of statements WordPress sent
//! (`tests/replay.rs`). No WordPress code is used here: the corpus is
//! statements, the schema was read from the database WordPress created
//! (CLAUDE.md rule 16).

pub mod classify;
pub mod ddl;
pub mod derived;
pub mod host;
pub mod objects;
pub mod projection;
pub mod protocol;
pub mod translate;

pub use classify::{classify, Class};
pub use host::{Host, HostError};
#[cfg(feature = "native")]
pub use projection::Native;
pub use projection::{Exec, Outcome, Projection, ProjectionError, Rows, WORDPRESS_SCHEMA};
pub use protocol::{Platform, Session};
pub use translate::{translate, Schema, TranslateError, Translated};
