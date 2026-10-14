//! The exported site against the source site, as a visitor sees them (ADR-0093 addendum,
//! 2026-10-14): the checks a design must pass before its preview goes out.
//!
//! - **Navigation parity** ([`navigation_parity`]): every entry of the live site's menus (every
//!   `<nav>` but a breadcrumb; nested entries with their parent) is on the exported page of the
//!   same path, under the same parent, and its link works (the export has the page, or a
//!   redirect to it). An entry may be missing only when it is listed as retired, with a reason.
//! - **Templates** ([`templates`]): every exported page of the source renders with a template
//!   composed for its type (`page-template-…` other than the default, a story `single`), never the
//!   generic page, unless listed as an exception.
//! - **No "Uncategorized"** ([`uncategorized`]): WordPress's default category never shows (the
//!   design's fix-06; a story without a category is a content gap, reported by the import).

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use site_design::dom::{self, El, Node};

/// One menu entry on a page.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct NavEntry {
    pub href: String,
    /// The entry above it (a submenu's item), by its link.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent: Option<String>,
    pub label: String,
}

/// `https://cinqueterre.travel/en/x` → `/en/x/`; a link off the site stays as it is; `#…` and
/// empty links are not entries.
pub fn norm_href(href: &str, origins: &[&str]) -> Option<String> {
    let mut h = href.trim().to_string();
    for o in origins {
        if let Some(rest) = h.strip_prefix(o.trim_end_matches('/')) {
            h = rest.to_string();
        }
    }
    if h.is_empty()
        || h.starts_with('#')
        || h.starts_with("javascript:")
        || h.starts_with("mailto:")
    {
        return None;
    }
    if !h.starts_with('/') {
        return Some(h);
    }
    let h = h.split('#').next().unwrap_or("").to_string();
    let last = h.rsplit('/').next().unwrap_or("");
    Some(if h.ends_with('/') || last.contains('.') {
        h
    } else {
        format!("{h}/")
    })
}

fn is_breadcrumb(e: &El) -> bool {
    let class = e.attr("class").unwrap_or("");
    let label = e.attr("aria-label").unwrap_or("").to_lowercase();
    class.contains("breadcrumb") || label.contains("breadcrumb")
}

/// The menu entries of a page (module docs), in document order.
pub fn nav_entries(html: &str, origins: &[&str]) -> Vec<NavEntry> {
    let doc = dom::parse(html);
    let mut out = Vec::new();
    fn walk(
        e: &El,
        in_nav: bool,
        parents: &mut Vec<String>,
        origins: &[&str],
        out: &mut Vec<NavEntry>,
    ) {
        let nav_here = e.tag == "nav" && !is_breadcrumb(e);
        if e.tag == "nav" && is_breadcrumb(e) {
            return;
        }
        let in_nav = in_nav || nav_here;
        // An item: its own link, then its submenu under it.
        if in_nav && e.tag == "li" {
            let own = e.children.iter().find_map(|c| match c {
                Node::El(x) if x.tag == "a" => Some(x),
                _ => None,
            });
            let own_href = own
                .and_then(|a| a.attr("href"))
                .and_then(|h| norm_href(h, origins));
            if let (Some(a), Some(h)) = (own, &own_href) {
                out.push(NavEntry {
                    href: h.clone(),
                    parent: parents.last().cloned(),
                    label: a.text(),
                });
            }
            if let Some(h) = &own_href {
                parents.push(h.clone());
            }
            for c in &e.children {
                if let Node::El(x) = c {
                    if x.tag != "a" {
                        walk(x, in_nav, parents, origins, out);
                    }
                }
            }
            if own_href.is_some() {
                parents.pop();
            }
            return;
        }
        if in_nav && e.tag == "a" {
            if let Some(h) = e.attr("href").and_then(|h| norm_href(h, origins)) {
                out.push(NavEntry {
                    href: h,
                    parent: parents.last().cloned(),
                    label: e.text(),
                });
            }
            return;
        }
        for c in &e.children {
            if let Node::El(x) = c {
                walk(x, in_nav, parents, origins, out);
            }
        }
    }
    walk(&doc, false, &mut Vec::new(), origins, &mut out);
    out
}

/// The parity of one page's menus, or of the whole check.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct NavReport {
    /// Pages compared.
    pub pages: Vec<String>,
    /// Source entries (with their parents) found on the export, working.
    pub found: u32,
    /// Source entries of which some are nested (under a parent).
    pub nested: u32,
    pub missing: Vec<String>,
    /// Entries the export has whose link leads nowhere.
    pub broken: Vec<String>,
    pub retired: Vec<String>,
}

