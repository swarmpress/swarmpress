//! The site's blueprint and tools (ADR-0072, FEAT-090, FEAT-091).
//!
//! `GET /api/site/blueprint` (session cookie and the company lease, like the
//! gateway) answers the semantic models of the site at the head of the
//! company's base branch:
//!
//! * the blueprint from `blueprint/site.json` with its named types, or, when
//!   the site has none yet, one reverse-engineered from its pages without a
//!   model (`blueprint::import`, `source: "imported"`, read-only);
//! * its tools (`blueprint/tools/*.tool.json`), each with its hash, the
//!   issues of the tool checker and the manifest it installs with;
//! * the checker's issues for the blueprint in its site (custom blocks,
//!   manifest sections and collections, the tools);
//! * the brick town (a `swarmpress.design.v1` the browser compiles with the
//!   kit), slots with issues marked;
//! * the theme as the ThemeCode job needs it: `theme_files` (block
//!   renderers), `kit_theme` (a site-kit theme, not the frozen one) and
//!   `tokens` (`[name, value]` CSS variables);
//! * the site facts of the checker's context (custom blocks, manifest
//!   sections and collections), so the browser checks edits with
//!   `blueprint-wasm` exactly as here.
//!
//! Everything is deterministic for a commit and cached per (repository,
//! commit); the ETag is the commit and `If-None-Match` gets 304.

use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::sync::{Arc, Mutex};

