//! The knowledge base: all indexes of one site at one commit, plus the
//! closed-world resolution APIs agents use (they never invent URLs or media).

use std::collections::{BTreeMap, BTreeSet};

use content_model::registry::{LINK_KEYS, MEDIA_KEYS};
use content_model::{block_meta, MediaRef, PageTypes, SchemaRegistry, SITE_PAGE_TYPES_PATH};
use serde::Serialize;
use serde_json::Value;

use crate::collections::CollectionIndex;
use crate::entities::{Entity, EntityIndex};
use crate::manifest::SiteManifest;
use crate::media::{MediaCandidate, MediaEntry, MediaIndex, MediaQuery, NeedsMedia};
use crate::pages::{normalize_route, PageEntry, PageRegistry};
use crate::source::KnowledgeError as SourceError;
use crate::source::{KnowledgeError, SiteSource};

/// Closed-world miss for links: the target page does not exist (yet).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, thiserror::Error)]
#[error("needs page `{target}` ({lang}): {reason}")]
pub struct NeedsPage {
    pub target: String,
    pub lang: String,
    pub reason: NeedsPageReason,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum NeedsPageReason {
    NotFound,
    /// The page exists but is not published in the requested language.
    MissingTranslation {
        page_id: String,
        available: Vec<String>,
    },
}

impl std::fmt::Display for NeedsPageReason {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            NeedsPageReason::NotFound => f.write_str("no such page"),
            NeedsPageReason::MissingTranslation { page_id, available } => write!(
                f,
                "page `{page_id}` has no translation; available: {}",
                available.join(", ")
            ),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct LinkCandidate {
    pub page_id: String,
    pub url: String,
    pub title: String,
    pub page_type: String,
    pub score: u32,
    pub why: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RefKind {
    /// An internal href / url field.
    Href,
    /// A `slug` reference to another page (e.g. related posts).
    PageSlug,
    /// A collection item referenced by `slugs` + `collectionType`.
    CollectionItem,
    /// A `collectionType` that has no collection directory.
    Collection,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct BrokenRef {
    /// JSON pointer into the page.
    pub pointer: String,
    pub value: String,
    pub kind: RefKind,
    pub reason: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct LinkReport {
    /// Internal references checked (hrefs, slugs, collection refs).
    pub checked: usize,
    pub external: usize,
    pub broken: Vec<BrokenRef>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct UnknownMedia {
    pub pointer: String,
    pub value: String,
    pub reason: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct MediaReport {
    pub checked: usize,
    /// Resolved via `media:<id>`.
    pub by_id: usize,
    /// Raw URLs that map back to an index entry.
    pub by_url: usize,
    pub unknown: Vec<UnknownMedia>,
}

/// What a closed-world problem is about.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ClosedWorldKind {
    /// A reference to a page (or collection) the site does not have.
    Link,
    /// A media reference that is not in the media index.
    Media,
    /// A `page_type` the site has neither declared nor used (FEAT-089).
    PageType,
}

impl ClosedWorldKind {
    /// `link` or `media`: the issue code the orchestrator's validator reports.
    pub fn code(self) -> &'static str {
        match self {
            ClosedWorldKind::Link => "link",
            ClosedWorldKind::Media => "media",
            ClosedWorldKind::PageType => "page_type",
        }
    }
}

/// One closed-world problem of a page (CLAUDE.md rule 5), as text a model or
/// a person can act on. [`KnowledgeBase::closed_world_issues`] is the one
/// place this text is made: the orchestrator's article validator and the
/// gateway's draft check both report it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ClosedWorldIssue {
    pub kind: ClosedWorldKind,
    /// JSON pointer into the page.
    pub pointer: String,
    pub message: String,
}

impl std::fmt::Display for ClosedWorldIssue {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.pointer, self.message)
    }
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct PageCheck {
    pub schema: Option<content_model::Report>,
    pub links: LinkReport,
    pub media: MediaReport,
}

impl PageCheck {
    pub fn is_ok(&self) -> bool {
        self.schema.as_ref().is_none_or(|r| r.is_ok())
            && self.links.broken.is_empty()
            && self.media.unknown.is_empty()
    }
}

#[derive(Debug, Clone)]
pub struct KnowledgeBase {
    pub label: String,
    pub manifest: SiteManifest,
    pub entities: EntityIndex,
    pub media: MediaIndex,
    pub pages: PageRegistry,
    pub collections: CollectionIndex,
    /// The core page types, then the site's own
    /// ([`SITE_PAGE_TYPES_PATH`], FEAT-089).
    pub page_types: PageTypes,
    /// Manifest languages plus every language a page is routed in.
    known_langs: BTreeSet<String>,
}

const ASSET_EXTS: &[&str] = &[
    ".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".pdf", ".ico", ".xml", ".txt", ".mp3",
];

fn escape(seg: &str) -> String {
    seg.replace('~', "~0").replace('/', "~1")
}

impl KnowledgeBase {
    /// Builds every index from a site checkout.
    pub fn build(src: &dyn SiteSource) -> Result<Self, KnowledgeError> {
        let mut kb = Self::from_parts(
            src.label(),
            SiteManifest::load(src)?,
            EntityIndex::load(src)?,
            MediaIndex::load(src)?,
            PageRegistry::build(src)?,
        );
        kb.collections = CollectionIndex::build(src)?;
        kb.page_types = page_types_of(src.read_json(SITE_PAGE_TYPES_PATH)?.as_ref())?;
        Ok(kb)
    }

    /// Assembles a knowledge base from indexes built elsewhere (the knowledge
    /// pack, [`crate::pack::load`]). The collection index is empty: collection
    /// references in a checked page report as broken, which is right for
    /// articles, since they embed no collections.
    pub fn from_parts(
        label: impl Into<String>,
        manifest: SiteManifest,
        entities: EntityIndex,
        media: MediaIndex,
        pages: PageRegistry,
    ) -> Self {
        let known_langs = manifest
            .languages
            .iter()
            .cloned()
            .chain(pages.count_by_lang().into_keys())
            .collect();
        KnowledgeBase {
            label: label.into(),
            manifest,
            entities,
            media,
            pages,
            collections: CollectionIndex::default(),
            page_types: PageTypes::core().clone(),
            known_langs,
        }
    }

    fn is_lang(&self, seg: &str) -> bool {
        self.known_langs.contains(seg)
    }

    fn find_page(&self, target: &str, lang: &str) -> Option<&PageEntry> {
        if let Some(p) = self.pages.by_id(target) {
            return Some(p);
        }
        let route = normalize_route(self.strip_origin(target));
        let first = route
            .trim_start_matches('/')
            .split('/')
            .next()
            .unwrap_or_default();
        if self.is_lang(first) {
            return self.pages.by_route(&route);
        }
        let prefixed = if route == "/" {
            format!("/{lang}")
        } else {
            format!("/{lang}{route}")
        };
        self.pages
            .by_route(&prefixed)
            .or_else(|| {
                // Language-neutral path that exists in another language only.
                self.manifest
                    .languages
                    .iter()
                    .find_map(|l| self.pages.by_route(&format!("/{l}{route}")))
            })
            .or_else(|| {
                // An entity slug: follow its canonical URL.
                let e = self.entities.get(target.trim_matches('/'))?;
                let url = e.canonical_url.as_ref()?;
                self.pages.by_route(url.get(lang))
            })
    }

    fn strip_origin<'a>(&self, href: &'a str) -> &'a str {
        if let Some(base) = &self.manifest.base_url {
            if let Some(rest) = href.strip_prefix(base.as_str()) {
                return if rest.is_empty() { "/" } else { rest };
            }
        }
        href
    }

