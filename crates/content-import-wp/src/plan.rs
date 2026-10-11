//! The import plan: what the sandbox's REST API writes, in order, on the import branch.
//!
//! - the site's options (title, tagline; the home is the page at `/`);
//! - the theme (`swarmpress/v1/theme`);
//! - one document per URL ([`crate::routes`]): a `post` for a blog article (`page_type`
//!   `blog-article`), a `page` otherwise,
//!   with its route, language, SEO title and description and its source as meta (the sandbox's
//!   routes plugin answers the URL with it), its title, excerpt and body in core blocks;
//! - one menu per language (`site.json`'s `navigation.main`, links in that language);
//! - a report: the block kinds that had no fields (the frozen theme draws them from its own code)
//!   and the URLs with no content.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::markup::{self, Notes};
use crate::routes::{routes, Route, Source, SECTIONS, VILLAGES};
use crate::{localized, Site, LANGS};

/// The theme the sandbox ships for migrated editorial sites.
pub const THEME: &str = "coast";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Plan {
    pub title: String,
    pub tagline: String,
    pub theme: String,
    pub docs: Vec<Doc>,
    pub menus: BTreeMap<String, Vec<MenuItem>>,
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

/// The plan for the whole site.
pub fn plan(site: &Site) -> Plan {
    let mut report = Report::default();
    let mut docs = Vec::new();
    for r in routes(site) {
        let mut notes = Notes::default();
        let doc = doc(site, &r, &mut notes);
        for k in notes.empty_blocks {
            *report.empty_blocks.entry(k).or_default() += 1;
        }
        if doc.content.trim().is_empty() {
            report.empty_routes.push(r.path.clone());
        }
        docs.push(doc);
    }
    let home = site.pages.get("index.json");
    let title = home
        .and_then(|h| h.get("seo").and_then(|s| s.get("title")))
        .and_then(|t| localized(t, "en"))
        .and_then(|t| t.split(" | ").next())
        .or_else(|| site.site.get("name").and_then(Value::as_str))
        .unwrap_or("Site")
        .to_string();
    let tagline = site
        .site
        .get("description")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let menus = LANGS
        .iter()
        .map(|l| (l.to_string(), menu(site, l)))
        .collect();
    Plan {
        title,
        tagline,
        theme: THEME.into(),
        docs,
        menus,
        report,
    }
}

fn last_segment(path: &str) -> String {
    let seg = path.trim_matches('/').rsplit('/').next().unwrap_or("");
    if seg.is_empty() {
        "home".into()
    } else {
        seg.into()
    }
}

/// The document a route publishes.
pub fn doc(site: &Site, r: &Route, notes: &mut Notes) -> Doc {
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
        .map(strip_tags)
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
    let mut content = markup::body(&blocks, lang, notes);
    content.push_str(&collections(site, &blocks, r, lang));
    let seo_title = seo
        .get("title")
        .and_then(|t| localized(t, lang))
        .unwrap_or("");
    let description = seo
        .get("description")
        .and_then(|t| localized(t, lang))
        .unwrap_or("");
    let post = page.get("page_type").and_then(Value::as_str) == Some("blog-article");
    let article = blocks
        .iter()
        .find(|b| b.get("type").and_then(Value::as_str) == Some("blog-article"))
        .and_then(|b| b.get("post"));
    let mut meta = BTreeMap::new();
    meta.insert("_swarmpress_route".to_string(), r.path.clone());
    meta.insert("_swarmpress_lang".to_string(), lang.to_string());
    if !source.is_empty() {
        meta.insert("_swarmpress_source".to_string(), source);
    }
    // The document title is the SEO title, else the page's own title (as the live site has it).
    let document_title = if seo_title.is_empty() {
        title.as_str()
    } else {
        seo_title
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
    if let Some(by) = article
        .and_then(|a| a.get("author"))
        .and_then(|a| localized(a, lang))
    {
        meta.insert("_swarmpress_byline".to_string(), by.to_string());
    }
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
        excerpt: description.to_string(),
        content,
        meta,
        category: article
            .and_then(|a| a.get("category"))
            .and_then(|c| localized(c, lang))
            .map(String::from),
        tags: article
            .and_then(|a| a.get("tags"))
            .and_then(Value::as_array)
            .map(|t| {
                t.iter()
                    .filter_map(|x| localized(x, lang))
                    .map(String::from)
                    .collect()
            })
            .unwrap_or_default(),
        date: page
            .get("created_at")
            .and_then(Value::as_str)
            .map(|d| d.chars().take(19).collect()),
    }
}

fn strip_tags(s: &str) -> String {
    let s = s
        .replace("<br/>", " ")
        .replace("<br />", " ")
        .replace("<br>", " ");
    let mut out = String::new();
    let mut in_tag = false;
    for c in s.chars() {
        match c {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
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
