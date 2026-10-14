//! Which component serves what (ADR-0093 addendum, 2026-10-14): the design's components mapped
//! to the site's content and page types, deterministically, and the coverage report that proves
//! it.
//!
//! **Content → component.** The site's content arrives as blocks with classes (`ct-faq-section`,
//! `ct-facts`, `ct-items-season`: the import's JSON blocks and fields, the platform's content
//! model). [`CONTENT_FUNCTIONS`] says, once for every site, which function each class needs
//! (questions and answers are `faq`, a route's facts `trail-stats`, an editor's comment a
//! `callout`); the design's component with that function renders it, as a **block style**: the
//! importer gives those blocks `is-style-{component}[-{variant}]` and the theme's CSS gives the
//! class the component's form ([`crate::components`]).
//!
//! **Templates → components.** The functions a template carries itself (the masthead and its
//! panels, the page header, the byline, the contents rail, the listing bar, pagination, search,
//! the footer) are placed by the plan, each instance marked `ds-c-{component}`.
//!
//! **Coverage.** [`coverage`] lists every component of the design: where it is used (templates,
//! parts, block styles and the pages whose content they style) or why it is not (no content of
//! its kind, no form on the site, nothing loads after the page). A component whose content the
//! site has but that nothing uses is an error: the job fails rather than ship a site that leaves
//! the design out.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use site_design::model::{Component, SiteDesign};
use site_design::wordpress::{BlockStyle, ThemeData};

use crate::model::{Issue, IssueCode, SiteContext};

/// `(content class, function, variant)`: the content's classes and the function that renders them.
/// A class ending in `-comment` (an editor's aside) is a `callout` too ([`function_of`]).
pub const CONTENT_FUNCTIONS: &[(&str, &str, &str)] = &[
    ("ct-faq-section", "faq", ""),
    ("ct-faq", "faq", ""),
    ("ct-facts", "trail-stats", ""),
    ("ct-airports-overview", "getting-here", ""),
    ("ct-getting-here", "getting-here", ""),
    ("ct-items-transport", "getting-here", ""),
    ("ct-itinerary-days", "itinerary", ""),
    ("ct-editorial-hero", "page-header", ""),
    ("ct-itinerary-hero", "page-header", "itinerary"),
    ("ct-interludes-item", "callout", "pull-quote"),
    ("ct-editorial-intro", "callout", "pull-quote"),
    ("ct-editorial-interlude", "callout", "pull-quote"),
    ("ct-quote", "callout", "pull-quote"),
    ("ct-callout", "callout", "local-wisdom"),
    ("ct-weather-journal", "callout", "local-wisdom"),
    ("ct-practical-info", "callout", "trail-notice"),
    ("ct-practical-advice", "callout", "trail-notice"),
    ("ct-closing-note", "callout", "closing"),
    ("ct-team-grid", "people", ""),
    ("ct-weather-live", "essentials", ""),
    ("ct-essentials", "essentials", ""),
    ("ct-forecast", "weather", "forecast"),
    ("ct-items-season", "weather", "seasons"),
    ("ct-gallery", "gallery", ""),
    ("ct-collection-with-interludes", "cards", "entries"),
    ("ct-collection-embed", "cards", "entries"),
    ("ct-contents", "contents", ""),
    ("ct-byline", "byline", ""),
    ("ct-continue-reading", "related", ""),
    ("ct-category", "tags", "tag"),
];

/// The function and variant a content class needs, if any.
pub fn function_of(class: &str) -> Option<(&'static str, &'static str)> {
    if let Some((_, f, v)) = CONTENT_FUNCTIONS.iter().find(|(c, _, _)| *c == class) {
        return Some((f, v));
    }
    let editor_aside =
        class.starts_with("ct-") && class.ends_with("-comment") || class == "ct-editor-note";
    editor_aside.then_some(("callout", "local-wisdom"))
}

/// Functions a template places itself, and whether the site needs them.
pub const TEMPLATE_FUNCTIONS: &[&str] = &[
    "masthead",
    "mega-menu",
    "mobile-menu",
    "button",
    "footer",
    "page-header",
    "breadcrumb",
    "byline",
    "contents",
    "reading-progress",
    "related",
    "listing-bar",
    "activity",
    "restaurant",
    "people",
    "weather",
    "pagination",
    "search",
    "empty",
    "cards",
    "tags",
    "feedback",
    "essentials",
    "itinerary",
];

