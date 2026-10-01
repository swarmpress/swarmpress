//! GitHub App authentication.
//!
//! * [`AppAuth`] signs short-lived RS256 app JWTs from the app id + private
//!   key PEM and exchanges them for **installation access tokens**, which
//!   are cached until 5 minutes before they expire.
//! * [`StaticToken`] is the dev mode: a fixed PAT / token.
//!
//! Both implement [`TokenProvider`], which is all [`crate::HttpGitHub`] needs.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use jsonwebtoken::{Algorithm, EncodingKey, Header};
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

use crate::clock::{Clock, SystemClock};
use crate::error::{GitHubError, Result};
use crate::http::{api_url, default_headers, map_status};
use crate::types::RepoId;

/// Refresh installation tokens this long before they expire.
pub const TOKEN_REFRESH_MARGIN: Duration = Duration::from_secs(5 * 60);

/// Supplies the bearer token for API calls.
#[async_trait]
pub trait TokenProvider: Send + Sync {
    async fn token(&self) -> Result<String>;
}

/// Dev / test mode: a fixed token (PAT or pre-minted installation token).
#[derive(Clone)]
pub struct StaticToken(pub String);

impl std::fmt::Debug for StaticToken {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("StaticToken(<redacted>)")
    }
}

#[async_trait]
impl TokenProvider for StaticToken {
    async fn token(&self) -> Result<String> {
        Ok(self.0.clone())
    }
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct AppClaims {
    pub iat: u64,
    pub exp: u64,
    pub iss: String,
}

#[derive(Clone)]
struct CachedToken {
    token: String,
    expires_at_ms: u64,
}

/// GitHub App credentials plus an installation-token cache.
pub struct AppAuth {
    app_id: String,
    key: EncodingKey,
    api_base: String,
    http: reqwest::Client,
    clock: Arc<dyn Clock>,
    cache: Mutex<HashMap<u64, CachedToken>>,
}

impl std::fmt::Debug for AppAuth {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AppAuth")
            .field("app_id", &self.app_id)
            .field("api_base", &self.api_base)
            .finish_non_exhaustive()
    }
}

#[derive(Deserialize)]
struct AccessTokenResponse {
    token: String,
    expires_at: String,
}

#[derive(Deserialize)]
struct InstallationResponse {
    id: u64,
}

impl AppAuth {
    /// `app_id` is the numeric App ID (or the client id, which GitHub also
    /// accepts as `iss`). `private_key_pem` is the PKCS#1 or PKCS#8 RSA key
    /// downloaded from the App settings. `api_base` is
    /// `https://api.github.com` or a GHES `https://host/api/v3`.
    pub fn new(
        app_id: impl Into<String>,
        private_key_pem: &[u8],
        api_base: impl Into<String>,
    ) -> Result<Self> {
        let key = EncodingKey::from_rsa_pem(private_key_pem)
            .map_err(|e| GitHubError::Auth(format!("invalid app private key: {e}")))?;
        Ok(Self {
            app_id: app_id.into(),
            key,
            api_base: api_base.into(),
            http: crate::http::build_client()?,
            clock: Arc::new(SystemClock),
            cache: Mutex::new(HashMap::new()),
        })
    }

    pub fn with_clock(mut self, clock: Arc<dyn Clock>) -> Self {
        self.clock = clock;
        self
    }

    pub fn with_http_client(mut self, http: reqwest::Client) -> Self {
        self.http = http;
        self
    }

    pub fn api_base(&self) -> &str {
        &self.api_base
    }

    /// Mint an app JWT: `iat` backdated 60 s for clock skew, 9 min lifetime
    /// (GitHub's maximum is 10).
    pub fn app_jwt(&self) -> Result<String> {
        let now = self.clock.now_secs();
        let claims = AppClaims {
            iat: now.saturating_sub(60),
            exp: now + 9 * 60,
            iss: self.app_id.clone(),
        };
        jsonwebtoken::encode(&Header::new(Algorithm::RS256), &claims, &self.key)
            .map_err(|e| GitHubError::Auth(format!("jwt signing failed: {e}")))
    }

    /// Look up the installation id for a repo (`GET /repos/{o}/{r}/installation`).
    pub async fn installation_for_repo(&self, repo: &RepoId) -> Result<u64> {
        let url = api_url(
            &self.api_base,
            &["repos", &repo.owner, &repo.name, "installation"],
        )?;
        let resp = self
            .http
            .get(url)
            .headers(default_headers())
            .bearer_auth(self.app_jwt()?)
            .send()
            .await?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(map_status(status.as_u16(), &body));
        }
        Ok(resp.json::<InstallationResponse>().await?.id)
    }

    /// Return a valid installation token, exchanging a fresh JWT if the
    /// cached one is missing or within [`TOKEN_REFRESH_MARGIN`] of expiry.
    pub async fn installation_token(&self, installation_id: u64) -> Result<String> {
        // Holding the async mutex across the exchange prevents a stampede of
        // parallel exchanges on cold start.
        let mut cache = self.cache.lock().await;
        let now = self.clock.now_ms();
        let margin = u64::try_from(TOKEN_REFRESH_MARGIN.as_millis()).unwrap_or(u64::MAX);
        if let Some(c) = cache.get(&installation_id) {
            if now.saturating_add(margin) < c.expires_at_ms {
                return Ok(c.token.clone());
            }
        }
        let fresh = self.exchange(installation_id).await?;
        let token = fresh.token.clone();
        cache.insert(installation_id, fresh);
        Ok(token)
    }

    /// Drop a cached token (e.g. after a 401).
    pub async fn invalidate(&self, installation_id: u64) {
        self.cache.lock().await.remove(&installation_id);
    }

    async fn exchange(&self, installation_id: u64) -> Result<CachedToken> {
        let id = installation_id.to_string();
        let url = api_url(
            &self.api_base,
            &["app", "installations", &id, "access_tokens"],
        )?;
        let resp = self
            .http
            .post(url)
            .headers(default_headers())
            .bearer_auth(self.app_jwt()?)
            .send()
            .await?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(match map_status(status.as_u16(), &body) {
                GitHubError::Unauthorized(m) | GitHubError::Forbidden(m) => {
                    GitHubError::Auth(format!("installation token exchange refused: {m}"))
                }
                other => other,
            });
        }
        let body: AccessTokenResponse = resp.json().await?;
        let expires = chrono::DateTime::parse_from_rfc3339(&body.expires_at)
            .map_err(|e| GitHubError::Decode(format!("expires_at: {e}")))?;
        let expires_at_ms = u64::try_from(expires.timestamp_millis()).unwrap_or(0);
        Ok(CachedToken {
            token: body.token,
            expires_at_ms,
        })
    }

    /// A [`TokenProvider`] bound to one installation.
    pub fn installation(self: &Arc<Self>, installation_id: u64) -> InstallationToken {
        InstallationToken {
            app: self.clone(),
            installation_id,
        }
    }
}

/// [`TokenProvider`] for one installation of an [`AppAuth`].
#[derive(Clone, Debug)]
pub struct InstallationToken {
    app: Arc<AppAuth>,
    installation_id: u64,
}

impl InstallationToken {
    pub fn installation_id(&self) -> u64 {
        self.installation_id
    }
}

#[async_trait]
impl TokenProvider for InstallationToken {
    async fn token(&self) -> Result<String> {
        self.app.installation_token(self.installation_id).await
    }
}
