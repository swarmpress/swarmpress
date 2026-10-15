//! The design's components and the source site's navigation kept (ADR-0093 addendum, 2026-10-14):
//! the navigation from the source menus and its parity check, the components mapped to the
//! site's content and page types, the coverage report and its errors; one failing fixture per
//! check, and seeded mutations that every check catches.
mod common;

use std::collections::BTreeMap;

use common::*;
use site_design::model::{Component, Icon, SiteDesign};
use site_design::wordpress::{NavigationItem, ThemeData};
use theme_designer::catalog::{coverage, marker};
use theme_designer::model::{Featured, MenuArea, PageType, Retired, SourceMenu};
use theme_designer::navigation::check_navigation;
use theme_designer::{assemble, check_template, check_theme, IssueCode, SiteContext, ThemePlan};

fn item(label: &str, url: &str, children: Vec<NavigationItem>) -> NavigationItem {
    NavigationItem {
        label: label.into(),
        url: url.into(),
        children,
        class: None,
    }
}

fn component(
    slug: &str,
    number: &str,
    name: &str,
    subtitle: Option<&str>,
    labels: &[&str],
) -> Component {
    let spans: String = labels
        .iter()
        .map(|l| format!("<span class=\"mono\">{l}</span>"))
        .collect();
    Component {
        slug: slug.into(),
        name: name.into(),
        number: Some(number.into()),
        subtitle: subtitle.map(String::from),
        page: "pages/04-components.html".into(),
        notes: Vec::new(),
        html: format!("<div><div class=\"mono\">{number} {name}</div><div>{spans}</div></div>"),
        functions: site_design::components::functions_of(name, subtitle),
        variants: Vec::new(),
        states: Vec::new(),
        css: String::new(),
    }
}

/// The trimmed style guide with a components sheet and an icon set.
fn design() -> (site_design::DesignBundle, SiteDesign) {
    let bundle = dispatch_mini();
    let mut d = site_design::interpret(&bundle);
    d.components = vec![
        component(
            "masthead-village-menu",
            "4.1",
            "Masthead & village menu",
            None,
            &[],
        ),
        component("buttons", "4.2", "Buttons", None, &[]),
        component(
            "trail-ledger",
            "4.5",
            "Trail Ledger",
            Some("replaces inline trail stats"),
            &["Distance", "Time", "Grade"],
        ),
        component(
            "essentials-ticker",
            "4.6",
            "Essentials ticker",
            None,
            &["Sea", "Sunset"],
        ),
        component(
            "editorial-callouts",
            "4.7",
            "Editorial callouts",
            None,
            &["Local wisdom", "Trail notice"],
        ),
        component("dateline-byline", "4.8", "Dateline & byline", None, &[]),
        component(
            "page-header",
            "4.9",
            "Page header",
            Some("breadcrumb, eyebrow, H1, lede, dateline"),
            &[],
        ),
        component(
            "contents-rail-progress",
            "4.10",
            "Contents rail + progress",
            None,
            &[],
        ),
        component("search-overlay", "4.11", "Search overlay", None, &[]),
        component("form-controls", "4.12", "Form controls", None, &[]),
        component(
            "accordion",
            "4.13",
            "Accordion",
            Some("FAQ, practical matters"),
            &[],
        ),
        component(
            "gallery",
            "4.16",
            "Gallery",
            Some("full-bleed, counter, captions"),
            &[],
        ),
        component(
            "pagination-load-more",
            "4.17",
            "Pagination & load more",
            None,
            &[],
        ),
        component("loading", "4.19", "Loading", None, &[]),
        component("mobile-menu-390", "4.20", "Mobile menu (390)", None, &[]),
        component("continue-reading", "4.21", "Continue reading", None, &[]),
    ];
    d.icons = vec![
        Icon {
            id: "ct-pin".into(),
            name: "pin".into(),
            group: "interface".into(),
            paths: vec!["M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z".into()],
            colour: None,
            label: None,
        },
        Icon {
            id: "ct-wx-rain".into(),
            name: "rain".into(),
            group: "weather".into(),
            paths: vec!["M8 17l-1 3".into()],
            colour: None,
            label: None,
        },
    ];
    (bundle, d)
}

