//! Core block catalog and per-block metadata.
//!
//! The 46 core block types mirror `packages/content-schema/src/blocks.ts`
//! (and therefore the embedded `page.schema.json`). [`BlockMeta`] carries the
//! agent-facing semantics first ported from the legacy
//! `legacy/packages/shared/src/content/block-metadata.ts`: narrative intent,
//! media requirements (with entity matching strictness) and linking rules.
//!
//! The metadata is data (FEAT-089): `packages/content-schema/data/block-meta.json`,
//! which the TypeScript side parses too, copied by `pnpm schema:export` to
//! `crates/content-schema/schema/block-meta.json` and read here.

use std::collections::BTreeMap;
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};

/// Every core block type, in schema order.
pub const CORE_BLOCK_TYPES: [&str; 46] = [
    // Core content (12)
    "paragraph",
    "heading",
    "hero",
    "image",
    "gallery",
    "quote",
    "list",
    "faq",
    "callout",
    "embed",
    "collection-embed",
    "map",
    // Sections (8)
    "hero-section",
    "feature-section",
    "stats-section",
    "cta-section",
    "faq-section",
    "content-section",
    "newsletter",
    "section-header",
    // Cinque Terre theme (12)
    "village-selector",
    "places-to-stay",
    "featured-carousel",
    "village-intro",
    "trending-now",
    "about",
    "curated-escapes",
    "latest-stories",
    "eat-drink",
    "highlights",
    "audio-guides",
    "practical-advice",
    // Editorial (5)
    "editorial-hero",
    "editorial-intro",
    "editorial-interlude",
    "editor-note",
    "closing-note",
    // Templates (9)
    "itinerary-hero",
    "itinerary-days",
    "team-grid",
    "airports-overview",
    "weather-live",
    "weather-journal",
    "blog-article",
    "collection-with-interludes",
    "blog-index",
];

/// Prefix of site custom block types (`x:<name>`).
pub const CUSTOM_PREFIX: &str = "x:";

pub fn is_core_block(t: &str) -> bool {
    CORE_BLOCK_TYPES.contains(&t)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum BlockCategory {
    Core,
    Section,
    Theme,
    Editorial,
    Template,
    Custom,
}

/// Narrative purpose of a block.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Intent {
    /// Display visual content prominently (hero, gallery).
    Showcase,
    /// Provide information or facts (paragraph, list, faq).
    Inform,
    /// Guide the reader to other content.
    Navigate,
    /// Drive an action (CTA, newsletter).
    Convert,
    /// Show options side by side.
    Compare,
    /// Set context or scene (intro, editorial hero).
    Orient,
    /// Encourage interaction (quote, testimonial).
    Engage,
}

