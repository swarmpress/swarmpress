//! The theme's plan: the deterministic part ([`crate::styles`]) and one task per template
//! and part for the model; then the model's markup assembled into [`ThemeData`].
//!
//! Templates: one per template of the design (WordPress's name by
//! `site_design::wordpress::template_slug`), plus the ones every theme has that the design
//! has no page for (`index`, `single`, `page`, `404`, `archive`, `front-page`), composed
//! from the design system. Parts: `header` and `footer`, from the design's parts with
//! their menus. A query section is bound to the site's collection whose source and words
//! fit (the design's `latest` to the newest stories, `collection` with "villages" to the
//! villages); a section no collection fits is left out with a note (rule 5: the theme shows
//! only what the site has).

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use site_design::bundle::BundleManifest;
use site_design::model::{
    PartArea as DesignArea, QuerySource, RuleCheck, Section, SectionContent, SiteDesign,
    TemplateKind,
};
use site_design::wordpress::{
    template_slug, GlobalStyles, NavigationMenu, PartArea, ThemeData, ThemeFontFamily, ThemePart,
    ThemeTemplate, THEME_DATA_FORMAT,
};

use crate::model::{
    Collection, Issue, IssueCode, MenuSpec, Presets, SectionSpec, SiteContext, TaskKind,
    TemplateTask,
};
use crate::styles::{colour_preset, menus, slugify, styles};

/// Templates every theme has (WordPress's fallbacks and the front page).
pub const REQUIRED: [&str; 6] = ["index", "single", "page", "404", "archive", "front-page"];
/// A part's design markup is cut to this many characters for the prompt.
pub const PART_HTML_CHARS: usize = 6000;
/// A component's notes are cut to this many characters.
pub const NOTES_CHARS: usize = 480;

/// Everything the job needs besides the model.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ThemePlan {
    /// The design bundle's hash.
    pub design: String,
    pub global_styles: GlobalStyles,
    pub presets: Presets,
    pub fonts: Vec<ThemeFontFamily>,
    pub navigation: Vec<NavigationMenu>,
    /// Parts first, then templates.
    pub tasks: Vec<TemplateTask>,
    /// The design's enforceable rules: `(id, check)`.
    pub rules: Vec<(String, RuleCheck)>,
    /// Template slugs the theme must have.
    pub required: Vec<String>,
    pub site: SiteContext,
    /// What the deterministic part noted (menu items without a page, sections without a
    /// collection, fonts reduced) and its errors (a font file missing).
    pub notes: Vec<Issue>,
}

fn cut(s: &str, n: usize) -> String {
    if s.chars().count() <= n {
        s.to_string()
    } else {
        let mut o: String = s.chars().take(n).collect();
        o.push('…');
        o
    }
}

fn words(s: &str) -> BTreeSet<String> {
    slugify(s)
        .split('-')
        .filter(|w| w.len() > 2)
        .map(|w| w.trim_end_matches('s').to_string())
        .collect()
}

/// The site's collection for a query section (module docs).
pub fn bind<'a>(
    section: &Section,
    source: QuerySource,
    collections: &'a [Collection],
) -> Option<&'a Collection> {
    let mut said = String::new();
    for v in [
        section.role.as_deref(),
        section.props.get("heading").map(String::as_str),
        section.props.get("eyebrow").map(String::as_str),
    ]
    .into_iter()
    .flatten()
    {
        said.push(' ');
        said.push_str(v);
    }
    let said = words(&said);
    let score = |c: &Collection| {
        let mut w = words(&c.name);
        w.extend(words(&c.label));
        for k in &c.keywords {
            w.extend(words(k));
        }
        w.intersection(&said).count()
    };
    let same: Vec<&Collection> = collections.iter().filter(|c| c.source == source).collect();
    let best = same
        .iter()
        .copied()
        .max_by_key(|c| (score(c), std::cmp::Reverse(c.name.clone())))
        .filter(|c| score(c) > 0);
    best.or_else(|| (same.len() == 1).then(|| same[0]))
        .or_else(|| {
            collections
                .iter()
                .max_by_key(|c| (score(c), std::cmp::Reverse(c.name.clone())))
                .filter(|c| score(c) > 0)
        })
}