/// cinqueterre.travel with its source menus (two villages with their sections, the footer's
/// columns, the wordmark), three page types and a featured story.
fn site() -> SiteContext {
    let mut s = cinqueterre();
    for lang in ["en", "de", "fr", "it"] {
        let l = |p: &str| format!("/{lang}/{p}");
        s.menus.push(SourceMenu {
            name: "nav".into(),
            lang: lang.into(),
            area: MenuArea::Header,
            items: [
                "riomaggiore",
                "manarola",
                "corniglia",
                "vernazza",
                "monterosso",
            ]
            .iter()
            .map(|v| {
                let name = format!("{}{}", v[..1].to_uppercase(), &v[1..]);
                item(
                    &name,
                    &l(&format!("{v}/")),
                    vec![
                        item("Overview", &l(&format!("{v}/")), vec![]),
                        item("Hiking", &l(&format!("{v}/hiking/")), vec![]),
                        item("Weather", &l(&format!("{v}/weather/")), vec![]),
                    ],
                )
            })
            .collect(),
        });
        s.menus.push(SourceMenu {
            name: "footer".into(),
            lang: lang.into(),
            area: MenuArea::Footer,
            items: vec![
                item(
                    "Explore",
                    "",
                    vec![
                        item("Cinque Terre", &l("cinque-terre/"), vec![]),
                        item("Stories", &l("blog/"), vec![]),
                    ],
                ),
                item("About", "", vec![item("Our Team", &l("team/"), vec![])]),
            ],
        });
        s.menus.push(SourceMenu {
            name: "brand".into(),
            lang: lang.into(),
            area: MenuArea::Other,
            items: vec![item("Cinque Terre", &l(""), vec![])],
        });
        s.featured.push(Featured {
            place: "vernazza".into(),
            lang: lang.into(),
            title: "A Local's Guide to Vernazza".into(),
            url: l("blog/locals-guide-to-vernazza/"),
            image: Some("https://images.example/v.jpg".into()),
        });
    }
    let pt = |key: &str, template: &str, post: bool, kinds: &[&str]| PageType {
        key: key.into(),
        label: key.into(),
        template: template.into(),
        count: 4,
        sample: format!("/en/{key}/"),
        kinds: kinds.iter().map(|k| (k.to_string(), 4)).collect(),
        post,
        placed: false,
    };
    s.page_types = vec![
        pt(
            "faq",
            "page-faq",
            false,
            &["ct-faq-section", "ct-giulia-comment"],
        ),
        pt(
            "village-hiking",
            "page-village-hiking",
            false,
            &["ct-facts", "ct-practical-info", "ct-editorial-hero"],
        ),
        pt(
            "article",
            "single",
            true,
            &["ct-contents", "ct-byline", "ct-continue-reading"],
        ),
    ];
    s
}

fn made() -> (SiteDesign, ThemePlan, ThemeData, SiteContext) {
    let (bundle, d) = design();
    let s = site();
    let p = theme_designer::plan(&d, &bundle.manifest(), &s);
    let data = assemble(&p, &sketches(&p));
    (d, p, data, s)
}

#[test]
fn the_navigation_keeps_every_source_entry_nested_in_the_designs_menus() {
    let (_, p, data, s) = made();
    let villages: Vec<_> = data
        .navigation
        .iter()
        .filter(|m| m.name == "villages")
        .collect();
    assert_eq!(
        villages.len(),
        4,
        "the design's villages menu in every language"
    );
    let de = villages.iter().find(|m| m.lang == "de").unwrap();
    // The source's German menu, its submenus kept; each place's panel has its head and featured story.
    let v = de.items.iter().find(|i| i.url == "/de/vernazza/").unwrap();
    assert!(v.children.iter().any(|c| c.url == "/de/vernazza/hiking/"));
    assert_eq!(v.children[0].class.as_deref(), Some("ds-panel-head"));
    assert!(v
        .children
        .iter()
        .any(|c| c.class.as_deref() == Some("ds-featured")));
    // The footer's columns take the design's footer menus; the wordmark its own.
    assert!(data
        .navigation
        .iter()
        .any(|m| m.name == "brand" && m.items[0].label.contains("<em>")));
    assert_eq!(check_navigation(&data.navigation, &s), vec![]);
    let header = p.tasks.iter().find(|t| t.slug == "header").unwrap();
    assert_eq!(header.brand.as_deref(), Some("brand"));
    assert!(header
        .menus
        .iter()
        .any(|m| m.name == "villages" && m.components.contains(&"mobile-menu-390".to_string())));
}

