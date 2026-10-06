//! Index builders and resolution against a trimmed copy of cinqueterre.travel
//! (`tests/fixtures/cinqueterre-mini`: 9 pages incl. a same-route pair and two
//! legacy `content/blog` copies, one wrapped and one array-shaped collection
//! file, a media-index subset, the full entity index, the five villages, and a
//! synthetic `theme/blocks/wine-map` custom block).

use std::path::PathBuf;

use content_model::{blocks_doc, validate_page_v1, validate_page_v2, Intent, SchemaRegistry};
use knowledge::{
    load_custom_blocks, DirSource, DuplicateKind, FileShape, KnowledgeBase, MediaMatch,
    NeedsPageReason, RefKind, SiteSource, SiteSummary,
};
use serde_json::json;

fn src() -> DirSource {
    DirSource::new(
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/cinqueterre-mini"),
    )
}

fn kb() -> KnowledgeBase {
    KnowledgeBase::build(&src()).expect("fixture indexes")
}

#[test]
fn manifest_is_inferred_from_legacy_config() {
    let kb = kb();
    let m = &kb.manifest;
    assert!(m.inferred);
    assert_eq!(m.name, "Cinque Terre Travel Guide");
    assert_eq!(m.base_url.as_deref(), Some("https://cinqueterre.travel"));
    assert_eq!(m.default_language, "en");
    assert_eq!(m.languages, vec!["en", "de", "it", "fr"]);
    let regions: Vec<_> = m.regions.iter().map(|r| r.slug.as_str()).collect();
    assert_eq!(
        regions,
        vec![
            "riomaggiore",
            "manarola",
            "corniglia",
            "vernazza",
            "monterosso"
        ]
    );
    assert_eq!(m.region("vernazza").unwrap().order, 4);
    assert!(m
        .sections
        .iter()
        .any(|s| s.slug == "restaurants" && s.per_region));
    assert!(m.sections.iter().any(|s| s.slug == "blog" && !s.per_region));
    let kinds: Vec<_> = m
        .collections
        .iter()
        .map(|c| (c.kind.as_str(), c.per_region))
        .collect();
    assert_eq!(kinds, vec![("hikes", true), ("restaurants", true)]);
    assert_eq!(m.collections[1].display_name, "Restaurants");
    assert!(m.notes.iter().any(|n| n.contains("config/site.json")));
}

#[test]
fn entity_and_media_indexes() {
    let kb = kb();
    assert_eq!(
        kb.entities.of_kind(knowledge::EntityKind::Village).count(),
        5
    );
    assert_eq!(kb.entities.find("path of love")[0].0.slug, "via-dell-amore");
    assert_eq!(kb.media.len(), 20);
    assert_eq!(kb.media.unique_urls(), 18);
    let hero = kb.resolve_media("media:riomaggiore-hero-001").unwrap();
    assert_eq!(hero.tags.village, "riomaggiore");
    assert_eq!(
        hero.alt.as_ref().unwrap().get("de"),
        "Riomaggiore bunte Häuser an der Klippe"
    );
    assert_eq!(hero.license, "unsplash");
    assert!(kb.resolve_media("invented-001").is_err());
}

#[test]
fn page_registry_and_duplicates() {
    let kb = kb();
    assert_eq!(kb.pages.len(), 9);
    assert!(kb.pages.errors.is_empty());
    let by_lang = kb.pages.count_by_lang();
    assert_eq!((by_lang["en"], by_lang["it"]), (8, 7));
    assert_eq!(kb.pages.missing_fallback()[0].id, "transport-de-001");
    let same_route = kb
        .pages
        .duplicates
        .iter()
        .filter(|d| matches!(d.kind, DuplicateKind::SameRoute { .. }))
        .count();
    assert_eq!(
        same_route, 4,
        "blog-index.json and cinque-terre/blog-index.json share /<lang>/blog"
    );
    let stray: Vec<_> = kb
        .pages
        .duplicates
        .iter()
        .filter_map(|d| match d.kind {
            DuplicateKind::StrayCopy { identical } => Some((d.paths[1].as_str(), identical)),
            _ => None,
        })
        .collect();
    assert_eq!(
        stray,
        vec![
            (
                "content/blog/5-hidden-gelaterias-you-need-to-try.json",
                false
            ),
            ("content/blog/day-trip-to-portovenere.json", true),
        ]
    );
}

