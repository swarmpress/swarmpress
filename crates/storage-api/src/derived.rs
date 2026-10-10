//! Values WordPress derives and stores, corrected after a merge.
//!
//! A term taxonomy's `count` is the number of published objects carrying it. Two branches that
//! each tag a post merge their posts cleanly, but each side's count was computed alone (base 1,
//! both sides 2), so the merged count would be wrong (2 instead of 3). After a merge the counts
//! are recomputed from the merged posts.

use std::collections::BTreeMap;

use serde_json::Value;

/// Recomputes every term taxonomy's `count` from the posts in `objects`.
pub fn recount_terms(objects: &mut BTreeMap<String, Value>) {
    let mut counts: BTreeMap<String, i64> = BTreeMap::new();
    for (k, v) in objects.iter() {
        if !k.starts_with("post:") {
            continue;
        }
        let status = v["row"]["post_status"].as_str().unwrap_or("");
        let ptype = v["row"]["post_type"].as_str().unwrap_or("");
        let counted = status == "publish" || (ptype == "attachment" && status == "inherit");
        if !counted {
            continue;
        }
        for tt in v
            .get("terms")
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
            .map(|(tt, _)| tt)
        {
            *counts.entry(tt.clone()).or_default() += 1;
        }
    }
    for (k, v) in objects.iter_mut() {
        if !k.starts_with("term:") {
            continue;
        }
        if let Some(tax) = v.get_mut("taxonomies").and_then(Value::as_object_mut) {
            for (tt, row) in tax.iter_mut() {
                // Link categories count links, which posts do not carry: leave them.
                if row.get("taxonomy").and_then(Value::as_str) == Some("link_category") {
                    continue;
                }
                if let Some(o) = row.as_object_mut() {
                    o.insert(
                        "count".into(),
                        Value::from(counts.get(tt).copied().unwrap_or(0)),
                    );
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn counts_follow_the_merged_published_posts() {
        let mut o: BTreeMap<String, Value> = BTreeMap::new();
        o.insert("term:3".into(), json!({"row": {"name": "harvest"}, "taxonomies": {"3": {"taxonomy": "post_tag", "count": 2}}}));
        for (id, status) in [(1, "publish"), (2, "publish"), (3, "publish"), (4, "draft")] {
            o.insert(
                format!("post:{id}"),
                json!({"row": {"post_status": status, "post_type": "post"}, "terms": {"3": 0}}),
            );
        }
        recount_terms(&mut o);
        assert_eq!(o["term:3"]["taxonomies"]["3"]["count"], 3);
    }
}
