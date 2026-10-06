//! Tool output as site data (ADR-0072 decision 5, FEAT-092): build-time
//! bindings read typed data files, never a live call.
//!
//! `PUT /api/site/data` (session cookie and the company lease) commits one
//! run's output of an installed tool to `content/data/<tool>/<key>.json` on the
//! base branch:
//!
//! * the tool must exist at the base head (`blueprint/tools/<tool>.tool.json`)
//!   and name the output `port` (or have exactly one);
//! * the value is validated against that output's type in the site's types
//!   (422 with the reasons otherwise): nothing untyped reaches a page;
//! * `key` is `latest` (a run without per-page inputs) or a kebab-case page
//!   key;
//! * the write is a content write (`ContentAgent`, a `drafts/` branch, then a
//!   squash merge by the platform), skipped when the file already holds the
//!   same value.
//!
//! `GET /api/site/data?tool=…&key=…` reads it back (`404` when absent): the
//! last good output a failed `keep-last` run leaves in place.

use std::collections::BTreeMap;
use std::sync::Arc;

use axum::extract::{Query, State};
use axum::http::HeaderMap;
use axum::Json;
use blueprint::tools::ToolGraph;
use blueprint::{TypeExpr, TypeRegistry};
use github::{ActorKind, GuardedRepo, MergeMethod, MergeOptions, NewPullRequest, PutFile, RepoApi};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::app::AppState;
use crate::auth::CurrentUser;
use crate::companies::require_lease;
use crate::error::{AppError, AppResult};
use crate::gateway::{company_repo, gh_error};
use crate::site_knowledge::base_head;

/// Where tool data lives.
pub const DATA_DIR: &str = "content/data";
/// Largest data file, bytes of pretty JSON.
pub const MAX_DATA_BYTES: usize = 256 * 1024;

fn valid_key(k: &str) -> bool {
    !k.is_empty()
        && k.len() <= 100
        && k.bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        && !k.starts_with('-')
        && !k.ends_with('-')
}

/// The data file of a tool's run.
pub fn data_path(tool: &str, key: &str) -> String {
    format!("{DATA_DIR}/{tool}/{key}.json")
}

#[derive(Deserialize)]
pub struct PutData {
    pub tool: String,
    #[serde(default = "latest")]
    pub key: String,
    /// The output port; may be left out when the tool has one output.
    #[serde(default)]
    pub port: Option<String>,
    pub value: Value,
}

fn latest() -> String {
    "latest".into()
}

/// The tool and the site's types at a commit (the `blueprint/` tree only).
async fn tool_at(
    api: &Arc<dyn RepoApi>,
    repo: &github::RepoId,
    head: &str,
    tool: &str,
) -> AppResult<(ToolGraph, TypeRegistry)> {
    let snap = api
        .snapshot(repo, head, "blueprint")
        .await
        .map_err(gh_error)?;
    let path = format!("{}/{tool}.tool.json", blueprint::format::TOOLS_DIR);
    let text = snap
        .files
        .get(&path)
        .ok_or_else(|| AppError::NotFound(format!("the site has no tool {tool}")))?;
    let v: Value =
        serde_json::from_str(text).map_err(|e| AppError::BadGateway(format!("{path}: {e}")))?;
    let graph =
        ToolGraph::from_value(&v).map_err(|e| AppError::BadGateway(format!("{path}: {e}")))?;
    let mut types = BTreeMap::new();
    for (p, t) in &snap.files {
        if let Some(name) = p
            .strip_prefix(&format!("{}/", blueprint::format::TYPES_DIR))
            .and_then(|r| r.strip_suffix(".json"))
        {
            let v: Value =
                serde_json::from_str(t).map_err(|e| AppError::BadGateway(format!("{p}: {e}")))?;
            types.insert(name.to_string(), v);
        }
    }
    let reg = TypeRegistry::with_site(&types).map_err(|issues| {
        AppError::BadGateway(format!(
            "the site's types do not check: {}",
            issues
                .iter()
                .map(ToString::to_string)
                .collect::<Vec<_>>()
                .join("; ")
        ))
    })?;
    Ok((graph, reg))
}

