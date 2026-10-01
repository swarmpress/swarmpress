//! `FakeClaude`: a scripted [`ClaudeApi`] that records every request.
//!
//! Each call pops the next [`Scripted`] entry. An exhausted script is an
//! error ([`ClaudeError::ScriptExhausted`]), never a silent default.

use std::collections::VecDeque;
use std::sync::Mutex;

use async_trait::async_trait;
use serde_json::Value;

use crate::api::{ClaudeApi, EventSink};
use crate::error::{ClaudeError, Result};
use crate::sse::{Delta, DeltaUsage, MessageDeltaBody, StreamAccumulator, StreamEvent};
use crate::types::{
    ContentBlock, MessagesRequest, MessagesResponse, Role, StopDetails, StopReason, Usage,
};

#[derive(Debug, Clone)]
pub enum Scripted {
    /// Returned from `create`; replayed as synthesized events from `stream`.
    Response(MessagesResponse),
    /// Raw events, replayed by `stream` and accumulated by `create`.
    Events(Vec<StreamEvent>),
    Error(ClaudeError),
}

impl From<MessagesResponse> for Scripted {
    fn from(r: MessagesResponse) -> Self {
        Scripted::Response(r)
    }
}

impl From<ClaudeError> for Scripted {
    fn from(e: ClaudeError) -> Self {
        Scripted::Error(e)
    }
}

#[derive(Debug, Default)]
pub struct FakeClaude {
    script: Mutex<VecDeque<Scripted>>,
    requests: Mutex<Vec<MessagesRequest>>,
}

impl FakeClaude {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_script<I, S>(script: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<Scripted>,
    {
        let fake = Self::new();
        for s in script {
            fake.push(s);
        }
        fake
    }

    pub fn push(&self, item: impl Into<Scripted>) -> &Self {
        self.script.lock().unwrap().push_back(item.into());
        self
    }

    /// Every request received so far, in order.
    pub fn requests(&self) -> Vec<MessagesRequest> {
        self.requests.lock().unwrap().clone()
    }

    pub fn remaining(&self) -> usize {
        self.script.lock().unwrap().len()
    }

    fn next(&self, request: &MessagesRequest) -> Result<Scripted> {
        request.validate().map_err(ClaudeError::InvalidRequest)?;
        self.requests.lock().unwrap().push(request.clone());
        let n = self.requests.lock().unwrap().len();
        self.script
            .lock()
            .unwrap()
            .pop_front()
            .ok_or_else(|| ClaudeError::ScriptExhausted(format!("no scripted reply for call #{n}")))
    }
}

#[async_trait]
impl ClaudeApi for FakeClaude {
    async fn create(&self, request: &MessagesRequest) -> Result<MessagesResponse> {
        match self.next(request)? {
            Scripted::Response(r) => Ok(r),
            Scripted::Error(e) => Err(e),
            Scripted::Events(events) => {
                let mut acc = StreamAccumulator::new();
                for ev in &events {
                    acc.apply(ev)?;
                }
                acc.finish()
            }
        }
    }

