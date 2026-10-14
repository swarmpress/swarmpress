//! The visual check's report and what a repair round makes of it (ADR-0093, FEAT-115).
//!
//! The executor renders the theme on a branch of the site and compares the design's pages with
//! the pages the theme renders, region by region (sections by their class `sp-{id}`, the parts
//! `header` and `footer`, a listing's components), at a phone's and a desktop's width, pictures
//! masked (`apps/game/e2e/theme-visual.mts`). Nothing here renders: [`VisualReport`] is what comes
//! back, [`repairs`] picks the tasks whose regions score below [`VISUAL_THRESHOLD`] and writes, per
//! task, the regions furthest from the design with the design's markup and the rendered one, for a
//! repair turn; [`score`] is the digest's score.

use std::collections::BTreeMap;
use std::fmt::Write as _;

use serde::{Deserialize, Serialize};

use crate::model::{TaskKind, TemplateTask};
use crate::plan::ThemePlan;

/// A page whose score is below this (per mille) gets a repair round.
pub const VISUAL_THRESHOLD: u32 = 800;
/// Visual repair rounds after the first rendering.
pub const MAX_VISUAL_ROUNDS: u32 = 2;
/// Regions a repair turn is told about, per task.
pub const REGIONS_PER_FIX: usize = 3;
/// Characters of each region's markup a repair turn reads.
pub const REGION_HTML_CHARS: usize = 3500;

/// The comparison of one template's page at one width.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct VisualPage {
    /// The template (`front-page`, `archive-activity`).
    #[serde(rename = "page")]
    pub template: String,
    /// The site's URL that renders it.
    #[serde(default)]
    pub site: String,
    pub width: u32,
    /// False when the page could not be compared at this width (the design's page has no
    /// layout there, or none of its regions is on the site's page); `reason` says why.
    #[serde(default = "yes")]
    pub compared: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    /// By region, weighted by the design region's height (per mille).
    #[serde(default)]
    pub score: u32,
    /// The whole page compared as one picture, for reference.
    #[serde(default)]
    pub whole: u32,
    #[serde(default)]
    pub regions: Vec<VisualRegion>,
}

fn yes() -> bool {
    true
}

/// One region compared.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct VisualRegion {
    /// A section's id, `header`, `footer`, or a component's slug.
    pub name: String,
    pub weight: u32,
    pub similarity: u32,
    pub found: bool,
    /// The rendered region's markup (cut).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub site_html: Option<String>,
}

/// What the executor's visual check returns.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct VisualReport {
    pub pages: Vec<VisualPage>,
}

impl VisualReport {
    /// The lowest score of `template` over the widths.
    pub fn worst_of(&self, template: &str) -> Option<u32> {
        self.pages
            .iter()
            .filter(|p| p.template == template && p.compared)
            .map(|p| p.score)
            .min()
    }

    /// The report without the rendered markup (what the artifact keeps).
    pub fn summary(&self) -> VisualReport {
        let mut r = self.clone();
        for p in &mut r.pages {
            for g in &mut p.regions {
                g.site_html = None;
            }
        }
        r
    }

    /// `front-page 742/811 (375/1280)` lines.
    pub fn lines(&self) -> Vec<String> {
        let mut by: BTreeMap<&str, Vec<(u32, u32)>> = BTreeMap::new();
        let mut why: BTreeMap<&str, Vec<String>> = BTreeMap::new();
        for p in &self.pages {
            if p.compared {
                by.entry(p.template.as_str())
                    .or_default()
                    .push((p.width, p.score));
            } else {
                why.entry(p.template.as_str()).or_default().push(format!(
                    "not compared at {} px ({})",
                    p.width,
                    p.reason.as_deref().unwrap_or("no layout")
                ));
            }
        }
        let mut names: Vec<&str> = by.keys().chain(why.keys()).copied().collect();
        names.sort_unstable();
        names.dedup();
        names
            .into_iter()
            .map(|t| {
                let mut v = by.get(t).cloned().unwrap_or_default();
                v.sort_unstable();
                let mut parts: Vec<String> =
                    v.iter().map(|(w, s)| format!("{s} at {w} px")).collect();
                parts.extend(why.get(t).cloned().unwrap_or_default());
                format!("{t}: {}", parts.join(", "))
            })
            .collect()
    }
}

/// The digest's score (0–10): the pages' mean score, in tenths of a thousand.
pub fn score(report: &VisualReport) -> Option<u8> {
    let compared: Vec<&VisualPage> = report.pages.iter().filter(|p| p.compared).collect();
    if compared.is_empty() {
        return None;
    }
    let n = u32::try_from(compared.len()).unwrap_or(u32::MAX);
    let mean = compared.iter().map(|p| p.score).sum::<u32>() / n;
    u8::try_from((mean + 50) / 100).ok()
}

