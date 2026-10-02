//! The knowledge pack (ADR-0061): one JSON document per site commit that
//! carries what an executor needs to enforce the closed world for articles
//! without a checkout of the site.
//!
//! ```json
//! { "commit": "<sha>",
//!   "files": { "<repo path>": "<file text, verbatim>" },
//!   "manifest": { ...SiteManifest... },
//!   "pages": [ { "id", "path", "page_type", "routes", "titles", "status" } ] }
//! ```
//!
//! * `files` holds [`PACK_FILES`]: the eight `content/config` files agents
//!   read (entity, media and sitemap indexes, style guide, writer prompt,
//!   content calendar, linking policy, media guidelines) and the blog index
//!   page. A file the site does not have is left out.
//! * `manifest` is the site manifest as [`SiteManifest::load`] sees it on the
//!   full tree. It is carried because a site without `site.manifest.json`
//!   infers it from files the pack does not hold (`content/site.json`,
//!   `content/config/site.json`, the village and collection trees), and link
//!   resolution depends on its languages and base URL.
//! * `pages` is the routed page list ([`PageRegistry::build`]), not the page
//!   bodies: enough to resolve links and to detect slug collisions.
//!
//! [`build`] runs where the tree is (the central server over a repository
//! snapshot, `cargo xtask site-pack` over a clone). [`load`] runs wherever the
//! pack is, including wasm: it needs no [`SiteSource`], no filesystem and no
//! network.
//!
//! [`Pack::to_json`] is deterministic: keys are written in a fixed order
//! (struct fields, then sorted map keys) and file text is copied verbatim, so
//! the same tree at the same commit always gives the same bytes.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::entities::{EntityIndex, ENTITY_INDEX_PATH};
use crate::kb::KnowledgeBase;
use crate::manifest::SiteManifest;
use crate::media::{MediaIndex, MEDIA_INDEX_PATH};
use crate::pages::{PageEntry, PageRegistry};
use crate::source::{KnowledgeError, SiteSource};

/// The blog index page: finalise-on-merge appends to it, and the orchestrator
/// reads it to know which articles and hero images are already listed.
pub const BLOG_INDEX_PATH: &str = "content/pages/blog-index.json";

/// Every file a pack carries verbatim, when the site has it.
pub const PACK_FILES: [&str; 9] = [
    ENTITY_INDEX_PATH,
    MEDIA_INDEX_PATH,
    "content/config/sitemap-index.json",
    "content/config/style-guide.json",
    "content/config/writer-prompt.json",
    "content/config/content-calendar.json",
    "content/config/linking-policy.json",
    "content/config/media-guidelines.json",
    BLOG_INDEX_PATH,
];

/// Used as the `path` of errors about the pack document itself.
const PACK_LABEL: &str = "<knowledge pack>";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Pack {
    /// The site commit the pack was built from.
    pub commit: String,
    /// Repo path → file text, verbatim.
    pub files: BTreeMap<String, String>,
    pub manifest: SiteManifest,
    /// Routed pages, sorted by path.
    pub pages: Vec<PageEntry>,
}

impl Pack {
    /// The pack as compact JSON. Deterministic: see the module docs.
    pub fn to_json(&self) -> Result<String, KnowledgeError> {
        serde_json::to_string(self).map_err(|e| KnowledgeError::Json {
            path: PACK_LABEL.into(),
            message: e.to_string(),
        })
    }

    pub fn from_json(text: &str) -> Result<Self, KnowledgeError> {
        serde_json::from_str(text).map_err(|e| KnowledgeError::Json {
            path: PACK_LABEL.into(),
            message: e.to_string(),
        })
    }

    /// Text of a carried file, or `None` if the site does not have it.
    pub fn file(&self, path: &str) -> Option<&str> {
        self.files.get(path).map(String::as_str)
    }

    /// A carried file parsed as JSON, or `None` if the site does not have it.
    pub fn file_json(&self, path: &str) -> Result<Option<Value>, KnowledgeError> {
        self.file(path)
            .map(|text| {
                serde_json::from_str(text).map_err(|e| KnowledgeError::Json {
                    path: path.to_string(),
                    message: e.to_string(),
                })
            })
            .transpose()
    }
}

/// Builds the pack of the tree in `src`, which must hold all of `content/`
/// at `commit`. Fails if a carried file is not UTF-8 text or if the result
/// would not [`load`].
pub fn build(src: &dyn SiteSource, commit: &str) -> Result<Pack, KnowledgeError> {
    let mut files = BTreeMap::new();
    for path in PACK_FILES {
        let Some(bytes) = src.read(path)? else {
            continue;
        };
        let text = String::from_utf8(bytes).map_err(|e| KnowledgeError::Shape {
            path: path.to_string(),
            message: format!("not UTF-8 text: {e}"),
        })?;
        files.insert(path.to_string(), text);
    }
    let pack = Pack {
        commit: commit.to_string(),
        files,
        manifest: SiteManifest::load(src)?,
        pages: PageRegistry::build(src)?.pages,
    };
    load(&pack)?;
    Ok(pack)
}

