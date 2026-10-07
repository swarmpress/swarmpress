//! Writer-facing block documentation generated from the schema registry.
//!
//! Legacy lesson: hand-written prompt docs drifted from the Zod schema and
//! the writer produced blocks the validator rejected. Here the docs are a
//! pure function of the registered schemas plus block metadata.

use std::fmt::Write as _;

use serde_json::{json, Map, Value};

use crate::blocks::{BlockCategory, EntityMatch};
use crate::registry::{BlockSchema, SchemaRegistry, LINK_KEYS, MEDIA_KEYS, STRUCTURAL_KEYS};

const MAX_DEPTH: usize = 3;

fn field_role(key: &str) -> Option<&'static str> {
    if MEDIA_KEYS.contains(&key) {
        Some("media")
    } else if LINK_KEYS.contains(&key) {
        Some("link")
    } else {
        None
    }
}

fn type_label(schema: &Value, key: &str) -> String {
    if let Some(c) = schema.get("const") {
        return c.to_string();
    }
    if let Some(Value::Array(e)) = schema.get("enum") {
        return e
            .iter()
            .map(Value::to_string)
            .collect::<Vec<_>>()
            .join(" | ");
    }
    if let Some(Value::Array(alts)) = schema.get("anyOf").or_else(|| schema.get("oneOf")) {
        return alts
            .iter()
            .map(|a| type_label(a, key))
            .collect::<Vec<_>>()
            .join(" | ");
    }
    match schema.get("type").and_then(Value::as_str) {
        Some("string") => match field_role(key) {
            Some("media") => "media".into(),
            Some("link") => "link".into(),
            _ if schema.get("format").is_some() => {
                format!("string ({})", schema["format"].as_str().unwrap_or_default())
            }
            _ if STRUCTURAL_KEYS.contains(&key) => "string".into(),
            _ => "text".into(),
        },
        Some("array") => format!("list of {}", type_label(&schema["items"], key)),
        Some("object") => {
            if schema.get("properties").is_some() {
                "object".into()
            } else {
                "map".into()
            }
        }
        Some(t) => t.to_string(),
        None => "any".into(),
    }
}

fn constraints(schema: &Value) -> Vec<String> {
    let mut out = vec![];
    let target = if schema["type"] == "array" {
        &schema["items"]
    } else {
        schema
    };
    if let Some(n) = target.get("minLength").and_then(Value::as_u64) {
        if n > 0 {
            out.push("non-empty".to_string());
        }
    }
    for (k, label) in [("minimum", "min"), ("maximum", "max")] {
        if let Some(n) = schema.get(k) {
            out.push(format!("{label} {n}"));
        }
    }
    if let Some(n) = schema.get("minItems") {
        out.push(format!("at least {n} item(s)"));
    }
    if let Some(d) = schema.get("default") {
        out.push(format!("default {d}"));
    }
    out
}

