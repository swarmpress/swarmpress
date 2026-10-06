//! Site blueprints and tool graphs (ADR-0072, `docs/design/construction-kits.md`).
//!
//! * [`format`]: the blueprint (`swarmpress.blueprint.v1`): page types and
//!   their slots, globals, collections, relationships, navigation, intent.
//! * [`types`]: one structural type system for blocks and tools.
//! * [`check`]: closed ids, page-type rules and type fits, as [`Issue`]s.
//! * [`hash`], [`diff`]: the semantic hash and diffs keyed by stable ids.
//! * [`import`]: a read-only blueprint reverse-engineered from a live site.
//! * [`town`]: the blueprint as a brick town, a `swarmpress.design.v1`
//!   design the kit compiles (the bricks are a view, never the source).
//!
//! Everything is pure and deterministic (ordered maps only, integers only),
//! natively and in wasm.

#![forbid(unsafe_code)]

pub mod check;
pub mod diff;
pub mod format;
pub mod hash;
pub mod import;
pub mod issue;
pub mod site;
pub mod town;
pub mod types;

pub use check::{check, CheckContext, ToolSig};
pub use diff::{apply, diff, Change, ChangeKind, Subject};
pub use format::{Blueprint, BlueprintPageType, BLUEPRINT_FORMAT, BLUEPRINT_PATH};
pub use hash::hash;
pub use issue::{Issue, IssueCode};
pub use types::{TypeExpr, TypeRegistry};
