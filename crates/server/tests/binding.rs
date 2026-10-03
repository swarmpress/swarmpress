//! Which repository a company writes to (increment G2, ADR-0047): the
//! owner's default binding applied at creation, the allow-list
//! (`SWARMPRESS_ALLOWED_SITE_REPOS`) at creation, at a rebind and on every
//! gateway call, the rebind route (`PATCH /api/companies/me`), and the
//! startup refusals of real-GitHub mode.

mod common;

use common::{file_db, temp_dir, Opts, TestServer, LEASE};
use github::RepoId;
use reqwest::Method;
use serde_json::{json, Value};
use swarmpress_server::app::AppState;
use swarmpress_server::config::{Config, GithubMode, GithubOAuthConfig};
use swarmpress_server::db::accounts;
use swarmpress_server::db::gateway::get_pr;

const REHEARSAL: &str = "drietsch/cinqueterre.travel";
const LIVE: &str = "swarmpress/cinqueterre.travel";

fn opts(f: impl FnOnce(&mut Config) + Send + 'static) -> Opts {
    Opts { tweak: Box::new(f) }
}

/// `PATCH /api/companies/me` with the session and, when given, a lease.
async fn rebind(s: &TestServer, cookie: &str, lease: Option<&str>, body: Value) -> (u16, Value) {
    let headers: Vec<(&str, &str)> = lease.map(|l| (LEASE, l)).into_iter().collect();
    s.send_json(
        Method::PATCH,
        "/api/companies/me",
        Some(cookie),
        &headers,
        Some(body),
    )
    .await
}

/// A non-article page: the gateway takes any JSON object outside the blog.
async fn draft_note(s: &TestServer, p: &common::GatewayPlayer, content_id: &str) -> Value {
    let (st, d) = s
        .gateway(
            p,
            "draft",
            json!({ "content_id": content_id, "work_item": format!("work-{content_id}"),
                    "path": format!("content/pages/en/{content_id}.json"),
                    "page": { "title": { "en": content_id } },
                    "message": format!("Draft: {content_id}") }),
        )
        .await;
    assert_eq!(st, 200, "{d}");
    d
}

fn kinds(events: &[Value]) -> Vec<&str> {
    events.iter().map(|e| e["kind"].as_str().unwrap()).collect()
}

#[tokio::test]
async fn a_new_company_is_bound_to_the_owners_default() {
    let s = TestServer::start_with(opts(|c| {
        c.default_site_repo = Some(REHEARSAL.into());
        c.default_base_branch = "rehearsal".into();
        c.allowed_site_repos = vec![REHEARSAL.into(), "sandbox/live-test".into()];
    }))
    .await;
    let cookie = s.dev_login("ceo").await;
    // The game reads the default before it founds the company, and passes it.
    let (st, me) = s.get_json("/api/me", Some(&cookie)).await;
    assert_eq!(st, 200, "{me}");
    assert_eq!(
        me["default_binding"],
        json!({ "site_repo": REHEARSAL, "base_branch": "rehearsal" })
    );
    assert_eq!(me["company"], Value::Null);
    // Without a binding in the request, the default is applied.
    let (st, c) = s
        .post_json(
            "/api/companies",
            Some(&cookie),
            json!({ "name": "ceo Dispatch" }),
        )
        .await;
    assert_eq!(st, 201, "{c}");
    assert_eq!(
        (c["site_repo"].as_str(), c["site_base_branch"].as_str()),
        (Some(REHEARSAL), Some("rehearsal"))
    );
    let (_, me) = s.get_json("/api/me", Some(&cookie)).await;
    assert_eq!(me["company"]["site_repo"], REHEARSAL);

    // An explicit binding on the list is kept; a missing branch is the default branch.
    let other = s.dev_login("ada").await;
    let (st, c) = s
        .post_json(
            "/api/companies",
            Some(&other),
            json!({ "name": "Ada Daily", "site_repo": "Sandbox/Live-Test" }),
        )
        .await;
    assert_eq!(st, 201, "{c}");
    assert_eq!(
        (c["site_repo"].as_str(), c["site_base_branch"].as_str()),
        (Some("Sandbox/Live-Test"), Some("rehearsal"))
    );
}

