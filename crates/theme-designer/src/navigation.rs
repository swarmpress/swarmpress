//! The theme's navigation from the source site's menus (ADR-0093 addendum, 2026-10-14).
//!
//! A design proposes menus (`villages` in its masthead, four columns in its footer); the site's
//! visitors know the source site's menus, nested, per language. The theme keeps **every source
//! entry** and puts it where the design has a menu for it:
//!
//! 1. Each design menu takes the source menu, or the source column (a top-level item with
//!    children, such as the footer's *Explore*), whose items its own items name: by label, by the
//!    page the label resolves to, or by the column's heading. The match is made in the site's
//!    first language and kept for every language, so the theme's menu `villages-de` is the
//!    source's German menu, submenus and all.
//! 2. What no design menu takes stays too: a source menu of the header becomes the header's main
//!    menu, a single-link menu (the wordmark's) the wordmark, every other column a footer column
//!    of its own.
//! 3. The header's main menu carries the design's panel per place (4.1): each place's item gets
//!    its featured story as a last child with the class `ds-featured`; the languages are added as
//!    a row the phone's menu shows (4.20).
//!
//! [`check_navigation`] is the guarantee: every source entry (nested ones included) is in the
//! theme's menus of its language, under the same parent, with a link; an entry may be missing only
//! when the site lists it as retired. Anything else fails the theme.

use std::collections::{BTreeMap, BTreeSet};

use site_design::model::{PartArea as DesignArea, SiteDesign};
use site_design::wordpress::{valid_slug, NavigationItem, NavigationMenu, ThemeData};

use crate::model::{Issue, IssueCode, MenuArea, SiteContext, SourceMenu};
use crate::styles::{label_key, resolve, slugify};

/// Where the theme shows a menu.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct NavPlan {
    pub menus: Vec<NavigationMenu>,
    /// The header's menus in order: `(name, label)`; the first with submenus is the main menu.
    pub header: Vec<(String, String)>,
    /// The footer's columns in order: `(name, heading)`.
    pub footer: Vec<(String, String)>,
    /// The wordmark's menu, when the source has one (its one link is the home in each language).
    pub brand: Option<String>,
    pub notes: Vec<Issue>,
}

/// Where a design menu's items come from: a source menu, or one of its columns.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
struct Source {
    menu: String,
    column: Option<usize>,
}

fn norm(url: &str) -> String {
    let u = url.trim();
    if u.is_empty() || u.contains('#') || u.contains('?') || u.ends_with('/') {
        return u.to_string();
    }
    let last = u.rsplit('/').next().unwrap_or("");
    if last.contains('.') {
        u.to_string()
    } else {
        format!("{u}/")
    }
}

fn items_of(m: &SourceMenu, column: Option<usize>) -> Option<&[NavigationItem]> {
    match column {
        None => Some(&m.items),
        Some(i) => m.items.get(i).map(|c| c.children.as_slice()),
    }
}

/// How many of the design menu's items a source list names (by label or by page), and a bonus
/// when the design menu's label is the column's heading.
fn score(
    site: &SiteContext,
    lang: &str,
    design_items: &[site_design::model::MenuItem],
    design_label: &str,
    list: &[NavigationItem],
    heading: Option<&str>,
) -> usize {
    let keys: BTreeSet<String> = list.iter().map(|i| label_key(&i.label)).collect();
    let urls: BTreeSet<String> = list.iter().map(|i| norm(&i.url)).collect();
    let mut n = 0;
    for it in design_items {
        let by_label = keys.contains(&label_key(&it.label));
        let by_page = resolve(site, lang, &it.label).is_some_and(|(u, _)| urls.contains(&norm(&u)));
        if by_label || by_page {
            n += 2;
        }
    }
    if heading.is_some_and(|h| label_key(h) == label_key(design_label)) {
        n += 3;
    }
    n
}

