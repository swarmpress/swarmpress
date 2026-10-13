//! Fixtures: the designs of crates/site-design's tests and the sites they are rendered for.
#![allow(dead_code)]

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde_json::json;
use site_design::model::QuerySource;
use site_design::{interpret, DesignBundle, DesignSource, SiteDesign};
use theme_designer::{Collection, SiteContext, SiteLink, ThemePlan};

pub fn fixtures() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../site-design/tests/fixtures")
}

fn read_dir(root: &Path) -> BTreeMap<String, Vec<u8>> {
    let mut out = BTreeMap::new();
    fn walk(root: &Path, dir: &Path, out: &mut BTreeMap<String, Vec<u8>>) {
        let mut entries: Vec<_> = std::fs::read_dir(dir)
            .unwrap()
            .map(|e| e.unwrap().path())
            .collect();
        entries.sort();
        for p in entries {
            if p.is_dir() {
                walk(root, &p, out);
            } else {
                let rel = p
                    .strip_prefix(root)
                    .unwrap()
                    .to_string_lossy()
                    .replace('\\', "/");
                out.insert(rel, std::fs::read(&p).unwrap());
            }
        }
    }
    walk(root, root, &mut out);
    out
}

/// The trimmed Claude Design export of cinqueterre.travel's style guide.
pub fn dispatch_mini() -> DesignBundle {
    let html =
        std::fs::read(fixtures().join("claude-export/cinqueterre-dispatch-mini.html")).unwrap();
    DesignBundle::from_upload(
        BTreeMap::from([("cinqueterre-dispatch-mini.html".to_string(), html)]),
        DesignSource::Upload,
        1_760_000_000_000,
    )
    .unwrap()
}

/// The handmade multi-page bundle (its font is not a licensed family).
pub fn coast() -> DesignBundle {
    DesignBundle::new(
        read_dir(&fixtures().join("coast-journal")),
        DesignSource::Upload,
        1_760_000_000_000,
    )
    .unwrap()
}

/// The owner's full export, when it is on this machine.
pub fn full_export() -> Option<DesignBundle> {
    let html =
        std::fs::read("/Users/drietsch/Downloads/Cinque Terre Dispatch Style Guide.html").ok()?;
    DesignBundle::from_upload(
        BTreeMap::from([("style-guide.html".to_string(), html)]),
        DesignSource::Upload,
        0,
    )
    .ok()
}

/// cinqueterre.travel as the theme sees it: four languages, the footer's pages, the
/// villages, the newest and the curated stories, the stays.
pub fn cinqueterre() -> SiteContext {
    let mut links = Vec::new();
    for lang in ["en", "de", "fr", "it"] {
        let l = |label: &str, path: &str| SiteLink {
            lang: lang.into(),
            label: label.into(),
            url: format!("/{lang}/{path}"),
        };
        for v in [
            "Riomaggiore",
            "Manarola",
            "Corniglia",
            "Vernazza",
            "Monterosso",
        ] {
            links.push(l(v, &format!("{}/", v.to_lowercase())));
        }
        links.push(l("Cinque Terre", "cinque-terre/"));
        links.push(l("Things to Do", "things-to-do/"));
        links.push(l("Stories", "blog/"));
        links.push(l("Food & Drink", "culinary/"));
        links.push(l("Places to Stay", "accommodations/"));
        links.push(l("Weather", "weather/"));
        links.push(l("Our Team", "team/"));
        links.push(l("FAQ", "cinque-terre/faq/"));
    }
    SiteContext {
        name: "Cinque Terre Dispatch".into(),
        languages: vec!["en".into(), "de".into(), "fr".into(), "it".into()],
        links,
        collections: vec![
            Collection {
                name: "latest-stories".into(),
                label: "Latest stories".into(),
                source: QuerySource::Latest,
                keywords: vec!["stories".into(), "dispatch".into(), "latest".into()],
                query: json!({"postType": "post", "order": "desc", "orderBy": "date"}),
            },
            Collection {
                name: "editors-picks".into(),
                label: "Editors' picks".into(),
                source: QuerySource::Featured,
                keywords: vec!["picks".into(), "curated".into()],
                query: json!({"postType": "post", "sticky": "only"}),
            },
            Collection {
                name: "villages".into(),
                label: "The five villages".into(),
                source: QuerySource::Collection,
                keywords: vec!["villages".into(), "destinations".into()],
                query: json!({"postType": "page", "orderBy": "menu_order", "order": "asc", "parents": [0], "search": ""}),
            },
            Collection {
                name: "stays".into(),
                label: "Places to stay".into(),
                source: QuerySource::Collection,
                keywords: vec!["stay".into(), "sleep".into(), "accommodations".into()],
                query: json!({"postType": "page", "orderBy": "title", "order": "asc", "search": "stay"}),
            },
        ],
    }
}

