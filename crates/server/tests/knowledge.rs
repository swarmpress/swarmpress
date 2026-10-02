//! The knowledge pack through the gateway (ADR-0061 decisions 1 and 4,
//! increments K1 and G3): `GET /api/gateway/knowledge` (lease, ETag = the
//! base head, 304, the in-memory cache and its invalidation by a merge, 413
//! for a site over the snapshot caps) and the closed-world half of the draft
//! check (unknown links and media are refused with 422).

mod common;

use std::path::PathBuf;

use common::{article, GatewayPlayer, Opts, TestServer, LEASE};
use github::GitHubError;
use knowledge::pack::Pack;
use reqwest::header::{CACHE_CONTROL, CONTENT_TYPE, COOKIE, ETAG, IF_NONE_MATCH};
use serde_json::{json, Value};

const SLUG: &str = "harvest-week-in-manarola";
const TITLE: &str = "Harvest Week in Manarola";

async fn get(
    s: &TestServer,
    cookie: &str,
    lease: Option<&str>,
    if_none_match: Option<&str>,
) -> reqwest::Response {
    let mut req = s
        .http
        .get(s.url("/api/gateway/knowledge"))
        .header(COOKIE, cookie);
    if let Some(l) = lease {
        req = req.header(LEASE, l);
    }
    if let Some(t) = if_none_match {
        req = req.header(IF_NONE_MATCH, t);
    }
    req.send().await.unwrap()
}

async fn knowledge(
    s: &TestServer,
    p: &GatewayPlayer,
    if_none_match: Option<&str>,
) -> reqwest::Response {
    get(s, &p.cookie, Some(&p.lease), if_none_match).await
}

fn header(res: &reqwest::Response, name: reqwest::header::HeaderName) -> String {
    res.headers()
        .get(name)
        .map(|v| v.to_str().unwrap().to_string())
        .unwrap_or_default()
}

fn snapshots(s: &TestServer) -> usize {
    s.fake_github()
        .calls()
        .iter()
        .filter(|c| *c == "snapshot")
        .count()
}

fn issues(body: &Value) -> Vec<String> {
    body["issues"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|v| v.as_str().map(String::from))
        .collect()
}

#[tokio::test]
async fn the_pack_of_the_base_head_with_its_etag_and_304_when_it_did_not_move() {
    let s = TestServer::start().await;
    let p = s.gateway_player(1).await;
    let head = s.fake_github().branch_head(&p.repo, "main").unwrap();

    let res = knowledge(&s, &p, None).await;
    assert_eq!(res.status(), 200);
    let etag = header(&res, ETAG);
    assert_eq!(etag, format!("\"{head}\""));
    assert_eq!(header(&res, CACHE_CONTROL), "no-cache");
    assert_eq!(header(&res, CONTENT_TYPE), "application/json");
    let text = res.text().await.unwrap();
    let pack = Pack::from_json(&text).unwrap();
    assert_eq!(pack.commit, head);
    assert_eq!(
        pack.pages.iter().map(|p| p.id.as_str()).collect::<Vec<_>>(),
        vec!["manarola"]
    );
    assert!(pack.file("content/config/media-index.json").is_some());
    assert_eq!(pack.to_json().unwrap(), text, "the body is Pack::to_json");
    assert_eq!(snapshots(&s), 1);

    // Unchanged head: 304 without a body, the same ETag, no snapshot.
    let res = knowledge(&s, &p, Some(&etag)).await;
    assert_eq!(res.status(), 304);
    assert_eq!(header(&res, ETAG), etag);
    assert_eq!(header(&res, CACHE_CONTROL), "no-cache");
    assert!(res.bytes().await.unwrap().is_empty());
    // A weak or listed tag matches too; another tag does not.
    let res = knowledge(&s, &p, Some(&format!("\"0000\", W/{etag}"))).await;
    assert_eq!(res.status(), 304);
    let res = knowledge(&s, &p, Some("\"0000\"")).await;
    assert_eq!(res.status(), 200);
    assert_eq!(res.text().await.unwrap(), text);
    // The second 200 came from the cache.
    assert_eq!(snapshots(&s), 1);
    assert!(s.st.knowledge.contains(&p.repo.to_string(), &head));
}

