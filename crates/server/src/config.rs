//! Server configuration, read from the environment (see `.env.example`).

use std::net::SocketAddr;
use std::path::PathBuf;
use std::time::Duration;

use anyhow::{Context, Result};
use serde::Serialize;

use crate::gateway::parse_repo;
use crate::tracker::TrackerConfig;

pub const DEFAULT_DATABASE_URL: &str = "sqlite://data/swarmpress.db?mode=rwc";

/// Which repository and base branch a company's content gateway writes to.
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct SiteBinding {
    /// `owner/name`.
    pub site_repo: String,
    pub base_branch: String,
}

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

/// Which GitHub the content gateway talks to (`SWARMPRESS_GITHUB`).
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

/// Hosted inference (ADR-0067): GPT-6-Luna through the OpenAI Responses API.
#[derive(Clone, Debug)]
pub struct LlmConfig {
    /// `OPENAI_API_KEY`. Without it `POST /api/llm/generate` answers 503.
    pub api_key: Option<String>,
    /// `OPENAI_BASE_URL` (default `https://api.openai.com`; tests point it at wiremock).
    pub api_base: String,
    /// `SWARMPRESS_LLM_MODEL` (default `gpt-6-luna`).
    pub model: String,
    /// Spending cap per company and UTC day, millionths of a dollar
    /// (`LUNA_DAILY_BUDGET_USD`, default 2).
    pub daily_budget_micros: i64,
    /// One provider call's limit (`SWARMPRESS_LLM_TIMEOUT_SECS`, default 600).
    pub timeout: Duration,
    /// Retries of a Flex call the provider refuses as busy (429/503), with backoff.
    pub flex_retries: u32,
    /// One web search, millionths of a dollar ($10 per 1,000 calls, ADR-0068).
    pub web_search_micros: i64,
    /// Prices per million tokens, in millionths of a dollar: Standard, then Flex and Batch.
    pub prices: LlmPrices,
}

/// Token prices of one model, millionths of a dollar per million tokens.
#[derive(Clone, Copy, Debug)]
pub struct LlmPrices {
    pub standard: TokenPrices,
    pub flex: TokenPrices,
}

#[derive(Clone, Copy, Debug)]
pub struct TokenPrices {
    pub input: i64,
    pub cached_input: i64,
    /// Input written to the provider's prompt cache.
    pub cache_write: i64,
    pub output: i64,
}

