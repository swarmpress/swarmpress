//! Plain data types exchanged with [`crate::RepoApi`].

use serde::{Deserialize, Serialize};

/// `owner/name` of a repository.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct RepoId {
    pub owner: String,
    pub name: String,
}

impl RepoId {
    pub fn new(owner: impl Into<String>, name: impl Into<String>) -> Self {
        Self {
            owner: owner.into(),
            name: name.into(),
        }
    }
}

impl std::fmt::Display for RepoId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}/{}", self.owner, self.name)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RepoInfo {
    pub id: RepoId,
    pub default_branch: String,
    pub private: bool,
    pub html_url: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewRepo {
    pub owner: String,
    pub name: String,
    pub private: bool,
    pub description: Option<String>,
}

/// A file read from a ref. `content` is the raw (decoded) bytes; `sha` is
/// the git blob sha, which is what `put_file`/`delete_file` expect back for
/// optimistic concurrency.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileContent {
    pub path: String,
    pub content: Vec<u8>,
    pub sha: String,
}

impl FileContent {
    pub fn text(&self) -> Result<&str, std::str::Utf8Error> {
        std::str::from_utf8(&self.content)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EntryKind {
    File,
    Dir,
    Symlink,
    Submodule,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub sha: String,
    pub kind: EntryKind,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BranchInfo {
    pub name: String,
    /// Head commit sha.
    pub sha: String,
}

/// A git identity (the author or the committer of a commit).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CommitAuthor {
    pub name: String,
    pub email: String,
}

/// Write one file on a branch.
///
/// `expected_sha`:
/// * `None` — create-only; fails with `Conflict` if the file already exists.
/// * `Some(sha)` — update; fails with `Conflict` unless the current blob sha
///   on the branch equals `sha`.
///
/// `author`:
/// * `None` — the authenticated identity (the token's user or the App) is
///   both author and committer.
/// * `Some(a)` — `a` is the git author; the authenticated identity stays the
///   committer (ADR-0056 decision 8: the staff persona writes, swarm.press
///   commits).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PutFile {
    pub branch: String,
    pub path: String,
    pub content: Vec<u8>,
    pub message: String,
    pub expected_sha: Option<String>,
    pub author: Option<CommitAuthor>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeleteFile {
    pub branch: String,
    pub path: String,
    pub message: String,
    pub expected_sha: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WriteResult {
    /// New blob sha (`None` after a delete).
    pub content_sha: Option<String>,
    /// The commit created on the branch.
    pub commit_sha: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FileStatus {
    Added,
    Modified,
    Removed,
    Renamed,
    Copied,
    Changed,
    Unchanged,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChangedFile {
    pub path: String,
    pub status: FileStatus,
    pub previous_path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommitInfo {
    pub sha: String,
    pub message: String,
    pub parents: Vec<String>,
    pub files: Vec<ChangedFile>,
    /// The git author, when the API reports one.
    pub author: Option<CommitAuthor>,
    /// The git committer, when the API reports one.
    pub committer: Option<CommitAuthor>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewPullRequest {
    pub title: String,
    pub head: String,
    pub base: String,
    pub body: String,
    pub draft: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PrState {
    Open,
    Closed,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PullRequestUpdate {
    pub title: Option<String>,
    pub body: Option<String>,
    pub base: Option<String>,
    pub state: Option<PrState>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PullRequest {
    pub number: u64,
    pub title: String,
    pub body: String,
    pub state: PrState,
    pub merged: bool,
    pub head_ref: String,
    pub head_sha: String,
    pub base_ref: String,
    /// `None` while GitHub is still computing mergeability.
    pub mergeable: Option<bool>,
    /// GitHub's `mergeable_state` (`clean`, `dirty`, `blocked`, `unstable`,
    /// `behind`, `unknown`, ...).
    pub mergeable_state: String,
    pub merge_commit_sha: Option<String>,
    pub labels: Vec<String>,
    pub html_url: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum MergeMethod {
    #[default]
    Squash,
    Merge,
    Rebase,
}

impl MergeMethod {
    pub fn as_str(self) -> &'static str {
        match self {
            MergeMethod::Squash => "squash",
            MergeMethod::Merge => "merge",
            MergeMethod::Rebase => "rebase",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct MergeOptions {
    pub method: MergeMethod,
    /// Refuse to merge (Conflict) unless the PR head is exactly this sha —
    /// guarantees we merge what was reviewed.
    pub expected_head_sha: Option<String>,
    pub commit_title: Option<String>,
    pub commit_message: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MergeResult {
    /// The squash (or merge) commit sha on the base branch.
    pub sha: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CheckStatus {
    Queued,
    InProgress,
    Completed,
    Waiting,
    Requested,
    Pending,
    #[serde(other)]
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CheckConclusion {
    Success,
    Failure,
    Neutral,
    Cancelled,
    Skipped,
    TimedOut,
    ActionRequired,
    Stale,
    StartupFailure,
    #[serde(other)]
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CheckRun {
    pub id: u64,
    pub name: String,
    pub head_sha: String,
    pub status: CheckStatus,
    pub conclusion: Option<CheckConclusion>,
    #[serde(default)]
    pub details_url: Option<String>,
}

/// One run of a GitHub Actions workflow (`GET /repos/{o}/{r}/actions/runs`).
///
/// A re-run keeps the run's `id` and counts up `run_attempt`, so
/// `(id, run_attempt)` names one attempt.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorkflowRun {
    pub id: u64,
    #[serde(default)]
    pub name: Option<String>,
    pub head_sha: String,
    /// The workflow file, e.g. `.github/workflows/deploy.yml` (GitHub may
    /// add `@<ref>`).
    #[serde(default)]
    pub path: String,
    /// `push`, `workflow_dispatch`, ...
    #[serde(default)]
    pub event: String,
    pub status: CheckStatus,
    pub conclusion: Option<CheckConclusion>,
    #[serde(default = "first_attempt")]
    pub run_attempt: u32,
}

fn first_attempt() -> u32 {
    1
}

impl WorkflowRun {
    /// The workflow file's name, e.g. `deploy.yml`.
    pub fn workflow_file(&self) -> &str {
        let path = self.path.split('@').next().unwrap_or_default();
        path.rsplit('/').next().unwrap_or(path)
    }
}

impl CheckRun {
    pub fn is_success(&self) -> bool {
        self.status == CheckStatus::Completed
            && matches!(
                self.conclusion,
                Some(CheckConclusion::Success)
                    | Some(CheckConclusion::Neutral)
                    | Some(CheckConclusion::Skipped)
            )
    }
}