#[tokio::test]
async fn the_route_needs_a_session_and_the_current_lease() {
    let s = TestServer::start().await;
    let p = s.gateway_player(1).await;
    let res = s
        .http
        .get(s.url("/api/gateway/knowledge"))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 401);
    assert_eq!(get(&s, &p.cookie, None, None).await.status(), 428);
    // A stale lease: another device took the company over.
    let (st, _) = s
        .post_json(
            &format!("/api/companies/{}/lease", p.company),
            Some(&p.cookie),
            json!({ "device_id": "desktop", "mode": "force" }),
        )
        .await;
    assert_eq!(st, 200);
    assert_eq!(get(&s, &p.cookie, Some(&p.lease), None).await.status(), 409);
    // A company whose base branch does not exist: 404.
    let cookie = s.dev_login("nobranch").await;
    let (st, c) = s
        .post_json(
            "/api/companies",
            Some(&cookie),
            json!({ "name": "No Branch", "base_branch": "nope" }),
        )
        .await;
    assert_eq!(st, 201, "{c}");
    let company = c["id"].as_str().unwrap();
    let lease = s.lease(&cookie, company, "laptop").await;
    let res = get(&s, &cookie, Some(&lease), None).await;
    assert_eq!(res.status(), 404);
}

#[tokio::test]
async fn a_merge_moves_the_head_and_drops_the_cached_pack() {
    let s = TestServer::start().await;
    let p = s.gateway_player(1).await;
    let old_head = s.fake_github().branch_head(&p.repo, "main").unwrap();
    let res = knowledge(&s, &p, None).await;
    let old_etag = header(&res, ETAG);
    assert_eq!(res.status(), 200);

    let (st, d) = s
        .draft_article(&p, "c1", SLUG, article("c1", SLUG, TITLE))
        .await;
    assert_eq!(st, 200, "{d}");
    assert!(
        s.st.knowledge.contains(&p.repo.to_string(), &old_head),
        "the draft check read the pack of the same head"
    );
    let (st, m) = s
        .gateway(
            &p,
            "merge",
            json!({ "number": d["number"], "head_sha": d["head_sha"] }),
        )
        .await;
    assert_eq!(st, 200, "{m}");
    assert!(!s.st.knowledge.contains(&p.repo.to_string(), &old_head));
    assert!(s.st.knowledge.is_empty());

    let new_head = s.fake_github().branch_head(&p.repo, "main").unwrap();
    assert_eq!(m["merged_sha"], json!(new_head));
    let res = knowledge(&s, &p, Some(&old_etag)).await;
    assert_eq!(res.status(), 200, "the old ETag is stale");
    let etag = header(&res, ETAG);
    assert_eq!(etag, format!("\"{new_head}\""));
    assert_ne!(etag, old_etag);
    let pack = Pack::from_json(&res.text().await.unwrap()).unwrap();
    assert_eq!(pack.commit, new_head);
    let article = pack
        .pages
        .iter()
        .find(|e| e.path == format!("content/pages/blog/{SLUG}.json"))
        .expect("the merged article is a page of the new pack");
    assert_eq!(article.status.as_deref(), Some("published"));
    assert_eq!(knowledge(&s, &p, Some(&etag)).await.status(), 304);
}

#[tokio::test]
async fn a_site_over_the_snapshot_caps_is_413_and_broken_indexes_are_502() {
    let s = TestServer::start().await;
    let p = s.gateway_player(1).await;
    s.fake_github().fail_next(
        "snapshot",
        GitHubError::TooLarge("the files under `content` are over 33554432 bytes".into()),
    );
    let res = knowledge(&s, &p, None).await;
    assert_eq!(res.status(), 413);
    let body: Value = res.json().await.unwrap();
    assert!(body["error"].as_str().unwrap().contains("over"), "{body}");
    // Nothing partial was cached: the next request builds the pack.
    assert!(s.st.knowledge.is_empty());
    assert_eq!(knowledge(&s, &p, None).await.status(), 200);

    // A draft whose closed world cannot be read is refused the same way.
    let q = s.gateway_player(2).await;
    s.fake_github()
        .fail_next("snapshot", GitHubError::TooLarge("too big".into()));
    let (st, b) = s
        .draft_article(&q, "c1", SLUG, article("c1", SLUG, TITLE))
        .await;
    assert_eq!(st, 413, "{b}");

    // A carried index that is not JSON.
    let r = s.gateway_player(3).await;
    s.fake_github().create_repo(
        &r.repo,
        &common::with_site(&[("content/config/media-index.json", "{ not json")]),
    );
    let res = knowledge(&s, &r, None).await;
    assert_eq!(res.status(), 502);
    let body: Value = res.json().await.unwrap();
    assert!(
        body["error"].as_str().unwrap().contains("media-index.json"),
        "{body}"
    );
}

