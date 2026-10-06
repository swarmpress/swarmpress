//! The weekly editorial board (FEAT-087, ADR-0069), on the demo office:
//!
//! - off by default; when on, a project's first board is at the next 10:00,
//!   then every Monday at 10:00, once a day at most;
//! - who sits on it; `BoardOutcome` and every refusal;
//! - planned items wait unstarted and do not count against the WIP limit;
//!   due ones start in priority, publish-day, id order with the lowest-id
//!   free drafter who is not their editor; dependencies wait for publication;
//!   the next standup starts what came due;
//! - a failed or timed-out board raises `BoardFailed`; `Retry` holds it again.

use sim_core::clock::{SimConfig, Weekday};
use sim_core::commands::{AutonomyPolicy, Command, JobDigest, JobFailure, Policy, ServerCommand};
use sim_core::ids::{ProjectId, StaffId, WorkItemId};
use sim_core::inbox::{TicketKind, TicketOption, TicketSpec};
use sim_core::plan::{
    can_review, Effect, JobKind, PlannedStub, WorkItemKind, WorkItemStatus, WorkPriority,
    MAX_BOARD_ITEMS, MAX_PLANNED, WIP_LIMIT,
};
use sim_core::roles::Role;
use sim_core::scenarios::{demo_office_with_config, DEMO_PROJECT};
use sim_core::world::MeetingKind;
use sim_core::{Reject, World};

const GIULIA: StaffId = StaffId(1); // writer
const ISABELLA: StaffId = StaffId(2); // writer
const LORENZO: StaffId = StaffId(3); // writer
const SOPHIA: StaffId = StaffId(4); // editor-in-chief
const MARCO: StaffId = StaffId(5); // editor
/// Steps per game day in [`fast`].
const DAY: u64 = 600;

/// One game day = 600 steps; day 0 is a Monday and starts at 07:00.
fn fast(seed: u64) -> World {
    demo_office_with_config(
        seed,
        SimConfig {
            day_real_minutes: 1,
            ..SimConfig::default()
        },
    )
}

fn with_board(seed: u64) -> World {
    let mut w = fast(seed);
    assert_eq!(w.config.steps_per_day(), DAY);
    w.apply(Command::SetPolicy(Policy::EditorialBoard(true)))
        .unwrap();
    w
}

/// A drained `RequestJob`, flattened, with the day it was requested on.
#[derive(Clone, Debug, PartialEq, Eq)]
struct Req {
    job_id: u64,
    kind: JobKind,
    project: ProjectId,
    work_item: Option<WorkItemId>,
    staff: Vec<StaffId>,
    day: u32,
}

fn drain(w: &mut World) -> Vec<Req> {
    let day = w.clock().day;
    w.drain_effects()
        .into_iter()
        .map(|e| match e {
            Effect::RequestJob {
                job_id,
                kind,
                project,
                work_item,
                staff,
                ..
            } => Req {
                job_id,
                kind,
                project,
                work_item,
                staff,
                day,
            },
        })
        .collect()
}

fn run(w: &mut World, n: u64) -> Vec<Req> {
    let mut all = Vec::new();
    for _ in 0..n {
        w.step();
        all.extend(drain(w));
    }
    all
}

/// Steps until a job of `kind` is requested; other requests are ignored.
fn step_until(w: &mut World, kind: JobKind, max_steps: u64) -> Req {
    for _ in 0..max_steps {
        w.step();
        if let Some(r) = drain(w).into_iter().find(|r| r.kind == kind) {
            return r;
        }
    }
    panic!("no {kind:?} job within {max_steps} steps");
}

fn complete(w: &mut World, job_id: u64, score: u8) {
    w.apply_server(ServerCommand::JobCompleted {
        job_id,
        digest: JobDigest {
            ok: true,
            score,
            words: 950,
            qa_defects: 0,
            artifact_sha: [0xab; 16],
        },
    })
    .expect("job result accepted");
}

fn stub(brief_ref: u64, start: u8, publish: u8) -> PlannedStub {
    PlannedStub {
        kind: WorkItemKind::Article,
        brief_ref,
        editor: MARCO,
        priority: WorkPriority::Normal,
        workstream: None,
        start_offset: start,
        publish_offset: publish,
        depends_on: vec![],
    }
}

fn outcome(job_id: u64, items: Vec<PlannedStub>) -> ServerCommand {
    ServerCommand::BoardOutcome {
        job_id,
        workstreams: vec![],
        items,
    }
}

