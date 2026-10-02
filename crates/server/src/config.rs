//! Server configuration, read from the environment (see `.env.example`).

use std::net::SocketAddr;
use std::path::PathBuf;
use std::time::Duration;

use anyhow::{Context, Result};

use crate::tracker::TrackerConfig;

pub const DEFAULT_DATABASE_URL: &str = "sqlite://data/simpress.db?mode=rwc";

/// GitHub OAuth app settings. The base URLs are configurable so tests can
/// point them at a fake provider (wiremock).
#[derive(Clone, Debug)]
pub struct GithubOAuthConfig {
    pub client_id: String,
    pub client_secret: String,
    /// `https://github.com/login/oauth/authorize`
    pub authorize_url: String,
    /// `https://github.com/login/oauth/access_token`
    pub token_url: String,
    /// `https://api.github.com`
    pub api_base: String,
}

impl GithubOAuthConfig {
    /// Real GitHub endpoints with the given credentials.
    pub fn github(client_id: impl Into<String>, client_secret: impl Into<String>) -> Self {
        Self {
            client_id: client_id.into(),
            client_secret: client_secret.into(),
            authorize_url: "https://github.com/login/oauth/authorize".into(),
            token_url: "https://github.com/login/oauth/access_token".into(),
            api_base: "https://api.github.com".into(),
        }
    }

    /// All endpoints under one base URL (a fake provider in tests).
    pub fn with_base(base: &str, client_id: &str, client_secret: &str) -> Self {
        let base = base.trim_end_matches('/');
        Self {
            client_id: client_id.into(),
            client_secret: client_secret.into(),
            authorize_url: format!("{base}/login/oauth/authorize"),
            token_url: format!("{base}/login/oauth/access_token"),
            api_base: base.into(),
        }
    }
}

/// Which GitHub the content gateway talks to (`SIMPRESS_GITHUB`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum GithubMode {
    /// In-memory `github::FakeGitHub` (tests, dev). Repos are created on demand.
    Fake,
    /// The real REST API: a static token (`GITHUB_TOKEN`) or the GitHub App
    /// (`GITHUB_APP_ID` + `GITHUB_APP_PRIVATE_KEY_PATH`). With neither, gateway
    /// calls fail loudly with 503.
    Real {
        api_base: String,
        token: Option<String>,
        app_id: Option<String>,
        app_private_key_path: Option<PathBuf>,
    },
}

/// Web fetch proxy (ADR-0040).
#[derive(Clone, Debug)]
pub struct WebConfig {
    /// Per-user token bucket for `/web/fetch`.
    pub rate_per_min: u32,
    pub burst: u32,
    pub max_bytes: usize,
    pub timeout: Duration,
    pub max_redirects: usize,
    /// Allow loopback/private targets. Never set from the environment: only
    /// tests that fetch from a local mock server turn this on.
    pub allow_private_for_tests: bool,
}

impl Default for WebConfig {
    fn default() -> Self {
        Self {
            rate_per_min: 30,
            burst: 10,
            max_bytes: 2 * 1024 * 1024,
            timeout: Duration::from_secs(10),
            max_redirects: 5,
            allow_private_for_tests: false,
        }
    }
}

#[derive(Clone, Debug)]
pub struct Config {
    /// `sqlite://data/simpress.db?mode=rwc` (default) or `sqlite::memory:`.
    pub database_url: String,
    /// Sync blobs and other files (`SIMPRESS_DATA_DIR`, default `./data`).
    pub data_dir: PathBuf,
    pub bind: SocketAddr,
    /// Public origin players use (OAuth redirect target, cookie `Secure` flag).
    pub public_url: String,
    pub github: GithubOAuthConfig,
    /// `POST /auth/dev/login` is enabled (`SIMPRESS_DEV_AUTH=1`). Never in production.
    pub dev_auth: bool,
    /// Content gateway backend (`SIMPRESS_GITHUB=fake`, otherwise real).
    pub github_mode: GithubMode,
    /// Owner for site repos of companies created without an explicit repo
    /// (`GITHUB_SITES_ORG`, default `simpress-sites`).
    pub sites_org: String,
    /// `X-Hub-Signature-256` secret for `POST /webhooks/github`.
    pub webhook_secret: Option<String>,
    /// Emit `DeployLanded` right after a gateway merge (`SIMPRESS_SIMULATE_DEPLOY`,
    /// default on with the fake GitHub, off otherwise).
    pub simulate_deploy: bool,
    /// Company lease length (`SIMPRESS_LEASE_SECS`, default 90).
    pub lease_ttl: Duration,
    /// Upper bound on a gateway page (bytes of JSON text).
    pub max_page_bytes: usize,
    /// Upper bound on one sync upload (`SIMPRESS_SYNC_MAX_BYTES`, default 64 MiB).
    pub sync_max_bytes: usize,
    pub web: WebConfig,
    /// Built game client to serve at `/` (SPA fallback to index.html).
    pub static_dir: Option<PathBuf>,
    pub session_ttl: Duration,
    /// First-party analytics tracker (ADR-0032).
    pub tracker: TrackerConfig,
}

