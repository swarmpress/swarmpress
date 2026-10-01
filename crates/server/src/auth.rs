//! GitHub OAuth web flow and cookie sessions.
//!
//! - `/auth/github/login`: random `state` in an HttpOnly cookie, redirect to GitHub.
//! - `/auth/github/callback`: verify `state`, exchange `code`, fetch `/user`,
//!   upsert the user, create a session row (sha256 of the token) and set the
//!   `simpress_session` cookie (HttpOnly, SameSite=Lax, Secure on https).
//! - `/auth/logout` (POST): delete the session and clear the cookie.

use axum::extract::{FromRequestParts, Query, State};
use axum::http::request::Parts;
use axum::http::StatusCode;
use axum::response::Redirect;
use axum_extra::extract::cookie::{Cookie, CookieJar, SameSite};
use rand::RngCore;
use serde::Deserialize;
use sha2::{Digest, Sha256};

use crate::app::AppState;
use crate::db::{self, User};
use crate::error::{AppError, AppResult};

pub const SESSION_COOKIE: &str = "simpress_session";
pub const STATE_COOKIE: &str = "simpress_oauth_state";

pub fn random_token() -> String {
    let mut b = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut b);
    hex::encode(b)
}

/// Sessions are stored by hash so a DB leak does not leak live cookies.
pub fn session_id_hash(token: &str) -> String {
    hex::encode(Sha256::digest(token.as_bytes()))
}

fn cookie(
    st: &AppState,
    name: &'static str,
    value: String,
    path: &'static str,
    max_age_secs: i64,
) -> Cookie<'static> {
    Cookie::build((name, value))
        .http_only(true)
        .same_site(SameSite::Lax)
        .secure(st.cfg.cookie_secure())
        .path(path)
        .max_age(time_duration(max_age_secs))
        .build()
}

fn time_duration(secs: i64) -> time::Duration {
    time::Duration::seconds(secs)
}

pub async fn login(State(st): State<AppState>, jar: CookieJar) -> (CookieJar, Redirect) {
    let state = random_token();
    let mut url = url::Url::parse(&st.cfg.github.authorize_url).expect("valid authorize_url");
    url.query_pairs_mut()
        .append_pair("client_id", &st.cfg.github.client_id)
        .append_pair("redirect_uri", &st.cfg.oauth_redirect_uri())
        .append_pair("scope", "read:user")
        .append_pair("state", &state)
        .append_pair("allow_signup", "true");
    let jar = jar.add(cookie(&st, STATE_COOKIE, state, "/auth", 600));
    (jar, Redirect::to(url.as_str()))
}

#[derive(Deserialize)]
pub struct CallbackQuery {
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
}

#[derive(Deserialize)]
struct GithubUser {
    id: i64,
    login: String,
    name: Option<String>,
    avatar_url: Option<String>,
}

pub async fn callback(
    State(st): State<AppState>,
    jar: CookieJar,
    Query(q): Query<CallbackQuery>,
) -> AppResult<(CookieJar, Redirect)> {
    if let Some(err) = q.error {
        return Err(AppError::BadRequest(format!(
            "GitHub denied the login: {err}"
        )));
    }
    let expected = jar
        .get(STATE_COOKIE)
        .map(|c| c.value().to_string())
        .ok_or_else(|| AppError::BadRequest("missing OAuth state cookie".into()))?;
    let got = q
        .state
        .ok_or_else(|| AppError::BadRequest("missing state".into()))?;
    if !constant_time_eq(expected.as_bytes(), got.as_bytes()) {
        return Err(AppError::BadRequest("OAuth state mismatch".into()));
    }
    let code = q
        .code
        .ok_or_else(|| AppError::BadRequest("missing code".into()))?;

    let gh = &st.cfg.github;
    let token: TokenResponse = st
        .http
        .post(&gh.token_url)
        .header("Accept", "application/json")
        .form(&[
            ("client_id", gh.client_id.as_str()),
            ("client_secret", gh.client_secret.as_str()),
            ("code", code.as_str()),
            ("redirect_uri", st.cfg.oauth_redirect_uri().as_str()),
        ])
        .send()
        .await
        .map_err(|e| AppError::BadGateway(format!("token exchange: {e}")))?
        .error_for_status()
        .map_err(|e| AppError::BadGateway(format!("token exchange: {e}")))?
        .json()
        .await
        .map_err(|e| AppError::BadGateway(format!("token exchange body: {e}")))?;
    let access_token = match (token.access_token, token.error) {
        (Some(t), None) => t,
        (_, err) => {
            return Err(AppError::BadRequest(format!(
                "GitHub token exchange failed: {} {}",
                err.unwrap_or_default(),
                token.error_description.unwrap_or_default()
            )))
        }
    };

    let user: GithubUser = st
        .http
        .get(format!("{}/user", gh.api_base.trim_end_matches('/')))
        .bearer_auth(&access_token)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| AppError::BadGateway(format!("GitHub /user: {e}")))?
        .error_for_status()
        .map_err(|e| AppError::BadGateway(format!("GitHub /user: {e}")))?
        .json()
        .await
        .map_err(|e| AppError::BadGateway(format!("GitHub /user body: {e}")))?;

    let u = db::upsert_github_user(
        &st.pool,
        user.id,
        &user.login,
        user.name.as_deref(),
        user.avatar_url.as_deref(),
    )
    .await?;
    let token = random_token();
    db::create_session(&st.pool, &session_id_hash(&token), u.id, st.cfg.session_ttl).await?;
    tracing::info!(user_id = %u.id, login = %u.login, "signed in");

    let ttl = i64::try_from(st.cfg.session_ttl.as_secs()).unwrap_or(i64::MAX / 4);
    let jar = jar
        .remove(Cookie::build(STATE_COOKIE).path("/auth"))
        .add(cookie(&st, SESSION_COOKIE, token, "/", ttl));
    let home = format!("{}/", st.cfg.public_url.trim_end_matches('/'));
    Ok((jar, Redirect::to(&home)))
}

pub async fn logout(
    State(st): State<AppState>,
    jar: CookieJar,
) -> AppResult<(CookieJar, StatusCode)> {
    if let Some(c) = jar.get(SESSION_COOKIE) {
        db::delete_session(&st.pool, &session_id_hash(c.value())).await?;
    }
    let jar = jar.remove(Cookie::build(SESSION_COOKIE).path("/"));
    Ok((jar, StatusCode::NO_CONTENT))
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// The signed-in user (from the session cookie). Rejects with 401.
#[derive(Clone, Debug)]
pub struct CurrentUser(pub User);

impl FromRequestParts<AppState> for CurrentUser {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, st: &AppState) -> Result<Self, Self::Rejection> {
        let jar = CookieJar::from_headers(&parts.headers);
        let token = jar.get(SESSION_COOKIE).ok_or(AppError::Unauthorized)?;
        let user = db::session_user(&st.pool, &session_id_hash(token.value()))
            .await?
            .ok_or(AppError::Unauthorized)?;
        Ok(CurrentUser(user))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokens_are_random_and_hashed() {
        let a = random_token();
        let b = random_token();
        assert_ne!(a, b);
        assert_eq!(a.len(), 64);
        assert_ne!(session_id_hash(&a), a);
        assert_eq!(session_id_hash(&a), session_id_hash(&a));
    }

    #[test]
    fn ct_eq() {
        assert!(constant_time_eq(b"abc", b"abc"));
        assert!(!constant_time_eq(b"abc", b"abd"));
        assert!(!constant_time_eq(b"abc", b"ab"));
    }
}
