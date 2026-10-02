//! Determinism evidence shared with the headless runner (ADR-0042): the
//! world hashes pinned in `packages/runner/test/fixtures/golden.json` must
//! come out of the `Sim` facade natively and in wasm (wasm-bindgen-test), and
//! the Bun runner asserts the same file (`packages/runner/test/golden.test.ts`).
//! Native = wasm = Bun, from one fixture.

use client_wasm::Sim;
use serde_json::Value;

#[cfg(target_arch = "wasm32")]
use wasm_bindgen_test::wasm_bindgen_test;

const GOLDEN: &str = include_str!("../../../packages/runner/test/fixtures/golden.json");

#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
#[cfg_attr(not(target_arch = "wasm32"), test)]
fn runner_golden_hashes_match() {
    let doc: Value = serde_json::from_str(GOLDEN).expect("golden.json parses");
    let cases = doc["cases"].as_array().expect("cases[]");
    assert!(!cases.is_empty());
    for case in cases {
        let seed: u64 = case["seed"].as_str().unwrap().parse().unwrap();
        let days = case["days"].as_u64().unwrap();
        let mut sim = match case["world"].as_str().unwrap() {
            "demo" => Sim::demo(seed),
            "empty" => Sim::new(seed),
            other => panic!("unknown world {other}"),
        };
        assert_eq!(sim.steps_per_day(), doc["steps_per_day"].as_u64().unwrap());
        for _ in 0..days {
            sim.advance(u32::try_from(sim.steps_per_day()).unwrap());
        }
        let got = format!("{:#018x}", sim.hash());
        assert_eq!(
            got,
            case["hash"].as_str().unwrap(),
            "world {} seed {seed} after {days} day(s)",
            case["world"]
        );
    }
}
