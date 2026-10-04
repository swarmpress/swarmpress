//! The blog-article profile the gateway enforces (ADR-0061 decisions 3 to 5;
//! `docs/design/mvp-pipeline.md` section 4).
//!
//! A draft at `content/pages/blog/<slug>.json` is an article for the frozen
//! theme and must be exactly the shape the orchestrator assembles:
//!
//! - a valid page under schema v2 (`content_model::validate_page_v2`);
//! - `page_type: "blog-article"`, `id` equal to the content id, and a `slug`
//!   whose every language key is `/<lang>/blog/<slug>` for the file's stem;
//! - one `editorial-hero`, first (the page's only `<h1>`); one
//!   `closing-note`, last; in between only `heading`, `paragraph`, `list`,
//!   `callout` and `image`, with at least one paragraph;
//! - no raw `<` or `>` in `editorial-hero.title` and `closing-note.content`,
//!   the two fields the theme prints with `set:html`.
//!
//! Everything here is pure. The checks that need the site (create-only path,
//! no second open pull request, closed-world links and media) are in the
//! central server's gateway (`crates/server/src/gateway.rs`).
//!
//! The profile lives in this crate, not in the server, so that the browser
//! runs the very same code: the eval harness (FEAT-036, ADR-0058) checks
//! every committed draft against the profile the gateway will enforce
//! (`orchestrator::eval::gateway_checks`, through orchestrator-wasm). The
//! server re-exports this module as `crate::article`.

use std::sync::OnceLock;

use crate::{validate_page_v2, SchemaRegistry};
use serde_json::Value;

/// Articles live directly in this directory of the site repo.
pub const BLOG_DIR: &str = "content/pages/blog/";
/// The hand-curated story list. Only the gateway's finalise step writes it.
pub const BLOG_INDEX_PATH: &str = "content/pages/blog-index.json";
pub const ARTICLE_PAGE_TYPE: &str = "blog-article";
pub const HERO_BLOCK: &str = "editorial-hero";
pub const CLOSING_BLOCK: &str = "closing-note";
/// What may stand between the hero and the closing note.
pub const BODY_BLOCKS: &[&str] = &["heading", "paragraph", "list", "callout", "image"];

const MAX_SLUG_LEN: usize = 100;
/// More problems than this are not worth listing.
const MAX_ISSUES: usize = 40;

/// Whether `path` (already normalised by `PathPolicy`) is an article file:
/// a direct child of `content/pages/blog/`. Compared without case, so a
/// differently cased directory or extension cannot dodge the profile; the
/// profile then insists on the canonical spelling.
pub fn is_article_path(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    lower
        .strip_prefix(BLOG_DIR)
        .is_some_and(|rest| !rest.contains('/'))
}

/// Whether `path` is the blog index page (compared without case).
pub fn is_blog_index_path(path: &str) -> bool {
    path.eq_ignore_ascii_case(BLOG_INDEX_PATH)
}

/// The slug of a canonical article path (`content/pages/blog/<slug>.json`).
pub fn article_slug(path: &str) -> Option<&str> {
    let stem = path.strip_prefix(BLOG_DIR)?.strip_suffix(".json")?;
    (!stem.contains('/')).then_some(stem)
}

/// Lowercase kebab-case, 1 to 100 bytes: what `slugify` produces and what
/// every existing article uses.
pub fn is_valid_slug(slug: &str) -> bool {
    !slug.is_empty()
        && slug.len() <= MAX_SLUG_LEN
        && !slug.starts_with('-')
        && !slug.ends_with('-')
        && !slug.contains("--")
        && slug
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
}

fn registry() -> &'static SchemaRegistry {
    static REGISTRY: OnceLock<SchemaRegistry> = OnceLock::new();
    REGISTRY.get_or_init(SchemaRegistry::core)
}

/// Every string a v2 text field holds: the plain value, or each language of
/// a localized object.
fn texts(value: &Value) -> Vec<&str> {
    match value {
        Value::String(s) => vec![s.as_str()],
        Value::Object(m) => m.values().filter_map(Value::as_str).collect(),
        _ => Vec::new(),
    }
}

fn has_raw_html(value: &Value) -> bool {
    texts(value).iter().any(|s| s.contains(['<', '>']))
}

