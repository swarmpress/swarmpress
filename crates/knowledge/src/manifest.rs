//! Site manifest: languages, regions, sections and collections.
//!
//! The target is `content/site.manifest.json` (cutover step 3). Until a site
//! has one, [`SiteManifest::load`] infers a best-effort manifest from what the
//! cinqueterre repo already has: `content/site.json`, `content/config/site.json`,
//! `content/config/navigation.json`, `content/config/villages/*.json`,
//! `content/config/entity-index.json`, `content/config/sitemap-index.json` and
//! the `content/collections/` tree. Every inference is recorded in `notes`.

use std::collections::{BTreeMap, BTreeSet};

use content_model::{LocalizedString, FALLBACK_LANG};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::source::{file_stem, KnowledgeError, SiteSource};

pub const MANIFEST_PATH: &str = "content/site.manifest.json";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Region {
    pub slug: String,
    pub name: LocalizedString,
    pub order: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub entity: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Section {
    pub slug: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<LocalizedString>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page_type: Option<String>,
    /// Exists under every region (`/<lang>/<region>/<slug>`).
    #[serde(default)]
    pub per_region: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CollectionDef {
    /// Directory name under `content/collections/`.
    pub kind: String,
    pub display_name: String,
    pub dir: String,
    /// Files are named after regions.
    #[serde(default)]
    pub per_region: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub region_field: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title_field: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SiteManifest {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
    pub default_language: String,
    pub languages: Vec<String>,
    #[serde(default)]
    pub regions: Vec<Region>,
    #[serde(default)]
    pub sections: Vec<Section>,
    #[serde(default)]
    pub collections: Vec<CollectionDef>,
    /// True when inferred rather than read from `site.manifest.json`.
    #[serde(default)]
    pub inferred: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub notes: Vec<String>,
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
        Value::String(s) if !s.is_empty() => Some(LocalizedString::new(s.clone())),
        Value::Object(m) => {
            // Drop empty translations ("de": "") so they fall back to `en`.
            let cleaned: serde_json::Map<String, Value> = m
                .iter()
                .filter(|(_, v)| v.as_str().is_some_and(|s| !s.is_empty()))
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect();
            serde_json::from_value(Value::Object(cleaned)).ok()
        }
        _ => None,
    }
}

fn first_str<'a>(candidates: &[&'a Value]) -> Option<&'a str> {
    candidates
        .iter()
        .find_map(|v| v.as_str().filter(|s| !s.is_empty()))
}

impl SiteManifest {
    /// Reads `content/site.manifest.json`, or infers a manifest.
    pub fn load(src: &dyn SiteSource) -> Result<Self, KnowledgeError> {
        if let Some(v) = src.read_json(MANIFEST_PATH)? {
            return serde_json::from_value(v).map_err(|e| KnowledgeError::Shape {
                path: MANIFEST_PATH.into(),
                message: e.to_string(),
            });
        }
        Self::infer(src)
    }

