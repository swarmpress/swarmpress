//! Application state, HTTP routes and server bootstrap.

use std::sync::Arc;

use anyhow::Result;
use axum::extract::DefaultBodyLimit;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use rand::RngCore;
use serde::Deserialize;
use sqlx::PgPool;
use tokio::net::TcpListener;
use tokio::task::JoinHandle;
use tower_http::services::{ServeDir, ServeFile};
use tower_http::trace::TraceLayer;

use crate::actor::{ActorSpawner, Registry};
use crate::auth::{self, CurrentUser};
use crate::config::Config;
use crate::db;
use crate::error::{AppError, AppResult};
use crate::jobs::{self, ArtifactValidator, ClaudeExecutor, JobNotifier, JobQueue};
use crate::plan::{self, PermissivePlanOpValidator, PlanHub, PlanOpValidator, PlanService};
use crate::store::PgStore;
use crate::tracker::{self, AnalyticsSignalSink, PendingSignalSink, Tracker};
use crate::ws;

#[derive(Clone)]
pub struct AppState {
    pub cfg: Arc<Config>,
    pub pool: PgPool,
    pub registry: Arc<Registry>,
    pub jobs: JobQueue,
    pub notifier: JobNotifier,
    pub validator: Arc<dyn ArtifactValidator>,
    pub http: reqwest::Client,
    /// Plan text store + `PlanPost` fan-out (publishing-plan.md §6).
    pub plan: PlanService,
    /// First-party analytics collector (ADR-0032).
    pub tracker: Arc<Tracker>,
    /// Where nightly analytics signals go (the company actor, eventually).
    pub signal_sink: Arc<dyn AnalyticsSignalSink>,
}

impl AppState {
    pub fn new(
        cfg: Config,
        pool: PgPool,
        spawner: Arc<dyn ActorSpawner>,
        notifier: JobNotifier,
        validator: Arc<dyn ArtifactValidator>,
    ) -> Self {
        let store = Arc::new(PgStore::new(pool.clone()));
        let registry = Arc::new(Registry::new(
            pool.clone(),
            store,
            spawner,
            cfg.actor.clone(),
        ));
        let jobs = JobQueue::new(pool.clone(), cfg.job_retry);
        let http = reqwest::Client::builder()
            .user_agent(concat!("simpress-server/", env!("CARGO_PKG_VERSION")))
            .timeout(std::time::Duration::from_secs(20))
            .build()
            .expect("http client");
        let plan = PlanService::new(
            pool.clone(),
            PlanHub::default(),
            Arc::new(PermissivePlanOpValidator),
            cfg.actor.step_period,
        );
        let tracker = Arc::new(Tracker::new(cfg.tracker.clone()));
        Self {
            cfg: Arc::new(cfg),
            pool,
            registry,
            jobs,
            notifier,
            validator,
            http,
            plan,
            tracker,
            signal_sink: Arc::new(PendingSignalSink),
        }
    }

    /// Replace the (permissive, loud) plan-op RBAC validator.
    pub fn with_plan_validator(mut self, v: Arc<dyn PlanOpValidator>) -> Self {
        self.plan = self.plan.with_validator(v);
        self
    }

    /// Replace the (pending-only) analytics signal sink.
    pub fn with_signal_sink(mut self, sink: Arc<dyn AnalyticsSignalSink>) -> Self {
        self.signal_sink = sink;
        self
    }
}

