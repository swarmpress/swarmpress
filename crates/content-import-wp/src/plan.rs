//! The import plan: what the sandbox's REST API writes, in order, on the import branch.
//!
//! - the site's options (title, tagline; the home is the page at `/`);
//! - the theme (`swarmpress/v1/theme`): `canvas` with the site's design as data ([`crate::theme`],
//!   ADR-0093), else the fallback theme folder ([`fallback_theme_for`]);
//! - one document per URL ([`crate::routes`]): a `post` for a blog article (`page_type`
//!   `blog-article`), a `page` otherwise,
//!   with its route, language, SEO title and description and its source as meta (the sandbox's
//!   routes plugin answers the URL with it), its title, excerpt and body in core blocks;
//! - one menu per language (`site.json`'s `navigation.main`, links in that language; for the
//!   ported theme, the frozen theme's own header: the five villages and their sections), and the
//!   theme's named menus ([`Plan::named_menus`]: its wordmark and footer, per language);
//! - a report: the block kinds that had no fields (the frozen theme draws them from its own code)
//!   and the URLs with no content.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::compose;
use crate::entries::{self, ContentType, Entry};
use crate::markup::{self, Notes};
use crate::routes::{routes, Route, Source, SECTIONS, VILLAGES};
use crate::theme_data::ThemeData;
use crate::{localized, Site, LANGS};

/// The theme the sandbox ships for migrated editorial sites.
pub const THEME: &str = "coast";

/// The sandbox's port of cinqueterre.travel's own Astro theme (ADR-0092): a child of Coast.
pub const CINQUETERRE_THEME: &str = "cinqueterre";

/// FALLBACK, until every site's design runs on data (ADR-0093): the sites whose own design the
/// sandbox still carries as theme files, by `site.json`'s `id`. Used only for a plan without
/// [`ThemeData`]; cinqueterre.travel keeps its `cinqueterre` theme folder until its design runs on
/// data (the plan's step 6), and then this table and the folder go.
const FALLBACK_SITE_THEMES: [(&str, &str); 1] = [("cinqueterre-travel", CINQUETERRE_THEME)];

/// The theme a site without theme data is imported with (FALLBACK, see
/// [`FALLBACK_SITE_THEMES`]): its own ported theme when the sandbox ships one, else Coast.
pub fn fallback_theme_for(site: &Site) -> &'static str {
    let id = site.site.get("id").and_then(Value::as_str).unwrap_or("");
    FALLBACK_SITE_THEMES
        .iter()
        .find(|(s, _)| *s == id)
        .map(|(_, t)| *t)
        .unwrap_or(THEME)
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Plan {
    pub title: String,
    pub tagline: String,
    pub theme: String,
    pub docs: Vec<Doc>,
    pub menus: BTreeMap<String, Vec<MenuItem>>,
    /// The theme's named menus, by name then language (`footer` → `en` → items): written as the
    /// navigation `{name}-{lang}`, which a navigation block with the class `sp-menu-{name}` shows
    /// in the page's language (the sandbox's routes plugin).
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub named_menus: BTreeMap<String, BTreeMap<String, Vec<MenuItem>>>,
    /// The site's design as data (ADR-0093): with it the site is imported onto the neutral theme
    /// `canvas` ([`crate::theme::BASE_THEME`]) and the data is written over REST before the
    /// documents ([`crate::theme::calls`]); without it, the fallback theme folder.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub theme_data: Option<ThemeData>,
    /// The site's content types and their entries ([`crate::entries`]).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub content_types: Vec<ContentType>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub entries: Vec<Entry>,
    pub report: Report,
}

/// One post or page.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Doc {
    pub route: String,
    pub lang: String,
    /// `page` or `post`.
    pub post_type: String,
    pub slug: String,
    pub title: String,
    pub excerpt: String,
    pub content: String,
    pub meta: BTreeMap<String, String>,
    /// A blog article's category, by name.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    /// A blog article's tags, by name.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    /// Publication date (`2023-10-14T12:00:00`), when the source has one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub date: Option<String>,
    /// A story the editors picked (the blog index's stories): sticky, the design's featured query.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub sticky: bool,
    /// The page's template of the site's design (`archive-activity`, `page-front`), when the
    /// design has one for it ([`assign_templates`]).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub template: Option<String>,
    /// The route of the page above it (a village's section → the village): WordPress's parent,
    /// which the breadcrumb follows.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MenuItem {
    pub label: String,
    pub url: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub children: Vec<MenuItem>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Report {
    /// Block kind → how many times it had no fields to import.
    pub empty_blocks: BTreeMap<String, u32>,
    /// URLs with no content of their own (a village section with neither a page nor a hub).
    pub empty_routes: Vec<String>,
}

