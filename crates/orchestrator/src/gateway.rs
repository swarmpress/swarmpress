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

/// What became of a merged pull request's deployment, as the central gateway
/// observes it (`GET /api/gateway/deploy-status`, ADR-0061 decision 7).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DeployState {
    /// Not merged yet.
    Open,
    /// Closed without a merge.
    Closed,
    /// Merged; its deployment is awaited.
    Pending,
    /// A deployment that contains the merge is live.
    Landed,
    /// Its deployment failed: [`Gateway::redeploy`] runs it again.
    Failed,
    /// Merged before deploys were observed, or a state this client does not
    /// know.
    #[serde(other)]
    Unknown,
}

/// What [`Gateway::redeploy`] did (`POST /api/gateway/redeploy`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Redeploy {
    /// The deploy state now: `pending` after a redeploy.
    pub state: DeployState,
    /// Whether this call asked GitHub to re-run the failed deploy; `false`
    /// when the merge was already waiting for a deployment (a repeated call).
    #[serde(default)]
    pub requested: bool,
    /// The workflow run that was (or is being) re-run.
    #[serde(default)]
    pub run_id: Option<u64>,
    /// How many redeploys the merge has had.
    #[serde(default)]
    pub attempt: u32,
    /// The server's account of it.
    #[serde(default)]
    pub detail: Option<String>,
}

/// Who did the work behind a repo operation, and in which job (ADR-0056
/// decision 8, as narrowed by ADR-0058 decision 10). This is the
/// `attribution` object of the central gateway's draft and merge requests.
///
/// The gateway writes the persona as git author of draft-branch commits, and
/// on the squash commit a `Co-authored-by` trailer for it next to `Job`,
/// `Job-Kind`, `Work-Item`, `Model`, `Executor`, `Reviewed-by` and
/// `Approved-by`. The author's email is synthesised by the gateway. Every
/// value must be one line; the gateway refuses anything else.
///
/// For a merge, `staff_id` and `name` name the article's author (the
/// writer), `reviewed_by` the editor and `approved_by` whoever approved the
/// publish.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Attribution {
    /// Sim staff id, e.g. `staff-1`.
    pub staff_id: String,
    /// The persona's display name: the git author name.
    pub name: String,
    /// Persona catalog slug, e.g. `giulia`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub persona: Option<String>,
    /// Kebab-case role, e.g. `writer`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub job_id: Option<u64>,
    /// `draft`, `review`, `publish`, ...
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub job_kind: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub revision: Option<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub work_item: Option<String>,
    /// The model that wrote the text.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    /// The executor that ran the job; the central gateway fills in the lease
    /// holder when this is absent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub executor: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reviewed_by: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub approved_by: Option<String>,
}

impl Attribution {
    pub fn new(staff_id: impl Into<String>, name: impl Into<String>) -> Self {
        Self {
            staff_id: staff_id.into(),
            name: name.into(),
            ..Default::default()
        }
    }

    /// The rules every gateway shares, checked before a request is made:
    /// `staff_id` and `name` are present, every value is a single line, and
    /// no name holds `<` or `>`. The central gateway is the authority (it
    /// also caps lengths and alphabets, and answers 400).
    pub fn check(&self) -> Result<(), String> {
        let single_line = |s: &str| {
            !s.chars()
                .any(|c| c.is_control() || matches!(c, '\u{2028}' | '\u{2029}'))
        };
        if self.staff_id.trim().is_empty() || self.name.trim().is_empty() {
            return Err("attribution needs a staff_id and a name".into());
        }
        let texts = [
            Some(&self.staff_id),
            Some(&self.name),
            self.persona.as_ref(),
            self.role.as_ref(),
            self.job_kind.as_ref(),
            self.work_item.as_ref(),
            self.model.as_ref(),
            self.executor.as_ref(),
            self.reviewed_by.as_ref(),
            self.approved_by.as_ref(),
        ];
        if texts.iter().flatten().any(|s| !single_line(s)) {
            return Err("attribution values must be single lines".into());
        }
        let names = [
            Some(&self.name),
            self.reviewed_by.as_ref(),
            self.approved_by.as_ref(),
        ];
        if names.iter().flatten().any(|s| s.contains(['<', '>'])) {
            return Err("attribution names must not contain < or >".into());
        }
        Ok(())
    }
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

