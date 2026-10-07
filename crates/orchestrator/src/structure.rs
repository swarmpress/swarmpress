//! The architects' jobs (ADR-0072, FEAT-095): structural work items drafted
//! by a model and applied at the CEO's `StructureApproval`.
//!
//! ```text
//! Commission{kind, brief_ref}   the host stores the CEO's request as the brief
//!                               ([`structure_brief`]) and logs the command
//! Architect  (Draft, Structure) request + the site's models (Gateway::site_models)
//!   → one structured call: {summary, edits} (blueprint::proposal_schema)
//!   → edits applied (blueprint::apply_edits), checked in the site
//!     (blueprint::check), one repair turn with the issues
//!   → the item's artifact: Proposal{base_hash, proposal, changes, summary}
//!   → an `artifact` post with the summary and the change list
//!   → JobCompleted{ok, score: min(changes, 10), qa_defects: issues repaired}
//! ToolBuild  (Draft, Tool)      the same, the answer a whole tool graph
//!                               (blueprint::tool_proposal_schema, check_tool)
//! ThemeCode  (Draft, Theme)     the theme's missing block renderers, one model call
//!                               each (checked, one repair turn), written on design/<item>
//!                               as a pull request (FEAT-094); the frozen theme fails loudly
//! Publish    (after Approve)    the artifact applied through the gateway
//!   (put_blueprint on the stored base hash; put_tool) → JobCompleted{ok, commit}
//!   a stale base or a refusal   → JobFailed{InvalidOutput} and a status post
//! ToolRun                       not run here yet (FEAT-091): JobFailed{Infrastructure}
//! ```
//!
//! The orchestrator never changes a stage: the sim parks the item at the
//! gate after the Draft, and only the CEO's `Approve` starts the Publish job
//! that writes. Nothing reaches the repository before that. A model failure
//! is never a fake success (rule 11): an answer that still does not check
//! after the repair turn fails the job with `InvalidOutput`.
//!
//! **Dispatch.** The Publish job is shared with articles; the item's artifact
//! says which it is: a record with a [`Proposal`] (written by the Draft of a
//! structural item) is applied here, any other record takes the article path
//! unchanged. The request text is the item's brief, a [`structure_brief`]
//! record (the `BriefRecord` shape, so every reader of briefs keeps working)
//! whose `brief.angle` holds the CEO's words.

use std::collections::BTreeMap;

use agents::jobs::architect::{
    architect_prompt, tool_build_prompt, ArchitectInput, ToolBuildInput, ARCHITECT_ANSWER,
    TOOL_BUILD_ANSWER,
};
use agents::llm::structured_with_repair;
use agents::prompts::{templates, CompanyPrompt, Vars};
use agents::{CallProfile, LlmError, LlmMessage, LlmRequest, RepairFailed, Role};
use blueprint::edit::block_ids;
use blueprint::site::SiteContext;
use blueprint::tools::{check_tool, ToolContext, ToolGraph};
use blueprint::{apply_edits, check, diff, parse_edits, Blueprint, CheckContext, ToolSig};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::gateway::{Gateway, ModelsPut};
use crate::run::{corrupt, invalid, persona, Orchestrator, OrchestratorError, Result};
use crate::staged::stage_hash;
use crate::store::{ArtifactRecord, Store};
use crate::{Digest, JobFailure, JobRequest, Outcome, ProgressState, StaffRef};

/// The brief kinds of structural items (the sim's `WorkItemKind` slugs).
pub const STRUCTURE_KINDS: [&str; 3] = ["structure", "tool", "theme"];

/// The brief a host stores when the CEO commissions structural work: the
/// `BriefRecord` shape with the request as `brief.angle` and `kind` the
/// item's kind (`structure`, `tool` or `theme`). The title is the request's
/// first line, cut.
pub fn structure_brief(kind: &str, request: &str) -> Value {
    let title: String = request
        .trim()
        .lines()
        .next()
        .unwrap_or("")
        .chars()
        .take(80)
        .collect();
    json!({
        "job_id": 0,
        "brief": {
            "content_id": format!("{kind}-request"),
            "title": title,
            "slug": "",
            "angle": request.trim(),
            "keywords": [],
            "target_words": 0,
            "language": "en",
            "notes": "",
        },
        "writer": "",
        "editor": "",
        "kind": kind,
    })
}