/// The knowledge base of a pack. For links, media and the page registry it
/// answers exactly as [`KnowledgeBase::build`] on the tree the pack was built
/// from. It differs where the page bodies or the collection files would be
/// needed: the collection index is empty, and the registry lists id and
/// route conflicts but no stray copies and no read errors.
pub fn load(pack: &Pack) -> Result<KnowledgeBase, KnowledgeError> {
    let entities = pack
        .file_json(ENTITY_INDEX_PATH)?
        .map(|v| EntityIndex::from_value(&v))
        .unwrap_or_default();
    let media = pack
        .file_json(MEDIA_INDEX_PATH)?
        .map(|v| MediaIndex::from_value(&v))
        .unwrap_or_default();
    Ok(KnowledgeBase::from_parts(
        format!("pack@{}", pack.commit),
        pack.manifest.clone(),
        entities,
        media,
        PageRegistry::from_entries(pack.pages.iter().cloned()),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::kb::ClosedWorldKind;
    use crate::source::MemSource;
    use serde_json::json;

    fn site() -> MemSource {
        let mut s = MemSource::new();
        s.insert_json(
            "content/site.json",
            &json!({"name": "Mini", "locales": ["en", "it"], "defaultLocale": "en"}),
        )
        .insert(
            ENTITY_INDEX_PATH,
            "{\n  \"villages\": {\"alpha\": {\"name\": {\"en\": \"Alpha\"}, \"position\": 1}}\n}\n",
        )
        .insert_json(
            MEDIA_INDEX_PATH,
            &json!({"images": [{"id": "alpha-1", "url": "https://img.test/a", "tags": {"village": "alpha", "category": "sights"}}]}),
        )
        .insert("content/config/style-guide.json", "{\"voice\": \"warm\"}\n")
        .insert_json("content/config/navigation.json", &json!({"main_nav": []}))
        .insert_json(
            "content/pages/alpha.json",
            &json!({"id": "alpha", "slug": {"en": "/en/alpha", "it": "/it/alpha"}, "title": {"en": "Alpha"}, "page_type": "village", "body": []}),
        )
        .insert_json(
            BLOG_INDEX_PATH,
            &json!({"id": "blog", "slug": {"en": "/en/blog"}, "title": "Blog", "page_type": "blog", "status": "published", "body": []}),
        );
        s
    }

    #[test]
    fn carries_the_listed_files_verbatim_and_nothing_else() {
        let src = site();
        let pack = build(&src, "c0ffee").unwrap();
        assert_eq!(pack.commit, "c0ffee");
        assert_eq!(
            pack.files.keys().map(String::as_str).collect::<Vec<_>>(),
            vec![
                ENTITY_INDEX_PATH,
                MEDIA_INDEX_PATH,
                "content/config/style-guide.json",
                BLOG_INDEX_PATH,
            ],
            "missing files are left out; navigation.json and site.json are not carried"
        );
        // Verbatim: whitespace and key order of the source file survive.
        assert_eq!(
            pack.file(ENTITY_INDEX_PATH).unwrap().as_bytes(),
            src.read(ENTITY_INDEX_PATH).unwrap().unwrap()
        );
        assert_eq!(
            pack.file_json("content/config/style-guide.json").unwrap(),
            Some(json!({"voice": "warm"}))
        );
        assert_eq!(pack.file_json("content/config/nope.json").unwrap(), None);
        assert_eq!(pack.manifest.name, "Mini");
        let paths: Vec<_> = pack.pages.iter().map(|p| p.path.as_str()).collect();
        assert_eq!(paths, vec!["content/pages/alpha.json", BLOG_INDEX_PATH]);
        assert_eq!(pack.pages[1].status.as_deref(), Some("published"));
    }

    #[test]
    fn json_has_a_fixed_shape_and_key_order() {
        let pack = build(&site(), "c0ffee").unwrap();
        let text = pack.to_json().unwrap();
        assert!(text.starts_with("{\"commit\":\"c0ffee\",\"files\":{\"content/config/"));
        let order: Vec<usize> = ["\"commit\":", "\"files\":", "\"manifest\":", "\"pages\":"]
            .iter()
            .map(|k| text.find(k).unwrap())
            .collect();
        assert!(order.windows(2).all(|w| w[0] < w[1]), "{order:?}");
        let v: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(
            v.as_object().unwrap().keys().collect::<Vec<_>>(),
            vec!["commit", "files", "manifest", "pages"]
        );
        assert_eq!(
            v["pages"][0],
            json!({
                "id": "alpha", "path": "content/pages/alpha.json", "page_type": "village",
                "routes": {"en": "/en/alpha", "it": "/it/alpha"},
                "titles": {"en": "Alpha"}, "status": null
            })
        );
        assert_eq!(Pack::from_json(&text).unwrap(), pack);
        assert_eq!(Pack::from_json(&text).unwrap().to_json().unwrap(), text);
    }

    #[test]
    fn loads_without_a_source() {
        let pack = build(&site(), "c0ffee").unwrap();
        let kb = load(&Pack::from_json(&pack.to_json().unwrap()).unwrap()).unwrap();
        assert_eq!(kb.label, "pack@c0ffee");
        assert_eq!(kb.resolve_link("alpha", "it").unwrap(), "/it/alpha");
        assert_eq!(kb.resolve_media("media:alpha-1").unwrap().id, "alpha-1");
        assert!(kb.resolve_media("media:invented").is_err());
        assert!(kb.collections.files.is_empty());
    }

    #[test]
    fn closed_world_issues_name_the_pointer_and_the_value() {
        let kb = load(&build(&site(), "c0ffee").unwrap()).unwrap();
        let page = json!({
            "slug": {"en": "/en/blog/x"},
            "body": [
                {"type": "image", "src": "https://img.test/a", "alt": "known"},
                {"type": "image", "src": "https://img.test/invented", "alt": "unknown"},
                {"type": "closing-note", "actions": [
                    {"label": "ok", "href": "/en/alpha"},
                    {"label": "gone", "href": "/en/nowhere"}
                ]}
            ]
        });
        let issues = kb.closed_world_issues(&page);
        assert_eq!(
            issues
                .iter()
                .map(|i| (i.kind, i.pointer.as_str()))
                .collect::<Vec<_>>(),
            vec![
                (ClosedWorldKind::Link, "/body/2/actions/1/href"),
                (ClosedWorldKind::Media, "/body/1/src"),
            ]
        );
        assert_eq!(
            issues[0].to_string(),
            "/body/2/actions/1/href: \"/en/nowhere\" is not a page of the site: no page at this route"
        );
        assert!(
            issues[1]
                .message
                .starts_with("\"https://img.test/invented\" is not in the media index"),
            "{}",
            issues[1]
        );
        assert_eq!(ClosedWorldKind::Media.code(), "media");
        assert!(kb
            .closed_world_issues(&json!({"body": [{"type": "image", "src": "https://img.test/a"}]}))
            .is_empty());
    }

    #[test]
    fn a_site_without_indexes_gives_an_empty_closed_world() {
        let mut s = MemSource::new();
        s.insert_json(
            "content/pages/a.json",
            &json!({"id": "a", "slug": {"en": "/en/a"}, "title": "A", "body": []}),
        );
        let pack = build(&s, "0").unwrap();
        assert!(pack.files.is_empty());
        let kb = load(&pack).unwrap();
        assert!(kb.media.is_empty() && kb.entities.entities.is_empty());
        assert_eq!(kb.pages.len(), 1);
    }

    #[test]
    fn broken_or_binary_carried_files_fail_the_build() {
        let mut s = site();
        s.insert(MEDIA_INDEX_PATH, "{ not json");
        assert!(matches!(
            build(&s, "c"),
            Err(KnowledgeError::Json { path, .. }) if path == MEDIA_INDEX_PATH
        ));
        let mut s = site();
        s.insert("content/config/writer-prompt.json", vec![0xff, 0xfe, 0x00]);
        assert!(matches!(
            build(&s, "c"),
            Err(KnowledgeError::Shape { path, .. }) if path == "content/config/writer-prompt.json"
        ));
        assert!(matches!(
            Pack::from_json("{\"commit\": 1}"),
            Err(KnowledgeError::Json { .. })
        ));
    }

    #[test]
    fn registry_from_entries_recomputes_lookups_and_conflicts() {
        let mut s = site();
        s.insert_json(
            "content/pages/x/alpha-copy.json",
            &json!({"id": "alpha", "slug": {"en": "/en/alpha"}, "title": "Copy", "body": []}),
        );
        let direct = PageRegistry::build(&s).unwrap();
        let rebuilt = PageRegistry::from_entries(direct.pages.clone());
        assert_eq!(rebuilt.pages, direct.pages);
        assert_eq!(rebuilt.duplicates, direct.duplicates);
        assert_eq!(rebuilt.duplicates.len(), 2, "same id and same route");
        assert_eq!(
            rebuilt.by_route("/en/alpha").unwrap().path,
            "content/pages/alpha.json",
            "conflicts resolve to the first page by path, as in a direct build"
        );
        assert_eq!(rebuilt.by_id("blog").unwrap().path, BLOG_INDEX_PATH);
    }
}
