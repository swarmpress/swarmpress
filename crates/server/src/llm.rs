//! Hosted inference (ADR-0067): `POST /api/llm/generate` runs one model turn
//! on GPT-6-Luna through the OpenAI Responses API.
//!
//! - Signed-in players with their company's current lease only (paid spend is
//!   fenced, ADR-0045); the lease lock is released before the provider call,
//!   so a long generation never blocks the gateway.
//! - The key stays here (`OPENAI_API_KEY`); without it the route answers 503.
//! - Every call is a row in `llm_jobs` (written before the call, finished
//!   after it) with its tokens and cost; a company that has spent its daily
//!   budget (`LUNA_DAILY_BUDGET_USD`, per UTC day) gets 429.
//! - `service_tier`: `flex` (default) for queued work, `default` (Standard)
//!   where the player waits. A Flex call the provider refuses as busy is
//!   retried with backoff, then fails; it is never promoted silently.
//! - `json_schema` asks for JSON-schema output (not strict: the client's
//!   repair loop and the Rust checks still run, CLAUDE.md rule 3).
//!
//! The answer is untrusted text: the browser validates it, and only the
//! orchestrator turns it into commands.

use std::time::Duration;

use axum::extract::State;
use axum::http::HeaderMap;
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::app::AppState;
use crate::auth::CurrentUser;
use crate::companies::require_lease;
use crate::config::{LlmConfig, TokenPrices};
use crate::error::{AppError, AppResult};

const DAY_MS: i64 = 86_400_000;
/// The model's own output limit (128,000 tokens for GPT-6-Luna).
const MAX_OUTPUT_TOKENS: u32 = 128_000;
const DEFAULT_OUTPUT_TOKENS: u32 = 4096;
const EFFORTS: [&str; 6] = ["none", "low", "medium", "high", "xhigh", "max"];

#[derive(Debug, Deserialize)]
pub struct Message {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Deserialize)]
pub struct GenerateRequest {
    pub messages: Vec<Message>,
    /// What the call is for (job records and budgets per workload).
    #[serde(default)]
    pub kind: Option<String>,
    /// Answer and reasoning tokens together (the provider counts both).
    #[serde(default)]
    pub max_output_tokens: Option<u32>,
    /// `none` … `max`; default `none`.
    #[serde(default)]
    pub reasoning_effort: Option<String>,
    /// `flex` (default) or `default` (Standard).
    #[serde(default)]
    pub service_tier: Option<String>,
    /// A JSON schema the answer should follow.
    #[serde(default)]
    pub json_schema: Option<Value>,
}

/// Start of the UTC day of `now_ms`.
pub fn day_start(now_ms: i64) -> i64 {
    now_ms - now_ms.rem_euclid(DAY_MS)
}

/// Cost of one answer in millionths of a dollar.
pub fn cost_micros(p: TokenPrices, input: i64, cached: i64, output: i64) -> i64 {
    let cached = cached.clamp(0, input.max(0));
    let fresh = input.max(0) - cached;
    // Prices are per million tokens; round up so the budget never undercounts.
    let total = fresh * p.input + cached * p.cached_input + output.max(0) * p.output;
    (total + 999_999) / 1_000_000
}

fn prices_for(cfg: &LlmConfig, tier: &str) -> TokenPrices {
    match tier {
        "flex" | "batch" => cfg.prices.flex,
        _ => cfg.prices.standard,
    }
}

/// The Responses API request body.
pub fn request_body(
    cfg: &LlmConfig,
    req: &GenerateRequest,
    effort: &str,
    tier: &str,
    max_output: u32,
) -> Value {
    let input: Vec<Value> = req
        .messages
        .iter()
        .map(|m| json!({ "role": m.role, "content": m.content }))
        .collect();
    let mut body = json!({
        "model": cfg.model,
        "input": input,
        "max_output_tokens": max_output,
        "reasoning": { "effort": effort },
        "service_tier": tier,
        "store": false,
    });
    if let Some(schema) = &req.json_schema {
        body["text"] = json!({
            "format": { "type": "json_schema", "name": "answer", "schema": schema, "strict": false }
        });
    }
    body
}

/// What the browser needs from a Responses API answer.
#[derive(Debug, PartialEq)]
pub struct Answer {
    pub text: String,
    /// `stop`, or `length` when the output limit cut the answer.
    pub finish: &'static str,
    pub input_tokens: i64,
    pub cached_tokens: i64,
    pub output_tokens: i64,
    pub reasoning_tokens: i64,
    pub tier: String,
    pub response_id: Option<String>,
}

