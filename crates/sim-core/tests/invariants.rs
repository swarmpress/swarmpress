//! Property tests: random command sequences against the demo office.
//!
//! Invariants checked after every step and every command:
//! - nothing panics (including decoding arbitrary bytes as commands)
//! - cash is conserved: `opening_cash + Σ ledger totals == cash`, and a
//!   settlement step changes cash by exactly the settlement's `net`
//! - no person on site is ever inside a wall
//! - every command either validates and applies, or is rejected by both
//!   `validate` and `apply` with the same reason, leaving the world untouched
//! - nobody ever fails to find a path (connectivity is validated)
//! - organization: allocations never exceed 100%; the executive office only
//!   names active people in those roles; project leads are on their team;
//!   per-project ledgers plus overhead sum to the company ledger; every open
//!   ticket is still before its deadline (so tickets always resolve by it);
//!   the Secretary never answers a High or over-threshold ticket, and never
//!   the publish gate, whose default never publishes
//! - the plan (ADR-0059): open items per project stay within the
//!   work-in-progress limit; a writer has at most one active draft; an item
//!   parked at the publish gate has no pending job

use proptest::prelude::*;
use proptest::sample::select;

use sim_core::building::{Door, RoomKind, Window};
use sim_core::commands::{
    AutonomyPolicy, Command, DemolishTarget, Input, JobDigest, JobFailure, OvertimePolicy,
    Placement, Policy, ServerCommand, SiteSignals,
};
use sim_core::economy::LedgerKind;
use sim_core::equipment::EquipmentKind;
use sim_core::finance::CostBreakdown;
use sim_core::geom::{PosMm, Side, TileRect};
use sim_core::ids::{
    CandidateId, EquipId, MeetingId, ProjectId, RoomId, StaffId, TicketId, WorkItemId,
};
use sim_core::inbox::{
    DelegationPolicy, FollowUpTopic, Priority, ResolvedBy, SecretaryTaskKind, TicketKind,
    TicketOption,
};
use sim_core::plan::{
    BriefStub, JobKind, PhaseKind, PhaseState, PlannedStub, WorkItemKind, WorkItemStatus,
    WorkPriority, MAX_PLANNED, MAX_REVISIONS, WIP_LIMIT,
};
use sim_core::projects::ProjectStatus;
use sim_core::roles::Role;
use sim_core::scenarios::demo_office_with_config;
use sim_core::staff::Spot;
use sim_core::{validate_input, SimConfig, World};

fn side() -> impl Strategy<Value = Side> {
    select(Side::ALL.to_vec())
}

fn rect() -> impl Strategy<Value = TileRect> {
    prop_oneof![
        8 => (-2i32..22, -2i32..14, 1i32..12, 1i32..12)
            .prop_map(|(x, z, w, d)| TileRect::new(x, z, w, d)),
        1 => (any::<i32>(), any::<i32>(), any::<i32>(), any::<i32>())
            .prop_map(|(x, z, w, d)| TileRect::new(x, z, w, d)),
    ]
}

fn pos() -> impl Strategy<Value = PosMm> {
    prop_oneof![
        8 => (-1_000i32..22_000, -1_000i32..12_000).prop_map(|(x, z)| PosMm::new(x, z)),
        1 => (any::<i32>(), any::<i32>()).prop_map(|(x, z)| PosMm::new(x, z)),
    ]
}

fn placement() -> impl Strategy<Value = Placement> {
    prop_oneof![
        (pos(), 0u8..5).prop_map(|(pos, rot)| Placement::Floor { pos, rot }),
        (1u32..40).prop_map(|d| Placement::OnDesk(EquipId(d))),
    ]
}