    pub fn infer(src: &dyn SiteSource) -> Result<Self, KnowledgeError> {
        let null = Value::Null;
        let site = src.read_json("content/site.json")?.unwrap_or(Value::Null);
        let config = src
            .read_json("content/config/site.json")?
            .unwrap_or(Value::Null);
        let sitemap = src
            .read_json("content/config/sitemap-index.json")?
            .unwrap_or(Value::Null);
        let entities = src
            .read_json("content/config/entity-index.json")?
            .unwrap_or(Value::Null);
        let nav = src
            .read_json("content/config/navigation.json")?
            .unwrap_or(Value::Null);
        let mut notes = vec![format!("inferred: {MANIFEST_PATH} not found")];

        let name = first_str(&[&site["name"], &config["site"]["name"]])
            .unwrap_or("site")
            .to_string();
        let base_url = first_str(&[&config["site"]["base_url"], &sitemap["baseUrl"]])
            .map(|s| s.trim_end_matches('/').to_string());
        let default_language = first_str(&[
            &site["defaultLocale"],
            &sitemap["defaultLanguage"],
            &config["site"]["default_language"],
        ])
        .unwrap_or(FALLBACK_LANG)
        .to_string();

        // Languages: union of every declaration, in first-seen order.
        let mut languages: Vec<String> = vec![];
        let declared = [
            ("content/site.json locales", strings(&site["locales"])),
            ("sitemap-index languages", strings(&sitemap["languages"])),
            (
                "config/site.json site.languages",
                strings(&config["site"]["languages"]),
            ),
        ];
        for (_, langs) in &declared {
            for l in langs {
                if !languages.contains(l) {
                    languages.push(l.clone());
                }
            }
        }
        if languages.is_empty() {
            languages.push(default_language.clone());
        }
        for (what, langs) in &declared {
            if !langs.is_empty() && langs.len() != languages.len() {
                notes.push(format!(
                    "{what} lists {langs:?} but the union of declarations is {languages:?}"
                ));
            }
        }

        // Regions: village config files, ordered by entity-index position.
        let mut regions = vec![];
        for path in src.list_json("content/config/villages")? {
            let stem = file_stem(&path);
            if stem.starts_with('_') {
                continue;
            }
            let Some(v) = src.read_json(&path)? else {
                continue;
            };
            let slug = v["slug"].as_str().unwrap_or(stem).to_string();
            let ent = &entities["villages"][&slug];
            let name = localized(&ent["name"])
                .or_else(|| localized(&v["hero"]["title"]))
                .unwrap_or_else(|| LocalizedString::new(slug.clone()));
            let order = ent["position"].as_u64().and_then(|p| u32::try_from(p).ok());
            regions.push((order, slug.clone(), name, !ent.is_null()));
        }
        if regions.is_empty() {
            if let Some(m) = entities["villages"].as_object() {
                notes.push("regions taken from entity-index (no config/villages)".into());
                for (slug, ent) in m {
                    let name = localized(&ent["name"])
                        .unwrap_or_else(|| LocalizedString::new(slug.clone()));
                    let order = ent["position"].as_u64().and_then(|p| u32::try_from(p).ok());
                    regions.push((order, slug.clone(), name, true));
                }
            }
        }
        regions
            .sort_by(|a, b| (a.0.unwrap_or(u32::MAX), &a.1).cmp(&(b.0.unwrap_or(u32::MAX), &b.1)));
        let region_slugs: BTreeSet<String> = regions.iter().map(|r| r.1.clone()).collect();
        let regions: Vec<Region> = regions
            .into_iter()
            .enumerate()
            .map(|(i, (_, slug, name, has_entity))| Region {
                entity: has_entity.then(|| slug.clone()),
                slug,
                name,
                order: u32::try_from(i + 1).unwrap_or(u32::MAX),
            })
            .collect();

        // Sections: sitemap-index top-level pages + per-region children.
        let mut sections: BTreeMap<String, Section> = BTreeMap::new();
        if let Some(pages) = sitemap["pages"].as_object() {
            for (key, p) in pages {
                let parent = p["parent"].as_str();
                let (slug, per_region) = match key.split_once('/') {
                    Some((head, tail)) if region_slugs.contains(head) => (tail.to_string(), true),
                    Some(_) => continue, // e.g. blog/<post>: content, not a section
                    None if region_slugs.contains(key) || parent.is_none() => continue,
                    None => (key.clone(), false),
                };
                let entry = sections.entry(slug.clone()).or_insert_with(|| Section {
                    slug,
                    title: None,
                    page_type: p["pageType"].as_str().map(str::to_string),
                    per_region,
                });
                entry.per_region |= per_region;
                if !per_region && entry.title.is_none() {
                    entry.title = localized(&p["title"]);
                }
            }
        } else {
            notes.push("sections taken from navigation.json (no sitemap-index)".into());
            for item in nav["main_nav"].as_array().into_iter().flatten() {
                let url = item["url"].as_str().unwrap_or_default().trim_matches('/');
                if url.is_empty() || url.contains('/') || region_slugs.contains(url) {
                    continue;
                }
                sections.insert(
                    url.to_string(),
                    Section {
                        slug: url.to_string(),
                        title: localized(&item["title"]),
                        page_type: None,
                        per_region: false,
                    },
                );
            }
        }

        // Collections: content/collections/<kind>/.
        let collection_config = src
            .read_json("content/collections/config.json")?
            .unwrap_or(Value::Null);
        let mut files_by_kind: BTreeMap<String, Vec<String>> = BTreeMap::new();
        for path in src.list_json("content/collections")? {
            if let Some((kind, file)) = path["content/collections/".len()..].split_once('/') {
                files_by_kind
                    .entry(kind.to_string())
                    .or_default()
                    .push(file_stem(file).to_string());
            }
        }
        let mut collections = vec![];
        for (kind, stems) in files_by_kind {
            let schema = src
                .read_json(&format!("content/collections/{kind}/_schema.json"))?
                .unwrap_or(Value::Null);
            let configured = collection_config["collections"]
                .as_array()
                .and_then(|a| a.iter().find(|c| c["type"] == kind.as_str()))
                .unwrap_or(&null);
            let per_region = stems.iter().any(|s| region_slugs.contains(s));
            collections.push(CollectionDef {
                display_name: first_str(&[&configured["displayName"], &schema["display_name"]])
                    .unwrap_or(&kind)
                    .to_string(),
                dir: format!("content/collections/{kind}"),
                per_region,
                region_field: per_region.then(|| "village".to_string()),
                title_field: schema["title_field"].as_str().map(str::to_string),
                kind,
            });
        }

        Ok(SiteManifest {
            name,
            base_url,
            default_language,
            languages,
            regions,
            sections: sections.into_values().collect(),
            collections,
            inferred: true,
            notes,
        })
    }

