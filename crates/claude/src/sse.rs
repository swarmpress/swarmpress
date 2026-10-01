//! Server-sent events: a hand-written incremental SSE frame parser, the typed
//! Messages stream events, and an accumulator that folds a stream into a
//! [`MessagesResponse`].

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::{ClaudeError, Result};
use crate::types::{ContentBlock, MessagesResponse, StopDetails, StopReason};

/// One dispatched SSE frame (`event:` + joined `data:` lines).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SseFrame {
    pub event: Option<String>,
    pub data: String,
}

/// Incremental SSE parser. Feed arbitrary byte chunks (they may split lines
/// or UTF-8 sequences); complete frames come out.
#[derive(Debug, Default)]
pub struct SseParser {
    buf: Vec<u8>,
    event: Option<String>,
    data: Vec<String>,
}

impl SseParser {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn push(&mut self, chunk: &[u8]) -> Vec<SseFrame> {
        self.buf.extend_from_slice(chunk);
        let mut frames = Vec::new();
        while let Some(pos) = self.buf.iter().position(|&b| b == b'\n') {
            let mut line: Vec<u8> = self.buf.drain(..=pos).collect();
            line.pop(); // '\n'
            if line.last() == Some(&b'\r') {
                line.pop();
            }
            let line = String::from_utf8_lossy(&line).into_owned();
            self.handle_line(&line, &mut frames);
        }
        frames
    }

    /// Flushes a trailing frame that wasn't terminated by a blank line.
    pub fn finish(&mut self) -> Vec<SseFrame> {
        let mut frames = Vec::new();
        if !self.buf.is_empty() {
            let rest = std::mem::take(&mut self.buf);
            let line = String::from_utf8_lossy(&rest)
                .trim_end_matches('\r')
                .to_owned();
            self.handle_line(&line, &mut frames);
        }
        self.dispatch(&mut frames);
        frames
    }

    fn handle_line(&mut self, line: &str, frames: &mut Vec<SseFrame>) {
        if line.is_empty() {
            self.dispatch(frames);
            return;
        }
        if line.starts_with(':') {
            return; // comment
        }
        let (field, value) = match line.find(':') {
            Some(i) => {
                let v = &line[i + 1..];
                (&line[..i], v.strip_prefix(' ').unwrap_or(v))
            }
            None => (line, ""),
        };
        match field {
            "event" => self.event = Some(value.to_owned()),
            "data" => self.data.push(value.to_owned()),
            _ => {} // id, retry: unused by the Messages API
        }
    }

