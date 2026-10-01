//! Server configuration, read from the environment (see `.env.example`).

use std::net::SocketAddr;
use std::path::PathBuf;
use std::time::Duration;

use anyhow::{Context, Result};

use crate::actor::ActorConfig;
use crate::jobs::RetryPolicy;

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

#[derive(Clone, Debug)]
pub struct Config {
    pub database_url: String,
    pub bind: SocketAddr,
    /// Public origin players use (OAuth redirect target, cookie `Secure` flag).
    pub public_url: String,
    pub github: GithubOAuthConfig,
    /// Built game client to serve at `/` (SPA fallback to index.html).
    pub static_dir: Option<PathBuf>,
    /// Real minutes per game day for newly created companies.
    pub default_day_real_minutes: u32,
    pub session_ttl: Duration,
    pub actor: ActorConfig,
    /// Lease length handed to job workers (browser and Claude).
    pub job_lease: Duration,
    pub job_retry: RetryPolicy,
    /// How often expired leases are reaped.
    pub job_reap_interval: Duration,
    /// Concurrent Claude jobs per server process.
    pub claude_concurrency: usize,
    /// Upper bound on a browser artifact (bytes of JSON text).
    pub max_artifact_bytes: usize,
}

impl Config {
    /// A config suitable for tests: all URLs local, short timings.
    pub fn for_tests(database_url: &str, github: GithubOAuthConfig) -> Self {
        Self {
            database_url: database_url.into(),
            bind: "127.0.0.1:0".parse().expect("valid addr"),
            public_url: "http://localhost:5173".into(),
            github,
            static_dir: None,
            default_day_real_minutes: 60,
            session_ttl: Duration::from_secs(30 * 24 * 3600),
            actor: ActorConfig::default(),
            job_lease: Duration::from_secs(30),
            job_retry: RetryPolicy::default(),
            job_reap_interval: Duration::from_secs(5),
            claude_concurrency: 1,
            max_artifact_bytes: 256 * 1024,
        }
    }

    pub fn from_env() -> Result<Self> {
        let database_url = req("DATABASE_URL")?;
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
        if github.client_id.is_empty() {
            tracing::warn!("GITHUB_OAUTH_CLIENT_ID is empty: GitHub login will fail");
        }

        let static_dir = match opt("SIMPRESS_STATIC_DIR") {
            Some(v) if v.is_empty() => None,
            Some(v) => Some(PathBuf::from(v)),
            None => Some(PathBuf::from("apps/game/dist")),
        };

        let defaults = ActorConfig::default();
        let actor = ActorConfig {
            hash_every: num("SIMPRESS_HASH_EVERY_STEPS", defaults.hash_every)?,
            snapshot_every: num("SIMPRESS_SNAPSHOT_EVERY_STEPS", defaults.snapshot_every)?,
            catchup_budget: num("SIMPRESS_CATCHUP_STEPS_PER_TICK", defaults.catchup_budget)?,
            idle_unload: Some(Duration::from_secs(num("SIMPRESS_IDLE_UNLOAD_SECS", 300)?)),
            ..defaults
        };

        Ok(Self {
            database_url,
            bind,
            public_url,
            github,
            static_dir,
            default_day_real_minutes: num("SIMPRESS_DAY_REAL_MINUTES", 60)?,
            session_ttl: Duration::from_secs(num("SIMPRESS_SESSION_TTL_SECS", 30 * 24 * 3600)?),
            actor,
            job_lease: Duration::from_secs(num("SIMPRESS_JOB_LEASE_SECS", 60)?),
            job_retry: RetryPolicy::default(),
            job_reap_interval: Duration::from_secs(num("SIMPRESS_JOB_REAP_SECS", 5)?),
            claude_concurrency: num("SIMPRESS_CLAUDE_CONCURRENCY", 4)?,
            max_artifact_bytes: num("SIMPRESS_MAX_ARTIFACT_BYTES", 256 * 1024)?,
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

fn req(key: &str) -> Result<String> {
    std::env::var(key).with_context(|| format!("{key} must be set"))
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
