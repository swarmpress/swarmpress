//! The sim ↔ orchestrator job contract (docs/mvp.md, docs/architecture/sim.md
//! "Job contract"), walked end to end on the cinqueterre.travel company:
//!
//! standup → MeetingOutcome → draft → review 6 → revision → review 8 →
//! publish → DeployLanded → Published; plus the revision cap (Blocked + a
//! QuestionTicket), failed jobs, retries and rejections.

use sim_core::clock::SimConfig;
use sim_core::commands::{Command, JobDigest, ServerCommand};
use sim_core::ids::{ProjectId, StaffId, WorkItemId};
use sim_core::inbox::{TicketKind, TicketOption};
use sim_core::plan::{
    BriefStub, Effect, FeedKind, JobKind, WorkItemKind, WorkItemStatus, MAX_REVISIONS,
};
use sim_core::scenarios::{demo_office_with_config, scenario, DEMO_PROJECT};
use sim_core::{Reject, World};

const GIULIA: StaffId = StaffId(1); // writer
const MARCO: StaffId = StaffId(5); // editor
const DAVIDE: StaffId = StaffId(11); // IT engineer: publishes
const FRANCESCA: StaffId = StaffId(6); // photographer

/// One game day = 600 steps.
fn fast(seed: u64) -> World {
    demo_office_with_config(
        seed,
        SimConfig {
            day_real_minutes: 1,
            ..SimConfig::default()
        },
    )
}

/// A drained `RequestJob`, flattened.
#[derive(Clone, Debug, PartialEq, Eq)]
struct Req {
    job_id: u64,
    kind: JobKind,
    project: ProjectId,
    work_item: Option<WorkItemId>,
    brief_ref: Option<u64>,
    revision: u8,
    staff: Vec<StaffId>,
}

fn drain(w: &mut World) -> Vec<Req> {
    w.drain_effects()
        .into_iter()
        .map(|e| match e {
            Effect::RequestJob {
                job_id,
                kind,
                project,
                work_item,
                brief_ref,
                revision,
                staff,
                ..
            } => Req {
                job_id,
                kind,
                project,
                work_item,
                brief_ref,
                revision,
                staff,
            },
        })
        .collect()
}

/// Steps until exactly one job of `kind` is requested; returns it.
fn step_until_job(w: &mut World, kind: JobKind, max_steps: u32) -> Req {
    for _ in 0..max_steps {
        w.step();
        let reqs = drain(w);
        assert!(
            reqs.iter().all(|r| r.kind == kind),
            "unexpected job(s) while waiting for {kind:?}: {reqs:?}"
        );
        if let Some(r) = reqs.into_iter().next() {
            return r;
        }
    }
    panic!("no {kind:?} job within {max_steps} steps");
}

fn digest(ok: bool, score: u8) -> JobDigest {
    JobDigest {
        ok,
        score,
        words: 950,
        qa_defects: 0,
        artifact_sha: [0xab; 16],
    }
}

fn complete(w: &mut World, job_id: u64, ok: bool, score: u8) {
    w.apply_server(ServerCommand::JobCompleted {
        job_id,
        digest: digest(ok, score),
    })
    .expect("job result accepted");
}

/// Runs to the 09:00 standup and answers it with one brief (Giulia writes,
/// Marco edits). Returns the work item and its first Draft job.
fn standup_to_draft(w: &mut World) -> (WorkItemId, Req) {
    let standup = step_until_job(w, JobKind::Standup, 400);
    assert_eq!(standup.project, DEMO_PROJECT);
    assert_eq!(standup.work_item, None);
    w.apply_server(ServerCommand::MeetingOutcome {
        job_id: standup.job_id,
        briefs: vec![BriefStub {
            kind: WorkItemKind::Article,
            writer: GIULIA,
            editor: MARCO,
            brief_ref: 77,
        }],
    })
    .expect("outcome accepted");
    let reqs = drain(w);
    assert_eq!(reqs.len(), 1, "{reqs:?}");
    let draft = reqs[0].clone();
    let id = draft.work_item.expect("a draft is about a work item");
    (id, draft)
}