    pub fn region(&self, slug: &str) -> Option<&Region> {
        self.regions.iter().find(|r| r.slug == slug)
    }

    pub fn is_language(&self, lang: &str) -> bool {
        self.languages.iter().any(|l| l == lang)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::source::MemSource;
    use serde_json::json;

    fn source() -> MemSource {
        let mut s = MemSource::new();
        s.insert_json(
            "content/site.json",
            &json!({"name": "Test Site", "locales": ["en", "de"], "defaultLocale": "en"}),
        )
        .insert_json(
            "content/config/site.json",
            &json!({"site": {"base_url": "https://t.test/", "languages": ["en"]}}),
        )
        .insert_json(
            "content/config/villages/beta.json",
            &json!({"slug": "beta", "hero": {"title": {"en": "Beta"}}}),
        )
        .insert_json(
            "content/config/villages/alpha.json",
            &json!({"slug": "alpha"}),
        )
        .insert_json("content/config/villages/_schema.json", &json!({}))
        .insert_json(
            "content/config/entity-index.json",
            &json!({"villages": {
                "beta": {"name": {"en": "Beta Town"}, "position": 1},
                "alpha": {"name": {"en": "Alpha", "de": ""}, "position": 2}}}),
        )
        .insert_json(
            "content/config/sitemap-index.json",
            &json!({"pages": {
                "home": {"pageType": "homepage", "parent": null},
                "beta": {"parent": "home"},
                "beta/restaurants": {"parent": "beta", "pageType": "collection"},
                "hikes": {"parent": "home", "pageType": "collection-hub", "title": {"en": "Hikes"}},
                "blog/post": {"parent": "blog"}}}),
        )
        .insert_json(
            "content/collections/restaurants/beta.json",
            &json!({"items": []}),
        )
        .insert_json(
            "content/collections/restaurants/_schema.json",
            &json!({"display_name": "Food", "title_field": "name"}),
        )
        .insert_json("content/collections/region/all.json", &json!([]));
        s
    }

    #[test]
    fn infers_manifest_from_legacy_files() {
        let m = SiteManifest::load(&source()).unwrap();
        assert!(m.inferred);
        assert_eq!(m.name, "Test Site");
        assert_eq!(m.base_url.as_deref(), Some("https://t.test"));
        assert_eq!(m.languages, vec!["en", "de"]);
        assert!(
            m.notes.iter().any(|n| n.contains("config/site.json")),
            "{:?}",
            m.notes
        );
        let regions: Vec<_> = m
            .regions
            .iter()
            .map(|r| (r.slug.as_str(), r.order, r.name.en.as_str()))
            .collect();
        assert_eq!(
            regions,
            vec![("beta", 1, "Beta Town"), ("alpha", 2, "Alpha")]
        );
        assert_eq!(m.region("alpha").unwrap().name.get("de"), "Alpha");
        let sections: Vec<_> = m
            .sections
            .iter()
            .map(|s| (s.slug.as_str(), s.per_region))
            .collect();
        assert_eq!(sections, vec![("hikes", false), ("restaurants", true)]);
        let c: Vec<_> = m
            .collections
            .iter()
            .map(|c| (c.kind.as_str(), c.display_name.as_str(), c.per_region))
            .collect();
        assert_eq!(
            c,
            vec![("region", "region", false), ("restaurants", "Food", true)]
        );
    }

    #[test]
    fn prefers_explicit_manifest() {
        let mut s = source();
        s.insert_json(
            MANIFEST_PATH,
            &json!({"name": "Explicit", "default_language": "it", "languages": ["it", "en"]}),
        );
        let m = SiteManifest::load(&s).unwrap();
        assert!(!m.inferred);
        assert_eq!(m.name, "Explicit");
        assert!(m.regions.is_empty());
        s.insert_json(MANIFEST_PATH, &json!({"languages": 3}));
        assert!(SiteManifest::load(&s).is_err());
    }
}
