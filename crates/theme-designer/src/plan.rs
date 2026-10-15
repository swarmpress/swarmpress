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

#[allow(unused_imports)]
use crate::model::PageType;
use crate::model::{
    Collection, Issue, IssueCode, MenuSpec, Presets, SectionSpec, SiteContext, TaskKind,
    TemplateTask,
};
use crate::styles::{colour_preset, menus, slugify, styles};

/// Templates every theme has (WordPress's fallbacks and the front page).
pub const REQUIRED: [&str; 7] = [
    "index",
    "single",
    "page",
    "404",
    "archive",
    "search",
    "front-page",
];
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
    /// The design's components applied to the site's content by class ([`crate::catalog`]).
    #[serde(default)]
    pub block_styles: Vec<site_design::wordpress::BlockStyle>,
    /// The files the static site publishes (the icon sprite, the enhancement script).
    #[serde(default)]
    pub files: Vec<site_design::wordpress::ThemeFile>,
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
        components: Vec::new(),
        essentials: None,
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
    spec.components = markers_for(design, &spec, &s.html);
    // An essentials box in the section (the hero's "today on the coast"): the template holds a
    // group the export fills with a place's live values; the place is the one the design names,
    // else the site's first.
    if let Some(c) = crate::catalog::component_for(design, "essentials") {
        if spec.components.contains(&c.slug) && !site.places.is_empty() {
            spec.components.retain(|x| x != &c.slug);
            let said =
                slugify(&site_design::dom::parse(&format!("<body>{}</body>", s.html)).text());
            let place = site
                .places
                .iter()
                .find(|p| said.contains(&slugify(&p.label)))
                .unwrap_or(&site.places[0]);
            let label = site_design::dom::parse(&format!("<body>{}</body>", s.html))
                .descendants()
                .into_iter()
                .filter(|e| e.elements().count() == 0)
                .map(|e| e.text())
                .find(|t| {
                    let k = slugify(t);
                    k.contains("today") || k.contains("essentials") || k.contains("now")
                });
            spec.essentials = Some(crate::model::EssentialsSpec {
                component: c.slug.clone(),
                place: place.slug.clone(),
                label,
            });
        }
    }
    Some(spec)
}

/// The short labels of a component's specimen (`SEA`, `AIR · SUNNY`, `SUNSET`): how its instance
/// is recognised in a page's section.
fn specimen_labels(c: &site_design::model::Component) -> BTreeSet<String> {
    let doc = site_design::dom::parse(&format!("<body>{}</body>", c.html));
    let mut out = BTreeSet::new();
    for e in doc.descendants() {
        if e.elements().count() > 0 {
            continue;
        }
        let class = e.attr("class").unwrap_or("");
        let style = e.attr("style").unwrap_or("");
        let label = class.split_whitespace().any(|x| x == "mono")
            || style.contains("text-transform:uppercase");
        let t = e.text();
        let words = t.split_whitespace().count();
        if label && (1..=2).contains(&words) && !t.chars().any(|ch| ch.is_ascii_digit()) {
            let k = slugify(&t);
            if k.len() >= 3 {
                out.insert(k);
            }
        }
    }
    out
}

/// The design's components a section is an instance of: what it names, what its shape is, and
/// the components whose specimen's labels it shows (at least two, and most of them).
pub fn markers_for(design: &SiteDesign, spec: &SectionSpec, html: &str) -> Vec<String> {
    use crate::catalog::component_for;
    let mut out: Vec<String> = Vec::new();
    let mut add = |slug: &str| {
        if !out.iter().any(|x| x == slug) {
            out.push(slug.to_string());
        }
    };
    if let Some(w) = &spec.what {
        if design.components.iter().any(|c| &c.slug == w) {
            add(w);
        }
    }
    let by_shape: &[&str] = match spec.shape.as_deref().unwrap_or("") {
        "bar" => &["listing-bar"],
        "cards" | "tiles" | "feature" => &["cards"],
        "hero" if !spec.links.is_empty() => &["button"],
        "band" if !spec.links.is_empty() => &["button"],
        "page-head" => &["page-header"],
        "entries" => &["activity"],
        "restaurants" => &["restaurant"],
        "people" => &["people"],
        "article" => &["contents", "reading-progress"],
        _ => &[],
    };
    for f in by_shape {
        if let Some(c) = component_for(design, f) {
            add(&c.slug);
        }
    }
    if !html.is_empty() {
        let text = site_design::dom::parse(&format!("<body>{html}</body>"))
            .text()
            .to_lowercase();
        let said: BTreeSet<&str> = text
            .split(|c: char| !c.is_alphanumeric())
            .filter(|w| !w.is_empty())
            .collect();
        for c in &design.components {
            if c.functions.iter().any(|f| {
                matches!(
                    f.as_str(),
                    "masthead"
                        | "mega-menu"
                        | "mobile-menu"
                        | "footer"
                        | "button"
                        | "tags"
                        | "cards"
                )
            }) {
                continue;
            }
            let labels = specimen_labels(c);
            let hit = labels
                .iter()
                .filter(|l| l.split('-').all(|w| said.contains(w)))
                .count();
            if hit >= 2 && hit * 2 >= labels.len().min(6) {
                add(&c.slug);
            }
        }
    }
    out
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
                                class: None,
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
                components: Vec::new(),
            });
        }
        out
    }
}