    /// Resolves a page id, route (`/en/riomaggiore`), language-neutral path
    /// (`/riomaggiore`, `riomaggiore/restaurants`) or entity slug to the URL
    /// of that page in `lang`. Never fabricates a URL.
    pub fn resolve_link(&self, target: &str, lang: &str) -> Result<String, NeedsPage> {
        let needs = |reason| NeedsPage {
            target: target.to_string(),
            lang: lang.to_string(),
            reason,
        };
        let page = self
            .find_page(target, lang)
            .ok_or_else(|| needs(NeedsPageReason::NotFound))?;
        page.route(lang).map(str::to_string).ok_or_else(|| {
            needs(NeedsPageReason::MissingTranslation {
                page_id: page.id.clone(),
                available: page.routes.keys().cloned().collect(),
            })
        })
    }

    /// Candidate pages to link for a free-text query or entity name, best first.
    pub fn find_link_targets(&self, query: &str, lang: &str, limit: usize) -> Vec<LinkCandidate> {
        let q = query.trim().to_lowercase();
        if q.is_empty() {
            return vec![];
        }
        let tokens: Vec<&str> = q
            .split(|c: char| !c.is_alphanumeric())
            .filter(|t| t.len() > 2)
            .collect();
        let entities: Vec<(&Entity, u32)> = self.entities.find(&q);
        let mut out = vec![];
        for p in &self.pages.pages {
            let Some(url) = p.route(lang) else { continue };
            let title = p.title(lang).to_lowercase();
            let mut score = 0;
            let mut why = vec![];
            for (e, s) in &entities {
                if let Some(canon) = e
                    .canonical_url
                    .as_ref()
                    .map(|u| normalize_route(u.get(lang)))
                {
                    if canon == url {
                        score += 100 + s;
                        why.push(format!("canonical page of {}", e.slug));
                        continue;
                    }
                }
                if url.split('/').any(|seg| seg == e.slug) {
                    score += 20 + s / 10;
                    why.push(format!("about {}", e.slug));
                }
            }
            if title.contains(&q) {
                score += 60;
                why.push("title match".into());
            }
            let hits = u32::try_from(
                tokens
                    .iter()
                    .filter(|t| title.contains(**t) || url.contains(**t))
                    .count(),
            )
            .unwrap_or(0);
            if hits > 0 {
                score += hits * 10;
                why.push(format!("{hits} keyword(s)"));
            }
            if score > 0 {
                // Shorter routes are hubs; prefer them on ties.
                let depth = u32::try_from(url.matches('/').count()).unwrap_or(9).min(9);
                out.push(LinkCandidate {
                    page_id: p.id.clone(),
                    url: url.to_string(),
                    title: p.title(lang).to_string(),
                    page_type: p.page_type.clone(),
                    score: score * 10 + (9 - depth),
                    why: why.join(", "),
                });
            }
        }
        out.sort_by(|a, b| b.score.cmp(&a.score).then_with(|| a.url.cmp(&b.url)));
        if limit > 0 {
            out.truncate(limit);
        }
        out
    }

