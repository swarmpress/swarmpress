//! Typed request/response structs for `POST /v1/messages`.
//!
//! Model-specific rules encoded here (current Claude 5.5 / 4.5 models):
//! - thinking is adaptive and always on; there is no `thinking` field at all
//!   (sending `{type:"disabled"}` or `budget_tokens` is a 400);
//! - depth is controlled by `output_config.effort`, which this crate always
//!   sets explicitly ([`OutputConfig`] has no `Option` around it);
//! - forced tool choice (`any` / `tool`) is a 400, so [`ToolChoice`] can only
//!   express `auto` and `none`;
//! - no assistant prefill: requests must end with a user turn
//!   ([`MessagesRequest::validate`]).

use std::fmt;
use std::str::FromStr;

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Model identifiers.
pub mod models {
    pub const OPUS: &str = "claude-opus-5-5";
    pub const SONNET: &str = "claude-sonnet-5-5";
    pub const HAIKU: &str = "claude-haiku-4-5";
    /// Default model for every call that doesn't pick one.
    pub const DEFAULT: &str = OPUS;
    /// All models this crate knows about.
    pub const ALL: [&str; 3] = [OPUS, SONNET, HAIKU];
}

/// `output_config.effort`. Always set explicitly (opus-5-5 defaults to
/// `medium` server-side, but we never rely on the default).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Effort {
    Low,
    Medium,
    High,
    Xhigh,
    Max,
}

impl Effort {
    pub fn as_str(self) -> &'static str {
        match self {
            Effort::Low => "low",
            Effort::Medium => "medium",
            Effort::High => "high",
            Effort::Xhigh => "xhigh",
            Effort::Max => "max",
        }
    }
}

impl fmt::Display for Effort {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for Effort {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "low" => Ok(Effort::Low),
            "medium" => Ok(Effort::Medium),
            "high" => Ok(Effort::High),
            "xhigh" => Ok(Effort::Xhigh),
            "max" => Ok(Effort::Max),
            other => Err(format!("unknown effort {other:?}")),
        }
    }
}

/// `cache_control: {type: "ephemeral"}`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CacheControl {
    #[serde(rename = "type")]
    pub kind: String,
}

