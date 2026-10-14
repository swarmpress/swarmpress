//! Interpretation of two designs (FEAT-114): a handmade multi-page bundle
//! (`coast-journal`) and a trimmed Claude Design standalone export of the
//! owner's "Salt & Pigment" style guide (two of its pages, re-bundled small).
//! Each has a snapshot (`*.design.json`); `UPDATE_SNAPSHOTS=1` rewrites them.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use site_design::*;

fn fixtures() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures")
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

pub fn coast() -> DesignBundle {
    DesignBundle::new(
        read_dir(&fixtures().join("coast-journal")),
        DesignSource::Upload,
        1_760_000_000_000,
    )
    .unwrap()
}

pub fn dispatch_mini() -> DesignBundle {
    let html =
        std::fs::read(fixtures().join("claude-export/cinqueterre-dispatch-mini.html")).unwrap();
    DesignBundle::from_upload(
        BTreeMap::from([("cinqueterre-dispatch-mini.html".to_string(), html)]),
        DesignSource::Connector {
            client: "claude-design".into(),
        },
        1_760_000_000_000,
    )
    .unwrap()
}

fn snapshot(name: &str, d: &SiteDesign) {
    let path = fixtures().join(format!("{name}.design.json"));
    let got = serde_json::to_string_pretty(d).unwrap() + "\n";
    if std::env::var("UPDATE_SNAPSHOTS").is_ok() || !path.exists() {
        std::fs::write(&path, &got).unwrap();
    }
    let want = std::fs::read_to_string(&path).unwrap();
    assert!(
        got == want,
        "{name}: the interpretation changed; review and rerun with UPDATE_SNAPSHOTS=1"
    );
    // The snapshot is the model's wire format: it reads back unchanged.
    let back: SiteDesign = serde_json::from_str(&want).unwrap();
    assert_eq!(&back, d);
}

fn template<'a>(d: &'a SiteDesign, slug: &str) -> &'a Template {
    d.templates
        .iter()
        .find(|t| t.slug == slug)
        .unwrap_or_else(|| panic!("no template {slug}"))
}

fn keys(t: &Template) -> Vec<String> {
    t.sections.iter().map(Section::key).collect()
}

#[test]
fn a_multi_page_bundle_becomes_templates_parts_menus_and_tokens() {
    let d = interpret(&coast());
    snapshot("coast-journal", &d);

    let kinds: Vec<(&str, TemplateKind)> = d
        .templates
        .iter()
        .map(|t| (t.slug.as_str(), t.kind))
        .collect();
    assert_eq!(
        kinds,
        [
            ("home", TemplateKind::Home),
            ("404", TemplateKind::NotFound),
            ("single", TemplateKind::Single),
            ("archive", TemplateKind::Archive),
        ]
    );
    assert_eq!(
        keys(template(&d, "home")),
        [
            "hero-section",
            "query-featured",
            "query-latest",
            "stats-section",
            "newsletter"
        ]
    );
    assert_eq!(keys(template(&d, "single")), ["entry", "query-collection"]);
    assert_eq!(
        keys(template(&d, "archive")),
        ["hero-section", "query-inherit", "cta-section"]
    );
    assert_eq!(keys(template(&d, "404")), ["hero-section"]);
    let home = template(&d, "home");
    assert_eq!(home.parts, ["header", "footer"]);
    assert_eq!(
        home.sections[0].props["eyebrow"],
        "Travel journal · Liguria"
    );
    match &home.sections[2].content {
        SectionContent::Query { query } => {
            assert_eq!((query.source, query.items), (QuerySource::Latest, 4))
        }
        other => panic!("{other:?}"),
    }

    // Parts and menus: the header's nav, the footer's labelled groups; links to pages name their templates.
    let parts: Vec<&str> = d.parts.iter().map(|p| p.slug.as_str()).collect();
    assert_eq!(parts, ["header", "footer"]);
    assert!(!d.parts[0].html.contains("evil"));
    let main = d.navigation.iter().find(|m| m.slug == "main").unwrap();
    let items: Vec<(&str, Option<&str>)> = main
        .items
        .iter()
        .map(|i| (i.label.as_str(), i.template.as_deref()))
        .collect();
    assert_eq!(
        items,
        [
            ("Home", Some("home")),
            ("Stories", Some("archive")),
            ("Featured", Some("single")),
            ("About", None)
        ]
    );
    assert!(d.navigation.iter().any(|m| m.slug == "footer-explore"));
    assert_eq!(d.languages, ["en", "it"]);

    // Tokens from :root (stylesheet and inline), @font-face, @media and stacks.
    let t = &d.tokens;
    let colour = |n: &str| t.colours.iter().find(|c| c.name == n).unwrap();
    assert_eq!(colour("--color-paper").role, ColourRole::Background);
    assert_eq!(colour("--color-ink").role, ColourRole::Text);
    assert_eq!(colour("--color-ink-muted").role, ColourRole::TextMuted);
    assert_eq!(colour("--color-accent").role, ColourRole::Accent);
    assert_eq!(colour("--color-line").role, ColourRole::Border);
    assert_eq!(colour("--color-highlight").role, ColourRole::Highlight);
    let ink = colour("--color-ink").contrast.as_ref().unwrap();
    assert_eq!(ink.against, "--color-paper");
    assert!(ink.ratio_x100 > 1400, "{}", ink.ratio_x100);
    let serif = t.fonts.iter().find(|f| f.name == "Coast Serif").unwrap();
    assert_eq!(serif.faces[0].file, "fonts/coast-serif.woff2");
    assert_eq!(serif.faces[0].weight, "400 700");
    assert_eq!(serif.stack, "'Coast Serif', Georgia, serif");
    assert_eq!(
        t.type_scale[0].fluid.as_deref(),
        Some("clamp(40px, 4vw + 20px, 72px)")
    );
    assert_eq!(t.spacing.len(), 2);
    assert_eq!(t.radii[0].value, "4px");
    assert_eq!(t.elevations.len(), 1);
    assert_eq!(t.motion.len(), 2);
    let bps: Vec<(u32, Option<u32>)> = t.breakpoints.iter().map(|b| (b.min_px, b.max_px)).collect();
    assert_eq!(bps, [(0, Some(640)), (641, Some(1024))]);
}

