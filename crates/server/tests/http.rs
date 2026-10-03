//! Migrations, health, GitHub OAuth and dev-login sessions, and the companies API.

mod common;

use common::{cookie_pair, set_cookie_header, Opts, TestServer};
use reqwest::header::{COOKIE, LOCATION};
use serde_json::json;
use swarmpress_server::db::accounts;

#[tokio::test]
async fn migrations_apply_and_constraints_hold() {
    let s = TestServer::start().await;
    let names: Vec<String> = swarmpress_server::db::tracker::schema_columns(&s.db)
        .await
        .unwrap()
        .into_iter()
        .map(|(t, _)| t)
        .collect();
    for t in [
        "companies",
        "company_executors",
        "events",
        "gateway_prs",
        "gateway_prs_retired",
        "sessions",
        "sync_segments",
        "sync_snapshots",
        "users",
        "webhook_deliveries",
        "projects",
        "tracker_events",
    ] {
        assert!(names.iter().any(|n| n == t), "missing table {t}");
    }
    for gone in [
        "jobs",
        "sim_commands",
        "sim_snapshots",
        "plan_posts",
        "llm_calls",
    ] {
        assert!(!names.iter().any(|n| n == gone), "{gone} should be retired");
    }

    let user = accounts::upsert_github_user(&s.db, 1, "a", None, None, 0)
        .await
        .unwrap();
    let c1 = accounts::create_company(&s.db, &user.id, "One", 1, "o/r", "main", 0)
        .await
        .unwrap();
    assert!(c1.is_some());
    // owner_user_id UNIQUE: one company per user.
    let c2 = accounts::create_company(&s.db, &user.id, "Two", 2, "o/r", "main", 0)
        .await
        .unwrap();
    assert!(c2.is_none());
    // CHECK: name length.
    let other = accounts::upsert_dev_user(&s.db, "b", 0).await.unwrap();
    assert!(
        accounts::create_company(&s.db, &other.id, "", 1, "o/r", "main", 0)
            .await
            .is_err()
    );

    // Re-running migrations is a no-op.
    s.db.migrate().await.unwrap();
}

#[tokio::test]
async fn healthz_ok() {
    let s = TestServer::start().await;
    let (status, body) = s.get_json("/healthz", None).await;
    assert_eq!(status, 200);
    assert_eq!(body["status"], "ok");
}

#[tokio::test]
async fn oauth_login_creates_session_and_me_works() {
    let s = TestServer::start().await;
    let (status, _) = s.get_json("/api/me", None).await;
    assert_eq!(status, 401);

    let cookie = s.login(4242, "ada").await;
    let (status, me) = s.get_json("/api/me", Some(&cookie)).await;
    assert_eq!(status, 200, "{me}");
    assert_eq!(me["user"]["login"], "ada");
    assert_eq!(me["user"]["github_id"], 4242);
    assert_eq!(me["company"], serde_json::Value::Null);

    // The token is stored hashed, never in clear.
    let token = cookie.split_once('=').unwrap().1;
    assert!(!accounts::session_exists(&s.db, token).await.unwrap());
    assert!(
        accounts::session_exists(&s.db, &swarmpress_server::auth::session_id_hash(token))
            .await
            .unwrap()
    );

    // Logging in again updates the same user row.
    let cookie2 = s.login(4242, "ada-renamed").await;
    let (_, me2) = s.get_json("/api/me", Some(&cookie2)).await;
    assert_eq!(me2["user"]["id"], me["user"]["id"]);
    assert_eq!(me2["user"]["login"], "ada-renamed");
}

#[tokio::test]
async fn session_cookie_attributes() {
    let s = TestServer::start().await;
    s.gh.register("attrcode", &testkit::oauth::GithubUser::new(7, "x"))
        .await;
    let res = s
        .http
        .get(s.url("/auth/github/login"))
        .send()
        .await
        .unwrap();
    let state_hdr = set_cookie_header(&res, "swarmpress_oauth_state").unwrap();
    assert!(state_hdr.contains("HttpOnly"), "{state_hdr}");
    assert!(state_hdr.contains("SameSite=Lax"), "{state_hdr}");
    let loc = res.headers()[LOCATION].to_str().unwrap().to_string();
    assert!(loc.contains("client_id=test-client-id"));
    assert!(loc.contains("redirect_uri=http%3A%2F%2Flocalhost%3A5173%2Fauth%2Fgithub%2Fcallback"));
    let state = url::Url::parse(&loc)
        .unwrap()
        .query_pairs()
        .find(|(k, _)| k == "state")
        .unwrap()
        .1
        .to_string();
    let res = s
        .http
        .get(s.url(&format!(
            "/auth/github/callback?code=attrcode&state={state}"
        )))
        .header(COOKIE, cookie_pair(&res, "swarmpress_oauth_state").unwrap())
        .send()
        .await
        .unwrap();
    assert_eq!(res.headers()[LOCATION], "http://localhost:5173/");
    let sess = set_cookie_header(&res, "swarmpress_session").unwrap();
    assert!(
        sess.contains("HttpOnly") && sess.contains("SameSite=Lax") && sess.contains("Path=/"),
        "{sess}"
    );
    assert!(
        !sess.contains("Secure"),
        "http public url → no Secure flag: {sess}"
    );
}

