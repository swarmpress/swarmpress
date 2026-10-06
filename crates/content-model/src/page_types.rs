//! The page-type registry (FEAT-089, ADR-0072): what a page of each type may
//! hold, as data.
//!
//! The format (`swarmpress.page-types.v1`) and the core types are defined in
//! Zod (`packages/content-schema/src/page-types.ts`) and exported to
//! `crates/content-schema/schema/`. A site declares its own types in
//! [`SITE_PAGE_TYPES_PATH`], in the same format.
//!
//! A page type's slots are ordered and name disjoint block sets: the body is
//! the blocks of the first slot, then those of the second, and so on, each
//! slot holding between `min` and `max` blocks. [`PageType::check_body`]
//! reports, in this order:
//!
//! 1. blocks no slot names;
//! 2. slots holding too few or too many blocks;
//! 3. a first or last slot that must be filled but does not open or close
//!    the body;
//! 4. blocks out of slot order;
//! 5. `require` minimums;
//! 6. raw `<` or `>` in fields the theme prints as HTML.
//!
//! Everything here is pure, so the gateway, the browser (through wasm) and
//! the eval harness run the very same checks.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Where a site declares its own page types.
pub const SITE_PAGE_TYPES_PATH: &str = "content/config/page-types.json";
/// The registry format.
pub const PAGE_TYPES_FORMAT: &str = "swarmpress.page-types.v1";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Slot {
    pub id: String,
    pub blocks: Vec<String>,
    #[serde(default)]
    pub min: u32,
    /// `None`: any number.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Require {
    pub block: String,
    pub min: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HtmlField {
    pub block: String,
    pub field: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PageType {
    pub id: String,
    /// lang → label; `en` is required.
    pub label: BTreeMap<String, String>,
    #[serde(default)]
    pub aliases: Vec<String>,
    /// Route pattern with `{lang}` and `{slug}` placeholders.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub route: Option<String>,
    /// `None`: the body is not constrained.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub slots: Option<Vec<Slot>>,
    #[serde(default)]
    pub require: Vec<Require>,
    #[serde(default)]
    pub html_fields: Vec<HtmlField>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct PageTypesFile {
    format: String,
    page_types: Vec<PageType>,
}

/// One problem of a page body against its type.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct BodyIssue {
    /// JSON pointer into the page (`/body`, `/body/3`, `/body/0/title`).
    pub pointer: String,
    /// The whole problem as text an agent can act on (it names the pointer).
    pub message: String,
}

impl std::fmt::Display for BodyIssue {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

/// A set of page types, looked up by id or alias.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct PageTypes {
    types: Vec<PageType>,
}

fn kind(block: &Value) -> &str {
    block.get("type").and_then(Value::as_str).unwrap_or("")
}

/// Every string a v2 text field holds: the plain value, or each language of
/// a localized object.
fn texts(value: &Value) -> Vec<&str> {
    match value {
        Value::String(s) => vec![s.as_str()],
        Value::Object(m) => m.values().filter_map(Value::as_str).collect(),
        _ => Vec::new(),
    }
}

fn count_word(n: u32) -> String {
    match n {
        1 => "one".into(),
        2 => "two".into(),
        3 => "three".into(),
        n => n.to_string(),
    }
}

impl Slot {
    /// `editorial-hero`, or `a block of slot body (heading, paragraph)`.
    fn name(&self) -> String {
        match self.blocks.as_slice() {
            [one] => one.clone(),
            many => format!("blocks of slot {} ({})", self.id, many.join(", ")),
        }
    }

    /// `the editorial-hero`, or `one of heading, paragraph`.
    fn the(&self) -> String {
        match self.blocks.as_slice() {
            [one] => format!("the {one}"),
            many => format!("one of {}", many.join(", ")),
        }
    }
}

impl PageType {
    /// The English label.
    pub fn label_en(&self) -> &str {
        self.label.get("en").map(String::as_str).unwrap_or(&self.id)
    }

    /// Whether `name` is this type's id or one of its aliases.
    pub fn is(&self, name: &str) -> bool {
        self.id == name || self.aliases.iter().any(|a| a == name)
    }

    /// The blocks the body may hold, in slot order; `None` when the type does
    /// not constrain its body.
    pub fn allowed_blocks(&self) -> Option<Vec<&str>> {
        self.slots.as_ref().map(|slots| {
            slots
                .iter()
                .flat_map(|s| s.blocks.iter().map(String::as_str))
                .collect()
        })
    }

    /// The type's route for one language and slug, when it has a pattern.
    pub fn route_for(&self, lang: &str, slug: &str) -> Option<String> {
        self.route
            .as_ref()
            .map(|r| r.replace("{lang}", lang).replace("{slug}", slug))
    }

    /// The rules a single type must keep: disjoint slots, unique slot ids,
    /// `min` not above `max`.
    fn rule_errors(&self) -> Vec<String> {
        let mut out = Vec::new();
        let mut slot_of: BTreeMap<&str, &str> = BTreeMap::new();
        let mut ids = BTreeSet::new();
        for slot in self.slots.iter().flatten() {
            if !ids.insert(slot.id.as_str()) {
                out.push(format!("{}: slot {} is declared twice", self.id, slot.id));
            }
            if slot.max.is_some_and(|max| slot.min > max) {
                out.push(format!("{}: slot {} has min above max", self.id, slot.id));
            }
            for block in &slot.blocks {
                if let Some(other) = slot_of.insert(block, &slot.id) {
                    out.push(format!(
                        "{}: block {block} is in slots {other} and {}: a block belongs to one slot",
                        self.id, slot.id
                    ));
                }
            }
        }
        out
    }

    /// The page body against this type. Empty: the body fits.
    pub fn check_body(&self, body: &[Value]) -> Vec<BodyIssue> {
        let mut out = Vec::new();
        let mut issue = |pointer: String, message: String| out.push(BodyIssue { pointer, message });
        let types: Vec<&str> = body.iter().map(kind).collect();

        if let Some(slots) = &self.slots {
            let slot_of: BTreeMap<&str, usize> = slots
                .iter()
                .enumerate()
                .flat_map(|(i, s)| s.blocks.iter().map(move |b| (b.as_str(), i)))
                .collect();
            let allowed = self.allowed_blocks().unwrap_or_default().join(", ");

            // 1. Blocks no slot names.
            for (i, t) in types.iter().enumerate() {
                if !slot_of.contains_key(t) {
                    issue(
                        format!("/body/{i}"),
                        format!(
                            "/body/{i}: `{t}` is not allowed in a {} page (allowed: {allowed})",
                            self.id
                        ),
                    );
                }
            }

            // 2. Slot counts.
            for (si, slot) in slots.iter().enumerate() {
                let n = types
                    .iter()
                    .filter(|t| slot_of.get(*t) == Some(&si))
                    .count() as u32;
                let name = slot.name();
                match slot.max {
                    Some(max) if max == slot.min && n != max => issue(
                        "/body".into(),
                        format!(
                            "/body must hold exactly {} {name}, found {n}",
                            count_word(max)
                        ),
                    ),
                    Some(max) if n > max => issue(
                        "/body".into(),
                        format!(
                            "/body must hold at most {} {name}, found {n}",
                            count_word(max)
                        ),
                    ),
                    _ if n < slot.min => issue(
                        "/body".into(),
                        format!(
                            "/body must hold at least {} {name}, found {n}",
                            count_word(slot.min)
                        ),
                    ),
                    _ => {}
                }
            }

            // 3. A filled first or last slot opens or closes the body.
            if let Some(first) = slots.first().filter(|s| s.min > 0) {
                if types.first().and_then(|t| slot_of.get(t)) != Some(&0) {
                    issue("/body/0".into(), format!("/body/0 must be {}", first.the()));
                }
            }
            if let Some(last) = slots.last().filter(|s| s.min > 0 && slots.len() > 1) {
                if types.last().and_then(|t| slot_of.get(t)) != Some(&(slots.len() - 1)) {
                    issue(
                        format!("/body/{}", types.len().saturating_sub(1)),
                        format!("the last block of /body must be {}", last.the()),
                    );
                }
            }

            // 4. Slot order.
            let mut furthest = 0;
            for (i, t) in types.iter().enumerate() {
                let Some(&si) = slot_of.get(t) else { continue };
                if si < furthest {
                    issue(
                        format!("/body/{i}"),
                        format!(
                            "/body/{i}: `{t}` (slot {}) must come before the {} slot",
                            slots[si].id, slots[furthest].id
                        ),
                    );
                } else {
                    furthest = si;
                }
            }
        }

        // 5. Required minimums.
        for r in &self.require {
            let n = types.iter().filter(|t| **t == r.block).count() as u32;
            if n < r.min {
                issue(
                    "/body".into(),
                    format!("/body must hold at least {} {}", count_word(r.min), r.block),
                );
            }
        }

        // 6. Fields printed as HTML.
        for (i, block) in body.iter().enumerate() {
            for f in self.html_fields.iter().filter(|f| f.block == types[i]) {
                let raw = block
                    .get(&f.field)
                    .is_some_and(|v| texts(v).iter().any(|s| s.contains(['<', '>'])));
                if raw {
                    issue(
                        format!("/body/{i}/{}", f.field),
                        format!(
                            "/body/{i}/{} is printed as HTML: it must not contain a raw `<` or `>` (escape them)",
                            f.field
                        ),
                    );
                }
            }
        }
        out
    }
}

impl PageTypes {
    /// The core types the platform has rules for.
    pub fn core() -> &'static PageTypes {
        static CORE: OnceLock<PageTypes> = OnceLock::new();
        CORE.get_or_init(|| {
            let v: Value = serde_json::from_str(content_schema::CORE_PAGE_TYPES_JSON)
                .expect("the core page types are JSON");
            PageTypes::parse(&v).expect("the core page types are valid")
        })
    }

    /// A registry file: the exported format, then the cross-field rules.
    pub fn parse(file: &Value) -> Result<PageTypes, Vec<String>> {
        content_schema::validate_page_types(file)?;
        let file: PageTypesFile =
            serde_json::from_value(file.clone()).map_err(|e| vec![e.to_string()])?;
        if file.format != PAGE_TYPES_FORMAT {
            return Err(vec![format!("format must be {PAGE_TYPES_FORMAT:?}")]);
        }
        let types = PageTypes {
            types: file.page_types,
        };
        let errors = types.rule_errors();
        if errors.is_empty() {
            Ok(types)
        } else {
            Err(errors)
        }
    }

    fn rule_errors(&self) -> Vec<String> {
        let mut out: Vec<String> = self.types.iter().flat_map(PageType::rule_errors).collect();
        let mut names = BTreeSet::new();
        for t in &self.types {
            for name in std::iter::once(&t.id).chain(&t.aliases) {
                if !names.insert(name.as_str()) {
                    out.push(format!("page type {name} is declared twice"));
                }
            }
        }
        out
    }

    /// These types followed by a site's own. A site type may not reuse a
    /// core id or alias: the core rules are the gateway's.
    pub fn with_site(&self, site: &PageTypes) -> Result<PageTypes, Vec<String>> {
        let merged = PageTypes {
            types: self.types.iter().chain(&site.types).cloned().collect(),
        };
        let errors = merged.rule_errors();
        if errors.is_empty() {
            Ok(merged)
        } else {
            Err(errors)
        }
    }

    /// The type a `page_type` value names, by id or alias.
    pub fn get(&self, name: &str) -> Option<&PageType> {
        self.types.iter().find(|t| t.is(name))
    }

    /// Every type, in declaration order.
    pub fn iter(&self) -> impl Iterator<Item = &PageType> {
        self.types.iter()
    }

    /// Every id and alias.
    pub fn names(&self) -> BTreeSet<&str> {
        self.types
            .iter()
            .flat_map(|t| {
                std::iter::once(t.id.as_str()).chain(t.aliases.iter().map(String::as_str))
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn article() -> &'static PageType {
        PageTypes::core().get("blog-article").unwrap()
    }

    fn body(types: &[&str]) -> Vec<Value> {
        types.iter().map(|t| json!({ "type": t })).collect()
    }

    fn messages(types: &[&str]) -> Vec<String> {
        article()
            .check_body(&body(types))
            .into_iter()
            .map(|i| i.message)
            .collect()
    }

    #[test]
    fn the_core_types_load_with_aliases() {
        let core = PageTypes::core();
        assert_eq!(
            core.iter().map(|t| t.id.as_str()).collect::<Vec<_>>(),
            ["blog-article", "blog-index"]
        );
        for name in ["blog-article", "blog-post", "article"] {
            assert_eq!(core.get(name).map(|t| t.id.as_str()), Some("blog-article"));
        }
        assert!(core.get("village").is_none());
        assert_eq!(core.get("blog-index").unwrap().allowed_blocks(), None);
        assert_eq!(
            article().route_for("de", "x").as_deref(),
            Some("/de/blog/x")
        );
    }

    #[test]
    fn every_core_block_a_type_names_is_a_core_block() {
        for t in PageTypes::core().iter() {
            for b in t.allowed_blocks().unwrap_or_default() {
                assert!(crate::is_core_block(b), "{}: {b}", t.id);
            }
        }
    }

    #[test]
    fn a_body_in_slot_order_fits() {
        assert!(messages(&[
            "editorial-hero",
            "paragraph",
            "heading",
            "paragraph",
            "closing-note"
        ])
        .is_empty());
    }

    #[test]
    fn slot_counts_order_and_requirements() {
        let m = messages(&["paragraph", "editorial-hero", "closing-note"]);
        assert!(
            m.iter().any(|s| s == "/body/0 must be the editorial-hero"),
            "{m:?}"
        );
        assert!(
            m.iter()
                .any(|s| s.contains("(slot hero) must come before the body slot")),
            "{m:?}"
        );
        assert!(!m.iter().any(|s| s.contains("exactly one")), "{m:?}");

        let m = messages(&["editorial-hero", "paragraph"]);
        assert!(
            m.iter()
                .any(|s| s == "/body must hold exactly one closing-note, found 0"),
            "{m:?}"
        );
        assert!(
            m.iter()
                .any(|s| s == "the last block of /body must be the closing-note"),
            "{m:?}"
        );

        let m = messages(&["editorial-hero", "closing-note"]);
        assert_eq!(m, ["/body must hold at least one paragraph"]);

        let m = messages(&["editorial-hero", "quote", "paragraph", "closing-note"]);
        assert_eq!(m.len(), 1, "{m:?}");
        assert!(m[0].starts_with("/body/1: `quote` is not allowed in a blog-article page"));
    }

    #[test]
    fn site_types_are_checked_and_may_not_shadow_the_core() {
        let file = |types: Value| json!({ "format": PAGE_TYPES_FORMAT, "page_types": types });
        let site = PageTypes::parse(&file(json!([{
            "id": "village",
            "label": { "en": "Village" },
            "slots": [
                { "id": "intro", "blocks": ["village-intro"], "min": 1, "max": 1 },
                { "id": "more", "blocks": ["highlights", "x:key-facts"], "max": 2 }
            ]
        }])))
        .unwrap();
        let all = PageTypes::core().with_site(&site).unwrap();
        let village = all.get("village").unwrap();
        assert!(village
            .check_body(&body(&["village-intro", "x:key-facts"]))
            .is_empty());
        let m: Vec<String> = village
            .check_body(&body(&[
                "village-intro",
                "highlights",
                "highlights",
                "highlights",
            ]))
            .into_iter()
            .map(|i| i.message)
            .collect();
        assert_eq!(
            m,
            ["/body must hold at most two blocks of slot more (highlights, x:key-facts), found 3"]
        );

        let shadow = PageTypes::parse(&file(
            json!([{ "id": "x", "label": { "en": "X" }, "aliases": ["article"] }]),
        ))
        .unwrap();
        assert!(PageTypes::core().with_site(&shadow).is_err());

        // The rules Zod refines and JSON Schema cannot carry.
        let twice = file(json!([{ "id": "a", "label": { "en": "A" }, "slots": [
            { "id": "s", "blocks": ["image"] }, { "id": "t", "blocks": ["image"] }
        ] }]));
        assert!(PageTypes::parse(&twice).unwrap_err()[0].contains("a block belongs to one slot"));
        let inverted = file(json!([{ "id": "a", "label": { "en": "A" }, "slots": [
            { "id": "s", "blocks": ["image"], "min": 3, "max": 1 }
        ] }]));
        assert!(PageTypes::parse(&inverted).is_err());
        // The format itself.
        assert!(PageTypes::parse(
            &json!({ "format": PAGE_TYPES_FORMAT, "page_types": [{ "id": "a" }] })
        )
        .is_err());
    }
}