impl Default for LlmConfig {
    fn default() -> Self {
        Self {
            api_key: None,
            api_base: "https://api.openai.com".into(),
            model: "gpt-6-luna".into(),
            daily_budget_micros: 2_000_000,
            timeout: Duration::from_secs(600),
            flex_retries: 3,
            web_search_micros: 10_000,
            // GPT-6-Luna, checked 2026-10-05 (docs/adr/0067-hosted-inference-on-gpt-6-luna.md).
            prices: LlmPrices {
                standard: TokenPrices {
                    input: 100_000,
                    cached_input: 10_000,
                    cache_write: 125_000,
                    output: 500_000,
                },
                flex: TokenPrices {
                    input: 50_000,
                    cached_input: 5_000,
                    cache_write: 62_500,
                    output: 250_000,
                },
            },
        }
    }
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

/// Deploy observation by polling (ADR-0061 decision 7). Only used with a
/// real GitHub: see `deploys::enabled`.
#[derive(Clone, Debug)]
pub struct DeployWatchConfig {
    /// How often the poller asks GitHub (`SWARMPRESS_DEPLOY_POLL_SECS`,
    /// default 30, at least 5).
    pub poll_interval: Duration,
    /// A merge still pending this long after it was merged fails as
    /// `timed_out` and is no longer asked about
    /// (`SWARMPRESS_DEPLOY_POLL_MAX_AGE_SECS`, default 3600).
    pub max_age: Duration,
    /// Most merges asked about per repository and round, the newest first
    /// (`SWARMPRESS_DEPLOY_POLL_BATCH`, default 20).
    pub batch: usize,
    /// Name of the check run (the workflow job) that publishes the site
    /// (`SWARMPRESS_DEPLOY_CHECK`, default `deploy`).
    pub check_name: String,
    /// File name of the site's deploy workflow, whose failed run
    /// `POST /api/gateway/redeploy` re-runs (`SWARMPRESS_DEPLOY_WORKFLOW`,
    /// default `deploy.yml`).
    pub workflow: String,
}

impl Default for DeployWatchConfig {
    fn default() -> Self {
        Self {
            poll_interval: Duration::from_secs(30),
            max_age: Duration::from_secs(3600),
            batch: 20,
            check_name: "deploy".into(),
            workflow: "deploy.yml".into(),
        }
    }
}

#[derive(Clone, Debug)]
pub struct Config {
    /// `sqlite://data/swarmpress.db?mode=rwc` (default) or `sqlite::memory:`.
    pub database_url: String,
    /// Sync blobs and other files (`SWARMPRESS_DATA_DIR`, default `./data`).
    pub data_dir: PathBuf,
    pub bind: SocketAddr,
    /// Public origin players use (OAuth redirect target, cookie `Secure` flag).
    pub public_url: String,
    pub github: GithubOAuthConfig,
    /// `POST /auth/dev/login` is enabled (`SWARMPRESS_DEV_AUTH=1`). Never in production.
    pub dev_auth: bool,
    /// Content gateway backend (`SWARMPRESS_GITHUB=fake`, otherwise real).
    pub github_mode: GithubMode,
    /// The initial tree of every fake site repository the gateway creates on
    /// first use (`SWARMPRESS_FAKE_SITE`, a directory; fake GitHub only):
    /// its files, at their paths relative to it. Without it a fake repository
    /// starts with a `README.md` only, which gives an empty knowledge pack.
    pub fake_site: Option<PathBuf>,
    /// Owner for site repos of companies created without an explicit repo
    /// when no default repo is configured (`GITHUB_SITES_ORG`, default
    /// `swarmpress-sites`): `{org}/{login}-site`.
    pub sites_org: String,
    /// The site repository a new company is bound to
    /// (`SWARMPRESS_DEFAULT_SITE_REPO`, `owner/name`): the owner's choice,
    /// applied at company creation. Without it the default is
    /// `{GITHUB_SITES_ORG}/{login}-site`.
    pub default_site_repo: Option<String>,
    /// The base branch of a new company's binding
    /// (`SWARMPRESS_DEFAULT_BASE_BRANCH`, default `main`).
    pub default_base_branch: String,
    /// The only repositories a company may be bound to
    /// (`SWARMPRESS_ALLOWED_SITE_REPOS`, comma-separated `owner/name`,
    /// compared without case), at creation, at a rebind and on every gateway
    /// call. Required with a real GitHub (a startup error when empty); empty
    /// with the fake GitHub means any repository.
    pub allowed_site_repos: Vec<String>,
    /// `X-Hub-Signature-256` secret for `POST /webhooks/github`.
    pub webhook_secret: Option<String>,
    /// Emit `DeployLanded` right after a gateway merge (`SWARMPRESS_SIMULATE_DEPLOY`,
    /// default on with the fake GitHub, off otherwise). With a real GitHub
    /// it is refused at startup: it would report merges as live that are not.
    pub simulate_deploy: bool,
    /// The deploy poller (real GitHub only).
    pub deploys: DeployWatchConfig,
    /// Company lease length (`SWARMPRESS_LEASE_SECS`, default 90).
    pub lease_ttl: Duration,
    /// Upper bound on a gateway page (bytes of JSON text).
    pub max_page_bytes: usize,
    /// Enforce the blog-article profile on drafts under `content/pages/blog/`
    /// (`SWARMPRESS_ARTICLE_PROFILE`, default `enforce`). `off` is accepted
    /// only with the fake GitHub: a bridge for scripted runs whose
    /// orchestrator still writes the pre-MVP article shape.
    pub article_profile: bool,
    /// Mail domain of the git author addresses the gateway synthesises for
    /// staff personas, `<staff>+<company>@<domain>`
    /// (`SWARMPRESS_STAFF_EMAIL_DOMAIN`, default `staff.swarm.press`).
    pub staff_email_domain: String,
    /// Upper bound on one sync upload (`SWARMPRESS_SYNC_MAX_BYTES`, default 64 MiB).
    pub sync_max_bytes: usize,
    pub web: WebConfig,
    /// Hosted inference (ADR-0067).
    pub llm: LlmConfig,
    /// Built game client to serve at `/` (SPA fallback to index.html).
    pub static_dir: Option<PathBuf>,
    /// Cross-origin isolation for the served client (ADR-0041): the COEP value sent with
    /// COOP `same-origin` (`SWARMPRESS_COEP` = `credentialless` (default), `require-corp`, or
    /// `off` to send neither header).
    pub coep: Option<String>,
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
            fake_site: None,
            sites_org: "swarmpress-sites".into(),
            default_site_repo: None,
            default_base_branch: "main".into(),
            allowed_site_repos: Vec::new(),
            webhook_secret: Some("test-webhook-secret".into()),
            simulate_deploy: true,
            deploys: DeployWatchConfig::default(),
            lease_ttl: Duration::from_secs(90),
            max_page_bytes: 256 * 1024,
            article_profile: true,
            staff_email_domain: github::provenance::DEFAULT_EMAIL_DOMAIN.into(),
            sync_max_bytes: 8 * 1024 * 1024,
            web: WebConfig::default(),
            llm: LlmConfig::default(),
            static_dir: None,
            coep: Some("credentialless".into()),
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
            opt("SWARMPRESS_DATA_DIR")
                .filter(|v| !v.is_empty())
                .unwrap_or_else(|| "data".into()),
        );
        let bind: SocketAddr = opt("SWARMPRESS_BIND")
            .unwrap_or_else(|| "127.0.0.1:8080".into())
            .parse()
            .context("SWARMPRESS_BIND must be host:port")?;
        // The server's own origin: it serves the built game itself
        // (SWARMPRESS_STATIC_DIR). `pnpm dev` with GitHub sign-in through
        // Vite sets http://localhost:5173.
        let public_url = opt("SWARMPRESS_PUBLIC_URL")
            .filter(|v| !v.is_empty())
            .unwrap_or_else(|| format!("http://localhost:{}", bind.port()));

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
        let dev_auth = flag("SWARMPRESS_DEV_AUTH", false)?;
        if github.client_id.is_empty() && !dev_auth {
            tracing::warn!(
                "GITHUB_OAUTH_CLIENT_ID is empty and SWARMPRESS_DEV_AUTH is off: nobody can sign in"
            );
        }
        if dev_auth {
            tracing::warn!(
                "SWARMPRESS_DEV_AUTH=1: POST /auth/dev/login signs anyone in. Development only."
            );
        }

