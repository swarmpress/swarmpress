//! Repo operations: drafts are PR branches, merge is the publish step.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use agents::MaybeSendSync;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// A repo operation failed (network, conflict, policy). The job can be
/// retried; both operations are idempotent.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("gateway: {0}")]
pub struct GatewayError(pub String);

/// The draft PR of one content id.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DraftPr {
    pub number: u64,
    /// The draft branch (`drafts/content-<content_id>` for `github::ContentRepo`
    /// and [`FakeGateway`]).
    pub branch: String,
    /// Head commit after this call (hex).
    pub head_sha: String,
}

/// Content repo access. In the browser this is an HTTP client of the central
/// gateway (`POST /api/gateway/draft|merge`, PathPolicy server-side).
#[cfg_attr(not(target_arch = "wasm32"), async_trait)]
#[cfg_attr(target_arch = "wasm32", async_trait(?Send))]
pub trait Gateway: MaybeSendSync {
    /// Commit `page` to `path` on its draft branch and open (or reuse)
    /// its PR against the base branch.
    async fn open_draft(
        &self,
        content_id: &str,
        path: &str,
        page: &Value,
        message: &str,
    ) -> Result<DraftPr, GatewayError>;

    /// Squash-merge PR `pr_number` if its head is still `head_sha`; returns the
    /// merge commit sha. Merging an already merged PR returns its sha.
    async fn merge(&self, pr_number: u64, head_sha: &str) -> Result<String, GatewayError>;
}

#[cfg_attr(not(target_arch = "wasm32"), async_trait)]
#[cfg_attr(target_arch = "wasm32", async_trait(?Send))]
impl<T: Gateway + ?Sized> Gateway for Arc<T> {
    async fn open_draft(
        &self,
        content_id: &str,
        path: &str,
        page: &Value,
        message: &str,
    ) -> Result<DraftPr, GatewayError> {
        (**self).open_draft(content_id, path, page, message).await
    }
    async fn merge(&self, pr_number: u64, head_sha: &str) -> Result<String, GatewayError> {
        (**self).merge(pr_number, head_sha).await
    }
}

/// A PR in [`FakeGateway`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FakePr {
    pub number: u64,
    pub branch: String,
    pub head_sha: String,
    pub merged_sha: Option<String>,
}

#[derive(Debug, Default)]
struct FakeState {
    /// branch → path → file text ("main" is the base branch).
    files: BTreeMap<String, BTreeMap<String, String>>,
    /// branch → head sha
    heads: BTreeMap<String, String>,
    prs: BTreeMap<u64, FakePr>,
    commits: u64,
    merges: u32,
}

/// In-memory [`Gateway`]: branches, files and PRs in `BTreeMap`s, with
/// deterministic fake shas. Base branch is `main`.
#[derive(Debug, Default)]
pub struct FakeGateway {
    state: Mutex<FakeState>,
}

fn fake_sha(parts: &[&str]) -> String {
    let joined = parts.join("\u{0}");
    let a = xxhash_rust::xxh3::xxh3_128(joined.as_bytes());
    let b = xxhash_rust::xxh3::xxh3_64_with_seed(joined.as_bytes(), 1);
    format!("{a:032x}{:08x}", b >> 32)
}

