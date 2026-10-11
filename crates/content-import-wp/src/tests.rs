use std::collections::BTreeMap;

use serde_json::json;

use crate::compare::{compare, coverage, decode, site_path, Facts, CONTENT_PERMILLE};
use crate::markup::{self, Notes};
use crate::plan::plan;
use crate::routes::{routes, Source};
use crate::{localized, Site};

/// A small site in the live site's shapes: a hub, a village's own section, a page at its own
/// slug, a blog article, a collection.
fn site() -> Site {
    let mut s = Site {
        site: json!({
            "name": "Coast",
            "description": "Five villages",
            "navigation": {"main": [
                {"title": {"en": "Villages", "de": "Dörfer"}, "url": "/villages", "children": [
                    {"title": {"en": "Vernazza"}, "url": "/vernazza"}
                ]}
            ]}
        }),
        ..Site::default()
    };
    s.pages.insert(
        "index.json".into(),
        json!({"title": {"en": "Home"}, "seo": {"title": {"en": "Coast Dispatch | Travel"}}, "body": [{"type": "hero-section"}]}),
    );
    s.pages.insert(
        "sights.json".into(),
        json!({"title": {"en": "Sights", "de": "Sehenswürdigkeiten"}, "body": [
            {"type": "editorial-hero", "title": {"en": "Stone<br/>and Sea", "de": "Stein<br/>und Meer"}, "badge": {"en": "UNESCO"}, "image": "https://img.example/hero.jpg"}
        ]}),
    );
    s.pages.insert(
        "vernazza/restaurants.json".into(),
        json!({"title": {"en": "Eating in Vernazza"}, "seo": {"description": {"en": "Where to eat."}}, "body": [
            {"type": "editorial-intro", "quote": {"en": "Fish, **always**."}, "author": "Giulia", "content": {"en": ["One.", "Two [map](/maps)."]}},
            {"type": "faq-section", "title": {"en": "FAQ"}, "faqs": [{"question": {"en": "Book?"}, "answer": {"en": "Yes."}}]},
            {"type": "collection-embed", "collectionType": "restaurants", "heading": {"en": "Featured"}}
        ]}),
    );
    s.pages.insert(
        "transportation.json".into(),
        json!({"slug": {"en": "/en/transportation", "de": "/de/anreise"}, "title": {"en": "Getting here"}, "body": []}),
    );
    s.pages.insert(
        "blog/gelato.json".into(),
        json!({"slug": {"en": "/en/blog/gelato", "de": "/de/blog/gelato", "fr": "/fr/blog/gelato", "it": "/it/blog/gelato"},
               "page_type": "blog-article", "title": {"en": "Gelato"}, "created_at": "2023-10-14T12:00:00.000Z", "body": [
            {"type": "blog-article", "post": {"title": "Gelato", "author": "Marco", "category": "Food", "tags": ["Gelato", "Summer"]},
             "content": {"intro": "Cold and good.", "closing": {"text": "Read more", "url": "/blog"}}}
        ]}),
    );
    s.pages.insert(
        "village.json".into(),
        json!({"title": {"en": "The village"}, "body": [{"type": "village-intro"}]}),
    );
    s.villages.insert(
        "vernazza".into(),
        json!({"seo": {"title": {"en": "Vernazza | Coast"}}, "hero": {"title": "Vernazza", "imageAlt": "The harbour", "image": "https://img.example/v.jpg", "primaryCta": {"label": "Explore", "href": "#villages"}},
               "intro": {"leadStory": {"title": "Where history meets the sea"}, "essentials": {"today": {"sunset": "20:48"}}}}),
    );
    s.collections.insert(
        "restaurants".into(),
        vec![
            json!({"village": "vernazza", "items": [{"name": {"en": "Gambero Rosso"}, "details": {"atmosphere": {"en": "On the harbour."}}}]}),
            json!({"village": "manarola", "items": [{"name": {"en": "Elsewhere"}}]}),
        ],
    );
    s
}

#[test]
fn localized_falls_back_to_english() {
    let v = json!({"en": "Hello", "de": "Hallo"});
    assert_eq!(localized(&v, "de"), Some("Hallo"));
    assert_eq!(localized(&v, "fr"), Some("Hello"));
    assert_eq!(localized(&json!("plain"), "it"), Some("plain"));
    assert_eq!(localized(&json!({"id": 1, "to": "x"}), "en"), None);
}

