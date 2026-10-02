//! Content gateway (ADR-0038): the browser's orchestrator opens and merges
//! content PRs through the server, which holds the GitHub credentials.
//!
//! - `POST /api/gateway/draft {content_id, path, page, message, work_item?}`
//!   → `{number, branch, head_sha}`: commit `page` (canonical JSON) at
//!   `path` on `drafts/content-{content_id}` and make sure a PR is open.
//!   Idempotent (`github::ContentRepo::open_draft`).
//! - `POST /api/gateway/merge {number, head_sha}` → `{merged_sha}`: squash
//!   merge, refused unless the head is exactly `head_sha`. Only PRs this
//!   company opened through the gateway can be merged. With
//!   `SIMPRESS_SIMULATE_DEPLOY` a `DeployLanded` event follows at once;
//!   otherwise the site's `deployment_status` webhook produces it.
//!
//! Both require the company lease (`x-simpress-lease`). `PathPolicy`: the
//! draft is written as a content agent (`content/**` only, `drafts/` branch
//! only, platform files refused) and must be a `.json` page object of at
//! most 256 KiB; `..`, absolute paths, backslashes and NUL are refused.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use anyhow::{Context, Result};
use axum::extract::State;
use axum::http::HeaderMap;
use axum::Json;
use github::content::page_bytes;
use github::{
    ActorKind, AppAuth, ContentRepo, FakeGitHub, GitHubError, GuardedRepo, HttpGitHub, PathPolicy,
    RepoApi, RepoId, StaticToken,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::app::AppState;
use crate::auth::CurrentUser;
use crate::companies::require_lease;
use crate::config::GithubMode;
use crate::db::gateway::{self as store, NewGatewayPr};
use crate::error::{AppError, AppResult};
use crate::events::{self, kinds};

/// Where repo operations go.
pub enum RepoBackend {
    /// In-memory fake; repos are created on first use.
    Fake(Arc<FakeGitHub>),
    /// Real REST API with one static token.
    Token(Arc<HttpGitHub>),
    /// Real REST API as a GitHub App (installation token per repo).
    App {
        auth: Arc<AppAuth>,
        api_base: String,
        clients: Mutex<HashMap<u64, Arc<HttpGitHub>>>,
    },
    /// Nothing configured: every gateway call fails loudly (503).
    Unconfigured,
}

impl std::fmt::Debug for RepoBackend {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            RepoBackend::Fake(_) => "RepoBackend::Fake",
            RepoBackend::Token(_) => "RepoBackend::Token",
            RepoBackend::App { .. } => "RepoBackend::App",
            RepoBackend::Unconfigured => "RepoBackend::Unconfigured",
        })
    }
}

impl RepoBackend {
    pub fn from_mode(mode: &GithubMode) -> Result<Self> {
        Ok(match mode {
            GithubMode::Fake => RepoBackend::Fake(Arc::new(FakeGitHub::new())),
            GithubMode::Real {
                api_base,
                token: Some(token),
                ..
            } => RepoBackend::Token(Arc::new(
                HttpGitHub::new(api_base.clone(), Arc::new(StaticToken(token.clone())))
                    .context("GitHub client")?,
            )),
            GithubMode::Real {
                api_base,
                app_id: Some(app_id),
                app_private_key_path: Some(key_path),
                ..
            } => {
                let pem = std::fs::read(key_path)
                    .with_context(|| format!("read {}", key_path.display()))?;
                RepoBackend::App {
                    auth: Arc::new(
                        AppAuth::new(app_id.clone(), &pem, api_base.clone())
                            .context("GitHub App auth")?,
                    ),
                    api_base: api_base.clone(),
                    clients: Mutex::new(HashMap::new()),
                }
            }
            GithubMode::Real { .. } => {
                tracing::warn!(
                    "no GITHUB_TOKEN or GitHub App configured: the content gateway will answer 503"
                );
                RepoBackend::Unconfigured
            }
        })
    }

    /// The fake, when running against it (tests, dev).
    pub fn fake(&self) -> Option<&Arc<FakeGitHub>> {
        match self {
            RepoBackend::Fake(f) => Some(f),
            _ => None,
        }
    }

