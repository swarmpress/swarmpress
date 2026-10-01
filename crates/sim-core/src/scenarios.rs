//! Canned worlds and scripts.
//!
//! [`demo_office`] is the cinqueterre.travel starting company
//! (docs/game-design/organization.md §10): the player is the CEO (not a
//! `Staff` entity, but with an office), plus 13 people in seven departments
//! and one active project, `cinqueterre-travel`.
//!
//! The building is one floor on a 24×16 m lot, entrance on the south side:
//!
//! ```text
//!   x: 0       8     12    16    20    24
//! z 0 ┌───────┬─────┬─────┬─────┬─────┐
//!     │Newsrm │Edit.│Kitch│ CEO │Finan│  north row (windows north;
//!     │3 desks│ off.│ en  │ off.│ ce  │  newsroom west, finance east)
//!     │+3 spar│     │     │Paolo│Elena│
//!   6 ├───────┴─────┴─────┴─────┴─────┤  corridor (z 6..8)
//!   8 ├─────┬────┬──┬─────┬───┬──────┤
//!     │Meet-│Pho-│  │Stra-│De-│ SEO  │  south row (windows south;
//!     │ ing │ to │co│tegy │sig│ lab  │  meeting west, SEO east)
//!     │room │stu-│rr│room │ n │──────┤
//!     │     │dio │  │     │   │Server│  server room opens into the SEO lab
//!  16 └─────┴────┴▲─┴─────┴───┴──────┘
//!                 entrance (10,15) south
//! ```
//!
//! Room choices: the CFO works in a new `finance-office` kind; Strategy has
//! its own `strategy-room` kind (strategist and data-scientist desks around a
//! planning table), which also serves as the second meeting room when two
//! project standups overlap. The CEO office has the Secretary's desk (the
//! front door of the Inbox) and no desk for the CEO, who is the player.
//!
//! cinqueterre.travel starts as a legacy publication at company level 3
//! (rooms-and-progression.md); its building predates the progression gates,
//! so the scenario builds at level 4 (design studio) and then sets level 3.
//!
//! The demo is built through [`World::apply`] (construction and staffing are
//! validated and booked); only people ([`World::add_staff`]) and the imported
//! project ([`World::add_project`]) are inserted directly.

use crate::building::{Building, Door, Entrance, RoomKind, Window};
use crate::clock::{hm, SimConfig};
use crate::commands::{
    Command, DemolishTarget, Input, OvertimePolicy, Placement, Policy, ServerCommand, SiteSignals,
};
use crate::economy::Company;
use crate::equipment::EquipmentKind;
use crate::geom::{PosMm, Side, Tile, TileRect};
use crate::ids::{CandidateId, EquipId, MeetingId, ProjectId, RoomId, StaffId, TicketId};
use crate::inbox::{DelegationPolicy, FollowUpTopic, SecretaryTaskKind, TicketOption};
use crate::projects::ProjectStatus;
use crate::staff::{persona, persona_by_key, Schedule, Traits};
use crate::world::World;

/// Starting cash of the cinqueterre.travel company before construction,
/// cents (€300 000).
pub const DEMO_START_CASH: i64 = 30_000_000;
/// Company level of the demo: a legacy publication (level 3).
pub const DEMO_LEVEL: u8 = 3;
/// Monthly budget of the cinqueterre.travel project, cents (€80 000; the
/// team costs about €71 000 a month with overtime and its share of rent and
/// upkeep).
pub const DEMO_BUDGET_CENTS: i64 = 8_000_000;
/// The demo's project.
pub const DEMO_PROJECT: ProjectId = ProjectId(1);

/// Steps the golden determinism test runs.
pub const GOLDEN_STEPS: u64 = 50_000;
/// Seed of the golden determinism test.
pub const GOLDEN_SEED: u64 = 42;

