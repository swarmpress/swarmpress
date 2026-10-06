//! wasm-bindgen facade over the site blueprint and tool graphs
//! (`crates/blueprint`, ADR-0072) for the blueprint canvas (FEAT-090). Built
//! by `cargo xtask wasm` into `crates/blueprint-wasm/pkg`; the browser checks
//! and diffs edits with the very code the server runs.
//!
//! JSON goes in and out as strings. Every function that can refuse its input
//! throws a JSON array of issues (`{code, path, message}`) instead.
//!
//! ```ts
//! export function blueprintInfo(): string                       // {"version"}
//! export function checkBlueprint(bp: string, ctx: string): string   // Issue[]
//! export function hashBlueprint(bp: string): string
//! export function diffBlueprints(old: string, next: string): string  // Change[]
//! export function applyChanges(base: string, proposal: string, changes: string): string  // Blueprint
//! export function townDesign(bp: string, flagged: string): string    // design.v1; flagged: ["type/slot"]
//! export function pageTypesOf(bp: string): string                   // the site's page-type registry file
//! export function checkTool(graph: string, ctx: string): string      // Issue[]
//! export function toolManifest(graph: string): string               // the SDK manifest
//! export function toolSignature(graph: string): string              // {inputs, outputs} as type expressions
//! ```
//!
//! `ctx` is `{types: {Name: schema}, custom_blocks: [], sections: [],
//! collections: [], tools: [graph…], skills: {ext: [tool…]}, tables: []}`:
//! the `context` and `types` of `GET /api/site/blueprint` plus the site's
//! tool graphs.

use std::collections::{BTreeMap, BTreeSet};

use blueprint::diff::Change;
use blueprint::site::SiteContext;
use blueprint::tools::{check_tool, manifest, ToolContext, ToolGraph};
use blueprint::town::{town, TownInput};
use blueprint::{Blueprint, Issue, IssueCode, ToolSig};
use serde::Deserialize;
use serde_json::{json, Value};
use wasm_bindgen::prelude::*;

#[derive(Deserialize, Default)]
#[serde(default)]
struct Ctx {
    types: BTreeMap<String, Value>,
    custom_blocks: Vec<String>,
    sections: Vec<String>,
    collections: Vec<String>,
    tools: Vec<Value>,
    skills: BTreeMap<String, BTreeSet<String>>,
    tables: BTreeSet<String>,
}

fn refuse(issues: Vec<Issue>) -> JsValue {
    JsValue::from_str(&serde_json::to_string(&issues).unwrap_or_default())
}

fn bad(path: &str, m: impl std::fmt::Display) -> JsValue {
    refuse(vec![Issue::new(IssueCode::BadFormat, path, m.to_string())])
}

fn parse<T: serde::de::DeserializeOwned>(json: &str, what: &str) -> Result<T, JsValue> {
    serde_json::from_str(json).map_err(|e| bad(what, e))
}

fn blueprint_of(json: &str) -> Result<Blueprint, JsValue> {
    parse(json, "/")
}

fn tools_of(ctx: &Ctx) -> Result<Vec<ToolGraph>, JsValue> {
    ctx.tools
        .iter()
        .enumerate()
        .map(|(i, v)| ToolGraph::from_value(v).map_err(|e| bad(&format!("/tools/{i}"), e)))
        .collect()
}

fn sigs(tools: &[ToolGraph]) -> BTreeMap<String, ToolSig> {
    tools.iter().map(|g| (g.id.clone(), g.sig())).collect()
}

fn out<T: serde::Serialize>(v: &T) -> String {
    serde_json::to_string(v).unwrap_or_default()
}

#[wasm_bindgen(js_name = blueprintInfo)]
pub fn blueprint_info() -> String {
    json!({ "version": env!("CARGO_PKG_VERSION") }).to_string()
}

/// The checker's issues for a blueprint in its site.
#[wasm_bindgen(js_name = checkBlueprint)]
pub fn check_blueprint(bp: &str, ctx: &str) -> Result<String, JsValue> {
    let bp = blueprint_of(bp)?;
    let ctx: Ctx = parse(ctx, "/context")?;
    let tools = tools_of(&ctx)?;
    let site = SiteContext {
        custom_blocks: ctx.custom_blocks.clone(),
        sections: ctx.sections.clone(),
        collections: ctx.collections.clone(),
    };
    let check_ctx = site
        .check_context(&ctx.types, sigs(&tools))
        .map_err(refuse)?;
    Ok(out(&blueprint::check(&bp, &check_ctx)))
}

#[wasm_bindgen(js_name = hashBlueprint)]
pub fn hash_blueprint(bp: &str) -> Result<String, JsValue> {
    Ok(blueprint::hash(&blueprint_of(bp)?))
}

#[wasm_bindgen(js_name = diffBlueprints)]
pub fn diff_blueprints(old: &str, next: &str) -> Result<String, JsValue> {
    Ok(out(&blueprint::diff(
        &blueprint_of(old)?,
        &blueprint_of(next)?,
    )))
}

#[wasm_bindgen(js_name = applyChanges)]
pub fn apply_changes(base: &str, proposal: &str, changes: &str) -> Result<String, JsValue> {
    let changes: Vec<Change> = parse(changes, "/changes")?;
    Ok(out(&blueprint::apply(
        &blueprint_of(base)?,
        &blueprint_of(proposal)?,
        &changes,
    )))
}

#[wasm_bindgen(js_name = townDesign)]
pub fn town_design(bp: &str, flagged: &str) -> Result<String, JsValue> {
    let issues: BTreeSet<String> = parse(flagged, "/flagged")?;
    Ok(out(&town(
        &blueprint_of(bp)?,
        &TownInput {
            issues,
            ..TownInput::default()
        },
    )))
}

#[wasm_bindgen(js_name = pageTypesOf)]
pub fn page_types_of(bp: &str) -> Result<String, JsValue> {
    Ok(blueprint_of(bp)?.registry().to_string())
}

#[wasm_bindgen(js_name = checkTool)]
pub fn check_tool_js(graph: &str, ctx: &str) -> Result<String, JsValue> {
    let g: ToolGraph = parse(graph, "/")?;
    let ctx: Ctx = parse(ctx, "/context")?;
    let tools = tools_of(&ctx)?;
    let types = blueprint::TypeRegistry::with_site(&ctx.types).map_err(refuse)?;
    let tool_ctx = ToolContext {
        types,
        tools: sigs(&tools)
            .into_iter()
            .filter(|(id, _)| *id != g.id)
            .collect(),
        skills: ctx.skills,
        tables: ctx.tables,
    };
    Ok(out(&check_tool(&g, &tool_ctx)))
}

#[wasm_bindgen(js_name = toolManifest)]
pub fn tool_manifest(graph: &str) -> Result<String, JsValue> {
    let g: ToolGraph = parse(graph, "/")?;
    Ok(manifest(&g).to_string())
}

#[wasm_bindgen(js_name = toolSignature)]
pub fn tool_signature(graph: &str) -> Result<String, JsValue> {
    let g: ToolGraph = parse(graph, "/")?;
    let sig = g.sig();
    let strings = |m: &BTreeMap<String, blueprint::TypeExpr>| {
        m.iter()
            .map(|(k, v)| (k.clone(), v.to_string()))
            .collect::<BTreeMap<_, _>>()
    };
    Ok(json!({ "inputs": strings(&sig.inputs), "outputs": strings(&sig.outputs) }).to_string())
}
