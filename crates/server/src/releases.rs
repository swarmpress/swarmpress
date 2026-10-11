//! Releases of a company's WordPress site (ADR-0083, plan M5): the static export of `live` is
//! deployed here, never a WordPress. The executor crawls `live` (`crates/site-export`), uploads
//! the files' bytes to the asset store (`PUT /api/assets/{sha256}`) and then the release:
//!
//! - `PUT /api/releases/{id}` with the company lease: `{release: {id, files, redirects},
//!   work_item?, change_request?}`. The id must be the manifest's own (`swarmpress:release:v1`;
//!   400 otherwise) and every file's bytes must be in the company's object store (409 with the
//!   missing paths). The release is written to the static data plane ([`StaticPlane`]) and becomes
//!   the company's current site; a `DeployLanded` event (`source: "export"`) tells the sim the
//!   work item is live. A failure to write reports `DeployFailed`.
//! - `GET /api/releases/current`: `{id, url}` of the current release, or 404.
//! - `GET /sites/{company}/{*path}`: the current release as a site (the filesystem plane's own
//!   public face; a CDN serves the same files in production). No sign-in: it is the public site.
//!
//! [`FsStaticPlane`] writes `{data_dir}/sites/{company}/releases/{id}/` and a `current` pointer.
//! A Cloudflare Pages or R2 plane is the next implementation (ADR-0049).

use std::path::PathBuf;

use axum::extract::{Path, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};
use site_export::Release;

use crate::app::{require_company, AppState};
use crate::assets::object_key;
use crate::auth::CurrentUser;
use crate::companies::require_lease;
use crate::db::events as event_store;
use crate::error::{AppError, AppResult};
use crate::events::{self, kinds};

/// Where releases are served from.
pub trait StaticPlane: Send + Sync {
    /// Writes `release` (its bytes by digest from `bytes`) and makes it the company's current site;
    /// returns the site's URL.
    fn publish(
        &self,
        company: &str,
        release: &Release,
        bytes: &dyn Fn(&str) -> anyhow::Result<Vec<u8>>,
    ) -> anyhow::Result<String>;
    /// The current release's id.
    fn current(&self, company: &str) -> anyhow::Result<Option<String>>;
    /// One file of the current release: its bytes and type, or a redirect target.
    fn get(&self, company: &str, path: &str) -> anyhow::Result<Option<Served>>;
}

pub enum Served {
    File {
        bytes: Vec<u8>,
        content_type: String,
    },
    Redirect(String),
}

/// Releases as directories under `{data_dir}/sites/`.
pub struct FsStaticPlane {
    root: PathBuf,
    public_base: String,
}

impl FsStaticPlane {
    pub fn new(root: PathBuf, public_base: &str) -> Self {
        Self {
            root,
            public_base: public_base.trim_end_matches('/').to_string(),
        }
    }

    fn company_dir(&self, company: &str) -> anyhow::Result<PathBuf> {
        if company.is_empty()
            || !company
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-')
        {
            anyhow::bail!("bad company id");
        }
        Ok(self.root.join(company))
    }

    fn manifest(&self, company: &str) -> anyhow::Result<Option<Release>> {
        let Some(id) = self.current(company)? else {
            return Ok(None);
        };
        let text = std::fs::read_to_string(
            self.company_dir(company)?
                .join("releases")
                .join(&id)
                .join(".release.json"),
        )?;
        Ok(Some(serde_json::from_str(&text)?))
    }
}

impl StaticPlane for FsStaticPlane {
    fn publish(
        &self,
        company: &str,
        release: &Release,
        bytes: &dyn Fn(&str) -> anyhow::Result<Vec<u8>>,
    ) -> anyhow::Result<String> {
        let dir = self.company_dir(company)?;
        let rel = dir.join("releases").join(&release.id);
        if !rel.join(".release.json").exists() {
            let tmp = dir.join("releases").join(format!("{}.partial", release.id));
            let _ = std::fs::remove_dir_all(&tmp);
            for (path, f) in &release.files {
                let file = tmp.join(Release::file_path(path, &f.content_type));
                std::fs::create_dir_all(file.parent().expect("a file has a parent"))?;
                std::fs::write(file, bytes(&f.sha256)?)?;
            }
            std::fs::create_dir_all(&tmp)?;
            std::fs::write(tmp.join(".release.json"), serde_json::to_vec(release)?)?;
            std::fs::rename(&tmp, &rel)?;
        }
        // The pointer moves last: a reader sees the old release or the whole new one.
        std::fs::write(dir.join("current.partial"), &release.id)?;
        std::fs::rename(dir.join("current.partial"), dir.join("current"))?;
        Ok(format!("{}/sites/{company}/", self.public_base))
    }

