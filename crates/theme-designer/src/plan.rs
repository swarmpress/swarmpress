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
    template_slug, valid_slug, GlobalStyles, NavigationItem, NavigationMenu, PartArea, ThemeData,
    ThemeFontFamily, ThemePart, ThemeTemplate, THEME_DATA_FORMAT,
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
/// A section's design markup is cut to this many characters for the prompt.
pub const SECTION_HTML_CHARS: usize = 7000;
/// Entries a listing page shows.
pub const LISTING_ITEMS: u32 = 12;
/// The copy of the front page a page in another language takes as its template (WordPress lets a
/// page name only a custom template): the homes `/{lang}/` render as `/` does.
pub const LANGUAGE_HOME: &str = "page-front";

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
    t: &site_design::model::Template,
    s: &Section,
    site: &SiteContext,
    links: &mut LinkMenus,
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
        fields: Vec::new(),
        shape: None,
        html: None,
        links: Vec::new(),
        image: None,
    };
    let component_html = |slug: &str| {
        design
            .components
            .iter()
            .find(|c| c.slug == slug)
            .map(|c| c.html.clone())
            .filter(|h| !h.is_empty())
    };
    let own_html = if s.html.is_empty() {
        match &s.content {
            SectionContent::Component { component } => component_html(component),
            _ => s.props.get("component").and_then(|c| component_html(c)),
        }
    } else {
        Some(s.html.clone())
    };
    if let Some(h) = &own_html {
        spec.links = links.of_html(h, site, design);
        spec.html = Some(cut(&compact_html(h), SECTION_HTML_CHARS));
    }
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
            // A listing template lists its own collection (`archive-activity` the activities),
            // in the page's place when the page has one.
            let listing = (query.source == QuerySource::Inherit && t.kind == TemplateKind::Listing)
                .then(|| {
                    site.collections
                        .iter()
                        .find(|c| c.listing.as_deref() == Some(t.slug.as_str()))
                })
                .flatten();
            if let Some(c) = listing {
                let mut q = c.query.clone();
                if let Value::Object(m) = &mut q {
                    m.insert("perPage".into(), json!(LISTING_ITEMS));
                    m.entry("inherit").or_insert(json!(false));
                }
                spec.items = Some(LISTING_ITEMS);
                spec.collection = Some(c.name.clone());
                spec.fields = c.fields.clone();
                spec.query = Some(q);
            } else if query.source == QuerySource::Inherit && t.kind == TemplateKind::Listing {
                notes.push(Issue::new(
                    IssueCode::Note,
                    at,
                    format!(
                        "the listing {} has no collection on the site; its page shows its own content",
                        t.slug
                    ),
                ));
                return None;
            } else if query.source == QuerySource::Inherit {
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
                        spec.fields = c.fields.clone();
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
    let shape = shape_of(design, s, &spec, t.kind);
    if shape == "image-band" || shape == "hero" && s.facts.media > 0 {
        spec.image = picture_for(&spec, site);
    }
    spec.shape = Some(shape.into());
    Some(spec)
}

/// How a section is laid out in the theme's vocabulary ([`crate::components`]): from what fills
/// it, the fields of its entries and the design's markup.
pub fn shape_of(
    design: &SiteDesign,
    s: &Section,
    spec: &SectionSpec,
    kind: TemplateKind,
) -> &'static str {
    let html = spec.html.as_deref().unwrap_or("");
    let has = |f: &str| spec.fields.iter().any(|x| x == f);
    match &s.content {
        SectionContent::Entry => "entry",
        SectionContent::Component { .. } => "bar",
        SectionContent::Block { block } => match block.as_str() {
            "hero-section" => "hero",
            "image" | "gallery" => "image-band",
            _ => {
                let dark = spec.background.as_deref().is_some_and(|b| {
                    design
                        .tokens
                        .schemes
                        .iter()
                        .flat_map(|x| x.colours.iter())
                        .any(|c| {
                            crate::styles::colour_preset(design, &c.name).as_deref() == Some(b)
                        })
                });
                if dark {
                    "band"
                } else {
                    "prose"
                }
            }
        },
        SectionContent::Query { query } => {
            if kind == TemplateKind::Listing {
                if html.contains("grid-column:1 / span 5") || has("price") && has("closed") {
                    "restaurants"
                } else if html.contains("portrait") || has("role") {
                    "people"
                } else {
                    "entries"
                }
            } else if has("number") {
                "tiles"
            } else if query.source == QuerySource::Featured {
                "feature"
            } else if s.facts.media == 0 {
                "rows"
            } else {
                "cards"
            }
        }
    }
}

