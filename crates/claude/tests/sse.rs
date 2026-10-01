use claude::sse::{parse_sse_body, SseParser};
use claude::{ClaudeError, ContentBlock, StopReason, StreamEvent};
use serde_json::json;

fn fixture(name: &str) -> Vec<u8> {
    std::fs::read(format!(
        "{}/tests/fixtures/sse/{name}",
        env!("CARGO_MANIFEST_DIR")
    ))
    .unwrap()
}

#[test]
fn text_stream_with_thinking_ping_and_comment() {
    let (events, msg) = parse_sse_body(&fixture("text.sse")).unwrap();
    assert!(events.iter().any(|e| matches!(e, StreamEvent::Ping)));
    let deltas: Vec<&str> = events.iter().filter_map(|e| e.text_delta()).collect();
    assert_eq!(
        deltas,
        ["Buongiorno! ", "I'd pitch the Via dell'Amore reopening."]
    );
    assert_eq!(
        msg.text(),
        "Buongiorno! I'd pitch the Via dell'Amore reopening."
    );
    assert_eq!(msg.stop_reason, Some(StopReason::EndTurn));
    match &msg.content[0] {
        ContentBlock::Thinking {
            thinking,
            signature,
        } => {
            assert_eq!(thinking, "The standup needs a pitch.");
            assert_eq!(signature, "EqQBCgIYAhIM");
        }
        other => panic!("expected thinking, got {other:?}"),
    }
    assert_eq!(msg.usage.input_tokens, 1200);
    assert_eq!(msg.usage.output_tokens, 42);
    assert_eq!(msg.usage.cache_read_input_tokens, Some(1024));
    assert_eq!(msg.usage.cache_creation_input_tokens, Some(0));
}

#[test]
fn tool_use_with_input_json_delta() {
    let (_, msg) = parse_sse_body(&fixture("tool_use.sse")).unwrap();
    assert_eq!(msg.stop_reason, Some(StopReason::ToolUse));
    let calls = msg.tool_uses();
    assert_eq!(calls.len(), 2);
    assert_eq!(calls[0].0, "toolu_01");
    assert_eq!(calls[0].1, "find_media");
    assert_eq!(calls[0].2, &json!({"village": "vernazza", "limit": 3}));
    // a tool with no input deltas keeps the empty object
    assert_eq!(calls[1].2, &json!({}));
}

#[test]
fn refusal_maps_to_error_with_details() {
    let (_, msg) = parse_sse_body(&fixture("refusal.sse")).unwrap();
    assert!(msg.is_refusal());
    let err = msg.check_refusal().unwrap_err();
    assert_eq!(
        err,
        ClaudeError::Refusal {
            category: Some("cyber".into()),
            explanation: Some("The request asks for working malware.".into()),
        }
    );
    assert!(!err.is_retryable());
}

#[test]
fn max_tokens_is_returned_to_caller() {
    let (_, msg) = parse_sse_body(&fixture("max_tokens.sse")).unwrap();
    assert_eq!(msg.stop_reason, Some(StopReason::MaxTokens));
    assert_eq!(msg.text(), "{\"title\": {\"en\": \"Last light on");
    assert!(msg.check_refusal().is_ok());
}

#[test]
fn error_event_becomes_retryable_stream_error() {
    let err = parse_sse_body(&fixture("error.sse")).unwrap_err();
    assert_eq!(
        err,
        ClaudeError::Stream {
            error_type: "overloaded_error".into(),
            message: "Overloaded".into()
        }
    );
    assert!(err.is_retryable());
}

/// Server-side fallback: the serving model differs from the requested one.
/// The `model_fallback` block shape is illustrative: the point is that block
/// and event types this crate doesn't know are preserved, not dropped.
#[test]
fn fallback_model_and_unknown_blocks_are_preserved() {
    let (events, msg) = parse_sse_body(&fixture("fallback.sse")).unwrap();
    assert!(msg.served_by_fallback("claude-opus-5-5"));
    assert_eq!(msg.model, "claude-sonnet-5-5");
    match &msg.content[0] {
        ContentBlock::Unknown(v) => assert_eq!(v["type"], "model_fallback"),
        other => panic!("expected unknown block, got {other:?}"),
    }
    assert!(events.iter().any(|e| matches!(e, StreamEvent::Unknown(_))));
    // unknown blocks round-trip unchanged
    let echoed = serde_json::to_value(&msg.content[0]).unwrap();
    assert_eq!(echoed["from"], "claude-opus-5-5");
    assert_eq!(msg.text(), "Served by the fallback.");
}

#[test]
fn parser_handles_arbitrary_chunk_boundaries_and_crlf() {
    let body = fixture("tool_use.sse");
    let crlf: Vec<u8> = String::from_utf8(body.clone())
        .unwrap()
        .replace('\n', "\r\n")
        .into_bytes();
    let whole = parse_sse_body(&body).unwrap().1;
    for input in [&body, &crlf] {
        for chunk in [1usize, 3, 7, 64] {
            let mut p = SseParser::new();
            let mut frames = Vec::new();
            for c in input.chunks(chunk) {
                frames.extend(p.push(c));
            }
            frames.extend(p.finish());
            let mut acc = claude::StreamAccumulator::new();
            for f in &frames {
                acc.apply(&claude::sse::parse_event(f).unwrap()).unwrap();
            }
            assert_eq!(acc.finish().unwrap(), whole, "chunk size {chunk}");
        }
    }
}

#[test]
fn multibyte_utf8_split_across_chunks() {
    let body = "event: x\ndata: {\"type\":\"ping\",\"s\":\"caffè ☕\"}\n\n".as_bytes();
    let mut p = SseParser::new();
    let mut frames = Vec::new();
    for c in body.chunks(1) {
        frames.extend(p.push(c));
    }
    assert_eq!(frames.len(), 1);
    assert!(frames[0].data.contains("caffè ☕"));
    assert_eq!(frames[0].event.as_deref(), Some("x"));
}

#[test]
fn truncated_stream_is_an_error() {
    let body = fixture("text.sse");
    let s = String::from_utf8(body).unwrap();
    let cut = s.find("event: message_stop").unwrap();
    let err = parse_sse_body(&s.as_bytes()[..cut]).unwrap_err();
    assert!(matches!(err, ClaudeError::Transport(_)));
}
