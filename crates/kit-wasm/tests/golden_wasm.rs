//! The kit in wasm: the golden cases (`crates/kit/tests/golden_cases`) give
//! the native digest on wasm32 (wasm-bindgen-test under Node), and the
//! facade's buffers, issues, hashes and room shells are consistent. Runs as a
//! plain test natively too:
//!
//! ```sh
//! CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUNNER=wasm-bindgen-test-runner \
//!   cargo test -p kit-wasm --target wasm32-unknown-unknown
//! ```

#[path = "../../kit/tests/golden_cases/mod.rs"]
mod golden_cases;

use serde_json::Value;
#[cfg(target_arch = "wasm32")]
use wasm_bindgen_test::wasm_bindgen_test;

#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
#[cfg_attr(not(target_arch = "wasm32"), test)]
fn golden_digest_matches_native() {
    let d = golden_cases::digest();
    assert_eq!(d, golden_cases::GOLDEN, "digest on this host: {d}");
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
#[cfg_attr(not(target_arch = "wasm32"), test)]
fn facade_buffers_match_the_summary() {
    let b = kit_wasm::compile_shipped("desk", "{}");
    assert!(b.ok(), "{}", b.issues_json());
    let s: Value = serde_json::from_str(&b.summary_json()).unwrap();
    assert_eq!(s["workstation"], Value::Bool(true));
    let mut seqs = Vec::new();
    for i in 0..b.group_count() {
        let t = b.group_transforms(i);
        let m = b.group_meta(i);
        assert_eq!(t.len() % 7, 0);
        assert_eq!(t.len() / 7, m.len() / 3, "{}", b.group_colour(i));
        assert!(!b.group_template(i).is_empty());
        seqs.extend(m.chunks(3).map(|x| x[0]));
    }
    seqs.sort_unstable();
    let parts = s["parts"].as_u64().unwrap() as u32;
    assert_eq!(
        seqs,
        (0..parts).collect::<Vec<_>>(),
        "every part once, in build order"
    );
    assert_eq!(b.instance_count() as u32, parts);
    let studs: usize = (0..b.stud_group_count())
        .map(|i| b.stud_positions(i).len() / 3)
        .sum();
    assert_eq!(studs as u64, s["studs"].as_u64().unwrap());
    let info: Value = serde_json::from_str(&b.info_json()).unwrap();
    assert_eq!(info["ports"].as_array().unwrap().len(), 3);
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
#[cfg_attr(not(target_arch = "wasm32"), test)]
fn facade_refuses_with_issues() {
    let floating = r#"{"format": "swarmpress.design.v1", "id": "probe", "name": "Probe",
        "footprint": [2, 2], "height": 3, "provenance": {"kind": "kit"},
        "ops": [{"op": "box", "at": [0, 0, 1], "size": [1, 1, 1], "part": "plate", "colour": "red"}]}"#;
    let b = kit_wasm::compile(floating, "");
    assert!(!b.ok());
    assert_eq!(b.summary_json(), "null");
    let issues: Value = serde_json::from_str(&b.issues_json()).unwrap();
    assert_eq!(issues[0]["code"], "floating");
    assert_eq!(issues[0]["op"], serde_json::json!([0]));
    let b = kit_wasm::compile_shipped("desk", r#"{"half": 99}"#);
    assert!(!b.ok());
    assert!(b.issues_json().contains("bad-param"));
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
#[cfg_attr(not(target_arch = "wasm32"), test)]
fn facade_hashes_like_the_kit() {
    let designs: Vec<Value> = serde_json::from_str(&kit_wasm::designs_json()).unwrap();
    assert!(designs.len() >= 14);
    for d in designs {
        let id = d["id"].as_str().unwrap();
        let h = kit_wasm::hash_design(&d.to_string()).unwrap();
        assert_eq!(h, kit_wasm::compile_shipped(id, "").hash(), "{id}");
    }
    let info: Value = serde_json::from_str(&kit_wasm::kit_info()).unwrap();
    let cat: Value = serde_json::from_str(&kit_wasm::catalogue_json()).unwrap();
    assert_eq!(info["catalogue"], cat["catalogue"]);
    let mapping: Value = serde_json::from_str(&kit_wasm::mapping_json()).unwrap();
    assert_eq!(mapping["equipment"]["desk"], "desk");
}

/// Two rooms of the demo layout in `Sim.layout_json()`'s shape (metres): the
/// server room's door opens north into the SEO lab.
const LAYOUT: &str = r#"{"rooms": [
  {"id": "room-10", "kind": "seo-lab", "x": 19.0, "z": 8.0, "w": 5.0, "d": 4.0,
   "doors": [{"side": "north", "at": 2.0, "width": 1.0}],
   "windows": [{"side": "east", "at": 1.0, "width": 2.0}], "desks": [], "props": []},
  {"id": "room-11", "kind": "server-room", "x": 19.0, "z": 12.0, "w": 5.0, "d": 4.0,
   "doors": [{"side": "north", "at": 2.0, "width": 1.0}], "windows": []}
]}"#;

#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
#[cfg_attr(not(target_arch = "wasm32"), test)]
fn room_shells_from_the_layout() {
    let shells: Value = serde_json::from_str(&kit_wasm::room_shells(LAYOUT).unwrap()).unwrap();
    for id in ["room-10", "room-11"] {
        let chunks = shells[id].as_array().unwrap();
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0]["offset"], serde_json::json!([0.0, 0.0]));
        let b = kit_wasm::compile(&chunks[0]["design"].to_string(), "");
        assert!(b.ok(), "{id}: {}", b.issues_json());
        assert_eq!(b.hash(), chunks[0]["hash"].as_str().unwrap());
    }
    // The SEO lab gets a doorway (no leaf) where the server room's door opens in.
    let lab = serde_json::to_string(&shells["room-10"][0]["design"]).unwrap();
    let lab_alone = {
        let room: Value = serde_json::from_str(LAYOUT).unwrap();
        kit_wasm::room_shell(&room["rooms"][0].to_string()).unwrap()
    };
    let alone: Value = serde_json::from_str(&lab_alone).unwrap();
    assert_ne!(
        lab,
        alone[0]["design"].to_string(),
        "the doorway changes the shell"
    );
    let bad = kit_wasm::room_shell(r#"{"id": "room-1", "kind": "ballroom", "w": 4.0, "d": 4.0}"#);
    assert!(bad.unwrap_err().contains("ballroom"));
}