/// The site's picture whose words best match the section's (its design markup's text, its role):
/// `PHOTO · Vernazza harbour` → the picture labelled `Vernazza`. None when no word matches.
fn picture_for(spec: &SectionSpec, site: &SiteContext) -> Option<crate::model::SiteImage> {
    let mut said = String::new();
    if let Some(h) = &spec.html {
        said.push_str(&site_design::dom::parse(&format!("<body>{h}</body>")).text());
    }
    for v in [&spec.role, &spec.heading, &spec.eyebrow]
        .into_iter()
        .flatten()
    {
        said.push(' ');
        said.push_str(v);
    }
    let said = words(&said);
    site.images
        .iter()
        .map(|i| (words(&i.label).intersection(&said).count(), i))
        .filter(|(n, _)| *n > 0)
        .max_by_key(|(n, i)| (*n, std::cmp::Reverse(i.url.clone())))
        .map(|(_, i)| i.clone())
}

/// The design's markup without what a renderer never needs (long `@font-face` rules, whitespace
/// runs), so more of it fits a prompt.
pub fn compact_html(h: &str) -> String {
    let mut out = String::with_capacity(h.len());
    let mut space = false;
    for c in h.chars() {
        if c.is_whitespace() {
            if !space {
                out.push(' ');
            }
            space = true;
        } else {
            out.push(c);
            space = false;
        }
    }
    out.replace("> <", "><")
}

/// The design's links and buttons as one-item menus per language (`link-{label}`): a template
/// serves every language, so a link to the site's page is a navigation block the sandbox fills
/// with the page's language (ADR-0092).
#[derive(Default)]
pub struct LinkMenus {
    pub menus: BTreeMap<String, Vec<NavigationMenu>>,
}

