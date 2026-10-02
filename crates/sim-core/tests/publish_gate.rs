//! The CEO publish gate and the failures the sim can see (FEAT-079,
//! ADR-0059; docs/design/mvp-pipeline.md section 5), on the cinqueterre.travel
//! company:
//!
//! - under `ApproveAll` nothing asks for a Publish job before the CEO answers
//!   `Publish`; a deferred or expired approval never publishes and is raised
//!   again at 08:30; the Secretary can never answer it;
//! - `SendBack`, `Kill`, `Autonomous` and the `ApproveMajor` thresholds;
//! - `JobFailed` per reason, the standup timeout, `DeployFailed`;
//! - the escalation default (first `Retry`, later `Kill`);
//! - the work-in-progress limit and one item per writer;
//! - the views: due steps, speech bubbles, who works on what;
//! - a snapshot taken at the gate re-issues nothing.

use sim_core::clock::{hm, SimConfig};
use sim_core::commands::{AutonomyPolicy, Command, JobDigest, JobFailure, Policy, ServerCommand};
use sim_core::ids::{ProjectId, StaffId, TicketId, WorkItemId};
use sim_core::inbox::{
    DelegationPolicy, Priority, ResolvedBy, SecretaryTaskKind, Ticket, TicketKind, TicketOption,
    TicketSpec, TicketStatus,
};
use sim_core::plan::{
    BriefStub, Effect, JobKind, PhaseKind, PhaseState, WorkItemKind, WorkItemStatus, MAX_REVISIONS,
    STANDUP_DUE_MINUTES, WIP_LIMIT,
};
use sim_core::scenarios::{demo_office, demo_office_with_config, DEMO_PROJECT};
use sim_core::staff::{Pose, Spot};
use sim_core::world::utterance_steps;
use sim_core::{Reject, World};

const GIULIA: StaffId = StaffId(1); // writer
const ISABELLA: StaffId = StaffId(2); // writer
const LORENZO: StaffId = StaffId(3); // writer
const SOPHIA: StaffId = StaffId(4); // editor-in-chief
const MARCO: StaffId = StaffId(5); // editor
const SECRETARY: StaffId = StaffId(8);

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
                revision,
                staff,
                ..
            } => Req {
                job_id,
                kind,
                project,
                work_item,
                revision,
                staff,
            },
        })
        .collect()
}

/// Steps until a job of `kind` is requested; returns it. Any other request
/// on the way fails the test.
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

/// Steps `days` game days and returns every job requested on the way.
fn run_days(w: &mut World, days: u64) -> Vec<Req> {
    let n = w.config.steps_per_day() * days;
    run(w, n)
}

