//! The closed world of the staged article (ADR-0058, ADR-0061, FEAT-032):
//! shortlists built from a knowledge base, alias resolution at assembly and
//! the v2 site validator. The article itself is the fixture of the agents
//! crate (`crates/agents/tests/fixtures/article`).

use std::collections::BTreeSet;
use std::sync::Arc;

use agents::article::{
    assemble_page, outline_schema, ArticleInput, ArticleParts, AssembleError, PageIssue, SectionId,
    THEME_LANGUAGES,
};
use agents::pipeline::{Brief, PageValidator};
use agents::prompts::SiteContext;
use agents::StyleGuide;
use knowledge::{pack, DirSource, KnowledgeBase, MemSource, SiteSource};
use orchestrator::{
    article_context, blog_categories, brief_entities, entity_facts, hero_shortlist, link_shortlist,
    related_titles, site_validator, site_validator_v2, used_hero_images, ArticleContext,
    SiteValidatorV2, HERO_SHORTLIST, LINK_SHORTLIST,
};
use serde_json::{json, Value};

const BRIEF: &str = include_str!("../../agents/tests/fixtures/article/brief.json");
const PARTS: &str = include_str!("../../agents/tests/fixtures/article/parts.json");
const GOLDEN: &str = include_str!("../../agents/tests/fixtures/article/page.golden.json");
const STYLE_GUIDE: &str = include_str!("../../agents/tests/fixtures/style-guide.json");
const BLOG_INDEX: &str = "content/pages/blog-index.json";

fn unsplash(photo: &str) -> String {
    format!("https://images.unsplash.com/{photo}?q=80&w=2670&auto=format&fit=crop")
}

fn page(id: &str, route: &str, title: &str, page_type: &str) -> Value {
    json!({
        "id": id,
        "slug": {"en": format!("/en{route}"), "de": format!("/de{route}"),
                 "fr": format!("/fr{route}"), "it": format!("/it{route}")},
        "title": {"en": title},
        "page_type": page_type,
        "body": []
    })
}