/// A section of a template the plan composes itself (not from a design page).
fn sec(id: &str, kind: &str, what: Option<&str>, shape: &str) -> SectionSpec {
    SectionSpec {
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
        shape: Some(shape.into()),
        html: None,
        links: Vec::new(),
        image: None,
        components: Vec::new(),
        essentials: None,
    }
}

/// The component slugs of `functions` in the design (the ones it has).
fn comps(design: &SiteDesign, functions: &[&str]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for f in functions {
        if let Some(c) = crate::catalog::component_for(design, f) {
            if !out.contains(&c.slug) {
                out.push(c.slug.clone());
            }
        }
    }
    out
}

fn synthesized(
    slug: &str,
    design: &SiteDesign,
) -> (String, Option<TemplateKind>, String, Vec<SectionSpec>) {
    let list = |id: &str| SectionSpec {
        collection: Some("inherit".into()),
        query: Some(json!({"inherit": true})),
        components: comps(design, &["pagination"]),
        ..sec(id, "query", None, "rows")
    };
    let head = || SectionSpec {
        components: comps(design, &["page-header"]),
        ..sec("page-header", "block", Some("page-header"), "prose")
    };
    match slug {
        "index" => (
            "Index".into(),
            None,
            "The fallback for every list of entries: the newest stories, each with its title, category, date and excerpt, and the pages of the list.".into(),
            vec![head(), list("entries")],
        ),
        "archive" => (
            "Archive".into(),
            Some(TemplateKind::Archive),
            "A category's or tag's stories: the archive's title and description, then its entries and the pages of the list.".into(),
            vec![head(), list("entries")],
        ),
        "search" => (
            "Search results".into(),
            Some(TemplateKind::Search),
            "The results of a search: what was searched as the h1, the entries found, the pages of the list, and what to do when nothing was found.".into(),
            vec![
                SectionSpec {
                    components: comps(design, &["page-header", "search"]),
                    ..sec("search-header", "block", Some("search-header"), "prose")
                },
                SectionSpec {
                    components: comps(design, &["pagination", "empty"]),
                    ..list("results")
                },
            ],
        ),
        "single" => (
            "Single".into(),
            Some(TemplateKind::Single),
            "One story: its title as the page's only h1, its category and date, its featured image, its content.".into(),
            vec![sec("entry", "entry", None, "entry")],
        ),
        "page" => (
            "Page".into(),
            Some(TemplateKind::Page),
            "A page of the site: its title as the page's only h1 and its content.".into(),
            vec![SectionSpec {
                components: comps(design, &["page-header"]),
                ..sec("entry", "entry", None, "entry")
            }],
        ),
        "404" => (
            "Page not found".into(),
            Some(TemplateKind::NotFound),
            "The page was not found: say so in one h1, say why, offer one way out (the search and a link to the home page).".into(),
            vec![SectionSpec {
                components: comps(design, &["empty", "search"]),
                ..sec("not-found", "block", Some("not-found"), "prose")
            }],
        ),
        _ => (
            "Front page".into(),
            Some(TemplateKind::Home),
            "The site's front page: its own content.".into(),
            vec![sec("entry", "entry", None, "entry")],
        ),
    }
}

