//! Page registry: every routed page in `content/pages/**`, keyed by id and by
//! route per language, plus duplicate detection (two pages claiming one URL,
//! repeated ids, and stray copies of pages outside `content/pages/`, such as
//! the legacy `content/blog/` mirror of `content/pages/blog/`).

use std::collections::BTreeMap;

use content_model::text_of;
use serde::Serialize;
use serde_json::Value;

use crate::source::{KnowledgeError, SiteSource};

pub const PAGES_DIR: &str = "content/pages";
/// Other content dirs never hold routed pages.
const NON_PAGE_DIRS: &[&str] = &["content/pages/", "content/collections/", "content/config/"];

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PageEntry {
    pub id: String,
    /// Repo path of the page file.
    pub path: String,
    pub page_type: String,
    /// lang → route (`/en/riomaggiore`), normalized.
    pub routes: BTreeMap<String, String>,
    /// lang → title (plain titles are stored under `en`).
    pub titles: BTreeMap<String, String>,
    pub status: Option<String>,
}

impl PageEntry {
    pub fn title(&self, lang: &str) -> &str {
        self.titles
            .get(lang)
            .or_else(|| self.titles.get("en"))
            .or_else(|| self.titles.values().next())
            .map(String::as_str)
            .unwrap_or(&self.id)
    }