use axum::extract::State;
use axum::http::header::{CACHE_CONTROL, ETAG};
use axum::http::{HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use blueprint::tools::{check_tool, manifest, ToolContext, ToolGraph};
use blueprint::town::{town, TownInput};
use blueprint::{check, site, ToolSig};
use knowledge::SiteSource;
use serde_json::{json, Value};

use crate::app::AppState;
use crate::auth::CurrentUser;
use crate::companies::require_lease;
use crate::error::{AppError, AppResult};
use crate::gateway::{company_repo, gh_error};
use crate::site_knowledge::{base_head, if_none_match};

const CACHE_ENTRIES: usize = 8;

#[derive(Debug)]
struct Modeled {
    repo: String,
    commit: String,
    body: Value,
}

/// Answers by (repository, commit), most recently used last.
#[derive(Debug, Default)]
pub struct BlueprintCache {
    entries: Mutex<VecDeque<Arc<Modeled>>>,
}

impl BlueprintCache {
    fn get(&self, repo: &str, sha: &str) -> Option<Arc<Modeled>> {
        let mut e = self.entries.lock().unwrap_or_else(|p| p.into_inner());
        let at = e.iter().position(|a| a.repo == repo && a.commit == sha)?;
        let hit = e.remove(at)?;
        e.push_back(hit.clone());
        Some(hit)
    }

    fn insert(&self, a: Arc<Modeled>) {
        let mut e = self.entries.lock().unwrap_or_else(|p| p.into_inner());
        e.retain(|x| !(x.repo == a.repo && x.commit == a.commit));
        e.push_back(a);
        while e.len() > CACHE_ENTRIES {
            e.pop_front();
        }
    }
}

fn issues_json(issues: &[blueprint::Issue]) -> Value {
    serde_json::to_value(issues).unwrap_or(Value::Null)
}

/// The site's models at one commit, as the endpoint answers them. Pure over
/// the tree: the tests call it on a fixture checkout.
pub fn models_of(src: &dyn SiteSource, commit: &str) -> Result<Value, String> {
    let fail = |issues: Vec<blueprint::Issue>| {
        issues
            .iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>()
            .join("; ")
    };
    let stored = site::load(src).map_err(fail)?;
    let (source, bp, types) = match stored.blueprint {
        Some(bp) => ("repo", bp, stored.types),
        None => {
            let imported = blueprint::import::import(src).map_err(|e| e.to_string())?;
            ("imported", imported.blueprint, imported.types)
        }
    };

    // Tools.
    let mut graphs = Vec::new();
    let mut tool_errors = Vec::new();
    let tool_paths = src
        .list(blueprint::format::TOOLS_DIR)
        .map_err(|e| e.to_string())?;
    for path in tool_paths.iter().filter(|p| p.ends_with(".tool.json")) {
        let parsed = src
            .read_json(path)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("{path} vanished"))
            .and_then(|v| ToolGraph::from_value(&v));
        match parsed {
            Ok(g) => graphs.push(g),
            Err(e) => tool_errors.push(json!({ "path": path, "error": e })),
        }
    }
    let sigs: BTreeMap<String, ToolSig> = graphs.iter().map(|g| (g.id.clone(), g.sig())).collect();

    let site_ctx = site::site_context(src).map_err(fail)?;
    let ctx = site_ctx.check_context(&types, sigs.clone()).map_err(fail)?;
    let issues = check(&bp, &ctx);
    let tool_ctx = ToolContext {
        types: ctx.types.clone(),
        tools: sigs,
        skills: BTreeMap::new(),
        tables: BTreeSet::new(),
    };
    let tools: Vec<Value> = graphs
        .iter()
        .map(|g| {
            json!({
                "id": g.id,
                "hash": g.hash(),
                "graph": g,
                "issues": issues_json(&check_tool(g, &tool_ctx)),
                "manifest": manifest(g),
            })
        })
        .collect();

    // Slots with issues show in the bricks.
    let mut flagged = BTreeSet::new();
    for i in &issues {
        let mut parts = i.path.trim_start_matches('/').split('/');
        if let (Some("page_types"), Some(t), Some("slots"), Some(s)) =
            (parts.next(), parts.next(), parts.next(), parts.next())
        {
            let (Ok(t), Ok(s)) = (t.parse::<usize>(), s.parse::<usize>()) else {
                continue;
            };
            if let Some(pt) = bp.page_types.get(t) {
                if let Some(slot) = pt.slots.as_ref().and_then(|v| v.get(s)) {
                    flagged.insert(format!("{}/{}", pt.id, slot.id));
                }
            }
        }
    }
    // Tools stand as machines; a node with a checker issue wears a red brick.
    let machines = graphs
        .iter()
        .map(|g| {
            let broken = check_tool(g, &tool_ctx)
                .iter()
                .filter_map(|i| {
                    let rest = i.path.strip_prefix("/nodes/")?;
                    let key = rest.split('/').next()?;
                    match key.parse::<usize>() {
                        Ok(k) => g.nodes.get(k).map(|n| n.id().to_string()),
                        Err(_) => Some(key.to_string()),
                    }
                })
                .collect();
            blueprint::machines::MachineInput {
                graph: g.clone(),
                broken,
            }
        })
        .collect();
    let design = town(
        &bp,
        &TownInput {
            issues: flagged,
            tools: machines,
        },
    );

    // The theme as the ThemeCode job sees it (FEAT-094): its block renderers,
    // whether it is a site-kit theme at all, and its tokens as CSS variables.
    let theme_files: Vec<String> = src
        .list("theme/blocks")
        .map_err(|e| e.to_string())?
        .into_iter()
        .filter(|p| blueprint::theme::block_of_path(p).is_some())
        .collect();
    let kit_theme = src
        .exists(crate::site_theme::THEME_CONFIG)
        .map_err(|e| e.to_string())?;
    let tokens: Vec<Value> = src
        .read_json(blueprint::theme::TOKENS_PATH)
        .map_err(|e| e.to_string())?
        .map(|t| blueprint::theme::flatten_tokens(&t))
        .unwrap_or_default()
        .into_iter()
        .map(|(k, v)| json!([k, v]))
        .collect();

    Ok(json!({
        "commit": commit,
        "source": source,
        "hash": blueprint::hash(&bp),
        "blueprint": bp,
        "types": types,
        "issues": issues_json(&issues),
        "context": site_ctx,
        "tools": tools,
        "tool_errors": tool_errors,
        "town": design,
        "theme_files": theme_files,
        "kit_theme": kit_theme,
        "tokens": tokens,
    }))
}

