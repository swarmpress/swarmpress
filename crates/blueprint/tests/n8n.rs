//! Workflows imported from n8n (FEAT-096, ADR-0076) under the Rust checker:
//! every runnable workflow checks clean and derives its manifest (the `code`
//! capability, its request origins, the model tier); a workflow with a step
//! swarm.press cannot run is refused for exactly that step. The fixtures are
//! written by `packages/toolgraph/test/n8n.test.ts`.

use std::collections::BTreeMap;
use std::path::PathBuf;

use blueprint::tools::{
    check_tool, manifest, n8n_url_origin, needs, ToolContext, ToolGraph, UrlOrigin, N8N_TYPES,
};
use blueprint::{IssueCode, TypeRegistry};
use serde_json::{json, Value};

fn load(id: &str) -> (ToolGraph, TypeRegistry) {
    let path =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(format!("tests/fixtures/n8n/{id}.json"));
    let v: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    let types: BTreeMap<String, Value> = serde_json::from_value(v["types"].clone()).unwrap();
    (
        ToolGraph::from_value(&v["graph"]).unwrap(),
        TypeRegistry::with_site(&types).unwrap(),
    )
}

fn check(id: &str) -> Vec<(IssueCode, String)> {
    let (g, types) = load(id);
    let ctx = ToolContext {
        types,
        ..ToolContext::default()
    };
    check_tool(&g, &ctx)
        .into_iter()
        .map(|i| (i.code, i.path))
        .collect()
}

#[test]
fn imported_workflows_check_clean() {
    for id in [
        "news-digest",
        "weather-alert",
        "lead-intake",
        "trail-roundup",
    ] {
        assert_eq!(check(id), vec![], "{id}");
    }
}

#[test]
fn a_step_that_cannot_run_is_the_reason_a_workflow_is_refused() {
    let issues = check("sealed-mix");
    assert_eq!(
        issues,
        vec![
            (IssueCode::BadNode, "/nodes/0".into()),
            (IssueCode::UnknownTool, "/nodes/1/type".into()),
        ],
        "Python code and a Slack node; the disabled step passes"
    );
}

#[test]
fn manifests_grant_code_and_exactly_the_reach_of_the_workflow() {
    let (g, _) = load("trail-roundup");
    let m = manifest(&g);
    assert_eq!(m["capabilities"], json!(["code", "llm:mid", "web"]));
    assert_eq!(m["origins"], json!(["https://trails.example.org"]));
    let (g, _) = load("lead-intake");
    assert_eq!(
        manifest(&g)["origins"],
        json!(["https://api.example-crm.com"])
    );
    assert_eq!(manifest(&g)["capabilities"], json!(["code", "web"]));
}

#[test]
fn a_computed_host_reaches_any_website_and_lists_no_origins() {
    let (mut g, _) = load("news-digest");
    let rss = g.nodes.iter_mut().find(|n| n.id() == "rss-read").unwrap();
    if let blueprint::tools::Node::N8n { parameters, .. } = rss {
        parameters["url"] = json!("={{ $json.feed }}");
    }
    let n = needs(&g);
    assert!(n.any_origin);
    assert!(manifest(&g).get("origins").is_none());
    assert_eq!(
        n8n_url_origin(&json!("=https://a.example.com/{{ $json.id }}")),
        Some(UrlOrigin::Literal("https://a.example.com".into()))
    );
    assert_eq!(
        n8n_url_origin(&json!("=https://{{ $json.host }}/x")),
        Some(UrlOrigin::Any)
    );
    assert_eq!(n8n_url_origin(&json!("ftp://a.example.com/")), None);
}

/// The Rust list of n8n types is the TypeScript catalogue's.
#[test]
fn the_type_list_matches_the_typescript_catalogue() {
    let ts = std::fs::read_to_string(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../packages/toolgraph/src/n8n/catalogue.ts"),
    )
    .unwrap();
    let start = ts.find("export const N8N_TYPES").unwrap();
    let block = &ts[start..start + ts[start..].find("};").unwrap()];
    let mut from_ts: Vec<(String, bool, bool, bool)> = block
        .lines()
        .filter_map(|l| {
            let l = l.trim();
            let name = l.strip_prefix('"')?.split('"').next()?.to_string();
            Some((
                name,
                l.contains("web: true"),
                l.contains("llm: true"),
                l.contains("tool: true"),
            ))
        })
        .collect();
    let mut from_rs: Vec<(String, bool, bool, bool)> = N8N_TYPES
        .iter()
        .map(|(n, t)| (n.to_string(), t.web, t.llm, t.tool))
        .collect();
    from_ts.sort();
    from_rs.sort();
    assert_eq!(from_rs, from_ts);
}
