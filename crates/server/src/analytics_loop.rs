//! The analytics loop's server half (ADR-0071 decisions 1 and 2).
//!
//! - `GET /api/analytics/signals` (lease): the company's pending
//!   `AnalyticsSignal` rows, oldest first, each as the sim's
//!   `AnalyticsSignals` takes it (the sim project id; the top-pages digest as
//!   decimal text, a u64 a JS number cannot hold), plus the tracker project
//!   and the day that `ack` names.
//! - `POST /api/analytics/signals/ack` (lease) `{rows: [{project_key, day}]}`:
//!   the rows the host logged are applied; rows of other companies are
//!   ignored. Idempotent.
//! - `GET /api/analytics/page?path=/en/blog/x&from=YYYY-MM-DD[&project=…]`
//!   (lease): one page's page views, sessions, average engaged time and
//!   75%-scroll count since `from`, and the median page views of the
//!   project's pages over the same days (the yardstick of a follow-up).

use axum::extract::{Query, State};
use axum::http::HeaderMap;
use axum::Json;
use chrono::NaiveDate;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::app::AppState;
use crate::auth::CurrentUser;
use crate::companies::require_lease;
use crate::db::tracker as store;
use crate::error::{AppError, AppResult};

/// `GET /api/analytics/signals` (module docs).
pub async fn signals(
    State(st): State<AppState>,
    CurrentUser(user): CurrentUser,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let fenced = require_lease(&st, &headers, &user).await?;
    let rows: Vec<Value> = store::pending_signals(&st.db)
        .await?
        .into_iter()
        .filter(|r| r.company_id == fenced.company.id)
        .map(|r| {
            json!({
                "project_key": r.project_id,
                "day": r.day,
                "project": r.sim_project_id,
                "sessions": r.sessions,
                "visitors": r.visitors,
                "pageviews": r.pageviews,
                "engagement_pm": r.engagement_pm.clamp(0, 1000),
                "top_pages_digest": (r.top_pages_digest as u64).to_string(),
            })
        })
        .collect();
    Ok(Json(json!({ "signals": rows })))
}

#[derive(Deserialize)]
pub struct AckRow {
    pub project_key: String,
    pub day: NaiveDate,
}

#[derive(Deserialize)]
pub struct AckBody {
    pub rows: Vec<AckRow>,
}

/// `POST /api/analytics/signals/ack` (module docs).
pub async fn ack(
    State(st): State<AppState>,
    CurrentUser(user): CurrentUser,
    headers: HeaderMap,
    Json(body): Json<AckBody>,
) -> AppResult<Json<Value>> {
    let fenced = require_lease(&st, &headers, &user).await?;
    if body.rows.len() > 400 {
        return Err(AppError::BadRequest("at most 400 rows per ack".into()));
    }
    let mine: Vec<String> = store::list_projects(&st.db, &fenced.company.id)
        .await?
        .into_iter()
        .map(|p| p.id)
        .collect();
    let mut applied = 0usize;
    for r in &body.rows {
        if mine.contains(&r.project_key) {
            store::mark_signal_applied(&st.db, &r.project_key, r.day, st.now_ms()).await?;
            applied += 1;
        }
    }
    Ok(Json(json!({ "applied": applied })))
}

#[derive(Deserialize)]
pub struct PageQuery {
    pub path: String,
    pub from: NaiveDate,
    /// The tracker project (id, slug or the sim's project id); the company's
    /// first project when absent.
    #[serde(default)]
    pub project: Option<String>,
}

/// `GET /api/analytics/page` (module docs).
pub async fn page(
    State(st): State<AppState>,
    CurrentUser(user): CurrentUser,
    headers: HeaderMap,
    Query(q): Query<PageQuery>,
) -> AppResult<Json<Value>> {
    let fenced = require_lease(&st, &headers, &user).await?;
    let projects = store::list_projects(&st.db, &fenced.company.id).await?;
    let project = match q.project.as_deref() {
        Some(key) => projects
            .iter()
            .find(|p| p.id == key || p.slug == key || p.sim_project_id == key),
        None => projects.first(),
    }
    .ok_or_else(|| AppError::NotFound("no tracker project for this company".into()))?;
    let path = q.path.trim();
    if !path.starts_with('/') || path.len() > 500 {
        return Err(AppError::BadRequest(
            "path must be a site path like /en/blog/x".into(),
        ));
    }
    let s = store::page_stats(&st.db, &project.id, path, q.from).await?;
    let mut per_page = store::per_path_pageviews(&st.db, &project.id, q.from).await?;
    per_page.sort_unstable();
    let median = if per_page.is_empty() {
        0
    } else {
        per_page[per_page.len() / 2]
    };
    Ok(Json(json!({
        "project": project.sim_project_id,
        "path": path,
        "from": q.from,
        "pageviews": s.pageviews,
        "sessions": s.sessions,
        "avg_engaged_ms": s.avg_engaged_ms,
        "scroll_75": s.scroll_75,
        "days": s.days,
        "median_pageviews": median,
        "pages": per_page.len(),
    })))
}