fn write_fields(out: &mut String, schema: &Value, depth: usize) {
    let Some(props) = schema.get("properties").and_then(Value::as_object) else {
        return;
    };
    let required: Vec<&str> = schema
        .get("required")
        .and_then(Value::as_array)
        .map(|r| r.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default();
    let indent = "  ".repeat(depth);
    for (k, v) in props {
        if k == "type" && v.get("const").is_some() {
            continue;
        }
        let mut notes = vec![if required.contains(&k.as_str()) {
            "required".to_string()
        } else {
            "optional".to_string()
        }];
        notes.extend(constraints(v));
        let _ = writeln!(
            out,
            "{indent}- `{k}`: {} ({})",
            type_label(v, k),
            notes.join(", ")
        );
        let nested = if v["type"] == "array" { &v["items"] } else { v };
        if depth + 1 < MAX_DEPTH && nested.get("properties").is_some() {
            write_fields(out, nested, depth + 1);
        }
    }
}

fn placeholder(schema: &Value, key: &str) -> Value {
    if let Some(c) = schema.get("const") {
        return c.clone();
    }
    if let Some(Value::Array(e)) = schema.get("enum") {
        return e.first().cloned().unwrap_or(Value::Null);
    }
    if let Some(Value::Array(alts)) = schema.get("anyOf").or_else(|| schema.get("oneOf")) {
        return alts
            .first()
            .map(|a| placeholder(a, key))
            .unwrap_or(Value::Null);
    }
    match schema.get("type").and_then(Value::as_str) {
        Some("string") => match field_role(key) {
            Some("media") => json!("media:IMAGE_ID"),
            Some("link") => json!("<resolve_link>"),
            _ => json!("…"),
        },
        Some("integer") | Some("number") => {
            schema.get("minimum").cloned().unwrap_or_else(|| json!(1))
        }
        Some("boolean") => json!(false),
        Some("array") => match schema.get("minItems").and_then(Value::as_u64) {
            Some(n) if n > 0 => json!([placeholder(&schema["items"], key)]),
            _ => json!([]),
        },
        Some("object") => minimal_example(schema),
        _ => Value::Null,
    }
}

fn minimal_example(schema: &Value) -> Value {
    let mut out = Map::new();
    let Some(props) = schema.get("properties").and_then(Value::as_object) else {
        return Value::Object(out);
    };
    for r in schema
        .get("required")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
    {
        if let Some(p) = props.get(r) {
            out.insert(r.to_string(), placeholder(p, r));
        }
    }
    Value::Object(out)
}

fn write_block(out: &mut String, b: &BlockSchema) {
    let m = &b.meta;
    let intent = serde_json::to_value(m.intent).unwrap_or_default();
    let _ = writeln!(
        out,
        "### `{}` — {}\n\n{}.\n",
        b.block_type,
        intent.as_str().unwrap_or_default(),
        m.description
    );
    if let Some(media) = &m.media {
        let matching = match media.entity_match {
            EntityMatch::Strict => "must show the block's own village/entity (or `region`)",
            EntityMatch::Category => "must match the category; any village",
            EntityMatch::None => "generic imagery is fine",
        };
        let _ = write!(
            out,
            "- Media: {} {}–{} image(s); {}",
            if media.required {
                "required,"
            } else {
                "optional,"
            },
            media.min,
            media.max,
            matching
        );
        if !media.allowed_categories.is_empty() {
            let _ = write!(out, "; categories: {}", media.allowed_categories.join(", "));
        }
        out.push('\n');
    }
    if let Some(l) = &m.linking {
        let _ = write!(out, "- Links: {}–{} internal", l.min_links, l.max_links);
        if !l.allowed_targets.is_empty() {
            let _ = write!(out, " to {}", l.allowed_targets.join(", "));
        }
        if let Some(g) = &l.anchor_guidance {
            let _ = write!(out, ". {g}");
        }
        out.push('\n');
    }
    if !m.context.is_empty() {
        let _ = writeln!(out, "- Needs context: {}", m.context.join(", "));
    }
    let _ = writeln!(out, "- Fields:");
    let mut fields = String::new();
    write_fields(&mut fields, &b.v1, 1);
    out.push_str(&fields);
    let _ = writeln!(
        out,
        "- Minimal example: `{}`\n",
        serde_json::to_string(&minimal_example(&b.v1)).unwrap_or_default()
    );
}

/// The reference of one block type as [`blocks_doc`] writes it (meaning,
/// media, linking, fields, a minimal example), `None` for a type `registry`
/// does not know. A theme component's prompt reads it (FEAT-094).
pub fn block_doc(registry: &SchemaRegistry, block_type: &str) -> Option<String> {
    let b = registry.get(block_type)?;
    let mut out = String::new();
    write_block(&mut out, b);
    Some(out.trim_end().to_string())
}

/// Markdown block reference for writer prompts, generated from `registry`.
pub fn blocks_doc(registry: &SchemaRegistry) -> String {
    let custom = registry.custom_types().len();
    let mut out = String::new();
    let _ = writeln!(
        out,
        "# Block reference\n\nGenerated from the JSON Schemas of {} block types ({} core, {} custom). \
Do not invent block types or fields.\n",
        registry.len(),
        registry.len() - custom,
        custom
    );
    out.push_str(
        "## Conventions\n\n\
- A page body is a JSON array of blocks; every block has a `type`.\n\
- `text` fields take a plain string or a localized object `{\"en\": \"…\", \"de\": \"…\"}`; `en` is required.\n\
- `media` fields take `media:<id>` from the site's media index (use `suggest_media`); never invent image URLs.\n\
- `link` fields take URLs returned by `resolve_link` (plain or per-language object); never invent internal URLs.\n\
- Inline emphasis belongs in structured fields, not ad-hoc markup.\n\n",
    );
    let sections = [
        (BlockCategory::Core, "Core blocks"),
        (BlockCategory::Section, "Section blocks"),
        (BlockCategory::Theme, "Theme blocks"),
        (BlockCategory::Editorial, "Editorial blocks"),
        (BlockCategory::Template, "Template blocks"),
        (BlockCategory::Custom, "Site custom blocks (`x:`)"),
    ];
    for (cat, title) in sections {
        let blocks: Vec<_> = registry
            .blocks()
            .filter(|b| b.meta.category == cat)
            .collect();
        if blocks.is_empty() {
            continue;
        }
        let _ = writeln!(out, "## {title}\n");
        for b in blocks {
            write_block(&mut out, b);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::blocks::CORE_BLOCK_TYPES;

    #[test]
    fn documents_every_block_from_schema() {
        let mut r = SchemaRegistry::core();
        r.register_custom(
            "wine-map",
            json!({"type": "object", "description": "Wineries map", "properties": {"title": {"type": "string"}, "pins": {"type": "array", "items": {"type": "object", "properties": {"lat": {"type": "number"}}}}}, "required": ["pins"]}),
        )
        .unwrap();
        let doc = blocks_doc(&r);
        for t in CORE_BLOCK_TYPES {
            assert!(doc.contains(&format!("### `{t}`")), "{t} undocumented");
        }
        assert!(doc.contains("### `x:wine-map`"));
        assert!(doc.contains("47 block types (46 core, 1 custom)"));
        assert!(doc.contains("- `markdown`: text (required, non-empty)"));
        assert!(doc.contains("- `level`: 2 | 3 | 4 (required)"));
        assert!(doc.contains("`{\"pins\":[],\"type\":\"x:wine-map\"}`"));
        assert!(doc.contains("    - `lat`: number (optional)"));
        // One block's reference is its part of the whole.
        let one = block_doc(&r, "heading").unwrap();
        assert!(
            one.starts_with("### `heading`") && doc.contains(&one),
            "{one}"
        );
        assert!(block_doc(&r, "nope").is_none());
    }

    #[test]
    fn examples_validate_under_v2_for_simple_blocks() {
        let r = SchemaRegistry::core();
        for t in [
            "paragraph",
            "heading",
            "quote",
            "faq",
            "list",
            "gallery",
            "callout",
        ] {
            let ex = minimal_example(&r.get(t).unwrap().v1);
            assert!(r.get(t).unwrap().validator().is_valid(&ex), "{t}: {ex}");
        }
    }
}
