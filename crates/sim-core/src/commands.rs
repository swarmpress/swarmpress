//! Inputs to the simulation. Player [`Command`]s come from the CEO's client;
//! [`ServerCommand`]s are injected by the authoritative server (job results
//! and failures, deploy notices, meeting utterances, nightly site audit). Both are applied in `(step, seq)`
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
use crate::ids::{
    CandidateId, EquipId, MeetingId, ObjectId, ProjectId, RoomId, StaffId, TicketId, TownItemId,
    WorkItemId,
};
use crate::inbox::{DelegationPolicy, SecretaryTaskKind, TicketOption};
use crate::interior::PlannedEquipment;
use crate::objects::ObjectSummary;
use crate::plan::{BriefStub, PlannedStub, WorkItemKind, WorkItemStatus, WorkPriority};
use crate::projects::ProjectStatus;
use crate::structure::ToolStub;
use crate::town::TownKind;

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
    /// The CEO changes an open work item in the plan (publishing-plan.md §6,
    /// ADR-0069): its priority, the editor of an item not started yet, its
    /// planned due day, or cancels it. Approving stays the publish gate's.
    UpdateWorkItem {
        item: WorkItemId,
        update: WorkItemUpdate,
    },
    /// The CEO asks for a change to the site's structure, a tool or the
    /// theme (ADR-0072): a structural work item whose Draft its architect
    /// starts at once. The request's words are store text under `brief_ref`.
    Commission {
        project: ProjectId,
        kind: WorkItemKind,
        brief_ref: u64,
    },
    /// The CEO runs an installed tool now (ADR-0072).
    RunTool {
        tool_ref: u64,
    },
    /// Move (and turn) a placed item (ADR-0087 decision 2). It keeps its id
    /// and its desk assignment; the items on a moved desk move with it.
    MoveEquipment {
        equipment: EquipId,
        placement: Placement,
    },
    /// Place a tree, a street lamp or a bench in the town (ADR-0087
    /// decision 4). The sections' houses are never placed.
    PlaceTownItem {
        kind: TownKind,
        pos: PosMm,
        rot: u8,
    },
    /// Move (and turn) any town item, houses included.
    MoveTownItem {
        item: TownItemId,
        pos: PosMm,
        rot: u8,
    },
    /// Remove a tree, a street lamp or a bench. Houses stay.
    RemoveTownItem {
        item: TownItemId,
    },
    /// The CEO asks the office designer to furnish a room (ADR-0087
    /// decision 6): an `Interior` work item whose Draft the designer starts
    /// at once. The request's words and the brief are store text under
    /// `brief_ref`.
    CommissionInterior {
        room: RoomId,
        brief_ref: u64,
    },
    /// Place one of the player's own kit designs in a room (ADR-0065 §4,
    /// ADR-0087 decision 7): the design's hash (64 lowercase hex characters,
    /// a reference, not text) and its compiled summary. Bricks never enter
    /// the sim; see [`crate::objects`].
    PlaceObject {
        design: String,
        pos: PosMm,
        rot: u8,
        summary: ObjectSummary,
    },
    /// Move (and turn) a placed object; it keeps its id.
    MoveObject {
        object: ObjectId,
        pos: PosMm,
        rot: u8,
    },
    /// Take a placed object away (no refund).
    RemoveObject {
        object: ObjectId,
    },
    /// Place a desk-top design (`mount` `Surface`) on a built-in desk
    /// (ADR-0088 decision 3): it takes the desk's screen slot when it has a
    /// screen, its lamp slot otherwise, and moves and goes with the desk.
    PlaceObjectOnDesk {
        design: String,
        desk: EquipId,
        summary: ObjectSummary,
    },
}

/// What [`Command::UpdateWorkItem`] changes.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum WorkItemUpdate {
    Priority(WorkPriority),
    /// The editor who reviews and owns it; only before it starts.
    Owner(StaffId),
    /// The day it should be ready; the planned publish day is the day after.
    DueDay(u32),
    /// Only `Cancelled`: the sim's state machine owns every other status.
    Status(WorkItemStatus),
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
    /// The weekly editorial board on or off (ADR-0069, default off).
    EditorialBoard(bool),
    /// The analytics loop's jobs on or off (ADR-0071, default off).
    Analytics(bool),
    /// Promotion copy when a page goes live, on or off (ADR-0073, default off).
    Distribution(bool),
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

/// Who decides that an approved article is published (ADR-0059). After a
/// review at or above the quality bar:
/// - `ApproveAll` (the default): the item is parked and a `PublishApproval`
///   ticket asks the CEO;
/// - `ApproveMajor`: published without asking only at a score of
///   [`crate::plan::AUTO_PUBLISH_SCORE`] or above with no revision, otherwise
///   the ticket;
/// - `Autonomous`: published without asking.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum AutonomyPolicy {
    #[serde(alias = "approve-all")]
    ApproveAll,
    #[serde(alias = "approve-major")]
    ApproveMajor,
    #[serde(alias = "autonomous")]
    Autonomous,
}