/// `PUT /api/site/data` (module docs). Answers `{path, commit, changed}`.
pub async fn put_data(
    State(st): State<AppState>,
    CurrentUser(user): CurrentUser,
    headers: HeaderMap,
    Json(body): Json<PutData>,
) -> AppResult<Json<Value>> {
    let fenced = require_lease(&st, &headers, &user).await?;
    let company = &fenced.company;
    if !blueprint::issue::valid_id(&body.tool) || !valid_key(&body.key) {
        return Err(AppError::BadRequest(
            "tool and key are kebab-case ids".into(),
        ));
    }
    let repo = company_repo(&st, company)?;
    let _guard = st.repo_lock(&repo.to_string()).await;
    let api = st.github.api_for(&repo).await?;
    let head = base_head(api.as_ref(), &repo, &company.site_base_branch).await?;
    let (graph, reg) = tool_at(&api, &repo, &head, &body.tool).await?;
    let port = match &body.port {
        Some(p) => p.clone(),
        None if graph.outputs.len() == 1 => {
            graph.outputs.keys().next().cloned().unwrap_or_default()
        }
        None => {
            return Err(AppError::BadRequest(format!(
                "name one of the tool's outputs: {}",
                graph.outputs.keys().cloned().collect::<Vec<_>>().join(", ")
            )))
        }
    };
    let ty = graph
        .outputs
        .get(&port)
        .ok_or_else(|| AppError::BadRequest(format!("{} has no output {port}", body.tool)))?;
    let ty = TypeExpr::parse(ty).map_err(AppError::BadRequest)?;
    reg.validate(&body.value, &ty)
        .map_err(|why| AppError::Unprocessable {
            message: format!("the value is not a {ty}"),
            issues: why,
        })?;

    let path = data_path(&body.tool, &body.key);
    let mut text = serde_json::to_string_pretty(&body.value).unwrap_or_default();
    text.push('\n');
    if text.len() > MAX_DATA_BYTES {
        return Err(AppError::PayloadTooLarge(format!(
            "{path} would be over {MAX_DATA_BYTES} bytes"
        )));
    }
    let existing = api.get_file(&repo, &head, &path).await.map_err(gh_error)?;
    if existing.as_ref().and_then(|f| f.text().ok()) == Some(text.as_str()) {
        return Ok(Json(
            json!({ "path": path, "commit": head, "changed": false }),
        ));
    }
    let guarded: Arc<dyn RepoApi> =
        Arc::new(GuardedRepo::new(api.clone(), ActorKind::ContentAgent));
    let branch = format!(
        "drafts/data-{}-{}-{}",
        body.tool,
        body.key,
        &head[..8.min(head.len())]
    );
    if api
        .get_branch(&repo, &branch)
        .await
        .map_err(gh_error)?
        .is_none()
    {
        guarded
            .create_branch(&repo, &branch, &head)
            .await
            .map_err(gh_error)?;
    }
    let message = format!("Data: {} ({})", body.tool, body.key);
    guarded
        .put_file(
            &repo,
            &PutFile {
                branch: branch.clone(),
                path: path.clone(),
                content: text.into_bytes(),
                message: message.clone(),
                expected_sha: existing.map(|f| f.sha),
                author: None,
            },
        )
        .await
        .map_err(gh_error)?;
    let branch_head = api
        .get_branch(&repo, &branch)
        .await
        .map_err(gh_error)?
        .map(|b| b.sha)
        .unwrap_or_default();
    let pr = api
        .create_pr(
            &repo,
            &NewPullRequest {
                title: message.clone(),
                head: branch,
                base: company.site_base_branch.clone(),
                body: "A tool's output as site data (ADR-0072).".into(),
                draft: false,
            },
        )
        .await
        .map_err(gh_error)?;
    let merged = api
        .merge_pr(
            &repo,
            pr.number,
            &MergeOptions {
                method: MergeMethod::Squash,
                expected_head_sha: Some(branch_head),
                commit_title: Some(format!("{message} (#{})", pr.number)),
                commit_message: None,
            },
        )
        .await
        .map_err(gh_error)?;
    tracing::info!(company_id = %company.id, tool = %body.tool, key = %body.key, "site data written");
    Ok(Json(
        json!({ "path": path, "commit": merged.sha, "changed": true }),
    ))
}

#[derive(Deserialize)]
pub struct DataQuery {
    pub tool: String,
    #[serde(default = "latest")]
    pub key: String,
}

/// `GET /api/site/data?tool=…&key=…` (module docs): `{path, commit, value}`.
pub async fn get_data(
    State(st): State<AppState>,
    CurrentUser(user): CurrentUser,
    headers: HeaderMap,
    Query(q): Query<DataQuery>,
) -> AppResult<Json<Value>> {
    let fenced = require_lease(&st, &headers, &user).await?;
    if !blueprint::issue::valid_id(&q.tool) || !valid_key(&q.key) {
        return Err(AppError::BadRequest(
            "tool and key are kebab-case ids".into(),
        ));
    }
    let company = &fenced.company;
    let repo = company_repo(&st, company)?;
    let api = st.github.api_for(&repo).await?;
    let head = base_head(api.as_ref(), &repo, &company.site_base_branch).await?;
    let path = data_path(&q.tool, &q.key);
    let f = api
        .get_file(&repo, &head, &path)
        .await
        .map_err(gh_error)?
        .ok_or_else(|| AppError::NotFound(format!("{path} does not exist")))?;
    let text = f
        .text()
        .map_err(|_| AppError::BadGateway(format!("{path} is not UTF-8")))?;
    let value: Value =
        serde_json::from_str(text).map_err(|e| AppError::BadGateway(format!("{path}: {e}")))?;
    Ok(Json(
        json!({ "path": path, "commit": head, "value": value }),
    ))
}
