//! Path guard: which actor kind may write which paths and branches.
//!
//! * Content agents may write only `content/**`.
//! * Design agents may write only `theme/**`.
//! * Nobody but the platform bot may write `.github/**`, `package.json`,
//!   `pnpm-lock.yaml`, `package-lock.json` or `site.manifest.json` — at any
//!   depth, compared case-insensitively — even inside an otherwise allowed
//!   root (so a design agent cannot touch `theme/package.json`).
//! * Non-bot actors may only write on their own branch prefixes
//!   (`drafts/` for content, `design/` for design) — never on `main`.
//! * Repo-level operations (merge, close, template, Pages) are bot-only:
//!   the orchestrator merges, agents never do.
//!
//! [`GuardedRepo`] enforces this in front of any [`RepoApi`].

use std::sync::Arc;

use async_trait::async_trait;

use crate::api::RepoApi;
use crate::error::{GitHubError, Result};
use crate::types::*;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ActorKind {
    /// Writers, editors, SEO, linker, media: page and collection JSON.
    ContentAgent,
    /// Art director, front-end dev: the agent-authored theme.
    DesignAgent,
    /// The platform/orchestrator identity. Unrestricted.
    PlatformBot,
}

impl ActorKind {
    pub fn as_str(self) -> &'static str {
        match self {
            ActorKind::ContentAgent => "content-agent",
            ActorKind::DesignAgent => "design-agent",
            ActorKind::PlatformBot => "platform-bot",
        }
    }
}

/// File names only the platform bot may write, wherever they appear.
const PROTECTED_FILE_NAMES: &[&str] = &[
    "package.json",
    "pnpm-lock.yaml",
    "package-lock.json",
    "site.manifest.json",
];

/// Directory segments only the platform bot may write under.
const PROTECTED_DIRS: &[&str] = &[".github"];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PathPolicy {
    pub content_roots: Vec<String>,
    pub design_roots: Vec<String>,
    pub content_branch_prefixes: Vec<String>,
    pub design_branch_prefixes: Vec<String>,
}

impl Default for PathPolicy {
    fn default() -> Self {
        Self {
            content_roots: vec!["content".into()],
            design_roots: vec!["theme".into()],
            content_branch_prefixes: vec!["drafts/".into()],
            design_branch_prefixes: vec!["design/".into()],
        }
    }
}

/// Normalise a repo path, rejecting anything that could escape or alias:
/// absolute paths, `..`/`.` segments, empty segments, backslashes, NUL.
pub fn normalize_path(path: &str) -> Result<String> {
    let bad = |why: &str| GitHubError::InvalidArgument(format!("path {path:?}: {why}"));
    if path.is_empty() {
        return Err(bad("empty"));
    }
    if path.starts_with('/') {
        return Err(bad("absolute paths are not allowed"));
    }
    if path.contains('\\') || path.contains('\0') {
        return Err(bad("backslash or NUL"));
    }
    let trimmed = path.strip_suffix('/').unwrap_or(path);
    for seg in trimmed.split('/') {
        match seg {
            "" => return Err(bad("empty segment")),
            "." | ".." => return Err(bad("relative segment")),
            _ => {}
        }
    }
    Ok(trimmed.to_string())
}

fn under_root(path: &str, root: &str) -> bool {
    path.strip_prefix(root)
        .is_some_and(|rest| rest.starts_with('/') && rest.len() > 1)
}

/// True if only the platform bot may write `path` (already normalised).
pub fn is_protected(path: &str) -> bool {
    let segs: Vec<String> = path.split('/').map(|s| s.to_ascii_lowercase()).collect();
    let dir_hit = segs[..segs.len().saturating_sub(1)]
        .iter()
        .any(|s| PROTECTED_DIRS.contains(&s.as_str()));
    let name_hit = segs
        .last()
        .is_some_and(|n| PROTECTED_FILE_NAMES.contains(&n.as_str()));
    // `.github` as the file itself (e.g. a file literally named .github)
    let self_hit = segs
        .last()
        .is_some_and(|n| PROTECTED_DIRS.contains(&n.as_str()));
    dir_hit || name_hit || self_hit
}

