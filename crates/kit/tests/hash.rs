//! The design hash: stable for a canonical form, changed by any edit.

use std::collections::BTreeMap;

use kit::design::{
    Arg, Axis, Design, MirrorOp, Op, ParamDef, PartOp, Port, Provenance, Region, RepeatOp, Shape,
    UseOp,
};
use kit::expr::Num;
use proptest::prelude::*;

const COLOURS: [&str; 5] = ["white", "red", "navy", "sand", "$c"];
const PARTS: [&str; 4] = ["plate-2x4", "round-brick-1x1", "tile-1x2", "screen-2x2"];

fn num() -> impl Strategy<Value = Num> {
    prop_oneof![
        (0i64..40).prop_map(Num::Int),
        (0i64..40).prop_map(|n| Num::Expr(format!("$w - {n}"))),
        (1i64..4).prop_map(|n| Num::Expr(format!("{n} * $w + 1"))),
    ]
}

fn num3() -> impl Strategy<Value = [Num; 3]> {
    [num(), num(), num()]
}

fn leaf() -> impl Strategy<Value = Op> {
    prop_oneof![
        (
            num3(),
            num3(),
            0usize..3,
            0usize..COLOURS.len(),
            any::<bool>()
        )
            .prop_map(|(at, size, m, c, disc)| {
                Op::Box(Region {
                    at,
                    size,
                    part: ["brick", "plate", "tile"][m].to_string(),
                    colour: Some(COLOURS[c].to_string()),
                    shape: if disc { Shape::Disc } else { Shape::Box },
                })
            }),
        (num3(), num3(), 0usize..COLOURS.len()).prop_map(|(at, size, c)| Op::Fill(Region {
            at,
            size,
            part: "brick".into(),
            colour: Some(COLOURS[c].to_string()),
            shape: Shape::Box,
        })),
        (0usize..PARTS.len(), num3(), 0i64..4).prop_map(|(p, at, t)| Op::Part(PartOp {
            part: PARTS[p].to_string(),
            at,
            turn: Num::Int(t),
            colour: None,
            surface: None,
        })),
        (num3(), 0i64..4).prop_map(|(at, t)| Op::Use(UseOp {
            design: "mug".into(),
            at,
            turn: Num::Int(t),
            params: BTreeMap::from([("colour".to_string(), Arg::Str("$c".into()))]),
            hash: None,
            name: None,
        })),
    ]
}

fn op() -> impl Strategy<Value = Op> {
    leaf().prop_recursive(2, 12, 3, |inner| {
        prop_oneof![
            (any::<bool>(), prop::collection::vec(inner.clone(), 1..3)).prop_map(|(x, ops)| {
                Op::Mirror(MirrorOp {
                    axis: if x { Axis::X } else { Axis::Z },
                    ops,
                })
            }),
            (1i64..5, num3(), prop::collection::vec(inner, 1..3)).prop_map(|(n, step, ops)| {
                Op::Repeat(RepeatOp {
                    count: Num::Int(n),
                    step,
                    ops,
                })
            }),
        ]
    })
}

fn design() -> impl Strategy<Value = Design> {
    (
        "[a-z][a-z0-9]{0,8}",
        "[A-Za-z ]{1,20}",
        prop::collection::vec(op(), 1..6),
        prop::collection::btree_set("[a-z]{3,8}", 0..3),
        num3(),
    )
        .prop_map(|(id, name, ops, tags, port_at)| Design {
            schema: None,
            format: kit::DESIGN_FORMAT.into(),
            id,
            name,
            mount: Default::default(),
            footprint: [Num::Expr("2 * $w".into()), Num::Int(16)],
            height: Num::Int(40),
            params: BTreeMap::from([
                (
                    "w".to_string(),
                    ParamDef::Int {
                        min: 8,
                        max: 24,
                        default: 12,
                    },
                ),
                (
                    "c".to_string(),
                    ParamDef::Colour {
                        default: "red".into(),
                        allowed: vec![],
                    },
                ),
            ]),
            ops,
            ports: vec![Port {
                id: "top".into(),
                at: port_at,
                accepts: vec!["screen".into()],
                turn: Num::Int(0),
            }],
            tags: tags.into_iter().collect(),
            budget: None,
            provenance: Provenance::Kit,
        })
}

