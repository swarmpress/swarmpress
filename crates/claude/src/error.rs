use std::time::Duration;

use crate::types::MessagesResponse;

/// Every way a Claude call can fail.
///
/// A refusal is an error, not a response: the orchestrator blocks the stage
/// and opens a ticket. It is never retryable.
#[derive(Debug, Clone, PartialEq, thiserror::Error)]
pub enum ClaudeError {
    #[error("HTTP {status} ({error_type}): {message}")]
    Http {
        status: u16,
        error_type: String,
        message: String,
        retry_after: Option<Duration>,
    },
    /// An `event: error` frame inside an SSE stream.
    #[error("stream error ({error_type}): {message}")]
    Stream { error_type: String, message: String },
    #[error("transport error: {0}")]
    Transport(String),
    #[error("decode error: {0}")]
    Decode(String),
    #[error("invalid request: {0}")]
    InvalidRequest(String),
    #[error("model refused (category {category:?}): {explanation:?}")]
    Refusal {
        category: Option<String>,
        explanation: Option<String>,
    },
    /// Output hit `max_tokens` where the helper cannot continue on its own
    /// (e.g. truncated structured JSON). The partial response is attached so
    /// the caller can decide whether to continue.
    #[error("output truncated at max_tokens")]
    MaxTokens { partial: Box<MessagesResponse> },
    #[error("structured output invalid after {attempts} attempt(s): {errors:?}")]
    SchemaValidation {
        attempts: u32,
        errors: Vec<String>,
        last_output: String,
    },
    #[error("invalid JSON schema: {0}")]
    InvalidSchema(String),
    #[error("tool loop exceeded {0} iterations")]
    ToolLoopExhausted(u32),
    #[error("FakeClaude script exhausted: {0}")]
    ScriptExhausted(String),
}

impl ClaudeError {
    /// Whether the same request may be retried (rate limits, overload,
    /// server errors, transport failures). Refusals never are.
    pub fn is_retryable(&self) -> bool {
        match self {
            ClaudeError::Http {
                status, error_type, ..
            } => {
                matches!(*status, 408 | 409 | 429 | 529)
                    || (500..=599).contains(status) && *status != 501
                    || error_type == "overloaded_error"
                    || error_type == "rate_limit_error"
            }
            ClaudeError::Stream { error_type, .. } => {
                matches!(
                    error_type.as_str(),
                    "overloaded_error" | "api_error" | "rate_limit_error"
                )
            }
            ClaudeError::Transport(_) => true,
            _ => false,
        }
    }

    pub fn is_refusal(&self) -> bool {
        matches!(self, ClaudeError::Refusal { .. })
    }
}

pub type Result<T, E = ClaudeError> = std::result::Result<T, E>;
