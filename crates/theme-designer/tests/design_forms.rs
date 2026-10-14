//! The design's forms in the theme (FEAT-115): the component styles from the tokens, the
//! sections' shapes and design markup, links as menus per language, fields as bindings, the
//! design's placeholders refused, and the visual check's repair turns.
mod common;

use common::*;
use theme_designer::check::placeholder;
use theme_designer::visual::{
    repairs, score, VisualPage, VisualRegion, VisualReport, VISUAL_THRESHOLD,
};
use theme_designer::{check_template, IssueCode, TaskKind};

#[test]
fn component_styles_come_from_the_tokens_and_colour_each_place() {
    let p = dispatch_full_tokens();
    let css = &p.global_styles.css;
    // The vocabulary is there, with the design's values, and no placeholder is left unfilled.
    for class in [
        ".ds-wrap",
        ".ds-eyebrow",
        ".ds-tiles",
        ".ds-cards",
        ".ds-rows",
        ".ds-ledger",
        ".ds-masthead",
        ".ds-footer",
        ".ds-know",
    ] {
        assert!(css.contains(class), "{class} is styled");
    }
    let unfilled = css
        .split('@')
        .skip(1)
        .step_by(2)
        .any(|w| !w.is_empty() && w.chars().all(|c| c.is_ascii_lowercase() || c == '-'));
    assert!(!unfilled, "every value filled");
    assert!(css.contains("var(--wp--preset--color--ink)"));
    assert!(css.contains("var(--wp--preset--font-family--ibm-plex-mono)"));
    // Each place's pigment, from the token named after it.
    assert!(
        css.contains(".sp_place-vernazza{--ds-pigment:var(--wp--preset--color--v-vernazza)}"),
        "{css}"
    );
    assert!(
        css.contains(".sp_place-riomaggiore{--ds-pigment:var(--wp--preset--color--v-riomaggiore)}")
    );
    // The vocabulary is listed for the model, every class once.
    let names: Vec<&str> = theme_designer::components::VOCABULARY
        .iter()
        .map(|(c, _)| *c)
        .collect();
    let mut sorted = names.clone();
    sorted.sort_unstable();
    sorted.dedup();
    assert_eq!(sorted.len(), names.len());
    assert!(names.iter().all(|c| c.starts_with("ds-")));
}

#[test]
fn sections_carry_their_shape_markup_fields_and_links() {
    let p = dispatch_full_tokens();
    let front = p.tasks.iter().find(|t| t.slug == "front-page").unwrap();
    let shape = |id: &str| {
        front
            .sections
            .iter()
            .find(|s| s.id == id)
            .and_then(|s| s.shape.clone())
    };
    assert_eq!(shape("hero").as_deref(), Some("hero"));
    assert_eq!(shape("query-collection").as_deref(), Some("tiles"));
    assert_eq!(shape("query-featured").as_deref(), Some("feature"));
    assert_eq!(shape("query-collection-2").as_deref(), Some("cards"));
    assert_eq!(shape("query-latest").as_deref(), Some("rows"));
    assert_eq!(shape("content").as_deref(), Some("band"));
    let villages = front
        .sections
        .iter()
        .find(|s| s.id == "query-collection")
        .unwrap();
    assert_eq!(villages.query.as_ref().unwrap()["postType"], "sp_village");
    assert!(villages.fields.contains(&"number".to_string()));
    assert!(
        villages.html.as_deref().unwrap().contains("01"),
        "the design's markup"
    );
    // A link the design writes and the site has: a one-item menu per language.
    let latest = front
        .sections
        .iter()
        .find(|s| s.id == "query-latest")
        .unwrap();
    assert_eq!(latest.links[0].class, "sp-menu-link-all-stories");
    let menus: Vec<_> = p
        .navigation
        .iter()
        .filter(|m| m.name == "link-all-stories")
        .collect();
    assert_eq!(menus.len(), 4);
    assert_eq!(menus[1].items[0].url, "/de/blog/");
    // The image band shows the site's picture of what the design names.
    let band = front.sections.iter().find(|s| s.id == "image").unwrap();
    assert_eq!(
        band.image.as_ref().unwrap().url,
        "https://images.example/vernazza.jpg"
    );
    // The homes of the other languages render as the front page.
    let data = theme_designer::assemble(&p, &sketches(&p));
    assert!(data
        .templates
        .iter()
        .any(|t| t.slug == theme_designer::plan::LANGUAGE_HOME));
}

