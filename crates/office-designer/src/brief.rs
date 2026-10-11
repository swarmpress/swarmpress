//! A build brief: what the room must offer when the plan is built
//! (construction-kit.md §7.2 `brief#0`). Counts include what the room already has.

use serde::{Deserialize, Serialize};

/// What a brief can ask for: a closed list.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Need {
    /// Desks with a screen (monitor or colour monitor) on them.
    Workstations,
    /// Seats at the room's table (meeting rooms, strategy rooms, kitchens):
    /// set by the room's size, never by the plan.
    MeetingSeats,
    /// Archive shelves.
    Storage,
    /// Whiteboards and mood boards.
    WritingSurfaces,
    /// Coffee machines.
    Coffee,
    /// Plants.
    Plants,
}

impl Need {
    pub const ALL: [Need; 6] = [
        Need::Workstations,
        Need::MeetingSeats,
        Need::Storage,
        Need::WritingSurfaces,
        Need::Coffee,
        Need::Plants,
    ];

    pub fn slug(self) -> String {
        serde_json::to_value(self)
            .ok()
            .and_then(|v| v.as_str().map(str::to_owned))
            .unwrap_or_default()
    }

    /// Plain words for messages: `workstations`, `meeting seats`.
    pub fn words(self) -> String {
        self.slug().replace('-', " ")
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Brief {
    #[serde(default)]
    pub workstations: u8,
    #[serde(default)]
    pub meeting_seats: u8,
    #[serde(default)]
    pub storage: u8,
    #[serde(default)]
    pub writing_surfaces: u8,
    #[serde(default)]
    pub coffee: u8,
    #[serde(default)]
    pub plants: u8,
    /// The most the plan may cost, cents.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_cost_cents: Option<i64>,
}

impl Brief {
    pub fn wants(&self, need: Need) -> u8 {
        match need {
            Need::Workstations => self.workstations,
            Need::MeetingSeats => self.meeting_seats,
            Need::Storage => self.storage,
            Need::WritingSurfaces => self.writing_surfaces,
            Need::Coffee => self.coffee,
            Need::Plants => self.plants,
        }
    }
}