/// A small site with the routes and images the fixture article refers to,
/// plus the cases the shortlists must handle (see the media index comments).
fn site() -> MemSource {
    let village = |slug: &str, name: &str, position: u32, near: &[&str]| {
        json!({
            "slug": slug, "name": {"en": name}, "position": position,
            "canonicalUrl": {"en": format!("/en/{slug}"), "de": format!("/de/{slug}")},
            "relatedVillages": near
        })
    };
    let mut manarola = village("manarola", "Manarola", 2, &["riomaggiore", "corniglia"]);
    manarola["aliases"] = json!(["wine village"]);
    manarola["keywords"] = json!(["wine", "sunset", "vineyards"]);
    let image = |id: &str, photo: &str, village: &str, category: &str, used_in: &[&str]| {
        json!({
            "id": id, "url": unsplash(photo), "license": "unsplash",
            "tags": {"village": village, "category": category}, "usedIn": used_in
        })
    };
    let mut dusk = image(
        "manarola-sights-001",
        "photo-1516483638261-f4dbaf036963",
        "manarola",
        "sights",
        &["manarola.json:hero"],
    );
    dusk["alt"] = json!({"en": "Manarola seen from the sea at dusk", "de": "Manarola vom Meer"});
    dusk["photographer"] = json!("Luca Bravo");
    dusk["tags"]["subcategory"] = json!("village-overview");
    dusk["tags"]["timeOfDay"] = json!("sunset");
    dusk["tags"]["season"] = json!("all");
    let mut terraces = image(
        "manarola-sights-014",
        "photo-1499678329028-101435549a4e",
        "manarola",
        "sights",
        &[],
    );
    terraces["tags"]["subcategory"] = json!("viewpoint");
    terraces["photographer"] = json!("Unknown");

    let mut blog_index = page("blog", "/blog", "The Dispatch", "blog");
    blog_index["body"] = json!([{
        "type": "blog-index", "title": "The Dispatch",
        "categories": ["All Stories", "Guides", "Food & Drink", "Culture"],
        "stories": [{
            "id": 1, "slug": "the-ultimate-guide-to-cinque-terre-wines",
            "title": "The Ultimate Guide to Cinque Terre Wines", "category": "Food & Drink",
            "image": "https://images.unsplash.com/photo-listed-in-the-blog-index?q=80&w=800"
        }]
    }]);
    let mut german_only = page("nur-deutsch", "/manarola-wein", "Manarola Wein", "village");
    german_only["slug"] = json!({"de": "/de/manarola-wein"});

    let mut s = MemSource::new();
    s.insert_json(
        "content/site.json",
        &json!({"name": "Cinque Terre Dispatch", "locales": ["en", "de", "fr", "it"], "defaultLocale": "en"}),
    )
    .insert_json(
        "content/config/entity-index.json",
        &json!({
            "villages": {
                "riomaggiore": village("riomaggiore", "Riomaggiore", 1, &["manarola"]),
                "manarola": manarola,
                "corniglia": village("corniglia", "Corniglia", 3, &["manarola", "vernazza"]),
                "vernazza": village("vernazza", "Vernazza", 4, &["corniglia"])
            },
            "trails": {"via-dell-amore": {
                "name": {"en": "Via dell'Amore"}, "aliases": ["path of love"],
                "connectsVillages": ["riomaggiore", "manarola"]
            }},
            "transport": {"train": {
                "slug": "train", "name": {"en": "Cinque Terre Express"},
                "stopsAt": ["riomaggiore", "manarola"]
            }},
            "categories": [{"slug": "food", "name": {"en": "Food"}}]
        }),
    )
    .insert_json(
        "content/config/media-index.json",
        &json!({
            "categories": ["sights", "beaches", "trails", "food", "accommodations"],
            "images": [
                dusk,
                terraces,
                // The same photo under a second id and another crop: listed once.
                {"id": "manarola-sights-014-crop", "url": "https://images.unsplash.com/photo-1499678329028-101435549a4e?w=800",
                 "tags": {"village": "manarola", "category": "sights"}, "license": "unsplash"},
                // The hero block's media rules exclude accommodation photos.
                image("manarola-accommodations-001", "photo-a-hotel-room", "manarola", "accommodations", &[]),
                // Already the hero of an article, by the media index's own record.
                image("manarola-sights-020", "photo-hero-of-an-old-article", "manarola", "sights",
                      &["pages/pages/blog/5-hidden-gelaterias-you-need-to-try.json:image"]),
                // Already the hero of an article, by the blog index's story card.
                image("manarola-sights-021", "photo-listed-in-the-blog-index", "manarola", "sights", &[]),
                image("region-sights-007", "photo-1538681105587-85640961bf8b", "region", "sights", &[]),
                image("region-food-001", "photo-a-glass-of-wine", "region", "food", &[]),
                // Another village: never offered for a Manarola article.
                image("vernazza-sights-001", "photo-vernazza-harbour", "vernazza", "sights", &[]),
                // A site asset path (an author portrait), not a photograph.
                {"id": "author-giulia", "url": "/giulia_rossi.png", "tags": {"village": "region", "category": "sights"}}
            ]
        }),
    )
    .insert_json("content/pages/index.json", &page("home", "", "Cinque Terre Dispatch", "home"))
    .insert_json("content/pages/manarola.json", &page("manarola", "/manarola", "Manarola | The Dispatch", "village"))
    .insert_json("content/pages/manarola/hiking.json", &page("manarola-hiking", "/manarola/hiking", "Hiking from Manarola", "collection"))
    .insert_json("content/pages/culinary.json", &page("culinary", "/culinary", "Food and Wine", "editorial"))
    .insert_json("content/pages/vernazza.json", &page("vernazza", "/vernazza", "Vernazza", "village"))
    .insert_json("content/pages/de-only.json", &german_only)
    .insert_json(BLOG_INDEX, &blog_index)
    .insert_json(
        "content/pages/blog/the-ultimate-guide-to-cinque-terre-wines.json",
        &page("wines", "/blog/the-ultimate-guide-to-cinque-terre-wines", "The Ultimate Guide to Cinque Terre Wines | The Dispatch", "blog-article"),
    )
    .insert_json(
        "content/pages/blog/a-photographers-guide-to-manarola-at-sunset.json",
        &page("sunset", "/blog/a-photographers-guide-to-manarola-at-sunset", "A Photographer's Guide to Manarola at Sunset | The Dispatch", "blog-article"),
    )
    .insert_json(
        "content/pages/blog/local-train-and-ferry-cheatsheet.json",
        &page("trains", "/blog/local-train-and-ferry-cheatsheet", "Local Train and Ferry Cheatsheet", "blog-article"),
    );
    s
}