/// A region as the repairs see it: its worst score, its score per width, the rendered markup,
/// whether the site has it.
type Found = (u32, Vec<(u32, u32)>, Option<String>, bool);

/// One repair turn the visual check asks for.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VisualFix {
    /// The task's label (`template front-page`, `part header`).
    pub task: String,
    /// The regions, worst first, as the prompt shows them.
    pub regions: String,
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

/// The task a region belongs to: a part's (`header`, `footer`) or the page's template's.
fn owner<'a>(plan: &'a ThemePlan, template: &str, region: &str) -> Option<&'a TemplateTask> {
    plan.tasks
        .iter()
        .find(|t| t.kind == TaskKind::Part && t.slug == region)
        .or_else(|| {
            plan.tasks
                .iter()
                .find(|t| t.kind == TaskKind::Template && t.slug == template)
        })
}

/// The design's markup of a region: the section's, the part's, or the component's.
fn design_html(task: &TemplateTask, region: &str) -> Option<String> {
    if task.kind == TaskKind::Part {
        return task.html.clone();
    }
    task.sections
        .iter()
        .find(|s| s.id == region || s.what.as_deref() == Some(region))
        .and_then(|s| s.html.clone())
}

/// The repair turns for the regions below the threshold (module docs), one per task, in the
/// plan's order. Regions the site lacks come first (a missing section is the biggest gap).
pub fn repairs(report: &VisualReport, plan: &ThemePlan) -> Vec<VisualFix> {
    // task label → (region → (worst score, widths, site markup, found))
    type Seen = BTreeMap<String, Found>;
    let mut by_task: BTreeMap<String, Seen> = BTreeMap::new();
    for p in &report.pages {
        if !p.compared || p.score >= VISUAL_THRESHOLD {
            continue;
        }
        for r in &p.regions {
            let sim = if r.found { r.similarity } else { 0 };
            if sim >= VISUAL_THRESHOLD {
                continue;
            }
            let Some(task) = owner(plan, &p.template, &r.name) else {
                continue;
            };
            let e = by_task
                .entry(task.label())
                .or_default()
                .entry(r.name.clone())
                .or_insert((u32::MAX, Vec::new(), None, r.found));
            e.0 = e.0.min(sim);
            e.1.push((p.width, sim));
            if e.2.is_none() || p.width > 600 {
                e.2.clone_from(&r.site_html);
            }
            e.3 &= r.found;
        }
    }
    let mut out = Vec::new();
    for t in &plan.tasks {
        let Some(regions) = by_task.get(&t.label()) else {
            continue;
        };
        let mut list: Vec<(&String, &Found)> = regions.iter().collect();
        list.sort_by(|a, b| (a.1 .3, a.1 .0, a.0).cmp(&(b.1 .3, b.1 .0, b.0)));
        let mut text = String::new();
        for (name, (_, widths, site, found)) in list.into_iter().take(REGIONS_PER_FIX) {
            let mut w = widths.clone();
            w.sort_unstable();
            let scores: Vec<String> = w.iter().map(|(w, s)| format!("{s} at {w} px")).collect();
            let _ = writeln!(
                text,
                "### {name}: {}{}",
                scores.join(", "),
                if *found {
                    ""
                } else {
                    " (the page has no element with this region's class)"
                }
            );
            if let Some(h) = design_html(t, name) {
                let _ = writeln!(
                    text,
                    "The design's markup:\n```html\n{}\n```",
                    cut(&h, REGION_HTML_CHARS)
                );
            }
            if let Some(h) = site {
                let _ = writeln!(
                    text,
                    "As rendered:\n```html\n{}\n```",
                    cut(h, REGION_HTML_CHARS)
                );
            }
            text.push('\n');
        }
        out.push(VisualFix {
            task: t.label(),
            regions: text,
        });
    }
    out
}