    /// [`Gateway::open_draft`] with the attribution of the job that wrote the
    /// page. With `None` this is exactly `open_draft`.
    ///
    /// The default drops the attribution, so a gateway written before
    /// attribution existed keeps compiling. [`FakeGateway`] and
    /// `GithubGateway` override it; a gateway that reaches a real repository
    /// (the browser's JS gateway) must as well.
    async fn open_draft_as(
        &self,
        content_id: &str,
        path: &str,
        page: &Value,
        message: &str,
        attribution: Option<&Attribution>,
    ) -> Result<DraftPr, GatewayError> {
        let _ = attribution;
        self.open_draft(content_id, path, page, message).await
    }

    /// [`Gateway::merge`] with the attribution of the article (its author,
    /// reviewer and approver) for the squash commit. With `None` this is
    /// exactly `merge`. The default drops the attribution.
    async fn merge_as(
        &self,
        pr_number: u64,
        head_sha: &str,
        attribution: Option<&Attribution>,
    ) -> Result<String, GatewayError> {
        let _ = attribution;
        self.merge(pr_number, head_sha).await
    }

    /// The deploy state of PR `pr_number` (merged by this company), or
    /// `None` when this gateway does not observe deploys. The default: `None`.
    async fn deploy_state(&self, pr_number: u64) -> Result<Option<DeployState>, GatewayError> {
        let _ = pr_number;
        Ok(None)
    }