fn section_spec(
    design: &SiteDesign,
    s: &Section,
    site: &SiteContext,
    at: &str,
    notes: &mut Vec<Issue>,
) -> Option<SectionSpec> {
    let mut spec = SectionSpec {
        id: s.id.clone(),
        class: format!("sp-{}", slugify(&s.id)),
        kind: String::new(),
        what: None,
        notes: None,
        role: s.role.clone(),
        heading: s.props.get("heading").cloned(),
        eyebrow: s.props.get("eyebrow").cloned(),
        background: s
            .props
            .get("background")
            .and_then(|b| colour_preset(design, b)),
        items: s.props.get("items").and_then(|i| i.parse().ok()),
        collection: None,
        query: None,
    };
    let component_notes = |slug: &str| {
        design.components.iter().find(|c| c.slug == slug).map(|c| {
            let mut t = c.name.clone();
            if let Some(sub) = &c.subtitle {
                t.push_str(": ");
                t.push_str(sub);
            }
            for n in &c.notes {
                t.push_str(". ");
                t.push_str(n);
            }
            cut(&t, NOTES_CHARS)
        })
    };
    match &s.content {
        SectionContent::Block { block } => {
            spec.kind = "block".into();
            spec.what = Some(block.clone());
        }
        SectionContent::Entry => spec.kind = "entry".into(),
        SectionContent::Component { component } => {
            spec.kind = "component".into();
            spec.what = Some(component.clone());
            spec.notes = component_notes(component);
        }
        SectionContent::Query { query } => {
            spec.kind = "query".into();
            spec.items = Some(query.items);
            if let Some(c) = s.props.get("component") {
                spec.what = Some(c.clone());
                spec.notes = component_notes(c);
            }
            if query.source == QuerySource::Inherit {
                spec.collection = Some("inherit".into());
                spec.query = Some(json!({"inherit": true}));
            } else {
                match bind(s, query.source, &site.collections) {
                    Some(c) => {
                        let mut q = c.query.clone();
                        if let Value::Object(m) = &mut q {
                            m.insert("perPage".into(), json!(query.items));
                            m.entry("inherit").or_insert(json!(false));
                        }
                        spec.collection = Some(c.name.clone());
                        spec.query = Some(q);
                    }
                    None => {
                        notes.push(Issue::new(
                            IssueCode::Note,
                            at,
                            format!(
                                "section {} ({}) shows entries the site has no collection for; it is left out",
                                s.id,
                                spec.heading.as_deref().or(s.role.as_deref()).unwrap_or("a list")
                            ),
                        ));
                        return None;
                    }
                }
            }
        }
    }
    Some(spec)
}

fn synthesized(slug: &str) -> (String, Option<TemplateKind>, String, Vec<SectionSpec>) {
    let sec = |id: &str, kind: &str, what: Option<&str>| SectionSpec {
        id: id.into(),
        class: format!("sp-{id}"),
        kind: kind.into(),
        what: what.map(String::from),
        notes: None,
        role: None,
        heading: None,
        eyebrow: None,
        background: None,
        items: None,
        collection: None,
        query: None,
    };
    let list = |id: &str| SectionSpec {
        collection: Some("inherit".into()),
        query: Some(json!({"inherit": true})),
        ..sec(id, "query", None)
    };
    match slug {
        "index" => (
            "Index".into(),
            None,
            "The fallback for every list of entries: the newest stories, each with its title, category, date and excerpt, and the pages of the list.".into(),
            vec![sec("page-header", "block", Some("page-header")), list("entries")],
        ),
        "archive" => (
            "Archive".into(),
            Some(TemplateKind::Archive),
            "A category's or tag's stories: the archive's title and description, then its entries and the pages of the list.".into(),
            vec![sec("page-header", "block", Some("page-header")), list("entries")],
        ),
        "single" => (
            "Single".into(),
            Some(TemplateKind::Single),
            "One story: its title as the page's only h1, its category and date, its featured image, its content.".into(),
            vec![sec("entry", "entry", None)],
        ),
        "page" => (
            "Page".into(),
            Some(TemplateKind::Page),
            "A page of the site: its title as the page's only h1 and its content.".into(),
            vec![sec("entry", "entry", None)],
        ),
        "404" => (
            "Page not found".into(),
            Some(TemplateKind::NotFound),
            "The page was not found: say so in one h1, offer the search and a link to the home page.".into(),
            vec![sec("not-found", "block", Some("not-found"))],
        ),
        _ => (
            "Front page".into(),
            Some(TemplateKind::Home),
            "The site's front page: its own content.".into(),
            vec![sec("entry", "entry", None)],
        ),
    }
}

