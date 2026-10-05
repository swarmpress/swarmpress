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
    /// Answer budget.
    pub max_tokens: u32,
    /// Cap on reasoning before the answer, on top of `max_tokens` (ADR-0058:
    /// a staged call reserves both in the model's context). `Some(0)` asks
    /// for an answer without reasoning (repair turns); `None` leaves it to
    /// the backend. Backends without a reasoning switch ignore it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning_tokens: Option<u32>,
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
    /// `answer` is the last answer without its reasoning, when the backend
    /// has it: what a repair turn quotes back ([`structured_with_repair`]).
    #[error("invalid structured output: {errors:?}")]
    InvalidOutput {
        errors: Vec<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        answer: Option<String>,
    },
    /// No executor available (e.g. no capable browser, or the GPU device was
    /// lost more often than the runtime retries); retry later. Not the job's
    /// fault: the orchestrator turns it into an infrastructure error, so the
    /// job runs again once the model is back (ADR-0058, P6).
    #[error("backend unavailable: {0}")]
    Unavailable(String),
    /// The call ran past its wall-clock limit, or was cancelled, and was
    /// aborted (the browser bridge, P6). The staged jobs retry the stage once.
    #[error("timed out: {0}")]
    Timeout(String),
    #[error("backend error: {0}")]
    Backend(String),
}

impl LlmError {
    /// [`LlmError::InvalidOutput`] without an answer to quote.
    pub fn invalid(errors: Vec<String>) -> Self {
        LlmError::InvalidOutput {
            errors,
            answer: None,
        }
    }
}

/// Receives streamed text deltas.
pub type DeltaSink<'a> = &'a mut (dyn FnMut(&str) + Send);

/// `Send + Sync` on native targets; nothing on wasm32, where the browser's
/// local models are JS objects (not `Send`) and everything runs on one thread.
#[cfg(not(target_arch = "wasm32"))]
pub trait MaybeSendSync: Send + Sync {}
#[cfg(not(target_arch = "wasm32"))]
impl<T: Send + Sync + ?Sized> MaybeSendSync for T {}
/// `Send + Sync` on native targets; nothing on wasm32, where the browser's
/// local models are JS objects (not `Send`) and everything runs on one thread.
#[cfg(target_arch = "wasm32")]
pub trait MaybeSendSync {}
#[cfg(target_arch = "wasm32")]
impl<T: ?Sized> MaybeSendSync for T {}

/// An LLM backend. Its futures are `Send` on native targets and `?Send` on
/// wasm32 (implementations use the same `cfg_attr` pair as this trait).
#[cfg_attr(not(target_arch = "wasm32"), async_trait)]
#[cfg_attr(target_arch = "wasm32", async_trait(?Send))]
pub trait Llm: MaybeSendSync {
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

    /// [`Llm::structured`] plus a semantic check (closed-world references,
    /// "numbers only from the input", …). Backends that can feed the check's
    /// errors back to the model as repair turns override this; the default
    /// validates once and fails with [`LlmError::InvalidOutput`].
    async fn structured_checked(
        &self,
        req: &LlmRequest,
        schema: &Value,
        check: &SemanticCheck<'_>,
    ) -> Result<Value, LlmError> {
        let v = self.structured(req, schema).await?;
        check(&v).map_err(|errors| LlmError::InvalidOutput {
            errors,
            answer: Some(v.to_string()),
        })?;
        Ok(v)
    }

    /// JSON conforming to `schema`, answered with web search (ADR-0068), and
    /// every source URL the searches returned. The caller checks the answer's
    /// cited URLs against `sources` ([`normalize_source_url`]). Backends that
    /// cannot search fail loudly (CLAUDE.md rule 11).
    async fn research(&self, req: &LlmRequest, schema: &Value) -> Result<Researched, LlmError> {
        let _ = (req, schema);
        Err(LlmError::Unavailable(
            "this model backend cannot search the web (ADR-0068)".into(),
        ))
    }

    /// The id of the model that answers, when the backend knows it (the
    /// browser's resident model, e.g. `ternary-bonsai-2-27b`): the `Model`
    /// of a commit's provenance (ADR-0056 decision 8). Default: unknown.
    fn model_id(&self) -> Option<String> {
        None
    }
}

/// A research answer (ADR-0068): the structured value and the source URLs the
/// web searches returned, normalized.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Researched {
    pub value: Value,
    #[serde(default)]
    pub sources: Vec<String>,
    #[serde(default)]
    pub searches: u32,
}