#[test]
fn the_style_guide_export_unpacks_and_interprets() {
    let b = dispatch_mini();
    let m = b.manifest();
    let paths: Vec<&str> = m.files.iter().map(|f| f.path.as_str()).collect();
    assert!(paths.contains(&"pages/01-color.html"), "{paths:?}");
    assert!(paths.contains(&"pages/06-applied-homepage.html"));
    assert!(paths.contains(&"design.json"));
    assert!(paths
        .iter()
        .any(|p| p.starts_with("assets/") && p.ends_with(".woff2")));
    assert!(
        !paths.iter().any(|p| p.ends_with(".js")),
        "scripts are never part of a bundle"
    );
    assert_eq!(m.hash, b.hash());

    let d = interpret(&b);
    snapshot("cinqueterre-dispatch-mini", &d);
    assert_eq!(d.title, "Cinque Terre Dispatch Style Guide (mini)");
    let roles: Vec<(&str, PageRole)> = d.pages.iter().map(|p| (p.title.as_str(), p.role)).collect();
    assert_eq!(
        roles,
        [
            ("01 — Color", PageRole::Guide),
            ("06 — Applied: Homepage", PageRole::Template)
        ]
    );

    // The Color sheet's data, read without running it.
    let t = &d.tokens;
    let names: Vec<(&str, &str, ColourRole)> = t
        .colours
        .iter()
        .map(|c| (c.name.as_str(), c.value.as_str(), c.role))
        .collect();
    assert_eq!(
        names,
        [
            ("--ct-ink", "#0F1E2E", ColourRole::Text),
            ("--ct-ink-soft", "#3A4756", ColourRole::TextMuted),
            ("--ct-mist", "#6B7682", ColourRole::TextMuted),
            ("--ct-paper", "#F3EFE7", ColourRole::Background),
            ("--ct-calce", "#E8E2D6", ColourRole::Surface),
            ("--ct-line", "#CFC6B6", ColourRole::Border),
            ("--ct-corallo", "#B5482F", ColourRole::Accent),
            ("--ct-mare", "#1F6F8B", ColourRole::Link),
            ("--ct-limone", "#E8C547", ColourRole::Highlight),
            ("--ct-v-riomaggiore", "#D98C7A", ColourRole::Pigment),
            ("--ct-v-manarola", "#D9A441", ColourRole::Pigment),
            ("--ct-v-corniglia", "#9DAA7C", ColourRole::Pigment),
            ("--ct-v-vernazza", "#7FA9C2", ColourRole::Pigment),
            ("--ct-v-monterosso", "#E8C547", ColourRole::Pigment),
        ]
    );
    let corallo = t.colours.iter().find(|c| c.name == "--ct-corallo").unwrap();
    let c = corallo.contrast.as_ref().unwrap();
    assert_eq!(
        (c.against.as_str(), c.stated.as_deref()),
        ("--ct-paper", Some("4.7:1"))
    );
    assert!(
        (460..=475).contains(&c.ratio_x100),
        "computed {}",
        c.ratio_x100
    );
    let rio = t
        .colours
        .iter()
        .find(|c| c.name == "--ct-v-riomaggiore")
        .unwrap();
    assert_eq!(rio.tint.as_deref(), Some("#EFE1D8"));
    assert_eq!(t.schemes.len(), 1);
    assert!(t.schemes[0].dark);
    assert_eq!(t.schemes[0].colours[0].value, "#0B1622");
    assert_eq!(t.schemes[0].colours[0].role, ColourRole::Background);
    let mono = t.fonts.iter().find(|f| f.name == "IBM Plex Mono").unwrap();
    assert_eq!(mono.role, FontRole::Meta);
    assert!(mono.faces[0].file.starts_with("assets/"));
    assert!(
        b.bytes(&mono.faces[0].file).is_some(),
        "the font file is in the bundle"
    );

    // The homepage: header and footer, the sections in order, the menus.
    let home = template(&d, "home");
    assert_eq!(home.kind, TemplateKind::Home);
    assert_eq!(
        keys(home),
        [
            "hero-section",
            "image",
            "query-collection",
            "query-featured",
            "query-collection",
            "query-latest",
            "content-section"
        ]
    );
    let bands: Vec<Option<&str>> = home
        .sections
        .iter()
        .map(|s| s.props.get("background").map(String::as_str))
        .collect();
    assert_eq!(bands[4], Some("--ct-calce"), "places to stay sit on Calce");
    assert_eq!(
        bands[6],
        Some("--notte"),
        "the itinerary sits on the dark scheme's ground"
    );
    let villages = d.navigation.iter().find(|m| m.slug == "villages").unwrap();
    assert_eq!(villages.items.len(), 5);
    assert_eq!(d.languages, ["en", "de", "fr", "it"]);
    assert_eq!(
        d.navigation
            .iter()
            .filter(|m| m.slug.starts_with("footer-"))
            .count(),
        4
    );
}