        let github_mode = match opt("SWARMPRESS_GITHUB").as_deref() {
            Some("fake") => GithubMode::Fake,
            None | Some("" | "real") => GithubMode::Real {
                api_base: github.api_base.clone(),
                token: opt("GITHUB_TOKEN").filter(|v| !v.is_empty()),
                app_id: opt("GITHUB_APP_ID").filter(|v| !v.is_empty()),
                app_private_key_path: opt("GITHUB_APP_PRIVATE_KEY_PATH")
                    .filter(|v| !v.is_empty())
                    .map(PathBuf::from),
            },
            Some(v) => anyhow::bail!("SWARMPRESS_GITHUB={v:?} must be `fake` or `real`"),
        };
        let fake_site = opt("SWARMPRESS_FAKE_SITE")
            .filter(|v| !v.is_empty())
            .map(PathBuf::from);
        let simulate_deploy = flag(
            "SWARMPRESS_SIMULATE_DEPLOY",
            github_mode == GithubMode::Fake,
        )?;

        let article_profile = match opt("SWARMPRESS_ARTICLE_PROFILE").as_deref() {
            None | Some("" | "enforce") => true,
            Some("off") => false,
            Some(v) => {
                anyhow::bail!("SWARMPRESS_ARTICLE_PROFILE={v:?} must be `enforce` or `off`")
            }
        };

