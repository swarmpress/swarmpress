//! Application state, HTTP routes and server bootstrap.

use std::collections::HashMap;
use std::sync::Arc;

use anyhow::Result;
use axum::extract::{DefaultBodyLimit, State};
use axum::http::{HeaderName, HeaderValue, StatusCode};
use axum::response::IntoResponse;
use axum::routing::{get, post, put};
use axum::{Json, Router};
use github::{Clock, SystemClock};
use tokio::net::TcpListener;
use tokio::task::JoinHandle;
use tower::ServiceBuilder;
use tower_http::services::{ServeDir, ServeFile};
use tower_http::set_header::SetResponseHeaderLayer;
use tower_http::trace::TraceLayer;

use crate::auth::{self, CurrentUser};
use crate::config::Config;
use crate::db::{accounts, Company, Db};
use crate::error::{AppError, AppResult};
use crate::events::{self, EventHub};
use crate::gateway::{self, RepoBackend};
use crate::site_knowledge::{self, KnowledgeCache};
use crate::tracker::{self, AnalyticsSignalSink, PendingSignalSink, RateLimiter, Tracker};
use crate::{companies, deploys, llm, sync, web, webhooks};

#[derive(Clone)]
pub struct AppState {
    pub cfg: Arc<Config>,
    pub db: Db,
    /// Wall clock (unix ms); tests inject a `github::ManualClock`.
    pub clock: Arc<dyn Clock>,
    pub http: reqwest::Client,
    /// Offline event inbox fan-out.
    pub events: EventHub,
    /// Content gateway backend (fake or real GitHub).
    pub github: Arc<RepoBackend>,
    /// Knowledge packs by (site repository, commit) ([`site_knowledge`]).
    pub knowledge: Arc<KnowledgeCache>,
    /// Site audits by (site repository, commit) ([`crate::site_audit`], ADR-0070).
    pub audits: Arc<crate::site_audit::AuditCache>,
    /// Blueprints and tools by (site repository, commit) ([`crate::site_blueprint`], ADR-0072).
    pub blueprints: Arc<crate::site_blueprint::BlueprintCache>,
    /// Per-user limiter for `/web/fetch`.
    pub web_limiter: Arc<RateLimiter<String>>,
    /// Serializes sync blob writes (single process).
    pub sync_lock: Arc<tokio::sync::Mutex<()>>,
    /// One mutex per company (ADR-0045 decision 5), see [`AppState::company_lock`].
    company_locks: CompanyLocks,
    /// One mutex per site repository, see [`AppState::repo_lock`].
    repo_locks: CompanyLocks,
    /// First-party analytics collector (ADR-0032).
    pub tracker: Arc<Tracker>,
    /// Where nightly analytics signals go.
    pub signal_sink: Arc<dyn AnalyticsSignalSink>,
}

impl AppState {
    pub fn new(cfg: Config, db: Db) -> Result<Self> {
        cfg.validate()?;
        let github = Arc::new(RepoBackend::from_config(&cfg)?);
        Ok(Self::with_parts(cfg, db, Arc::new(SystemClock), github))
    }

    pub fn with_parts(
        cfg: Config,
        db: Db,
        clock: Arc<dyn Clock>,
        github: Arc<RepoBackend>,
    ) -> Self {
        let http = reqwest::Client::builder()
            .user_agent(concat!("swarmpress-server/", env!("CARGO_PKG_VERSION")))
            .timeout(std::time::Duration::from_secs(20))
            .build()
            .expect("http client");
        let tracker = Arc::new(Tracker::new(cfg.tracker.clone()));
        let web_limiter = Arc::new(RateLimiter::new(cfg.web.rate_per_min, cfg.web.burst));
        Self {
            cfg: Arc::new(cfg),
            db,
            clock,
            http,
            events: EventHub::default(),
            github,
            knowledge: Arc::new(KnowledgeCache::default()),
            audits: Arc::new(crate::site_audit::AuditCache::default()),
            blueprints: Arc::new(crate::site_blueprint::BlueprintCache::default()),
            web_limiter,
            sync_lock: Arc::new(tokio::sync::Mutex::new(())),
            company_locks: CompanyLocks::default(),
            repo_locks: CompanyLocks::default(),
            tracker,
            signal_sink: Arc::new(PendingSignalSink),
        }
    }

    /// Replace the (pending-only) analytics signal sink.
    pub fn with_signal_sink(mut self, sink: Arc<dyn AnalyticsSignalSink>) -> Self {
        self.signal_sink = sink;
        self
    }

    /// Now, in unix milliseconds.
    pub fn now_ms(&self) -> i64 {
        i64::try_from(self.clock.now_ms()).unwrap_or(i64::MAX)
    }

