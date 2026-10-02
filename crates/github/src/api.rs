//! The `RepoApi` trait: every repo operation swarm.press performs on GitHub.
//!
//! Implementations: [`crate::HttpGitHub`] (real REST), [`crate::FakeGitHub`]
//! (in-memory, deterministic) and [`crate::GuardedRepo`] (path-policy
//! wrapper around either).

use async_trait::async_trait;

use crate::error::Result;
use crate::snapshot::Snapshot;
use crate::types::*;

#[async_trait]
pub trait RepoApi: Send + Sync {
    // ---- repos ---------------------------------------------------------
    async fn get_repo(&self, repo: &RepoId) -> Result<RepoInfo>;

    /// Generate a new repo from a template repo (`POST /repos/{t}/generate`).
    async fn create_repo_from_template(
        &self,
        template: &RepoId,
        new_repo: &NewRepo,
    ) -> Result<RepoInfo>;

    /// Configure GitHub Pages to build from Actions (`build_type=workflow`).
    /// Idempotent: if Pages already exists it is switched to workflow.
    async fn enable_pages_workflow(&self, repo: &RepoId) -> Result<()>;

    // ---- refs ----------------------------------------------------------
    /// `Ok(None)` when the branch does not exist.
    async fn get_branch(&self, repo: &RepoId, branch: &str) -> Result<Option<BranchInfo>>;

    /// Create `branch` pointing at `from` (a branch name or a full commit
    /// sha). `AlreadyExists` if it exists.
    async fn create_branch(&self, repo: &RepoId, branch: &str, from: &str) -> Result<BranchInfo>;

    async fn get_commit(&self, repo: &RepoId, sha: &str) -> Result<CommitInfo>;

    // ---- contents ------------------------------------------------------
    /// `Ok(None)` when the path does not exist at `git_ref`.
    async fn get_file(
        &self,
        repo: &RepoId,
        git_ref: &str,
        path: &str,
    ) -> Result<Option<FileContent>>;

    /// Immediate children of a directory. Empty when the path does not exist.
    async fn list_dir(&self, repo: &RepoId, git_ref: &str, path: &str) -> Result<Vec<DirEntry>>;

    /// Every text file under `prefix` at `git_ref` (a branch name or a full
    /// commit sha), read in one go, with the commit the ref pointed at.
    /// `prefix` is a directory or file path; empty means the whole repo.
    /// Files that are not UTF-8 text are listed in [`Snapshot::skipped`].
    /// `NotFound` when the ref does not exist; `TooLarge` over the
    /// implementation's caps.
    async fn snapshot(&self, repo: &RepoId, git_ref: &str, prefix: &str) -> Result<Snapshot>;

    async fn put_file(&self, repo: &RepoId, req: &PutFile) -> Result<WriteResult>;

    async fn delete_file(&self, repo: &RepoId, req: &DeleteFile) -> Result<WriteResult>;

    // ---- pull requests -------------------------------------------------
    async fn create_pr(&self, repo: &RepoId, pr: &NewPullRequest) -> Result<PullRequest>;

    async fn update_pr(
        &self,
        repo: &RepoId,
        number: u64,
        update: &PullRequestUpdate,
    ) -> Result<PullRequest>;

    async fn get_pr(&self, repo: &RepoId, number: u64) -> Result<PullRequest>;

    /// The open PR whose head is `head_branch` in this repo, if any.
    async fn find_open_pr(&self, repo: &RepoId, head_branch: &str) -> Result<Option<PullRequest>>;

    /// Issue comment on the PR; returns the comment id.
    async fn comment(&self, repo: &RepoId, number: u64, body: &str) -> Result<u64>;

    async fn add_labels(&self, repo: &RepoId, number: u64, labels: &[String]) -> Result<()>;

    async fn merge_pr(
        &self,
        repo: &RepoId,
        number: u64,
        opts: &MergeOptions,
    ) -> Result<MergeResult>;

    async fn close_pr(&self, repo: &RepoId, number: u64) -> Result<PullRequest>;

    // ---- checks / actions ----------------------------------------------
    async fn list_check_runs(&self, repo: &RepoId, head_sha: &str) -> Result<Vec<CheckRun>>;

    /// Download the zip of the named artifact of a workflow run.
    async fn download_artifact(&self, repo: &RepoId, run_id: u64, name: &str) -> Result<Vec<u8>>;

    // ---- gateway additions (ADR-0061) ----------------------------------
    /// Delete `branch`. `Ok(false)` when it did not exist. GitHub closes
    /// the open pull requests whose head it was.
    async fn delete_branch(&self, repo: &RepoId, branch: &str) -> Result<bool>;
}
