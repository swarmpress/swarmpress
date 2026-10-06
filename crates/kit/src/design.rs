//! The design format `swarmpress.design.v1` and its content hash.
//!
//! A design is data: a named build of catalogue parts and other designs, in a
//! closed brick script (construction-kit.md §2.2). Coordinates are integer
//! triples `[x, z, y]`: `x` and `z` in studs (x east, z south, 16 studs = 1 m),
//! `y` in plates (3 plates = 1 brick, 40 plates = 1 m). Every integer may be
//! an expression over the design's integer parameters ([`crate::expr`]).
//!
//! The canonical form ([`Design::canonical_json`]) is the design re-serialised
//! with sorted keys, no whitespace, canonical expressions (constants folded),
//! defaults omitted and tags sorted. Its domain-separated SHA-256
//! ([`Design::hash`], prefix `swarmpress:design:v1`, as ADR-0056 does for
//! records) identifies the design: a placed object refers to `{id, hash, params}`
//! and any edit gives a new hash.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::expr::{ExprError, Num};
use crate::issue::{Issue, IssueCode};

/// The `format` value of every design.
pub const DESIGN_FORMAT: &str = "swarmpress.design.v1";
/// Domain prefix of the design hash.
pub const DESIGN_DOMAIN: &str = "swarmpress:design:v1";

/// Where a design is grounded: what counts as "the ground" for the
/// no-floating-bricks rule, and how the renderer places it.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Mount {
    /// Stands on the floor (its `y = 0` layer is grounded).
    #[default]
    Floor,
    /// Stands on another design's surface at a port (a monitor on a desk);
    /// its `y = 0` layer is grounded.
    Surface,
    /// Hangs from the ceiling: its top layer (`y = height - 1`) is grounded.
    Ceiling,
}

impl Mount {
    pub fn is_floor(&self) -> bool {
        *self == Mount::Floor
    }
}

/// A parameter declaration.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case", deny_unknown_fields)]
pub enum ParamDef {
    Int {
        min: i64,
        max: i64,
        default: i64,
    },
    Enum {
        values: Vec<String>,
        default: String,
    },
    Colour {
        default: String,
        /// Colours allowed for this parameter; empty means the whole palette.
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        allowed: Vec<String>,
    },
}

/// A parameter value given to `compile` (integers for `int`, ids for `enum` and `colour`).
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ParamValue {
    Int(i64),
    Str(String),
}

/// Parameter values by name.
pub type Params = BTreeMap<String, ParamValue>;

/// The shape of a `box` or `fill` region.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Shape {
    /// The whole cuboid.
    #[default]
    Box,
    /// The upright cylinder (ellipse) inscribed in the cuboid.
    Disc,
}

impl Shape {
    pub fn is_box(&self) -> bool {
        *self == Shape::Box
    }
}

/// `box` and `fill`: a region of brick material. `part` is the material the
/// brick splitter uses: `brick` (bricks and plates, studs where visible),
/// `plate` (plates only), `tile` (smooth tiles) or, for `box` only, `empty`
/// (clears the region: openings, notches). `box` overwrites what is there;
/// `fill` only fills empty cells.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Region {
    pub at: [Num; 3],
    pub size: [Num; 3],
    pub part: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub colour: Option<String>,
    #[serde(default, skip_serializing_if = "Shape::is_box")]
    pub shape: Shape,
}

/// `part`: one catalogue part, its min corner at `at`, turned `turn` quarter
/// turns (clockwise seen from above; at turn 0 a part's front faces south,
/// `+z`). `surface` names an information surface on a part that has one.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PartOp {
    pub part: String,
    pub at: [Num; 3],
    #[serde(default = "Num::zero", skip_serializing_if = "Num::is_zero")]
    pub turn: Num,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub colour: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub surface: Option<String>,
}

/// A parameter value passed to a used design: an integer or expression for
/// `int` parameters, an id or `$param` for `enum` and `colour` parameters.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Arg {
    Int(i64),
    Str(String),
}

/// `use`: another design from the library, its footprint's min corner at
/// `at`, turned `turn`. `hash` optionally pins the exact version.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UseOp {
    pub design: String,
    pub at: [Num; 3],
    #[serde(default = "Num::zero", skip_serializing_if = "Num::is_zero")]
    pub turn: Num,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub params: BTreeMap<String, Arg>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hash: Option<String>,
    /// The object's name in the build (defaults to the design id).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Axis {
    X,
    Z,
}

