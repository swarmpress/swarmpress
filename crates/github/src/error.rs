//! Error type shared by every [`crate::RepoApi`] implementation.

use std::time::Duration;

/// Errors returned by GitHub operations, real or fake.
///
/// The variants are deliberately coarse so that callers (pipelines, the
/// orchestrator) can branch on *meaning* rather than on HTTP status codes:
/// `Conflict` is always "someone else moved first, re-read and retry",
/// `NotMergeable` is always "checks/conflicts block the merge", etc.
#[derive(Debug, thiserror::Error)]
pub enum GitHubError {
    /// The repo, ref, file, PR or artifact does not exist.
    #[error("not found: {0}")]
    NotFound(String),

    /// Optimistic-concurrency failure: the expected blob/head sha did not
    /// match, or a file exists where a create-only write was requested.
    #[error("conflict: {0}")]
    Conflict(String),

    /// A branch / repo / resource with that name already exists.
    #[error("already exists: {0}")]
    AlreadyExists(String),

    /// The PR cannot be merged (merge conflicts, failing required checks,
    /// already merged or closed).
    #[error("pull request not mergeable: {0}")]
    NotMergeable(String),

    /// The request was refused by the [`crate::PathPolicy`] before reaching GitHub.
    #[error("policy denied for {actor}: {reason}")]
    PolicyDenied { actor: String, reason: String },

    /// Bad credentials (401).
    #[error("unauthorized: {0}")]
    Unauthorized(String),

    /// Permission denied (403 that is not a rate limit).
    #[error("forbidden: {0}")]
    Forbidden(String),

    /// GitHub rejected the payload (422).
    #[error("validation failed: {0}")]
    Validation(String),

    /// Rate limited and retries were exhausted.
    #[error("rate limited; retry after {retry_after:?}")]
    RateLimited { retry_after: Duration },

    /// App authentication failed (JWT signing, token exchange).
    #[error("auth error: {0}")]
    Auth(String),

    /// Any other non-success HTTP status.
    #[error("http {status}: {message}")]
    Http { status: u16, message: String },

    /// Network / transport failure.
    #[error("transport: {0}")]
    Transport(String),

    /// Response body could not be decoded.
    #[error("decode: {0}")]
    Decode(String),

    /// Caller passed something invalid (bad branch name, bad path).
    #[error("invalid argument: {0}")]
    InvalidArgument(String),
}

impl GitHubError {
    /// True for the optimistic-concurrency failure callers usually retry on.
    pub fn is_conflict(&self) -> bool {
        matches!(self, GitHubError::Conflict(_))
    }

    pub fn is_not_found(&self) -> bool {
        matches!(self, GitHubError::NotFound(_))
    }
}

impl From<reqwest::Error> for GitHubError {
    fn from(e: reqwest::Error) -> Self {
        if e.is_decode() {
            GitHubError::Decode(e.to_string())
        } else {
            GitHubError::Transport(e.to_string())
        }
    }
}

impl From<serde_json::Error> for GitHubError {
    fn from(e: serde_json::Error) -> Self {
        GitHubError::Decode(e.to_string())
    }
}

pub type Result<T, E = GitHubError> = std::result::Result<T, E>;
