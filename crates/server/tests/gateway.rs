//! Content gateway against the in-memory FakeGitHub: draft, merge,
//! PathPolicy, the lease requirement, simulated deploys and the
//! `deployment_status` webhook.

mod common;

use common::{Opts, TestServer};
use github::RepoId;
use reqwest::Method;
use serde_json::{json, Value};

const LEASE: &str = "x-simpress-lease";

fn page(title: &str) -> Value {
    json!({ "title": { "en": title }, "blocks": [{ "type": "paragraph", "text": { "en": "Hello" } }] })
}

struct Player {
    cookie: String,
    lease: String,
}

async fn player(s: &TestServer, n: i64) -> Player {
    let (cookie, company) = s.player(n).await;
    let lease = s.lease(&cookie, &company, "laptop").await;
    Player { cookie, lease }
}

async fn draft(s: &TestServer, p: &Player, body: Value) -> (u16, Value) {
    s.send_json(
        Method::POST,
        "/api/gateway/draft",
        Some(&p.cookie),
        &[(LEASE, &p.lease)],
        Some(body),
    )
    .await
}

async fn merge(s: &TestServer, p: &Player, number: u64, head_sha: &str) -> (u16, Value) {
    s.send_json(
        Method::POST,
        "/api/gateway/merge",
        Some(&p.cookie),
        &[(LEASE, &p.lease)],
        Some(json!({ "number": number, "head_sha": head_sha })),
    )
    .await
}

async fn events(s: &TestServer, cookie: &str) -> Vec<Value> {
    let (st, body) = s.get_json("/api/events?after=0", Some(cookie)).await;
    assert_eq!(st, 200, "{body}");
    body["events"].as_array().unwrap().clone()
}

#[tokio::test]
async fn draft_then_merge_lands_a_deploy_event() {
    let s = TestServer::start().await;
    let p = player(&s, 1).await;
    let repo = RepoId::new("simpress-sites", "player1-site");

    let (st, d) = draft(
        &s,
        &p,
        json!({ "content_id": "wi-4", "work_item": "work-item-4", "path": "content/pages/en/harvest.json",
                "page": page("Harvest"), "message": "Draft: harvest" }),
    )
    .await;
    assert_eq!(st, 200, "{d}");
    assert_eq!(d["branch"], "drafts/content-wi-4");
    let number = d["number"].as_u64().unwrap();
    let head = d["head_sha"].as_str().unwrap().to_string();
    let gh = s.fake_github();
    assert_eq!(
        gh.branch_head(&repo, "drafts/content-wi-4").as_deref(),
        Some(head.as_str())
    );
    let text = gh
        .file_text(
            &repo,
            "drafts/content-wi-4",
            "content/pages/en/harvest.json",
        )
        .unwrap();
    assert!(text.contains("Harvest"), "{text}");

    // A revision moves the head; re-drafting identical bytes does not.
    let (_, d2) = draft(
        &s,
        &p,
        json!({ "content_id": "wi-4", "path": "content/pages/en/harvest.json",
                "page": page("Harvest v2"), "message": "Revise" }),
    )
    .await;
    assert_eq!(d2["number"], number);
    let head2 = d2["head_sha"].as_str().unwrap().to_string();
    assert_ne!(head2, head);
    let (_, d3) = draft(
        &s,
        &p,
        json!({ "content_id": "wi-4", "path": "content/pages/en/harvest.json",
                "page": page("Harvest v2"), "message": "Revise" }),
    )
    .await;
    assert_eq!(d3["head_sha"], head2.as_str());
    assert_eq!(d3["committed"], false);

    // Merging the stale head is refused; the reviewed head merges.
    let (st, _) = merge(&s, &p, number, &head).await;
    assert_eq!(st, 409);
    assert!(events(&s, &p.cookie).await.is_empty());
    let (st, m) = merge(&s, &p, number, &head2).await;
    assert_eq!(st, 200, "{m}");
    let merged = m["merged_sha"].as_str().unwrap().to_string();
    assert_eq!(
        gh.branch_head(&repo, "main").as_deref(),
        Some(merged.as_str())
    );
    assert!(gh
        .file_text(&repo, "main", "content/pages/en/harvest.json")
        .unwrap()
        .contains("Harvest v2"));

    // Simulated deploy (fake GitHub default): one DeployLanded event.
    let evs = events(&s, &p.cookie).await;
    assert_eq!(evs.len(), 1, "{evs:?}");
    assert_eq!(evs[0]["kind"], "DeployLanded");
    assert_eq!(evs[0]["payload"]["content_id"], "wi-4");
    assert_eq!(evs[0]["payload"]["work_item"], "work-item-4");
    assert_eq!(evs[0]["payload"]["merged_sha"], merged.as_str());

    // Merging again is idempotent and does not land a second deploy.
    let (st, m2) = merge(&s, &p, number, &head2).await;
    assert_eq!(st, 200);
    assert_eq!(m2["merged_sha"], merged.as_str());
    assert_eq!(events(&s, &p.cookie).await.len(), 1);
}

