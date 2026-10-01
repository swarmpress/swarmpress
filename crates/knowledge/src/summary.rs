//! Human-readable index summary (used by the `index_site` example and tests).

use std::collections::BTreeMap;
use std::fmt;

use serde::Serialize;

use crate::entities::EntityKind;
use crate::kb::{KnowledgeBase, RefKind, SiteAudit};
use crate::pages::DuplicateKind;

#[derive(Debug, Clone, Serialize)]
pub struct SiteSummary {
    pub source: String,
    pub manifest_inferred: bool,
    pub languages: Vec<String>,
    pub regions: Vec<String>,
    pub sections: usize,
    pub pages: usize,
    pub pages_by_lang: BTreeMap<String, usize>,
    pub pages_by_type: BTreeMap<String, usize>,
    pub pages_without_en: usize,
    pub page_errors: usize,
    pub collections: BTreeMap<String, BTreeMap<String, usize>>,
    pub collection_items: usize,
    pub collection_issues: usize,
    pub media: usize,
    pub media_unique_urls: usize,
    pub media_issues: usize,
    pub entities: BTreeMap<EntityKind, usize>,
    pub duplicates_same_route: usize,
    pub duplicates_same_id: usize,
    pub stray_copies: usize,
    pub stray_copies_identical: usize,
    pub stray_pages: usize,
    pub audit: Option<AuditSummary>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AuditSummary {
    pub links_checked: usize,
    pub broken_links: usize,
    pub broken_by_kind: BTreeMap<RefKind, usize>,
    pub media_checked: usize,
    pub media_by_id: usize,
    pub media_by_url: usize,
    pub unknown_media: usize,
}

impl SiteSummary {
    pub fn new(kb: &KnowledgeBase, audit: Option<&SiteAudit>) -> Self {
        let dup = |f: fn(&DuplicateKind) -> bool| {
            kb.pages.duplicates.iter().filter(|d| f(&d.kind)).count()
        };
        let mut entities = BTreeMap::new();
        for e in &kb.entities.entities {
            *entities.entry(e.kind).or_insert(0) += 1;
        }
        SiteSummary {
            source: kb.label.clone(),
            manifest_inferred: kb.manifest.inferred,
            languages: kb.manifest.languages.clone(),
            regions: kb.manifest.regions.iter().map(|r| r.slug.clone()).collect(),
            sections: kb.manifest.sections.len(),
            pages: kb.pages.len(),
            pages_by_lang: kb.pages.count_by_lang(),
            pages_by_type: kb.pages.count_by_type(),
            pages_without_en: kb.pages.missing_fallback().len(),
            page_errors: kb.pages.errors.len(),
            collections: kb.collections.counts(),
            collection_items: kb.collections.total_items(),
            collection_issues: kb.collections.issues.len(),
            media: kb.media.len(),
            media_unique_urls: kb.media.unique_urls(),
            media_issues: kb.media.issues.len(),
            entities,
            duplicates_same_route: dup(|k| matches!(k, DuplicateKind::SameRoute { .. })),
            duplicates_same_id: dup(|k| matches!(k, DuplicateKind::SameId { .. })),
            stray_copies: dup(|k| matches!(k, DuplicateKind::StrayCopy { .. })),
            stray_copies_identical: dup(|k| {
                matches!(k, DuplicateKind::StrayCopy { identical: true })
            }),
            stray_pages: kb.pages.stray_pages.len(),
            audit: audit.map(|a| AuditSummary {
                links_checked: a.links_checked,
                broken_links: a.broken.len(),
                broken_by_kind: a.broken_by_kind.clone(),
                media_checked: a.media_checked,
                media_by_id: a.media_by_id,
                media_by_url: a.media_by_url,
                unknown_media: a.unknown_media.len(),
            }),
        }
    }
}

fn join_counts<K: fmt::Debug>(m: &BTreeMap<K, usize>) -> String {
    m.iter()
        .map(|(k, v)| format!("{}={v}", format!("{k:?}").trim_matches('"')))
        .collect::<Vec<_>>()
        .join(" ")
}

impl fmt::Display for SiteSummary {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        writeln!(f, "site: {}", self.source)?;
        writeln!(
            f,
            "manifest: {} | languages: {} | regions: {} | sections: {}",
            if self.manifest_inferred {
                "inferred"
            } else {
                "site.manifest.json"
            },
            self.languages.join(","),
            self.regions.join(","),
            self.sections
        )?;
        writeln!(
            f,
            "pages: {} (errors {}, without en route {})",
            self.pages, self.page_errors, self.pages_without_en
        )?;
        writeln!(f, "  by lang: {}", join_counts(&self.pages_by_lang))?;
        writeln!(f, "  by type: {}", join_counts(&self.pages_by_type))?;
        writeln!(
            f,
            "duplicates: same-route {} | same-id {} | stray copies {} ({} identical) | stray pages {}",
            self.duplicates_same_route,
            self.duplicates_same_id,
            self.stray_copies,
            self.stray_copies_identical,
            self.stray_pages
        )?;
        writeln!(
            f,
            "collections: {} items in {} types (issues {})",
            self.collection_items,
            self.collections.len(),
            self.collection_issues
        )?;
        for (kind, regions) in &self.collections {
            writeln!(f, "  {kind}: {}", join_counts(regions))?;
        }
        writeln!(
            f,
            "media: {} entries, {} distinct images (issues {})",
            self.media, self.media_unique_urls, self.media_issues
        )?;
        writeln!(f, "entities: {}", join_counts(&self.entities))?;
        if let Some(a) = &self.audit {
            writeln!(
                f,
                "links: {} internal refs checked, {} broken ({})",
                a.links_checked,
                a.broken_links,
                join_counts(&a.broken_by_kind)
            )?;
            writeln!(
                f,
                "page media: {} checked, {} via media:<id>, {} raw URLs found in index, {} not in index",
                a.media_checked, a.media_by_id, a.media_by_url, a.unknown_media
            )?;
        }
        Ok(())
    }
}