/// A source URL compared by what it points at: without the search provider's
/// `utm_source` parameter, the fragment and a trailing slash (the server's
/// `normalize_url` does the same to the sources it returns).
pub fn normalize_source_url(u: &str) -> String {
    let u = u.trim();
    let u = u.split('#').next().unwrap_or(u);
    let (base, query) = match u.split_once('?') {
        Some((b, q)) => (b, Some(q)),
        None => (u, None),
    };
    let kept: Vec<&str> = query
        .map(|q| {
            q.split('&')
                .filter(|kv| !kv.is_empty() && !kv.starts_with("utm_source="))
                .collect()
        })
        .unwrap_or_default();
    let base = base.trim_end_matches('/');
    if kept.is_empty() {
        base.to_string()
    } else {
        format!("{base}?{}", kept.join("&"))
    }
}

/// A semantic output check: `Err` lists human-readable problems.
pub type SemanticCheck<'a> = dyn Fn(&Value) -> Result<(), Vec<String>> + Sync + 'a;

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
            ClaudeError::SchemaValidation {
                errors,
                last_output,
                ..
            } => LlmError::InvalidOutput {
                errors,
                answer: Some(strip_reasoning(&last_output)),
            },
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

#[cfg_attr(not(target_arch = "wasm32"), async_trait)]
#[cfg_attr(target_arch = "wasm32", async_trait(?Send))]
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
    async fn structured_checked(
        &self,
        req: &LlmRequest,
        schema: &Value,
        check: &SemanticCheck<'_>,
    ) -> Result<Value, LlmError> {
        let mreq = self.build_request(req)?;
        let out = claude::structured_output_with(
            self.api.as_ref(),
            mreq,
            schema,
            self.max_schema_repairs,
            check,
        )
        .await?;
        Ok(out.value)
    }
}

// ---------------------------------------------------------------------------
// Repair turns (ADR-0058 decision 4)
// ---------------------------------------------------------------------------

/// Characters of a previous answer a repair turn quotes back, at most.
pub const REPAIR_QUOTE_CHARS: usize = 6000;
/// Problems a repair turn lists, at most (each cut to [`REPAIR_ERROR_CHARS`]).
pub const REPAIR_MAX_ERRORS: usize = 12;
pub const REPAIR_ERROR_CHARS: usize = 300;

/// The answer without the model's reasoning: `<think>…</think>` blocks are
/// removed, and an unterminated `<think>` drops everything after it (the
/// model never left its reasoning).
pub fn strip_reasoning(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    loop {
        let lower = rest.to_ascii_lowercase();
        let Some(open) = lower.find("<think>") else {
            out.push_str(rest);
            break;
        };
        out.push_str(&rest[..open]);
        match lower[open..].find("</think>") {
            Some(close) => rest = &rest[open + close + "</think>".len()..],
            None => break,
        }
    }
    out.trim().to_string()
}

fn cut_chars(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_string();
    }
    let cut: String = text.chars().take(max).collect();
    format!("{cut} […]")
}

/// What a repair turn quotes back: the answer without its reasoning, cut to
/// [`REPAIR_QUOTE_CHARS`].
pub fn repair_quote(answer: &str) -> String {
    let stripped = strip_reasoning(answer);
    let n = stripped.chars().count();
    if n <= REPAIR_QUOTE_CHARS {
        return stripped;
    }
    let cut: String = stripped.chars().take(REPAIR_QUOTE_CHARS).collect();
    format!("{cut}\n[… cut: the previous answer was {n} characters long]")
}

/// The user turn of a repair: the problems, each on one line, capped.
pub fn repair_turn(errors: &[String]) -> String {
    let mut s = String::from(
        "Your previous answer did not pass the checks. Fix every problem below and reply with the complete corrected JSON only.\n\nProblems:\n",
    );
    for e in errors.iter().take(REPAIR_MAX_ERRORS) {
        s.push_str("- ");
        s.push_str(&cut_chars(e.trim(), REPAIR_ERROR_CHARS));
        s.push('\n');
    }
    if errors.len() > REPAIR_MAX_ERRORS {
        s.push_str(&format!(
            "- … and {} more\n",
            errors.len() - REPAIR_MAX_ERRORS
        ));
    }
    s
}

