//! Invalid designs are refused with the right issue, naming the operation.

mod common;

use kit::{compile, compile_with, Design, IssueCode, Kit, Limits, ParamValue, Params};
use serde_json::{json, Value};

fn design(ops: Value) -> Value {
    json!({
        "format": "swarmpress.design.v1",
        "id": "probe",
        "name": "Probe",
        "footprint": [8, 8],
        "height": 12,
        "params": { "w": { "type": "int", "min": 1, "max": 8, "default": 4 } },
        "ops": ops,
        "provenance": { "kind": "kit" }
    })
}

fn parse(v: &Value) -> Design {
    Design::from_json(&v.to_string()).unwrap()
}

/// Compile and expect exactly this first issue code and op path.
fn refused_with(kit: &Kit, v: Value, params: &Params, code: IssueCode, op: &[u32]) -> String {
    let issues = compile(&parse(&v), params, kit).expect_err("should be refused");
    let first = &issues[0];
    assert_eq!(first.code, code, "{}", common::show(&issues));
    assert_eq!(first.op, op, "{}", common::show(&issues));
    first.message.clone()
}

fn ground() -> Value {
    json!({ "op": "box", "at": [0, 0, 0], "size": [8, 8, 1], "part": "plate", "colour": "grey-dark" })
}

#[test]
fn a_valid_probe_compiles() {
    let kit = Kit::shipped();
    let c = compile(&parse(&design(json!([ground()]))), &Params::new(), kit).unwrap();
    assert_eq!(c.summary.parts, 1, "one 8 × 8 plate");
}

#[test]
fn unknown_part_and_material() {
    let kit = Kit::shipped();
    let v = design(
        json!([ground(), { "op": "part", "part": "brick-3x3", "at": [0, 0, 1], "colour": "red" }]),
    );
    let m = refused_with(kit, v, &Params::new(), IssueCode::UnknownPart, &[1]);
    assert!(m.contains("brick-3x3"));
    let v = design(
        json!([{ "op": "box", "at": [0, 0, 0], "size": [1, 1, 1], "part": "marble", "colour": "red" }]),
    );
    refused_with(kit, v, &Params::new(), IssueCode::UnknownPart, &[0]);
}

#[test]
fn unknown_and_disallowed_colours() {
    let kit = Kit::shipped();
    let v = design(
        json!([ground(), { "op": "box", "at": [0, 0, 1], "size": [2, 2, 3], "part": "brick", "colour": "mauve" }]),
    );
    refused_with(kit, v, &Params::new(), IssueCode::UnknownColour, &[1]);
    // Screens only come in glowing colours; bricks never glow.
    let v = design(
        json!([ground(), { "op": "part", "part": "screen-2x2", "at": [0, 0, 1], "colour": "red" }]),
    );
    refused_with(kit, v, &Params::new(), IssueCode::ColourNotAllowed, &[1]);
    let v = design(
        json!([{ "op": "box", "at": [0, 0, 0], "size": [2, 2, 3], "part": "brick", "colour": "bulb" }]),
    );
    refused_with(kit, v, &Params::new(), IssueCode::ColourNotAllowed, &[0]);
}

#[test]
fn floating_bricks() {
    let kit = Kit::shipped();
    let v = design(
        json!([ground(), { "op": "box", "at": [2, 2, 6], "size": [2, 2, 3], "part": "brick", "colour": "red" }]),
    );
    let m = refused_with(kit, v, &Params::new(), IssueCode::Floating, &[1]);
    assert!(m.starts_with("12 cells"), "{m}");
    // Touching a grounded brick sideways is enough.
    let v = design(json!([
        ground(),
        { "op": "box", "at": [0, 0, 1], "size": [1, 1, 9], "part": "brick", "colour": "red" },
        { "op": "box", "at": [1, 0, 6], "size": [3, 1, 3], "part": "brick", "colour": "red" }
    ]));
    compile(&parse(&v), &Params::new(), kit).unwrap();
    // A ceiling design hangs from its top layer.
    let mut v = design(
        json!([{ "op": "box", "at": [0, 0, 0], "size": [2, 2, 3], "part": "brick", "colour": "red" }]),
    );
    v["mount"] = json!("ceiling");
    refused_with(kit, v.clone(), &Params::new(), IssueCode::Floating, &[0]);
    v["ops"] = json!([{ "op": "box", "at": [0, 0, 0], "size": [2, 2, 12], "part": "brick", "colour": "red" }]);
    compile(&parse(&v), &Params::new(), kit).unwrap();
}