#[test]
fn routes_follow_the_frozen_themes_precedence() {
    let r = routes(&site());
    let at = |p: &str| r.iter().find(|x| x.path == p).map(|x| x.source.clone());
    // Hubs in every language, the English home at `/`.
    assert_eq!(
        at("/de/sights/"),
        Some(Source::Page {
            path: "sights.json".into()
        })
    );
    assert_eq!(
        at("/"),
        Some(Source::Page {
            path: "index.json".into()
        })
    );
    // A village's own section; a section falling back to its hub; a section with neither.
    assert_eq!(
        at("/en/vernazza/restaurants/"),
        Some(Source::Page {
            path: "vernazza/restaurants.json".into()
        })
    );
    assert_eq!(
        at("/en/manarola/sights/"),
        Some(Source::Page {
            path: "sights.json".into()
        })
    );
    assert!(matches!(
        at("/fr/corniglia/maps/"),
        Some(Source::Empty { .. })
    ));
    // A village with no overview renders the village template, or nothing when there is none.
    assert!(at("/en/vernazza/").is_some());
    // A page at its own slug in each language (a blog article is a page in `pages/blog/`).
    assert_eq!(
        at("/de/anreise/"),
        Some(Source::Page {
            path: "transportation.json".into()
        })
    );
    assert_eq!(
        at("/it/blog/gelato/"),
        Some(Source::Page {
            path: "blog/gelato.json".into()
        })
    );
    // The hub wins over a slug of the same path.
    assert_eq!(
        at("/en/transportation/"),
        Some(Source::Page {
            path: "transportation.json".into()
        })
    );
    // 5 villages × 16 sections + 5 villages, per language, plus hubs, the article, `/` and anreise.
    let per_lang = 5 * 16 + 5 + 4 + 1;
    assert_eq!(
        r.len(),
        4 * per_lang + 1 + 1,
        "{:?}",
        r.iter().map(|x| &x.path).collect::<Vec<_>>()
    );
}

#[test]
fn a_block_keeps_every_string_as_core_blocks() {
    let mut notes = Notes::default();
    let b = json!({"type": "editorial-hero", "title": {"en": "Stone<br/>and Sea", "de": "Stein<br/>und Meer"}, "badge": {"en": "UNESCO"}, "image": "https://img.example/hero.jpg", "variant": "dark"});
    let de = markup::block(&b, "de", &mut notes);
    assert!(
        de.starts_with("<!-- wp:group {\"className\":\"ct-editorial-hero\""),
        "{de}"
    );
    assert!(
        de.contains("<h2 class=\"wp-block-heading\">Stein<br>und Meer</h2>"),
        "{de}"
    );
    assert!(de.contains("<p class=\"ct-badge\">UNESCO</p>"), "{de}");
    assert!(
        de.contains("<img src=\"https://img.example/hero.jpg\" alt=\"\"/>"),
        "{de}"
    );
    assert!(!de.contains("dark"), "presentation is left out: {de}");

    let intro = json!({"type": "editorial-intro", "quote": {"en": "Fish, **always**."}, "author": "Giulia", "content": {"en": ["One & two.", "See [the map](/maps)."]}, "callouts": {"en": ["Early", "Late"]}});
    let en = markup::block(&intro, "fr", &mut notes);
    assert!(en.contains("<blockquote class=\"wp-block-quote\"><!-- wp:paragraph -->\n<p>Fish, <strong>always</strong>.</p>"), "{en}");
    assert!(en.contains("<cite>Giulia</cite>"), "{en}");
    assert!(en.contains("<p>One &amp; two.</p>"), "{en}");
    assert!(en.contains("<a href=\"/fr/maps/\">the map</a>"), "{en}");
    assert!(
        en.contains("<ul class=\"wp-block-list\"><!-- wp:list-item -->\n<li>Early</li>"),
        "{en}"
    );

    let faq = json!({"type": "faq-section", "faqs": [{"question": {"en": "Book?"}, "answer": {"en": "Yes.\n\nEarly."}}]});
    let f = markup::block(&faq, "en", &mut notes);
    assert!(f.contains("<details class=\"wp-block-details\"><summary>Book?</summary><!-- wp:paragraph -->\n<p>Yes.</p>"), "{f}");

    let cta = json!({"type": "closing-note", "buttons": [{"text": {"en": "Plan", "de": "Planen"}, "url": "/itinerary", "variant": "primary"}]});
    let c = markup::block(&cta, "de", &mut notes);
    assert!(c.contains("href=\"/de/itinerary/\">Planen</a>"), "{c}");

    let index = json!({"type": "blog-index", "stories": [{"id": 1, "slug": "gelato", "title": "Gelato", "excerpt": "Cold."}]});
    let i = markup::block(&index, "de", &mut notes);
    assert!(
        i.contains("<h3 class=\"wp-block-heading\"><a href=\"/de/blog/gelato/\">Gelato</a></h3>"),
        "{i}"
    );

    assert!(notes.empty_blocks.is_empty());
    markup::block(&json!({"type": "hero-section"}), "en", &mut notes);
    assert_eq!(notes.empty_blocks, vec!["hero-section".to_string()]);
}