/// The request of a repair turn. It starts again from the original request
/// (never from an earlier repair turn), so its size is bounded: the original
/// messages, the previous answer stripped of its reasoning and capped
/// ([`repair_quote`]), and the problems ([`repair_turn`]). Without an answer
/// to quote, the problems are appended to the last user message. Reasoning
/// is off: the model has thought about the task already.
pub fn repair_request(req: &LlmRequest, answer: Option<&str>, errors: &[String]) -> LlmRequest {
    let mut out = req.clone();
    out.reasoning_tokens = Some(0);
    let turn = repair_turn(errors);
    match answer.map(repair_quote).filter(|a| !a.is_empty()) {
        Some(quote) => {
            out.messages.push(LlmMessage::assistant(quote));
            out.messages.push(LlmMessage::user(turn));
        }
        None => match out.messages.last_mut() {
            Some(last) if last.role == LlmRole::User => {
                last.text = format!("{}\n\n{turn}", last.text);
            }
            _ => out.messages.push(LlmMessage::user(turn)),
        },
    }
    out
}

/// A structured answer that passed its checks.
#[derive(Debug, Clone, PartialEq)]
pub struct Repaired {
    pub value: Value,
    /// Model calls made: 1 plus the repair turns.
    pub calls: u32,
    pub repairs: u32,
}

/// A structured call that did not produce a value that passes its checks.
#[derive(Debug, Clone, PartialEq)]
pub struct RepairFailed {
    /// [`LlmError::InvalidOutput`] with the last problems (and answer) when
    /// the repairs ran out or made no progress; any other error as the
    /// backend reported it (a refusal or truncation is never repaired here).
    pub error: LlmError,
    pub calls: u32,
    pub repairs: u32,
    /// A repair turn gave back the same answer as before: the loop stopped.
    pub no_progress: bool,
}

impl RepairFailed {
    /// The problems of an invalid answer (empty for other errors).
    pub fn errors(&self) -> &[String] {
        match &self.error {
            LlmError::InvalidOutput { errors, .. } => errors,
            _ => &[],
        }
    }
}

/// [`Llm::structured`] with semantic `check`s and at most `max` repair turns
/// (ADR-0058 decision 4; `docs/design/mvp-pipeline.md` §1 "Repair loop in
/// Rust").
///
/// Schema problems the backend could not repair ([`LlmError::InvalidOutput`]
/// from the browser bridge) and problems `check` finds are handled alike: a
/// repair turn ([`repair_request`]) quotes the answer back without its
/// reasoning, capped, with the problems. An answer that does not change after
/// a repair turn stops the loop (no progress). Refusals, truncation and
/// backend errors are returned at once.
pub async fn structured_with_repair(
    llm: &dyn Llm,
    req: &LlmRequest,
    schema: &Value,
    check: &SemanticCheck<'_>,
    max: u32,
) -> Result<Repaired, RepairFailed> {
    let mut calls = 0;
    let mut previous: Option<String> = None;
    let mut errors: Vec<String> = Vec::new();
    for attempt in 0..=max {
        let request = if attempt == 0 {
            req.clone()
        } else {
            repair_request(req, previous.as_deref(), &errors)
        };
        calls += 1;
        let answer = match llm.structured(&request, schema).await {
            Ok(value) => match check(&value) {
                Ok(()) => {
                    return Ok(Repaired {
                        value,
                        calls,
                        repairs: attempt,
                    })
                }
                Err(problems) => {
                    errors = problems;
                    Some(value.to_string())
                }
            },
            Err(LlmError::InvalidOutput {
                errors: problems,
                answer,
            }) => {
                errors = problems;
                answer.map(|a| strip_reasoning(&a))
            }
            Err(error) => {
                return Err(RepairFailed {
                    error,
                    calls,
                    repairs: attempt,
                    no_progress: false,
                })
            }
        };
        let stuck = attempt > 0 && answer.is_some() && answer == previous;
        previous = answer;
        if stuck {
            return Err(RepairFailed {
                error: LlmError::InvalidOutput {
                    errors,
                    answer: previous,
                },
                calls,
                repairs: attempt,
                no_progress: true,
            });
        }
    }
    Err(RepairFailed {
        error: LlmError::InvalidOutput {
            errors,
            answer: previous,
        },
        calls,
        repairs: max,
        no_progress: false,
    })
}

// ---------------------------------------------------------------------------
// FakeLlm
// ---------------------------------------------------------------------------

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

/// Answers a [`FakeLlm`] call once its script is used up: the request and,
/// for a structured call, the schema. `crate::fake_writer` is one.
pub type FakeResponder = dyn Fn(&LlmRequest, Option<&Value>) -> FakeReply + Send + Sync;