pub fn parse_answer(v: &Value, requested_tier: &str) -> Result<Answer, String> {
    let status = v["status"].as_str().unwrap_or("");
    let finish = match status {
        "completed" => "stop",
        "incomplete" if v["incomplete_details"]["reason"] == "max_output_tokens" => "length",
        "incomplete" => {
            return Err(format!(
                "the answer is incomplete: {}",
                v["incomplete_details"]["reason"]
                    .as_str()
                    .unwrap_or("no reason given")
            ))
        }
        other => return Err(format!("unexpected response status {other:?}")),
    };
    let mut text = String::new();
    for item in v["output"].as_array().into_iter().flatten() {
        if item["type"] != "message" {
            continue;
        }
        for part in item["content"].as_array().into_iter().flatten() {
            match part["type"].as_str() {
                Some("output_text") => text.push_str(part["text"].as_str().unwrap_or("")),
                Some("refusal") => {
                    return Err(format!(
                        "the model refused: {}",
                        part["refusal"].as_str().unwrap_or("")
                    ))
                }
                _ => {}
            }
        }
    }
    let u = &v["usage"];
    Ok(Answer {
        text,
        finish,
        input_tokens: u["input_tokens"].as_i64().unwrap_or(0),
        cached_tokens: u["input_tokens_details"]["cached_tokens"]
            .as_i64()
            .unwrap_or(0),
        output_tokens: u["output_tokens"].as_i64().unwrap_or(0),
        reasoning_tokens: u["output_tokens_details"]["reasoning_tokens"]
            .as_i64()
            .unwrap_or(0),
        tier: v["service_tier"]
            .as_str()
            .unwrap_or(requested_tier)
            .to_string(),
        response_id: v["id"].as_str().map(String::from),
    })
}

/// `POST /api/llm/generate`
pub async fn generate(
    State(st): State<AppState>,
    CurrentUser(user): CurrentUser,
    headers: HeaderMap,
    Json(req): Json<GenerateRequest>,
) -> AppResult<Json<Value>> {
    // The lease fences the spend; its lock is not held across the provider call.
    let company = require_lease(&st, &headers, &user).await?.company;
    let cfg = st.cfg.llm.clone();
    let key = cfg.api_key.clone().ok_or_else(|| {
        AppError::Unavailable(
            "no model provider is configured on the server (OPENAI_API_KEY)".into(),
        )
    })?;

    if req.messages.is_empty() {
        return Err(AppError::BadRequest("messages must not be empty".into()));
    }
    if let Some(m) = req.messages.iter().find(|m| {
        !matches!(
            m.role.as_str(),
            "system" | "developer" | "user" | "assistant"
        )
    }) {
        return Err(AppError::BadRequest(format!(
            "unknown message role {:?}",
            m.role
        )));
    }
    let effort = req
        .reasoning_effort
        .clone()
        .unwrap_or_else(|| "none".into());
    if !EFFORTS.contains(&effort.as_str()) {
        return Err(AppError::BadRequest(format!(
            "reasoning_effort must be one of {}",
            EFFORTS.join(", ")
        )));
    }
    let tier = req.service_tier.clone().unwrap_or_else(|| "flex".into());
    if !matches!(tier.as_str(), "flex" | "default") {
        return Err(AppError::BadRequest(
            "service_tier must be flex or default".into(),
        ));
    }
    let max_output = req.max_output_tokens.unwrap_or(DEFAULT_OUTPUT_TOKENS);
    if max_output == 0 || max_output > MAX_OUTPUT_TOKENS {
        return Err(AppError::BadRequest(format!(
            "max_output_tokens must be 1 to {MAX_OUTPUT_TOKENS}"
        )));
    }
    let kind: String = req
        .kind
        .clone()
        .unwrap_or_else(|| "generate".into())
        .chars()
        .take(40)
        .collect();

    let now = st.now_ms();
    let spent: i64 = sqlx::query_scalar("SELECT COALESCE(SUM(cost_micros), 0) FROM llm_jobs WHERE company_id = ?1 AND created_at >= ?2")
        .bind(&company.id)
        .bind(day_start(now))
        .fetch_one(&st.db.writer)
        .await?;
    if spent >= cfg.daily_budget_micros {
        return Err(AppError::TooManyRequests(format!(
            "the company's daily model budget (${}.{:02}) is used up; it resets at 00:00 UTC",
            cfg.daily_budget_micros / 1_000_000,
            (cfg.daily_budget_micros % 1_000_000) / 10_000
        )));
    }

    let job_id = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO llm_jobs (id, company_id, user_id, kind, model, tier_requested, reasoning_effort, status, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'pending', ?8)",
    )
    .bind(&job_id)
    .bind(&company.id)
    .bind(&user.id)
    .bind(&kind)
    .bind(&cfg.model)
    .bind(&tier)
    .bind(&effort)
    .bind(now)
    .execute(&st.db.writer)
    .await?;

    let body = request_body(&cfg, &req, &effort, &tier, max_output);
    let (result, attempts) = call_provider(&st.http, &cfg, &key, &body, &tier).await;
    let finished = st.now_ms();
    match result {
        Ok(raw) => match parse_answer(&raw, &tier) {
            Ok(a) => {
                let cost = cost_micros(
                    prices_for(&cfg, &a.tier),
                    a.input_tokens,
                    a.cached_tokens,
                    a.output_tokens,
                );
                sqlx::query(
                    "UPDATE llm_jobs SET status = ?2, tier_returned = ?3, input_tokens = ?4, cached_tokens = ?5,
                     output_tokens = ?6, reasoning_tokens = ?7, cost_micros = ?8, attempts = ?9, response_id = ?10,
                     finished_at = ?11 WHERE id = ?1",
                )
                .bind(&job_id)
                .bind(if a.finish == "stop" { "ok" } else { "incomplete" })
                .bind(&a.tier)
                .bind(a.input_tokens)
                .bind(a.cached_tokens)
                .bind(a.output_tokens)
                .bind(a.reasoning_tokens)
                .bind(cost)
                .bind(attempts)
                .bind(&a.response_id)
                .bind(finished)
                .execute(&st.db.writer)
                .await?;
                tracing::info!(company = %company.id, job = %job_id, %kind, tier = %a.tier, input = a.input_tokens,
                    output = a.output_tokens, cost_micros = cost, "llm generate");
                Ok(Json(json!({
                    "job_id": job_id,
                    "text": a.text,
                    "finish": a.finish,
                    "model": cfg.model,
                    "service_tier": a.tier,
                    "usage": {
                        "input_tokens": a.input_tokens,
                        "cached_input_tokens": a.cached_tokens,
                        "output_tokens": a.output_tokens,
                        "reasoning_tokens": a.reasoning_tokens,
                    },
                    "cost_micros": cost,
                    "duration_ms": finished - now,
                })))
            }
            Err(msg) => {
                fail_job(&st, &job_id, attempts, &msg, finished).await?;
                Err(AppError::BadGateway(msg))
            }
        },
        Err(e) => {
            fail_job(&st, &job_id, attempts, &e.to_string(), finished).await?;
            Err(e)
        }
    }
}