#[test]
fn site_links_take_the_pages_language() {
    assert_eq!(markup::link("/itinerary", "de"), "/de/itinerary/");
    assert_eq!(markup::link("/en/vernazza", "de"), "/en/vernazza/");
    assert_eq!(markup::link("/maps#top", "fr"), "/fr/maps/#top");
    assert_eq!(markup::link("/giulia.png", "fr"), "/giulia.png");
    assert_eq!(
        markup::link("https://x.example/a", "fr"),
        "https://x.example/a"
    );
}

#[test]
fn the_plan_has_one_document_per_url_with_its_route_as_meta() {
    let p = plan(&site());
    assert_eq!(p.title, "Coast Dispatch");
    assert_eq!(p.docs.len(), routes(&site()).len());
    let d = p
        .docs
        .iter()
        .find(|d| d.route == "/en/vernazza/restaurants/")
        .unwrap();
    assert_eq!(d.post_type, "page");
    assert_eq!(d.title, "Eating in Vernazza");
    assert_eq!(d.meta["_swarmpress_route"], "/en/vernazza/restaurants/");
    assert_eq!(d.meta["_swarmpress_seo_description"], "Where to eat.");
    // No SEO title: the document title is the page's own.
    assert_eq!(d.meta["_swarmpress_seo_title"], "Eating in Vernazza");
    assert_eq!(
        d.meta["_swarmpress_source"],
        "pages/vernazza/restaurants.json"
    );
    // The village's collection items only.
    assert!(
        d.content.contains("Gambero Rosso") && d.content.contains("On the harbour."),
        "{}",
        d.content
    );
    assert!(!d.content.contains("Elsewhere"));
    // A hub standing in for a village section names the village.
    let hub = p
        .docs
        .iter()
        .find(|d| d.route == "/de/manarola/sights/")
        .unwrap();
    assert_eq!(hub.title, "Sehenswürdigkeiten · Manarola");
    // A blog article is a post with its category, tags, byline and date.
    let post = p
        .docs
        .iter()
        .find(|d| d.route == "/de/blog/gelato/")
        .unwrap();
    assert_eq!(post.post_type, "post");
    assert_eq!(post.slug, "gelato-de");
    assert_eq!(post.category.as_deref(), Some("Food"));
    assert_eq!(post.tags, vec!["Gelato", "Summer"]);
    assert_eq!(post.meta["_swarmpress_byline"], "Marco");
    assert_eq!(post.date.as_deref(), Some("2023-10-14T12:00:00"));
    assert!(
        post.content.contains("href=\"/de/blog/\">Read more</a>"),
        "{}",
        post.content
    );
    // What the import cannot carry is reported.
    assert_eq!(p.report.empty_blocks.get("hero-section"), Some(&5));
    assert!(p
        .report
        .empty_routes
        .contains(&"/fr/corniglia/maps/".to_string()));
    // A village's intro is the village's own content, with its SEO; another village has none.
    let v = p.docs.iter().find(|d| d.route == "/en/vernazza/").unwrap();
    assert!(
        v.content.contains("Where history meets the sea")
            && v.content.contains("alt=\"The harbour\""),
        "{}",
        v.content
    );
    assert!(
        v.content.contains("href=\"#villages\">Explore</a>"),
        "{}",
        v.content
    );
    assert!(
        v.content
            .contains("<span class=\"ct-meta-key\">Sunset</span> 20:48"),
        "{}",
        v.content
    );
    assert_eq!(v.meta["_swarmpress_seo_title"], "Vernazza | Coast");
    // The template stands in at /{lang}/village/ and for the four other villages, index and overview.
    assert_eq!(
        p.report.empty_blocks.get("village-intro"),
        Some(&(4 + 4 * 4 + 4 * 4))
    );
    // The menus, one per language, links in that language.
    assert_eq!(p.menus["de"][0].label, "Dörfer");
    assert_eq!(p.menus["de"][0].url, "/de/villages/");
    assert_eq!(p.menus["de"][0].children[0].url, "/de/vernazza/");
}

#[test]
fn facts_read_the_main_content_title_and_site_links() {
    let html = r#"<!doctype html><html><head><title> Vernazza &amp; More </title>
        <meta name="description" content="The jewel."></head><body>
        <header><a href="/en/">Home</a></header>
        <main class="x"><h1>Vernazza</h1><!-- the hero --><script>var a = "<p>no</p>";</script>[object Object]
        <p>Tower &#8217;s view, <a href="https://coast.example/en/maps?x=1#y">maps</a> and
        <a href="/en/blog/gelato">gelato</a>, <a href="https://elsewhere.example/">out</a>.</p>
        <nav><a href="/en/footer-nav/">n</a></nav></main><footer>Footer text</footer></body></html>"#;
    let f = Facts::from_html(200, html, "https://coast.example");
    assert_eq!(f.title, "Vernazza & More");
    assert_eq!(f.description, "The jewel.");
    assert_eq!(f.text, "Vernazza\nTower 's view, maps and gelato , out .");
    assert_eq!(
        f.links.iter().map(String::as_str).collect::<Vec<_>>(),
        vec!["/en/blog/gelato/", "/en/footer-nav/", "/en/maps/"]
    );
    assert_eq!(
        site_path("/giulia.png", "https://coast.example").as_deref(),
        Some("/giulia.png")
    );
    assert_eq!(decode("&lt;b&gt; &#x41; &unknown;"), "<b> A &unknown;");
}

