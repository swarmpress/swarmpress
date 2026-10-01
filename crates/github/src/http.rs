//! `HttpGitHub`: the real REST implementation of [`RepoApi`] over reqwest.
//!
//! Raw REST (no octocrab) so every request, header and status mapping is
//! explicit and contract-testable with wiremock.

use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use base64::Engine as _;
use http::{HeaderMap, HeaderValue};
use reqwest::Method;
use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::{json, Value};
use url::Url;

use crate::api::RepoApi;
use crate::auth::TokenProvider;
use crate::clock::{Clock, Sleeper, SystemClock, TokioSleeper};
use crate::error::{GitHubError, Result};
use crate::ratelimit::{Governor, GovernorConfig, RateLimitInfo};
use crate::types::*;

pub const DEFAULT_API_BASE: &str = "https://api.github.com";
const USER_AGENT: &str = "simpress-github/0.2";
const API_VERSION: &str = "2022-11-28";

pub(crate) fn build_client() -> Result<reqwest::Client> {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| GitHubError::Transport(e.to_string()))
}

pub(crate) fn default_headers() -> HeaderMap {
    let mut h = HeaderMap::new();
    h.insert(
        http::header::ACCEPT,
        HeaderValue::from_static("application/vnd.github+json"),
    );
    h.insert(
        "x-github-api-version",
        HeaderValue::from_static(API_VERSION),
    );
    h
}

/// Join percent-encoded path segments onto the API base (which may itself
/// carry a path, e.g. GHES `/api/v3`).
pub(crate) fn api_url(base: &str, segments: &[&str]) -> Result<Url> {
    let mut url = Url::parse(base)
        .map_err(|e| GitHubError::InvalidArgument(format!("api base {base:?}: {e}")))?;
    url.path_segments_mut()
        .map_err(|_| GitHubError::InvalidArgument(format!("api base {base:?} cannot be a base")))?
        .pop_if_empty()
        .extend(segments);
    Ok(url)
}

fn message_of(body: &str) -> String {
    serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|v| v.get("message").and_then(|m| m.as_str()).map(String::from))
        .unwrap_or_else(|| body.chars().take(300).collect())
}

/// Default status → error mapping.
pub(crate) fn map_status(status: u16, body: &str) -> GitHubError {
    let msg = message_of(body);
    match status {
        401 => GitHubError::Unauthorized(msg),
        403 => GitHubError::Forbidden(msg),
        404 => GitHubError::NotFound(msg),
        405 => GitHubError::NotMergeable(msg),
        409 => GitHubError::Conflict(msg),
        422 => GitHubError::Validation(msg),
        _ => GitHubError::Http {
            status,
            message: msg,
        },
    }
}

fn b64() -> base64::engine::GeneralPurpose {
    base64::engine::general_purpose::STANDARD
}

fn decode_b64(s: &str) -> Result<Vec<u8>> {
    let cleaned: String = s.chars().filter(|c| !c.is_ascii_whitespace()).collect();
    b64()
        .decode(cleaned)
        .map_err(|e| GitHubError::Decode(format!("base64: {e}")))
}

fn is_full_sha(s: &str) -> bool {
    s.len() == 40 && s.chars().all(|c| c.is_ascii_hexdigit())
}

struct RawResponse {
    status: u16,
    body: Vec<u8>,
}

impl RawResponse {
    fn ok(&self) -> bool {
        (200..300).contains(&self.status)
    }

    fn text(&self) -> String {
        String::from_utf8_lossy(&self.body).into_owned()
    }

    fn json<T: DeserializeOwned>(&self) -> Result<T> {
        serde_json::from_slice(&self.body).map_err(GitHubError::from)
    }

    fn into_result(self) -> Result<RawResponse> {
        if self.ok() {
            Ok(self)
        } else {
            Err(map_status(self.status, &self.text()))
        }
    }
}

/// Real GitHub REST client for one installation (or one dev token).
pub struct HttpGitHub {
    http: reqwest::Client,
    base: String,
    tokens: Arc<dyn TokenProvider>,
    governor: Arc<Governor>,
    clock: Arc<dyn Clock>,
    sleeper: Arc<dyn Sleeper>,
    max_retries: u32,
}

impl std::fmt::Debug for HttpGitHub {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("HttpGitHub")
            .field("base", &self.base)
            .finish_non_exhaustive()
    }
}