/// The design's component for a function (the first in the design's order).
pub fn component_for<'a>(design: &'a SiteDesign, function: &str) -> Option<&'a Component> {
    design
        .components
        .iter()
        .find(|c| c.functions.iter().any(|f| f == function))
}

/// The block styles for the site's content: one per (component, variant) the content needs.
pub fn block_styles(design: &SiteDesign, site: &SiteContext) -> Vec<BlockStyle> {
    let mut by_name: BTreeMap<String, BlockStyle> = BTreeMap::new();
    let present: BTreeSet<&str> = site
        .page_types
        .iter()
        .flat_map(|p| p.kinds.keys().map(String::as_str))
        .collect();
    for class in present {
        let Some((f, variant)) = function_of(class) else {
            continue;
        };
        let Some(c) = component_for(design, f) else {
            continue;
        };
        let name = if variant.is_empty() {
            c.slug.clone()
        } else {
            format!("{}-{variant}", c.slug)
        };
        let label = if variant.is_empty() {
            c.name.clone()
        } else {
            format!("{} ({})", c.name, variant.replace('-', " "))
        };
        by_name
            .entry(name.clone())
            .or_insert_with(|| BlockStyle {
                name,
                label,
                component: c.slug.clone(),
                classes: Vec::new(),
            })
            .classes
            .push(class.to_string());
    }
    by_name.into_values().collect()
}

/// Where a component is used, or why not.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ComponentUse {
    pub slug: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub number: Option<String>,
    pub name: String,
    pub functions: Vec<String>,
    /// `template page-village-hiking`, `part header`, `content: ct-faq-section on 31 pages (is-style-accordion)`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub used_in: Vec<String>,
    /// Why it is not used, when it is not.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unused: Option<String>,
}

/// A page type and the components its pages show.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct PageTypeUse {
    pub key: String,
    pub template: String,
    pub count: u32,
    pub sample: String,
    pub components: Vec<String>,
    /// The template is one of WordPress's fallbacks (`index`, `page`), not composed for the type.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub generic: bool,
}

/// The coverage report (module docs).
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Coverage {
    pub components: Vec<ComponentUse>,
    pub page_types: Vec<PageTypeUse>,
}

/// Templates that are WordPress's fallbacks, not composed for a page type.
pub const GENERIC_TEMPLATES: [&str; 2] = ["index", "page"];

/// The marker class of a component's instance.
pub fn marker(slug: &str) -> String {
    format!("ds-c-{slug}")
}

/// Why a component no template or content uses is unused, when the site gives it nothing to do;
/// `None` when the site does and the component should have been used.
fn reason_unused(
    c: &Component,
    site: &SiteContext,
    present: &BTreeSet<&str>,
    asked: bool,
) -> Option<String> {
    let content_classes: Vec<&str> = CONTENT_FUNCTIONS
        .iter()
        .filter(|(_, f, _)| c.functions.iter().any(|x| x == f))
        .map(|(cl, _, _)| *cl)
        .collect();
    let has_content = content_classes.iter().any(|cl| present.contains(cl));
    let fs: BTreeSet<&str> = c.functions.iter().map(String::as_str).collect();
    if fs.contains("form") && !site.forms {
        return Some("the site has no form a visitor can send (the newsletter is hidden by the owner's decision)".into());
    }
    if fs.len() == 1 && fs.contains("loading") {
        return Some(
            "a static page shows all of its content when it loads; nothing loads later".into(),
        );
    }
    if fs.contains("gallery") && !has_content {
        return Some(format!(
            "no content of this kind on the site (no set of pictures: {})",
            content_classes.join(", ")
        ));
    }
    if !content_classes.is_empty()
        && !has_content
        && fs.iter().all(|f| !TEMPLATE_FUNCTIONS.contains(f))
    {
        return Some(format!(
            "no content of this kind on the site ({})",
            content_classes.join(", ")
        ));
    }
    if fs.is_empty() {
        return Some("the design says nothing it serves (its name names no site function)".into());
    }
    if !asked && !has_content {
        return Some(
            "no page of the design places it, and the site has no content of its kind".into(),
        );
    }
    None
}