fn kb() -> KnowledgeBase {
    KnowledgeBase::build(&site()).unwrap()
}

fn blog_index() -> Value {
    site().read_json(BLOG_INDEX).unwrap().unwrap()
}

fn brief() -> Brief {
    serde_json::from_str(BRIEF).unwrap()
}

fn parts() -> ArticleParts {
    serde_json::from_str(PARTS).unwrap()
}

fn golden() -> Value {
    serde_json::from_str(GOLDEN).unwrap()
}

fn style() -> StyleGuide {
    StyleGuide::from_json_str(STYLE_GUIDE).unwrap()
}

fn validator(kb: KnowledgeBase) -> Arc<SiteValidatorV2> {
    let context = SiteContext::new("cinqueterre.travel", style(), None).unwrap();
    site_validator_v2(&context, Arc::new(kb))
}

fn ids(heroes: &[agents::article::HeroOption]) -> Vec<(&str, &str)> {
    heroes
        .iter()
        .map(|h| (h.alias.as_str(), h.media_id.as_str()))
        .collect()
}

fn routes(links: &[agents::article::LinkOption]) -> Vec<(&str, &str)> {
    links
        .iter()
        .map(|l| (l.alias.as_str(), l.route.as_str()))
        .collect()
}

fn assemble(
    parts: &ArticleParts,
    brief: &Brief,
    ctx: &ArticleContext,
) -> Result<Value, AssembleError> {
    assemble_page(&ArticleInput {
        brief,
        brief_ref: 6_712_345_678_901_234_567,
        author: "Giulia Rossi",
        brand_suffix: "The Dispatch",
        languages: &THEME_LANGUAGES,
        parts,
        heroes: &ctx.heroes,
        links: &ctx.links,
        inline_image: true,
    })
}

// ---------------------------------------------------------------- shortlists

#[test]
fn the_hero_shortlist_is_ranked_filtered_and_aliased() {
    let kb = kb();
    let brief = brief();
    assert_eq!(
        brief_entities(&kb, &brief)
            .iter()
            .map(|e| e.slug.as_str())
            .collect::<Vec<_>>(),
        vec!["manarola"]
    );
    let heroes = hero_shortlist(&kb, &brief, &BTreeSet::new(), HERO_SHORTLIST);
    // Manarola's own images first (fewest uses first, then id), then region
    // imagery. No accommodation photo, no second crop of the same photo, no
    // site asset path and nothing from another village.
    assert_eq!(
        ids(&heroes),
        vec![
            ("M1", "manarola-sights-014"),
            ("M2", "manarola-sights-021"),
            ("M3", "manarola-sights-001"),
            ("M4", "manarola-sights-020"),
            ("M5", "region-food-001"),
            ("M6", "region-sights-007"),
        ]
    );
    assert_eq!(hero_shortlist(&kb, &brief, &BTreeSet::new(), 2).len(), 2);
    assert!(hero_shortlist(&kb, &brief, &BTreeSet::new(), 0).is_empty());

    // Alt text from the index, or built from the tags when the index has none.
    let by_id = |id: &str| heroes.iter().find(|h| h.media_id == id).unwrap();
    let dusk = by_id("manarola-sights-001");
    assert_eq!(dusk.alt, "Manarola seen from the sea at dusk");
    assert_eq!(dusk.about, "manarola, sights, village-overview, sunset");
    assert_eq!(
        dusk.credit.as_deref(),
        Some("Photo by Luca Bravo on Unsplash")
    );
    assert_eq!(
        dusk.url,
        unsplash("photo-1516483638261-f4dbaf036963"),
        "the index URL, verbatim"
    );
    let terraces = by_id("manarola-sights-014");
    assert_eq!(terraces.alt, "Manarola: viewpoint");
    assert_eq!(terraces.credit, None, "\"Unknown\" is not a credit");
    assert_eq!(by_id("region-food-001").alt, "Food");
    assert!(heroes.iter().all(|h| !h.alt.is_empty()));
}

