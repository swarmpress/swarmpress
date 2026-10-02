//! Sync and backup (ADR-0038/0041): the company's append-only command-log
//! segments and its latest snapshot, so a new device or a cleared browser
//! can restore the company. Only the company owner may read or write.
//!
//! - `PUT /api/sync/{company}/log/{segment}` (raw bytes): 201 when stored,
//!   200 when the identical bytes are already there, 409 when the segment
//!   exists with different bytes (segments are immutable).
//! - `GET /api/sync/{company}/log/{segment}` → the bytes
//!   (`x-swarmpress-sha256`), `GET /api/sync/{company}/log` →
//!   `{segments: [{segment, sha256, size, created_at}]}`.
//! - `PUT /api/sync/{company}/snapshot` (raw bytes, `x-swarmpress-step`
//!   required) replaces the latest snapshot; `GET` returns it with
//!   `x-swarmpress-step` and `x-swarmpress-sha256`.
//!
//! Bytes are files under `{SWARMPRESS_DATA_DIR}/sync/{company}/`, written to a
//! temp file and renamed into place; SQLite holds the index rows.

use std::path::{Path as FsPath, PathBuf};

use anyhow::Context;
use axum::body::{Body, Bytes};
use axum::extract::{Path, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::app::AppState;
use crate::auth::CurrentUser;
use crate::companies::owned_company;
use crate::db::{new_id, sync as store};
use crate::error::{AppError, AppResult};

pub const STEP_HEADER: &str = "x-swarmpress-step";
pub const SHA_HEADER: &str = "x-swarmpress-sha256";

fn company_dir(st: &AppState, company: &str) -> PathBuf {
    st.cfg.data_dir.join("sync").join(company)
}

fn segment_path(st: &AppState, company: &str, segment: i64) -> PathBuf {
    company_dir(st, company)
        .join("log")
        .join(format!("{segment:020}.bin"))
}

fn snapshot_path(st: &AppState, company: &str) -> PathBuf {
    company_dir(st, company).join("snapshot.bin")
}

fn sha256_hex(b: &[u8]) -> String {
    hex::encode(Sha256::digest(b))
}

/// Write `bytes` to a unique temp file next to `dest`; returns its path.
async fn write_temp(dest: &FsPath, bytes: &[u8]) -> anyhow::Result<PathBuf> {
    let dir = dest.parent().context("blob path has a parent")?;
    tokio::fs::create_dir_all(dir)
        .await
        .with_context(|| format!("create {}", dir.display()))?;
    let tmp = dir.join(format!(".tmp-{}", new_id()));
    tokio::fs::write(&tmp, bytes)
        .await
        .with_context(|| format!("write {}", tmp.display()))?;
    Ok(tmp)
}

fn segment_index(segment: u64) -> AppResult<i64> {
    i64::try_from(segment).map_err(|_| AppError::BadRequest("segment out of range".into()))
}

fn blob_response(bytes: Vec<u8>, extra: &[(&'static str, String)]) -> Response {
    let mut res = Response::new(Body::from(bytes));
    let h = res.headers_mut();
    h.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/octet-stream"),
    );
    h.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    for (k, v) in extra {
        if let Ok(v) = HeaderValue::from_str(v) {
            h.insert(*k, v);
        }
    }
    res
}

async fn read_blob(path: &FsPath) -> AppResult<Vec<u8>> {
    tokio::fs::read(path)
        .await
        .with_context(|| format!("read {}", path.display()))
        .map_err(AppError::Internal)
}

/// `PUT /api/sync/{company}/log/{segment}`
pub async fn put_segment(
    State(st): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path((company, segment)): Path<(String, u64)>,
    body: Bytes,
) -> AppResult<(StatusCode, Json<Value>)> {
    let c = owned_company(&st, &user, &company).await?;
    let seg = segment_index(segment)?;
    let sha = sha256_hex(&body);
    let size = i64::try_from(body.len()).unwrap_or(i64::MAX);
    let dest = segment_path(&st, &c.id, seg);
    let _guard = st.sync_lock.lock().await;
    let tmp = write_temp(&dest, &body).await?;
    let existing = match store::insert_segment(&st.db, &c.id, seg, &sha, size, st.now_ms()).await {
        Ok(e) => e,
        Err(e) => {
            let _ = tokio::fs::remove_file(&tmp).await;
            return Err(e.into());
        }
    };
    let reply = json!({ "segment": segment, "sha256": sha, "size": size });
    match existing {
        None => {
            if let Err(e) = tokio::fs::rename(&tmp, &dest).await {
                let _ = tokio::fs::remove_file(&tmp).await;
                store::delete_segment(&st.db, &c.id, seg).await?;
                return Err(AppError::Internal(
                    anyhow::anyhow!(e).context("store segment"),
                ));
            }
            tracing::debug!(company_id = %c.id, segment, size, "sync segment stored");
            Ok((StatusCode::CREATED, Json(reply)))
        }
        Some(row) => {
            let _ = tokio::fs::remove_file(&tmp).await;
            if row.sha256 == sha {
                Ok((StatusCode::OK, Json(reply)))
            } else {
                Err(AppError::Conflict(format!(
                    "segment {segment} already exists with different content (segments are immutable)"
                )))
            }
        }
    }
}

/// `GET /api/sync/{company}/log/{segment}`
pub async fn get_segment(
    State(st): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path((company, segment)): Path<(String, u64)>,
) -> AppResult<Response> {
    let c = owned_company(&st, &user, &company).await?;
    let seg = segment_index(segment)?;
    let row = store::get_segment(&st.db, &c.id, seg)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("no segment {segment}")))?;
    let bytes = read_blob(&segment_path(&st, &c.id, seg)).await?;
    Ok(blob_response(bytes, &[(SHA_HEADER, row.sha256)]))
}