    async fn stream(
        &self,
        request: &MessagesRequest,
        on_event: EventSink<'_>,
    ) -> Result<MessagesResponse> {
        let events = match self.next(request)? {
            Scripted::Response(r) => response_to_events(&r),
            Scripted::Events(events) => events,
            Scripted::Error(e) => return Err(e),
        };
        let mut acc = StreamAccumulator::new();
        for ev in &events {
            on_event(ev);
            acc.apply(ev)?;
        }
        acc.finish()
    }
}

/// Splits a response into the event sequence the API would stream for it
/// (text is chunked into small deltas, tool input into JSON fragments).
pub fn response_to_events(resp: &MessagesResponse) -> Vec<StreamEvent> {
    let mut start = resp.clone();
    start.content.clear();
    start.stop_reason = None;
    start.stop_sequence = None;
    start.stop_details = None;
    start.usage.output_tokens = 0;
    let mut events = vec![
        StreamEvent::MessageStart { message: start },
        StreamEvent::Ping,
    ];
    for (index, block) in resp.content.iter().enumerate() {
        match block {
            ContentBlock::Text { text, .. } => {
                events.push(StreamEvent::ContentBlockStart {
                    index,
                    content_block: ContentBlock::text(""),
                });
                for chunk in chunk_str(text, 12) {
                    events.push(StreamEvent::ContentBlockDelta {
                        index,
                        delta: Delta::TextDelta { text: chunk },
                    });
                }
            }
            ContentBlock::ToolUse { id, name, input } => {
                events.push(StreamEvent::ContentBlockStart {
                    index,
                    content_block: ContentBlock::ToolUse {
                        id: id.clone(),
                        name: name.clone(),
                        input: Value::Object(Default::default()),
                    },
                });
                let json = input.to_string();
                for chunk in chunk_str(&json, 16) {
                    events.push(StreamEvent::ContentBlockDelta {
                        index,
                        delta: Delta::InputJsonDelta {
                            partial_json: chunk,
                        },
                    });
                }
            }
            other => events.push(StreamEvent::ContentBlockStart {
                index,
                content_block: other.clone(),
            }),
        }
        events.push(StreamEvent::ContentBlockStop { index });
    }
    events.push(StreamEvent::MessageDelta {
        delta: MessageDeltaBody {
            stop_reason: resp.stop_reason,
            stop_sequence: resp.stop_sequence.clone(),
            stop_details: resp.stop_details.clone(),
        },
        usage: DeltaUsage {
            output_tokens: Some(resp.usage.output_tokens),
            ..Default::default()
        },
    });
    events.push(StreamEvent::MessageStop);
    events
}

fn chunk_str(s: &str, n: usize) -> Vec<String> {
    let chars: Vec<char> = s.chars().collect();
    if chars.is_empty() {
        return Vec::new();
    }
    chars.chunks(n).map(|c| c.iter().collect()).collect()
}

/// Builders for scripted responses.
pub mod responses {
    use super::*;

    fn base(content: Vec<ContentBlock>, stop: StopReason) -> MessagesResponse {
        let output_tokens = content
            .iter()
            .map(|b| match b {
                ContentBlock::Text { text, .. } => text.len() as u64 / 4 + 1,
                _ => 8,
            })
            .sum();
        MessagesResponse {
            id: "msg_fake".into(),
            model: crate::models::DEFAULT.into(),
            role: Role::Assistant,
            content,
            stop_reason: Some(stop),
            stop_sequence: None,
            stop_details: None,
            usage: Usage {
                input_tokens: 100,
                output_tokens,
                ..Default::default()
            },
        }
    }

    pub fn text(text: impl Into<String>) -> MessagesResponse {
        base(vec![ContentBlock::text(text)], StopReason::EndTurn)
    }

    /// A structured-output reply: the JSON serialized into a text block.
    pub fn json(value: &Value) -> MessagesResponse {
        text(value.to_string())
    }

    pub fn tool_use(id: &str, name: &str, input: Value) -> MessagesResponse {
        tool_uses(vec![(id, name, input)])
    }

    pub fn tool_uses(calls: Vec<(&str, &str, Value)>) -> MessagesResponse {
        base(
            calls
                .into_iter()
                .map(|(id, name, input)| ContentBlock::ToolUse {
                    id: id.into(),
                    name: name.into(),
                    input,
                })
                .collect(),
            StopReason::ToolUse,
        )
    }

    pub fn refusal(category: &str, explanation: &str) -> MessagesResponse {
        let mut r = base(Vec::new(), StopReason::Refusal);
        r.stop_details = Some(StopDetails {
            kind: Some("refusal".into()),
            category: Some(category.into()),
            explanation: Some(explanation.into()),
        });
        r
    }

    pub fn max_tokens(partial_text: impl Into<String>) -> MessagesResponse {
        base(
            vec![ContentBlock::text(partial_text)],
            StopReason::MaxTokens,
        )
    }

    /// Sets the serving model (e.g. to simulate server-side fallback).
    pub fn served_by(mut resp: MessagesResponse, model: &str) -> MessagesResponse {
        resp.model = model.into();
        resp
    }
}
