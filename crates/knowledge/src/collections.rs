//! Collection index: `content/collections/<type>/<region>.json`.
//!
//! Files hold per-region arrays. Two shapes exist in the wild: a bare array
//! `[...]` and a wrapper `{ "items": [...], ... }`; item names are strings or
//! localized objects. `_schema.json` files and the top-level
//! `content/collections/config.json` are metadata, not items.

use std::collections::BTreeMap;

use content_model::{LocalizedText, FALLBACK_LANG};
use serde::Serialize;
use serde_json::Value;

use crate::source::{file_stem, KnowledgeError, SiteSource};

pub const COLLECTIONS_DIR: &str = "content/collections";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum FileShape {
    /// `[ ... ]`
    Array,
    /// `{ "items": [ ... ] }`
    Wrapped,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CollectionItem {
    pub slug: String,
    pub name: Option<LocalizedText>,
}

impl CollectionItem {
    pub fn name(&self, lang: &str) -> Option<&str> {
        self.name
            .as_ref()
            .and_then(|n| n.get(lang))
            .map(String::as_str)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CollectionFile {
    /// Collection type (directory name), e.g. `restaurants`.
    pub kind: String,
    /// Region key (file stem), e.g. `riomaggiore`.
    pub region: String,
    pub path: String,
    pub shape: FileShape,
    pub items: Vec<CollectionItem>,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct CollectionIndex {
    pub files: Vec<CollectionFile>,
    /// Per-type `_schema.json` metadata (display name, title field, …).
    pub schemas: BTreeMap<String, Value>,
    pub issues: Vec<String>,
}

fn item_name(item: &Value) -> Option<LocalizedText> {
    for key in ["name", "title"] {
        match &item[key] {
            Value::String(s) => return Some(LocalizedText::Plain(s.clone())),
            Value::Object(m) if !m.is_empty() => {
                let by_lang: BTreeMap<String, String> = m
                    .iter()
                    .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
                    .collect();
                if !by_lang.is_empty() {
                    return Some(LocalizedText::ByLang(by_lang));
                }
            }
            _ => {}
        }
    }
    None
}

impl CollectionIndex {
    pub fn build(src: &dyn SiteSource) -> Result<Self, KnowledgeError> {
        let mut idx = CollectionIndex::default();
        for path in src.list_json(COLLECTIONS_DIR)? {
            let rel = &path[COLLECTIONS_DIR.len() + 1..];
            let Some((kind, file)) = rel.split_once('/') else {
                continue; // top-level config.json
            };
            if file.contains('/') {
                idx.issues
                    .push(format!("{path}: nested collection dirs are not supported"));
                continue;
            }
            let v = match src.read_json(&path) {
                Ok(Some(v)) => v,
                Ok(None) => continue,
                Err(e) => {
                    idx.issues.push(e.to_string());
                    continue;
                }
            };
            if file == "_schema.json" {
                idx.schemas.insert(kind.to_string(), v);
                continue;
            }
            let (shape, raw) = match &v {
                Value::Array(a) => (FileShape::Array, a),
                Value::Object(m) => match m.get("items") {
                    Some(Value::Array(a)) => (FileShape::Wrapped, a),
                    _ => {
                        idx.issues
                            .push(format!("{path}: object without an `items` array"));
                        continue;
                    }
                },
                _ => {
                    idx.issues
                        .push(format!("{path}: neither an array nor {{items: [...]}}"));
                    continue;
                }
            };
            let mut items = vec![];
            for (i, item) in raw.iter().enumerate() {
                let slug = item["slug"]
                    .as_str()
                    .or_else(|| item["id"].as_str())
                    .map(str::to_string);
                match slug {
                    Some(slug) => items.push(CollectionItem {
                        slug,
                        name: item_name(item),
                    }),
                    None => idx.issues.push(format!("{path}: item {i} has no slug")),
                }
            }
            idx.files.push(CollectionFile {
                kind: kind.to_string(),
                region: file_stem(file).to_string(),
                path,
                shape,
                items,
            });
        }
        Ok(idx)
    }

    /// Collection types, sorted.
    pub fn kinds(&self) -> Vec<&str> {
        let mut k: Vec<&str> = self.files.iter().map(|f| f.kind.as_str()).collect();
        k.extend(self.schemas.keys().map(String::as_str));
        k.sort();
        k.dedup();
        k
    }

    pub fn file(&self, kind: &str, region: &str) -> Option<&CollectionFile> {
        self.files
            .iter()
            .find(|f| f.kind == kind && f.region == region)
    }

    pub fn regions(&self, kind: &str) -> Vec<&str> {
        self.files
            .iter()
            .filter(|f| f.kind == kind)
            .map(|f| f.region.as_str())
            .collect()
    }

    /// Finds an item by slug in a collection, optionally within one region.
    pub fn find_item(
        &self,
        kind: &str,
        slug: &str,
        region: Option<&str>,
    ) -> Option<(&CollectionFile, &CollectionItem)> {
        self.files
            .iter()
            .filter(|f| f.kind == kind && region.is_none_or(|r| f.region == r))
            .find_map(|f| f.items.iter().find(|i| i.slug == slug).map(|i| (f, i)))
    }

    /// Items per type and region.
    pub fn counts(&self) -> BTreeMap<String, BTreeMap<String, usize>> {
        let mut m: BTreeMap<String, BTreeMap<String, usize>> = BTreeMap::new();
        for f in &self.files {
            m.entry(f.kind.clone())
                .or_default()
                .insert(f.region.clone(), f.items.len());
        }
        m
    }

    pub fn total_items(&self) -> usize {
        self.files.iter().map(|f| f.items.len()).sum()
    }

    /// Display name of a collection type from its `_schema.json`.
    pub fn display_name(&self, kind: &str) -> Option<&str> {
        self.schemas.get(kind)?.get("display_name")?.as_str()
    }

    /// Items without a name in the fallback language.
    pub fn unnamed(&self) -> usize {
        self.files
            .iter()
            .flat_map(|f| &f.items)
            .filter(|i| i.name(FALLBACK_LANG).is_none())
            .count()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::source::MemSource;
    use serde_json::json;

    #[test]
    fn tolerates_both_shapes_and_name_forms() {
        let mut s = MemSource::new();
        s.insert_json("content/collections/config.json", &json!({"collections": []}))
            .insert_json("content/collections/restaurants/_schema.json", &json!({"display_name": "Restaurants"}))
            .insert_json(
                "content/collections/restaurants/manarola.json",
                &json!({"items": [{"slug": "nessun-dorma", "name": {"en": "Nessun Dorma", "it": "Nessun Dorma"}}, {"name": "no slug"}]}),
            )
            .insert_json(
                "content/collections/hikes/vernazza.json",
                &json!([{"slug": "sentiero-azzurro", "name": "Sentiero Azzurro"}, {"id": "by-id", "title": {"en": "By id"}}]),
            )
            .insert_json("content/collections/hikes/bad.json", &json!({"nope": 1}));
        let idx = CollectionIndex::build(&s).unwrap();
        assert_eq!(idx.kinds(), vec!["hikes", "restaurants"]);
        assert_eq!(idx.total_items(), 3);
        assert_eq!(idx.issues.len(), 2, "{:?}", idx.issues);
        let r = idx.file("restaurants", "manarola").unwrap();
        assert_eq!(r.shape, FileShape::Wrapped);
        assert_eq!(r.items[0].name("it"), Some("Nessun Dorma"));
        let h = idx.file("hikes", "vernazza").unwrap();
        assert_eq!(h.shape, FileShape::Array);
        assert_eq!(h.items[0].name("de"), Some("Sentiero Azzurro"));
        assert_eq!(h.items[1].slug, "by-id");
        assert!(idx
            .find_item("hikes", "sentiero-azzurro", Some("vernazza"))
            .is_some());
        assert!(idx
            .find_item("hikes", "sentiero-azzurro", Some("manarola"))
            .is_none());
        assert_eq!(idx.display_name("restaurants"), Some("Restaurants"));
        assert_eq!(idx.counts()["restaurants"]["manarola"], 1);
        assert_eq!(idx.unnamed(), 0);
    }
}