#[test]
fn outside_the_footprint() {
    let kit = Kit::shipped();
    let v = design(
        json!([{ "op": "box", "at": [6, 0, 0], "size": [4, 1, 1], "part": "plate", "colour": "red" }]),
    );
    refused_with(kit, v, &Params::new(), IssueCode::OutsideFootprint, &[0]);
    let v = design(
        json!([{ "op": "box", "at": [0, 0, 10], "size": [1, 1, 3], "part": "brick", "colour": "red" }]),
    );
    refused_with(kit, v, &Params::new(), IssueCode::OutsideFootprint, &[0]);
    // A repeat that walks out of the footprint is caught at the step that leaves.
    let v = design(
        json!([{ "op": "repeat", "count": 3, "step": [3, 0, 0], "ops": [
        { "op": "box", "at": [0, 0, 0], "size": [3, 1, 1], "part": "plate", "colour": "red" }
    ] }]),
    );
    refused_with(kit, v, &Params::new(), IssueCode::OutsideFootprint, &[0, 0]);
    // A used design must fit, turned, inside its parent.
    let v = design(json!([ground(), { "op": "use", "design": "mug", "at": [7, 0, 1], "turn": 0 }]));
    refused_with(kit, v, &Params::new(), IssueCode::OutsideFootprint, &[1]);
}

#[test]
fn over_budget() {
    let kit = Kit::shipped();
    let mut v = design(json!([
        ground(),
        { "op": "box", "at": [0, 0, 1], "size": [1, 1, 1], "part": "plate", "colour": "red" }
    ]));
    v["budget"] = json!({ "parts": 1 });
    let m = refused_with(kit, v, &Params::new(), IssueCode::OverBudget, &[]);
    assert!(m.contains("2 parts"), "{m}");
    let big = design(json!([ground()]));
    let limits = Limits {
        max_cells: 100,
        ..Limits::default()
    };
    let issues = compile_with(&parse(&big), &Params::new(), kit, &limits).unwrap_err();
    assert_eq!(issues[0].code, IssueCode::OverBudget);
    let limits = Limits {
        max_writes: 3,
        ..Limits::default()
    };
    let v = design(
        json!([{ "op": "repeat", "count": 8, "step": [1, 0, 0], "ops": [
        { "op": "box", "at": [0, 0, 0], "size": [1, 1, 1], "part": "plate", "colour": "red" }
    ] }]),
    );
    let issues = compile_with(&parse(&v), &Params::new(), kit, &limits).unwrap_err();
    assert_eq!(issues[0].code, IssueCode::OverBudget);
    assert_eq!(issues[0].op, vec![0, 0]);
}

fn library_design(id: &str, ops: Value) -> Design {
    let mut v = design(ops);
    v["id"] = json!(id);
    parse(&v)
}

#[test]
fn cyclic_and_too_deep_use() {
    let shipped = Kit::shipped();
    let use_op = |d: &str| json!({ "op": "use", "design": d, "at": [0, 0, 0] });
    let a = library_design("cycle-a", json!([ground(), use_op("cycle-b")]));
    let b = library_design("cycle-b", json!([use_op("cycle-a")]));
    let kit = shipped.with_designs(&[a.clone(), b]).unwrap();
    let issues = compile(&a, &Params::new(), &kit).unwrap_err();
    assert_eq!(issues[0].code, IssueCode::CyclicUse);
    // The cycle is found inside cycle-b, at its first op.
    assert_eq!(issues[0].design, "cycle-b");
    assert_eq!(issues[0].op, vec![1, 0]);
    assert!(issues[0].message.contains("cycle-a → cycle-b → cycle-a"));
    let selfish = library_design("selfish", json!([use_op("selfish")]));
    let kit = shipped
        .with_designs(std::slice::from_ref(&selfish))
        .unwrap();
    assert_eq!(
        compile(&selfish, &Params::new(), &kit).unwrap_err()[0].code,
        IssueCode::CyclicUse
    );
    // A chain of ten nested designs is deeper than the limit of eight.
    let mut chain = vec![library_design("deep-9", json!([ground()]))];
    for i in (0..9).rev() {
        chain.push(library_design(
            &format!("deep-{i}"),
            json!([use_op(&format!("deep-{}", i + 1))]),
        ));
    }
    let kit = shipped.with_designs(&chain).unwrap();
    let issues = compile(chain.last().unwrap(), &Params::new(), &kit).unwrap_err();
    assert_eq!(issues[0].code, IssueCode::DepthExceeded);
    assert_eq!(issues[0].op.len(), 8);
}

#[test]
fn unknown_design_and_pinned_hash() {
    let kit = Kit::shipped();
    let v = design(json!([ground(), { "op": "use", "design": "sofa", "at": [0, 0, 1] }]));
    refused_with(kit, v, &Params::new(), IssueCode::UnknownDesign, &[1]);
    let pinned = |h: &str| {
        design(json!([ground(), { "op": "use", "design": "mug", "at": [0, 0, 1], "hash": h }]))
    };
    refused_with(
        kit,
        pinned(&"0".repeat(64)),
        &Params::new(),
        IssueCode::HashMismatch,
        &[1],
    );
    compile(
        &parse(&pinned(kit.design_hash("mug").unwrap())),
        &Params::new(),
        kit,
    )
    .unwrap();
}

