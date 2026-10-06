//! Page types in the closed world (FEAT-089, ADR-0072): a page's `page_type`
//! must be a type the site declares (the core registry and
//! `content/config/page-types.json`) or already uses, and the knowledge pack
//! carries the site's registry so a browser answers the same.

use std::path::PathBuf;

use knowledge::{pack, ClosedWorldKind, DirSource, KnowledgeBase, MemSource, SiteSource};
use serde_json::{json, Value};

fn mini() -> DirSource {
    DirSource::new(
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/cinqueterre-mini"),
    )
}

fn page(page_type: &str) -> Value {
    json!({
        "id": "p1",
        "slug": { "en": "/en/x" },
        "title": { "en": "X" },
        "page_type": page_type,
        "body": []
    })
}

fn kinds(kb: &KnowledgeBase, page_type: &str) -> Vec<ClosedWorldKind> {
    kb.closed_world_issues(&page(page_type))
        .into_iter()
        .map(|i| i.kind)
        .collect()
}

#[test]
fn the_fixture_site_knows_the_core_types_and_the_ones_it_uses() {
    let kb = KnowledgeBase::build(&mini()).unwrap();
    assert_eq!(
        kb.page_type_names().into_iter().collect::<Vec<_>>(),
        [
            "article",
            "blog-article",
            "blog-index",
            "blog-post",
            "city",
            "info",
            "language_root",
            "restaurants"
        ]
    );
    for known in ["blog-article", "blog-post", "city", "restaurants"] {
        assert!(kinds(&kb, known).is_empty(), "{known}");
    }
    let issue = kb.check_page_type(&page("villages")).unwrap();
    assert_eq!(issue.kind, ClosedWorldKind::PageType);
    assert_eq!(issue.kind.code(), "page_type");
    assert_eq!(issue.pointer, "/page_type");
    assert!(
        issue.message.starts_with(
            "\"villages\" is not a page type of the site (known: article, blog-article"
        ),
        "{}",
        issue.message
    );
    // The page type is reported before links and media.
    let mut p = page("villages");
    p["body"] = json!([{ "type": "image", "src": "media:nope", "alt": "x" }]);
    let all: Vec<_> = kb
        .closed_world_issues(&p)
        .into_iter()
        .map(|i| i.kind)
        .collect();
    assert_eq!(all.first(), Some(&ClosedWorldKind::PageType));
    // No page type at all is the schema's to report.
    assert!(kb.check_page_type(&json!({ "body": [] })).is_none());
}

fn with_registry(registry: &Value) -> MemSource {
    let mut src = MemSource::new();
    src.insert_json(content_model::SITE_PAGE_TYPES_PATH, registry);
    src
}

#[test]
fn a_site_declares_its_own_types_and_the_pack_carries_them() {
    let registry = json!({
        "format": "swarmpress.page-types.v1",
        "page_types": [{
            "id": "village",
            "label": { "en": "Village" },
            "slots": [{ "id": "intro", "blocks": ["village-intro"], "min": 1, "max": 1 }]
        }]
    });
    let src = with_registry(&registry);
    let kb = KnowledgeBase::build(&src).unwrap();
    assert!(kinds(&kb, "village").is_empty());
    assert_eq!(kinds(&kb, "town"), [ClosedWorldKind::PageType]);
    let village = kb.page_types.get("village").unwrap();
    assert_eq!(
        village.check_body(&[json!({ "type": "village-intro" })]),
        []
    );

    let pack = pack::build(&src, "c0ffee").unwrap();
    assert!(pack.files.contains_key(content_model::SITE_PAGE_TYPES_PATH));
    let loaded = pack::load(&pack).unwrap();
    assert_eq!(loaded.page_types, kb.page_types);
    assert_eq!(kinds(&loaded, "town"), [ClosedWorldKind::PageType]);
    assert!(src.exists(content_model::SITE_PAGE_TYPES_PATH).unwrap());
}

#[test]
fn a_broken_registry_fails_the_build_with_its_path() {
    for bad in [
        json!({ "format": "swarmpress.page-types.v1", "page_types": [{ "id": "village" }] }),
        // Shadows the core article type.
        json!({ "format": "swarmpress.page-types.v1", "page_types": [
            { "id": "post", "label": { "en": "Post" }, "aliases": ["blog-article"] }
        ] }),
    ] {
        let err = KnowledgeBase::build(&with_registry(&bad))
            .unwrap_err()
            .to_string();
        assert!(err.starts_with("content/config/page-types.json: "), "{err}");
    }
}