async fn fail_job(
    st: &AppState,
    job_id: &str,
    attempts: i64,
    msg: &str,
    now: i64,
) -> AppResult<()> {
    sqlx::query("UPDATE llm_jobs SET status = 'failed', error = ?2, attempts = ?3, finished_at = ?4 WHERE id = ?1")
        .bind(job_id)
        .bind(msg.chars().take(500).collect::<String>())
        .bind(attempts)
        .bind(now)
        .execute(&st.db.writer)
        .await?;
    Ok(())
}

/// One Responses API call; a Flex call refused as busy (429, 503) is retried
/// with backoff up to `flex_retries` times. Returns the JSON and the attempts made.
async fn call_provider(
    http: &reqwest::Client,
    cfg: &LlmConfig,
    key: &str,
    body: &Value,
    tier: &str,
) -> (AppResult<Value>, i64) {
    let url = format!("{}/v1/responses", cfg.api_base.trim_end_matches('/'));
    let mut attempt: i64 = 0;
    loop {
        attempt += 1;
        let res = http
            .post(&url)
            .bearer_auth(key)
            .timeout(cfg.timeout)
            .json(body)
            .send()
            .await;
        let res = match res {
            Ok(r) => r,
            Err(e) if e.is_timeout() => {
                return (
                    Err(AppError::GatewayTimeout(
                        "the model did not answer in time".into(),
                    )),
                    attempt,
                )
            }
            Err(e) => {
                return (
                    Err(AppError::BadGateway(format!(
                        "model provider unreachable: {e}"
                    ))),
                    attempt,
                )
            }
        };
        let status = res.status();
        if status.is_success() {
            return match res.json::<Value>().await {
                Ok(v) => (Ok(v), attempt),
                Err(e) => (
                    Err(AppError::BadGateway(format!(
                        "unreadable model answer: {e}"
                    ))),
                    attempt,
                ),
            };
        }
        let text = res.text().await.unwrap_or_default();
        let parsed = serde_json::from_str::<Value>(&text).ok();
        let detail = parsed
            .as_ref()
            .and_then(|v| v["error"]["message"].as_str().map(String::from))
            .unwrap_or_else(|| text.chars().take(300).collect());
        // The provider also answers 429 when the account has no credits; that is not "busy".
        let code = parsed
            .as_ref()
            .map(|v| {
                format!(
                    "{} {}",
                    v["error"]["code"].as_str().unwrap_or(""),
                    v["error"]["type"].as_str().unwrap_or("")
                )
            })
            .unwrap_or_default();
        if code.contains("insufficient_quota") || code.contains("credit_balance") {
            return (
                Err(AppError::Unavailable(format!(
                    "the model provider account has no credits: {detail}"
                ))),
                attempt,
            );
        }
        let busy = status.as_u16() == 429 || status.as_u16() == 503;
        if busy && tier == "flex" && attempt <= i64::from(cfg.flex_retries) {
            tokio::time::sleep(Duration::from_millis(500 * (1 << (attempt - 1).min(5)))).await;
            continue;
        }
        let err = if busy {
            AppError::Unavailable(format!("the model provider is busy ({status}): {detail}"))
        } else {
            AppError::BadGateway(format!("model provider {status}: {detail}"))
        };
        return (Err(err), attempt);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::LlmConfig;

    #[test]
    fn day_start_is_utc_midnight() {
        assert_eq!(day_start(0), 0);
        assert_eq!(day_start(DAY_MS + 5), DAY_MS);
        assert_eq!(day_start(3 * DAY_MS - 1), 2 * DAY_MS);
    }

    #[test]
    fn cost_counts_cached_input_at_the_cached_price_and_rounds_up() {
        let p = LlmConfig::default().prices;
        // 100k input of which 40k cached, 20k output on Standard:
        // 60k × $0.10 + 40k × $0.01 + 20k × $0.50 per million = $0.0164.
        assert_eq!(cost_micros(p.standard, 100_000, 40_000, 20_000), 16_400);
        // Flex is half.
        assert_eq!(cost_micros(p.flex, 100_000, 40_000, 20_000), 8_200);
        assert_eq!(cost_micros(p.standard, 1, 0, 0), 1);
        assert_eq!(cost_micros(p.standard, 0, 0, 0), 0);
    }

    #[test]
    fn the_request_carries_effort_tier_schema_and_no_storage() {
        let cfg = LlmConfig::default();
        let req = GenerateRequest {
            messages: vec![Message {
                role: "user".into(),
                content: "hi".into(),
            }],
            kind: None,
            max_output_tokens: None,
            reasoning_effort: None,
            service_tier: None,
            json_schema: Some(json!({ "type": "object" })),
        };
        let b = request_body(&cfg, &req, "medium", "flex", 900);
        assert_eq!(b["model"], "gpt-6-luna");
        assert_eq!(b["reasoning"]["effort"], "medium");
        assert_eq!(b["service_tier"], "flex");
        assert_eq!(b["store"], false);
        assert_eq!(b["max_output_tokens"], 900);
        assert_eq!(b["text"]["format"]["type"], "json_schema");
        assert_eq!(b["input"][0]["content"], "hi");
    }

    #[test]
    fn answers_are_read_from_message_output_and_usage() {
        let v = json!({
            "id": "resp_1", "status": "completed", "service_tier": "flex",
            "output": [
                { "type": "reasoning", "summary": [] },
                { "type": "message", "content": [ { "type": "output_text", "text": "Hello" }, { "type": "output_text", "text": " there" } ] }
            ],
            "usage": { "input_tokens": 50, "input_tokens_details": { "cached_tokens": 10 },
                       "output_tokens": 30, "output_tokens_details": { "reasoning_tokens": 20 } }
        });
        let a = parse_answer(&v, "flex").unwrap();
        assert_eq!(a.text, "Hello there");
        assert_eq!(a.finish, "stop");
        assert_eq!(
            (
                a.input_tokens,
                a.cached_tokens,
                a.output_tokens,
                a.reasoning_tokens
            ),
            (50, 10, 30, 20)
        );
        assert_eq!(a.response_id.as_deref(), Some("resp_1"));

        let cut = json!({ "status": "incomplete", "incomplete_details": { "reason": "max_output_tokens" }, "output": [], "usage": {} });
        assert_eq!(parse_answer(&cut, "default").unwrap().finish, "length");
        let filtered = json!({ "status": "incomplete", "incomplete_details": { "reason": "content_filter" }, "output": [] });
        assert!(parse_answer(&filtered, "default").is_err());
        let refused = json!({ "status": "completed", "output": [ { "type": "message", "content": [ { "type": "refusal", "refusal": "no" } ] } ] });
        assert!(parse_answer(&refused, "default")
            .unwrap_err()
            .contains("refused"));
    }
}
