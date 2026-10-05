//! `POST /api/llm/generate` (ADR-0067) against a fake Responses API (wiremock):
//! sign-in and lease, no key, the answer and its job record, the daily budget,
//! Flex retries. No call leaves the machine.

mod common;

use common::{Opts, TestServer, LEASE};
use reqwest::Method;
use serde_json::{json, Value};
use wiremock::matchers::{body_partial_json, header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn answer(text: &str, input: i64, output: i64) -> Value {
    json!({
        "id": "resp_test", "status": "completed", "service_tier": "flex",
        "output": [
            { "type": "reasoning", "summary": [] },
            { "type": "message", "content": [ { "type": "output_text", "text": text } ] }
        ],
        "usage": { "input_tokens": input, "input_tokens_details": { "cached_tokens": 0 },
                   "output_tokens": output, "output_tokens_details": { "reasoning_tokens": 0 } }
    })
}

async fn server(provider: &MockServer, budget_micros: i64) -> TestServer {
    let base = provider.uri();
    TestServer::start_with(Opts {
        tweak: Box::new(move |c| {
            c.llm.api_key = Some("test-key".into());
            c.llm.api_base = base.clone();
            c.llm.daily_budget_micros = budget_micros;
        }),
    })
    .await
}

fn body() -> Value {
    json!({ "kind": "draft", "messages": [ { "role": "system", "content": "be brief" }, { "role": "user", "content": "hi" } ],
            "reasoning_effort": "low", "max_output_tokens": 500 })
}

async fn generate(s: &TestServer, cookie: &str, lease: Option<&str>, b: Value) -> (u16, Value) {
    let headers: Vec<(&str, &str)> = lease.map(|l| vec![(LEASE, l)]).unwrap_or_default();
    s.send_json(
        Method::POST,
        "/api/llm/generate",
        Some(cookie),
        &headers,
        Some(b),
    )
    .await
}

#[tokio::test]
async fn needs_a_session_the_lease_and_a_configured_key() {
    let s = TestServer::start().await;
    assert_eq!(s.post_json("/api/llm/generate", None, body()).await.0, 401);
    let p = s.gateway_player(1).await;
    assert_eq!(generate(&s, &p.cookie, None, body()).await.0, 428);
    assert_eq!(
        generate(&s, &p.cookie, Some("1.not-the-lease"), body())
            .await
            .0,
        409
    );
    // The default config has no key: the route says so instead of faking an answer.
    let (st, b) = generate(&s, &p.cookie, Some(&p.lease), body()).await;
    assert_eq!(st, 503, "{b}");
    assert!(
        b["error"].as_str().unwrap().contains("OPENAI_API_KEY"),
        "{b}"
    );
}

#[tokio::test]
async fn answers_and_records_the_job_with_its_cost() {
    let provider = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/responses"))
        .and(header("authorization", "Bearer test-key"))
        .and(body_partial_json(json!({ "model": "gpt-6-luna", "store": false, "service_tier": "flex",
                                       "reasoning": { "effort": "low" }, "max_output_tokens": 500 })))
        .respond_with(ResponseTemplate::new(200).set_body_json(answer("Ciao!", 1000, 200)))
        .expect(1)
        .mount(&provider)
        .await;
    let s = server(&provider, 2_000_000).await;
    let p = s.gateway_player(1).await;
    let (st, b) = generate(&s, &p.cookie, Some(&p.lease), body()).await;
    assert_eq!(st, 200, "{b}");
    assert_eq!(b["text"], "Ciao!");
    assert_eq!(b["finish"], "stop");
    assert_eq!(b["usage"]["input_tokens"], 1000);
    // Flex: 1000 × $0.05 + 200 × $0.25 per million = $0.0001 = 100 micros.
    assert_eq!(b["cost_micros"], 100);
    let (status, cost): (String, i64) =
        sqlx::query_as("SELECT status, cost_micros FROM llm_jobs WHERE id = ?1")
            .bind(b["job_id"].as_str().unwrap())
            .fetch_one(&s.st.db.reader)
            .await
            .unwrap();
    assert_eq!((status.as_str(), cost), ("ok", 100));
}

#[tokio::test]
async fn a_spent_daily_budget_refuses_further_calls() {
    let provider = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/responses"))
        .respond_with(ResponseTemplate::new(200).set_body_json(answer("one", 1000, 200)))
        .expect(1)
        .mount(&provider)
        .await;
    let s = server(&provider, 50).await;
    let p = s.gateway_player(1).await;
    assert_eq!(generate(&s, &p.cookie, Some(&p.lease), body()).await.0, 200);
    let (st, b) = generate(&s, &p.cookie, Some(&p.lease), body()).await;
    assert_eq!(st, 429, "{b}");
    assert!(
        b["error"].as_str().unwrap().contains("daily model budget"),
        "{b}"
    );
}

#[tokio::test]
async fn a_busy_flex_call_is_retried_and_a_cut_answer_says_length() {
    let provider = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/responses"))
        .respond_with(
            ResponseTemplate::new(429)
                .set_body_json(json!({ "error": { "message": "resource unavailable" } })),
        )
        .up_to_n_times(1)
        .mount(&provider)
        .await;
    let mut cut = answer("{\"title\": \"Vern", 300, 500);
    cut["status"] = json!("incomplete");
    cut["incomplete_details"] = json!({ "reason": "max_output_tokens" });
    Mock::given(method("POST"))
        .and(path("/v1/responses"))
        .and(body_partial_json(
            json!({ "text": { "format": { "type": "json_schema" } } }),
        ))
        .respond_with(ResponseTemplate::new(200).set_body_json(cut))
        .mount(&provider)
        .await;
    let s = server(&provider, 2_000_000).await;
    let p = s.gateway_player(1).await;
    let mut b = body();
    b["json_schema"] = json!({ "type": "object", "properties": { "title": { "type": "string" } } });
    let (st, out) = generate(&s, &p.cookie, Some(&p.lease), b).await;
    assert_eq!(st, 200, "{out}");
    assert_eq!(out["finish"], "length");
    let attempts: i64 = sqlx::query_scalar("SELECT attempts FROM llm_jobs WHERE id = ?1")
        .bind(out["job_id"].as_str().unwrap())
        .fetch_one(&s.st.db.reader)
        .await
        .unwrap();
    assert_eq!(attempts, 2);
}

#[tokio::test]
async fn an_account_without_credits_is_not_retried_as_busy() {
    let provider = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/responses"))
        .respond_with(ResponseTemplate::new(429).set_body_json(json!({ "error": {
            "message": "You have no credits remaining.", "type": "insufficient_quota", "code": "credit_balance_exhausted" } })))
        .expect(1)
        .mount(&provider)
        .await;
    let s = server(&provider, 2_000_000).await;
    let p = s.gateway_player(1).await;
    let (st, b) = generate(&s, &p.cookie, Some(&p.lease), body()).await;
    assert_eq!(st, 503, "{b}");
    assert!(b["error"].as_str().unwrap().contains("no credits"), "{b}");
}

#[tokio::test]
async fn bad_requests_and_provider_errors_are_reported() {
    let provider = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/responses"))
        .respond_with(
            ResponseTemplate::new(400)
                .set_body_json(json!({ "error": { "message": "invalid schema" } })),
        )
        .mount(&provider)
        .await;
    let s = server(&provider, 2_000_000).await;
    let p = s.gateway_player(1).await;
    for bad in [
        json!({ "messages": [] }),
        json!({ "messages": [ { "role": "robot", "content": "x" } ] }),
        json!({ "messages": [ { "role": "user", "content": "x" } ], "reasoning_effort": "extreme" }),
        json!({ "messages": [ { "role": "user", "content": "x" } ], "service_tier": "priority" }),
        json!({ "messages": [ { "role": "user", "content": "x" } ], "max_output_tokens": 0 }),
    ] {
        assert_eq!(
            generate(&s, &p.cookie, Some(&p.lease), bad.clone()).await.0,
            400,
            "{bad}"
        );
    }
    let (st, b) = generate(&s, &p.cookie, Some(&p.lease), body()).await;
    assert_eq!(st, 502, "{b}");
    assert!(
        b["error"].as_str().unwrap().contains("invalid schema"),
        "{b}"
    );
    let failed: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM llm_jobs WHERE status = 'failed'")
        .fetch_one(&s.st.db.reader)
        .await
        .unwrap();
    assert_eq!(failed, 1);
}