/// The article profile. `Err` lists every problem found, as text an agent
/// can act on.
pub fn check_article_profile(
    page: &Value,
    path: &str,
    content_id: &str,
) -> Result<(), Vec<String>> {
    let mut issues = Vec::new();

    // ---- path and slug
    let slug = match article_slug(path) {
        Some("") => {
            issues.push("the article slug is empty".to_string());
            None
        }
        Some(s) if is_valid_slug(s) => Some(s),
        Some(s) => {
            issues.push(format!(
                "the article slug {s:?} must be lowercase kebab-case ([a-z0-9-], at most {MAX_SLUG_LEN} bytes)"
            ));
            None
        }
        None => {
            issues.push(format!(
                "an article path must be `{BLOG_DIR}<slug>.json`, got {path:?}"
            ));
            None
        }
    };

    // ---- schema v2
    let report = validate_page_v2(page, registry());
    issues.extend(report.error_lines());

    // ---- envelope
    if page.get("page_type").and_then(Value::as_str) != Some(ARTICLE_PAGE_TYPE) {
        issues.push(format!("/page_type must be {ARTICLE_PAGE_TYPE:?}"));
    }
    if page.get("id").and_then(Value::as_str) != Some(content_id) {
        issues.push(format!("/id must be the content id {content_id:?}"));
    }
    if let Some(slug) = slug {
        match page.get("slug").and_then(Value::as_object) {
            Some(routes) if !routes.is_empty() => {
                for (lang, route) in routes {
                    let want = format!("/{lang}/blog/{slug}");
                    if route.as_str() != Some(want.as_str()) {
                        issues.push(format!(
                            "/slug/{lang} must be {want:?} (the file is {slug}.json)"
                        ));
                    }
                }
            }
            _ => issues.push("/slug must be an object of routes per language".to_string()),
        }
    }

    // ---- blocks: set and order
    match page.get("body").and_then(Value::as_array) {
        None => {} // the schema already reported it
        Some(body) => check_body(body, &mut issues),
    }

    if issues.is_empty() {
        Ok(())
    } else {
        if issues.len() > MAX_ISSUES {
            let more = issues.len() - MAX_ISSUES;
            issues.truncate(MAX_ISSUES);
            issues.push(format!("and {more} more"));
        }
        Err(issues)
    }
}

fn kind(block: &Value) -> &str {
    block.get("type").and_then(Value::as_str).unwrap_or("")
}