/// A structural item's proposal, kept in its artifact record until the
/// Publish job applies it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Proposal {
    /// `structure` or `tool`.
    pub kind: String,
    /// The blueprint hash the proposal was made on (a structure's Publish
    /// writes on it, so a blueprint changed meanwhile is a 409).
    pub base_hash: String,
    /// The whole proposed blueprint (`structure`).
    #[serde(default, skip_serializing_if = "Value::is_null")]
    pub proposal: Value,
    /// The edits the model returned (`structure`).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub edits: Vec<Value>,
    /// The proposed tool graph (`tool`).
    #[serde(default, skip_serializing_if = "Value::is_null")]
    pub graph: Value,
    /// The semantic changes: `blueprint::Change`s, or one
    /// `{kind, subject: "tool", id}`.
    #[serde(default)]
    pub changes: Vec<Value>,
    pub summary: String,
    /// The proposal's own hash (the blueprint's or the tool's).
    #[serde(default)]
    pub hash: String,
    /// The checker's issues the first answer had (repaired since).
    #[serde(default)]
    pub repaired: Vec<String>,
    /// The theme components written (`theme`): renderer path → source.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub files: BTreeMap<String, String>,
    /// The theme's pull request (`theme`), merged by the item's Publish.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pr: Option<crate::gateway::ThemePr>,
}