impl FakeGateway {
    pub fn new() -> Self {
        Self::default()
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, FakeState> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Head sha of a branch, if it exists.
    pub fn branch_head(&self, branch: &str) -> Option<String> {
        self.lock().heads.get(branch).cloned()
    }

    /// File text on a branch (`"main"` for the published tree).
    pub fn file_text(&self, branch: &str, path: &str) -> Option<String> {
        self.lock().files.get(branch)?.get(path).cloned()
    }

    pub fn pr(&self, number: u64) -> Option<FakePr> {
        self.lock().prs.get(&number).cloned()
    }

    /// How many merges actually happened (idempotent retries don't count).
    pub fn merge_count(&self) -> u32 {
        self.lock().merges
    }
}

#[cfg_attr(not(target_arch = "wasm32"), async_trait)]
#[cfg_attr(target_arch = "wasm32", async_trait(?Send))]
impl Gateway for FakeGateway {
    async fn open_draft(
        &self,
        content_id: &str,
        path: &str,
        page: &Value,
        message: &str,
    ) -> Result<DraftPr, GatewayError> {
        if content_id.is_empty()
            || !content_id
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        {
            return Err(GatewayError(format!("invalid content id {content_id:?}")));
        }
        if !path.starts_with("content/") || path.contains("..") {
            return Err(GatewayError(format!("path outside content/: {path}")));
        }
        // Same naming as `github::ContentRepo::draft_branch`.
        let branch = format!("drafts/content-{content_id}");
        let text =
            serde_json::to_string_pretty(page).map_err(|e| GatewayError(e.to_string()))? + "\n";
        let mut s = self.lock();
        let unchanged = s
            .files
            .get(&branch)
            .and_then(|f| f.get(path))
            .is_some_and(|t| *t == text);
        if !unchanged || !s.heads.contains_key(&branch) {
            s.commits += 1;
            let n = s.commits.to_string();
            let sha = fake_sha(&[&branch, path, &text, message, &n]);
            let base = s.files.get("main").cloned().unwrap_or_default();
            s.files
                .entry(branch.clone())
                .or_insert(base)
                .insert(path.to_string(), text);
            s.heads.insert(branch.clone(), sha);
        }
        let head = s.heads[&branch].clone();
        let open = s
            .prs
            .values()
            .find(|p| p.branch == branch && p.merged_sha.is_none())
            .map(|p| p.number);
        let number = match open {
            Some(n) => n,
            None => {
                let n = s.prs.keys().next_back().copied().unwrap_or(0) + 1;
                s.prs.insert(
                    n,
                    FakePr {
                        number: n,
                        branch: branch.clone(),
                        head_sha: head.clone(),
                        merged_sha: None,
                    },
                );
                n
            }
        };
        if let Some(p) = s.prs.get_mut(&number) {
            p.head_sha = head.clone();
        }
        Ok(DraftPr {
            number,
            branch,
            head_sha: head,
        })
    }

    async fn merge(&self, pr_number: u64, head_sha: &str) -> Result<String, GatewayError> {
        let mut s = self.lock();
        let pr = s
            .prs
            .get(&pr_number)
            .cloned()
            .ok_or_else(|| GatewayError(format!("no PR #{pr_number}")))?;
        if pr.head_sha != head_sha {
            return Err(GatewayError(format!(
                "PR #{pr_number} head is {} not {head_sha}",
                pr.head_sha
            )));
        }
        if let Some(sha) = pr.merged_sha {
            return Ok(sha);
        }
        let branch_files = s.files.get(&pr.branch).cloned().unwrap_or_default();
        let main = s.files.entry("main".into()).or_default();
        main.extend(branch_files);
        let sha = fake_sha(&["merge", &pr.branch, head_sha]);
        s.heads.insert("main".into(), sha.clone());
        s.merges += 1;
        if let Some(p) = s.prs.get_mut(&pr_number) {
            p.merged_sha = Some(sha.clone());
        }
        Ok(sha)
    }
}

/// [`Gateway`] over the GitHub client (`github::ContentRepo`): direct repo
/// access for the server (Agency jobs) and native tests with `FakeGitHub`.
#[cfg(not(target_arch = "wasm32"))]
#[derive(Clone)]
pub struct GithubGateway {
    repo: github::ContentRepo,
}

#[cfg(not(target_arch = "wasm32"))]
impl GithubGateway {
    pub fn new(
        api: Arc<dyn github::RepoApi>,
        repo: github::RepoId,
        base_branch: impl Into<String>,
    ) -> Self {
        Self {
            repo: github::ContentRepo::new(api, repo, base_branch),
        }
    }

    pub fn from_content_repo(repo: github::ContentRepo) -> Self {
        Self { repo }
    }
}

#[cfg(not(target_arch = "wasm32"))]
#[async_trait]
impl Gateway for GithubGateway {
    async fn open_draft(
        &self,
        content_id: &str,
        path: &str,
        page: &Value,
        message: &str,
    ) -> Result<DraftPr, GatewayError> {
        let pr = self
            .repo
            .open_draft(content_id, path, page, message)
            .await
            .map_err(|e| GatewayError(format!("open draft PR: {e}")))?;
        Ok(DraftPr {
            number: pr.pr.number,
            branch: pr.branch,
            head_sha: pr.pr.head_sha,
        })
    }

    async fn merge(&self, pr_number: u64, head_sha: &str) -> Result<String, GatewayError> {
        self.repo
            .merge_draft(pr_number, head_sha)
            .await
            .map(|m| m.sha)
            .map_err(|e| GatewayError(format!("merge PR #{pr_number}: {e}")))
    }
}