    /// Route in `lang`, if the page is published in that language.
    pub fn route(&self, lang: &str) -> Option<&str> {
        self.routes.get(lang).map(String::as_str)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DuplicateKind {
    /// Several pages claim the same URL.
    SameRoute { lang: String, route: String },
    /// Several pages share an `id`.
    SameId { id: String },
    /// A page file outside `content/pages/` mirrors a routed page.
    StrayCopy { identical: bool },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Duplicate {
    #[serde(flatten)]
    pub kind: DuplicateKind,
    /// Involved files; the canonical (routed) one first where applicable.
    pub paths: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct PageRegistry {
    pub pages: Vec<PageEntry>,
    pub duplicates: Vec<Duplicate>,
    /// Page-shaped files outside `content/pages/` that mirror no routed page.
    pub stray_pages: Vec<String>,
    /// Files under `content/pages/` that could not be read as pages.
    pub errors: Vec<String>,
    #[serde(skip)]
    by_id: BTreeMap<String, Vec<usize>>,
    #[serde(skip)]
    by_route: BTreeMap<String, Vec<usize>>,
}

/// Normalizes a route or href path: no query/fragment, leading `/`, no trailing `/`.
pub fn normalize_route(s: &str) -> String {
    let end = s.find(['?', '#']).unwrap_or(s.len());
    let p = s[..end].trim();
    let p = p.trim_end_matches('/');
    if p.is_empty() {
        "/".to_string()
    } else if p.starts_with('/') {
        p.to_string()
    } else {
        format!("/{p}")
    }
}

fn looks_like_page(v: &Value) -> bool {
    v.get("id").is_some_and(Value::is_string)
        && v.get("slug").is_some()
        && v.get("body").is_some_and(Value::is_array)
}

fn entry_from(path: &str, v: &Value) -> Result<PageEntry, String> {
    let id = v["id"].as_str().ok_or("missing string `id`")?.to_string();
    let mut routes = BTreeMap::new();
    match &v["slug"] {
        Value::Object(m) => {
            for (lang, r) in m {
                if let Some(r) = r.as_str() {
                    routes.insert(lang.clone(), normalize_route(r));
                }
            }
        }
        Value::String(s) => {
            routes.insert("en".to_string(), normalize_route(s));
        }
        _ => return Err("missing `slug`".into()),
    }
    let mut titles = BTreeMap::new();
    match &v["title"] {
        Value::Object(m) => {
            for (lang, t) in m {
                if let Some(t) = t.as_str() {
                    titles.insert(lang.clone(), t.to_string());
                }
            }
        }
        other => {
            if let Some(t) = text_of(other, "en") {
                titles.insert("en".to_string(), t);
            }
        }
    }
    Ok(PageEntry {
        id,
        path: path.to_string(),
        page_type: v["page_type"].as_str().unwrap_or_default().to_string(),
        routes,
        titles,
        status: v["status"].as_str().map(str::to_string),
    })
}

impl PageRegistry {
    pub fn build(src: &dyn SiteSource) -> Result<Self, KnowledgeError> {
        let mut reg = PageRegistry::default();
        let mut values: BTreeMap<String, Value> = BTreeMap::new();
        for path in src.list_json(PAGES_DIR)? {
            match src.read_json(&path) {
                Ok(Some(v)) => match entry_from(&path, &v) {
                    Ok(e) => {
                        reg.insert(e);
                        values.insert(path, v);
                    }
                    Err(msg) => reg.errors.push(format!("{path}: {msg}")),
                },
                Ok(None) => {}
                Err(e) => reg.errors.push(e.to_string()),
            }
        }
        reg.find_conflicts();
        // Page-shaped files elsewhere under content/ (e.g. the legacy content/blog mirror).
        for path in src.list_json("content")? {
            if NON_PAGE_DIRS.iter().any(|d| path.starts_with(d)) {
                continue;
            }
            let Ok(Some(v)) = src.read_json(&path) else {
                continue;
            };
            if !looks_like_page(&v) {
                continue;
            }
            let Ok(stray) = entry_from(&path, &v) else {
                continue;
            };
            let twin = reg
                .by_id
                .get(&stray.id)
                .and_then(|v| v.first())
                .copied()
                .or_else(|| {
                    stray
                        .routes
                        .values()
                        .find_map(|r| reg.by_route.get(r).and_then(|v| v.first()).copied())
                });
            match twin {
                Some(i) => {
                    let canonical = reg.pages[i].path.clone();
                    let identical = values.get(&canonical) == Some(&v);
                    reg.duplicates.push(Duplicate {
                        kind: DuplicateKind::StrayCopy { identical },
                        paths: vec![canonical, path],
                    });
                }
                None => reg.stray_pages.push(path),
            }
        }
        Ok(reg)
    }

    fn insert(&mut self, e: PageEntry) {
        let i = self.pages.len();
        self.by_id.entry(e.id.clone()).or_default().push(i);
        for r in e.routes.values() {
            self.by_route.entry(r.clone()).or_default().push(i);
        }
        self.pages.push(e);
    }

    fn find_conflicts(&mut self) {
        for (id, idxs) in &self.by_id {
            if idxs.len() > 1 {
                self.duplicates.push(Duplicate {
                    kind: DuplicateKind::SameId { id: id.clone() },
                    paths: idxs.iter().map(|&i| self.pages[i].path.clone()).collect(),
                });
            }
        }
        for (route, idxs) in &self.by_route {
            if idxs.len() > 1 {
                let lang = self.pages[idxs[0]]
                    .routes
                    .iter()
                    .find(|(_, r)| *r == route)
                    .map(|(l, _)| l.clone())
                    .unwrap_or_default();
                self.duplicates.push(Duplicate {
                    kind: DuplicateKind::SameRoute {
                        lang,
                        route: route.clone(),
                    },
                    paths: idxs.iter().map(|&i| self.pages[i].path.clone()).collect(),
                });
            }
        }
    }

    pub fn len(&self) -> usize {
        self.pages.len()
    }

    pub fn is_empty(&self) -> bool {
        self.pages.is_empty()
    }

    pub fn by_id(&self, id: &str) -> Option<&PageEntry> {
        self.by_id
            .get(id)
            .and_then(|v| v.first())
            .map(|&i| &self.pages[i])
    }

    /// The page routed at `route` (any language). Conflicting routes return
    /// the first page by path; conflicts are listed in [`Self::duplicates`].
    pub fn by_route(&self, route: &str) -> Option<&PageEntry> {
        self.by_route
            .get(&normalize_route(route))
            .and_then(|v| v.first())
            .map(|&i| &self.pages[i])
    }

    /// Pages whose route (in any language) ends with `/<segment>`.
    pub fn by_last_segment(&self, segment: &str) -> Vec<&PageEntry> {
        let suffix = format!("/{}", segment.trim_matches('/'));
        let mut out: Vec<&PageEntry> = self
            .pages
            .iter()
            .filter(|p| p.routes.values().any(|r| r.ends_with(&suffix)))
            .collect();
        out.dedup_by(|a, b| a.id == b.id);
        out
    }

    /// Page counts per language (pages routed in that language).
    pub fn count_by_lang(&self) -> BTreeMap<String, usize> {
        let mut m = BTreeMap::new();
        for p in &self.pages {
            for l in p.routes.keys() {
                *m.entry(l.clone()).or_insert(0) += 1;
            }
        }
        m
    }

    pub fn count_by_type(&self) -> BTreeMap<String, usize> {
        let mut m = BTreeMap::new();
        for p in &self.pages {
            *m.entry(p.page_type.clone()).or_insert(0) += 1;
        }
        m
    }

    /// Pages with no route in the fallback language.
    pub fn missing_fallback(&self) -> Vec<&PageEntry> {
        self.pages
            .iter()
            .filter(|p| !p.routes.contains_key("en"))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::source::MemSource;
    use serde_json::json;

    fn page(id: &str, slug: Value) -> Value {
        json!({"id": id, "slug": slug, "title": {"en": id}, "page_type": "t", "body": []})
    }

    #[test]
    fn indexes_routes_and_finds_duplicates() {
        let mut s = MemSource::new();
        s.insert_json(
            "content/pages/a.json",
            &page("a", json!({"en": "/en/a/", "de": "/de/a"})),
        )
        .insert_json(
            "content/pages/blog/b.json",
            &page("b", json!({"en": "/en/blog/b"})),
        )
        .insert_json(
            "content/pages/x/a2.json",
            &page("a2", json!({"en": "/en/a"})),
        )
        .insert_json(
            "content/pages/x/b2.json",
            &page("b", json!({"en": "/en/blog/b-old"})),
        )
        .insert_json(
            "content/blog/b.json",
            &page("b", json!({"en": "/en/blog/b"})),
        )
        .insert_json(
            "content/blog/c.json",
            &page("c", json!({"en": "/en/blog/c"})),
        )
        .insert_json("content/site.json", &json!({"id": "site"}))
        .insert("content/pages/broken.json", "{\"title\": 1}");
        let r = PageRegistry::build(&s).unwrap();
        assert_eq!(r.len(), 4);
        assert_eq!(r.errors.len(), 1);
        assert_eq!(r.by_route("/en/a").unwrap().id, "a");
        assert_eq!(r.by_route("/de/a/").unwrap().id, "a");
        assert_eq!(r.by_id("b").unwrap().path, "content/pages/blog/b.json");
        let kinds: Vec<_> = r.duplicates.iter().map(|d| &d.kind).collect();
        assert!(kinds.contains(&&DuplicateKind::SameId { id: "b".into() }));
        assert!(kinds.contains(&&DuplicateKind::SameRoute {
            lang: "en".into(),
            route: "/en/a".into()
        }));
        let stray = r
            .duplicates
            .iter()
            .find(|d| matches!(d.kind, DuplicateKind::StrayCopy { .. }))
            .unwrap();
        assert_eq!(
            stray.paths,
            vec!["content/pages/blog/b.json", "content/blog/b.json"]
        );
        assert_eq!(stray.kind, DuplicateKind::StrayCopy { identical: true });
        assert_eq!(r.stray_pages, vec!["content/blog/c.json"]);
        assert_eq!(r.count_by_lang()["en"], 4);
        assert_eq!(r.by_last_segment("b").len(), 1);
    }

    #[test]
    fn normalizes_routes() {
        assert_eq!(normalize_route("/en/x/"), "/en/x");
        assert_eq!(normalize_route("en/x?y=1#z"), "/en/x");
        assert_eq!(normalize_route("/"), "/");
        assert_eq!(normalize_route(""), "/");
    }
}
