//! The construction kit (ADR-0065, `docs/design/construction-kit.md`).
//!
//! Four layers: **parts** (a fixed catalogue in `kit/parts/*.json`),
//! **designs** (named builds in a closed brick script, hashed as content),
//! **rooms** (a shell from the sim's room plus placements) and buildings.
//! This crate is the deterministic compiler shared by the renderer, the
//! headless runner and the central server, natively and in wasm:
//!
//! ```text
//! design + params ─► expand ops ─► voxel grid (colour, material, object)
//!                                      ├─► validation (parts, colours, footprint, budgets,
//!                                      │               no floating bricks, ports)
//!                                      ├─► brick splitter ─► bricks per colour (+ studs)
//!                                      └─► summary: footprint, height, tags, seats,
//!                                          workstation, light, storage, screens,
//!                                          surfaces, part count, cost
//! ```
//!
//! Rules (CLAUDE.md rule 1 applies): integers only in everything that feeds a
//! summary, a hash or a validation; ordered collections only; no I/O, time or
//! threads. Floats appear only in [`export`], the renderer's instance buffers.
//!
//! The sim holds capabilities, never bricks: in the MVP the renderer maps each
//! equipment and room kind to a shipped design ([`Kit::mapping`],
//! [`shell::room_shell`]) and the sim is unchanged.
//!
//! ```
//! let kit = kit::Kit::shipped();
//! let desk = kit.design("desk").unwrap();
//! let built = kit::compile(desk, &kit::Params::new(), kit).unwrap();
//! assert!(built.summary.workstation);
//! ```

#![forbid(unsafe_code)]

pub mod catalogue;
pub mod compile;
pub mod design;
pub mod export;
pub mod expr;
pub mod grid;
pub mod issue;
pub mod shell;
pub mod shipped;
pub mod split;
pub mod summary;

pub use catalogue::{Colour, ColourClass, Kit, PartDef, PartTag};
pub use compile::{compile, compile_with, summary, Compiled, Limits};
pub use design::{Design, ParamValue, Params, DESIGN_DOMAIN, DESIGN_FORMAT};
pub use export::{buffers, Buffers};
pub use issue::{Issue, IssueCode};
pub use shell::{room_shell, room_specs, LayoutRoom, RoomSpec, ShellChunk};
pub use summary::Summary;

/// The design hash: `sha256("swarmpress:design:v1" ‖ canonical JSON)`, hex.
pub fn hash(design: &Design) -> Result<String, Vec<Issue>> {
    design.hash()
}