        let static_dir = match opt("SWARMPRESS_STATIC_DIR") {
            Some(v) if v.is_empty() => None,
            Some(v) => Some(PathBuf::from(v)),
            None => Some(PathBuf::from("apps/game/dist")),
        };

        let coep = match opt("SWARMPRESS_COEP").as_deref() {
            None | Some("") | Some("credentialless") => Some("credentialless".to_string()),
            Some("require-corp") => Some("require-corp".to_string()),
            Some("off") => None,
            Some(v) => anyhow::bail!(
                "SWARMPRESS_COEP={v:?} must be `credentialless`, `require-corp` or `off`"
            ),
        };

        let wd = WebConfig::default();
        let web = WebConfig {
            rate_per_min: num("SWARMPRESS_WEB_FETCH_RATE_PER_MIN", wd.rate_per_min)?,
            burst: num("SWARMPRESS_WEB_FETCH_BURST", wd.burst)?,
            ..wd
        };

        let ld = LlmConfig::default();
        let daily_budget_micros =
            match opt("LUNA_DAILY_BUDGET_USD").filter(|v| !v.trim().is_empty()) {
                None => ld.daily_budget_micros,
                Some(v) => usd_micros(&v).ok_or_else(|| {
                    anyhow::anyhow!(
                        "LUNA_DAILY_BUDGET_USD={v:?} must be an amount in dollars, e.g. 2 or 2.50"
                    )
                })?,
            };
        let llm = LlmConfig {
            api_key: opt("OPENAI_API_KEY").filter(|v| !v.trim().is_empty()),
            api_base: opt("OPENAI_BASE_URL")
                .filter(|v| !v.is_empty())
                .unwrap_or(ld.api_base.clone()),
            model: opt("SWARMPRESS_LLM_MODEL")
                .filter(|v| !v.is_empty())
                .unwrap_or(ld.model.clone()),
            daily_budget_micros,
            timeout: Duration::from_secs(num("SWARMPRESS_LLM_TIMEOUT_SECS", 600u64)?),
            ..ld
        };

        let td = TrackerConfig::default();
        let tracker = TrackerConfig {
            origin: opt("SWARMPRESS_TRACKER_ORIGIN")
                .filter(|v| !v.is_empty())
                .unwrap_or_else(|| public_url.clone()),
            raw_retention_days: num(
                "SWARMPRESS_TRACKER_RAW_RETENTION_DAYS",
                td.raw_retention_days,
            )?
            .max(1),
            allow_localhost: flag(
                "SWARMPRESS_TRACKER_ALLOW_LOCALHOST",
                public_url.starts_with("http://localhost") || public_url.starts_with("http://127."),
            )?,
            trust_forwarded_for: flag("SWARMPRESS_TRACKER_TRUST_PROXY", td.trust_forwarded_for)?,
            rate_per_min: num("SWARMPRESS_TRACKER_RATE_PER_MIN", td.rate_per_min)?,
            burst: num("SWARMPRESS_TRACKER_BURST", td.burst)?,
            ..td
        };

