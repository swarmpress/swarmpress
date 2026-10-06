//! Reverse-engineering a live site into a read-only blueprint (FEAT-093,
//! design §8). No model: the same tree always gives the same blueprint.
//!
//! * **Page types** come from the pages' `page_type`; a core type keeps the
//!   platform's slots.
//! * **Slots** come from block usage per type. A block that opens (or closes)
//!   at least [`ANCHOR_PERMILLE`] of a type's pages and never stands anywhere
//!   else becomes a one-block opening (closing) slot, required when every
//!   page has it; every other block goes into one `body` slot in order of its
//!   average position. The slots are kept only if every page of the type
//!   fits them (`content_model` body checks); otherwise the type stays
//!   unconstrained.
//! * **Routes** come from the pages' English routes: `/{lang}/…/{slug}` when
//!   they share everything but the last segment.
//! * **Relationships** come from the link graph: page type A links to page
//!   type B when at least [`LINK_PERMILLE`] of A's pages (and at least two)
//!   link to a page of B.
//! * **Collections** and **navigation** come from the site manifest, item
//!   counts from the collection index, design intent from `theme/tokens.json`.
//!
//! The frozen theme is only read, never written (CLAUDE.md rule 9).

use std::collections::{BTreeMap, BTreeSet};

use content_model::PageTypes;
use knowledge::{KnowledgeBase, KnowledgeError, SiteSource};
use serde_json::{json, Value};

use crate::format::{
    Blueprint, BlueprintPageType, Cardinality, Collection, DesignIntent, NavItem, Relationship,
    Slot, Source,
};

/// A block that opens or closes this share of a type's pages anchors a slot.
pub const ANCHOR_PERMILLE: u64 = 800;
/// Share of a type's pages that must link to another type for a relationship.
pub const LINK_PERMILLE: u64 = 300;

/// A blueprint read from a site, and the item types its collections name.
#[derive(Clone, Debug, PartialEq)]
pub struct Imported {
    pub blueprint: Blueprint,
    /// Type name → schema (the restricted subset), for `blueprint/types/`.
    pub types: BTreeMap<String, Value>,
}