#[test]
fn heroes_already_used_by_an_article_are_dropped() {
    let kb = kb();
    let brief = brief();
    let used = used_hero_images(&kb, Some(&blog_index()));
    assert_eq!(
        used.iter().map(String::as_str).collect::<Vec<_>>(),
        vec![
            "https://images.unsplash.com/photo-hero-of-an-old-article",
            "https://images.unsplash.com/photo-listed-in-the-blog-index",
        ],
        "one from the media index's usedIn, one from the blog index's story card"
    );
    assert_eq!(
        ids(&hero_shortlist(&kb, &brief, &used, HERO_SHORTLIST)),
        vec![
            ("M1", "manarola-sights-014"),
            ("M2", "manarola-sights-001"),
            ("M3", "region-food-001"),
            ("M4", "region-sights-007"),
        ]
    );
    // Without the blog index only the media index's record is known.
    assert_eq!(used_hero_images(&kb, None).len(), 1);

    // In-flight heroes are named by media id or by URL, with any query.
    let mut in_flight = used.clone();
    in_flight.insert("manarola-sights-014".into());
    in_flight.insert("https://images.unsplash.com/photo-a-glass-of-wine".into());
    assert_eq!(
        ids(&hero_shortlist(&kb, &brief, &in_flight, HERO_SHORTLIST)),
        vec![("M1", "manarola-sights-001"), ("M2", "region-sights-007")]
    );
    let ctx = article_context(
        &kb,
        &brief,
        Some(&blog_index()),
        &BTreeSet::from(["manarola-sights-014".to_string()]),
    );
    assert_eq!(
        ids(&ctx.heroes),
        vec![
            ("M1", "manarola-sights-001"),
            ("M2", "region-food-001"),
            ("M3", "region-sights-007")
        ]
    );
}

#[test]
fn a_brief_without_a_village_gets_region_imagery() {
    let kb = kb();
    let mut brief = brief();
    brief.title = "What to eat in autumn".into();
    brief.angle = "Seasonal food on the coast.".into();
    brief.keywords = vec!["food".into(), "autumn".into()];
    assert!(brief_entities(&kb, &brief).iter().all(|e| e.slug == "food"));
    // The brief names the media category `food`: that image ranks first.
    assert_eq!(
        ids(&hero_shortlist(
            &kb,
            &brief,
            &BTreeSet::new(),
            HERO_SHORTLIST
        )),
        vec![("M1", "region-food-001"), ("M2", "region-sights-007")]
    );
}

#[test]
fn an_empty_hero_shortlist_is_the_needs_media_case() {
    let brief = brief();
    let mut s = site();
    s.insert_json(
        "content/config/media-index.json",
        &json!({"images": [
            {"id": "manarola-accommodations-001", "url": unsplash("photo-a-hotel-room"),
             "tags": {"village": "manarola", "category": "accommodations"}},
            {"id": "author-giulia", "url": "/giulia_rossi.png", "tags": {"village": "manarola", "category": "sights"}}
        ]}),
    );
    let only_unfit = KnowledgeBase::build(&s).unwrap();
    assert!(hero_shortlist(&only_unfit, &brief, &BTreeSet::new(), HERO_SHORTLIST).is_empty());
    s.insert_json("content/config/media-index.json", &json!({"images": []}));
    let none = KnowledgeBase::build(&s).unwrap();
    assert!(hero_shortlist(&none, &brief, &BTreeSet::new(), HERO_SHORTLIST).is_empty());
    // Every image used: the outline schema then accepts no outline at all.
    let kb = kb();
    let all: BTreeSet<String> = kb.media.entries.iter().map(|e| e.id.clone()).collect();
    let ctx = article_context(&kb, &brief, Some(&blog_index()), &all);
    assert!(ctx.heroes.is_empty());
    let schema = outline_schema(&ctx.hero_aliases(), &ctx.link_aliases(), &ctx.categories);
    let outline = serde_json::to_value(parts().outline).unwrap();
    assert!(!jsonschema::validator_for(&schema)
        .unwrap()
        .is_valid(&outline));
}

