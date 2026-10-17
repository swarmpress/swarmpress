//! A JSON-block site moved onto WordPress (ADR-0083 §5, plan M8: cinqueterre.travel).
//!
//! The site repo's JSON pages (blog articles among them) and collections become WordPress posts and pages in
//! core blocks, each keeping its public URL; the sandbox's REST API writes them on a branch, as the
//! CEO, and the branch is merged into `live`. Nothing here talks to WordPress: the crate is the
//! plan, and the `swarmpress-wp-migrate` CLI (feature `cli`) runs it.
//!
//! - [`Site::read`]: the site repo's `content/` directory (pages, collections, the villages'
//!   own content in `config/villages/`).
//! - [`routes`]: every URL the live site serves and the JSON it renders, by the frozen theme's
//!   routing rules (read, never changed: CLAUDE.md rule 9).
//! - [`markup`]: a JSON block as core block markup, every string of it kept, in one language.
//! - [`plan`]: the import plan: options, the theme, one document per URL, the menus.
//! - [`entries`]: the site's structured entries (villages, stays, restaurants, things to do, the
//!   editors) as content types of their own, for the design's listings and home.
//! - [`compose`]: the pages the frozen theme drew from its own code (the home, the village
//!   overview) composed as core blocks, and the weather pages' live forecast block.
//! - [`theme`]: the site's design as data ([`theme_data::ThemeData`], ADR-0093) as the REST calls
//!   that write it onto the neutral theme `canvas`, in a fixed order, idempotently.
//! - [`compare`]: the export against the live site, URL by URL: status, title, content, links.
//! - [`qa`]: what a release says about its site, for the QA stage's rules (ADR-0094).

pub mod compare;
pub mod compose;
pub mod design;
pub mod entries;
pub mod markup;
pub mod parity;
pub mod plan;
pub mod qa;
pub mod routes;
pub mod theme;
pub mod theme_data;

use std::collections::BTreeMap;
use std::path::Path;

use serde_json::Value;

/// The languages the site is published in; `en` is the default and the fallback.
pub const LANGS: [&str; 4] = ["en", "de", "fr", "it"];

/// A site repo's content: pages by their path under `pages/` (`vernazza/restaurants.json`; blog
/// articles are pages too, in `pages/blog/`), collection files by type (`{village, items}`), and `site.json`.
#[derive(Debug, Clone, Default)]
pub struct Site {
    pub pages: BTreeMap<String, Value>,
    pub collections: BTreeMap<String, Vec<Value>>,
    /// The villages' own content (`config/villages/{slug}.json`: hero, intro, SEO), which the
    /// theme's village intro renders.
    pub villages: BTreeMap<String, Value>,
    pub site: Value,
}

impl Site {
    /// Reads `content/` (`pages/`, `collections/`, `config/villages/`, `site.json`; not
    /// `blog/`, which the live site never renders). Unreadable JSON is an
    /// error naming the file: an import never skips a page silently.
    pub fn read(content: &Path) -> Result<Site, String> {
        let mut site = Site {
            site: read_json(&content.join("site.json")).unwrap_or(Value::Null),
            ..Site::default()
        };
        for (rel, v) in json_files(&content.join("pages"))? {
            site.pages.insert(rel, v);
        }
        for (rel, v) in json_files(&content.join("collections"))? {
            let mut parts = rel.split('/');
            let (Some(kind), Some(file)) = (parts.next(), parts.next()) else {
                continue;
            };
            if !file.starts_with('_') {
                site.collections
                    .entry(kind.to_string())
                    .or_default()
                    .push(v);
            }
        }
        for (rel, v) in json_files(&content.join("config/villages"))? {
            if !rel.starts_with('_') && !rel.contains('/') {
                site.villages
                    .insert(rel.trim_end_matches(".json").to_string(), v);
            }
        }
        Ok(site)
    }
}

fn read_json(path: &Path) -> Result<Value, String> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))?;
    serde_json::from_str(&text).map_err(|e| format!("{}: {e}", path.display()))
}

/// Every `*.json` under `dir`, by its path relative to `dir` (`/`-separated), sorted.
fn json_files(dir: &Path) -> Result<Vec<(String, Value)>, String> {
    let mut out = Vec::new();
    if !dir.is_dir() {
        return Ok(out);
    }
    let mut stack = vec![dir.to_path_buf()];
    while let Some(d) = stack.pop() {
        let entries = std::fs::read_dir(&d).map_err(|e| format!("{}: {e}", d.display()))?;
        for e in entries {
            let p = e.map_err(|e| e.to_string())?.path();
            if p.is_dir() {
                stack.push(p);
            } else if p.extension().is_some_and(|x| x == "json") {
                let rel = p
                    .strip_prefix(dir)
                    .map_err(|e| e.to_string())?
                    .components()
                    .map(|c| c.as_os_str().to_string_lossy().into_owned())
                    .collect::<Vec<_>>()
                    .join("/");
                out.push((rel, read_json(&p)?));
            }
        }
    }
    out.sort_by(|a, b| a.0.cmp(&b.0));
    Ok(out)
}

/// A localized value in `lang`, falling back to English, then to any language; a plain string is
/// itself. Not a string (a number, a list) gives `None`.
pub fn localized<'a>(v: &'a Value, lang: &str) -> Option<&'a str> {
    match v {
        Value::String(s) => Some(s.as_str()),
        Value::Object(o) if is_localized(o) => o
            .get(lang)
            .or_else(|| o.get("en"))
            .and_then(Value::as_str)
            .or_else(|| o.values().find_map(Value::as_str)),
        _ => None,
    }
}

/// A localized list (`{"en": ["…"], "de": ["…"]}`) in `lang`, falling back to English.
pub fn localized_list<'a>(v: &'a Value, lang: &str) -> Option<&'a Vec<Value>> {
    match v {
        Value::Array(a) => Some(a),
        Value::Object(o) if is_localized(o) => o
            .get(lang)
            .or_else(|| o.get("en"))
            .and_then(Value::as_array),
        _ => None,
    }
}

/// An object with an English value whose keys are all language codes: a LocalizedString or list.
pub fn is_localized(o: &serde_json::Map<String, Value>) -> bool {
    const KNOWN: [&str; 10] = ["en", "de", "fr", "it", "es", "nl", "pt", "pl", "ja", "zh"];
    !o.is_empty() && o.contains_key("en") && o.keys().all(|k| KNOWN.contains(&k.as_str()))
}

#[cfg(test)]
mod tests;
