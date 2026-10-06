//! The architects' prompts (ADR-0072, FEAT-095): the Information
//! Architect's blueprint proposal (`site-architect`, played by the UX
//! designer) and the Web Developer's tool graph (`tool-build`).
//!
//! Both answer one structured call against a schema the `blueprint` crate
//! builds (`blueprint::proposal_schema`, `blueprint::tool_proposal_schema`);
//! the orchestrator applies and checks the answer and gives the checker's
//! issues back for one repair turn. This module only renders what the model
//! reads: the request (the CEO's words, data), the site's structure as
//! lines, and the closed lists it may name. The blueprint arrives as JSON so
//! this crate needs no dependency on the blueprint model.

use serde_json::Value;

/// Answer budget of the architect's proposal, tokens.
pub const ARCHITECT_ANSWER: u32 = 2400;
/// Answer budget of a tool graph, tokens.
pub const TOOL_BUILD_ANSWER: u32 = 3200;
/// The request is cut to this many characters.
pub const REQUEST_CHARS: usize = 1200;

/// What the architect works from.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ArchitectInput<'a> {
    /// The CEO's request (store text).
    pub request: &'a str,
    /// The current blueprint (`swarmpress.blueprint.v1` JSON).
    pub blueprint: &'a Value,
    /// The core page types (their slots are the platform's).
    pub core_types: &'a [String],
    /// Every block id a slot may name.
    pub blocks: &'a [String],
    /// The site's manifest sections and collections.
    pub sections: &'a [String],
    pub collections: &'a [String],
    /// The summary of the proposal this revision replaces.
    pub previous: Option<&'a str>,
}

fn cut(s: &str, n: usize) -> String {
    let t = s.trim();
    if t.chars().count() <= n {
        t.to_string()
    } else {
        let mut out: String = t.chars().take(n).collect();
        out.push('…');
        out
    }
}

fn strs(v: &Value) -> Vec<&str> {
    v.as_array()
        .map(|a| a.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default()
}

/// The blueprint as lines: one per page type with its slots, then the
/// relationships, the navigation and the intent.
pub fn blueprint_lines(bp: &Value, core_types: &[String]) -> String {
    let mut out = String::from("Page types:\n");
    for t in bp["page_types"].as_array().into_iter().flatten() {
        let id = t["id"].as_str().unwrap_or("?");
        let label = t["label"]["en"].as_str().unwrap_or(id);
        let route = t["route"].as_str().unwrap_or("(no route)");
        let core = if core_types.iter().any(|c| c == id) {
            " (core: slots fixed)"
        } else {
            ""
        };
        out.push_str(&format!("- {id} «{label}» {route}{core}\n"));
        match t["slots"].as_array() {
            None => out.push_str("  slots: unconstrained\n"),
            Some(slots) => {
                for s in slots {
                    let min = s["min"].as_u64().unwrap_or(0);
                    let max = s["max"]
                        .as_u64()
                        .map_or_else(|| "n".to_string(), |m| m.to_string());
                    out.push_str(&format!(
                        "  slot {} [{}] {min}..{max}\n",
                        s["id"].as_str().unwrap_or("?"),
                        strs(&s["blocks"]).join(", ")
                    ));
                }
            }
        }
    }
    let rels = bp["relationships"].as_array().cloned().unwrap_or_default();
    out.push_str("Relationships:\n");
    if rels.is_empty() {
        out.push_str("- none\n");
    }
    for r in rels {
        out.push_str(&format!(
            "- {} > {}: {} ({})\n",
            r["from"].as_str().unwrap_or("?"),
            r["to"].as_str().unwrap_or("?"),
            r["kind"].as_str().unwrap_or("?"),
            r["cardinality"].as_str().unwrap_or("?")
        ));
    }
    let nav: Vec<String> = bp["navigation"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|n| match (n["page_type"].as_str(), n["section"].as_str()) {
            (Some(t), _) => format!("page type {t}"),
            (_, Some(s)) => format!("section {s}"),
            _ => "?".to_string(),
        })
        .collect();
    out.push_str(&format!(
        "Navigation: {}\n",
        if nav.is_empty() {
            "none".to_string()
        } else {
            nav.join(", ")
        }
    ));
    let kw = strs(&bp["intent"]["keywords"]);
    out.push_str(&format!(
        "Intent: {}\n",
        if kw.is_empty() {
            "none".to_string()
        } else {
            kw.join(", ")
        }
    ));
    out
}

/// The user turn of the `site-architect` call. Starts with `## Task: site
/// architect` (the fake model answers by it, `crate::fake_writer`).
pub fn architect_prompt(i: &ArchitectInput<'_>) -> String {
    let mut out = format!(
        "## Task: site architect\n\n## Request\n{}\n\n## Blueprint\n{}\n## Site\nSections: {}\nCollections: {}\n\n## Blocks\n{}\n",
        cut(i.request, REQUEST_CHARS),
        blueprint_lines(i.blueprint, i.core_types),
        if i.sections.is_empty() { "none".to_string() } else { i.sections.join(", ") },
        if i.collections.is_empty() { "none".to_string() } else { i.collections.join(", ") },
        i.blocks.join(", ")
    );
    if let Some(p) = i.previous.filter(|p| !p.trim().is_empty()) {
        out.push_str(&format!(
            "\n## Your previous proposal (the CEO sent it back)\n{}\nPropose again, differently where it fell short.\n",
            cut(p, 600)
        ));
    }
    out.push_str("\nAnswer with the summary and the edits.");
    out
}

/// What the tool builder works from.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ToolBuildInput<'a> {
    pub request: &'a str,
    /// The site's named types (name → schema).
    pub types: &'a [(String, Value)],
    /// The built-in type names (`Page`, `Village`, …).
    pub builtin_types: &'a [String],
    /// The site's tools as `id: inputs → outputs`.
    pub tools: &'a [String],
    pub previous: Option<&'a str>,
}

