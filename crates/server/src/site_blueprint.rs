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
//!   kit), slots with issues marked.
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

    let ctx = site::context(src, &types, sigs.clone()).map_err(fail)?;
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
    let design = town(&bp, &TownInput { issues: flagged });

    Ok(json!({
        "commit": commit,
        "source": source,
        "hash": blueprint::hash(&bp),
        "blueprint": bp,
        "types": types,
        "issues": issues_json(&issues),
        "tools": tools,
        "tool_errors": tool_errors,
        "town": design,
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
