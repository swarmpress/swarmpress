//! Three-way merges of objects (ADR-0080 §4): JSON objects merge field by field, block lists
//! merge block by block (diff3 over the base), a block changed on both sides merges its
//! attributes and inner blocks recursively. Anything both sides changed differently is a typed
//! [`Conflict`], never a silent choice.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

/// Something both sides changed differently.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Conflict {
    /// The object (`post:12`).
    pub key: String,
    /// Where in it (`row.post_title`, `blocks[2].attrs.level`); empty for the whole object.
    pub path: String,
    pub base: Value,
    pub ours: Value,
    pub theirs: Value,
}

/// Arrays merged as block lists: a post's `blocks` and a block's `inner`.
fn is_block_list(field: &str) -> bool {
    field == "blocks" || field == "inner"
}

/// Merges one value; `path` names it for conflicts.
pub fn merge_value(
    key: &str,
    path: &str,
    base: &Value,
    ours: &Value,
    theirs: &Value,
    out: &mut Vec<Conflict>,
) -> Value {
    if ours == theirs || theirs == base {
        return ours.clone();
    }
    if ours == base {
        return theirs.clone();
    }
    let field = path.rsplit(['.', ']']).next().unwrap_or(path);
    match (base, ours, theirs) {
        (Value::Object(b), Value::Object(o), Value::Object(t)) => {
            Value::Object(merge_maps(key, path, b, o, t, out))
        }
        (Value::Array(b), Value::Array(o), Value::Array(t)) if is_block_list(field) => {
            Value::Array(merge_blocks(key, path, b, o, t, out))
        }
        _ => {
            out.push(Conflict {
                key: key.into(),
                path: path.into(),
                base: base.clone(),
                ours: ours.clone(),
                theirs: theirs.clone(),
            });
            ours.clone()
        }
    }
}

fn join(path: &str, field: &str) -> String {
    if path.is_empty() {
        field.to_string()
    } else {
        format!("{path}.{field}")
    }
}

fn merge_maps(
    key: &str,
    path: &str,
    b: &Map<String, Value>,
    o: &Map<String, Value>,
    t: &Map<String, Value>,
    out: &mut Vec<Conflict>,
) -> Map<String, Value> {
    let mut keys: Vec<&String> = b.keys().chain(o.keys()).chain(t.keys()).collect();
    keys.sort();
    keys.dedup();
    let mut m = Map::new();
    for k in keys {
        let (bv, ov, tv) = (b.get(k), o.get(k), t.get(k));
        let null = Value::Null;
        // A field absent on a side is "removed" there; Null stands for absent in the merge.
        let merged = merge_value(
            key,
            &join(path, k),
            bv.unwrap_or(&null),
            ov.unwrap_or(&null),
            tv.unwrap_or(&null),
            out,
        );
        let removed =
            (ov.is_none() && tv.is_none()) || (merged.is_null() && (ov.is_none() || tv.is_none()));
        if !removed {
            m.insert(k.clone(), merged);
        }
    }
    m
}

/// The longest common subsequence of `a` and `b`, as index pairs.
pub fn lcs<T: PartialEq>(a: &[T], b: &[T]) -> Vec<(usize, usize)> {
    let (n, m) = (a.len(), b.len());
    let mut dp = vec![vec![0u32; m + 1]; n + 1];
    for i in (0..n).rev() {
        for j in (0..m).rev() {
            dp[i][j] = if a[i] == b[j] {
                dp[i + 1][j + 1] + 1
            } else {
                dp[i + 1][j].max(dp[i][j + 1])
            };
        }
    }
    let (mut i, mut j, mut out) = (0, 0, Vec::new());
    while i < n && j < m {
        if a[i] == b[j] {
            out.push((i, j));
            i += 1;
            j += 1;
        } else if dp[i + 1][j] >= dp[i][j + 1] {
            i += 1;
        } else {
            j += 1;
        }
    }
    out
}

/// What one side did to the base list: per base block keep, delete or replace, and the blocks
/// it inserted before each base position (and at the end).
enum Op {
    Keep,
    Delete,
    Replace(Value),
}