impl NavReport {
    pub fn ok(&self) -> bool {
        self.missing.is_empty() && self.broken.is_empty()
    }
}

/// Navigation parity (module docs): `live` and `export` pages by path; `exists` says whether the
/// export answers a path (a page or a redirect); `retired` the entries left out on purpose
/// (URL → reason).
pub fn navigation_parity(
    live: &BTreeMap<String, String>,
    export: &BTreeMap<String, String>,
    origins: &[&str],
    exists: &dyn Fn(&str) -> bool,
    retired: &BTreeMap<String, String>,
) -> NavReport {
    let mut r = NavReport::default();
    for (path, html) in live {
        let Some(ex) = export.get(path) else {
            r.missing
                .push(format!("{path}: the export has no such page"));
            continue;
        };
        r.pages.push(path.clone());
        let want = nav_entries(html, origins);
        let have = nav_entries(ex, origins);
        let have_set: BTreeSet<(&str, Option<&str>)> = have
            .iter()
            .map(|e| (e.href.as_str(), e.parent.as_deref()))
            .collect();
        let have_any: BTreeSet<&str> = have.iter().map(|e| e.href.as_str()).collect();
        let mut seen = BTreeSet::new();
        for e in &want {
            if !seen.insert((e.href.clone(), e.parent.clone())) {
                continue;
            }
            if let Some(why) = retired.get(&e.href) {
                r.retired
                    .push(format!("{path}: \"{}\" ({}) — {why}", e.label, e.href));
                continue;
            }
            let ok = match &e.parent {
                Some(p) => have_set.contains(&(e.href.as_str(), Some(p.as_str()))),
                None => have_any.contains(e.href.as_str()),
            };
            if !ok {
                r.missing.push(format!(
                    "{path}: \"{}\" ({}){}",
                    e.label,
                    e.href,
                    e.parent
                        .as_deref()
                        .map(|p| format!(" under {p}"))
                        .unwrap_or_default()
                ));
                continue;
            }
            if e.href.starts_with('/') && !exists(&e.href) {
                r.broken.push(format!(
                    "{path}: \"{}\" ({}) leads nowhere",
                    e.label, e.href
                ));
                continue;
            }
            r.found += 1;
            if e.parent.is_some() {
                r.nested += 1;
            }
        }
    }
    r
}

/// The template a WordPress page rendered with, from its `<body>` classes: `page-template-x`,
/// `single` for a story, `front-page` for the home, else `page` (the generic one).
pub fn template_of(html: &str) -> String {
    let lower = html.to_ascii_lowercase();
    let Some(i) = lower.find("<body") else {
        return "?".into();
    };
    let tag = &html[i..i + lower[i..].find('>').unwrap_or(0)];
    let class = tag
        .split("class=\"")
        .nth(1)
        .and_then(|c| c.split('"').next())
        .unwrap_or("");
    let cs: Vec<&str> = class.split_whitespace().collect();
    if let Some(t) = cs
        .iter()
        .find_map(|c| c.strip_prefix("page-template-"))
        .filter(|t| *t != "default")
    {
        return t.to_string();
    }
    if cs.contains(&"single") {
        return "single".into();
    }
    if cs.contains(&"home") || cs.contains(&"front-page") {
        return "front-page".into();
    }
    if cs.contains(&"error404") {
        return "404".into();
    }
    "page".into()
}

/// The template check (module docs): one line per source page that renders generically.
pub fn templates(
    export: &BTreeMap<String, String>,
    source: &[String],
    exceptions: &BTreeMap<String, String>,
) -> (BTreeMap<String, u32>, Vec<String>) {
    let mut by: BTreeMap<String, u32> = BTreeMap::new();
    let mut out = Vec::new();
    for path in source {
        let Some(html) = export.get(path) else {
            continue;
        };
        let t = template_of(html);
        *by.entry(t.clone()).or_default() += 1;
        if t == "page" && !exceptions.contains_key(path) {
            out.push(format!("{path} renders with the generic page template"));
        }
    }
    (by, out)
}