fn board_outcome(w: &mut World, job_id: u64, items: Vec<PlannedStub>) {
    w.apply_server(outcome(job_id, items))
        .expect("board outcome accepted");
}

fn items_with(w: &World, brief_ref: u64) -> WorkItemId {
    w.plan
        .items
        .values()
        .find(|i| i.brief_ref == Some(brief_ref))
        .map(|i| i.id)
        .expect("the brief's item")
}

fn open_tickets(w: &World, kind: TicketKind) -> Vec<sim_core::inbox::Ticket> {
    w.tickets
        .values()
        .filter(|t| t.is_open() && t.kind == kind)
        .cloned()
        .collect()
}

// ---------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------

#[test]
fn the_board_is_off_by_default() {
    let mut w = fast(1);
    assert!(!w.company.policies.editorial_board);
    let reqs = run(&mut w, 8 * DAY);
    assert!(reqs.iter().all(|r| r.kind != JobKind::Board), "{reqs:?}");
    assert!(w.plan.board_days.is_empty());
}

#[test]
fn the_first_board_is_at_the_next_ten_then_every_monday() {
    // turned on on a Wednesday: the first board is that day, the next on Monday
    let mut w = fast(2);
    run(&mut w, 2 * DAY);
    assert_eq!(w.clock().weekday(), Weekday::Wednesday);
    w.apply(Command::SetPolicy(Policy::EditorialBoard(true)))
        .unwrap();
    let reqs = run(&mut w, 14 * DAY);
    let boards: Vec<(u32, ProjectId)> = reqs
        .iter()
        .filter(|r| r.kind == JobKind::Board)
        .map(|r| (r.day, r.project))
        .collect();
    assert_eq!(
        boards,
        vec![(2, DEMO_PROJECT), (7, DEMO_PROJECT), (14, DEMO_PROJECT)],
        "Wednesday, then Mondays"
    );
    for (day, _) in boards.iter().skip(1) {
        assert_eq!(Weekday::of_day(*day), Weekday::Monday);
    }
}

#[test]
fn the_board_opens_at_ten_with_the_planners() {
    let mut w = with_board(3);
    let board = step_until(&mut w, JobKind::Board, 600);
    assert_eq!(w.clock().day, 0);
    assert_eq!(w.clock().minute / 60, 10);
    let m = w
        .meetings
        .values()
        .find(|m| m.job == Some(board.job_id))
        .expect("the board's meeting");
    assert_eq!(m.kind, MeetingKind::EditorialBoard);
    assert_eq!(m.project, Some(DEMO_PROJECT));
    assert!(board.staff.contains(&MARCO) && board.staff.contains(&SOPHIA));
    assert!(
        !board.staff.contains(&GIULIA),
        "writers do not plan: {:?}",
        board.staff
    );
    if let Some(cfo) = w.exec.cfo {
        assert!(board.staff.contains(&cfo), "the CFO sits in");
    }
    for s in &board.staff {
        let role = w.staff[s].role;
        assert!(
            matches!(
                role,
                Role::Strategist
                    | Role::EditorInChief
                    | Role::Editor
                    | Role::SeoSpecialist
                    | Role::MarketingManager
                    | Role::Cfo
            ),
            "{s:?} is a {role:?}"
        );
    }
    assert_eq!(w.plan.board_days.get(&DEMO_PROJECT), Some(&0));
}

// ---------------------------------------------------------------------
// The outcome
// ---------------------------------------------------------------------

#[test]
fn planned_items_wait_unstarted_and_leave_the_wip_limit_free() {
    let mut w = with_board(4);
    let board = step_until(&mut w, JobKind::Board, 600);
    let open_before = w.open_items(DEMO_PROJECT);
    assert_eq!(open_before, 0);
    // nothing is due today: everything waits
    board_outcome(
        &mut w,
        board.job_id,
        (0..MAX_BOARD_ITEMS as u64)
            .map(|i| stub(700 + i, 2, 4))
            .collect(),
    );
    assert!(drain(&mut w).is_empty(), "nothing starts before its day");
    assert_eq!(w.unstarted_items(DEMO_PROJECT), MAX_BOARD_ITEMS);
    assert_eq!(w.open_items(DEMO_PROJECT), 0, "unstarted items are not WIP");
    let item = &w.plan.items[&items_with(&w, 700)];
    assert_eq!(item.status, WorkItemStatus::Planned);
    assert!(item.is_unstarted());
    assert_eq!(item.owner, Some(MARCO));
    assert_eq!(item.phases[0].assignee, None, "no writer before it starts");
    assert_eq!(item.phases[1].assignee, Some(MARCO));
    assert_eq!(
        (item.start_day, item.due_day, item.publish_day),
        (Some(2), Some(3), Some(4))
    );
    assert!(w.plan.jobs.is_empty(), "the board's job is done");
    let m = w.meetings.values().find(|m| m.job == Some(board.job_id));
    assert!(m.is_none(), "the board's meeting ended with its outcome");
}