#[test]
fn the_link_shortlist_offers_only_routes_that_exist() {
    let kb = kb();
    let brief = brief();
    let links = link_shortlist(&kb, &brief, LINK_SHORTLIST);
    // The queries take turns: "manarola" gives the village page, "wine
    // harvest" the food page, "vineyards" and the title the next Manarola
    // pages; then "wine harvest" again. A village's sub-pages do not crowd
    // out what the keywords find.
    assert_eq!(
        routes(&links),
        vec![
            ("L1", "/en/manarola"),
            ("L2", "/en/culinary"),
            ("L3", "/en/manarola/hiking"),
            ("L4", "/en/blog/a-photographers-guide-to-manarola-at-sunset"),
            ("L5", "/en/blog/the-ultimate-guide-to-cinque-terre-wines"),
        ]
    );
    assert_eq!(
        links.iter().map(|l| l.title.as_str()).collect::<Vec<_>>(),
        vec![
            "Manarola",
            "Food and Wine",
            "Hiking from Manarola",
            "A Photographer's Guide to Manarola at Sunset",
            "The Ultimate Guide to Cinque Terre Wines",
        ],
        "labels carry no brand suffix"
    );
    for link in &links {
        let entry = kb.pages.by_route(&link.route).expect("route exists");
        assert_eq!(entry.id, link.page_id);
        assert_eq!(kb.resolve_link(&link.page_id, "en").unwrap(), link.route);
    }
    assert_eq!(routes(&link_shortlist(&kb, &brief, 2)).len(), 2);

    // The article's own route is never offered, and a page is offered only in
    // the brief's language.
    let mut own = brief.clone();
    own.slug = "a-photographers-guide-to-manarola-at-sunset".into();
    assert!(link_shortlist(&kb, &own, LINK_SHORTLIST)
        .iter()
        .all(|l| l.route != "/en/blog/a-photographers-guide-to-manarola-at-sunset"));
    assert!(links
        .iter()
        .all(|l| l.route.starts_with("/en/") && l.page_id != "nur-deutsch"));
    let mut german = brief.clone();
    german.language = "de".into();
    let de = link_shortlist(&kb, &german, LINK_SHORTLIST);
    assert!(de.iter().all(|l| l.route.starts_with("/de/")), "{de:?}");
    assert!(de.iter().any(|l| l.page_id == "nur-deutsch"));

    // Nothing related: nothing offered, and the outline may name no link.
    let mut unrelated = brief.clone();
    unrelated.title = "Zzz".into();
    unrelated.angle = "Qqq".into();
    unrelated.keywords = vec!["xyzzy".into()];
    assert!(link_shortlist(&kb, &unrelated, LINK_SHORTLIST).is_empty());
}

#[test]
fn entity_facts_and_related_titles_come_from_the_indexes() {
    let kb = kb();
    let brief = brief();
    assert_eq!(
        entity_facts(&kb, &brief, 5),
        vec!["Manarola (village): also called wine village; known for wine, sunset, vineyards; next to Riomaggiore, Corniglia"]
    );
    assert_eq!(
        related_titles(&kb, &brief),
        vec![
            "A Photographer's Guide to Manarola at Sunset",
            "The Ultimate Guide to Cinque Terre Wines",
        ]
    );

    let mut walk = brief.clone();
    walk.title = "Walking the Via dell'Amore from Riomaggiore".into();
    walk.angle =
        "The path of love, reopened, and how to reach it on the Cinque Terre Express.".into();
    walk.keywords = vec!["Via dell'Amore".into(), "Riomaggiore".into()];
    assert_eq!(
        entity_facts(&kb, &walk, 5),
        vec![
            // Named in the title and keywords, and by its alias in the angle.
            "Via dell'Amore (trail): also called path of love; connects Riomaggiore, Manarola",
            "Riomaggiore (village): next to Manarola",
            // Named in the angle only.
            "Cinque Terre Express (transport): stops at Riomaggiore, Manarola",
        ]
    );
    assert_eq!(entity_facts(&kb, &walk, 1).len(), 1);
    assert!(related_titles(&kb, &walk).is_empty());

    assert_eq!(
        blog_categories(&blog_index()),
        vec!["Guides", "Food & Drink", "Culture"]
    );
    assert!(blog_categories(&json!({"body": []})).is_empty());
}