impl PathPolicy {
    fn deny(actor: ActorKind, reason: String) -> GitHubError {
        GitHubError::PolicyDenied {
            actor: actor.as_str().into(),
            reason,
        }
    }

    /// Check that `actor` may write `path`. Returns the normalised path.
    pub fn check_write(&self, actor: ActorKind, path: &str) -> Result<String> {
        let p = normalize_path(path)?;
        if actor == ActorKind::PlatformBot {
            return Ok(p);
        }
        if is_protected(&p) {
            return Err(Self::deny(
                actor,
                format!("{p} is platform-owned (bot only)"),
            ));
        }
        let roots = match actor {
            ActorKind::ContentAgent => &self.content_roots,
            ActorKind::DesignAgent => &self.design_roots,
            ActorKind::PlatformBot => unreachable!(),
        };
        if roots.iter().any(|r| under_root(&p, r)) {
            Ok(p)
        } else {
            Err(Self::deny(
                actor,
                format!("{p} is outside {}", roots.join(", ")),
            ))
        }
    }

    /// Check that `actor` may create or write to `branch`.
    pub fn check_branch(&self, actor: ActorKind, branch: &str) -> Result<()> {
        validate_branch_name(branch)?;
        let prefixes = match actor {
            ActorKind::PlatformBot => return Ok(()),
            ActorKind::ContentAgent => &self.content_branch_prefixes,
            ActorKind::DesignAgent => &self.design_branch_prefixes,
        };
        if prefixes
            .iter()
            .any(|pre| branch.starts_with(pre.as_str()) && branch.len() > pre.len())
        {
            Ok(())
        } else {
            Err(Self::deny(
                actor,
                format!("branch {branch} must start with {}", prefixes.join(" or ")),
            ))
        }
    }

    /// Repo-level actions (merge, close, template, Pages) are bot-only.
    pub fn check_admin(&self, actor: ActorKind, op: &str) -> Result<()> {
        if actor == ActorKind::PlatformBot {
            Ok(())
        } else {
            Err(Self::deny(
                actor,
                format!("{op} is reserved for the platform bot"),
            ))
        }
    }
}

/// Conservative subset of git's ref-name rules.
pub fn validate_branch_name(branch: &str) -> Result<()> {
    let bad = |why: &str| GitHubError::InvalidArgument(format!("branch {branch:?}: {why}"));
    if branch.is_empty() || branch.len() > 200 {
        return Err(bad("empty or too long"));
    }
    if branch.starts_with('/') || branch.ends_with('/') || branch.ends_with(".lock") {
        return Err(bad("bad start/end"));
    }
    if branch.contains("..") || branch.contains("//") || branch.contains("@{") {
        return Err(bad("forbidden sequence"));
    }
    if !branch
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '/' | '-' | '_' | '.'))
    {
        return Err(bad("only [A-Za-z0-9/._-] allowed"));
    }
    if branch
        .split('/')
        .any(|s| s.starts_with('.') || s.is_empty())
    {
        return Err(bad("segment starts with '.'"));
    }
    Ok(())
}

/// A [`RepoApi`] that enforces [`PathPolicy`] for one actor kind before
/// delegating. Reads always pass through.
#[derive(Clone)]
pub struct GuardedRepo {
    inner: Arc<dyn RepoApi>,
    actor: ActorKind,
    policy: PathPolicy,
}

impl GuardedRepo {
    pub fn new(inner: Arc<dyn RepoApi>, actor: ActorKind) -> Self {
        Self::with_policy(inner, actor, PathPolicy::default())
    }

    pub fn with_policy(inner: Arc<dyn RepoApi>, actor: ActorKind, policy: PathPolicy) -> Self {
        Self {
            inner,
            actor,
            policy,
        }
    }

    pub fn actor(&self) -> ActorKind {
        self.actor
    }

    pub fn policy(&self) -> &PathPolicy {
        &self.policy
    }
}

#[async_trait]
impl RepoApi for GuardedRepo {
    async fn get_repo(&self, repo: &RepoId) -> Result<RepoInfo> {
        self.inner.get_repo(repo).await
    }

    async fn create_repo_from_template(
        &self,
        template: &RepoId,
        new_repo: &NewRepo,
    ) -> Result<RepoInfo> {
        self.policy
            .check_admin(self.actor, "create_repo_from_template")?;
        self.inner
            .create_repo_from_template(template, new_repo)
            .await
    }