#[test]
fn due_items_start_by_priority_day_and_id_with_free_drafters_up_to_the_wip_limit() {
    let mut w = with_board(5);
    let board = step_until(&mut w, JobKind::Board, 600);
    let mut urgent = stub(803, 0, 6);
    urgent.priority = WorkPriority::Urgent;
    let early = stub(802, 0, 2);
    board_outcome(
        &mut w,
        board.job_id,
        vec![
            stub(800, 0, 5),
            stub(801, 0, 5),
            early,
            urgent,
            stub(804, 0, 3),
        ],
    );
    let drafts: Vec<Req> = drain(&mut w);
    assert_eq!(drafts.len(), WIP_LIMIT, "{drafts:?}");
    assert!(drafts.iter().all(|r| r.kind == JobKind::Draft));
    let started: Vec<WorkItemId> = drafts.iter().filter_map(|r| r.work_item).collect();
    assert_eq!(
        started,
        vec![
            items_with(&w, 803), // urgent first
            items_with(&w, 802), // then the earliest publish day
            items_with(&w, 804),
        ]
    );
    // lowest-id free drafters, never the item's editor
    let writers: Vec<StaffId> = drafts.iter().map(|r| r.staff[0]).collect();
    assert_eq!(writers, vec![GIULIA, ISABELLA, LORENZO]);
    assert_eq!(w.open_items(DEMO_PROJECT), WIP_LIMIT);
    assert_eq!(w.unstarted_items(DEMO_PROJECT), 2);
    for id in &started {
        assert_eq!(w.plan.items[id].status, WorkItemStatus::InProgress);
    }
}

#[test]
fn a_dependent_item_waits_for_publication() {
    let mut w = with_board(6);
    w.apply(Command::SetPolicy(Policy::Autonomy(
        AutonomyPolicy::Autonomous,
    )))
    .unwrap();
    let board = step_until(&mut w, JobKind::Board, 600);
    let mut second = stub(901, 0, 3);
    second.depends_on = vec![0];
    board_outcome(&mut w, board.job_id, vec![stub(900, 0, 2), second]);
    let first = items_with(&w, 900);
    let second = items_with(&w, 901);
    let drafts = drain(&mut w);
    assert_eq!(drafts.len(), 1, "{drafts:?}");
    assert_eq!(drafts[0].work_item, Some(first));
    assert_eq!(w.plan.items[&second].depends_on, vec![first]);

    // the first goes through draft, review, publish and its deploy
    complete(&mut w, drafts[0].job_id, 0);
    let review = step_until(&mut w, JobKind::Review, 300);
    complete(&mut w, review.job_id, 8);
    let publish = step_until(&mut w, JobKind::Publish, 300);
    complete(&mut w, publish.job_id, 0);
    run(&mut w, 20);
    assert!(
        w.plan.items[&second].is_unstarted(),
        "not before it is live"
    );
    w.apply_server(ServerCommand::DeployLanded { work_item: first })
        .unwrap();
    assert_eq!(w.plan.items[&first].status, WorkItemStatus::Published);
    assert!(
        w.plan.items[&second].is_unstarted(),
        "starts at the standup"
    );

    // the next standup starts it
    let draft = step_until(&mut w, JobKind::Draft, 2 * DAY);
    assert_eq!(draft.work_item, Some(second));
}

#[test]
fn the_next_standup_starts_what_came_due() {
    let mut w = with_board(7);
    let board = step_until(&mut w, JobKind::Board, 600);
    board_outcome(&mut w, board.job_id, vec![stub(1000, 1, 3)]);
    assert!(drain(&mut w).is_empty());
    let id = items_with(&w, 1000);
    // day 1, 09:00: the item starts before the standup's job is requested
    let mut seen = Vec::new();
    for _ in 0..DAY {
        w.step();
        seen.extend(drain(&mut w));
        if seen.iter().any(|r| r.kind == JobKind::Standup) {
            break;
        }
    }
    let kinds: Vec<(JobKind, u32)> = seen.iter().map(|r| (r.kind, r.day)).collect();
    assert_eq!(kinds, vec![(JobKind::Draft, 1), (JobKind::Standup, 1)]);
    assert_eq!(seen[0].work_item, Some(id));
    assert_eq!(seen[0].staff, vec![GIULIA]);
}