#[test]
fn shortlists_are_deterministic_and_the_same_from_a_knowledge_pack() {
    let brief = brief();
    let index = blog_index();
    let from_tree = article_context(&kb(), &brief, Some(&index), &BTreeSet::new());
    assert_eq!(
        from_tree,
        article_context(&kb(), &brief, Some(&index), &BTreeSet::new())
    );

    // The browser has no checkout: it loads the knowledge pack (ADR-0061).
    let pack = pack::build(&site(), "c0ffee").unwrap();
    let packed = pack::load(&pack::Pack::from_json(&pack.to_json().unwrap()).unwrap()).unwrap();
    let packed_index = pack.file_json(BLOG_INDEX).unwrap().unwrap();
    assert_eq!(
        from_tree,
        article_context(&packed, &brief, Some(&packed_index), &BTreeSet::new())
    );

    assert_eq!(from_tree.hero_aliases(), vec!["M1", "M2", "M3", "M4"]);
    assert_eq!(from_tree.link_aliases(), vec!["L1", "L2", "L3", "L4", "L5"]);
    assert_eq!(
        from_tree.categories,
        vec!["Guides", "Food & Drink", "Culture"]
    );
    // It is a stage result: it must survive the stage store.
    let stored: ArticleContext =
        serde_json::from_value(serde_json::to_value(&from_tree).unwrap()).unwrap();
    assert_eq!(stored, from_tree);
}

// ---------------------------------------------------------------- closed world

#[test]
fn an_outline_can_only_name_what_the_shortlists_offer() {
    let kb = kb();
    let brief = brief();
    let ctx = article_context(&kb, &brief, Some(&blog_index()), &BTreeSet::new());
    let schema = outline_schema(&ctx.hero_aliases(), &ctx.link_aliases(), &ctx.categories);
    let schema = jsonschema::validator_for(&schema).unwrap();

    let mut parts = parts();
    parts.outline.hero = "M1".into();
    parts.outline.links = vec!["L3".into(), "L2".into()];
    assert!(schema.is_valid(&serde_json::to_value(&parts.outline).unwrap()));

    let page = assemble(&parts, &brief, &ctx).unwrap();
    let validator = validator(kb);
    assert_eq!(validator.check(&page), vec![]);
    let body = page["body"].as_array().unwrap();
    assert_eq!(
        body[0]["image"],
        "https://images.unsplash.com/photo-1499678329028-101435549a4e?q=80&w=2000&auto=format&fit=crop"
    );
    assert_eq!(page["metadata"]["hero_media_id"], "manarola-sights-014");
    assert_eq!(page["metadata"]["inline_media_id"], "manarola-sights-001");
    assert_eq!(
        body.last().unwrap()["actions"],
        json!([
            {"label": "Hiking from Manarola", "href": "/en/manarola/hiking", "variant": "primary"},
            {"label": "Food and Wine", "href": "/en/culinary", "variant": "secondary"}
        ])
    );

    // An alias outside the shortlist is a schema error for the model and an
    // assembly error for the orchestrator: it cannot reach a page.
    for (hero, links) in [
        ("M5", vec!["L1"]),
        ("M1", vec!["L6"]),
        ("manarola-sights-014", vec![]),
    ] {
        let mut invented = parts.clone();
        invented.outline.hero = hero.into();
        invented.outline.links = links.into_iter().map(String::from).collect();
        assert!(!schema.is_valid(&serde_json::to_value(&invented.outline).unwrap()));
        assert!(matches!(
            assemble(&invented, &brief, &ctx),
            Err(AssembleError::UnknownHero(_) | AssembleError::UnknownLink(_))
        ));
    }
}

#[test]
fn the_golden_article_passes_the_v2_site_validator() {
    let validator = validator(kb());
    let page = golden();
    assert_eq!(validator.check(&page), vec![]);
    assert_eq!(PageValidator::validate(validator.as_ref(), &page), Ok(()));

    // The validator in use today is schema v1, which rejects the localized
    // `seo` the frozen theme reads.
    let context = SiteContext::new("cinqueterre.travel", style(), None).unwrap();
    let errors = site_validator(&context).validate(&page).unwrap_err();
    assert!(errors.iter().any(|e| e.contains("seo")), "{errors:?}");
}

fn only(issues: Vec<PageIssue>) -> PageIssue {
    assert_eq!(issues.len(), 1, "{issues:#?}");
    issues.into_iter().next().unwrap()
}

