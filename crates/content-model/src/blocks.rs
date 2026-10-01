//! Core block catalog and per-block metadata.
//!
//! The 46 core block types mirror `packages/content-schema/src/blocks.ts`
//! (and therefore the embedded `page.schema.json`). [`BlockMeta`] carries the
//! agent-facing semantics ported from the legacy
//! `legacy/packages/shared/src/content/block-metadata.ts`: narrative intent,
//! media requirements (with entity matching strictness) and linking rules.
//! Blocks the legacy table did not cover got metadata here in the same spirit.

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

// ---------------------------------------------------------------------------
// Builders (keep the table below compact)
// ---------------------------------------------------------------------------

fn strs(v: &[&str]) -> Vec<String> {
    v.iter().map(|s| s.to_string()).collect()
}

fn media(required: bool, min: u32, max: u32, m: EntityMatch, cats: &[&str]) -> MediaRequirements {
    MediaRequirements {
        required,
        min,
        max,
        entity_match: m,
        allowed_categories: strs(cats),
        aspect_ratio: None,
    }
}

fn landscape(mut m: MediaRequirements) -> MediaRequirements {
    m.aspect_ratio = Some(AspectRatio::Landscape);
    m
}

fn links(min: u32, max: u32, targets: &[&str]) -> LinkingRules {
    LinkingRules {
        min_links: min,
        max_links: max,
        allowed_targets: strs(targets),
        anchor_guidance: None,
    }
}

fn guided(mut l: LinkingRules, guidance: &str) -> LinkingRules {
    l.anchor_guidance = Some(guidance.to_string());
    l
}

struct B(BlockMeta);

impl B {
    fn new(t: &str, category: BlockCategory, intent: Intent, description: &str) -> Self {
        B(BlockMeta {
            block_type: t.to_string(),
            category,
            intent,
            description: description.to_string(),
            media: None,
            linking: None,
            context: vec![],
        })
    }
    fn media(mut self, m: MediaRequirements) -> Self {
        self.0.media = Some(m);
        self
    }
    fn links(mut self, l: LinkingRules) -> Self {
        self.0.linking = Some(l);
        self
    }
    fn ctx(mut self, c: &[&str]) -> Self {
        self.0.context = strs(c);
        self
    }
}

const VILLAGE_TARGETS: &[&str] = &[
    "villages",
    "hikes",
    "restaurants",
    "accommodations",
    "sights",
];