    pub fn resolve_media(&self, id: &str) -> Result<&MediaEntry, NeedsMedia> {
        let id = id
            .strip_prefix(content_model::media::MEDIA_SCHEME)
            .unwrap_or(id);
        self.media.get(id).ok_or_else(|| NeedsMedia {
            id: Some(id.to_string()),
            entity: None,
            category: None,
            mood: None,
            reason: format!("no media with id `{id}`"),
        })
    }

    /// Ranked media for an entity (village) / category / mood. Strict entity
    /// matches first, then region imagery, then category-only matches.
    pub fn suggest_media(
        &self,
        entity: Option<&str>,
        category: Option<&str>,
        mood: Option<&str>,
        limit: usize,
    ) -> Result<Vec<MediaCandidate<'_>>, NeedsMedia> {
        self.media.suggest(&MediaQuery {
            entity,
            category,
            mood,
            entity_match: Some(content_model::EntityMatch::Category),
            limit,
        })
    }

    /// Like [`Self::suggest_media`] but honouring a block's media rules
    /// (entity strictness and allowed categories).
    pub fn suggest_media_for_block(
        &self,
        block_type: &str,
        entity: Option<&str>,
        mood: Option<&str>,
        limit: usize,
    ) -> Result<Vec<MediaCandidate<'_>>, NeedsMedia> {
        let req = block_meta(block_type).and_then(|m| m.media.as_ref());
        let mut out = self.media.suggest(&MediaQuery {
            entity,
            category: None,
            mood,
            entity_match: req.map(|r| r.entity_match),
            limit: 0,
        })?;
        if let Some(r) = req.filter(|r| !r.allowed_categories.is_empty()) {
            out.retain(|c| r.allowed_categories.contains(&c.entry.tags.category));
        }
        if limit > 0 {
            out.truncate(limit);
        }
        if out.is_empty() {
            return Err(NeedsMedia {
                id: None,
                entity: entity.map(str::to_string),
                category: None,
                mood: mood.map(str::to_string),
                reason: format!("no indexed image satisfies `{block_type}` media rules"),
            });
        }
        Ok(out)
    }

    // -----------------------------------------------------------------------
    // Page checks
    // -----------------------------------------------------------------------

    fn check_href(&self, href: &str, langs: &[String]) -> Result<bool, String> {
        let h = href.trim();
        if h.is_empty() || h.starts_with('#') || h.starts_with("mailto:") || h.starts_with("tel:") {
            return Ok(false);
        }
        let local = self.strip_origin(h);
        if local.starts_with("http://") || local.starts_with("https://") || local.starts_with("//")
        {
            return Ok(false); // external
        }
        let route = normalize_route(local);
        if ASSET_EXTS.iter().any(|e| route.to_lowercase().ends_with(e)) {
            return Ok(false);
        }
        let first = route
            .trim_start_matches('/')
            .split('/')
            .next()
            .unwrap_or_default();
        if self.is_lang(first) {
            return if self.pages.by_route(&route).is_some() {
                Ok(true)
            } else {
                Err("no page at this route".into())
            };
        }
        let candidates: Vec<String> = langs
            .iter()
            .map(|l| {
                if route == "/" {
                    format!("/{l}")
                } else {
                    format!("/{l}{route}")
                }
            })
            .collect();
        if candidates.iter().any(|c| self.pages.by_route(c).is_some()) {
            Ok(true)
        } else {
            Err(format!(
                "no page at {route} in any language ({})",
                langs.join(", ")
            ))
        }
    }

    /// Scans a page's blocks for internal hrefs, page slugs and collection
    /// references and reports those that do not resolve.
    pub fn check_links(&self, page: &Value) -> LinkReport {
        let mut langs: Vec<String> = page["slug"]
            .as_object()
            .map(|m| m.keys().cloned().collect())
            .unwrap_or_default();
        if langs.is_empty() {
            langs.push(self.manifest.default_language.clone());
        }
        let mut report = LinkReport::default();
        if let Some(body) = page["body"].as_array() {
            for (i, block) in body.iter().enumerate() {
                self.walk_links(block, &format!("/body/{i}"), None, &langs, &mut report);
            }
        }
        report
    }

    /// `coll` is the enclosing collection reference (kind, region, exists).
    fn walk_links(
        &self,
        v: &Value,
        ptr: &str,
        coll: Option<(&str, Option<&str>, bool)>,
        langs: &[String],
        r: &mut LinkReport,
    ) {
        match v {
            Value::Object(m) => {
                // Collection references: { collectionType, slugs?, village? }.
                let mut coll = coll;
                if let Some(kind) = m.get("collectionType").and_then(Value::as_str) {
                    let region = m.get("village").and_then(Value::as_str);
                    let exists = self.check_collection_ref(kind, region, ptr, r);
                    coll = Some((kind, region, exists));
                }
                for (k, child) in m {
                    let p = format!("{ptr}/{}", escape(k));
                    if LINK_KEYS.contains(&k.as_str()) {
                        match child {
                            Value::String(s) => self.record_href(s, &p, langs, r),
                            Value::Object(per_lang) => {
                                for (lang, s) in per_lang {
                                    if let Some(s) = s.as_str() {
                                        let one = std::slice::from_ref(lang);
                                        self.record_href(
                                            s,
                                            &format!("{p}/{}", escape(lang)),
                                            one,
                                            r,
                                        );
                                    }
                                }
                            }
                            _ => {}
                        }
                    } else if k == "slug" {
                        if let Some(s) = child.as_str() {
                            match coll {
                                Some((kind, region, true)) => {
                                    self.check_item_slug(kind, region, s, &p, r)
                                }
                                Some((_, _, false)) => {} // collection itself already reported
                                None => self.check_page_slug(s, &p, r),
                            }
                        }
                    } else if k == "slugs" && coll.is_some() {
                        if let (Some((kind, region, true)), Some(a)) = (coll, child.as_array()) {
                            for (i, s) in a.iter().enumerate() {
                                if let Some(s) = s.as_str() {
                                    self.check_item_slug(kind, region, s, &format!("{p}/{i}"), r);
                                }
                            }
                        }
                    } else if k != "collectionType" {
                        self.walk_links(child, &p, coll, langs, r);
                    }
                }
            }
            Value::Array(a) => {
                for (i, child) in a.iter().enumerate() {
                    self.walk_links(child, &format!("{ptr}/{i}"), coll, langs, r);
                }
            }
            _ => {}
        }
    }

    fn record_href(&self, href: &str, ptr: &str, langs: &[String], r: &mut LinkReport) {
        match self.check_href(href, langs) {
            Ok(true) => r.checked += 1,
            Ok(false) => {
                if href.starts_with("http") || href.starts_with("//") {
                    r.external += 1;
                }
            }
            Err(reason) => {
                r.checked += 1;
                r.broken.push(BrokenRef {
                    pointer: ptr.to_string(),
                    value: href.to_string(),
                    kind: RefKind::Href,
                    reason,
                });
            }
        }
    }

    fn check_page_slug(&self, slug: &str, ptr: &str, r: &mut LinkReport) {
        if slug.is_empty() {
            return;
        }
        r.checked += 1;
        let found = if slug.starts_with('/') {
            self.pages.by_route(slug).is_some()
        } else {
            !self.pages.by_last_segment(slug).is_empty()
        };
        if !found {
            r.broken.push(BrokenRef {
                pointer: ptr.to_string(),
                value: slug.to_string(),
                kind: RefKind::PageSlug,
                reason: "no page route ends with this slug".into(),
            });
        }
    }

    /// Returns whether the collection exists (so item slugs can be checked).
    fn check_collection_ref(
        &self,
        kind: &str,
        region: Option<&str>,
        ptr: &str,
        r: &mut LinkReport,
    ) -> bool {
        r.checked += 1;
        if self.collections.kinds().contains(&kind) {
            if let Some(region) = region {
                if !self.collections.regions(kind).contains(&region) {
                    r.broken.push(BrokenRef {
                        pointer: format!("{ptr}/village"),
                        value: region.to_string(),
                        kind: RefKind::Collection,
                        reason: format!("collection `{kind}` has no file for region `{region}`"),
                    });
                }
            }
            return true;
        }
        r.broken.push(BrokenRef {
            pointer: format!("{ptr}/collectionType"),
            value: kind.to_string(),
            kind: RefKind::Collection,
            reason: "no such collection under content/collections/".into(),
        });
        false
    }

    fn check_item_slug(
        &self,
        kind: &str,
        region: Option<&str>,
        slug: &str,
        ptr: &str,
        r: &mut LinkReport,
    ) {
        r.checked += 1;
        if self.collections.find_item(kind, slug, region).is_none() {
            let where_ = region
                .map(|v| format!("{kind}/{v}"))
                .unwrap_or_else(|| kind.to_string());
            r.broken.push(BrokenRef {
                pointer: ptr.to_string(),
                value: slug.to_string(),
                kind: RefKind::CollectionItem,
                reason: format!("no item `{slug}` in {where_}"),
            });
        }
    }

    /// Reports media fields whose value is not in the media index.
    pub fn check_media(&self, page: &Value) -> MediaReport {
        let mut report = MediaReport::default();
        if let Some(body) = page["body"].as_array() {
            for (i, block) in body.iter().enumerate() {
                self.walk_media(block, &format!("/body/{i}"), None, &mut report);
            }
        }
        if let Some(og) = page["seo"]["og_image"].as_str() {
            self.record_media(og, "/seo/og_image", &mut report);
        }
        report
    }

    fn walk_media(&self, v: &Value, ptr: &str, key: Option<&str>, r: &mut MediaReport) {
        match v {
            Value::Object(m) => {
                for (k, child) in m {
                    self.walk_media(child, &format!("{ptr}/{}", escape(k)), Some(k), r);
                }
            }
            Value::Array(a) => {
                for (i, child) in a.iter().enumerate() {
                    self.walk_media(child, &format!("{ptr}/{i}"), key, r);
                }
            }
            Value::String(s) if key.is_some_and(|k| MEDIA_KEYS.contains(&k)) => {
                self.record_media(s, ptr, r);
            }
            _ => {}
        }
    }

    fn record_media(&self, s: &str, ptr: &str, r: &mut MediaReport) {
        if s.is_empty() {
            return;
        }
        r.checked += 1;
        let unknown = |reason: String| UnknownMedia {
            pointer: ptr.to_string(),
            value: s.to_string(),
            reason,
        };
        match MediaRef::parse(s) {
            Ok(mr) => match self.media.resolve_ref(&mr) {
                Ok(_) if mr.is_closed_world() => r.by_id += 1,
                Ok(_) => r.by_url += 1,
                Err(e) => r.unknown.push(unknown(e.reason)),
            },
            Err(e) => r.unknown.push(unknown(e.to_string())),
        }
    }

    /// Whether `name` is a page type of the site: declared (core or the
    /// site's registry) or already used by one of its pages. The used ones
    /// keep the site's existing pages inside the closed world until the
    /// site declares its types.
    pub fn is_page_type(&self, name: &str) -> bool {
        self.page_types.get(name).is_some() || self.pages.pages.iter().any(|p| p.page_type == name)
    }

    /// Every page type of the site ([`Self::is_page_type`]), sorted.
    pub fn page_type_names(&self) -> BTreeSet<&str> {
        let mut names = self.page_types.names();
        names.extend(
            self.pages
                .pages
                .iter()
                .map(|p| p.page_type.as_str())
                .filter(|t| !t.is_empty()),
        );
        names
    }

    /// The page's `page_type` when the site does not know it
    /// ([`Self::is_page_type`]). A missing `page_type` is the schema's to
    /// report.
    pub fn check_page_type(&self, page: &Value) -> Option<ClosedWorldIssue> {
        let name = page.get("page_type").and_then(Value::as_str)?;
        if self.is_page_type(name) {
            return None;
        }
        let known: Vec<&str> = self.page_type_names().into_iter().collect();
        Some(ClosedWorldIssue {
            kind: ClosedWorldKind::PageType,
            pointer: "/page_type".into(),
            message: format!(
                "{name:?} is not a page type of the site (known: {})",
                known.join(", ")
            ),
        })
    }

    /// The page's unknown page type ([`Self::check_page_type`]), its links
    /// that do not resolve and its media that is not in the index
    /// ([`Self::check_links`], [`Self::check_media`]): the page type first,
    /// then links, then media, each in page order. Empty: the page stays
    /// inside the closed world.
    pub fn closed_world_issues(&self, page: &Value) -> Vec<ClosedWorldIssue> {
        let page_type = self.check_page_type(page);
        let links = self
            .check_links(page)
            .broken
            .into_iter()
            .map(|b| ClosedWorldIssue {
                kind: ClosedWorldKind::Link,
                pointer: b.pointer,
                message: format!("{:?} is not a page of the site: {}", b.value, b.reason),
            });
        let media = self
            .check_media(page)
            .unknown
            .into_iter()
            .map(|m| ClosedWorldIssue {
                kind: ClosedWorldKind::Media,
                pointer: m.pointer,
                message: format!("{:?} is not in the media index: {}", m.value, m.reason),
            });
        page_type.into_iter().chain(links).chain(media).collect()
    }

    /// Everything `write_page` checks: schema (if a registry is given), links, media.
    pub fn check_page(&self, page: &Value, registry: Option<&SchemaRegistry>) -> PageCheck {
        PageCheck {
            schema: registry.map(|r| content_model::validate_page_v2(page, r)),
            links: self.check_links(page),
            media: self.check_media(page),
        }
    }

    /// The pages a page links to (repo paths): its internal hrefs and page
    /// slugs that resolve, collection references left out. Used for the
    /// audit's inbound links (ADR-0070).
    pub fn link_targets(&self, page: &Value) -> BTreeSet<String> {
        let mut langs: Vec<String> = page["slug"]
            .as_object()
            .map(|m| m.keys().cloned().collect())
            .unwrap_or_default();
        if langs.is_empty() {
            langs.push(self.manifest.default_language.clone());
        }
        let mut out = BTreeSet::new();
        if let Some(body) = page["body"].as_array() {
            for block in body {
                self.walk_targets(block, false, &langs, &mut out);
            }
        }
        out
    }

    fn walk_targets(&self, v: &Value, in_coll: bool, langs: &[String], out: &mut BTreeSet<String>) {
        match v {
            Value::Object(m) => {
                let in_coll = in_coll || m.contains_key("collectionType");
                for (k, child) in m {
                    if LINK_KEYS.contains(&k.as_str()) {
                        match child {
                            Value::String(s) => self.href_target(s, langs, out),
                            Value::Object(per_lang) => {
                                for (lang, s) in per_lang {
                                    if let Some(s) = s.as_str() {
                                        self.href_target(s, std::slice::from_ref(lang), out);
                                    }
                                }
                            }
                            _ => {}
                        }
                    } else if k == "slug" && !in_coll {
                        if let Some(slug) = child.as_str().filter(|s| !s.is_empty()) {
                            if slug.starts_with('/') {
                                if let Some(p) = self.pages.by_route(slug) {
                                    out.insert(p.path.clone());
                                }
                            } else {
                                for p in self.pages.by_last_segment(slug) {
                                    out.insert(p.path.clone());
                                }
                            }
                        }
                    } else {
                        self.walk_targets(child, in_coll, langs, out);
                    }
                }
            }
            Value::Array(a) => {
                for child in a {
                    self.walk_targets(child, in_coll, langs, out);
                }
            }
            _ => {}
        }
    }

    fn href_target(&self, href: &str, langs: &[String], out: &mut BTreeSet<String>) {
        if self.check_href(href, langs) != Ok(true) {
            return;
        }
        let route = normalize_route(self.strip_origin(href.trim()));
        let first = route
            .trim_start_matches('/')
            .split('/')
            .next()
            .unwrap_or_default();
        let hit = if self.is_lang(first) {
            self.pages.by_route(&route)
        } else {
            langs.iter().find_map(|l| {
                let c = if route == "/" {
                    format!("/{l}")
                } else {
                    format!("/{l}{route}")
                };
                self.pages.by_route(&c)
            })
        };
        if let Some(p) = hit {
            out.insert(p.path.clone());
        }
    }

    /// Loads every routed page and checks links and media across the site;
    /// also counts inbound links (orphans), dates the articles (from their
    /// `updated_at`, else the blog index) and checks the blocks against
    /// `content/config/linking-policy.json` when the site has one (ADR-0070).
    pub fn audit(&self, src: &dyn SiteSource) -> Result<SiteAudit, KnowledgeError> {
        let mut audit = SiteAudit::default();
        let policy = src.read_json(LINKING_POLICY_PATH)?;
        let index_dates = blog_index_dates(src.read_json(crate::pack::BLOG_INDEX_PATH)?.as_ref());
        let mut inbound: BTreeMap<String, usize> = BTreeMap::new();
        // The site's navigation links pages too (header and footer menus).
        if let Some(nav) = src.read_json(NAVIGATION_PATH)? {
            let as_page = serde_json::json!({"body": [nav]});
            for t in self.link_targets(&as_page) {
                *inbound.entry(t).or_default() += 1;
            }
        }
        for p in &self.pages.pages {
            let Some(v) = src.read_json(&p.path)? else {
                continue;
            };
            let links = self.check_links(&v);
            let media = self.check_media(&v);
            audit.links_checked += links.checked;
            audit.media_checked += media.checked;
            audit.media_by_id += media.by_id;
            audit.media_by_url += media.by_url;
            for b in links.broken {
                *audit.broken_by_kind.entry(b.kind).or_default() += 1;
                audit.broken.push((p.path.clone(), b));
            }
            for m in media.unknown {
                audit.unknown_media.push((p.path.clone(), m));
            }
            for t in self.link_targets(&v) {
                if t != p.path {
                    *inbound.entry(t).or_default() += 1;
                }
            }
            if let Some(stem) = p
                .path
                .strip_prefix(BLOG_DIR)
                .and_then(|f| f.strip_suffix(".json"))
            {
                let date = v["updated_at"]
                    .as_str()
                    .and_then(|d| d.get(..10))
                    .map(String::from)
                    .or_else(|| index_dates.get(stem).cloned());
                audit.articles.push(ArticleDate {
                    path: p.path.clone(),
                    title: p.title(&self.manifest.default_language).to_string(),
                    date,
                });
                // The site languages its title has no text for (ADR-0073).
                let missing: Vec<String> = self
                    .manifest
                    .languages
                    .iter()
                    .filter(|l| **l != self.manifest.default_language)
                    .filter(|l| {
                        v["title"]
                            .get(l.as_str())
                            .and_then(Value::as_str)
                            .is_none_or(|t| t.trim().is_empty())
                    })
                    .cloned()
                    .collect();
                if !missing.is_empty() {
                    audit.untranslated.push(Untranslated {
                        path: p.path.clone(),
                        title: p.title(&self.manifest.default_language).to_string(),
                        missing,
                    });
                }
            }
            if let Some(policies) = policy.as_ref().and_then(|v| v["policies"].as_object()) {
                if let Some(body) = v["body"].as_array() {
                    for (i, block) in body.iter().enumerate() {
                        let Some(kind) = block["type"].as_str() else {
                            continue;
                        };
                        let Some(rule) = policies.get(kind) else {
                            continue;
                        };
                        let one = serde_json::json!({"slug": v["slug"], "body": [block]});
                        let links = self.check_links(&one).checked;
                        let min = rule["minLinks"].as_u64().unwrap_or(0) as usize;
                        let max = rule["maxLinks"].as_u64().map_or(usize::MAX, |m| m as usize);
                        if links < min || links > max {
                            audit.policy.push(PolicyFinding {
                                path: p.path.clone(),
                                pointer: format!("/body/{i}"),
                                block: kind.to_string(),
                                links,
                                min,
                                max: rule["maxLinks"].as_u64().map(|m| m as usize),
                            });
                        }
                    }
                }
            }
        }
        for p in &self.pages.pages {
            let home = p.page_type == "home"
                || p.routes
                    .values()
                    .any(|r| r == "/" || self.is_lang(r.trim_matches('/')));
            if !home && p.page_type != "blog-index" && !inbound.contains_key(&p.path) {
                audit.orphans.push(p.path.clone());
            }
        }
        audit.inbound = inbound;
        Ok(audit)
    }
}

