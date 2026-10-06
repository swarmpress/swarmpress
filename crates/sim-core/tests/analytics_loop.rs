//! The analytics loop's sim half (FEAT-089, ADR-0071): with the `analytics`
//! policy, the Monday KPI review requests the data scientist's report, and an
//! item published 14 game days ago gets one follow-up whose score stays on it.
//! Off by default: old logs replay without either.

use sim_core::clock::SimConfig;
use sim_core::commands::{AutonomyPolicy, Command, JobDigest, JobFailure, Policy, ServerCommand};
use sim_core::ids::{StaffId, WorkItemId};
use sim_core::plan::{BriefStub, Effect, JobKind, WorkItemKind, WorkItemStatus, FOLLOW_UP_DAYS};
use sim_core::roles::Role;
use sim_core::scenarios::demo_office_with_config;
use sim_core::World;

const DAY: u64 = 600;

fn fast(seed: u64) -> World {
    demo_office_with_config(
        seed,
        SimConfig {
            day_real_minutes: 1,
            ..SimConfig::default()
        },
    )
}

#[derive(Debug, Clone)]
struct Req {
    job_id: u64,
    kind: JobKind,
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
                work_item,
                staff,
                ..
            } => Req {
                job_id,
                kind,
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

fn done(w: &mut World, job_id: u64, score: u8) {
    w.apply_server(ServerCommand::JobCompleted {
        job_id,
        digest: JobDigest {
            ok: true,
            score,
            words: 900,
            qa_defects: 0,
            artifact_sha: [1; 16],
        },
    })
    .unwrap();
}

fn data_scientist(w: &World) -> StaffId {
    w.staff
        .values()
        .find(|s| s.role == Role::DataScientist)
        .expect("the demo office has a data scientist")
        .id
}

#[test]
fn off_by_default_on_the_kpi_review_requests_the_report() {
    let mut w = fast(1);
    let reqs = run(&mut w, DAY);
    assert!(reqs.iter().all(|r| !r.kind.is_analysis()), "{reqs:?}");

    let mut w = fast(1);
    w.apply(Command::SetPolicy(Policy::Analytics(true)))
        .unwrap();
    let reqs = run(&mut w, DAY);
    let kpi: Vec<&Req> = reqs
        .iter()
        .filter(|r| r.kind == JobKind::KpiReport)
        .collect();
    assert_eq!(kpi.len(), 1, "Monday (day 0) 09:30: {reqs:?}");
    assert_eq!(kpi[0].staff, vec![data_scientist(&w)]);
    let job = kpi[0].job_id;
    done(&mut w, job, 0);
    assert!(!w.plan.jobs.contains_key(&job));
    // the next Monday again; a failure is not retried
    let reqs = run(&mut w, 7 * DAY);
    let next = reqs
        .iter()
        .find(|r| r.kind == JobKind::KpiReport)
        .expect("next Monday's report");
    assert_eq!(next.day, 7);
    w.apply_server(ServerCommand::JobFailed {
        job_id: next.job_id,
        reason: JobFailure::Model,
    })
    .unwrap();
    assert!(w.plan.jobs.is_empty() || w.plan.jobs.values().all(|j| j.kind != JobKind::KpiReport));
}

#[test]
fn a_published_item_gets_one_follow_up_after_fourteen_days() {
    let mut w = fast(2);
    w.apply(Command::SetPolicy(Policy::Analytics(true)))
        .unwrap();
    w.apply(Command::SetPolicy(Policy::Autonomy(
        AutonomyPolicy::Autonomous,
    )))
    .unwrap();
    // to the standup; one brief, through to published
    let standup = loop {
        w.step();
        if let Some(r) = drain(&mut w)
            .into_iter()
            .find(|r| r.kind == JobKind::Standup)
        {
            break r;
        }
    };
    w.apply_server(ServerCommand::MeetingOutcome {
        job_id: standup.job_id,
        briefs: vec![BriefStub {
            kind: WorkItemKind::Article,
            writer: StaffId(1),
            editor: StaffId(5),
            brief_ref: 77,
        }],
    })
    .unwrap();
    let draft = drain(&mut w).remove(0);
    let item = draft.work_item.unwrap();
    done(&mut w, draft.job_id, 0);
    let review = loop {
        w.step();
        if let Some(r) = drain(&mut w)
            .into_iter()
            .find(|r| r.kind == JobKind::Review)
        {
            break r;
        }
    };
    done(&mut w, review.job_id, 8);
    let publish = loop {
        w.step();
        if let Some(r) = drain(&mut w)
            .into_iter()
            .find(|r| r.kind == JobKind::Publish)
        {
            break r;
        }
    };
    done(&mut w, publish.job_id, 0);
    run(&mut w, 20);
    w.apply_server(ServerCommand::DeployLanded { work_item: item })
        .unwrap();
    assert_eq!(w.plan.items[&item].status, WorkItemStatus::Published);
    let published_day = w.clock().day;

    // nothing before day +14, then one follow-up by the data scientist
    let mut follow: Option<Req> = None;
    for _ in 0..(u64::from(FOLLOW_UP_DAYS) + 2) * DAY {
        w.step();
        for r in drain(&mut w) {
            if r.kind == JobKind::Performance {
                assert!(follow.is_none(), "one follow-up only");
                follow = Some(r);
            }
        }
        if let Some(f) = &follow {
            // answer at once, so the clock never holds for it
            if w.plan.jobs.contains_key(&f.job_id) {
                done(&mut w, f.job_id, 2);
            }
        }
    }
    let f = follow.expect("a follow-up");
    assert_eq!(f.work_item, Some(item));
    assert_eq!(f.staff, vec![data_scientist(&w)]);
    assert!(
        f.day >= published_day + FOLLOW_UP_DAYS,
        "{} vs {published_day}",
        f.day
    );
    let it = &w.plan.items[&item];
    assert_eq!(it.performance, Some(2));
    assert!(it.followed_up);
    // its score is in the plan view, as the board reads it
    let reqs = run(&mut w, 3 * DAY);
    assert!(reqs.iter().all(|r| r.kind != JobKind::Performance));
}
