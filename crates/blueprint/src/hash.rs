//! The blueprint's semantic hash: `sha256("swarmpress:blueprint:v1" ‖
//! canonical JSON)`, written the same way as the design hash
//! (`kit::design::write_canonical`). Counts the importer fills in (pages per
//! type, items per collection) and editor positions are not semantic and are
//! left out, so moving a brick on the canvas or publishing a page does not
//! change the site's structure.

use serde_json::Value;

use crate::format::{Blueprint, BLUEPRINT_DOMAIN};

/// The blueprint as a semantic value: counts removed.
pub fn semantic_value(bp: &Blueprint) -> Value {
    let mut v = serde_json::to_value(bp).expect("a blueprint serializes");
    for t in v["page_types"].as_array_mut().into_iter().flatten() {
        if let Some(o) = t.as_object_mut() {
            o.remove("pages");
        }
    }
    for c in v["collections"].as_array_mut().into_iter().flatten() {
        if let Some(o) = c.as_object_mut() {
            o.remove("items");
        }
    }
    v
}

pub fn canonical_json(bp: &Blueprint) -> String {
    let mut out = String::new();
    kit::design::write_canonical(&semantic_value(bp), &mut out);
    out
}

/// Lower-case hex.
pub fn hash(bp: &Blueprint) -> String {
    kit::design::domain_hash(BLUEPRINT_DOMAIN, canonical_json(bp).as_bytes())
}
