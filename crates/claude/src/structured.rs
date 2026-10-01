//! Structured output: `output_config.format = json_schema`, then local
//! parsing, JSON-Schema validation (jsonschema crate) and optional semantic
//! checks, with up to N repair turns.

use serde_json::Value;

use crate::api::ClaudeApi;
use crate::error::{ClaudeError, Result};
use crate::types::{Message, MessagesRequest, MessagesResponse, StopReason, Usage};

#[derive(Debug, Clone)]
pub struct StructuredOutcome {
    pub value: Value,
    pub response: MessagesResponse,
    /// Total API calls (1 = valid on first try).
    pub attempts: u32,
    pub usage: Usage,
}

/// Compiles a schema once and returns human-readable errors for an instance.
pub struct SchemaValidator {
    validator: jsonschema::Validator,
}

impl SchemaValidator {
    pub fn new(schema: &Value) -> Result<Self> {
        let validator = jsonschema::validator_for(schema)
            .map_err(|e| ClaudeError::InvalidSchema(e.to_string()))?;
        Ok(Self { validator })
    }

    pub fn validate(&self, instance: &Value) -> std::result::Result<(), Vec<String>> {
        let errors: Vec<String> = self
            .validator
            .iter_errors(instance)
            .map(|e| {
                let path = e.instance_path.to_string();
                if path.is_empty() {
                    format!("(root): {e}")
                } else {
                    format!("{path}: {e}")
                }
            })
            .collect();
        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors)
        }
    }
}

/// Extracts a JSON value from model text. Tolerates a surrounding Markdown
/// code fence (some local models add one); structured outputs never do.
pub fn extract_json(text: &str) -> std::result::Result<Value, String> {
    let t = text.trim();
    let t = t
        .strip_prefix("```json")
        .or_else(|| t.strip_prefix("```"))
        .map(|s| s.trim_end().trim_end_matches("```").trim())
        .unwrap_or(t);
    serde_json::from_str(t).map_err(|e| format!("output is not valid JSON: {e}"))
}

/// Builds the repair message sent after an invalid output.
pub fn repair_prompt(errors: &[String]) -> String {
    let mut s = String::from(
        "Your previous output did not pass validation. Fix every problem below and reply with the complete corrected JSON document only.\n\nProblems:\n",
    );
    for e in errors {
        s.push_str("- ");
        s.push_str(e);
        s.push('\n');
    }
    s
}

/// Structured output with schema validation only.
pub async fn structured_output(
    api: &dyn ClaudeApi,
    request: MessagesRequest,
    schema: &Value,
    max_repairs: u32,
) -> Result<StructuredOutcome> {
    structured_output_with(api, request, schema, max_repairs, &|_| Ok(())).await
}

/// Structured output with an extra semantic check (e.g. closed-world links)
/// whose errors are fed back to the model like schema errors.
///
/// - refusal → [`ClaudeError::Refusal`] (no repair attempt);
/// - `max_tokens` → [`ClaudeError::MaxTokens`] with the partial response;
/// - still invalid after `max_repairs` repair turns →
///   [`ClaudeError::SchemaValidation`].
pub async fn structured_output_with(
    api: &dyn ClaudeApi,
    request: MessagesRequest,
    schema: &Value,
    max_repairs: u32,
    check: &(dyn Fn(&Value) -> std::result::Result<(), Vec<String>> + Sync),
) -> Result<StructuredOutcome> {
    let validator = SchemaValidator::new(schema)?;
    let mut req = request.with_json_schema(schema.clone());
    let mut usage = Usage::default();
    let mut attempts = 0;
    loop {
        attempts += 1;
        let resp = api.create(&req).await?;
        usage.accumulate(&resp.usage);
        let resp = resp.check_refusal()?;
        if resp.stop_reason == Some(StopReason::MaxTokens) {
            return Err(ClaudeError::MaxTokens {
                partial: Box::new(resp),
            });
        }
        let text = resp.text();
        let errors = match extract_json(&text) {
            Err(e) => vec![e],
            Ok(value) => match validator.validate(&value).and_then(|_| check(&value)) {
                Ok(()) => {
                    return Ok(StructuredOutcome {
                        value,
                        response: resp,
                        attempts,
                        usage,
                    })
                }
                Err(errors) => errors,
            },
        };
        if attempts > max_repairs {
            return Err(ClaudeError::SchemaValidation {
                attempts,
                errors,
                last_output: text,
            });
        }
        req.messages.push(Message::assistant(resp.content.clone()));
        req.messages
            .push(Message::user_text(repair_prompt(&errors)));
    }
}
