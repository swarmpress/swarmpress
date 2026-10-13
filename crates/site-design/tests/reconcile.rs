//! Semantic reconciliation (FEAT-114, concept §5.4): a changed design is
//! diffed per template, section and token; a later design of one template
//! replaces only that template.

use std::collections::BTreeMap;
use std::path::Path;

use site_design::*;

fn coast_files() -> BTreeMap<String, Vec<u8>> {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/coast-journal");
    let mut out = BTreeMap::new();
    for p in [
        "index.html",
        "article.html",
        "stories.html",
        "404.html",
        "styles.css",
        "fonts/coast-serif.woff2",
    ] {
        out.insert(p.to_string(), std::fs::read(root.join(p)).unwrap());
    }
    out
}

fn design(files: BTreeMap<String, Vec<u8>>) -> SiteDesign {
    interpret(&DesignBundle::new(files, DesignSource::Upload, 0).unwrap())
}

fn edit(files: &mut BTreeMap<String, Vec<u8>>, path: &str, from: &str, to: &str) {
    let s = String::from_utf8(files[path].clone()).unwrap();
    assert!(s.contains(from), "{path} has {from:?}");
    files.insert(path.into(), s.replacen(from, to, 1).into_bytes());
}

#[test]
fn the_same_design_has_no_differences() {
    let a = design(coast_files());
    let d = diff(&a, &a);
    assert!(d.is_empty(), "{d:#?}");
}

#[test]
fn changes_are_named_per_template_section_and_token() {
    let old = design(coast_files());
    let mut files = coast_files();
    // Home: the latest stories get a new heading and a fifth card; a FAQ is added after the stats.
    edit(
        &mut files,
        "index.html",
        "<h2>Latest stories</h2>",
        "<h2>Latest dispatches</h2>",
    );
    edit(
        &mut files,
        "index.html",
        "<article class=\"card\"><a href=\"article.html\">The blue trail, reopened</a></article>",
        "<article class=\"card\"><a href=\"article.html\">The blue trail, reopened</a></article><article class=\"card\"><a href=\"article.html\">Night boats</a></article>",
    );
    edit(
        &mut files,
        "index.html",
        "<section class=\"newsletter\">",
        "<section class=\"faq\"><details>Q1</details><details>Q2</details><details>Q3</details></section><section class=\"newsletter\">",
    );
    // A token changes, one is added.
    edit(
        &mut files,
        "styles.css",
        "--color-accent: #C4281C;",
        "--color-accent: #B5482F;\n  --color-sea: #1F6F8B;",
    );
    // The 404 page goes.
    files.remove("404.html");
    let new = design(files);
    let d = diff(&old, &new);
    assert!(!d.is_empty());

    let home = d.templates.iter().find(|t| t.slug == "home").unwrap();
    assert_eq!(home.change, Change::Changed);
    let s: Vec<(&str, Change)> = home
        .sections
        .iter()
        .map(|s| (s.key.as_str(), s.change))
        .collect();
    assert_eq!(
        s,
        [
            ("hero-section", Change::Same),
            ("query-featured", Change::Same),
            ("query-latest", Change::Changed),
            ("stats-section", Change::Same),
            ("faq-section", Change::Added),
            ("newsletter", Change::Same),
        ]
    );
    let latest = &home.sections[2];
    assert!(
        latest
            .notes
            .contains(&"heading: Latest stories → Latest dispatches".to_string()),
        "{:?}",
        latest.notes
    );
    assert!(
        latest.notes.contains(&"items: 4 → 5".to_string()),
        "{:?}",
        latest.notes
    );
    for slug in ["single", "archive"] {
        assert_eq!(
            d.templates.iter().find(|t| t.slug == slug).unwrap().change,
            Change::Same,
            "{slug}"
        );
    }
    assert_eq!(
        d.templates.iter().find(|t| t.slug == "404").unwrap().change,
        Change::Removed
    );

    let tokens: Vec<(&str, Option<&str>, Option<&str>)> = d
        .tokens
        .iter()
        .map(|t| (t.token.as_str(), t.before.as_deref(), t.after.as_deref()))
        .collect();
    assert_eq!(
        tokens,
        [
            ("colour --color-accent", Some("#C4281C"), Some("#B5482F")),
            ("colour --color-sea", None, Some("#1F6F8B")),
        ]
    );
}

#[test]
fn a_later_design_of_one_template_replaces_only_that_template() {
    let base = design(coast_files());
    // Claude Design sends only the article page, redesigned, with its own accent.
    let mut files = BTreeMap::new();
    let article = String::from_utf8(coast_files()["article.html"].clone())
        .unwrap()
        .replace("<section class=\"cards related\">", "<section class=\"pull\"><h2>A quote</h2><p>One sentence.</p></section><section class=\"cards related\">")
        .replace("<link rel=\"stylesheet\" href=\"styles.css\">", "<style>:root { --color-accent: #1F6F8B; }</style>");
    files.insert("article.html".to_string(), article.into_bytes());
    let later = design(files);
    assert_eq!(later.templates.len(), 1);

    let merged = merge(&base, &later);
    let slugs: Vec<&str> = merged.templates.iter().map(|t| t.slug.as_str()).collect();
    assert_eq!(slugs, ["home", "404", "single", "archive"]);
    assert_eq!(merged.bundle, later.bundle);
    let d = diff(&base, &merged);
    let changed: Vec<(&str, Change)> = d
        .templates
        .iter()
        .map(|t| (t.slug.as_str(), t.change))
        .collect();
    assert_eq!(
        changed,
        [
            ("home", Change::Same),
            ("404", Change::Same),
            ("single", Change::Changed),
            ("archive", Change::Same)
        ]
    );
    // Its token replaces the one with the same name; the others stay.
    let accent = merged
        .tokens
        .colours
        .iter()
        .find(|c| c.name == "--color-accent")
        .unwrap();
    assert_eq!(accent.value, "#1F6F8B");
    assert!(merged
        .tokens
        .colours
        .iter()
        .any(|c| c.name == "--color-paper"));
    // The parts and menus of the base stay: the later page brought its own, the same.
    assert_eq!(merged.parts.len(), 2);
}