impl HttpGitHub {
    pub fn new(api_base: impl Into<String>, tokens: Arc<dyn TokenProvider>) -> Result<Self> {
        let clock: Arc<dyn Clock> = Arc::new(SystemClock);
        Ok(Self {
            http: build_client()?,
            base: api_base.into(),
            tokens,
            governor: Arc::new(Governor::new(GovernorConfig::default(), clock.now_ms())),
            clock,
            sleeper: Arc::new(TokioSleeper),
            max_retries: 3,
        })
    }

    /// Share a governor (e.g. from a [`crate::GovernorPool`]) across clients
    /// of the same installation.
    pub fn with_governor(mut self, governor: Arc<Governor>) -> Self {
        self.governor = governor;
        self
    }

    pub fn with_time(mut self, clock: Arc<dyn Clock>, sleeper: Arc<dyn Sleeper>) -> Self {
        self.clock = clock;
        self.sleeper = sleeper;
        self
    }

    pub fn with_max_retries(mut self, n: u32) -> Self {
        self.max_retries = n;
        self
    }

    pub fn with_http_client(mut self, http: reqwest::Client) -> Self {
        self.http = http;
        self
    }

    pub fn governor(&self) -> &Arc<Governor> {
        &self.governor
    }

    fn url(&self, segments: &[&str]) -> Result<Url> {
        api_url(&self.base, segments)
    }

    fn repo_url(&self, repo: &RepoId, rest: &[&str]) -> Result<Url> {
        let mut segs: Vec<&str> = vec!["repos", &repo.owner, &repo.name];
        segs.extend_from_slice(rest);
        self.url(&segs)
    }

    fn contents_url(&self, repo: &RepoId, path: &str) -> Result<Url> {
        let mut segs: Vec<&str> = vec!["contents"];
        segs.extend(path.trim_matches('/').split('/').filter(|s| !s.is_empty()));
        self.repo_url(repo, &segs)
    }

    /// Send with governor pacing and rate-limit retries. Returns the final
    /// response whatever its status, except rate limits that outlast the
    /// retry budget, which become [`GitHubError::RateLimited`].
    async fn send(&self, method: Method, url: Url, body: Option<&Value>) -> Result<RawResponse> {
        let mut attempt: u32 = 0;
        loop {
            self.governor
                .acquire(self.clock.as_ref(), self.sleeper.as_ref())
                .await;
            let token = self.tokens.token().await?;
            let mut req = self
                .http
                .request(method.clone(), url.clone())
                .headers(default_headers())
                .bearer_auth(token);
            if let Some(b) = body {
                req = req.json(b);
            }
            let resp = req.send().await?;
            let status = resp.status().as_u16();
            let info = RateLimitInfo::from_headers(resp.headers());
            let bytes = resp.bytes().await?.to_vec();
            let now = self.clock.now_ms();
            let imposed = self.governor.observe_at(now, info);

            let secondary_msg = (status == 403 || status == 429)
                && String::from_utf8_lossy(&bytes)
                    .to_ascii_lowercase()
                    .contains("secondary rate limit");
            let rate_limited = status == 429
                || (status == 403
                    && (info.remaining == Some(0)
                        || info.retry_after_s.is_some()
                        || secondary_msg));
            if !rate_limited {
                return Ok(RawResponse {
                    status,
                    body: bytes,
                });
            }
            let wait = if imposed.is_zero() {
                self.governor.penalize_secondary_at(now, attempt)
            } else {
                imposed
            };
            tracing::warn!(status, ?wait, attempt, %url, "github rate limited");
            if attempt >= self.max_retries {
                return Err(GitHubError::RateLimited { retry_after: wait });
            }
            attempt += 1;
        }
    }

    async fn get_json<T: DeserializeOwned>(&self, url: Url) -> Result<T> {
        self.send(Method::GET, url, None)
            .await?
            .into_result()?
            .json()
    }

    async fn get_optional_json(&self, url: Url) -> Result<Option<Value>> {
        let r = self.send(Method::GET, url, None).await?;
        if r.status == 404 {
            return Ok(None);
        }
        Ok(Some(r.into_result()?.json()?))
    }
}

// ---- wire shapes ----------------------------------------------------------