/// `GET /api/site/blueprint` (module docs).
pub async fn get_blueprint(
    State(st): State<AppState>,
    CurrentUser(user): CurrentUser,
    headers: HeaderMap,
) -> AppResult<Response> {
    let fenced = require_lease(&st, &headers, &user).await?;
    let company = &fenced.company;
    let repo = company_repo(&st, company)?;
    let api = st.github.api_for(&repo).await?;
    let head = base_head(api.as_ref(), &repo, &company.site_base_branch).await?;
    let etag =
        HeaderValue::from_str(&format!("\"{head}\"")).map_err(|e| AppError::Internal(e.into()))?;
    let cache = HeaderValue::from_static("no-cache");
    if if_none_match(&headers, &head) {
        return Ok((
            StatusCode::NOT_MODIFIED,
            [(ETAG, etag), (CACHE_CONTROL, cache)],
        )
            .into_response());
    }
    let name = repo.to_string().to_ascii_lowercase();
    let hit = match st.blueprints.get(&name, &head) {
        Some(hit) => hit,
        None => {
            // The whole tree: content, blueprint/ and theme/blocks.
            let snap = api.snapshot(&repo, &head, "").await.map_err(gh_error)?;
            let body = models_of(&snap, &head).map_err(|e| {
                AppError::BadGateway(format!(
                    "the models of {repo} at {head} cannot be read: {e}"
                ))
            })?;
            let m = Arc::new(Modeled {
                repo: name,
                commit: head.clone(),
                body,
            });
            st.blueprints.insert(m.clone());
            m
        }
    };
    Ok((
        [(ETAG, etag), (CACHE_CONTROL, cache)],
        Json(hit.body.clone()),
    )
        .into_response())
}

#[derive(serde::Deserialize)]
pub struct PutBody {
    /// The new blueprint (`swarmpress.blueprint.v1`); absent: kept (a PUT of
    /// tools only).
    #[serde(default)]
    pub blueprint: Option<Value>,
    /// The site's types, when they change too (name → schema); absent: kept.
    #[serde(default)]
    pub types: Option<BTreeMap<String, Value>>,
    /// The hash of the blueprint the edit was made on (`hash` of the GET):
    /// a different current hash means someone else changed it first (409).
    pub base_hash: String,
    #[serde(default)]
    pub message: Option<String>,
    /// Tools to install or replace (id → `swarmpress.tool.v1` graph), written
    /// to `blueprint/tools/<id>.tool.json` after the tool checker passes in
    /// the site's context (FEAT-095: the Web Developer's `ToolBuild`, applied
    /// at the CEO's `StructureApproval`); absent: the tools are kept.
    #[serde(default)]
    pub tools: Option<BTreeMap<String, Value>>,
}

fn pretty(v: &impl serde::Serialize) -> Vec<u8> {
    let mut s = serde_json::to_string_pretty(v).unwrap_or_default();
    s.push('\n');
    s.into_bytes()
}