#[test]
fn fields_only_by_binding_and_never_the_designs_placeholders() {
    assert_eq!(placeholder("[°] SEA").as_deref(), Some("[°]"));
    assert_eq!(placeholder("Photo: [CREDIT]").as_deref(), Some("[CREDIT]"));
    assert_eq!(placeholder("see [the map](/maps)"), None);
    assert_eq!(placeholder("no brackets"), None);
    let p = dispatch_full_tokens();
    let parts = p.part_slugs();
    let front = p.tasks.iter().find(|t| t.slug == "front-page").unwrap();
    let good = theme_designer::sketch::template(front, &p.presets);
    assert!(check_template(front, &good, &p.context(&parts)).is_empty());
    // A field the entries do not have, or a source other than the entry's fields.
    let bad = good.replacen(
        "\"args\":{\"key\":\"number\"}",
        "\"args\":{\"key\":\"secret\"}",
        1,
    );
    let issues = check_template(front, &bad, &p.context(&parts));
    assert!(
        issues
            .iter()
            .any(|i| i.code == IssueCode::Query
                && i.message.contains("the field \"secret\" is none")),
        "{issues:#?}"
    );
    let bad = good.replacen(
        "\"source\":\"core/post-meta\"",
        "\"source\":\"core/site-option\"",
        1,
    );
    let issues = check_template(front, &bad, &p.context(&parts));
    assert!(
        issues
            .iter()
            .any(|i| i.message.contains("only \"core/post-meta\"")),
        "{issues:#?}"
    );
    // The design's placeholder copy.
    let bad = good.replacen(
        "<p class=\"ds-eyebrow\">Travel guide",
        "<p class=\"ds-eyebrow\">[°] Travel guide",
        1,
    );
    let issues = check_template(front, &bad, &p.context(&parts));
    assert!(
        issues
            .iter()
            .any(|i| i.code == IssueCode::Rule && i.message.contains("\"[°]\" is a placeholder")),
        "{issues:#?}"
    );
}

#[test]
fn the_visual_check_asks_for_repairs_of_the_regions_furthest_from_the_design() {
    let p = dispatch_full_tokens();
    let region = |name: &str, similarity: u32, found: bool| VisualRegion {
        name: name.into(),
        weight: 100,
        similarity,
        found,
        site_html: found.then(|| format!("<section class=\"sp-{name}\">…</section>")),
    };
    let page = |width: u32, score: u32, regions: Vec<VisualRegion>| VisualPage {
        template: "front-page".into(),
        site: "/".into(),
        width,
        compared: true,
        reason: None,
        score,
        whole: 0,
        regions,
    };
    let report = VisualReport {
        pages: vec![
            page(
                375,
                720,
                vec![
                    region("hero", 650, true),
                    region("query-latest", 0, false),
                    region("header", 700, true),
                    region("image", 900, true),
                ],
            ),
            page(1280, 850, vec![region("hero", 790, true)]),
            VisualPage {
                compared: false,
                reason: Some("no layout".into()),
                ..page(1440, 0, vec![])
            },
        ],
    };
    assert_eq!(score(&report), Some(8), "the compared pages' mean");
    assert_eq!(report.worst_of("front-page"), Some(720));
    let fixes = repairs(&report, &p);
    // The header is the part's to fix; the sections the template's; the good region not at all.
    let labels: Vec<&str> = fixes.iter().map(|f| f.task.as_str()).collect();
    assert_eq!(labels, ["part header", "template front-page"]);
    let front = &fixes[1].regions;
    let missing = front.find("### query-latest").unwrap();
    let hero = front.find("### hero").unwrap();
    assert!(missing < hero, "a missing region first");
    assert!(front.contains("(the page has no element with this region's class)"));
    assert!(front.contains("650 at 375 px"), "{front}");
    assert!(front.contains("The design's markup:"));
    assert!(!front.contains("### image"));
    const { assert!(VISUAL_THRESHOLD > 700) };
    // Nothing to repair once every page looks like its design.
    let fine = VisualReport {
        pages: vec![page(375, 900, vec![region("hero", 850, true)])],
    };
    assert!(repairs(&fine, &p).is_empty());
    assert!(p.tasks.iter().any(|t| t.kind == TaskKind::Part));
    // The summary drops the rendered markup.
    assert!(report.summary().pages[0].regions[0].site_html.is_none());
}
