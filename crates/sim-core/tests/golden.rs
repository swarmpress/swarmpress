//! Golden determinism: the scripted 50,000-step run of the demo office must
//! hash to the same value on every platform, natively and in wasm
//! (`crates/client-wasm/tests/golden_wasm.rs` asserts the same constant).
//!
//! If a deliberate sim change moves the hash, regenerate with
//! `cargo test -p sim-core --test golden -- --nocapture` and update
//! `GOLDEN_HASH` here AND in `crates/client-wasm/tests/golden_wasm.rs` and
//! `crates/client-wasm/tests/snapshot_wasm.rs`, bump `WORLD_FORMAT`
//! (`tests/snapshot.rs` says how), and regenerate
//! `packages/runner/test/fixtures/golden.json`.
//!
//! History:
//! - `0x591f_2064_16aa_2764`: world format 1.
//! - world format 2 (FEAT-079, ADR-0059): the publish gate, `JobFailed` and
//!   `DeployFailed`, the failure tickets (a standup nobody answers now
//!   raises one every day, which is why the command-less runner fixture
//!   moved too), the escalation default, `Meeting.speak_from/speak_chars`,
//!   `Ticket.failure`, `WorkItem.escalations`, and a longer script.
//! - `0x39d9_8696_fe53_cdc4`: world format 2.
//! - world format 3 (FEAT-087, ADR-0069): the weekly editorial board, the
//!   work item's planned days, workstream and dependencies, the plan's
//!   workstreams and board days, the `EditorialBoard` policy; the script
//!   turns the board on and answers the first one.
//! - `0xa01f_2bd6_e634_9f86`: world format 3.
//! - world format 4 (FEAT-089, ADR-0071): `WorkItem.performance` and
//!   `followed_up`, `Policies.analytics`; the script is unchanged.

use sim_core::commands::JobFailure;
use sim_core::ids::{StaffId, TicketId, WorkItemId};
use sim_core::inbox::{ResolvedBy, TicketKind, TicketOption, TicketStatus};
use sim_core::plan::{JobKind, WorkItemStatus};
use sim_core::scenarios::{golden_script, run_golden, DEMO_PROJECT, GOLDEN_STEPS};

const GOLDEN_HASH: u64 = 0xc494_97aa_3ace_5cd8;

#[test]
fn golden_hash() {
    let (w, results) = run_golden(GOLDEN_STEPS);
    assert_eq!(results.len(), golden_script().len());
    assert!(results.iter().all(|(_, r)| r.is_ok()), "{results:?}");
    // The scripted job contract. Item 1: approved by the CEO at the gate,
    // a failed deploy retried, published.
    let item = |i| &w.plan.items[&WorkItemId(i)];
    assert_eq!(item(1).status, WorkItemStatus::Published);
    assert_eq!(item(1).last_score, Some(8));
    let ticket = |i| &w.tickets[&TicketId(i)];
    assert_eq!(
        item(1).tickets,
        vec![TicketId(4), TicketId(10)],
        "the approval and the failed deploy"
    );
    assert_eq!(ticket(4).kind, TicketKind::PublishApproval);
    assert_eq!(ticket(4).answer, Some(TicketOption::Publish));
    assert_eq!(ticket(4).resolved_by, Some(ResolvedBy::Ceo));
    assert_eq!(ticket(10).kind, TicketKind::DeployFailed);
    assert_eq!(ticket(10).answer, Some(TicketOption::Retry));
    // Item 2: revised once, deferred at the gate, asked again at 08:30, sent
    // back (revision 2), its draft timed out, retried by the default of its
    // first escalation: drafting again.
    assert_eq!(item(2).revision, 2);
    assert_eq!(item(2).last_score, Some(9));
    assert_eq!(item(2).status, WorkItemStatus::InProgress);
    assert_eq!(item(2).escalations, 1);
    assert_eq!(
        item(2).tickets,
        vec![TicketId(11), TicketId(12), TicketId(15)]
    );
    assert_eq!(ticket(11).answer, Some(TicketOption::Defer));
    assert_eq!(ticket(12).kind, TicketKind::PublishApproval);
    assert_eq!(ticket(12).answer, Some(TicketOption::SendBack));
    assert_eq!(ticket(15).kind, TicketKind::Escalation);
    assert_eq!(ticket(15).failure, Some(JobFailure::Timeout));
    assert_eq!(ticket(15).status, TicketStatus::Expired);
    assert_eq!(ticket(15).answer, Some(TicketOption::Retry));
    // Item 3: no media, killed by the default two days later.
    assert_eq!(item(3).status, WorkItemStatus::Cancelled);
    assert_eq!(item(3).tickets, vec![TicketId(14)]);
    assert_eq!(ticket(14).kind, TicketKind::NeedsMedia);
    assert_eq!(ticket(14).answer, Some(TicketOption::Kill));
    // The failed standup was retried; every standup nobody answered raised
    // a ticket of its own.
    assert_eq!(ticket(13).kind, TicketKind::StandupFailed);
    assert_eq!(ticket(13).failure, Some(JobFailure::Infrastructure));
    assert_eq!(ticket(13).answer, Some(TicketOption::Retry));
    let timed_out = w
        .tickets
        .values()
        .filter(|t| t.kind == TicketKind::StandupFailed && t.failure == Some(JobFailure::Timeout))
        .count();
    assert!(timed_out >= 3, "{timed_out} standups timed out");
    // Day 4, 10:00: the first editorial board (job 19) planned items 4 and
    // 5 under one workstream; item 4 started with the lowest-id free writer,
    // item 5 waits for it to be published.
    assert_eq!(w.plan.board_days.get(&DEMO_PROJECT), Some(&4));
    assert_eq!(item(4).status, WorkItemStatus::InProgress);
    assert_eq!(item(4).phases[0].assignee, Some(StaffId(1)));
    assert_eq!(
        (item(4).start_day, item(4).due_day, item(4).publish_day),
        (Some(4), Some(6), Some(7))
    );
    assert_eq!(item(5).status, WorkItemStatus::Planned);
    assert!(item(5).is_unstarted());
    assert_eq!(item(5).depends_on, vec![WorkItemId(4)]);
    assert_eq!(item(4).workstream, item(5).workstream);
    assert_eq!(w.plan.workstreams.len(), 1);
    // Pending: item 2's retried draft and item 4's draft.
    let pending: Vec<(JobKind, Option<WorkItemId>)> = w
        .plan
        .jobs
        .values()
        .map(|j| (j.kind, j.work_item))
        .collect();
    assert_eq!(
        pending,
        vec![
            (JobKind::Draft, Some(WorkItemId(2))),
            (JobKind::Draft, Some(WorkItemId(4)))
        ]
    );
    println!("golden hash: {:#018x}", w.hash());
    assert_eq!(w.hash(), GOLDEN_HASH, "got {:#018x}", w.hash());
}