/// The template of a page type the design has no page for (ADR-0093 addendum): the page header
/// (breadcrumb, eyebrow, the title as the only h1, a story's lede and dateline), then the page's own
/// content, whose blocks the design's components render by their block styles; a story adds the
/// contents rail with the reading progress.
fn page_type_task(
    pt: &crate::model::PageType,
    design: &SiteDesign,
    site: &SiteContext,
) -> TemplateTask {
    let mut head = sec("page-head", "title", None, "page-head");
    head.components = comps(design, &["page-header", "breadcrumb"]);
    let body = if pt.post {
        SectionSpec {
            components: comps(design, &["contents", "reading-progress"]),
            ..sec("article", "content", None, "article")
        }
    } else {
        sec("page-content", "content", None, "prose-wide")
    };
    let styles: Vec<String> = crate::catalog::block_styles(design, site)
        .into_iter()
        .filter(|b| b.classes.iter().any(|c| pt.kinds.contains_key(c)))
        .map(|b| b.label)
        .collect();
    // A dark scheme the design reserves for some pages (`Notte — … Events, Weather at night`).
    let mut classes = Vec::new();
    for sc in design.tokens.schemes.iter().filter(|x| x.dark) {
        let said: BTreeSet<String> = words(&sc.label);
        if words(&pt.key.replace("village-", ""))
            .iter()
            .any(|w| said.contains(w))
        {
            classes.push("ds-notte-at-night".to_string());
        }
    }
    // A story whose content carries its byline (author, place, date) shows no WordPress date or
    // author of its own: one byline, the real author (WordPress's is whoever imported it).
    let forbid: Vec<(String, String)> = if pt.post && pt.kinds.contains_key("ct-byline") {
        [
            "core/post-date",
            "core/post-time-to-read",
            "core/post-author-name",
            "core/post-author",
        ]
        .iter()
        .map(|b| {
            (
                b.to_string(),
                "the story's byline is in its content (one byline, its real author)".to_string(),
            )
        })
        .collect()
    } else {
        Vec::new()
    };
    TemplateTask {
        kind: TaskKind::Template,
        slug: pt.template.clone(),
        title: pt.label.clone(),
        area: None,
        design: None,
        template_kind: Some(if pt.post {
            TemplateKind::Single
        } else {
            TemplateKind::Page
        }),
        purpose: Some(format!(
            "The site's {} ({} pages, e.g. {}): the page header (the breadcrumb, the title as the page's only h1{}), then the page's own content (core/post-content), whose blocks the theme's block styles render as the design's components{}.",
            pt.label,
            pt.count,
            pt.sample,
            if pt.post { ", its category, lede and dateline" } else { "" },
            if styles.is_empty() {
                String::new()
            } else {
                format!(" ({})", styles.join(", "))
            }
        )),
        sections: vec![head, body],
        parts: vec!["header".into(), "footer".into()],
        menus: Vec::new(),
        html: None,
        components: Vec::new(),
        classes,
        brand: None,
        search: None,
        forbid,
    }
}

/// The design's own menus as navigation, for a site without source menus.
fn design_nav(design: &SiteDesign, site: &SiteContext) -> crate::navigation::NavPlan {
    let (menus_, notes) = menus(design, site);
    let names: BTreeSet<String> = menus_.iter().map(|m| m.name.clone()).collect();
    let label = |n: &str| {
        design
            .navigation
            .iter()
            .find(|m| slugify(&m.slug) == n)
            .map_or_else(|| "Languages".to_string(), |m| m.label.clone())
    };
    let mut nav = crate::navigation::NavPlan {
        menus: menus_,
        notes,
        ..Default::default()
    };
    for (area, list) in [
        (DesignArea::Header, &mut nav.header),
        (DesignArea::Footer, &mut nav.footer),
    ] {
        let part = design.parts.iter().find(|p| p.area == area);
        let mut ms: Vec<String> = part
            .map(|p| p.menus.iter().map(|m| slugify(m)).collect())
            .unwrap_or_default();
        if part.is_none() && area == DesignArea::Header {
            ms.extend(design.navigation.first().map(|m| slugify(&m.slug)));
        }
        if area == DesignArea::Header && names.contains("languages") {
            ms.push("languages".into());
        }
        for n in ms.into_iter().filter(|n| names.contains(n)) {
            list.push((n.clone(), label(&n)));
        }
    }
    nav
}