#[test]
fn the_whole_article_loop() {
    let mut w = fast(1);

    // 09:00 standup: one job, with the project's team
    let standup = step_until_job(&mut w, JobKind::Standup, 400);
    assert_eq!(w.clock().minute, 9 * 60);
    assert_eq!(standup.job_id, 1);
    assert_eq!(standup.project, DEMO_PROJECT);
    assert_eq!(
        (standup.work_item, standup.brief_ref, standup.revision),
        (None, None, 0)
    );
    for s in [GIULIA, MARCO, FRANCESCA, DAVIDE] {
        assert!(standup.staff.contains(&s), "{s} at the standup");
    }
    assert!(
        !standup.staff.contains(&StaffId(7)),
        "the CFO is not on the team"
    );

    // a standup ends with an outcome, not a job result
    assert!(matches!(
        w.apply_server(ServerCommand::JobCompleted {
            job_id: standup.job_id,
            digest: digest(true, 0),
        }),
        Err(Reject::Invalid(_))
    ));
    // briefs are validated against the team
    for (writer, editor) in [(GIULIA, GIULIA), (FRANCESCA, MARCO), (GIULIA, StaffId(1))] {
        let r = w.apply_server(ServerCommand::MeetingOutcome {
            job_id: standup.job_id,
            briefs: vec![BriefStub {
                kind: WorkItemKind::Article,
                writer,
                editor,
                brief_ref: 1,
            }],
        });
        assert!(r.is_err(), "{writer} → {editor}");
    }

    // MeetingOutcome: a work item in Draft and a Draft job for the writer
    w.apply_server(ServerCommand::MeetingOutcome {
        job_id: standup.job_id,
        briefs: vec![BriefStub {
            kind: WorkItemKind::Article,
            writer: GIULIA,
            editor: MARCO,
            brief_ref: 77,
        }],
    })
    .unwrap();
    assert!(
        w.apply_server(ServerCommand::MeetingOutcome {
            job_id: standup.job_id,
            briefs: vec![],
        })
        .is_err(),
        "one outcome per standup"
    );
    let reqs = drain(&mut w);
    assert_eq!(reqs.len(), 1);
    let draft = reqs[0].clone();
    let id = draft.work_item.unwrap();
    assert_eq!(draft.kind, JobKind::Draft);
    assert_eq!(draft.brief_ref, Some(77));
    assert_eq!(draft.revision, 0);
    assert_eq!(draft.staff, vec![GIULIA]);
    assert_eq!(w.plan.items[&id].status, WorkItemStatus::InProgress);
    assert_eq!(w.plan.items[&id].owner, Some(MARCO));
    assert_eq!(w.busy_with(GIULIA), Some(id));

    // a deploy for an unmerged item is rejected
    assert!(w
        .apply_server(ServerCommand::DeployLanded { work_item: id })
        .is_err());

    // Draft ok → Review (after the draft's minimum time)
    complete(&mut w, draft.job_id, true, 0);
    assert!(
        w.apply_server(ServerCommand::JobCompleted {
            job_id: draft.job_id,
            digest: digest(true, 0),
        })
        .is_err(),
        "a job completes once"
    );
    assert_eq!(w.plan.items[&id].status, WorkItemStatus::InProgress);
    let review = step_until_job(&mut w, JobKind::Review, 200);
    assert_eq!(review.work_item, Some(id));
    assert_eq!(review.revision, 0);
    assert_eq!(review.staff, vec![MARCO]);
    assert_eq!(w.plan.items[&id].status, WorkItemStatus::InReview);

    // Review 6 < 7 → revision 1: a new Draft job
    complete(&mut w, review.job_id, true, 6);
    let redraft = step_until_job(&mut w, JobKind::Draft, 200);
    assert_eq!(redraft.work_item, Some(id));
    assert_eq!(redraft.revision, 1);
    assert_eq!(redraft.brief_ref, Some(77));
    assert_eq!(redraft.staff, vec![GIULIA]);
    let item = &w.plan.items[&id];
    assert_eq!(
        (item.status, item.revision, item.last_score),
        (WorkItemStatus::InProgress, 1, Some(6))
    );

    // Draft ok → Review of revision 1 → 8 ≥ 7 → Publish
    complete(&mut w, redraft.job_id, true, 0);
    let review2 = step_until_job(&mut w, JobKind::Review, 200);
    assert_eq!(review2.revision, 1);
    complete(&mut w, review2.job_id, true, 8);
    let publish = step_until_job(&mut w, JobKind::Publish, 200);
    assert_eq!(publish.work_item, Some(id));
    assert_eq!(publish.staff, vec![DAVIDE]);
    assert_eq!(w.plan.items[&id].status, WorkItemStatus::Approved);
    assert_eq!(w.plan.items[&id].last_score, Some(8));

    // Publish ok → Scheduled (merged, waiting for the deploy)
    complete(&mut w, publish.job_id, true, 0);
    for _ in 0..50 {
        w.step();
    }
    assert!(drain(&mut w).is_empty(), "no more jobs");
    assert_eq!(w.plan.items[&id].status, WorkItemStatus::Scheduled);
    assert!(w.plan.jobs.is_empty(), "nothing pending");

    // DeployLanded → Published
    let pages = w.projects[&DEMO_PROJECT].kpis.live_pages;
    w.apply_server(ServerCommand::DeployLanded { work_item: id })
        .unwrap();
    let item = &w.plan.items[&id];
    assert_eq!(item.status, WorkItemStatus::Published);
    assert_eq!(item.published_step, Some(w.step));
    assert!(item.tickets.is_empty());
    assert_eq!(w.projects[&DEMO_PROJECT].kpis.live_pages, pages + 1);
    assert!(w
        .plan
        .feed
        .iter()
        .any(|f| f.kind == FeedKind::Published && f.work_item == id));
    assert!(w
        .apply_server(ServerCommand::DeployLanded { work_item: id })
        .is_err());
}

