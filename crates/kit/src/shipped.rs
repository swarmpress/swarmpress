//! The kit as shipped: the files under `kit/`, embedded so the wasm build
//! needs no file access.

use std::sync::OnceLock;

use crate::catalogue::{Kit, Sources};

pub const PALETTE: &str = include_str!("../../../kit/palette.json");
pub const PARTS: [&str; 2] = [
    include_str!("../../../kit/parts/standard.json"),
    include_str!("../../../kit/parts/special.json"),
];
pub const ROOMS: &str = include_str!("../../../kit/rooms.json");
pub const MAPPING: &str = include_str!("../../../kit/mapping.json");

/// Shipped designs as `(file stem, JSON)`; a test checks this list against
/// the files in `kit/designs/`.
pub const DESIGNS: [(&str, &str); 18] = [
    (
        "archive-shelf",
        include_str!("../../../kit/designs/archive-shelf.json"),
    ),
    (
        "book-row",
        include_str!("../../../kit/designs/book-row.json"),
    ),
    (
        "camera-rig",
        include_str!("../../../kit/designs/camera-rig.json"),
    ),
    (
        "ceiling-light",
        include_str!("../../../kit/designs/ceiling-light.json"),
    ),
    ("chair", include_str!("../../../kit/designs/chair.json")),
    (
        "coffee-machine",
        include_str!("../../../kit/designs/coffee-machine.json"),
    ),
    (
        "color-monitor",
        include_str!("../../../kit/designs/color-monitor.json"),
    ),
    ("desk", include_str!("../../../kit/designs/desk.json")),
    (
        "desk-lamp",
        include_str!("../../../kit/designs/desk-lamp.json"),
    ),
    (
        "desk-pedestal",
        include_str!("../../../kit/designs/desk-pedestal.json"),
    ),
    (
        "meeting-table",
        include_str!("../../../kit/designs/meeting-table.json"),
    ),
    ("monitor", include_str!("../../../kit/designs/monitor.json")),
    (
        "mood-board-wall",
        include_str!("../../../kit/designs/mood-board-wall.json"),
    ),
    ("mug", include_str!("../../../kit/designs/mug.json")),
    (
        "paper-stack",
        include_str!("../../../kit/designs/paper-stack.json"),
    ),
    ("plant", include_str!("../../../kit/designs/plant.json")),
    ("stool", include_str!("../../../kit/designs/stool.json")),
    (
        "whiteboard",
        include_str!("../../../kit/designs/whiteboard.json"),
    ),
];

/// The shipped sources.
pub fn sources() -> Sources<'static> {
    static DESIGN_TEXTS: OnceLock<Vec<&'static str>> = OnceLock::new();
    let designs = DESIGN_TEXTS.get_or_init(|| DESIGNS.iter().map(|(_, t)| *t).collect());
    Sources {
        palette: PALETTE,
        parts: &PARTS,
        designs: designs.as_slice(),
        rooms: ROOMS,
        mapping: MAPPING,
    }
}

impl Kit {
    /// The shipped kit, loaded once. Panics if the embedded data is invalid,
    /// which the crate's tests rule out.
    pub fn shipped() -> &'static Kit {
        static KIT: OnceLock<Kit> = OnceLock::new();
        KIT.get_or_init(|| match Kit::load(&sources()) {
            Ok(k) => k,
            Err(issues) => {
                let lines: Vec<String> = issues.iter().map(ToString::to_string).collect();
                panic!("the shipped kit is invalid:\n{}", lines.join("\n"))
            }
        })
    }
}
