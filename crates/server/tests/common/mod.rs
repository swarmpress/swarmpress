//! Integration-test harness: a real server on 127.0.0.1:0 backed by a fresh
//! temp-file SQLite database (WAL, writer + reader pools) per test, the
//! in-memory `github::FakeGitHub` for the content gateway, a fake GitHub
//! OAuth provider (wiremock) and a manual clock.
#![allow(dead_code)]

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use github::{FakeGitHub, ManualClock, SystemClock};
use reqwest::header::{COOKIE, LOCATION, SET_COOKIE};
use reqwest::redirect::Policy;
use reqwest::Method;
use serde_json::{json, Value};
use swarmpress_server::app::{self, AppState};
use swarmpress_server::config::{Config, GithubOAuthConfig};
use swarmpress_server::db::Db;
use swarmpress_server::gateway::RepoBackend;
use testkit::oauth::{self, GithubUser, CLIENT_ID, CLIENT_SECRET};
use tokio::task::JoinHandle;

pub struct TestServer {
    pub addr: std::net::SocketAddr,
    pub st: AppState,
    pub db: Db,
    /// Fake GitHub OAuth provider (login flow).
    pub gh: oauth::FakeGitHub,
    pub clock: Arc<ManualClock>,
    pub http: reqwest::Client,
    pub dir: PathBuf,
    server: JoinHandle<()>,
}

pub struct Opts {
    pub tweak: Box<dyn FnOnce(&mut Config) + Send>,
}

impl Default for Opts {
    fn default() -> Self {
        Self {
            tweak: Box::new(|_| {}),
        }
    }
}

