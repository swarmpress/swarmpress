//! Companies and the device lease (ADR-0038).
//!
//! - `POST /api/companies {name, site_repo?, base_branch?}` → 201 company, or
//!   409 when the caller already owns one. Without `site_repo` the company is
//!   bound to `{GITHUB_SITES_ORG}/{login}-site`.
//! - `GET /api/companies/me` → the caller's company (404 without one).
//! - `POST /api/companies/{id}/lease {device_id, force?}` →
//!   `{lease_id, holder, expires_at}`. One device holds a company at a
//!   time; the holder renews by posting again (same `lease_id`). Another
//!   device's unexpired lease answers 409 (`{error, holder, expires_at}`)
//!   unless `force: true`, which takes it over with a new `lease_id`.
//! - `DELETE /api/companies/{id}/lease` with `x-swarmpress-lease` releases it.

use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use rand::RngCore;
use serde::Deserialize;
use serde_json::json;

use crate::app::{require_company, AppState};
use crate::auth::CurrentUser;
use crate::db::{accounts, Company, LeaseOutcome, User};
use crate::error::{AppError, AppResult};
use crate::gateway::parse_repo;

pub const LEASE_HEADER: &str = "x-swarmpress-lease";

#[derive(Deserialize)]
pub struct CreateCompany {
    pub name: String,
    #[serde(default)]
    pub site_repo: Option<String>,
    #[serde(default)]
    pub base_branch: Option<String>,
}

pub async fn create(
    State(st): State<AppState>,
    CurrentUser(user): CurrentUser,
    Json(body): Json<CreateCompany>,
) -> AppResult<(StatusCode, Json<Company>)> {
    let name = body.name.trim();
    if name.is_empty() || name.chars().count() > 80 {
        return Err(AppError::BadRequest("name must be 1-80 characters".into()));
    }
    let site_repo = match body.site_repo.as_deref().map(str::trim) {
        Some(r) if !r.is_empty() => r.to_string(),
        _ => format!(
            "{}/{}-site",
            st.cfg.sites_org,
            user.login.to_ascii_lowercase()
        ),
    };
    let repo = parse_repo(&site_repo)
        .ok_or_else(|| AppError::BadRequest("site_repo must be `owner/name`".into()))?;
    let base = body.base_branch.as_deref().unwrap_or("main").trim();
    github::policy::validate_branch_name(base)
        .map_err(|_| AppError::BadRequest("base_branch is not a valid branch name".into()))?;
    let seed = rand::rngs::OsRng.next_u64();
    match accounts::create_company(
        &st.db,
        &user.id,
        name,
        seed,
        &repo.to_string(),
        base,
        st.now_ms(),
    )
    .await?
    {
        Some(c) => {
            tracing::info!(company_id = %c.id, user_id = %user.id, repo = %c.site_repo, "company created");
            Ok((StatusCode::CREATED, Json(c)))
        }
        None => Err(AppError::Conflict("you already own a company".into())),
    }
}

pub async fn me(
    State(st): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> AppResult<Json<Company>> {
    Ok(Json(require_company(&st, &user.id).await?))
}

/// The caller's company when it is `id`: 404 if no such company, 403 if it
/// belongs to someone else.
pub async fn owned_company(st: &AppState, user: &User, id: &str) -> AppResult<Company> {
    let c = accounts::company_by_id(&st.db, id)
        .await?
        .ok_or_else(|| AppError::NotFound("no such company".into()))?;
    if c.owner_user_id != user.id {
        return Err(AppError::Forbidden("not your company".into()));
    }
    Ok(c)
}

#[derive(Deserialize)]
pub struct LeaseBody {
    pub device_id: String,
    #[serde(default)]
    pub force: bool,
}

fn valid_device_id(d: &str) -> bool {
    !d.is_empty()
        && d.len() <= 128
        && d.bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_' | b'.' | b':'))
}

pub async fn lease(
    State(st): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
    Json(body): Json<LeaseBody>,
) -> AppResult<Response> {
    let c = owned_company(&st, &user, &id).await?;
    if !valid_device_id(&body.device_id) {
        return Err(AppError::BadRequest(
            "device_id must be 1-128 of [A-Za-z0-9-_.:]".into(),
        ));
    }
    let ttl_ms = i64::try_from(st.cfg.lease_ttl.as_millis()).unwrap_or(i64::MAX / 4);
    match accounts::acquire_lease(
        &st.db,
        &c.id,
        &body.device_id,
        body.force,
        st.now_ms(),
        ttl_ms,
    )
    .await?
    {
        LeaseOutcome::Granted { lease, renewed } => {
            if !renewed {
                tracing::info!(company_id = %c.id, device = %lease.device_id, force = body.force, "lease taken");
            }
            Ok(Json(json!({
                "lease_id": lease.lease_id,
                "holder": lease.device_id,
                "expires_at": lease.expires_at,
                "renewed": renewed,
            }))
            .into_response())
        }
        LeaseOutcome::Held(other) => Ok((
            StatusCode::CONFLICT,
            Json(json!({
                "error": "another device holds this company",
                "holder": other.device_id,
                "expires_at": other.expires_at,
            })),
        )
            .into_response()),
    }
}

pub async fn release(
    State(st): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> AppResult<StatusCode> {
    let c = owned_company(&st, &user, &id).await?;
    let lease_id = lease_header(&headers)?;
    if accounts::release_lease(&st.db, &c.id, lease_id).await? {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(AppError::Conflict("lease not held".into()))
    }
}

fn lease_header(headers: &HeaderMap) -> AppResult<&str> {
    headers
        .get(LEASE_HEADER)
        .and_then(|v| v.to_str().ok())
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .ok_or_else(|| AppError::PreconditionRequired(format!("{LEASE_HEADER} header required")))
}

/// The caller's company, provided the request carries its current,
/// unexpired lease: 428 without the header, 409 when the lease is not held.
pub async fn require_lease(st: &AppState, headers: &HeaderMap, user: &User) -> AppResult<Company> {
    let lease_id = lease_header(headers)?;
    let c = require_company(st, &user.id).await?;
    match accounts::active_lease(&st.db, &c.id, st.now_ms()).await? {
        Some(l) if l.lease_id == lease_id => Ok(c),
        _ => Err(AppError::Conflict(
            "company lease not held (expired or taken by another device)".into(),
        )),
    }
}
