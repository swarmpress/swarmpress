//! Entity index (`content/config/entity-index.json`): villages, trails,
//! transport and categories — the closed set of things a page may be "about".

use std::collections::BTreeSet;

use content_model::LocalizedString;
use serde::Serialize;
use serde_json::Value;

use crate::source::{KnowledgeError, SiteSource};

pub const ENTITY_INDEX_PATH: &str = "content/config/entity-index.json";

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum EntityKind {
    Village,
    Trail,
    Transport,
    Category,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Geo {
    pub lat: f64,
    pub lng: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Entity {
    pub kind: EntityKind,
    pub slug: String,
    pub name: LocalizedString,
    pub canonical_url: Option<LocalizedString>,
    pub aliases: Vec<String>,
    pub keywords: Vec<String>,
    /// relatedVillages / connectsVillages / stopsAt.
    pub related: Vec<String>,
    pub position: Option<u32>,
    pub coordinates: Option<Geo>,
}

impl Entity {
    /// Match quality of `query` against this entity (0 = no match).
    pub fn match_score(&self, query: &str) -> u32 {
        let q = query.trim().to_lowercase();
        if q.is_empty() {
            return 0;
        }
        if self.slug == q || self.slug.replace('-', " ") == q {
            return 100;
        }
        if self.name.iter().any(|(_, n)| n.to_lowercase() == q) {
            return 90;
        }
        if self.aliases.iter().any(|a| a.to_lowercase() == q) {
            return 80;
        }
        if self.name.iter().any(|(_, n)| n.to_lowercase().contains(&q)) || self.slug.contains(&q) {
            return 50;
        }
        if self.keywords.iter().any(|k| k.to_lowercase() == q) {
            return 30;
        }
        if self.aliases.iter().any(|a| a.to_lowercase().contains(&q)) {
            return 20;
        }
        0
    }
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct EntityIndex {
    pub entities: Vec<Entity>,
    pub issues: Vec<String>,
}

fn strings(v: &Value) -> Vec<String> {
    v.as_array()
        .map(|a| {
            a.iter()
                .filter_map(|s| s.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

fn localized(v: &Value) -> Option<LocalizedString> {
    match v {
        Value::String(s) => Some(LocalizedString::new(s.clone())),
        Value::Object(_) => serde_json::from_value(v.clone()).ok(),
        _ => None,
    }
}

fn title_case(slug: &str) -> String {
    slug.split('-')
        .map(|w| {
            let mut c = w.chars();
            c.next()
                .map(|f| f.to_uppercase().chain(c).collect::<String>())
                .unwrap_or_default()
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn parse_entity(kind: EntityKind, key: &str, v: &Value) -> Entity {
    let slug = v["slug"].as_str().unwrap_or(key).to_string();
    let related = ["relatedVillages", "connectsVillages", "stopsAt"]
        .iter()
        .flat_map(|k| strings(&v[*k]))
        .collect();
    let coordinates = match (
        v["coordinates"]["lat"].as_f64(),
        v["coordinates"]["lng"].as_f64(),
    ) {
        (Some(lat), Some(lng)) => Some(Geo { lat, lng }),
        _ => None,
    };
    Entity {
        kind,
        name: localized(&v["name"]).unwrap_or_else(|| LocalizedString::new(title_case(&slug))),
        canonical_url: localized(&v["canonicalUrl"]),
        aliases: strings(&v["aliases"]),
        keywords: strings(&v["keywords"]),
        related,
        position: v["position"].as_u64().and_then(|p| u32::try_from(p).ok()),
        coordinates,
        slug,
    }
}

impl EntityIndex {
    pub fn from_value(v: &Value) -> Self {
        let mut idx = EntityIndex::default();
        for (field, kind) in [
            ("villages", EntityKind::Village),
            ("trails", EntityKind::Trail),
            ("transport", EntityKind::Transport),
        ] {
            match &v[field] {
                Value::Object(m) => {
                    for (k, e) in m {
                        idx.entities.push(parse_entity(kind, k, e));
                    }
                }
                Value::Array(a) => {
                    for e in a {
                        let k = e["slug"].as_str().unwrap_or_default();
                        idx.entities.push(parse_entity(kind, k, e));
                    }
                }
                Value::Null => {}
                _ => idx
                    .issues
                    .push(format!("`{field}` is neither an object nor an array")),
            }
        }
        for c in v["categories"].as_array().into_iter().flatten() {
            if let Some(slug) = c["slug"].as_str() {
                idx.entities
                    .push(parse_entity(EntityKind::Category, slug, c));
            }
        }
        idx.entities
            .sort_by(|a, b| (a.kind, a.position, &a.slug).cmp(&(b.kind, b.position, &b.slug)));
        let mut seen = BTreeSet::new();
        for e in &idx.entities {
            if !seen.insert((e.kind, e.slug.clone())) {
                idx.issues
                    .push(format!("duplicate {:?} entity `{}`", e.kind, e.slug));
            }
        }
        idx
    }

    /// Loads the index; a missing file yields an empty index.
    pub fn load(src: &dyn SiteSource) -> Result<Self, KnowledgeError> {
        Ok(src
            .read_json(ENTITY_INDEX_PATH)?
            .map(|v| Self::from_value(&v))
            .unwrap_or_default())
    }

    pub fn get(&self, slug: &str) -> Option<&Entity> {
        self.entities.iter().find(|e| e.slug == slug)
    }

    pub fn of_kind(&self, kind: EntityKind) -> impl Iterator<Item = &Entity> {
        self.entities.iter().filter(move |e| e.kind == kind)
    }

    pub fn count(&self, kind: EntityKind) -> usize {
        self.of_kind(kind).count()
    }

    /// Entities matching `query` (slug, name in any language, alias, keyword), best first.
    pub fn find(&self, query: &str) -> Vec<(&Entity, u32)> {
        let mut hits: Vec<_> = self
            .entities
            .iter()
            .map(|e| (e, e.match_score(query)))
            .filter(|(_, s)| *s > 0)
            .collect();
        hits.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.slug.cmp(&b.0.slug)));
        hits
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn sample() -> EntityIndex {
        EntityIndex::from_value(&json!({
            "villages": {
                "manarola": {"slug": "manarola", "name": {"en": "Manarola"}, "position": 2, "aliases": ["mana"], "keywords": ["sunset"], "relatedVillages": ["riomaggiore"], "coordinates": {"lat": 44.1, "lng": 9.7}},
                "riomaggiore": {"slug": "riomaggiore", "name": {"en": "Riomaggiore", "de": "Riomaggiore"}, "position": 1, "canonicalUrl": {"en": "/en/riomaggiore"}}
            },
            "trails": {"via-dell-amore": {"name": {"en": "Via dell'Amore"}, "aliases": ["path of love"], "connectsVillages": ["riomaggiore", "manarola"]}},
            "transport": {"train": {"slug": "cinque-terre-train", "name": {"en": "Cinque Terre Express"}}},
            "categories": [{"slug": "food", "name": {"en": "Food", "it": "Cibo"}}]
        }))
    }

    #[test]
    fn parses_all_kinds_in_order() {
        let idx = sample();
        assert!(idx.issues.is_empty(), "{:?}", idx.issues);
        let villages: Vec<_> = idx
            .of_kind(EntityKind::Village)
            .map(|e| e.slug.as_str())
            .collect();
        assert_eq!(villages, vec!["riomaggiore", "manarola"]);
        assert_eq!(idx.count(EntityKind::Trail), 1);
        assert_eq!(
            idx.get("cinque-terre-train").unwrap().kind,
            EntityKind::Transport
        );
        assert_eq!(
            idx.get("via-dell-amore").unwrap().related,
            vec!["riomaggiore", "manarola"]
        );
        assert_eq!(
            idx.get("manarola")
                .unwrap()
                .coordinates
                .as_ref()
                .unwrap()
                .lat,
            44.1
        );
    }

    #[test]
    fn finds_by_name_alias_keyword() {
        let idx = sample();
        assert_eq!(idx.find("Manarola")[0].0.slug, "manarola");
        assert_eq!(idx.find("path of love")[0].0.slug, "via-dell-amore");
        assert_eq!(idx.find("cibo")[0].0.slug, "food");
        assert_eq!(idx.find("sunset")[0].0.slug, "manarola");
        assert!(idx.find("caribbean").is_empty());
    }
}