fn policy() -> impl Strategy<Value = Policy> {
    prop_oneof![
        select(vec![
            OvertimePolicy::Never,
            OvertimePolicy::Allow,
            OvertimePolicy::Crunch
        ])
        .prop_map(Policy::Overtime),
        select(vec![
            AutonomyPolicy::ApproveAll,
            AutonomyPolicy::ApproveMajor,
            AutonomyPolicy::Autonomous
        ])
        .prop_map(Policy::Autonomy),
        (0u8..14).prop_map(Policy::QualityBar),
        any::<bool>().prop_map(Policy::EditorialBoard),
        any::<bool>().prop_map(Policy::Analytics),
        any::<bool>().prop_map(Policy::Distribution),
    ]
}

fn command() -> impl Strategy<Value = Command> {
    prop_oneof![
        1 => (side(), 0u8..10).prop_map(|(side, tiles)| Command::BuyFloorSpace { side, tiles }),
        1 => (
            select(RoomKind::ALL.to_vec()),
            rect(),
            0u8..2,
            prop::collection::vec((side(), -1i32..12).prop_map(|(side, at)| Door { side, at }), 0..4),
            prop::collection::vec(
                (side(), -500i32..8_000, 0i32..4_000)
                    .prop_map(|(side, at_mm, width_mm)| Window { side, at_mm, width_mm }),
                0..3
            ),
        )
            .prop_map(|(kind, rect, floor, doors, windows)| Command::PlaceRoom {
                kind,
                rect,
                floor,
                doors,
                windows
            }),
        1 => (1u32..8).prop_map(|r| Command::Demolish(DemolishTarget::Room(RoomId(r)))),
        1 => (1u32..40).prop_map(|e| Command::Demolish(DemolishTarget::Equipment(EquipId(e)))),
        3 => (select(EquipmentKind::ALL.to_vec()), placement())
            .prop_map(|(kind, placement)| Command::PlaceEquipment { kind, placement }),
        1 => (1u32..20).prop_map(|c| Command::Hire {
            candidate: CandidateId(c)
        }),
        1 => (1u32..10).prop_map(|s| Command::Fire { staff: StaffId(s) }),
        1 => policy().prop_map(Command::SetPolicy),
        3 => org_command(),
    ]
}

fn staff_id() -> impl Strategy<Value = StaffId> {
    (1u32..18).prop_map(StaffId)
}

fn project_id() -> impl Strategy<Value = ProjectId> {
    (1u32..4).prop_map(ProjectId)
}

fn ticket_option() -> impl Strategy<Value = TicketOption> {
    select(vec![
        TicketOption::ApproveOverrun,
        TicketOption::CutScope,
        TicketOption::Acknowledge,
        TicketOption::CutCosts,
        TicketOption::TakeLoan,
        TicketOption::ArrangeHiring,
        TicketOption::Ignore,
        TicketOption::Approve,
        TicketOption::Reject,
        TicketOption::Retry,
        TicketOption::Kill,
        TicketOption::Publish,
        TicketOption::SendBack,
        TicketOption::Defer,
        TicketOption::Skip,
    ])
}

fn delegate_task() -> impl Strategy<Value = SecretaryTaskKind> {
    prop_oneof![
        Just(SecretaryTaskKind::TriageInbox),
        (
            prop::collection::vec(staff_id(), 0..5),
            prop::option::of(project_id())
        )
            .prop_map(|(attendees, project)| SecretaryTaskKind::ScheduleMeeting {
                attendees,
                project
            }),
        prop::option::of(project_id())
            .prop_map(|project| SecretaryTaskKind::PrepareBriefing { project }),
        (1u32..20).prop_map(|t| SecretaryTaskKind::DraftReply {
            ticket: TicketId(t)
        }),
        (select(Role::ALL.to_vec()), prop::option::of(project_id()))
            .prop_map(|(role, project)| SecretaryTaskKind::ArrangeHiring { role, project }),
        (
            staff_id(),
            select(vec![FollowUpTopic::Morale, FollowUpTopic::Salary])
        )
            .prop_map(|(staff, topic)| SecretaryTaskKind::FollowUp { staff, topic }),
    ]
}