#[test]
fn a_lost_or_flattened_entry_fails_and_a_retired_one_is_noted() {
    let (_, _, data, mut s) = made();
    // Lost: Hiking under Manarola in English.
    let mut lost = data.navigation.clone();
    for m in lost
        .iter_mut()
        .filter(|m| m.name == "villages" && m.lang == "en")
    {
        for it in &mut m.items {
            if it.url == "/en/manarola/" {
                it.children.retain(|c| c.url != "/en/manarola/hiking/");
            }
        }
    }
    let issues = check_navigation(&lost, &s);
    assert_eq!(issues.len(), 1, "{issues:#?}");
    assert_eq!(issues[0].code, IssueCode::Missing);
    assert!(
        issues[0].message.contains("/en/manarola/hiking/"),
        "{}",
        issues[0].message
    );
    // Flattened: the same entry at the top level, no longer under its village.
    let mut flat = lost.clone();
    for m in flat
        .iter_mut()
        .filter(|m| m.name == "villages" && m.lang == "en")
    {
        m.items.push(item("Hiking", "/en/manarola/hiking/", vec![]));
    }
    let issues = check_navigation(&flat, &s);
    assert!(
        issues[0].message.contains("under /en/manarola/"),
        "{}",
        issues[0].message
    );
    // Retired with a reason: a note, not an error.
    s.retired.push(Retired {
        url: "/en/manarola/hiking/".into(),
        reason: "the owner's decision".into(),
    });
    let issues = check_navigation(&lost, &s);
    assert!(issues.iter().all(|i| !i.is_error()), "{issues:#?}");
    assert!(issues[0].message.contains("retired"));
}

#[test]
fn components_serve_the_content_and_unused_ones_say_why() {
    let (d, p, data, _) = made();
    let parts = p.part_slugs();
    for t in &p.tasks {
        let m = theme_designer::sketch::template(t, &p.presets);
        assert_eq!(
            check_template(t, &m, &p.context(&parts)),
            vec![],
            "{}",
            t.label()
        );
    }
    assert_eq!(check_theme(&data, &p), vec![]);
    let (report, issues) = coverage(&d, &p, &data);
    assert_eq!(issues, vec![], "{issues:#?}");
    let by: BTreeMap<&str, &theme_designer::catalog::ComponentUse> = report
        .components
        .iter()
        .map(|c| (c.slug.as_str(), c))
        .collect();
    // Content → components, as block styles on the pages that have it.
    assert!(by["accordion"]
        .used_in
        .iter()
        .any(|u| u.contains("ct-faq-section") && u.contains("is-style-accordion")));
    assert!(by["trail-ledger"]
        .used_in
        .iter()
        .any(|u| u.contains("ct-facts")));
    assert!(by["editorial-callouts"]
        .used_in
        .iter()
        .any(|u| u.contains("is-style-editorial-callouts-local-wisdom")));
    assert!(by["continue-reading"]
        .used_in
        .iter()
        .any(|u| u.contains("ct-continue-reading")));
    // Templates and parts → components.
    assert!(by["masthead-village-menu"]
        .used_in
        .contains(&"part header".to_string()));
    assert!(by["mobile-menu-390"]
        .used_in
        .contains(&"part header".to_string()));
    assert!(by["search-overlay"]
        .used_in
        .contains(&"part header".to_string()));
    assert!(by["page-header"]
        .used_in
        .iter()
        .any(|u| u == "template page-faq"));
    assert!(by["contents-rail-progress"]
        .used_in
        .iter()
        .any(|u| u == "template single"));
    assert!(by["pagination-load-more"]
        .used_in
        .iter()
        .any(|u| u == "template archive"));
    // Unused, each with its reason.
    assert!(by["form-controls"]
        .unused
        .as_deref()
        .unwrap()
        .contains("no form"));
    assert!(by["gallery"]
        .unused
        .as_deref()
        .unwrap()
        .contains("no content of this kind"));
    assert!(by["loading"]
        .unused
        .as_deref()
        .unwrap()
        .contains("nothing loads later"));
    // Every page type on a template of its own, with its components.
    for pt in &report.page_types {
        assert!(!pt.generic, "{pt:?}");
    }
    let faq = report.page_types.iter().find(|p| p.key == "faq").unwrap();
    assert!(faq.components.contains(&"accordion".to_string()));
    assert!(faq.components.contains(&"page-header".to_string()));
    // The page types have templates; the files are the sprite and the audited script.
    assert!(data
        .templates
        .iter()
        .any(|t| t.slug == "page-village-hiking"));
    assert!(data
        .files
        .iter()
        .any(|f| f.path == "icons.svg" && f.content.contains("id=\"ct-wx-rain\"")));
    assert!(data.files.iter().any(|f| f.path == "ds.js"));
    assert_eq!(data.validate_shape(), vec![]);
}

