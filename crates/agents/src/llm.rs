//! The `Llm` abstraction the orchestrators run on. Implemented by
//! [`ClaudeLlm`] (Claude Messages API) and, on the server, by the browser
//! worker bridge (jobs executed by a client's local model). [`FakeLlm`] is
//! the scripted test double.

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use claude::{ClaudeApi, ClaudeError, Message, MessagesRequest, StopReason, StreamEvent, Tool};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::roles::{JobKind, Role, RolesConfig, Seniority};

/// Who is calling and for which job (selects model/effort or local model).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CallProfile {
    pub job: JobKind,
    pub role: Role,
    /// Set when the call speaks for a staff member (seniority picks the model).
    pub seniority: Option<Seniority>,
    /// Staff id of the speaker/author, for transcripts and audit.
    pub staff_id: Option<String>,
}

impl CallProfile {
    pub fn new(job: JobKind, role: Role) -> Self {
        Self {
            job,
            role,
            seniority: None,
            staff_id: None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LlmRole {
    User,
    Assistant,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LlmMessage {
    pub role: LlmRole,
    pub text: String,
}

impl LlmMessage {
    pub fn user(text: impl Into<String>) -> Self {
        Self {
            role: LlmRole::User,
            text: text.into(),
        }
    }
    pub fn assistant(text: impl Into<String>) -> Self {
        Self {
            role: LlmRole::Assistant,
            text: text.into(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LlmRequest {
    pub profile: CallProfile,
    /// Stable system layers (company → site → persona). Cached by Claude.
    pub system: Vec<String>,
    /// Conversation; must end with a user message (no prefill).
    pub messages: Vec<LlmMessage>,
    pub max_tokens: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error, Serialize, Deserialize)]
pub enum LlmError {
    /// The model refused. Never retried with the same prompt; the stage
    /// blocks and a ticket opens.
    #[error("refused (category {category:?}): {explanation:?}")]
    Refusal {
        category: Option<String>,
        explanation: Option<String>,
    },
    #[error("output truncated at max_tokens")]
    Truncated { partial: String },
    /// Structured output still invalid after the backend's repair turns.
    #[error("invalid structured output: {errors:?}")]
    InvalidOutput { errors: Vec<String> },
    /// No executor available (e.g. no capable browser); retry later.
    #[error("backend unavailable: {0}")]
    Unavailable(String),
    #[error("backend error: {0}")]
    Backend(String),
}

/// Receives streamed text deltas.
pub type DeltaSink<'a> = &'a mut (dyn FnMut(&str) + Send);

#[async_trait]
pub trait Llm: Send + Sync {
    /// Free text (meeting turns, chatter). Deltas stream into `on_delta`.
    async fn generate(
        &self,
        req: &LlmRequest,
        on_delta: Option<DeltaSink<'_>>,
    ) -> Result<String, LlmError>;

    /// JSON conforming to `schema`. The backend validates against the schema
    /// and runs its own repair turns before giving up with
    /// [`LlmError::InvalidOutput`].
    async fn structured(&self, req: &LlmRequest, schema: &Value) -> Result<Value, LlmError>;
}

impl From<ClaudeError> for LlmError {
    fn from(e: ClaudeError) -> Self {
        match e {
            ClaudeError::Refusal {
                category,
                explanation,
            } => LlmError::Refusal {
                category,
                explanation,
            },
            ClaudeError::MaxTokens { partial } => LlmError::Truncated {
                partial: partial.text(),
            },
            ClaudeError::SchemaValidation { errors, .. } => LlmError::InvalidOutput { errors },
            other => LlmError::Backend(other.to_string()),
        }
    }
}

/// [`Llm`] over the Claude Messages API, with model/effort from
/// `config/roles.toml` (seniority overrides the model).
pub struct ClaudeLlm {
    api: Arc<dyn ClaudeApi>,
    roles: RolesConfig,
    /// Structured-output repair turns.
    pub max_schema_repairs: u32,
    /// `max_uses` for roles with web search.
    pub web_search_max_uses: u32,
}

impl ClaudeLlm {
    pub fn new(api: Arc<dyn ClaudeApi>, roles: RolesConfig) -> Self {
        Self {
            api,
            roles,
            max_schema_repairs: 2,
            web_search_max_uses: 5,
        }
    }

    /// Builds the Messages request for an [`LlmRequest`].
    pub fn build_request(&self, req: &LlmRequest) -> Result<MessagesRequest, LlmError> {
        let profile = self
            .roles
            .claude_profile(req.profile.role, req.profile.seniority)
            .ok_or_else(|| {
                LlmError::Backend(format!("no Claude profile for role {}", req.profile.role))
            })?;
        let mut m = MessagesRequest::new(profile.model, req.max_tokens, profile.effort)
            .with_system_layers(&req.system, None);
        for msg in &req.messages {
            m.messages.push(match msg.role {
                LlmRole::User => Message::user_text(&msg.text),
                LlmRole::Assistant => Message::assistant_text(&msg.text),
            });
        }
        if profile.web_search {
            m = m.with_tools(vec![Tool::web_search(self.web_search_max_uses)]);
        }
        Ok(m)
    }
}

#[async_trait]
impl Llm for ClaudeLlm {
    async fn generate(
        &self,
        req: &LlmRequest,
        on_delta: Option<DeltaSink<'_>>,
    ) -> Result<String, LlmError> {
        let mreq = self.build_request(req)?;
        let resp = match on_delta {
            Some(sink) => {
                let mut cb = |e: &StreamEvent| {
                    if let Some(t) = e.text_delta() {
                        sink(t);
                    }
                };
                self.api.stream(&mreq, &mut cb).await?
            }
            None => self.api.create(&mreq).await?,
        };
        let resp = resp.check_refusal()?;
        if resp.stop_reason == Some(StopReason::MaxTokens) {
            return Err(LlmError::Truncated {
                partial: resp.text(),
            });
        }
        Ok(resp.text())
    }

    async fn structured(&self, req: &LlmRequest, schema: &Value) -> Result<Value, LlmError> {
        let mreq = self.build_request(req)?;
        let out =
            claude::structured_output(self.api.as_ref(), mreq, schema, self.max_schema_repairs)
                .await?;
        Ok(out.value)
    }
}

/// A scripted reply for [`FakeLlm`].
#[derive(Debug, Clone)]
pub enum FakeReply {
    Text(String),
    Json(Value),
    Error(LlmError),
}

#[derive(Debug, Clone)]
pub struct RecordedCall {
    pub request: LlmRequest,
    /// `Some` for `structured` calls.
    pub schema: Option<Value>,
}

/// Scripted [`Llm`]. `structured` validates the scripted JSON against the
/// schema and returns [`LlmError::InvalidOutput`] if it doesn't conform (as
/// a backend that exhausted its repairs would). An exhausted script is an
/// error.
#[derive(Debug, Default)]
pub struct FakeLlm {
    script: Mutex<VecDeque<FakeReply>>,
    calls: Mutex<Vec<RecordedCall>>,
}

impl FakeLlm {
    pub fn new(script: impl IntoIterator<Item = FakeReply>) -> Self {
        Self {
            script: Mutex::new(script.into_iter().collect()),
            calls: Mutex::default(),
        }
    }

    pub fn push(&self, r: FakeReply) {
        self.script.lock().unwrap().push_back(r);
    }

    pub fn calls(&self) -> Vec<RecordedCall> {
        self.calls.lock().unwrap().clone()
    }

    pub fn remaining(&self) -> usize {
        self.script.lock().unwrap().len()
    }

    fn next(&self, req: &LlmRequest, schema: Option<&Value>) -> Result<FakeReply, LlmError> {
        if req.messages.last().map(|m| m.role) != Some(LlmRole::User) {
            return Err(LlmError::Backend(
                "request must end with a user message".into(),
            ));
        }
        self.calls.lock().unwrap().push(RecordedCall {
            request: req.clone(),
            schema: schema.cloned(),
        });
        let n = self.calls.lock().unwrap().len();
        self.script
            .lock()
            .unwrap()
            .pop_front()
            .ok_or_else(|| LlmError::Backend(format!("FakeLlm script exhausted at call #{n}")))
    }
}

#[async_trait]
impl Llm for FakeLlm {
    async fn generate(
        &self,
        req: &LlmRequest,
        on_delta: Option<DeltaSink<'_>>,
    ) -> Result<String, LlmError> {
        let text = match self.next(req, None)? {
            FakeReply::Text(t) => t,
            FakeReply::Json(v) => v.to_string(),
            FakeReply::Error(e) => return Err(e),
        };
        if let Some(sink) = on_delta {
            let chars: Vec<char> = text.chars().collect();
            for chunk in chars.chunks(8) {
                sink(&chunk.iter().collect::<String>());
            }
        }
        Ok(text)
    }

    async fn structured(&self, req: &LlmRequest, schema: &Value) -> Result<Value, LlmError> {
        let value = match self.next(req, Some(schema))? {
            FakeReply::Json(v) => v,
            FakeReply::Text(t) => {
                claude::extract_json(&t).map_err(|e| LlmError::InvalidOutput { errors: vec![e] })?
            }
            FakeReply::Error(e) => return Err(e),
        };
        let validator = claude::SchemaValidator::new(schema)
            .map_err(|e| LlmError::Backend(format!("bad schema: {e}")))?;
        validator
            .validate(&value)
            .map_err(|errors| LlmError::InvalidOutput { errors })?;
        Ok(value)
    }
}