impl Config {
    /// A config suitable for tests: local URLs, dev auth and the fake GitHub on.
    pub fn for_tests(database_url: &str, data_dir: PathBuf, github: GithubOAuthConfig) -> Self {
        Self {
            database_url: database_url.into(),
            data_dir,
            bind: "127.0.0.1:0".parse().expect("valid addr"),
            public_url: "http://localhost:5173".into(),
            github,
            dev_auth: true,
            github_mode: GithubMode::Fake,
            sites_org: "simpress-sites".into(),
            webhook_secret: Some("test-webhook-secret".into()),
            simulate_deploy: true,
            lease_ttl: Duration::from_secs(90),
            max_page_bytes: 256 * 1024,
            sync_max_bytes: 8 * 1024 * 1024,
            web: WebConfig::default(),
            static_dir: None,
            session_ttl: Duration::from_secs(30 * 24 * 3600),
            tracker: TrackerConfig {
                origin: "http://127.0.0.1".into(),
                trust_forwarded_for: true,
                ..TrackerConfig::default()
            },
        }
    }

    pub fn from_env() -> Result<Self> {
        let database_url = opt("DATABASE_URL")
            .filter(|v| !v.is_empty())
            .unwrap_or_else(|| DEFAULT_DATABASE_URL.into());
        let data_dir = PathBuf::from(
            opt("SIMPRESS_DATA_DIR")
                .filter(|v| !v.is_empty())
                .unwrap_or_else(|| "data".into()),
        );
        let bind = opt("SIMPRESS_BIND")
            .unwrap_or_else(|| "127.0.0.1:8080".into())
            .parse()
            .context("SIMPRESS_BIND must be host:port")?;
        let public_url =
            opt("SIMPRESS_PUBLIC_URL").unwrap_or_else(|| "http://localhost:5173".into());

        let mut github = GithubOAuthConfig::github(
            opt("GITHUB_OAUTH_CLIENT_ID").unwrap_or_default(),
            opt("GITHUB_OAUTH_CLIENT_SECRET").unwrap_or_default(),
        );
        if let Some(v) = opt("GITHUB_OAUTH_AUTHORIZE_URL") {
            github.authorize_url = v;
        }
        if let Some(v) = opt("GITHUB_OAUTH_TOKEN_URL") {
            github.token_url = v;
        }
        if let Some(v) = opt("GITHUB_API_URL") {
            github.api_base = v;
        }
        let dev_auth = flag("SIMPRESS_DEV_AUTH", false)?;
        if github.client_id.is_empty() && !dev_auth {
            tracing::warn!(
                "GITHUB_OAUTH_CLIENT_ID is empty and SIMPRESS_DEV_AUTH is off: nobody can sign in"
            );
        }
        if dev_auth {
            tracing::warn!(
                "SIMPRESS_DEV_AUTH=1: POST /auth/dev/login signs anyone in. Development only."
            );
        }

        let github_mode = match opt("SIMPRESS_GITHUB").as_deref() {
            Some("fake") => GithubMode::Fake,
            None | Some("" | "real") => GithubMode::Real {
                api_base: github.api_base.clone(),
                token: opt("GITHUB_TOKEN").filter(|v| !v.is_empty()),
                app_id: opt("GITHUB_APP_ID").filter(|v| !v.is_empty()),
                app_private_key_path: opt("GITHUB_APP_PRIVATE_KEY_PATH")
                    .filter(|v| !v.is_empty())
                    .map(PathBuf::from),
            },
            Some(v) => anyhow::bail!("SIMPRESS_GITHUB={v:?} must be `fake` or `real`"),
        };
        let simulate_deploy = flag("SIMPRESS_SIMULATE_DEPLOY", github_mode == GithubMode::Fake)?;

        let static_dir = match opt("SIMPRESS_STATIC_DIR") {
            Some(v) if v.is_empty() => None,
            Some(v) => Some(PathBuf::from(v)),
            None => Some(PathBuf::from("apps/game/dist")),
        };

        let wd = WebConfig::default();
        let web = WebConfig {
            rate_per_min: num("SIMPRESS_WEB_FETCH_RATE_PER_MIN", wd.rate_per_min)?,
            burst: num("SIMPRESS_WEB_FETCH_BURST", wd.burst)?,
            ..wd
        };

        let td = TrackerConfig::default();
        let tracker = TrackerConfig {
            origin: opt("SIMPRESS_TRACKER_ORIGIN")
                .filter(|v| !v.is_empty())
                .unwrap_or_else(|| public_url.clone()),
            raw_retention_days: num("SIMPRESS_TRACKER_RAW_RETENTION_DAYS", td.raw_retention_days)?
                .max(1),
            allow_localhost: flag(
                "SIMPRESS_TRACKER_ALLOW_LOCALHOST",
                public_url.starts_with("http://localhost") || public_url.starts_with("http://127."),
            )?,
            trust_forwarded_for: flag("SIMPRESS_TRACKER_TRUST_PROXY", td.trust_forwarded_for)?,
            rate_per_min: num("SIMPRESS_TRACKER_RATE_PER_MIN", td.rate_per_min)?,
            burst: num("SIMPRESS_TRACKER_BURST", td.burst)?,
            ..td
        };

        Ok(Self {
            database_url,
            data_dir,
            bind,
            public_url,
            github,
            dev_auth,
            github_mode,
            sites_org: opt("GITHUB_SITES_ORG")
                .filter(|v| !v.is_empty())
                .unwrap_or_else(|| "simpress-sites".into()),
            webhook_secret: opt("GITHUB_WEBHOOK_SECRET").filter(|v| !v.is_empty()),
            simulate_deploy,
            lease_ttl: Duration::from_secs(num("SIMPRESS_LEASE_SECS", 90)?.max(1)),
            max_page_bytes: 256 * 1024,
            sync_max_bytes: num("SIMPRESS_SYNC_MAX_BYTES", 64 * 1024 * 1024)?,
            web,
            static_dir,
            session_ttl: Duration::from_secs(num("SIMPRESS_SESSION_TTL_SECS", 30 * 24 * 3600)?),
            tracker,
        })
    }

    /// Cookies get `Secure` when the public origin is https.
    pub fn cookie_secure(&self) -> bool {
        self.public_url.starts_with("https://")
    }

    pub fn oauth_redirect_uri(&self) -> String {
        format!(
            "{}/auth/github/callback",
            self.public_url.trim_end_matches('/')
        )
    }
}

fn opt(key: &str) -> Option<String> {
    std::env::var(key).ok()
}

fn flag(key: &str, default: bool) -> Result<bool> {
    match opt(key).as_deref() {
        None | Some("") => Ok(default),
        Some("1" | "true" | "yes" | "on") => Ok(true),
        Some("0" | "false" | "no" | "off") => Ok(false),
        Some(v) => anyhow::bail!("{key}={v:?} must be true or false"),
    }
}

fn num<T: std::str::FromStr>(key: &str, default: T) -> Result<T>
where
    T::Err: std::fmt::Display,
{
    match opt(key) {
        None => Ok(default),
        Some(v) if v.is_empty() => Ok(default),
        Some(v) => v
            .parse()
            .map_err(|e| anyhow::anyhow!("{key}={v:?} is not a valid number: {e}")),
    }
}