/// The plan for the whole site, without the newsletter (the owner's decision of 2026-10-13).
pub fn plan(site: &Site) -> Plan {
    plan_with(site, compose::Options::default())
}

/// The plan for the whole site with `opts` (the newsletter only where a form endpoint answers it).
pub fn plan_with(site: &Site, opts: compose::Options) -> Plan {
    plan_with_theme(site, opts, None)
}

/// A menu of the source site as its visitors know it, in one language.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SourceMenu {
    /// `nav`, `footer`, `brand`.
    pub name: String,
    /// `header`, `footer` or `other`.
    pub area: String,
    pub lang: String,
    pub items: Vec<MenuItem>,
}

/// The source site's menus (what its live pages show): for a site whose live theme the sandbox
/// carries as a fallback (cinqueterre.travel's), that theme's header and named menus; else
/// `site.json`'s main menu. A design's theme keeps every entry of these (ADR-0093 addendum).
pub fn source_menus(site: &Site, opts: compose::Options) -> Vec<SourceMenu> {
    let ported = fallback_theme_for(site) == CINQUETERRE_THEME;
    let mut out = Vec::new();
    for l in LANGS {
        let items = if ported {
            compose::spine(l)
        } else {
            menu(site, l)
        };
        out.push(SourceMenu {
            name: "nav".into(),
            area: "header".into(),
            lang: l.to_string(),
            items,
        });
    }
    if ported {
        for (name, by_lang) in compose::named_menus(opts) {
            let area = if name == "footer" { "footer" } else { "other" };
            for (lang, items) in by_lang {
                out.push(SourceMenu {
                    name: name.clone(),
                    area: area.into(),
                    lang,
                    items,
                });
            }
        }
    }
    out
}

/// The plan with the site's design as data: on `canvas` with `theme_data`, else on the fallback
/// theme folder ([`fallback_theme_for`]).
pub fn plan_with_theme(
    site: &Site,
    mut opts: compose::Options,
    theme_data: Option<ThemeData>,
) -> Plan {
    opts.design = opts.design || theme_data.is_some();
    let mut report = Report::default();
    let mut docs = Vec::new();
    for r in routes(site) {
        let mut notes = Notes::default();
        let doc = doc(site, &r, &mut notes, opts);
        for k in notes.empty_blocks {
            *report.empty_blocks.entry(k).or_default() += 1;
        }
        if doc.content.trim().is_empty() {
            report.empty_routes.push(r.path.clone());
        }
        docs.push(doc);
    }
    let title = site_name(site);
    mark_picks(site, &mut docs);
    if opts.design {
        // What to read after each story (the design's 4.21).
        crate::design::continue_reading(&mut docs);
    }
    if let Some(data) = &theme_data {
        // The design's rules on the pages (ADR-0093): a headline without the site's name (fix-02).
        for d in &mut docs {
            d.title = headline(&d.title, &title);
            // The design's components on the content, by its classes (block styles).
            d.content = crate::design::apply_block_styles(&d.content, &data.block_styles);
        }
        assign_templates(&mut docs, data);
    }
    let tagline = site
        .site
        .get("description")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let theme = if theme_data.is_some() {
        crate::theme::BASE_THEME
    } else {
        fallback_theme_for(site)
    };
    let ported = theme == CINQUETERRE_THEME;
    let menus = LANGS
        .iter()
        .map(|l| {
            let items = if ported {
                compose::spine(l)
            } else {
                menu(site, l)
            };
            (l.to_string(), items)
        })
        .collect();
    let named_menus = if ported {
        compose::named_menus(opts)
    } else {
        BTreeMap::new()
    };
    Plan {
        title,
        tagline,
        theme: theme.into(),
        docs,
        menus,
        named_menus,
        theme_data,
        content_types: entries::content_types(),
        entries: entries::entries(site),
        report,
    }
}