#[tokio::test]
async fn without_a_configured_default_the_old_default_stays() {
    let s = TestServer::start().await;
    let cookie = s.dev_login("Carol").await;
    let (_, me) = s.get_json("/api/me", Some(&cookie)).await;
    assert_eq!(
        me["default_binding"],
        json!({ "site_repo": "swarmpress-sites/carol-site", "base_branch": "main" })
    );
}

#[tokio::test]
async fn the_allow_list_refuses_a_company_outside_it() {
    let s = TestServer::start_with(opts(|c| {
        c.allowed_site_repos = vec![REHEARSAL.into()];
    }))
    .await;
    // The legacy default (`{org}/{login}-site`) is not on the list either.
    let cookie = s.dev_login("ceo").await;
    for body in [
        json!({ "name": "X" }),
        json!({ "name": "X", "site_repo": LIVE }),
        json!({ "name": "X", "site_repo": "drietsch/cinqueterre.travel2" }),
    ] {
        let (st, e) = s
            .post_json("/api/companies", Some(&cookie), body.clone())
            .await;
        assert_eq!(st, 403, "{body}: {e}");
        assert!(
            e["error"]
                .as_str()
                .unwrap()
                .contains("SWARMPRESS_ALLOWED_SITE_REPOS"),
            "{e}"
        );
    }
    assert_eq!(s.get_json("/api/companies/me", Some(&cookie)).await.0, 404);
    // Malformed is still a 400, before the list is consulted.
    let (st, _) = s
        .post_json(
            "/api/companies",
            Some(&cookie),
            json!({ "name": "X", "site_repo": "not-a-repo" }),
        )
        .await;
    assert_eq!(st, 400);
    // On the list, compared without case.
    let (st, c) = s
        .post_json(
            "/api/companies",
            Some(&cookie),
            json!({ "name": "X", "site_repo": "Drietsch/CinqueTerre.travel" }),
        )
        .await;
    assert_eq!(st, 201, "{c}");
}

#[tokio::test]
async fn the_gateway_refuses_a_binding_that_is_not_allowed() {
    // A company bound before the list named its repository (here: written
    // straight into the database) cannot write, read the pack or close.
    let s = TestServer::start_with(opts(|c| {
        c.allowed_site_repos = vec![REHEARSAL.into()];
    }))
    .await;
    let cookie = s.dev_login("ceo").await;
    let (_, me) = s.get_json("/api/me", Some(&cookie)).await;
    let user_id = me["user"]["id"].as_str().unwrap().to_string();
    let company = accounts::create_company(&s.db, &user_id, "Old", 1, LIVE, "main", 0)
        .await
        .unwrap()
        .unwrap();
    let lease = s.lease(&cookie, &company.id, "laptop").await;
    let gh = s.fake_github();
    let headers = [(LEASE, lease.as_str())];
    for (method, path, body) in [
        (
            Method::POST,
            "/api/gateway/draft",
            Some(
                json!({ "content_id": "c1", "path": "content/pages/en/a.json",
                         "page": { "title": { "en": "a" } }, "message": "Draft: a" }),
            ),
        ),
        (
            Method::POST,
            "/api/gateway/merge",
            Some(json!({ "number": 1, "head_sha": "abc" })),
        ),
        (Method::GET, "/api/gateway/knowledge", None),
    ] {
        let (st, e) = s
            .send_json(method, path, Some(&cookie), &headers, body)
            .await;
        // The merge of an unknown PR is a 404 before any repository is touched.
        if path.ends_with("merge") {
            assert_eq!(st, 404, "{path}: {e}");
            continue;
        }
        assert_eq!(st, 403, "{path}: {e}");
        assert!(e["error"].as_str().unwrap().contains(LIVE), "{path}: {e}");
    }
    assert!(gh.calls().is_empty(), "{:?}", gh.calls());
    assert!(gh
        .branch_head(&RepoId::new("swarmpress", "cinqueterre.travel"), "main")
        .is_none());

    // Rebound onto the list, the same company works.
    let (st, c) = rebind(&s, &cookie, Some(&lease), json!({ "site_repo": REHEARSAL })).await;
    assert_eq!(st, 200, "{c}");
    let (st, d) = s
        .send_json(
            Method::POST,
            "/api/gateway/draft",
            Some(&cookie),
            &headers,
            Some(
                json!({ "content_id": "c1", "path": "content/pages/en/a.json",
                         "page": { "title": { "en": "a" } }, "message": "Draft: a" }),
            ),
        )
        .await;
    assert_eq!(st, 200, "{d}");
    assert!(gh
        .branch_head(
            &RepoId::new("drietsch", "cinqueterre.travel"),
            "drafts/content-c1"
        )
        .is_some());
}

