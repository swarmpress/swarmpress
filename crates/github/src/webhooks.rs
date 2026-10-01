//! GitHub webhooks: HMAC-SHA256 verification, typed event parsing and
//! delivery-id dedupe.
//!
//! Processing order in [`WebhookHandler::process`] is deliberate:
//! 1. verify `X-Hub-Signature-256` (constant time) — unauthenticated bodies
//!    never reach the parser or the dedupe store;
//! 2. parse into a typed [`WebhookEvent`];
//! 3. mark the `X-GitHub-Delivery` id as seen; redeliveries come back as
//!    [`Delivery::Duplicate`].

use std::collections::{HashSet, VecDeque};
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use hmac::{Hmac, Mac};
use http::HeaderMap;
use serde::Deserialize;
use sha2::Sha256;

use crate::types::{CheckConclusion, CheckStatus, RepoId};

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum WebhookError {
    #[error("missing header {0}")]
    MissingHeader(&'static str),
    #[error("malformed signature header")]
    MalformedSignature,
    #[error("signature mismatch")]
    InvalidSignature,
    #[error("payload parse error for {event}: {message}")]
    Parse { event: String, message: String },
    #[error("dedupe store: {0}")]
    Store(String),
}

pub const SIGNATURE_HEADER: &str = "x-hub-signature-256";
pub const EVENT_HEADER: &str = "x-github-event";
pub const DELIVERY_HEADER: &str = "x-github-delivery";

/// Compute the `sha256=<hex>` signature GitHub would send for `body`.
pub fn sign(secret: &[u8], body: &[u8]) -> String {
    // HMAC accepts keys of any length; `new_from_slice` cannot fail here.
    let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(secret)
        .unwrap_or_else(|_| unreachable!("HMAC accepts any key length"));
    mac.update(body);
    format!("sha256={}", hex::encode(mac.finalize().into_bytes()))
}

/// Verify an `X-Hub-Signature-256` header value against `body`.
/// The comparison is constant time (`hmac::Mac::verify_slice`).
pub fn verify_signature(
    secret: &[u8],
    body: &[u8],
    header: Option<&str>,
) -> Result<(), WebhookError> {
    let header = header.ok_or(WebhookError::MissingHeader(SIGNATURE_HEADER))?;
    let hex_sig = header
        .trim()
        .strip_prefix("sha256=")
        .ok_or(WebhookError::MalformedSignature)?;
    let sig = hex::decode(hex_sig).map_err(|_| WebhookError::MalformedSignature)?;
    if sig.len() != 32 {
        return Err(WebhookError::MalformedSignature);
    }
    let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(secret)
        .unwrap_or_else(|_| unreachable!("HMAC accepts any key length"));
    mac.update(body);
    mac.verify_slice(&sig)
        .map_err(|_| WebhookError::InvalidSignature)
}

// ---- payload types ---------------------------------------------------------

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct WhOwner {
    pub login: String,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct WhRepository {
    pub id: u64,
    pub name: String,
    pub full_name: String,
    pub owner: WhOwner,
    #[serde(default)]
    pub default_branch: Option<String>,
}

impl WhRepository {
    pub fn repo_id(&self) -> RepoId {
        RepoId::new(&self.owner.login, &self.name)
    }
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct WhInstallation {
    pub id: u64,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct WhRef {
    #[serde(rename = "ref")]
    pub ref_name: String,
    pub sha: String,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct WhLabel {
    pub name: String,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PullRequestAction {
    Opened,
    Edited,
    Closed,
    Reopened,
    Synchronize,
    Labeled,
    Unlabeled,
    ReadyForReview,
    ConvertedToDraft,
    ReviewRequested,
    #[serde(other)]
    Other,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct WhPullRequest {
    pub number: u64,
    pub title: String,
    pub state: String,
    #[serde(default)]
    pub merged: bool,
    pub merge_commit_sha: Option<String>,
    pub head: WhRef,
    pub base: WhRef,
    #[serde(default)]
    pub html_url: String,
    #[serde(default)]
    pub labels: Vec<WhLabel>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct PullRequestEvent {
    pub action: PullRequestAction,
    pub number: u64,
    pub pull_request: WhPullRequest,
    pub repository: WhRepository,
    pub installation: Option<WhInstallation>,
}

impl PullRequestEvent {
    /// Closed by merging (vs. closed without merge).
    pub fn is_merged(&self) -> bool {
        self.action == PullRequestAction::Closed && self.pull_request.merged
    }
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CheckAction {
    Created,
    Completed,
    Rerequested,
    RequestedAction,
    Requested,
    #[serde(other)]
    Other,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct WhCheckSuiteRef {
    pub id: u64,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct WhCheckRun {
    pub id: u64,
    pub name: String,
    pub head_sha: String,
    pub status: CheckStatus,
    pub conclusion: Option<CheckConclusion>,
    pub details_url: Option<String>,
    pub check_suite: Option<WhCheckSuiteRef>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct CheckRunEvent {
    pub action: CheckAction,
    pub check_run: WhCheckRun,
    pub repository: WhRepository,
    pub installation: Option<WhInstallation>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct WhPrNumber {
    pub number: u64,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct WhCheckSuite {
    pub id: u64,
    pub head_branch: Option<String>,
    pub head_sha: String,
    pub status: Option<CheckStatus>,
    pub conclusion: Option<CheckConclusion>,
    #[serde(default)]
    pub pull_requests: Vec<WhPrNumber>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct CheckSuiteEvent {
    pub action: CheckAction,
    pub check_suite: WhCheckSuite,
    pub repository: WhRepository,
    pub installation: Option<WhInstallation>,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WorkflowRunAction {
    Requested,
    InProgress,
    Completed,
    #[serde(other)]
    Other,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct WhWorkflowRun {
    pub id: u64,
    pub name: Option<String>,
    pub path: Option<String>,
    pub head_branch: Option<String>,
    pub head_sha: String,
    pub event: String,
    pub status: Option<CheckStatus>,
    pub conclusion: Option<CheckConclusion>,
    pub run_number: u64,
    #[serde(default)]
    pub html_url: String,
    #[serde(default)]
    pub pull_requests: Vec<WhPrNumber>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct WorkflowRunEvent {
    pub action: WorkflowRunAction,
    pub workflow_run: WhWorkflowRun,
    pub repository: WhRepository,
    pub installation: Option<WhInstallation>,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DeploymentState {
    Pending,
    Queued,
    InProgress,
    Success,
    Failure,
    Error,
    Inactive,
    #[serde(other)]
    Other,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct WhDeploymentStatus {
    pub id: u64,
    pub state: DeploymentState,
    pub environment: Option<String>,
    pub target_url: Option<String>,
    pub environment_url: Option<String>,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct WhDeployment {
    pub id: u64,
    pub sha: String,
    #[serde(rename = "ref")]
    pub ref_name: String,
    pub environment: String,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct DeploymentStatusEvent {
    pub action: String,
    pub deployment_status: WhDeploymentStatus,
    pub deployment: WhDeployment,
    pub repository: WhRepository,
    pub installation: Option<WhInstallation>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct WhCommit {
    pub id: String,
    pub message: String,
    #[serde(default)]
    pub added: Vec<String>,
    #[serde(default)]
    pub removed: Vec<String>,
    #[serde(default)]
    pub modified: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct PushEvent {
    #[serde(rename = "ref")]
    pub ref_name: String,
    pub before: String,
    pub after: String,
    #[serde(default)]
    pub created: bool,
    #[serde(default)]
    pub deleted: bool,
    #[serde(default)]
    pub forced: bool,
    pub head_commit: Option<WhCommit>,
    #[serde(default)]
    pub commits: Vec<WhCommit>,
    pub repository: WhRepository,
    pub installation: Option<WhInstallation>,
}

impl PushEvent {
    /// Branch name for `refs/heads/*` pushes; `None` for tags.
    pub fn branch(&self) -> Option<&str> {
        self.ref_name.strip_prefix("refs/heads/")
    }

    /// Every path added/modified/removed across the pushed commits.
    pub fn touched_paths(&self) -> Vec<String> {
        let mut v: Vec<String> = self
            .commits
            .iter()
            .flat_map(|c| c.added.iter().chain(&c.modified).chain(&c.removed))
            .cloned()
            .collect();
        v.sort();
        v.dedup();
        v
    }
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct PingEvent {
    pub zen: Option<String>,
    pub hook_id: Option<u64>,
}

/// A parsed webhook payload.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WebhookEvent {
    PullRequest(Box<PullRequestEvent>),
    CheckRun(Box<CheckRunEvent>),
    CheckSuite(Box<CheckSuiteEvent>),
    WorkflowRun(Box<WorkflowRunEvent>),
    DeploymentStatus(Box<DeploymentStatusEvent>),
    Push(Box<PushEvent>),
    Ping(PingEvent),
    /// An event type we do not model; kept so callers can log it.
    Other {
        event: String,
        action: Option<String>,
    },
}

impl WebhookEvent {
    /// Repo the event is about, when it has one.
    pub fn repo(&self) -> Option<RepoId> {
        match self {
            WebhookEvent::PullRequest(e) => Some(e.repository.repo_id()),
            WebhookEvent::CheckRun(e) => Some(e.repository.repo_id()),
            WebhookEvent::CheckSuite(e) => Some(e.repository.repo_id()),
            WebhookEvent::WorkflowRun(e) => Some(e.repository.repo_id()),
            WebhookEvent::DeploymentStatus(e) => Some(e.repository.repo_id()),
            WebhookEvent::Push(e) => Some(e.repository.repo_id()),
            WebhookEvent::Ping(_) | WebhookEvent::Other { .. } => None,
        }
    }

    pub fn installation_id(&self) -> Option<u64> {
        let i = match self {
            WebhookEvent::PullRequest(e) => &e.installation,
            WebhookEvent::CheckRun(e) => &e.installation,
            WebhookEvent::CheckSuite(e) => &e.installation,
            WebhookEvent::WorkflowRun(e) => &e.installation,
            WebhookEvent::DeploymentStatus(e) => &e.installation,
            WebhookEvent::Push(e) => &e.installation,
            WebhookEvent::Ping(_) | WebhookEvent::Other { .. } => return None,
        };
        i.as_ref().map(|i| i.id)
    }
}

/// Parse a payload given its `X-GitHub-Event` name.
pub fn parse_event(event: &str, body: &[u8]) -> Result<WebhookEvent, WebhookError> {
    fn p<T: for<'de> Deserialize<'de>>(event: &str, body: &[u8]) -> Result<T, WebhookError> {
        serde_json::from_slice(body).map_err(|e| WebhookError::Parse {
            event: event.into(),
            message: e.to_string(),
        })
    }
    Ok(match event {
        "pull_request" => WebhookEvent::PullRequest(Box::new(p(event, body)?)),
        "check_run" => WebhookEvent::CheckRun(Box::new(p(event, body)?)),
        "check_suite" => WebhookEvent::CheckSuite(Box::new(p(event, body)?)),
        "workflow_run" => WebhookEvent::WorkflowRun(Box::new(p(event, body)?)),
        "deployment_status" => WebhookEvent::DeploymentStatus(Box::new(p(event, body)?)),
        "push" => WebhookEvent::Push(Box::new(p(event, body)?)),
        "ping" => WebhookEvent::Ping(p(event, body)?),
        other => {
            let v: serde_json::Value = p(event, body)?;
            WebhookEvent::Other {
                event: other.into(),
                action: v.get("action").and_then(|a| a.as_str()).map(String::from),
            }
        }
    })
}

// ---- dedupe ----------------------------------------------------------------

/// Remembers which delivery ids were already processed. The server backs
/// this with Postgres (ideally marking inside the same transaction that
/// applies the event); [`InMemoryDedupe`] is for tests and single-node dev.
#[async_trait]
pub trait DeliveryDedupe: Send + Sync {
    /// Record `delivery_id`; `true` if this is the first time it is seen.
    async fn check_and_mark(&self, delivery_id: &str) -> Result<bool, WebhookError>;
}

/// Bounded FIFO set of recent delivery ids.
#[derive(Debug)]
pub struct InMemoryDedupe {
    cap: usize,
    inner: Mutex<(HashSet<String>, VecDeque<String>)>,
}

impl InMemoryDedupe {
    pub fn new(capacity: usize) -> Self {
        Self {
            cap: capacity.max(1),
            inner: Mutex::new((HashSet::new(), VecDeque::new())),
        }
    }
}

impl Default for InMemoryDedupe {
    fn default() -> Self {
        Self::new(10_000)
    }
}

#[async_trait]
impl DeliveryDedupe for InMemoryDedupe {
    async fn check_and_mark(&self, delivery_id: &str) -> Result<bool, WebhookError> {
        let mut g = self
            .inner
            .lock()
            .map_err(|_| WebhookError::Store("poisoned".into()))?;
        let (set, order) = &mut *g;
        if set.contains(delivery_id) {
            return Ok(false);
        }
        set.insert(delivery_id.to_string());
        order.push_back(delivery_id.to_string());
        while order.len() > self.cap {
            if let Some(old) = order.pop_front() {
                set.remove(&old);
            }
        }
        Ok(true)
    }
}

// ---- handler ---------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WebhookEnvelope {
    pub delivery_id: String,
    pub event_name: String,
    pub event: WebhookEvent,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Delivery {
    Fresh(WebhookEnvelope),
    Duplicate { delivery_id: String },
}

/// Verify → parse → dedupe, for one webhook secret.
pub struct WebhookHandler {
    secret: Vec<u8>,
    dedupe: Arc<dyn DeliveryDedupe>,
}

impl std::fmt::Debug for WebhookHandler {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("WebhookHandler { secret: <redacted>, .. }")
    }
}

impl WebhookHandler {
    pub fn new(secret: impl Into<Vec<u8>>, dedupe: Arc<dyn DeliveryDedupe>) -> Self {
        Self {
            secret: secret.into(),
            dedupe,
        }
    }

    pub async fn process(
        &self,
        headers: &HeaderMap,
        body: &[u8],
    ) -> Result<Delivery, WebhookError> {
        let h = |name: &'static str| headers.get(name).and_then(|v| v.to_str().ok());
        verify_signature(&self.secret, body, h(SIGNATURE_HEADER))?;
        let event_name = h(EVENT_HEADER)
            .ok_or(WebhookError::MissingHeader(EVENT_HEADER))?
            .to_string();
        let delivery_id = h(DELIVERY_HEADER)
            .ok_or(WebhookError::MissingHeader(DELIVERY_HEADER))?
            .to_string();
        let event = parse_event(&event_name, body)?;
        if !self.dedupe.check_and_mark(&delivery_id).await? {
            return Ok(Delivery::Duplicate { delivery_id });
        }
        Ok(Delivery::Fresh(WebhookEnvelope {
            delivery_id,
            event_name,
            event,
        }))
    }
}
