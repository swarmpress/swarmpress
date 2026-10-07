//! The site's tools in a Draft's research (ADR-0072 design §7.4, FEAT-091):
//! the `tools#0` stage.
//!
//! After the web research, a writer may use the site's own tools (those
//! with an `on-demand` trigger and no checker issues) for facts the article
//! needs: a timetable, a price list, the newest pages. The model asks
//! through `use_tools` (`agents::tool_use`), the host runs the tools
//! ([`ToolCaller`], in the browser the sandbox), and the facts the model
//! states from their results join the dossier as evidence whose source is
//! the tool (`tool:<id>`). A fact naming a tool that did not run, or one that
//! failed, is dropped: the article may only state what a source returned
//! (CLAUDE.md rule 5). Without a caller, or a site without such tools, the
//! stage does nothing; a failed stage leaves the dossier as it was.

use std::collections::BTreeSet;

use agents::research::Evidence;
use agents::tool_use::{structured_with_tools, OfferedTool};
use agents::{LlmMessage, LlmRequest};
use serde_json::{json, Value};

use crate::gateway::Gateway;
use crate::run::{Orchestrator, Result};
use crate::staged::{stage_hash, Cx};
use crate::store::Store;

/// The tool turns one stage may take.
pub const TOOL_ROUNDS: u32 = 2;
/// Facts one stage adds at most.
pub const MAX_TOOL_FACTS: usize = 8;

/// The tools a writer may call: on demand, checking clean.
pub fn offered_tools(models: &Value) -> Vec<OfferedTool> {
    models["tools"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|t| t["issues"].as_array().is_none_or(Vec::is_empty))
        .filter(|t| {
            t["graph"]["triggers"]
                .as_array()
                .into_iter()
                .flatten()
                .any(|x| x["kind"] == "on-demand")
        })
        .filter_map(|t| {
            let g = &t["graph"];
            let id = g["id"].as_str()?.to_string();
            let description = g["description"]
                .as_str()
                .filter(|d| !d.is_empty())
                .or_else(|| g["name"]["en"].as_str())
                .unwrap_or(&id)
                .to_string();
            let props: serde_json::Map<String, Value> = g["inputs"]
                .as_object()
                .into_iter()
                .flatten()
                .map(|(k, ty)| {
                    (
                        k.clone(),
                        json!({ "description": format!("a {}", ty.as_str().unwrap_or("value")) }),
                    )
                })
                .collect();
            Some(OfferedTool {
                id,
                description,
                input: json!({ "type": "object", "properties": props }),
            })
        })
        .collect()
}

fn facts_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["facts"],
        "properties": {
            "facts": {
                "type": "array",
                "maxItems": MAX_TOOL_FACTS,
                "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": ["claim", "tool"],
                    "properties": { "claim": { "type": "string" }, "tool": { "type": "string" } }
                }
            }
        }
    })
}

impl<S: Store, G: Gateway> Orchestrator<S, G> {
    /// `tools#0` (module docs): facts from the site's tools added to `evidence`.
    pub(crate) async fn tool_stage(
        &self,
        cx: &Cx<'_>,
        brief: &agents::pipeline::Brief,
        evidence: &mut Vec<Evidence>,
    ) -> Result<()> {
        let Some(caller) = self.tools.clone() else {
            return Ok(());
        };
        let Ok(models) = self.gateway.site_models().await else {
            return Ok(());
        };
        let offered = offered_tools(&models);
        if offered.is_empty() {
            return Ok(());
        }
        let known: Vec<String> = evidence
            .iter()
            .map(|e| format!("{}: {}", e.id, e.claim))
            .collect();
        let user = format!(
            "## Task: tool facts\n\nThe article: \"{}\". {}\n\nWhat the research found:\n{}\n\n\
             The site has its own tools for current facts (timetables, numbers, its newest pages). Use them for facts this \
             article needs that the research did not give. Answer {{\"facts\": [{{\"claim\", \"tool\"}}]}}: each claim states \
             one fact exactly as a tool's result gives it, and names the tool. No tool needed: no facts.",
            brief.title,
            brief.angle,
            if known.is_empty() { "(nothing yet)".to_string() } else { known.join("\n") },
        );
        let schema = facts_schema();
        let ids: Vec<&str> = offered.iter().map(|t| t.id.as_str()).collect();
        let hash = stage_hash(&["tools", &cx.system, &user, &ids.join(",")]);
        if let Some(v) = self.recall(cx.req, "tools", 0, Some(&hash)).await? {
            let added: Vec<Evidence> = serde_json::from_value(v).unwrap_or_default();
            evidence.extend(added);
            return Ok(());
        }
        if self.cancelled(cx.req).is_some() {
            return Ok(());
        }
        let req = LlmRequest {
            profile: cx.call.clone(),
            system: vec![cx.system.clone()],
            messages: vec![LlmMessage::user(user)],
            max_tokens: 1200,
            reasoning_tokens: Some(0),
        };
        let Ok(answer) = structured_with_tools(
            self.llm.as_ref(),
            &req,
            &schema,
            &offered,
            caller.as_ref(),
            TOOL_ROUNDS,
        )
        .await
        else {
            return Ok(());
        };
        // Only tools that ran and answered back a fact.
        let ran: BTreeSet<&str> = answer
            .calls
            .iter()
            .filter(|(_, _, r)| r.is_ok())
            .map(|(t, _, _)| t.as_str())
            .collect();
        let mut added = Vec::new();
        for f in answer.value["facts"]
            .as_array()
            .into_iter()
            .flatten()
            .take(MAX_TOOL_FACTS)
        {
            let (Some(claim), Some(tool)) = (f["claim"].as_str(), f["tool"].as_str()) else {
                continue;
            };
            if claim.trim().is_empty() || !ran.contains(tool) {
                continue;
            }
            let title = offered
                .iter()
                .find(|t| t.id == tool)
                .map(|t| t.description.clone())
                .unwrap_or_else(|| tool.to_string());
            added.push(Evidence {
                id: format!("E{}", evidence.len() + added.len() + 1),
                claim: claim.trim().to_string(),
                url: format!("tool:{tool}"),
                title,
            });
        }
        let kept: Vec<Evidence> = self.remember(cx.req, "tools", 0, hash, &added).await?;
        evidence.extend(kept);
        Ok(())
    }
}