#[test]
fn bundles_refuse_what_is_not_a_design() {
    let mut files = read_dir(&fixtures().join("coast-journal"));
    files.insert("app.js".into(), b"alert(1)".to_vec());
    let e = DesignBundle::new(files, DesignSource::Upload, 0).unwrap_err();
    assert_eq!(e[0].path.as_deref(), Some("app.js"));
    let big = BTreeMap::from([("index.html".to_string(), vec![b' '; MAX_BUNDLE_BYTES + 1])]);
    assert!(DesignBundle::new(big, DesignSource::Upload, 0).is_err());
}

#[test]
fn the_designs_pages_render_static_with_their_regions_marked() {
    let bundle = dispatch_mini();
    let d = interpret(&bundle);
    let texts: BTreeMap<String, String> = bundle
        .files()
        .iter()
        .filter(|(p, _)| p.ends_with(".html") || p.ends_with(".css"))
        .map(|(p, b)| (p.clone(), String::from_utf8_lossy(b).into_owned()))
        .collect();
    let pages = site_design::render::static_pages(&d, &texts);
    let home = template(&d, "home");
    let html = &pages[&home.source];
    assert!(html.starts_with("<!DOCTYPE html>"));
    // Every section of the home by its id, in order, and its parts.
    let mut at = 0;
    for s in &home.sections {
        let mark = format!("data-sp-section=\"{}\"", s.id);
        let i = html[at..]
            .find(&mark)
            .unwrap_or_else(|| panic!("{mark} in order"))
            + at;
        at = i;
        // The section's own markup is kept for the web designer, as the interpretation saw it.
        assert!(!s.html.is_empty(), "{} has its markup", s.id);
    }
    assert!(html.contains("data-sp-part=\"header\""));
    assert!(html.contains("data-sp-part=\"footer\""));
    // The page's runtime is expanded: the loops' items are there, no template syntax, no script.
    assert!(!html.contains("<sc-for"), "loops expanded");
    assert!(!html.contains("{{"), "substitutions made");
    assert!(!html.contains("<script src"));
}