fn build_core_meta() -> Vec<BlockMeta> {
    use BlockCategory::*;
    use EntityMatch as E;
    use Intent::*;
    let v = vec![
        // --- Core content -------------------------------------------------
        B::new(
            "paragraph",
            Core,
            Inform,
            "Text paragraph for conveying information",
        )
        .links(guided(
            links(0, 3, VILLAGE_TARGETS),
            "Use descriptive anchor text that describes the destination",
        )),
        B::new(
            "heading",
            Core,
            Orient,
            "Section heading (h2-h4) that structures the page",
        ),
        B::new(
            "hero",
            Core,
            Orient,
            "Large hero section to set context and capture attention",
        )
        .media(landscape(media(
            true,
            1,
            1,
            E::Strict,
            &["sights", "beaches", "trails"],
        )))
        .links(links(0, 2, &["villages", "itinerary"])),
        B::new(
            "image",
            Core,
            Showcase,
            "Single image with optional caption",
        )
        .media(media(true, 1, 1, E::Strict, &[])),
        B::new(
            "gallery",
            Core,
            Showcase,
            "Multiple images in grid, carousel, or masonry layout",
        )
        .media(media(
            true,
            3,
            12,
            E::Strict,
            &["sights", "beaches", "food", "accommodations"],
        )),
        B::new("quote", Core, Engage, "Pull quote with attribution"),
        B::new(
            "list",
            Core,
            Inform,
            "Ordered or unordered list of short items",
        )
        .links(links(0, 5, VILLAGE_TARGETS)),
        B::new(
            "faq",
            Core,
            Inform,
            "Frequently asked questions with expandable answers",
        )
        .links(guided(
            links(1, 5, &["villages", "hikes", "transport", "weather"]),
            "Link relevant terms in answers to related pages",
        )),
        B::new("callout", Core, Inform, "Highlighted tip, warning or note"),
        B::new(
            "embed",
            Core,
            Engage,
            "Embedded video or map from an allowed provider",
        ),
        B::new(
            "collection-embed",
            Core,
            Navigate,
            "Cards for items of a site collection",
        )
        .media(media(false, 0, 12, E::Strict, &[]))
        .links(links(
            0,
            12,
            &["restaurants", "accommodations", "hikes", "events", "sights"],
        ))
        .ctx(&["collection_type"]),
        B::new(
            "map",
            Core,
            Orient,
            "Interactive map with markers or a trail",
        )
        .links(links(0, 20, VILLAGE_TARGETS)),
        // --- Sections -----------------------------------------------------
        B::new(
            "hero-section",
            Section,
            Orient,
            "Full-width hero with CTA buttons",
        )
        .media(landscape(media(true, 1, 1, E::Category, &[])))
        .links(links(1, 3, &["villages", "itinerary", "accommodations"])),
        B::new(
            "feature-section",
            Section,
            Inform,
            "Grid of features with icons and short copy",
        )
        .links(links(0, 6, &[])),
        B::new("stats-section", Section, Inform, "Key figures with labels"),
        B::new(
            "cta-section",
            Section,
            Convert,
            "Call-to-action section to drive user action",
        )
        .media(media(false, 0, 1, E::None, &[]))
        .links(links(1, 2, &["itinerary", "accommodations", "restaurants"])),
        B::new(
            "faq-section",
            Section,
            Inform,
            "FAQ section with a heading and Q&A items",
        )
        .links(guided(
            links(0, 5, &["villages", "hikes", "transport", "weather"]),
            "Link relevant terms in answers to related pages",
        )),
        B::new(
            "content-section",
            Section,
            Inform,
            "Long-form text section, optionally with an image",
        )
        .media(media(false, 0, 1, E::Strict, &[]))
        .links(links(0, 5, VILLAGE_TARGETS)),
        B::new("newsletter", Section, Convert, "Newsletter signup form"),
        B::new(
            "section-header",
            Section,
            Orient,
            "Eyebrow, title and intro for a section",
        ),
        // --- Cinque Terre theme -------------------------------------------
        B::new(
            "village-selector",
            Theme,
            Navigate,
            "Navigation component to select villages",
        )
        .media(media(true, 5, 5, E::Strict, &["sights"]))
        .links(links(5, 5, &["villages"])),
        B::new(
            "places-to-stay",
            Theme,
            Showcase,
            "Accommodation listings for a village",
        )
        .media(media(true, 3, 10, E::Strict, &["accommodations"]))
        .links(links(1, 3, &["accommodations", "villages"]))
        .ctx(&["village"]),
        B::new(
            "featured-carousel",
            Theme,
            Showcase,
            "Carousel of featured content (stories, places)",
        )
        .media(media(
            true,
            3,
            8,
            E::Category,
            &["sights", "food", "accommodations"],
        ))
        .links(links(3, 8, &["villages", "blog", "itinerary"])),
        B::new(
            "village-intro",
            Theme,
            Orient,
            "Village introduction with lead story and essentials",
        )
        .media(media(true, 1, 2, E::Strict, &[]))
        .links(guided(
            links(
                2,
                5,
                &[
                    "restaurants",
                    "accommodations",
                    "hikes",
                    "beaches",
                    "sights",
                ],
            ),
            "Link to village subsections naturally in the narrative",
        ))
        .ctx(&["village", "weather", "essentials"]),
        B::new(
            "trending-now",
            Theme,
            Navigate,
            "Lead story plus secondary stories",
        )
        .media(media(true, 1, 6, E::Category, &[]))
        .links(links(1, 6, &["blog", "villages"])),
        B::new(
            "about",
            Theme,
            Inform,
            "About section describing the publication/team",
        )
        .media(media(false, 0, 1, E::None, &[]))
        .links(links(0, 2, &["team"])),
        B::new(
            "curated-escapes",
            Theme,
            Navigate,
            "Grid of themed travel collection cards",
        )
        .media(media(true, 2, 8, E::Category, &[]))
        .links(links(2, 8, &["itinerary", "blog", "villages"])),
        B::new(
            "latest-stories",
            Theme,
            Navigate,
            "Blog-style grid with lead story and filters",
        )
        .media(media(true, 1, 12, E::Category, &[]))
        .links(links(1, 12, &["blog"])),
        B::new("eat-drink", Theme, Showcase, "Restaurant and food listings")
            .media(media(true, 3, 10, E::Strict, &["food", "restaurants"]))
            .links(links(1, 3, &["restaurants", "villages", "culinary"]))
            .ctx(&["village"]),
        B::new(
            "highlights",
            Theme,
            Showcase,
            "Key highlights/features of an area",
        )
        .media(media(true, 3, 6, E::Category, &[]))
        .links(links(2, 6, &["villages", "hikes", "beaches", "sights"])),
        B::new(
            "audio-guides",
            Theme,
            Engage,
            "Audio/podcast cards with play buttons",
        )
        .media(media(false, 0, 6, E::Category, &[])),
        B::new(
            "practical-advice",
            Theme,
            Inform,
            "Compact icon-based advice strip",
        )
        .links(links(0, 4, &["transport", "weather"])),
        // --- Editorial ----------------------------------------------------
        B::new(
            "editorial-hero",
            Editorial,
            Orient,
            "Editorial page hero with background image and article metadata",
        )
        .media(landscape(media(
            true,
            1,
            1,
            E::Strict,
            &["sights", "trails", "food"],
        )))
        .ctx(&["village", "category", "author"]),
        B::new(
            "editorial-intro",
            Editorial,
            Orient,
            "Centered intro with badge, quote and two-column content",
        )
        .links(links(0, 4, VILLAGE_TARGETS)),
        B::new(
            "editorial-interlude",
            Editorial,
            Engage,
            "Highlighted break between content sections",
        ),
        B::new(
            "editor-note",
            Editorial,
            Engage,
            "Expert quote with avatar (local perspective)",
        )
        .media(media(false, 0, 1, E::None, &[])),
        B::new(
            "closing-note",
            Editorial,
            Convert,
            "Reflective closing section with optional actions",
        )
        .links(links(0, 3, &[])),
        // --- Templates ----------------------------------------------------
        B::new(
            "itinerary-hero",
            Template,
            Orient,
            "Hero section for itinerary pages",
        )
        .media(landscape(media(true, 1, 1, E::Category, &[])))
        .ctx(&["duration", "difficulty"]),
        B::new(
            "itinerary-days",
            Template,
            Inform,
            "Day-by-day itinerary breakdown",
        )
        .media(media(true, 4, 10, E::Strict, &[]))
        .links(guided(
            links(
                4,
                15,
                &["villages", "hikes", "restaurants", "accommodations"],
            ),
            "Link each village and activity mentioned to its page",
        )),
        B::new(
            "team-grid",
            Template,
            Inform,
            "Editor profiles with portraits",
        )
        .media(media(true, 1, 12, E::None, &[])),
        B::new(
            "airports-overview",
            Template,
            Orient,
            "Nearest airports with distances and travel times",
        )
        .links(links(0, 2, &["transport"])),
        B::new(
            "weather-live",
            Template,
            Inform,
            "Current conditions, forecast and webcams",
        )
        .media(media(false, 0, 6, E::Strict, &[]))
        .ctx(&["weather"]),
        B::new(
            "weather-journal",
            Template,
            Engage,
            "Editor's weather note with recommendations",
        )
        .media(media(false, 0, 1, E::None, &[]))
        .ctx(&["weather"]),
        B::new(
            "blog-article",
            Template,
            Inform,
            "Full blog article with nested content and sidebar",
        )
        .media(media(false, 0, 8, E::Strict, &[]))
        .links(links(
            1,
            10,
            &["villages", "hikes", "restaurants", "accommodations", "blog"],
        )),
        B::new(
            "collection-with-interludes",
            Template,
            Showcase,
            "Collection items with editorial interludes between groups",
        )
        .media(media(true, 5, 30, E::Strict, &[]))
        .links(links(2, 10, &["villages", "restaurants", "accommodations"]))
        .ctx(&["village", "collection_type"]),
        B::new(
            "blog-index",
            Template,
            Navigate,
            "Blog listing with lead story and categories",
        )
        .media(media(true, 1, 50, E::Category, &[]))
        .links(links(1, 50, &["blog"])),
    ];
    v.into_iter().map(|b| b.0).collect()
}

/// Metadata for every core block, keyed by type.
pub fn core_block_meta() -> &'static BTreeMap<String, BlockMeta> {
    static META: OnceLock<BTreeMap<String, BlockMeta>> = OnceLock::new();
    META.get_or_init(|| {
        build_core_meta()
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