fn org_command() -> impl Strategy<Value = Command> {
    prop_oneof![
        (1u32..8, 0u8..4, 0u32..20).prop_map(|(item, k, n)| {
            use sim_core::commands::WorkItemUpdate as U;
            let update = match k {
                0 => U::Priority(WorkPriority::High),
                1 => U::Owner(StaffId(n % 14)),
                2 => U::DueDay(n),
                _ => U::Status(WorkItemStatus::Cancelled),
            };
            Command::UpdateWorkItem {
                item: WorkItemId(item),
                update,
            }
        }),
        staff_id().prop_map(|staff| Command::Promote { staff }),
        (staff_id(), -10i64..60_000).prop_map(|(staff, cents_per_day)| Command::SetSalary {
            staff,
            cents_per_day
        }),
        (staff_id(), project_id(), 0u8..110).prop_map(|(staff, project, allocation_pct)| {
            Command::AssignToProject {
                staff,
                project,
                allocation_pct,
            }
        }),
        (staff_id(), project_id())
            .prop_map(|(staff, project)| Command::RemoveFromProject { staff, project }),
        (project_id(), staff_id())
            .prop_map(|(project, staff)| Command::SetProjectLead { project, staff }),
        select(vec![
            ("amalfi", "amalfi.travel"),
            ("capri", "capri.travel"),
            ("cinqueterre-travel", "x.travel"),
            ("Bad", "bad"),
        ])
        .prop_map(|(slug, domain)| Command::CreateProject {
            slug: slug.into(),
            name: "A Publication".into(),
            domain: domain.into(),
        }),
        (
            project_id(),
            select(vec![
                ProjectStatus::Proposed,
                ProjectStatus::Active,
                ProjectStatus::Paused,
                ProjectStatus::Archived
            ])
        )
            .prop_map(|(project, status)| Command::SetProjectStatus { project, status }),
        (project_id(), -1i64..10_000_000).prop_map(|(project, monthly_cents)| {
            Command::SetProjectBudget {
                project,
                monthly_cents,
            }
        }),
        ((1u32..20).prop_map(TicketId), ticket_option())
            .prop_map(|(ticket, option)| Command::AnswerTicket { ticket, option }),
        delegate_task().prop_map(|task| Command::Delegate { task }),
        select(vec![
            DelegationPolicy::Off,
            DelegationPolicy::Low,
            DelegationPolicy::LowAndMedium
        ])
        .prop_map(|policy| Command::SetDelegation { policy }),
        staff_id().prop_map(|staff| Command::Praise { staff }),
    ]
}