#[test]
fn collections_in_both_shapes() {
    let kb = kb();
    let r = kb.collections.file("restaurants", "riomaggiore").unwrap();
    assert_eq!(r.shape, FileShape::Wrapped);
    assert_eq!(r.items.len(), 20);
    let h = kb.collections.file("hikes", "riomaggiore").unwrap();
    assert_eq!(h.shape, FileShape::Array);
    assert_eq!(h.items.len(), 14);
    let (_, item) = kb
        .collections
        .find_item("restaurants", "dau-cila", Some("riomaggiore"))
        .unwrap();
    assert!(item.name("en").is_some());
    assert_eq!(kb.collections.unnamed(), 0);
}

#[test]
fn resolve_link_is_closed_world() {
    let kb = kb();
    assert_eq!(
        kb.resolve_link("riomaggiore", "de").unwrap(),
        "/de/riomaggiore"
    );
    assert_eq!(
        kb.resolve_link("/riomaggiore/", "it").unwrap(),
        "/it/riomaggiore"
    );
    assert_eq!(
        kb.resolve_link("f078d913-1cbb-4b76-b294-4af999f13c8b", "fr")
            .unwrap(),
        "/fr/riomaggiore"
    );
    assert_eq!(
        kb.resolve_link("riomaggiore/restaurants", "en").unwrap(),
        "/en/riomaggiore/restaurants"
    );
    assert_eq!(
        kb.resolve_link(
            "https://cinqueterre.travel/en/blog/day-trip-to-portovenere/",
            "de"
        )
        .unwrap(),
        "/de/blog/day-trip-to-portovenere"
    );
    let missing = kb.resolve_link("/fr/transport", "en").unwrap_err();
    assert!(matches!(
        missing.reason,
        NeedsPageReason::MissingTranslation { .. }
    ));
    let nf = kb
        .resolve_link("/en/hikes/via-dell-amore", "en")
        .unwrap_err();
    assert_eq!(nf.reason, NeedsPageReason::NotFound);
    assert!(
        kb.resolve_link("via-dell-amore", "en").is_err(),
        "entity without a page"
    );
}

#[test]
fn find_link_targets_ranks_entity_pages() {
    let kb = kb();
    let c = kb.find_link_targets("Riomaggiore", "en", 5);
    assert_eq!(c[0].url, "/en/riomaggiore");
    assert!(c.iter().any(|c| c.url == "/en/riomaggiore/restaurants"));
    let blog = kb.find_link_targets("Portovenere day trip", "en", 3);
    assert_eq!(blog[0].url, "/en/blog/day-trip-to-portovenere");
    assert!(kb.find_link_targets("caribbean", "en", 3).is_empty());
}

#[test]
fn suggest_media_prefers_strict_entity_matches() {
    let kb = kb();
    let s = kb
        .suggest_media(Some("riomaggiore"), Some("sights"), Some("vibrant"), 5)
        .unwrap();
    assert_eq!(s[0].entry.id, "riomaggiore-hero-001");
    assert!(s.iter().take(3).all(|c| c.matched == MediaMatch::Strict));
    assert!(s.iter().skip(3).all(|c| c.matched != MediaMatch::Strict));
    // Strict block rules never offer another village's imagery.
    let hero = kb
        .suggest_media_for_block("hero", Some("manarola"), None, 0)
        .unwrap();
    assert!(hero
        .iter()
        .all(|c| ["manarola", "region"].contains(&c.entry.tags.village.as_str())));
    // beaches only exist for monterosso → corniglia's eat-drink block needs media.
    assert!(kb
        .suggest_media_for_block("eat-drink", Some("corniglia"), None, 3)
        .is_err());
}

#[test]
fn link_and_media_checks() {
    let kb = kb();
    let page = json!({
        "id": "t", "slug": {"en": "/en/t", "de": "/de/t"}, "title": {"en": "T"}, "page_type": "t",
        "body": [
            {"type": "closing-note", "title": "x", "content": "y", "actions": [
                {"label": "ok", "href": "/riomaggiore"},
                {"label": "ok", "href": {"en": "/en/blog/day-trip-to-portovenere", "de": "/de/nope"}},
                {"label": "bad", "href": "/en/invented"},
                {"label": "ext", "href": "https://example.com/x"},
                {"label": "anchor", "href": "#top"}
            ]},
            {"type": "collection-with-interludes", "collectionType": "restaurants", "village": "riomaggiore",
             "slugs": ["dau-cila", "invented-trattoria"]},
            {"type": "collection-embed", "collectionType": "agriturismi", "items": [{"slug": "x"}]},
            {"type": "blog-index", "stories": [{"slug": "day-trip-to-portovenere"}, {"slug": "never-written"}]},
            {"type": "image", "src": "media:riomaggiore-hero-001", "alt": "a"},
            {"type": "image", "src": "https://images.unsplash.com/photo-1534445867742-43195f401b6c?w=10", "alt": "b"},
            {"type": "image", "src": "media:invented", "alt": "c"},
            {"type": "image", "src": "https://cdn.example/x.jpg", "alt": "d"}
        ]
    });
    let links = kb.check_links(&page);
    let broken: Vec<_> = links
        .broken
        .iter()
        .map(|b| (b.kind, b.value.as_str()))
        .collect();
    assert_eq!(
        broken,
        vec![
            (RefKind::Href, "/de/nope"),
            (RefKind::Href, "/en/invented"),
            (RefKind::CollectionItem, "invented-trattoria"),
            (RefKind::Collection, "agriturismi"),
            (RefKind::PageSlug, "never-written"),
        ]
    );
    assert_eq!(links.external, 1);
    assert_eq!(links.broken[0].pointer, "/body/0/actions/1/href/de");
    let media = kb.check_media(&page);
    assert_eq!((media.checked, media.by_id, media.by_url), (4, 1, 1));
    let unknown: Vec<_> = media.unknown.iter().map(|m| m.value.as_str()).collect();
    assert_eq!(unknown, vec!["media:invented", "https://cdn.example/x.jpg"]);
}

