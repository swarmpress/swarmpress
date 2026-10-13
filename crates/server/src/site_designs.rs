//! A site's designs (ADR-0093, FEAT-114): the design bundles a site was sent,
//! kept as write-once versions, and their interpretation.
//!
//! A site is its company today (one site per company), so `{id}` is the
//! company id; the caller must own it.
//!
//! - `POST /api/sites/{id}/designs` with the company lease: JSON
//!   `{files: [{path, base64}], source?}` (`source` is a
//!   [`DesignSource`]: `{"kind": "upload"}` by default). A single Claude
//!   Design standalone export (one `.html` carrying `__bundler/manifest`) is
//!   unpacked into its pages and assets. Allowed files: html, css, svg, png,
//!   jpg, webp, woff2, json; never scripts. At most 20 MB decoded (413), 512
//!   files; a bundle that breaks the rules is 422 with the issues. Each file's
//!   bytes go to the object store like an asset ([`crate::assets`]); the
//!   manifest is a row. Answers `{version, hash, files, bytes}`: 201 for a new
//!   version, 200 when the site already has this bundle (its version).
//! - `GET /api/sites/{id}/designs`: `{designs: [{version, hash, source,
//!   created_at, files, bytes}]}`, oldest first.
//! - `GET /api/sites/{id}/designs/{version}`: `{version, manifest, design}`,
//!   the design interpreted ([`site_design::SiteDesign`]).
//! - `GET /api/sites/{id}/designs/{version}/files/{*path}`: one file, with its
//!   type, under a sandboxing CSP (no scripts run, no origin is shared).

use std::collections::BTreeMap;
use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use base64::Engine as _;
use serde::Deserialize;
use serde_json::{json, Value};
use site_design::{BundleManifest, DesignBundle, DesignSource, MAX_BUNDLE_BYTES, MAX_FILES};

use crate::app::AppState;
use crate::assets::{object_key, ObjectStore};
use crate::auth::CurrentUser;
use crate::companies::{owned_company, require_lease};
use crate::db::assets::{self, AssetRow};
use crate::db::designs;
use crate::error::{AppError, AppResult};

/// The request body limit: 20 MB as base64 plus the envelope.
pub const MAX_BODY_BYTES: usize = MAX_BUNDLE_BYTES / 3 * 4 + 1024 * 1024;

/// The CSP a design's files are served under: an opaque origin, no scripts.
pub const FILE_CSP: &str = "sandbox; default-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'";

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UploadFile {
    pub path: String,
    pub base64: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Upload {
    pub files: Vec<UploadFile>,
    #[serde(default)]
    pub source: Option<DesignSource>,
}

fn source_kind(s: &DesignSource) -> &'static str {
    match s {
        DesignSource::Upload => "upload",
        DesignSource::Connector { .. } => "connector",
        DesignSource::ClaudeDesign { .. } => "claude-design",
    }
}

fn manifest_of(row: &designs::DesignRow) -> AppResult<BundleManifest> {
    serde_json::from_str(&row.manifest_json).map_err(|e| AppError::Internal(e.into()))
}

fn summary(row: &designs::DesignRow, m: &BundleManifest) -> Value {
    json!({
        "version": row.version,
        "hash": row.hash,
        "source": m.source,
        "created_at": row.created_at,
        "files": m.files.len(),
        "bytes": m.files.iter().map(|f| f.size).sum::<u64>(),
    })
}

/// `POST /api/sites/{id}/designs` (module docs).
pub async fn post_design(
    State(st): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(body): Json<Upload>,
) -> AppResult<Response> {
    let fenced = require_lease(&st, &headers, &user).await?;
    if fenced.company.id != id {
        return Err(AppError::Forbidden("not your site".into()));
    }
    if body.files.len() > MAX_FILES {
        return Err(AppError::PayloadTooLarge(format!(
            "a design has at most {MAX_FILES} files"
        )));
    }
    let mut files = BTreeMap::new();
    let mut total = 0usize;
    for f in body.files {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(f.base64.trim())
            .map_err(|_| AppError::BadRequest(format!("{}: not base64", f.path)))?;
        total += bytes.len();
        if total > MAX_BUNDLE_BYTES {
            return Err(AppError::PayloadTooLarge(format!(
                "a design is at most {MAX_BUNDLE_BYTES} bytes"
            )));
        }
        if files.insert(f.path.clone(), bytes).is_some() {
            return Err(AppError::BadRequest(format!("{}: sent twice", f.path)));
        }
    }
    let source = body.source.unwrap_or(DesignSource::Upload);
    let now = st.now_ms();
    let bundle = tokio::task::spawn_blocking(move || DesignBundle::from_upload(files, source, now))
        .await
        .map_err(|e| AppError::Internal(e.into()))?
        .map_err(|issues| AppError::Unprocessable {
            message: "the design's files break the bundle rules".into(),
            issues: issues
                .into_iter()
                .map(|i| match i.path {
                    Some(p) => format!("{p}: {}", i.message),
                    None => i.message,
                })
                .collect(),
        })?;
    let manifest = bundle.manifest();
    // The bytes first, then the rows: a version never names a missing file.
    let company = fenced.company.id.clone();
    let store: Arc<dyn ObjectStore> = st.objects.clone();
    let entries = manifest.files.clone();
    let bundle = Arc::new(bundle);
    let b2 = bundle.clone();
    let c2 = company.clone();
    tokio::task::spawn_blocking(move || -> anyhow::Result<()> {
        for f in &entries {
            let bytes = b2.bytes(&f.path).expect("a manifest file is in its bundle");
            store.put(&object_key(&c2, &f.sha256), bytes)?;
        }
        Ok(())
    })
    .await
    .map_err(|e| AppError::Internal(e.into()))??;
    for f in &manifest.files {
        assets::insert_asset(
            &st.db,
            &company,
            &AssetRow {
                sha256: f.sha256.clone(),
                content_type: f.content_type.clone(),
                size: i64::try_from(f.size).unwrap_or(i64::MAX),
            },
            now,
        )
        .await?;
    }
    let manifest_json =
        serde_json::to_string(&manifest).map_err(|e| AppError::Internal(e.into()))?;
    let (version, new) = designs::insert_design(
        &st.db,
        &company,
        &manifest.hash,
        source_kind(&manifest.source),
        manifest.created_at,
        &manifest_json,
    )
    .await?;
    let body = json!({
        "version": version,
        "hash": manifest.hash,
        "files": manifest.files.len(),
        "bytes": bundle.total_bytes(),
    });
    let status = if new {
        StatusCode::CREATED
    } else {
        StatusCode::OK
    };
    Ok((status, Json(body)).into_response())
}

