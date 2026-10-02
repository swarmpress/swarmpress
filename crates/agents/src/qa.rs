//! QA gate, LLM half: the coherence review that runs after the deterministic
//! checks (schema, links, media, house style) have passed.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::llm::{CallProfile, Llm, LlmError, LlmMessage, LlmRequest};
use crate::roles::{JobKind, Role};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct QaDefect {
    /// Index into `body`, or `None` for page-level problems.
    pub block_index: Option<u32>,
    pub problem: String,
    pub fix: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct QaReport {
    pub pass: bool,
    pub score: u8,
    pub defects: Vec<QaDefect>,
}

impl QaReport {
    /// The orchestrator's verdict: the model's `pass` is ignored when it
    /// lists defects.
    pub fn passed(&self) -> bool {
        self.pass && self.defects.is_empty()
    }
}

pub fn qa_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "pass": {"type": "boolean"},
            "score": {"type": "integer", "minimum": 1, "maximum": 10},
            "defects": {"type": "array", "items": {
                "type": "object",
                "properties": {
                    "block_index": {"type": ["integer", "null"], "minimum": 0},
                    "problem": {"type": "string"},
                    "fix": {"type": "string"}
                },
                "required": ["block_index", "problem", "fix"],
                "additionalProperties": false
            }}
        },
        "required": ["pass", "score", "defects"],
        "additionalProperties": false
    })
}

/// Runs one coherence review of `page` with the resolved QA system prompt.
pub async fn qa_coherence_review(
    llm: &dyn Llm,
    system: &str,
    page: &Value,
) -> Result<QaReport, LlmError> {
    let req = LlmRequest {
        profile: CallProfile::new(JobKind::QaCoherence, Role::FactChecker),
        system: vec![system.to_owned()],
        messages: vec![LlmMessage::user(format!(
            "## Page\n```json\n{}\n```\n\nReview this page for coherence defects.",
            serde_json::to_string_pretty(page).unwrap_or_default()
        ))],
        max_tokens: 4096,
    };
    let v = llm.structured(&req, &qa_schema()).await?;
    serde_json::from_value(v).map_err(|e| LlmError::InvalidOutput {
        errors: vec![format!("qa report: {e}")],
    })
}