/// Scripted [`Llm`]. `structured` validates the scripted JSON against the
/// schema and returns [`LlmError::InvalidOutput`] if it doesn't conform (as
/// a backend that exhausted its repairs would). Scripted replies come first;
/// then the responder answers, if there is one. An exhausted script without
/// a responder is an error.
#[derive(Default)]
pub struct FakeLlm {
    script: Mutex<VecDeque<FakeReply>>,
    calls: Mutex<Vec<RecordedCall>>,
    responder: Option<Box<FakeResponder>>,
    /// What [`Llm::model_id`] reports ([`FakeLlm::with_model_id`]).
    model_id: Option<String>,
}

impl std::fmt::Debug for FakeLlm {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("FakeLlm")
            .field("remaining", &self.remaining())
            .field("calls", &self.calls.lock().unwrap().len())
            .field("responder", &self.responder.is_some())
            .finish()
    }
}

impl FakeLlm {
    pub fn new(script: impl IntoIterator<Item = FakeReply>) -> Self {
        Self {
            script: Mutex::new(script.into_iter().collect()),
            calls: Mutex::default(),
            responder: None,
            model_id: None,
        }
    }

    /// Reports `id` as its [`Llm::model_id`].
    pub fn with_model_id(mut self, id: impl Into<String>) -> Self {
        self.model_id = Some(id.into());
        self
    }

    /// A script, then `responder` for every call after it.
    pub fn with_responder(
        script: impl IntoIterator<Item = FakeReply>,
        responder: impl Fn(&LlmRequest, Option<&Value>) -> FakeReply + Send + Sync + 'static,
    ) -> Self {
        Self {
            responder: Some(Box::new(responder)),
            ..Self::new(script)
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
        let scripted = self.script.lock().unwrap().pop_front();
        match (scripted, &self.responder) {
            (Some(reply), _) => Ok(reply),
            (None, Some(responder)) => Ok(responder(req, schema)),
            (None, None) => Err(LlmError::Backend(format!(
                "FakeLlm script exhausted at call #{n}"
            ))),
        }
    }
}

#[cfg_attr(not(target_arch = "wasm32"), async_trait)]
#[cfg_attr(target_arch = "wasm32", async_trait(?Send))]
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
                claude::extract_json(&strip_reasoning(&t)).map_err(|e| LlmError::InvalidOutput {
                    errors: vec![e],
                    answer: Some(strip_reasoning(&t)),
                })?
            }
            FakeReply::Error(e) => return Err(e),
        };
        let validator = claude::SchemaValidator::new(schema)
            .map_err(|e| LlmError::Backend(format!("bad schema: {e}")))?;
        validator
            .validate(&value)
            .map_err(|errors| LlmError::InvalidOutput {
                errors,
                answer: Some(value.to_string()),
            })?;
        Ok(value)
    }

    /// The responder's answer (scripts are for the stages a test is about; a
    /// fake without a responder takes the script), as if every URL it names had
    /// come back from a search.
    async fn research(&self, req: &LlmRequest, schema: &Value) -> Result<Researched, LlmError> {
        let value = match &self.responder {
            Some(responder) => {
                self.calls.lock().unwrap().push(RecordedCall {
                    request: req.clone(),
                    schema: Some(schema.clone()),
                });
                match responder(req, Some(schema)) {
                    FakeReply::Json(v) => v,
                    FakeReply::Text(t) => {
                        claude::extract_json(&strip_reasoning(&t)).map_err(|e| {
                            LlmError::InvalidOutput {
                                errors: vec![e],
                                answer: Some(t),
                            }
                        })?
                    }
                    FakeReply::Error(e) => return Err(e),
                }
            }
            None => self.structured(req, schema).await?,
        };
        let mut sources = Vec::new();
        collect_urls(&value, &mut sources);
        Ok(Researched {
            value,
            sources,
            searches: 1,
        })
    }

    fn model_id(&self) -> Option<String> {
        self.model_id.clone()
    }
}

/// Every string under a `url` key, normalized, without duplicates.
fn collect_urls(v: &Value, out: &mut Vec<String>) {
    match v {
        Value::Object(m) => {
            for (k, x) in m {
                if k == "url" {
                    if let Some(u) = x.as_str() {
                        let n = normalize_source_url(u);
                        if !out.contains(&n) {
                            out.push(n);
                        }
                    }
                } else {
                    collect_urls(x, out);
                }
            }
        }
        Value::Array(a) => a.iter().for_each(|x| collect_urls(x, out)),
        _ => {}
    }
}