pub fn temp_dir(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("swarmpress-{tag}-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// A migrated temp-file database (WAL) in `dir`.
pub async fn file_db(dir: &std::path::Path) -> Db {
    let url = format!("sqlite://{}/swarmpress.db?mode=rwc", dir.display());
    let db = Db::connect(&url).await.unwrap();
    db.migrate().await.unwrap();
    db
}

impl TestServer {
    pub async fn start() -> Self {
        Self::start_with(Opts::default()).await
    }

    pub async fn start_with(opts: Opts) -> Self {
        let dir = temp_dir("test");
        let db = file_db(&dir).await;
        let gh = oauth::FakeGitHub::start().await;
        let mut cfg = Config::for_tests(
            "",
            dir.join("data"),
            GithubOAuthConfig::with_base(&gh.base_url(), CLIENT_ID, CLIENT_SECRET),
        );
        (opts.tweak)(&mut cfg);
        let clock = ManualClock::new(github::Clock::now_ms(&SystemClock));
        let backend = Arc::new(RepoBackend::from_mode(&cfg.github_mode).unwrap());
        let st = AppState::with_parts(cfg, db.clone(), clock.clone(), backend);
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let st2 = st.clone();
        let server = tokio::spawn(async move {
            app::serve(listener, st2, std::future::pending())
                .await
                .unwrap();
        });
        let http = reqwest::Client::builder()
            .redirect(Policy::none())
            .no_proxy()
            .timeout(Duration::from_secs(10))
            .build()
            .unwrap();
        Self {
            addr,
            st,
            db,
            gh,
            clock,
            http,
            dir,
            server,
        }
    }

    pub fn url(&self, path: &str) -> String {
        format!("http://{}{}", self.addr, path)
    }

    pub fn ws_url(&self, path: &str) -> String {
        format!("ws://{}{}", self.addr, path)
    }

    /// The in-memory GitHub behind the content gateway.
    pub fn fake_github(&self) -> Arc<FakeGitHub> {
        self.st.github.fake().expect("fake github").clone()
    }

    /// Full OAuth web flow against the fake GitHub; returns the Cookie header
    /// value (`swarmpress_session=...`).
    pub async fn login(&self, github_id: i64, login: &str) -> String {
        let code = format!("code{github_id}x{}", uuid::Uuid::new_v4().simple());
        self.gh
            .register(&code, &GithubUser::new(github_id, login))
            .await;

        let res = self
            .http
            .get(self.url("/auth/github/login"))
            .send()
            .await
            .unwrap();
        assert!(res.status().is_redirection(), "login: {}", res.status());
        let location = res.headers()[LOCATION].to_str().unwrap().to_string();
        assert!(
            location.starts_with(&self.gh.base_url()),
            "redirects to provider: {location}"
        );
        let state_cookie = cookie_pair(&res, "swarmpress_oauth_state").expect("state cookie");
        let state = url::Url::parse(&location)
            .unwrap()
            .query_pairs()
            .find(|(k, _)| k == "state")
            .map(|(_, v)| v.to_string())
            .expect("state param");

        let res = self
            .http
            .get(self.url(&format!("/auth/github/callback?code={code}&state={state}")))
            .header(COOKIE, &state_cookie)
            .send()
            .await
            .unwrap();
        assert!(res.status().is_redirection(), "callback: {}", res.status());
        cookie_pair(&res, "swarmpress_session").expect("session cookie")
    }

    /// `POST /auth/dev/login`; returns the Cookie header value.
    pub async fn dev_login(&self, login: &str) -> String {
        let res = self
            .http
            .post(self.url("/auth/dev/login"))
            .json(&json!({ "login": login }))
            .send()
            .await
            .unwrap();
        assert_eq!(res.status(), 200, "dev login");
        cookie_pair(&res, "swarmpress_session").expect("session cookie")
    }

    pub async fn send_json(
        &self,
        method: Method,
        path: &str,
        cookie: Option<&str>,
        headers: &[(&str, &str)],
        body: Option<Value>,
    ) -> (u16, Value) {
        let mut req = self.http.request(method, self.url(path));
        if let Some(c) = cookie {
            req = req.header(COOKIE, c);
        }
        for (k, v) in headers {
            req = req.header(*k, *v);
        }
        if let Some(b) = body {
            req = req.json(&b);
        }
        let res = req.send().await.unwrap();
        let status = res.status().as_u16();
        (status, res.json().await.unwrap_or(Value::Null))
    }

    pub async fn get_json(&self, path: &str, cookie: Option<&str>) -> (u16, Value) {
        self.send_json(Method::GET, path, cookie, &[], None).await
    }

    pub async fn post_json(&self, path: &str, cookie: Option<&str>, body: Value) -> (u16, Value) {
        self.send_json(Method::POST, path, cookie, &[], Some(body))
            .await
    }

    pub async fn put_json(&self, path: &str, cookie: Option<&str>, body: Value) -> (u16, Value) {
        self.send_json(Method::PUT, path, cookie, &[], Some(body))
            .await
    }

    /// Sign in a fresh dev player and give them a company. Returns
    /// (cookie, company_id).
    pub async fn player(&self, n: i64) -> (String, String) {
        let cookie = self.dev_login(&format!("player{n}")).await;
        let (status, body) = self
            .post_json(
                "/api/companies",
                Some(&cookie),
                json!({ "name": "Gazette" }),
            )
            .await;
        assert_eq!(status, 201, "{body}");
        (cookie, body["id"].as_str().unwrap().to_string())
    }

    /// Take the company lease for `device`; returns the fencing token
    /// (`<epoch>.<lease_id>`, the `x-swarmpress-lease` header value).
    pub async fn lease(&self, cookie: &str, company: &str, device: &str) -> String {
        let (st, body) = self
            .post_json(
                &format!("/api/companies/{company}/lease"),
                Some(cookie),
                json!({ "device_id": device }),
            )
            .await;
        assert_eq!(st, 200, "{body}");
        body["token"].as_str().unwrap().to_string()
    }
}

// ---------------------------------------------------------------- gateway

/// The fencing-token header of gateway calls.
pub const LEASE: &str = "x-swarmpress-lease";

/// A signed-in player with a company, its lease and its (fake) site repo.
pub struct GatewayPlayer {
    pub cookie: String,
    pub company: String,
    /// The fencing token (`<epoch>.<lease_id>`).
    pub lease: String,
    /// `swarmpress-sites/player{n}-site`.
    pub repo: github::RepoId,
}

impl TestServer {
    /// Player `n` with a company and the lease taken by `laptop`.
    pub async fn gateway_player(&self, n: i64) -> GatewayPlayer {
        let (cookie, company) = self.player(n).await;
        let lease = self.lease(&cookie, &company, "laptop").await;
        GatewayPlayer {
            cookie,
            company,
            lease,
            repo: github::RepoId::new("swarmpress-sites", format!("player{n}-site")),
        }
    }

    /// `POST /api/gateway/{route}` with the player's session and lease.
    pub async fn gateway(&self, p: &GatewayPlayer, route: &str, body: Value) -> (u16, Value) {
        self.send_json(
            Method::POST,
            &format!("/api/gateway/{route}"),
            Some(&p.cookie),
            &[(LEASE, &p.lease)],
            Some(body),
        )
        .await
    }

    /// Draft `page` as `content_id` at `content/pages/blog/{slug}.json`.
    pub async fn draft_article(
        &self,
        p: &GatewayPlayer,
        content_id: &str,
        slug: &str,
        page: Value,
    ) -> (u16, Value) {
        self.gateway(
            p,
            "draft",
            json!({ "content_id": content_id, "work_item": format!("work-{content_id}"),
                    "path": article_path(slug), "page": page, "message": format!("Draft: {slug}") }),
        )
        .await
    }

    /// Every event in the player's inbox, oldest first.
    pub async fn inbox(&self, cookie: &str) -> Vec<Value> {
        let (st, body) = self.get_json("/api/events?after=0", Some(cookie)).await;
        assert_eq!(st, 200, "{body}");
        body["events"].as_array().unwrap().clone()
    }
}

pub fn article_path(slug: &str) -> String {
    format!("content/pages/blog/{slug}.json")
}

/// An article in the shape the orchestrator assembles for the frozen theme
/// (docs/design/mvp-pipeline.md section 4): hero, intro, sections, closing
/// note; plain text; localized `seo`; four slug keys.
pub fn article(content_id: &str, slug: &str, title: &str) -> Value {
    json!({
        "id": content_id,
        "slug": {
            "en": format!("/en/blog/{slug}"),
            "de": format!("/de/blog/{slug}"),
            "fr": format!("/fr/blog/{slug}"),
            "it": format!("/it/blog/{slug}")
        },
        "title": { "en": title },
        "page_type": "blog-article",
        "seo": {
            "title": { "en": format!("{title} | The Dispatch") },
            "description": { "en": format!("{title}: what the terraces look like when the whole village picks grapes.") },
            "keywords": ["manarola", "harvest"]
        },
        "body": [
            { "type": "editorial-hero", "title": title,
              "subtitle": format!("{title}: what the terraces look like when the whole village picks grapes."),
              "badge": "Culture",
              "image": "https://images.unsplash.com/photo-1516483638261-f4dbaf036963?q=80&w=2574&auto=format&fit=crop",
              "height": "70vh" },
            { "type": "paragraph", "markdown": "The monorail starts before the sun does, and by seven the first crates are on their way down." },
            { "type": "heading", "level": 2, "text": "Tuesday: the first crates" },
            { "type": "paragraph", "markdown": "Maria and her sons carry the first crates down by hand, as her father did." },
            { "type": "list", "ordered": false, "items": ["Bring water", "Wear boots"] },
            { "type": "callout", "style": "info", "content": "The terraces are private land: ask before you walk in." },
            { "type": "closing-note", "badge": "Practical Notes", "title": "Before you go",
              "content": "Harvest runs from mid-September &amp; into October.",
              "actions": [{ "label": "More about Manarola", "href": "/en/manarola", "variant": "primary" }] }
        ],
        "metadata": { "author": "Giulia Rossi", "category": "Culture" },
        "status": "in_review"
    })
}

impl Drop for TestServer {
    fn drop(&mut self) {
        self.server.abort();
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

/// `name=value` from the response's Set-Cookie headers.
pub fn cookie_pair(res: &reqwest::Response, name: &str) -> Option<String> {
    res.headers().get_all(SET_COOKIE).iter().find_map(|v| {
        let s = v.to_str().ok()?;
        let pair = s.split(';').next()?.trim();
        let (k, val) = pair.split_once('=')?;
        (k == name && !val.is_empty()).then(|| pair.to_string())
    })
}

/// Full Set-Cookie header for `name` (to check attributes).
pub fn set_cookie_header(res: &reqwest::Response, name: &str) -> Option<String> {
    res.headers().get_all(SET_COOKIE).iter().find_map(|v| {
        let s = v.to_str().ok()?;
        s.starts_with(&format!("{name}=")).then(|| s.to_string())
    })
}