#[tokio::test]
async fn path_policy_rejections() {
    let s = TestServer::start().await;
    let p = player(&s, 1).await;
    let body = |path: &str, page: Value| json!({ "content_id": "c1", "path": path, "page": page, "message": "m" });
    for (path, code) in [
        ("content/../theme/x.json", 400),
        ("/content/a.json", 400),
        ("content//a.json", 400),
        ("theme/style.json", 403),
        (".github/workflows/deploy.json", 403),
        ("content/package.json", 403),
        ("content/site.manifest.json", 403),
        ("content/notes.md", 400),
        ("README.json", 403),
    ] {
        let (st, b) = draft(&s, &p, body(path, page("x"))).await;
        assert_eq!(st, code, "{path}: {b}");
    }
    // Not an object, too large, bad content id.
    let (st, _) = draft(&s, &p, body("content/a.json", json!("text"))).await;
    assert_eq!(st, 400);
    let big = json!({ "blob": "x".repeat(300 * 1024) });
    let (st, _) = draft(&s, &p, body("content/a.json", big)).await;
    assert_eq!(st, 413);
    let (st, _) = draft(
        &s,
        &p,
        json!({ "content_id": "../main", "path": "content/a.json", "page": page("x"), "message": "m" }),
    )
    .await;
    assert_eq!(st, 400);
    // Nothing reached GitHub's write side.
    let calls = s.fake_github().calls();
    assert!(
        !calls
            .iter()
            .any(|c| c == "put_file" || c == "create_branch"),
        "{calls:?}"
    );
}

#[tokio::test]
async fn gateway_requires_the_lease() {
    let s = TestServer::start().await;
    let (cookie, company) = s.player(1).await;
    let body =
        json!({ "content_id": "c1", "path": "content/a.json", "page": page("x"), "message": "m" });
    // No header → 428.
    let (st, _) = s
        .send_json(
            Method::POST,
            "/api/gateway/draft",
            Some(&cookie),
            &[],
            Some(body.clone()),
        )
        .await;
    assert_eq!(st, 428);
    // Unknown lease → 409.
    let (st, _) = s
        .send_json(
            Method::POST,
            "/api/gateway/draft",
            Some(&cookie),
            &[(LEASE, "not-a-lease")],
            Some(body.clone()),
        )
        .await;
    assert_eq!(st, 409);
    // A lease taken over by another device → 409 for the old one.
    let old = s.lease(&cookie, &company, "laptop").await;
    let (st, _) = s
        .post_json(
            &format!("/api/companies/{company}/lease"),
            Some(&cookie),
            json!({ "device_id": "phone", "force": true }),
        )
        .await;
    assert_eq!(st, 200);
    let (st, _) = s
        .send_json(
            Method::POST,
            "/api/gateway/draft",
            Some(&cookie),
            &[(LEASE, &old)],
            Some(body.clone()),
        )
        .await;
    assert_eq!(st, 409);
    let (st, _) = s
        .send_json(
            Method::POST,
            "/api/gateway/merge",
            Some(&cookie),
            &[(LEASE, &old)],
            Some(json!({ "number": 1, "head_sha": "x" })),
        )
        .await;
    assert_eq!(st, 409);
    // Expired lease → 409.
    let fresh = s.lease(&cookie, &company, "phone").await;
    s.clock.advance(std::time::Duration::from_secs(91));
    let (st, _) = s
        .send_json(
            Method::POST,
            "/api/gateway/draft",
            Some(&cookie),
            &[(LEASE, &fresh)],
            Some(body),
        )
        .await;
    assert_eq!(st, 409);
    // Signed out → 401.
    let (st, _) = s
        .send_json(
            Method::POST,
            "/api/gateway/draft",
            None,
            &[(LEASE, &fresh)],
            Some(json!({})),
        )
        .await;
    assert_eq!(st, 401);
}

#[tokio::test]
async fn merge_only_own_gateway_prs() {
    let s = TestServer::start().await;
    let a = player(&s, 1).await;
    let b = player(&s, 2).await;
    let (_, d) = draft(
        &s,
        &a,
        json!({ "content_id": "c1", "path": "content/a.json", "page": page("A"), "message": "m" }),
    )
    .await;
    let number = d["number"].as_u64().unwrap();
    let head = d["head_sha"].as_str().unwrap();
    // B cannot merge A's PR number (B has no such gateway PR).
    let (st, _) = merge(&s, &b, number, head).await;
    assert_eq!(st, 404);
    let (st, _) = merge(&s, &a, number + 100, head).await;
    assert_eq!(st, 404);
}

