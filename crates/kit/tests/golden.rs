//! Golden determinism: the same designs, parameters and catalogue compile to
//! the same bricks and summaries. The same cases and digest run in wasm in
//! `crates/kit-wasm/tests/golden_wasm.rs`.

mod golden_cases;

use kit::{compile, Kit, Params};

#[test]
fn golden_digest_is_stable() {
    let d = golden_cases::digest();
    assert_eq!(d, golden_cases::GOLDEN, "new golden digest: {d}");
}

#[test]
fn compiling_twice_gives_the_same_output() {
    let kit = Kit::shipped();
    for (name, design, params) in golden_cases::cases() {
        let a = compile(&design, &params, kit).unwrap();
        let b = compile(&design, &params, kit).unwrap();
        assert_eq!(a, b, "{name}");
        assert_eq!(kit::buffers(&a, kit), kit::buffers(&b, kit), "{name}");
    }
}

#[test]
fn the_catalogue_digest_is_part_of_the_output() {
    let kit = Kit::shipped();
    let c = compile(kit.design("stool").unwrap(), &Params::new(), kit).unwrap();
    assert_eq!(c.catalogue, kit.catalogue_hash());
    assert_eq!(c.catalogue.len(), 64);
}

#[test]
fn construction_order_is_bottom_up_and_complete() {
    let kit = Kit::shipped();
    let c = compile(kit.design("desk").unwrap(), &Params::new(), kit).unwrap();
    let bricks = c.bricks();
    let seqs: Vec<u32> = bricks.iter().map(|(_, b)| b.seq).collect();
    assert_eq!(seqs, (0..bricks.len() as u32).collect::<Vec<_>>());
    let keys: Vec<[u32; 3]> = bricks
        .iter()
        .map(|(_, b)| [b.at[2], b.at[1], b.at[0]])
        .collect();
    let mut sorted = keys.clone();
    sorted.sort();
    assert_eq!(keys, sorted, "y, then z, then x");
}