#[derive(Deserialize)]
struct WireOwner {
    login: String,
}

#[derive(Deserialize)]
struct WireRepo {
    name: String,
    owner: WireOwner,
    default_branch: Option<String>,
    #[serde(default)]
    private: bool,
    #[serde(default)]
    html_url: String,
}

impl From<WireRepo> for RepoInfo {
    fn from(r: WireRepo) -> Self {
        RepoInfo {
            id: RepoId::new(r.owner.login, r.name),
            default_branch: r.default_branch.unwrap_or_else(|| "main".into()),
            private: r.private,
            html_url: r.html_url,
        }
    }
}

#[derive(Deserialize)]
struct WireRef {
    object: WireObject,
}

#[derive(Deserialize)]
struct WireObject {
    sha: String,
}

#[derive(Deserialize)]
struct WireBranchRef {
    #[serde(rename = "ref")]
    ref_name: String,
    sha: String,
}

#[derive(Deserialize)]
struct WireLabel {
    name: String,
}

#[derive(Deserialize)]
struct WirePr {
    number: u64,
    title: String,
    body: Option<String>,
    state: PrState,
    merged: Option<bool>,
    merged_at: Option<String>,
    mergeable: Option<bool>,
    mergeable_state: Option<String>,
    merge_commit_sha: Option<String>,
    head: WireBranchRef,
    base: WireBranchRef,
    #[serde(default)]
    labels: Vec<WireLabel>,
    #[serde(default)]
    html_url: String,
}

impl From<WirePr> for PullRequest {
    fn from(p: WirePr) -> Self {
        PullRequest {
            number: p.number,
            title: p.title,
            body: p.body.unwrap_or_default(),
            state: p.state,
            merged: p.merged.unwrap_or(p.merged_at.is_some()),
            head_ref: p.head.ref_name,
            head_sha: p.head.sha,
            base_ref: p.base.ref_name,
            mergeable: p.mergeable,
            mergeable_state: p.mergeable_state.unwrap_or_else(|| "unknown".into()),
            merge_commit_sha: p.merge_commit_sha,
            labels: p.labels.into_iter().map(|l| l.name).collect(),
            html_url: p.html_url,
        }
    }
}

#[derive(Deserialize)]
struct WireCommit {
    sha: String,
    commit: WireCommitInner,
    #[serde(default)]
    parents: Vec<WireObject>,
    #[serde(default)]
    files: Vec<WireFile>,
}

#[derive(Deserialize)]
struct WireCommitInner {
    message: String,
}

#[derive(Deserialize)]
struct WireFile {
    filename: String,
    status: FileStatus,
    previous_filename: Option<String>,
}

#[derive(Deserialize)]
struct WireWrite {
    content: Option<WireObject>,
    commit: WireObject,
}

#[derive(Deserialize)]
struct WireCheckRuns {
    check_runs: Vec<CheckRun>,
}

#[derive(Deserialize)]
struct WireArtifacts {
    artifacts: Vec<WireArtifact>,
}

#[derive(Deserialize)]
struct WireArtifact {
    id: u64,
    name: String,
    #[serde(default)]
    expired: bool,
}

#[derive(Deserialize)]
struct WireMerge {
    sha: String,
}

#[derive(Deserialize)]
struct WireComment {
    id: u64,
}

fn file_kind(t: &str) -> EntryKind {
    match t {
        "dir" => EntryKind::Dir,
        "symlink" => EntryKind::Symlink,
        "submodule" => EntryKind::Submodule,
        _ => EntryKind::File,
    }
}

#[async_trait]
impl RepoApi for HttpGitHub {
    async fn get_repo(&self, repo: &RepoId) -> Result<RepoInfo> {
        let r: WireRepo = self.get_json(self.repo_url(repo, &[])?).await?;
        Ok(r.into())
    }

    async fn create_repo_from_template(
        &self,
        template: &RepoId,
        new_repo: &NewRepo,
    ) -> Result<RepoInfo> {
        let url = self.repo_url(template, &["generate"])?;
        let body = json!({
            "owner": new_repo.owner,
            "name": new_repo.name,
            "private": new_repo.private,
            "description": new_repo.description,
            "include_all_branches": false,
        });
        let r = self.send(Method::POST, url, Some(&body)).await?;
        if r.status == 422 && r.text().to_ascii_lowercase().contains("already exists") {
            return Err(GitHubError::AlreadyExists(format!(
                "{}/{}",
                new_repo.owner, new_repo.name
            )));
        }
        let w: WireRepo = r.into_result()?.json()?;
        Ok(w.into())
    }