#[test]
fn each_coverage_check_fails_its_fixture() {
    let (d, p, data, _) = made();
    // Content the design has a component for, without its block style.
    let mut no_style = data.clone();
    no_style.block_styles.retain(|b| b.component != "accordion");
    let (_, issues) = coverage(&d, &p, &no_style);
    assert!(
        issues.iter().any(|i| i
            .message
            .contains("ct-faq-section (faq) has no block style")),
        "{issues:#?}"
    );
    assert!(
        issues.iter().any(|i| i.at == "component 4.13"),
        "{issues:#?}"
    );
    // A part without a component's instance: the mobile menu is on the site's header no more.
    let mut no_marker = data.clone();
    for p in &mut no_marker.template_parts {
        p.content = p.content.replace(&marker("mobile-menu-390"), "");
    }
    let (_, issues) = coverage(&d, &p, &no_marker);
    assert!(
        issues
            .iter()
            .any(|i| i.at == "component 4.20" && i.message.contains("Mobile menu")),
        "{issues:#?}"
    );
    // A page type without its template renders generically.
    let mut no_template = data.clone();
    no_template.templates.retain(|t| t.slug != "page-faq");
    let (report, issues) = coverage(&d, &p, &no_template);
    assert!(
        issues.iter().any(|i| i.at == "page type faq"),
        "{issues:#?}"
    );
    assert!(report
        .page_types
        .iter()
        .any(|p| p.key == "faq" && p.generic));
}

#[test]
fn a_template_without_its_components_marker_fails_its_check() {
    let (_, p, _, _) = made();
    let parts = p.part_slugs();
    let t = p.tasks.iter().find(|t| t.slug == "page-faq").unwrap();
    let good = theme_designer::sketch::template(t, &p.presets);
    let bad = good.replace(&marker("page-header"), "");
    let issues = check_template(t, &bad, &p.context(&parts));
    assert!(
        issues
            .iter()
            .any(|i| i.code == IssueCode::Missing && i.message.contains("page-header")),
        "{issues:#?}"
    );
}

#[test]
fn the_component_css_stays_within_the_storage_layers_limits() {
    let (_, p, _, _) = made();
    let css = &p.global_styles.css;
    // The governed storage rebuilds a string with a backslash and quotes from pieces: keep both out.
    assert!(!css.contains('\\'), "no backslash in the CSS");
    assert!(
        css.matches('\'').count() <= 20,
        "{} single quotes",
        css.matches('\'').count()
    );
    // Every component form and the micro-interactions with their reduced-motion fallbacks.
    for want in [
        ".is-style-accordion",
        ".is-style-trail-ledger",
        ".ds-nav-dots .wp-block-navigation__container>.has-child>.wp-block-navigation__submenu-container",
        "prefers-reduced-motion:reduce",
        "--ds-ease-tide",
        ".ds-i-ct-pin",
        ".ct-wx-rain",
    ] {
        assert!(css.contains(want), "missing {want}");
    }
}

struct Lcg(u64);

impl Lcg {
    fn next(&mut self, n: u64) -> u64 {
        self.0 = self
            .0
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        (self.0 >> 33) % n.max(1)
    }
}

