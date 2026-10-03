//! Summaries: what a compiled design can do, derived only from its geometry
//! and its parts' tags (construction-kit.md §3), never from free text.
//!
//! The rules are game design and are listed in construction-kit.md
//! ("Shipped designs") for the owner's review:
//!
//! - **seat**: a part tagged `seat` whose top is at seat height
//!   ([`SEAT_TOP`], 40–70 cm);
//! - **work surface**: the largest flat area (stud²) at desk height
//!   ([`DESK_TOP`], 70–80 cm) whose cells have nothing but parts on them;
//! - **workstation**: a work surface of at least [`MIN_WORK_SURFACE`], a
//!   `screen` or `paper` part, and a port that accepts a `seat`;
//! - **light**: parts tagged `light-emitter`;
//! - **storage**: the top area (stud²) of parts tagged `shelf`;
//! - **screens**, **doors**, **windows**: parts with those tags;
//! - **surfaces**: named information surfaces;
//! - **parts** and **cost**: every part (split bricks and placed parts) and
//!   the sum of their catalogue prices.

use std::ops::RangeInclusive;

use serde::{Deserialize, Serialize};

use crate::design::Mount;

/// Top of a seat, plates (40–70 cm).
pub const SEAT_TOP: RangeInclusive<u32> = 16..=28;
/// Top of a work surface, plates (70–80 cm).
pub const DESK_TOP: RangeInclusive<u32> = 28..=32;
/// Smallest work surface of a workstation, stud² (8 × 8 studs, 0.25 m²).
pub const MIN_WORK_SURFACE: u32 = 64;
/// How far outside its footprint a seat port may lie, studs (1 m).
pub const SEAT_REACH: i64 = 16;

/// Capability tags a design may declare only if its geometry backs them.
pub const CAPABILITIES: [&str; 7] = [
    "seat",
    "workstation",
    "light",
    "storage",
    "screen",
    "door",
    "window",
];

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PortSummary {
    pub id: String,
    pub accepts: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Summary {
    pub design: String,
    pub hash: String,
    pub mount: Mount,
    /// Declared footprint `[w, d]`, studs.
    pub footprint: [u32; 2],
    /// Built height (top of the highest part), plates.
    pub height: u32,
    /// The design's declared tags, sorted.
    pub tags: Vec<String>,
    /// Capability tags the geometry backs, sorted.
    pub capabilities: Vec<String>,
    pub seats: u32,
    pub workstation: bool,
    /// Work surface at desk height, stud².
    pub work_surface: u32,
    pub lights: u32,
    /// Shelf area, stud².
    pub storage: u32,
    pub screens: u32,
    pub doors: u32,
    pub windows: u32,
    /// Information surface names, in build order.
    pub surfaces: Vec<String>,
    pub ports: Vec<PortSummary>,
    /// Parts (split bricks and placed parts); studs are not parts.
    pub parts: u32,
    pub studs: u32,
    /// Price of the parts, cents of in-game money.
    pub cost: u64,
}

impl Summary {
    /// Whether the geometry backs a capability tag.
    pub fn has_capability(&self, tag: &str) -> bool {
        self.capabilities.iter().any(|c| c == tag)
    }

    /// The derived capability tags, sorted.
    pub(crate) fn derive_capabilities(&mut self) {
        let mut c = Vec::new();
        let has = [
            ("door", self.doors > 0),
            ("light", self.lights > 0),
            ("screen", self.screens > 0),
            ("seat", self.seats > 0),
            ("storage", self.storage > 0),
            ("window", self.windows > 0),
            ("workstation", self.workstation),
        ];
        for (tag, yes) in has {
            if yes {
                c.push(tag.to_string());
            }
        }
        self.capabilities = c;
    }
}
