//! Golden determinism under wasm: the scripted 50,000-step demo run must give
//! the same hash in wasm32 as natively. Runs as a plain test natively and as a
//! wasm-bindgen-test under Node on wasm32 (see this crate's README).
//!
//! `GOLDEN_HASH` must equal the one in `crates/sim-core/tests/golden.rs`.

use client_wasm::Sim;
use sim_core::commands::{Command, Policy};
use sim_core::scenarios::{golden_script, run_golden, GOLDEN_STEPS};

#[cfg(target_arch = "wasm32")]
use wasm_bindgen_test::wasm_bindgen_test;

const GOLDEN_HASH: u64 = 0x3b02_96fc_7d0f_2aba;

#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
#[cfg_attr(not(target_arch = "wasm32"), test)]
fn golden_hash_matches_native() {
    let (w, results) = run_golden(GOLDEN_STEPS);
    assert_eq!(results.len(), golden_script().len());
    assert!(results.iter().all(|(_, r)| r.is_ok()));
    assert_eq!(w.hash(), GOLDEN_HASH, "got {:#018x}", w.hash());
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
#[cfg_attr(not(target_arch = "wasm32"), test)]
fn facade_round_trip() {
    let mut sim = Sim::demo(42);
    let a = sim.hash();
    sim.advance(1_750);
    assert_eq!(sim.minute_of_day(), 630);
    assert_ne!(sim.hash(), a);
    let cmd = protocol::encode(&Command::SetPolicy(Policy::QualityBar(8))).unwrap();
    assert_eq!(sim.validate_command(&cmd), None);
    assert_eq!(sim.apply_command(&cmd), Ok(()));
    assert!(sim.render_state_json().contains("\"staff\""));
    assert!(sim.layout_json().contains("\"newsroom\""));
    assert!(!sim.render_state().is_empty());
}