    /// The company's mutex. A fenced write holds it across the lease check,
    /// the external call and the bookkeeping; a lease grant takes it too, so a
    /// takeover waits until an in-flight side effect has been recorded. This
    /// relies on the single server process.
    pub async fn company_lock(&self, company_id: &str) -> tokio::sync::OwnedMutexGuard<()> {
        self.company_locks.lock(company_id).await
    }

    /// The mutex of a site repository (`owner/name`, compared without case).
    /// Finalising an article reads the base branch's story list, rewrites it
    /// on the draft branch and squash-merges: two merges into one repository
    /// must not interleave, also when two companies are bound to it. Taken
    /// after the company lock, never before it.
    pub async fn repo_lock(&self, repo: &str) -> tokio::sync::OwnedMutexGuard<()> {
        self.repo_locks.lock(&repo.to_ascii_lowercase()).await
    }
}

impl CompanyLocks {
    async fn lock(&self, key: &str) -> tokio::sync::OwnedMutexGuard<()> {
        let lock = self
            .0
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .entry(key.to_string())
            .or_default()
            .clone();
        lock.lock_owned().await
    }
}

/// Mutexes by key (a company id, a repository name). Entries are never
/// removed: one small allocation per company that ever took a lease and per
/// repository that ever merged an article.
#[derive(Clone, Default)]
struct CompanyLocks(Arc<std::sync::Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>>);

/// The caller's company, or 404.
pub async fn require_company(st: &AppState, user_id: &str) -> AppResult<Company> {
    accounts::company_for_user(&st.db, user_id)
        .await?
        .ok_or_else(|| AppError::NotFound("create a company first".into()))
}

pub fn router(st: AppState) -> Router {
    let sync_limit = DefaultBodyLimit::max(st.cfg.sync_max_bytes);
    // JSON page (256 KiB) plus envelope.
    let gateway_limit = DefaultBodyLimit::max(st.cfg.max_page_bytes * 2 + 16 * 1024);
    let mut r = Router::new()
        .route("/healthz", get(healthz))
        // auth
        .route("/auth/github/login", get(auth::login))
        .route("/auth/github/callback", get(auth::callback))
        .route("/auth/dev/login", post(auth::dev_login))
        .route("/auth/logout", post(auth::logout))
        .route("/api/me", get(me))
        // companies and leases
        .route("/api/companies", post(companies::create))
        .route(
            "/api/companies/me",
            get(companies::me).patch(companies::rebind),
        )
        .route(
            "/api/companies/{id}/lease",
            post(companies::lease).delete(companies::release),
        )
        // content gateway
        .route(
            "/api/gateway/draft",
            post(gateway::draft).layer(gateway_limit),
        )
        .route("/api/gateway/merge", post(gateway::merge))
        .route("/api/gateway/close", post(gateway::close))
        .route("/api/gateway/knowledge", get(site_knowledge::knowledge))
        .route("/api/gateway/file", get(crate::site_audit::file))
        .route("/api/site/audit", get(crate::site_audit::audit))
        .route(
            "/api/site/data",
            get(crate::site_data::get_data).put(crate::site_data::put_data),
        )
        .route(
            "/api/site/blueprint",
            get(crate::site_blueprint::get_blueprint).put(crate::site_blueprint::put_blueprint),
        )
        .route("/api/gateway/deploy-status", get(deploys::status))
        .route("/api/gateway/redeploy", post(deploys::redeploy))
        // test route: fake GitHub only (404 otherwise)
        .route("/api/dev/github/commit/{sha}", get(gateway::dev_commit))
        // events
        .route("/api/events", get(events::list))
        .route("/ws/events", get(events::ws))
        .route(
            "/webhooks/github",
            post(webhooks::github).layer(DefaultBodyLimit::max(1024 * 1024)),
        )
        // sync
        .route("/api/sync/{company}/log", get(sync::list_segments))
        .route(
            "/api/sync/{company}/log/{segment}",
            put(sync::put_segment)
                .get(sync::get_segment)
                .layer(sync_limit),
        )
        .route(
            "/api/sync/{company}/snapshot",
            put(sync::put_snapshot)
                .get(sync::get_snapshot)
                .layer(sync_limit),
        )
        // web access
        .route("/api/llm/generate", post(llm::generate))
        .route("/web/fetch", get(web::fetch))
        .route("/web/firecrawl/{*rest}", post(web::firecrawl))
        // tracker
        .route(
            "/api/projects",
            get(tracker::list_projects).post(tracker::post_project),
        )
        .route("/api/analytics", get(tracker::get_analytics))
        .route(
            "/api/analytics/signals",
            get(crate::analytics_loop::signals),
        )
        .route(
            "/api/analytics/signals/ack",
            post(crate::analytics_loop::ack),
        )
        .route("/api/analytics/page", get(crate::analytics_loop::page))
        .route("/t/s.js", get(tracker::script))
        .route(
            "/t/e",
            post(tracker::collect)
                .options(tracker::preflight)
                .layer(DefaultBodyLimit::max(8 * 1024)),
        );
    if let Some(dir) = &st.cfg.static_dir {
        if dir.is_dir() {
            let index = dir.join("index.html");
            let files = ServeDir::new(dir).fallback(ServeFile::new(index));
            r = match st.cfg.coep.as_deref() {
                // The game page must be cross-origin isolated for Turso wasm's
                // shared-memory threads (ADR-0041).
                Some(coep) => r.fallback_service(
                    ServiceBuilder::new()
                        .layer(SetResponseHeaderLayer::overriding(
                            HeaderName::from_static("cross-origin-opener-policy"),
                            HeaderValue::from_static("same-origin"),
                        ))
                        .layer(SetResponseHeaderLayer::overriding(
                            HeaderName::from_static("cross-origin-embedder-policy"),
                            HeaderValue::from_str(coep).expect("validated in config"),
                        ))
                        .service(files),
                ),
                None => r.fallback_service(files),
            };
        } else {
            tracing::warn!(dir = %dir.display(), "static dir does not exist; not serving the game client");
        }
    }
    r.layer(TraceLayer::new_for_http()).with_state(st)
}

