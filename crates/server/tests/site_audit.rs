//! The site audit and the article update path (ADR-0070, FEAT-088):
//! `GET /api/site/audit` (lease, the report of the base head, stale articles by
//! the server's day, the ETag and 304), `GET /api/gateway/file` (a page with its
//! blob sha; 403 outside `content/pages/`, 404 when absent) and the draft's
//! update mode (an update names the blob it replaces; create stays create-only).

mod common;

use common::{article, article_path, with_site, GatewayPlayer, TestServer, LEASE};
use reqwest::header::{COOKIE, ETAG, IF_NONE_MATCH};
use serde_json::{json, Value};

const OLD: &str = "old-harvest";
const FRESH: &str = "fresh-ferry";
const GALLERY: &str = "old-gallery";

/// An older article whose hero image the media index does not list (as on the live site).
fn gallery(extra_image: Option<&str>) -> Value {
    let mut body = vec![
        json!({"type": "editorial-hero", "image": "https://cdn.test/legacy-hero.jpg", "title": {"en": "Old Gallery"}}),
        json!({"type": "paragraph", "text": {"en": "The terraces at dusk."}}),
    ];
    if let Some(url) = extra_image {
        body.push(json!({"type": "editorial-hero", "image": url, "title": {"en": "More"}}));
    }
    json!({"id": "content-gallery", "slug": {"en": "/en/blog/old-gallery"}, "title": {"en": "Old Gallery"},
           "page_type": "blog-article", "status": "published", "body": body})
}

/// An old article (2020), a fresh one, a blog index dating the fresh one, a
/// page with a broken link and a linking policy the page breaks.
fn site_files() -> Vec<(&'static str, String)> {
    let old = article("content-old", OLD, "The Old Harvest");
    let mut old = old;
    old["updated_at"] = json!("2020-03-01T10:00:00.000Z");
    let fresh = article("content-fresh", FRESH, "The Fresh Ferry");
    vec![
        (
            "content/pages/blog/old-harvest.json",
            serde_json::to_string_pretty(&old).unwrap(),
        ),
        (
            "content/pages/blog/fresh-ferry.json",
            serde_json::to_string_pretty(&fresh).unwrap(),
        ),
        (
            "content/pages/blog/old-gallery.json",
            serde_json::to_string_pretty(&gallery(None)).unwrap(),
        ),
        (
            "content/pages/blog-index.json",
            json!({"id": "blog-index", "slug": {"en": "/en/blog"}, "title": {"en": "Blog"},
                   "page_type": "blog-index", "status": "published",
                   "body": [{"type": "blog-index", "stories": [
                       {"id": 1, "slug": FRESH, "title": "The Fresh Ferry", "date": "Oct 1, 2026"},
                       {"id": 2, "slug": OLD, "title": "The Old Harvest", "date": "Mar 1, 2020"}]}]})
            .to_string(),
        ),
        (
            "content/pages/riomaggiore.json",
            json!({"id": "riomaggiore", "slug": {"en": "/en/riomaggiore"}, "title": {"en": "Riomaggiore"},
                   "page_type": "village", "status": "published",
                   "body": [{"type": "paragraph", "text": {"en": "See the harbour."},
                             "href": "/en/nowhere-at-all"}]})
            .to_string(),
        ),
        (
            "content/config/linking-policy.json",
            json!({"policies": {"paragraph": {"minLinks": 0, "maxLinks": 0}}}).to_string(),
        ),
    ]
}

async fn player(s: &TestServer) -> GatewayPlayer {
    let repo = github::RepoId::new("swarmpress-sites", "player1-site");
    let files = site_files();
    let extra: Vec<(&str, &str)> = files.iter().map(|(p, t)| (*p, t.as_str())).collect();
    s.fake_github().create_repo(&repo, &with_site(&extra));
    s.gateway_player(1).await
}

async fn get(
    s: &TestServer,
    p: &GatewayPlayer,
    path: &str,
    if_none_match: Option<&str>,
) -> reqwest::Response {
    let mut req = s
        .http
        .get(s.url(path))
        .header(COOKIE, &p.cookie)
        .header(LEASE, &p.lease);
    if let Some(t) = if_none_match {
        req = req.header(IF_NONE_MATCH, t);
    }
    req.send().await.unwrap()
}

