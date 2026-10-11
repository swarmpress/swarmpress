//! Forms and comments of a WordPress site's static export (ADR-0083 §3): no WordPress is public, so
//! a comment form or a form a plugin renders posts to the platform instead, and each submission
//! becomes a `FormSubmitted` event in the company's inbox, for the staff and the CEO to act on.
//!
//! `POST /f/{company}?to=<the WordPress endpoint it was meant for>`: no sign-in (it is the public
//! site), `application/x-www-form-urlencoded`, at most 64 KiB, each value cut to 4,000 characters,
//! at most 60 fields; per client address and company 10 a minute (429). The answer is a 303 back to
//! the page the form was on when it is the company's site, else to the site's home. Submitted text is
//! untrusted data, never instructions.

use std::net::{IpAddr, SocketAddr};
use std::time::Instant;

use axum::body::Bytes;
use axum::extract::{ConnectInfo, Path, Query, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use serde::Deserialize;
use serde_json::{json, Map, Value};

use crate::app::AppState;
use crate::db::events as event_store;
use crate::error::{AppError, AppResult};
use crate::events;

pub const MAX_FORM_BYTES: usize = 64 * 1024;
const MAX_VALUE_CHARS: usize = 4_000;
const MAX_FIELDS: usize = 60;

#[derive(Deserialize)]
pub struct FormQuery {
    #[serde(default)]
    to: String,
}

pub async fn submit(
    State(st): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    Path(company): Path<String>,
    Query(q): Query<FormQuery>,
    headers: HeaderMap,
    body: Bytes,
) -> AppResult<Response> {
    if company.is_empty()
        || !company
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-')
    {
        return Err(AppError::NotFound("no such site".into()));
    }
    let ip: IpAddr = crate::tracker::client_ip(&headers, peer, st.tracker.cfg.trust_forwarded_for);
    if !st
        .forms_limiter
        .allow((ip, company.clone()), Instant::now())
    {
        return Err(AppError::TooManyRequests("too many submissions".into()));
    }
    if body.len() > MAX_FORM_BYTES {
        return Err(AppError::PayloadTooLarge("the form is too large".into()));
    }
    let ct = headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if !ct.starts_with("application/x-www-form-urlencoded") {
        return Err(AppError::UnsupportedMediaType(
            "forms are application/x-www-form-urlencoded".into(),
        ));
    }
    let mut fields = Map::new();
    for (k, v) in url::form_urlencoded::parse(&body).take(MAX_FIELDS) {
        let v: String = v.chars().take(MAX_VALUE_CHARS).collect();
        fields.insert(k.chars().take(100).collect(), Value::String(v));
    }
    let site = format!("/sites/{company}/");
    let referer = headers
        .get(header::REFERER)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let back = url::Url::parse(referer)
        .ok()
        .filter(|u| u.path().starts_with(&site))
        .map(|u| u.path().to_string())
        .unwrap_or(site);
    let to: String = q.to.chars().take(200).collect();
    // Only a company that exists gets events.
    if crate::db::accounts::company_by_id(&st.db, &company)
        .await?
        .is_none()
    {
        return Err(AppError::NotFound("no such site".into()));
    }
    let ev = event_store::insert_event(
        &st.db,
        &company,
        events::kinds::FORM_SUBMITTED,
        &json!({ "to": to, "page": back, "fields": fields }),
        st.now_ms(),
    )
    .await?;
    events::announce(&st, ev);
    Ok((StatusCode::SEE_OTHER, [(header::LOCATION, back)]).into_response())
}
