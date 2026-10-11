//! Asset bytes (ADR-0050, plan M3): media a company's WordPress uploads, stored by their SHA-256 in
//! object storage. The governed content repository holds each asset's sidecar (path, digest,
//! type, size); the bytes are here, once per company and digest.
//!
//! - `PUT /api/assets/{sha256}` with the company lease: the body's digest must be `{sha256}`
//!   (400 otherwise); `Content-Type` is kept. 201 when new, 200 when the company had it.
//! - `GET /api/assets/{sha256}`: the company's own bytes, with their type (404 otherwise).
//!
//! Keys are `c/{company}/sha256/{hash}` ([`ObjectStore`]); the filesystem store keeps them under
//! `{data_dir}/objects/`. An object store with an S3 or R2 API is the next implementation.

use std::path::PathBuf;

use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use sha2::{Digest, Sha256};

use crate::app::{require_company, AppState};
use crate::auth::CurrentUser;
use crate::companies::require_lease;
use crate::db::assets::{self, AssetRow};
use crate::error::{AppError, AppResult};

/// The largest asset accepted (bytes).
pub const MAX_ASSET_BYTES: usize = 32 * 1024 * 1024;

/// Where asset bytes live: write-once objects by key.
pub trait ObjectStore: Send + Sync {
    fn put(&self, key: &str, bytes: &[u8]) -> anyhow::Result<()>;
    fn get(&self, key: &str) -> anyhow::Result<Option<Vec<u8>>>;
}

/// Objects as files under a directory.
pub struct FsObjectStore {
    root: PathBuf,
}

impl FsObjectStore {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }

    fn path(&self, key: &str) -> anyhow::Result<PathBuf> {
        if key
            .split('/')
            .any(|p| p.is_empty() || p == "." || p == "..")
        {
            anyhow::bail!("bad object key {key:?}");
        }
        Ok(self.root.join(key))
    }
}

impl ObjectStore for FsObjectStore {
    fn put(&self, key: &str, bytes: &[u8]) -> anyhow::Result<()> {
        let path = self.path(key)?;
        if path.exists() {
            return Ok(());
        }
        std::fs::create_dir_all(path.parent().expect("a key has a parent"))?;
        // Write then rename: a reader never sees half an object.
        let tmp = path.with_extension("partial");
        std::fs::write(&tmp, bytes)?;
        std::fs::rename(tmp, path)?;
        Ok(())
    }

    fn get(&self, key: &str) -> anyhow::Result<Option<Vec<u8>>> {
        match std::fs::read(self.path(key)?) {
            Ok(b) => Ok(Some(b)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e.into()),
        }
    }
}

pub fn object_key(company: &str, sha256: &str) -> String {
    format!("c/{company}/sha256/{sha256}")
}

fn check_digest(sha256: &str) -> AppResult<()> {
    if sha256.len() == 64
        && sha256
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
    {
        Ok(())
    } else {
        Err(AppError::BadRequest(
            "the asset id must be a lowercase hex SHA-256".into(),
        ))
    }
}

pub async fn put_asset(
    State(st): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(sha256): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> AppResult<StatusCode> {
    check_digest(&sha256)?;
    let fenced = require_lease(&st, &headers, &user).await?;
    if body.len() > MAX_ASSET_BYTES {
        return Err(AppError::PayloadTooLarge(format!(
            "an asset is at most {MAX_ASSET_BYTES} bytes"
        )));
    }
    let got = hex::encode(Sha256::digest(&body));
    if got != sha256 {
        return Err(AppError::BadRequest(format!(
            "the body's SHA-256 is {got}, not {sha256}"
        )));
    }
    let content_type = headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_string();
    let company = fenced.company.id.clone();
    let size = i64::try_from(body.len()).unwrap_or(i64::MAX);
    let store = st.objects.clone();
    let key = object_key(&company, &sha256);
    tokio::task::spawn_blocking(move || store.put(&key, &body))
        .await
        .map_err(|e| AppError::Internal(e.into()))??;
    let new = assets::insert_asset(
        &st.db,
        &company,
        &AssetRow {
            sha256,
            content_type,
            size,
        },
        st.now_ms(),
    )
    .await?;
    Ok(if new {
        StatusCode::CREATED
    } else {
        StatusCode::OK
    })
}

pub async fn get_asset(
    State(st): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(sha256): Path<String>,
) -> AppResult<Response> {
    check_digest(&sha256)?;
    let company = require_company(&st, &user.id).await?;
    let row = assets::asset(&st.db, &company.id, &sha256)
        .await?
        .ok_or_else(|| AppError::NotFound("no such asset".into()))?;
    let store = st.objects.clone();
    let key = object_key(&company.id, &sha256);
    let bytes = tokio::task::spawn_blocking(move || store.get(&key))
        .await
        .map_err(|e| AppError::Internal(e.into()))??
        .ok_or_else(|| AppError::NotFound("the asset's bytes are missing".into()))?;
    Ok((
        [
            (header::CONTENT_TYPE, row.content_type),
            (
                header::CACHE_CONTROL,
                "private, max-age=31536000, immutable".to_string(),
            ),
        ],
        bytes,
    )
        .into_response())
}