fn side_ops(base: &[Value], side: &[Value]) -> (Vec<Op>, Vec<Vec<Value>>) {
    let mut ops: Vec<Op> = (0..base.len()).map(|_| Op::Delete).collect();
    let mut inserts: Vec<Vec<Value>> = vec![Vec::new(); base.len() + 1];
    let mut pairs = lcs(base, side);
    pairs.push((base.len(), side.len()));
    let (mut pb, mut ps) = (0, 0);
    for (bi, si) in pairs {
        let (gb, gs) = (bi - pb, si - ps);
        if gb == gs {
            // The same number of blocks between anchors: each changed in place.
            for n in 0..gb {
                ops[pb + n] = if base[pb + n] == side[ps + n] {
                    Op::Keep
                } else {
                    Op::Replace(side[ps + n].clone())
                };
            }
        } else {
            // Base blocks in the gap stay Delete; the side's blocks are inserted after them.
            inserts[bi].extend_from_slice(&side[ps..si]);
        }
        if bi < base.len() {
            ops[bi] = Op::Keep;
        }
        (pb, ps) = (bi + 1, si + 1);
    }
    (ops, inserts)
}

/// Block lists merge block by block: each side's changes are aligned to the base, and two sides
/// conflict only where they changed the same block differently or inserted different blocks at
/// the same place. The same block changed on both sides merges recursively.
fn merge_blocks(
    key: &str,
    path: &str,
    b: &[Value],
    o: &[Value],
    t: &[Value],
    out: &mut Vec<Conflict>,
) -> Vec<Value> {
    let (oo, oi) = side_ops(b, o);
    let (to, ti) = side_ops(b, t);
    let mut res: Vec<Value> = Vec::new();
    let conflict = |res: &Vec<Value>,
                    base: Vec<Value>,
                    ours: Vec<Value>,
                    theirs: Vec<Value>,
                    out: &mut Vec<Conflict>| {
        out.push(Conflict {
            key: key.into(),
            path: format!("{path}[{}]", res.len()),
            base: Value::Array(base),
            ours: Value::Array(ours),
            theirs: Value::Array(theirs),
        });
    };
    for i in 0..=b.len() {
        let (a, c) = (&oi[i], &ti[i]);
        if a == c || c.is_empty() {
            res.extend_from_slice(a);
        } else if a.is_empty() {
            res.extend_from_slice(c);
        } else {
            conflict(&res, vec![], a.clone(), c.clone(), out);
            res.extend_from_slice(a);
        }
        if i == b.len() {
            break;
        }
        match (&oo[i], &to[i]) {
            (Op::Keep, Op::Keep) => res.push(b[i].clone()),
            (Op::Keep, Op::Delete) | (Op::Delete, Op::Keep) | (Op::Delete, Op::Delete) => {}
            (Op::Keep, Op::Replace(v)) | (Op::Replace(v), Op::Keep) => res.push(v.clone()),
            (Op::Replace(x), Op::Replace(y)) if x == y => res.push(x.clone()),
            (Op::Replace(x), Op::Replace(y))
                if x.get("name") == b[i].get("name") && y.get("name") == b[i].get("name") =>
            {
                let p = format!("{path}[{}]", res.len());
                res.push(merge_block(key, &p, &b[i], x, y, out));
            }
            (Op::Replace(x), Op::Replace(y)) => {
                conflict(
                    &res,
                    vec![b[i].clone()],
                    vec![x.clone()],
                    vec![y.clone()],
                    out,
                );
                res.push(x.clone());
            }
            (Op::Replace(x), Op::Delete) => {
                conflict(&res, vec![b[i].clone()], vec![x.clone()], vec![], out);
                res.push(x.clone());
            }
            (Op::Delete, Op::Replace(y)) => {
                conflict(&res, vec![b[i].clone()], vec![], vec![y.clone()], out);
            }
        }
    }
    res
}

