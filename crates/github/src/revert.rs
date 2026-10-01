//! Revert helper: open a PR that undoes a squash commit.
//!
//! GitHub's REST API has no revert endpoint, so this is built from the
//! primitive [`RepoApi`] operations and therefore works identically against
//! [`crate::FakeGitHub`] and [`crate::HttpGitHub`]. It is used for the
//! post-deploy smoke failure path (plan section B, step 8).

use crate::api::RepoApi;
use crate::error::{GitHubError, Result};
use crate::types::*;

/// Branch name used for the revert of `commit_sha`.
pub fn revert_branch_name(commit_sha: &str) -> String {
    let short: String = commit_sha.chars().take(12).collect();
    format!("revert/{short}")
}

/// Open (or reuse) a PR against `base` that reverts the single-parent
/// (squash) commit `commit_sha`.
///
/// Safety: every file touched by the commit must still be byte-identical on
/// `base` to what the commit wrote; otherwise later work would be clobbered
/// and the helper returns [`GitHubError::Conflict`] instead.
pub async fn open_revert_pr(
    api: &dyn RepoApi,
    repo: &RepoId,
    commit_sha: &str,
    base: &str,
) -> Result<PullRequest> {
    let commit = api.get_commit(repo, commit_sha).await?;
    let parent = match commit.parents.as_slice() {
        [p] => p.clone(),
        other => {
            return Err(GitHubError::InvalidArgument(format!(
                "can only revert single-parent (squash) commits; {commit_sha} has {} parents",
                other.len()
            )))
        }
    };
    let branch = revert_branch_name(&commit.sha);

    if let Some(pr) = api.find_open_pr(repo, &branch).await? {
        return Ok(pr);
    }

    // Verify base still carries the commit's version of every touched file.
    for f in &commit.files {
        let at_commit = api.get_file(repo, &commit.sha, &f.path).await?;
        let at_base = api.get_file(repo, base, &f.path).await?;
        let same = match (&at_commit, &at_base) {
            (None, None) => true,
            (Some(a), Some(b)) => a.sha == b.sha,
            _ => false,
        };
        if !same {
            return Err(GitHubError::Conflict(format!(
                "{} changed on {base} after {}; refusing automatic revert",
                f.path, commit.sha
            )));
        }
    }

    match api.create_branch(repo, &branch, base).await {
        Ok(_) | Err(GitHubError::AlreadyExists(_)) => {}
        Err(e) => return Err(e),
    }

    let subject = commit.message.lines().next().unwrap_or("").to_string();
    let msg = format!(
        "Revert \"{subject}\"\n\nThis reverts commit {}.",
        commit.sha
    );

    for f in &commit.files {
        // The path the commit wrote: remove or restore it.
        restore_path(api, repo, &branch, &parent, &f.path, &msg).await?;
        if let Some(prev) = &f.previous_path {
            restore_path(api, repo, &branch, &parent, prev, &msg).await?;
        }
    }

    api.create_pr(
        repo,
        &NewPullRequest {
            title: format!("Revert \"{subject}\""),
            head: branch,
            base: base.to_string(),
            body: format!("Automatic rollback of {}.", commit.sha),
            draft: false,
        },
    )
    .await
}

/// Make `path` on `branch` equal to its state at `parent` (deleting it if it
/// did not exist there). No-op when already equal.
async fn restore_path(
    api: &dyn RepoApi,
    repo: &RepoId,
    branch: &str,
    parent: &str,
    path: &str,
    message: &str,
) -> Result<()> {
    let want = api.get_file(repo, parent, path).await?;
    let have = api.get_file(repo, branch, path).await?;
    match (want, have) {
        (None, None) => Ok(()),
        (None, Some(cur)) => api
            .delete_file(
                repo,
                &DeleteFile {
                    branch: branch.into(),
                    path: path.into(),
                    message: message.into(),
                    expected_sha: cur.sha,
                },
            )
            .await
            .map(|_| ()),
        (Some(w), cur) => {
            if cur.as_ref().map(|c| &c.sha) == Some(&w.sha) {
                return Ok(());
            }
            api.put_file(
                repo,
                &PutFile {
                    branch: branch.into(),
                    path: path.into(),
                    content: w.content,
                    message: message.into(),
                    expected_sha: cur.map(|c| c.sha),
                },
            )
            .await
            .map(|_| ())
        }
    }
}