/// The site's places by the words of an item (its label, its URL's segments).
fn place_of<'a>(site: &'a SiteContext, it: &NavigationItem) -> Option<&'a crate::model::Place> {
    let segs: BTreeSet<&str> = it.url.split('/').filter(|s| !s.is_empty()).collect();
    site.places
        .iter()
        .find(|p| segs.contains(p.slug.as_str()) || label_key(&p.label) == label_key(&it.label))
}

/// The theme's navigation (module docs).
pub fn navigation(design: &SiteDesign, site: &SiteContext) -> NavPlan {
    let mut plan = NavPlan::default();
    let langs = site.langs();
    let first = langs[0].clone();
    let source: Vec<&SourceMenu> = site.menus.iter().filter(|m| m.lang == first).collect();
    let by_name = |name: &str, lang: &str| -> Option<&SourceMenu> {
        site.menus.iter().find(|m| m.name == name && m.lang == lang)
    };
    let part_menus = |area: DesignArea| -> Vec<String> {
        design
            .parts
            .iter()
            .filter(|p| p.area == area)
            .flat_map(|p| p.menus.iter().cloned())
            .collect()
    };
    let header_design = part_menus(DesignArea::Header);
    let footer_design = part_menus(DesignArea::Footer);

    // 1. Each design menu takes its best source list.
    let mut taken: BTreeMap<Source, String> = BTreeMap::new();
    let mut ordered: Vec<&site_design::model::Menu> = Vec::new();
    for slug in header_design.iter().chain(footer_design.iter()) {
        if let Some(m) = design.navigation.iter().find(|m| &m.slug == slug) {
            ordered.push(m);
        }
    }
    for m in &design.navigation {
        if !ordered.iter().any(|o| o.slug == m.slug) {
            ordered.push(m);
        }
    }
    for dm in ordered {
        let name = slugify(&dm.slug);
        if !valid_slug(&name) || name == "languages" {
            continue;
        }
        let in_header = header_design.contains(&dm.slug);
        let in_footer = footer_design.contains(&dm.slug);
        let mut best: Option<(usize, Source)> = None;
        for sm in &source {
            // A menu of the header takes the source's header menu first, a footer's its footer.
            let same_area = (in_header && sm.area == MenuArea::Header)
                || (in_footer && sm.area == MenuArea::Footer);
            let mut cands = vec![(None, sm.items.as_slice(), None)];
            for (i, c) in sm.items.iter().enumerate() {
                if !c.children.is_empty() {
                    cands.push((Some(i), c.children.as_slice(), Some(c.label.as_str())));
                }
            }
            let whole_taken = taken
                .keys()
                .any(|t| t.menu == sm.name && t.column.is_none());
            let column_taken = taken
                .keys()
                .any(|t| t.menu == sm.name && t.column.is_some());
            for (column, list, heading) in cands {
                let src = Source {
                    menu: sm.name.clone(),
                    column,
                };
                // A source entry goes to one design menu: a menu taken whole gives no column, a
                // menu with a column taken is not taken whole; a column only to a menu of its area.
                if taken.contains_key(&src)
                    || whole_taken
                    || (column.is_none() && column_taken)
                    || (column.is_some() && !same_area)
                {
                    continue;
                }
                let mut s = score(site, &first, &dm.items, &dm.label, list, heading);
                if s > 0 && same_area {
                    s += 6;
                }
                if s > 0 && best.as_ref().is_none_or(|(b, _)| s > *b) {
                    best = Some((s, src));
                }
            }
        }
        match best {
            Some((_, src)) => {
                for lang in &langs {
                    let Some(items) =
                        by_name(&src.menu, lang).and_then(|m| items_of(m, src.column))
                    else {
                        continue;
                    };
                    plan.menus.push(NavigationMenu {
                        name: name.clone(),
                        lang: lang.clone(),
                        items: items.to_vec(),
                    });
                }
                taken.insert(src.clone(), name.clone());
                if in_header {
                    plan.header.push((name, dm.label.clone()));
                } else {
                    // A column's heading is the source's, in the first language's words.
                    let heading = src
                        .column
                        .and_then(|c| by_name(&src.menu, &first).and_then(|m| m.items.get(c)))
                        .map_or_else(|| dm.label.clone(), |c| c.label.clone());
                    plan.footer.push((name, heading));
                }
            }
            None => plan.notes.push(Issue::new(
                IssueCode::Note,
                format!("menu {name}"),
                "the source site has no menu with these entries: the design's menu is not shown",
            )),
        }
    }

    // 2. What no design menu took.
    for sm in &source {
        let whole = Source {
            menu: sm.name.clone(),
            column: None,
        };
        if taken.contains_key(&whole) {
            continue;
        }
        let columns_taken: BTreeSet<usize> = taken
            .keys()
            .filter(|s| s.menu == sm.name)
            .filter_map(|s| s.column)
            .collect();
        let copy = |name: &str, column: Option<usize>, plan: &mut NavPlan| {
            for lang in &langs {
                if let Some(items) = by_name(&sm.name, lang).and_then(|m| items_of(m, column)) {
                    plan.menus.push(NavigationMenu {
                        name: name.to_string(),
                        lang: lang.clone(),
                        items: items.to_vec(),
                    });
                }
            }
        };
        if columns_taken.is_empty() {
            if sm.area == MenuArea::Other && sm.items.len() == 1 && sm.items[0].children.is_empty()
            {
                copy(&sm.name, None, &mut plan);
                plan.brand = Some(sm.name.clone());
                continue;
            }
            let main = sm.area == MenuArea::Header
                && !plan.header.iter().any(|(n, _)| {
                    plan.menus
                        .iter()
                        .any(|m| &m.name == n && m.items.iter().any(|i| !i.children.is_empty()))
                });
            let name = slugify(&sm.name);
            copy(&name, None, &mut plan);
            if main {
                plan.header.insert(0, (name, "Menu".into()));
            } else if sm.items.iter().all(|i| !i.children.is_empty()) {
                // A menu of columns: one footer column each.
                plan.menus.retain(|m| m.name != name);
                for (i, c) in sm.items.iter().enumerate() {
                    let col = format!("{name}-{}", slugify(&c.label));
                    copy(&col, Some(i), &mut plan);
                    plan.footer.push((col, c.label.clone()));
                }
            } else {
                plan.footer.push((name, sm.name.clone()));
            }
            continue;
        }
        // Some columns taken: the others become columns of their own, its loose links one more.
        let mut loose = false;
        for (i, c) in sm.items.iter().enumerate() {
            if columns_taken.contains(&i) {
                continue;
            }
            if c.children.is_empty() {
                loose = true;
                continue;
            }
            let col = format!("{}-{}", slugify(&sm.name), slugify(&c.label));
            copy(&col, Some(i), &mut plan);
            plan.footer.push((col, c.label.clone()));
        }
        if loose {
            let name = format!("{}-more", slugify(&sm.name));
            for lang in &langs {
                if let Some(m) = by_name(&sm.name, lang) {
                    plan.menus.push(NavigationMenu {
                        name: name.clone(),
                        lang: lang.clone(),
                        items: m
                            .items
                            .iter()
                            .filter(|i| i.children.is_empty())
                            .cloned()
                            .collect(),
                    });
                }
            }
            plan.footer.push((name, sm.name.clone()));
        }
    }

    // 3. The main menu's panels: each place's featured story, and the languages row for phones.
    let main = plan
        .header
        .iter()
        .find(|(n, _)| {
            plan.menus
                .iter()
                .any(|m| &m.name == n && m.items.iter().any(|i| !i.children.is_empty()))
        })
        .map(|(n, _)| n.clone());
    if let Some(main) = &main {
        for m in plan.menus.iter_mut().filter(|m| &m.name == main) {
            // Each village's item says which village it is: its dot, tint and panel follow it.
            for it in &mut m.items {
                if let Some(place) = place_of(site, it) {
                    let class = format!("ds-village-{}", place.slug);
                    it.class = Some(match &it.class {
                        Some(c) if !c.split_whitespace().any(|x| x == class) => {
                            format!("{c} {class}")
                        }
                        Some(c) => c.clone(),
                        None => class,
                    });
                }
            }
            let mut n = 0;
            for it in &mut m.items {
                if it.children.is_empty() {
                    continue;
                }
                n += 1;
                let Some(place) = place_of(site, it) else {
                    continue;
                };
                // The panel's head: its number, the place's name, its line (4.1).
                let mut head = format!(
                    "<span class=\"ds-panel-no\">{n:02}</span><span class=\"ds-panel-name\">{}</span>",
                    esc(&it.label)
                );
                if let Some(line) = place.lines.get(&m.lang) {
                    head.push_str(&format!(
                        "<span class=\"ds-panel-line\">{}</span>",
                        esc(line)
                    ));
                }
                it.children.insert(
                    0,
                    NavigationItem {
                        label: head,
                        url: it.url.clone(),
                        children: Vec::new(),
                        class: Some("ds-panel-head".into()),
                    },
                );
                if let Some(f) = site
                    .featured
                    .iter()
                    .find(|f| f.place == place.slug && f.lang == m.lang)
                {
                    let img = f
                        .image
                        .as_deref()
                        .map(|src| {
                            format!(
                                "<img class=\"ds-featured-img\" src=\"{}\" alt=\"{}\">",
                                esc(src),
                                esc(&f.title)
                            )
                        })
                        .unwrap_or_default();
                    it.children.push(NavigationItem {
                        label: format!(
                            "{img}<span class=\"ds-featured-title\">{}</span>",
                            esc(&f.title)
                        ),
                        url: f.url.clone(),
                        children: Vec::new(),
                        class: Some("ds-featured".into()),
                    });
                }
            }
            if langs.len() > 1 {
                for l in &langs {
                    m.items.push(NavigationItem {
                        label: l.to_ascii_uppercase(),
                        url: format!("/{l}/"),
                        children: Vec::new(),
                        class: Some(if *l == m.lang {
                            "ds-lang-item current-menu-item".into()
                        } else {
                            "ds-lang-item".into()
                        }),
                    });
                }
            }
        }
    }
    // The wordmark: the design's (its last word in italics), linking the source's home.
    if let (Some(b), Some(mark)) = (&plan.brand, wordmark(design)) {
        for m in plan.menus.iter_mut().filter(|m| &m.name == b) {
            if let Some(it) = m.items.first_mut() {
                it.label = mark.clone();
            }
        }
    }
    // The phone's sheet (4.20) opens with the wordmark beside its close button: the main menu's
    // first item, `ds-sheet-brand`, shown only in the open sheet.
    if let (Some(main), Some(mark)) = (&main, wordmark(design)) {
        let homes: BTreeMap<String, String> = plan
            .brand
            .as_ref()
            .map(|b| {
                plan.menus
                    .iter()
                    .filter(|m| &m.name == b)
                    .filter_map(|m| m.items.first().map(|i| (m.lang.clone(), i.url.clone())))
                    .collect()
            })
            .unwrap_or_default();
        for m in plan.menus.iter_mut().filter(|m| &m.name == main) {
            let url = homes
                .get(&m.lang)
                .cloned()
                .unwrap_or_else(|| format!("/{}/", m.lang));
            m.items.insert(
                0,
                NavigationItem {
                    label: mark.clone(),
                    url,
                    children: Vec::new(),
                    class: Some("ds-sheet-brand".into()),
                },
            );
        }
    }
    // The language switch.
    if langs.len() > 1 && !plan.menus.iter().any(|m| m.name == "languages") {
        for lang in &langs {
            plan.menus.push(NavigationMenu {
                name: "languages".into(),
                lang: lang.clone(),
                items: langs
                    .iter()
                    .map(|l| NavigationItem {
                        label: l.to_ascii_uppercase(),
                        url: format!("/{l}/"),
                        children: Vec::new(),
                        class: None,
                    })
                    .collect(),
            });
        }
        plan.header.push(("languages".into(), "Languages".into()));
    }
    plan
}

