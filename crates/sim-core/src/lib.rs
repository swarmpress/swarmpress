//! Deterministic simulation core for SimPress.
//!
//! Rules (see the plan's "Game design and sim model"):
//! - integer / fixed-point math only, no floats: positions are millimetres
//!   (`i32`), money is cents (`i64`), stats are permille (`u16`)
//! - ordered collections only (`Vec`, `BTreeMap`, `BTreeSet`), never a `HashMap`
//! - all randomness comes from the seeded PCG stored in the [`World`]
//! - the same seed + the same ordered command log yields the same
//!   [`World::hash`] natively and in wasm (see `tests/golden.rs`)
//!
//! Module map:
//! - [`clock`]: step → day/minute, day phases, daylight window
//! - [`geom`]: tiles (1 tile = 1 m), millimetre positions, rects, sides
//! - [`building`]: lot, rooms, doors, windows, walls, connectivity
//! - [`equipment`]: desks, monitors, lamps, lights, props
//! - [`staff`]: personas, roles, traits, schedules, the staff FSM types
//! - [`pathfinding`]: deterministic A* on the tile grid through doors
//! - [`commands`]: player [`Command`]s and [`ServerCommand`]s
//! - [`validate`]: `validate(&World, &Command) -> Result<(), Reject>`
//! - [`economy`]: cash ledger and the 00:00 settlement
//! - [`render_state`]: the sim → renderer contract (ADR-0007)
//! - [`world`]: the [`World`] itself, `apply` and `step`
//! - [`scenarios`]: canned worlds (`demo_office`) and the golden script

#![forbid(unsafe_code)]

pub mod building;
pub mod clock;
pub mod commands;
pub mod economy;
pub mod equipment;
pub mod geom;
pub mod ids;
pub mod pathfinding;
pub mod render_state;
pub mod scenarios;
pub mod staff;
pub mod validate;
pub mod world;

pub use clock::{Clock, DayPhase, SimConfig, MINUTES_PER_DAY, STEPS_PER_SECOND};
pub use commands::{Command, Input, ServerCommand};
pub use render_state::RenderState;
pub use validate::{validate, validate_input, validate_server, Reject};
pub use world::{CmdReceipt, StepReport, World};