impl LinkMenus {
    /// The links of a section's (or part's) markup that the site has a page for.
    pub fn of_html(
        &mut self,
        html: &str,
        site: &SiteContext,
        _design: &SiteDesign,
    ) -> Vec<MenuSpec> {
        let doc = site_design::dom::parse(&format!("<body>{html}</body>"));
        let mut out: Vec<MenuSpec> = Vec::new();
        let anchors: Vec<&site_design::dom::El> = doc
            .descendants()
            .into_iter()
            .filter(|e| e.tag == "a" || e.tag == "button")
            .collect();
        for a in anchors {
            let text = a.text();
            let class = a.attr("class").unwrap_or("");
            let action =
                text.contains('→') || class.split_whitespace().any(|c| c.starts_with("btn"));
            if !action {
                continue;
            }
            let label = text
                .replace('→', " ")
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ");
            if label.is_empty() || label.chars().count() > 40 {
                continue;
            }
            let name = format!("link-{}", slugify(&label));
            if out.iter().any(|m| m.name == name) || !valid_slug(&name) {
                continue;
            }
            if !self.menus.contains_key(&name) {
                let mut per_lang = Vec::new();
                for lang in site.langs() {
                    if let Some((url, l)) = crate::styles::resolve(site, &lang, &label) {
                        per_lang.push(NavigationMenu {
                            name: name.clone(),
                            lang,
                            items: vec![NavigationItem {
                                label: l,
                                url,
                                children: Vec::new(),
                            }],
                        });
                    }
                }
                if per_lang.is_empty() {
                    continue;
                }
                self.menus.insert(name.clone(), per_lang);
            }
            out.push(MenuSpec {
                class: format!("sp-menu-{name}"),
                label: label.clone(),
                name,
            });
        }
        out
    }
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
        fields: Vec::new(),
        shape: Some(
            match kind {
                "entry" => "entry",
                "query" => "rows",
                "title" => "page-head",
                "content" => "prose",
                _ => "prose",
            }
            .into(),
        ),
        html: None,
        links: Vec::new(),
        image: None,
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
    let mut st = styles(design, manifest);
    let (mut navigation, menu_notes) = menus(design, site);
    let mut notes = st.notes.clone();
    notes.extend(menu_notes);
    let mut links = LinkMenus::default();
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
        let menu_names: BTreeSet<String> = navigation.iter().map(|m| m.name.clone()).collect();
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
        let mut menus: Vec<MenuSpec> = names
            .into_iter()
            .filter(|n| menu_names.contains(n))
            .map(|n| MenuSpec {
                label: menu_label(&n),
                class: format!("sp-menu-{n}"),
                name: n,
            })
            .collect();
        if let Some(p) = part {
            menus.extend(links.of_html(&p.html, site, design));
        }
        tasks.push(TemplateTask {
            kind: TaskKind::Part,
            slug: slug.into(),
            title: if slug == "header" { "Header" } else { "Footer" }.into(),
            area: Some(area),
            design: part.map(|p| p.slug.clone()),
            template_kind: None,
            purpose: Some(if slug == "header" {
                "The site's masthead on every page: the site's name (not an h1), its menus, its button.".into()
            } else {
                "The site's footer on every page: the site's name, its line, its menus, the copyright.".into()
            }),
            sections: Vec::new(),
            parts: Vec::new(),
            menus,
            html: part.map(|p| cut(&compact_html(&p.html), PART_HTML_CHARS)),
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
        let mut sections: Vec<SectionSpec> = t
            .sections
            .iter()
            .filter_map(|s| section_spec(design, t, s, site, &mut links, &at, &mut notes))
            .collect();
        if t.kind == TemplateKind::Listing {
            // A listing is a page of the site: its title (the h1) first, its own text after
            // the entries (the page keeps every word it has).
            let (title, content) = page_frame();
            sections.insert(0, title);
            sections.push(content);
        }
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

    // The link menus the sections and parts name, per language.
    for (_, per_lang) in std::mem::take(&mut links.menus) {
        navigation.extend(per_lang);
    }
    // The component styles (theme-designer components.rs), after the global styles' own CSS.
    let dot_menu = design
        .parts
        .iter()
        .find(|p| p.area == DesignArea::Header)
        .and_then(|p| p.menus.first())
        .and_then(|m| design.navigation.iter().find(|n| &n.slug == m))
        .map(|m| {
            (
                slugify(&m.slug),
                m.items.iter().map(|i| i.label.clone()).collect::<Vec<_>>(),
            )
        });
    st.global_styles
        .css
        .push_str(&crate::components::components(
            &crate::components::ComponentInput {
                design,
                presets: &st.presets,
                site,
                dot_menu,
            },
        ));

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

/// A listing page's frame: its title section (the page's h1) and its own text.
fn page_frame() -> (SectionSpec, SectionSpec) {
    let sec = |id: &str, kind: &str, shape: &str| SectionSpec {
        id: id.into(),
        class: format!("sp-{id}"),
        kind: kind.into(),
        what: None,
        notes: None,
        role: None,
        heading: None,
        eyebrow: None,
        background: None,
        items: None,
        collection: None,
        query: None,
        fields: Vec::new(),
        shape: Some(shape.into()),
        html: None,
        links: Vec::new(),
        image: None,
    };
    (
        sec("page-title", "title", "page-head"),
        sec("page-content", "content", "prose"),
    )
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
    // The homes of the other languages render as the front page does.
    if plan.site.langs().len() > 1 && !templates.iter().any(|t| t.slug == LANGUAGE_HOME) {
        if let Some(front) = templates.iter().find(|t| t.slug == "front-page").cloned() {
            templates.push(ThemeTemplate {
                slug: LANGUAGE_HOME.into(),
                title: format!("{} (every language)", front.title),
                content: front.content,
            });
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