/// `PUT /api/site/blueprint`: the CEO's edit of the site's structure
/// (ADR-0072 decision 8). The blueprint is checked in its site exactly as the
/// GET checks it (422 with the issues), written by the structure actor
/// (`blueprint/` only, on a `structure/` branch), the site's page-type
/// registry (`content/config/page-types.json`) is derived from it by the
/// platform, and the branch is squash-merged into the base branch. Answers
/// `{commit, hash, changes, tools}`: the new base head, the blueprint's hash,
/// the semantic diff from the one it replaced and the ids of the tools
/// written.
///
/// `tools` (optional, FEAT-095) installs or replaces tools: each graph's id
/// must be its key, and it must pass `check_tool` in the site's context (its
/// types and the other tools' signatures, the new ones included), else 422
/// with the issues; the blueprint is then checked against the new tools too.
pub async fn put_blueprint(
    State(st): State<AppState>,
    CurrentUser(user): CurrentUser,
    headers: HeaderMap,
    Json(body): Json<PutBody>,
) -> AppResult<Json<Value>> {
    use github::{
        ActorKind, GuardedRepo, MergeMethod, MergeOptions, NewPullRequest, PutFile, RepoApi,
    };

    let fenced = require_lease(&st, &headers, &user).await?;
    let company = &fenced.company;
    let repo = company_repo(&st, company)?;
    let _guard = st.repo_lock(&repo.to_string()).await;
    let api = st.github.api_for(&repo).await?;
    let head = base_head(api.as_ref(), &repo, &company.site_base_branch).await?;
    let snap = api.snapshot(&repo, &head, "").await.map_err(gh_error)?;
    let current = models_of(&snap, &head).map_err(|e| {
        AppError::BadGateway(format!(
            "the models of {repo} at {head} cannot be read: {e}"
        ))
    })?;
    if current["hash"].as_str() != Some(body.base_hash.as_str()) {
        return Err(AppError::Conflict(format!(
            "the blueprint changed since this edit began (now {})",
            current["hash"].as_str().unwrap_or_default()
        )));
    }
    let old = blueprint::Blueprint::from_value(&current["blueprint"])
        .map_err(|e| AppError::Internal(anyhow::anyhow!(e)))?;
    let new = match &body.blueprint {
        Some(v) => blueprint::Blueprint::from_value(v)
            .map_err(|e| AppError::BadRequest(format!("not a blueprint: {e}")))?,
        None => old.clone(),
    };
    let types_changed = body.types.is_some();
    let types: BTreeMap<String, Value> = match body.types {
        Some(t) => t,
        None => serde_json::from_value(current["types"].clone()).unwrap_or_default(),
    };
    let mut tools: BTreeMap<String, ToolGraph> = current["tools"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|t| ToolGraph::from_value(&t["graph"]).ok())
        .map(|g| (g.id.clone(), g))
        .collect();
    let mut new_tools: Vec<ToolGraph> = Vec::new();
    for (id, v) in body.tools.iter().flatten() {
        let g = ToolGraph::from_value(v).map_err(|e| AppError::Unprocessable {
            message: format!("tool {id} is not a tool graph"),
            issues: vec![e],
        })?;
        if g.id != *id {
            return Err(AppError::BadRequest(format!(
                "tool {id}: the graph's id is {}",
                g.id
            )));
        }
        if tools.get(id) != Some(&g) {
            new_tools.push(g.clone());
        }
        tools.insert(id.clone(), g);
    }
    let sigs: BTreeMap<String, ToolSig> = tools.values().map(|g| (g.id.clone(), g.sig())).collect();
    let fail = |issues: Vec<blueprint::Issue>| AppError::Unprocessable {
        message: "the blueprint does not check".into(),
        issues: issues.iter().map(ToString::to_string).collect(),
    };
    let ctx = site::site_context(&snap)
        .map_err(fail)?
        .check_context(&types, sigs.clone())
        .map_err(fail)?;
    let tool_ctx = ToolContext {
        types: ctx.types.clone(),
        tools: sigs,
        skills: BTreeMap::new(),
        tables: BTreeSet::new(),
    };
    for g in &new_tools {
        let issues = check_tool(g, &tool_ctx);
        if !issues.is_empty() {
            return Err(AppError::Unprocessable {
                message: format!("tool {} does not check", g.id),
                issues: issues.iter().map(ToString::to_string).collect(),
            });
        }
    }
    let issues = check(&new, &ctx);
    if !issues.is_empty() {
        return Err(fail(issues));
    }
    let changes = blueprint::diff(&old, &new);
    let hash = blueprint::hash(&new);
    let tool_ids: Vec<&str> = new_tools.iter().map(|g| g.id.as_str()).collect();
    if changes.is_empty() && current["source"] == "repo" && !types_changed && new_tools.is_empty() {
        return Ok(Json(
            json!({ "commit": head, "hash": hash, "changes": [], "tools": [] }),
        ));
    }

    // Write: the structure actor on its branch, the derived registry by the platform.
    let guarded: Arc<dyn RepoApi> =
        Arc::new(GuardedRepo::new(api.clone(), ActorKind::StructureAgent));
    // One branch per change: the blueprint's hash, and the new tools' hashes when tools change.
    let branch = match new_tools.first() {
        None => format!("structure/{}", &hash[..12]),
        Some(g) => format!("structure/{}-{}", &hash[..8], &g.hash()[..8]),
    };
    if api
        .get_branch(&repo, &branch)
        .await
        .map_err(gh_error)?
        .is_none()
    {
        guarded
            .create_branch(&repo, &branch, &head)
            .await
            .map_err(gh_error)?;
    }
    let message = body
        .message
        .unwrap_or_else(|| "Update the site blueprint".to_string());
    let sha_at = |path: &str| snap.files.contains_key(path);
    let mut writes: Vec<(String, Vec<u8>, bool)> =
        vec![(blueprint::BLUEPRINT_PATH.to_string(), pretty(&new), true)];
    for (name, schema) in &types {
        writes.push((
            format!("{}/{name}.json", blueprint::format::TYPES_DIR),
            pretty(schema),
            true,
        ));
    }
    for g in &new_tools {
        writes.push((
            format!("{}/{}.tool.json", blueprint::format::TOOLS_DIR, g.id),
            pretty(g),
            true,
        ));
    }
    let registry = new.registry();
    if registry["page_types"]
        .as_array()
        .is_some_and(|a| !a.is_empty())
        || sha_at(content_model::SITE_PAGE_TYPES_PATH)
    {
        writes.push((
            content_model::SITE_PAGE_TYPES_PATH.to_string(),
            pretty(&registry),
            false,
        ));
    }
    for (path, bytes, structure) in writes {
        if snap.files.get(&path).map(|t| t.as_bytes()) == Some(bytes.as_slice()) {
            continue;
        }
        let existing = api
            .get_file(&repo, &branch, &path)
            .await
            .map_err(gh_error)?
            .map(|f| f.sha);
        let put = PutFile {
            branch: branch.clone(),
            path: path.clone(),
            content: bytes,
            message: message.clone(),
            expected_sha: existing,
            author: None,
        };
        let target: &Arc<dyn RepoApi> = if structure { &guarded } else { &api };
        target.put_file(&repo, &put).await.map_err(gh_error)?;
    }
    let branch_head = api
        .get_branch(&repo, &branch)
        .await
        .map_err(gh_error)?
        .map(|b| b.sha)
        .unwrap_or_default();
    if branch_head == head {
        return Ok(Json(
            json!({ "commit": head, "hash": hash, "changes": changes, "tools": tool_ids }),
        ));
    }
    let pr = api
        .create_pr(
            &repo,
            &NewPullRequest {
                title: message.clone(),
                head: branch.clone(),
                base: company.site_base_branch.clone(),
                body: format!(
                    "The site's structure (ADR-0072): {} changes.",
                    changes.len()
                ),
                draft: false,
            },
        )
        .await
        .map_err(gh_error)?;
    let merged = api
        .merge_pr(
            &repo,
            pr.number,
            &MergeOptions {
                method: MergeMethod::Squash,
                expected_head_sha: Some(branch_head),
                commit_title: Some(format!("{message} (#{})", pr.number)),
                commit_message: None,
            },
        )
        .await
        .map_err(gh_error)?;
    tracing::info!(company_id = %company.id, pr = pr.number, %hash, "blueprint updated");
    Ok(Json(
        json!({ "commit": merged.sha, "hash": hash, "changes": changes, "tools": tool_ids }),
    ))
}