fn server_command() -> impl Strategy<Value = ServerCommand> {
    prop_oneof![
        (1u32..5, 0u32..4, 1u32..9, 0u32..400).prop_map(|(m, seq, s, chars)| {
            ServerCommand::Utterance {
                meeting: MeetingId(m),
                seq,
                speaker: StaffId(s),
                chars,
            }
        }),
        (0u32..100, 0u8..5).prop_map(|(live_pages, languages)| {
            ServerCommand::SiteSignals(SiteSignals {
                live_pages,
                languages,
                ..SiteSignals::default()
            })
        }),
        (project_id(), 0u32..4, 0u32..5_000, 0u16..1_200).prop_map(
            |(project, day, sessions, engagement_pm)| ServerCommand::AnalyticsSignals {
                project,
                day,
                sessions,
                visitors: sessions / 2,
                pageviews: sessions * 3,
                engagement_pm,
                top_pages_digest: u64::from(sessions),
            }
        ),
        (1u32..5).prop_map(|w| ServerCommand::DeployLanded {
            work_item: WorkItemId(w),
        }),
        (1u64..8, 1u32..14, 1u32..14).prop_map(|(j, wr, ed)| ServerCommand::MeetingOutcome {
            job_id: j,
            briefs: vec![BriefStub {
                kind: WorkItemKind::Article,
                writer: StaffId(wr),
                editor: StaffId(ed),
                brief_ref: j,
            }],
        }),
        (1u64..12, any::<bool>(), 0u8..11).prop_map(|(j, ok, score)| ServerCommand::JobCompleted {
            job_id: j,
            digest: JobDigest {
                ok,
                score,
                words: 800,
                qa_defects: 0,
                artifact_sha: [7; 16],
            },
        }),
        (1u64..12, select(JobFailure::ALL.to_vec()))
            .prop_map(|(job_id, reason)| ServerCommand::JobFailed { job_id, reason }),
        (1u32..5).prop_map(|w| ServerCommand::DeployFailed {
            work_item: WorkItemId(w),
        }),
        (1u64..12, 1u32..14, 0u8..4, 0u8..6, any::<bool>()).prop_map(
            |(j, ed, start, publish, dep)| ServerCommand::BoardOutcome {
                job_id: j,
                workstreams: vec![7],
                items: vec![
                    PlannedStub {
                        kind: WorkItemKind::Article,
                        brief_ref: 1_000 + j,
                        editor: StaffId(ed),
                        priority: WorkPriority::Normal,
                        workstream: Some(0),
                        start_offset: start,
                        publish_offset: publish,
                        depends_on: vec![],
                    },
                    PlannedStub {
                        kind: WorkItemKind::Article,
                        brief_ref: 2_000 + j,
                        editor: StaffId(ed),
                        priority: WorkPriority::High,
                        workstream: None,
                        start_offset: 0,
                        publish_offset: publish,
                        depends_on: if dep { vec![0] } else { vec![] },
                    },
                ],
            }
        ),
    ]
}

fn input() -> impl Strategy<Value = Input> {
    prop_oneof![
        6 => command().prop_map(Input::Player),
        1 => server_command().prop_map(Input::Server),
    ]
}

/// A test step: a raw input, or a world-aware recipe that usually produces a
/// valid input (so the accepting paths get exercised, not just rejections).
#[derive(Clone, Debug)]
enum Action {
    Raw(Input),
    /// Room against the lot's east edge with a west door, after buying land.
    Room {
        kind: usize,
        z: i32,
        w: i32,
        d: i32,
        door: i32,
    },
    /// Desk on a newsroom grid point.
    Desk {
        gx: i32,
        gz: i32,
        rot: u8,
    },
    /// Utterance by someone seated in the running meeting.
    Speak {
        pick: usize,
        chars: u32,
    },
    /// Answer an open ticket with one of its own options.
    Answer {
        pick: usize,
        option: usize,
    },
    /// Fire someone from the starting company (CFO, Secretary, photographer…).
    FireKey {
        pick: usize,
    },
}

fn action() -> impl Strategy<Value = Action> {
    prop_oneof![
        5 => input().prop_map(Action::Raw),
        2 => (0usize..6, 0i32..10, 3i32..5, 3i32..6, 0i32..5)
            .prop_map(|(kind, z, w, d, door)| Action::Room { kind, z, w, d, door }),
        1 => (0i32..4, 0i32..4, 0u8..4).prop_map(|(gx, gz, rot)| Action::Desk { gx, gz, rot }),
        1 => (0usize..8, 1u32..300).prop_map(|(pick, chars)| Action::Speak { pick, chars }),
        2 => (0usize..16, 0usize..4).prop_map(|(pick, option)| Action::Answer { pick, option }),
        1 => (0usize..5).prop_map(|pick| Action::FireKey { pick }),
    ]
}

