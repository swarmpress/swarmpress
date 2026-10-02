//! Companies and the executor lease (ADR-0038, ADR-0045).
//!
//! - `POST /api/companies {name, site_repo?, base_branch?}` → 201 company, or
//!   409 when the caller already owns one. Without `site_repo` the company is
//!   bound to `{GITHUB_SITES_ORG}/{login}-site`.
//! - `GET /api/companies/me` → the caller's company (404 without one).
//! - `POST /api/companies/{id}/lease {device_id, mode?, kind?}` →
//!   `{epoch, lease_id, token, holder, holder_kind, ttl_ms, renewed,
//!   handover_requested, handover_by, head}`. One executor holds a company at
//!   a time. `mode` (default `acquire`):
//!   - `renew` (with `x-swarmpress-lease`): extends the lease, epoch unchanged;
//!     409 once it was released or taken;
//!   - `acquire`: takes a free, expired or released lease, or the caller's
//!     own, at epoch + 1; another executor's unexpired lease answers 409
//!     (`{error, epoch, holder, holder_kind, ttl_ms, handover_requested}`);
//!   - `request`: like `acquire`, and a 409 also records a handover request
//!     that the holder sees on its next renew and as a `HandoverRequested`
//!     event;
//!   - `force`: takes over at epoch + 1; the old holder gets `LeaseRevoked`.
//!
//!   `kind` is `browser` (default) or `self`.
//! - `DELETE /api/companies/{id}/lease` with `x-swarmpress-lease` releases it.
//!
//! The fencing token is `x-swarmpress-lease: <epoch>.<lease_id>` (the reply's
//! `token`). A lease grant and every fenced write hold the company's mutex
//! ([`AppState::company_lock`]).

use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use rand::RngCore;
use serde::Deserialize;
use serde_json::json;

use crate::app::{require_company, AppState};
use crate::auth::CurrentUser;
use crate::db::{
    accounts, Company, ExecutorKind, Lease, LeaseMode, LeaseOutcome, LeaseRequest, User,
};
use crate::error::{AppError, AppResult};
use crate::events::{self, kinds};
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
#[serde(deny_unknown_fields)]
pub struct LeaseBody {
    /// The executor's id (a device id for browsers).
    pub device_id: String,
    #[serde(default)]
    pub mode: Option<LeaseMode>,
    #[serde(default)]
    pub kind: Option<ExecutorKind>,
}

fn valid_device_id(d: &str) -> bool {
    !d.is_empty()
        && d.len() <= 128
        && d.bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_' | b'.' | b':'))
}

fn lease_reply(lease: &Lease, now_ms: i64, renewed: bool) -> serde_json::Value {
    json!({
        "epoch": lease.epoch,
        "lease_id": lease.lease_id,
        "token": lease.token(),
        "holder": lease.holder_id,
        "holder_kind": lease.holder_kind,
        "ttl_ms": lease.expires_at.saturating_sub(now_ms).max(0),
        "renewed": renewed,
        "handover_requested": lease.handover_by.is_some(),
        "handover_by": lease.handover_by,
        "head": lease.head,
    })
}