#[tokio::test]
async fn a_rebind_needs_the_lease_and_the_allow_list() {
    let s = TestServer::start_with(opts(|c| {
        c.allowed_site_repos = vec!["swarmpress-sites/player1-site".into(), REHEARSAL.into()];
    }))
    .await;
    let p = s.gateway_player(1).await;
    let before = s.get_json("/api/companies/me", Some(&p.cookie)).await.1;

    // No session, no lease, a stale lease.
    let (st, _) = s
        .send_json(
            Method::PATCH,
            "/api/companies/me",
            None,
            &[],
            Some(json!({ "site_repo": REHEARSAL })),
        )
        .await;
    assert_eq!(st, 401);
    let (st, e) = rebind(&s, &p.cookie, None, json!({ "site_repo": REHEARSAL })).await;
    assert_eq!(st, 428, "{e}");
    let (st, taken) = s
        .post_json(
            &format!("/api/companies/{}/lease", p.company),
            Some(&p.cookie),
            json!({ "device_id": "phone", "mode": "force" }),
        )
        .await;
    assert_eq!(st, 200, "{taken}");
    let other = taken["token"].as_str().unwrap().to_string();
    let (st, e) = rebind(
        &s,
        &p.cookie,
        Some(&p.lease),
        json!({ "site_repo": REHEARSAL }),
    )
    .await;
    assert_eq!(st, 409, "a taken-over lease: {e}");

    // Outside the list, malformed, or nothing named: refused.
    for (body, code) in [
        (json!({ "site_repo": LIVE }), 403),
        (json!({ "site_repo": "nope" }), 400),
        (json!({ "base_branch": "a..b" }), 400),
        (json!({}), 400),
        (json!({ "site_repo": "  ", "base_branch": "" }), 400),
    ] {
        let (st, e) = rebind(&s, &p.cookie, Some(&other), body.clone()).await;
        assert_eq!(st, code, "{body}: {e}");
    }
    // An unknown field is refused by the body's shape.
    let (st, _) = rebind(&s, &p.cookie, Some(&other), json!({ "repo": REHEARSAL })).await;
    assert!((400..500).contains(&st), "{st}");
    assert_eq!(
        s.get_json("/api/companies/me", Some(&p.cookie)).await.1,
        before
    );
    assert!(s
        .inbox(&p.cookie)
        .await
        .iter()
        .all(|e| e["kind"] != "SiteRebound"));

    // The same binding again changes nothing and records nothing.
    let (st, c) = rebind(
        &s,
        &p.cookie,
        Some(&other),
        json!({ "site_repo": "Swarmpress-Sites/Player1-Site", "base_branch": "main" }),
    )
    .await;
    assert_eq!(st, 200, "{c}");
    assert_eq!(c, before);
    assert!(s
        .inbox(&p.cookie)
        .await
        .iter()
        .all(|e| e["kind"] != "SiteRebound"));
}