#[test]
fn the_comparison_passes_a_page_with_its_content_and_links() {
    let live_text = "The harbour of Vernazza is the only natural harbour of the five villages";
    let page = |status: u16, text: &str, links: &[&str]| Facts {
        status,
        title: "Vernazza".into(),
        text: text.into(),
        links: links.iter().map(|s| s.to_string()).collect(),
        ..Facts::default()
    };
    let live: BTreeMap<String, Facts> = [
        (
            "/en/vernazza/".to_string(),
            page(200, live_text, &["/en/maps/"]),
        ),
        ("/en/gone/".to_string(), page(200, "Something", &[])),
        ("/en/thin/".to_string(), page(200, live_text, &[])),
    ]
    .into();
    let export: BTreeMap<String, Facts> = [
        (
            "/en/vernazza/".to_string(),
            page(
                200,
                &format!("Intro. {live_text}. More."),
                &["/en/maps/", "/en/x/"],
            ),
        ),
        (
            "/en/thin/".to_string(),
            page(200, "The harbour of Vernazza", &[]),
        ),
        ("/en/new/".to_string(), page(200, "New", &[])),
    ]
    .into();
    let r = compare(&live, &export);
    let at = |p: &str| r.urls.iter().find(|u| u.path == p).unwrap();
    assert!(at("/en/vernazza/").pass, "{:?}", at("/en/vernazza/"));
    assert_eq!(at("/en/vernazza/").content_permille, 1000);
    assert!(!at("/en/gone/").pass);
    assert_eq!(at("/en/gone/").export_status, 404);
    assert!(at("/en/thin/").content_permille < CONTENT_PERMILLE);
    assert_eq!(r.summary.passed, 1);
    assert_eq!(r.summary.extra_in_export, vec!["/en/new/".to_string()]);
    assert_eq!(coverage("", "anything"), 1000);
}

/// The live site's content, when this checkout has it (`cinqueterre.travel/`, a repo of its own):
/// every page reads, routes and maps.
#[test]
fn the_live_sites_content_plans() {
    let dir =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../cinqueterre.travel/content");
    if !dir.is_dir() {
        eprintln!("skipped: {} is not checked out", dir.display());
        return;
    }
    let site = Site::read(&dir).unwrap();
    let p = plan(&site);
    assert!(p.docs.len() > 600, "{}", p.docs.len());
    for d in &p.docs {
        assert!(
            !d.title.is_empty() || d.route == "/",
            "{} has no title",
            d.route
        );
        assert!(d.meta["_swarmpress_route"] == d.route);
    }
}

#[test]
fn the_themes_chrome_and_the_live_sites_broken_links_are_not_required() {
    let page = |text: &str, links: &[&str]| Facts {
        status: 200,
        text: text.into(),
        links: links.iter().map(|s| s.to_string()).collect(),
        ..Facts::default()
    };
    let footer = "Subscribe to the dispatch for slow travel news";
    let live: BTreeMap<String, Facts> = (0..5)
        .map(|i| {
            let text =
                format!("Page {i} talks about village number {i} and its harbour stones. {footer}");
            (
                format!("/en/p{i}/"),
                page(&text, &["/en/about/", "/en/p0/", "/itinerary/"]),
            )
        })
        .chain([("/en/about/".to_string(), page("About us", &[]))])
        .collect();
    // The export has each page's own text and links, but a footer and menu of its own.
    let export: BTreeMap<String, Facts> = live
        .iter()
        .map(|(p, f)| {
            let own = f.text.replace(footer, "Our newsletter");
            (p.clone(), page(&own, &["/en/p0/", "/en/itinerary/"]))
        })
        .collect();
    let r = compare(&live, &export);
    // The footer's trigrams and the menu link to /en/about/ are on every page: the theme's.
    assert!(r.urls.iter().all(|u| u.pass), "{:?}", r.urls);
    assert!(r.summary.chrome_trigrams > 0);
    // `/itinerary/` is not a live page: the live site's broken link, which the import fixed.
    assert_eq!(
        r.summary.live_broken_links, 0,
        "a link on every page is chrome, not counted"
    );
}