fn resolve(w: &World, a: Action) -> Input {
    match a {
        Action::Raw(i) => i,
        Action::Room {
            kind,
            z,
            w: rw,
            d,
            door,
        } => {
            let kinds = [
                RoomKind::Kitchen,
                RoomKind::Archive,
                RoomKind::MeetingRoom,
                RoomKind::CeoOffice,
                RoomKind::EditorOffice,
                RoomKind::Newsroom,
            ];
            let lot = w.building.lot;
            Input::Player(Command::PlaceRoom {
                kind: kinds[kind],
                rect: TileRect::new(lot.x_end() - rw, lot.z + z, rw, d),
                floor: 0,
                doors: vec![Door {
                    side: Side::West,
                    at: door.min(d - 1),
                }],
                windows: vec![Window {
                    side: Side::East,
                    at_mm: 500,
                    width_mm: 1_000,
                }],
            })
        }
        Action::Answer { pick, option } => {
            let open: Vec<_> = w.tickets.values().filter(|t| t.is_open()).collect();
            match open.get(pick % open.len().max(1)) {
                Some(t) => Input::Player(Command::AnswerTicket {
                    ticket: t.id,
                    option: t.options[option % t.options.len()],
                }),
                None => Input::Player(Command::Praise { staff: StaffId(1) }),
            }
        }
        Action::FireKey { pick } => {
            // CFO, Secretary, photographer, data scientist, strategist
            let key = [7, 8, 6, 13, 9][pick % 5];
            Input::Player(Command::Fire {
                staff: StaffId(key),
            })
        }
        Action::Desk { gx, gz, rot } => Input::Player(Command::PlaceEquipment {
            kind: EquipmentKind::Desk,
            placement: Placement::Floor {
                pos: PosMm::new(1_200 + gx * 2_300, 1_200 + gz * 2_300),
                rot,
            },
        }),
        Action::Speak { pick, chars } => {
            let now = w.clock();
            let Some(m) = w.meetings.values().find(|m| m.is_active(now)) else {
                return Input::Server(ServerCommand::SiteSignals(SiteSignals::default()));
            };
            let seated: Vec<StaffId> = w
                .staff
                .values()
                .filter(|s| {
                    s.path.is_none()
                        && matches!(s.spot, Some(Spot::MeetingSeat { meeting, .. }) if meeting == m.id)
                })
                .map(|s| s.id)
                .collect();
            let speaker = seated
                .get(pick % seated.len().max(1))
                .copied()
                .unwrap_or(StaffId(1));
            Input::Server(ServerCommand::Utterance {
                meeting: m.id,
                seq: m.next_seq,
                speaker,
                chars,
            })
        }
    }
}

fn config() -> impl Strategy<Value = SimConfig> {
    (select(vec![1u64, 2, 20]), 0u64..1440).prop_map(|(day_real_minutes, start_minute)| SimConfig {
        day_real_minutes,
        start_minute,
    })
}

fn check(w: &World) {
    assert_eq!(
        w.ledger.opening_cash + w.ledger.total(),
        w.company.cash,
        "cash conserved"
    );
    for s in w.staff.values().filter(|s| s.is_on_site()) {
        assert!(
            !w.building.point_in_wall(s.pos),
            "{} at {:?} is inside a wall (step {}, {:?})",
            s.id,
            s.pos,
            w.step,
            s.activity
        );
    }
    assert_eq!(w.nav_failures, 0, "everyone can always find a path");
    check_org(w);
}

fn ledger_total(w: &World, k: LedgerKind) -> i64 {
    w.ledger.totals.get(&k).copied().unwrap_or(0)
}

