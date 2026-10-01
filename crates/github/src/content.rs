//! `ContentRepo`: the content/theme convenience layer, carrying over the
//! legacy `RepoClient` semantics (`getPageByPath`, drafts branch
//! `drafts/content-{id}`, one PR per piece, squash merge) onto [`RepoApi`].
//!
//! Every operation is **idempotent** so the job queue can retry freely:
//! re-opening a draft reuses the branch and the open PR and skips the
//! commit when the page bytes are unchanged; merging an already merged PR
//! returns its merge commit.
//!
//! Wrap the inner API in a [`crate::GuardedRepo`] to enforce the path
//! policy: agents get `ContentAgent`/`DesignAgent`, the orchestrator (which
//! merges) uses `PlatformBot`.

use std::sync::Arc;

use serde_json::Value;

use crate::api::RepoApi;
use crate::error::{GitHubError, Result};
use crate::policy::{normalize_path, validate_branch_name};
use crate::types::*;

/// How many times a write is retried after an optimistic-concurrency
/// conflict (re-reading the sha each time).
const CONFLICT_RETRIES: usize = 3;

#[derive(Debug, Clone, PartialEq)]
pub struct VersionedJson {
    pub value: Value,
    pub sha: String,
}

/// Result of [`ContentRepo::open_draft`] / [`ContentRepo::open_design_pr`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DraftPr {
    pub branch: String,
    pub pr: PullRequest,
    /// Commit created by this call; `None` when the content was unchanged.
    pub commit_sha: Option<String>,
    pub created_branch: bool,
    pub created_pr: bool,
}

#[derive(Clone)]
pub struct ContentRepo {
    api: Arc<dyn RepoApi>,
    repo: RepoId,
    base: String,
}

fn validate_id(kind: &str, id: &str) -> Result<()> {
    if id.is_empty()
        || id.len() > 100
        || !id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(GitHubError::InvalidArgument(format!(
            "{kind} {id:?} must match [A-Za-z0-9_-]{{1,100}}"
        )));
    }
    Ok(())
}

/// Canonical on-disk JSON: pretty-printed, trailing newline. Stable bytes
/// are what make "unchanged → no commit" work.
pub fn page_bytes(page: &Value) -> Result<Vec<u8>> {
    let mut s = serde_json::to_string_pretty(page)?;
    s.push('\n');
    Ok(s.into_bytes())
}

impl ContentRepo {
    pub fn new(api: Arc<dyn RepoApi>, repo: RepoId, base_branch: impl Into<String>) -> Self {
        Self {
            api,
            repo,
            base: base_branch.into(),
        }
    }

    pub fn repo(&self) -> &RepoId {
        &self.repo
    }

    pub fn base_branch(&self) -> &str {
        &self.base
    }

    pub fn api(&self) -> &Arc<dyn RepoApi> {
        &self.api
    }

    pub fn draft_branch(content_id: &str) -> Result<String> {
        validate_id("content id", content_id)?;
        Ok(format!("drafts/content-{content_id}"))
    }

    pub fn design_branch(project: &str) -> Result<String> {
        validate_id("project", project)?;
        Ok(format!("design/{project}"))
    }

    // ---- reads ---------------------------------------------------------

    /// Page JSON at `path` on the base branch. `NotFound` if absent.
    pub async fn read_page(&self, path: &str) -> Result<Value> {
        self.read_page_at(&self.base, path)
            .await?
            .map(|v| v.value)
            .ok_or_else(|| GitHubError::NotFound(format!("{path} on {}", self.base)))
    }

    /// Page JSON plus blob sha at any ref; `None` if absent.
    pub async fn read_page_at(&self, git_ref: &str, path: &str) -> Result<Option<VersionedJson>> {
        let path = normalize_path(path)?;
        let Some(f) = self.api.get_file(&self.repo, git_ref, &path).await? else {
            return Ok(None);
        };
        let value = serde_json::from_slice(&f.content)
            .map_err(|e| GitHubError::Decode(format!("{path}: {e}")))?;
        Ok(Some(VersionedJson { value, sha: f.sha }))
    }

    // ---- shared building blocks ----------------------------------------

    /// Ensure `branch` exists (created from base). Returns whether it was created.
    async fn ensure_branch(&self, branch: &str) -> Result<(BranchInfo, bool)> {
        validate_branch_name(branch)?;
        if let Some(b) = self.api.get_branch(&self.repo, branch).await? {
            return Ok((b, false));
        }
        match self.api.create_branch(&self.repo, branch, &self.base).await {
            Ok(b) => Ok((b, true)),
            Err(GitHubError::AlreadyExists(_)) => {
                // Lost a race with a concurrent attempt: reuse theirs.
                let b = self
                    .api
                    .get_branch(&self.repo, branch)
                    .await?
                    .ok_or_else(|| GitHubError::NotFound(format!("branch {branch}")))?;
                Ok((b, false))
            }
            Err(e) => Err(e),
        }
    }