#[test]
fn custom_blocks_from_the_site_repo() {
    let src = src();
    let mut registry = SchemaRegistry::core();
    assert_eq!(
        load_custom_blocks(&src, &mut registry).unwrap(),
        vec!["x:wine-map"]
    );
    let meta = registry.meta("x:wine-map").unwrap();
    assert_eq!(meta.intent, Intent::Orient);
    assert_eq!(meta.context, vec!["village"]);
    assert!(blocks_doc(&registry).contains("### `x:wine-map` — orient"));
    let page = json!({"id": "w", "slug": {"en": "/en/w"}, "title": "W", "page_type": "t", "body": [
        {"type": "x:wine-map", "village": "manarola", "wineries": [{"name": "Cantina", "image": "media:manarola-hero-001"}]}
    ]});
    let kb = kb();
    let check = kb.check_page(&page, Some(&registry));
    assert!(check.is_ok(), "{check:?}");
    let bad = json!({"id": "w", "slug": {"en": "/en/w"}, "title": "W", "page_type": "t", "body": [
        {"type": "x:wine-map", "wineries": [{"label": "no name"}]}
    ]});
    assert!(!validate_page_v2(&bad, &registry).is_ok());
}

#[test]
fn schema_v1_vs_v2_on_fixture_pages() {
    let src = src();
    let kb = kb();
    let registry = SchemaRegistry::core();
    let (mut v1, mut v2) = (0, 0);
    for p in &kb.pages.pages {
        let v = src.read_json(&p.path).unwrap().unwrap();
        v1 += usize::from(validate_page_v1(&v).is_ok());
        v2 += usize::from(validate_page_v2(&v, &registry).is_ok());
    }
    assert_eq!((v1, v2), (1, 2));
}

#[test]
fn audit_and_summary() {
    let src = src();
    let kb = kb();
    let audit = kb.audit(&src).unwrap();
    assert!(audit.links_checked > 40);
    assert!(audit.broken_by_kind[&RefKind::Href] > 0);
    assert_eq!(
        audit.media_checked,
        audit.media_by_id + audit.media_by_url + audit.unknown_media.len()
    );
    // ADR-0070: inbound links (page bodies and the navigation), orphans, article dates.
    assert_eq!(
        audit.inbound["content/pages/blog/day-trip-to-portovenere.json"],
        3
    );
    assert_eq!(
        audit.orphans,
        [
            "content/pages/blog/last-light-on-sentiero-azzurro.json",
            "content/pages/riomaggiore/restaurants.json",
            "content/pages/transport.json"
        ]
    );
    let dates: Vec<(&str, Option<&str>)> = audit
        .articles
        .iter()
        .map(|a| (a.path.as_str(), a.date.as_deref()))
        .collect();
    assert_eq!(
        dates,
        [
            (
                "content/pages/blog/5-hidden-gelaterias-you-need-to-try.json",
                Some("2025-01-05")
            ),
            (
                "content/pages/blog/day-trip-to-portovenere.json",
                Some("2026-01-25")
            ),
            (
                "content/pages/blog/last-light-on-sentiero-azzurro.json",
                Some("2026-05-12")
            )
        ]
    );
    assert!(
        audit.policy.is_empty(),
        "the mini site has no linking policy"
    );
    let summary = SiteSummary::new(&kb, Some(&audit)).to_string();
    assert!(summary.contains("pages: 9"));
    assert!(summary.contains("stray copies 2 (1 identical)"));
    assert!(summary.contains("restaurants: riomaggiore=20"));
}
