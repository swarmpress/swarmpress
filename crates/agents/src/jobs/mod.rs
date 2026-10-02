//! Structured LLM jobs of the organization (organization.md §9, §6, §6a, §7;
//! publishing-plan.md §6): each job has an input (data, rendered as JSON into
//! the user message), an output type with a JSON Schema (always including
//! `plan_ops`, ADR-0031), an optional semantic check run through
//! [`Llm::structured_checked`] (so Claude gets repair turns), and a runner.
//!
//! The orchestrator owns state: these functions only return artifacts.

pub mod analytics;
pub mod hiring;
pub mod numbers;
pub mod office;
pub mod production;
pub mod strategy;

use std::sync::OnceLock;

use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::{json, Map, Value};

use crate::llm::{CallProfile, Llm, LlmError, LlmMessage, LlmRequest, SemanticCheck};
use crate::plan::{format_plan_context, with_plan_ops, PlanContext, DEFAULT_RECENT_POSTS};
use crate::roles::{JobKind, Role, RolesConfig, Seniority};

pub use numbers::check_number_provenance;

/// Who performs a job.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JobStaff {
    /// Staff id (for transcripts and audit).
    pub staff_id: String,
    pub role: Role,
    /// `None` for Agency (Claude) contractors.
    pub seniority: Option<Seniority>,
}

impl JobStaff {
    pub fn new(staff_id: impl Into<String>, role: Role, seniority: Option<Seniority>) -> Self {
        Self {
            staff_id: staff_id.into(),
            role,
            seniority,
        }
    }
}

/// The job context shared by every runner.
#[derive(Debug, Clone, Copy)]
pub struct JobCtx<'a> {
    pub staff: &'a JobStaff,
    /// Resolved system prompt (company template → site → persona).
    pub system: &'a str,
    /// The work item this job is for, if any.
    pub plan: Option<&'a PlanContext>,
}

fn roles() -> &'static RolesConfig {
    static R: OnceLock<RolesConfig> = OnceLock::new();
    R.get_or_init(RolesConfig::builtin)
}

/// Makes every listed property required and closes the object; adds
/// `plan_ops`.
pub fn job_schema(properties: Value) -> Value {
    with_plan_ops(closed_object(properties))
}

/// `{"type":"object", properties, required: all keys, additionalProperties: false}`.
pub fn closed_object(properties: Value) -> Value {
    let props: Map<String, Value> = properties.as_object().cloned().unwrap_or_default();
    let required: Vec<&String> = props.keys().collect();
    json!({
        "type": "object",
        "properties": props,
        "required": required,
        "additionalProperties": false
    })
}

/// `{"type":"string","minLength":1}`.
pub fn text() -> Value {
    json!({"type": "string", "minLength": 1})
}

/// Array of non-empty strings.
pub fn texts(min: u64) -> Value {
    json!({"type": "array", "minItems": min, "items": text()})
}

pub fn one_of(values: &[&str]) -> Value {
    json!({"type": "string", "enum": values})
}

/// Builds the request and runs a structured job: schema validation plus
/// `check`, then deserialization into `T`.
pub async fn run_structured<T: DeserializeOwned>(
    llm: &dyn Llm,
    kind: JobKind,
    ctx: JobCtx<'_>,
    task: &str,
    input: &impl Serialize,
    schema: &Value,
    check: &SemanticCheck<'_>,
) -> Result<T, LlmError> {
    let policy = roles().job(kind);
    if !policy.performed_by(ctx.staff.role) {
        return Err(LlmError::Backend(format!(
            "{} cannot perform {kind} (role {} or {:?})",
            ctx.staff.role, policy.role, policy.also
        )));
    }
    let mut user = format!("## Task: {kind}\n{task}\n");
    if let Some(plan) = ctx.plan {
        user.push('\n');
        user.push_str(&format_plan_context(plan, DEFAULT_RECENT_POSTS));
    }
    user.push_str(&format!(
        "\n## Input data\n```json\n{}\n```\n\nReply with the JSON object only, matching the provided schema.",
        serde_json::to_string_pretty(input).unwrap_or_default()
    ));
    let req = LlmRequest {
        profile: CallProfile {
            job: kind,
            role: ctx.staff.role,
            seniority: ctx.staff.seniority,
            staff_id: Some(ctx.staff.staff_id.clone()),
        },
        system: vec![ctx.system.to_owned()],
        messages: vec![LlmMessage::user(user)],
        max_tokens: policy.max_tokens,
    };
    let v = llm.structured_checked(&req, schema, check).await?;
    serde_json::from_value(v).map_err(|e| LlmError::InvalidOutput {
        errors: vec![format!("{kind}: {e}")],
    })
}

/// A check that always passes.
pub fn no_check(_: &Value) -> Result<(), Vec<String>> {
    Ok(())
}

/// Collects `errors` into a check result.
pub(crate) fn finish(errors: Vec<String>) -> Result<(), Vec<String>> {
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors)
    }
}

/// Reads `field` of every object in the array at `path` as strings.
pub(crate) fn strings_at<'a>(v: &'a Value, array: &str, field: &str) -> Vec<&'a str> {
    v.get(array)
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|x| x.get(field).and_then(Value::as_str))
                .collect()
        })
        .unwrap_or_default()
}