/// Rewrite every integer literal as an equivalent expression string.
fn literals_as_text(ops: &mut [Op]) {
    fn n(x: &mut Num) {
        if let Num::Int(v) = x {
            *x = Num::Expr(format!("({v} + 0) * 1"));
        }
    }
    for op in ops {
        match op {
            Op::Box(r) | Op::Fill(r) => r.at.iter_mut().chain(r.size.iter_mut()).for_each(n),
            Op::Part(p) => p.at.iter_mut().for_each(n),
            Op::Use(u) => u.at.iter_mut().for_each(n),
            Op::Mirror(m) => literals_as_text(&mut m.ops),
            Op::Repeat(r) => {
                r.step.iter_mut().for_each(n);
                literals_as_text(&mut r.ops);
            }
        }
    }
}

/// The first box of a design, if any (searching nested ops).
fn first_region(ops: &mut [Op]) -> Option<&mut Region> {
    for op in ops {
        match op {
            Op::Box(r) | Op::Fill(r) => return Some(r),
            Op::Mirror(m) => {
                if let Some(r) = first_region(&mut m.ops) {
                    return Some(r);
                }
            }
            Op::Repeat(r) => {
                if let Some(x) = first_region(&mut r.ops) {
                    return Some(x);
                }
            }
            _ => {}
        }
    }
    None
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(256))]

    #[test]
    fn canonical_form_round_trips(d in design()) {
        let c = d.canonical_json().unwrap();
        let back = Design::from_json(&c).unwrap();
        prop_assert_eq!(back.canonical_json().unwrap(), c.clone());
        prop_assert_eq!(back.hash().unwrap(), d.hash().unwrap());
        // Any JSON rendering of the same design hashes the same.
        let pretty = serde_json::to_string_pretty(&d).unwrap();
        prop_assert_eq!(Design::from_json(&pretty).unwrap().hash().unwrap(), d.hash().unwrap());
    }

    #[test]
    fn equivalent_expressions_hash_the_same(d in design()) {
        let mut e = d.clone();
        literals_as_text(&mut e.ops);
        prop_assert_eq!(e.hash().unwrap(), d.hash().unwrap());
        let mut t = d.clone();
        t.tags.reverse();
        prop_assert_eq!(t.hash().unwrap(), d.hash().unwrap());
    }

    #[test]
    fn any_edit_changes_the_hash(d in design(), which in 0usize..9, k in 1i64..7) {
        let h = d.hash().unwrap();
        let mut e = d.clone();
        match which {
            0 => e.id.push('x'),
            1 => e.name.push('!'),
            2 => e.ops.push(Op::Part(PartOp {
                part: "tile-1x1".into(),
                at: [Num::Int(0), Num::Int(0), Num::Int(0)],
                turn: Num::Int(0),
                colour: Some("black".into()),
                surface: None,
            })),
            3 => { e.ops.pop(); }
            4 => e.tags.push("zz-new".into()),
            5 => e.height = Num::Int(40 + k),
            6 => e.ports[0].accepts.push("light".into()),
            7 => {
                let r = first_region(&mut e.ops);
                prop_assume!(r.is_some());
                let r = r.unwrap();
                r.colour = Some(if r.colour.as_deref() == Some("black") { "white" } else { "black" }.into());
            }
            _ => e.provenance = Provenance::Player { player: format!("p{k}") },
        }
        prop_assume!(e != d);
        prop_assert_ne!(e.hash().unwrap(), h);
    }
}

#[test]
fn hash_is_domain_separated_sha256() {
    let d = kit::Kit::shipped().design("mug").unwrap();
    let c = d.canonical_json().unwrap();
    let plain = kit::design::domain_hash("", c.as_bytes());
    assert_ne!(d.hash().unwrap(), plain);
    assert_eq!(
        d.hash().unwrap(),
        kit::design::domain_hash(kit::DESIGN_DOMAIN, c.as_bytes())
    );
    // sha256("abc") pins the primitive.
    assert_eq!(
        kit::design::domain_hash("", b"abc"),
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
}