/// `mirror`: the ops, then the ops mirrored across the design's footprint
/// centre on `axis`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MirrorOp {
    pub axis: Axis,
    pub ops: Vec<Op>,
}

/// `repeat`: the ops `count` times, the k-th time moved by `k * step`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RepeatOp {
    pub count: Num,
    pub step: [Num; 3],
    pub ops: Vec<Op>,
}

/// One operation of the brick script.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "kebab-case")]
pub enum Op {
    Box(Region),
    Fill(Region),
    Part(PartOp),
    Use(UseOp),
    Mirror(MirrorOp),
    Repeat(RepeatOp),
}

/// An attach point: where another design goes (`accepts` lists the tags it
/// takes, e.g. `seat`, `screen`, `light`). `at` is a grid point `[x, z, y]`
/// where the attached design's footprint centre stands, `turn` its turn
/// relative to this design.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Port {
    pub id: String,
    pub at: [Num; 3],
    pub accepts: Vec<String>,
    #[serde(default = "Num::zero", skip_serializing_if = "Num::is_zero")]
    pub turn: Num,
}

/// Who made a design (ADR-0065 decision 2; ADR-0056 for staff attribution).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum Provenance {
    /// Shipped with the kit.
    Kit,
    Player {
        player: String,
    },
    Staff {
        staff: String,
        job: String,
        model: String,
    },
    /// An SDK extension's design pack (ADR-0043).
    Pack {
        pack: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        version: Option<String>,
    },
    /// Generated from a semantic model (ADR-0072): a view of `source` at
    /// `hash` (the blueprint's town). Rebuilt when the model changes, never
    /// edited brick by brick.
    View {
        source: String,
        hash: String,
    },
}

/// Part budget a design declares for itself (capped by the compile limits).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Budget {
    pub parts: u32,
}

/// A design (`swarmpress.design.v1`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Design {
    /// Editors' schema hint; never part of the canonical form.
    #[serde(rename = "$schema", default, skip_serializing)]
    pub schema: Option<String>,
    pub format: String,
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Mount::is_floor")]
    pub mount: Mount,
    /// `[w, d]` in studs: the build must fit `0..w` × `0..d`.
    pub footprint: [Num; 2],
    /// Height in plates: the build must fit `0..height`.
    pub height: Num,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub params: BTreeMap<String, ParamDef>,
    pub ops: Vec<Op>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub ports: Vec<Port>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub budget: Option<Budget>,
    pub provenance: Provenance,
}

/// Ids, names of tags, ports, surfaces and parameters: lower-case kebab.
pub fn valid_id(s: &str) -> bool {
    let b = s.as_bytes();
    !b.is_empty()
        && b.len() <= 64
        && (b[0].is_ascii_lowercase() || b[0].is_ascii_digit())
        && b.iter()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == b'-')
        && !s.ends_with('-')
}

/// Parameter names: identifiers usable after `$` in expressions.
pub fn valid_param_name(s: &str) -> bool {
    let b = s.as_bytes();
    !b.is_empty()
        && b.len() <= 32
        && (b[0].is_ascii_lowercase() || b[0] == b'_')
        && b.iter()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == b'_')
}

fn expr_issue(design: &str, path: &[u32], what: &str, e: &ExprError) -> Issue {
    Issue::new(
        IssueCode::BadExpression,
        design,
        path,
        format!("{what}: {e}"),
    )
}

impl Design {
    /// Parse a design from JSON (shape only; [`crate::compile`] checks the rest).
    pub fn from_json(json: &str) -> Result<Design, Vec<Issue>> {
        serde_json::from_str::<Design>(json).map_err(|e| {
            let id = serde_json::from_str::<Value>(json)
                .ok()
                .and_then(|v| v.get("id").and_then(Value::as_str).map(str::to_string))
                .unwrap_or_default();
            vec![Issue::design(IssueCode::BadFormat, &id, e.to_string())]
        })
    }

