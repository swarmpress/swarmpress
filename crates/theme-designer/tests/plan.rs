//! The theme's plan for cinqueterre.travel's design (FEAT-115): the deterministic part,
//! the tasks, the reference rendering through every check, and the fake designer.
mod common;

use common::*;
use serde_json::json;
use theme_designer::fake::{self, PRESETS_MARK, TASK_MARK};
use theme_designer::{assemble, check_template, check_theme, IssueCode, SiteContext, TaskKind};

fn slugs(p: &theme_designer::ThemePlan) -> Vec<String> {
    p.tasks.iter().map(|t| t.label()).collect()
}

#[test]
fn the_style_guide_becomes_parts_templates_presets_fonts_and_menus() {
    let bundle = dispatch_mini();
    let (_, p) = plan_of(&bundle, &cinqueterre());
    assert_eq!(
        slugs(&p),
        [
            "part header",
            "part footer",
            "template front-page",
            "template index",
            "template single",
            "template page",
            "template 404",
            "template archive"
        ]
    );
    assert_eq!(
        p.required,
        ["404", "archive", "front-page", "index", "page", "single"]
    );
    // palette and roles
    assert_eq!(p.presets.colors["ink"], "#0F1E2E");
    assert_eq!(p.presets.colors["notte"], "#0B1622");
    assert_eq!(p.presets.role("text"), Some("ink"));
    assert_eq!(p.presets.role("background"), Some("paper"));
    assert_eq!(p.presets.role("link"), Some("mare"));
    assert_eq!(p.presets.role("inverse"), Some("salt"));
    let st = &p.global_styles.styles;
    assert_eq!(st["color"]["text"], "var:preset|color|ink");
    assert_eq!(
        st["elements"]["link"]["color"]["text"],
        "var:preset|color|mare"
    );
    assert_eq!(p.global_styles.version, 3);
    // one face per weight and style, its file's hash from the bundle
    let mono = &p.fonts[0];
    assert_eq!(mono.name, "IBM Plex Mono");
    assert_eq!(mono.faces.len(), 1);
    let entry = bundle
        .manifest()
        .files
        .into_iter()
        .find(|f| f.path == mono.faces[0].file.path)
        .unwrap();
    assert_eq!(mono.faces[0].file.sha256, entry.sha256);
    // menus per language, links from the site, the language switch
    let villages: Vec<_> = p
        .navigation
        .iter()
        .filter(|m| m.name == "villages")
        .collect();
    assert_eq!(villages.len(), 4);
    assert_eq!(villages[1].lang, "de");
    assert_eq!(villages[1].items[3].url, "/de/vernazza/");
    assert!(p
        .navigation
        .iter()
        .any(|m| m.name == "languages" && m.items.len() == 4));
    assert!(p
        .navigation
        .iter()
        .all(|m| m.items.iter().all(|i| !i.url.starts_with('#'))));
    let notes: Vec<&str> = p.notes.iter().map(|n| n.message.as_str()).collect();
    assert!(notes
        .iter()
        .any(|n| n.starts_with("\"Itineraries\" has no page on the site")));
    // the header shows its menus; the front page its sections, bound to the site
    let header = &p.tasks[0];
    let menus: Vec<&str> = header.menus.iter().map(|m| m.class.as_str()).collect();
    assert_eq!(menus, ["sp-menu-villages", "sp-menu-languages"]);
    let front = &p.tasks[2];
    let bound: Vec<(&str, Option<&str>)> = front
        .sections
        .iter()
        .map(|s| (s.id.as_str(), s.collection.as_deref()))
        .collect();
    assert_eq!(
        bound,
        [
            ("hero", None),
            ("image", None),
            ("query-collection", Some("villages")),
            ("query-featured", Some("editors-picks")),
            ("query-collection-2", Some("stays")),
            ("query-latest", Some("latest-stories")),
            ("content", None)
        ]
    );
    assert_eq!(front.sections[1].background.as_deref(), Some("v-vernazza"));
    assert_eq!(front.sections[5].query.as_ref().unwrap()["perPage"], 6);
}

