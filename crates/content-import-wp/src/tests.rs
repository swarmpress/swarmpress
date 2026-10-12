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

    let team = json!({"type": "team-grid", "editors": [{"name": "Giulia", "persona": "Early mornings on the rocks.", "love": "Rain."}]});
    let t = markup::block(&team, "en", &mut notes);
    assert!(t.contains("<p>Early mornings on the rocks.</p>"), "{t}");
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
    // A blog article is a post with its category, tags, byline and date.
    let post = p
        .docs
        .iter()
        .find(|d| d.route == "/de/blog/gelato/")
        .unwrap();
    assert_eq!(post.post_type, "post");
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
/// its language as a query block, the newsletter form), and so is the village overview.
#[test]
fn the_home_and_the_village_overview_are_composed() {
    let p = plan(&site());
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