        let cfg = Self {
            database_url,
            data_dir,
            bind,
            public_url,
            github,
            dev_auth,
            github_mode,
            fake_site,
            sites_org: opt("GITHUB_SITES_ORG")
                .filter(|v| !v.is_empty())
                .unwrap_or_else(|| "swarmpress-sites".into()),
            default_site_repo: opt("SWARMPRESS_DEFAULT_SITE_REPO")
                .map(|v| v.trim().to_string())
                .filter(|v| !v.is_empty()),
            default_base_branch: opt("SWARMPRESS_DEFAULT_BASE_BRANCH")
                .map(|v| v.trim().to_string())
                .filter(|v| !v.is_empty())
                .unwrap_or_else(|| "main".into()),
            allowed_site_repos: opt("SWARMPRESS_ALLOWED_SITE_REPOS")
                .map(|v| split_list(&v))
                .unwrap_or_default(),
            webhook_secret: opt("GITHUB_WEBHOOK_SECRET").filter(|v| !v.is_empty()),
            simulate_deploy,
            deploys: {
                let d = DeployWatchConfig::default();
                DeployWatchConfig {
                    poll_interval: Duration::from_secs(
                        num("SWARMPRESS_DEPLOY_POLL_SECS", d.poll_interval.as_secs())?.max(5),
                    ),
                    max_age: Duration::from_secs(
                        num("SWARMPRESS_DEPLOY_POLL_MAX_AGE_SECS", d.max_age.as_secs())?.max(60),
                    ),
                    batch: num("SWARMPRESS_DEPLOY_POLL_BATCH", d.batch)?.clamp(1, 100),
                    check_name: opt("SWARMPRESS_DEPLOY_CHECK")
                        .map(|v| v.trim().to_string())
                        .filter(|v| !v.is_empty())
                        .unwrap_or(d.check_name),
                    workflow: opt("SWARMPRESS_DEPLOY_WORKFLOW")
                        .map(|v| v.trim().rsplit('/').next().unwrap_or_default().to_string())
                        .filter(|v| !v.is_empty())
                        .unwrap_or(d.workflow),
                }
            },
            lease_ttl: Duration::from_secs(num("SWARMPRESS_LEASE_SECS", 90)?.max(1)),
            max_page_bytes: 256 * 1024,
            article_profile,
            staff_email_domain: opt("SWARMPRESS_STAFF_EMAIL_DOMAIN")
                .map(|v| v.trim().to_ascii_lowercase())
                .filter(|v| !v.is_empty())
                .unwrap_or_else(|| github::provenance::DEFAULT_EMAIL_DOMAIN.into()),
            sync_max_bytes: num("SWARMPRESS_SYNC_MAX_BYTES", 64 * 1024 * 1024)?,
            web,
            llm,
            static_dir,
            coep,
            session_ttl: Duration::from_secs(num("SWARMPRESS_SESSION_TTL_SECS", 30 * 24 * 3600)?),
            tracker,
        };
        cfg.validate()?;
        Ok(cfg)
    }

    /// Combinations that must stop the server at startup. Called by
    /// [`Config::from_env`] and by `AppState::new`.
    pub fn validate(&self) -> Result<()> {
        let real = matches!(self.github_mode, GithubMode::Real { .. });
        if real && self.simulate_deploy {
            anyhow::bail!(
                "SWARMPRESS_SIMULATE_DEPLOY=1 is only allowed with SWARMPRESS_GITHUB=fake: \
                 with a real GitHub it would report every merge as live, deployed or not. \
                 Deploys of a real repository are observed by polling and by the webhook"
            );
        }
        if real && self.fake_site.is_some() {
            anyhow::bail!(
                "SWARMPRESS_FAKE_SITE is only allowed with SWARMPRESS_GITHUB=fake: \
                 it seeds the in-memory site repositories of the fake"
            );
        }
        if real && !self.article_profile {
            anyhow::bail!(
                "SWARMPRESS_ARTICLE_PROFILE=off is only allowed with SWARMPRESS_GITHUB=fake: \
                 a real site repository always gets the article profile"
            );
        }
        if !is_mail_domain(&self.staff_email_domain) {
            anyhow::bail!(
                "SWARMPRESS_STAFF_EMAIL_DOMAIN={:?} must be a host name like `staff.swarm.press`",
                self.staff_email_domain
            );
        }
        if real && self.dev_auth && !self.bind.ip().is_loopback() {
            anyhow::bail!(
                "SWARMPRESS_DEV_AUTH=1 with a real GitHub is only allowed on a loopback address: \
                 SWARMPRESS_BIND={} would let anyone who reaches it sign in and write to the \
                 site repository. Bind to 127.0.0.1, or sign in with GitHub instead",
                self.bind
            );
        }
        self.validate_site_binding(real)
    }

    /// The repository rules (G2): every allow-list entry and the default
    /// binding are well formed, the default is on the list, and a real GitHub
    /// has a list at all.
    fn validate_site_binding(&self, real: bool) -> Result<()> {
        for entry in &self.allowed_site_repos {
            if parse_repo(entry).is_none() {
                anyhow::bail!("SWARMPRESS_ALLOWED_SITE_REPOS: {entry:?} is not `owner/name`");
            }
        }
        if real && self.allowed_site_repos.is_empty() {
            anyhow::bail!(
                "SWARMPRESS_ALLOWED_SITE_REPOS is required with a real GitHub \
                 (SWARMPRESS_GITHUB unset or `real`): list the repositories a company may write \
                 to, comma-separated `owner/name`, so that a typo can never write to another \
                 one. For development use SWARMPRESS_GITHUB=fake"
            );
        }
        if let Some(repo) = &self.default_site_repo {
            if parse_repo(repo).is_none() {
                anyhow::bail!("SWARMPRESS_DEFAULT_SITE_REPO={repo:?} is not `owner/name`");
            }
            if !self.site_repo_allowed(repo) {
                anyhow::bail!(
                    "SWARMPRESS_DEFAULT_SITE_REPO={repo:?} is not in SWARMPRESS_ALLOWED_SITE_REPOS"
                );
            }
        }
        if github::policy::validate_branch_name(&self.default_base_branch).is_err() {
            anyhow::bail!(
                "SWARMPRESS_DEFAULT_BASE_BRANCH={:?} is not a valid branch name",
                self.default_base_branch
            );
        }
        Ok(())
    }

    /// Whether a company may be bound to `repo` (`owner/name`): it is on
    /// `SWARMPRESS_ALLOWED_SITE_REPOS` (without case), or the list is empty
    /// (the fake GitHub only; a real GitHub refuses to start without one).
    pub fn site_repo_allowed(&self, repo: &str) -> bool {
        self.allowed_site_repos.is_empty()
            || self
                .allowed_site_repos
                .iter()
                .any(|r| r.eq_ignore_ascii_case(repo))
    }

    /// The binding a new company of `login` gets when the request names
    /// none: `SWARMPRESS_DEFAULT_SITE_REPO` on `SWARMPRESS_DEFAULT_BASE_BRANCH`,
    /// else `{GITHUB_SITES_ORG}/{login}-site`.
    pub fn default_binding(&self, login: &str) -> SiteBinding {
        SiteBinding {
            site_repo: self.default_site_repo.clone().unwrap_or_else(|| {
                format!("{}/{}-site", self.sites_org, login.to_ascii_lowercase())
            }),
            base_branch: self.default_base_branch.clone(),
        }
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

/// A lowercase host name with at least two labels (it ends up in commit
/// headers, so nothing else is let through).
fn is_mail_domain(d: &str) -> bool {
    d.len() <= 253
        && d.contains('.')
        && d.split('.').all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label
                    .bytes()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
        })
}