/// Steps `n` times and returns every job requested on the way.
fn run(w: &mut World, n: u64) -> Vec<Req> {
    let mut all = Vec::new();
    for _ in 0..n {
        w.step();
        all.extend(drain(w));
    }
    all
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

fn fail(w: &mut World, job_id: u64, reason: JobFailure) {
    w.apply_server(ServerCommand::JobFailed { job_id, reason })
        .expect("job failure accepted");
}

fn brief(writer: StaffId, editor: StaffId, brief_ref: u64) -> BriefStub {
    BriefStub {
        kind: WorkItemKind::Article,
        writer,
        editor,
        brief_ref,
    }
}

fn answer(w: &mut World, ticket: TicketId, option: TicketOption) {
    w.apply(Command::AnswerTicket { ticket, option })
        .unwrap_or_else(|e| panic!("{option:?} on {ticket}: {e}"));
}

fn set_autonomy(w: &mut World, a: AutonomyPolicy) {
    w.apply(Command::SetPolicy(Policy::Autonomy(a))).unwrap();
}

/// Runs to the 09:00 standup and answers it with one brief (Giulia writes,
/// Marco edits). Returns the work item and its first Draft job.
fn standup_to_draft(w: &mut World) -> (WorkItemId, Req) {
    let standup = step_until_job(w, JobKind::Standup, 400);
    w.apply_server(ServerCommand::MeetingOutcome {
        job_id: standup.job_id,
        briefs: vec![brief(GIULIA, MARCO, 77)],
    })
    .expect("outcome accepted");
    let reqs = drain(w);
    assert_eq!(reqs.len(), 1, "{reqs:?}");
    (
        reqs[0].work_item.expect("a draft has a work item"),
        reqs[0].clone(),
    )
}

/// Draft ok, then the review scores `score`. Returns the review job; the
/// review's minimum time has not passed yet.
fn draft_and_review(w: &mut World, draft: &Req, score: u8) -> Req {
    complete(w, draft.job_id, 0);
    let review = step_until_job(w, JobKind::Review, 200);
    complete(w, review.job_id, score);
    review
}

/// Standup → draft → a review of `score`, then steps until the review phase
/// is over (the gate decides in that step). Returns the item and the jobs
/// requested while the review ran out.
fn to_the_gate(w: &mut World, score: u8) -> (WorkItemId, Vec<Req>) {
    let (id, draft) = standup_to_draft(w);
    draft_and_review(w, &draft, score);
    let mut reqs = Vec::new();
    for _ in 0..200 {
        w.step();
        reqs.extend(drain(w));
        if w.plan.items[&id].status != WorkItemStatus::InReview {
            return (id, reqs);
        }
    }
    panic!("the review never ended");
}

fn open_tickets(w: &World, kind: TicketKind) -> Vec<&Ticket> {
    w.tickets
        .values()
        .filter(|t| t.is_open() && t.kind == kind)
        .collect()
}

fn the_open_ticket(w: &World, kind: TicketKind) -> Ticket {
    let open = open_tickets(w, kind);
    assert_eq!(open.len(), 1, "one open {kind:?} ticket: {open:?}");
    open[0].clone()
}

// ---------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------

#[test]
fn approve_all_is_the_default_and_parks_the_item_with_a_ticket() {
    let mut w = fast(1);
    assert_eq!(w.company.policies.autonomy, AutonomyPolicy::ApproveAll);
    let (id, reqs) = to_the_gate(&mut w, 8);
    assert!(reqs.is_empty(), "no job at the gate: {reqs:?}");

    let item = &w.plan.items[&id];
    assert_eq!(item.status, WorkItemStatus::Approved);
    assert!(item.awaiting_approval());
    assert_eq!(item.last_score, Some(8));
    let publish = item.phase().expect("the publish phase is current");
    assert_eq!(
        (publish.kind, publish.state, publish.job),
        (PhaseKind::Publish, PhaseState::Pending, None)
    );
    assert!(w.plan.jobs.is_empty(), "nothing is pending at the gate");
    assert_eq!(w.next_due_step(), None);
    assert_eq!(w.busy_with(GIULIA), None);

    let t = the_open_ticket(&w, TicketKind::PublishApproval);
    assert_eq!(item.tickets, vec![t.id]);
    assert_eq!(t.priority, Priority::High);
    assert_eq!(t.work_item, Some(id));
    assert_eq!(t.project, Some(DEMO_PROJECT));
    assert_eq!(t.from, Some(MARCO), "the editor who approved it asks");
    assert_eq!(
        t.options,
        vec![
            TicketOption::Publish,
            TicketOption::SendBack,
            TicketOption::Kill,
            TicketOption::Defer
        ]
    );
    assert_eq!(t.default_option, TicketOption::Defer);
    assert_eq!(t.deadline_step, t.created_step + w.config.steps_per_day());
    assert_eq!(t.failure, None);

    // a deploy notice for an unmerged item is still refused
    assert!(w
        .apply_server(ServerCommand::DeployLanded { work_item: id })
        .is_err());
    // options of other kinds are not options of this ticket
    for o in [
        TicketOption::Approve,
        TicketOption::Reject,
        TicketOption::Retry,
    ] {
        assert!(matches!(
            w.apply(Command::AnswerTicket {
                ticket: t.id,
                option: o
            }),
            Err(Reject::Invalid(_))
        ));
    }
}

#[test]
fn no_publish_job_exists_before_a_publish_answer() {
    let mut w = fast(2);
    let (id, reqs) = to_the_gate(&mut w, 9);
    assert!(reqs.is_empty());
    // the rest of the working day: nothing asks for a publish
    let later = run(&mut w, 150);
    assert!(
        later.iter().all(|r| r.kind != JobKind::Publish),
        "{later:?}"
    );
    assert!(w.plan.jobs.values().all(|j| j.kind != JobKind::Publish));
    assert!(w.plan.items[&id].awaiting_approval());

    // the CEO says yes: the Publish phase starts, with its job
    let t = the_open_ticket(&w, TicketKind::PublishApproval);
    answer(&mut w, t.id, TicketOption::Publish);
    let reqs = drain(&mut w);
    assert_eq!(reqs.len(), 1, "{reqs:?}");
    assert_eq!(reqs[0].kind, JobKind::Publish);
    assert_eq!(reqs[0].work_item, Some(id));
    let item = &w.plan.items[&id];
    assert_eq!(item.status, WorkItemStatus::Approved);
    assert!(!item.awaiting_approval());
    assert_eq!(item.phase().unwrap().state, PhaseState::Working);
    let t = &w.tickets[&t.id];
    assert_eq!(t.status, TicketStatus::Answered);
    assert_eq!(t.resolved_by, Some(ResolvedBy::Ceo));
    assert_eq!(t.answer, Some(TicketOption::Publish));
    // answered once
    assert!(w
        .apply(Command::AnswerTicket {
            ticket: t.id,
            option: TicketOption::Publish
        })
        .is_err());

    // … and the item goes on as before: merged, deployed, published
    complete(&mut w, reqs[0].job_id, 0);
    run(&mut w, 20);
    assert_eq!(w.plan.items[&id].status, WorkItemStatus::Scheduled);
    w.apply_server(ServerCommand::DeployLanded { work_item: id })
        .unwrap();
    assert_eq!(w.plan.items[&id].status, WorkItemStatus::Published);
    assert!(open_tickets(&w, TicketKind::PublishApproval).is_empty());
}

/// The clock crossed 08:30 in the step that just ran.
fn crossed_morning(w: &World) -> bool {
    let now = w.clock();
    let before = w.config.clock_at(w.step - 1);
    now.minute >= hm(8, 30) && (before.day != now.day || before.minute < hm(8, 30))
}

#[test]
fn an_expired_approval_never_publishes_and_is_raised_again_at_0830() {
    let mut w = fast(3);
    let (id, _) = to_the_gate(&mut w, 8);
    let first = the_open_ticket(&w, TicketKind::PublishApproval);
    let gate_day = w.clock().day;

    // An absent CEO, five more days. Standups come and go (and time out);
    // the item stays parked and nothing is ever published.
    let mut raised: Vec<(u32, u16)> = Vec::new();
    let mut seen = vec![first.id];
    for _ in 0..w.config.steps_per_day() * 5 {
        w.step();
        let reqs = drain(&mut w);
        assert!(reqs.iter().all(|r| r.kind == JobKind::Standup), "{reqs:?}");
        let item = &w.plan.items[&id];
        assert!(item.awaiting_approval(), "parked, never published");
        assert!(w.plan.jobs.values().all(|j| j.work_item != Some(id)));
        let open = open_tickets(&w, TicketKind::PublishApproval);
        assert!(open.len() <= 1, "at most one approval ticket: {open:?}");
        if let Some(t) = open.first() {
            if !seen.contains(&t.id) {
                seen.push(t.id);
                assert_eq!(t.created_step, w.step);
                assert!(crossed_morning(&w), "raised when the clock passed 08:30");
                raised.push((w.clock().day, w.clock().minute));
            }
        }
    }
    // The first ticket expired on the next day at the time it was raised
    // (after 08:30), so the first fresh one is two mornings on; from then on
    // each morning's ticket expires as the next is raised.
    let days: Vec<u32> = raised.iter().map(|(d, _)| *d).collect();
    assert_eq!(
        days,
        (gate_day + 2..=gate_day + 5).collect::<Vec<u32>>(),
        "{raised:?}"
    );
    assert!(raised
        .iter()
        .all(|(_, m)| (hm(8, 30)..hm(8, 34)).contains(m)));
    // every earlier ticket expired with the default, which is Defer
    let item = &w.plan.items[&id];
    assert_eq!(item.tickets, seen);
    for tid in &seen[..seen.len() - 1] {
        let t = &w.tickets[tid];
        assert_eq!(t.status, TicketStatus::Expired);
        assert_eq!(t.resolved_by, Some(ResolvedBy::Default));
        assert_eq!(t.answer, Some(TicketOption::Defer));
    }
    assert!(w.tickets[seen.last().unwrap()].is_open());
    assert_eq!(item.status, WorkItemStatus::Approved);
    assert_eq!(item.published_step, None);

    // the CEO comes back: the latest ticket still publishes
    answer(&mut w, *seen.last().unwrap(), TicketOption::Publish);
    assert_eq!(drain(&mut w)[0].kind, JobKind::Publish);
}

#[test]
fn defer_never_publishes_and_is_raised_again_the_next_morning() {
    let mut w = fast(4);
    let (id, _) = to_the_gate(&mut w, 8);
    let first = the_open_ticket(&w, TicketKind::PublishApproval);
    let day = w.clock().day;
    answer(&mut w, first.id, TicketOption::Defer);
    assert!(drain(&mut w).is_empty(), "Defer starts nothing");
    assert_eq!(w.tickets[&first.id].answer, Some(TicketOption::Defer));
    assert!(w.plan.items[&id].awaiting_approval());
    assert!(open_tickets(&w, TicketKind::PublishApproval).is_empty());

    // nothing until the next 08:30 …
    while !(w.clock().day == day + 1 && w.clock().minute >= hm(8, 30)) {
        assert!(open_tickets(&w, TicketKind::PublishApproval).is_empty());
        w.step();
        assert!(drain(&mut w).iter().all(|r| r.kind != JobKind::Publish));
    }
    // … then a fresh ticket about the same item
    let again = the_open_ticket(&w, TicketKind::PublishApproval);
    assert_ne!(again.id, first.id);
    assert_eq!(again.work_item, Some(id));
    assert_eq!(again.created_step, w.step);
    assert_eq!(again.default_option, TicketOption::Defer);
    assert_eq!(w.plan.items[&id].tickets, vec![first.id, again.id]);
    assert!(w.plan.items[&id].awaiting_approval());
    // deferred again: once more the morning after
    answer(&mut w, again.id, TicketOption::Defer);
    let reqs = run_days(&mut w, 1);
    assert!(reqs.iter().all(|r| r.kind != JobKind::Publish), "{reqs:?}");
    assert_eq!(w.plan.items[&id].tickets.len(), 3);
}

#[test]
fn the_secretary_cannot_answer_under_any_delegation_policy() {
    for policy in [
        DelegationPolicy::Off,
        DelegationPolicy::Low,
        DelegationPolicy::LowAndMedium,
    ] {
        let mut w = fast(5);
        assert_eq!(w.secretary(), Some(SECRETARY));
        w.apply(Command::SetDelegation { policy }).unwrap();
        let (id, _) = to_the_gate(&mut w, 8);
        let t = the_open_ticket(&w, TicketKind::PublishApproval);
        assert!(t.routed_via_secretary, "triaged, but never answered");
        assert_eq!(t.proposed_option, Some(TicketOption::Defer));
        assert!(!w.secretary_may_answer(&t), "{policy:?}");
        // everything the CEO can hand to the Secretary, and a policy change
        w.apply(Command::Delegate {
            task: SecretaryTaskKind::TriageInbox,
        })
        .unwrap();
        w.apply(Command::Delegate {
            task: SecretaryTaskKind::DraftReply { ticket: t.id },
        })
        .unwrap();
        w.apply(Command::SetDelegation {
            policy: DelegationPolicy::LowAndMedium,
        })
        .unwrap();
        let reqs = run(&mut w, 200);
        assert!(reqs.iter().all(|r| r.kind != JobKind::Publish), "{reqs:?}");
        let t = &w.tickets[&t.id];
        assert!(t.is_open(), "{policy:?}: still the CEO's to answer");
        assert!(t.reply_drafted, "the Secretary did draft a reply");
        assert!(w.plan.items[&id].awaiting_approval());
        assert!(w
            .tickets
            .values()
            .filter(|t| t.kind == TicketKind::PublishApproval)
            .all(|t| t.resolved_by != Some(ResolvedBy::Secretary)));
    }
    // by rule, not only by priority
    assert!(TicketKind::PublishApproval.ceo_only());
    assert_eq!(TicketKind::PublishApproval.priority(), Priority::High);
}

#[test]
fn send_back_restarts_draft_with_the_revision_incremented() {
    let mut w = fast(6);
    let (id, _) = to_the_gate(&mut w, 8);
    let t = the_open_ticket(&w, TicketKind::PublishApproval);
    answer(&mut w, t.id, TicketOption::SendBack);
    let reqs = drain(&mut w);
    assert_eq!(reqs.len(), 1, "{reqs:?}");
    assert_eq!(
        (reqs[0].kind, reqs[0].work_item, reqs[0].revision),
        (JobKind::Draft, Some(id), 1)
    );
    assert_eq!(reqs[0].staff, vec![GIULIA]);
    let item = &w.plan.items[&id];
    assert_eq!(item.status, WorkItemStatus::InProgress);
    assert_eq!(item.revision, 1);
    assert_eq!(item.current, 0);
    assert_eq!(item.phases[1].state, PhaseState::Pending, "review again");
    assert_eq!(item.phases[1].result, None);
    assert_eq!(item.phases[2].state, PhaseState::Pending);
    assert_eq!(w.busy_with(GIULIA), Some(id));

    // the new revision goes through review and the gate again
    let review = draft_and_review(&mut w, &reqs[0], 8);
    assert_eq!(review.revision, 1);
    let reqs = run(&mut w, 40);
    assert!(reqs.is_empty(), "parked again: {reqs:?}");
    let again = the_open_ticket(&w, TicketKind::PublishApproval);
    assert_ne!(again.id, t.id);
    assert!(w.plan.items[&id].awaiting_approval());
}

#[test]
fn send_back_is_refused_when_no_revision_is_left() {
    let mut w = fast(7);
    let (id, mut job) = standup_to_draft(&mut w);
    // three failed reviews, then a pass on the last revision
    for rev in 0..MAX_REVISIONS {
        assert_eq!(job.revision, rev);
        draft_and_review(&mut w, &job, 5);
        job = step_until_job(&mut w, JobKind::Draft, 200);
    }
    assert_eq!(job.revision, MAX_REVISIONS);
    draft_and_review(&mut w, &job, 8);
    run(&mut w, 40);
    assert!(w.plan.items[&id].awaiting_approval());
    let t = the_open_ticket(&w, TicketKind::PublishApproval);
    assert_eq!(
        w.apply(Command::AnswerTicket {
            ticket: t.id,
            option: TicketOption::SendBack
        }),
        Err(Reject::Invalid(
            "the item has no revision left: publish it or kill it"
        ))
    );
    assert!(w.tickets[&t.id].is_open());
    assert_eq!(w.plan.items[&id].revision, MAX_REVISIONS);
    answer(&mut w, t.id, TicketOption::Publish);
    assert_eq!(drain(&mut w)[0].kind, JobKind::Publish);
}

#[test]
fn kill_cancels_the_parked_item() {
    let mut w = fast(8);
    let (id, _) = to_the_gate(&mut w, 8);
    let t = the_open_ticket(&w, TicketKind::PublishApproval);
    answer(&mut w, t.id, TicketOption::Kill);
    assert!(drain(&mut w).is_empty());
    assert_eq!(w.plan.items[&id].status, WorkItemStatus::Cancelled);
    // a cancelled item is never asked about again
    let reqs = run_days(&mut w, 2);
    assert!(reqs.iter().all(|r| r.kind == JobKind::Standup), "{reqs:?}");
    assert!(open_tickets(&w, TicketKind::PublishApproval).is_empty());
    assert_eq!(w.plan.items[&id].tickets, vec![t.id]);
}

#[test]
fn autonomous_publishes_as_before() {
    let mut w = fast(9);
    set_autonomy(&mut w, AutonomyPolicy::Autonomous);
    let (id, reqs) = to_the_gate(&mut w, 7);
    assert_eq!(reqs.len(), 1, "{reqs:?}");
    assert_eq!(reqs[0].kind, JobKind::Publish);
    assert_eq!(reqs[0].work_item, Some(id));
    let item = &w.plan.items[&id];
    assert_eq!(item.status, WorkItemStatus::Approved);
    assert!(!item.awaiting_approval());
    assert!(item.tickets.is_empty(), "nobody was asked");
    assert!(w
        .tickets
        .values()
        .all(|t| t.kind != TicketKind::PublishApproval));
}

#[test]
fn approve_major_publishes_only_a_first_draft_scoring_nine() {
    // (score, failed reviews first) → published without asking?
    for (score, revisions, unasked) in [
        (10u8, 0u8, true),
        (9, 0, true),
        (8, 0, false),
        (7, 0, false),
        (9, 1, false),
        (10, 1, false),
    ] {
        let mut w = fast(10);
        set_autonomy(&mut w, AutonomyPolicy::ApproveMajor);
        let (id, mut job) = standup_to_draft(&mut w);
        for _ in 0..revisions {
            draft_and_review(&mut w, &job, 5);
            job = step_until_job(&mut w, JobKind::Draft, 200);
        }
        draft_and_review(&mut w, &job, score);
        let reqs = run(&mut w, 40);
        let item = &w.plan.items[&id];
        let case = format!("score {score}, revision {revisions}");
        assert_eq!(item.revision, revisions, "{case}");
        assert_eq!(item.status, WorkItemStatus::Approved, "{case}");
        if unasked {
            assert_eq!(reqs.len(), 1, "{case}: {reqs:?}");
            assert_eq!(reqs[0].kind, JobKind::Publish, "{case}");
            assert!(open_tickets(&w, TicketKind::PublishApproval).is_empty());
        } else {
            assert!(reqs.is_empty(), "{case}: {reqs:?}");
            assert!(item.awaiting_approval(), "{case}");
            assert_eq!(open_tickets(&w, TicketKind::PublishApproval).len(), 1);
        }
    }
}

#[test]
fn a_policy_change_does_not_release_parked_items() {
    let mut w = fast(11);
    let (id, _) = to_the_gate(&mut w, 9);
    set_autonomy(&mut w, AutonomyPolicy::Autonomous);
    let reqs = run(&mut w, 100);
    assert!(reqs.is_empty(), "{reqs:?}");
    assert!(w.plan.items[&id].awaiting_approval());
    assert_eq!(open_tickets(&w, TicketKind::PublishApproval).len(), 1);
}

// ---------------------------------------------------------------------
// Failures
// ---------------------------------------------------------------------

#[test]
fn a_failed_standup_ends_the_meeting_with_a_ticket_and_retry_requests_it_again() {
    for reason in JobFailure::ALL {
        let mut w = fast(12);
        let standup = step_until_job(&mut w, JobKind::Standup, 400);
        let meeting = *w.meetings.keys().next().expect("the standup is open");
        assert!(w.meetings[&meeting].is_active(w.clock()));
        run(&mut w, 3);

        fail(&mut w, standup.job_id, reason);
        assert!(!w.plan.jobs.contains_key(&standup.job_id));
        let m = &w.meetings[&meeting];
        assert!(!m.is_active(w.clock()), "{reason:?}: the meeting ended");
        assert_eq!(m.job, None);
        assert!(w.plan.items.is_empty());
        let t = the_open_ticket(&w, TicketKind::StandupFailed);
        assert_eq!(t.failure, Some(reason));
        assert_eq!(t.project, Some(DEMO_PROJECT));
        assert_eq!(t.from, Some(SOPHIA), "the project lead");
        assert_eq!(t.work_item, None);
        assert_eq!(t.priority, Priority::High);
        assert_eq!(t.options, vec![TicketOption::Retry, TicketOption::Skip]);
        assert_eq!(t.default_option, TicketOption::Skip);
        assert_eq!(t.deadline_step, w.step + w.config.steps_per_day());
        // the job is gone: neither an outcome nor a second failure applies
        assert!(w
            .apply_server(ServerCommand::MeetingOutcome {
                job_id: standup.job_id,
                briefs: vec![],
            })
            .is_err());
        assert!(w
            .apply_server(ServerCommand::JobFailed {
                job_id: standup.job_id,
                reason,
            })
            .is_err());

        // Retry: a standup again, now, with a new job and a new meeting
        answer(&mut w, t.id, TicketOption::Retry);
        let reqs = drain(&mut w);
        assert_eq!(reqs.len(), 1, "{reqs:?}");
        let again = &reqs[0];
        assert_eq!(again.kind, JobKind::Standup);
        assert_eq!(again.project, DEMO_PROJECT);
        assert_ne!(again.job_id, standup.job_id);
        assert_eq!(again.staff, standup.staff, "the same team");
        let pending = w.plan.jobs[&again.job_id];
        let m2 = pending.meeting.expect("a standup job has a meeting");
        assert_ne!(m2, meeting);
        assert!(w.meetings[&m2].is_active(w.clock()));
        assert_eq!(w.meetings[&m2].job, Some(again.job_id));
        assert_eq!(w.meetings[&m2].start, w.clock().minute);
        // … and it works like any standup
        w.apply_server(ServerCommand::MeetingOutcome {
            job_id: again.job_id,
            briefs: vec![brief(GIULIA, MARCO, 5)],
        })
        .unwrap();
        assert_eq!(drain(&mut w)[0].kind, JobKind::Draft);
    }
}

#[test]
fn a_standup_retry_is_refused_while_one_is_running() {
    let mut w = fast(13);
    let standup = step_until_job(&mut w, JobKind::Standup, 400);
    fail(&mut w, standup.job_id, JobFailure::Model);
    let first = the_open_ticket(&w, TicketKind::StandupFailed);
    answer(&mut w, first.id, TicketOption::Retry);
    let running = drain(&mut w).remove(0);
    assert!(w.plan.jobs.contains_key(&running.job_id));
    // a second ticket about the same project while the retried standup runs
    let stale = standup_ticket(&mut w);
    let h = w.hash();
    assert_eq!(
        w.apply(Command::AnswerTicket {
            ticket: stale,
            option: TicketOption::Retry
        }),
        Err(Reject::Invalid(
            "a standup of this project is already running"
        ))
    );
    assert_eq!(w.hash(), h, "a refused answer changes nothing");
    answer(&mut w, stale, TicketOption::Skip);
    assert!(drain(&mut w).is_empty(), "Skip holds no standup");
    assert!(w.plan.jobs.contains_key(&running.job_id));
}

/// A `StandupFailed` ticket out of nowhere: its `Retry` is the test's way to
/// hold a standup at any time of day.
fn standup_ticket(w: &mut World) -> TicketId {
    w.raise_ticket(TicketSpec {
        kind: TicketKind::StandupFailed,
        project: Some(DEMO_PROJECT),
        from: None,
        role: None,
        amount_cents: 0,
        work_item: None,
    })
}

/// Holds a standup now and returns its job.
fn standup_now(w: &mut World) -> Req {
    let t = standup_ticket(w);
    answer(w, t, TicketOption::Retry);
    let reqs = drain(w);
    assert_eq!(reqs.len(), 1, "{reqs:?}");
    assert_eq!(reqs[0].kind, JobKind::Standup);
    reqs[0].clone()
}

#[test]
fn the_standup_timeout_raises_the_ticket_instead_of_dropping_the_job() {
    let mut w = fast(14);
    let standup = step_until_job(&mut w, JobKind::Standup, 400);
    let requested = w.step;
    // nobody answers for an hour of game time
    while w.plan.jobs.contains_key(&standup.job_id) {
        assert!(open_tickets(&w, TicketKind::StandupFailed).is_empty());
        w.step();
        assert!(w.step < requested + 100, "the standup never timed out");
    }
    assert_eq!(w.clock().minute, hm(10, 0), "60 game minutes after 09:00");
    let t = the_open_ticket(&w, TicketKind::StandupFailed);
    assert_eq!(t.failure, Some(JobFailure::Timeout));
    assert_eq!(t.created_step, w.step);
    assert_eq!(t.default_option, TicketOption::Skip);
    assert!(w.meetings.values().all(|m| m.job.is_none()));
    // a late outcome is refused
    assert!(w
        .apply_server(ServerCommand::MeetingOutcome {
            job_id: standup.job_id,
            briefs: vec![],
        })
        .is_err());

    // Skip by default a day later; meanwhile tomorrow's standup is held
    let mut standups = 0;
    let deadline = t.deadline_step;
    while w.step <= deadline {
        w.step();
        for r in drain(&mut w) {
            assert_eq!(r.kind, JobKind::Standup);
            standups += 1;
            w.apply_server(ServerCommand::MeetingOutcome {
                job_id: r.job_id,
                briefs: vec![],
            })
            .unwrap();
        }
    }
    assert_eq!(standups, 1, "the default (Skip) held no extra standup");
    let t = &w.tickets[&t.id];
    assert_eq!(t.status, TicketStatus::Expired);
    assert_eq!(t.answer, Some(TicketOption::Skip));
    assert!(open_tickets(&w, TicketKind::StandupFailed).is_empty());
}

#[test]
fn a_failed_work_item_job_blocks_with_the_ticket_its_reason_calls_for() {
    for reason in JobFailure::ALL {
        let expect = match reason {
            JobFailure::NeedsMedia => TicketKind::NeedsMedia,
            JobFailure::NeedsPage => TicketKind::NeedsPage,
            _ => TicketKind::Escalation,
        };
        let mut w = fast(15);
        let (id, draft) = standup_to_draft(&mut w);
        fail(&mut w, draft.job_id, reason);
        let item = &w.plan.items[&id];
        assert_eq!(item.status, WorkItemStatus::Blocked, "{reason:?}");
        assert_eq!(item.phase().unwrap().state, PhaseState::Blocked);
        assert!(w.plan.jobs.is_empty());
        assert_eq!(item.tickets.len(), 1);
        let t = w.tickets[&item.tickets[0]].clone();
        assert_eq!(t.kind, expect, "{reason:?}");
        assert_eq!(t.failure, Some(reason));
        assert_eq!(t.work_item, Some(id));
        assert_eq!(t.priority, Priority::High);
        assert!(t.is_open());
        assert_eq!(t.options, vec![TicketOption::Retry, TicketOption::Kill]);
        match expect {
            // missing media or a missing page does not fix itself
            TicketKind::NeedsMedia | TicketKind::NeedsPage => {
                assert_eq!(t.default_option, TicketOption::Kill);
                assert_eq!(t.deadline_step, w.step + 2 * w.config.steps_per_day());
                assert_eq!(item.escalations, 0);
            }
            _ => {
                assert_eq!(
                    t.default_option,
                    TicketOption::Retry,
                    "the first escalation"
                );
                assert_eq!(t.deadline_step, w.step + w.config.steps_per_day());
                assert_eq!(item.escalations, 1);
            }
        }
        // the job failed once
        assert!(w
            .apply_server(ServerCommand::JobFailed {
                job_id: draft.job_id,
                reason,
            })
            .is_err());
        assert!(w
            .apply_server(ServerCommand::JobCompleted {
                job_id: draft.job_id,
                digest: JobDigest {
                    ok: true,
                    score: 0,
                    words: 1,
                    qa_defects: 0,
                    artifact_sha: [0; 16],
                },
            })
            .is_err());
        // Retry restarts the phase with a new job for the same revision
        let ticket = t.id;
        answer(&mut w, ticket, TicketOption::Retry);
        let reqs = drain(&mut w);
        assert_eq!(reqs.len(), 1, "{reqs:?}");
        assert_eq!(
            (reqs[0].kind, reqs[0].work_item, reqs[0].revision),
            (JobKind::Draft, Some(id), 0)
        );
        assert_ne!(reqs[0].job_id, draft.job_id);
        assert_eq!(w.plan.items[&id].status, WorkItemStatus::InProgress);
    }
    // an unknown job cannot fail
    let mut w = fast(15);
    assert_eq!(
        w.apply_server(ServerCommand::JobFailed {
            job_id: 99,
            reason: JobFailure::Model,
        }),
        Err(Reject::Invalid("no pending job with that id"))
    );
}

#[test]
fn needs_media_is_killed_by_default_after_two_days() {
    let mut w = fast(16);
    let (id, draft) = standup_to_draft(&mut w);
    fail(&mut w, draft.job_id, JobFailure::NeedsMedia);
    let t = the_open_ticket(&w, TicketKind::NeedsMedia);
    let until_deadline = t.deadline_step - w.step;
    let reqs = run(&mut w, until_deadline - 1);
    assert!(reqs.iter().all(|r| r.kind == JobKind::Standup), "{reqs:?}");
    assert_eq!(w.plan.items[&id].status, WorkItemStatus::Blocked);
    run(&mut w, 2);
    assert_eq!(w.plan.items[&id].status, WorkItemStatus::Cancelled);
    assert_eq!(w.tickets[&t.id].answer, Some(TicketOption::Kill));
}

#[test]
fn job_completed_not_ok_still_blocks() {
    let mut w = fast(17);
    let (id, draft) = standup_to_draft(&mut w);
    w.apply_server(ServerCommand::JobCompleted {
        job_id: draft.job_id,
        digest: JobDigest {
            ok: false,
            score: 0,
            words: 0,
            qa_defects: 0,
            artifact_sha: [0; 16],
        },
    })
    .unwrap();
    assert_eq!(w.plan.items[&id].status, WorkItemStatus::Blocked);
    let t = the_open_ticket(&w, TicketKind::Escalation);
    assert_eq!(t.failure, None, "the old command carries no reason");
    assert_eq!(t.default_option, TicketOption::Retry);
}

/// Drives an item to `Scheduled` (merged, waiting for its deploy).
fn to_scheduled(w: &mut World) -> WorkItemId {
    set_autonomy(w, AutonomyPolicy::Autonomous);
    let (id, reqs) = to_the_gate(w, 8);
    complete(w, reqs[0].job_id, 0);
    run(w, 20);
    assert_eq!(w.plan.items[&id].status, WorkItemStatus::Scheduled);
    id
}

#[test]
fn deploy_failed_blocks_with_a_ticket_and_retry_requests_publish_again() {
    let mut w = fast(18);
    // only a merged item can fail to deploy
    let (id, draft) = standup_to_draft(&mut w);
    assert!(w
        .apply_server(ServerCommand::DeployFailed { work_item: id })
        .is_err());
    assert!(w
        .apply_server(ServerCommand::DeployFailed {
            work_item: WorkItemId(99)
        })
        .is_err());
    // (finish this one through the gate)
    set_autonomy(&mut w, AutonomyPolicy::Autonomous);
    draft_and_review(&mut w, &draft, 8);
    let publish = step_until_job(&mut w, JobKind::Publish, 200);
    complete(&mut w, publish.job_id, 0);
    run(&mut w, 20);
    assert_eq!(w.plan.items[&id].status, WorkItemStatus::Scheduled);

    w.apply_server(ServerCommand::DeployFailed { work_item: id })
        .unwrap();
    let item = &w.plan.items[&id];
    assert_eq!(item.status, WorkItemStatus::Blocked);
    assert_eq!(item.phase().unwrap().kind, PhaseKind::Publish);
    assert_eq!(item.phase().unwrap().state, PhaseState::Blocked);
    assert_eq!(item.escalations, 0, "a failed deploy is not an escalation");
    let t = the_open_ticket(&w, TicketKind::DeployFailed);
    assert_eq!(item.tickets.last(), Some(&t.id));
    assert_eq!(t.work_item, Some(id));
    assert_eq!(t.priority, Priority::High);
    assert_eq!(
        t.options,
        vec![TicketOption::Retry, TicketOption::Acknowledge]
    );
    assert_eq!(t.default_option, TicketOption::Acknowledge);
    assert_eq!(t.deadline_step, w.step + w.config.steps_per_day());
    // blocked: neither notice applies now
    assert!(w
        .apply_server(ServerCommand::DeployFailed { work_item: id })
        .is_err());
    assert!(w
        .apply_server(ServerCommand::DeployLanded { work_item: id })
        .is_err());

    // Retry: the Publish job again (the executor's merge is idempotent)
    answer(&mut w, t.id, TicketOption::Retry);
    let reqs = drain(&mut w);
    assert_eq!(reqs.len(), 1, "{reqs:?}");
    assert_eq!(
        (reqs[0].kind, reqs[0].work_item),
        (JobKind::Publish, Some(id))
    );
    assert_ne!(reqs[0].job_id, publish.job_id);
    assert_eq!(w.plan.items[&id].status, WorkItemStatus::Approved);
    complete(&mut w, reqs[0].job_id, 0);
    run(&mut w, 20);
    assert_eq!(w.plan.items[&id].status, WorkItemStatus::Scheduled);
    w.apply_server(ServerCommand::DeployLanded { work_item: id })
        .unwrap();
    assert_eq!(w.plan.items[&id].status, WorkItemStatus::Published);
}

#[test]
fn an_acknowledged_deploy_failure_waits_for_the_next_deploy() {
    let mut w = fast(19);
    let id = to_scheduled(&mut w);
    w.apply_server(ServerCommand::DeployFailed { work_item: id })
        .unwrap();
    let t = the_open_ticket(&w, TicketKind::DeployFailed);
    // nobody answers: Acknowledge by default a day later, and no job
    let reqs = run_days(&mut w, 1);
    assert!(reqs.iter().all(|r| r.kind == JobKind::Standup), "{reqs:?}");
    let t = &w.tickets[&t.id];
    assert_eq!(t.status, TicketStatus::Expired);
    assert_eq!(t.answer, Some(TicketOption::Acknowledge));
    // the merge stands: the item lands with the next deploy that carries it
    let item = &w.plan.items[&id];
    assert_eq!(item.status, WorkItemStatus::Scheduled);
    assert_eq!(item.phase().unwrap().state, PhaseState::Done);
    w.apply_server(ServerCommand::DeployLanded { work_item: id })
        .unwrap();
    assert_eq!(w.plan.items[&id].status, WorkItemStatus::Published);
}

// ---------------------------------------------------------------------
// Escalation default
// ---------------------------------------------------------------------

#[test]
fn the_first_escalation_defaults_to_retry_and_later_ones_to_kill() {
    let mut w = fast(20);
    let (id, draft) = standup_to_draft(&mut w);
    fail(&mut w, draft.job_id, JobFailure::Timeout);
    let first = the_open_ticket(&w, TicketKind::Escalation);
    assert_eq!(first.default_option, TicketOption::Retry);
    assert_eq!(first.proposed_option, Some(TicketOption::Retry));
    assert_eq!(w.plan.items[&id].escalations, 1);

    // nobody answers: a day later the default retries the draft
    let mut redraft = None;
    while w.step <= first.deadline_step {
        w.step();
        for r in drain(&mut w) {
            if r.kind == JobKind::Draft {
                redraft = Some(r);
            }
        }
    }
    let redraft = redraft.expect("the default retried the draft");
    assert_eq!((redraft.work_item, redraft.revision), (Some(id), 0));
    assert_eq!(w.tickets[&first.id].status, TicketStatus::Expired);
    assert_eq!(w.tickets[&first.id].answer, Some(TicketOption::Retry));
    assert_eq!(w.plan.items[&id].status, WorkItemStatus::InProgress);

    // it fails again: the second escalation defaults to Kill
    fail(&mut w, redraft.job_id, JobFailure::Model);
    let second = the_open_ticket(&w, TicketKind::Escalation);
    assert_ne!(second.id, first.id);
    assert_eq!(second.default_option, TicketOption::Kill);
    assert_eq!(w.plan.items[&id].escalations, 2);
    assert_eq!(w.plan.items[&id].tickets, vec![first.id, second.id]);
    while w.step <= second.deadline_step {
        w.step();
        assert!(drain(&mut w).iter().all(|r| r.kind == JobKind::Standup));
    }
    assert_eq!(w.plan.items[&id].status, WorkItemStatus::Cancelled);
    assert_eq!(w.tickets[&second.id].answer, Some(TicketOption::Kill));
}

#[test]
fn an_explicit_retry_also_counts_as_the_first_escalation() {
    let mut w = fast(21);
    let (id, draft) = standup_to_draft(&mut w);
    fail(&mut w, draft.job_id, JobFailure::InvalidOutput);
    let first = the_open_ticket(&w, TicketKind::Escalation);
    answer(&mut w, first.id, TicketOption::Retry);
    let redraft = drain(&mut w).remove(0);
    // the revision cap is an escalation too: the second one of this item
    let mut job = redraft;
    for _ in 0..=MAX_REVISIONS {
        draft_and_review(&mut w, &job, 3);
        let reqs = run(&mut w, 40);
        match reqs.into_iter().find(|r| r.kind == JobKind::Draft) {
            Some(next) => job = next,
            None => break,
        }
    }
    assert_eq!(w.plan.items[&id].status, WorkItemStatus::Blocked);
    assert_eq!(w.plan.items[&id].revision, MAX_REVISIONS);
    let second = the_open_ticket(&w, TicketKind::Escalation);
    assert_eq!(second.default_option, TicketOption::Kill);
    assert_eq!(second.failure, None);
}

// ---------------------------------------------------------------------
// Invariants: work in progress, one item per writer
// ---------------------------------------------------------------------

#[test]
fn a_standup_cannot_commission_beyond_the_wip_limit() {
    let mut w = fast(22);
    let standup = step_until_job(&mut w, JobKind::Standup, 400);
    let four = vec![
        brief(GIULIA, MARCO, 1),
        brief(ISABELLA, MARCO, 2),
        brief(LORENZO, MARCO, 3),
        brief(SOPHIA, MARCO, 4),
    ];
    assert_eq!(WIP_LIMIT, 3);
    let h = w.hash();
    assert_eq!(
        w.apply_server(ServerCommand::MeetingOutcome {
            job_id: standup.job_id,
            briefs: four.clone(),
        }),
        Err(Reject::Limit("work in progress (open items per project)"))
    );
    assert_eq!(w.hash(), h, "a refused outcome changes nothing");
    assert!(w.plan.jobs.contains_key(&standup.job_id), "still pending");
    // exactly the limit is fine
    w.apply_server(ServerCommand::MeetingOutcome {
        job_id: standup.job_id,
        briefs: four[..3].to_vec(),
    })
    .unwrap();
    assert_eq!(w.open_items(DEMO_PROJECT), 3);
    assert_eq!(drain(&mut w).len(), 3);
}

#[test]
fn parked_items_count_so_an_absent_ceo_stops_new_commissions_and_loses_nothing() {
    let mut w = fast(23);
    // day 0: three articles reach the gate and park
    let standup = step_until_job(&mut w, JobKind::Standup, 400);
    w.apply_server(ServerCommand::MeetingOutcome {
        job_id: standup.job_id,
        briefs: vec![
            brief(GIULIA, MARCO, 1),
            brief(ISABELLA, MARCO, 2),
            brief(LORENZO, SOPHIA, 3),
        ],
    })
    .unwrap();
    let drafts = drain(&mut w);
    for d in &drafts {
        complete(&mut w, d.job_id, 0);
    }
    let mut reviews = Vec::new();
    while reviews.len() < 3 {
        w.step();
        reviews.extend(drain(&mut w));
    }
    for r in &reviews {
        assert_eq!(r.kind, JobKind::Review);
        complete(&mut w, r.job_id, 8);
    }
    assert!(run(&mut w, 40).is_empty());
    let parked = |w: &World| {
        w.plan
            .items
            .values()
            .filter(|i| i.awaiting_approval())
            .count()
    };
    assert_eq!(parked(&w), 3);
    assert_eq!(w.open_items(DEMO_PROJECT), 3);

    // day 1: the desk is full. Even one more brief is refused; an empty
    // outcome is the standup's honest answer.
    let next = step_until_job(&mut w, JobKind::Standup, 700);
    assert_eq!(
        w.apply_server(ServerCommand::MeetingOutcome {
            job_id: next.job_id,
            briefs: vec![brief(SOPHIA, MARCO, 4)],
        }),
        Err(Reject::Limit("work in progress (open items per project)"))
    );
    w.apply_server(ServerCommand::MeetingOutcome {
        job_id: next.job_id,
        briefs: vec![],
    })
    .unwrap();
    // … and nothing was lost: the three are still parked, a week later
    let week = run_days(&mut w, 7);
    assert!(week.iter().all(|r| r.kind == JobKind::Standup), "{week:?}");
    assert_eq!(parked(&w), 3);
    assert_eq!(w.plan.items.len(), 3);
    assert_eq!(open_tickets(&w, TicketKind::PublishApproval).len(), 3);

    // the CEO returns and publishes one: room for one commission again
    let t = open_tickets(&w, TicketKind::PublishApproval)[0].clone();
    answer(&mut w, t.id, TicketOption::Publish);
    let publish = drain(&mut w).remove(0);
    complete(&mut w, publish.job_id, 0);
    run(&mut w, 20);
    let id = t.work_item.unwrap();
    assert_eq!(w.plan.items[&id].status, WorkItemStatus::Scheduled);
    assert_eq!(w.open_items(DEMO_PROJECT), 3, "merged is not closed yet");
    w.apply_server(ServerCommand::DeployLanded { work_item: id })
        .unwrap();
    assert_eq!(w.open_items(DEMO_PROJECT), 2);
    let standup = step_until_job(&mut w, JobKind::Standup, 700);
    let writer = w.plan.items[&id].writer().unwrap();
    w.apply_server(ServerCommand::MeetingOutcome {
        job_id: standup.job_id,
        briefs: vec![brief(writer, MARCO, 5)],
    })
    .unwrap();
    assert_eq!(w.open_items(DEMO_PROJECT), 3);
}

#[test]
fn a_writer_has_at_most_one_item_in_the_writing_loop() {
    let mut w = fast(24);
    let standup = step_until_job(&mut w, JobKind::Standup, 400);
    // the same writer twice in one outcome
    assert_eq!(
        w.apply_server(ServerCommand::MeetingOutcome {
            job_id: standup.job_id,
            briefs: vec![brief(GIULIA, MARCO, 1), brief(GIULIA, SOPHIA, 2)],
        }),
        Err(Reject::Occupied(
            "the writer already has an item in the writing loop"
        ))
    );
    w.apply_server(ServerCommand::MeetingOutcome {
        job_id: standup.job_id,
        briefs: vec![brief(GIULIA, MARCO, 1)],
    })
    .unwrap();
    let draft = drain(&mut w).remove(0);
    let id = draft.work_item.unwrap();
    assert_eq!(w.writing(GIULIA), Some(id));
    assert_eq!(w.writing(ISABELLA), None);

    // Still hers while it is drafted, reviewed (a failed review comes back
    // to her), blocked, and parked at the gate (a SendBack comes back too).
    let refused = |w: &mut World, when: &str| {
        let s = standup_now(w);
        assert_eq!(
            w.apply_server(ServerCommand::MeetingOutcome {
                job_id: s.job_id,
                briefs: vec![brief(GIULIA, SOPHIA, 9)],
            }),
            Err(Reject::Occupied(
                "the writer already has an item in the writing loop"
            )),
            "{when}"
        );
        // (an empty outcome ends that standup)
        w.apply_server(ServerCommand::MeetingOutcome {
            job_id: s.job_id,
            briefs: vec![],
        })
        .unwrap();
    };
    refused(&mut w, "drafting");
    fail(&mut w, draft.job_id, JobFailure::Model);
    refused(&mut w, "blocked");
    let t = the_open_ticket(&w, TicketKind::Escalation);
    answer(&mut w, t.id, TicketOption::Retry);
    let redraft = drain(&mut w).remove(0);
    draft_and_review(&mut w, &redraft, 8);
    refused(&mut w, "in review");
    run(&mut w, 40);
    assert!(w.plan.items[&id].awaiting_approval());
    refused(&mut w, "parked at the gate");

    // past the gate she is free for the next article
    let t = the_open_ticket(&w, TicketKind::PublishApproval);
    answer(&mut w, t.id, TicketOption::Publish);
    drain(&mut w);
    assert_eq!(w.writing(GIULIA), None);
    let s = standup_now(&mut w);
    w.apply_server(ServerCommand::MeetingOutcome {
        job_id: s.job_id,
        briefs: vec![brief(GIULIA, SOPHIA, 9)],
    })
    .unwrap();
    // at every moment: no writer with two active drafts
    let drafting = |staff: StaffId| {
        w.plan
            .items
            .values()
            .filter(|i| {
                !i.status.is_closed()
                    && i.phase()
                        .is_some_and(|p| p.kind == PhaseKind::Draft && p.assignee == Some(staff))
            })
            .count()
    };
    assert_eq!(drafting(GIULIA), 1);
}

// ---------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------

#[test]
fn next_due_step_of_a_pending_standup_draft_and_review() {
    // the default clock: 12,000 steps a day, so the numbers are round
    let mut w = demo_office(25);
    assert_eq!(w.next_due_step(), None, "nothing pending");
    let h0 = w.hash();
    assert_eq!(w.next_due_step(), None);
    assert_eq!(w.hash(), h0, "a view");

    // standup: 30 game minutes (250 steps) after the request at 09:00
    let standup = step_until_job(&mut w, JobKind::Standup, 2_000);
    assert_eq!(w.step, 1_000);
    assert_eq!(w.minutes_to_steps(STANDUP_DUE_MINUTES), 250);
    assert_eq!(w.next_due_step(), Some(1_250));
    assert_eq!(w.job_due_step(&w.plan.jobs[&standup.job_id]), 1_250);
    run(&mut w, 100);
    assert_eq!(w.next_due_step(), Some(1_250), "it does not move");

    // draft: its phase's minimum (2 game hours = 1,000 steps)
    w.apply_server(ServerCommand::MeetingOutcome {
        job_id: standup.job_id,
        briefs: vec![brief(GIULIA, MARCO, 1), brief(ISABELLA, SOPHIA, 2)],
    })
    .unwrap();
    let drafts = drain(&mut w);
    let started = w.step;
    assert_eq!(started, 1_100);
    assert_eq!(w.next_due_step(), Some(started + 1_000));
    for d in &drafts {
        assert_eq!(w.job_due_step(&w.plan.jobs[&d.job_id]), started + 1_000);
        let id = d.work_item.unwrap();
        assert_eq!(
            w.plan.items[&id].phases[0].min_done_step,
            Some(started + 1_000)
        );
    }
    // an answered job is no longer pending, so no longer due
    complete(&mut w, drafts[0].job_id, 0);
    assert_eq!(w.next_due_step(), Some(started + 1_000), "the other draft");
    complete(&mut w, drafts[1].job_id, 0);
    assert_eq!(w.next_due_step(), None);

    // review: 1 game hour (500 steps) from when the draft phase ended
    let mut reviews = Vec::new();
    while reviews.len() < 2 {
        w.step();
        reviews.extend(drain(&mut w));
    }
    let review_start = started + 1_000;
    assert_eq!(w.step, review_start);
    assert_eq!(w.next_due_step(), Some(review_start + 500));
    let h = w.hash();
    let again = w.next_due_step();
    assert_eq!((again, w.hash()), (Some(review_start + 500), h));

    // the earliest of several: a publish (15 minutes = 125 steps) beats a review
    set_autonomy(&mut w, AutonomyPolicy::Autonomous);
    complete(&mut w, reviews[0].job_id, 9);
    let publish = step_until_job(&mut w, JobKind::Publish, 600);
    let publish_start = w.step;
    assert_eq!(publish_start, review_start + 500);
    assert_eq!(
        w.job_due_step(&w.plan.jobs[&publish.job_id]),
        publish_start + 125
    );
    assert_eq!(
        w.next_due_step(),
        Some(review_start + 500),
        "the unanswered review is overdue and comes first"
    );
    complete(&mut w, reviews[1].job_id, 9);
    assert_eq!(w.next_due_step(), Some(publish_start + 125));
}

#[test]
fn utterances_set_the_speak_fields_and_the_bubbles() {
    let mut w = demo_office(26);
    while w.clock().minute < hm(9, 10) {
        w.step();
    }
    let m = *w.meetings.keys().next().expect("standup open");
    assert!(w.render_state().bubbles.is_empty(), "nobody spoke yet");
    let seated: Vec<StaffId> = w
        .staff
        .values()
        .filter(|s| s.path.is_none() && matches!(s.spot, Some(Spot::MeetingSeat { .. })))
        .map(|s| s.id)
        .collect();
    assert!(seated.len() >= 2, "{seated:?}");

    let from = w.step;
    w.apply_server(ServerCommand::Utterance {
        meeting: m,
        seq: 0,
        speaker: seated[0],
        chars: 90,
    })
    .unwrap();
    let meeting = &w.meetings[&m];
    assert_eq!(meeting.speaker, Some(seated[0]));
    assert_eq!(meeting.speak_from, from);
    assert_eq!(meeting.speak_chars, 90);
    assert_eq!(meeting.speak_until, from + utterance_steps(90));
    assert_eq!(meeting.next_seq, 1);
    let rs = w.render_state();
    assert_eq!(rs.bubbles.len(), 1);
    let b = rs.bubbles[0];
    assert_eq!(
        (
            b.meeting,
            b.seq,
            b.speaker,
            b.started_step,
            b.until_step,
            b.chars
        ),
        (m, 0, seated[0], from, from + utterance_steps(90), 90)
    );
    // the speaker talks, the others listen
    let pose = |rs: &sim_core::RenderState, id: StaffId| {
        rs.staff.iter().find(|s| s.id == id).map(|s| s.pose)
    };
    assert_eq!(pose(&rs, seated[0]), Some(Pose::Talk));
    assert_eq!(pose(&rs, seated[1]), Some(Pose::Listen));

    // a second turn replaces the first: seq 1, new timing
    run(&mut w, 20);
    let from2 = w.step;
    w.apply_server(ServerCommand::Utterance {
        meeting: m,
        seq: 1,
        speaker: seated[1],
        chars: 30,
    })
    .unwrap();
    let rs = w.render_state();
    assert_eq!(rs.bubbles.len(), 1);
    let b = rs.bubbles[0];
    assert_eq!(
        (b.seq, b.speaker, b.started_step, b.until_step, b.chars),
        (1, seated[1], from2, from2 + utterance_steps(30), 30)
    );
    // when the turn is over the bubble is gone
    run(&mut w, utterance_steps(30));
    assert_eq!(w.meetings[&m].speaker, None);
    assert!(w.render_state().bubbles.is_empty());
    // only numbers went in: the render state round-trips as bytes
    let bytes = postcard::to_allocvec(&rs).unwrap();
    assert_eq!(
        postcard::from_bytes::<sim_core::RenderState>(&bytes).unwrap(),
        rs
    );
}

#[test]
fn staff_render_state_carries_the_work_item_and_typing_means_a_job() {
    let mut w = demo_office(27);
    let (id, draft) = standup_to_draft_default(&mut w);
    // let everyone walk back to their desks
    run(&mut w, 400);
    let rs = w.render_state();
    let of = |rs: &sim_core::RenderState, s: StaffId| {
        rs.staff
            .iter()
            .find(|r| r.id == s)
            .cloned()
            .unwrap_or_else(|| panic!("{s} on site"))
    };
    let giulia = of(&rs, GIULIA);
    assert_eq!(giulia.work_item, Some(id), "she drafts it");
    assert_eq!(giulia.pose, Pose::Type);
    assert!(giulia.seated_at.is_some());
    // nobody else has a job: seated, not typing
    let marco = of(&rs, MARCO);
    assert_eq!(marco.work_item, None);
    assert_eq!(marco.pose, Pose::Sit);
    for s in &rs.staff {
        assert_eq!(s.work_item, w.busy_with(s.id));
        assert_eq!(
            s.pose == Pose::Type,
            s.work_item.is_some() && s.path.is_none(),
            "{} types exactly when at the desk with a job",
            s.id
        );
    }
    // the draft goes to review: the editor types, the writer does not
    complete(&mut w, draft.job_id, 0);
    step_until_job(&mut w, JobKind::Review, 2_000);
    let rs = w.render_state();
    assert_eq!(of(&rs, MARCO).work_item, Some(id));
    assert_eq!(of(&rs, MARCO).pose, Pose::Type);
    assert_eq!(of(&rs, GIULIA).work_item, None);
    assert_eq!(of(&rs, GIULIA).pose, Pose::Sit);
}

/// [`standup_to_draft`] on the default clock (the standup is 1,000 steps in).
fn standup_to_draft_default(w: &mut World) -> (WorkItemId, Req) {
    let standup = step_until_job(w, JobKind::Standup, 2_000);
    w.apply_server(ServerCommand::MeetingOutcome {
        job_id: standup.job_id,
        briefs: vec![brief(GIULIA, MARCO, 77)],
    })
    .expect("outcome accepted");
    let reqs = drain(w);
    (reqs[0].work_item.unwrap(), reqs[0].clone())
}

// ---------------------------------------------------------------------
// Snapshot at the gate
// ---------------------------------------------------------------------

#[test]
fn a_snapshot_taken_at_the_gate_restores_and_reissues_nothing() {
    let mut w = fast(28);
    let (id, _) = to_the_gate(&mut w, 8);
    assert!(w.plan.items[&id].awaiting_approval());
    assert!(w.effects().is_empty());
    let hash = w.hash();

    let mut back = World::from_snapshot(&w.snapshot(), None).expect("restores");
    assert_eq!(back.hash(), hash);
    assert_eq!(
        back.reissue_pending_jobs(),
        0,
        "an item at the gate has no job"
    );
    assert!(back.effects().is_empty());
    assert_eq!(back.hash(), hash);
    assert!(back.plan.items[&id].awaiting_approval());
    let t = the_open_ticket(&back, TicketKind::PublishApproval);

    // the two worlds stay one world: through the answer and the publish job
    for world in [&mut w, &mut back] {
        answer(world, t.id, TicketOption::Publish);
    }
    assert_eq!(drain(&mut w), drain(&mut back));
    assert_eq!(w.hash(), back.hash());
    // … and now there is exactly the Publish job to re-issue
    let mut again = World::from_snapshot(&back.snapshot(), None).unwrap();
    assert_eq!(again.reissue_pending_jobs(), 1);
    let reqs = drain(&mut again);
    assert_eq!(
        (reqs[0].kind, reqs[0].work_item),
        (JobKind::Publish, Some(id))
    );
    assert_eq!(again.hash(), back.hash());
}

#[test]
fn a_snapshot_with_a_blocked_item_and_a_failed_standup_reissues_nothing() {
    let mut w = fast(29);
    let (id, draft) = standup_to_draft(&mut w);
    fail(&mut w, draft.job_id, JobFailure::NeedsPage);
    assert_eq!(w.plan.items[&id].status, WorkItemStatus::Blocked);
    let mut back = World::from_snapshot(&w.snapshot(), None).unwrap();
    assert_eq!(back.reissue_pending_jobs(), 0);
    assert_eq!(back.hash(), w.hash());
    // the ticket and its reason survive the round trip
    let t = the_open_ticket(&back, TicketKind::NeedsPage);
    assert_eq!(t.failure, Some(JobFailure::NeedsPage));
}