/// A small site for the coast journal.
pub fn coast_site() -> SiteContext {
    SiteContext {
        name: "Coast Journal".into(),
        languages: vec!["en".into()],
        links: vec![
            SiteLink {
                lang: "en".into(),
                label: "Home".into(),
                url: "/en/".into(),
            },
            SiteLink {
                lang: "en".into(),
                label: "Stories".into(),
                url: "/en/stories/".into(),
            },
            SiteLink {
                lang: "en".into(),
                label: "The team".into(),
                url: "/en/team/".into(),
            },
        ],
        collections: cinqueterre().collections,
    }
}

pub fn plan_of(bundle: &DesignBundle, site: &SiteContext) -> (SiteDesign, ThemePlan) {
    let design = interpret(bundle);
    let p = theme_designer::plan(&design, &bundle.manifest(), site);
    (design, p)
}

/// Every task's reference markup, by label.
pub fn sketches(p: &ThemePlan) -> BTreeMap<String, String> {
    p.tasks
        .iter()
        .map(|t| (t.label(), theme_designer::sketch::template(t, &p.presets)))
        .collect()
}

/// The trimmed export with the full guide's type scale, spacing and fonts' roles (its
/// Typography and Grid sheets are not in the trimmed bundle): the design the checks'
/// fixtures start from.
pub fn dispatch_full_tokens() -> ThemePlan {
    use site_design::model::{SizeToken, TypeToken};
    let bundle = dispatch_mini();
    let mut design = interpret(&bundle);
    let ty = |name: &str,
              family: &str,
              size: &str,
              fluid: Option<&str>,
              lh: &str,
              tracking: Option<&str>,
              transform: Option<&str>| TypeToken {
        name: name.into(),
        family: Some(family.into()),
        weight: Some("400".into()),
        style: None,
        size: size.into(),
        fluid: fluid.map(String::from),
        line_height: Some(lh.into()),
        tracking: tracking.map(String::from),
        transform: transform.map(String::from),
        note: None,
    };
    design.tokens.type_scale = vec![
        ty(
            "h1",
            "IBM Plex Mono",
            "72px",
            Some("clamp(44px, 3.2vw + 26px, 72px)"),
            "1.0",
            Some("-0.025em"),
            None,
        ),
        ty(
            "h2",
            "IBM Plex Mono",
            "48px",
            Some("clamp(34px, 1.6vw + 25px, 48px)"),
            "1.05",
            None,
            None,
        ),
        ty("body", "IBM Plex Mono", "16px", None, "1.6", None, None),
        ty(
            "eyebrow",
            "IBM Plex Mono",
            "12px",
            None,
            "1.2",
            Some("0.14em"),
            Some("uppercase"),
        ),
        ty(
            "meta",
            "IBM Plex Mono",
            "13px",
            None,
            "1.4",
            Some("0.02em"),
            None,
        ),
    ];
    design.tokens.spacing = (1..=7)
        .map(|i| SizeToken {
            name: format!("space-{i}"),
            value: format!("{}px", 4 * i),
            usage: None,
        })
        .collect();
    theme_designer::plan(&design, &bundle.manifest(), &cinqueterre())
}