/// One line per change: `added page-type author`.
fn change_lines(changes: &[Value]) -> Vec<String> {
    changes
        .iter()
        .map(|c| {
            let mut line = format!(
                "{} {} {}",
                c["kind"].as_str().unwrap_or("?"),
                c["subject"].as_str().unwrap_or("?"),
                c["id"].as_str().unwrap_or("?")
            );
            let fields: Vec<&str> = c["fields"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .collect();
            if !fields.is_empty() {
                line.push_str(&format!(" ({})", fields.join(", ")));
            }
            line
        })
        .collect()
}

/// The site's models as the jobs need them.
struct Models {
    hash: String,
    blueprint: Blueprint,
    blueprint_json: Value,
    types: BTreeMap<String, Value>,
    tools: BTreeMap<String, ToolGraph>,
    context: SiteContext,
}

impl Models {
    fn from_json(v: &Value) -> Result<Models> {
        let bad = |what: &str, e: String| invalid(format!("the site's models: {what}: {e}"));
        let blueprint = Blueprint::from_value(&v["blueprint"]).map_err(|e| bad("blueprint", e))?;
        let types: BTreeMap<String, Value> =
            serde_json::from_value(v["types"].clone()).map_err(|e| bad("types", e.to_string()))?;
        let context: SiteContext = serde_json::from_value(v["context"].clone())
            .map_err(|e| bad("context", e.to_string()))?;
        let tools = v["tools"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|t| ToolGraph::from_value(&t["graph"]).ok())
            .map(|g| (g.id.clone(), g))
            .collect();
        Ok(Models {
            hash: v["hash"]
                .as_str()
                .map(String::from)
                .unwrap_or_else(|| blueprint::hash(&blueprint)),
            blueprint_json: v["blueprint"].clone(),
            blueprint,
            types,
            tools,
            context,
        })
    }

    fn sigs(&self, except: Option<&str>) -> BTreeMap<String, ToolSig> {
        self.tools
            .values()
            .filter(|g| Some(g.id.as_str()) != except)
            .map(|g| (g.id.clone(), g.sig()))
            .collect()
    }

    fn check_context(&self) -> Result<CheckContext> {
        self.context
            .check_context(&self.types, self.sigs(None))
            .map_err(|i| invalid(format!("the site's types do not check: {i:?}")))
    }
}

/// What the architect's answer becomes, or the issues a repair turn names.
fn structure_of(
    answer: &Value,
    base: &Blueprint,
    ctx: &CheckContext,
) -> std::result::Result<(Blueprint, Vec<Value>), Vec<String>> {
    let strings = |i: Vec<blueprint::Issue>| i.iter().map(ToString::to_string).collect::<Vec<_>>();
    let edits = parse_edits(answer).map_err(strings)?;
    let next = apply_edits(base, &edits).map_err(strings)?;
    let issues = check(&next, ctx);
    if !issues.is_empty() {
        return Err(strings(issues));
    }
    let changes = diff(base, &next);
    if changes.is_empty() {
        return Err(vec![
            "/edits: the edits change nothing in the blueprint".to_string()
        ]);
    }
    Ok((
        next,
        changes
            .iter()
            .map(|c| serde_json::to_value(c).unwrap_or_default())
            .collect(),
    ))
}

/// What the tool builder's answer becomes (`added`/`changed` tool), or the
/// issues a repair turn names.
fn tool_of(
    answer: &Value,
    models: &Models,
) -> std::result::Result<(ToolGraph, Value), Vec<String>> {
    let graph = ToolGraph::from_value(&answer["graph"])
        .map_err(|e| vec![format!("/graph: not a swarmpress.tool.v1 graph: {e}")])?;
    let ctx = ToolContext {
        types: models
            .context
            .check_context(&models.types, BTreeMap::new())
            .map_err(|i| i.iter().map(ToString::to_string).collect::<Vec<_>>())?
            .types,
        tools: models.sigs(Some(&graph.id)),
        ..Default::default()
    };
    let issues = check_tool(&graph, &ctx);
    if !issues.is_empty() {
        return Err(issues.iter().map(|i| format!("/graph{}", i)).collect());
    }
    let kind = match models.tools.get(&graph.id) {
        None => "added",
        Some(old) if *old == graph => {
            return Err(vec![format!(
                "/graph: the site has this tool ({}) exactly as proposed: nothing changes",
                graph.id
            )])
        }
        Some(_) => "changed",
    };
    let change = json!({"kind": kind, "subject": "tool", "id": graph.id});
    Ok((graph, change))
}

/// Why a structured call failed, as a job outcome; `Err` when the model is
/// gone (the host waits and runs the job again).
fn failure(f: &RepairFailed) -> Result<JobFailure> {
    match &f.error {
        LlmError::InvalidOutput { .. } => Ok(JobFailure::InvalidOutput),
        LlmError::Timeout(_) => Ok(JobFailure::Timeout),
        LlmError::Unavailable(m) => Err(OrchestratorError::Unavailable(m.clone())),
        LlmError::Refusal { .. } | LlmError::Truncated { .. } | LlmError::Backend(_) => {
            Ok(JobFailure::Model)
        }
    }
}

impl<S: Store, G: Gateway> Orchestrator<S, G> {
    /// The request text of a structural item: its brief's `angle` (or a
    /// `request` field).
    async fn structure_request(&self, req: &JobRequest) -> Result<String> {
        let brief_ref = req
            .brief_ref
            .ok_or_else(|| invalid(format!("job {} has no brief_ref", req.job_id)))?;
        let v = self
            .store
            .get_brief(&req.company_id, brief_ref)
            .await?
            .ok_or_else(|| invalid(format!("unknown brief_ref {brief_ref}")))?;
        let text = v["request"]
            .as_str()
            .or_else(|| v["brief"]["angle"].as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        if text.is_empty() {
            return Err(invalid(format!(
                "brief {brief_ref} holds no request for the architect"
            )));
        }
        Ok(text)
    }

    fn architect_of<'a>(&self, req: &'a JobRequest) -> Result<&'a StaffRef> {
        req.staff
            .first()
            .ok_or_else(|| invalid(format!("job {} has nobody to do it", req.job_id)))
    }

    fn failed(&self, req: &JobRequest, reason: JobFailure) -> Vec<Outcome> {
        vec![Outcome::JobFailed {
            job_id: req.job_id,
            reason,
        }]
    }

    /// The architect's or the tool builder's model call: one structured call
    /// with one repair turn, cached as the stage `stage#0` of the job.
    #[allow(clippy::too_many_arguments)]
    async fn propose(
        &self,
        req: &JobRequest,
        who: &StaffRef,
        template: &CompanyPrompt,
        job: agents::JobKind,
        stage: &str,
        user: String,
        max_tokens: u32,
        schema: &Value,
        check: &(dyn Fn(&Value) -> std::result::Result<(), Vec<String>> + Sync),
    ) -> Result<std::result::Result<(Value, Vec<String>), RepairFailed>> {
        let p = persona(&who.persona)?;
        let system = self.system_prompt(template, &p, Vars::new())?;
        let hash = stage_hash(&[stage, &system, &user]);
        if let Some(v) = self.recall(req, stage, 0, Some(&hash)).await? {
            let repaired = v["repaired"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .map(String::from)
                .collect();
            return Ok(Ok((v["answer"].clone(), repaired)));
        }
        let request = LlmRequest {
            profile: CallProfile {
                job,
                role: who.role.parse::<Role>().unwrap_or(Role::WebDeveloper),
                seniority: Some(p.seniority),
                staff_id: Some(who.id.clone()),
            },
            system: vec![system],
            messages: vec![LlmMessage::user(user)],
            max_tokens,
            reasoning_tokens: Some(512),
        };
        // The first answer's issues, for the digest (the repair turn quotes them).
        let first: std::sync::Mutex<Option<Vec<String>>> = std::sync::Mutex::new(None);
        let counting = |v: &Value| {
            let r = check(v);
            let mut f = first.lock().unwrap_or_else(|e| e.into_inner());
            if f.is_none() {
                *f = Some(r.as_ref().err().cloned().unwrap_or_default());
            }
            r
        };
        match structured_with_repair(self.llm.as_ref(), &request, schema, &counting, 1).await {
            Ok(r) => {
                let mut repaired = first
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .clone()
                    .unwrap_or_default();
                // A first answer the backend refused against the schema never reached the check.
                if r.repairs > 0 && repaired.is_empty() {
                    repaired.push("the first answer did not fit the answer schema".into());
                }
                let row = json!({"answer": r.value, "repaired": repaired});
                let kept: Value = self.remember(req, stage, 0, hash, &row).await?;
                Ok(Ok((kept["answer"].clone(), repaired)))
            }
            Err(f) => Ok(Err(f)),
        }
    }

    /// A failed proposal: the issues in the item's thread, the job failed.
    async fn proposal_failed(
        &self,
        req: &JobRequest,
        item: &str,
        who: &StaffRef,
        f: &RepairFailed,
        what: &str,
    ) -> Result<Vec<Outcome>> {
        if let Some(reason) = self.cancelled(req) {
            return Ok(self.failed(req, reason));
        }
        let reason = failure(f)?;
        let errors = f.errors();
        let mut text = format!("The {what} could not be proposed: {}.", f.error);
        if !errors.is_empty() {
            text = format!(
                "The {what} still did not check after a repair turn:\n{}",
                errors
                    .iter()
                    .take(8)
                    .map(|e| format!("- {e}"))
                    .collect::<Vec<_>>()
                    .join("\n")
            );
        }
        self.system_post(
            req,
            item,
            "status",
            0,
            &text,
            json!({"structure": "failed", "errors": errors}),
        )
        .await?;
        self.report_job(
            req,
            Some(who),
            ProgressState::Failed,
            json!({"error": f.error.to_string()}),
        );
        Ok(self.failed(req, reason))
    }

    /// The item's title and brief in the plan text (once per job).
    async fn name_item(
        &self,
        req: &JobRequest,
        item: &str,
        kind: &str,
        request: &str,
    ) -> Result<()> {
        let first: String = request
            .lines()
            .next()
            .unwrap_or("")
            .chars()
            .take(70)
            .collect();
        let title = match kind {
            "tool" => format!("Tool: {first}"),
            _ => format!("Structure: {first}"),
        };
        Ok(self
            .store
            .set_item_text(&req.company_id, item, Some(&title), Some(request))
            .await?)
    }

    async fn store_proposal(
        &self,
        req: &JobRequest,
        item: &str,
        who: &StaffRef,
        proposal: Proposal,
    ) -> Result<Vec<Outcome>> {
        let mut art = self.load_artifact(req, item).await?.unwrap_or_default();
        art.brief_ref = req.brief_ref.unwrap_or(art.brief_ref);
        art.revision = req.revision;
        art.merged_sha = None;
        art.model = self.llm.model_id().or(art.model);
        let lines = change_lines(&proposal.changes);
        let text = format!(
            "{}\n\nChanges:\n{}",
            proposal.summary.trim(),
            lines
                .iter()
                .map(|l| format!("- {l}"))
                .collect::<Vec<_>>()
                .join("\n")
        );
        let payload = json!({"structure": {
            "kind": proposal.kind,
            "summary": proposal.summary,
            "changes": proposal.changes,
            "base_hash": proposal.base_hash,
            "hash": proposal.hash,
            "revision": req.revision,
        }});
        let n = u8::try_from(proposal.changes.len().min(10)).unwrap_or(10);
        let defects = u16::try_from(proposal.repaired.len()).unwrap_or(u16::MAX);
        let sha = proposal.hash.clone();
        art.structure = Some(proposal);
        self.save_artifact(req, item, &art).await?;
        let key = format!("{}:artifact:0", req.job_id);
        self.post(
            req,
            item,
            "artifact",
            &who.id,
            None,
            &text,
            payload,
            Some(&key),
        )
        .await?;
        self.report_job(
            req,
            Some(who),
            ProgressState::Done,
            json!({"changes": lines.len(), "repaired": defects}),
        );
        Ok(vec![Outcome::JobCompleted {
            job_id: req.job_id,
            digest: Digest {
                ok: true,
                score: n,
                words: 0,
                qa_defects: defects,
                artifact_sha: Some(sha),
            },
        }])
    }

    /// On a revision: the previous proposal's summary and the CEO's newest
    /// send-back note after it (`payload.ui_type: 'send-back-note'`).
    async fn previous_summary(&self, req: &JobRequest, item: &str) -> Result<Option<String>> {
        if req.revision == 0 {
            return Ok(None);
        }
        let Some(summary) = self
            .load_artifact(req, item)
            .await?
            .and_then(|a| a.structure)
            .map(|p| p.summary)
        else {
            return Ok(None);
        };
        let plan = self.store.plan_json(&req.company_id).await?;
        let posts = plan["posts"][item].as_array().cloned().unwrap_or_default();
        let last = posts.iter().rposition(|p| {
            p["type"] == "artifact" && p["payload"]["structure"]["changes"].is_array()
        });
        let note = posts
            .iter()
            .enumerate()
            .rev()
            .find(|(i, p)| {
                p["payload"]["ui_type"] == "send-back-note" && last.is_none_or(|d| *i > d)
            })
            .and_then(|(_, p)| p["text"].as_str())
            .map(str::trim)
            .filter(|t| !t.is_empty());
        Ok(Some(match note {
            Some(n) => format!("{summary}\nThe CEO's note: {n}"),
            None => summary,
        }))
    }

    /// The `Architect` job (module docs).
    pub(crate) async fn architect(&self, req: &JobRequest) -> Result<Vec<Outcome>> {
        let item = self.work_item(req)?.to_string();
        let who = self.architect_of(req)?.clone();
        self.report_job(req, Some(&who), ProgressState::Started, json!({}));
        let request = self.structure_request(req).await?;
        self.name_item(req, &item, "structure", &request).await?;
        if let Some(reason) = self.cancelled(req) {
            return Ok(self.failed(req, reason));
        }
        let models = Models::from_json(&self.gateway.site_models().await?)?;
        let ctx = models.check_context()?;
        let blocks = block_ids(&ctx);
        let core: Vec<String> = content_model::PageTypes::core()
            .iter()
            .map(|t| t.id.clone())
            .collect();
        let previous = self.previous_summary(req, &item).await?;
        let user = architect_prompt(&ArchitectInput {
            request: &request,
            blueprint: &models.blueprint_json,
            core_types: &core,
            blocks: &blocks,
            sections: &models.context.sections,
            collections: &models.context.collections,
            previous: previous.as_deref(),
        });
        let schema = blueprint::proposal_schema(&blocks);
        let check = |v: &Value| structure_of(v, &models.blueprint, &ctx).map(|_| ());
        let answer = self
            .propose(
                req,
                &who,
                &templates::information_architect(),
                agents::JobKind::SiteArchitect,
                "architect",
                user,
                ARCHITECT_ANSWER,
                &schema,
                &check,
            )
            .await?;
        let (value, repaired) = match answer {
            Ok(a) => a,
            Err(f) => {
                return self
                    .proposal_failed(req, &item, &who, &f, "blueprint change")
                    .await
            }
        };
        let (next, changes) = match structure_of(&value, &models.blueprint, &ctx) {
            Ok(r) => r,
            Err(errors) => {
                let f = RepairFailed {
                    error: LlmError::InvalidOutput {
                        errors,
                        answer: None,
                    },
                    calls: 0,
                    repairs: 0,
                    no_progress: false,
                };
                return self
                    .proposal_failed(req, &item, &who, &f, "blueprint change")
                    .await;
            }
        };
        let proposal = Proposal {
            kind: "structure".into(),
            base_hash: models.hash.clone(),
            proposal: serde_json::to_value(&next).map_err(corrupt)?,
            edits: value["edits"].as_array().cloned().unwrap_or_default(),
            graph: Value::Null,
            changes,
            summary: value["summary"].as_str().unwrap_or("").trim().to_string(),
            hash: blueprint::hash(&next),
            repaired,
            files: BTreeMap::new(),
            pr: None,
        };
        self.store_proposal(req, &item, &who, proposal).await
    }

    /// The `ToolBuild` job (module docs).
    pub(crate) async fn tool_build(&self, req: &JobRequest) -> Result<Vec<Outcome>> {
        let item = self.work_item(req)?.to_string();
        let who = self.architect_of(req)?.clone();
        self.report_job(req, Some(&who), ProgressState::Started, json!({}));
        let request = self.structure_request(req).await?;
        self.name_item(req, &item, "tool", &request).await?;
        if let Some(reason) = self.cancelled(req) {
            return Ok(self.failed(req, reason));
        }
        let models = Models::from_json(&self.gateway.site_models().await?)?;
        let types: Vec<(String, Value)> = models
            .types
            .iter()
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect();
        let builtin: Vec<String> = blueprint::TypeRegistry::default()
            .names()
            .filter(|n| !models.types.contains_key(*n))
            .map(String::from)
            .collect();
        let tools: Vec<String> = models
            .tools
            .values()
            .map(|g| {
                let ports = |m: &BTreeMap<String, String>| {
                    m.iter()
                        .map(|(k, v)| format!("{k}: {v}"))
                        .collect::<Vec<_>>()
                        .join(", ")
                };
                format!(
                    "{}: ({}) -> ({})",
                    g.id,
                    ports(&g.inputs),
                    ports(&g.outputs)
                )
            })
            .collect();
        let previous = self.previous_summary(req, &item).await?;
        let user = tool_build_prompt(&ToolBuildInput {
            request: &request,
            types: &types,
            builtin_types: &builtin,
            tools: &tools,
            previous: previous.as_deref(),
        });
        let schema = blueprint::tool_proposal_schema();
        let check = |v: &Value| tool_of(v, &models).map(|_| ());
        let answer = self
            .propose(
                req,
                &who,
                &templates::web_developer(),
                agents::JobKind::ToolBuild,
                "tool_build",
                user,
                TOOL_BUILD_ANSWER,
                &schema,
                &check,
            )
            .await?;
        let (value, repaired) = match answer {
            Ok(a) => a,
            Err(f) => return self.proposal_failed(req, &item, &who, &f, "tool").await,
        };
        let (graph, change) = match tool_of(&value, &models) {
            Ok(r) => r,
            Err(errors) => {
                let f = RepairFailed {
                    error: LlmError::InvalidOutput {
                        errors,
                        answer: None,
                    },
                    calls: 0,
                    repairs: 0,
                    no_progress: false,
                };
                return self.proposal_failed(req, &item, &who, &f, "tool").await;
            }
        };
        let proposal = Proposal {
            kind: "tool".into(),
            base_hash: models.hash.clone(),
            proposal: Value::Null,
            edits: Vec::new(),
            hash: graph.hash(),
            graph: serde_json::to_value(&graph).map_err(corrupt)?,
            changes: vec![change],
            summary: value["summary"].as_str().unwrap_or("").trim().to_string(),
            repaired,
            files: BTreeMap::new(),
            pr: None,
        };
        self.store_proposal(req, &item, &who, proposal).await
    }

    /// The `ThemeCode` job (FEAT-094): the components of the blocks the
    /// blueprint uses and the theme has no renderer for, at most
    /// `blueprint::theme::MAX_COMPONENTS_PER_JOB`, each one model call with
    /// one repair turn under `blueprint::theme::check_component`, written on
    /// `design/<item>` as a pull request the item's Publish merges after the
    /// CEO's approval. A site that still builds the frozen theme fails
    /// loudly (CLAUDE.md rules 9 and 11); nothing missing completes with
    /// nothing to merge.
    pub(crate) async fn theme_code(&self, req: &JobRequest) -> Result<Vec<Outcome>> {
        let item = self.work_item(req)?.to_string();
        let who = self.architect_of(req)?.clone();
        self.report_job(req, Some(&who), ProgressState::Started, json!({}));
        let request = self.structure_request(req).await?;
        self.name_item(req, &item, "theme", &request).await?;
        if let Some(reason) = self.cancelled(req) {
            return Ok(self.failed(req, reason));
        }
        let raw = self.gateway.site_models().await?;
        let models = Models::from_json(&raw)?;
        if raw["kit_theme"] != json!(true) {
            self.system_post(
                req,
                &item,
                "status",
                0,
                "The site still builds the frozen theme: theme generation waits for the cutover, so nothing was written.",
                json!({"structure": "frozen-theme", "feature": "FEAT-094"}),
            )
            .await?;
            self.report_job(
                req,
                Some(&who),
                ProgressState::Failed,
                json!({"error": "frozen theme"}),
            );
            return Ok(self.failed(req, JobFailure::Infrastructure));
        }
        let have: std::collections::BTreeSet<String> = raw["theme_files"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(String::from)
            .collect();
        let tokens: Vec<(String, String)> = raw["tokens"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|t| Some((t[0].as_str()?.to_string(), t[1].as_str()?.to_string())))
            .collect();
        let keywords: Vec<String> = models
            .blueprint
            .intent
            .keywords
            .iter()
            .filter_map(|k| serde_json::to_value(k).ok()?.as_str().map(String::from))
            .collect();
        let missing = blueprint::theme::missing_renderers(&models.blueprint, &have);
        let todo: Vec<String> = missing
            .iter()
            .take(blueprint::theme::MAX_COMPONENTS_PER_JOB)
            .cloned()
            .collect();
        if todo.is_empty() {
            self.system_post(
                req,
                &item,
                "artifact",
                0,
                "Every block the blueprint uses already has a renderer in the theme: nothing to write.",
                json!({"structure": "theme-complete"}),
            )
            .await?;
            let proposal = Proposal {
                kind: "theme".into(),
                base_hash: models.hash.clone(),
                proposal: Value::Null,
                edits: Vec::new(),
                graph: Value::Null,
                changes: Vec::new(),
                summary: "Nothing to write: the theme renders every block.".into(),
                hash: models.hash.clone(),
                repaired: Vec::new(),
                files: BTreeMap::new(),
                pr: None,
            };
            return self.store_proposal(req, &item, &who, proposal).await;
        }
        let registry = content_model::SchemaRegistry::core();
        let mut files = BTreeMap::new();
        let mut repaired = Vec::new();
        for block in &todo {
            if let Some(reason) = self.cancelled(req) {
                return Ok(self.failed(req, reason));
            }
            let doc = content_model::docs::block_doc(&registry, block).unwrap_or_else(|| {
                format!("`{block}`: the site's own block (its schema is in theme/blocks).")
            });
            let intent = content_model::block_meta(block)
                .and_then(|m| serde_json::to_value(m.intent).ok())
                .and_then(|v| v.as_str().map(String::from))
                .unwrap_or_else(|| "inform".into());
            let user = agents::theme::component_prompt(block, &doc, &intent, &tokens, &keywords);
            let schema = agents::theme::component_schema();
            let check = |v: &Value| {
                blueprint::theme::check_component(v["component"].as_str().unwrap_or_default())
            };
            let stage = format!("theme_code:{block}");
            let answer = self
                .propose(
                    req,
                    &who,
                    &templates::web_developer(),
                    agents::JobKind::ThemeCode,
                    &stage,
                    user,
                    agents::theme::COMPONENT_ANSWER,
                    &schema,
                    &check,
                )
                .await?;
            match answer {
                Ok((v, r)) => {
                    repaired.extend(r.into_iter().map(|i| format!("{block}: {i}")));
                    files.insert(
                        blueprint::theme::renderer_path(block),
                        v["component"].as_str().unwrap_or_default().to_string(),
                    );
                }
                Err(f) => return self.proposal_failed(req, &item, &who, &f, "theme").await,
            }
        }
        let message = format!("Theme components for {item}: {}", todo.join(", "));
        let pr = self.gateway.put_theme(&item, &files, &message).await?;
        let changes: Vec<Value> = files
            .keys()
            .map(|p| json!({"kind": "added", "subject": "renderer", "id": p}))
            .collect();
        let left = missing.len() - todo.len();
        let summary = format!(
            "Components for {}{} (pull request #{}).",
            todo.join(", "),
            if left > 0 {
                format!("; {left} more blocks wait for the next job")
            } else {
                String::new()
            },
            pr.number
        );
        let proposal = Proposal {
            kind: "theme".into(),
            base_hash: models.hash.clone(),
            proposal: Value::Null,
            edits: Vec::new(),
            graph: Value::Null,
            changes,
            summary,
            hash: pr.head_sha.clone(),
            repaired,
            files,
            pr: Some(pr),
        };
        self.store_proposal(req, &item, &who, proposal).await
    }

    /// The `ToolRun` job: the orchestrator does not run tools yet (FEAT-091's
    /// interpreter is not wired into the game). It fails loudly: the sim
    /// counts the failed run.
    pub(crate) async fn tool_run(&self, req: &JobRequest) -> Result<Vec<Outcome>> {
        let who = req.staff.first();
        self.report_job(
            req,
            who,
            ProgressState::Failed,
            json!({"error": "tool runs are not wired into the orchestrator yet"}),
        );
        Ok(self.failed(req, JobFailure::Infrastructure))
    }

    /// The Publish job of a structural item: the approved proposal applied
    /// through the gateway (module docs). `art` holds its [`Proposal`].
    pub(crate) async fn apply_structure(
        &self,
        req: &JobRequest,
        item: &str,
        mut art: ArtifactRecord,
    ) -> Result<Vec<Outcome>> {
        let p = art
            .structure
            .clone()
            .ok_or_else(|| invalid(format!("{item} has no structural proposal")))?;
        let completed = |sha: String| {
            vec![Outcome::JobCompleted {
                job_id: req.job_id,
                digest: Digest {
                    ok: true,
                    score: 0,
                    words: 0,
                    qa_defects: 0,
                    artifact_sha: Some(sha),
                },
            }]
        };
        // Applied already: a run again after a reload writes nothing.
        if let Some(sha) = art.merged_sha.clone() {
            return Ok(completed(sha));
        }
        if let Some(reason) = self.cancelled(req) {
            return Ok(self.failed(req, reason));
        }
        let approver = req
            .approved_by
            .as_deref()
            .filter(|a| !a.trim().is_empty())
            .map(|a| format!(", approved by {a}"))
            .unwrap_or_default();
        let message = format!(
            "{} ({item}, job {}{approver})",
            p.summary
                .lines()
                .next()
                .unwrap_or("Structure change")
                .trim(),
            req.job_id
        );
        // A theme: its pull request merges (nothing to merge when every block had a renderer).
        if p.kind == "theme" {
            let commit = match &p.pr {
                Some(pr) => self.gateway.merge_theme(pr.number, &pr.head_sha).await?,
                None => p.base_hash.clone(),
            };
            art.merged_sha = Some(commit.clone());
            self.save_artifact(req, item, &art).await?;
            self.system_post(
                req,
                item,
                "artifact",
                0,
                &format!(
                    "Applied to the site: {} theme components ({})",
                    p.files.len(),
                    &commit[..commit.len().min(7)]
                ),
                json!({"structure": "applied", "commit": commit, "files": p.files.keys().collect::<Vec<_>>()}),
            )
            .await?;
            return Ok(completed(commit));
        }
        let put = match p.kind.as_str() {
            "tool" => self.gateway.put_tool(&p.graph, &message).await?,
            _ => {
                self.gateway
                    .put_blueprint(&json!({
                        "blueprint": p.proposal,
                        "base_hash": p.base_hash,
                        "message": message,
                    }))
                    .await?
            }
        };
        match put {
            ModelsPut::Landed {
                commit,
                changes,
                tools,
                ..
            } => {
                art.merged_sha = Some(commit.clone());
                self.save_artifact(req, item, &art).await?;
                let what = if p.kind == "tool" {
                    format!("tool {}", tools.join(", "))
                } else {
                    format!(
                        "{} {}",
                        changes.len(),
                        if changes.len() == 1 {
                            "change"
                        } else {
                            "changes"
                        }
                    )
                };
                self.system_post(
                    req,
                    item,
                    "artifact",
                    0,
                    &format!(
                        "Applied to the site: {what} ({})",
                        &commit[..commit.len().min(7)]
                    ),
                    json!({"structure": "applied", "commit": commit, "changes": changes, "tools": tools}),
                )
                .await?;
                Ok(completed(commit))
            }
            ModelsPut::Stale { error } => {
                self.system_post(
                    req,
                    item,
                    "status",
                    1,
                    "The blueprint changed meanwhile, so this proposal was not applied: send it back for a new one.",
                    json!({"structure": "stale", "error": error, "base_hash": p.base_hash}),
                )
                .await?;
                Ok(self.failed(req, JobFailure::InvalidOutput))
            }
            ModelsPut::Refused { error, issues } => {
                let lines: Vec<String> = issues.iter().take(8).map(|i| format!("- {i}")).collect();
                self.system_post(
                    req,
                    item,
                    "status",
                    2,
                    &format!("The site refused the change: {error}\n{}", lines.join("\n")),
                    json!({"structure": "refused", "error": error, "issues": issues}),
                )
                .await?;
                Ok(self.failed(req, JobFailure::InvalidOutput))
            }
        }
    }
}
