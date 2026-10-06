//! Tool graphs (FEAT-091): the fixture tools check clean, their manifests
//! grant exactly what they need, and the checker names every broken step.
//! The same fixtures run in the TypeScript interpreter (`packages/toolgraph`).

use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;

use blueprint::tools::{check_tool, manifest, needs, ToolContext, ToolGraph, ROLES};
use blueprint::{site, IssueCode, TypeRegistry};
use knowledge::DirSource;
use serde_json::{json, Value};

fn dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/site")
}

fn tool(id: &str) -> ToolGraph {
    let text =
        std::fs::read_to_string(dir().join(format!("blueprint/tools/{id}.tool.json"))).unwrap();
    ToolGraph::from_value(&serde_json::from_str(&text).unwrap()).unwrap()
}

fn ctx() -> ToolContext {
    let models = site::load(&DirSource::new(dir())).unwrap();
    ToolContext {
        types: TypeRegistry::with_site(&models.types).unwrap(),
        tools: BTreeMap::new(),
        skills: BTreeMap::from([(
            "com.example.fact-checker".to_string(),
            BTreeSet::from(["extract_claims".to_string()]),
        )]),
        tables: BTreeSet::new(),
    }
}

fn codes(g: &ToolGraph) -> Vec<IssueCode> {
    check_tool(g, &ctx()).into_iter().map(|i| i.code).collect()
}

fn edit(id: &str, f: impl FnOnce(&mut Value)) -> ToolGraph {
    let mut v = serde_json::to_value(tool(id)).unwrap();
    f(&mut v);
    ToolGraph::from_value(&v).unwrap()
}

#[test]
fn the_fixture_tools_check_clean() {
    for id in ["ferry-times", "weather", "story-teaser"] {
        assert_eq!(check_tool(&tool(id), &ctx()), vec![], "{id}");
    }
}

#[test]
fn manifests_grant_exactly_what_the_graph_needs() {
    let m = manifest(&tool("ferry-times"));
    assert_eq!(m["id"], "press.swarm.tool.ferry-times");
    assert_eq!(m["kinds"], json!(["skill"]));
    assert_eq!(m["capabilities"], json!(["web"]));
    assert_eq!(
        m["origins"],
        json!(["https://www.navigazionegolfodeipoeti.it"])
    );
    let teaser = needs(&tool("story-teaser"));
    assert_eq!(teaser.capabilities, BTreeSet::from(["llm:low".to_string()]));
    assert!(teaser.origins.is_empty());
    // A changed graph is a new version.
    let changed = edit("ferry-times", |v| v["nodes"][5]["count"] = json!(4));
    assert_ne!(manifest(&changed)["version"], m["version"]);
    // The golden manifests, shared with the TypeScript side.
    let all: BTreeMap<&str, Value> = ["ferry-times", "weather", "story-teaser"]
        .into_iter()
        .map(|id| (id, manifest(&tool(id))))
        .collect();
    let path = dir().join("manifests.golden.json");
    let text = serde_json::to_string_pretty(&all).unwrap() + "\n";
    if std::env::var_os("BLESS").is_some() {
        std::fs::write(&path, &text).unwrap();
    }
    assert_eq!(
        text,
        std::fs::read_to_string(&path).expect("golden (BLESS=1)")
    );
}

#[test]
fn broken_graphs_are_named() {
    // A cycle.
    let g = edit("weather", |v| {
        v["edges"]
            .as_array_mut()
            .unwrap()
            .push(json!(["now.out", "fetch.params"]))
    });
    assert!(codes(&g).contains(&IssueCode::BadGraph));
    // An unconnected inlet.
    let g = edit("weather", |v| {
        v["edges"].as_array_mut().unwrap().remove(2);
    });
    assert!(codes(&g).contains(&IssueCode::BadGraph));
    // A path the incoming type does not have.
    let g = edit("weather", |v| v["nodes"][2]["path"] = json!("$.today"));
    assert_eq!(codes(&g), vec![IssueCode::TypeMismatch]);
    // What reaches the output does not fit.
    let g = edit("weather", |v| v["outputs"]["weather"] = json!("Teaser"));
    assert_eq!(codes(&g), vec![IssueCode::TypeMismatch]);
    // A map field the item lacks.
    let g = edit("ferry-times", |v| {
        v["nodes"][4]["fields"]["to"] = json!("$.destination")
    });
    assert_eq!(codes(&g), vec![IssueCode::TypeMismatch]);
    // Not https, or a templated host.
    let g = edit("weather", |v| {
        v["nodes"][1]["url"] = json!("http://api.open-meteo.com/x")
    });
    assert_eq!(codes(&g), vec![IssueCode::BadOrigin]);
    let g = edit("weather", |v| {
        v["nodes"][1]["url"] = json!("https://{city}.example.com/")
    });
    assert!(codes(&g).contains(&IssueCode::BadOrigin));
    // Placeholders with nothing to fill them.
    let g = edit("weather", |v| {
        v["edges"].as_array_mut().unwrap().remove(0);
    });
    assert!(codes(&g).contains(&IssueCode::BadGraph));
    // An unknown role, an unknown skill tool.
    let g = edit("story-teaser", |v| v["nodes"][2]["role"] = json!("oracle"));
    assert_eq!(codes(&g), vec![IssueCode::UnknownRef]);
    let g = edit("story-teaser", |v| {
        v["nodes"][2] = json!({ "id": "write", "kind": "skill", "extension": "com.example.nope", "tool": "x", "returns": "Teaser" });
    });
    assert_eq!(codes(&g), vec![IssueCode::UnknownTool]);
    // Too many nodes.
    let g = edit("weather", |v| {
        for k in 0..12 {
            v["nodes"]
                .as_array_mut()
                .unwrap()
                .push(json!({ "id": format!("x{k}"), "kind": "op", "op": "merge" }));
        }
    });
    assert!(codes(&g).contains(&IssueCode::OverBudget));
}

#[test]
fn the_roles_are_the_sdk_s() {
    let sdk = std::fs::read_to_string(
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../packages/sdk/src/schemas.ts"),
    )
    .unwrap();
    let block = sdk
        .split("ROLE_DEPARTMENTS = {")
        .nth(1)
        .unwrap()
        .split("} as const")
        .next()
        .unwrap();
    let roles: Vec<String> = block
        .lines()
        .filter_map(|l| l.trim().split(':').next())
        .map(|k| k.trim().trim_matches('"').to_string())
        .filter(|k| !k.is_empty())
        .collect();
    assert_eq!(roles, ROLES);
}

#[test]
fn signatures_feed_bindings() {
    let sig = tool("ferry-times").sig();
    assert_eq!(sig.outputs["departures"].to_string(), "FerryDeparture[]");
    assert_eq!(sig.inputs["village"].to_string(), "Village");
}