    async fn enable_pages_workflow(&self, repo: &RepoId) -> Result<()> {
        let url = self.repo_url(repo, &["pages"])?;
        let body = json!({ "build_type": "workflow" });
        let r = self.send(Method::POST, url.clone(), Some(&body)).await?;
        if r.ok() {
            return Ok(());
        }
        if r.status == 409 {
            // Pages already exists: switch its source to Actions.
            self.send(Method::PUT, url, Some(&body))
                .await?
                .into_result()?;
            return Ok(());
        }
        Err(map_status(r.status, &r.text()))
    }

    async fn get_branch(&self, repo: &RepoId, branch: &str) -> Result<Option<BranchInfo>> {
        let mut segs = vec!["git", "ref", "heads"];
        segs.extend(branch.split('/'));
        let Some(v) = self.get_optional_json(self.repo_url(repo, &segs)?).await? else {
            return Ok(None);
        };
        // `git/ref` returns an array for prefix matches; treat as absent.
        if v.is_array() {
            return Ok(None);
        }
        let r: WireRef = serde_json::from_value(v)?;
        Ok(Some(BranchInfo {
            name: branch.to_string(),
            sha: r.object.sha,
        }))
    }

    async fn create_branch(&self, repo: &RepoId, branch: &str, from: &str) -> Result<BranchInfo> {
        let sha = if is_full_sha(from) {
            from.to_string()
        } else {
            self.get_branch(repo, from)
                .await?
                .ok_or_else(|| GitHubError::NotFound(format!("branch {from}")))?
                .sha
        };
        let url = self.repo_url(repo, &["git", "refs"])?;
        let body = json!({ "ref": format!("refs/heads/{branch}"), "sha": sha });
        let r = self.send(Method::POST, url, Some(&body)).await?;
        if r.status == 422 && r.text().to_ascii_lowercase().contains("already exists") {
            return Err(GitHubError::AlreadyExists(format!("branch {branch}")));
        }
        r.into_result()?;
        Ok(BranchInfo {
            name: branch.to_string(),
            sha,
        })
    }

    async fn get_commit(&self, repo: &RepoId, sha: &str) -> Result<CommitInfo> {
        let c: WireCommit = self
            .get_json(self.repo_url(repo, &["commits", sha])?)
            .await?;
        Ok(CommitInfo {
            sha: c.sha,
            message: c.commit.message,
            parents: c.parents.into_iter().map(|p| p.sha).collect(),
            files: c
                .files
                .into_iter()
                .map(|f| ChangedFile {
                    path: f.filename,
                    status: f.status,
                    previous_path: f.previous_filename,
                })
                .collect(),
        })
    }

    async fn get_file(
        &self,
        repo: &RepoId,
        git_ref: &str,
        path: &str,
    ) -> Result<Option<FileContent>> {
        let mut url = self.contents_url(repo, path)?;
        url.query_pairs_mut().append_pair("ref", git_ref);
        let Some(v) = self.get_optional_json(url).await? else {
            return Ok(None);
        };
        if v.is_array() {
            return Err(GitHubError::InvalidArgument(format!(
                "{path} is a directory"
            )));
        }
        let kind = v.get("type").and_then(Value::as_str).unwrap_or("file");
        if kind != "file" {
            return Err(GitHubError::InvalidArgument(format!("{path} is a {kind}")));
        }
        let sha = v
            .get("sha")
            .and_then(Value::as_str)
            .ok_or_else(|| GitHubError::Decode("contents: missing sha".into()))?
            .to_string();
        let encoding = v
            .get("encoding")
            .and_then(Value::as_str)
            .unwrap_or("base64");
        let content = if encoding == "base64" {
            decode_b64(v.get("content").and_then(Value::as_str).unwrap_or(""))?
        } else {
            // Files over 1 MB come back with encoding "none": fetch the blob.
            let blob: Value = self
                .get_json(self.repo_url(repo, &["git", "blobs", &sha])?)
                .await?;
            decode_b64(blob.get("content").and_then(Value::as_str).unwrap_or(""))?
        };
        Ok(Some(FileContent {
            path: path.to_string(),
            content,
            sha,
        }))
    }

