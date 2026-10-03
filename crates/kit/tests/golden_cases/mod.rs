//! The golden cases, shared by the native test (`crates/kit/tests/golden.rs`)
//! and the wasm-bindgen test (`crates/kit-wasm/tests/golden_wasm.rs`): every
//! shipped design with its defaults, a few parameter variants and two room
//! shells (one of them cut into chunks). The digest covers every brick, stud,
//! surface, object, port and summary, so any difference between hosts shows.
#![allow(dead_code)]

use kit::shell::{Opening, Side};
use kit::{compile, Design, Kit, ParamValue, Params, RoomSpec};

/// Update when the catalogue, a shipped design, the shell generator or the
/// compiler's output changes on purpose (the failing test prints the new value).
pub const GOLDEN: &str = "6ea57c3d246ef3dbe3a8baf9acaf3b46f4c4d6c685ce1749cfc1df7c6d7bbfcf";

fn params(pairs: &[(&str, ParamValue)]) -> Params {
    pairs
        .iter()
        .map(|(k, v)| (k.to_string(), v.clone()))
        .collect()
}

fn opening(side: Side, at_mm: i32, width_mm: i32) -> Opening {
    Opening {
        side,
        at_mm,
        width_mm,
    }
}

pub fn rooms() -> Vec<RoomSpec> {
    vec![
        // The demo newsroom: 8 × 6 m, a door south, windows north and west.
        RoomSpec {
            id: "room-1".into(),
            kind: "newsroom".into(),
            w_mm: 8_000,
            d_mm: 6_000,
            doors: vec![opening(Side::South, 3_000, 1_000)],
            doorways: vec![],
            windows: vec![
                opening(Side::North, 1_000, 2_500),
                opening(Side::North, 4_500, 2_500),
                opening(Side::West, 1_500, 3_000),
            ],
        },
        // 12 × 9 m: four chunks, a doorway, a window across a chunk edge.
        RoomSpec {
            id: "room-90".into(),
            kind: "kitchen".into(),
            w_mm: 12_000,
            d_mm: 9_000,
            doors: vec![opening(Side::West, 2_000, 1_000)],
            doorways: vec![opening(Side::East, 5_000, 1_000)],
            windows: vec![opening(Side::North, 6_625, 3_000)],
        },
    ]
}

pub fn cases() -> Vec<(String, Design, Params)> {
    let kit = Kit::shipped();
    let mut out: Vec<(String, Design, Params)> = kit
        .designs()
        .iter()
        .map(|(id, d)| (id.clone(), d.clone(), Params::new()))
        .collect();
    let variant = |id: &str, p: Params| (format!("{id}+"), kit.design(id).unwrap().clone(), p);
    out.push(variant(
        "desk",
        params(&[
            ("half", ParamValue::Int(16)),
            ("top", ParamValue::Str("navy".into())),
        ]),
    ));
    out.push(variant("plant", params(&[("size", ParamValue::Int(40))])));
    out.push(variant(
        "meeting-table",
        params(&[("r", ParamValue::Int(8))]),
    ));
    out.push(variant(
        "paper-stack",
        params(&[("count", ParamValue::Int(12))]),
    ));
    for room in rooms() {
        for chunk in kit::room_shell(&room, kit).unwrap() {
            out.push((chunk.design.id.clone(), chunk.design, Params::new()));
        }
    }
    out
}

/// One digest over the canonical JSON of every compiled case.
pub fn digest() -> String {
    let kit = Kit::shipped();
    let mut all = String::new();
    for (name, design, params) in cases() {
        let c = compile(&design, &params, kit).unwrap_or_else(|e| panic!("{name}: {e:?}"));
        all.push_str(&name);
        all.push('\n');
        all.push_str(&serde_json::to_string(&c).unwrap());
        all.push('\n');
    }
    kit::design::domain_hash("swarmpress:kit-golden:v1", all.as_bytes())
}
