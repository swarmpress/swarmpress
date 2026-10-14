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
               "page_type": "blog-article", "title": {"en": "Gelato | The Dispatch"}, "created_at": "2023-10-14T12:00:00.000Z", "body": [
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
    // Each field's paragraphs carry its class, so a theme can place it.
    assert!(
        en.contains("<p class=\"ct-content\">One &amp; two.</p>"),
        "{en}"
    );
    assert!(en.contains("<a href=\"/fr/maps/\">the map</a>"), "{en}");
    assert!(
        en.contains(
            "<ul class=\"wp-block-list ct-callouts\"><!-- wp:list-item -->\n<li>Early</li>"
        ),
        "{en}"
    );

    // The HTML a source string carries (the live site renders it): its paragraphs and inline tags.
    let html = json!({"type": "editorial-intro", "leftContent": {"en": "<p>Trains every <strong>15 minutes</strong>.</p><p>See <a href=\"/maps\">the map</a> <script>x</script></p>"}});
    let h = markup::block(&html, "de", &mut notes);
    assert!(
        h.contains("<p class=\"ct-left-content\">Trains every <strong>15 minutes</strong>.</p>"),
        "{h}"
    );
    assert!(
        h.contains("See <a href=\"/de/maps/\">the map</a> &lt;script&gt;"),
        "{h}"
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

    let team = json!({"type": "team-grid", "editors": [{"name": "Giulia", "persona": "Early mornings on the rocks.", "love": "Rain."}]});
    let t = markup::block(&team, "en", &mut notes);
    assert!(
        t.contains("<p class=\"ct-persona\">Early mornings on the rocks.</p>"),
        "{t}"
    );
    let byline = json!({"type": "quote", "quote": "Fish.", "persona": "giulia"});
    let q = markup::block(&byline, "en", &mut notes);
    assert!(!q.contains("giulia"), "an editor's id is left out: {q}");

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
    // A blog article is a post with its category, tags, byline and date; its heading is the
    // article's own title, its document title the page's.
    let post = p
        .docs
        .iter()
        .find(|d| d.route == "/de/blog/gelato/")
        .unwrap();
    assert_eq!(post.post_type, "post");
    assert_eq!(post.title, "Gelato");
    assert_eq!(post.meta["_swarmpress_seo_title"], "Gelato | The Dispatch");
    assert_eq!(post.slug, "gelato-de");
    assert_eq!(post.category.as_deref(), Some("Food"));
    // Its language is a tag too: the home lists the stories in its own language.
    assert_eq!(post.tags, vec!["Gelato", "Summer", "Deutsch"]);
    assert_eq!(post.meta["_swarmpress_byline"], "Marco");
    assert_eq!(post.date.as_deref(), Some("2023-10-14T12:00:00"));
    assert!(
        post.content.contains("href=\"/de/blog/\">Read more</a>"),
        "{}",
        post.content
    );
    // What the import cannot carry is reported; the home's sections are composed, not carried.
    assert_eq!(p.report.empty_blocks.get("hero-section"), None);
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
    // The template stands in for the four other villages, index and overview; at
    // /{lang}/village/ the village overview is composed.
    assert_eq!(
        p.report.empty_blocks.get("village-intro"),
        Some(&(4 * 4 + 4 * 4))
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
    // The site gets its own theme, and every link of its menus is a page the plan publishes.
    assert_eq!(p.theme, crate::plan::CINQUETERRE_THEME);
    let routes: std::collections::BTreeSet<&str> =
        p.docs.iter().map(|d| d.route.as_str()).collect();
    let mut links = Vec::new();
    for items in p
        .menus
        .values()
        .chain(p.named_menus.values().flat_map(|m| m.values()))
    {
        for i in items {
            links.push(i.url.clone());
            links.extend(i.children.iter().map(|c| c.url.clone()));
        }
    }
    assert!(links.len() > 4 * (5 * 11 + 1 + 1 + 18), "{}", links.len());
    for l in links.iter().filter(|l| !l.is_empty()) {
        let path = l.split('#').next().unwrap();
        assert!(routes.contains(path), "{l} is not a page of the site");
    }
    // The home's picks and stays come from its content.
    for lang in crate::LANGS {
        assert_eq!(
            crate::compose::editors_picks(&site, lang).len(),
            crate::compose::PICKS
        );
        assert_eq!(
            crate::compose::places_to_stay(&site, lang).len(),
            crate::compose::STAYS
        );
        for pick in crate::compose::editors_picks(&site, lang) {
            assert!(routes.contains(pick.href.as_str()), "{}", pick.href);
        }
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

fn doc_at<'a>(p: &'a crate::plan::Plan, route: &str) -> &'a crate::plan::Doc {
    p.docs
        .iter()
        .find(|d| d.route == route)
        .unwrap_or_else(|| panic!("no {route}"))
}

/// The owner's decisions of 2026-10-12: the home is composed (the villages, the latest stories in
/// its language as a query block, the newsletter form), and so is the village overview. The
/// newsletter only with the option (2026-10-13: hidden until a form endpoint answers it).
#[test]
fn the_home_and_the_village_overview_are_composed() {
    let p = crate::plan::plan_with(
        &site(),
        crate::compose::Options {
            newsletter: true,
            ..Default::default()
        },
    );
    for (route, lang, tag) in [("/", "en", "English"), ("/de/", "de", "Deutsch")] {
        let home = doc_at(&p, route);
        let c = &home.content;
        // The site's name as the page's heading, the villages linking their pages.
        assert!(
            c.contains("<h1 class=\"wp-block-heading\">Coast Dispatch</h1>"),
            "{c}"
        );
        assert!(
            c.contains(&format!("<a href=\"/{lang}/vernazza/\">Vernazza</a>")),
            "{c}"
        );
        assert!(
            c.contains(&format!("<a href=\"/{lang}/monterosso/\">")),
            "{c}"
        );
        // Vernazza's own hero image and line.
        assert!(c.contains("alt=\"The harbour\""), "{c}");
        // The latest stories: a query of the posts tagged with the page's language.
        assert!(c.contains("<!-- wp:query "), "{c}");
        assert!(
            c.contains(&format!(
                "\"post_tag\":[\"swarmpress-term:post_tag:{tag}\"]"
            )),
            "{c}"
        );
        assert!(c.contains(&format!("<a href=\"/{lang}/blog/\">")), "{c}");
        // The newsletter form posts to WordPress's admin-post.php; the export sends it to /f/.
        assert!(c.contains("action=\"/wp-admin/admin-post.php\""), "{c}");
        assert!(c.contains("type=\"email\" name=\"email\" required"), "{c}");
        assert!(
            c.contains(&format!("name=\"lang\" value=\"{lang}\"")),
            "{c}"
        );
        // The theme's empty sections are gone.
        assert!(!c.contains("ct-hero-section"), "{c}");
    }
    let villages = doc_at(&p, "/fr/village/");
    assert_eq!(villages.title, "Les cinq villages");
    assert_eq!(
        villages.meta["_swarmpress_seo_title"],
        "Les cinq villages | Coast Dispatch"
    );
    for v in [
        "riomaggiore",
        "manarola",
        "corniglia",
        "vernazza",
        "monterosso",
    ] {
        assert!(
            villages.content.contains(&format!("href=\"/fr/{v}/\"")),
            "{v}: {}",
            villages.content
        );
        assert!(villages
            .content
            .contains(&format!("href=\"/fr/{v}/weather/\">Météo</a>")));
    }
    assert!(!villages.content.contains("ct-village-intro"));
    // Only /{lang}/village/ is the overview: a village still has its own intro.
    assert!(doc_at(&p, "/en/vernazza/")
        .content
        .contains("Where history meets the sea"));
}

/// The weather pages: the sample forecast is not content; a live forecast block takes its place,
/// the five villages on a general page, the village itself on its own weather page.
#[test]
fn weather_pages_carry_a_live_forecast_block_instead_of_sample_data() {
    let mut s = site();
    s.pages.insert(
        "weather.json".into(),
        json!({"slug": {"en": "/en/weather", "de": "/de/wetter"}, "title": {"en": "Weather"}, "body": [
            {"type": "weather-live", "title": {"en": "Atmosphere", "de": "Atmosphäre"}, "badge": {"en": "Live"},
             "currentWeather": {"temp": 12, "condition": {"en": "Partly Cloudy"}},
             "forecast": [{"day": {"en": "Fri"}, "high": 13, "condition": {"en": "Sunny"}}]},
            {"type": "closing-note", "title": {"en": "Plan with intention"}}
        ]}),
    );
    let p = plan(&s);
    let de = &doc_at(&p, "/de/wetter/").content;
    assert!(de.contains("Atmosphäre"), "{de}");
    assert!(
        !de.contains("Partly Cloudy") && !de.contains("Sunny"),
        "{de}"
    );
    let markers = site_export::forecast::needed(de).unwrap();
    assert_eq!(markers.len(), 5, "{de}");
    assert!(markers.iter().any(|p| p.name == "Monterosso al Mare"));
    assert!(de.contains("data-lang=\"de\""));
    assert!(de.contains("Die kommende Woche"));
    // After the live block, before what follows it.
    let at = de.find("data-sp-forecast").unwrap();
    assert!(de.find("Atmosphäre").unwrap() < at && at < de.find("Plan with intention").unwrap());
    // A village's weather page (the hub standing in): that village only.
    let v = &doc_at(&p, "/en/manarola/weather/").content;
    let places: Vec<_> = site_export::forecast::needed(v)
        .unwrap()
        .into_iter()
        .collect();
    assert_eq!(places.len(), 1);
    assert_eq!(places[0].name, "Manarola");
    assert_eq!(places[0].key(), "44.1069,9.7286");
    // Other pages have none.
    assert!(
        site_export::forecast::needed(&doc_at(&p, "/en/sights/").content)
            .unwrap()
            .is_empty()
    );
}

/// The site repo's deploy to Cloudflare Pages (ADR-0091), as swarmpress keeps it: the export is
/// what is uploaded, the forecast is filled first, credentials come only from the repo's secrets.
#[test]
fn the_site_repos_cloudflare_pages_workflow() {
    let w = include_str!("../../../templates/site-repo/.github/workflows/deploy.yml");
    let at = |needle: &str| {
        w.find(needle)
            .unwrap_or_else(|| panic!("the workflow lacks {needle}"))
    };
    // The export, after its forecast is filled, goes to Pages with wrangler.
    let fill = at("swarmpress-wp-migrate forecast --export site/export");
    let deploy = at("uses: cloudflare/wrangler-action@v3");
    assert!(fill < deploy);
    assert!(w.contains("command: pages deploy site/export/files --project-name="));
    // Credentials are the repo's secrets, never a value in the file.
    assert!(w.contains("apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}"));
    assert!(w.contains("accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}"));
    for line in w
        .lines()
        .filter(|l| l.contains("apiToken:") || l.contains("accountId:"))
    {
        assert!(line.contains("${{ secrets."), "{line}");
    }
    // A daily rebuild keeps the forecast fresh; branches other than main are previews.
    assert!(w.contains("schedule:") && w.contains("cron:"));
    assert!(w.contains("branches: [\"**\"]"));
    // swarmpress is pinned (a repo variable), and a missing setting fails loudly.
    assert!(w.contains("ref: ${{ vars.SWARMPRESS_REF }}"));
    assert!(w.contains("::error::not set in the site repo"));
    // Nothing GitHub Pages is left.
    assert!(!w.contains("deploy-pages") && !w.contains("upload-pages-artifact"));
}

/// A collection's interludes stand where the source places them: after the item `afterIndex`
/// names, as the live page shows them.
#[test]
fn interludes_stand_after_the_item_they_name() {
    let b = json!({"type": "collection-with-interludes",
        "items": [{"title": {"en": "First"}}, {"title": {"en": "Second"}}, {"title": {"en": "Third"}}],
        "interludes": [{"afterIndex": 0, "title": {"en": "After one"}}, {"afterIndex": 9, "title": {"en": "At the end"}}]});
    let m = markup::block(&b, "en", &mut Notes::default());
    let at = |t: &str| m.find(t).unwrap_or_else(|| panic!("{t}: {m}"));
    assert!(at("First") < at("After one") && at("After one") < at("Second"));
    assert!(at("Third") < at("At the end"));
    assert_eq!(m.matches("ct-interludes-item").count(), 2 * 2, "{m}");
    assert!(!m.contains("afterIndex"));
}

/// cinqueterre.travel with the theme ported from its Astro theme (ADR-0092): the theme is
/// activated, the header is the frozen theme's coastal spine, and the wordmark, the header's
/// button and the footer are named menus in each language.
#[test]
fn cinqueterre_gets_its_own_theme_and_the_frozen_themes_menus() {
    assert_eq!(plan(&site()).theme, "coast");
    assert!(plan(&site()).named_menus.is_empty());
    let mut s = site();
    s.site["id"] = json!("cinqueterre-travel");
    let p = plan(&s);
    assert_eq!(p.theme, crate::plan::CINQUETERRE_THEME);
    let de = &p.menus["de"];
    let villages: Vec<&str> = de.iter().map(|m| m.url.as_str()).collect();
    assert_eq!(
        villages,
        [
            "/de/riomaggiore/",
            "/de/manarola/",
            "/de/corniglia/",
            "/de/vernazza/",
            "/de/monterosso/"
        ]
    );
    let sections: Vec<&str> = de[3].children.iter().map(|m| m.url.as_str()).collect();
    assert_eq!(sections.len(), 10);
    assert_eq!(
        sections[0], "/de/vernazza/",
        "the overview is the village itself"
    );
    assert!(sections.contains(&"/de/vernazza/weather/"));
    assert_eq!(de[3].children[1].label, "Aktivitäten");
    for name in ["brand", "footer"] {
        assert_eq!(p.named_menus[name].len(), 4, "{name}");
    }
    assert_eq!(p.named_menus["brand"]["it"][0].url, "/it/");
    // The newsletter is hidden (2026-10-13): no header button, no footer link…
    assert!(!p.named_menus.contains_key("cta"));
    // …and with it, both come back in every language.
    let with = crate::plan::plan_with(
        &s,
        crate::compose::Options {
            newsletter: true,
            ..Default::default()
        },
    );
    assert_eq!(with.named_menus["cta"].len(), 4);
    assert_eq!(with.named_menus["cta"]["fr"][0].url, "/fr/#subscribe");
    let about = |p: &crate::plan::Plan| {
        p.named_menus["footer"]["it"][3]
            .children
            .iter()
            .map(|m| m.url.clone())
            .collect::<Vec<_>>()
    };
    assert_eq!(about(&p), ["/it/team/", "/it/cinque-terre/faq/"]);
    assert_eq!(
        about(&with),
        ["/it/team/", "/it/cinque-terre/faq/", "/it/#subscribe"]
    );
    let footer = &p.named_menus["footer"]["de"];
    assert_eq!(footer.len(), 4);
    assert_eq!(footer[1].label, "Dörfer");
    assert_eq!(footer[1].children[0].url, "/de/monterosso/");
    assert!(footer
        .iter()
        .flat_map(|c| &c.children)
        .all(|m| m.url.starts_with("/de/")));
}

/// The home's sections from the site's own content: the hero as a cover, the owner's curated
/// stories as the editors' picks (in the page's language), the featured stays, then the villages,
/// the latest stories and the newsletter; nothing the content lacks.
#[test]
fn the_homes_sections_come_from_the_sites_content() {
    let mut s = site();
    s.pages.insert(
        "blog-index.json".into(),
        json!({"body": [{"type": "blog-index", "stories": [
            {"slug": "gone", "title": "Not on the site"},
            {"slug": "gelato", "title": "Gelato (index)", "excerpt": "Cold.", "author": "Marco", "category": "Food", "image": "https://img.example/g.jpg"},
            {"slug": "gelato", "title": "Lead", "isLead": "true", "image": "https://img.example/l.jpg"}
        ]}]}),
    );
    s.pages.get_mut("blog/gelato.json").unwrap()["body"][0]["post"]["title"] =
        json!({"en": "Gelato", "de": "Eis"});
    s.collections.insert(
        "accommodations".into(),
        vec![
            json!({"village": "vernazza", "items": [
                {"name": {"en": "Harbour Rooms"}, "featured": true, "rank": 2, "stars": 3, "price_range": {"min": 120, "max": 205}, "ratings": {"average": 8.6}, "details": {"teaser": {"en": "On the water", "de": "Am Wasser"}}},
                {"name": {"en": "Hidden"}, "featured": true, "rank": 1, "published": false},
                {"name": {"en": "Plain"}, "rank": 1}
            ]}),
            json!({"village": "manarola", "items": [{"name": {"en": "Vineyard House"}, "featured": true, "rank": 5, "ratings": {"average": 4.5}}]}),
        ],
    );
    let picks = crate::compose::editors_picks(&s, "de");
    assert_eq!(picks.len(), 2, "{picks:?}");
    assert_eq!(
        picks[0].title, "Eis",
        "the lead first, its article's title in German"
    );
    assert_eq!(picks[0].href, "/de/blog/gelato/");
    assert_eq!(picks[0].image, "https://img.example/l.jpg");
    assert_eq!(picks[1].author, "Marco");
    let stays = crate::compose::places_to_stay(&s, "de");
    let names: Vec<&str> = stays.iter().map(|x| x.name.as_str()).collect();
    assert_eq!(
        names,
        ["Vineyard House", "Harbour Rooms"],
        "the villages along the coast, featured and published only"
    );
    assert_eq!(stays[1].rating.as_deref(), Some("8.6/10"));
    assert_eq!(stays[0].rating.as_deref(), Some("4.5/5"));
    assert_eq!(stays[1].teaser, "Am Wasser");

    let with = crate::compose::Options {
        newsletter: true,
        ..Default::default()
    };
    let home = crate::compose::home(&s, "de", "Coast Dispatch", "Five villages", with);
    let at = |t: &str| home.find(t).unwrap_or_else(|| panic!("{t}: {home}"));
    assert!(home.starts_with("<!-- wp:cover "), "{home}");
    assert!(at("ct-home-hero") < at("ct-picks"));
    assert!(at("ct-picks") < at("ct-villages-home"));
    assert!(at("ct-villages-home") < at("ct-stays"));
    assert!(at("ct-stays") < at("ct-home-stories"));
    assert!(at("ct-home-stories") < at("ct-newsletter"));
    assert!(home.contains("href=\"/de/itinerary/\""));
    assert!(home.contains("<a href=\"/de/vernazza/hotels/\">Harbour Rooms</a>"));
    assert!(home.contains("€120–205 pro Nacht"));
    assert!(home.contains("ct-stay ct-village-vernazza"));
    assert!(
        !home.contains("Not on the site") && !home.contains("Hidden") && !home.contains("Plain")
    );
    // Without curated stories or featured stays, those sections are left out, not invented.
    let bare = crate::compose::home(&site(), "en", "Coast Dispatch", "", with);
    assert!(
        !bare.contains("ct-picks") && !bare.contains("ct-stays"),
        "{bare}"
    );
}

/// The owner's decision of 2026-10-13: the newsletter is hidden until the central server has a
/// public address, a privacy line and a double opt-in. Without the option no page has a form, a
/// `#subscribe` section or the blog index's invitation; with it (an export with
/// `--forms-endpoint`), the home's form is back.
#[test]
fn the_newsletter_is_hidden_unless_a_form_endpoint_answers_it() {
    let mut s = site();
    s.pages.insert(
        "blog-index.json".into(),
        json!({"body": [{"type": "blog-index", "intro": {"en": "All our stories."}, "newsletter": {"title": "Get the Dispatch in Your Inbox.", "disclaimer": "By subscribing, you agree."}}]}),
    );
    let hidden = plan(&s);
    assert!(!hidden.docs.is_empty());
    for d in &hidden.docs {
        for needle in [
            "<form",
            "admin-post.php",
            "id=\"subscribe\"",
            "ct-newsletter",
            "Get the Dispatch",
            "By subscribing",
        ] {
            assert!(!d.content.contains(needle), "{} has {needle}", d.route);
        }
    }
    let shown = crate::plan::plan_with(
        &s,
        crate::compose::Options {
            newsletter: true,
            ..Default::default()
        },
    );
    let home = doc_at(&shown, "/en/");
    assert!(home.content.contains("action=\"/wp-admin/admin-post.php\""));
    assert!(home.content.contains("id=\"subscribe\""));
    assert!(shown
        .docs
        .iter()
        .any(|d| d.content.contains("Get the Dispatch in Your Inbox.")));
    // The rest of the plan is the same either way.
    assert_eq!(hidden.docs.len(), shown.docs.len());
}

// ------------------------------------------------------------------ the theme as data (ADR-0093)

fn theme_data() -> crate::theme_data::ThemeData {
    let font =
        |path: &str| json!({"path": path, "sha256": "00".repeat(32), "content_type": "font/woff2"});
    serde_json::from_value(json!({
        "format": "swarmpress.theme-data.v1",
        "design": "d1",
        // Listed out of order on purpose: the calls' order is the plan's, not the data's.
        "navigation": [
            {"name": "nav", "lang": "de", "items": [{"label": "Hafen", "url": "/de/hafen/", "children": [{"label": "Boote", "url": "/de/hafen/boote/"}]}]},
            {"name": "footer", "lang": "en", "items": []}
        ],
        "patterns": [{"slug": "site/hero", "title": "Hero", "categories": ["Sections"], "content": "<!-- wp:heading -->\n<h2 class=\"wp-block-heading\">Boats</h2>\n<!-- /wp:heading -->"}],
        "templates": [{"slug": "front-page", "title": "Front page", "content": "<!-- wp:template-part {\"slug\":\"header\"} /-->\n<!-- wp:pattern {\"slug\":\"site/hero\"} /-->"}],
        "template_parts": [{"slug": "header", "area": "header", "content": "<!-- wp:site-title /-->"}],
        "global_styles": {
            "version": 3,
            "settings": {"color": {"palette": [{"slug": "sea", "name": "Sea", "color": "#0b5394"}]}},
            "styles": {"color": {"background": "var(--wp--preset--color--sea)"}},
            "css": ".hero{letter-spacing:.02em}"
        },
        "fonts": [{"name": "Harbour Serif", "slug": "harbour-serif", "family": "\"Harbour Serif\", serif", "faces": [
            {"weight": "400", "style": "normal", "file": font("fonts/HarbourSerif-Regular.woff2")},
            {"weight": "700", "style": "normal", "unicode_range": "U+0000-00FF", "file": font("fonts/HarbourSerif-Bold.woff2")}
        ]}]
    }))
    .unwrap()
}

#[test]
fn the_theme_data_is_written_in_a_fixed_order_onto_canvas() {
    use crate::theme::{calls, Call, Kind, BASE_THEME};
    let c = calls(&theme_data(), BASE_THEME);
    let kinds: Vec<String> = c
        .iter()
        .map(|c| match c {
            Call::SwitchTheme { stylesheet } => format!("theme {stylesheet}"),
            Call::FontFamily { slug, .. } => format!("family {slug}"),
            Call::FontFace { file_name, .. } => format!("face {file_name}"),
            Call::GlobalStyles { .. } => "global styles".into(),
            Call::Upsert { kind, slug, .. } => format!("{kind:?} {slug}"),
        })
        .collect();
    assert_eq!(
        kinds,
        [
            "theme canvas",
            "family harbour-serif",
            "face harbour-serif-400-normal.woff2",
            "face harbour-serif-700-normal.woff2",
            "global styles",
            "TemplatePart header",
            "Template front-page",
            "Pattern hero",
            "Navigation nav-de",
            "Navigation footer-en",
        ]
    );
    // The face: its file, uploaded under a name of its own, with the settings the font library wants.
    let Call::FontFace {
        settings,
        file,
        mime,
        src,
        ..
    } = &c[2]
    else {
        panic!("{:?}", c[2]);
    };
    assert_eq!(file, "fonts/HarbourSerif-Regular.woff2");
    assert_eq!(mime, "font/woff2");
    assert_eq!(
        src,
        "/wp-content/uploads/fonts/harbour-serif-400-normal.woff2"
    );
    assert_eq!(
        settings,
        &json!({"fontFamily": "Harbour Serif", "fontWeight": "400", "fontStyle": "normal", "src": "file-0"})
    );
    // A pattern is unsynced (inserted as a copy, rendered by slug) with its categories by name; its
    // post is the slug's name (`site/hero` → `hero`, what the sandbox looks up for `wp:pattern`).
    let Call::Upsert {
        body, categories, ..
    } = &c[7]
    else {
        panic!("{:?}", c[7]);
    };
    assert_eq!(body["slug"], "hero");
    assert_eq!(body["meta"]["wp_pattern_sync_status"], "unsynced");
    assert_eq!(categories, &["Sections"]);
    // A menu's items as navigation blocks: a submenu with its children.
    let Call::Upsert { body, .. } = &c[8] else {
        panic!("{:?}", c[8]);
    };
    let nav = body["content"].as_str().unwrap();
    assert!(nav.starts_with("<!-- wp:navigation-submenu {"), "{nav}");
    assert!(nav.contains("\"url\":\"/de/hafen/boote/\""), "{nav}");
    // A face's unicode range travels with it.
    let Call::FontFace { settings, .. } = &c[3] else {
        panic!("{:?}", c[3]);
    };
    assert_eq!(settings["unicodeRange"], "U+0000-00FF");
    // Templates and parts are found by their id on the theme; patterns and menus by slug.
    assert_eq!(
        Kind::Template.lookup("canvas", "front-page"),
        "/wp/v2/templates/canvas//front-page"
    );
    assert_eq!(
        Kind::TemplatePart.item("canvas", "header", 0),
        "/wp/v2/template-parts/canvas//header"
    );
    assert!(Kind::Navigation
        .lookup("canvas", "nav-de")
        .starts_with("/wp/v2/navigation?slug=nav-de&"));
    assert_eq!(Kind::Pattern.item("canvas", "hero", 42), "/wp/v2/blocks/42");
    assert_eq!(Kind::Pattern.collection(), "/wp/v2/blocks");
    // The same data, the same calls: a second import writes the same objects (by slug).
    assert_eq!(c, calls(&theme_data(), BASE_THEME));
}

#[test]
fn global_styles_carry_the_css_and_every_font_with_its_files() {
    use crate::theme::global_styles_body;
    let data = theme_data();
    let body = global_styles_body(&data);
    assert_eq!(body["settings"]["color"]["palette"][0]["slug"], "sea");
    assert_eq!(body["styles"]["css"], ".hero{letter-spacing:.02em}");
    assert_eq!(
        body["styles"]["color"]["background"],
        "var(--wp--preset--color--sea)"
    );
    let families = &body["settings"]["typography"]["fontFamilies"];
    assert_eq!(families[0]["slug"], "harbour-serif");
    assert_eq!(families[0]["fontFamily"], "\"Harbour Serif\", serif");
    let faces = families[0]["fontFace"].as_array().unwrap();
    assert_eq!(faces.len(), 2);
    assert_eq!(
        faces[1]["src"],
        json!(["/wp-content/uploads/fonts/harbour-serif-700-normal.woff2"])
    );

    // A family the settings list already (by origin here) gets the faces it lacks, nothing twice.
    let mut d = data.clone();
    d.global_styles.settings["typography"] = json!({"fontFamilies": {"custom": [
        {"slug": "harbour-serif", "name": "Harbour Serif", "fontFamily": "serif",
         "fontFace": [{"fontWeight": "400", "fontStyle": "normal", "src": ["/elsewhere.woff2"]}]}
    ]}});
    let body = global_styles_body(&d);
    let custom = &body["settings"]["typography"]["fontFamilies"]["custom"];
    assert_eq!(custom.as_array().unwrap().len(), 1);
    let faces = custom[0]["fontFace"].as_array().unwrap();
    assert_eq!(faces.len(), 2, "{faces:?}");
    assert_eq!(faces[0]["src"], json!(["/elsewhere.woff2"]));
    assert_eq!(faces[1]["fontWeight"], "700");

    // Without fonts and CSS, the styles are the data's own.
    let mut bare = data.clone();
    bare.fonts.clear();
    bare.global_styles.css.clear();
    let body = global_styles_body(&bare);
    assert_eq!(body["settings"], data.global_styles.settings);
    assert!(body["styles"].get("css").is_none());
}

#[test]
fn with_theme_data_the_site_is_imported_onto_canvas_without_it_onto_its_fallback_theme() {
    let opts = crate::compose::Options::default();
    let mut s = site();
    s.site["id"] = json!("cinqueterre-travel");
    // FALLBACK: cinqueterre.travel keeps its theme folder until its design runs on data.
    let folder = crate::plan::plan_with_theme(&s, opts, None);
    assert_eq!(folder.theme, crate::plan::CINQUETERRE_THEME);
    assert!(folder.theme_data.is_none());
    assert_eq!(crate::plan::fallback_theme_for(&site()), crate::plan::THEME);
    let data = crate::plan::plan_with_theme(&s, opts, Some(theme_data()));
    assert_eq!(data.theme, crate::theme::BASE_THEME);
    assert_eq!(data.theme_data.as_ref(), Some(&theme_data()));
    // The ported theme's named menus are its own: not on canvas, where the data names its menus.
    assert!(data.named_menus.is_empty());
    // The plan file carries the data, and reads back the same.
    let back: crate::plan::Plan =
        serde_json::from_str(&serde_json::to_string(&data).unwrap()).unwrap();
    assert_eq!(back, data);
    // A plan without data has no `theme_data` key (plans written before it still read).
    assert!(!serde_json::to_string(&folder)
        .unwrap()
        .contains("theme_data"));
}

#[test]
fn theme_data_is_checked_for_its_shape_before_it_is_written() {
    use crate::theme::checked;
    // The fixture above has no index, single, page or 404 template and no footer part.
    let issues = checked(&theme_data()).unwrap_err();
    for want in [
        "templates: has the template index",
        "templates: has the template 404",
        "template_parts: has the part footer",
    ] {
        assert!(issues.iter().any(|i| i == want), "{want:?} in {issues:#?}");
    }
    let mut ok = theme_data();
    for slug in ["index", "single", "page", "404"] {
        ok.templates.push(crate::theme_data::ThemeTemplate {
            slug: slug.into(),
            title: slug.into(),
            content: "<!-- wp:post-content /-->".into(),
        });
    }
    ok.template_parts.push(crate::theme_data::ThemePart {
        slug: "footer".into(),
        area: crate::theme_data::PartArea::Footer,
        content: "<!-- wp:site-title /-->".into(),
    });
    ok.fonts[0].faces[0].file.sha256 = "ab".repeat(32);
    ok.fonts[0].faces[1].file.sha256 = "cd".repeat(32);
    assert_eq!(checked(&ok), Ok(()));
}

#[test]
fn entries_carry_language_place_link_and_fields_on_the_designs_scales() {
    use crate::entries::{content_types, entries, price_level, rating_of_ten, PER_PLACE};
    // fix-01: one scale of ten with one decimal; fix-10: € glyphs out of four.
    assert_eq!(rating_of_ten(&json!(4.6)).as_deref(), Some("9.2"));
    assert_eq!(rating_of_ten(&json!(8.1)).as_deref(), Some("8.1"));
    assert_eq!(rating_of_ten(&json!(4)).as_deref(), Some("8.0"));
    assert_eq!(rating_of_ten(&json!(4.25)).as_deref(), Some("8.5"));
    assert_eq!(rating_of_ten(&json!(0)), None);
    assert_eq!(rating_of_ten(&json!("9")), None);
    assert_eq!(
        price_level(&json!("$$$")),
        Some(("€€€".into(), "€".into(), 3))
    );
    assert_eq!(price_level(&json!(5)).map(|p| p.2), Some(4));
    assert_eq!(price_level(&json!("")), None);

    let mut s = site();
    s.collections.insert(
        "accommodations".into(),
        vec![json!({"village": "vernazza", "items": (0..20).map(|i| json!({
            "slug": format!("stay-{i}"), "name": {"en": format!("Stay {i}"), "de": format!("Haus {i}")},
            "rank": i, "featured": i == 7, "price_range": {"min": 100, "max": 200},
            "ratings": {"average": 4.5}, "details": {"teaser": {"en": "By the sea"}}
        })).collect::<Vec<_>>()})],
    );
    let all = entries(&s);
    let types = content_types();
    let names: Vec<&str> = types.iter().map(|t| t.name.as_str()).collect();
    assert_eq!(
        names,
        [
            "post",
            "sp_village",
            "sp_stay",
            "sp_restaurant",
            "sp_activity",
            "sp_editor"
        ]
    );
    // Every content type's name fits WordPress's 20 characters; every field is public.
    for t in content_types() {
        assert!(t.name.len() <= 20);
        assert!(t.fields.iter().all(|(k, _)| !k.starts_with('_')));
    }
    let stays: Vec<_> = all
        .iter()
        .filter(|e| e.post_type == "sp_stay" && e.lang == "de")
        .collect();
    // At most PER_PLACE per village and language, the featured one first.
    assert_eq!(stays.len(), PER_PLACE);
    assert_eq!(stays[0].title, "Haus 7");
    assert_eq!(stays[0].fields["rating"], "9.0");
    assert_eq!(stays[0].fields["rating_scale"], "/ 10");
    assert_eq!(stays[0].fields["price"], "€100–200");
    assert_eq!(stays[0].fields["price_unit"], "/ Nacht");
    assert_eq!(stays[0].link, "/de/vernazza/hotels/");
    assert_eq!(stays[0].place.as_deref(), Some("vernazza"));
    // The five villages in every language, south to north, with their pictures described.
    let villages: Vec<_> = all
        .iter()
        .filter(|e| e.post_type == "sp_village" && e.lang == "en")
        .collect();
    assert_eq!(villages.len(), 5);
    let v = villages.iter().find(|e| e.title == "Vernazza").unwrap();
    assert_eq!((v.order, v.fields["number"].as_str()), (4, "04"));
    assert_eq!(v.fields["image_alt"], "The harbour");
    assert_eq!(v.link, "/en/vernazza/");
    // A restaurant's place scopes it; one without a name is left out.
    let rest: Vec<_> = all
        .iter()
        .filter(|e| e.post_type == "sp_restaurant" && e.lang == "en")
        .collect();
    assert_eq!(rest.len(), 2);
    assert!(rest.iter().any(|e| e.place.as_deref() == Some("manarola")));
}

#[test]
fn with_a_design_the_homes_are_its_templates_pages_get_its_listings_and_its_rules_hold() {
    use crate::plan::{assign_templates, headline, listing_of, plan_with_theme};
    assert_eq!(
        headline("Vernazza | Cinque Terre Dispatch", "Cinque Terre Dispatch"),
        "Vernazza"
    );
    assert_eq!(
        headline(
            "Cinque Terre Dispatch | Luxury Travel Guide",
            "Cinque Terre Dispatch"
        ),
        "Luxury Travel Guide"
    );
    assert_eq!(
        headline("Cinque Terre Dispatch", "Cinque Terre Dispatch"),
        "Cinque Terre Dispatch"
    );
    assert_eq!(headline("A | B", "Other"), "A | B");
    assert_eq!(
        headline(
            "The Culinary Story | Cinque Terre Dispatch · Corniglia",
            "Cinque Terre Dispatch"
        ),
        "The Culinary Story · Corniglia"
    );
    assert_eq!(listing_of("/en/vernazza/restaurants/"), Some("restaurant"));
    assert_eq!(listing_of("/en/things-to-do/"), Some("activity"));
    assert_eq!(listing_of("/things-to-do/"), None);
    assert_eq!(listing_of("/en/vernazza/"), None);

    let mut data = theme_data();
    for slug in [crate::theme::LANGUAGE_HOME, "archive-restaurant"] {
        data.templates.push(crate::theme_data::ThemeTemplate {
            slug: slug.into(),
            title: slug.into(),
            content: "<!-- wp:post-content /-->".into(),
        });
    }
    let opts = crate::compose::Options::default();
    let composed = plan_with_theme(&site(), opts, None);
    let designed = plan_with_theme(&site(), opts, Some(data.clone()));
    // The composed home is the importer's; with a design the home is its template's.
    assert!(doc_at(&composed, "/en/").content.contains("wp:query"));
    assert!(!doc_at(&designed, "/en/").content.contains("wp:query"));
    assert_eq!(
        doc_at(&designed, "/de/").template.as_deref(),
        Some("page-front")
    );
    assert_eq!(
        doc_at(&designed, "/").template,
        None,
        "/ is the front page itself"
    );
    assert_eq!(
        doc_at(&designed, "/en/vernazza/restaurants/")
            .template
            .as_deref(),
        Some("archive-restaurant")
    );
    assert_eq!(
        doc_at(&designed, "/en/sights/").template,
        None,
        "no such listing in the design"
    );
    // A village's pages belong to its place; every image says what it shows.
    assert_eq!(
        doc_at(&designed, "/en/vernazza/restaurants/").meta["_swarmpress_place"],
        "vernazza"
    );
    for d in &designed.docs {
        assert!(
            !d.content.contains("alt=\"\""),
            "{} has an image without alt",
            d.route
        );
    }
    // The entries and their types travel with the plan.
    assert!(!designed.entries.is_empty());
    assert_eq!(designed.content_types[0].name, "post");
    let mut docs = composed.docs.clone();
    assign_templates(&mut docs, &theme_data());
    assert!(
        docs.iter().all(|d| d.template.is_none()),
        "a design without those templates"
    );
    // The theme's calls as JSON for an executor of its own (the browser's engine).
    let calls = crate::theme::calls_json(&data, crate::theme::BASE_THEME);
    let kinds: Vec<&str> = calls
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c["call"].as_str().unwrap())
        .collect();
    assert_eq!(
        kinds[..4],
        ["switch-theme", "font-family", "font-face", "font-face"]
    );
    let part = calls
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["kind"] == "template-part")
        .unwrap();
    assert_eq!(part["item"], "/wp/v2/template-parts/canvas//header");
    assert_eq!(part["lookup"], "/wp/v2/template-parts/canvas//header");
}