/// Seeded mutations of a theme that passes: a source entry dropped from a menu, or a component's
/// marker dropped from a template or part. Every one is caught.
#[test]
fn every_navigation_and_coverage_mutant_is_caught() {
    let (d, p, data, s) = made();
    let mut g = Lcg(0x0a7_15ec);
    let mut caught = 0;
    for _ in 0..60 {
        let mut m = data.clone();
        if g.next(2) == 0 {
            // A source entry (with a link) dropped from the theme's menus.
            let menus: Vec<usize> = (0..m.navigation.len())
                .filter(|i| {
                    !m.navigation[*i].name.starts_with("link-")
                        && m.navigation[*i].name != "languages"
                })
                .collect();
            let mi = menus[usize::try_from(g.next(menus.len() as u64)).unwrap()];
            let menu = &mut m.navigation[mi];
            let mut paths: Vec<(usize, Option<usize>)> = Vec::new();
            for (i, it) in menu.items.iter().enumerate() {
                if it.class.is_none() {
                    paths.push((i, None));
                }
                for (j, c) in it.children.iter().enumerate() {
                    if c.class.is_none() {
                        paths.push((i, Some(j)));
                    }
                }
            }
            if paths.is_empty() {
                continue;
            }
            let (i, j) = paths[usize::try_from(g.next(paths.len() as u64)).unwrap()];
            let lang = menu.lang.clone();
            let parent = j.map(|_| menu.items[i].url.clone());
            let what = match j {
                Some(j) => menu.items[i].children.remove(j),
                None => menu.items.remove(i),
            };
            // The same entry elsewhere in the language's menus (a place's "Overview" is the place
            // itself; a menu the design shows twice) is not lost.
            let still = m.navigation.iter().filter(|x| x.lang == lang).any(|x| {
                x.items.iter().any(|t| {
                    (parent.is_none() && t.url == what.url)
                        || t.children
                            .iter()
                            .any(|c| c.url == what.url && Some(&t.url) == parent.as_ref())
                })
            });
            let issues = check_navigation(&m.navigation, &s);
            if !still {
                assert!(
                    issues.iter().any(|x| x.is_error()),
                    "dropping {} ({}) escaped",
                    what.label,
                    what.url
                );
                caught += 1;
            }
        } else {
            // A component's marker dropped from where it is placed.
            let used: Vec<String> = coverage(&d, &p, &data)
                .0
                .components
                .iter()
                .filter(|c| {
                    c.used_in
                        .iter()
                        .any(|u| u.starts_with("template") || u.starts_with("part"))
                })
                .filter(|c| !c.used_in.iter().any(|u| u.starts_with("content")))
                .map(|c| c.slug.clone())
                .collect();
            let slug = &used[usize::try_from(g.next(used.len() as u64)).unwrap()];
            let mk = marker(slug);
            for t in &mut m.templates {
                t.content = t.content.replace(&mk, "");
            }
            for p in &mut m.template_parts {
                p.content = p.content.replace(&mk, "");
            }
            let (_, issues) = coverage(&d, &p, &m);
            assert!(issues.iter().any(|x| x.is_error()), "dropping {mk} escaped");
            caught += 1;
        }
    }
    assert!(caught >= 40, "only {caught} mutants applied");
}

#[test]
fn a_storys_template_has_one_byline_and_the_page_headers_order() {
    let (_, p, _, _) = made();
    let parts = p.part_slugs();
    let t = p.tasks.iter().find(|t| t.slug == "single").unwrap();
    assert!(t.forbid.iter().any(|(b, _)| b == "core/post-author-name"));
    let good = theme_designer::sketch::template(t, &p.presets);
    assert_eq!(check_template(t, &good, &p.context(&parts)), vec![]);
    // WordPress's author (whoever imported the story) beside the content's byline.
    let bad = good.replacen(
        "<!-- wp:post-title {\"level\":1} /-->",
        "<!-- wp:post-title {\"level\":1} /-->\n<!-- wp:post-author-name /-->",
        1,
    );
    let issues = check_template(t, &bad, &p.context(&parts));
    assert!(
        issues
            .iter()
            .any(|i| i.message.contains("core/post-author-name is not used here")),
        "{issues:#?}"
    );
    // The eyebrow after the title: the design's header is breadcrumb, eyebrow, title, lede.
    let eyebrow = "<!-- wp:post-terms {\"className\":\"ds-eyebrow\",\"term\":\"category\"} /-->\n";
    assert!(good.contains(eyebrow), "{good}");
    let moved = good.replacen(eyebrow, "", 1).replacen(
        "<!-- wp:post-title {\"level\":1} /-->\n",
        &format!("<!-- wp:post-title {{\"level\":1}} /-->\n{eyebrow}"),
        1,
    );
    let issues = check_template(t, &moved, &p.context(&parts));
    assert!(
        issues.iter().any(|i| i.code == IssueCode::Rule
            && i.message.contains("puts the title before the eyebrow")),
        "{issues:#?}"
    );
}

#[test]
fn tags_lists_and_an_editors_note_take_the_designs_forms() {
    let (_, p, _, _) = made();
    let css = &p.global_styles.css;
    // An empty picture frame is never shown; a wrap inside a wrap is not narrowed again.
    assert!(css.contains(".ds-card-img:not(:has(img[src]"));
    assert!(css.contains(".ds-wrap .ds-wrap{max-width:none"));
    assert_eq!(
        theme_designer::catalog::function_of("ct-tags"),
        Some(("tags", "list"))
    );
    assert_eq!(
        theme_designer::catalog::function_of("ct-editor-note"),
        Some(("callout", "pull-quote"))
    );
    assert_eq!(
        theme_designer::catalog::function_of("ct-items-transport"),
        Some(("getting-here", ""))
    );
}