/// A page's headline without the site's name (the design's rule fix-02: `Vernazza | Cinque Terre
/// Dispatch` → `Vernazza`; `Cinque Terre Dispatch | Luxury Travel Guide` → `Luxury Travel Guide`).
/// The document title (`_swarmpress_seo_title`) keeps it.
pub fn headline(title: &str, site: &str) -> String {
    let parts: Vec<&str> = title.split(" | ").map(str::trim).collect();
    let mut kept: Vec<String> = Vec::new();
    let mut changed = false;
    for p in &parts {
        if p.eq_ignore_ascii_case(site) {
            changed = true;
            continue;
        }
        // The site's name before a place (`Cinque Terre Dispatch · Corniglia`): the place stays.
        match p.strip_prefix(site).and_then(|r| r.strip_prefix(" · ")) {
            Some(rest) if !rest.trim().is_empty() => {
                changed = true;
                match kept.last_mut() {
                    Some(last) => {
                        last.push_str(" · ");
                        last.push_str(rest.trim());
                    }
                    None => kept.push(rest.trim().to_string()),
                }
            }
            _ => kept.push((*p).to_string()),
        }
    }
    if !changed || kept.is_empty() {
        return title.to_string();
    }
    kept.join(" | ")
}

/// The editors' picks (the blog index's stories, [`compose::editors_picks`]) are sticky: the
/// design's featured query lists them, in the page's language.
fn mark_picks(site: &Site, docs: &mut [Doc]) {
    let mut picked = std::collections::BTreeSet::new();
    for lang in LANGS {
        for p in compose::editors_picks(site, lang) {
            picked.insert(p.href);
        }
    }
    for d in docs {
        if d.post_type == "post" && picked.contains(&d.route) {
            d.sticky = true;
        }
    }
}

/// The listing templates of a design by the site's sections: a page of things to do or sights
/// shows the activities (`archive-activity`), restaurants and food the restaurants, the weather
/// pages the weather, the team the editors. The design's own words for its listings are matched
/// with these; a design without such a template leaves the page on its `page` template.
pub const LISTINGS: [(&str, &str); 7] = [
    ("things-to-do", "activity"),
    ("sights", "activity"),
    ("restaurants", "restaurant"),
    ("culinary", "restaurant"),
    ("weather", "weather"),
    ("team", "editor"),
    ("hotels", "stay"),
];

/// The listing a route shows (its section's or hub's), if any.
pub fn listing_of(route: &str) -> Option<&'static str> {
    let segs: Vec<&str> = route.trim_matches('/').split('/').collect();
    let last = *segs.last()?;
    if segs.len() < 2 {
        return None;
    }
    LISTINGS.iter().find(|(s, _)| *s == last).map(|(_, l)| *l)
}

/// Pages get the design's templates where it has them (ADR-0093): the homes in every language
/// the front page's (`page-front`, a copy of `front-page` a page may name), a listing page its
/// listing's (`archive-{listing}`). `/` is the front page itself.
pub fn assign_templates(docs: &mut [Doc], data: &ThemeData) {
    let has = |slug: &str| data.templates.iter().any(|t| t.slug == slug);
    let listings = crate::design::listings(data);
    let types = crate::design::type_templates(docs, &listings);
    for d in docs.iter_mut() {
        if d.post_type != "page" || d.route == "/" {
            continue;
        }
        let t = crate::design::page_template(d, &types, &listings);
        if has(&t) {
            d.template = Some(t);
        }
    }
}

/// The site's name: the home's SEO title before ` | `, else `site.json`'s name.
pub fn site_name(site: &Site) -> String {
    site.pages
        .get("index.json")
        .and_then(|h| h.get("seo").and_then(|s| s.get("title")))
        .and_then(|t| localized(t, "en"))
        .and_then(|t| t.split(" | ").next())
        .or_else(|| site.site.get("name").and_then(Value::as_str))
        .unwrap_or("Site")
        .to_string()
}

fn last_segment(path: &str) -> String {
    let seg = path.trim_matches('/').rsplit('/').next().unwrap_or("");
    if seg.is_empty() {
        "home".into()
    } else {
        seg.into()
    }
}

/// The fields of a page's blocks that invite to the newsletter (the blog index's "Get the Dispatch
/// in your inbox"): left out while the newsletter is hidden.
const NEWSLETTER_FIELDS: [&str; 1] = ["newsletter"];