    /// Write `bytes` at `path` on `branch` unless already identical.
    /// Retries on optimistic-concurrency conflicts by re-reading the sha.
    async fn upsert_file(
        &self,
        branch: &str,
        path: &str,
        bytes: &[u8],
        message: &str,
    ) -> Result<Option<String>> {
        let mut attempt = 0;
        loop {
            let current = self.api.get_file(&self.repo, branch, path).await?;
            if current.as_ref().is_some_and(|c| c.content == bytes) {
                return Ok(None);
            }
            let req = PutFile {
                branch: branch.to_string(),
                path: path.to_string(),
                content: bytes.to_vec(),
                message: message.to_string(),
                expected_sha: current.map(|c| c.sha),
            };
            match self.api.put_file(&self.repo, &req).await {
                Ok(w) => return Ok(Some(w.commit_sha)),
                Err(GitHubError::Conflict(_)) if attempt < CONFLICT_RETRIES => attempt += 1,
                Err(e) => return Err(e),
            }
        }
    }

    /// Reuse the open PR for `branch` or open a new one.
    async fn ensure_pr(
        &self,
        branch: &str,
        title: &str,
        body: &str,
    ) -> Result<(PullRequest, bool)> {
        if let Some(pr) = self.api.find_open_pr(&self.repo, branch).await? {
            return Ok((pr, false));
        }
        let new = NewPullRequest {
            title: title.to_string(),
            head: branch.to_string(),
            base: self.base.clone(),
            body: body.to_string(),
            draft: false,
        };
        match self.api.create_pr(&self.repo, &new).await {
            Ok(pr) => Ok((pr, true)),
            Err(GitHubError::AlreadyExists(_)) => self
                .api
                .find_open_pr(&self.repo, branch)
                .await?
                .map(|pr| (pr, false))
                .ok_or_else(|| GitHubError::NotFound(format!("open PR for {branch}"))),
            Err(e) => Err(e),
        }
    }

    // ---- content drafts ------------------------------------------------

    /// Commit `page_json` at `path` on `drafts/content-{content_id}` and make
    /// sure a PR into the base branch is open. Idempotent.
    pub async fn open_draft(
        &self,
        content_id: &str,
        path: &str,
        page_json: &Value,
        message: &str,
    ) -> Result<DraftPr> {
        let branch = Self::draft_branch(content_id)?;
        let path = normalize_path(path)?;
        let bytes = page_bytes(page_json)?;
        let (_, created_branch) = self.ensure_branch(&branch).await?;
        let commit_sha = self.upsert_file(&branch, &path, &bytes, message).await?;
        let title = message.lines().next().unwrap_or(message);
        let body = format!("Draft for content `{content_id}`.\n\nPage: `{path}`");
        let (mut pr, created_pr) = self.ensure_pr(&branch, title, &body).await?;
        if commit_sha.is_some() && !created_pr {
            // The PR view we got may predate our commit; refresh head sha.
            pr = self.api.get_pr(&self.repo, pr.number).await?;
        }
        Ok(DraftPr {
            branch,
            pr,
            commit_sha,
            created_branch,
            created_pr,
        })
    }

    /// Squash-merge a draft PR, refusing if its head is not `expected_head_sha`
    /// (i.e. not what was reviewed). Idempotent: an already merged PR
    /// returns its merge commit.
    pub async fn merge_draft(
        &self,
        pr_number: u64,
        expected_head_sha: &str,
    ) -> Result<MergeResult> {
        let pr = self.api.get_pr(&self.repo, pr_number).await?;
        if pr.merged {
            if pr.head_sha != expected_head_sha {
                return Err(GitHubError::Conflict(format!(
                    "PR #{pr_number} was merged at {} not {expected_head_sha}",
                    pr.head_sha
                )));
            }
            return pr
                .merge_commit_sha
                .map(|sha| MergeResult { sha })
                .ok_or_else(|| GitHubError::Decode("merged PR without merge sha".into()));
        }
        self.api
            .merge_pr(
                &self.repo,
                pr_number,
                &MergeOptions {
                    method: MergeMethod::Squash,
                    expected_head_sha: Some(expected_head_sha.to_string()),
                    commit_title: Some(format!("{} (#{pr_number})", pr.title)),
                    commit_message: None,
                },
            )
            .await
    }

    // ---- theme / design flow -------------------------------------------

    /// Ensure `design/{project}` exists (from base). Idempotent.
    pub async fn open_design_branch(&self, project: &str) -> Result<BranchInfo> {
        let branch = Self::design_branch(project)?;
        Ok(self.ensure_branch(&branch).await?.0)
    }

    /// Commit theme files on `design/{project}` (one commit per changed
    /// file; unchanged files are skipped). Returns the last commit sha, or
    /// `None` if nothing changed.
    pub async fn commit_design_files(
        &self,
        project: &str,
        files: &[(String, Vec<u8>)],
        message: &str,
    ) -> Result<Option<String>> {
        let branch = Self::design_branch(project)?;
        self.ensure_branch(&branch).await?;
        let mut last = None;
        for (path, bytes) in files {
            let path = normalize_path(path)?;
            if let Some(sha) = self.upsert_file(&branch, &path, bytes, message).await? {
                last = Some(sha);
            }
        }
        Ok(last)
    }

    /// Ensure an open PR for `design/{project}`. Idempotent.
    pub async fn open_design_pr(&self, project: &str, title: &str, body: &str) -> Result<DraftPr> {
        let branch = Self::design_branch(project)?;
        let (_, created_branch) = self.ensure_branch(&branch).await?;
        let (pr, created_pr) = self.ensure_pr(&branch, title, body).await?;
        Ok(DraftPr {
            branch,
            pr,
            commit_sha: None,
            created_branch,
            created_pr,
        })
    }
}