    /// The design with canonical expressions and sorted, deduplicated tags.
    pub fn canonical(&self) -> Result<Design, Vec<Issue>> {
        let mut issues = Vec::new();
        let id = self.id.clone();
        let mut num = |n: &Num, path: &[u32], what: &str| -> Num {
            match n.canonical() {
                Ok(c) => c,
                Err(e) => {
                    issues.push(expr_issue(&id, path, what, &e));
                    n.clone()
                }
            }
        };
        let mut d = self.clone();
        d.schema = None;
        d.footprint = [
            num(&self.footprint[0], &[], "footprint"),
            num(&self.footprint[1], &[], "footprint"),
        ];
        d.height = num(&self.height, &[], "height");
        let mut path = Vec::new();
        d.ops = canon_ops(&self.ops, &mut path, &mut num);
        for p in &mut d.ports {
            p.at = [
                num(&p.at[0], &[], "port"),
                num(&p.at[1], &[], "port"),
                num(&p.at[2], &[], "port"),
            ];
            p.turn = num(&p.turn, &[], "port turn");
        }
        d.tags.sort();
        d.tags.dedup();
        if issues.is_empty() {
            Ok(d)
        } else {
            Err(issues)
        }
    }

    /// The canonical JSON text (the bytes that are hashed).
    pub fn canonical_json(&self) -> Result<String, Vec<Issue>> {
        let d = self.canonical()?;
        let v = serde_json::to_value(&d)
            .map_err(|e| vec![Issue::design(IssueCode::BadFormat, &self.id, e.to_string())])?;
        let mut out = String::new();
        write_canonical(&v, &mut out);
        Ok(out)
    }

    /// `sha256("swarmpress:design:v1" ‖ canonical JSON)`, lower-case hex.
    pub fn hash(&self) -> Result<String, Vec<Issue>> {
        Ok(domain_hash(
            DESIGN_DOMAIN,
            self.canonical_json()?.as_bytes(),
        ))
    }
}

fn canon3(
    num: &mut impl FnMut(&Num, &[u32], &str) -> Num,
    a: &[Num; 3],
    path: &[u32],
    what: &str,
) -> [Num; 3] {
    [
        num(&a[0], path, what),
        num(&a[1], path, what),
        num(&a[2], path, what),
    ]
}

fn canon_ops(
    ops: &[Op],
    path: &mut Vec<u32>,
    num: &mut impl FnMut(&Num, &[u32], &str) -> Num,
) -> Vec<Op> {
    let mut out = Vec::with_capacity(ops.len());
    for (i, op) in ops.iter().enumerate() {
        path.push(u32::try_from(i).unwrap_or(u32::MAX));
        let c = match op {
            Op::Box(r) | Op::Fill(r) => {
                let r = Region {
                    at: canon3(num, &r.at, path, "at"),
                    size: canon3(num, &r.size, path, "size"),
                    ..r.clone()
                };
                if matches!(op, Op::Box(_)) {
                    Op::Box(r)
                } else {
                    Op::Fill(r)
                }
            }
            Op::Part(p) => Op::Part(PartOp {
                at: canon3(num, &p.at, path, "at"),
                turn: num(&p.turn, path, "turn"),
                ..p.clone()
            }),
            Op::Use(u) => {
                let at = canon3(num, &u.at, path, "at");
                let turn = num(&u.turn, path, "turn");
                let params = u
                    .params
                    .iter()
                    .map(|(k, a)| {
                        let a = match a {
                            Arg::Int(n) => Arg::Int(*n),
                            // An argument that parses as an expression is an
                            // integer argument; anything else is an id.
                            Arg::Str(s) => match Num::Expr(s.clone()).canonical() {
                                Ok(Num::Int(n)) => Arg::Int(n),
                                Ok(Num::Expr(e)) => Arg::Str(e),
                                Err(_) => Arg::Str(s.clone()),
                            },
                        };
                        (k.clone(), a)
                    })
                    .collect();
                Op::Use(UseOp {
                    at,
                    turn,
                    params,
                    ..u.clone()
                })
            }
            Op::Mirror(m) => Op::Mirror(MirrorOp {
                axis: m.axis,
                ops: canon_ops(&m.ops, path, num),
            }),
            Op::Repeat(r) => {
                let count = num(&r.count, path, "count");
                let step = canon3(num, &r.step, path, "step");
                Op::Repeat(RepeatOp {
                    count,
                    step,
                    ops: canon_ops(&r.ops, path, num),
                })
            }
        };
        out.push(c);
        path.pop();
    }
    out
}