/// The document a route publishes.
pub fn doc(site: &Site, r: &Route, notes: &mut Notes, opts: compose::Options) -> Doc {
    let lang = r.lang.as_str();
    let (json, source) = match &r.source {
        Source::Page { path } => (site.pages.get(path), format!("pages/{path}")),
        Source::Empty { .. } => (None, String::new()),
    };
    let null = Value::Null;
    let page = json.unwrap_or(&null);
    let seo = page.get("seo").unwrap_or(&null);
    let mut title = page
        .get("title")
        .and_then(|t| localized(t, lang))
        .map(markup::strip_tags)
        .unwrap_or_default();
    if let Source::Empty { title: t } = &r.source {
        title = t.clone();
    }
    if let (Some(v), Source::Page { path }) = (&r.village, &r.source) {
        // A hub page standing in for a village section: the village's name in the title.
        if !path.starts_with(&format!("{v}/")) && !title.is_empty() {
            let i = LANGS.iter().position(|l| *l == lang).unwrap_or(0);
            let name = VILLAGES
                .iter()
                .find(|(s, _)| s == v)
                .map(|(_, n)| n[i])
                .unwrap_or(v);
            title = format!("{title} · {name}");
        }
    }
    let mut blocks = page
        .get("body")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if !opts.newsletter {
        for b in &mut blocks {
            if let Some(o) = b.as_object_mut() {
                for k in NEWSLETTER_FIELDS {
                    o.remove(k);
                }
            }
        }
    }
    if opts.design {
        crate::design::prepare(&mut blocks);
    }
    // The theme's village intro renders the village's own content (`config/villages/`).
    let village = r.village.as_ref().and_then(|v| site.villages.get(v));
    // A village's own page without a page of its own is the village's intro.
    if let (Some(v), Source::Empty { .. }, true) = (&r.village, &r.source, village.is_some()) {
        if r.path.ends_with(&format!("/{v}/")) {
            blocks.push(serde_json::json!({"type": "village-intro"}));
        }
    }
    if let Some(vc) = village {
        for b in &mut blocks {
            if b.get("type").and_then(Value::as_str) == Some("village-intro")
                && b.as_object().is_some_and(|o| o.len() == 1)
            {
                *b = serde_json::json!({"type": "village-intro", "hero": vc["hero"], "intro": vc["intro"]});
            }
        }
    }
    let seo = if seo.is_null() {
        village.and_then(|v| v.get("seo")).unwrap_or(&null)
    } else {
        seo
    };
    // The pages the frozen theme drew from its own code are composed (the owner's decisions of
    // 2026-10-12): the home, the village overview, the weather pages' live forecast.
    let home = compose::is_home(r);
    let overview = compose::is_village_overview(r);
    let mut content = String::new();
    if home && opts.design {
        // The design's front-page template renders the home (its queries in the page's language).
        for b in &blocks {
            let mut own = Notes::default();
            let m = markup::block(b, lang, &mut own);
            if own.empty_blocks.is_empty() {
                content.push_str(&m);
            }
        }
    } else if home || overview {
        content = if home {
            let description = seo
                .get("description")
                .and_then(|t| localized(t, lang))
                .unwrap_or("");
            compose::home(site, lang, &site_name(site), description, opts)
        } else {
            compose::village_overview(site, lang)
        };
        // The page's own blocks with content follow; the empty ones are what was composed.
        for b in &blocks {
            let mut own = Notes::default();
            let m = markup::block(b, lang, &mut own);
            if own.empty_blocks.is_empty() {
                content.push_str(&m);
            }
        }
    } else {
        let forecast = compose::weather(&mut blocks, r);
        for (i, b) in blocks.iter().enumerate() {
            let kind = b.get("type").and_then(Value::as_str).unwrap_or("");
            if opts.design && kind == "blog-article" {
                content.push_str(&crate::design::article(b, lang));
            } else {
                content.push_str(&markup::block(b, lang, notes));
            }
            // The design's essentials ticker beside the live conditions (filled at export).
            if opts.design && kind == "weather-live" {
                content.push_str(&compose::essentials(r));
            }
            if let Some((_, f)) = forecast.as_ref().filter(|(at, _)| *at == i) {
                content.push_str(f);
            }
        }
        if let (Some((_, f)), true) = (&forecast, blocks.is_empty()) {
            content.push_str(f);
        }
    }
    content.push_str(&collections(site, &blocks, r, lang));
    if opts.design {
        content = crate::design::facts(&content);
    }
    let mut seo_title = seo
        .get("title")
        .and_then(|t| localized(t, lang))
        .unwrap_or("")
        .to_string();
    let mut description = seo
        .get("description")
        .and_then(|t| localized(t, lang))
        .unwrap_or("")
        .to_string();
    if overview {
        let (t, d) = compose::village_overview_title(lang);
        title = t.to_string();
        seo_title = format!("{t} | {}", site_name(site));
        description = d.to_string();
    }
    let post = page.get("page_type").and_then(Value::as_str) == Some("blog-article");
    let article = blocks
        .iter()
        .find(|b| b.get("type").and_then(Value::as_str) == Some("blog-article"))
        // A story's fields: under `post`, or on the block itself (the older, flat shape).
        .map(|b| b.get("post").unwrap_or(b));
    // An article's heading is its own title as the live page shows it, without the site's name
    // the page title carries for the document title (which stays as it was).
    let heading = article
        .and_then(|a| a.get("title"))
        .and_then(|t| localized(t, lang))
        .map(markup::strip_tags)
        .filter(|t| !t.is_empty());
    let mut meta = BTreeMap::new();
    meta.insert(
        "_swarmpress_page_type".to_string(),
        crate::design::page_type(r, page, post),
    );
    if let Some(p) = article.and_then(|a| crate::design::story_place(a, lang)) {
        meta.insert("_swarmpress_story_place".to_string(), p.to_string());
    }
    meta.insert("_swarmpress_route".to_string(), r.path.clone());
    meta.insert("_swarmpress_lang".to_string(), lang.to_string());
    if !source.is_empty() {
        meta.insert("_swarmpress_source".to_string(), source);
    }
    // The document title is the SEO title, else the page's own title (as the live site has it).
    let document_title = if seo_title.is_empty() {
        title.as_str()
    } else {
        seo_title.as_str()
    };
    if !document_title.is_empty() {
        meta.insert(
            "_swarmpress_seo_title".to_string(),
            document_title.to_string(),
        );
    }
    if !description.is_empty() {
        meta.insert(
            "_swarmpress_seo_description".to_string(),
            description.to_string(),
        );
    }
    // A village's pages belong to its place: a query of the design scoped to the page's place
    // lists that village's entries.
    if let Some(v) = &r.village {
        meta.insert("_swarmpress_place".to_string(), v.clone());
    }
    // A story's picture as a field (`image`, `image_alt`), for the design's cards: its article's,
    // else its hero's.
    let hero_image = blocks
        .iter()
        .find(|b| b.get("type").and_then(Value::as_str) == Some("editorial-hero"))
        .and_then(|b| b.get("image"));
    if let Some(img) = article
        .and_then(|a| a.get("image"))
        .or(if post { hero_image } else { None })
        .and_then(Value::as_str)
        .filter(|s| s.starts_with("http") || s.starts_with('/'))
    {
        meta.insert("image".to_string(), img.to_string());
        meta.insert(
            "image_alt".to_string(),
            heading.clone().unwrap_or_else(|| title.clone()),
        );
    }
    if let Some(by) = article
        .and_then(|a| a.get("author"))
        .and_then(|a| localized(a, lang))
    {
        meta.insert("_swarmpress_byline".to_string(), by.to_string());
    }
    let title = match heading {
        Some(h) if post => h,
        _ => title,
    };
    // A story's category: its article's; with a design (fix-06: no "Uncategorized"), else its
    // hero's badge, reported as a content gap.
    let mut category = article
        .and_then(|a| a.get("category"))
        .and_then(|c| localized(c, lang))
        .map(String::from);
    if post && category.is_none() && opts.design {
        category = blocks
            .iter()
            .find(|b| b.get("type").and_then(Value::as_str) == Some("editorial-hero"))
            .and_then(|b| b.get("badge"))
            .and_then(|c| localized(c, lang))
            .map(String::from);
        if category.is_some() {
            meta.insert("_swarmpress_category_from_badge".to_string(), "1".into());
        }
    }
    // A village's section sits under the village (WordPress's parent: the breadcrumb).
    let parent = r.village.as_ref().and_then(|v| {
        let own = format!("/{lang}/{v}/");
        (r.path != own && r.path.starts_with(&own)).then_some(own)
    });
    // Every image says what it shows (the design's rule fix-06/fix-12): an image without its own
    // description is described by the page's title.
    let content = markup::fill_alt(&content, &title);
    let slug = if r.path == "/" {
        "home".to_string()
    } else {
        format!("{}-{}", last_segment(&r.path), lang)
    };
    Doc {
        route: r.path.clone(),
        lang: lang.into(),
        post_type: if post { "post" } else { "page" }.into(),
        slug,
        title,
        excerpt: description.clone(),
        content,
        meta,
        category,
        tags: if post {
            // Every article carries its language as a tag: the home lists the stories in its own.
            let mut tags: Vec<String> = article
                .and_then(|a| a.get("tags"))
                .and_then(Value::as_array)
                .map(|t| {
                    t.iter()
                        .filter_map(|x| localized(x, lang))
                        .map(String::from)
                        .collect()
                })
                .unwrap_or_default();
            tags.push(compose::language_tag(lang).to_string());
            tags
        } else {
            vec![]
        },
        date: page
            .get("created_at")
            .and_then(Value::as_str)
            .map(|d| d.chars().take(19).collect()),
        sticky: false,
        template: None,
        parent,
    }
}

