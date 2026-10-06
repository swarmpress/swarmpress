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

    /// A page of the base branch with its blob sha (ADR-0070), `None` when it
    /// does not exist. The default fails loudly (rule 11).
    async fn read_page(&self, path: &str) -> Result<Option<PageFile>, GatewayError> {
        Err(GatewayError(format!(
            "this gateway cannot read pages ({path})"
        )))
    }

    /// [`Gateway::open_draft_as`] for an update of an existing article
    /// (ADR-0070 decision 6): refused unless `path` is still the blob
    /// `blob_sha` on the base branch. The default fails loudly (rule 11).
    async fn open_update_as(
        &self,
        content_id: &str,
        path: &str,
        page: &Value,
        message: &str,
        attribution: Option<&Attribution>,
        blob_sha: &str,
    ) -> Result<DraftPr, GatewayError> {
        let _ = (content_id, page, message, attribution, blob_sha);
        Err(GatewayError(format!("this gateway cannot update {path}")))
    }

    /// The site's models at the base head (`GET /api/site/blueprint`,
    /// ADR-0072): `{commit, source, hash, blueprint, types, issues, context,
    /// tools: [{id, hash, graph, issues, manifest}]}`. The default fails
    /// loudly (rule 11).
    async fn site_models(&self) -> Result<Value, GatewayError> {
        Err(GatewayError(
            "this gateway cannot read the site's models".into(),
        ))
    }

    /// Writes the site's blueprint (`PUT /api/site/blueprint` with
    /// `{blueprint, types?, base_hash, message?}`, FEAT-095): an architect's
    /// approved proposal. The default fails loudly (rule 11).
    async fn put_blueprint(&self, body: &Value) -> Result<ModelsPut, GatewayError> {
        let _ = body;
        Err(GatewayError(
            "this gateway cannot change the site's blueprint".into(),
        ))
    }

    /// Installs or replaces one tool (`PUT /api/site/blueprint` with
    /// `{base_hash, tools: {id: graph}, message}` on the current base,
    /// FEAT-095): the Web Developer's approved graph. The default fails
    /// loudly (rule 11).
    async fn put_tool(&self, graph: &Value, message: &str) -> Result<ModelsPut, GatewayError> {
        let _ = message;
        Err(GatewayError(format!(
            "this gateway cannot install tools ({})",
            graph["id"].as_str().unwrap_or("?")
        )))
    }
}

/// A page read through the gateway: its JSON and the blob sha an update names.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PageFile {
    pub page: Value,
    pub sha: String,
}

/// What a write of the site's models came to (`PUT /api/site/blueprint`,
/// ADR-0072): it landed, its base was stale (409), or the server's checker
/// refused it (422). Other failures are [`GatewayError`]s (retryable).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum ModelsPut {
    Landed {
        /// The base branch's head after the write.
        commit: String,
        /// The blueprint's hash after the write.
        hash: String,
        /// The semantic diff it landed (`blueprint::Change`s).
        #[serde(default)]
        changes: Vec<Value>,
        /// The tools written.
        #[serde(default)]
        tools: Vec<String>,
    },
    /// The blueprint changed since the base the change was made on.
    Stale {
        #[serde(default)]
        error: String,
    },
    /// The change does not check in the site.
    Refused {
        #[serde(default)]
        error: String,
        #[serde(default)]
        issues: Vec<String>,
    },
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
    async fn read_page(&self, path: &str) -> Result<Option<PageFile>, GatewayError> {
        (**self).read_page(path).await
    }
    async fn open_update_as(
        &self,
        content_id: &str,
        path: &str,
        page: &Value,
        message: &str,
        attribution: Option<&Attribution>,
        blob_sha: &str,
    ) -> Result<DraftPr, GatewayError> {
        (**self)
            .open_update_as(content_id, path, page, message, attribution, blob_sha)
            .await
    }
    async fn site_models(&self) -> Result<Value, GatewayError> {
        (**self).site_models().await
    }
    async fn put_blueprint(&self, body: &Value) -> Result<ModelsPut, GatewayError> {
        (**self).put_blueprint(body).await
    }
    async fn put_tool(&self, graph: &Value, message: &str) -> Result<ModelsPut, GatewayError> {
        (**self).put_tool(graph, message).await
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
    /// The site's models, once a test set them ([`FakeGateway::set_site`]).
    site: Option<FakeSite>,
}

/// The site's models in [`FakeGateway`]: what `blueprint/` holds, and the
/// site facts of the checker's context.
#[derive(Debug, Clone)]
pub struct FakeSite {
    pub blueprint: blueprint::Blueprint,
    pub types: BTreeMap<String, Value>,
    pub tools: BTreeMap<String, blueprint::tools::ToolGraph>,
    pub context: blueprint::site::SiteContext,
    /// Writes that landed (the commit counter).
    pub writes: u32,
}