/// `"2"`, `"2.5"` or `"0.05"` dollars as millionths of a dollar (no floating point).
pub fn usd_micros(v: &str) -> Option<i64> {
    let v = v.trim().trim_start_matches('$');
    let (whole, frac) = v.split_once('.').unwrap_or((v, ""));
    if whole.is_empty() && frac.is_empty() || frac.len() > 6 {
        return None;
    }
    let whole: i64 = if whole.is_empty() {
        0
    } else {
        whole.parse().ok()?
    };
    let frac_digits = format!("{frac:0<6}");
    let frac: i64 = if frac.is_empty() {
        0
    } else {
        frac_digits.parse().ok()?
    };
    if whole < 0 || !v.chars().all(|c| c.is_ascii_digit() || c == '.') {
        return None;
    }
    whole.checked_mul(1_000_000)?.checked_add(frac)
}

fn opt(key: &str) -> Option<String> {
    std::env::var(key).ok()
}

/// A comma-separated list: entries trimmed, empty ones dropped.
fn split_list(v: &str) -> Vec<String> {
    v.split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(String::from)
        .collect()
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dollar_amounts_parse_without_floating_point() {
        assert_eq!(usd_micros("2"), Some(2_000_000));
        assert_eq!(usd_micros("2.50"), Some(2_500_000));
        assert_eq!(usd_micros("$0.05"), Some(50_000));
        assert_eq!(usd_micros(".5"), Some(500_000));
        assert_eq!(usd_micros("0"), Some(0));
        for bad in ["", "-1", "abc", "1.2345678", "1,5", "."] {
            assert_eq!(usd_micros(bad), None, "{bad}");
        }
    }

    fn real(token: Option<&str>) -> GithubMode {
        GithubMode::Real {
            api_base: "https://api.github.com".into(),
            token: token.map(String::from),
            app_id: None,
            app_private_key_path: None,
        }
    }

    /// The test config with an allow-list, so it stays valid when a test
    /// switches it to a real GitHub.
    fn cfg() -> Config {
        let mut c = Config::for_tests(
            "sqlite::memory:",
            PathBuf::from("data"),
            GithubOAuthConfig::github("id", "secret"),
        );
        c.allowed_site_repos = vec!["owner/site".into()];
        c
    }

    #[test]
    fn the_test_config_is_valid() {
        cfg().validate().unwrap();
    }

    #[test]
    fn a_real_github_needs_an_allow_list() {
        let mut c = cfg();
        c.allowed_site_repos.clear();
        c.validate().expect("the fake GitHub takes any repository");
        assert!(c.site_repo_allowed("anyone/anything"));
        c.simulate_deploy = false;
        for mode in [real(Some("tok")), real(None)] {
            c.github_mode = mode;
            let e = c.validate().unwrap_err().to_string();
            assert!(e.contains("SWARMPRESS_ALLOWED_SITE_REPOS"), "{e}");
        }
        c.allowed_site_repos = split_list(" drietsch/cinqueterre.travel , ,Sandbox/Live-Test ");
        assert_eq!(
            c.allowed_site_repos,
            ["drietsch/cinqueterre.travel", "Sandbox/Live-Test"]
        );
        c.validate().unwrap();
        // Compared without case, as GitHub does; nothing else gets through.
        assert!(c.site_repo_allowed("Drietsch/CinqueTerre.travel"));
        assert!(c.site_repo_allowed("sandbox/live-test"));
        assert!(!c.site_repo_allowed("swarmpress/cinqueterre.travel"));
        assert!(!c.site_repo_allowed("drietsch/cinqueterre.travel2"));
        // A malformed entry stops the server, fake or real.
        for bad in ["noslash", "a/b/c", "a/..", "/b"] {
            c.allowed_site_repos = vec![bad.into()];
            let e = c.validate().unwrap_err().to_string();
            assert!(e.contains("SWARMPRESS_ALLOWED_SITE_REPOS"), "{bad}: {e}");
        }
        c.github_mode = GithubMode::Fake;
        c.allowed_site_repos = vec!["noslash".into()];
        assert!(c.validate().is_err());
    }

    #[test]
    fn the_default_binding_comes_from_the_owner_and_must_be_allowed() {
        let mut c = cfg();
        c.allowed_site_repos.clear();
        assert_eq!(
            c.default_binding("Ada"),
            SiteBinding {
                site_repo: "swarmpress-sites/ada-site".into(),
                base_branch: "main".into(),
            }
        );
        c.default_site_repo = Some("drietsch/cinqueterre.travel".into());
        c.default_base_branch = "rehearsal".into();
        c.validate().unwrap();
        assert_eq!(
            c.default_binding("ada"),
            SiteBinding {
                site_repo: "drietsch/cinqueterre.travel".into(),
                base_branch: "rehearsal".into(),
            }
        );
        // On the list or the server does not start.
        c.allowed_site_repos = vec!["drietsch/other".into()];
        let e = c.validate().unwrap_err().to_string();
        assert!(
            e.contains("SWARMPRESS_DEFAULT_SITE_REPO") && e.contains("not in"),
            "{e}"
        );
        c.allowed_site_repos = vec!["Drietsch/CinqueTerre.Travel".into()];
        c.validate().unwrap();
        c.default_site_repo = Some("not a repo".into());
        let e = c.validate().unwrap_err().to_string();
        assert!(e.contains("SWARMPRESS_DEFAULT_SITE_REPO"), "{e}");
        c.default_site_repo = None;
        for bad in ["", "a..b", "a b", "x.lock", "/main"] {
            c.default_base_branch = bad.into();
            let e = c.validate().unwrap_err().to_string();
            assert!(e.contains("SWARMPRESS_DEFAULT_BASE_BRANCH"), "{bad:?}: {e}");
        }
    }

    #[test]
    fn dev_auth_with_a_real_github_is_loopback_only() {
        let mut c = cfg();
        c.simulate_deploy = false;
        c.dev_auth = true;
        for open in ["0.0.0.0:8080", "192.168.1.20:8080", "[::]:8080"] {
            c.bind = open.parse().unwrap();
            c.github_mode = GithubMode::Fake;
            c.validate().expect("the fake GitHub writes nothing real");
            c.github_mode = real(Some("tok"));
            let e = c.validate().unwrap_err().to_string();
            assert!(
                e.contains("SWARMPRESS_DEV_AUTH") && e.contains("loopback"),
                "{open}: {e}"
            );
            c.dev_auth = false;
            c.validate().expect("GitHub sign-in may listen anywhere");
            c.dev_auth = true;
        }
        for local in ["127.0.0.1:8080", "[::1]:8080", "127.0.0.2:9000"] {
            c.bind = local.parse().unwrap();
            c.validate().unwrap();
        }
    }

    #[test]
    fn the_article_profile_cannot_be_switched_off_for_a_real_repository() {
        let mut c = cfg();
        c.article_profile = false;
        c.validate().expect("off is a bridge for the fake GitHub");
        c.simulate_deploy = false;
        c.github_mode = real(Some("tok"));
        let e = c.validate().unwrap_err().to_string();
        assert!(e.contains("SWARMPRESS_ARTICLE_PROFILE"), "{e}");
        c.article_profile = true;
        c.validate().unwrap();
    }

    #[test]
    fn a_fake_site_seed_is_refused_with_a_real_github() {
        let mut c = cfg();
        c.fake_site = Some(PathBuf::from(
            "crates/knowledge/tests/fixtures/cinqueterre-mini",
        ));
        c.validate().expect("the fake may be seeded");
        c.simulate_deploy = false;
        c.github_mode = real(Some("tok"));
        let e = c.validate().unwrap_err().to_string();
        assert!(e.contains("SWARMPRESS_FAKE_SITE"), "{e}");
        c.fake_site = None;
        c.validate().unwrap();
    }

    #[test]
    fn simulated_deploys_are_refused_with_a_real_github() {
        let mut c = cfg();
        assert!(c.simulate_deploy, "the fake's default");
        for mode in [real(Some("tok")), real(None)] {
            c.github_mode = mode;
            c.simulate_deploy = true;
            let e = c.validate().unwrap_err().to_string();
            assert!(e.contains("SWARMPRESS_SIMULATE_DEPLOY"), "{e}");
            c.simulate_deploy = false;
            c.validate().unwrap();
        }
    }

    #[test]
    fn the_staff_email_domain_must_be_a_host_name() {
        let mut c = cfg();
        for ok in ["staff.swarm.press", "example.org", "a-b.c1.invalid"] {
            c.staff_email_domain = ok.into();
            c.validate().unwrap();
        }
        for bad in [
            "",
            "localhost",
            "Staff.Swarm.Press",
            "a..b",
            "-a.b",
            "a.b-",
            "x.org>\nApproved-by: nobody",
            "a b.org",
            "me@x.org",
        ] {
            c.staff_email_domain = bad.into();
            let e = c.validate().unwrap_err().to_string();
            assert!(e.contains("SWARMPRESS_STAFF_EMAIL_DOMAIN"), "{bad}: {e}");
        }
    }
}