#[test]
fn revision_cap_blocks_with_a_ticket() {
    let mut w = fast(2);
    let (id, mut job) = standup_to_draft(&mut w);
    for rev in 0..=MAX_REVISIONS {
        assert_eq!(job.kind, JobKind::Draft);
        assert_eq!(job.revision, rev);
        complete(&mut w, job.job_id, true, 0);
        let review = step_until_job(&mut w, JobKind::Review, 200);
        assert_eq!(review.revision, rev);
        complete(&mut w, review.job_id, true, 5);
        if rev < MAX_REVISIONS {
            job = step_until_job(&mut w, JobKind::Draft, 200);
        }
    }
    // the fourth failed review blocks the item: no new job, a ticket instead
    for _ in 0..100 {
        w.step();
    }
    assert!(drain(&mut w).is_empty());
    let item = &w.plan.items[&id];
    assert_eq!(item.status, WorkItemStatus::Blocked);
    assert_eq!(item.revision, MAX_REVISIONS);
    assert_eq!(item.tickets.len(), 1);
    let t = &w.tickets[&item.tickets[0]];
    assert_eq!(t.kind, TicketKind::Escalation);
    assert_eq!(t.work_item, Some(id));
    assert_eq!(t.default_option, TicketOption::Kill);
    assert!(t.options.contains(&TicketOption::Retry));
    assert!(t.deadline_step > w.step);
    assert!(t.is_open(), "High tickets are never auto-answered");
    assert!(w
        .plan
        .feed
        .iter()
        .any(|f| f.kind == FeedKind::Blocked && f.work_item == id));
    // past the deadline the default (Kill) cancels the item
    let deadline = t.deadline_step;
    while w.step <= deadline {
        w.step();
    }
    assert_eq!(w.plan.items[&id].status, WorkItemStatus::Cancelled);
    assert!(w.plan.jobs.values().all(|j| j.work_item != Some(id)));
}

#[test]
fn a_failed_job_blocks_and_retry_restarts_the_phase() {
    let mut w = fast(3);
    let (id, draft) = standup_to_draft(&mut w);
    complete(&mut w, draft.job_id, false, 0);
    assert_eq!(w.plan.items[&id].status, WorkItemStatus::Blocked);
    let ticket = w.plan.items[&id].tickets[0];
    assert_eq!(w.tickets[&ticket].kind, TicketKind::Escalation);
    assert_eq!(w.tickets[&ticket].default_option, TicketOption::Kill);
    // the CEO retries: a fresh Draft job for the same revision
    w.apply(Command::AnswerTicket {
        ticket,
        option: TicketOption::Retry,
    })
    .unwrap();
    let reqs = drain(&mut w);
    assert_eq!(reqs.len(), 1, "{reqs:?}");
    assert_eq!(reqs[0].kind, JobKind::Draft);
    assert_eq!(reqs[0].work_item, Some(id));
    assert_eq!(reqs[0].revision, 0);
    assert_ne!(reqs[0].job_id, draft.job_id);
    assert_eq!(w.plan.items[&id].status, WorkItemStatus::InProgress);
}

#[test]
fn one_standup_per_day_per_project() {
    let mut w = fast(4);
    let per_day = w.config.steps_per_day();
    let mut standups = Vec::new();
    for _ in 0..per_day * 3 {
        w.step();
        for r in drain(&mut w) {
            assert_eq!(r.kind, JobKind::Standup);
            // answer at once with no briefs: the meeting ends early, and
            // must not be rescheduled the same day
            w.apply_server(ServerCommand::MeetingOutcome {
                job_id: r.job_id,
                briefs: vec![],
            })
            .unwrap();
            standups.push((w.clock().day, r.project));
        }
    }
    assert_eq!(
        standups,
        vec![(0, DEMO_PROJECT), (1, DEMO_PROJECT), (2, DEMO_PROJECT)]
    );
    assert!(w.plan.items.is_empty());
}

#[test]
fn unanswered_standups_time_out() {
    let mut w = fast(5);
    let standup = step_until_job(&mut w, JobKind::Standup, 400);
    assert!(w.plan.jobs.contains_key(&standup.job_id));
    for _ in 0..w.config.steps_per_day() / 12 {
        w.step();
    }
    assert!(
        !w.plan.jobs.contains_key(&standup.job_id),
        "dropped after an hour"
    );
    assert!(w
        .apply_server(ServerCommand::MeetingOutcome {
            job_id: standup.job_id,
            briefs: vec![],
        })
        .is_err());
}

#[test]
fn effects_stay_outside_the_hash() {
    let mut a = fast(6);
    let mut b = fast(6);
    for _ in 0..300 {
        a.step();
        b.step();
        a.drain_effects();
    }
    assert!(!b.effects().is_empty(), "b kept its standup request");
    assert_eq!(a.hash(), b.hash());
}

#[test]
fn scenarios_by_name() {
    let w = scenario("cinqueterre", 9).unwrap();
    assert_eq!(w.staff.len(), 13);
    assert!((1..=13).all(|i| w.staff.contains_key(&StaffId(i))));
    assert_eq!(w.hash(), scenario("demo", 9).unwrap().hash());
    assert!(scenario("empty", 9).unwrap().staff.is_empty());
    assert!(scenario("nope", 9).is_none());
}
