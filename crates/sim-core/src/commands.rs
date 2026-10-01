//! Inputs to the simulation. Player [`Command`]s come from the CEO's client;
//! [`ServerCommand`]s are injected by the authoritative server (job results,
//! meeting utterances, nightly site audit). Both are applied in `(step, seq)`
//! order, see [`crate::world::World::enqueue`].
//!
//! Wire encoding is postcard; `protocol` re-exports these types.

use serde::{Deserialize, Serialize};

use crate::building::{Door, RoomKind, Window};
use crate::equipment::EquipmentKind;
use crate::geom::{PosMm, Side, TileRect};
use crate::ids::{CandidateId, EquipId, JobId, MeetingId, RoomId, StaffId};

/// What the player can do.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Command {
    /// Extend the lot by `tiles` rows/columns on `side`.
    BuyFloorSpace {
        side: Side,
        tiles: u8,
    },
    /// Build a room. Ceiling lights are installed automatically.
    PlaceRoom {
        kind: RoomKind,
        rect: TileRect,
        floor: u8,
        doors: Vec<Door>,
        windows: Vec<Window>,
    },
    /// Tear down a room (with its equipment) or one piece of equipment.
    Demolish(DemolishTarget),
    /// Buy and place equipment.
    PlaceEquipment {
        kind: EquipmentKind,
        placement: Placement,
    },
    /// Hire a candidate from today's shortlist.
    Hire {
        candidate: CandidateId,
    },
    /// Let someone go (pays severance; they walk out).
    Fire {
        staff: StaffId,
    },
    SetPolicy(Policy),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum DemolishTarget {
    Room(RoomId),
    Equipment(EquipId),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Placement {
    /// Free-standing item at a floor (or ceiling) position, `rot` quarter turns.
    Floor { pos: PosMm, rot: u8 },
    /// Item that sits on a desk (monitor, lamp).
    OnDesk(EquipId),
}

/// Company policies the CEO sets.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Policy {
    Overtime(OvertimePolicy),
    Autonomy(AutonomyPolicy),
    /// Editor approval bar, 5..=10 (default 7).
    QualityBar(u8),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum OvertimePolicy {
    /// Everyone is out by 18:30.
    Never,
    /// People keep their own hours (deadline crews stay late).
    Allow,
    /// Everyone stays until at least 20:00; morale suffers.
    Crunch,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum AutonomyPolicy {
    ApproveAll,
    ApproveMajor,
    Autonomous,
}

/// Digest of a finished LLM job. Text never enters the sim.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct JobDigest {
    pub ok: bool,
    /// Editor score 0..=10 where applicable.
    pub score: u8,
    pub words: u32,
    pub qa_defects: u16,
    /// First 16 bytes of the artifact's SHA-256.
    pub artifact_sha: [u8; 16],
}

/// Nightly deterministic audit of the real site.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct SiteSignals {
    pub live_pages: u32,
    pub languages: u8,
    pub broken_links: u32,
    pub media_count: u32,
    /// Lighthouse scores, 0..=100.
    pub lighthouse_performance: u8,
    pub lighthouse_accessibility: u8,
    pub lighthouse_seo: u8,
}

/// Commands only the server may inject.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum ServerCommand {
    /// An LLM job finished. M1: there are no jobs yet, so this is rejected
    /// loudly with [`crate::Reject::NotSupported`].
    JobCompleted { job_id: JobId, digest: JobDigest },
    /// One meeting turn: `speaker` talks for a duration derived from `chars`.
    /// The text itself is fetched by reference and never enters the sim.
    Utterance {
        meeting: MeetingId,
        seq: u32,
        speaker: StaffId,
        chars: u32,
    },
    /// Result of the nightly site audit.
    SiteSignals(SiteSignals),
}

/// Anything that can be applied to a world.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Input {
    Player(Command),
    Server(ServerCommand),
}

impl From<Command> for Input {
    fn from(c: Command) -> Self {
        Input::Player(c)
    }
}

impl From<ServerCommand> for Input {
    fn from(c: ServerCommand) -> Self {
        Input::Server(c)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn commands_round_trip_postcard() {
        let cmds = vec![
            Command::BuyFloorSpace {
                side: Side::East,
                tiles: 4,
            },
            Command::PlaceRoom {
                kind: RoomKind::Kitchen,
                rect: TileRect::new(16, 5, 4, 5),
                floor: 0,
                doors: vec![Door {
                    side: Side::West,
                    at: 1,
                }],
                windows: vec![Window {
                    side: Side::East,
                    at_mm: 1000,
                    width_mm: 2000,
                }],
            },
            Command::Demolish(DemolishTarget::Equipment(EquipId(3))),
            Command::PlaceEquipment {
                kind: EquipmentKind::Monitor,
                placement: Placement::OnDesk(EquipId(7)),
            },
            Command::Hire {
                candidate: CandidateId(1),
            },
            Command::Fire { staff: StaffId(2) },
            Command::SetPolicy(Policy::Overtime(OvertimePolicy::Crunch)),
        ];
        for c in cmds {
            let bytes = postcard::to_allocvec(&c).unwrap();
            assert_eq!(postcard::from_bytes::<Command>(&bytes).unwrap(), c);
        }
        let s = Input::Server(ServerCommand::Utterance {
            meeting: MeetingId(1),
            seq: 0,
            speaker: StaffId(5),
            chars: 120,
        });
        let bytes = postcard::to_allocvec(&s).unwrap();
        assert_eq!(postcard::from_bytes::<Input>(&bytes).unwrap(), s);
    }
}