#[test]
fn workstreams_are_reused_by_their_text_ref() {
    let mut w = with_board(8);
    let board = step_until(&mut w, JobKind::Board, 600);
    let mut a = stub(1100, 3, 4);
    a.workstream = Some(0);
    let mut b = stub(1101, 3, 4);
    b.workstream = Some(1);
    w.apply_server(ServerCommand::BoardOutcome {
        job_id: board.job_id,
        workstreams: vec![41, 42],
        items: vec![a, b],
    })
    .unwrap();
    assert_eq!(w.plan.workstreams.len(), 2);
    let next = step_until(&mut w, JobKind::Board, 8 * DAY);
    let mut c = stub(1102, 3, 4);
    c.workstream = Some(0);
    w.apply_server(ServerCommand::BoardOutcome {
        job_id: next.job_id,
        workstreams: vec![42],
        items: vec![c],
    })
    .unwrap();
    assert_eq!(w.plan.workstreams.len(), 2, "42 is reused");
    assert_eq!(
        w.plan.items[&items_with(&w, 1102)].workstream,
        w.plan.items[&items_with(&w, 1101)].workstream
    );
}

#[test]
fn every_malformed_outcome_is_refused() {
    let mut w = with_board(9);
    let board = step_until(&mut w, JobKind::Board, 600);
    let job = board.job_id;
    let refused = |w: &World, cmd: ServerCommand| -> Reject {
        sim_core::validate::validate_server(w, &cmd).expect_err("refused")
    };
    // not a board job
    assert!(matches!(
        refused(&w, outcome(job + 99, vec![])),
        Reject::Invalid(_)
    ));
    // too many items
    let many: Vec<PlannedStub> = (0..=MAX_BOARD_ITEMS as u64)
        .map(|i| stub(1200 + i, 0, 3))
        .collect();
    assert!(matches!(refused(&w, outcome(job, many)), Reject::Limit(_)));
    // a writer as editor
    let mut s = stub(1210, 0, 3);
    s.editor = GIULIA;
    assert!(!can_review(w.staff[&GIULIA].role));
    assert!(matches!(
        refused(&w, outcome(job, vec![s])),
        Reject::Invalid(_)
    ));
    // beyond two weeks
    assert!(matches!(
        refused(&w, outcome(job, vec![stub(1211, 0, 14)])),
        Reject::Invalid(_)
    ));
    // starts after its publish day
    assert!(matches!(
        refused(&w, outcome(job, vec![stub(1212, 4, 3)])),
        Reject::Invalid(_)
    ));
    // an unknown workstream index
    let mut s = stub(1213, 0, 3);
    s.workstream = Some(0);
    assert!(matches!(
        refused(&w, outcome(job, vec![s])),
        Reject::Invalid(_)
    ));
    // a self, forward or excess dependency
    let mut s = stub(1214, 0, 3);
    s.depends_on = vec![0];
    assert!(matches!(
        refused(&w, outcome(job, vec![s])),
        Reject::Invalid(_)
    ));
    let mut s = stub(1215, 0, 3);
    s.depends_on = vec![1];
    assert!(matches!(
        refused(&w, outcome(job, vec![s, stub(1216, 0, 3)])),
        Reject::Invalid(_)
    ));
    let mut s = stub(1219, 0, 3);
    s.depends_on = vec![0, 1, 2];
    let three = vec![stub(1217, 0, 3), stub(1218, 0, 3), stub(1220, 0, 3), s];
    assert!(matches!(refused(&w, outcome(job, three)), Reject::Limit(_)));
    // a brief planned twice
    assert!(matches!(
        refused(&w, outcome(job, vec![stub(1221, 0, 3), stub(1221, 1, 3)])),
        Reject::Invalid(_)
    ));
    // a board's job is not a standup's or a work item's
    assert!(w
        .apply_server(ServerCommand::MeetingOutcome {
            job_id: job,
            briefs: vec![],
        })
        .is_err());
    assert!(w
        .apply_server(ServerCommand::JobCompleted {
            job_id: job,
            digest: JobDigest {
                ok: true,
                score: 0,
                words: 0,
                qa_defects: 0,
                artifact_sha: [0; 16],
            },
        })
        .is_err());
    // a well-formed one is accepted, once
    board_outcome(&mut w, job, vec![stub(1221, 3, 5)]);
    assert!(w.apply_server(outcome(job, vec![])).is_err());
}