/// How strictly an image must match the block's entity (village/region).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum EntityMatch {
    /// The image's village tag MUST equal the block's entity (or be `region`).
    Strict,
    /// The image category must match; any village.
    Category,
    /// Generic imagery is fine.
    None,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AspectRatio {
    Square,
    Video,
    Portrait,
    Landscape,
    Any,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaRequirements {
    pub required: bool,
    pub min: u32,
    pub max: u32,
    pub entity_match: EntityMatch,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub allowed_categories: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub aspect_ratio: Option<AspectRatio>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkingRules {
    pub min_links: u32,
    pub max_links: u32,
    /// Page types / sections this block may link to. Empty = any.
    #[serde(default)]
    pub allowed_targets: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub anchor_guidance: Option<String>,
}

impl LinkingRules {
    pub fn allows(&self, target: &str) -> bool {
        self.allowed_targets.is_empty() || self.allowed_targets.iter().any(|t| t == target)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockMeta {
    #[serde(rename = "type")]
    pub block_type: String,
    pub category: BlockCategory,
    pub intent: Intent,
    pub description: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub media: Option<MediaRequirements>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub linking: Option<LinkingRules>,
    /// Context the writer needs before using the block (village, weather, …).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub context: Vec<String>,
}

impl BlockMeta {
    pub fn requires_media(&self) -> bool {
        self.media.as_ref().is_some_and(|m| m.required)
    }

    /// Port of legacy `validateMediaForBlock`: does an image tagged
    /// `image_village`/`image_category` fit this block about `block_entity`?
    pub fn media_fits(
        &self,
        image_village: &str,
        block_entity: Option<&str>,
        image_category: &str,
    ) -> Result<(), String> {
        let Some(req) = &self.media else {
            return Ok(());
        };
        if req.entity_match == EntityMatch::Strict {
            if let Some(entity) = block_entity {
                if image_village != entity && image_village != "region" {
                    return Err(format!(
                        "image village {image_village:?} does not match block entity {entity:?}"
                    ));
                }
            }
        }
        if !req.allowed_categories.is_empty()
            && !req.allowed_categories.iter().any(|c| c == image_category)
        {
            return Err(format!(
                "image category {image_category:?} not in allowed categories: {}",
                req.allowed_categories.join(", ")
            ));
        }
        Ok(())
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct BlockMetaFile {
    format: String,
    blocks: Vec<BlockMeta>,
}

fn parse_core_meta() -> Vec<BlockMeta> {
    let file: BlockMetaFile =
        serde_json::from_str(content_schema::BLOCK_META_JSON).expect("the block metadata is valid");
    assert_eq!(
        file.format, "swarmpress.block-meta.v1",
        "block metadata format"
    );
    file.blocks
}

/// Metadata for every core block, keyed by type.
pub fn core_block_meta() -> &'static BTreeMap<String, BlockMeta> {
    static META: OnceLock<BTreeMap<String, BlockMeta>> = OnceLock::new();
    META.get_or_init(|| {
        parse_core_meta()
            .into_iter()
            .map(|m| (m.block_type.clone(), m))
            .collect()
    })
}

/// Metadata for a core block type.
pub fn block_meta(block_type: &str) -> Option<&'static BlockMeta> {
    core_block_meta().get(block_type)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_core_type_has_meta_and_vice_versa() {
        let meta = core_block_meta();
        assert_eq!(meta.len(), 46);
        for t in CORE_BLOCK_TYPES {
            assert!(meta.contains_key(t), "missing meta for {t}");
        }
        for k in meta.keys() {
            assert!(is_core_block(k), "meta for non-core {k}");
        }
    }

    #[test]
    fn category_counts_match_catalog() {
        let mut counts = BTreeMap::new();
        for m in core_block_meta().values() {
            *counts.entry(m.category).or_insert(0) += 1;
        }
        assert_eq!(counts[&BlockCategory::Core], 12);
        assert_eq!(counts[&BlockCategory::Section], 8);
        assert_eq!(counts[&BlockCategory::Theme], 12);
        assert_eq!(counts[&BlockCategory::Editorial], 5);
        assert_eq!(counts[&BlockCategory::Template], 9);
    }

    #[test]
    fn media_ranges_are_sane() {
        for m in core_block_meta().values() {
            if let Some(media) = &m.media {
                assert!(media.min <= media.max, "{}", m.block_type);
                assert_eq!(media.required, media.min > 0, "{}", m.block_type);
            }
            if let Some(l) = &m.linking {
                assert!(l.min_links <= l.max_links, "{}", m.block_type);
            }
        }
    }

    #[test]
    fn legacy_rules_ported() {
        let hero = block_meta("hero").unwrap();
        assert_eq!(hero.intent, Intent::Orient);
        assert!(hero.requires_media());
        assert!(hero
            .media_fits("riomaggiore", Some("riomaggiore"), "sights")
            .is_ok());
        assert!(hero
            .media_fits("region", Some("riomaggiore"), "beaches")
            .is_ok());
        assert!(hero
            .media_fits("vernazza", Some("riomaggiore"), "sights")
            .is_err());
        assert!(hero
            .media_fits("riomaggiore", Some("riomaggiore"), "food")
            .is_err());
        let vs = block_meta("village-selector").unwrap();
        assert_eq!(vs.linking.as_ref().unwrap().min_links, 5);
        assert!(vs.linking.as_ref().unwrap().allows("villages"));
        assert!(!vs.linking.as_ref().unwrap().allows("blog"));
        assert_eq!(block_meta("paragraph").unwrap().media, None);
    }

    #[test]
    fn meta_serializes() {
        let json = serde_json::to_value(block_meta("gallery").unwrap()).unwrap();
        assert_eq!(json["type"], "gallery");
        assert_eq!(json["media"]["entityMatch"], "strict");
        let back: BlockMeta = serde_json::from_value(json).unwrap();
        assert_eq!(&back, block_meta("gallery").unwrap());
    }
}
