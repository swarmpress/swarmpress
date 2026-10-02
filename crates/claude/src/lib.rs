//! Claude Messages API client over raw HTTP (there is no official Rust SDK).
//!
//! - [`ClaudeApi`]: `create` + `stream`, implemented by [`HttpClaude`]
//!   (reqwest + rustls, hand-written SSE parser, retries with jitter that
//!   honor `retry-after`) and [`FakeClaude`] (scripted, records requests).
//! - [`run_tool_loop`]: executes client tools, returns all results in one
//!   user message, `is_error` on failures.
//! - [`structured_output`]: JSON-schema output with local validation and
//!   repair turns.
//! - Refusals (`stop_reason: "refusal"`) map to [`ClaudeError::Refusal`] and
//!   are never retried.
//! - Server-side fallback is on by default ([`HttpConfig::server_side_fallback`]).
//! - Prompt caching: [`MessagesRequest::with_system_layers`] puts
//!   `cache_control` on the last stable system block.

mod api;
mod error;
pub mod fake;
#[cfg(feature = "http")]
mod http;
pub mod sse;
mod structured;
mod tool_loop;
mod types;

pub use api::{ClaudeApi, EventSink};
pub use error::{ClaudeError, Result};
pub use fake::{FakeClaude, Scripted};
#[cfg(feature = "http")]
pub use http::{
    HttpClaude, HttpConfig, PreparedRequest, RetryPolicy, ANTHROPIC_VERSION, DEFAULT_BASE_URL,
    FALLBACK_BETA,
};
pub use sse::{StreamAccumulator, StreamEvent};
pub use structured::{
    extract_json, repair_prompt, structured_output, structured_output_with, SchemaValidator,
    StructuredOutcome,
};
pub use tool_loop::{run_tool_loop, ToolExecutor, ToolLoopOutcome};
pub use types::*;