impl FakeSite {
    pub fn new(
        blueprint: blueprint::Blueprint,
        types: BTreeMap<String, Value>,
        context: blueprint::site::SiteContext,
    ) -> Self {
        Self {
            blueprint,
            types,
            tools: BTreeMap::new(),
            context,
            writes: 0,
        }
    }

    fn commit(&self) -> String {
        fake_sha(&["site", &self.writes.to_string()])
    }

    fn sigs(&self) -> BTreeMap<String, blueprint::ToolSig> {
        self.tools
            .values()
            .map(|g| (g.id.clone(), g.sig()))
            .collect()
    }

    /// The models as `GET /api/site/blueprint` answers them (no town).
    fn models(&self) -> Result<Value, GatewayError> {
        let fail = |i: Vec<blueprint::Issue>| GatewayError(format!("site models: {i:?}"));
        let ctx = self
            .context
            .check_context(&self.types, self.sigs())
            .map_err(fail)?;
        let tool_ctx = blueprint::tools::ToolContext {
            types: ctx.types.clone(),
            tools: self.sigs(),
            ..Default::default()
        };
        let tools: Vec<Value> = self
            .tools
            .values()
            .map(|g| {
                serde_json::json!({
                    "id": g.id,
                    "hash": g.hash(),
                    "graph": g,
                    "issues": blueprint::tools::check_tool(g, &tool_ctx),
                    "manifest": blueprint::tools::manifest(g),
                })
            })
            .collect();
        Ok(serde_json::json!({
            "commit": self.commit(),
            "source": "repo",
            "hash": blueprint::hash(&self.blueprint),
            "blueprint": self.blueprint,
            "types": self.types,
            "issues": blueprint::check(&self.blueprint, &ctx),
            "context": self.context,
            "tools": tools,
            "tool_errors": [],
        }))
    }

    /// `PUT /api/site/blueprint` as the server does it: base hash, tools
    /// checked, blueprint checked, then written.
    fn put(&mut self, body: &Value) -> Result<ModelsPut, GatewayError> {
        let current = blueprint::hash(&self.blueprint);
        if body["base_hash"].as_str() != Some(current.as_str()) {
            return Ok(ModelsPut::Stale {
                error: format!("the blueprint changed since this edit began (now {current})"),
            });
        }
        let new = match body.get("blueprint").filter(|v| !v.is_null()) {
            Some(v) => blueprint::Blueprint::from_value(v)
                .map_err(|e| GatewayError(format!("not a blueprint: {e}")))?,
            None => self.blueprint.clone(),
        };
        let types: BTreeMap<String, Value> = match body.get("types").filter(|v| !v.is_null()) {
            Some(v) => {
                serde_json::from_value(v.clone()).map_err(|e| GatewayError(e.to_string()))?
            }
            None => self.types.clone(),
        };
        let mut tools = self.tools.clone();
        let mut written = Vec::new();
        if let Some(Value::Object(m)) = body.get("tools") {
            for (id, v) in m {
                let g = match blueprint::tools::ToolGraph::from_value(v) {
                    Ok(g) if g.id == *id => g,
                    Ok(g) => {
                        return Err(GatewayError(format!(
                            "tool {id}: the graph's id is {}",
                            g.id
                        )))
                    }
                    Err(e) => {
                        return Ok(ModelsPut::Refused {
                            error: format!("tool {id} is not a tool graph"),
                            issues: vec![e],
                        })
                    }
                };
                if tools.get(id) != Some(&g) {
                    written.push(id.clone());
                }
                tools.insert(id.clone(), g);
            }
        }
        let sigs: BTreeMap<String, blueprint::ToolSig> =
            tools.values().map(|g| (g.id.clone(), g.sig())).collect();
        let ctx = match self.context.check_context(&types, sigs.clone()) {
            Ok(c) => c,
            Err(issues) => {
                return Ok(ModelsPut::Refused {
                    error: "the types do not check".into(),
                    issues: issues.iter().map(ToString::to_string).collect(),
                })
            }
        };
        let tool_ctx = blueprint::tools::ToolContext {
            types: ctx.types.clone(),
            tools: sigs,
            ..Default::default()
        };
        for id in &written {
            let issues = blueprint::tools::check_tool(&tools[id], &tool_ctx);
            if !issues.is_empty() {
                return Ok(ModelsPut::Refused {
                    error: format!("tool {id} does not check"),
                    issues: issues.iter().map(ToString::to_string).collect(),
                });
            }
        }
        let issues = blueprint::check(&new, &ctx);
        if !issues.is_empty() {
            return Ok(ModelsPut::Refused {
                error: "the blueprint does not check".into(),
                issues: issues.iter().map(ToString::to_string).collect(),
            });
        }
        let changes: Vec<Value> = blueprint::diff(&self.blueprint, &new)
            .iter()
            .map(|c| serde_json::to_value(c).unwrap_or_default())
            .collect();
        let hash = blueprint::hash(&new);
        if !changes.is_empty() || !written.is_empty() || types != self.types {
            self.blueprint = new;
            self.types = types;
            self.tools = tools;
            self.writes += 1;
        }
        Ok(ModelsPut::Landed {
            commit: self.commit(),
            hash,
            changes,
            tools: written,
        })
    }
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

