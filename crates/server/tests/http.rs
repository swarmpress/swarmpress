//! Migrations, health, GitHub OAuth sessions and the companies API.

mod common;

use common::{cookie_pair, set_cookie_header, TestServer};
use reqwest::header::{COOKIE, LOCATION};
use serde_json::json;
use sqlx::PgPool;

#[sqlx::test(migrations = "./migrations")]
async fn migrations_apply_and_constraints_hold(pool: PgPool) {
    let tables: Vec<(String,)> = sqlx::query_as(
        "SELECT table_name::text FROM information_schema.tables
         WHERE table_schema = 'public' ORDER BY table_name",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    let names: Vec<_> = tables.into_iter().map(|t| t.0).collect();
    for t in [
        "companies",
        "jobs",
        "llm_calls",
        "sessions",
        "sim_commands",
        "sim_snapshots",
        "users",
        "webhook_deliveries",
    ] {
        assert!(
            names.contains(&t.to_string()),
            "missing table {t}: {names:?}"
        );
    }

    let user = simpress_server::db::upsert_github_user(&pool, 1, "a", None, None)
        .await
        .unwrap();
    let c1 = simpress_server::db::create_company(&pool, user.id, "One", 1, 60)
        .await
        .unwrap();
    assert!(c1.is_some());
    // owner_user_id UNIQUE: one company per user.
    let c2 = simpress_server::db::create_company(&pool, user.id, "Two", 2, 60)
        .await
        .unwrap();
    assert!(c2.is_none());

    // Bad executor is rejected by the CHECK constraint.
    let bad = sqlx::query("INSERT INTO jobs (kind, executor) VALUES ('x', 'gpu')")
        .execute(&pool)
        .await;
    assert!(bad.is_err());

    // Re-running migrations is a no-op.
    simpress_server::db::migrate(&pool).await.unwrap();
}

#[sqlx::test(migrations = "./migrations")]
async fn healthz_ok(pool: PgPool) {
    let s = TestServer::start(pool).await;
    let (status, body) = s.get_json("/healthz", None).await;
    assert_eq!(status, 200);
    assert_eq!(body["status"], "ok");
}

#[sqlx::test(migrations = "./migrations")]
async fn oauth_login_creates_session_and_me_works(pool: PgPool) {
    let s = TestServer::start(pool.clone()).await;
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
    let clear: Option<(String,)> = sqlx::query_as("SELECT id FROM sessions WHERE id = $1")
        .bind(token)
        .fetch_optional(&pool)
        .await
        .unwrap();
    assert!(clear.is_none());

    // Logging in again updates the same user row.
    let cookie2 = s.login(4242, "ada-renamed").await;
    let (_, me2) = s.get_json("/api/me", Some(&cookie2)).await;
    assert_eq!(me2["user"]["id"], me["user"]["id"]);
    assert_eq!(me2["user"]["login"], "ada-renamed");
}

#[sqlx::test(migrations = "./migrations")]
async fn session_cookie_attributes(pool: PgPool) {
    let s = TestServer::start(pool).await;
    s.gh.register("attrcode", &testkit::oauth::GithubUser::new(7, "x"))
        .await;
    let res = s
        .http
        .get(s.url("/auth/github/login"))
        .send()
        .await
        .unwrap();
    let state_hdr = set_cookie_header(&res, "simpress_oauth_state").unwrap();
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
        .header(COOKIE, cookie_pair(&res, "simpress_oauth_state").unwrap())
        .send()
        .await
        .unwrap();
    assert_eq!(res.headers()[LOCATION], "http://localhost:5173/");
    let sess = set_cookie_header(&res, "simpress_session").unwrap();
    assert!(
        sess.contains("HttpOnly") && sess.contains("SameSite=Lax") && sess.contains("Path=/"),
        "{sess}"
    );
    assert!(
        !sess.contains("Secure"),
        "http public url → no Secure flag: {sess}"
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn oauth_rejects_bad_state_and_bad_code(pool: PgPool) {
    let s = TestServer::start(pool).await;
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
        .header(COOKIE, "simpress_oauth_state=def")
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 400);
    assert!(cookie_pair(&res, "simpress_session").is_none());

    // Unknown code: GitHub returns an error body.
    let res = s
        .http
        .get(s.url("/auth/github/callback?code=nope&state=abc"))
        .header(COOKIE, "simpress_oauth_state=abc")
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
        .get_json("/api/me", Some("simpress_session=deadbeef"))
        .await;
    assert_eq!(status, 401);
}

#[sqlx::test(migrations = "./migrations")]
async fn logout_invalidates_session(pool: PgPool) {
    let s = TestServer::start(pool).await;
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

#[sqlx::test(migrations = "./migrations")]
async fn expired_session_is_rejected(pool: PgPool) {
    let s = TestServer::start(pool.clone()).await;
    let cookie = s.login(6, "eve").await;
    sqlx::query("UPDATE sessions SET expires_at = now() - interval '1 second'")
        .execute(&pool)
        .await
        .unwrap();
    let (status, _) = s.get_json("/api/me", Some(&cookie)).await;
    assert_eq!(status, 401);
}

#[sqlx::test(migrations = "./migrations")]
async fn one_company_per_user(pool: PgPool) {
    let s = TestServer::start(pool).await;
    let (status, _) = s
        .post_json("/api/companies", None, json!({ "name": "X" }))
        .await;
    assert_eq!(status, 401);

    let cookie = s.login(10, "carol").await;
    let (status, _) = s
        .post_json("/api/companies", Some(&cookie), json!({ "name": "  " }))
        .await;
    assert_eq!(status, 400);

    let (status, c) = s
        .post_json(
            "/api/companies",
            Some(&cookie),
            json!({ "name": "Carol Press" }),
        )
        .await;
    assert_eq!(status, 201, "{c}");
    assert_eq!(c["name"], "Carol Press");
    assert_eq!(c["day_real_minutes"], 60);

    let (status, _) = s
        .post_json("/api/companies", Some(&cookie), json!({ "name": "Second" }))
        .await;
    assert_eq!(status, 409);

    let (status, list) = s.get_json("/api/companies", Some(&cookie)).await;
    assert_eq!(status, 200);
    assert_eq!(list.as_array().unwrap().len(), 1);
    let (_, me) = s.get_json("/api/me", Some(&cookie)).await;
    assert_eq!(me["company"]["id"], c["id"]);

    // Another player sees only their own (none).
    let other = s.login(11, "dan").await;
    let (_, list) = s.get_json("/api/companies", Some(&other)).await;
    assert_eq!(list.as_array().unwrap().len(), 0);
}

#[sqlx::test(migrations = "./migrations")]
async fn serves_static_client_with_spa_fallback(pool: PgPool) {
    let dir = std::env::temp_dir().join(format!("simpress-static-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(dir.join("assets")).unwrap();
    std::fs::write(dir.join("index.html"), "<html>game</html>").unwrap();
    std::fs::write(dir.join("assets/app.js"), "console.log(1)").unwrap();
    let d2 = dir.clone();
    let s = TestServer::start_with(
        pool,
        common::Opts {
            tweak: Box::new(move |c| c.static_dir = Some(d2)),
            ..Default::default()
        },
    )
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