/// One block changed on both sides: attributes field by field, inner blocks as a block list.
/// `attrs_raw` follows `attrs` when they merged to something new.
fn merge_block(
    key: &str,
    path: &str,
    b: &Value,
    o: &Value,
    t: &Value,
    out: &mut Vec<Conflict>,
) -> Value {
    let (Some(bm), Some(om), Some(tm)) = (b.as_object(), o.as_object(), t.as_object()) else {
        out.push(Conflict {
            key: key.into(),
            path: path.into(),
            base: b.clone(),
            ours: o.clone(),
            theirs: t.clone(),
        });
        return o.clone();
    };
    let strip = |m: &Map<String, Value>| {
        let mut m = m.clone();
        m.remove("attrs_raw");
        m
    };
    let (bs, os, ts) = (strip(bm), strip(om), strip(tm));
    let mut merged = merge_maps(key, path, &bs, &os, &ts, out);
    let attrs = merged.get("attrs").cloned().unwrap_or(Value::Null);
    let raw = if Some(&attrs) == om.get("attrs") {
        om.get("attrs_raw").cloned()
    } else if Some(&attrs) == tm.get("attrs") {
        tm.get("attrs_raw").cloned()
    } else if attrs.is_null() {
        None
    } else {
        Some(Value::String(
            serde_json::to_string(&attrs).unwrap_or_default(),
        ))
    };
    if let Some(r) = raw {
        merged.insert("attrs_raw".into(), r);
    }
    Value::Object(merged)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn p(text: &str) -> Value {
        json!({"t": "block", "name": "paragraph", "inner": [{"t": "html", "html": text}]})
    }

    #[test]
    fn fields_changed_on_different_sides_both_land() {
        let mut c = Vec::new();
        let m = merge_value(
            "post:1",
            "",
            &json!({"row": {"post_title": "A", "post_excerpt": ""}}),
            &json!({"row": {"post_title": "B", "post_excerpt": ""}}),
            &json!({"row": {"post_title": "A", "post_excerpt": "short"}}),
            &mut c,
        );
        assert!(c.is_empty());
        assert_eq!(
            m,
            json!({"row": {"post_title": "B", "post_excerpt": "short"}})
        );
    }

    #[test]
    fn the_same_field_changed_differently_is_a_typed_conflict() {
        let mut c = Vec::new();
        merge_value(
            "post:1",
            "",
            &json!({"row": {"post_title": "A"}}),
            &json!({"row": {"post_title": "B"}}),
            &json!({"row": {"post_title": "C"}}),
            &mut c,
        );
        assert_eq!(c.len(), 1);
        assert_eq!(c[0].path, "row.post_title");
        assert_eq!(
            (c[0].ours.clone(), c[0].theirs.clone()),
            (json!("B"), json!("C"))
        );
    }

    #[test]
    fn blocks_added_and_edited_on_different_sides_merge() {
        let base = json!({"blocks": [p("one"), p("two"), p("three")]});
        // ours edits block two; theirs adds a block after three and removes one
        let ours = json!({"blocks": [p("one"), p("TWO"), p("three")]});
        let theirs = json!({"blocks": [p("two"), p("three"), p("four")]});
        let mut c = Vec::new();
        let m = merge_value("post:1", "", &base, &ours, &theirs, &mut c);
        assert!(c.is_empty(), "{c:?}");
        assert_eq!(m, json!({"blocks": [p("TWO"), p("three"), p("four")]}));
    }

    #[test]
    fn the_same_block_edited_differently_conflicts_at_that_block() {
        let base = json!({"blocks": [p("one"), p("two")]});
        let ours = json!({"blocks": [p("one"), p("ours")]});
        let theirs = json!({"blocks": [p("one"), p("theirs")]});
        let mut c = Vec::new();
        merge_value("post:1", "", &base, &ours, &theirs, &mut c);
        assert_eq!(c.len(), 1);
        assert!(c[0].path.starts_with("blocks[1]"), "{}", c[0].path);
    }

    #[test]
    fn a_block_s_attributes_merge_field_by_field() {
        let b = json!({"t": "block", "name": "heading", "attrs": {"level": 2, "textAlign": "left"}, "attrs_raw": "{\"level\":2,\"textAlign\":\"left\"}", "inner": []});
        let o = json!({"t": "block", "name": "heading", "attrs": {"level": 3, "textAlign": "left"}, "attrs_raw": "{\"level\":3,\"textAlign\":\"left\"}", "inner": []});
        let t = json!({"t": "block", "name": "heading", "attrs": {"level": 2, "textAlign": "center"}, "attrs_raw": "{\"level\":2,\"textAlign\":\"center\"}", "inner": []});
        let mut c = Vec::new();
        let m = merge_value(
            "post:1",
            "",
            &json!({"blocks": [b]}),
            &json!({"blocks": [o]}),
            &json!({"blocks": [t]}),
            &mut c,
        );
        assert!(c.is_empty(), "{c:?}");
        assert_eq!(
            m["blocks"][0]["attrs"],
            json!({"level": 3, "textAlign": "center"})
        );
        assert_eq!(
            m["blocks"][0]["attrs_raw"],
            json!("{\"level\":3,\"textAlign\":\"center\"}")
        );
    }
}