/// A small tool the prompt shows as the format's example.
pub const TOOL_EXAMPLE: &str = r#"{"format":"swarmpress.tool.v1","id":"weather","name":{"en":"Weather now"},"inputs":{"city":"string"},"outputs":{"weather":"Weather"},"nodes":[{"id":"in","kind":"input","port":"city"},{"id":"fetch","kind":"connector","connector":"http-get","url":"https://api.open-meteo.com/v1/current?city={city}","returns":"WeatherReport"},{"id":"now","kind":"op","op":"pick","path":"$.current","returns":"Weather"},{"id":"out","kind":"output","port":"weather"}],"edges":[["in.out","fetch.params"],["fetch.out","now.in"],["now.out","out.in"]],"triggers":[{"kind":"on-demand"}]}"#;

/// The user turn of the `tool-build` call. Starts with `## Task: tool
/// build`.
pub fn tool_build_prompt(i: &ToolBuildInput<'_>) -> String {
    let mut types = String::new();
    for (name, schema) in i.types {
        types.push_str(&format!("- {name}: {schema}\n"));
    }
    if types.is_empty() {
        types.push_str("- none\n");
    }
    let mut out = format!(
        "## Task: tool build\n\n## Request\n{}\n\n## Site types\n{}Built in: {}\n\n## Site tools\n{}\n\n## Example of the format\n{}\n",
        cut(i.request, REQUEST_CHARS),
        types,
        i.builtin_types.join(", "),
        if i.tools.is_empty() { "- none".to_string() } else { i.tools.iter().map(|t| format!("- {t}")).collect::<Vec<_>>().join("\n") },
        TOOL_EXAMPLE
    );
    if let Some(p) = i.previous.filter(|p| !p.trim().is_empty()) {
        out.push_str(&format!(
            "\n## Your previous tool (the CEO sent it back)\n{}\nBuild it again, differently where it fell short.\n",
            cut(p, 600)
        ));
    }
    out.push_str("\nAnswer with the summary and the whole graph.");
    out
}