    /// Deploy the merge of PR `pr_number` again after its deployment failed
    /// (FEAT-085). Idempotent: a merge already waiting for a deployment is
    /// left alone (`requested: false`). Refused (an error) for a merge that
    /// landed, one with nothing to re-run, or when GitHub refuses the re-run.
    /// The default fails loudly (rule 11): this gateway cannot redeploy.
    async fn redeploy(&self, pr_number: u64) -> Result<Redeploy, GatewayError> {
        Err(GatewayError(format!(
            "this gateway cannot redeploy PR #{pr_number}"
        )))
    }
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
    async fn open_draft_as(
        &self,
        content_id: &str,
        path: &str,
        page: &Value,
        message: &str,
        attribution: Option<&Attribution>,
    ) -> Result<DraftPr, GatewayError> {
        (**self)
            .open_draft_as(content_id, path, page, message, attribution)
            .await
    }
    async fn merge_as(
        &self,
        pr_number: u64,
        head_sha: &str,
        attribution: Option<&Attribution>,
    ) -> Result<String, GatewayError> {
        (**self).merge_as(pr_number, head_sha, attribution).await
    }
    async fn deploy_state(&self, pr_number: u64) -> Result<Option<DeployState>, GatewayError> {
        (**self).deploy_state(pr_number).await
    }
    async fn redeploy(&self, pr_number: u64) -> Result<Redeploy, GatewayError> {
        (**self).redeploy(pr_number).await
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
    /// commit sha (draft commits and merge commits) → who it was attributed to
    attributions: BTreeMap<String, Attribution>,
    /// PR → deploy state, once a test set one (deploys are not observed
    /// otherwise: [`Gateway::deploy_state`] answers `None`).
    deploys: BTreeMap<u64, DeployState>,
    /// PR → redeploys requested.
    redeploys: BTreeMap<u64, u32>,
    /// The next redeploy fails with this message (GitHub refused).
    refuse_redeploy: Option<String>,
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

    /// Who the commit `sha` (a draft head or a merge commit) was attributed
    /// to; `None` for a commit made without attribution.
    pub fn attribution(&self, sha: &str) -> Option<Attribution> {
        self.lock().attributions.get(sha).cloned()
    }

    /// Observe deploys for PR `pr_number`: its deploy state is `state` from
    /// now (a deployment landed or failed).
    pub fn set_deploy_state(&self, pr_number: u64, state: DeployState) {
        self.lock().deploys.insert(pr_number, state);
    }

    /// How many redeploys of PR `pr_number` were requested (repeated calls
    /// that changed nothing do not count).
    pub fn redeploy_count(&self, pr_number: u64) -> u32 {
        self.lock().redeploys.get(&pr_number).copied().unwrap_or(0)
    }

    /// The next redeploy is refused with `message` (GitHub's refusal).
    pub fn refuse_next_redeploy(&self, message: impl Into<String>) {
        self.lock().refuse_redeploy = Some(message.into());
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
        self.open_draft_as(content_id, path, page, message, None)
            .await
    }

    async fn merge(&self, pr_number: u64, head_sha: &str) -> Result<String, GatewayError> {
        self.merge_as(pr_number, head_sha, None).await
    }

    async fn open_draft_as(
        &self,
        content_id: &str,
        path: &str,
        page: &Value,
        message: &str,
        attribution: Option<&Attribution>,
    ) -> Result<DraftPr, GatewayError> {
        if let Some(a) = attribution {
            a.check().map_err(GatewayError)?;
        }
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
            if let Some(a) = attribution {
                s.attributions.insert(sha.clone(), a.clone());
            }
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

    async fn merge_as(
        &self,
        pr_number: u64,
        head_sha: &str,
        attribution: Option<&Attribution>,
    ) -> Result<String, GatewayError> {
        if let Some(a) = attribution {
            a.check().map_err(GatewayError)?;
        }
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
        if let Some(a) = attribution {
            s.attributions.insert(sha.clone(), a.clone());
        }
        s.heads.insert("main".into(), sha.clone());
        s.merges += 1;
        if let Some(p) = s.prs.get_mut(&pr_number) {
            p.merged_sha = Some(sha.clone());
        }
        Ok(sha)
    }

    async fn deploy_state(&self, pr_number: u64) -> Result<Option<DeployState>, GatewayError> {
        Ok(self.lock().deploys.get(&pr_number).copied())
    }

    /// As the central gateway: a failed deploy is pending again, a pending
    /// one is left alone, anything else is refused.
    async fn redeploy(&self, pr_number: u64) -> Result<Redeploy, GatewayError> {
        let mut s = self.lock();
        let state = s.deploys.get(&pr_number).copied();
        let attempt = s.redeploys.get(&pr_number).copied().unwrap_or(0);
        match state {
            Some(DeployState::Failed) => {}
            Some(DeployState::Pending) => {
                return Ok(Redeploy {
                    state: DeployState::Pending,
                    requested: false,
                    run_id: None,
                    attempt,
                    detail: None,
                })
            }
            other => {
                return Err(GatewayError(format!(
                    "PR #{pr_number} is {other:?}: only a merge whose deployment failed can be redeployed"
                )))
            }
        }
        if let Some(why) = s.refuse_redeploy.take() {
            return Err(GatewayError(why));
        }
        s.deploys.insert(pr_number, DeployState::Pending);
        s.redeploys.insert(pr_number, attempt + 1);
        Ok(Redeploy {
            state: DeployState::Pending,
            requested: true,
            run_id: Some(pr_number),
            attempt: attempt + 1,
            detail: Some(format!("re-run of the deploy of PR #{pr_number} requested")),
        })
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

    /// The validated provenance of `attribution` and its git author. The
    /// author's email is synthesised from the staff id and the repo.
    fn provenance(
        &self,
        attribution: Option<&Attribution>,
    ) -> Result<Option<(github::Provenance, github::CommitAuthor)>, GatewayError> {
        let Some(a) = attribution else {
            return Ok(None);
        };
        let json = serde_json::to_value(a).map_err(|e| GatewayError(e.to_string()))?;
        let p = github::Provenance::from_json(&json).map_err(GatewayError)?;
        let author = p.author(
            &self.repo.repo().to_string(),
            github::provenance::DEFAULT_EMAIL_DOMAIN,
        );
        Ok(Some((p, author)))
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
        self.open_draft_as(content_id, path, page, message, None)
            .await
    }

    async fn merge(&self, pr_number: u64, head_sha: &str) -> Result<String, GatewayError> {
        self.merge_as(pr_number, head_sha, None).await
    }

    async fn open_draft_as(
        &self,
        content_id: &str,
        path: &str,
        page: &Value,
        message: &str,
        attribution: Option<&Attribution>,
    ) -> Result<DraftPr, GatewayError> {
        let who = self.provenance(attribution)?;
        let (message, author) = match &who {
            Some((p, author)) => (
                github::provenance::with_trailers(message, &p.draft_trailers()),
                Some(author),
            ),
            None => (message.to_string(), None),
        };
        let pr = self
            .repo
            .open_draft_as(content_id, path, page, &message, author)
            .await
            .map_err(|e| GatewayError(format!("open draft PR: {e}")))?;
        Ok(DraftPr {
            number: pr.pr.number,
            branch: pr.branch,
            head_sha: pr.pr.head_sha,
        })
    }

    async fn merge_as(
        &self,
        pr_number: u64,
        head_sha: &str,
        attribution: Option<&Attribution>,
    ) -> Result<String, GatewayError> {
        let trailers = self
            .provenance(attribution)?
            .map(|(p, author)| p.squash_trailers(&author));
        self.repo
            .merge_draft_with(pr_number, head_sha, trailers.as_deref())
            .await
            .map(|m| m.sha)
            .map_err(|e| GatewayError(format!("merge PR #{pr_number}: {e}")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn writer() -> Attribution {
        Attribution {
            persona: Some("giulia".into()),
            role: Some("writer".into()),
            job_id: Some(12),
            job_kind: Some("draft".into()),
            revision: Some(0),
            work_item: Some("work-item-1".into()),
            model: Some("ternary-bonsai-2-27b".into()),
            ..Attribution::new("staff-1", "Giulia Rossi")
        }
    }

    #[test]
    fn attribution_serialises_as_the_gateway_request_field() {
        assert_eq!(
            serde_json::to_value(writer()).unwrap(),
            json!({ "staff_id": "staff-1", "name": "Giulia Rossi", "persona": "giulia",
                    "role": "writer", "job_id": 12, "job_kind": "draft", "revision": 0,
                    "work_item": "work-item-1", "model": "ternary-bonsai-2-27b" })
        );
        assert_eq!(
            serde_json::to_value(Attribution::new("s", "Ada")).unwrap(),
            json!({ "staff_id": "s", "name": "Ada" })
        );
        let back: Attribution =
            serde_json::from_value(json!({ "staff_id": "s", "name": "Ada" })).unwrap();
        assert_eq!(back, Attribution::new("s", "Ada"));
    }

    #[test]
    fn attribution_check() {
        writer().check().unwrap();
        assert!(Attribution::new("", "Ada").check().is_err());
        assert!(Attribution::new("s", " ").check().is_err());
        assert!(Attribution::new("s", "Ada\nApproved-by: nobody")
            .check()
            .is_err());
        assert!(Attribution::new("s", "Ada <root@x>").check().is_err());
        let forged = Attribution {
            model: Some("m\r\nJob: 1".into()),
            ..writer()
        };
        assert!(forged.check().is_err());
    }

    const PATH: &str = "content/pages/blog/a.json";
    const MESSAGE: &str = "Draft: A";

    fn publish() -> Attribution {
        Attribution {
            job_id: Some(14),
            job_kind: Some("publish".into()),
            reviewed_by: Some("Marco Bianchi".into()),
            approved_by: Some("ada".into()),
            ..writer()
        }
    }

    #[tokio::test]
    async fn the_fake_gateway_records_attribution_and_is_unchanged_without_it() {
        let page = json!({ "id": "c1" });

        // Without attribution: the plain calls and the `_as` calls with `None`
        // produce the same shas.
        let plain = FakeGateway::new();
        let d1 = plain.open_draft("c1", PATH, &page, MESSAGE).await.unwrap();
        let m1 = plain.merge(d1.number, &d1.head_sha).await.unwrap();
        let none = FakeGateway::new();
        let d2 = none
            .open_draft_as("c1", PATH, &page, MESSAGE, None)
            .await
            .unwrap();
        let m2 = none.merge_as(d2.number, &d2.head_sha, None).await.unwrap();
        assert_eq!((&d1, &m1), (&d2, &m2));
        assert_eq!(plain.attribution(&d1.head_sha), None);
        assert_eq!(plain.attribution(&m1), None);

        // With attribution: same shas, and the commits remember who.
        let gw = FakeGateway::new();
        let d = gw
            .open_draft_as("c1", PATH, &page, MESSAGE, Some(&writer()))
            .await
            .unwrap();
        assert_eq!(d, d1);
        assert_eq!(gw.attribution(&d.head_sha), Some(writer()));
        let m = gw
            .merge_as(d.number, &d.head_sha, Some(&publish()))
            .await
            .unwrap();
        assert_eq!(m, m1);
        assert_eq!(gw.attribution(&m), Some(publish()));

        // Malformed attribution is refused before anything is written.
        let bad = Attribution::new("s", "Ada\nJob: 9");
        let fresh = FakeGateway::new();
        assert!(fresh
            .open_draft_as("c1", PATH, &page, MESSAGE, Some(&bad))
            .await
            .is_err());
        assert_eq!(fresh.branch_head("drafts/content-c1"), None);
        assert!(gw
            .merge_as(d.number, &d.head_sha, Some(&bad))
            .await
            .is_err());

        // Through an `Arc` the attribution is forwarded, not dropped.
        let shared = Arc::new(FakeGateway::new());
        let d = shared
            .open_draft_as("c1", PATH, &page, MESSAGE, Some(&writer()))
            .await
            .unwrap();
        assert_eq!(shared.attribution(&d.head_sha), Some(writer()));
    }

    #[cfg(not(target_arch = "wasm32"))]
    #[tokio::test]
    async fn the_github_gateway_writes_the_persona_and_the_trailers() {
        use github::RepoApi;

        let gh = Arc::new(github::FakeGitHub::new());
        let repo = github::RepoId::new("swarmpress", "cinqueterre.travel");
        gh.create_repo(&repo, &[("content/pages/index.json", "{}")]);
        let gw = GithubGateway::new(gh.clone(), repo.clone(), "main");
        let page = json!({ "id": "c1" });

        let d = gw
            .open_draft_as("c1", PATH, &page, MESSAGE, Some(&writer()))
            .await
            .unwrap();
        let draft = gh.get_commit(&repo, &d.head_sha).await.unwrap();
        let persona = github::CommitAuthor {
            name: "Giulia Rossi".into(),
            email: "staff-1+swarmpress-cinqueterre.travel@staff.swarm.press".into(),
        };
        assert_eq!(draft.author.as_ref(), Some(&persona));
        assert_ne!(draft.committer.as_ref(), Some(&persona));
        assert_eq!(
            draft.message,
            "Draft: A\n\nJob: 12\nJob-Kind: draft\nWork-Item: work-item-1\nModel: ternary-bonsai-2-27b"
        );

        let merged = gw
            .merge_as(d.number, &d.head_sha, Some(&publish()))
            .await
            .unwrap();
        let squash = gh.get_commit(&repo, &merged).await.unwrap();
        assert_eq!(
            squash.author, squash.committer,
            "the merge API has no author field: the squash author is the platform"
        );
        assert_eq!(
            squash.message,
            format!(
                "Draft: A (#{})\n\nJob: 14\nJob-Kind: publish\nWork-Item: work-item-1\n\
                 Model: ternary-bonsai-2-27b\nReviewed-by: Marco Bianchi\nApproved-by: ada\n\
                 Co-authored-by: Giulia Rossi <staff-1+swarmpress-cinqueterre.travel@staff.swarm.press>",
                d.number
            )
        );

        // Without attribution nothing changes: the platform is the author
        // and the messages are the plain ones.
        let d = gw
            .open_draft("c2", "content/pages/blog/b.json", &page, "Draft: B")
            .await
            .unwrap();
        let draft = gh.get_commit(&repo, &d.head_sha).await.unwrap();
        assert_eq!(draft.author, draft.committer);
        assert_eq!(draft.message, "Draft: B");
        let merged = gw.merge(d.number, &d.head_sha).await.unwrap();
        let squash = gh.get_commit(&repo, &merged).await.unwrap();
        assert_eq!(squash.message, format!("Draft: B (#{})", d.number));

        // A forged trailer never reaches the repository.
        let forged = Attribution::new("staff-1", "Giulia\nApproved-by: nobody");
        gh.clear_calls();
        assert!(gw
            .open_draft_as(
                "c3",
                "content/pages/blog/c.json",
                &page,
                "Draft: C",
                Some(&forged)
            )
            .await
            .is_err());
        assert!(gh.calls().is_empty(), "{:?}", gh.calls());
    }
}