/// `(persona slug, room kind, desk position, rotation, (arrive, leave,
/// lunch), traits, allocation % on cinqueterre.travel)`
type DemoPerson = (&'static str, PosMm, u8, (u16, u16, u16), Traits, u8);

fn t(
    rigor: u16,
    speed: u16,
    creativity: u16,
    sociability: u16,
    resilience: u16,
    ambition: u16,
) -> Traits {
    Traits {
        rigor,
        speed,
        creativity,
        sociability,
        resilience,
        ambition,
    }
}

/// The staff in persona-id order (so `staff-N` plays persona `N`).
fn demo_people() -> [DemoPerson; 13] {
    [
        (
            "giulia",
            PosMm::new(1_500, 1_500),
            0,
            (hm(8, 45), hm(18, 30), hm(12, 30)),
            t(650, 550, 850, 750, 600, 600),
            100,
        ),
        (
            "isabella",
            PosMm::new(4_000, 1_500),
            0,
            (hm(8, 10), hm(18, 0), hm(12, 30)),
            t(600, 750, 800, 700, 650, 700),
            100,
        ),
        (
            "lorenzo",
            PosMm::new(6_500, 1_500),
            0,
            (hm(8, 40), hm(17, 30), hm(12, 45)),
            t(850, 450, 700, 500, 600, 500),
            100,
        ),
        (
            "sophia",
            PosMm::new(9_000, 2_000),
            0,
            (hm(8, 30), hm(19, 30), hm(13, 0)),
            t(700, 600, 600, 800, 700, 650),
            100,
        ),
        (
            "marco",
            PosMm::new(11_000, 2_000),
            0,
            (hm(8, 0), hm(23, 15), hm(13, 0)),
            t(900, 600, 500, 550, 800, 750),
            100,
        ),
        (
            "francesca",
            PosMm::new(8_000, 9_500),
            0,
            (hm(8, 35), hm(18, 0), hm(12, 30)),
            t(650, 600, 900, 650, 600, 600),
            100,
        ),
        (
            "elena",
            PosMm::new(21_500, 2_000),
            0,
            (hm(8, 20), hm(18, 0), hm(12, 30)),
            t(950, 650, 450, 550, 800, 700),
            0,
        ),
        (
            "paolo",
            PosMm::new(17_000, 4_000),
            0,
            (hm(8, 10), hm(17, 30), hm(12, 15)),
            t(850, 750, 450, 850, 700, 450),
            0,
        ),
        (
            "chiara",
            PosMm::new(13_000, 9_500),
            0,
            (hm(8, 30), hm(18, 0), hm(12, 45)),
            t(750, 600, 850, 700, 650, 750),
            0,
        ),
        (
            "luca",
            PosMm::new(17_500, 9_500),
            0,
            (hm(8, 50), hm(18, 30), hm(13, 0)),
            t(750, 700, 700, 500, 650, 650),
            100,
        ),
        (
            "davide",
            PosMm::new(21_500, 13_500),
            0,
            (hm(8, 25), hm(17, 30), hm(12, 30)),
            t(900, 650, 450, 400, 800, 550),
            100,
        ),
        (
            "alessia",
            PosMm::new(21_500, 9_500),
            0,
            (hm(8, 45), hm(18, 0), hm(12, 30)),
            t(700, 700, 650, 750, 600, 700),
            100,
        ),
        (
            "matteo",
            PosMm::new(15_000, 9_500),
            0,
            (hm(8, 40), hm(18, 0), hm(13, 0)),
            t(950, 600, 600, 450, 700, 650),
            0,
        ),
    ]
}

/// Spare newsroom desks for hires.
const SPARE_DESKS: [PosMm; 3] = [
    PosMm::new(1_500, 4_000),
    PosMm::new(4_000, 4_000),
    PosMm::new(6_500, 4_000),
];

fn window(side: Side, at_mm: i32, width_mm: i32) -> Window {
    Window {
        side,
        at_mm,
        width_mm,
    }
}

fn door(side: Side, at: i32) -> Door {
    Door { side, at }
}

/// `(kind, rect, doors, windows)` of every room, in build order.
fn demo_rooms() -> Vec<(RoomKind, TileRect, Vec<Door>, Vec<Window>)> {
    use Side::*;
    vec![
        (
            RoomKind::Newsroom,
            TileRect::new(0, 0, 8, 6),
            vec![door(South, 3)],
            vec![
                window(North, 1_000, 2_500),
                window(North, 4_500, 2_500),
                window(West, 1_500, 3_000),
            ],
        ),
        (
            RoomKind::EditorOffice,
            TileRect::new(8, 0, 4, 6),
            vec![door(South, 1)],
            vec![window(North, 1_000, 2_000)],
        ),
        (
            RoomKind::Kitchen,
            TileRect::new(12, 0, 4, 6),
            vec![door(South, 1)],
            vec![window(North, 1_000, 2_000)],
        ),
        (
            RoomKind::CeoOffice,
            TileRect::new(16, 0, 4, 6),
            vec![door(South, 1)],
            vec![window(North, 1_000, 2_000)],
        ),
        (
            RoomKind::FinanceOffice,
            TileRect::new(20, 0, 4, 6),
            vec![door(South, 1)],
            vec![window(North, 1_000, 2_000), window(East, 1_500, 3_000)],
        ),
        (
            RoomKind::MeetingRoom,
            TileRect::new(0, 8, 6, 8),
            vec![door(North, 3)],
            vec![window(West, 2_000, 3_000), window(South, 1_500, 3_000)],
        ),
        (
            RoomKind::PhotoStudio,
            TileRect::new(6, 8, 4, 8),
            vec![door(North, 2)],
            vec![window(South, 1_000, 2_000)],
        ),
        (
            RoomKind::StrategyRoom,
            TileRect::new(12, 8, 4, 8),
            vec![door(North, 1), door(West, 2)],
            vec![window(South, 1_000, 2_000)],
        ),
        (
            RoomKind::DesignStudio,
            TileRect::new(16, 8, 3, 8),
            vec![door(North, 1)],
            vec![window(South, 500, 2_000)],
        ),
        (
            RoomKind::SeoLab,
            TileRect::new(19, 8, 5, 4),
            vec![door(North, 2)],
            vec![window(East, 1_000, 2_000)],
        ),
        (
            RoomKind::ServerRoom,
            TileRect::new(19, 12, 5, 4),
            vec![door(North, 2)],
            vec![],
        ),
    ]
}

/// Props: `(kind, position)`.
fn demo_props() -> [(EquipmentKind, PosMm); 8] {
    [
        (EquipmentKind::CoffeeMachine, PosMm::new(15_300, 700)),
        (EquipmentKind::Plant, PosMm::new(19_400, 600)),
        (EquipmentKind::ArchiveShelf, PosMm::new(16_800, 800)),
        (EquipmentKind::Plant, PosMm::new(23_400, 5_400)),
        (EquipmentKind::Whiteboard, PosMm::new(3_000, 8_600)),
        (EquipmentKind::CameraRig, PosMm::new(8_000, 13_500)),
        (EquipmentKind::Whiteboard, PosMm::new(14_000, 15_300)),
        (EquipmentKind::MoodBoardWall, PosMm::new(17_500, 14_500)),
    ]
}

/// The demo office with the default clock (20 real minutes per day, 07:00 start).
pub fn demo_office(seed: u64) -> World {
    demo_office_with_config(seed, SimConfig::default())
}

/// The cinqueterre.travel starting company with a custom clock.
pub fn demo_office_with_config(seed: u64, config: SimConfig) -> World {
    let building = Building::new(
        TileRect::new(0, 0, 24, 16),
        Entrance {
            tile: Tile::new(10, 15),
            side: Side::South,
        },
    );
    // Built at level 4 (design studio), then set to the legacy level 3.
    let mut w = World::with_parts(seed, config, building, Company::new(DEMO_START_CASH, 4));
    let must = |w: &mut World, c: Command| {
        w.apply(c).expect("demo command is valid");
    };
    for (kind, rect, doors, windows) in demo_rooms() {
        must(
            &mut w,
            Command::PlaceRoom {
                kind,
                rect,
                floor: 0,
                doors,
                windows,
            },
        );
    }
    let desk_at = |w: &mut World, pos: PosMm, rot: u8, screen: EquipmentKind| -> EquipId {
        let desk = w.ids.peek_equip();
        must(
            w,
            Command::PlaceEquipment {
                kind: EquipmentKind::Desk,
                placement: Placement::Floor { pos, rot },
            },
        );
        for kind in [screen, EquipmentKind::DeskLamp] {
            must(
                w,
                Command::PlaceEquipment {
                    kind,
                    placement: Placement::OnDesk(desk),
                },
            );
        }
        desk
    };
    let project = w.add_project(
        "cinqueterre-travel",
        "cinqueterre.travel",
        "cinqueterre.travel",
        ProjectStatus::Active,
    );
    let mut staffed = Vec::new();
    for (key, pos, rot, (arrive, leave, lunch), traits, allocation) in demo_people() {
        let pid = persona_by_key(key).expect("demo persona exists");
        let p = persona(pid).expect("demo persona exists");
        let screen = if p.role == crate::roles::Role::WebDeveloper {
            EquipmentKind::ColorMonitor
        } else {
            EquipmentKind::Monitor
        };
        let desk = desk_at(&mut w, pos, rot, screen);
        let id = w.add_staff(
            pid,
            p.role,
            p.seniority,
            traits,
            p.salary_cents_per_day(),
            Schedule::new(arrive, leave, lunch),
            Some(desk),
        );
        if allocation > 0 {
            staffed.push((id, allocation));
        }
    }
    for pos in SPARE_DESKS {
        desk_at(&mut w, pos, 0, EquipmentKind::Monitor);
    }
    for (kind, pos) in demo_props() {
        must(
            &mut w,
            Command::PlaceEquipment {
                kind,
                placement: Placement::Floor { pos, rot: 0 },
            },
        );
    }
    for (staff, allocation_pct) in staffed {
        must(
            &mut w,
            Command::AssignToProject {
                staff,
                project,
                allocation_pct,
            },
        );
    }
    let sophia = StaffId(4);
    must(
        &mut w,
        Command::SetProjectLead {
            project,
            staff: sophia,
        },
    );
    must(
        &mut w,
        Command::SetProjectBudget {
            project,
            monthly_cents: DEMO_BUDGET_CENTS,
        },
    );
    must(
        &mut w,
        Command::SetDelegation {
            policy: DelegationPolicy::Low,
        },
    );
    w.company.level = DEMO_LEVEL;
    // Shortlist without the people already on staff.
    w.refresh_candidates();
    w
}

/// The fixed command log of the golden determinism test, as
/// `(step, input)`. Each entry is enqueued at `(step, 0)`.
///
/// Covers: budgets, buying land, building an archive with a shelf, hiring
/// (CFO affordability ticket, auto-answered under Low delegation), staffing
/// the hire, praise, promotion, a salary change, proposing a second project,
/// delegated tasks (draft reply, meeting, follow-up), standup utterances,
/// site and analytics signals, overtime policy changes, firing the
/// photographer mid-shift (missing-role ticket) and answering it, activating
/// the second project and splitting a writer across both, placing and
/// removing a plant, demolishing the archive at night and widening the
/// delegation.
pub fn golden_script() -> Vec<(u64, Input)> {
    let p = |c: Command| Input::Player(c);
    let s = |c: ServerCommand| Input::Server(c);
    let amalfi = ProjectId(2);
    vec![
        (
            100,
            p(Command::SetProjectBudget {
                project: DEMO_PROJECT,
                monthly_cents: 8_500_000,
            }),
        ),
        (
            200,
            p(Command::BuyFloorSpace {
                side: Side::East,
                tiles: 4,
            }),
        ),
        (
            300,
            p(Command::PlaceRoom {
                kind: RoomKind::Archive,
                rect: TileRect::new(24, 4, 4, 4),
                floor: 0,
                doors: vec![Door {
                    side: Side::West,
                    at: 2,
                }],
                windows: vec![Window {
                    side: Side::East,
                    at_mm: 1_000,
                    width_mm: 2_000,
                }],
            }),
        ),
        (
            400,
            p(Command::PlaceEquipment {
                kind: EquipmentKind::ArchiveShelf,
                placement: Placement::Floor {
                    pos: PosMm::new(26_000, 6_000),
                    rot: 0,
                },
            }),
        ),
        (
            500,
            p(Command::Hire {
                candidate: CandidateId(6),
            }),
        ),
        (
            600,
            p(Command::AssignToProject {
                staff: StaffId(14),
                project: DEMO_PROJECT,
                allocation_pct: 50,
            }),
        ),
        (700, p(Command::Praise { staff: StaffId(1) })),
        (800, p(Command::Promote { staff: StaffId(12) })),
        (
            900,
            p(Command::SetSalary {
                staff: StaffId(8),
                cents_per_day: 12_000,
            }),
        ),
        (
            1_000,
            p(Command::CreateProject {
                slug: "amalfi-dispatch".into(),
                name: "Amalfi Dispatch".into(),
                domain: "amalfi.travel".into(),
            }),
        ),
        (
            1_100,
            p(Command::Delegate {
                task: SecretaryTaskKind::DraftReply {
                    ticket: TicketId(2),
                },
            }),
        ),
        (
            1_200,
            p(Command::Delegate {
                task: SecretaryTaskKind::ScheduleMeeting {
                    attendees: vec![StaffId(1), StaffId(2), StaffId(3)],
                    project: Some(DEMO_PROJECT),
                },
            }),
        ),
        (
            1_300,
            p(Command::Delegate {
                task: SecretaryTaskKind::FollowUp {
                    staff: StaffId(3),
                    topic: FollowUpTopic::Morale,
                },
            }),
        ),
        // day 1, 09:12: standup turns
        (
            13_100,
            s(ServerCommand::Utterance {
                meeting: MeetingId(4),
                seq: 0,
                speaker: StaffId(4),
                chars: 140,
            }),
        ),
        (
            13_140,
            s(ServerCommand::Utterance {
                meeting: MeetingId(4),
                seq: 1,
                speaker: StaffId(9),
                chars: 80,
            }),
        ),
        // day 1, 11:00: the CEO approves the proposal directly
        (
            15_000,
            p(Command::SetProjectStatus {
                project: amalfi,
                status: ProjectStatus::Active,
            }),
        ),
        // day 1, 23:00
        (
            20_000,
            p(Command::SetPolicy(Policy::Overtime(OvertimePolicy::Crunch))),
        ),
        // day 2, 07:00
        (
            24_000,
            s(ServerCommand::SiteSignals(SiteSignals {
                live_pages: 61,
                languages: 4,
                broken_links: 3,
                media_count: 338,
                lighthouse_performance: 91,
                lighthouse_accessibility: 96,
                lighthouse_seo: 100,
            })),
        ),
        (
            24_100,
            s(ServerCommand::AnalyticsSignals {
                project: DEMO_PROJECT,
                day: 1,
                sessions: 1_840,
                visitors: 1_420,
                pageviews: 4_610,
                engagement_pm: 640,
                top_pages_digest: 0x5eed_cafe,
            }),
        ),
        // day 2, 19:00
        (
            30_000,
            p(Command::SetPolicy(Policy::Overtime(OvertimePolicy::Allow))),
        ),
        // day 3, 10:00: Francesca (the only photographer) walks out mid-shift
        (37_500, p(Command::Fire { staff: StaffId(6) })),
        (
            37_600,
            p(Command::AnswerTicket {
                ticket: TicketId(8),
                option: TicketOption::ArrangeHiring,
            }),
        ),
        (
            38_100,
            p(Command::AssignToProject {
                staff: StaffId(2),
                project: DEMO_PROJECT,
                allocation_pct: 60,
            }),
        ),
        (
            38_200,
            p(Command::AssignToProject {
                staff: StaffId(2),
                project: amalfi,
                allocation_pct: 40,
            }),
        ),
        (
            39_000,
            p(Command::PlaceEquipment {
                kind: EquipmentKind::Plant,
                placement: Placement::Floor {
                    pos: PosMm::new(12_600, 15_400),
                    rot: 0,
                },
            }),
        ),
        (
            40_000,
            p(Command::Demolish(DemolishTarget::Equipment(EquipId(75)))),
        ),
        // day 4, 03:00: nobody in; the archive goes
        (
            46_000,
            p(Command::Demolish(DemolishTarget::Room(RoomId(12)))),
        ),
        (
            48_000,
            p(Command::SetDelegation {
                policy: DelegationPolicy::LowAndMedium,
            }),
        ),
    ]
}

/// Result of each scripted input, with the step it was applied at.
pub type ScriptResults = Vec<(u64, Result<(), crate::Reject>)>;

/// Builds the demo office, enqueues [`golden_script`] and runs `steps` steps.
/// Returns the world and every queued input's result in order.
pub fn run_golden(steps: u64) -> (World, ScriptResults) {
    let mut w = demo_office(GOLDEN_SEED);
    for (step, input) in golden_script() {
        w.enqueue(step, 0, input).expect("script is ordered");
    }
    let mut results = Vec::new();
    for _ in 0..steps {
        let at = w.step;
        for (_, r) in w.step().applied {
            results.push((at, r));
        }
    }
    (w, results)
}