/// A `collection-embed`'s items from `collections/` (the route's village only, on a village page).
fn collections(site: &Site, blocks: &[Value], r: &Route, lang: &str) -> String {
    let mut out = String::new();
    for b in blocks {
        if b.get("type").and_then(Value::as_str) != Some("collection-embed") {
            continue;
        }
        let Some(kind) = b.get("collectionType").and_then(Value::as_str) else {
            continue;
        };
        let Some(files) = site.collections.get(kind) else {
            continue;
        };
        let mut items = String::new();
        for file in files {
            let village = file.get("village").and_then(Value::as_str);
            if r.village.is_some() && village.is_some() && village != r.village.as_deref() {
                continue;
            }
            for item in file
                .get("items")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                let Some(name) = item
                    .get("name")
                    .or(item.get("title"))
                    .and_then(|n| localized(n, lang))
                else {
                    continue;
                };
                let mut inner = markup::heading(&markup::inline(name), 3);
                let summary = item
                    .get("summary")
                    .or(item.get("description"))
                    .or(item.get("details").and_then(|d| d.get("atmosphere")))
                    .and_then(|s| localized(s, lang));
                if let Some(s) = summary {
                    inner.push_str(&markup::paragraph_html(&markup::inline(s), None));
                }
                items.push_str(&markup::group("ct-collection-item", &inner));
            }
        }
        if !items.is_empty() {
            out.push_str(&markup::group(
                &format!("ct-collection ct-collection-{kind}"),
                &items,
            ));
        }
    }
    out
}

