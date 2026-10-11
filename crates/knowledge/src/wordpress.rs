//! The knowledge pack of a WordPress site (ADR-0082 §1, plan M4): the closed world read from
//! WordPress's own registries through its REST API, in the pack format the jobs already know
//! ([`crate::pack`]). The governed layer fetches the registries from a sandbox on `live`; this
//! module only shapes them, so it runs in wasm.
//!
//! - **media** (`/wp/v2/media`) become the media index, keyed by attachment id: an article's
//!   hero is a featured image WordPress knows. WordPress media have no category, so landscape
//!   images count as `sights` (the hero block admits them) and portrait ones as inline media;
//! - **posts and pages** become the routed pages (their permalinks are the routes links resolve
//!   to) and the blog index's stories;
//! - **categories and tags** become category entities, and the categories the blog index's tabs;
//! - **block types** (`/wp/v2/block-types`) are carried as [`BLOCK_TYPES_PATH`]: the block set a
//!   capability's blocks must come from;
//! - the site's name and URL become the manifest (one language, `en`, until WordPress sites are
//!   multilingual).
//!
//! The same registries give the same bytes ([`crate::Pack::to_json`] is deterministic): input lists
//! are sorted by id here.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::entities::ENTITY_INDEX_PATH;
use crate::manifest::SiteManifest;
use crate::media::MEDIA_INDEX_PATH;
use crate::pack::{Pack, BLOG_INDEX_PATH};
use crate::pages::PageEntry;
use crate::source::KnowledgeError;

/// The site's block set in a WordPress pack: a JSON array of block names (`core/paragraph`).
pub const BLOCK_TYPES_PATH: &str = "wordpress/block-types.json";