/// The comparison spec's pages for the design's **components** and the site's **page types**
/// (ADR-0093 addendum, 2026-10-14), beside the templates' own:
///
/// - each used component: its instance on a page that has it (its marker `ds-c-{slug}`, or its
///   block style `is-style-{name}`) against its specimen on the design's sheet
///   (`[data-sp-component={slug}] > :nth-child(2)`);
/// - each page type: its sample page against the design's closest composition (the design's
///   template that shares the most of its components), region by region: the parts, and each
///   shared component.
///
/// `static_page` names a design page's static rendering (`pages/04-components.static.html`).
pub fn coverage_pages(
    design: &site_design::SiteDesign,
    plan: &ThemePlan,
    data: &site_design::ThemeData,
    coverage: &crate::catalog::Coverage,
    static_page: &dyn Fn(&str) -> String,
) -> Vec<serde_json::Value> {
    use serde_json::json;
    // An instance is the component's marker or one of its block styles, wherever it is.
    let site_sel = |slug: &str| -> Option<String> {
        let mut sels: Vec<String> = Vec::new();
        let m = crate::catalog::marker(slug);
        let in_markup = data.templates.iter().any(|t| t.content.contains(&m))
            || data.template_parts.iter().any(|p| p.content.contains(&m));
        if in_markup {
            sels.push(format!(".{m}"));
        }
        for b in data.block_styles.iter().filter(|b| b.component == slug) {
            sels.push(format!(".is-style-{}", b.name));
        }
        (!sels.is_empty()).then(|| sels.join(", "))
    };
    let in_parts = |slug: &str| {
        let m = crate::catalog::marker(slug);
        data.template_parts.iter().any(|p| p.content.contains(&m))
    };
    let first_lang = plan.site.langs()[0].clone();
    let mut pages = Vec::new();
    for c in coverage.components.iter().filter(|c| !c.used_in.is_empty()) {
        let Some(comp) = design.components.iter().find(|x| x.slug == c.slug) else {
            continue;
        };
        let Some(sel) = site_sel(&c.slug) else {
            continue;
        };
        // A page that has it: the part's on the home; else the page type with most pages that
        // shows it in its template or its content.
        let url = if in_parts(&c.slug) {
            Some(format!("/{first_lang}/"))
        } else {
            coverage
                .page_types
                .iter()
                .filter(|p| p.components.contains(&c.slug))
                .filter(|p| {
                    let m = crate::catalog::marker(&c.slug);
                    data.templates
                        .iter()
                        .any(|t| t.slug == p.template && t.content.contains(&m))
                        || data.block_styles.iter().any(|b| {
                            b.component == c.slug
                                && b.classes.iter().any(|cl| {
                                    plan.site
                                        .page_types
                                        .iter()
                                        .any(|x| x.key == p.key && x.kinds.contains_key(cl))
                                })
                        })
                })
                .max_by_key(|p| (p.count, std::cmp::Reverse(p.key.clone())))
                .map(|p| p.sample.clone())
        };
        let Some(url) = url else { continue };
        pages.push(json!({
            "name": format!("component {} {}", c.number.as_deref().unwrap_or(""), c.slug),
            "design": static_page(&comp.page),
            "site": url,
            "regions": [{"name": c.slug, "design": format!("[data-sp-component={}] > :nth-child(2)", c.slug), "site": sel}],
        }));
    }
    // The design's compositions: its templates, the components each one's sections are.
    let compositions: Vec<(&site_design::model::Template, Vec<(String, String)>)> = design
        .templates
        .iter()
        .map(|t| {
            let task = plan
                .tasks
                .iter()
                .find(|x| x.design.as_deref() == Some(t.slug.as_str()));
            let mut comps: Vec<(String, String)> = Vec::new();
            for s in task.map(|x| x.sections.as_slice()).unwrap_or(&[]) {
                for c in s
                    .components
                    .iter()
                    .chain(s.essentials.iter().map(|e| &e.component))
                {
                    let sel = if t.kind == site_design::model::TemplateKind::Listing {
                        format!("[data-sp-component={c}] > :nth-child(2)")
                    } else {
                        format!("[data-sp-section={}]", s.id)
                    };
                    if !comps.iter().any(|(x, _)| x == c) {
                        comps.push((c.clone(), sel));
                    }
                }
            }
            (t, comps)
        })
        .collect();
    for pt in &coverage.page_types {
        let best = compositions
            .iter()
            .map(|(t, cs)| {
                let shared: Vec<&(String, String)> = cs
                    .iter()
                    .filter(|(c, _)| pt.components.contains(c))
                    .collect();
                (
                    shared.len(),
                    t.kind == site_design::model::TemplateKind::Home,
                    *t,
                    shared,
                )
            })
            .max_by_key(|(n, home, t, _)| (*n, *home, std::cmp::Reverse(t.slug.clone())));
        let Some((_, _, t, shared)) = best else {
            continue;
        };
        let mut regions = Vec::new();
        if t.kind != site_design::model::TemplateKind::Listing {
            regions.push(json!({"name": "header", "design": "[data-sp-part=header]", "site": "header.wp-block-template-part"}));
        }
        for (c, dsel) in shared {
            if let Some(ssel) = site_sel(c) {
                regions.push(json!({"name": c, "design": dsel, "site": ssel, "sameAspect": true}));
            }
        }
        if t.kind != site_design::model::TemplateKind::Listing {
            regions.push(json!({"name": "footer", "design": "[data-sp-part=footer]", "site": "footer.wp-block-template-part"}));
        }
        pages.push(json!({
            "name": format!("page-type {}", pt.key),
            "design": static_page(&t.source),
            "site": pt.sample,
            "regions": regions,
            "closest": t.slug,
        }));
    }
    pages
}
