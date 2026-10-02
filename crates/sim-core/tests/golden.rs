//! Golden determinism: the scripted 50,000-step run of the demo office must
//! hash to the same value on every platform, natively and in wasm
//! (`crates/client-wasm/tests/golden_wasm.rs` asserts the same constant).
//!
//! If a deliberate sim change moves the hash, regenerate with
//! `cargo test -p sim-core --test golden -- --nocapture` and update
//! `GOLDEN_HASH` here AND in `crates/client-wasm/tests/golden_wasm.rs`.

use sim_core::ids::WorkItemId;
use sim_core::plan::WorkItemStatus;
use sim_core::scenarios::{golden_script, run_golden, GOLDEN_STEPS};

const GOLDEN_HASH: u64 = 0x591f_2064_16aa_2764;

#[test]
fn golden_hash() {
    let (w, results) = run_golden(GOLDEN_STEPS);
    assert_eq!(results.len(), golden_script().len());
    assert!(results.iter().all(|(_, r)| r.is_ok()), "{results:?}");
    // the scripted job contract: item 1 published, item 2 in its revision
    let item = |i| &w.plan.items[&WorkItemId(i)];
    assert_eq!(item(1).status, WorkItemStatus::Published);
    assert_eq!(item(1).last_score, Some(8));
    assert_eq!(item(2).revision, 1);
    assert_eq!(item(2).status, WorkItemStatus::InReview);
    println!("golden hash: {:#018x}", w.hash());
    assert_eq!(w.hash(), GOLDEN_HASH, "got {:#018x}", w.hash());
}