#[tokio::test]
async fn without_simulated_deploys_merge_emits_nothing() {
    let s = TestServer::start_with(Opts {
        tweak: Box::new(|c| c.simulate_deploy = false),
    })
    .await;
    let p = player(&s, 1).await;
    let (_, d) = draft(
        &s,
        &p,
        json!({ "content_id": "c1", "path": "content/a.json", "page": page("A"), "message": "m" }),
    )
    .await;
    let (st, _) = merge(
        &s,
        &p,
        d["number"].as_u64().unwrap(),
        d["head_sha"].as_str().unwrap(),
    )
    .await;
    assert_eq!(st, 200);
    assert!(events(&s, &p.cookie).await.is_empty());
}

fn deployment_status(repo: &RepoId, sha: &str, state: &str) -> Value {
    json!({
        "action": "created",
        "deployment_status": { "id": 9, "state": state, "environment": "github-pages" },
        "deployment": { "id": 7, "sha": sha, "ref": "main", "environment": "github-pages" },
        "repository": { "id": 1, "name": repo.name, "full_name": repo.to_string(),
                         "owner": { "login": repo.owner } },
        "installation": { "id": 42 }
    })
}

async fn deliver(s: &TestServer, id: &str, event: &str, body: &Value, secret: &str) -> u16 {
    let bytes = serde_json::to_vec(body).unwrap();
    s.http
        .post(s.url("/webhooks/github"))
        .header("x-github-event", event)
        .header("x-github-delivery", id)
        .header(
            "x-hub-signature-256",
            github::webhooks::sign(secret.as_bytes(), &bytes),
        )
        .header("content-type", "application/json")
        .body(bytes)
        .send()
        .await
        .unwrap()
        .status()
        .as_u16()
}

#[tokio::test]
async fn deployment_status_webhook_lands_the_deploy() {
    let s = TestServer::start_with(Opts {
        tweak: Box::new(|c| c.simulate_deploy = false),
    })
    .await;
    let p = player(&s, 1).await;
    let repo = RepoId::new("simpress-sites", "player1-site");
    let (_, d) = draft(
        &s,
        &p,
        json!({ "content_id": "wi-9", "work_item": "work-item-9", "path": "content/a.json",
                "page": page("A"), "message": "m" }),
    )
    .await;
    let (_, m) = merge(
        &s,
        &p,
        d["number"].as_u64().unwrap(),
        d["head_sha"].as_str().unwrap(),
    )
    .await;
    let sha = m["merged_sha"].as_str().unwrap();
    let secret = "test-webhook-secret";

    // Bad signature → 401, nothing stored.
    let body = deployment_status(&repo, sha, "success");
    assert_eq!(
        deliver(&s, "d-1", "deployment_status", &body, "wrong").await,
        401
    );
    assert!(events(&s, &p.cookie).await.is_empty());

    // Pending is ignored; success lands; a redelivery is deduped.
    let pending = deployment_status(&repo, sha, "in_progress");
    assert_eq!(
        deliver(&s, "d-0", "deployment_status", &pending, secret).await,
        202
    );
    assert_eq!(
        deliver(&s, "d-1", "deployment_status", &body, secret).await,
        202
    );
    assert_eq!(
        deliver(&s, "d-1", "deployment_status", &body, secret).await,
        200
    );
    let evs = events(&s, &p.cookie).await;
    assert_eq!(evs.len(), 1, "{evs:?}");
    assert_eq!(evs[0]["kind"], "DeployLanded");
    assert_eq!(evs[0]["payload"]["content_id"], "wi-9");
    assert_eq!(evs[0]["payload"]["work_item"], "work-item-9");
    assert_eq!(evs[0]["payload"]["merged_sha"], sha);
    assert_eq!(evs[0]["payload"]["source"], "webhook");

    // A failed deploy of an unknown sha still reaches the company inbox.
    let failed = deployment_status(&repo, "abc123", "failure");
    assert_eq!(
        deliver(&s, "d-2", "deployment_status", &failed, secret).await,
        202
    );
    let evs = events(&s, &p.cookie).await;
    assert_eq!(evs[1]["kind"], "DeployFailed");
    assert_eq!(evs[1]["payload"]["content_id"], Value::Null);

    // Other repos and other events don't touch this company.
    let other = deployment_status(&RepoId::new("x", "y"), sha, "success");
    assert_eq!(
        deliver(&s, "d-3", "deployment_status", &other, secret).await,
        202
    );
    assert_eq!(
        deliver(&s, "d-4", "ping", &json!({ "zen": "hi" }), secret).await,
        202
    );
    assert_eq!(events(&s, &p.cookie).await.len(), 2);
}