    /// A [`RepoApi`] that can write `repo`.
    pub async fn api_for(&self, repo: &RepoId) -> AppResult<Arc<dyn RepoApi>> {
        match self {
            RepoBackend::Fake(fake) => {
                match fake.get_repo(repo).await {
                    Ok(_) => {}
                    Err(GitHubError::NotFound(_)) => {
                        fake.create_repo(repo, &[("README.md", "# SimPress site\n")]);
                    }
                    Err(e) => return Err(gh_error(e)),
                }
                Ok(fake.clone())
            }
            RepoBackend::Token(api) => Ok(api.clone()),
            RepoBackend::App {
                auth,
                api_base,
                clients,
            } => {
                let installation = auth.installation_for_repo(repo).await.map_err(gh_error)?;
                if let Some(c) = clients
                    .lock()
                    .unwrap_or_else(|p| p.into_inner())
                    .get(&installation)
                {
                    return Ok(c.clone());
                }
                let client = Arc::new(
                    HttpGitHub::new(api_base.clone(), Arc::new(auth.installation(installation)))
                        .map_err(gh_error)?,
                );
                clients
                    .lock()
                    .unwrap_or_else(|p| p.into_inner())
                    .insert(installation, client.clone());
                Ok(client)
            }
            RepoBackend::Unconfigured => Err(AppError::Unavailable(
                "the content gateway has no GitHub credentials (GITHUB_TOKEN or GitHub App)".into(),
            )),
        }
    }
}

/// Map a GitHub error onto the HTTP surface.
pub fn gh_error(e: GitHubError) -> AppError {
    match e {
        GitHubError::PolicyDenied { reason, .. } => AppError::Forbidden(reason),
        GitHubError::InvalidArgument(m) => AppError::BadRequest(m),
        GitHubError::NotFound(m) => AppError::NotFound(m),
        e @ (GitHubError::Conflict(_)
        | GitHubError::AlreadyExists(_)
        | GitHubError::NotMergeable(_)) => AppError::Conflict(e.to_string()),
        e @ GitHubError::RateLimited { .. } => AppError::TooManyRequests(e.to_string()),
        e => AppError::BadGateway(e.to_string()),
    }
}

/// `owner/name` → [`RepoId`].
pub fn parse_repo(full: &str) -> Option<RepoId> {
    let (owner, name) = full.split_once('/')?;
    let ok = |s: &str| {
        !s.is_empty()
            && s.len() <= 100
            && !s.starts_with('.')
            && s.bytes()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_' | b'.'))
    };
    (ok(owner) && ok(name)).then(|| RepoId::new(owner, name))
}

/// The gateway's path rules, checked before any GitHub call. Returns the
/// normalised path.
pub fn check_draft(
    content_id: &str,
    path: &str,
    page: &Value,
    max_bytes: usize,
) -> AppResult<(String, String)> {
    let branch = ContentRepo::draft_branch(content_id).map_err(gh_error)?;
    let policy = PathPolicy::default();
    policy
        .check_branch(ActorKind::ContentAgent, &branch)
        .map_err(gh_error)?;
    let path = policy
        .check_write(ActorKind::ContentAgent, path)
        .map_err(gh_error)?;
    if !path.to_ascii_lowercase().ends_with(".json") {
        return Err(AppError::BadRequest(format!(
            "{path}: the gateway only writes .json pages"
        )));
    }
    if !page.is_object() {
        return Err(AppError::BadRequest("page must be a JSON object".into()));
    }
    let size = page_bytes(page).map_err(gh_error)?.len();
    if size > max_bytes {
        return Err(AppError::PayloadTooLarge(format!(
            "page is {size} bytes; the limit is {max_bytes}"
        )));
    }
    Ok((branch, path))
}

#[derive(Deserialize)]
pub struct DraftBody {
    pub content_id: String,
    pub path: String,
    pub page: Value,
    pub message: String,
    /// The sim work item this content belongs to (echoed in `DeployLanded`).
    #[serde(default)]
    pub work_item: Option<String>,
}

/// `POST /api/gateway/draft`
pub async fn draft(
    State(st): State<AppState>,
    CurrentUser(user): CurrentUser,
    headers: HeaderMap,
    Json(body): Json<DraftBody>,
) -> AppResult<Json<Value>> {
    let company = require_lease(&st, &headers, &user).await?;
    let message = body.message.trim();
    if message.is_empty() || message.len() > 1000 {
        return Err(AppError::BadRequest("message must be 1-1000 bytes".into()));
    }
    if let Some(w) = &body.work_item {
        if w.is_empty() || w.len() > 100 {
            return Err(AppError::BadRequest("work_item must be 1-100 bytes".into()));
        }
    }
    let (_, path) = check_draft(
        &body.content_id,
        &body.path,
        &body.page,
        st.cfg.max_page_bytes,
    )?;
    let repo = parse_repo(&company.site_repo)
        .ok_or_else(|| AppError::Conflict("the company's site repo binding is invalid".into()))?;
    let api = st.github.api_for(&repo).await?;
    let guarded: Arc<dyn RepoApi> = Arc::new(GuardedRepo::new(api, ActorKind::ContentAgent));
    let content = ContentRepo::new(guarded, repo, company.site_base_branch.clone());
    let dr = content
        .open_draft(&body.content_id, &path, &body.page, message)
        .await
        .map_err(gh_error)?;
    let number = i64::try_from(dr.pr.number).unwrap_or(i64::MAX);
    store::upsert_pr(
        &st.db,
        &NewGatewayPr {
            company_id: &company.id,
            number,
            content_id: &body.content_id,
            work_item: body.work_item.as_deref(),
            path: &path,
            branch: &dr.branch,
            head_sha: &dr.pr.head_sha,
        },
        st.now_ms(),
    )
    .await?;
    tracing::info!(company_id = %company.id, number, content_id = %body.content_id, "gateway draft");
    Ok(Json(json!({
        "number": dr.pr.number,
        "branch": dr.branch,
        "head_sha": dr.pr.head_sha,
        "created_pr": dr.created_pr,
        "committed": dr.commit_sha.is_some(),
    })))
}