/// `GET /api/sites/{id}/designs`.
pub async fn list_designs(
    State(st): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    let c = owned_company(&st, &user, &id).await?;
    let mut out = Vec::new();
    for row in designs::designs(&st.db, &c.id).await? {
        let m = manifest_of(&row)?;
        out.push(summary(&row, &m));
    }
    Ok(Json(json!({ "designs": out })))
}

async fn version_row(
    st: &AppState,
    site: &str,
    version: i64,
) -> AppResult<(designs::DesignRow, BundleManifest)> {
    let row = designs::design(&st.db, site, version)
        .await?
        .ok_or_else(|| AppError::NotFound("no such design version".into()))?;
    let m = manifest_of(&row)?;
    Ok((row, m))
}

async fn read_object(st: &AppState, company: &str, sha256: &str) -> AppResult<Vec<u8>> {
    let store = st.objects.clone();
    let key = object_key(company, sha256);
    tokio::task::spawn_blocking(move || store.get(&key))
        .await
        .map_err(|e| AppError::Internal(e.into()))??
        .ok_or_else(|| AppError::Internal(anyhow::anyhow!("a design file's bytes are missing")))
}

/// `GET /api/sites/{id}/designs/{version}`: the manifest and the interpretation.
pub async fn get_design(
    State(st): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path((id, version)): Path<(String, i64)>,
) -> AppResult<Json<Value>> {
    let c = owned_company(&st, &user, &id).await?;
    let (row, m) = version_row(&st, &c.id, version).await?;
    // Only the text files take part in the interpretation.
    let mut texts = BTreeMap::new();
    for f in &m.files {
        let p = f.path.to_ascii_lowercase();
        let text = p.ends_with(".html")
            || p.ends_with(".htm")
            || p.ends_with(".css")
            || p == "design.json";
        if !text
            || usize::try_from(f.size).unwrap_or(usize::MAX) > site_design::bundle::MAX_PARSE_BYTES
        {
            continue;
        }
        let bytes = read_object(&st, &c.id, &f.sha256).await?;
        if let Ok(s) = String::from_utf8(bytes) {
            texts.insert(f.path.clone(), s);
        }
    }
    let hash = row.hash.clone();
    let design = tokio::task::spawn_blocking(move || site_design::interpret_texts(&hash, &texts))
        .await
        .map_err(|e| AppError::Internal(e.into()))?;
    Ok(Json(json!({
        "version": row.version,
        "manifest": m,
        "design": design,
    })))
}

/// `GET /api/sites/{id}/designs/{version}/files/{*path}`.
pub async fn get_design_file(
    State(st): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path((id, version, path)): Path<(String, i64, String)>,
) -> AppResult<Response> {
    let c = owned_company(&st, &user, &id).await?;
    let (_, m) = version_row(&st, &c.id, version).await?;
    let f = m
        .files
        .iter()
        .find(|f| f.path == path)
        .ok_or_else(|| AppError::NotFound("no such file in this design".into()))?;
    let bytes = read_object(&st, &c.id, &f.sha256).await?;
    Ok((
        [
            (header::CONTENT_TYPE, f.content_type.clone()),
            (header::CONTENT_SECURITY_POLICY, FILE_CSP.to_string()),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff".to_string()),
            (
                header::CACHE_CONTROL,
                "private, max-age=31536000, immutable".to_string(),
            ),
        ],
        bytes,
    )
        .into_response())
}