fn check_org(w: &World) {
    for s in w.staff.values() {
        assert!(
            s.allocated_pct() <= 100,
            "{} allocated {}%",
            s.id,
            s.allocated_pct()
        );
        if s.role.is_executive() {
            assert!(
                s.projects.is_empty(),
                "executives are not staffed on projects"
            );
        }
        for p in s.projects.keys() {
            assert!(
                w.projects.get(p).is_some_and(|p| p.is_open()),
                "allocation on a closed project"
            );
        }
    }
    for (slot, role) in [(w.exec.cfo, Role::Cfo), (w.exec.secretary, Role::Secretary)] {
        if let Some(id) = slot {
            let s = &w.staff[&id];
            assert!(s.is_active() && s.role == role);
        }
    }
    for p in w.projects.values() {
        if let Some(lead) = p.lead {
            assert!(w.staff[&lead].allocation(p.id) > 0, "lead off the team");
        }
    }
    assert!(w.open_projects() <= w.project_limit().max(1));
    // per-project ledgers + overhead == company ledger
    let mut sum: CostBreakdown = w.finance.overhead_total;
    for p in w.projects.values() {
        sum.add(&p.ledger.total);
    }
    assert_eq!(sum.salaries, -ledger_total(w, LedgerKind::Salaries));
    assert_eq!(sum.overtime, -ledger_total(w, LedgerKind::Overtime));
    assert_eq!(sum.rent, -ledger_total(w, LedgerKind::Rent));
    assert_eq!(sum.upkeep, -ledger_total(w, LedgerKind::Upkeep));
    assert_eq!(sum.revenue, ledger_total(w, LedgerKind::Revenue));
    for t in w.tickets.values() {
        if t.is_open() {
            assert!(t.deadline_step > w.step, "{} open past its deadline", t.id);
            assert!(t.options.contains(&t.default_option));
        } else {
            assert!(t.resolved_step.is_some_and(|s| s <= t.deadline_step));
            assert!(t.answer.is_some_and(|a| t.options.contains(&a)));
        }
        if t.resolved_by == Some(ResolvedBy::Secretary) {
            assert_ne!(
                t.priority,
                Priority::High,
                "the Secretary answered a High ticket"
            );
            assert_ne!(
                t.kind,
                TicketKind::PublishApproval,
                "the Secretary answered the publish gate"
            );
            assert!(!t.over_threshold());
            assert!(t.routed_via_secretary);
        }
        if t.kind == TicketKind::PublishApproval && t.resolved_by == Some(ResolvedBy::Default) {
            assert_eq!(
                t.answer,
                Some(TicketOption::Defer),
                "the default of the publish gate never publishes"
            );
        }
    }
    if w.exec.secretary.is_none() {
        assert_eq!(w.pending_tasks(), 0);
    }
    check_plan(w);
}

/// The job contract: revisions are capped, blocked items are escalated,
/// working phases wait on a pending job, pending jobs point at live work;
/// and ADR-0059: a project's open items stay within the work-in-progress
/// limit, a writer has at most one item in the writing loop (so at most one
/// active draft), and an item parked at the publish gate has no job.
fn check_plan(w: &World) {
    for p in w.projects.keys() {
        assert!(
            w.open_items(*p) <= WIP_LIMIT,
            "{p} has {} open items (limit {WIP_LIMIT})",
            w.open_items(*p)
        );
        assert!(
            w.unstarted_items(*p) <= MAX_PLANNED,
            "{p} has {} planned items not started",
            w.unstarted_items(*p)
        );
    }
    let mut writers: Vec<StaffId> = Vec::new();
    let mut drafting: Vec<StaffId> = Vec::new();
    for item in w.plan.items.values() {
        if item.in_writing_loop() {
            let writer = item.writer().expect("an article has a writer");
            assert!(
                !writers.contains(&writer),
                "{writer} has two items in the writing loop"
            );
            writers.push(writer);
        }
        if item.is_unstarted() {
            // planned by the board: no writer and no job until it starts
            assert!(
                w.plan.jobs.values().all(|j| j.work_item != Some(item.id)),
                "{} has a job before it started",
                item.id
            );
            assert!(item.start_day.is_some(), "{} has no start day", item.id);
        } else if !item.status.is_closed() {
            if let Some(p) = item.phase().filter(|p| p.kind == PhaseKind::Draft) {
                let writer = p.assignee.expect("a draft has a writer");
                assert!(
                    !drafting.contains(&writer),
                    "{writer} has two active drafts"
                );
                drafting.push(writer);
            }
        }
        if item.awaiting_approval() {
            assert!(
                w.plan.jobs.values().all(|j| j.work_item != Some(item.id)),
                "{} is parked at the gate with a pending job",
                item.id
            );
            assert!(
                !item.tickets.is_empty(),
                "{} is parked without ever asking the CEO",
                item.id
            );
        }
    }
    for j in w.plan.jobs.values() {
        if j.kind == JobKind::Publish {
            let item = &w.plan.items[&j.work_item.expect("a publish job has an item")];
            assert!(
                !item.awaiting_approval(),
                "{} publishes while it waits for approval",
                item.id
            );
        }
    }
    for item in w.plan.items.values() {
        assert!(
            item.revision <= MAX_REVISIONS,
            "{} over the revision cap",
            item.id
        );
        if item.status == WorkItemStatus::Blocked {
            assert!(
                !item.tickets.is_empty(),
                "{} blocked without a ticket",
                item.id
            );
        }
        if let Some(p) = item.phase() {
            if p.state == PhaseState::Working && p.result.is_none() {
                let job = p.job.expect("a working phase has a job");
                assert!(
                    w.plan.jobs.contains_key(&job),
                    "{} waits on no job",
                    item.id
                );
            }
        }
    }
    for j in w.plan.jobs.values() {
        assert!(j.job_id <= w.plan.jobs_requested);
        if let Some(id) = j.work_item {
            assert!(!w.plan.items[&id].status.is_closed());
        }
    }
}

