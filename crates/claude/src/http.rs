//! `HttpClaude`: the real client over reqwest + rustls.

use std::time::Duration;

use async_trait::async_trait;
use futures_util::StreamExt;
use serde_json::Value;

use crate::api::{ClaudeApi, EventSink};
use crate::error::{ClaudeError, Result};
use crate::sse::{parse_event, SseParser, StreamAccumulator};
use crate::types::{MessagesRequest, MessagesResponse};

pub const DEFAULT_BASE_URL: &str = "https://api.anthropic.com";
pub const ANTHROPIC_VERSION: &str = "2023-06-01";
/// Beta header enabling server-side model fallback.
pub const FALLBACK_BETA: &str = "server-side-fallback-2026-07-01";

#[derive(Debug, Clone)]
pub struct RetryPolicy {
    /// Retries after the first attempt.
    pub max_retries: u32,
    pub base_delay: Duration,
    pub max_delay: Duration,
    /// Upper bound on how long a `retry-after` header can make us wait.
    pub max_retry_after: Duration,
}

impl Default for RetryPolicy {
    fn default() -> Self {
        Self {
            max_retries: 4,
            base_delay: Duration::from_millis(500),
            max_delay: Duration::from_secs(30),
            max_retry_after: Duration::from_secs(120),
        }
    }
}

impl RetryPolicy {
    /// Delay before retry number `attempt` (0-based). A server-provided
    /// `retry-after` is honored (never undercut), plus up to 10% jitter;
    /// otherwise exponential backoff with jitter in `[d/2, d]`.
    pub fn delay(&self, attempt: u32, retry_after: Option<Duration>) -> Duration {
        if let Some(ra) = retry_after {
            let ra = ra.min(self.max_retry_after);
            let ms = ra.as_millis() as u64;
            return Duration::from_millis(ms + fastrand::u64(0..=ms / 10));
        }
        let base = self.base_delay.as_millis() as u64;
        let cap = self.max_delay.as_millis() as u64;
        let exp = base.saturating_mul(1u64 << attempt.min(20)).min(cap);
        Duration::from_millis(fastrand::u64(exp / 2..=exp.max(1)))
    }
}

#[derive(Debug, Clone)]
pub struct HttpConfig {
    pub base_url: String,
    pub api_key: String,
    /// Send `anthropic-beta: server-side-fallback-…` and `fallbacks:"default"`.
    pub server_side_fallback: bool,
    pub retry: RetryPolicy,
    pub timeout: Duration,
}

impl HttpConfig {
    pub fn new(api_key: impl Into<String>) -> Self {
        Self {
            base_url: DEFAULT_BASE_URL.into(),
            api_key: api_key.into(),
            server_side_fallback: true,
            retry: RetryPolicy::default(),
            timeout: Duration::from_secs(600),
        }
    }
}

/// A fully prepared HTTP request (exposed for snapshot tests).
#[derive(Debug, Clone, serde::Serialize)]
pub struct PreparedRequest {
    pub url: String,
    /// Header name/value pairs; the API key is redacted by
    /// [`PreparedRequest::redacted`].
    pub headers: Vec<(String, String)>,
    pub body: Value,
}

impl PreparedRequest {
    pub fn redacted(mut self) -> Self {
        for (k, v) in &mut self.headers {
            if k == "x-api-key" {
                *v = "<redacted>".into();
            }
        }
        self
    }
}

pub struct HttpClaude {
    http: reqwest::Client,
    config: HttpConfig,
}

impl HttpClaude {
    pub fn new(config: HttpConfig) -> Result<Self> {
        let http = reqwest::Client::builder()
            .timeout(config.timeout)
            .build()
            .map_err(|e| ClaudeError::Transport(e.to_string()))?;
        Ok(Self { http, config })
    }

    /// Reads `ANTHROPIC_API_KEY` (required) and `ANTHROPIC_BASE_URL` (optional).
    pub fn from_env() -> Result<Self> {
        let key = std::env::var("ANTHROPIC_API_KEY")
            .map_err(|_| ClaudeError::InvalidRequest("ANTHROPIC_API_KEY is not set".into()))?;
        let mut cfg = HttpConfig::new(key);
        if let Ok(url) = std::env::var("ANTHROPIC_BASE_URL") {
            cfg.base_url = url;
        }
        Self::new(cfg)
    }

    pub fn config(&self) -> &HttpConfig {
        &self.config
    }

