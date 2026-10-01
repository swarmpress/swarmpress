//! HttpClaude against a wiremock server: retries, headers, streaming.

use std::time::{Duration, Instant};

use claude::{
    models, ClaudeApi, ClaudeError, Effort, HttpClaude, HttpConfig, MessagesRequest, RetryPolicy,
    StreamEvent,
};
use serde_json::json;
use wiremock::matchers::{body_partial_json, header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn ok_body() -> serde_json::Value {
    json!({
        "id": "msg_ok", "type": "message", "role": "assistant", "model": "claude-opus-5-5",
        "content": [{"type": "text", "text": "ciao"}],
        "stop_reason": "end_turn", "stop_sequence": null,
        "usage": {"input_tokens": 10, "output_tokens": 2}
    })
}

fn client(server: &MockServer, max_retries: u32) -> HttpClaude {
    let mut cfg = HttpConfig::new("sk-test");
    cfg.base_url = server.uri();
    cfg.retry = RetryPolicy {
        max_retries,
        base_delay: Duration::from_millis(10),
        max_delay: Duration::from_millis(50),
        max_retry_after: Duration::from_secs(5),
    };
    HttpClaude::new(cfg).unwrap()
}

fn req() -> MessagesRequest {
    MessagesRequest::new(models::OPUS, 100, Effort::Medium).with_user("hi")
}

#[tokio::test]
async fn retries_429_honoring_retry_after_then_succeeds() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/messages"))
        .respond_with(
            ResponseTemplate::new(429)
                .insert_header("retry-after", "1")
                .set_body_json(json!({"type":"error","error":{"type":"rate_limit_error","message":"slow down"}})),
        )
        .up_to_n_times(1)
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/v1/messages"))
        .and(header("x-api-key", "sk-test"))
        .and(header("anthropic-version", "2023-06-01"))
        .and(header("anthropic-beta", "server-side-fallback-2026-07-01"))
        .and(body_partial_json(
            json!({"fallbacks": "default", "output_config": {"effort": "medium"}}),
        ))
        .respond_with(ResponseTemplate::new(200).set_body_json(ok_body()))
        .expect(1)
        .mount(&server)
        .await;

    let started = Instant::now();
    let resp = client(&server, 3).create(&req()).await.unwrap();
    assert!(
        started.elapsed() >= Duration::from_secs(1),
        "retry-after not honored"
    );
    assert_eq!(resp.text(), "ciao");
}

#[tokio::test]
async fn retries_529_overloaded_and_5xx() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(529).set_body_json(
            json!({"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}),
        ))
        .up_to_n_times(1)
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(503).set_body_string("upstream"))
        .up_to_n_times(1)
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(200).set_body_json(ok_body()))
        .mount(&server)
        .await;
    let resp = client(&server, 3).create(&req()).await.unwrap();
    assert_eq!(resp.id, "msg_ok");
    assert_eq!(server.received_requests().await.unwrap().len(), 3);
}

#[tokio::test]
async fn gives_up_after_max_retries() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(529).set_body_json(
            json!({"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}),
        ))
        .mount(&server)
        .await;
    let err = client(&server, 2).create(&req()).await.unwrap_err();
    assert!(matches!(err, ClaudeError::Http { status: 529, .. }));
    assert_eq!(server.received_requests().await.unwrap().len(), 3);
}

#[tokio::test]
async fn does_not_retry_400() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(400).set_body_json(
            json!({"type":"error","error":{"type":"invalid_request_error","message":"bad"}}),
        ))
        .mount(&server)
        .await;
    let err = client(&server, 3).create(&req()).await.unwrap_err();
    match err {
        ClaudeError::Http {
            status, error_type, ..
        } => {
            assert_eq!(status, 400);
            assert_eq!(error_type, "invalid_request_error");
        }
        other => panic!("{other:?}"),
    }
    assert_eq!(server.received_requests().await.unwrap().len(), 1);
}

#[tokio::test]
async fn streams_sse_and_surfaces_deltas() {
    let server = MockServer::start().await;
    let body = std::fs::read_to_string(format!(
        "{}/tests/fixtures/sse/text.sse",
        env!("CARGO_MANIFEST_DIR")
    ))
    .unwrap();
    Mock::given(method("POST"))
        .and(body_partial_json(json!({"stream": true})))
        .respond_with(ResponseTemplate::new(200).set_body_raw(body, "text/event-stream"))
        .mount(&server)
        .await;
    let mut deltas = Vec::new();
    let mut sink = |e: &StreamEvent| {
        if let Some(t) = e.text_delta() {
            deltas.push(t.to_owned());
        }
    };
    let msg = client(&server, 0).stream(&req(), &mut sink).await.unwrap();
    assert_eq!(deltas.concat(), msg.text());
    assert_eq!(msg.usage.output_tokens, 42);
}

#[test]
fn backoff_delay_is_bounded_and_honors_retry_after() {
    let p = RetryPolicy {
        max_retries: 5,
        base_delay: Duration::from_millis(100),
        max_delay: Duration::from_millis(1000),
        max_retry_after: Duration::from_secs(10),
    };
    for attempt in 0..10 {
        let d = p.delay(attempt, None);
        assert!(d <= Duration::from_millis(1000));
    }
    let d = p.delay(0, Some(Duration::from_secs(3)));
    assert!(d >= Duration::from_secs(3) && d <= Duration::from_millis(3300));
    let capped = p.delay(0, Some(Duration::from_secs(600)));
    assert!(capped <= Duration::from_secs(11));
}