/// The theme's plan (module docs).
pub fn plan(design: &SiteDesign, manifest: &BundleManifest, site: &SiteContext) -> ThemePlan {
    let mut st = styles(design, manifest);
    let nav = if site.menus.is_empty() {
        design_nav(design, site)
    } else {
        crate::navigation::navigation(design, site)
    };
    let mut navigation = nav.menus.clone();
    let mut notes = st.notes.clone();
    notes.extend(nav.notes.iter().cloned());
    let mut links = LinkMenus::default();
    let main_menu = nav
        .header
        .iter()
        .find(|(n, _)| {
            navigation
                .iter()
                .any(|m| &m.name == n && m.items.iter().any(|i| !i.children.is_empty()))
        })
        .map(|(n, _)| n.clone());

    // --- parts
    let mut tasks = Vec::new();
    for (slug, area, design_area) in [
        ("header", PartArea::Header, DesignArea::Header),
        ("footer", PartArea::Footer, DesignArea::Footer),
    ] {
        let part = design.parts.iter().find(|p| p.area == design_area);
        let list = if slug == "header" {
            &nav.header
        } else {
            &nav.footer
        };
        let mut menus: Vec<MenuSpec> = list
            .iter()
            .map(|(n, l)| MenuSpec {
                label: l.clone(),
                class: format!("sp-menu-{n}"),
                name: n.clone(),
                components: if Some(n) == main_menu.as_ref() {
                    comps(design, &["mega-menu", "mobile-menu"])
                } else {
                    Vec::new()
                },
            })
            .collect();
        if let Some(p) = part {
            let mut found = links.of_html(&p.html, site, design);
            if slug == "header" {
                for m in &mut found {
                    m.components = comps(design, &["button"]);
                }
            }
            menus.extend(found);
        }
        // The part's own component (the masthead, the footer) on its outer group; the menus'
        // and the search's on theirs.
        let inner: BTreeSet<String> = menus.iter().flat_map(|m| m.components.clone()).collect();
        let search = if slug == "header" {
            comps(design, &["search"]).into_iter().next()
        } else {
            None
        };
        let components: Vec<String> = comps(
            design,
            &[if slug == "header" {
                "masthead"
            } else {
                "footer"
            }],
        )
        .into_iter()
        .filter(|c| !inner.contains(c) || slug == "header")
        .collect();
        tasks.push(TemplateTask {
            kind: TaskKind::Part,
            slug: slug.into(),
            title: if slug == "header" { "Header" } else { "Footer" }.into(),
            area: Some(area),
            design: part.map(|p| p.slug.clone()),
            template_kind: None,
            purpose: Some(if slug == "header" {
                "The site's masthead on every page: the wordmark (not an h1), the main menu with each item's panel of pages, the languages, the search, its button.".into()
            } else {
                "The site's footer on every page: the wordmark, its line, its menus as columns, the colophon.".into()
            }),
            sections: Vec::new(),
            parts: Vec::new(),
            menus,
            html: part.map(|p| cut(&compact_html(&p.html), PART_HTML_CHARS)),
            components,
            classes: Vec::new(),
            brand: if slug == "header" { nav.brand.clone() } else { None },
            search,
            forbid: Vec::new(),
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
            let (mut title, content) = page_frame();
            title.components = comps(design, &["page-header", "breadcrumb"]);
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
        let mut classes = Vec::new();
        for sc in design.tokens.schemes.iter().filter(|x| x.dark) {
            if words(&t.slug).iter().any(|w| words(&sc.label).contains(w)) {
                classes.push("ds-notte-at-night".to_string());
            }
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
            components: Vec::new(),
            classes,
            brand: None,
            search: None,
            forbid: Vec::new(),
        });
    }
    // --- the site's page types the design has no page for
    for pt in &site.page_types {
        if seen.contains(&pt.template)
            || crate::catalog::GENERIC_TEMPLATES.contains(&pt.template.as_str())
        {
            continue;
        }
        tasks.push(page_type_task(pt, design, site));
        seen.insert(pt.template.clone());
    }
    for r in REQUIRED {
        if seen.contains(r) {
            continue;
        }
        let (title, kind, purpose, sections) = synthesized(r, design);
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
            components: Vec::new(),
            classes: Vec::new(),
            brand: None,
            search: None,
            forbid: Vec::new(),
        });
        seen.insert(r.to_string());
    }

    // The link menus the sections and parts name, per language.
    for (_, per_lang) in std::mem::take(&mut links.menus) {
        navigation.extend(per_lang);
    }
    // The component styles (theme-designer components.rs), after the global styles' own CSS.
    let dot_menu = main_menu
        .clone()
        .or_else(|| {
            design
                .parts
                .iter()
                .find(|p| p.area == DesignArea::Header)
                .and_then(|p| p.menus.first())
                .map(|m| slugify(m))
        })
        .map(|name| {
            let first = site.langs()[0].clone();
            let labels = navigation
                .iter()
                .find(|m| m.name == name && m.lang == first)
                .map(|m| {
                    m.items
                        .iter()
                        .filter(|i| i.class.is_none())
                        .map(|i| i.label.clone())
                        .collect()
                })
                .unwrap_or_default();
            (name, labels)
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
    let block_styles = crate::catalog::block_styles(design, site);
    let mut files = Vec::new();
    if let Some(sprite) = crate::components::sprite(design) {
        files.push(site_design::wordpress::ThemeFile {
            path: "icons.svg".into(),
            content_type: "image/svg+xml".into(),
            content: sprite,
        });
    }
    files.push(site_design::wordpress::ThemeFile {
        path: site_design::wordpress::ENHANCEMENT_PATH.into(),
        content_type: "text/javascript".into(),
        content: site_design::wordpress::ENHANCEMENT_SCRIPT.into(),
    });

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
        block_styles,
        files,
    }
}

/// A listing page's frame: its title section (the page's h1) and its own text.
fn page_frame() -> (SectionSpec, SectionSpec) {
    (
        sec("page-title", "title", None, "page-head"),
        sec("page-content", "content", None, "prose"),
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
        block_styles: plan.block_styles.clone(),
        files: plan.files.clone(),
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