#[test]
fn a_project_holds_at_most_max_planned_unstarted_items() {
    let mut w = with_board(10);
    let board = step_until(&mut w, JobKind::Board, 600);
    board_outcome(
        &mut w,
        board.job_id,
        (0..MAX_BOARD_ITEMS as u64)
            .map(|i| stub(1300 + i, 10, 12))
            .collect(),
    );
    let next = step_until(&mut w, JobKind::Board, 8 * DAY);
    let room = MAX_PLANNED - MAX_BOARD_ITEMS;
    let too_many: Vec<PlannedStub> = (0..=room as u64).map(|i| stub(1400 + i, 10, 12)).collect();
    assert!(matches!(
        sim_core::validate::validate_server(&w, &outcome(next.job_id, too_many)),
        Err(Reject::Limit(_))
    ));
    let fits: Vec<PlannedStub> = (0..room as u64).map(|i| stub(1400 + i, 10, 12)).collect();
    board_outcome(&mut w, next.job_id, fits);
    assert_eq!(w.unstarted_items(DEMO_PROJECT), MAX_PLANNED);
}

// ---------------------------------------------------------------------
// Failures (rule 11)
// ---------------------------------------------------------------------

#[test]
fn a_failed_board_raises_board_failed_and_retry_holds_it_again() {
    let mut w = with_board(11);
    let board = step_until(&mut w, JobKind::Board, 600);
    w.apply_server(ServerCommand::JobFailed {
        job_id: board.job_id,
        reason: JobFailure::Infrastructure,
    })
    .unwrap();
    assert!(w.plan.jobs.values().all(|j| j.kind != JobKind::Board));
    let t = open_tickets(&w, TicketKind::BoardFailed);
    assert_eq!(t.len(), 1);
    let t = &t[0];
    assert_eq!(t.project, Some(DEMO_PROJECT));
    assert_eq!(t.failure, Some(JobFailure::Infrastructure));
    assert_eq!(t.options, vec![TicketOption::Retry, TicketOption::Skip]);
    assert_eq!(t.default_option, TicketOption::Skip);
    w.apply(Command::AnswerTicket {
        ticket: t.id,
        option: TicketOption::Retry,
    })
    .unwrap();
    let again = drain(&mut w);
    assert_eq!(again.len(), 1, "{again:?}");
    assert_eq!(again[0].kind, JobKind::Board);
    // the ticket is closed: answering it again is refused
    let again_answer = Command::AnswerTicket {
        ticket: t.id,
        option: TicketOption::Retry,
    };
    assert!(w.apply(again_answer).is_err(), "answered already");
    // a board is held once per run: a second Retry ticket waits while one runs
    let t2 = w.raise_ticket(TicketSpec {
        kind: TicketKind::BoardFailed,
        project: Some(DEMO_PROJECT),
        from: None,
        role: None,
        amount_cents: 0,
        work_item: None,
    });
    let retry = Command::AnswerTicket {
        ticket: t2,
        option: TicketOption::Retry,
    };
    assert!(
        w.apply(retry).is_err(),
        "a board of this project is running"
    );
}

#[test]
fn an_unanswered_board_times_out_into_a_ticket() {
    let mut w = with_board(12);
    let board = step_until(&mut w, JobKind::Board, 600);
    // the board waits two game hours at most
    run(&mut w, DAY / 6);
    assert!(!w.plan.jobs.contains_key(&board.job_id));
    let t = open_tickets(&w, TicketKind::BoardFailed);
    assert_eq!(t.len(), 1);
    assert_eq!(t[0].failure, Some(JobFailure::Timeout));
    assert!(w
        .meetings
        .values()
        .all(|m| m.kind != MeetingKind::EditorialBoard || m.job.is_none()));
    // Skip, the default, waits for Monday: no board on the following days
    let reqs = run(&mut w, 5 * DAY);
    let boards: Vec<u32> = reqs
        .iter()
        .filter(|r| r.kind == JobKind::Board)
        .map(|r| r.day)
        .collect();
    assert!(boards.is_empty(), "{boards:?}");
}

#[test]
fn a_snapshot_with_planned_items_restores_and_reissues_nothing() {
    let mut w = with_board(13);
    let board = step_until(&mut w, JobKind::Board, 600);
    board_outcome(
        &mut w,
        board.job_id,
        vec![stub(1500, 1, 3), stub(1501, 4, 6)],
    );
    let mut r = World::from_snapshot(&w.snapshot(), None).expect("restores");
    assert_eq!(r.hash(), w.hash());
    assert!(drain(&mut r).is_empty());
    assert_eq!(r.unstarted_items(DEMO_PROJECT), 2);
}