#[tokio::test]
async fn a_draft_with_an_unknown_link_or_media_is_refused_with_422() {
    let s = TestServer::start().await;
    let p = s.gateway_player(1).await;
    // The closing note links a page the site does not have.
    let mut page = article("c1", SLUG, TITLE);
    page["body"][6]["actions"][0]["href"] = json!("/en/nowhere");
    let (st, b) = s.draft_article(&p, "c1", SLUG, page).await;
    assert_eq!(st, 422, "{b}");
    assert!(
        b["error"]
            .as_str()
            .unwrap()
            .contains("refers to pages or media the site does not have"),
        "{b}"
    );
    assert_eq!(
        issues(&b),
        vec!["/body/6/actions/0/href: \"/en/nowhere\" is not a page of the site: no page at this route"]
    );

    // A hero image that is not in the media index, and an inline one too.
    let mut page = article("c1", SLUG, TITLE);
    page["body"][0]["image"] = json!("https://images.unsplash.com/photo-invented?w=2574");
    page["body"].as_array_mut().unwrap().insert(
        5,
        json!({ "type": "image", "src": "https://example.org/terraces.jpg", "alt": "Terraces" }),
    );
    let (st, b) = s.draft_article(&p, "c1", SLUG, page).await;
    assert_eq!(st, 422, "{b}");
    let found = issues(&b);
    assert_eq!(found.len(), 2, "{found:?}");
    assert!(
        found[0].starts_with("/body/0/image: \"https://images.unsplash.com/photo-invented?w=2574\" is not in the media index"),
        "{found:?}"
    );
    assert!(found[1].starts_with("/body/5/src: "), "{found:?}");

    // Nothing reached GitHub; the valid article still drafts.
    let calls = s.fake_github().calls();
    assert!(
        !calls
            .iter()
            .any(|c| c == "put_file" || c == "create_branch" || c == "create_pr"),
        "{calls:?}"
    );
    let (st, d) = s
        .draft_article(&p, "c1", SLUG, article("c1", SLUG, TITLE))
        .await;
    assert_eq!(st, 200, "{d}");
}

/// The fake GitHub path the scripted e2e runs (`apps/game/e2e/central-server.mjs`):
/// `SWARMPRESS_ARTICLE_PROFILE=off` switches the closed world off with the
/// profile, and `SWARMPRESS_FAKE_SITE` seeds every site repository the fake
/// creates with a site's files, so the browser gets a real pack.
#[tokio::test]
async fn the_fake_github_path_seeded_site_and_profile_off() {
    let mini = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../knowledge/tests/fixtures/cinqueterre-mini");
    let s = TestServer::start_with(Opts {
        tweak: Box::new(move |c| {
            c.article_profile = false;
            c.fake_site = Some(mini);
        }),
    })
    .await;
    // A company whose repo the fake creates on first use, from the seed.
    let (cookie, company) = s.player(1).await;
    let lease = s.lease(&cookie, &company, "laptop").await;
    let res = get(&s, &cookie, Some(&lease), None).await;
    assert_eq!(res.status(), 200);
    let pack = Pack::from_json(&res.text().await.unwrap()).unwrap();
    let kb = knowledge::pack::load(&pack).unwrap();
    assert_eq!(kb.media.len(), 20, "the mini fixture's media index");
    assert_eq!(pack.pages.len(), 9);
    assert!(pack.file("content/config/style-guide.json").is_some());
    assert!(pack.file("content/config/writer-prompt.json").is_some());

    // With the profile off an article outside the closed world is accepted.
    let mut page = article("c1", SLUG, TITLE);
    page["body"][6]["actions"][0]["href"] = json!("/en/nowhere");
    page["body"][0]["image"] = json!("https://example.org/invented.jpg");
    let (st, d) = s
        .send_json(
            reqwest::Method::POST,
            "/api/gateway/draft",
            Some(&cookie),
            &[(LEASE, &lease)],
            Some(json!({ "content_id": "c1", "work_item": "work-c1",
                         "path": format!("content/pages/blog/{SLUG}.json"),
                         "page": page, "message": "Draft" })),
        )
        .await;
    assert_eq!(st, 200, "{d}");

    // Without a seed a fake repository holds a README only: an empty, valid pack.
    let t = TestServer::start().await;
    let (cookie, company) = t.player(1).await;
    let lease = t.lease(&cookie, &company, "laptop").await;
    let res = get(&t, &cookie, Some(&lease), None).await;
    assert_eq!(res.status(), 200);
    let pack = Pack::from_json(&res.text().await.unwrap()).unwrap();
    assert!(pack.files.is_empty() && pack.pages.is_empty());
    knowledge::pack::load(&pack).unwrap();
}