fn esc(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// The design's wordmark (`Cinque Terre <em>Dispatch</em>`): the header's brand link, its words
/// apart in spans, the last in italics.
pub fn wordmark(design: &SiteDesign) -> Option<String> {
    let part = design.parts.iter().find(|p| p.area == DesignArea::Header)?;
    let doc = site_design::dom::parse(&format!("<body>{}</body>", part.html));
    let a = doc.find(&|e| e.tag == "a" && e.elements().filter(|x| x.tag == "span").count() >= 2)?;
    let spans: Vec<String> = a
        .elements()
        .filter(|x| x.tag == "span")
        .map(|x| x.text().trim().to_string())
        .collect();
    let (last, rest) = spans.split_last()?;
    Some(format!("{} <em>{}</em>", esc(&rest.join(" ")), esc(last)))
}

/// One entry of a menu with its parent, for the parity check.
struct Entry<'a> {
    label: &'a str,
    url: String,
    parent: Option<String>,
}

fn entries<'a>(
    items: &'a [NavigationItem],
    parent: Option<&NavigationItem>,
    out: &mut Vec<Entry<'a>>,
) {
    for it in items {
        out.push(Entry {
            label: &it.label,
            url: norm(&it.url),
            parent: parent.map(|p| norm(&p.url)).filter(|u| !u.is_empty()),
        });
        entries(&it.children, Some(it), out);
    }
}