/// `navigation.main` in `lang`; a village's children are its sections.
fn menu(site: &Site, lang: &str) -> Vec<MenuItem> {
    let items = site
        .site
        .get("navigation")
        .and_then(|n| n.get("main"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut out: Vec<MenuItem> = items.iter().filter_map(|i| menu_item(i, lang)).collect();
    if out.is_empty() {
        let i = LANGS.iter().position(|l| *l == lang).unwrap_or(0);
        out = VILLAGES
            .iter()
            .map(|(v, names)| MenuItem {
                label: names[i].into(),
                url: format!("/{lang}/{v}/"),
                children: SECTIONS
                    .iter()
                    .take(6)
                    .map(|(s, _, sn)| MenuItem {
                        label: sn[i].into(),
                        url: format!("/{lang}/{v}/{s}/"),
                        children: vec![],
                    })
                    .collect(),
            })
            .collect();
    }
    out
}

fn menu_item(v: &Value, lang: &str) -> Option<MenuItem> {
    let label = v.get("title").and_then(|t| localized(t, lang))?.to_string();
    let url = v
        .get("url")
        .and_then(Value::as_str)
        .map(|u| markup::link(u, lang))
        .unwrap_or_default();
    let children = v
        .get("children")
        .and_then(Value::as_array)
        .map(|c| c.iter().filter_map(|x| menu_item(x, lang)).collect())
        .unwrap_or_default();
    Some(MenuItem {
        label,
        url,
        children,
    })
}