    /// Puts a file on the base branch (`main`), as a published site would have it.
    pub fn put_main(&self, path: &str, text: &str) {
        self.lock()
            .files
            .entry("main".into())
            .or_default()
            .insert(path.to_string(), text.to_string());
    }

    /// The blob sha of a text, as [`Gateway::read_page`] answers it.
    pub fn blob_sha(text: &str) -> String {
        fake_sha(&["blob", text])
    }

    /// The site's models from now on (FEAT-095); without them
    /// [`Gateway::site_models`] fails.
    pub fn set_site(&self, site: FakeSite) {
        self.lock().site = Some(site);
    }

    /// The site's models as they are now.
    pub fn site(&self) -> Option<FakeSite> {
        self.lock().site.clone()
    }

    /// Changes another actor's edit made to the blueprint (the base of a
    /// pending proposal goes stale).
    pub fn edit_site(&self, f: impl FnOnce(&mut FakeSite)) {
        if let Some(site) = self.lock().site.as_mut() {
            f(site);
            site.writes += 1;
        }
    }
}

#[cfg_attr(not(target_arch = "wasm32"), async_trait)]
#[cfg_attr(target_arch = "wasm32", async_trait(?Send))]
impl Gateway for FakeGateway {
    async fn site_models(&self) -> Result<Value, GatewayError> {
        match self.lock().site.as_ref() {
            Some(site) => site.models(),
            None => Err(GatewayError("the fake site has no models".into())),
        }
    }

    async fn put_blueprint(&self, body: &Value) -> Result<ModelsPut, GatewayError> {
        match self.lock().site.as_mut() {
            Some(site) => site.put(body),
            None => Err(GatewayError("the fake site has no models".into())),
        }
    }

    async fn put_tool(&self, graph: &Value, message: &str) -> Result<ModelsPut, GatewayError> {
        let id = graph["id"].as_str().unwrap_or_default().to_string();
        let mut s = self.lock();
        let Some(site) = s.site.as_mut() else {
            return Err(GatewayError("the fake site has no models".into()));
        };
        let base = blueprint::hash(&site.blueprint);
        let mut tools = serde_json::Map::new();
        tools.insert(id, graph.clone());
        site.put(&serde_json::json!({"base_hash": base, "tools": tools, "message": message}))
    }

    async fn read_page(&self, path: &str) -> Result<Option<PageFile>, GatewayError> {
        let text = self
            .lock()
            .files
            .get("main")
            .and_then(|f| f.get(path))
            .cloned();
        text.map(|t| {
            let page = serde_json::from_str(&t)
                .map_err(|e| GatewayError(format!("{path} is not JSON: {e}")))?;
            Ok(PageFile {
                page,
                sha: Self::blob_sha(&t),
            })
        })
        .transpose()
    }

    async fn open_update_as(
        &self,
        content_id: &str,
        path: &str,
        page: &Value,
        message: &str,
        attribution: Option<&Attribution>,
        blob_sha: &str,
    ) -> Result<DraftPr, GatewayError> {
        let current = self
            .lock()
            .files
            .get("main")
            .and_then(|f| f.get(path))
            .cloned();
        match current {
            None => {
                return Err(GatewayError(format!(
                    "{path} does not exist on main: an update needs an existing article"
                )))
            }
            Some(t) if Self::blob_sha(&t) != blob_sha => {
                return Err(GatewayError(format!(
                    "{path} changed on main since it was read: read it again"
                )))
            }
            Some(_) => {}
        }
        self.open_draft_as(content_id, path, page, message, attribution)
            .await
    }

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

    async fn read_page(&self, path: &str) -> Result<Option<PageFile>, GatewayError> {
        let base = self.repo.base_branch().to_string();
        self.repo
            .read_page_at(&base, path)
            .await
            .map(|v| {
                v.map(|v| PageFile {
                    page: v.value,
                    sha: v.sha,
                })
            })
            .map_err(|e| GatewayError(format!("read {path}: {e}")))
    }

    async fn open_update_as(
        &self,
        content_id: &str,
        path: &str,
        page: &Value,
        message: &str,
        attribution: Option<&Attribution>,
        blob_sha: &str,
    ) -> Result<DraftPr, GatewayError> {
        match self.read_page(path).await? {
            None => Err(GatewayError(format!(
                "{path} does not exist: an update needs an existing article"
            ))),
            Some(f) if !f.sha.eq_ignore_ascii_case(blob_sha) => Err(GatewayError(format!(
                "{path} changed since it was read: read it again"
            ))),
            Some(_) => {
                self.open_draft_as(content_id, path, page, message, attribution)
                    .await
            }
        }
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
