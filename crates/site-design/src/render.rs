//! A design's pages as static, annotated HTML (ADR-0093, FEAT-115): what the web designer's
//! visual check screenshots next to the site.
//!
//! A Claude Design page is a template for its own runtime (`<sc-for>` loops, `{{…}}`
//! substitutions); the page a person sees is that template expanded with the page's literal data
//! ([`crate::dc::expand`]). [`static_pages`] expands every page a template or a component of the
//! interpretation comes from and marks what the theme renders, so a comparison can pair regions
//! instead of whole pages:
//!
//! - a template page's sections carry `data-sp-section="{id}"` (the ids of
//!   [`crate::model::Section`], in the interpretation's order), its header and footer
//!   `data-sp-part="header"` / `"footer"`;
//! - a components sheet's numbered parts carry `data-sp-component="{slug}"`.
//!
//! The site's side marks the same regions by class (`sp-{id}`, `sp-header`, …). Nothing here
//! runs the design: the data is read as literals, scripts never execute (the runtime's script
//! is dropped when the page is parsed).

use std::collections::BTreeMap;

use crate::dom::{self, El, Node};
use crate::interpret::sections_of;
use crate::model::{SiteDesign, TemplateKind};

/// `(element, attribute, value)` marks, found by identity in one tree.
type Marks = Vec<(*const El, &'static str, String)>;

fn apply(el: &mut El, marks: &Marks) {
    let me = el as *const El;
    for (at, name, value) in marks {
        if std::ptr::eq(*at, me) {
            el.set_attr(name, value.clone());
        }
    }
    for c in &mut el.children {
        if let Node::El(e) = c {
            apply(e, marks);
        }
    }
}

/// The design's template and component pages, expanded and annotated (module docs), by path.
pub fn static_pages(
    design: &SiteDesign,
    texts: &BTreeMap<String, String>,
) -> BTreeMap<String, String> {
    let mut paths: Vec<&str> = design
        .templates
        .iter()
        .map(|t| t.source.as_str())
        .chain(design.components.iter().map(|c| c.page.as_str()))
        .collect();
    paths.sort_unstable();
    paths.dedup();
    let mut out = BTreeMap::new();
    for path in paths {
        let Some(text) = texts.get(path) else {
            continue;
        };
        let raw = dom::parse(text);
        let (mut html, _) = crate::dc::expand(&raw);
        let mut marks: Marks = Vec::new();
        if let Some(body) = dom::body(&html) {
            // A template page: its sections in order, its parts.
            if let Some(t) = design
                .templates
                .iter()
                .find(|t| t.source == path && t.kind != TemplateKind::Listing)
            {
                let mut ids = t.sections.iter().map(|s| s.id.clone());
                for el in sections_of(body) {
                    match el.tag.as_str() {
                        "header" | "nav" => {
                            marks.push((el as *const El, "data-sp-part", "header".into()))
                        }
                        "footer" => marks.push((el as *const El, "data-sp-part", "footer".into())),
                        _ => {
                            if let Some(id) = ids.next() {
                                marks.push((el as *const El, "data-sp-section", id));
                            }
                        }
                    }
                }
            }
            // A sheet's numbered parts.
            let mine: Vec<_> = design
                .components
                .iter()
                .filter(|c| c.page == path)
                .collect();
            if !mine.is_empty() {
                for (label, block) in crate::guide::labelled(body) {
                    let Some((number, _)) = crate::guide::split_number(&label) else {
                        continue;
                    };
                    if let Some(c) = mine
                        .iter()
                        .find(|c| c.number.as_deref() == Some(number.as_str()))
                    {
                        if !marks
                            .iter()
                            .any(|(_, n, v)| *n == "data-sp-component" && *v == c.slug)
                        {
                            marks.push((block as *const El, "data-sp-component", c.slug.clone()));
                        }
                    }
                }
            }
        }
        apply(&mut html, &marks);
        out.insert(
            path.to_string(),
            format!("<!DOCTYPE html>\n{}", html.outer_html()),
        );
    }
    out
}
