//! The office designer's deterministic core (FEAT-084; ADR-0065 §7,
//! ADR-0087 decision 6; `docs/design/construction-kit.md` §7).
//!
//! A small model places equipment **by relation** (`{design, anchor, from,
//! gap, facing, count}`), never by coordinates; this crate turns that into
//! the sim's placements or into issues the model can repair:
//!
//! ```text
//! room + brief ─► catalogue slice + docs (generated from the kit) ─► model: layout#0
//!                                                                      │ Plan (JSON, closed vocabulary)
//!   Plan::from_json ─► solve ─► SolvedItem { design, Floor{pos, rot} | OnDesk(desk) }
//!                        └──► check: walls, collisions, table, doors, walkability,
//!                                    light, items, brief, cost ─► Evaluation
//!   repair::next_step ─► Done | Repair{fix: [placement], issues} | GiveUp
//!                              └► model: fix#i ─► PlanFix ─► apply_fix ─► Plan
//! ```
//!
//! Rules: integers (mm, studs, cents) only, ordered collections only, no
//! I/O, time or threads, so the same input gives the same bytes natively and
//! in wasm. Text never enters the sim (rule 2): the plan is an artifact; only
//! the solved placements become `PlaceEquipment` commands, which the sim
//! validates again (rule 3). The sim's rules this crate mirrors are checked
//! against `sim-core` in `tests/sim_contract.rs`, where every solved fixture
//! is also applied to a sim world command by command.
//!
//! ```
//! use office_designer::*;
//! let room = Room {
//!     kind: RoomKind::Newsroom, x_mm: 0, z_mm: 0, w_mm: 6000, d_mm: 5000,
//!     doors: vec![Opening { side: Side::South, at_mm: 1000, width_mm: 1000 }],
//!     windows: vec![Opening { side: Side::North, at_mm: 1000, width_mm: 4000 }],
//!     equipment: vec![], objects: vec![],
//! };
//! let plan = Plan::from_json(r#"{"placements": [
//!   {"design": "desk", "anchor": "wall:north", "count": 3, "spacing": 4},
//!   {"design": "monitor", "anchor": "placement:0"}
//! ]}"#).unwrap();
//! let brief = Brief { workstations: 3, ..Brief::default() };
//! let eval = evaluate(&room, &plan, &brief, Catalogue::shipped());
//! assert!(eval.ok, "{:#?}", eval.issues);
//! assert_eq!(eval.items.len(), 6);
//! ```

#![forbid(unsafe_code)]

pub mod brief;
pub mod catalogue;
pub mod check;
pub mod issue;
pub mod model;
pub mod plan;
pub mod repair;
pub mod solve;

pub use brief::{Brief, Need};
pub use catalogue::{
    design_doc, room_doc, slice, slice_doc, vocabulary_doc, Catalogue, DesignInfo,
};
pub use check::{check, evaluate, Evaluation, Requirement};
pub use issue::{Issue, IssueCode, Severity};
pub use model::{
    EquipmentDesign, ExistingItem, ExistingObject, ObjectOnDesk, Opening, Pos, Rect, Room,
    RoomKind, Side,
};
pub use plan::{fix_schema, plan_schema, Anchor, Facing, Placement, Plan};
pub use repair::{apply_fix, next_step, PlanFix, RepairTask, Step, MAX_REPAIR_ROUNDS};
pub use solve::{solve, At, DeskRef, Solution, SolvedItem};

/// Everything the `layout#0` call needs to see, generated: the vocabulary,
/// the room and the catalogue slice for the brief.
pub fn layout_context(room: &Room, brief: &Brief, cat: &Catalogue) -> String {
    let designs = slice(room.kind, brief, cat);
    format!(
        "{}\n\nThe room:\n{}\n\nThe catalogue:\n{}",
        vocabulary_doc(),
        room_doc(room),
        slice_doc(&designs, cat)
    )
}