#[tokio::test]
async fn the_audit_reports_signals_broken_links_orphans_stale_articles_and_policy() {
    let s = TestServer::start().await;
    let p = player(&s).await;
    let head = s.fake_github().branch_head(&p.repo, "main").unwrap();
    // without the lease: refused like the gateway
    let res = s
        .http
        .get(s.url("/api/site/audit"))
        .header(COOKIE, &p.cookie)
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 428);

    let res = get(&s, &p, "/api/site/audit", None).await;
    assert_eq!(res.status(), 200);
    let etag = res
        .headers()
        .get(ETAG)
        .unwrap()
        .to_str()
        .unwrap()
        .to_string();
    assert!(etag.starts_with(&format!("\"{head}-")), "{etag}");
    let r: Value = res.json().await.unwrap();
    assert_eq!(r["commit"], json!(head));
    assert_eq!(r["broken_links"], json!(1));
    assert_eq!(
        r["broken_pages"],
        json!([{"path": "content/pages/riomaggiore.json", "title": "Riomaggiore", "broken": 1}])
    );
    assert_eq!(r["signals"]["broken_links"], json!(1));
    assert!(r["signals"]["live_pages"].as_u64().unwrap() > 0);
    // the old article is stale, the fresh one is not
    let stale = r["stale"].as_array().unwrap();
    assert_eq!(stale.len(), 1, "{r}");
    assert_eq!(stale[0]["path"], json!(article_path(OLD)));
    assert_eq!(stale[0]["date"], json!("2020-03-01"));
    assert!(stale[0]["age_days"].as_i64().unwrap() > 2000);
    // the page nobody links to
    let orphans: Vec<&str> = r["orphans"]
        .as_array()
        .unwrap()
        .iter()
        .map(|o| o["path"].as_str().unwrap())
        .collect();
    assert!(
        orphans.contains(&"content/pages/riomaggiore.json"),
        "{orphans:?}"
    );
    assert!(
        !orphans.contains(&article_path(FRESH).as_str()),
        "listed in the blog index"
    );
    // the paragraph with a link the policy does not allow
    assert_eq!(r["policy_count"], json!(1));
    assert_eq!(
        r["policy"][0]["path"],
        json!("content/pages/riomaggiore.json")
    );

    // the same commit and day: 304, no second snapshot
    let snaps = |s: &TestServer| {
        s.fake_github()
            .calls()
            .iter()
            .filter(|c| *c == "snapshot")
            .count()
    };
    let before = snaps(&s);
    let res = get(&s, &p, "/api/site/audit", Some(&etag)).await;
    assert_eq!(res.status(), 304);
    let res = get(&s, &p, "/api/site/audit", None).await;
    assert_eq!(res.status(), 200);
    assert_eq!(snaps(&s), before, "cached per commit");
}

#[tokio::test]
async fn a_page_is_read_with_its_blob_sha_and_only_under_content_pages() {
    let s = TestServer::start().await;
    let p = player(&s).await;
    let path = article_path(OLD);
    let res = get(&s, &p, &format!("/api/gateway/file?path={path}"), None).await;
    assert_eq!(res.status(), 200);
    let f: Value = res.json().await.unwrap();
    assert_eq!(f["path"], json!(path));
    assert_eq!(f["page"]["title"]["en"], json!("The Old Harvest"));
    assert!(f["sha"].as_str().unwrap().len() >= 7);
    let res = get(
        &s,
        &p,
        "/api/gateway/file?path=content/config/site.json",
        None,
    )
    .await;
    assert_eq!(res.status(), 403);
    let res = get(
        &s,
        &p,
        "/api/gateway/file?path=content/pages/blog/none.json",
        None,
    )
    .await;
    assert_eq!(res.status(), 404);
}