/// The site's header and footer menus, which link pages as well.
pub const NAVIGATION_PATH: &str = "content/config/navigation.json";
/// Where the site's linking policy lives (ADR-0070).
pub const LINKING_POLICY_PATH: &str = "content/config/linking-policy.json";
/// Where the site keeps its articles.
pub const BLOG_DIR: &str = "content/pages/blog/";

/// `slug → YYYY-MM-DD` from the blog index's stories (`Oct 15, 2023` or ISO).
fn blog_index_dates(index: Option<&Value>) -> BTreeMap<String, String> {
    const MONTHS: [&str; 12] = [
        "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec",
    ];
    let mut out = BTreeMap::new();
    let Some(body) = index.and_then(|v| v["body"].as_array()) else {
        return out;
    };
    for story in body
        .iter()
        .filter(|b| b["type"] == "blog-index")
        .filter_map(|b| b["stories"].as_array())
        .flatten()
    {
        let (Some(slug), Some(date)) = (story["slug"].as_str(), story["date"].as_str()) else {
            continue;
        };
        let iso = if date.len() >= 10 && date.as_bytes()[4] == b'-' {
            Some(date[..10].to_string())
        } else {
            let words: Vec<&str> = date
                .split(|c: char| c.is_whitespace() || c == ',')
                .filter(|w| !w.is_empty())
                .collect();
            match words.as_slice() {
                [m, d, y, ..] => {
                    let lower = m.to_lowercase();
                    MONTHS
                        .iter()
                        .position(|x| lower.starts_with(x))
                        .and_then(|i| {
                            let d: u32 = d.parse().ok()?;
                            let y: u32 = y.parse().ok()?;
                            Some(format!("{y:04}-{:02}-{d:02}", i + 1))
                        })
                }
                _ => None,
            }
        };
        if let Some(iso) = iso {
            out.insert(slug.to_string(), iso);
        }
    }
    out
}

