//! The QA stage's release side (ADR-0094, FEAT-116): what a static export says about its site,
//! for `site_quality` to judge the pages' facts against. Pure: the caller reads the files.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::Value;
use site_quality::facts::{host_of, PageFacts, SiteFacts};

/// Every `<loc>` of a sitemap document.
pub fn sitemap_locs(xml: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = xml;
    while let Some(i) = rest.find("<loc>") {
        rest = &rest[i + 5..];
        let Some(j) = rest.find("</loc>") else {
            break;
        };
        out.push(
            rest[..j]
                .trim()
                .replace("&amp;", "&")
                .replace("&#038;", "&"),
        );
        rest = &rest[j + 6..];
    }
    out
}

/// The sitemap documents a release starts from (WordPress core's, or a plain one).
pub const SITEMAP_ROOTS: &[&str] = &["/wp-sitemap.xml", "/sitemap.xml", "/sitemap_index.xml"];

/// The release's site facts: `release` is `release.json`, `read` gives a file of the release by
/// path, `pages` are the observed facts (their languages and titles).
pub fn site_facts(
    release: &Value,
    read: &dyn Fn(&str) -> Option<String>,
    public_origin: &str,
    production: &str,
    labels: BTreeMap<String, BTreeMap<String, String>>,
    pages: &[PageFacts],
) -> SiteFacts {
    let mut paths = BTreeSet::new();
    for k in ["files", "redirects"] {
        if let Some(o) = release.get(k).and_then(Value::as_object) {
            paths.extend(o.keys().cloned());
        }
    }
    let mut site = SiteFacts {
        public_origin: public_origin.trim_end_matches('/').to_string(),
        production_hosts: BTreeSet::new(),
        languages: pages
            .iter()
            .map(|p| p.lang.clone())
            .filter(|l| !l.is_empty())
            .collect(),
        site_title: site_title(pages),
        paths,
        sitemap_found: false,
        sitemap: BTreeSet::new(),
        labels,
    };
    let host = host_of(production);
    if !host.is_empty() {
        let bare = host.trim_start_matches("www.").to_string();
        site.production_hosts.insert(format!("www.{bare}"));
        site.production_hosts.insert(bare);
    }
    // The sitemap, its index followed inside the release.
    let mut queue: Vec<String> = SITEMAP_ROOTS
        .iter()
        .filter(|p| site.paths.contains(**p))
        .map(|p| p.to_string())
        .collect();
    let mut seen = BTreeSet::new();
    while let Some(p) = queue.pop() {
        if !seen.insert(p.clone()) {
            continue;
        }
        let Some(xml) = read(&p) else { continue };
        site.sitemap_found = true;
        for loc in sitemap_locs(&xml) {
            let Some(path) = site.own_path("/", &loc) else {
                continue;
            };
            if path.ends_with(".xml") {
                queue.push(path);
            } else {
                site.sitemap.insert(path);
            }
        }
    }
    site
}

/// The site's name: the commonest suffix of the pages' titles (`… | Cinque Terre Dispatch`).
pub fn site_title(pages: &[PageFacts]) -> String {
    let mut by: BTreeMap<String, usize> = BTreeMap::new();
    for p in pages {
        if let Some((_, s)) = p.head.title.rsplit_once(" | ") {
            *by.entry(s.trim().to_string()).or_default() += 1;
        }
    }
    by.into_iter()
        .max_by(|a, b| a.1.cmp(&b.1).then_with(|| b.0.cmp(&a.0)))
        .map(|(s, _)| s)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn the_sitemap_index_is_followed_inside_the_release() {
        let release = json!({"files": {"/wp-sitemap.xml": {}, "/wp-sitemap-posts-page-1.xml": {}, "/en/a/": {}}, "redirects": {"/old/": "/en/a/"}});
        let read = |p: &str| {
            match p {
            "/wp-sitemap.xml" => Some("<sitemapindex><sitemap><loc>https://ex.travel/wp-sitemap-posts-page-1.xml</loc></sitemap></sitemapindex>".to_string()),
            "/wp-sitemap-posts-page-1.xml" => Some("<urlset><url><loc>https://ex.travel/en/a/</loc></url><url><loc>https://other.org/x/</loc></url></urlset>".to_string()),
            _ => None,
        }
        };
        let mut p = PageFacts {
            lang: "en".into(),
            ..PageFacts::default()
        };
        p.head.title = "A | Ex".into();
        let s = site_facts(
            &release,
            &read,
            "https://ex.travel",
            "https://ex.travel",
            BTreeMap::new(),
            &[p],
        );
        assert!(s.sitemap_found);
        assert_eq!(s.sitemap, BTreeSet::from(["/en/a/".to_string()]));
        assert!(s.paths.contains("/old/"));
        assert_eq!(s.site_title, "Ex");
        assert!(s.production_hosts.contains("www.ex.travel"));
    }
}
