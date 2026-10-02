//! Closed-world site knowledge for swarm.press agents.
//!
//! Built from a site repo checkout through [`SiteSource`] ([`DirSource`] on
//! disk now, a GitHub-backed source later):
//!
//! * [`SiteManifest`] — languages, regions, sections, collections (read from
//!   `content/site.manifest.json` or inferred from legacy config files);
//! * [`EntityIndex`] — villages, trails, transport, categories;
//! * [`MediaIndex`] — the closed image set with tags, alt text and licensing;
//! * [`PageRegistry`] — routed pages per language, plus duplicate detection;
//! * [`CollectionIndex`] — collection items per type and region.
//!
//! [`KnowledgeBase`] combines them and offers the resolution APIs agents use:
//! [`KnowledgeBase::resolve_link`], [`KnowledgeBase::find_link_targets`],
//! [`KnowledgeBase::resolve_media`], [`KnowledgeBase::suggest_media`] and the
//! page checks ([`KnowledgeBase::check_links`], [`KnowledgeBase::check_media`]).
//! Misses are typed ([`NeedsPage`], [`NeedsMedia`]) so a pipeline can
//! commission the missing page or image instead of letting a model invent one.

pub mod collections;
pub mod entities;
pub mod kb;
pub mod manifest;
pub mod media;
pub mod pages;
pub mod source;
pub mod summary;

pub use collections::{CollectionFile, CollectionIndex, CollectionItem, FileShape};
pub use entities::{Entity, EntityIndex, EntityKind};
pub use kb::{
    BrokenRef, KnowledgeBase, LinkCandidate, LinkReport, MediaReport, NeedsPage, NeedsPageReason,
    PageCheck, RefKind, SiteAudit, UnknownMedia,
};
pub use manifest::{CollectionDef, Region, Section, SiteManifest};
pub use media::{
    MediaCandidate, MediaEntry, MediaIndex, MediaMatch, MediaQuery, MediaTags, NeedsMedia,
};
pub use pages::{normalize_route, Duplicate, DuplicateKind, PageEntry, PageRegistry};
pub use source::{DirSource, KnowledgeError, MemSource, SiteSource};
pub use summary::SiteSummary;

use content_model::{RegistryError, SchemaRegistry};

/// Directory of a site's custom block definitions.
pub const THEME_BLOCKS_DIR: &str = "theme/blocks";

/// Registers every `theme/blocks/<name>/schema.json` from the site as `x:<name>`.
pub fn load_custom_blocks(
    src: &dyn SiteSource,
    registry: &mut SchemaRegistry,
) -> Result<Vec<String>, LoadBlocksError> {
    let mut out = vec![];
    for path in src.list(THEME_BLOCKS_DIR)? {
        let rel = &path[THEME_BLOCKS_DIR.len() + 1..];
        let Some((name, "schema.json")) = rel.split_once('/') else {
            continue;
        };
        let Some(schema) = src.read_json(&path)? else {
            continue;
        };
        out.push(registry.register_custom(name, schema)?);
    }
    Ok(out)
}

#[derive(Debug, thiserror::Error)]
pub enum LoadBlocksError {
    #[error(transparent)]
    Source(#[from] KnowledgeError),
    #[error(transparent)]
    Registry(#[from] RegistryError),
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn loads_custom_blocks_from_source() {
        let mut s = MemSource::new();
        s.insert_json(
            "theme/blocks/wine-map/schema.json",
            &json!({"type": "object", "properties": {"pins": {"type": "array"}}}),
        )
        .insert("theme/blocks/wine-map/Component.astro", "---\n---")
        .insert_json(
            "theme/blocks/hero/schema.json",
            &json!({"type": "object", "properties": {}}),
        );
        let mut r = SchemaRegistry::core();
        let err = load_custom_blocks(&s, &mut r).unwrap_err();
        assert!(matches!(
            err,
            LoadBlocksError::Registry(RegistryError::ShadowsCore(_))
        ));
        let mut s2 = MemSource::new();
        s2.insert_json(
            "theme/blocks/wine-map/schema.json",
            &json!({"type": "object", "properties": {"pins": {"type": "array"}}}),
        );
        let mut r = SchemaRegistry::core();
        assert_eq!(load_custom_blocks(&s2, &mut r).unwrap(), vec!["x:wine-map"]);
    }
}