#[test]
fn invented_media_comes_back_scoped_to_its_section() {
    let validator = validator(kb());
    let mut page = golden();
    page["body"][0]["image"] =
        json!("https://images.unsplash.com/photo-invented-by-the-model?w=2000");
    let issue = only(validator.check(&page));
    assert_eq!(
        (issue.section, issue.pointer.as_str(), issue.code.as_str()),
        (Some(SectionId::Title), "/body/0/image", "media")
    );
    assert!(
        issue.message.contains("photo-invented-by-the-model"),
        "{issue}"
    );
    assert!(issue.to_string().starts_with("[title] /body/0/image: "));

    let mut page = golden();
    page["body"][10]["src"] = json!("media:no-such-image");
    let issue = only(validator.check(&page));
    assert_eq!(
        (issue.section, issue.pointer.as_str(), issue.code.as_str()),
        (Some(SectionId::Section(2)), "/body/10/src", "media")
    );
    // A site asset path that is not in the index is unknown too.
    let mut page = golden();
    page["body"][10]["src"] = json!("/images/made-up.png");
    assert_eq!(only(validator.check(&page)).code, "media");
    // A known image under another crop is the same image.
    let mut page = golden();
    page["body"][10]["src"] =
        json!("https://images.unsplash.com/photo-1538681105587-85640961bf8b?w=640");
    assert_eq!(validator.check(&page), vec![]);
}

#[test]
fn unknown_links_come_back_scoped_to_the_closing() {
    let validator = validator(kb());
    // The two hrefs of the one agent-written article that is live.
    for href in [
        "/hiking/sentiero-azzurro",
        "/stories/hiking",
        "/en/no-such-page",
        "/de/culinary/nope",
    ] {
        let mut page = golden();
        page["body"][14]["actions"][1]["href"] = json!(href);
        let issue = only(validator.check(&page));
        assert_eq!(
            (issue.section, issue.pointer.as_str(), issue.code.as_str()),
            (Some(SectionId::Closing), "/body/14/actions/1/href", "link"),
            "{href}"
        );
        assert!(issue.message.contains(href), "{issue}");
    }
    // External links and existing routes are fine as far as the closed world goes.
    for href in ["/en/culinary", "/en/manarola/", "/en"] {
        let mut page = golden();
        page["body"][14]["actions"][1]["href"] = json!(href);
        assert_eq!(validator.check(&page), vec![], "{href}");
    }
}

#[test]
fn house_style_and_schema_errors_are_scoped_too() {
    let validator = validator(kb());
    let mut page = golden();
    page["body"][4]["markdown"] = json!("The terraces are a hidden gem above the village.");
    page["body"][8]["items"][1] = json!("A must-see terrace.");
    page["body"][14]["title"] = json!("A legendary end");
    let issues = validator.check(&page);
    assert_eq!(
        issues.iter().map(ToString::to_string).collect::<Vec<_>>(),
        vec![
            "[s1] /body/4/markdown: banned phrase \"hidden gem\" (house style)",
            "[s2] /body/8/items/1: banned phrase \"must-see\" (house style)",
            "[closing] /body/14/title: banned phrase \"legendary\" (house style)",
        ]
    );
    assert!(issues.iter().all(|i| i.code == "house_style"));
    assert_eq!(
        PageValidator::validate(validator.as_ref(), &page)
            .unwrap_err()
            .len(),
        3,
        "the same issues, as the lines a repair turn is given"
    );

    // What the orchestrator wrote itself is not the writer's style problem: a
    // label is the linked page's title, keywords come from the brief.
    let mut page = golden();
    page["body"][14]["actions"][0]["label"] = json!("An iconic page title");
    page["seo"]["keywords"] = json!(["hidden gem"]);
    assert_eq!(validator.check(&page), vec![]);

    // Schema v2 and the article profile, with the section where there is one.
    let mut page = golden();
    page["body"][6]["level"] = json!(7);
    let issues = validator.check(&page);
    assert!(!issues.is_empty());
    assert!(
        issues
            .iter()
            .all(|i| i.section == Some(SectionId::Section(2)) && i.pointer.starts_with("/body/6")),
        "{issues:#?}"
    );
    assert!(
        issues.iter().any(|i| i.code == "schema") && issues.iter().any(|i| i.code == "profile")
    );

    let mut page = golden();
    page["surprise"] = json!(true);
    let issue = only(validator.check(&page));
    assert_eq!((issue.section, issue.code.as_str()), (None, "schema"));

    let mut page = golden();
    page["body"][4] = json!({"type": "quote", "text": "Nobody said this."});
    let issue = only(validator.check(&page));
    assert_eq!(
        (issue.section, issue.code.as_str()),
        (Some(SectionId::Section(1)), "profile"),
        "a valid core block that is not part of an article"
    );
}

// ---------------------------------------------------------------- the real site

