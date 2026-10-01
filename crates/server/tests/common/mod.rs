//! Integration-test harness: a real server on 127.0.0.1:0 backed by the
//! per-test database from `#[sqlx::test]`, with a fake GitHub OAuth provider.
#![allow(dead_code)]

use std::sync::Arc;
use std::time::Duration;

use reqwest::header::{COOKIE, LOCATION, SET_COOKIE};
use reqwest::redirect::Policy;
use serde_json::Value;
use simpress_server::actor;
use simpress_server::app::{self, AppState, Background};
use simpress_server::config::{Config, GithubOAuthConfig};
use simpress_server::jobs::{ArtifactValidator, JobNotifier, PermissiveValidator};
use simpress_server::sim::LedgerSim;
use sqlx::PgPool;
use testkit::oauth::{FakeGitHub, GithubUser, CLIENT_ID, CLIENT_SECRET};
use testkit::ws::WsClient;
use tokio::task::JoinHandle;

pub struct TestServer {
    pub addr: std::net::SocketAddr,
    pub st: AppState,
    pub gh: FakeGitHub,
    pub http: reqwest::Client,
    server: JoinHandle<()>,
    bg: Option<Background>,
}

pub struct Opts {
    pub validator: Arc<dyn ArtifactValidator>,
    pub tweak: Box<dyn FnOnce(&mut Config) + Send>,
    /// Start the reaper + Claude pool (off by default so tests drive them).
    pub background: bool,
}

impl Default for Opts {
    fn default() -> Self {
        Self {
            validator: Arc::new(PermissiveValidator),
            tweak: Box::new(|_| {}),
            background: false,
        }
    }
}

impl TestServer {
    pub async fn start(pool: PgPool) -> Self {
        Self::start_with(pool, Opts::default()).await
    }

    pub async fn start_with(pool: PgPool, opts: Opts) -> Self {
        let gh = FakeGitHub::start().await;
        let mut cfg = Config::for_tests(
            "",
            GithubOAuthConfig::with_base(&gh.base_url(), CLIENT_ID, CLIENT_SECRET),
        );
        cfg.actor.idle_unload = None;
        (opts.tweak)(&mut cfg);
        let (notifier, notifier_task) = JobNotifier::start(&pool).await.expect("LISTEN");
        let st = AppState::new(
            cfg,
            pool,
            actor::spawner::<LedgerSim>(),
            notifier,
            opts.validator,
        );
        let bg = if opts.background {
            Some(app::spawn_background(
                &st,
                Arc::new(simpress_server::jobs::UnconfiguredClaude),
                Some(notifier_task),
            ))
        } else {
            Some(Background {
                tasks: vec![notifier_task],
            })
        };
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
            .timeout(Duration::from_secs(10))
            .build()
            .unwrap();
        Self {
            addr,
            st,
            gh,
            http,
            server,
            bg,
        }
    }

    pub fn url(&self, path: &str) -> String {
        format!("http://{}{}", self.addr, path)
    }

    pub fn ws_url(&self) -> String {
        format!("ws://{}/ws", self.addr)
    }

    /// Full OAuth web flow against the fake GitHub; returns the Cookie header
    /// value (`simpress_session=...`).
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
        let state_cookie = cookie_pair(&res, "simpress_oauth_state").expect("state cookie");
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
        cookie_pair(&res, "simpress_session").expect("session cookie")
    }

    pub async fn get_json(&self, path: &str, cookie: Option<&str>) -> (u16, Value) {
        let mut req = self.http.get(self.url(path));
        if let Some(c) = cookie {
            req = req.header(COOKIE, c);
        }
        let res = req.send().await.unwrap();
        let status = res.status().as_u16();
        (status, res.json().await.unwrap_or(Value::Null))
    }

    pub async fn post_json(&self, path: &str, cookie: Option<&str>, body: Value) -> (u16, Value) {
        let mut req = self.http.post(self.url(path)).json(&body);
        if let Some(c) = cookie {
            req = req.header(COOKIE, c);
        }
        let res = req.send().await.unwrap();
        let status = res.status().as_u16();
        (status, res.json().await.unwrap_or(Value::Null))
    }

    /// Sign in a fresh player and give them a company. Returns (cookie, company_id).
    pub async fn player(&self, github_id: i64) -> (String, uuid::Uuid) {
        let cookie = self.login(github_id, &format!("player{github_id}")).await;
        let (status, body) = self
            .post_json(
                "/api/companies",
                Some(&cookie),
                serde_json::json!({ "name": "Gazette" }),
            )
            .await;
        assert_eq!(status, 201, "{body}");
        let id = body["id"].as_str().unwrap().parse().unwrap();
        (cookie, id)
    }

    pub async fn ws(&self, cookie: &str) -> WsClient {
        WsClient::connect(&self.ws_url(), Some(cookie))
            .await
            .unwrap()
    }
}

impl Drop for TestServer {
    fn drop(&mut self) {
        self.server.abort();
        if let Some(bg) = &self.bg {
            bg.abort();
        }
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
