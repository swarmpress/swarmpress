//! Theme components from the blueprint (ADR-0072, FEAT-094).
//!
//! `PUT /api/site/theme` (session cookie and the company lease) writes the
//! Web Developer's components for one `Theme` work item:
//!
//! * only block renderers (`theme/blocks/<type>.astro`,
//!   `theme/blocks/<name>/Component.astro`), each passing
//!   `blueprint::theme::check_component` (422 with the reasons otherwise);
//! * only on a site that runs a site-kit theme (`theme/theme.config.ts`): the
//!   live cinqueterre.travel still builds the frozen theme, so it gets 409
//!   until the cutover (CLAUDE.md rule 9);
//! * as the design actor, on `design/<item>`, with one pull request per item
//!   (reused when the job runs again). The site CI's theme gate (FEAT-045)
//!   runs on it. Answers `{number, branch, head_sha}`.
//!
//! `POST /api/site/theme/merge` `{number, head_sha}` squash-merges it once
//! the CEO approved (the item's Publish job): `{commit}`.

use std::collections::BTreeMap;
use std::sync::Arc;

use axum::extract::State;
use axum::http::HeaderMap;
use axum::Json;
use blueprint::theme::{block_of_path, check_component};
use github::{ActorKind, GuardedRepo, MergeMethod, MergeOptions, NewPullRequest, PutFile, RepoApi};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::app::AppState;
use crate::auth::CurrentUser;
use crate::companies::require_lease;
use crate::error::{AppError, AppResult};
use crate::gateway::{company_repo, gh_error};
use crate::site_knowledge::base_head;

/// The file that marks a site-kit theme.
pub const THEME_CONFIG: &str = "theme/theme.config.ts";
/// Components one write carries at most.
pub const MAX_FILES: usize = 8;

#[derive(Deserialize)]
pub struct PutTheme {
    /// The `Theme` work item (`work-item-12`): the branch is `design/<item>`.
    pub item: String,
    /// Renderer path → component source.
    pub files: BTreeMap<String, String>,
    #[serde(default)]
    pub message: Option<String>,
}

/// `PUT /api/site/theme` (module docs).
pub async fn put_theme(
    State(st): State<AppState>,
    CurrentUser(user): CurrentUser,
    headers: HeaderMap,
    Json(body): Json<PutTheme>,
) -> AppResult<Json<Value>> {
    let fenced = require_lease(&st, &headers, &user).await?;
    let company = &fenced.company;
    if !blueprint::issue::valid_id(&body.item) {
        return Err(AppError::BadRequest(
            "item is a work item id (work-item-12)".into(),
        ));
    }
    if body.files.is_empty() || body.files.len() > MAX_FILES {
        return Err(AppError::BadRequest(format!(
            "1 to {MAX_FILES} components per write"
        )));
    }
    let mut issues = Vec::new();
    for (path, src) in &body.files {
        if block_of_path(path).is_none() {
            issues.push(format!("{path}: not a block renderer path"));
            continue;
        }
        if let Err(why) = check_component(src) {
            issues.extend(why.into_iter().map(|w| format!("{path}: {w}")));
        }
    }
    if !issues.is_empty() {
        return Err(AppError::Unprocessable {
            message: "the components do not check".into(),
            issues,
        });
    }

    let repo = company_repo(&st, company)?;
    let _guard = st.repo_lock(&repo.to_string()).await;
    let api = st.github.api_for(&repo).await?;
    let head = base_head(api.as_ref(), &repo, &company.site_base_branch).await?;
    if api
        .get_file(&repo, &head, THEME_CONFIG)
        .await
        .map_err(gh_error)?
        .is_none()
    {
        return Err(AppError::Conflict(format!(
            "the site does not run a site-kit theme ({THEME_CONFIG}): theme generation waits for the cutover"
        )));
    }
    let guarded: Arc<dyn RepoApi> = Arc::new(GuardedRepo::new(api.clone(), ActorKind::DesignAgent));
    let branch = format!("design/{}", body.item);
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
    let message = body
        .message
        .unwrap_or_else(|| format!("Theme components for {}", body.item));
    for (path, src) in &body.files {
        let existing = api.get_file(&repo, &branch, path).await.map_err(gh_error)?;
        if existing.as_ref().and_then(|f| f.text().ok()) == Some(src.as_str()) {
            continue;
        }
        guarded
            .put_file(
                &repo,
                &PutFile {
                    branch: branch.clone(),
                    path: path.clone(),
                    content: src.clone().into_bytes(),
                    message: message.clone(),
                    expected_sha: existing.map(|f| f.sha),
                    author: None,
                },
            )
            .await
            .map_err(gh_error)?;
    }
    let open = api.find_open_pr(&repo, &branch).await.map_err(gh_error)?;
    let pr = match open {
        Some(p) => p,
        None => api
            .create_pr(
                &repo,
                &NewPullRequest {
                    title: message.clone(),
                    head: branch.clone(),
                    base: company.site_base_branch.clone(),
                    body: "Theme components from the blueprint (ADR-0072). The theme gate checks them; the CEO approves before they merge.".into(),
                    draft: false,
                },
            )
            .await
            .map_err(gh_error)?,
    };
    let head_sha = api
        .get_branch(&repo, &branch)
        .await
        .map_err(gh_error)?
        .map(|b| b.sha)
        .unwrap_or_default();
    Ok(Json(
        json!({ "number": pr.number, "branch": branch, "head_sha": head_sha }),
    ))
}

#[derive(Deserialize)]
pub struct MergeTheme {
    pub number: u64,
    pub head_sha: String,
}

/// `POST /api/site/theme/merge` (module docs).
pub async fn merge_theme(
    State(st): State<AppState>,
    CurrentUser(user): CurrentUser,
    headers: HeaderMap,
    Json(body): Json<MergeTheme>,
) -> AppResult<Json<Value>> {
    let fenced = require_lease(&st, &headers, &user).await?;
    let repo = company_repo(&st, &fenced.company)?;
    let _guard = st.repo_lock(&repo.to_string()).await;
    let api = st.github.api_for(&repo).await?;
    let pr = api.get_pr(&repo, body.number).await.map_err(gh_error)?;
    if !pr.head_ref.starts_with("design/") {
        return Err(AppError::Forbidden(
            "only theme pull requests merge here".into(),
        ));
    }
    let merged = api
        .merge_pr(
            &repo,
            body.number,
            &MergeOptions {
                method: MergeMethod::Squash,
                expected_head_sha: Some(body.head_sha),
                commit_title: Some(format!("{} (#{})", pr.title, body.number)),
                commit_message: None,
            },
        )
        .await
        .map_err(gh_error)?;
    Ok(Json(json!({ "commit": merged.sha })))
}