/// Against the real site, from a clone (`CINQUETERRE_REPO=<clone>`: the
/// knowledge base is built with `DirSource` and compared with the pack built
/// from the same tree) or from a pack file (`CINQUETERRE_PACK=<file>` written
/// by `cargo xtask site-pack`: what the browser has):
/// `CINQUETERRE_REPO=/path/to/cinqueterre.travel cargo test -p orchestrator --test article -- --ignored --nocapture`
#[test]
#[ignore = "needs CINQUETERRE_REPO=<clone of cinqueterre.travel> or CINQUETERRE_PACK=<pack file>"]
fn the_real_site_yields_shortlists_that_resolve() {
    let (kb, site_pack, from_tree) = match std::env::var("CINQUETERRE_PACK") {
        Ok(file) => {
            let text = std::fs::read_to_string(&file).expect("readable pack file");
            let site_pack = pack::Pack::from_json(&text).unwrap();
            (pack::load(&site_pack).unwrap(), site_pack, false)
        }
        Err(_) => {
            let root = std::env::var("CINQUETERRE_REPO")
                .expect("set CINQUETERRE_REPO to the site clone or CINQUETERRE_PACK to a pack");
            let src = DirSource::new(root);
            let site_pack = pack::build(&src, "test").unwrap();
            (KnowledgeBase::build(&src).unwrap(), site_pack, true)
        }
    };
    assert!(
        kb.media.len() > 300 && kb.pages.len() > 100,
        "is this the real site?"
    );
    let index = site_pack
        .file_json(BLOG_INDEX)
        .unwrap()
        .expect("blog index");
    let style =
        StyleGuide::from_json_str(site_pack.file("content/config/style-guide.json").unwrap())
            .unwrap();
    let brief = brief();

    let ctx = article_context(&kb, &brief, Some(&index), &BTreeSet::new());
    println!("{}", serde_json::to_string_pretty(&ctx).unwrap());
    assert_eq!(ctx.heroes.len(), HERO_SHORTLIST);
    assert!(!ctx.links.is_empty() && ctx.links.len() <= LINK_SHORTLIST);
    assert_eq!(
        ctx.categories,
        vec!["Guides", "Food & Drink", "Culture", "Photography", "Hotels"]
    );
    assert!(
        ctx.facts[0].starts_with("Manarola (village)"),
        "{:?}",
        ctx.facts
    );

    // Every shortlist entry resolves in the knowledge base.
    let used = used_hero_images(&kb, Some(&index));
    assert!(!used.is_empty());
    for hero in &ctx.heroes {
        assert_eq!(kb.resolve_media(&hero.media_id).unwrap().url, hero.url);
        assert!(
            !used.contains(content_model::url_identity(&hero.url)),
            "{} is already a hero",
            hero.media_id
        );
        assert!(!hero.alt.is_empty());
    }
    for link in &ctx.links {
        assert_eq!(
            kb.pages.by_route(&link.route).expect("route exists").id,
            link.page_id
        );
    }
    // The pack the browser loads gives the same context as the tree.
    if from_tree {
        let packed = pack::load(&site_pack).unwrap();
        assert_eq!(
            ctx,
            article_context(&packed, &brief, Some(&index), &BTreeSet::new())
        );
    }

    // Assemble the fixture article against the real shortlists.
    let mut parts = parts();
    parts.outline.hero = ctx.heroes[0].alias.clone();
    parts.outline.links = ctx.links.iter().take(2).map(|l| l.alias.clone()).collect();
    let page = assemble(&parts, &brief, &ctx).unwrap();
    println!("{}", serde_json::to_string_pretty(&page).unwrap());

    let validator = SiteValidatorV2::new(Arc::new(kb.clone()), style);
    assert_eq!(validator.check(&page), vec![]);
    let media = kb.check_media(&page);
    assert_eq!(
        (media.checked, media.unknown.len()),
        (2, 0),
        "hero and inline image"
    );
    let links = kb.check_links(&page);
    assert_eq!((links.checked, links.broken.len()), (2, 0));
    for action in page["body"].as_array().unwrap().last().unwrap()["actions"]
        .as_array()
        .unwrap()
    {
        assert!(kb
            .pages
            .by_route(action["href"].as_str().unwrap())
            .is_some());
    }
    // The slug is free on the real site.
    assert!(kb
        .pages
        .by_route("/en/blog/harvest-week-in-manarola")
        .is_none());
}