/// Canonical JSON: object keys sorted by bytes, no whitespace. Only integers
/// occur in designs and catalogues; a float is written as serde_json prints it.
pub fn write_canonical(v: &Value, out: &mut String) {
    match v {
        Value::Null => out.push_str("null"),
        Value::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        Value::Number(n) => out.push_str(&n.to_string()),
        Value::String(s) => out.push_str(&serde_json::to_string(s).unwrap_or_default()),
        Value::Array(a) => {
            out.push('[');
            for (i, x) in a.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_canonical(x, out);
            }
            out.push(']');
        }
        Value::Object(m) => {
            let mut keys: Vec<&String> = m.keys().collect();
            keys.sort();
            out.push('{');
            for (i, k) in keys.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                out.push_str(&serde_json::to_string(k).unwrap_or_default());
                out.push(':');
                write_canonical(&m[*k], out);
            }
            out.push('}');
        }
    }
}

/// `sha256(domain ‖ bytes)` as lower-case hex.
pub fn domain_hash(domain: &str, bytes: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(domain.as_bytes());
    h.update(bytes);
    hex(&h.finalize())
}

pub(crate) fn hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push(char::from(HEX[usize::from(b >> 4)]));
        s.push(char::from(HEX[usize::from(b & 15)]));
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    const DOC_EXAMPLE: &str = r#"{
      "format": "swarmpress.design.v1",
      "id": "desk-double",
      "name": "Double desk",
      "footprint": ["$width", 16],
      "height": 40,
      "params": { "width": { "type": "int", "min": 24, "max": 48, "default": 32 }, "top": { "type": "colour", "default": "sand" } },
      "ops": [
        { "op": "box",  "at": [0, 0, 18], "size": ["$width", 16, 1], "part": "plate", "colour": "$top" },
        { "op": "use",  "design": "desk-leg", "at": [1, 1, 0] },
        { "op": "use",  "design": "desk-leg", "at": ["$width - 3", 1, 0] },
        { "op": "part", "part": "screen-2x2", "at": [8, 12, 19], "turn": 0, "surface": "monitor" }
      ],
      "ports": [ { "id": "seat-front", "at": [8, 20, 0], "accepts": ["seat"] }, { "id": "screen", "at": [8, 12, 19], "accepts": ["screen"] } ],
      "tags": ["workstation"],
      "provenance": { "kind": "kit" }
    }"#;

    #[test]
    fn parses_the_design_document_example() {
        let d = Design::from_json(DOC_EXAMPLE).unwrap();
        assert_eq!(d.ops.len(), 4);
        let c = d.canonical_json().unwrap();
        assert!(
            c.starts_with("{\"footprint\":[\"$width\",16],\"format\""),
            "{c}"
        );
        // `turn: 0` is a default and is omitted from the canonical form.
        assert!(!c.contains("\"turn\""));
        assert_eq!(d.hash().unwrap().len(), 64);
    }

    #[test]
    fn whitespace_and_key_order_do_not_change_the_hash() {
        let a = Design::from_json(DOC_EXAMPLE).unwrap();
        let mut v: Value = serde_json::from_str(DOC_EXAMPLE).unwrap();
        v["ops"][2]["at"][0] = Value::String("$width-3".into());
        let b = Design::from_json(&serde_json::to_string_pretty(&v).unwrap()).unwrap();
        assert_eq!(a.hash().unwrap(), b.hash().unwrap());
        v["ops"][2]["at"][0] = Value::String("$width - 2".into());
        let c = Design::from_json(&v.to_string()).unwrap();
        assert_ne!(a.hash().unwrap(), c.hash().unwrap());
    }

    #[test]
    fn unknown_fields_and_floats_are_bad_format() {
        let bad = DOC_EXAMPLE.replace("\"height\": 40", "\"height\": 40.5");
        assert_eq!(
            Design::from_json(&bad).unwrap_err()[0].code,
            IssueCode::BadFormat
        );
        let bad = DOC_EXAMPLE.replace("\"tags\"", "\"level\": 18, \"tags\"");
        let e = Design::from_json(&bad).unwrap_err();
        assert_eq!(e[0].code, IssueCode::BadFormat);
        assert_eq!(e[0].design, "desk-double");
    }

    #[test]
    fn ids() {
        assert!(valid_id("desk-2"));
        assert!(!valid_id("Desk"));
        assert!(!valid_id("desk-"));
        assert!(!valid_id(""));
        assert!(valid_param_name("half_width"));
        assert!(!valid_param_name("half-width"));
    }
}
