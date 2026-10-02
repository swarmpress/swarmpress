//! Articles through the content gateway (ADR-0061): the server-side draft
//! checks for `content/pages/blog/*.json` (schema v2, the article profile,
//! create-only paths, one open pull request per path).

mod common;

use common::{article, article_path, with_site, Opts, TestServer};
use serde_json::{json, Value};

const SLUG: &str = "harvest-week-in-manarola";
const TITLE: &str = "Harvest Week in Manarola";

fn issues(body: &Value) -> Vec<String> {
    body["issues"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default()
}

/// No write reached GitHub.
fn assert_nothing_written(s: &TestServer) {
    let calls = s.fake_github().calls();
    assert!(
        !calls
            .iter()
            .any(|c| c == "put_file" || c == "create_branch" || c == "create_pr"),
        "{calls:?}"
    );
}

#[tokio::test]
async fn a_valid_article_is_drafted() {
    let s = TestServer::start().await;
    let p = s.gateway_player(1).await;
    let (st, d) = s
        .draft_article(&p, "c1", SLUG, article("c1", SLUG, TITLE))
        .await;
    assert_eq!(st, 200, "{d}");
    assert_eq!(d["branch"], "drafts/content-c1");
    assert_eq!(d["created_pr"], true);
    let gh = s.fake_github();
    let text = gh
        .file_text(&p.repo, "drafts/content-c1", &article_path(SLUG))
        .unwrap();
    assert!(text.contains(TITLE), "{text}");
    assert!(gh.file_text(&p.repo, "main", &article_path(SLUG)).is_none());

    // A revision of the same content id at the same path is not a collision.
    let mut v2 = article("c1", SLUG, TITLE);
    v2["body"][1]["markdown"] = json!("The monorail starts at six.");
    let (st, d2) = s.draft_article(&p, "c1", SLUG, v2).await;
    assert_eq!(st, 200, "{d2}");
    assert_eq!(d2["number"], d["number"]);
    assert_ne!(d2["head_sha"], d["head_sha"]);
}

#[tokio::test]
async fn each_profile_violation_is_refused_with_422() {
    let s = TestServer::start().await;
    let p = s.gateway_player(1).await;
    type Mutation = (&'static str, fn(&mut Value), &'static str);
    let cases: [Mutation; 12] = [
        (
            "schema: unknown envelope field",
            |a| a["surprise"] = json!(1),
            "schema",
        ),
        (
            "schema: a block breaks its schema",
            |a| a["body"][2]["level"] = json!(9),
            "/body/2/level",
        ),
        (
            "page type",
            |a| a["page_type"] = json!("page"),
            "/page_type",
        ),
        ("id is not the content id", |a| a["id"] = json!("c2"), "/id"),
        (
            "slug does not match the file",
            |a| a["slug"]["en"] = json!("/en/blog/other"),
            "/slug/en",
        ),
        (
            "no hero",
            |a| {
                a["body"].as_array_mut().unwrap().remove(0);
            },
            "editorial-hero",
        ),
        (
            "hero not first",
            |a| a["body"].as_array_mut().unwrap().swap(0, 1),
            "/body/0 must be",
        ),
        (
            "closing note not last",
            |a| a["body"].as_array_mut().unwrap().swap(5, 6),
            "last block",
        ),
        (
            "a block outside the article set",
            |a| a["body"][1] = json!({ "type": "quote", "text": "Never trust a calm sea." }),
            "`quote` is not allowed",
        ),
        (
            "two heroes",
            |a| {
                let hero = a["body"][0].clone();
                a["body"].as_array_mut().unwrap().insert(2, hero);
            },
            "exactly one editorial-hero",
        ),
        (
            "raw HTML in the hero title",
            |a| a["body"][0]["title"] = json!("Harvest <b>Week</b>"),
            "/body/0/title is printed as HTML",
        ),
        (
            "raw HTML in the closing note",
            |a| a["body"][6]["content"] = json!("<p>Bring a headlamp.</p>"),
            "/body/6/content is printed as HTML",
        ),
    ];
    for (name, mutate, needle) in cases {
        let mut page = article("c1", SLUG, TITLE);
        mutate(&mut page);
        let (st, b) = s.draft_article(&p, "c1", SLUG, page).await;
        assert_eq!(st, 422, "{name}: {b}");
        let found = issues(&b);
        assert!(
            found.iter().any(|i| i.contains(needle)),
            "{name}: {found:?}"
        );
        assert!(b["error"].as_str().unwrap().contains("not a valid article"));
    }
    // An empty slug, a slug that is not kebab-case and a differently cased
    // directory are refused the same way.
    for (path, needle) in [
        ("content/pages/blog/.json", "slug is empty"),
        ("content/pages/blog/Harvest_Week.json", "kebab-case"),
        (
            "content/pages/Blog/harvest-week-in-manarola.json",
            "an article path must be",
        ),
    ] {
        let (st, b) = s
            .gateway(
                &p,
                "draft",
                json!({ "content_id": "c1", "path": path, "page": article("c1", SLUG, TITLE), "message": "m" }),
            )
            .await;
        assert_eq!(st, 422, "{path}: {b}");
        assert!(issues(&b).iter().any(|i| i.contains(needle)), "{path}: {b}");
    }
    assert_nothing_written(&s);
}

#[tokio::test]
async fn an_existing_article_cannot_be_overwritten() {
    let s = TestServer::start().await;
    let p = s.gateway_player(1).await;
    // The site already has this article on main.
    s.fake_github().create_repo(
        &p.repo,
        &with_site(&[(
            "content/pages/blog/hiking-the-blue-trail-what-to-expect.json",
            "{\"id\":\"legacy\"}\n",
        )]),
    );
    let slug = "hiking-the-blue-trail-what-to-expect";
    let (st, b) = s
        .draft_article(&p, "c1", slug, article("c1", slug, "Hiking the Blue Trail"))
        .await;
    assert_eq!(st, 409, "{b}");
    assert!(b["error"].as_str().unwrap().contains("create-only"), "{b}");
    assert_nothing_written(&s);
    assert_eq!(
        s.fake_github()
            .file_text(&p.repo, "main", &article_path(slug))
            .as_deref(),
        Some("{\"id\":\"legacy\"}\n")
    );

    // After its own merge the path exists on main too: a re-draft is refused.
    let (st, d) = s
        .draft_article(&p, "c2", SLUG, article("c2", SLUG, TITLE))
        .await;
    assert_eq!(st, 200, "{d}");
    let (st, m) = s
        .gateway(
            &p,
            "merge",
            json!({ "number": d["number"], "head_sha": d["head_sha"] }),
        )
        .await;
    assert_eq!(st, 200, "{m}");
    let (st, b) = s
        .draft_article(&p, "c2", SLUG, article("c2", SLUG, TITLE))
        .await;
    assert_eq!(st, 409, "{b}");
}

#[tokio::test]
async fn one_open_pull_request_per_path_and_one_path_per_content_id() {
    let s = TestServer::start().await;
    let p = s.gateway_player(1).await;
    let (st, d) = s
        .draft_article(&p, "c1", SLUG, article("c1", SLUG, TITLE))
        .await;
    assert_eq!(st, 200, "{d}");
    s.fake_github().clear_calls();

    // Another content id drafting the same slug.
    let (st, b) = s
        .draft_article(&p, "c2", SLUG, article("c2", SLUG, TITLE))
        .await;
    assert_eq!(st, 409, "{b}");
    assert!(
        b["error"]
            .as_str()
            .unwrap()
            .contains(&format!("pull request #{}", d["number"])),
        "{b}"
    );
    // The same content id drafting a second path.
    let other = "a-second-article";
    let (st, b) = s
        .draft_article(&p, "c1", other, article("c1", other, "A Second Article"))
        .await;
    assert_eq!(st, 409, "{b}");
    assert!(
        b["error"].as_str().unwrap().contains("one content id"),
        "{b}"
    );
    assert_nothing_written(&s);

    // Another company (another repo) is not affected.
    let q = s.gateway_player(2).await;
    let (st, b) = s
        .draft_article(&q, "c2", SLUG, article("c2", SLUG, TITLE))
        .await;
    assert_eq!(st, 200, "{b}");

    // Once the first pull request is merged the path is taken on main.
    let (st, _) = s
        .gateway(
            &p,
            "merge",
            json!({ "number": d["number"], "head_sha": d["head_sha"] }),
        )
        .await;
    assert_eq!(st, 200);
    let (st, b) = s
        .draft_article(&p, "c2", SLUG, article("c2", SLUG, TITLE))
        .await;
    assert_eq!(st, 409, "{b}");
    assert!(b["error"].as_str().unwrap().contains("create-only"), "{b}");
}

#[tokio::test]
async fn the_blog_index_cannot_be_drafted_and_other_content_is_untouched() {
    let s = TestServer::start().await;
    let p = s.gateway_player(1).await;
    let (st, b) = s
        .gateway(
            &p,
            "draft",
            json!({ "content_id": "c1", "path": "content/pages/blog-index.json",
                    "page": { "id": "blog-index" }, "message": "m" }),
        )
        .await;
    assert_eq!(st, 403, "{b}");
    assert_nothing_written(&s);

    // Pages outside the blog are accepted as before: no schema, and a
    // revision may overwrite what is on the base branch.
    s.fake_github()
        .create_repo(&p.repo, &[("content/pages/en/about.json", "{}\n")]);
    let (st, b) = s
        .gateway(
            &p,
            "draft",
            json!({ "content_id": "c1", "path": "content/pages/en/about.json",
                    "page": { "anything": true }, "message": "m" }),
        )
        .await;
    assert_eq!(st, 200, "{b}");
}

#[tokio::test]
async fn the_profile_switch_keeps_the_site_checks() {
    // SWARMPRESS_ARTICLE_PROFILE=off (fake GitHub only): the pre-MVP article
    // shape is accepted, the path stays create-only.
    let s = TestServer::start_with(Opts {
        tweak: Box::new(|c| c.article_profile = false),
    })
    .await;
    let p = s.gateway_player(1).await;
    let old = json!({ "id": "c1", "slug": { "en": "/en/blog/old-shape" }, "title": { "en": "Old" },
                      "page_type": "blog-article", "status": "draft",
                      "body": [{ "type": "paragraph", "markdown": "No hero." }] });
    let (st, d) = s.draft_article(&p, "c1", "old-shape", old.clone()).await;
    assert_eq!(st, 200, "{d}");
    let (st, b) = s.draft_article(&p, "c2", "old-shape", old).await;
    assert_eq!(st, 409, "{b}");
}