pub async fn lease(
    State(st): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(body): Json<LeaseBody>,
) -> AppResult<Response> {
    let c = owned_company(&st, &user, &id).await?;
    if !valid_device_id(&body.device_id) {
        return Err(AppError::BadRequest(
            "device_id must be 1-128 of [A-Za-z0-9-_.:]".into(),
        ));
    }
    let mode = body.mode.unwrap_or(LeaseMode::Acquire);
    let kind = body.kind.unwrap_or(ExecutorKind::Browser);
    if kind == ExecutorKind::Cloud {
        // Managed runs get their lease from the coordinator (ADR-0048), not
        // from a player session.
        return Err(AppError::BadRequest(
            "kind must be `browser` or `self`".into(),
        ));
    }
    let presented = match mode {
        LeaseMode::Renew => Some(lease_token(&headers)?),
        _ => None,
    };
    let ttl_ms = i64::try_from(st.cfg.lease_ttl.as_millis()).unwrap_or(i64::MAX / 4);
    // A grant changes the holder: wait for any fenced write in flight to be
    // recorded first. A renew changes nothing a fenced write depends on.
    let _guard = match mode {
        LeaseMode::Renew => None,
        _ => Some(st.company_lock(&c.id).await),
    };
    let now_ms = st.now_ms();
    let outcome = accounts::lease_op(
        &st.db,
        &c.id,
        LeaseRequest {
            mode,
            holder_id: &body.device_id,
            kind,
            presented,
            now_ms,
            ttl_ms,
        },
    )
    .await?;
    match outcome {
        LeaseOutcome::Granted {
            lease,
            renewed,
            revoked,
        } => {
            if !renewed {
                tracing::info!(company_id = %c.id, holder = %lease.holder_id, kind = %lease.holder_kind,
                    epoch = lease.epoch, ?mode, "lease taken");
            }
            if let Some(old) = revoked {
                events::publish(
                    &st,
                    &c.id,
                    kinds::LEASE_REVOKED,
                    json!({
                        "epoch": old.epoch,
                        "holder": old.holder_id,
                        "new_epoch": lease.epoch,
                        "by": lease.holder_id,
                    }),
                )
                .await?;
            }
            Ok(Json(lease_reply(&lease, now_ms, renewed)).into_response())
        }
        LeaseOutcome::Held {
            holder,
            handover_requested,
        } => {
            if handover_requested {
                events::publish(
                    &st,
                    &c.id,
                    kinds::HANDOVER_REQUESTED,
                    json!({
                        "epoch": holder.epoch,
                        "holder": holder.holder_id,
                        "by": body.device_id,
                    }),
                )
                .await?;
            }
            Ok((
                StatusCode::CONFLICT,
                Json(json!({
                    "error": "another executor holds this company",
                    "epoch": holder.epoch,
                    "holder": holder.holder_id,
                    "holder_kind": holder.holder_kind,
                    "ttl_ms": holder.expires_at.saturating_sub(now_ms).max(0),
                    "handover_requested": handover_requested,
                })),
            )
                .into_response())
        }
        LeaseOutcome::NotHeld => Err(AppError::Conflict(
            "company lease not held (released or taken by another executor)".into(),
        )),
    }
}

pub async fn release(
    State(st): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> AppResult<StatusCode> {
    let c = owned_company(&st, &user, &id).await?;
    let (epoch, lease_id) = lease_token(&headers)?;
    let _guard = st.company_lock(&c.id).await;
    if accounts::release_lease(&st.db, &c.id, epoch, lease_id).await? {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(AppError::Conflict("lease not held".into()))
    }
}

/// The fencing token of the request: 428 without the header, 409 when it is
/// not of the form `<epoch>.<lease_id>` (so it cannot be a current lease).
fn lease_token(headers: &HeaderMap) -> AppResult<(i64, &str)> {
    let raw = headers
        .get(LEASE_HEADER)
        .and_then(|v| v.to_str().ok())
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .ok_or_else(|| AppError::PreconditionRequired(format!("{LEASE_HEADER} header required")))?;
    accounts::parse_lease_token(raw).ok_or_else(|| AppError::Conflict(NOT_HELD.into()))
}

const NOT_HELD: &str = "company lease not held (expired, released or taken by another executor)";

/// A fenced write: the caller's company and its lock, provided the request
/// carries the company's current, unexpired `<epoch>.<lease_id>`. 428 without
/// the header, 409 when the lease is stale.
///
/// Keep the guard until the side effect and its bookkeeping are done: a
/// takeover waits for it (ADR-0045 decision 5).
pub struct Fenced {
    pub company: Company,
    pub lease: Lease,
    _guard: tokio::sync::OwnedMutexGuard<()>,
}

pub async fn require_lease(st: &AppState, headers: &HeaderMap, user: &User) -> AppResult<Fenced> {
    let (epoch, lease_id) = lease_token(headers)?;
    let company = require_company(st, &user.id).await?;
    let guard = st.company_lock(&company.id).await;
    match accounts::fenced_lease(&st.db, &company.id, epoch, lease_id, st.now_ms()).await? {
        Some(lease) => Ok(Fenced {
            company,
            lease,
            _guard: guard,
        }),
        None => Err(AppError::Conflict(NOT_HELD.into())),
    }
}