    async fn list_dir(&self, repo: &RepoId, git_ref: &str, path: &str) -> Result<Vec<DirEntry>> {
        let mut url = self.contents_url(repo, path)?;
        url.query_pairs_mut().append_pair("ref", git_ref);
        let Some(v) = self.get_optional_json(url).await? else {
            return Ok(Vec::new());
        };
        let Value::Array(items) = v else {
            return Err(GitHubError::InvalidArgument(format!(
                "{path} is not a directory"
            )));
        };
        let mut out: Vec<DirEntry> = items
            .iter()
            .map(|i| {
                let s = |k: &str| i.get(k).and_then(Value::as_str).unwrap_or("").to_string();
                DirEntry {
                    name: s("name"),
                    path: s("path"),
                    sha: s("sha"),
                    kind: file_kind(&s("type")),
                }
            })
            .collect();
        out.sort_by(|a, b| a.path.cmp(&b.path));
        Ok(out)
    }

    async fn put_file(&self, repo: &RepoId, req: &PutFile) -> Result<WriteResult> {
        let url = self.contents_url(repo, &req.path)?;
        let mut body = json!({
            "message": req.message,
            "content": b64().encode(&req.content),
            "branch": req.branch,
        });
        if let Some(sha) = &req.expected_sha {
            body["sha"] = json!(sha);
        }
        let r = self.send(Method::PUT, url, Some(&body)).await?;
        if r.status == 409 {
            return Err(GitHubError::Conflict(format!(
                "{}: {}",
                req.path,
                message_of(&r.text())
            )));
        }
        if r.status == 422 && r.text().contains("sha") {
            // "sha" wasn't supplied (file exists) / sha mismatch.
            return Err(GitHubError::Conflict(format!(
                "{}: {}",
                req.path,
                message_of(&r.text())
            )));
        }
        let w: WireWrite = r.into_result()?.json()?;
        Ok(WriteResult {
            content_sha: w.content.map(|c| c.sha),
            commit_sha: w.commit.sha,
        })
    }

    async fn delete_file(&self, repo: &RepoId, req: &DeleteFile) -> Result<WriteResult> {
        let url = self.contents_url(repo, &req.path)?;
        let body = json!({
            "message": req.message,
            "sha": req.expected_sha,
            "branch": req.branch,
        });
        let r = self.send(Method::DELETE, url, Some(&body)).await?;
        if r.status == 409 || (r.status == 422 && r.text().contains("sha")) {
            return Err(GitHubError::Conflict(format!(
                "{}: {}",
                req.path,
                message_of(&r.text())
            )));
        }
        let w: WireWrite = r.into_result()?.json()?;
        Ok(WriteResult {
            content_sha: None,
            commit_sha: w.commit.sha,
        })
    }

    async fn create_pr(&self, repo: &RepoId, pr: &NewPullRequest) -> Result<PullRequest> {
        let url = self.repo_url(repo, &["pulls"])?;
        let body = json!({
            "title": pr.title,
            "head": pr.head,
            "base": pr.base,
            "body": pr.body,
            "draft": pr.draft,
        });
        let r = self.send(Method::POST, url, Some(&body)).await?;
        if r.status == 422 && r.text().contains("already exists") {
            return Err(GitHubError::AlreadyExists(format!(
                "pull request for {}",
                pr.head
            )));
        }
        let w: WirePr = r.into_result()?.json()?;
        Ok(w.into())
    }

    async fn update_pr(
        &self,
        repo: &RepoId,
        number: u64,
        update: &PullRequestUpdate,
    ) -> Result<PullRequest> {
        let n = number.to_string();
        let url = self.repo_url(repo, &["pulls", &n])?;
        let mut body = serde_json::Map::new();
        if let Some(t) = &update.title {
            body.insert("title".into(), json!(t));
        }
        if let Some(b) = &update.body {
            body.insert("body".into(), json!(b));
        }
        if let Some(b) = &update.base {
            body.insert("base".into(), json!(b));
        }
        if let Some(s) = update.state {
            body.insert("state".into(), serde_json::to_value(s)?);
        }
        let w: WirePr = self
            .send(Method::PATCH, url, Some(&Value::Object(body)))
            .await?
            .into_result()?
            .json()?;
        Ok(w.into())
    }