    /// Builds URL, headers and JSON body exactly as they will be sent.
    pub fn prepare(&self, request: &MessagesRequest, stream: bool) -> Result<PreparedRequest> {
        request.validate().map_err(ClaudeError::InvalidRequest)?;
        let mut req = request.clone();
        req.stream = stream;
        let mut headers = vec![
            ("x-api-key".to_owned(), self.config.api_key.clone()),
            ("anthropic-version".to_owned(), ANTHROPIC_VERSION.to_owned()),
            ("content-type".to_owned(), "application/json".to_owned()),
        ];
        if self.config.server_side_fallback {
            if req.fallbacks.is_none() {
                req.fallbacks = Some("default".into());
            }
            headers.push(("anthropic-beta".to_owned(), FALLBACK_BETA.to_owned()));
        }
        if stream {
            headers.push(("accept".to_owned(), "text/event-stream".to_owned()));
        }
        let body = serde_json::to_value(&req).map_err(|e| ClaudeError::Decode(e.to_string()))?;
        Ok(PreparedRequest {
            url: format!("{}/v1/messages", self.config.base_url.trim_end_matches('/')),
            headers,
            body,
        })
    }

    /// Sends with retries; returns a response with a success status.
    async fn send(&self, prepared: &PreparedRequest) -> Result<reqwest::Response> {
        let policy = &self.config.retry;
        let mut attempt = 0u32;
        loop {
            let mut rb = self.http.post(&prepared.url).json(&prepared.body);
            for (k, v) in &prepared.headers {
                if k != "content-type" {
                    rb = rb.header(k, v);
                }
            }
            let err = match rb.send().await {
                Ok(resp) if resp.status().is_success() => return Ok(resp),
                Ok(resp) => error_from_response(resp).await,
                Err(e) => ClaudeError::Transport(e.to_string()),
            };
            if !err.is_retryable() || attempt >= policy.max_retries {
                return Err(err);
            }
            let retry_after = match &err {
                ClaudeError::Http { retry_after, .. } => *retry_after,
                _ => None,
            };
            tokio::time::sleep(policy.delay(attempt, retry_after)).await;
            attempt += 1;
        }
    }
}

fn parse_retry_after(headers: &reqwest::header::HeaderMap) -> Option<Duration> {
    if let Some(ms) = headers
        .get("retry-after-ms")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.trim().parse::<u64>().ok())
    {
        return Some(Duration::from_millis(ms));
    }
    headers
        .get("retry-after")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.trim().parse::<u64>().ok())
        .map(Duration::from_secs)
}

async fn error_from_response(resp: reqwest::Response) -> ClaudeError {
    let status = resp.status().as_u16();
    let retry_after = parse_retry_after(resp.headers());
    let text = resp.text().await.unwrap_or_default();
    let (error_type, message) = serde_json::from_str::<Value>(&text)
        .ok()
        .and_then(|v| {
            let e = v.get("error")?;
            Some((
                e.get("type")?.as_str()?.to_owned(),
                e.get("message")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_owned(),
            ))
        })
        .unwrap_or_else(|| ("unknown".to_owned(), text));
    ClaudeError::Http {
        status,
        error_type,
        message,
        retry_after,
    }
}

#[async_trait]
impl ClaudeApi for HttpClaude {
    async fn create(&self, request: &MessagesRequest) -> Result<MessagesResponse> {
        let prepared = self.prepare(request, false)?;
        let resp = self.send(&prepared).await?;
        let bytes = resp
            .bytes()
            .await
            .map_err(|e| ClaudeError::Transport(e.to_string()))?;
        serde_json::from_slice(&bytes)
            .map_err(|e| ClaudeError::Decode(format!("response body: {e}")))
    }

    async fn stream(
        &self,
        request: &MessagesRequest,
        on_event: EventSink<'_>,
    ) -> Result<MessagesResponse> {
        let prepared = self.prepare(request, true)?;
        let resp = self.send(&prepared).await?;
        let mut body = resp.bytes_stream();
        let mut parser = SseParser::new();
        let mut acc = StreamAccumulator::new();
        while let Some(chunk) = body.next().await {
            let chunk = chunk.map_err(|e| ClaudeError::Transport(e.to_string()))?;
            for frame in parser.push(&chunk) {
                let ev = parse_event(&frame)?;
                on_event(&ev);
                acc.apply(&ev)?;
            }
        }
        for frame in parser.finish() {
            let ev = parse_event(&frame)?;
            on_event(&ev);
            acc.apply(&ev)?;
        }
        acc.finish()
    }
}