    fn dispatch(&mut self, frames: &mut Vec<SseFrame>) {
        if self.data.is_empty() {
            self.event = None;
            return;
        }
        frames.push(SseFrame {
            event: self.event.take(),
            data: std::mem::take(&mut self.data).join("\n"),
        });
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ApiErrorBody {
    #[serde(rename = "type")]
    pub error_type: String,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Delta {
    TextDelta {
        text: String,
    },
    InputJsonDelta {
        partial_json: String,
    },
    ThinkingDelta {
        thinking: String,
    },
    SignatureDelta {
        signature: String,
    },
    CitationsDelta {
        citation: Value,
    },
    #[serde(untagged)]
    Unknown(Value),
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct MessageDeltaBody {
    #[serde(default)]
    pub stop_reason: Option<StopReason>,
    #[serde(default)]
    pub stop_sequence: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stop_details: Option<StopDetails>,
}

/// Cumulative usage in `message_delta` (any field may be absent).
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct DeltaUsage {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input_tokens: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output_tokens: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cache_creation_input_tokens: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cache_read_input_tokens: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub server_tool_use: Option<Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum StreamEvent {
    MessageStart {
        message: MessagesResponse,
    },
    ContentBlockStart {
        index: usize,
        content_block: ContentBlock,
    },
    ContentBlockDelta {
        index: usize,
        delta: Delta,
    },
    ContentBlockStop {
        index: usize,
    },
    MessageDelta {
        #[serde(default)]
        delta: MessageDeltaBody,
        #[serde(default)]
        usage: DeltaUsage,
    },
    MessageStop,
    Ping,
    Error {
        error: ApiErrorBody,
    },
    #[serde(untagged)]
    Unknown(Value),
}

impl StreamEvent {
    /// The text of a `text_delta`, if this is one.
    pub fn text_delta(&self) -> Option<&str> {
        match self {
            StreamEvent::ContentBlockDelta {
                delta: Delta::TextDelta { text },
                ..
            } => Some(text),
            _ => None,
        }
    }
}

/// Decodes one SSE frame into a typed event.
pub fn parse_event(frame: &SseFrame) -> Result<StreamEvent> {
    serde_json::from_str(&frame.data)
        .map_err(|e| ClaudeError::Decode(format!("bad SSE data for event {:?}: {e}", frame.event)))
}

/// Folds stream events into a final [`MessagesResponse`].
#[derive(Debug, Default)]
pub struct StreamAccumulator {
    message: Option<MessagesResponse>,
    partial_json: BTreeMap<usize, String>,
    stopped: bool,
}

impl StreamAccumulator {
    pub fn new() -> Self {
        Self::default()
    }

    /// Applies one event. An `error` event becomes [`ClaudeError::Stream`].
    pub fn apply(&mut self, event: &StreamEvent) -> Result<()> {
        match event {
            StreamEvent::MessageStart { message } => {
                self.message = Some(message.clone());
            }
            StreamEvent::ContentBlockStart {
                index,
                content_block,
            } => {
                let msg = self.msg_mut()?;
                if *index != msg.content.len() {
                    return Err(ClaudeError::Decode(format!(
                        "content_block_start index {index} but {} blocks so far",
                        msg.content.len()
                    )));
                }
                msg.content.push(content_block.clone());
            }
            StreamEvent::ContentBlockDelta { index, delta } => {
                let index = *index;
                if let Delta::InputJsonDelta { partial_json } = delta {
                    self.partial_json
                        .entry(index)
                        .or_default()
                        .push_str(partial_json);
                    return Ok(());
                }
                let block = self.block_mut(index)?;
                match (block, delta) {
                    (ContentBlock::Text { text, .. }, Delta::TextDelta { text: d }) => {
                        text.push_str(d)
                    }
                    (ContentBlock::Text { citations, .. }, Delta::CitationsDelta { citation }) => {
                        citations
                            .get_or_insert_with(Vec::new)
                            .push(citation.clone())
                    }
                    (
                        ContentBlock::Thinking { thinking, .. },
                        Delta::ThinkingDelta { thinking: d },
                    ) => thinking.push_str(d),
                    (
                        ContentBlock::Thinking { signature, .. },
                        Delta::SignatureDelta { signature: s },
                    ) => signature.push_str(s),
                    (_, Delta::Unknown(_)) => {}
                    (b, d) => {
                        return Err(ClaudeError::Decode(format!(
                            "delta {d:?} does not apply to block {b:?}"
                        )))
                    }
                }
            }
            StreamEvent::ContentBlockStop { index } => {
                let index = *index;
                if let Some(json) = self.partial_json.remove(&index) {
                    let parsed: Value = if json.trim().is_empty() {
                        Value::Object(Default::default())
                    } else {
                        serde_json::from_str(&json).map_err(|e| {
                            ClaudeError::Decode(format!("tool input JSON for block {index}: {e}"))
                        })?
                    };
                    match self.block_mut(index)? {
                        ContentBlock::ToolUse { input, .. }
                        | ContentBlock::ServerToolUse { input, .. } => *input = parsed,
                        other => {
                            return Err(ClaudeError::Decode(format!(
                                "input_json_delta on non-tool block {other:?}"
                            )))
                        }
                    }
                }
            }
            StreamEvent::MessageDelta { delta, usage } => {
                let msg = self.msg_mut()?;
                if delta.stop_reason.is_some() {
                    msg.stop_reason = delta.stop_reason;
                }
                if delta.stop_sequence.is_some() {
                    msg.stop_sequence = delta.stop_sequence.clone();
                }
                if delta.stop_details.is_some() {
                    msg.stop_details = delta.stop_details.clone();
                }
                let u = &mut msg.usage;
                if let Some(v) = usage.input_tokens {
                    u.input_tokens = v;
                }
                if let Some(v) = usage.output_tokens {
                    u.output_tokens = v;
                }
                if usage.cache_creation_input_tokens.is_some() {
                    u.cache_creation_input_tokens = usage.cache_creation_input_tokens;
                }
                if usage.cache_read_input_tokens.is_some() {
                    u.cache_read_input_tokens = usage.cache_read_input_tokens;
                }
                if usage.server_tool_use.is_some() {
                    u.server_tool_use = usage.server_tool_use.clone();
                }
            }
            StreamEvent::MessageStop => self.stopped = true,
            StreamEvent::Ping | StreamEvent::Unknown(_) => {}
            StreamEvent::Error { error } => {
                return Err(ClaudeError::Stream {
                    error_type: error.error_type.clone(),
                    message: error.message.clone(),
                })
            }
        }
        Ok(())
    }

    /// The final message. Fails if the stream ended before `message_stop`.
    pub fn finish(self) -> Result<MessagesResponse> {
        let msg = self
            .message
            .ok_or_else(|| ClaudeError::Transport("stream ended before message_start".into()))?;
        if !self.stopped {
            return Err(ClaudeError::Transport(
                "stream ended before message_stop".into(),
            ));
        }
        Ok(msg)
    }

    fn msg_mut(&mut self) -> Result<&mut MessagesResponse> {
        self.message
            .as_mut()
            .ok_or_else(|| ClaudeError::Decode("event before message_start".into()))
    }

    fn block_mut(&mut self, index: usize) -> Result<&mut ContentBlock> {
        self.msg_mut()?
            .content
            .get_mut(index)
            .ok_or_else(|| ClaudeError::Decode(format!("delta for unknown block {index}")))
    }
}

/// Parses a complete SSE body (fixtures, tests). Returns every event and the
/// accumulated response, or the first stream/decode error.
pub fn parse_sse_body(body: &[u8]) -> Result<(Vec<StreamEvent>, MessagesResponse)> {
    let mut parser = SseParser::new();
    let mut frames = parser.push(body);
    frames.extend(parser.finish());
    let mut acc = StreamAccumulator::new();
    let mut events = Vec::with_capacity(frames.len());
    for frame in &frames {
        let ev = parse_event(frame)?;
        acc.apply(&ev)?;
        events.push(ev);
    }
    Ok((events, acc.finish()?))
}
