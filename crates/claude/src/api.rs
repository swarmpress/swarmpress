use async_trait::async_trait;

use crate::error::Result;
use crate::sse::StreamEvent;
use crate::types::{MessagesRequest, MessagesResponse};

/// Callback that receives every stream event as it arrives (token deltas go
/// straight into speech bubbles and the feed).
pub type EventSink<'a> = &'a mut (dyn FnMut(&StreamEvent) + Send);

/// The Messages API. Implemented by [`crate::HttpClaude`] (real HTTP) and
/// [`crate::FakeClaude`] (scripted, for tests).
///
/// Both methods return the raw response, including `stop_reason: "refusal"`
/// and `"max_tokens"`; use [`MessagesResponse::check_refusal`] or the
/// higher-level helpers ([`crate::run_tool_loop`], [`crate::structured_output`])
/// which map refusals to [`crate::ClaudeError::Refusal`].
#[async_trait]
pub trait ClaudeApi: Send + Sync {
    async fn create(&self, request: &MessagesRequest) -> Result<MessagesResponse>;

    /// Streams the response, invoking `on_event` for each event, and returns
    /// the accumulated message.
    async fn stream(
        &self,
        request: &MessagesRequest,
        on_event: EventSink<'_>,
    ) -> Result<MessagesResponse>;
}