    async fn get_pr(&self, repo: &RepoId, number: u64) -> Result<PullRequest> {
        let n = number.to_string();
        let w: WirePr = self.get_json(self.repo_url(repo, &["pulls", &n])?).await?;
        Ok(w.into())
    }

    async fn find_open_pr(&self, repo: &RepoId, head_branch: &str) -> Result<Option<PullRequest>> {
        let mut url = self.repo_url(repo, &["pulls"])?;
        url.query_pairs_mut()
            .append_pair("state", "open")
            .append_pair("head", &format!("{}:{head_branch}", repo.owner))
            .append_pair("per_page", "10");
        let list: Vec<WirePr> = self.get_json(url).await?;
        Ok(list
            .into_iter()
            .map(PullRequest::from)
            .find(|p| p.head_ref == head_branch))
    }

    async fn comment(&self, repo: &RepoId, number: u64, body: &str) -> Result<u64> {
        let n = number.to_string();
        let url = self.repo_url(repo, &["issues", &n, "comments"])?;
        let c: WireComment = self
            .send(Method::POST, url, Some(&json!({ "body": body })))
            .await?
            .into_result()?
            .json()?;
        Ok(c.id)
    }

    async fn add_labels(&self, repo: &RepoId, number: u64, labels: &[String]) -> Result<()> {
        let n = number.to_string();
        let url = self.repo_url(repo, &["issues", &n, "labels"])?;
        self.send(Method::POST, url, Some(&json!({ "labels": labels })))
            .await?
            .into_result()?;
        Ok(())
    }

    async fn merge_pr(
        &self,
        repo: &RepoId,
        number: u64,
        opts: &MergeOptions,
    ) -> Result<MergeResult> {
        let n = number.to_string();
        let url = self.repo_url(repo, &["pulls", &n, "merge"])?;
        let mut body = json!({ "merge_method": opts.method.as_str() });
        if let Some(s) = &opts.expected_head_sha {
            body["sha"] = json!(s);
        }
        if let Some(t) = &opts.commit_title {
            body["commit_title"] = json!(t);
        }
        if let Some(m) = &opts.commit_message {
            body["commit_message"] = json!(m);
        }
        let r = self.send(Method::PUT, url, Some(&body)).await?;
        match r.status {
            405 => Err(GitHubError::NotMergeable(message_of(&r.text()))),
            409 => Err(GitHubError::Conflict(format!(
                "head moved: {}",
                message_of(&r.text())
            ))),
            _ => {
                let m: WireMerge = r.into_result()?.json()?;
                Ok(MergeResult { sha: m.sha })
            }
        }
    }

    async fn close_pr(&self, repo: &RepoId, number: u64) -> Result<PullRequest> {
        self.update_pr(
            repo,
            number,
            &PullRequestUpdate {
                state: Some(PrState::Closed),
                ..Default::default()
            },
        )
        .await
    }

    async fn list_check_runs(&self, repo: &RepoId, head_sha: &str) -> Result<Vec<CheckRun>> {
        let mut url = self.repo_url(repo, &["commits", head_sha, "check-runs"])?;
        url.query_pairs_mut().append_pair("per_page", "100");
        let w: WireCheckRuns = self.get_json(url).await?;
        Ok(w.check_runs)
    }

    async fn download_artifact(&self, repo: &RepoId, run_id: u64, name: &str) -> Result<Vec<u8>> {
        let run = run_id.to_string();
        let mut url = self.repo_url(repo, &["actions", "runs", &run, "artifacts"])?;
        url.query_pairs_mut()
            .append_pair("name", name)
            .append_pair("per_page", "100");
        let list: WireArtifacts = self.get_json(url).await?;
        let art = list
            .artifacts
            .into_iter()
            .find(|a| a.name == name && !a.expired)
            .ok_or_else(|| GitHubError::NotFound(format!("artifact {name} in run {run_id}")))?;
        let id = art.id.to_string();
        // 302 → short-lived blob-storage URL; reqwest follows it and strips
        // the Authorization header when the redirect leaves the API host.
        let url = self.repo_url(repo, &["actions", "artifacts", &id, "zip"])?;
        Ok(self.send(Method::GET, url, None).await?.into_result()?.body)
    }
}