#[tokio::test]
async fn oauth_rejects_bad_state_and_bad_code() {
    let s = TestServer::start().await;
    s.gh.register("goodcode", &testkit::oauth::GithubUser::new(1, "x"))
        .await;

    // No state cookie.
    let res = s
        .http
        .get(s.url("/auth/github/callback?code=goodcode&state=abc"))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 400);

    // State mismatch.
    let res = s
        .http
        .get(s.url("/auth/github/callback?code=goodcode&state=abc"))
        .header(COOKIE, "swarmpress_oauth_state=def")
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 400);
    assert!(cookie_pair(&res, "swarmpress_session").is_none());

    // Unknown code: GitHub returns an error body.
    let res = s
        .http
        .get(s.url("/auth/github/callback?code=nope&state=abc"))
        .header(COOKIE, "swarmpress_oauth_state=abc")
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 400);
    let body: serde_json::Value = res.json().await.unwrap();
    assert!(body["error"]
        .as_str()
        .unwrap()
        .contains("bad_verification_code"));

    // Forged session cookie.
    let (status, _) = s
        .get_json("/api/me", Some("swarmpress_session=deadbeef"))
        .await;
    assert_eq!(status, 401);
}

#[tokio::test]
async fn logout_invalidates_session() {
    let s = TestServer::start().await;
    let cookie = s.login(5, "bob").await;
    let res = s
        .http
        .post(s.url("/auth/logout"))
        .header(COOKIE, &cookie)
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 204);
    let (status, _) = s.get_json("/api/me", Some(&cookie)).await;
    assert_eq!(status, 401);
}

#[tokio::test]
async fn expired_session_is_rejected() {
    let s = TestServer::start().await;
    let cookie = s.login(6, "eve").await;
    s.clock
        .advance(std::time::Duration::from_secs(30 * 24 * 3600 + 1));
    let (status, _) = s.get_json("/api/me", Some(&cookie)).await;
    assert_eq!(status, 401);
}

#[tokio::test]
async fn one_company_per_user() {
    let s = TestServer::start().await;
    let (status, _) = s
        .post_json("/api/companies", None, json!({ "name": "X" }))
        .await;
    assert_eq!(status, 401);

    let cookie = s.login(10, "Carol").await;
    let (status, _) = s
        .post_json("/api/companies", Some(&cookie), json!({ "name": "  " }))
        .await;
    assert_eq!(status, 400);
    let (status, _) = s
        .post_json(
            "/api/companies",
            Some(&cookie),
            json!({ "name": "X", "site_repo": "not-a-repo" }),
        )
        .await;
    assert_eq!(status, 400);
    let (status, _) = s.get_json("/api/companies/me", Some(&cookie)).await;
    assert_eq!(status, 404);

    let (status, c) = s
        .post_json(
            "/api/companies",
            Some(&cookie),
            json!({ "name": "Carol Press" }),
        )
        .await;
    assert_eq!(status, 201, "{c}");
    assert_eq!(c["name"], "Carol Press");
    assert_eq!(c["site_repo"], "swarmpress-sites/carol-site");
    assert_eq!(c["site_base_branch"], "main");

    let (status, _) = s
        .post_json("/api/companies", Some(&cookie), json!({ "name": "Second" }))
        .await;
    assert_eq!(status, 409);

    let (status, mine) = s.get_json("/api/companies/me", Some(&cookie)).await;
    assert_eq!(status, 200);
    assert_eq!(mine["id"], c["id"]);
    let (_, me) = s.get_json("/api/me", Some(&cookie)).await;
    assert_eq!(me["company"]["id"], c["id"]);

    // Another player has none; an explicit repo binding is kept.
    let other = s.dev_login("dan").await;
    let (status, _) = s.get_json("/api/companies/me", Some(&other)).await;
    assert_eq!(status, 404);
    let (status, d) = s
        .post_json(
            "/api/companies",
            Some(&other),
            json!({ "name": "Dan Daily", "site_repo": "dan/site", "base_branch": "trunk" }),
        )
        .await;
    assert_eq!(status, 201, "{d}");
    assert_eq!(d["site_repo"], "dan/site");
    assert_eq!(d["site_base_branch"], "trunk");
}