impl CacheControl {
    pub fn ephemeral() -> Self {
        Self {
            kind: "ephemeral".into(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    User,
    Assistant,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ImageSource {
    Base64 { media_type: String, data: String },
    Url { url: String },
}

fn is_false(b: &bool) -> bool {
    !*b
}

/// A content block in a request or response message.
///
/// Unknown block types (new server features, fallback annotations, ...) are
/// preserved verbatim in [`ContentBlock::Unknown`] so they can be echoed back
/// to the API unchanged in a tool loop.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ContentBlock {
    Text {
        text: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        cache_control: Option<CacheControl>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        citations: Option<Vec<Value>>,
    },
    Image {
        source: ImageSource,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        cache_control: Option<CacheControl>,
    },
    ToolUse {
        id: String,
        name: String,
        input: Value,
    },
    ToolResult {
        tool_use_id: String,
        content: String,
        #[serde(default, skip_serializing_if = "is_false")]
        is_error: bool,
    },
    Thinking {
        thinking: String,
        #[serde(default)]
        signature: String,
    },
    RedactedThinking {
        data: String,
    },
    ServerToolUse {
        id: String,
        name: String,
        input: Value,
    },
    WebSearchToolResult {
        tool_use_id: String,
        content: Value,
    },
    #[serde(untagged)]
    Unknown(Value),
}

impl ContentBlock {
    pub fn text(text: impl Into<String>) -> Self {
        ContentBlock::Text {
            text: text.into(),
            cache_control: None,
            citations: None,
        }
    }

    pub fn tool_result(
        tool_use_id: impl Into<String>,
        content: impl Into<String>,
        is_error: bool,
    ) -> Self {
        ContentBlock::ToolResult {
            tool_use_id: tool_use_id.into(),
            content: content.into(),
            is_error,
        }
    }

    pub fn image_base64(media_type: impl Into<String>, data: impl Into<String>) -> Self {
        ContentBlock::Image {
            source: ImageSource::Base64 {
                media_type: media_type.into(),
                data: data.into(),
            },
            cache_control: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Message {
    pub role: Role,
    pub content: Vec<ContentBlock>,
}

impl Message {
    pub fn user_text(text: impl Into<String>) -> Self {
        Self {
            role: Role::User,
            content: vec![ContentBlock::text(text)],
        }
    }

    pub fn assistant_text(text: impl Into<String>) -> Self {
        Self {
            role: Role::Assistant,
            content: vec![ContentBlock::text(text)],
        }
    }

    pub fn user(content: Vec<ContentBlock>) -> Self {
        Self {
            role: Role::User,
            content,
        }
    }

    pub fn assistant(content: Vec<ContentBlock>) -> Self {
        Self {
            role: Role::Assistant,
            content,
        }
    }
}

/// A system prompt block. Only `text` exists.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SystemBlock {
    Text {
        text: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        cache_control: Option<CacheControl>,
    },
}

impl SystemBlock {
    pub fn text(text: impl Into<String>) -> Self {
        SystemBlock::Text {
            text: text.into(),
            cache_control: None,
        }
    }

    pub fn cached(text: impl Into<String>) -> Self {
        SystemBlock::Text {
            text: text.into(),
            cache_control: Some(CacheControl::ephemeral()),
        }
    }

    pub fn is_cached(&self) -> bool {
        matches!(
            self,
            SystemBlock::Text {
                cache_control: Some(_),
                ..
            }
        )
    }
}

/// A client tool definition. Prefer [`CustomTool::strict`] so the API
/// guarantees schema-conformant inputs (forced tool choice is unavailable).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CustomTool {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub strict: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cache_control: Option<CacheControl>,
}

impl CustomTool {
    pub fn strict(
        name: impl Into<String>,
        description: impl Into<String>,
        input_schema: Value,
    ) -> Self {
        Self {
            name: name.into(),
            description: description.into(),
            input_schema,
            strict: Some(true),
            cache_control: None,
        }
    }
}

/// A server tool (executed by Anthropic), e.g. web search.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ServerTool {
    #[serde(rename = "type")]
    pub kind: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_uses: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub allowed_domains: Option<Vec<String>>,
}

pub const WEB_SEARCH_TOOL_TYPE: &str = "web_search_20260209";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Tool {
    Server(ServerTool),
    Custom(CustomTool),
}

impl Tool {
    pub fn web_search(max_uses: u32) -> Self {
        Tool::Server(ServerTool {
            kind: WEB_SEARCH_TOOL_TYPE.into(),
            name: "web_search".into(),
            max_uses: Some(max_uses),
            allowed_domains: None,
        })
    }

    pub fn custom(tool: CustomTool) -> Self {
        Tool::Custom(tool)
    }

    pub fn name(&self) -> &str {
        match self {
            Tool::Server(t) => &t.name,
            Tool::Custom(t) => &t.name,
        }
    }
}

/// Tool choice. Only non-forcing variants exist: forced `any`/`tool` is a
/// 400 on the current models, so it is unrepresentable here.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ToolChoice {
    Auto {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        disable_parallel_tool_use: Option<bool>,
    },
    None,
}

impl ToolChoice {
    pub fn auto() -> Self {
        ToolChoice::Auto {
            disable_parallel_tool_use: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum OutputFormat {
    JsonSchema { schema: Value },
}

/// `output_config`. `effort` is mandatory by construction.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OutputConfig {
    pub effort: Effort,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub format: Option<OutputFormat>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Metadata {
    pub user_id: String,
}

/// Body of `POST /v1/messages`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MessagesRequest {
    pub model: String,
    pub max_tokens: u32,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub system: Vec<SystemBlock>,
    pub messages: Vec<Message>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tools: Vec<Tool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_choice: Option<ToolChoice>,
    pub output_config: OutputConfig,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stop_sequences: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<Metadata>,
    /// Server-side fallback (`"default"`). Filled in by [`crate::HttpClaude`]
    /// when fallback is enabled in its config and this is `None`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fallbacks: Option<String>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub stream: bool,
}

impl MessagesRequest {
    pub fn new(model: impl Into<String>, max_tokens: u32, effort: Effort) -> Self {
        Self {
            model: model.into(),
            max_tokens,
            system: Vec::new(),
            messages: Vec::new(),
            tools: Vec::new(),
            tool_choice: None,
            output_config: OutputConfig {
                effort,
                format: None,
            },
            stop_sequences: None,
            metadata: None,
            fallbacks: None,
            stream: false,
        }
    }

    /// Sets the system prompt from stable layers (company → site → persona,
    /// identical across calls) plus an optional volatile tail. The cache
    /// breakpoint goes on the **last stable** block so the volatile part never
    /// invalidates the cached prefix.
    pub fn with_system_layers<S: AsRef<str>>(
        mut self,
        stable: &[S],
        volatile: Option<&str>,
    ) -> Self {
        self.system.clear();
        let n = stable.len();
        for (i, s) in stable.iter().enumerate() {
            if i + 1 == n {
                self.system.push(SystemBlock::cached(s.as_ref()));
            } else {
                self.system.push(SystemBlock::text(s.as_ref()));
            }
        }
        if let Some(v) = volatile {
            self.system.push(SystemBlock::text(v));
        }
        self
    }

    pub fn with_message(mut self, message: Message) -> Self {
        self.messages.push(message);
        self
    }

    pub fn with_user(self, text: impl Into<String>) -> Self {
        self.with_message(Message::user_text(text))
    }

    /// Adds tools and sets `tool_choice: auto` (the only legal choice).
    pub fn with_tools(mut self, tools: Vec<Tool>) -> Self {
        self.tools.extend(tools);
        if !self.tools.is_empty() {
            self.tool_choice = Some(ToolChoice::auto());
        }
        self
    }

    pub fn with_json_schema(mut self, schema: Value) -> Self {
        self.output_config.format = Some(OutputFormat::JsonSchema { schema });
        self
    }

    pub fn with_effort(mut self, effort: Effort) -> Self {
        self.output_config.effort = effort;
        self
    }

    /// Local checks for things the API would reject: empty conversation and
    /// assistant prefill (the last message must be a user turn).
    pub fn validate(&self) -> Result<(), String> {
        match self.messages.last() {
            None => Err("request has no messages".into()),
            Some(m) if m.role == Role::Assistant => {
                Err("assistant prefill is not supported: last message must be a user turn".into())
            }
            Some(_) => Ok(()),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StopReason {
    EndTurn,
    MaxTokens,
    StopSequence,
    ToolUse,
    PauseTurn,
    Refusal,
    #[serde(other)]
    Other,
}

/// `stop_details` (present with `stop_reason: "refusal"`).
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct StopDetails {
    #[serde(default, rename = "type", skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub explanation: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct Usage {
    #[serde(default)]
    pub input_tokens: u64,
    #[serde(default)]
    pub output_tokens: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cache_creation_input_tokens: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cache_read_input_tokens: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub server_tool_use: Option<Value>,
}

impl Usage {
    /// Adds another call's usage into this running total.
    pub fn accumulate(&mut self, other: &Usage) {
        self.input_tokens += other.input_tokens;
        self.output_tokens += other.output_tokens;
        fn add(a: &mut Option<u64>, b: Option<u64>) {
            if let Some(b) = b {
                *a = Some(a.unwrap_or(0) + b);
            }
        }
        add(
            &mut self.cache_creation_input_tokens,
            other.cache_creation_input_tokens,
        );
        add(
            &mut self.cache_read_input_tokens,
            other.cache_read_input_tokens,
        );
    }
}

/// Response of `POST /v1/messages` (also the accumulated result of a stream).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MessagesResponse {
    pub id: String,
    /// The model that actually served the request. With server-side
    /// fallback this may differ from the requested model.
    pub model: String,
    pub role: Role,
    #[serde(default)]
    pub content: Vec<ContentBlock>,
    #[serde(default)]
    pub stop_reason: Option<StopReason>,
    #[serde(default)]
    pub stop_sequence: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stop_details: Option<StopDetails>,
    #[serde(default)]
    pub usage: Usage,
}

impl MessagesResponse {
    /// Concatenated text of all text blocks.
    pub fn text(&self) -> String {
        let mut out = String::new();
        for b in &self.content {
            if let ContentBlock::Text { text, .. } = b {
                out.push_str(text);
            }
        }
        out
    }

    /// `(id, name, input)` of each client tool call.
    pub fn tool_uses(&self) -> Vec<(&str, &str, &Value)> {
        self.content
            .iter()
            .filter_map(|b| match b {
                ContentBlock::ToolUse { id, name, input } => {
                    Some((id.as_str(), name.as_str(), input))
                }
                _ => None,
            })
            .collect()
    }

    pub fn is_refusal(&self) -> bool {
        self.stop_reason == Some(StopReason::Refusal)
    }

    /// True when the server answered with a different model than requested.
    pub fn served_by_fallback(&self, requested_model: &str) -> bool {
        self.model != requested_model
    }

    /// Maps `stop_reason: "refusal"` to [`crate::ClaudeError::Refusal`].
    /// Callers must not retry the same prompt after a refusal.
    pub fn check_refusal(self) -> Result<Self, crate::ClaudeError> {
        if self.is_refusal() {
            let details = self.stop_details.clone().unwrap_or_default();
            return Err(crate::ClaudeError::Refusal {
                category: details.category,
                explanation: details.explanation,
            });
        }
        Ok(self)
    }
}