impl AutonomyPolicy {
    pub const fn slug(self) -> &'static str {
        match self {
            AutonomyPolicy::ApproveAll => "approve-all",
            AutonomyPolicy::ApproveMajor => "approve-major",
            AutonomyPolicy::Autonomous => "autonomous",
        }
    }
}

/// Why a job failed ([`ServerCommand::JobFailed`]). A closed set: the
/// executor's error text stays outside the sim.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum JobFailure {
    /// The model failed or produced nothing usable.
    #[serde(alias = "model")]
    Model,
    /// The output did not validate, after the repairs allowed.
    #[serde(alias = "invalid-output")]
    InvalidOutput,
    /// The closed world has no media for the job (rule 5).
    #[serde(alias = "needs-media")]
    NeedsMedia,
    /// The closed world has no page the job must link to (rule 5).
    #[serde(alias = "needs-page")]
    NeedsPage,
    /// The executor's wall-clock limit, or the sim's own standup timeout.
    #[serde(alias = "timeout")]
    Timeout,
    #[serde(alias = "cancelled")]
    Cancelled,
    /// Store, gateway or network.
    #[serde(alias = "infrastructure")]
    Infrastructure,
    /// The release's QA stage blocks it (ADR-0094): deterministic findings outside listed
    /// content gaps after the repairs allowed, or classes no role on the staff can repair.
    #[serde(alias = "quality-gate")]
    QualityGate,
}

impl JobFailure {
    pub const ALL: [JobFailure; 8] = [
        JobFailure::Model,
        JobFailure::InvalidOutput,
        JobFailure::NeedsMedia,
        JobFailure::NeedsPage,
        JobFailure::Timeout,
        JobFailure::Cancelled,
        JobFailure::Infrastructure,
        JobFailure::QualityGate,
    ];