/// What the governed layer read from WordPress's REST API (field names as WordPress gives them).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Registries {
    pub site: SiteInfo,
    #[serde(default)]
    pub posts: Vec<WpPostInfo>,
    #[serde(default)]
    pub pages: Vec<WpPostInfo>,
    #[serde(default)]
    pub terms: Vec<WpTerm>,
    #[serde(default)]
    pub media: Vec<WpMedia>,
    #[serde(default)]
    pub block_types: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct SiteInfo {
    pub name: String,
    /// The URL WordPress believes it has (`home`); permalinks are made relative to it.
    pub url: String,
    #[serde(default)]
    pub description: String,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct WpPostInfo {
    pub id: u64,
    #[serde(default, rename = "type")]
    pub post_type: String,
    pub slug: String,
    pub link: String,
    /// The rendered title (`title.rendered`).
    pub title: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub excerpt: String,
    #[serde(default)]
    pub date: String,
    #[serde(default)]
    pub categories: Vec<u64>,
    #[serde(default)]
    pub featured_media: u64,
    #[serde(default)]
    pub author_name: String,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct WpTerm {
    pub id: u64,
    pub taxonomy: String,
    pub slug: String,
    pub name: String,
    #[serde(default)]
    pub link: String,
    #[serde(default)]
    pub description: String,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct WpMedia {
    pub id: u64,
    pub source_url: String,
    #[serde(default)]
    pub alt_text: String,
    #[serde(default)]
    pub caption: String,
    #[serde(default)]
    pub mime_type: String,
    #[serde(default)]
    pub width: Option<u32>,
    #[serde(default)]
    pub height: Option<u32>,
}

/// A WordPress page or post's id in the pack (`post-12`, `page-3`).
pub fn page_id(post_type: &str, id: u64) -> String {
    format!(
        "{}-{id}",
        if post_type.is_empty() {
            "post"
        } else {
            post_type
        }
    )
}

/// A permalink as a route: the path under the site's URL (`/harvest-week/`).
pub fn route_of(link: &str, site_url: &str) -> String {
    let site = site_url.trim_end_matches('/');
    let rest = link.strip_prefix(site).unwrap_or(link);
    let rest = match rest.find("://") {
        Some(i) => rest[i + 3..]
            .find('/')
            .map(|j| &rest[i + 3 + j..])
            .unwrap_or("/"),
        None => rest,
    };
    if rest.is_empty() {
        "/".into()
    } else {
        rest.to_string()
    }
}

/// The pack of a WordPress site at `commit` (the repository's `live` head).
pub fn pack(reg: &Registries, commit: &str) -> Result<Pack, KnowledgeError> {
    let mut media = reg.media.clone();
    media.sort_by_key(|m| m.id);
    let mut terms = reg.terms.clone();
    terms.sort_by_key(|t| (t.taxonomy.clone(), t.id));
    let mut posts: Vec<&WpPostInfo> = reg.posts.iter().chain(reg.pages.iter()).collect();
    posts.sort_by_key(|p| (p.post_type.clone(), p.id));
    let by_media: BTreeMap<u64, &WpMedia> = media.iter().map(|m| (m.id, m)).collect();
    let categories: BTreeMap<u64, &WpTerm> = terms
        .iter()
        .filter(|t| t.taxonomy == "category")
        .map(|t| (t.id, t))
        .collect();

    let images: Vec<Value> = media
        .iter()
        .filter(|m| m.mime_type.is_empty() || m.mime_type.starts_with("image/"))
        .map(|m| {
            let used_in: Vec<String> = posts
                .iter()
                .filter(|p| p.featured_media == m.id)
                .map(|p| format!("{}:image", if p.post_type == "post" { format!("/blog/{}", p.slug) } else { route_of(&p.link, &reg.site.url) }))
                .collect();
            // WordPress media have no category: a landscape image (or one without its size) may be
            // a hero (`sights`, which the hero block admits); a portrait one is inline only.
            let landscape = match (m.width, m.height) {
                (Some(w), Some(h)) => w >= h,
                _ => true,
            };
            let category = if landscape { "sights" } else { "media" };
            let mut v = json!({ "id": m.id.to_string(), "url": m.source_url, "tags": { "category": category }, "license": "", "usedIn": used_in });
            if !m.alt_text.trim().is_empty() {
                v["alt"] = json!({ "en": m.alt_text.trim() });
            }
            if let (Some(w), Some(h)) = (m.width, m.height) {
                v["dimensions"] = json!({ "width": w, "height": h });
            }
            v
        })
        .collect();
    let entities: Vec<Value> = terms
        .iter()
        .filter(|t| t.taxonomy == "category" || t.taxonomy == "post_tag")
        .map(|t| json!({ "slug": t.slug, "name": { "en": t.name }, "canonicalUrl": { "en": route_of(&t.link, &reg.site.url) } }))
        .collect();
    let stories: Vec<Value> = posts
        .iter()
        .filter(|p| p.post_type == "post" && (p.status.is_empty() || p.status == "publish"))
        .map(|p| {
            json!({
                "id": p.id,
                "slug": p.slug,
                "title": p.title,
                "excerpt": p.excerpt,
                "author": p.author_name,
                "date": p.date,
                "category": p.categories.first().and_then(|c| categories.get(c)).map(|t| t.name.clone()).unwrap_or_default(),
                "image": by_media.get(&p.featured_media).map(|m| m.source_url.clone()).unwrap_or_default(),
            })
        })
        .collect();
    let mut tabs = vec!["All Stories".to_string()];
    tabs.extend(
        categories
            .values()
            .filter(|t| t.slug != "uncategorized")
            .map(|t| t.name.clone()),
    );
    let blog_index = json!({
        "id": "blog-index",
        "title": { "en": reg.site.name },
        "page_type": "blog-index",
        "body": [{ "type": "blog-index", "title": reg.site.name, "categories": tabs, "stories": stories }],
    });
    let mut block_types = reg.block_types.clone();
    block_types.sort();
    block_types.dedup();

    let text = |v: &Value| serde_json::to_string_pretty(v).expect("a JSON value serializes");
    let mut files = BTreeMap::new();
    files.insert(
        MEDIA_INDEX_PATH.to_string(),
        text(&json!({ "version": "1.0.0", "images": images })),
    );
    files.insert(
        ENTITY_INDEX_PATH.to_string(),
        text(&json!({ "version": "1.0.0", "categories": entities })),
    );
    files.insert(BLOG_INDEX_PATH.to_string(), text(&blog_index));
    files.insert(BLOCK_TYPES_PATH.to_string(), text(&json!(block_types)));

    let pages: Vec<PageEntry> = {
        let mut v: Vec<PageEntry> = posts
            .iter()
            .filter(|p| p.status.is_empty() || p.status == "publish")
            .map(|p| PageEntry {
                id: page_id(&p.post_type, p.id),
                path: format!(
                    "wordpress/{}/{}",
                    if p.post_type.is_empty() {
                        "post"
                    } else {
                        &p.post_type
                    },
                    p.id
                ),
                page_type: if p.post_type == "post" {
                    "blog-post".into()
                } else {
                    p.post_type.clone()
                },
                routes: BTreeMap::from([("en".to_string(), route_of(&p.link, &reg.site.url))]),
                titles: BTreeMap::from([("en".to_string(), p.title.clone())]),
                status: Some("published".into()),
            })
            .collect();
        v.sort_by(|a, b| a.path.cmp(&b.path));
        v
    };
    let manifest = SiteManifest {
        name: reg.site.name.clone(),
        base_url: Some(reg.site.url.trim_end_matches('/').to_string()),
        default_language: "en".into(),
        languages: vec!["en".into()],
        regions: vec![],
        sections: vec![],
        collections: vec![],
        inferred: true,
        notes: vec!["the knowledge pack of a WordPress site, read from its REST API".into()],
    };
    let pack = Pack {
        commit: commit.to_string(),
        files,
        manifest,
        pages,
    };
    crate::pack::load(&pack)?;
    Ok(pack)
}

/// The block set a WordPress pack carries (empty for a pack of another site).
pub fn block_types(pack: &Pack) -> Vec<String> {
    pack.file(BLOCK_TYPES_PATH)
        .and_then(|t| serde_json::from_str(t).ok())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    pub(crate) fn registries() -> Registries {
        Registries {
            site: SiteInfo {
                name: "Cinque Terre".into(),
                url: "http://sandbox.invalid".into(),
                description: String::new(),
            },
            posts: vec![
                WpPostInfo {
                    id: 7,
                    post_type: "post".into(),
                    slug: "harvest-week".into(),
                    link: "http://sandbox.invalid/harvest-week/".into(),
                    title: "Harvest week".into(),
                    status: "publish".into(),
                    categories: vec![3],
                    featured_media: 21,
                    ..Default::default()
                },
                WpPostInfo {
                    id: 1,
                    post_type: "post".into(),
                    slug: "hello-world".into(),
                    link: "http://sandbox.invalid/hello-world/".into(),
                    title: "Hello world!".into(),
                    status: "publish".into(),
                    categories: vec![1],
                    ..Default::default()
                },
            ],
            pages: vec![WpPostInfo {
                id: 2,
                post_type: "page".into(),
                slug: "trains".into(),
                link: "http://sandbox.invalid/trains/".into(),
                title: "Trains".into(),
                status: "publish".into(),
                ..Default::default()
            }],
            terms: vec![
                WpTerm {
                    id: 3,
                    taxonomy: "category".into(),
                    slug: "food".into(),
                    name: "Food & Drink".into(),
                    link: "http://sandbox.invalid/category/food/".into(),
                    description: String::new(),
                },
                WpTerm {
                    id: 1,
                    taxonomy: "category".into(),
                    slug: "uncategorized".into(),
                    name: "Uncategorized".into(),
                    link: "http://sandbox.invalid/category/uncategorized/".into(),
                    description: String::new(),
                },
            ],
            media: vec![
                WpMedia {
                    id: 21,
                    source_url: "http://sandbox.invalid/wp-content/uploads/grapes.jpg".into(),
                    alt_text: "Grapes on the terraces".into(),
                    mime_type: "image/jpeg".into(),
                    width: Some(1600),
                    height: Some(900),
                    ..Default::default()
                },
                WpMedia {
                    id: 22,
                    source_url: "http://sandbox.invalid/wp-content/uploads/boats.jpg".into(),
                    alt_text: "Boats in Manarola".into(),
                    mime_type: "image/jpeg".into(),
                    ..Default::default()
                },
            ],
            block_types: vec![
                "core/paragraph".into(),
                "core/heading".into(),
                "core/paragraph".into(),
            ],
        }
    }

    #[test]
    fn a_wordpress_site_becomes_a_pack_the_jobs_already_read() {
        let p = pack(&registries(), "abc").unwrap();
        let kb = crate::pack::load(&p).unwrap();
        assert_eq!(
            kb.media
                .entries
                .iter()
                .map(|m| m.id.as_str())
                .collect::<Vec<_>>(),
            ["21", "22"]
        );
        assert_eq!(
            kb.media.entries[0].alt.as_ref().unwrap().get("en"),
            "Grapes on the terraces"
        );
        assert_eq!(
            kb.pages
                .pages
                .iter()
                .map(|p| (p.id.as_str(), p.route("en").unwrap()))
                .collect::<Vec<_>>(),
            [
                ("page-2", "/trains/"),
                ("post-1", "/hello-world/"),
                ("post-7", "/harvest-week/")
            ]
        );
        assert_eq!(
            kb.entities.get("food").unwrap().name.get("en"),
            "Food & Drink"
        );
        let blog = p.file_json(BLOG_INDEX_PATH).unwrap().unwrap();
        assert_eq!(
            blog["body"][0]["categories"],
            json!(["All Stories", "Food & Drink"])
        );
        assert_eq!(
            blog["body"][0]["stories"][1]["image"],
            "http://sandbox.invalid/wp-content/uploads/grapes.jpg"
        );
        assert_eq!(block_types(&p), ["core/heading", "core/paragraph"]);
        // Deterministic: the same registries in another order give the same bytes.
        let mut shuffled = registries();
        shuffled.posts.reverse();
        shuffled.media.reverse();
        assert_eq!(
            pack(&shuffled, "abc").unwrap().to_json().unwrap(),
            p.to_json().unwrap()
        );
    }

    #[test]
    fn permalinks_become_routes() {
        assert_eq!(
            route_of(
                "http://sandbox.invalid/harvest-week/",
                "http://sandbox.invalid/"
            ),
            "/harvest-week/"
        );
        assert_eq!(
            route_of("http://sandbox.invalid", "http://sandbox.invalid"),
            "/"
        );
        assert_eq!(
            route_of("https://other.example/x/", "http://sandbox.invalid"),
            "/x/"
        );
    }
}