    async fn enable_pages_workflow(&self, repo: &RepoId) -> Result<()> {
        self.policy
            .check_admin(self.actor, "enable_pages_workflow")?;
        self.inner.enable_pages_workflow(repo).await
    }

    async fn get_branch(&self, repo: &RepoId, branch: &str) -> Result<Option<BranchInfo>> {
        self.inner.get_branch(repo, branch).await
    }

    async fn create_branch(&self, repo: &RepoId, branch: &str, from: &str) -> Result<BranchInfo> {
        self.policy.check_branch(self.actor, branch)?;
        self.inner.create_branch(repo, branch, from).await
    }

    async fn get_commit(&self, repo: &RepoId, sha: &str) -> Result<CommitInfo> {
        self.inner.get_commit(repo, sha).await
    }

    async fn get_file(
        &self,
        repo: &RepoId,
        git_ref: &str,
        path: &str,
    ) -> Result<Option<FileContent>> {
        self.inner.get_file(repo, git_ref, path).await
    }

    async fn list_dir(&self, repo: &RepoId, git_ref: &str, path: &str) -> Result<Vec<DirEntry>> {
        self.inner.list_dir(repo, git_ref, path).await
    }

    async fn put_file(&self, repo: &RepoId, req: &PutFile) -> Result<WriteResult> {
        self.policy.check_branch(self.actor, &req.branch)?;
        let path = self.policy.check_write(self.actor, &req.path)?;
        let req = PutFile {
            path,
            ..req.clone()
        };
        self.inner.put_file(repo, &req).await
    }

    async fn delete_file(&self, repo: &RepoId, req: &DeleteFile) -> Result<WriteResult> {
        self.policy.check_branch(self.actor, &req.branch)?;
        let path = self.policy.check_write(self.actor, &req.path)?;
        let req = DeleteFile {
            path,
            ..req.clone()
        };
        self.inner.delete_file(repo, &req).await
    }

    async fn create_pr(&self, repo: &RepoId, pr: &NewPullRequest) -> Result<PullRequest> {
        self.policy.check_branch(self.actor, &pr.head)?;
        self.inner.create_pr(repo, pr).await
    }

    async fn update_pr(
        &self,
        repo: &RepoId,
        number: u64,
        update: &PullRequestUpdate,
    ) -> Result<PullRequest> {
        if update.state.is_some() || update.base.is_some() {
            self.policy
                .check_admin(self.actor, "changing PR state or base")?;
        }
        self.inner.update_pr(repo, number, update).await
    }

    async fn get_pr(&self, repo: &RepoId, number: u64) -> Result<PullRequest> {
        self.inner.get_pr(repo, number).await
    }

    async fn find_open_pr(&self, repo: &RepoId, head_branch: &str) -> Result<Option<PullRequest>> {
        self.inner.find_open_pr(repo, head_branch).await
    }

    async fn comment(&self, repo: &RepoId, number: u64, body: &str) -> Result<u64> {
        self.inner.comment(repo, number, body).await
    }

    async fn add_labels(&self, repo: &RepoId, number: u64, labels: &[String]) -> Result<()> {
        self.inner.add_labels(repo, number, labels).await
    }

    async fn merge_pr(
        &self,
        repo: &RepoId,
        number: u64,
        opts: &MergeOptions,
    ) -> Result<MergeResult> {
        self.policy.check_admin(self.actor, "merge_pr")?;
        self.inner.merge_pr(repo, number, opts).await
    }

    async fn close_pr(&self, repo: &RepoId, number: u64) -> Result<PullRequest> {
        self.policy.check_admin(self.actor, "close_pr")?;
        self.inner.close_pr(repo, number).await
    }

    async fn list_check_runs(&self, repo: &RepoId, head_sha: &str) -> Result<Vec<CheckRun>> {
        self.inner.list_check_runs(repo, head_sha).await
    }

    async fn download_artifact(&self, repo: &RepoId, run_id: u64, name: &str) -> Result<Vec<u8>> {
        self.inner.download_artifact(repo, run_id, name).await
    }
}