#[tokio::test]
async fn dev_login_creates_and_fetches_users() {
    let s = TestServer::start().await;
    let res = s
        .http
        .post(s.url("/auth/dev/login"))
        .json(&json!({ "login": "ada" }))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 200);
    let sess = set_cookie_header(&res, "swarmpress_session").unwrap();
    assert!(
        sess.contains("HttpOnly") && sess.contains("SameSite=Lax"),
        "{sess}"
    );
    let cookie = cookie_pair(&res, "swarmpress_session").unwrap();
    let body: serde_json::Value = res.json().await.unwrap();
    assert_eq!(body["user"]["login"], "ada");
    assert_eq!(body["user"]["github_id"], serde_json::Value::Null);

    let (status, me) = s.get_json("/api/me", Some(&cookie)).await;
    assert_eq!(status, 200);
    assert_eq!(me["user"]["id"], body["user"]["id"]);

    // Same login → same user; a new session.
    let again = s.dev_login("ada").await;
    assert_ne!(again, cookie);
    let (_, me2) = s.get_json("/api/me", Some(&again)).await;
    assert_eq!(me2["user"]["id"], me["user"]["id"]);

    // Bad logins.
    for bad in ["", "a b", "../x", &"x".repeat(40)] {
        let (status, _) = s
            .post_json("/auth/dev/login", None, json!({ "login": bad }))
            .await;
        assert_eq!(status, 400, "{bad:?}");
    }
}

#[tokio::test]
async fn dev_login_is_off_unless_enabled() {
    let s = TestServer::start_with(Opts {
        tweak: Box::new(|c| c.dev_auth = false),
    })
    .await;
    let (status, body) = s
        .post_json("/auth/dev/login", None, json!({ "login": "ada" }))
        .await;
    assert_eq!(status, 404, "{body}");
    // OAuth still works.
    let cookie = s.login(1, "ada").await;
    assert_eq!(s.get_json("/api/me", Some(&cookie)).await.0, 200);
}