fn title_case(id: &str) -> String {
    id.split(['-', '_'])
        .filter(|w| !w.is_empty())
        .map(|w| {
            let mut c = w.chars();
            c.next()
                .map(|f| f.to_uppercase().collect::<String>() + c.as_str())
                .unwrap_or_default()
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn pascal(id: &str) -> String {
    title_case(id).replace(' ', "")
}

fn kebab(id: &str) -> String {
    id.to_ascii_lowercase().replace('_', "-")
}

fn block_types(page: &Value) -> Vec<String> {
    page["body"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|b| b["type"].as_str().unwrap_or_default().to_string())
        .collect()
}

/// Slots that every one of `bodies` fits, or `None`.
fn derive_slots(bodies: &[Vec<String>]) -> Option<Vec<Slot>> {
    let n = bodies.len() as u64;
    if n == 0 || bodies.iter().all(Vec::is_empty) {
        return None;
    }
    // Where each block stands: (count at first, at last, elsewhere, position sum in permille, uses).
    #[derive(Default)]
    struct Use {
        first: u64,
        last: u64,
        middle: u64,
        pos: u64,
        uses: u64,
    }
    let mut uses: BTreeMap<&str, Use> = BTreeMap::new();
    for body in bodies {
        let len = body.len();
        for (i, t) in body.iter().enumerate() {
            let u = uses.entry(t.as_str()).or_default();
            u.uses += 1;
            u.pos += if len > 1 {
                (i as u64 * 1000) / (len as u64 - 1)
            } else {
                0
            };
            if i == 0 {
                u.first += 1;
            } else if i + 1 == len {
                u.last += 1;
            } else {
                u.middle += 1;
            }
        }
    }
    let anchor = |count: u64, only: bool| only && count * 1000 >= n * ANCHOR_PERMILLE;
    let lead = uses
        .iter()
        .filter(|(_, u)| anchor(u.first, u.last == 0 && u.middle == 0 && u.first == u.uses))
        .max_by_key(|(t, u)| (u.first, std::cmp::Reverse(**t)))
        .map(|(t, u)| (t.to_string(), u.first == n));
    let closing = uses
        .iter()
        .filter(|(t, _)| lead.as_ref().is_none_or(|(l, _)| l != *t))
        .filter(|(_, u)| anchor(u.last, u.first == 0 && u.middle == 0 && u.last == u.uses))
        .max_by_key(|(t, u)| (u.last, std::cmp::Reverse(**t)))
        .map(|(t, u)| (t.to_string(), u.last == n));

    let mut slots = Vec::new();
    if let Some((t, all)) = &lead {
        slots.push(Slot {
            id: "lead".into(),
            blocks: vec![t.clone()],
            min: u32::from(*all),
            max: Some(1),
            source: None,
        });
    }
    let mut body: Vec<(&str, u64)> = uses
        .iter()
        .filter(|(t, _)| {
            lead.as_ref().is_none_or(|(l, _)| l != *t)
                && closing.as_ref().is_none_or(|(c, _)| c != *t)
        })
        .map(|(t, u)| (*t, u.pos / u.uses.max(1)))
        .collect();
    body.sort_by(|a, b| a.1.cmp(&b.1).then(a.0.cmp(b.0)));
    if !body.is_empty() {
        slots.push(Slot {
            id: "body".into(),
            blocks: body.into_iter().map(|(t, _)| t.to_string()).collect(),
            min: 0,
            max: None,
            source: None,
        });
    }
    if let Some((t, all)) = &closing {
        slots.push(Slot {
            id: "closing".into(),
            blocks: vec![t.clone()],
            min: u32::from(*all),
            max: Some(1),
            source: None,
        });
    }
    Some(slots)
}

/// `/{lang}/a/{slug}` when the routes share all but their last segment.
fn derive_route(routes: &[&str], langs: &BTreeSet<String>) -> Option<String> {
    let split: Vec<Vec<&str>> = routes
        .iter()
        .map(|r| {
            r.trim_matches('/')
                .split('/')
                .filter(|s| !s.is_empty())
                .collect()
        })
        .collect();
    let first = split.first()?;
    if split.iter().any(|s| s.len() != first.len()) {
        return None;
    }
    let mut out: Vec<String> = Vec::new();
    for (i, seg) in first.iter().enumerate() {
        let same = split.iter().all(|s| s[i] == *seg);
        let last = i + 1 == first.len();
        if i == 0 && langs.contains(*seg) {
            out.push("{lang}".into());
        } else if same {
            out.push(seg.to_string());
        } else if last {
            out.push("{slug}".into());
        } else {
            return None;
        }
    }
    Some(format!("/{}", out.join("/")))
}

/// The site in `src`, as a blueprint.
pub fn import(src: &dyn SiteSource) -> Result<Imported, KnowledgeError> {
    let kb = KnowledgeBase::build(src)?;
    let core = PageTypes::core();
    let langs: BTreeSet<String> = kb.manifest.languages.iter().cloned().collect();
    let default_lang = kb.manifest.default_language.clone();

    // Pages per type, with their bodies and English routes.
    let mut by_type: BTreeMap<String, Vec<(String, Vec<String>, String)>> = BTreeMap::new();
    let mut type_of_path: BTreeMap<String, String> = BTreeMap::new();
    let mut bodies: BTreeMap<String, Value> = BTreeMap::new();
    for p in &kb.pages.pages {
        if p.page_type.is_empty() {
            continue;
        }
        let page = src.read_json(&p.path)?.unwrap_or(Value::Null);
        let route = p
            .routes
            .get(&default_lang)
            .or_else(|| p.routes.values().next())
            .cloned()
            .unwrap_or_default();
        let id = kebab(&p.page_type);
        type_of_path.insert(p.path.clone(), id.clone());
        by_type
            .entry(id)
            .or_default()
            .push((p.path.clone(), block_types(&page), route));
        bodies.insert(p.path.clone(), page);
    }

    let mut page_types = Vec::new();
    for (id, pages) in &by_type {
        let label = BTreeMap::from([("en".to_string(), title_case(id))]);
        let routes: Vec<&str> = pages.iter().map(|(_, _, r)| r.as_str()).collect();
        let mut t = BlueprintPageType {
            id: id.clone(),
            label,
            aliases: vec![],
            route: derive_route(&routes, &langs),
            source: Source::Page,
            slots: None,
            require: vec![],
            html_fields: vec![],
            linking: None,
            uses: vec![],
            pages: Some(pages.len() as u32),
        };
        if let Some(c) = core.get(id).filter(|c| c.id == *id) {
            t.label = c.label.clone();
            t.aliases = c.aliases.clone();
            t.route = c.route.clone().or(t.route);
            t.slots = c.slots.as_ref().map(|s| {
                s.iter()
                    .map(|s| Slot {
                        id: s.id.clone(),
                        blocks: s.blocks.clone(),
                        min: s.min,
                        max: s.max,
                        source: None,
                    })
                    .collect()
            });
            t.require = c.require.clone();
            t.html_fields = c.html_fields.clone();
        } else {
            let seqs: Vec<Vec<String>> = pages.iter().map(|(_, b, _)| b.clone()).collect();
            t.slots = derive_slots(&seqs).filter(|slots| fits_all(id, slots, &seqs));
        }
        page_types.push(t);
    }

    // Relationships from the link graph.
    let mut links: BTreeMap<(String, String), BTreeSet<String>> = BTreeMap::new();
    for (path, page) in &bodies {
        let Some(from) = type_of_path.get(path) else {
            continue;
        };
        for target in kb.link_targets(page) {
            if let Some(to) = type_of_path.get(&target) {
                if to != from || target != *path {
                    links
                        .entry((from.clone(), to.clone()))
                        .or_default()
                        .insert(path.clone());
                }
            }
        }
    }
    let relationships = links
        .into_iter()
        .filter(|((from, _), sources)| {
            let n = by_type.get(from).map_or(0, Vec::len) as u64;
            sources.len() >= 2 && sources.len() as u64 * 1000 >= n * LINK_PERMILLE
        })
        .map(|((from, to), _)| Relationship {
            from,
            to,
            kind: "links-to".into(),
            cardinality: Cardinality::ManyToMany,
            via: Some("body".into()),
        })
        .collect();

    // Collections and their item types.
    let counts = kb.collections.counts();
    let mut types = BTreeMap::new();
    let mut collections = Vec::new();
    for c in &kb.manifest.collections {
        let id = kebab(&c.kind);
        let item = format!("{}Item", pascal(&id));
        types.insert(
            item.clone(),
            json!({
                "type": "object",
                "additionalProperties": false,
                "required": ["slug"],
                "properties": { "slug": { "type": "string" }, "name": { "$ref": "LocalizedString" } }
            }),
        );
        let items: usize = counts.get(&c.kind).map(|m| m.values().sum()).unwrap_or(0);
        collections.push(Collection {
            id,
            item_type: item,
            from: format!("collection:{}", c.kind),
            order: None,
            limit: None,
            items: Some(items as u32),
        });
    }

    let navigation = kb
        .manifest
        .sections
        .iter()
        .map(|s| NavItem {
            page_type: None,
            section: Some(s.slug.clone()),
        })
        .collect();
    let intent = DesignIntent {
        keywords: vec![],
        tokens: src
            .exists("theme/tokens.json")?
            .then(|| "theme/tokens.json".to_string()),
    };

    Ok(Imported {
        blueprint: Blueprint {
            page_types,
            collections,
            relationships,
            navigation,
            intent,
            ..Blueprint::empty()
        },
        types,
    })
}

/// Whether every body fits the slots, by the registry's own body check.
fn fits_all(id: &str, slots: &[Slot], bodies: &[Vec<String>]) -> bool {
    let file = json!({
        "format": content_model::page_types::PAGE_TYPES_FORMAT,
        "page_types": [{
            "id": id,
            "label": { "en": id },
            "slots": slots.iter().map(|s| {
                let mut v = json!({ "id": s.id, "blocks": s.blocks, "min": s.min });
                if let Some(max) = s.max {
                    v["max"] = json!(max);
                }
                v
            }).collect::<Vec<_>>()
        }]
    });
    let Ok(reg) = PageTypes::parse(&file) else {
        return false;
    };
    let Some(t) = reg.get(id) else { return false };
    bodies.iter().all(|b| {
        let body: Vec<Value> = b.iter().map(|t| json!({ "type": t })).collect();
        t.check_body(&body).is_empty()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seqs(v: &[&[&str]]) -> Vec<Vec<String>> {
        v.iter()
            .map(|b| b.iter().map(|s| s.to_string()).collect())
            .collect()
    }

    #[test]
    fn anchored_blocks_become_slots() {
        let b = seqs(&[
            &["hero", "paragraph", "gallery", "newsletter"],
            &["hero", "paragraph", "newsletter"],
            &["hero", "gallery", "paragraph", "paragraph", "newsletter"],
        ]);
        let s = derive_slots(&b).unwrap();
        assert_eq!(
            s.iter().map(|s| s.id.as_str()).collect::<Vec<_>>(),
            ["lead", "body", "closing"]
        );
        assert_eq!(
            (s[0].blocks.clone(), s[0].min),
            (vec!["hero".to_string()], 1)
        );
        assert_eq!(s[2].blocks, ["newsletter"]);
        assert!(fits_all("x", &s, &b));
    }

    #[test]
    fn a_block_that_also_stands_elsewhere_anchors_nothing() {
        let b = seqs(&[&["paragraph", "image", "paragraph"], &["paragraph", "list"]]);
        let s = derive_slots(&b).unwrap();
        assert_eq!(s.len(), 1);
        assert_eq!(s[0].id, "body");
        assert!(fits_all("x", &s, &b));
    }

    #[test]
    fn routes() {
        let langs = BTreeSet::from(["en".to_string(), "de".to_string()]);
        assert_eq!(
            derive_route(&["/en/blog/a", "/en/blog/b"], &langs).as_deref(),
            Some("/{lang}/blog/{slug}")
        );
        assert_eq!(
            derive_route(&["/en/blog"], &langs).as_deref(),
            Some("/{lang}/blog")
        );
        assert_eq!(
            derive_route(&["/en/a", "/en/b"], &langs).as_deref(),
            Some("/{lang}/{slug}")
        );
        assert_eq!(derive_route(&["/en/a/x", "/en/b/y"], &langs), None);
        assert_eq!(derive_route(&["/en/a", "/en/b/c"], &langs), None);
        assert_eq!(derive_route(&["/en"], &langs).as_deref(), Some("/{lang}"));
    }
}