/// The theme's plan (module docs).
pub fn plan(design: &SiteDesign, manifest: &BundleManifest, site: &SiteContext) -> ThemePlan {
    let st = styles(design, manifest);
    let (navigation, menu_notes) = menus(design, site);
    let mut notes = st.notes.clone();
    notes.extend(menu_notes);
    let menu_names: BTreeSet<String> = navigation.iter().map(|m| m.name.clone()).collect();
    let menu_label = |name: &str| {
        design
            .navigation
            .iter()
            .find(|m| slugify(&m.slug) == name)
            .map_or_else(|| "Languages".to_string(), |m| m.label.clone())
    };

    // --- parts
    let mut tasks = Vec::new();
    for (slug, area, design_area) in [
        ("header", PartArea::Header, DesignArea::Header),
        ("footer", PartArea::Footer, DesignArea::Footer),
    ] {
        let part = design.parts.iter().find(|p| p.area == design_area);
        let mut names: Vec<String> = part
            .map(|p| p.menus.iter().map(|m| slugify(m)).collect())
            .unwrap_or_default();
        if slug == "header" && menu_names.contains("languages") {
            names.push("languages".into());
        }
        if part.is_none() && slug == "header" {
            names.extend(design.navigation.first().map(|m| slugify(&m.slug)));
        }
        let menus: Vec<MenuSpec> = names
            .into_iter()
            .filter(|n| menu_names.contains(n))
            .map(|n| MenuSpec {
                label: menu_label(&n),
                class: format!("sp-menu-{n}"),
                name: n,
            })
            .collect();
        tasks.push(TemplateTask {
            kind: TaskKind::Part,
            slug: slug.into(),
            title: if slug == "header" { "Header" } else { "Footer" }.into(),
            area: Some(area),
            design: part.map(|p| p.slug.clone()),
            template_kind: None,
            purpose: Some(if slug == "header" {
                "The site's masthead on every page: the site's name (not an h1), its menus.".into()
            } else {
                "The site's footer on every page: the site's name, its line, its menus, the copyright.".into()
            }),
            sections: Vec::new(),
            parts: Vec::new(),
            menus,
            html: part.map(|p| cut(&p.html, PART_HTML_CHARS)),
        });
    }

    // --- templates
    let mut seen = BTreeSet::new();
    for t in &design.templates {
        let slug = template_slug(t.kind, &t.slug);
        if !seen.insert(slug.clone()) {
            notes.push(Issue::new(
                IssueCode::Note,
                format!("template {slug}"),
                format!(
                    "the design's template {} renders as {slug} too; the first one is used",
                    t.slug
                ),
            ));
            continue;
        }
        let at = format!("template {slug}");
        let sections: Vec<SectionSpec> = t
            .sections
            .iter()
            .filter_map(|s| section_spec(design, s, site, &at, &mut notes))
            .collect();
        let mut parts: Vec<String> = t
            .parts
            .iter()
            .filter(|p| *p == "header" || *p == "footer")
            .cloned()
            .collect();
        if parts.is_empty() {
            parts = vec!["header".into(), "footer".into()];
        }
        tasks.push(TemplateTask {
            kind: TaskKind::Template,
            slug,
            title: t.title.clone(),
            area: None,
            design: Some(t.slug.clone()),
            template_kind: Some(t.kind),
            purpose: None,
            sections,
            parts,
            menus: Vec::new(),
            html: None,
        });
    }
    for r in REQUIRED {
        if seen.contains(r) {
            continue;
        }
        let (title, kind, purpose, sections) = synthesized(r);
        tasks.push(TemplateTask {
            kind: TaskKind::Template,
            slug: r.into(),
            title,
            area: None,
            design: None,
            template_kind: kind,
            purpose: Some(purpose),
            sections,
            parts: vec!["header".into(), "footer".into()],
            menus: Vec::new(),
            html: None,
        });
        seen.insert(r.to_string());
    }

    let rules = design
        .rules
        .iter()
        .filter_map(|r| r.check.clone().map(|c| (r.id.clone(), c)))
        .collect();
    let mut required: Vec<String> = seen.into_iter().collect();
    required.sort();
    ThemePlan {
        design: design.bundle.clone(),
        global_styles: st.global_styles,
        presets: st.presets,
        fonts: st.fonts,
        navigation,
        tasks,
        rules,
        required,
        site: site.clone(),
        notes,
    }
}