#[tokio::test]
async fn serves_static_client_with_spa_fallback() {
    let dir = std::env::temp_dir().join(format!("swarmpress-static-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(dir.join("assets")).unwrap();
    std::fs::write(dir.join("index.html"), "<html>game</html>").unwrap();
    std::fs::write(dir.join("assets/app.js"), "console.log(1)").unwrap();
    let d2 = dir.clone();
    let s = TestServer::start_with(Opts {
        tweak: Box::new(move |c| c.static_dir = Some(d2)),
    })
    .await;
    let get = |p: &str| s.http.get(s.url(p)).send();
    assert_eq!(
        get("/assets/app.js").await.unwrap().text().await.unwrap(),
        "console.log(1)"
    );
    assert_eq!(
        get("/").await.unwrap().text().await.unwrap(),
        "<html>game</html>"
    );
    assert_eq!(
        get("/some/route").await.unwrap().text().await.unwrap(),
        "<html>game</html>"
    );
    // API routes are not shadowed.
    assert_eq!(get("/api/me").await.unwrap().status(), 401);
    let _ = std::fs::remove_dir_all(dir);
}

/// The single-origin run (G2, `scripts/run-local.sh`): the built game and the
/// API on one origin, `SWARMPRESS_PUBLIC_URL` pointing at the server itself.
/// A fixture shaped like `vite build`'s output: the page, a hashed module, a
/// worker and a wasm file. Every file of the client is cross-origin isolated
/// (the page needs it for Turso's shared memory, a worker for its own
/// isolation), a deep link with the game's parameters falls back to the
/// page, wasm has its MIME type, and a dev login on that origin is a session
/// the API on the same origin accepts.
#[tokio::test]
async fn single_origin_serves_the_built_client_and_the_api() {
    let dist = common::temp_dir("dist");
    std::fs::create_dir_all(dist.join("assets")).unwrap();
    std::fs::write(
        dist.join("index.html"),
        r#"<!doctype html><html><head><script type="module" src="/assets/index-Bx3k.js"></script></head><body><div id="stage"></div></body></html>"#,
    )
    .unwrap();
    std::fs::write(
        dist.join("assets/index-Bx3k.js"),
        "import('./session-9a.js')",
    )
    .unwrap();
    std::fs::write(
        dist.join("assets/sqlite-worker-77.js"),
        "self.onmessage = () => {}",
    )
    .unwrap();
    std::fs::write(
        dist.join("assets/client_wasm_bg-4f.wasm"),
        b"\0asm\x01\0\0\0",
    )
    .unwrap();
    let d2 = dist.clone();
    // The public URL is the server's own origin, as run-local.sh sets it.
    let origin = "http://localhost:8080";
    let s = TestServer::start_with(Opts {
        tweak: Box::new(move |c| {
            c.static_dir = Some(d2);
            c.public_url = origin.into();
        }),
    })
    .await;
    // GitHub sign-in comes back to that origin, not to Vite's.
    assert_eq!(
        s.st.cfg.oauth_redirect_uri(),
        "http://localhost:8080/auth/github/callback"
    );

    let isolated = |r: &reqwest::Response, what: &str| {
        let h = r.headers();
        assert_eq!(h["cross-origin-opener-policy"], "same-origin", "{what}");
        assert_eq!(
            h["cross-origin-embedder-policy"], "credentialless",
            "{what}"
        );
    };
    for (path, body_has, mime) in [
        ("/", "index-Bx3k.js", "text/html"),
        (
            "/?central=1&llm=fake&ff=09:00",
            "index-Bx3k.js",
            "text/html",
        ),
        ("/play/deep/link?central=1", "index-Bx3k.js", "text/html"),
        ("/assets/index-Bx3k.js", "session-9a.js", "javascript"),
        ("/assets/sqlite-worker-77.js", "onmessage", "javascript"),
    ] {
        let r = s.http.get(s.url(path)).send().await.unwrap();
        assert_eq!(r.status(), 200, "{path}");
        isolated(&r, path);
        let ct = r.headers()["content-type"].to_str().unwrap().to_string();
        assert!(ct.contains(mime), "{path}: {ct}");
        assert!(r.text().await.unwrap().contains(body_has), "{path}");
    }
    let r = s
        .http
        .get(s.url("/assets/client_wasm_bg-4f.wasm"))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 200);
    isolated(&r, "wasm");
    assert_eq!(r.headers()["content-type"], "application/wasm");
    assert_eq!(r.bytes().await.unwrap().as_ref(), b"\0asm\x01\0\0\0");

    // The API answers on the same origin; the game page does not shadow it.
    let (st, h) = s.get_json("/healthz", None).await;
    assert_eq!((st, h["status"].as_str()), (200, Some("ok")));
    assert_eq!(s.get_json("/api/me", None).await.0, 401);
    let res = s
        .http
        .post(s.url("/auth/dev/login"))
        .header("origin", origin)
        .json(&json!({ "login": "ceo" }))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 200);
    let set = set_cookie_header(&res, "swarmpress_session").unwrap();
    assert!(
        set.contains("Path=/") && !set.contains("Secure"),
        "http origin: {set}"
    );
    let cookie = cookie_pair(&res, "swarmpress_session").unwrap();
    let (st, me) = s.get_json("/api/me", Some(&cookie)).await;
    assert_eq!(st, 200, "{me}");
    assert_eq!(me["user"]["login"], "ceo");
    // The binding the page shows before it founds the company.
    assert!(me["default_binding"]["site_repo"].is_string(), "{me}");
    let _ = std::fs::remove_dir_all(dist);
}

#[tokio::test]
async fn static_client_is_cross_origin_isolated() {
    let site = common::temp_dir("static");
    std::fs::write(
        site.join("index.html"),
        "<!doctype html><title>swarm.press</title>",
    )
    .unwrap();
    let dir = site.clone();
    let s = TestServer::start_with(Opts {
        tweak: Box::new(move |c| c.static_dir = Some(dir)),
    })
    .await;
    for path in ["/", "/some/spa/route"] {
        let r = reqwest::get(s.url(path)).await.unwrap();
        assert_eq!(r.status(), 200, "{path}");
        let h = r.headers();
        assert_eq!(h["cross-origin-opener-policy"], "same-origin", "{path}");
        assert_eq!(
            h["cross-origin-embedder-policy"], "credentialless",
            "{path}"
        );
    }
    // API responses are not the game page and carry no isolation headers.
    let r = reqwest::get(s.url("/healthz")).await.unwrap();
    assert!(r.headers().get("cross-origin-embedder-policy").is_none());

    let dir = site.clone();
    let off = TestServer::start_with(Opts {
        tweak: Box::new(move |c| {
            c.static_dir = Some(dir);
            c.coep = None;
        }),
    })
    .await;
    let r = reqwest::get(off.url("/")).await.unwrap();
    assert!(r.headers().get("cross-origin-opener-policy").is_none());
}