#[derive(Deserialize)]
pub struct MergeBody {
    pub number: u64,
    pub head_sha: String,
}

/// `POST /api/gateway/merge`
pub async fn merge(
    State(st): State<AppState>,
    CurrentUser(user): CurrentUser,
    headers: HeaderMap,
    Json(body): Json<MergeBody>,
) -> AppResult<Json<Value>> {
    let company = require_lease(&st, &headers, &user).await?;
    let number = i64::try_from(body.number)
        .map_err(|_| AppError::BadRequest("number out of range".into()))?;
    let pr = store::get_pr(&st.db, &company.id, number)
        .await?
        .ok_or_else(|| {
            AppError::NotFound(format!("PR #{number} was not opened by this company"))
        })?;
    let repo = parse_repo(&company.site_repo)
        .ok_or_else(|| AppError::Conflict("the company's site repo binding is invalid".into()))?;
    // The server merges as the platform bot: the browser only asks for PRs
    // the gateway itself opened, at the exact head that was reviewed.
    let api = st.github.api_for(&repo).await?;
    let content = ContentRepo::new(api, repo, company.site_base_branch.clone());
    let merged = content
        .merge_draft(body.number, &body.head_sha)
        .await
        .map_err(gh_error)?;
    let first_time = pr.merged_sha.is_none();
    store::set_merged(&st.db, &company.id, number, &merged.sha, st.now_ms()).await?;
    tracing::info!(company_id = %company.id, number, merged_sha = %merged.sha, "gateway merge");
    if first_time && st.cfg.simulate_deploy {
        events::publish(
            &st,
            &company.id,
            kinds::DEPLOY_LANDED,
            json!({
                "content_id": pr.content_id,
                "work_item": pr.work_item,
                "merged_sha": merged.sha,
                "number": body.number,
                "source": "simulated",
            }),
        )
        .await?;
    }
    Ok(Json(json!({ "merged_sha": merged.sha })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repos_parse() {
        assert_eq!(
            parse_repo("swarmpress/cinqueterre.travel"),
            Some(RepoId::new("swarmpress", "cinqueterre.travel"))
        );
        assert!(parse_repo("noslash").is_none());
        assert!(parse_repo("a/b/c").is_none());
        assert!(parse_repo("a/..").is_none());
        assert!(parse_repo("/b").is_none());
    }

    #[test]
    fn draft_path_policy() {
        let page = json!({ "title": { "en": "Hi" } });
        let ok = |p: &str| check_draft("c1", p, &page, 1024);
        assert_eq!(
            ok("content/pages/en/a.json").unwrap(),
            (
                "drafts/content-c1".to_string(),
                "content/pages/en/a.json".to_string()
            )
        );
        for (p, code) in [
            ("content/../theme/x.json", 400),
            ("/content/a.json", 400),
            ("content\\a.json", 400),
            ("theme/a.json", 403),
            (".github/workflows/x.json", 403),
            ("content/package.json", 403),
            ("content/a.md", 400),
            ("content", 403),
        ] {
            assert_eq!(ok(p).unwrap_err().status().as_u16(), code, "{p}");
        }
        assert_eq!(
            check_draft("c1", "content/a.json", &json!([1]), 1024)
                .unwrap_err()
                .status()
                .as_u16(),
            400
        );
        let big = json!({ "x": "y".repeat(2000) });
        assert_eq!(
            check_draft("c1", "content/a.json", &big, 1024)
                .unwrap_err()
                .status()
                .as_u16(),
            413
        );
        assert_eq!(
            check_draft("../x", "content/a.json", &page, 1024)
                .unwrap_err()
                .status()
                .as_u16(),
            400
        );
    }
}