/// The theme data: the plan's deterministic part and the markup of every task (by the
/// task's [`TemplateTask::label`]). A task without markup is left out (the checks then
/// name what is missing).
pub fn assemble(plan: &ThemePlan, markup: &BTreeMap<String, String>) -> ThemeData {
    let mut templates = Vec::new();
    let mut template_parts = Vec::new();
    for t in &plan.tasks {
        let Some(content) = markup.get(&t.label()) else {
            continue;
        };
        match t.kind {
            TaskKind::Template => templates.push(ThemeTemplate {
                slug: t.slug.clone(),
                title: t.title.clone(),
                content: content.clone(),
            }),
            TaskKind::Part => template_parts.push(ThemePart {
                slug: t.slug.clone(),
                area: t.area.unwrap_or(PartArea::Uncategorized),
                content: content.clone(),
            }),
        }
    }
    ThemeData {
        format: THEME_DATA_FORMAT.into(),
        design: plan.design.clone(),
        global_styles: plan.global_styles.clone(),
        templates,
        template_parts,
        patterns: Vec::new(),
        navigation: plan.navigation.clone(),
        fonts: plan.fonts.clone(),
    }
}

/// What every template call reads before its task (generated, one per job): the design's
/// title and principles, its rules of use, the presets in words, and the site's pages.
pub fn prompt_context(plan: &ThemePlan, design: &SiteDesign) -> String {
    use site_design::model::RuleKind;
    use std::fmt::Write as _;
    let mut s = String::new();
    let _ = writeln!(s, "The design: {}.", design.title.trim());
    let principles: Vec<String> = design
        .rules
        .iter()
        .filter(|r| r.kind == RuleKind::Principle)
        .map(|r| {
            let t = r.title.as_deref().unwrap_or("").trim();
            cut(&format!("- {t}: {}", r.text.trim()), 240)
        })
        .collect();
    if !principles.is_empty() {
        let _ = writeln!(s, "\nIts principles:\n{}", principles.join("\n"));
    }
    let rules: Vec<String> = design
        .rules
        .iter()
        .filter(|r| r.kind != RuleKind::Principle)
        .take(16)
        .map(|r| {
            let fix = r
                .fix
                .as_deref()
                .map(|f| format!(" → {}", f.trim()))
                .unwrap_or_default();
            cut(&format!("- {}{fix}", r.text.trim()), 200)
        })
        .collect();
    if !rules.is_empty() {
        let _ = writeln!(s, "\nIts rules:\n{}", rules.join("\n"));
    }
    let p = &plan.presets;
    let _ = writeln!(s, "\nThe theme's presets (use these slugs only):");
    let colours: Vec<String> = p
        .colors
        .iter()
        .map(|(k, v)| {
            let role = p
                .roles
                .iter()
                .find(|(_, s)| *s == k)
                .map(|(r, _)| format!(" ({r})"))
                .unwrap_or_default();
            format!("{k} {v}{role}")
        })
        .collect();
    let _ = writeln!(s, "- colours: {}", colours.join(", "));
    let list = |set: &BTreeSet<String>| set.iter().cloned().collect::<Vec<_>>().join(", ");
    let _ = writeln!(s, "- font sizes: {}", list(&p.font_sizes));
    let _ = writeln!(s, "- font families: {}", list(&p.font_families));
    let _ = writeln!(s, "- spacing: {}", list(&p.spacing));
    if !p.shadows.is_empty() {
        let _ = writeln!(s, "- shadows: {}", list(&p.shadows));
    }
    let lang = plan.site.langs()[0].clone();
    let pages: Vec<String> = plan
        .site
        .links
        .iter()
        .filter(|l| l.lang == lang)
        .take(40)
        .map(|l| format!("{} {}", l.label, l.url))
        .collect();
    let _ = writeln!(
        s,
        "\nThe site: {} (languages {}). Its pages you may link: / (the front page), {}",
        plan.site.name,
        plan.site.langs().join(", "),
        pages.join(", ")
    );
    s
}