    fn current(&self, company: &str) -> anyhow::Result<Option<String>> {
        match std::fs::read_to_string(self.company_dir(company)?.join("current")) {
            Ok(id) => Ok(Some(id.trim().to_string())),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    fn get(&self, company: &str, path: &str) -> anyhow::Result<Option<Served>> {
        let Some(release) = self.manifest(company)? else {
            return Ok(None);
        };
        let key = if path.is_empty() {
            "/".to_string()
        } else {
            format!("/{}", path.trim_start_matches('/'))
        };
        if let Some(to) = release.redirects.get(&key) {
            return Ok(Some(Served::Redirect(to.clone())));
        }
        let entry = release.files.get(&key).or_else(|| {
            if key.ends_with('/') {
                None
            } else {
                release.files.get(&format!("{key}/"))
            }
        });
        let Some(f) = entry else { return Ok(None) };
        let file = self
            .company_dir(company)?
            .join("releases")
            .join(&release.id)
            .join(Release::file_path(&key, &f.content_type));
        Ok(Some(Served::File {
            bytes: std::fs::read(file)?,
            content_type: f.content_type.clone(),
        }))
    }
}

#[derive(Deserialize)]
pub struct PutRelease {
    release: Release,
    #[serde(default)]
    work_item: Option<String>,
    #[serde(default)]
    change_request: Option<u64>,
}

fn deploy_payload(
    body: &PutRelease,
    state: &str,
    detail: Option<&str>,
    url: Option<&str>,
) -> Value {
    json!({
        "content_id": Value::Null,
        "work_item": body.work_item,
        "number": body.change_request,
        "merged_sha": Value::Null,
        "deployed_sha": body.release.id,
        "state": state,
        "detail": detail,
        "environment": url,
        "source": "export",
        "attempt": 0,
    })
}

pub async fn put_release(
    State(st): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(body): Json<PutRelease>,
) -> AppResult<Json<Value>> {
    let fenced = require_lease(&st, &headers, &user).await?;
    let company = fenced.company.id.clone();
    if body.release.id != id || body.release.computed_id() != id {
        return Err(AppError::BadRequest(
            "the release id is not its manifest's".into(),
        ));
    }
    let objects = st.objects.clone();
    let missing: Vec<String> = body
        .release
        .files
        .iter()
        .filter(|(_, f)| !matches!(objects.get(&object_key(&company, &f.sha256)), Ok(Some(_))))
        .map(|(p, _)| p.clone())
        .collect();
    if !missing.is_empty() {
        return Err(AppError::Conflict(format!(
            "the bytes of {} file(s) were not uploaded: {}",
            missing.len(),
            missing
                .iter()
                .take(10)
                .cloned()
                .collect::<Vec<_>>()
                .join(", ")
        )));
    }
    let plane = st.static_plane.clone();
    let release = body.release.clone();
    let c = company.clone();
    let result = tokio::task::spawn_blocking(move || {
        let read = |sha: &str| -> anyhow::Result<Vec<u8>> {
            objects
                .get(&object_key(&c, sha))?
                .ok_or_else(|| anyhow::anyhow!("missing {sha}"))
        };
        plane.publish(&c, &release, &read)
    })
    .await
    .map_err(|e| AppError::Internal(e.into()))?;
    match result {
        Ok(url) => {
            let ev = event_store::insert_event(
                &st.db,
                &company,
                kinds::DEPLOY_LANDED,
                &deploy_payload(
                    &body,
                    "success",
                    Some(&format!("release {}", &id[..12.min(id.len())])),
                    Some(&url),
                ),
                st.now_ms(),
            )
            .await?;
            events::announce(&st, ev);
            tracing::info!(company = %company, release = %id, files = body.release.files.len(), "release deployed");
            Ok(Json(
                json!({ "id": id, "url": url, "files": body.release.files.len() }),
            ))
        }
        Err(e) => {
            let detail = format!("the release could not be written: {e}");
            let ev = event_store::insert_event(
                &st.db,
                &company,
                kinds::DEPLOY_FAILED,
                &deploy_payload(&body, "error", Some(&detail), None),
                st.now_ms(),
            )
            .await?;
            events::announce(&st, ev);
            Err(AppError::Internal(anyhow::anyhow!(detail)))
        }
    }
}

pub async fn current_release(
    State(st): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> AppResult<Json<Value>> {
    let company = require_company(&st, &user.id).await?;
    let id = st
        .static_plane
        .current(&company.id)?
        .ok_or_else(|| AppError::NotFound("no release yet".into()))?;
    Ok(Json(
        json!({ "id": id, "url": format!("{}/sites/{}/", st.cfg.public_url.trim_end_matches('/'), company.id) }),
    ))
}

async fn serve(st: AppState, company: String, path: String) -> AppResult<Response> {
    let plane = st.static_plane.clone();
    let got = tokio::task::spawn_blocking(move || plane.get(&company, &path))
        .await
        .map_err(|e| AppError::Internal(e.into()))??;
    match got {
        Some(Served::File {
            bytes,
            content_type,
        }) => Ok(([(header::CONTENT_TYPE, content_type)], bytes).into_response()),
        Some(Served::Redirect(to)) => {
            Ok((StatusCode::MOVED_PERMANENTLY, [(header::LOCATION, to)]).into_response())
        }
        None => Err(AppError::NotFound("not found".into())),
    }
}

pub async fn site_root(
    State(st): State<AppState>,
    Path(company): Path<String>,
) -> AppResult<Response> {
    serve(st, company, String::new()).await
}

pub async fn site_file(
    State(st): State<AppState>,
    Path((company, path)): Path<(String, String)>,
) -> AppResult<Response> {
    serve(st, company, path).await
}
