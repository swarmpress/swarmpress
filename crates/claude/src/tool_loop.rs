//! Client tool-use loop.

use async_trait::async_trait;
use serde_json::Value;

use crate::api::ClaudeApi;
use crate::error::{ClaudeError, Result};
use crate::types::{ContentBlock, Message, MessagesRequest, MessagesResponse, StopReason, Usage};

/// Executes client tools. `Err(text)` becomes a `tool_result` with
/// `is_error: true` so the model can correct itself.
#[async_trait]
pub trait ToolExecutor: Send + Sync {
    async fn execute(&self, name: &str, input: &Value) -> std::result::Result<String, String>;
}

#[derive(Debug, Clone)]
pub struct ToolLoopOutcome {
    /// The last response (stop_reason `end_turn`, `max_tokens`, …).
    pub response: MessagesResponse,
    /// The full conversation including the final assistant turn.
    pub messages: Vec<Message>,
    /// Number of API calls made.
    pub calls: u32,
    pub usage: Usage,
}

/// Runs `create` until the model stops asking for tools.
///
/// - every `tool_use` in a turn is executed and **all** results go back in a
///   single user message;
/// - unknown tools and executor failures become `is_error` results;
/// - `pause_turn` (a long server-tool turn) re-sends the conversation;
/// - a refusal returns [`ClaudeError::Refusal`];
/// - `max_tokens` returns the outcome as-is; the caller decides whether to
///   continue.
pub async fn run_tool_loop(
    api: &dyn ClaudeApi,
    request: MessagesRequest,
    executor: &dyn ToolExecutor,
    max_calls: u32,
) -> Result<ToolLoopOutcome> {
    let mut req = request;
    let mut usage = Usage::default();
    let known: Vec<String> = req.tools.iter().map(|t| t.name().to_owned()).collect();
    for call in 1..=max_calls {
        let resp = api.create(&req).await?;
        usage.accumulate(&resp.usage);
        let resp = resp.check_refusal()?;
        match resp.stop_reason {
            Some(StopReason::ToolUse) => {
                let mut results = Vec::new();
                for (id, name, input) in resp.tool_uses() {
                    let result = if known.iter().any(|k| k == name) {
                        executor.execute(name, input).await
                    } else {
                        Err(format!("unknown tool {name:?}"))
                    };
                    results.push(match result {
                        Ok(out) => ContentBlock::tool_result(id, out, false),
                        Err(err) => ContentBlock::tool_result(id, err, true),
                    });
                }
                if results.is_empty() {
                    return Err(ClaudeError::Decode(
                        "stop_reason tool_use without tool_use blocks".into(),
                    ));
                }
                req.messages.push(Message::assistant(resp.content.clone()));
                req.messages.push(Message::user(results));
            }
            Some(StopReason::PauseTurn) => {
                req.messages.push(Message::assistant(resp.content.clone()));
                // The API resumes a paused turn when the conversation is
                // re-sent; a trailing user nudge keeps "no prefill" intact.
                req.messages.push(Message::user_text("Continue."));
            }
            _ => {
                let mut messages = req.messages;
                messages.push(Message::assistant(resp.content.clone()));
                return Ok(ToolLoopOutcome {
                    response: resp,
                    messages,
                    calls: call,
                    usage,
                });
            }
        }
    }
    Err(ClaudeError::ToolLoopExhausted(max_calls))
}