fn check_body(body: &[Value], issues: &mut Vec<String>) {
    let count = |t: &str| body.iter().filter(|b| kind(b) == t).count();

    let heroes = count(HERO_BLOCK);
    if heroes != 1 {
        issues.push(format!(
            "/body must hold exactly one {HERO_BLOCK} (the page's only <h1>), found {heroes}"
        ));
    }
    if body.first().map(kind) != Some(HERO_BLOCK) {
        issues.push(format!("/body/0 must be the {HERO_BLOCK}"));
    }
    let closings = count(CLOSING_BLOCK);
    if closings != 1 {
        issues.push(format!(
            "/body must hold exactly one {CLOSING_BLOCK}, found {closings}"
        ));
    }
    if body.last().map(kind) != Some(CLOSING_BLOCK) {
        issues.push(format!(
            "the last block of /body must be the {CLOSING_BLOCK}"
        ));
    }
    for (i, block) in body.iter().enumerate() {
        let t = kind(block);
        if t == HERO_BLOCK || t == CLOSING_BLOCK || BODY_BLOCKS.contains(&t) {
            continue;
        }
        issues.push(format!(
            "/body/{i}: `{t}` is not allowed in an article (allowed: {HERO_BLOCK}, {}, {CLOSING_BLOCK})",
            BODY_BLOCKS.join(", ")
        ));
    }
    if count("paragraph") == 0 {
        issues.push("/body must hold at least one paragraph".to_string());
    }

    // The two fields the frozen theme prints with `set:html`.
    for (i, block) in body.iter().enumerate() {
        let field = match kind(block) {
            HERO_BLOCK => "title",
            CLOSING_BLOCK => "content",
            _ => continue,
        };
        if block.get(field).is_some_and(has_raw_html) {
            issues.push(format!(
                "/body/{i}/{field} is printed as HTML: it must not contain a raw `<` or `>` (escape them)"
            ));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// The page the orchestrator's assembly produces (`agents::article::assemble_page`,
    /// its golden fixture) must pass the gateway's profile: the two sides of one contract.
    #[test]
    fn the_assembled_golden_article_passes_the_profile() {
        let page: Value = serde_json::from_str(include_str!(
            "../../agents/tests/fixtures/article/page.golden.json"
        ))
        .unwrap();
        let id = page["id"].as_str().unwrap().to_string();
        assert_eq!(
            check_article_profile(
                &page,
                "content/pages/blog/harvest-week-in-manarola.json",
                &id
            ),
            Ok(())
        );
    }

    const PATH: &str = "content/pages/blog/harvest-week-in-manarola.json";
    const ID: &str = "content-1a2b";

    /// The shape the orchestrator assembles (design section 4).
    fn article() -> Value {
        json!({
            "id": ID,
            "slug": {
                "en": "/en/blog/harvest-week-in-manarola",
                "de": "/de/blog/harvest-week-in-manarola",
                "fr": "/fr/blog/harvest-week-in-manarola",
                "it": "/it/blog/harvest-week-in-manarola"
            },
            "title": { "en": "Harvest Week in Manarola" },
            "page_type": "blog-article",
            "seo": {
                "title": { "en": "Harvest Week in Manarola | The Dispatch" },
                "description": { "en": "Seven days among the terraces above Manarola, when the whole village picks grapes." },
                "keywords": ["manarola", "harvest"]
            },
            "body": [
                { "type": "editorial-hero", "title": "Harvest Week in Manarola",
                  "subtitle": "Seven days among the terraces above Manarola, when the whole village picks grapes.",
                  "badge": "Culture",
                  "image": "https://images.unsplash.com/photo-1516483638261-f4dbaf036963?q=80&w=2574&auto=format&fit=crop",
                  "height": "70vh" },
                { "type": "paragraph", "markdown": "The monorail starts before the sun does." },
                { "type": "heading", "level": 2, "text": "Tuesday: the first crates" },
                { "type": "paragraph", "markdown": "Maria and her sons carry the first crates down by hand." },
                { "type": "list", "ordered": false, "items": ["Bring water", "Wear boots"] },
                { "type": "callout", "style": "info", "content": "The terraces are private land: ask before you walk in." },
                { "type": "image", "src": "https://images.unsplash.com/photo-1498503182468-3b51cbb6cb24?q=80&w=2670&auto=format&fit=crop",
                  "alt": "Terraced vineyards above the sea" },
                { "type": "closing-note", "badge": "Practical Notes", "title": "Before you go",
                  "content": "Harvest runs from mid-September &amp; into October.",
                  "actions": [{ "label": "More about Manarola", "href": "/en/manarola", "variant": "primary" }] }
            ],
            "metadata": { "author": "Giulia Rossi", "category": "Culture" },
            "status": "in_review"
        })
    }

    fn issues(page: &Value, path: &str, id: &str) -> Vec<String> {
        check_article_profile(page, path, id)
            .err()
            .unwrap_or_default()
    }

    fn has(issues: &[String], needle: &str) -> bool {
        issues.iter().any(|i| i.contains(needle))
    }

    #[test]
    fn article_paths() {
        assert!(is_article_path(PATH));
        assert!(is_article_path("content/pages/blog/.json"));
        assert!(is_article_path("content/pages/Blog/X.JSON"));
        assert!(!is_article_path("content/pages/blog/2026/x.json"));
        assert!(!is_article_path("content/pages/en/x.json"));
        assert!(!is_article_path("content/blog/x.json"));
        assert_eq!(article_slug(PATH), Some("harvest-week-in-manarola"));
        assert_eq!(article_slug("content/pages/Blog/x.json"), None);
        assert!(is_blog_index_path("content/pages/blog-index.json"));
        assert!(is_blog_index_path("content/pages/Blog-Index.json"));
        assert!(!is_blog_index_path(PATH));
        for bad in ["", "-a", "a-", "a--b", "Hidden", "a_b", "a.b", "é"] {
            assert!(!is_valid_slug(bad), "{bad}");
        }
        assert!(is_valid_slug("5-hidden-gelaterias-you-need-to-try"));
        assert!(!is_valid_slug(&"a".repeat(101)));
    }

    #[test]
    fn a_valid_article_passes() {
        assert_eq!(check_article_profile(&article(), PATH, ID), Ok(()));
        // English only is fine too: the server requires `en`, not four keys.
        let mut p = article();
        p["slug"] = json!({ "en": "/en/blog/harvest-week-in-manarola" });
        assert_eq!(check_article_profile(&p, PATH, ID), Ok(()));
    }

    #[test]
    fn schema_violations_are_reported() {
        let mut p = article();
        p["body"][2]["level"] = json!(7);
        assert!(has(&issues(&p, PATH, ID), "/body/2/level"));
        let mut p = article();
        p["surprise"] = json!(true);
        assert!(has(&issues(&p, PATH, ID), "schema"));
        let mut p = article();
        p["body"][1] = json!({ "type": "paragraph" });
        assert!(has(&issues(&p, PATH, ID), "/body/1"));
        // Not even a page.
        assert!(!issues(&json!({ "title": { "en": "x" } }), PATH, ID).is_empty());
    }

    #[test]
    fn envelope_violations() {
        let mut p = article();
        p["page_type"] = json!("page");
        assert!(has(&issues(&p, PATH, ID), "/page_type"));
        assert!(has(&issues(&article(), PATH, "content-other"), "/id"));
        let mut p = article();
        p["slug"]["de"] = json!("/de/blog/something-else");
        let i = issues(&p, PATH, ID);
        assert!(has(&i, "/slug/de"), "{i:?}");
        assert!(!has(&i, "/slug/en"), "{i:?}");
        let mut p = article();
        p["slug"] = json!({ "en": "/en/harvest-week-in-manarola" });
        assert!(has(&issues(&p, PATH, ID), "/slug/en"));
    }

    #[test]
    fn slug_and_path_violations() {
        let empty = "content/pages/blog/.json";
        assert!(has(&issues(&article(), empty, ID), "slug is empty"));
        let upper = "content/pages/blog/Harvest.json";
        assert!(has(&issues(&article(), upper, ID), "kebab-case"));
        let cased = "content/pages/Blog/harvest-week-in-manarola.JSON";
        assert!(has(
            &issues(&article(), cased, ID),
            "an article path must be"
        ));
    }

    #[test]
    fn block_set_and_order() {
        // No hero.
        let mut p = article();
        p["body"].as_array_mut().unwrap().remove(0);
        let i = issues(&p, PATH, ID);
        assert!(
            has(&i, "exactly one editorial-hero") && has(&i, "/body/0 must be"),
            "{i:?}"
        );
        // Two heroes.
        let mut p = article();
        let hero = p["body"][0].clone();
        p["body"].as_array_mut().unwrap().insert(3, hero);
        assert!(has(&issues(&p, PATH, ID), "exactly one editorial-hero"));
        // Hero not first.
        let mut p = article();
        p["body"].as_array_mut().unwrap().swap(0, 1);
        let i = issues(&p, PATH, ID);
        assert!(
            has(&i, "/body/0 must be") && !has(&i, "exactly one"),
            "{i:?}"
        );
        // Closing note missing, and not last.
        let mut p = article();
        p["body"].as_array_mut().unwrap().pop();
        let i = issues(&p, PATH, ID);
        assert!(
            has(&i, "exactly one closing-note") && has(&i, "last block"),
            "{i:?}"
        );
        let mut p = article();
        let n = p["body"].as_array().unwrap().len();
        p["body"].as_array_mut().unwrap().swap(n - 1, n - 2);
        assert!(has(&issues(&p, PATH, ID), "last block"));
        // Blocks outside the article set, valid under the schema or not.
        for block in [
            json!({ "type": "quote", "text": "Never trust a calm sea." }),
            json!({ "type": "faq", "items": [{ "question": "When?", "answer": "September." }] }),
            json!({ "type": "editor-note", "quote": "I walked it last Tuesday.", "author": "Giulia Rossi" }),
        ] {
            let mut p = article();
            let t = block["type"].as_str().unwrap().to_string();
            p["body"].as_array_mut().unwrap().insert(2, block);
            let i = issues(&p, PATH, ID);
            assert!(has(&i, &format!("/body/2: `{t}` is not allowed")), "{i:?}");
        }
        // No text at all.
        let mut p = article();
        let hero = p["body"][0].clone();
        let closing = p["body"].as_array().unwrap().last().unwrap().clone();
        p["body"] = json!([hero, closing]);
        assert!(has(&issues(&p, PATH, ID), "at least one paragraph"));
    }

    #[test]
    fn raw_html_in_the_two_html_fields() {
        let mut p = article();
        p["body"][0]["title"] = json!("Harvest <script>alert(1)</script>");
        assert!(has(
            &issues(&p, PATH, ID),
            "/body/0/title is printed as HTML"
        ));
        let mut p = article();
        let last = p["body"].as_array().unwrap().len() - 1;
        p["body"][last]["content"] = json!("<p>Bring a headlamp.</p>");
        assert!(has(
            &issues(&p, PATH, ID),
            &format!("/body/{last}/content is printed as HTML")
        ));
        // A localized object is checked in every language.
        let mut p = article();
        p["body"][0]["title"] = json!({ "en": "Harvest", "de": "Ernte > Lese" });
        assert!(has(&issues(&p, PATH, ID), "/body/0/title"));
        // Escaped entities and a `<` elsewhere are fine.
        let mut p = article();
        p["body"][0]["title"] = json!("Wine &amp; water &lt;3");
        p["body"][1]["markdown"] = json!("Fewer than 5 < 10 terraces remain.");
        assert_eq!(check_article_profile(&p, PATH, ID), Ok(()));
    }

    #[test]
    fn many_problems_are_capped() {
        let mut p = article();
        let junk: Vec<Value> = (0..80).map(|_| json!({ "type": "nope" })).collect();
        p["body"] = Value::Array(junk);
        let i = issues(&p, PATH, ID);
        assert_eq!(i.len(), MAX_ISSUES + 1);
        assert!(i.last().unwrap().starts_with("and "));
    }
}
