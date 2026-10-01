//! Golden determinism: the scripted 50,000-step run of the demo office must
//! hash to the same value on every platform, natively and in wasm
//! (`crates/client-wasm/tests/golden_wasm.rs` asserts the same constant).
//!
//! If a deliberate sim change moves the hash, regenerate with
//! `cargo test -p sim-core --test golden -- --nocapture` and update
//! `GOLDEN_HASH` here AND in `crates/client-wasm/tests/golden_wasm.rs`.

use sim_core::scenarios::{golden_script, run_golden, GOLDEN_STEPS};

const GOLDEN_HASH: u64 = 0x510c_1fc2_8504_1e3c;

#[test]
fn golden_hash() {
    let (w, results) = run_golden(GOLDEN_STEPS);
    assert_eq!(results.len(), golden_script().len());
    assert!(results.iter().all(|(_, r)| r.is_ok()), "{results:?}");
    println!("golden hash: {:#018x}", w.hash());
    assert_eq!(w.hash(), GOLDEN_HASH, "got {:#018x}", w.hash());
}