fn retired_for<'a>(site: &'a SiteContext, url: &str, lang: &str) -> Option<&'a str> {
    site.retired
        .iter()
        .find(|r| {
            let r_url = norm(&r.url);
            r_url == url || r_url.replace("{lang}", lang) == url
        })
        .map(|r| r.reason.as_str())
}

/// The navigation parity check (module docs): one error per source entry the theme's menus lack;
/// a note per retired entry. `menus` are the theme data's.
pub fn check_navigation(menus: &[NavigationMenu], site: &SiteContext) -> Vec<Issue> {
    let mut out = Vec::new();
    for sm in &site.menus {
        let mut want = Vec::new();
        entries(&sm.items, None, &mut want);
        let mut have = Vec::new();
        for m in menus.iter().filter(|m| m.lang == sm.lang) {
            entries(&m.items, None, &mut have);
        }
        for e in want {
            if e.url.is_empty() {
                // A column's heading: not a link.
                continue;
            }
            if let Some(why) = retired_for(site, &e.url, &sm.lang) {
                out.push(Issue::new(
                    IssueCode::Note,
                    format!("menu {}-{}", sm.name, sm.lang),
                    format!("\"{}\" ({}) is retired: {why}", e.label, e.url),
                ));
                continue;
            }
            let found = have
                .iter()
                .any(|h| h.url == e.url && (e.parent.is_none() || h.parent == e.parent));
            if !found {
                let under = e
                    .parent
                    .as_deref()
                    .map(|p| format!(" under {p}"))
                    .unwrap_or_default();
                out.push(Issue::new(
                    IssueCode::Missing,
                    format!("menu {}-{}", sm.name, sm.lang),
                    format!(
                        "the source entry \"{}\" ({}){under} is not in the theme's navigation: keep it, or list it as retired with a reason",
                        e.label, e.url
                    ),
                ));
            }
        }
    }
    out
}