/// `GET /api/sync/{company}/log`
pub async fn list_segments(
    State(st): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(company): Path<String>,
) -> AppResult<Json<Value>> {
    let c = owned_company(&st, &user, &company).await?;
    let segments = store::list_segments(&st.db, &c.id).await?;
    Ok(Json(json!({ "segments": segments })))
}

/// `PUT /api/sync/{company}/snapshot` (`x-swarmpress-step` required)
pub async fn put_snapshot(
    State(st): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(company): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> AppResult<Json<Value>> {
    let c = owned_company(&st, &user, &company).await?;
    let step: u64 = headers
        .get(STEP_HEADER)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.trim().parse().ok())
        .ok_or_else(|| AppError::BadRequest(format!("{STEP_HEADER} header (u64) required")))?;
    let step_i =
        i64::try_from(step).map_err(|_| AppError::BadRequest("step out of range".into()))?;
    let sha = sha256_hex(&body);
    let size = i64::try_from(body.len()).unwrap_or(i64::MAX);
    let dest = snapshot_path(&st, &c.id);
    let _guard = st.sync_lock.lock().await;
    let tmp = write_temp(&dest, &body).await?;
    if let Err(e) = tokio::fs::rename(&tmp, &dest).await {
        let _ = tokio::fs::remove_file(&tmp).await;
        return Err(AppError::Internal(
            anyhow::anyhow!(e).context("store snapshot"),
        ));
    }
    store::upsert_snapshot(&st.db, &c.id, step_i, &sha, size, st.now_ms()).await?;
    tracing::debug!(company_id = %c.id, step, size, "sync snapshot stored");
    Ok(Json(json!({ "step": step, "sha256": sha, "size": size })))
}

/// `GET /api/sync/{company}/snapshot`
pub async fn get_snapshot(
    State(st): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(company): Path<String>,
) -> AppResult<Response> {
    let c = owned_company(&st, &user, &company).await?;
    let row = store::get_snapshot(&st.db, &c.id)
        .await?
        .ok_or_else(|| AppError::NotFound("no snapshot yet".into()))?;
    let bytes = read_blob(&snapshot_path(&st, &c.id)).await?;
    Ok(blob_response(
        bytes,
        &[
            (STEP_HEADER, row.step.to_string()),
            (SHA_HEADER, row.sha256),
        ],
    )
    .into_response())
}