async fn healthz(State(st): State<AppState>) -> impl IntoResponse {
    match st.db.ping().await {
        Ok(()) => (StatusCode::OK, Json(serde_json::json!({ "status": "ok" }))),
        Err(e) => {
            tracing::error!(error = %e, "healthz: database unavailable");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(serde_json::json!({ "status": "db_unavailable" })),
            )
        }
    }
}

/// `GET /api/me` → `{user, company, default_binding}`. `default_binding` is
/// the repository and base branch the owner configured for new companies
/// (`SWARMPRESS_DEFAULT_SITE_REPO`, `SWARMPRESS_DEFAULT_BASE_BRANCH`): the
/// game passes it explicitly when it founds the company, and shows it next
/// to the company's own binding.
async fn me(
    State(st): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> AppResult<Json<serde_json::Value>> {
    let company = accounts::company_for_user(&st.db, &user.id).await?;
    Ok(Json(serde_json::json!({
        "user": user,
        "company": company,
        "default_binding": st.cfg.default_binding(&user.login),
    })))
}

/// Background tasks owned by a running server.
pub struct Background {
    pub tasks: Vec<JoinHandle<()>>,
}

impl Background {
    pub fn abort(&self) {
        for t in &self.tasks {
            t.abort();
        }
    }
}

/// Start the hourly maintenance (tracker rollup, nightly signals and
/// retention, expired-session cleanup) and, with a real GitHub, the deploy
/// poller ([`deploys::spawn`]; never with the fake or simulated deploys).
pub fn spawn_background(st: &AppState) -> Background {
    let mut tasks = vec![tracker::spawn_maintenance(st)];
    tasks.extend(deploys::spawn(st));
    // Hosted model calls a restart cut off (ADR-0067): at start, then hourly.
    let st3 = st.clone();
    let started = st.now_ms();
    tasks.push(tokio::spawn(async move {
        let mut tick = tokio::time::interval(std::time::Duration::from_secs(3600));
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            tick.tick().await;
            match llm::sweep_abandoned(&st3, started).await {
                Ok(n) if n > 0 => tracing::warn!(rows = n, "llm jobs abandoned"),
                Ok(_) => {}
                Err(e) => tracing::error!(error = ?e, "llm job sweep failed"),
            }
        }
    }));
    let st2 = st.clone();
    tasks.push(tokio::spawn(async move {
        let mut tick = tokio::time::interval(std::time::Duration::from_secs(3600));
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            tick.tick().await;
            match accounts::delete_expired_sessions(&st2.db, st2.now_ms()).await {
                Ok(n) if n > 0 => tracing::info!(deleted = n, "expired sessions removed"),
                Ok(_) => {}
                Err(e) => tracing::error!(error = ?e, "session cleanup failed"),
            }
        }
    }));
    Background { tasks }
}

/// Serve until `shutdown` resolves.
pub async fn serve(
    listener: TcpListener,
    st: AppState,
    shutdown: impl std::future::Future<Output = ()> + Send + 'static,
) -> Result<()> {
    let app = router(st);
    tracing::info!(addr = %listener.local_addr()?, "swarmpress server listening");
    // Connect info gives the tracker collector the peer IP (rate limiting and
    // the salted visitor hash; never stored).
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown)
    .await?;
    Ok(())
}
