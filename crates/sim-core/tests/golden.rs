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

use sim_core::commands::JobFailure;
use sim_core::ids::{TicketId, WorkItemId};
use sim_core::inbox::{ResolvedBy, TicketKind, TicketOption, TicketStatus};
use sim_core::plan::{JobKind, WorkItemStatus};
use sim_core::scenarios::{golden_script, run_golden, GOLDEN_STEPS};

const GOLDEN_HASH: u64 = 0x39d9_8696_fe53_cdc4;

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
    // The only job still pending is item 2's retried draft.
    let pending: Vec<JobKind> = w.plan.jobs.values().map(|j| j.kind).collect();
    assert_eq!(pending, vec![JobKind::Draft]);
    println!("golden hash: {:#018x}", w.hash());
    assert_eq!(w.hash(), GOLDEN_HASH, "got {:#018x}", w.hash());
}
