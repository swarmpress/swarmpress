//! The knowledge pack (ADR-0061, increment K1) against the `cinqueterre-mini`
//! fixture: a pack built from a checkout loads into a knowledge base that
//! answers like one built from the checkout itself, and its bytes are stable.

use std::collections::BTreeSet;
use std::path::PathBuf;

use knowledge::pack::{self, Pack, BLOG_INDEX_PATH, PACK_FILES};
use knowledge::{
    DirSource, DuplicateKind, KnowledgeBase, MediaCandidate, MediaIndex, MemSource, SiteSource,
};
use serde_json::{json, Value};

const COMMIT: &str = "3f2a9c1d5e7b4a6f8091a2b3c4d5e6f708192a3b";

fn src() -> DirSource {
    DirSource::new(
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/cinqueterre-mini"),
    )
}

fn ids(candidates: &[MediaCandidate<'_>]) -> Vec<String> {
    candidates.iter().map(|c| c.entry.id.clone()).collect()
}

/// Everything an article needs from a knowledge base, asked of both.
fn assert_same_answers(direct: &KnowledgeBase, loaded: &KnowledgeBase, src: &dyn SiteSource) {
    // Indexes.
    assert_eq!(loaded.manifest, direct.manifest);
    assert_eq!(loaded.entities.entities, direct.entities.entities);
    assert_eq!(loaded.entities.issues, direct.entities.issues);
    assert_eq!(
        serde_json::to_value(&loaded.media).unwrap(),
        serde_json::to_value(&direct.media).unwrap()
    );
    assert_eq!(loaded.media.len(), direct.media.len());
    assert_eq!(loaded.media.unique_urls(), direct.media.unique_urls());
    assert_eq!(loaded.pages.len(), direct.pages.len());
    assert_eq!(loaded.pages.pages, direct.pages.pages);
    assert_eq!(loaded.pages.count_by_lang(), direct.pages.count_by_lang());
    assert_eq!(loaded.pages.count_by_type(), direct.pages.count_by_type());
    let conflicts = |kb: &KnowledgeBase| -> Vec<_> {
        kb.pages
            .duplicates
            .iter()
            .filter(|d| !matches!(d.kind, DuplicateKind::StrayCopy { .. }))
            .cloned()
            .collect()
    };
    assert_eq!(conflicts(loaded), conflicts(direct));

    // Link resolution: every page by id, by route and by language-neutral
    // path, into every language, plus targets that do not exist.
    let langs: BTreeSet<String> = direct
        .manifest
        .languages
        .iter()
        .cloned()
        .chain(direct.pages.count_by_lang().into_keys())
        .collect();
    let mut targets: BTreeSet<String> = ["/en/invented", "invented", "/", "via-dell-amore"]
        .map(String::from)
        .into();
    for p in &direct.pages.pages {
        targets.insert(p.id.clone());
        for (lang, route) in &p.routes {
            targets.insert(route.clone());
            targets.insert(format!("https://cinqueterre.travel{route}/"));
            if let Some(neutral) = route.strip_prefix(&format!("/{lang}")) {
                targets.insert(neutral.to_string());
            }
        }
    }
    for e in &direct.entities.entities {
        targets.insert(e.slug.clone());
    }
    let mut resolved = 0;
    for t in &targets {
        for lang in &langs {
            let want = direct.resolve_link(t, lang);
            resolved += usize::from(want.is_ok());
            assert_eq!(loaded.resolve_link(t, lang), want, "{t} in {lang}");
        }
    }
    assert!(resolved > targets.len(), "{resolved} of {}", targets.len());
    for q in ["Riomaggiore", "Portovenere day trip", "gelato", "caribbean"] {
        for lang in &langs {
            assert_eq!(
                loaded.find_link_targets(q, lang, 8),
                direct.find_link_targets(q, lang, 8),
                "{q} in {lang}"
            );
        }
    }

    // Media resolution and suggestions.
    for e in &direct.media.entries {
        assert_eq!(loaded.resolve_media(&e.id), direct.resolve_media(&e.id));
        assert_eq!(
            loaded.media.by_url(&e.url).len(),
            direct.media.by_url(&e.url).len()
        );
    }
    assert_eq!(
        loaded.resolve_media("media:invented"),
        direct.resolve_media("media:invented")
    );
    let villages: BTreeSet<&str> = direct
        .media
        .entries
        .iter()
        .map(|e| e.tags.village.as_str())
        .collect();
    let categories: BTreeSet<&str> = direct
        .media
        .entries
        .iter()
        .map(|e| e.tags.category.as_str())
        .collect();
    for v in villages.iter().map(|v| Some(*v)).chain([None]) {
        for c in categories.iter().map(|c| Some(*c)).chain([None]) {
            for mood in [None, Some("vibrant")] {
                assert_eq!(
                    loaded.suggest_media(v, c, mood, 12),
                    direct.suggest_media(v, c, mood, 12),
                    "{v:?} {c:?} {mood:?}"
                );
            }
        }
    }

    // Page checks. Media is checked the same on every page; links the same on
    // every page that embeds no collection (the loaded base has no collection
    // index), which is every article.
    let mut articles = 0;
    for p in &direct.pages.pages {
        let page = src.read_json(&p.path).unwrap().unwrap();
        assert_eq!(
            loaded.check_media(&page),
            direct.check_media(&page),
            "{}",
            p.path
        );
        if !page.to_string().contains("\"collectionType\"") {
            articles += usize::from(p.path.starts_with("content/pages/blog/"));
            assert_eq!(
                loaded.check_links(&page),
                direct.check_links(&page),
                "{}",
                p.path
            );
        }
    }
    assert!(articles >= 3, "{articles} articles compared");
}

#[test]
fn pack_from_a_checkout_round_trips_to_an_equal_knowledge_base() {
    let src = src();
    let direct = KnowledgeBase::build(&src).unwrap();
    let pack = pack::build(&src, COMMIT).unwrap();
    // Through the wire format, as the browser receives it.
    let loaded = pack::load(&Pack::from_json(&pack.to_json().unwrap()).unwrap()).unwrap();

    assert_eq!(pack.commit, COMMIT);
    assert_eq!(loaded.label, format!("pack@{COMMIT}"));
    assert_eq!((loaded.pages.len(), loaded.media.len()), (9, 20));
    assert_same_answers(&direct, &loaded, &src);

    // An article as the orchestrator assembles it: known link and media pass,
    // invented ones are reported, identically on both sides.
    let article = json!({
        "id": "a", "page_type": "blog-article", "title": {"en": "A"},
        "slug": {"en": "/en/blog/a", "de": "/de/blog/a", "fr": "/fr/blog/a", "it": "/it/blog/a"},
        "seo": {"og_image": "media:riomaggiore-hero-001"},
        "body": [
            {"type": "hero", "title": "A", "image": "media:riomaggiore-hero-001"},
            {"type": "closing-note", "title": "x", "content": "y", "actions": [
                {"label": "village", "href": "/riomaggiore"},
                {"label": "post", "href": "/en/blog/day-trip-to-portovenere"},
                {"label": "invented", "href": "/en/blog/never-written"}
            ]},
            {"type": "image", "src": "https://cdn.example/invented.jpg", "alt": "x"}
        ]
    });
    let links = loaded.check_links(&article);
    assert_eq!(links, direct.check_links(&article));
    assert_eq!((links.checked, links.broken.len()), (3, 1));
    assert_eq!(links.broken[0].value, "/en/blog/never-written");
    let media = loaded.check_media(&article);
    assert_eq!(media, direct.check_media(&article));
    assert_eq!((media.by_id, media.unknown.len()), (2, 1));
}

#[test]
fn pack_carries_the_fixture_config_and_the_blog_index() {
    let src = src();
    let pack = pack::build(&src, COMMIT).unwrap();
    // The fixture has six of the eight config files (the style guide and the
    // writer prompt are the real site's, verbatim; the content calendar a few of
    // its topics, for the eval harness), and the blog index.
    assert_eq!(
        pack.files.keys().map(String::as_str).collect::<Vec<_>>(),
        vec![
            "content/config/content-calendar.json",
            "content/config/entity-index.json",
            "content/config/media-index.json",
            "content/config/sitemap-index.json",
            "content/config/style-guide.json",
            "content/config/writer-prompt.json",
            BLOG_INDEX_PATH,
        ]
    );
    for (path, text) in &pack.files {
        assert!(PACK_FILES.contains(&path.as_str()));
        assert_eq!(text.as_bytes(), src.read(path).unwrap().unwrap(), "{path}");
    }
    let blog = pack.file_json(BLOG_INDEX_PATH).unwrap().unwrap();
    assert_eq!(blog["slug"]["en"], "/en/blog");
    // No page body or collection item is shipped.
    let text = pack.to_json().unwrap();
    let v: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(
        v.as_object().unwrap().keys().collect::<Vec<_>>(),
        vec!["commit", "files", "manifest", "pages"]
    );
    assert!(v["pages"]
        .as_array()
        .unwrap()
        .iter()
        .all(|p| p.get("body").is_none()));
    assert!(!text.contains("dau-cila"), "a collection item leaked");
}

#[test]
fn building_twice_gives_byte_identical_packs() {
    let a = pack::build(&src(), COMMIT).unwrap().to_json().unwrap();
    let b = pack::build(&src(), COMMIT).unwrap().to_json().unwrap();
    assert_eq!(a.as_bytes(), b.as_bytes());

    // The same tree from another kind of source gives the same bytes: the
    // server builds from a repository snapshot, `cargo xtask site-pack` from
    // a clone.
    let dir = src();
    let mut mem = MemSource::new();
    for path in dir.list("content").unwrap().into_iter().rev() {
        mem.insert(path.clone(), dir.read(&path).unwrap().unwrap());
    }
    let c = pack::build(&mem, COMMIT).unwrap().to_json().unwrap();
    assert_eq!(a.as_bytes(), c.as_bytes());

    // Reserialising a parsed pack is stable too.
    let again = Pack::from_json(&a).unwrap().to_json().unwrap();
    assert_eq!(a.as_bytes(), again.as_bytes());
    // And the commit is the only thing that differs between commits of one tree.
    let other = pack::build(&src(), "other").unwrap().to_json().unwrap();
    assert_eq!(other.replacen("other", COMMIT, 1), a);
}

/// `suggest_media` is a total order: score descending, then id ascending.
/// The hero shortlist (`M1..M6`) is cut from it, so the order is pinned.
#[test]
fn suggest_media_order_is_pinned() {
    let kb = KnowledgeBase::build(&src()).unwrap();
    let got = kb
        .suggest_media(Some("riomaggiore"), Some("sights"), Some("vibrant"), 12)
        .unwrap();
    let scored: Vec<(&str, u32)> = got.iter().map(|c| (c.entry.id.as_str(), c.score)).collect();
    assert_eq!(
        scored,
        vec![
            ("riomaggiore-hero-001", 3117),
            ("riomaggiore-image-15063772", 3102),
            ("riomaggiore-image-15339297", 3102),
            ("region-image-15154447", 2108),
            ("region-image-15660737", 2107),
            ("region-image-14985031", 2104),
            ("region-image-14996783", 2100),
            ("region-image-15344476", 2100),
            ("corniglia-hero-001", 1108),
            ("corniglia-hero-15292608", 1108),
            ("corniglia-leadstory-001", 1108),
            ("manarola-image-15660501", 1108),
        ],
        "equal scores are ordered by id"
    );
    for pair in got.windows(2) {
        assert!(
            pair[0].score > pair[1].score
                || (pair[0].score == pair[1].score && pair[0].entry.id < pair[1].entry.id),
            "{} ({}) before {} ({})",
            pair[0].entry.id,
            pair[0].score,
            pair[1].entry.id,
            pair[1].score
        );
    }

    // The order does not depend on the order of the index file.
    let reversed = MediaIndex::from_entries(kb.media.entries.iter().rev().cloned());
    let query = knowledge::MediaQuery {
        entity: Some("riomaggiore"),
        category: Some("sights"),
        mood: Some("vibrant"),
        entity_match: Some(content_model::EntityMatch::Category),
        limit: 12,
    };
    assert_eq!(ids(&reversed.suggest(&query).unwrap()), ids(&got));

    // Nor on how the base was built.
    let loaded = pack::load(&pack::build(&src(), COMMIT).unwrap()).unwrap();
    let again = loaded
        .suggest_media(Some("riomaggiore"), Some("sights"), Some("vibrant"), 12)
        .unwrap();
    assert_eq!(again, got);
}

/// The real cinqueterre.travel checkout. Ignored by default, like
/// `tests/real_repo.rs`; `CINQUETERRE_REPO` overrides the path:
/// `CINQUETERRE_REPO=<clone> cargo test -p knowledge --test pack -- --ignored --nocapture`.
#[test]
#[ignore = "needs the cinqueterre.travel checkout (CINQUETERRE_REPO, default /home/user/cinqueterre.travel)"]
fn pack_from_the_real_site() {
    let root = std::env::var("CINQUETERRE_REPO")
        .unwrap_or_else(|_| "/home/user/cinqueterre.travel".into());
    assert!(
        std::path::Path::new(&root).join("content/pages").is_dir(),
        "no site checkout at {root}"
    );
    let src = DirSource::new(&root);
    let direct = KnowledgeBase::build(&src).unwrap();
    let pack = pack::build(&src, COMMIT).unwrap();
    let text = pack.to_json().unwrap();
    let loaded = pack::load(&Pack::from_json(&text).unwrap()).unwrap();

    assert_eq!(loaded.media.len(), 338);
    assert_eq!(loaded.pages.len(), 157);
    assert_eq!(pack.pages.len(), 157);
    assert_eq!(
        pack.files
            .keys()
            .map(String::as_str)
            .collect::<BTreeSet<_>>(),
        BTreeSet::from(PACK_FILES),
        "the real site has all nine carried files"
    );
    assert_same_answers(&direct, &loaded, &src);
    assert_eq!(
        text.as_bytes(),
        pack::build(&src, COMMIT)
            .unwrap()
            .to_json()
            .unwrap()
            .as_bytes()
    );
    let config: usize = pack.files.values().map(String::len).sum();
    println!(
        "pack: {} bytes ({} files, {config} bytes of file text; {} pages)",
        text.len(),
        pack.files.len(),
        pack.pages.len()
    );
}