#[tokio::test]
async fn a_rebind_waits_for_open_pull_requests_and_is_recorded() {
    let s = TestServer::start_with(opts(|c| {
        c.allowed_site_repos = vec!["swarmpress-sites/player1-site".into(), REHEARSAL.into()];
    }))
    .await;
    let p = s.gateway_player(1).await;
    let gh = s.fake_github();
    let fork = RepoId::new("drietsch", "cinqueterre.travel");

    // #1 is merged (and, simulated, landed); #2 stays open.
    let d1 = draft_note(&s, &p, "c1").await;
    let (st, m) = s
        .gateway(
            &p,
            "merge",
            json!({ "number": d1["number"], "head_sha": d1["head_sha"] }),
        )
        .await;
    assert_eq!(st, 200, "{m}");
    let d2 = draft_note(&s, &p, "c2").await;
    assert_eq!(
        (d1["number"].as_u64(), d2["number"].as_u64()),
        (Some(1), Some(2))
    );

    let (st, e) = rebind(
        &s,
        &p.cookie,
        Some(&p.lease),
        json!({ "site_repo": REHEARSAL }),
    )
    .await;
    assert_eq!(st, 409, "{e}");
    let why = e["error"].as_str().unwrap();
    assert!(
        why.contains("#2") && why.contains("open") && !why.contains("#1"),
        "{why}"
    );
    let (_, c) = s.get_json("/api/companies/me", Some(&p.cookie)).await;
    assert_eq!(c["site_repo"], "swarmpress-sites/player1-site");

    // Closed, the company may move. The event names both bindings, who and which lease.
    let (st, _) = s.gateway(&p, "close", json!({ "number": 2 })).await;
    assert_eq!(st, 200);
    let (st, c) = rebind(
        &s,
        &p.cookie,
        Some(&p.lease),
        json!({ "site_repo": REHEARSAL, "base_branch": "main" }),
    )
    .await;
    assert_eq!(st, 200, "{c}");
    assert_eq!(
        (c["site_repo"].as_str(), c["site_base_branch"].as_str()),
        (Some(REHEARSAL), Some("main"))
    );
    let inbox = s.inbox(&p.cookie).await;
    let rebound: Vec<&Value> = inbox
        .iter()
        .filter(|e| e["kind"] == "SiteRebound")
        .collect();
    assert_eq!(rebound.len(), 1, "{:?}", kinds(&inbox));
    let epoch: i64 = p.lease.split('.').next().unwrap().parse().unwrap();
    assert_eq!(
        rebound[0]["payload"],
        json!({
            "from": { "site_repo": "swarmpress-sites/player1-site", "base_branch": "main" },
            "to": { "site_repo": REHEARSAL, "base_branch": "main" },
            "by": "player1",
            "epoch": epoch,
            "retired": 2,
        })
    );

    // The old repository's pull requests were retired: the fork's #1 is a new
    // pull request, open, not the merged #1 of the old repository.
    assert!(get_pr(&s.db, &p.company, 1).await.unwrap().is_none());
    let n1 = draft_note(&s, &p, "c3").await;
    assert_eq!(n1["number"], 1);
    assert!(gh.branch_head(&fork, "drafts/content-c3").is_some());
    let row = get_pr(&s.db, &p.company, 1).await.unwrap().unwrap();
    assert_eq!((row.state(), row.content_id.as_str()), ("open", "c3"));
    let (st, status) = s
        .get_json("/api/gateway/deploy-status?number=1", Some(&p.cookie))
        .await;
    assert_eq!(st, 200, "{status}");
    assert_eq!(status["state"], "open");
    // The new #1 closes (an old merged row would have refused with 409).
    let (st, c) = s.gateway(&p, "close", json!({ "number": 1 })).await;
    assert_eq!(st, 200, "{c}");
    // Nothing in the old repository was touched by the rebind.
    let old = RepoId::new("swarmpress-sites", "player1-site");
    assert!(gh
        .file_text(&old, "main", "content/pages/en/c1.json")
        .is_some());
}

#[tokio::test]
async fn a_rebind_waits_for_a_pending_deployment() {
    // No simulated deploys: a merge stays `pending` until it is observed.
    let s = TestServer::start_with(opts(|c| {
        c.simulate_deploy = false;
        c.allowed_site_repos = vec!["swarmpress-sites/player1-site".into(), REHEARSAL.into()];
    }))
    .await;
    let p = s.gateway_player(1).await;
    let d = draft_note(&s, &p, "c1").await;
    let (st, m) = s
        .gateway(
            &p,
            "merge",
            json!({ "number": d["number"], "head_sha": d["head_sha"] }),
        )
        .await;
    assert_eq!(st, 200, "{m}");
    let (st, e) = rebind(
        &s,
        &p.cookie,
        Some(&p.lease),
        json!({ "site_repo": REHEARSAL }),
    )
    .await;
    assert_eq!(st, 409, "{e}");
    assert!(e["error"].as_str().unwrap().contains("pending"), "{e}");
    // A change of base branch on the same repository is a rebind too.
    let (st, e) = rebind(
        &s,
        &p.cookie,
        Some(&p.lease),
        json!({ "base_branch": "next" }),
    )
    .await;
    assert_eq!(st, 409, "{e}");
}