#[tokio::test]
async fn an_update_names_the_blob_it_replaces_and_create_stays_create_only() {
    let s = TestServer::start().await;
    let p = player(&s).await;
    let path = article_path(OLD);
    let res = get(&s, &p, &format!("/api/gateway/file?path={path}"), None).await;
    let f: Value = res.json().await.unwrap();
    let sha = f["sha"].as_str().unwrap().to_string();
    let mut page = article("content-old", OLD, "The Old Harvest, Revisited");
    page["updated_at"] = json!("2020-03-01T10:00:00.000Z");

    // create on an existing path: still refused
    let (st, body) = s.draft_article(&p, "content-old", OLD, page.clone()).await;
    assert_eq!(st, 409, "{body}");
    assert!(body.to_string().contains("create-only"), "{body}");

    let draft = |content: &str, update: Option<&str>, slug: &str| {
        json!({"content_id": content, "work_item": "work-item-9", "path": article_path(slug),
               "page": page, "message": format!("Refresh: {slug}"), "update": update})
    };
    // an update with a stale blob sha
    let (st, body) = s
        .gateway(&p, "draft", draft("content-old", Some("0000000"), OLD))
        .await;
    assert_eq!(st, 409, "{body}");
    assert!(body.to_string().contains("changed on main"), "{body}");
    // an update of a path that does not exist
    let other = article("content-new", "no-such-article", "No Such Article");
    let (st, body) = s
        .gateway(
            &p,
            "draft",
            json!({"content_id": "content-new", "path": article_path("no-such-article"), "page": other,
                   "message": "Refresh", "update": sha}),
        )
        .await;
    assert_eq!(st, 409, "{body}");
    // the update of the blob as read (the article's own content id): a pull request
    let (st, body) = s
        .gateway(&p, "draft", draft("content-old", Some(&sha), OLD))
        .await;
    assert_eq!(st, 200, "{body}");
    assert!(body["number"].as_u64().unwrap() > 0, "{body}");
    // an update may keep an older article's own shape, but not change its id
    let legacy = json!({"id": "content-old", "slug": {"en": "/en/blog/old-harvest"}, "title": {"en": "The Old Harvest"},
                        "page_type": "blog-article", "body": [{"type": "paragraph", "text": {"en": "Updated."}}]});
    let (st, body) = s
        .gateway(&p, "draft", json!({"content_id": "content-old", "path": path, "page": legacy, "message": "Refresh", "update": sha}))
        .await;
    assert_eq!(
        st, 200,
        "the profile of new articles does not apply: {body}"
    );
    let mut renamed = legacy.clone();
    renamed["id"] = json!("something-else");
    let (st, _) = s
        .gateway(&p, "draft", json!({"content_id": "content-old", "path": path, "page": renamed, "message": "Refresh", "update": sha}))
        .await;
    assert_eq!(st, 422);
    // update is for articles only
    let (st, _) = s
        .gateway(
            &p,
            "draft",
            json!({"content_id": "content-x", "path": "content/pages/riomaggiore.json",
                   "page": {"id": "riomaggiore", "slug": {"en": "/en/riomaggiore"}, "title": {"en": "R"}, "body": []},
                   "message": "x", "update": sha}),
        )
        .await;
    assert_eq!(st, 400);
}

#[tokio::test]
async fn an_update_is_refused_only_for_the_unknown_media_it_adds() {
    let s = TestServer::start().await;
    let p = player(&s).await;
    let path = article_path(GALLERY);
    let res = get(&s, &p, &format!("/api/gateway/file?path={path}"), None).await;
    let f: Value = res.json().await.unwrap();
    let sha = f["sha"].as_str().unwrap().to_string();
    let draft = |page: Value| json!({"content_id": "content-gallery", "path": path, "page": page, "message": "Fix", "update": sha});

    // A create with that image would be refused: it is not in the media index.
    let mut changed = gallery(None);
    changed["body"][1]["text"]["en"] = json!("The terraces at dusk, revised.");
    // The update keeps the page's own unlisted image: accepted.
    let (st, body) = s.gateway(&p, "draft", draft(changed)).await;
    assert_eq!(st, 200, "{body}");

    // An update that brings a new unlisted image is refused, and only for that one.
    let s2 = TestServer::start().await;
    let p2 = player(&s2).await;
    let res = get(&s2, &p2, &format!("/api/gateway/file?path={path}"), None).await;
    let sha2 = json_sha(res).await;
    let (st, body) = s2
        .gateway(
            &p2,
            "draft",
            json!({"content_id": "content-gallery", "path": path,
            "page": gallery(Some("https://cdn.test/new.jpg")), "message": "Fix", "update": sha2}),
        )
        .await;
    assert_eq!(st, 422, "{body}");
    let text = body.to_string();
    assert!(text.contains("new.jpg"), "{body}");
    assert!(!text.contains("legacy-hero.jpg"), "{body}");
}

async fn json_sha(res: reqwest::Response) -> String {
    let f: Value = res.json().await.unwrap();
    f["sha"].as_str().unwrap().to_string()
}