/// The coverage of `data` (module docs): the report, and an error per component the site needs
/// but nothing uses, and per page type on a generic template.
pub fn coverage(
    design: &SiteDesign,
    plan: &crate::plan::ThemePlan,
    data: &ThemeData,
) -> (Coverage, Vec<Issue>) {
    let site = &plan.site;
    // The components the plan places (a section, a part, a menu, the search).
    let asked: BTreeSet<&str> = plan
        .tasks
        .iter()
        .flat_map(|t| {
            t.components
                .iter()
                .chain(t.search.iter())
                .chain(t.menus.iter().flat_map(|m| m.components.iter()))
                .chain(t.sections.iter().flat_map(|s| {
                    s.components
                        .iter()
                        .chain(s.essentials.iter().map(|e| &e.component))
                }))
        })
        .map(String::as_str)
        .collect();
    let mut issues = Vec::new();
    let present: BTreeSet<&str> = site
        .page_types
        .iter()
        .flat_map(|p| p.kinds.keys().map(String::as_str))
        .collect();
    let pages_with = |class: &str| -> u32 {
        site.page_types
            .iter()
            .filter_map(|p| p.kinds.get(class))
            .sum()
    };
    let mut report = Coverage::default();
    for c in &design.components {
        let m = marker(&c.slug);
        let mut used_in = Vec::new();
        for p in &data.template_parts {
            if p.content.contains(&m) {
                used_in.push(format!("part {}", p.slug));
            }
        }
        for t in &data.templates {
            if t.content.contains(&m) {
                used_in.push(format!("template {}", t.slug));
            }
        }
        for b in data.block_styles.iter().filter(|b| b.component == c.slug) {
            for cl in &b.classes {
                let n = pages_with(cl);
                if n > 0 {
                    used_in.push(format!("content: {cl} on {n} pages (is-style-{})", b.name));
                }
            }
        }
        let unused = if used_in.is_empty() {
            let why = reason_unused(c, site, &present, asked.contains(c.slug.as_str()));
            if why.is_none() {
                issues.push(Issue::new(
                    IssueCode::Missing,
                    format!("component {}", c.number.as_deref().unwrap_or(&c.slug)),
                    format!(
                        "{} serves {} on this site, but no template, part or block style uses it: place it (class {m}) or map the content to it",
                        c.name,
                        c.functions.join(", ")
                    ),
                ));
            }
            why.or_else(|| Some("not used (an error: the site has what it serves)".into()))
        } else {
            None
        };
        report.components.push(ComponentUse {
            slug: c.slug.clone(),
            number: c.number.clone(),
            name: c.name.clone(),
            functions: c.functions.clone(),
            used_in,
            unused,
        });
    }
    // Content the design has a component for, which no block style renders.
    for class in &present {
        let Some((f, _)) = function_of(class) else {
            continue;
        };
        if component_for(design, f).is_none() {
            continue;
        }
        if !data
            .block_styles
            .iter()
            .any(|b| b.classes.iter().any(|c| c == class))
        {
            issues.push(Issue::new(
                IssueCode::Missing,
                "block styles",
                format!("the content's {class} ({f}) has no block style: the design's component for {f} must render it"),
            ));
        }
    }
    for pt in &site.page_types {
        let t = data.templates.iter().find(|t| t.slug == pt.template);
        let generic = GENERIC_TEMPLATES.contains(&pt.template.as_str()) || t.is_none();
        let mut comps: BTreeSet<String> = BTreeSet::new();
        if let Some(t) = t {
            for c in &design.components {
                if t.content.contains(&marker(&c.slug)) {
                    comps.insert(c.slug.clone());
                }
            }
        }
        for p in &data.template_parts {
            for c in &design.components {
                if p.content.contains(&marker(&c.slug)) {
                    comps.insert(c.slug.clone());
                }
            }
        }
        for b in &data.block_styles {
            if b.classes.iter().any(|cl| pt.kinds.contains_key(cl)) {
                comps.insert(b.component.clone());
            }
        }
        if generic {
            issues.push(Issue::new(
                IssueCode::Missing,
                format!("page type {}", pt.key),
                format!(
                    "its {} pages ({} …) render with {} : compose the template {} from the design's components",
                    pt.count,
                    pt.sample,
                    if t.is_none() { "no template of their own" } else { "a generic template" },
                    pt.template
                ),
            ));
        }
        report.page_types.push(PageTypeUse {
            key: pt.key.clone(),
            template: pt.template.clone(),
            count: pt.count,
            sample: pt.sample.clone(),
            components: comps.into_iter().collect(),
            generic,
        });
    }
    (report, issues)
}