/// An article and its last date (`YYYY-MM-DD`), if the site says.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ArticleDate {
    pub path: String,
    pub title: String,
    pub date: Option<String>,
}

/// A block with fewer or more internal links than the linking policy allows.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PolicyFinding {
    pub path: String,
    pub pointer: String,
    pub block: String,
    pub links: usize,
    pub min: usize,
    pub max: Option<usize>,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct SiteAudit {
    pub links_checked: usize,
    pub broken: Vec<(String, BrokenRef)>,
    pub broken_by_kind: BTreeMap<RefKind, usize>,
    pub media_checked: usize,
    pub media_by_id: usize,
    pub media_by_url: usize,
    pub unknown_media: Vec<(String, UnknownMedia)>,
    /// Inbound links per page path, from other pages (ADR-0070).
    pub inbound: BTreeMap<String, usize>,
    /// Routed pages no other page links to (the home and the blog index left out).
    pub orphans: Vec<String>,
    /// The site's articles with their last date.
    pub articles: Vec<ArticleDate>,
    /// Blocks outside the linking policy's link counts.
    pub policy: Vec<PolicyFinding>,
    /// Articles missing site languages (ADR-0073).
    pub untranslated: Vec<Untranslated>,
}

/// An article and the site languages its title has no text for.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Untranslated {
    pub path: String,
    pub title: String,
    pub missing: Vec<String>,
}

/// The core page types followed by a site's registry file, if it has one.
pub fn page_types_of(site: Option<&Value>) -> Result<PageTypes, SourceError> {
    let Some(file) = site else {
        return Ok(PageTypes::core().clone());
    };
    let shape = |errors: Vec<String>| SourceError::Shape {
        path: SITE_PAGE_TYPES_PATH.into(),
        message: errors.join("; "),
    };
    PageTypes::core()
        .with_site(&PageTypes::parse(file).map_err(shape)?)
        .map_err(shape)
}