#[test]
fn bad_expressions_and_params() {
    let kit = Kit::shipped();
    let with = |x: &str| {
        design(
            json!([ground(), { "op": "box", "at": [0, 0, 1], "size": [x, 1, 1], "part": "plate", "colour": "red" }]),
        )
    };
    // Syntax errors are found while canonicalising, before anything is built.
    refused_with(
        kit,
        with("$w -"),
        &Params::new(),
        IssueCode::BadExpression,
        &[1],
    );
    refused_with(
        kit,
        with("$w / 2"),
        &Params::new(),
        IssueCode::BadExpression,
        &[1],
    );
    refused_with(
        kit,
        with("$nope + 1"),
        &Params::new(),
        IssueCode::BadExpression,
        &[1],
    );
    refused_with(
        kit,
        with("9223372036854775807 * $w"),
        &Params::new(),
        IssueCode::BadExpression,
        &[1],
    );
    let m = refused_with(kit, with("$w - 4"), &Params::new(), IssueCode::BadOp, &[1]);
    assert!(m.contains("at least 1"));
    compile(&parse(&with("$w - 3")), &Params::new(), kit).unwrap();
    // Parameter values are checked against their declarations.
    let p = |v: ParamValue| Params::from([("w".to_string(), v)]);
    refused_with(
        kit,
        with("$w"),
        &p(ParamValue::Int(9)),
        IssueCode::BadParam,
        &[],
    );
    refused_with(
        kit,
        with("$w"),
        &p(ParamValue::Str("big".into())),
        IssueCode::BadParam,
        &[],
    );
    let extra = Params::from([("depth".to_string(), ParamValue::Int(2))]);
    refused_with(kit, with("$w"), &extra, IssueCode::BadParam, &[]);
    // A colour reference must name a colour parameter.
    let v = design(
        json!([{ "op": "box", "at": [0, 0, 0], "size": [1, 1, 1], "part": "plate", "colour": "$w" }]),
    );
    refused_with(kit, v, &Params::new(), IssueCode::BadParam, &[0]);
    // A float is not an integer: the JSON is refused as a whole.
    let bad = design(json!([ground()]))
        .to_string()
        .replace("\"height\":12", "\"height\":12.5");
    assert_eq!(
        Design::from_json(&bad).unwrap_err()[0].code,
        IssueCode::BadFormat
    );
}

#[test]
fn overlapping_parts() {
    let kit = Kit::shipped();
    let v = design(json!([
        ground(),
        { "op": "part", "part": "plate-2x4", "at": [0, 0, 1], "colour": "red" },
        { "op": "part", "part": "plate-2x4", "at": [1, 2, 1], "turn": 1, "colour": "red" }
    ]));
    let m = refused_with(kit, v, &Params::new(), IssueCode::Overlap, &[2]);
    assert!(m.contains("plate-2x4 of probe ops[1]"), "{m}");
    let v = design(json!([
        ground(),
        { "op": "part", "part": "plate-2x4", "at": [0, 0, 1], "colour": "red" },
        { "op": "box", "at": [0, 0, 1], "size": [8, 8, 2], "part": "brick", "colour": "red" }
    ]));
    refused_with(kit, v, &Params::new(), IssueCode::Overlap, &[2]);
    // `fill` goes around parts.
    let v = design(json!([
        ground(),
        { "op": "part", "part": "plate-2x4", "at": [0, 0, 1], "colour": "red" },
        { "op": "fill", "at": [0, 0, 1], "size": [8, 8, 2], "part": "brick", "colour": "navy" }
    ]));
    compile(&parse(&v), &Params::new(), kit).unwrap();
}

#[test]
fn ports_surfaces_and_tags() {
    let kit = Kit::shipped();
    let mut v = design(json!([ground()]));
    v["ports"] = json!([{ "id": "screen", "at": [4, 4, 5], "accepts": ["screen"] }]);
    let m = refused_with(kit, v.clone(), &Params::new(), IssueCode::BadPort, &[]);
    assert!(m.contains("does not stand on the build"), "{m}");
    v["ports"] = json!([{ "id": "screen", "at": [4, 4, 1], "accepts": ["screen"] }]);
    compile(&parse(&v), &Params::new(), kit).unwrap();
    v["ports"] = json!([{ "id": "seat", "at": [4, 40, 0], "accepts": ["seat"] }]);
    refused_with(kit, v.clone(), &Params::new(), IssueCode::BadPort, &[]);
    v["ports"] = json!([{ "id": "seat", "at": [4, 20, 0], "accepts": ["seat"] }]);
    compile(&parse(&v), &Params::new(), kit).unwrap();

    let v = design(
        json!([ground(), { "op": "part", "part": "plate-1x2", "at": [0, 0, 1], "colour": "red", "surface": "screen" }]),
    );
    refused_with(kit, v, &Params::new(), IssueCode::BadSurface, &[1]);

    let mut v = design(json!([ground()]));
    v["tags"] = json!(["workstation"]);
    let m = refused_with(kit, v, &Params::new(), IssueCode::TagNotMet, &[]);
    assert!(m.contains("workstation"));
}