/// Every source entry with a link, `(lang, url, parent url)`: what the export's parity check
/// looks for on the rendered pages.
pub fn source_entries(site: &SiteContext) -> Vec<(String, String, Option<String>)> {
    let mut out = Vec::new();
    for sm in &site.menus {
        let mut es = Vec::new();
        entries(&sm.items, None, &mut es);
        for e in es.into_iter().filter(|e| !e.url.is_empty()) {
            out.push((sm.lang.clone(), e.url, e.parent));
        }
    }
    out
}

/// Each village's tint is the design's pigment for that village, by identity (FEAT-115): its
/// menu items carry `ds-village-{slug}` (the header's dots, the phone's sheet, the panels), the
/// CSS gives that class the village's pigment and tint, and the places' classes (`sp_place-…`
/// on cards and tiles, `ct-place-…`/`ds-place-…` on content and panels) resolve to a palette
/// colour equal to it. No dot is set by an item's position.
pub fn check_pigments(design: &SiteDesign, data: &ThemeData, site: &SiteContext) -> Vec<Issue> {
    let mut out = Vec::new();
    let css = &data.global_styles.css;
    let at = "village pigments";
    if css.contains("-item:nth-child(") && css.contains("--ds-dot") {
        for line in css
            .lines()
            .filter(|l| l.contains(":nth-child(") && l.contains("--ds-dot"))
        {
            out.push(Issue::new(
                IssueCode::Rule,
                at,
                format!("a village's dot is set by its position, not by the village: {line}"),
            ));
        }
    }
    let palette: BTreeMap<String, String> = data.global_styles.settings["color"]["palette"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|p| {
                    Some((
                        p["slug"].as_str()?.to_string(),
                        p["color"].as_str()?.to_ascii_lowercase(),
                    ))
                })
                .collect()
        })
        .unwrap_or_default();
    // `{prefix}{--ds-pigment:var(--wp--preset--color--x)}` resolved through the palette.
    let resolved = |prefix: &str| -> Option<String> {
        let i = css.find(prefix)?;
        let rest = &css[i + prefix.len()..];
        let j = rest.find("--ds-pigment:var(--wp--preset--color--")?;
        let rest = &rest[j + 38..];
        let slug = &rest[..rest.find(')')?];
        palette.get(slug).cloned()
    };
    let menus_with_villages: Vec<&NavigationMenu> = data
        .navigation
        .iter()
        .filter(|m| {
            m.items.iter().any(|i| {
                i.class
                    .as_deref()
                    .is_some_and(|c| c.contains("ds-village-"))
            })
        })
        .collect();
    for place in &site.places {
        let Some(pigment) = crate::forms::village_pigment(design, &place.slug, &place.label) else {
            continue;
        };
        let want = pigment.value.to_ascii_lowercase();
        let class = format!("ds-village-{}", place.slug);
        // The menu items of the village (every language), by class and by identity.
        for m in &menus_with_villages {
            for it in &m.items {
                let is_it = place_of(site, it).is_some_and(|p| p.slug == place.slug);
                let has = it
                    .class
                    .as_deref()
                    .is_some_and(|c| c.split_whitespace().any(|x| x == class));
                if is_it != has {
                    out.push(Issue::new(
                        IssueCode::Rule,
                        at,
                        format!(
                            "menu {} ({}): the item {:?} {} the class {class}",
                            m.name,
                            m.lang,
                            it.label,
                            if has {
                                "is not the village but has"
                            } else {
                                "is the village but lacks"
                            }
                        ),
                    ));
                }
            }
        }
        if !menus_with_villages.is_empty() {
            let rule = format!(".ds-village-{}{{--ds-dot:", place.slug);
            let dot = css.find(&rule).map(|i| {
                let v = &css[i + rule.len()..];
                v[..v.find(';').unwrap_or(v.len())].to_ascii_lowercase()
            });
            if dot.as_deref() != Some(want.as_str()) {
                out.push(Issue::new(
                    IssueCode::Rule,
                    at,
                    format!(
                        "{}: the menu's dot is {:?}, the design's pigment {want}",
                        place.label, dot
                    ),
                ));
            }
        }
        for prefix in [
            format!(".sp_place-{}{{", place.slug),
            format!(".ct-place-{},.ds-place-{}{{", place.slug, place.slug),
        ] {
            let got = resolved(&prefix);
            if got.as_deref() != Some(want.as_str()) {
                out.push(Issue::new(
                    IssueCode::Rule,
                    at,
                    format!(
                        "{}: {prefix} is {:?}, the design's pigment {want}",
                        place.label, got
                    ),
                ));
            }
        }
    }
    out
}