/// Pages that show WordPress's default category (module docs).
pub fn uncategorized(export: &BTreeMap<String, String>) -> Vec<String> {
    export
        .iter()
        .filter(|(_, h)| {
            let l = h.to_ascii_lowercase();
            l.contains("/category/uncategorized/") || l.contains(">uncategorized<")
        })
        .map(|(p, _)| p.clone())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const ORIGINS: &[&str] = &["https://cinqueterre.travel"];

    fn page(nav: &str) -> String {
        format!("<html><body><header>{nav}</header><nav aria-label=\"Breadcrumb\"><a href=\"/x/\">x</a></nav></body></html>")
    }

    const LIVE: &str = r#"<nav><ul><li><a href="https://cinqueterre.travel/en/vernazza/">Vernazza</a><ul><li><a href="/en/vernazza/hiking/">Hiking</a></li><li><a href="/en/vernazza/beaches">Beaches</a></li></ul></li><li><a href="/en/team/">Team</a></li><li><a href="">Explore</a></li></ul></nav>"#;

    #[test]
    fn nested_entries_keep_their_parent() {
        let e = nav_entries(&page(LIVE), ORIGINS);
        let got: Vec<(String, Option<String>)> = e
            .iter()
            .map(|x| (x.href.clone(), x.parent.clone()))
            .collect();
        assert_eq!(
            got,
            [
                ("/en/vernazza/".to_string(), None),
                (
                    "/en/vernazza/hiking/".to_string(),
                    Some("/en/vernazza/".to_string())
                ),
                (
                    "/en/vernazza/beaches/".to_string(),
                    Some("/en/vernazza/".to_string())
                ),
                ("/en/team/".to_string(), None),
            ]
        );
    }

    #[test]
    fn parity_fails_for_a_lost_flattened_or_broken_entry_and_spares_the_retired() {
        let live = BTreeMap::from([("/en/".to_string(), page(LIVE))]);
        let exists = |p: &str| p != "/en/vernazza/beaches/";
        // The same menu: every entry found, two nested; one link is broken.
        let same = BTreeMap::from([("/en/".to_string(), page(LIVE))]);
        let r = navigation_parity(&live, &same, ORIGINS, &exists, &BTreeMap::new());
        assert_eq!(r.found, 3);
        assert_eq!(r.nested, 1);
        assert_eq!(r.broken.len(), 1, "{r:?}");
        // A flat menu (the submenu's entries at the top level) loses the nesting.
        let flat = r#"<nav><a href="/en/vernazza/">V</a><a href="/en/vernazza/hiking/">H</a><a href="/en/vernazza/beaches/">B</a><a href="/en/team/">T</a></nav>"#;
        let export = BTreeMap::from([("/en/".to_string(), page(flat))]);
        let all = |_: &str| true;
        let r = navigation_parity(&live, &export, ORIGINS, &all, &BTreeMap::new());
        assert_eq!(r.missing.len(), 2, "{r:?}");
        assert!(r.missing[0].contains("under /en/vernazza/"));
        // A lost entry is missing unless it is retired.
        let lost = LIVE.replace("<li><a href=\"/en/team/\">Team</a></li>", "");
        let export = BTreeMap::from([("/en/".to_string(), page(&lost))]);
        let r = navigation_parity(&live, &export, ORIGINS, &all, &BTreeMap::new());
        assert_eq!(r.missing.len(), 1);
        assert!(!r.ok());
        let retired =
            BTreeMap::from([("/en/team/".to_string(), "the owner's decision".to_string())]);
        let r = navigation_parity(&live, &export, ORIGINS, &all, &retired);
        assert!(r.ok(), "{r:?}");
        assert_eq!(r.retired.len(), 1);
    }

    #[test]
    fn templates_and_uncategorized() {
        let ex = BTreeMap::from([
            ("/en/a/".to_string(), "<html><body class=\"page page-template page-template-page-faq\">x</body></html>".to_string()),
            ("/en/b/".to_string(), "<html><body class=\"page page-template-default\">x</body></html>".to_string()),
            ("/en/blog/c/".to_string(), "<html><body class=\"single single-post\"><a href=\"/category/uncategorized/\">Uncategorized</a></body></html>".to_string()),
        ]);
        let src = vec![
            "/en/a/".to_string(),
            "/en/b/".to_string(),
            "/en/blog/c/".to_string(),
        ];
        let (by, bad) = templates(&ex, &src, &BTreeMap::new());
        assert_eq!(by["page-faq"], 1);
        assert_eq!(by["single"], 1);
        assert_eq!(bad, ["/en/b/ renders with the generic page template"]);
        let exc = BTreeMap::from([("/en/b/".to_string(), "a page of its own".to_string())]);
        assert!(templates(&ex, &src, &exc).1.is_empty());
        assert_eq!(uncategorized(&ex), ["/en/blog/c/"]);
    }
}