#[test]
fn every_reference_rendering_passes_and_the_theme_assembles() {
    for (bundle, site) in [(dispatch_mini(), cinqueterre())] {
        let (_, p) = plan_of(&bundle, &site);
        let s = sketches(&p);
        let parts = p.part_slugs();
        for t in &p.tasks {
            let issues = check_template(t, &s[&t.label()], &p.context(&parts));
            assert!(issues.is_empty(), "{}: {issues:#?}", t.label());
        }
        let data = assemble(&p, &s);
        assert_eq!(data.validate_shape(), vec![]);
        assert_eq!(check_theme(&data, &p), vec![]);
        // The design's templates, the required ones, and the front page again for the other
        // languages' homes (`page-front`).
        assert_eq!(data.templates.len(), 7);
        assert_eq!(data.template_parts.len(), 2);
    }
}

#[test]
fn same_input_same_bytes() {
    let (_, a) = plan_of(&dispatch_mini(), &cinqueterre());
    let (_, b) = plan_of(&dispatch_mini(), &cinqueterre());
    assert_eq!(
        serde_json::to_string(&a).unwrap(),
        serde_json::to_string(&b).unwrap()
    );
    let da = serde_json::to_string(&assemble(&a, &sketches(&a))).unwrap();
    let db = serde_json::to_string(&assemble(&b, &sketches(&b))).unwrap();
    assert_eq!(da, db);
}

#[test]
fn sections_without_a_collection_are_left_out_with_a_note() {
    let site = SiteContext {
        collections: Vec::new(),
        ..cinqueterre()
    };
    let (_, p) = plan_of(&dispatch_mini(), &site);
    let front = p.tasks.iter().find(|t| t.slug == "front-page").unwrap();
    assert!(front.sections.iter().all(|s| s.kind != "query"));
    assert!(p.notes.iter().any(|n| n.code == IssueCode::Note
        && n.message
            .starts_with("section query-latest (Latest stories)")));
}

#[test]
fn the_full_style_guide_plans_every_listing_when_present() {
    let Some(bundle) = full_export() else {
        eprintln!("skipped: the owner's export is not on this machine");
        return;
    };
    let (_, p) = plan_of(&bundle, &cinqueterre());
    assert_eq!(
        slugs(&p)[2..7],
        [
            "template front-page",
            "template archive-activity",
            "template archive-restaurant",
            "template archive-weather",
            "template archive-editor"
        ]
    );
    let families: Vec<&str> = p.fonts.iter().map(|f| f.name.as_str()).collect();
    assert_eq!(
        families,
        ["Bodoni Moda", "IBM Plex Mono", "Schibsted Grotesk"]
    );
    assert!(p.presets.font_sizes.contains("eyebrow"));
    assert!(p.presets.large_sizes.contains("h-1") && !p.presets.large_sizes.contains("body"));
    assert!(p.global_styles.css.contains(
        ".has-eyebrow-font-size{line-height:1.2;letter-spacing:0.14em;text-transform:uppercase"
    ));
    assert_eq!(p.rules.len(), 10);
    let s = sketches(&p);
    let data = assemble(&p, &s);
    assert_eq!(check_theme(&data, &p), vec![]);
}

fn prompt(task: &theme_designer::TemplateTask, p: &theme_designer::ThemePlan) -> String {
    format!(
        "## Task: web design template\n\n{TASK_MARK}\n```json\n{}\n```\n\n{PRESETS_MARK}\n```json\n{}\n```\n",
        serde_json::to_string(task).unwrap(),
        serde_json::to_string(&p.presets).unwrap()
    )
}

#[test]
fn the_fake_slips_once_on_the_front_page_and_fixes_it() {
    let (_, p) = plan_of(&dispatch_mini(), &cinqueterre());
    let parts = p.part_slugs();
    let ctx = p.context(&parts);
    for t in &p.tasks {
        let first = fake::answer(&prompt(t, &p), false);
        let issues = check_template(t, first["content"].as_str().unwrap(), &ctx);
        if t.slug == fake::SLIP_TEMPLATE {
            assert_eq!(issues.len(), 1, "{issues:#?}");
            assert_eq!(issues[0].code, IssueCode::Token);
            assert!(
                issues[0]
                    .message
                    .contains("sets the raw colour #0F1E2E in \"text\""),
                "{}",
                issues[0].message
            );
        } else {
            assert!(issues.is_empty(), "{}: {issues:#?}", t.label());
        }
        let fixed = fake::answer(&prompt(t, &p), true);
        assert!(check_template(t, fixed["content"].as_str().unwrap(), &ctx).is_empty());
    }
    assert_eq!(fake::answer("no task here", false), json!({"content": ""}));
    assert!(p.tasks.iter().any(|t| t.kind == TaskKind::Part));
}