fn run_steps(w: &mut World, n: u32) {
    for _ in 0..n {
        let cash = w.company.cash;
        let report = w.step();
        if let Some(s) = report.settlement {
            if report.applied.is_empty() {
                assert_eq!(cash + s.net, w.company.cash, "settlement moves exactly net");
            }
            assert_eq!(s.cash_after, w.company.cash);
        }
        check(w);
    }
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 128, ..ProptestConfig::default() })]

    #[test]
    fn random_commands_keep_invariants(
        seed in any::<u64>(),
        cfg in config(),
        script in prop::collection::vec((0u32..600, action()), 1..16),
    ) {
        let mut w = demo_office_with_config(seed, cfg);
        check(&w);
        for (wait, action) in script {
            run_steps(&mut w, wait);
            let input = resolve(&w, action);
            let verdict = validate_input(&w, &input);
            let before = w.hash();
            let applied = w.apply_input(input);
            prop_assert_eq!(verdict.is_ok(), applied.is_ok());
            if let Err(e) = applied {
                prop_assert_eq!(Err::<(), _>(e), verdict);
                prop_assert_eq!(before, w.hash(), "rejected input changed the world");
            }
            check(&w);
        }
        run_steps(&mut w, 300);
    }

    #[test]
    fn queued_and_immediate_application_agree(
        seed in any::<u64>(),
        script in prop::collection::vec((1u64..400, command()), 1..10),
    ) {
        // Applying at step s via apply() equals enqueueing for step s.
        let cfg = SimConfig { day_real_minutes: 2, start_minute: 8 * 60 };
        let mut a = demo_office_with_config(seed, cfg.clone());
        let mut b = demo_office_with_config(seed, cfg);
        let mut at = 0u64;
        for (seq, (gap, cmd)) in script.into_iter().enumerate() {
            at += gap;
            b.enqueue(at, u32::try_from(seq).unwrap(), Input::Player(cmd.clone())).unwrap();
            while a.step < at {
                a.step();
            }
            let _ = a.apply(cmd);
        }
        while b.pending_len() > 0 || b.step <= at {
            b.step();
        }
        while a.step < b.step {
            a.step();
        }
        prop_assert_eq!(a.render_state(), b.render_state());
        prop_assert_eq!(a.hash(), b.hash());
    }

    #[test]
    fn decoding_arbitrary_bytes_never_panics(bytes in prop::collection::vec(any::<u8>(), 0..64)) {
        let mut w = demo_office_with_config(1, SimConfig::default());
        if let Ok(cmd) = postcard::from_bytes::<Command>(&bytes) {
            let _ = w.apply(cmd);
        }
        if let Ok(cmd) = postcard::from_bytes::<ServerCommand>(&bytes) {
            let _ = w.apply_server(cmd);
        }
        check(&w);
    }
}
