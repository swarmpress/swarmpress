//! Closed media index (`content/config/media-index.json`).
//!
//! Agents never invent image URLs: they pick an id from this index
//! (`media:<id>`) via [`MediaIndex::suggest`], and the QA gate rejects media
//! that cannot be resolved back to an entry.

use std::collections::BTreeMap;

use content_model::{url_identity, EntityMatch, LocalizedString, MediaRef};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::source::{KnowledgeError, SiteSource};

pub const MEDIA_INDEX_PATH: &str = "content/config/media-index.json";

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaTags {
    /// Village slug or `region` for region-wide imagery.
    #[serde(default)]
    pub village: String,
    #[serde(default)]
    pub category: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subcategory: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub time_of_day: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub season: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mood: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Dimensions {
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaEntry {
    pub id: String,
    pub url: String,
    #[serde(default)]
    pub tags: MediaTags,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub alt: Option<LocalizedString>,
    #[serde(default)]
    pub license: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub photographer: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dimensions: Option<Dimensions>,
    #[serde(default)]
    pub used_in: Vec<String>,
}

impl MediaEntry {
    pub fn media_ref(&self) -> MediaRef {
        MediaRef::Id(self.id.clone())
    }
}

/// Controlled vocabularies declared by the index.
#[derive(Debug, Clone, Default, Serialize)]
pub struct MediaVocabulary {
    pub categories: Vec<String>,
    pub villages: Vec<String>,
    pub moods: Vec<String>,
    pub time_of_day: Vec<String>,
    pub seasons: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum MediaMatch {
    /// Image is tagged with the requested entity (village).
    Strict,
    /// Image is region-wide imagery (`village: region`).
    Region,
    /// Category matches; the village does not.
    Category,
    /// No entity or category constraint was requested.
    Any,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct MediaCandidate<'a> {
    pub entry: &'a MediaEntry,
    pub matched: MediaMatch,
    pub score: u32,
}

/// Closed-world miss: nothing suitable exists; the caller must commission media.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, thiserror::Error)]
#[error("needs media: {reason}")]
pub struct NeedsMedia {
    pub id: Option<String>,
    pub entity: Option<String>,
    pub category: Option<String>,
    pub mood: Option<String>,
    pub reason: String,
}

/// What to look for when suggesting media.
#[derive(Debug, Clone, Default)]
pub struct MediaQuery<'q> {
    pub entity: Option<&'q str>,
    pub category: Option<&'q str>,
    pub mood: Option<&'q str>,
    /// How strictly the entity must match (from the block's metadata).
    pub entity_match: Option<EntityMatch>,
    pub limit: usize,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct MediaIndex {
    pub entries: Vec<MediaEntry>,
    pub vocabulary: MediaVocabulary,
    pub issues: Vec<String>,
    #[serde(skip)]
    by_id: BTreeMap<String, usize>,
    #[serde(skip)]
    by_url: BTreeMap<String, Vec<usize>>,
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

impl MediaIndex {
    pub fn from_value(v: &Value) -> Self {
        let mut idx = MediaIndex {
            vocabulary: MediaVocabulary {
                categories: strings(&v["categories"]),
                villages: strings(&v["villages"]),
                moods: strings(&v["moods"]),
                time_of_day: strings(&v["timeOfDay"]),
                seasons: strings(&v["seasons"]),
            },
            ..Default::default()
        };
        for (i, raw) in v["images"].as_array().into_iter().flatten().enumerate() {
            match serde_json::from_value::<MediaEntry>(raw.clone()) {
                Ok(e) => idx.push(e),
                Err(e) => idx.issues.push(format!("images[{i}]: {e}")),
            }
        }
        idx
    }

    pub fn from_entries(entries: impl IntoIterator<Item = MediaEntry>) -> Self {
        let mut idx = MediaIndex::default();
        for e in entries {
            idx.push(e);
        }
        idx
    }

    fn push(&mut self, e: MediaEntry) {
        if self.by_id.contains_key(&e.id) {
            self.issues.push(format!("duplicate media id `{}`", e.id));
            return;
        }
        let i = self.entries.len();
        self.by_id.insert(e.id.clone(), i);
        self.by_url
            .entry(url_identity(&e.url).to_string())
            .or_default()
            .push(i);
        self.entries.push(e);
    }

    /// Loads the index; a missing file yields an empty index.
    pub fn load(src: &dyn SiteSource) -> Result<Self, KnowledgeError> {
        Ok(src
            .read_json(MEDIA_INDEX_PATH)?
            .map(|v| Self::from_value(&v))
            .unwrap_or_default())
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Distinct underlying images (URLs compared without query string).
    pub fn unique_urls(&self) -> usize {
        self.by_url.len()
    }

    /// Entries that share their underlying image with another entry.
    pub fn shared_url_entries(&self) -> usize {
        self.by_url
            .values()
            .filter(|v| v.len() > 1)
            .map(Vec::len)
            .sum()
    }

    pub fn get(&self, id: &str) -> Option<&MediaEntry> {
        self.by_id.get(id).map(|&i| &self.entries[i])
    }

    /// Entries whose URL is the same image as `url` (query/fragment ignored).
    pub fn by_url(&self, url: &str) -> Vec<&MediaEntry> {
        self.by_url
            .get(url_identity(url))
            .map(|v| v.iter().map(|&i| &self.entries[i]).collect())
            .unwrap_or_default()
    }

    /// Resolves a `media:<id>`, URL or site path to index entries.
    pub fn resolve_ref(&self, r: &MediaRef) -> Result<Vec<&MediaEntry>, NeedsMedia> {
        let miss = |id: Option<String>, reason: String| NeedsMedia {
            id,
            entity: None,
            category: None,
            mood: None,
            reason,
        };
        match r {
            MediaRef::Id(id) => self
                .get(id)
                .map(|e| vec![e])
                .ok_or_else(|| miss(Some(id.clone()), format!("no media with id `{id}`"))),
            MediaRef::Url(u) => {
                let hits = self.by_url(u);
                if hits.is_empty() {
                    Err(miss(None, format!("URL not in media index: {u}")))
                } else {
                    Ok(hits)
                }
            }
            MediaRef::SitePath(p) => Err(miss(
                None,
                format!("site asset path not in media index: {p}"),
            )),
        }
    }

    /// Ranked candidates: strict entity matches first, then region imagery,
    /// then category-only matches. Within a tier, category, mood and lower
    /// reuse rank higher.
    pub fn suggest(&self, q: &MediaQuery<'_>) -> Result<Vec<MediaCandidate<'_>>, NeedsMedia> {
        let needs = |reason: &str| NeedsMedia {
            id: None,
            entity: q.entity.map(str::to_string),
            category: q.category.map(str::to_string),
            mood: q.mood.map(str::to_string),
            reason: reason.to_string(),
        };
        let mode = q.entity_match.unwrap_or(EntityMatch::Strict);
        let cat_ok = |e: &MediaEntry| {
            q.category
                .is_none_or(|c| e.tags.category == c || e.tags.subcategory.as_deref() == Some(c))
        };
        let mut out = vec![];
        for e in &self.entries {
            let cat = cat_ok(e);
            let matched = match (q.entity, mode) {
                (_, EntityMatch::None) | (None, _) => {
                    if !cat {
                        continue;
                    }
                    if q.category.is_some() {
                        MediaMatch::Category
                    } else {
                        MediaMatch::Any
                    }
                }
                (Some(ent), EntityMatch::Strict) => {
                    if e.tags.village == ent {
                        MediaMatch::Strict
                    } else if e.tags.village == "region" {
                        MediaMatch::Region
                    } else {
                        continue;
                    }
                }
                (Some(ent), EntityMatch::Category) => {
                    if e.tags.village == ent {
                        MediaMatch::Strict
                    } else if e.tags.village == "region" {
                        MediaMatch::Region
                    } else if cat && q.category.is_some() {
                        MediaMatch::Category
                    } else {
                        continue;
                    }
                }
            };
            let tier = match matched {
                MediaMatch::Strict => 3,
                MediaMatch::Region => 2,
                MediaMatch::Category | MediaMatch::Any => 1,
            };
            let mood = q.mood.is_some_and(|m| e.tags.mood.as_deref() == Some(m));
            let reuse_penalty = u32::try_from(e.used_in.len().min(9)).unwrap_or(9);
            let score = tier * 1000
                + u32::from(cat && q.category.is_some()) * 100
                + u32::from(mood) * 10
                + (9 - reuse_penalty);
            out.push(MediaCandidate {
                entry: e,
                matched,
                score,
            });
        }
        out.sort_by(|a, b| {
            b.score
                .cmp(&a.score)
                .then_with(|| a.entry.id.cmp(&b.entry.id))
        });
        if q.limit > 0 {
            out.truncate(q.limit);
        }
        if out.is_empty() {
            return Err(needs("no indexed image fits the requested entity/category"));
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    pub(crate) fn sample() -> MediaIndex {
        MediaIndex::from_value(&json!({
            "categories": ["sights", "food"], "villages": ["manarola", "vernazza"],
            "images": [
                {"id": "manarola-sights-1", "url": "https://img.test/a?w=1", "tags": {"village": "manarola", "category": "sights", "mood": "romantic"}, "license": "unsplash", "usedIn": ["x", "y"]},
                {"id": "manarola-food-1", "url": "https://img.test/b", "tags": {"village": "manarola", "category": "food"}, "license": "unsplash", "usedIn": []},
                {"id": "region-sights-1", "url": "https://img.test/c", "tags": {"village": "region", "category": "sights"}, "license": "unsplash"},
                {"id": "vernazza-sights-1", "url": "https://img.test/d", "tags": {"village": "vernazza", "category": "sights"}, "license": "unsplash", "alt": {"en": "Harbor"}},
                {"id": "manarola-sights-1-crop", "url": "https://img.test/a?w=2", "tags": {"village": "manarola", "category": "sights"}, "license": "unsplash"},
                {"id": "broken"},
                {"id": "manarola-food-1", "url": "https://img.test/dup", "tags": {"village": "manarola", "category": "food"}}
            ]
        }))
    }

    #[test]
    fn indexes_and_reports_issues() {
        let m = sample();
        assert_eq!(m.len(), 5);
        assert_eq!(m.issues.len(), 2, "{:?}", m.issues);
        assert_eq!(m.unique_urls(), 4);
        assert_eq!(m.shared_url_entries(), 2);
        assert_eq!(
            m.get("vernazza-sights-1").unwrap().alt.as_ref().unwrap().en,
            "Harbor"
        );
        assert_eq!(m.by_url("https://img.test/a?w=999").len(), 2);
    }

    #[test]
    fn resolves_refs_closed_world() {
        let m = sample();
        assert_eq!(
            m.resolve_ref(&MediaRef::id("manarola-food-1")).unwrap()[0].id,
            "manarola-food-1"
        );
        assert!(m.resolve_ref(&MediaRef::id("invented")).is_err());
        assert_eq!(
            m.resolve_ref(&MediaRef::parse("https://img.test/c?x").unwrap())
                .unwrap()
                .len(),
            1
        );
        assert!(m
            .resolve_ref(&MediaRef::parse("https://elsewhere.test/c").unwrap())
            .is_err());
        assert!(m
            .resolve_ref(&MediaRef::parse("/giulia.png").unwrap())
            .is_err());
    }

    #[test]
    fn suggest_ranks_strict_then_region_then_category() {
        let m = sample();
        let q = MediaQuery {
            entity: Some("manarola"),
            category: Some("sights"),
            mood: Some("romantic"),
            entity_match: Some(EntityMatch::Category),
            limit: 0,
        };
        let got: Vec<_> = m
            .suggest(&q)
            .unwrap()
            .iter()
            .map(|c| (c.entry.id.as_str(), c.matched))
            .collect();
        assert_eq!(got[0], ("manarola-sights-1", MediaMatch::Strict));
        assert_eq!(got[1], ("manarola-sights-1-crop", MediaMatch::Strict));
        assert_eq!(got[2].1, MediaMatch::Strict); // manarola food: entity match beats category
        assert_eq!(got[3], ("region-sights-1", MediaMatch::Region));
        assert_eq!(got[4], ("vernazza-sights-1", MediaMatch::Category));

        let strict = MediaQuery {
            entity_match: Some(EntityMatch::Strict),
            ..q.clone()
        };
        assert!(m
            .suggest(&strict)
            .unwrap()
            .iter()
            .all(|c| c.entry.tags.village != "vernazza"));

        let none = MediaQuery {
            entity: None,
            category: Some("food"),
            mood: None,
            entity_match: None,
            limit: 1,
        };
        assert_eq!(m.suggest(&none).unwrap()[0].entry.id, "manarola-food-1");

        let miss = MediaQuery {
            entity: Some("corniglia"),
            category: Some("beaches"),
            mood: None,
            entity_match: Some(EntityMatch::Category),
            limit: 3,
        };
        // region imagery still qualifies for any village
        assert_eq!(m.suggest(&miss).unwrap()[0].matched, MediaMatch::Region);
        let empty = MediaIndex::default();
        assert!(empty.suggest(&miss).is_err());
    }
}