pub fn router(st: AppState) -> Router {
    let mut r = Router::new()
        .route("/healthz", get(healthz))
        .route("/auth/github/login", get(auth::login))
        .route("/auth/github/callback", get(auth::callback))
        .route("/auth/logout", post(auth::logout))
        .route("/api/me", get(me))
        .route("/api/companies", get(list_companies).post(create_company))
        .route(
            "/api/projects",
            get(tracker::list_projects).post(tracker::post_project),
        )
        .route("/api/analytics", get(tracker::get_analytics))
        .route("/t/s.js", get(tracker::script))
        .route(
            "/t/e",
            post(tracker::collect)
                .options(tracker::preflight)
                .layer(DefaultBodyLimit::max(8 * 1024)),
        )
        .merge(plan::routes())
        .route("/ws", get(ws::ws_handler));
    if let Some(dir) = &st.cfg.static_dir {
        if dir.is_dir() {
            let index = dir.join("index.html");
            r = r.fallback_service(ServeDir::new(dir).fallback(ServeFile::new(index)));
        } else {
            tracing::warn!(dir = %dir.display(), "static dir does not exist; not serving the game client");
        }
    }
    r.layer(TraceLayer::new_for_http()).with_state(st)
}

async fn healthz(State(st): State<AppState>) -> impl IntoResponse {
    match sqlx::query("SELECT 1").execute(&st.pool).await {
        Ok(_) => (StatusCode::OK, Json(serde_json::json!({ "status": "ok" }))),
        Err(e) => {
            tracing::error!(error = %e, "healthz: database unreachable");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(serde_json::json!({ "status": "db_unavailable" })),
            )
        }
    }
}

async fn me(
    State(st): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> AppResult<Json<serde_json::Value>> {
    let company = db::company_for_user(&st.pool, user.id).await?;
    Ok(Json(
        serde_json::json!({ "user": user, "company": company }),
    ))
}

async fn list_companies(
    State(st): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> AppResult<Json<Vec<db::Company>>> {
    Ok(Json(
        db::company_for_user(&st.pool, user.id)
            .await?
            .into_iter()
            .collect(),
    ))
}

#[derive(Deserialize)]
struct CreateCompany {
    name: String,
}

async fn create_company(
    State(st): State<AppState>,
    CurrentUser(user): CurrentUser,
    Json(body): Json<CreateCompany>,
) -> AppResult<(StatusCode, Json<db::Company>)> {
    let name = body.name.trim();
    if name.is_empty() || name.chars().count() > 80 {
        return Err(AppError::BadRequest("name must be 1-80 characters".into()));
    }
    let seed = rand::rngs::OsRng.next_u64();
    match db::create_company(
        &st.pool,
        user.id,
        name,
        seed,
        st.cfg.default_day_real_minutes,
    )
    .await?
    {
        Some(c) => {
            tracing::info!(company_id = %c.id, user_id = %user.id, "company created");
            Ok((StatusCode::CREATED, Json(c)))
        }
        None => Err(AppError::Conflict("you already own a company".into())),
    }
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

/// Start the job notifier, lease reaper, Claude pool and the hourly tracker
/// maintenance (rollup, nightly signals, retention) for `st`.
pub fn spawn_background(
    st: &AppState,
    claude: Arc<dyn ClaudeExecutor>,
    notifier_task: Option<JoinHandle<()>>,
) -> Background {
    let mut tasks: Vec<JoinHandle<()>> = notifier_task.into_iter().collect();
    tasks.push(jobs::spawn_reaper(
        st.jobs.clone(),
        st.cfg.job_reap_interval,
    ));
    tasks.push(jobs::spawn_claude_pool(
        st.jobs.clone(),
        claude,
        st.notifier.clone(),
        st.cfg.claude_concurrency,
        st.cfg.job_lease,
        std::time::Duration::from_secs(5),
    ));
    tasks.push(tracker::spawn_maintenance(st));
    Background { tasks }
}

/// Serve until `shutdown` resolves, then stop company actors cleanly.
pub async fn serve(
    listener: TcpListener,
    st: AppState,
    shutdown: impl std::future::Future<Output = ()> + Send + 'static,
) -> Result<()> {
    let registry = st.registry.clone();
    let app = router(st);
    tracing::info!(addr = %listener.local_addr()?, "simpress server listening");
    // Connect info gives the tracker collector the peer IP (rate limiting and
    // the salted visitor hash; never stored).
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown)
    .await?;
    registry.shutdown_all().await;
    Ok(())
}
