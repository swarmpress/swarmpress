//! World snapshots under wasm (FEAT-060, ADR-0046): a sim rebuilt from its
//! snapshot is the same sim natively and in wasm32. Plain tests natively,
//! wasm-bindgen-tests under Node on wasm32 (see this crate's README).
//!
//! The expected hashes are the existing goldens: `GOLDEN_HASH` of
//! `crates/sim-core/tests/golden.rs` for the scripted run with commands, and
//! `packages/runner/test/fixtures/golden.json` for whole days through the
//! `Sim` facade (the Bun runner asserts the same file with a snapshot in the
//! middle: `packages/runner/test/snapshot.test.ts`).

use client_wasm::Sim;
use serde_json::Value;
use sim_core::scenarios::{demo_office, golden_script, GOLDEN_SEED, GOLDEN_STEPS};
use sim_core::World;

#[cfg(target_arch = "wasm32")]
use wasm_bindgen_test::wasm_bindgen_test;

const GOLDEN_HASH: u64 = 0x591f_2064_16aa_2764;
const GOLDEN: &str = include_str!("../../../packages/runner/test/fixtures/golden.json");

/// The scripted 50,000-step run with commands, jobs and queued inputs,
/// rebuilt from a snapshot every 7,919 steps.
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
#[cfg_attr(not(target_arch = "wasm32"), test)]
fn golden_run_through_snapshots() {
    let mut w = demo_office(GOLDEN_SEED);
    for (step, input) in golden_script() {
        w.enqueue(step, 0, input).expect("script is ordered");
    }
    let mut restores = 0;
    for _ in 0..GOLDEN_STEPS {
        if w.step > 0 && w.step % 7_919 == 0 {
            w = World::from_snapshot(&w.snapshot(), None).expect("restores");
            restores += 1;
        }
        assert!(w.step().applied.iter().all(|(_, r)| r.is_ok()));
    }
    assert_eq!(restores, 6);
    assert_eq!(w.hash(), GOLDEN_HASH, "got {:#018x}", w.hash());
}

/// Every case of the shared fixture, with the sim thrown away and rebuilt
/// from `Sim::snapshot` after each game day.
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
#[cfg_attr(not(target_arch = "wasm32"), test)]
fn runner_golden_hashes_survive_a_snapshot_a_day() {
    let doc: Value = serde_json::from_str(GOLDEN).expect("golden.json parses");
    for case in doc["cases"].as_array().expect("cases[]") {
        let seed: u64 = case["seed"].as_str().unwrap().parse().unwrap();
        let days = case["days"].as_u64().unwrap();
        let mut sim = match case["world"].as_str().unwrap() {
            "demo" => Sim::demo(seed),
            "empty" => Sim::new(seed),
            other => panic!("unknown world {other}"),
        };
        for _ in 0..days {
            sim.advance(u32::try_from(sim.steps_per_day()).unwrap());
            let bytes = sim.snapshot();
            let at = (sim.step(), sim.hash());
            sim = Sim::from_snapshot(&bytes).expect("restores");
            assert_eq!((sim.step(), sim.hash()), at);
            assert_eq!(sim.seed(), seed);
        }
        assert_eq!(
            format!("{:#018x}", sim.hash()),
            case["hash"].as_str().unwrap(),
            "world {} seed {seed} after {days} day(s)",
            case["world"]
        );
    }
}

/// A sim restored while a job is pending hands out the same request again,
/// as the same JSON the orchestrator got the first time.
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
#[cfg_attr(not(target_arch = "wasm32"), test)]
fn a_sim_from_a_snapshot_reissues_the_pending_job_as_the_same_json() {
    let mut sim = Sim::scenario("cinqueterre", 9).unwrap();
    assert_eq!(sim.reissue_pending_jobs(), 0);
    // 07:00 → 09:00: the standup's job
    sim.advance(1_000);
    assert_eq!(sim.pending_effects(), 1);
    let bytes = sim.snapshot();
    let original = sim.drain_effects_json();
    assert!(original.contains("\"kind\":\"standup\""), "{original}");
    let hash = sim.hash();

    let mut back = Sim::from_snapshot(&bytes).unwrap();
    assert_eq!(back.pending_effects(), 0, "effects are not in a snapshot");
    assert_eq!(back.hash(), hash);
    assert_eq!(back.reissue_pending_jobs(), 1);
    assert_eq!(back.reissue_pending_jobs(), 0, "not twice");
    assert_eq!(back.drain_effects_json(), original);
    assert_eq!(back.hash(), hash, "re-issuing never moves the hash");

    // The outcome applies to the restored sim and requests the draft, as in the original.
    let outcome = r#"{"MeetingOutcome":{"job_id":1,"briefs":[{"writer":"staff-1","editor":"staff-5","brief_ref":18446744073709551610}]}}"#;
    back.apply_command_json(outcome).unwrap();
    sim.apply_command_json(outcome).unwrap();
    assert_eq!(back.drain_effects_json(), sim.drain_effects_json());
    back.advance(500);
    sim.advance(500);
    assert_eq!(back.hash(), sim.hash());
    // the draft is pending in both; a second restore re-issues job 2
    let mut again = Sim::from_snapshot(&back.snapshot()).unwrap();
    assert_eq!(again.reissue_pending_jobs(), 1);
    let draft = again.drain_effects_json();
    assert!(
        draft.contains("\"job_id\":2") && draft.contains("\"kind\":\"draft\""),
        "{draft}"
    );
    assert!(
        draft.contains("18446744073709551610"),
        "the brief ref keeps all its digits: {draft}"
    );
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
#[cfg_attr(not(target_arch = "wasm32"), test)]
fn bad_snapshots_throw() {
    let mut sim = Sim::demo(1);
    sim.advance(700);
    let good = sim.snapshot();
    assert!(Sim::from_snapshot(&good).is_ok());

    let err = |bytes: &[u8]| Sim::from_snapshot(bytes).err().expect("refused");
    assert!(err(&[]).starts_with("bad snapshot: the snapshot is truncated"));
    assert!(
        err(b"{\"format\":\"swarmpress.checkpoint.v1\",\"step\":0,\"hash\":\"0\"}")
            .contains("bad magic")
    );
    let mut other_build = good.clone();
    other_build[6] = other_build[6].wrapping_add(1);
    assert!(
        err(&other_build).contains("sim build"),
        "{}",
        err(&other_build)
    );
    let mut flipped = good.clone();
    let last = flipped.len() - 1;
    flipped[last] ^= 0x10;
    assert!(err(&flipped).contains("corrupt"), "{}", err(&flipped));
    let mut wrong_hash = good.clone();
    wrong_hash[40] ^= 0x10;
    assert!(err(&wrong_hash).contains("corrupt"));
}
