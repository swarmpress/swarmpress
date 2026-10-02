//! Inputs to the simulation. Player [`Command`]s come from the CEO's client;
//! [`ServerCommand`]s are injected by the authoritative server (job results,
//! meeting utterances, nightly site audit). Both are applied in `(step, seq)`
//! order, see [`crate::world::World::enqueue`].
//!
//! Wire encoding is postcard; `protocol` re-exports these types. The browser
//! may also send JSON (`client-wasm`'s `apply_command_json`): serde's default
//! external tagging, ids as `"staff-3"` strings or numbers, and enum leaf
//! values as variant names or their kebab-case slugs (see
//! `crates/client-wasm/README.md`).

use serde::{Deserialize, Serialize};

use crate::building::{Door, RoomKind, Window};
use crate::equipment::EquipmentKind;
use crate::geom::{PosMm, Side, TileRect};
use crate::ids::{CandidateId, EquipId, MeetingId, ProjectId, RoomId, StaffId, TicketId, WorkItemId};
use crate::inbox::{DelegationPolicy, SecretaryTaskKind, TicketOption};
use crate::plan::BriefStub;
use crate::projects::ProjectStatus;

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
    /// One seniority step up: +15% salary, morale boost. Star needs level 5.
    Promote {
        staff: StaffId,
    },
    /// New daily salary, cents. Raises lift morale, cuts hurt.
    SetSalary {
        staff: StaffId,
        cents_per_day: i64,
    },
    /// Staff someone on a project (or change their allocation). A person's
    /// allocations never exceed 100%.
    AssignToProject {
        staff: StaffId,
        project: ProjectId,
        allocation_pct: u8,
    },
    RemoveFromProject {
        staff: StaffId,
        project: ProjectId,
    },
    /// The lead must be on the project's team.
    SetProjectLead {
        project: ProjectId,
        staff: StaffId,
    },
    /// A new publication, created as `Proposed` with a proposal ticket.
    /// Gated by the level's project limit.
    CreateProject {
        slug: String,
        name: String,
        domain: String,
    },
    SetProjectStatus {
        project: ProjectId,
        status: ProjectStatus,
    },
    /// Monthly budget, cents (0 = none). The CFO watches it.
    SetProjectBudget {
        project: ProjectId,
        monthly_cents: i64,
    },
    /// Decide an Inbox ticket.
    AnswerTicket {
        ticket: TicketId,
        option: TicketOption,
    },
    /// Hand a task to the Executive Secretary (needs one).
    Delegate {
        task: SecretaryTaskKind,
    },
    /// What the Secretary may answer on the CEO's behalf.
    SetDelegation {
        policy: DelegationPolicy,
    },
    /// Small morale boost; at most [`crate::world::PRAISES_PER_DAY`] a day.
    Praise {
        staff: StaffId,
    },
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
    /// A requested job ([`crate::plan::Effect::RequestJob`]) finished.
    JobCompleted { job_id: u64, digest: JobDigest },
    /// A standup's outcome: the briefs it agreed on become work items.
    /// `job_id` is the standup's job.
    MeetingOutcome { job_id: u64, briefs: Vec<BriefStub> },
    /// The deploy carrying a merged work item is live.
    DeployLanded { work_item: WorkItemId },
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
    /// One day of first-party analytics for a project (organization.md §6a,
    /// ADR-0032). Integers only; the same for every replica.
    AnalyticsSignals {
        project: ProjectId,
        day: u32,
        sessions: u32,
        visitors: u32,
        pageviews: u32,
        /// Engaged sessions, permille (0..=1000).
        engagement_pm: u16,
        /// Digest of the day's top-pages table (the table stays server-side).
        top_pages_digest: u64,
    },
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
            Command::Promote { staff: StaffId(1) },
            Command::SetSalary {
                staff: StaffId(1),
                cents_per_day: 15_000,
            },
            Command::AssignToProject {
                staff: StaffId(1),
                project: ProjectId(1),
                allocation_pct: 50,
            },
            Command::RemoveFromProject {
                staff: StaffId(1),
                project: ProjectId(1),
            },
            Command::SetProjectLead {
                project: ProjectId(1),
                staff: StaffId(4),
            },
            Command::CreateProject {
                slug: "amalfi".into(),
                name: "Amalfi".into(),
                domain: "amalfi.travel".into(),
            },
            Command::SetProjectStatus {
                project: ProjectId(2),
                status: ProjectStatus::Active,
            },
            Command::SetProjectBudget {
                project: ProjectId(1),
                monthly_cents: 6_000_000,
            },
            Command::AnswerTicket {
                ticket: TicketId(3),
                option: TicketOption::CutScope,
            },
            Command::Delegate {
                task: SecretaryTaskKind::ScheduleMeeting {
                    attendees: vec![StaffId(1), StaffId(2)],
                    project: Some(ProjectId(1)),
                },
            },
            Command::SetDelegation {
                policy: DelegationPolicy::Low,
            },
            Command::Praise { staff: StaffId(2) },
        ];
        for c in cmds {
            let bytes = postcard::to_allocvec(&c).unwrap();
            assert_eq!(postcard::from_bytes::<Command>(&bytes).unwrap(), c);
            let json = serde_json::to_string(&c).unwrap();
            assert_eq!(serde_json::from_str::<Command>(&json).unwrap(), c, "{json}");
        }
        let s = Input::Server(ServerCommand::Utterance {
            meeting: MeetingId(1),
            seq: 0,
            speaker: StaffId(5),
            chars: 120,
        });
        let bytes = postcard::to_allocvec(&s).unwrap();
        assert_eq!(postcard::from_bytes::<Input>(&bytes).unwrap(), s);
        let a = Input::Server(ServerCommand::AnalyticsSignals {
            project: ProjectId(1),
            day: 3,
            sessions: 1_200,
            visitors: 900,
            pageviews: 3_400,
            engagement_pm: 610,
            top_pages_digest: 0xfeed,
        });
        let bytes = postcard::to_allocvec(&a).unwrap();
        assert_eq!(postcard::from_bytes::<Input>(&bytes).unwrap(), a);
    }

    #[test]
    fn json_commands_use_external_tagging_and_slugs() {
        let c: Command =
            serde_json::from_str(r#"{"AnswerTicket":{"ticket":"ticket-3","option":"cut-scope"}}"#)
                .unwrap();
        assert_eq!(
            c,
            Command::AnswerTicket {
                ticket: TicketId(3),
                option: TicketOption::CutScope
            }
        );
        let c: Command = serde_json::from_str(
            r#"{"Delegate":{"task":{"ArrangeHiring":{"role":"photographer","project":"project-1"}}}}"#,
        )
        .unwrap();
        assert_eq!(
            c,
            Command::Delegate {
                task: SecretaryTaskKind::ArrangeHiring {
                    role: crate::roles::Role::Photographer,
                    project: Some(ProjectId(1))
                }
            }
        );
        let c: Command = serde_json::from_str(r#"{"Delegate":{"task":"TriageInbox"}}"#).unwrap();
        assert_eq!(
            c,
            Command::Delegate {
                task: SecretaryTaskKind::TriageInbox
            }
        );
        let c: Command = serde_json::from_str(r#"{"Fire":{"staff":6}}"#).unwrap();
        assert_eq!(c, Command::Fire { staff: StaffId(6) });
    }
}