    pub const fn slug(self) -> &'static str {
        match self {
            JobFailure::Model => "model",
            JobFailure::InvalidOutput => "invalid-output",
            JobFailure::NeedsMedia => "needs-media",
            JobFailure::NeedsPage => "needs-page",
            JobFailure::Timeout => "timeout",
            JobFailure::Cancelled => "cancelled",
            JobFailure::Infrastructure => "infrastructure",
            JobFailure::QualityGate => "quality-gate",
        }
    }
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
    /// An editorial board's outcome (ADR-0069): the items it planned, not
    /// started yet. `workstreams` are the opaque text refs of the
    /// workstreams the items name by index. `job_id` is the board's job.
    BoardOutcome {
        job_id: u64,
        workstreams: Vec<u64>,
        items: Vec<PlannedStub>,
    },
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
    /// A line a person says outside a meeting (ADR-0074, the story director):
    /// a bubble of `chars` characters; the text is fetched by `seq`.
    Remark {
        speaker: StaffId,
        #[serde(default)]
        listener: Option<StaffId>,
        seq: u32,
        chars: u32,
    },
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
    /// A requested job failed (ADR-0059). A standup ends and a
    /// `StandupFailed` ticket is raised; a work item is blocked with a
    /// `NeedsMedia`, `NeedsPage` or `Escalation` ticket. The reason is an
    /// enum: no text enters the sim.
    JobFailed { job_id: u64, reason: JobFailure },
    /// The deploy carrying a merged (`Scheduled`) work item failed: the item
    /// is blocked and a `DeployFailed` ticket raised.
    DeployFailed { work_item: WorkItemId },
    /// The site's blueprint at the base head (ADR-0072): its digest and
    /// counts; the blueprint itself stays in the site repo.
    BlueprintChanged {
        /// First 16 bytes of the blueprint's semantic hash.
        hash: [u8; 16],
        page_types: u16,
        slots: u16,
        issues: u16,
    },
    /// The site's installed tools (ADR-0072): exactly these, each with its
    /// schedule and the role of its agent step.
    ToolsChanged { tools: Vec<ToolStub> },
    /// The office designer's room plan (ADR-0087 decision 6): the
    /// placements of an `InteriorDesign` job's plan, in build order, before
    /// its `JobCompleted`. Numbers only: the plan's text stays in the store.
    InteriorPlan {
        job_id: u64,
        items: Vec<PlannedEquipment>,
    },
    /// A design version arrived in the site's design store (ADR-0093,
    /// FEAT-115): the number only; the design stays in the store. A version
    /// newer than any before it starts the web designer's theme.
    DesignReceived { version: u32 },
    /// The QA stage's digest of a site theme's release (ADR-0094, FEAT-116): numbers only, from
    /// the web designer's Draft or its Publish, before the job's own outcome. The report stays in
    /// the content repository.
    SiteQuality {
        job_id: u64,
        quality: crate::site_theme::SiteQualityDigest,
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
            Command::MoveEquipment {
                equipment: EquipId(17),
                placement: Placement::Floor {
                    pos: PosMm::new(4_000, 3_000),
                    rot: 1,
                },
            },
            Command::PlaceTownItem {
                kind: TownKind::Bench,
                pos: PosMm::new(-3_000, -8_000),
                rot: 2,
            },
            Command::MoveTownItem {
                item: TownItemId(3),
                pos: PosMm::new(1_000, -9_000),
                rot: 0,
            },
            Command::RemoveTownItem {
                item: TownItemId(7),
            },
            Command::CommissionInterior {
                room: RoomId(6),
                brief_ref: 12,
            },
            Command::PlaceObject {
                design: "ab".repeat(32),
                pos: PosMm::new(27_000, 9_000),
                rot: 1,
                summary: sample_summary(),
            },
            Command::MoveObject {
                object: ObjectId(2),
                pos: PosMm::new(26_000, 8_000),
                rot: 3,
            },
            Command::RemoveObject {
                object: ObjectId(2),
            },
            Command::PlaceObjectOnDesk {
                design: "cd".repeat(32),
                desk: EquipId(3),
                summary: ObjectSummary {
                    mount: crate::objects::Mount::Surface,
                    workstation: false,
                    seat_at: None,
                    ..sample_summary()
                },
            },
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
        for reason in JobFailure::ALL {
            let f = Input::Server(ServerCommand::JobFailed { job_id: 9, reason });
            let bytes = postcard::to_allocvec(&f).unwrap();
            assert_eq!(postcard::from_bytes::<Input>(&bytes).unwrap(), f);
            // the slug and the variant name both parse
            let by_slug: JobFailure =
                serde_json::from_str(&format!("\"{}\"", reason.slug())).unwrap();
            assert_eq!(by_slug, reason);
            let json = serde_json::to_string(&reason).unwrap();
            assert_eq!(serde_json::from_str::<JobFailure>(&json).unwrap(), reason);
        }
        let d = Input::Server(ServerCommand::DeployFailed {
            work_item: WorkItemId(3),
        });
        let bytes = postcard::to_allocvec(&d).unwrap();
        assert_eq!(postcard::from_bytes::<Input>(&bytes).unwrap(), d);
    }

    fn sample_summary() -> ObjectSummary {
        ObjectSummary {
            footprint: [24, 12],
            height: 34,
            mount: crate::objects::Mount::Floor,
            seats: 0,
            workstation: true,
            seat_at: Some([0, 750]),
            lights: 1,
            storage: 0,
            screens: 1,
            parts: 204,
            cost: 3_199,
        }
    }

    #[test]
    fn object_commands_json() {
        let hash = "0123456789abcdef".repeat(4);
        let c = Command::PlaceObject {
            design: hash.clone(),
            pos: PosMm::new(27_000, 9_000),
            rot: 1,
            summary: sample_summary(),
        };
        let json = format!(
            r#"{{"PlaceObject":{{"design":"{hash}","pos":{{"x":27000,"z":9000}},"rot":1,"summary":{{"footprint":[24,12],"height":34,"mount":"Floor","seats":0,"workstation":true,"seat_at":[0,750],"lights":1,"storage":0,"screens":1,"parts":204,"cost":3199}}}}}}"#
        );
        assert_eq!(serde_json::to_string(&c).unwrap(), json);
        assert_eq!(serde_json::from_str::<Command>(&json).unwrap(), c);
        // JSON written before ADR-0088 has no seat position: it reads as none
        let old = json.replace(r#""seat_at":[0,750],"#, "");
        match serde_json::from_str::<Command>(&old).unwrap() {
            Command::PlaceObject { summary, .. } => assert_eq!(summary.seat_at, None),
            other => panic!("{other:?}"),
        }
        // the kit's kebab-case mount is read too
        let kit = json.replace("\"Floor\"", "\"floor\"");
        assert_eq!(serde_json::from_str::<Command>(&kit).unwrap(), c);
        let c = Command::MoveObject {
            object: ObjectId(1),
            pos: PosMm::new(26_000, 8_000),
            rot: 0,
        };
        let json = r#"{"MoveObject":{"object":"object-1","pos":{"x":26000,"z":8000},"rot":0}}"#;
        assert_eq!(serde_json::to_string(&c).unwrap(), json);
        assert_eq!(serde_json::from_str::<Command>(json).unwrap(), c);
        let c = Command::RemoveObject {
            object: ObjectId(1),
        };
        let json = r#"{"RemoveObject":{"object":"object-1"}}"#;
        assert_eq!(serde_json::to_string(&c).unwrap(), json);
        assert_eq!(serde_json::from_str::<Command>(json).unwrap(), c);
        let c = Command::PlaceObjectOnDesk {
            design: hash.clone(),
            desk: EquipId(3),
            summary: ObjectSummary {
                footprint: [4, 4],
                height: 12,
                mount: crate::objects::Mount::Surface,
                seats: 0,
                workstation: false,
                seat_at: None,
                lights: 0,
                storage: 0,
                screens: 1,
                parts: 9,
                cost: 450,
            },
        };
        let json = format!(
            r#"{{"PlaceObjectOnDesk":{{"design":"{hash}","desk":"equip-3","summary":{{"footprint":[4,4],"height":12,"mount":"Surface","seats":0,"workstation":false,"seat_at":null,"lights":0,"storage":0,"screens":1,"parts":9,"cost":450}}}}}}"#
        );
        assert_eq!(serde_json::to_string(&c).unwrap(), json);
        assert_eq!(serde_json::from_str::<Command>(&json).unwrap(), c);
    }

    #[test]
    fn earlier_commands_keep_their_postcard_tags() {
        // New variants go at the end of the enum: the logged bytes of the
        // earlier ones never change.
        let tag = |c: &Command| postcard::to_allocvec(c).unwrap()[0];
        assert_eq!(
            tag(&Command::CommissionInterior {
                room: RoomId(1),
                brief_ref: 1
            }),
            26
        );
        assert_eq!(
            tag(&Command::RemoveObject {
                object: ObjectId(1)
            }),
            29
        );
        assert_eq!(
            tag(&Command::PlaceObjectOnDesk {
                design: String::new(),
                desk: EquipId(1),
                summary: sample_summary(),
            }),
            30
        );
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
        let c: Command =
            serde_json::from_str(r#"{"AnswerTicket":{"ticket":"ticket-4","option":"send-back"}}"#)
                .unwrap();
        assert_eq!(
            c,
            Command::AnswerTicket {
                ticket: TicketId(4),
                option: TicketOption::SendBack
            }
        );
        let c: Command =
            serde_json::from_str(r#"{"SetPolicy":{"Autonomy":"approve-major"}}"#).unwrap();
        assert_eq!(
            c,
            Command::SetPolicy(Policy::Autonomy(AutonomyPolicy::ApproveMajor))
        );
        // building (ADR-0087)
        let c: Command = serde_json::from_str(
            r#"{"MoveEquipment":{"equipment":"equip-17","placement":{"Floor":{"pos":{"x":4000,"z":3000},"rot":1}}}}"#,
        )
        .unwrap();
        assert_eq!(
            c,
            Command::MoveEquipment {
                equipment: EquipId(17),
                placement: Placement::Floor {
                    pos: PosMm::new(4_000, 3_000),
                    rot: 1
                }
            }
        );
        let c: Command = serde_json::from_str(
            r#"{"MoveEquipment":{"equipment":"equip-20","placement":{"OnDesk":"equip-3"}}}"#,
        )
        .unwrap();
        assert_eq!(
            c,
            Command::MoveEquipment {
                equipment: EquipId(20),
                placement: Placement::OnDesk(EquipId(3))
            }
        );
        let c = Command::PlaceTownItem {
            kind: TownKind::StreetLamp,
            pos: PosMm::new(-3_000, -8_000),
            rot: 0,
        };
        assert_eq!(
            serde_json::to_string(&c).unwrap(),
            r#"{"PlaceTownItem":{"kind":"StreetLamp","pos":{"x":-3000,"z":-8000},"rot":0}}"#
        );
        let c = Command::MoveTownItem {
            item: TownItemId(1),
            pos: PosMm::new(3_000, -10_000),
            rot: 2,
        };
        assert_eq!(
            serde_json::to_string(&c).unwrap(),
            r#"{"MoveTownItem":{"item":"town-1","pos":{"x":3000,"z":-10000},"rot":2}}"#
        );
        let c: Command = serde_json::from_str(r#"{"RemoveTownItem":{"item":"town-14"}}"#).unwrap();
        assert_eq!(
            c,
            Command::RemoveTownItem {
                item: TownItemId(14)
            }
        );
        let s: ServerCommand =
            serde_json::from_str(r#"{"JobFailed":{"job_id":7,"reason":"needs-media"}}"#).unwrap();
        assert_eq!(
            s,
            ServerCommand::JobFailed {
                job_id: 7,
                reason: JobFailure::NeedsMedia
            }
        );
        let s: ServerCommand =
            serde_json::from_str(r#"{"DeployFailed":{"work_item":"work-item-2"}}"#).unwrap();
        assert_eq!(
            s,
            ServerCommand::DeployFailed {
                work_item: WorkItemId(2)
            }
        );
    }
}