#[tokio::test]
async fn a_base_branch_change_keeps_the_repositorys_records() {
    let s = TestServer::start().await;
    let p = s.gateway_player(1).await;
    let d = draft_note(&s, &p, "c1").await;
    let (st, _) = s
        .gateway(
            &p,
            "merge",
            json!({ "number": d["number"], "head_sha": d["head_sha"] }),
        )
        .await;
    assert_eq!(st, 200);
    let (st, c) = rebind(
        &s,
        &p.cookie,
        Some(&p.lease),
        json!({ "base_branch": "next" }),
    )
    .await;
    assert_eq!(st, 200, "{c}");
    assert_eq!(c["site_base_branch"], "next");
    // Same repository: its pull request numbers stay meaningful.
    assert!(get_pr(&s.db, &p.company, 1).await.unwrap().is_some());
    let ev = s.inbox(&p.cookie).await;
    let rebound = ev.iter().find(|e| e["kind"] == "SiteRebound").unwrap();
    assert_eq!(rebound["payload"]["retired"], 0);
}

// ---------------------------------------------------------------- startup

fn real_config(dir: &std::path::Path) -> Config {
    let mut cfg = Config::for_tests(
        "",
        dir.join("data"),
        GithubOAuthConfig::github("id", "secret"),
    );
    cfg.simulate_deploy = false;
    cfg.github_mode = GithubMode::Real {
        api_base: "https://api.github.com".into(),
        token: Some("test-token".into()),
        app_id: None,
        app_private_key_path: None,
    };
    cfg
}

#[tokio::test]
async fn real_github_mode_refuses_to_start_without_an_allow_list() {
    let dir = temp_dir("startup");
    let db = file_db(&dir).await;
    let mut cfg = real_config(&dir);
    assert!(cfg.allowed_site_repos.is_empty());
    let err = AppState::new(cfg.clone(), db.clone())
        .err()
        .expect("refused");
    assert!(
        err.to_string().contains("SWARMPRESS_ALLOWED_SITE_REPOS"),
        "{err}"
    );
    // A default outside the list is refused too.
    cfg.allowed_site_repos = vec![REHEARSAL.into()];
    cfg.default_site_repo = Some(LIVE.into());
    let err = AppState::new(cfg.clone(), db.clone())
        .err()
        .expect("refused");
    assert!(
        err.to_string().contains("SWARMPRESS_DEFAULT_SITE_REPO"),
        "{err}"
    );
    cfg.default_site_repo = Some(REHEARSAL.into());
    assert!(AppState::new(cfg, db.clone()).is_ok());
    db.close().await;
    let _ = std::fs::remove_dir_all(dir);
}

#[tokio::test]
async fn real_github_mode_refuses_dev_auth_off_loopback() {
    let dir = temp_dir("startup");
    let db = file_db(&dir).await;
    let mut cfg = real_config(&dir);
    cfg.allowed_site_repos = vec![REHEARSAL.into()];
    assert!(cfg.dev_auth, "the test config signs in by dev login");
    cfg.bind = "0.0.0.0:8080".parse().unwrap();
    let err = AppState::new(cfg.clone(), db.clone())
        .err()
        .expect("refused");
    assert!(err.to_string().contains("SWARMPRESS_DEV_AUTH"), "{err}");
    // Loopback is fine, and so is GitHub sign-in on any address.
    cfg.bind = "127.0.0.1:8080".parse().unwrap();
    assert!(AppState::new(cfg.clone(), db.clone()).is_ok());
    cfg.bind = "0.0.0.0:8080".parse().unwrap();
    cfg.dev_auth = false;
    assert!(AppState::new(cfg.clone(), db.clone()).is_ok());
    // The fake GitHub writes nothing real: dev login may listen anywhere.
    cfg.dev_auth = true;
    cfg.github_mode = GithubMode::Fake;
    assert!(AppState::new(cfg, db.clone()).is_ok());
    db.close().await;
    let _ = std::fs::remove_dir_all(dir);
}
