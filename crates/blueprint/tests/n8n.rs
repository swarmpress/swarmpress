//! Graphs imported from n8n (FEAT-096) under the Rust checker: the imported
//! RSS digest checks clean; the weather alert is refused only for its sealed
//! Code step, so it cannot be installed until someone replaces it. The
//! fixtures are written by `packages/toolgraph/test/n8n.test.ts`.

use std::collections::BTreeMap;
use std::path::PathBuf;

use blueprint::tools::{check_tool, ToolContext, ToolGraph};
use blueprint::{IssueCode, TypeRegistry};
use serde_json::Value;

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
fn an_imported_rss_digest_checks_clean() {
    assert_eq!(check("news-digest"), vec![]);
}

#[test]
fn a_sealed_step_is_the_only_reason_the_weather_alert_cannot_be_installed() {
    let issues = check("weather-alert");
    assert_eq!(issues.len(), 1, "{issues:?}");
    assert_eq!(issues[0].0, IssueCode::UnknownTool);
}
