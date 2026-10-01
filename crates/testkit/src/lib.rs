//! Shared test helpers for SimPress crates.
//!
//! - [`db`]: locate the test Postgres (`DATABASE_URL`), with a helpful panic
//! - [`oauth`]: a fake GitHub OAuth provider + API (wiremock)
//! - [`ws`]: a postcard WebSocket test client (tokio-tungstenite)
//! - [`world`]: deterministic world builders and golden-hash helpers
//!
//! This crate does not depend on the server, so server unit tests can use it.

pub mod db {
    /// The Postgres URL used by `#[sqlx::test]` and other DB tests.
    /// Panics with setup instructions when unset.
    pub fn database_url() -> String {
        std::env::var("DATABASE_URL").unwrap_or_else(|_| {
            panic!(
                "DATABASE_URL is not set. Start a throwaway Postgres with\n  \
                 eval \"$(crates/server/scripts/test-pg.sh start)\"\n\
                 or `docker compose up -d postgres` and export DATABASE_URL."
            )
        })
    }

    /// Quick connectivity check, for tests that want to fail early and clearly.
    pub async fn ping() -> anyhow::Result<()> {
        use sqlx::Connection;
        let mut c = sqlx::PgConnection::connect(&database_url()).await?;
        sqlx::query("SELECT 1").execute(&mut c).await?;
        Ok(())
    }
}

pub mod oauth {
    use serde_json::json;
    use wiremock::matchers::{body_string_contains, header, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    pub const CLIENT_ID: &str = "test-client-id";
    pub const CLIENT_SECRET: &str = "test-client-secret";

    #[derive(Clone, Debug)]
    pub struct GithubUser {
        pub id: i64,
        pub login: String,
        pub name: Option<String>,
    }

    impl GithubUser {
        pub fn new(id: i64, login: &str) -> Self {
            Self {
                id,
                login: login.into(),
                name: Some(format!("{login} (test)")),
            }
        }
    }

    /// Fake `github.com/login/oauth/*` + `api.github.com/user` on one base URL.
    pub struct FakeGitHub {
        pub server: MockServer,
    }

    impl FakeGitHub {
        pub async fn start() -> Self {
            let server = MockServer::start().await;
            // Unknown codes get GitHub's (HTTP 200!) error shape.
            Mock::given(method("POST"))
                .and(path("/login/oauth/access_token"))
                .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                    "error": "bad_verification_code",
                    "error_description": "The code passed is incorrect or expired."
                })))
                .with_priority(10)
                .mount(&server)
                .await;
            Self { server }
        }

        pub fn base_url(&self) -> String {
            self.server.uri()
        }

        /// Accept `code` → issue a token → `/user` returns `user`.
        pub async fn register(&self, code: &str, user: &GithubUser) {
            let token = format!("gho_{code}");
            Mock::given(method("POST"))
                .and(path("/login/oauth/access_token"))
                .and(body_string_contains(format!("code={code}")))
                .and(body_string_contains(format!("client_id={CLIENT_ID}")))
                .and(body_string_contains(format!(
                    "client_secret={CLIENT_SECRET}"
                )))
                .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                    "access_token": token,
                    "token_type": "bearer",
                    "scope": "read:user"
                })))
                .with_priority(1)
                .mount(&self.server)
                .await;
            Mock::given(method("GET"))
                .and(path("/user"))
                .and(header("authorization", format!("Bearer {token}").as_str()))
                .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                    "id": user.id,
                    "login": user.login,
                    "name": user.name,
                    "avatar_url": format!("https://avatars.example/{}", user.id)
                })))
                .mount(&self.server)
                .await;
        }
    }
}

pub mod ws {
    use std::time::Duration;

    use anyhow::{anyhow, bail, Context, Result};
    use futures::{SinkExt, StreamExt};
    use serde::de::DeserializeOwned;
    use serde::Serialize;
    use tokio::net::TcpStream;
    use tokio_tungstenite::tungstenite::client::IntoClientRequest;
    use tokio_tungstenite::tungstenite::http::HeaderValue;
    use tokio_tungstenite::tungstenite::Message;
    use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};

    pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(10);

    /// Binary-postcard WebSocket client for server integration tests.
    pub struct WsClient {
        stream: WebSocketStream<MaybeTlsStream<TcpStream>>,
    }

    impl WsClient {
        /// Connect to `url` (ws://...) sending `cookie` as the Cookie header.
        pub async fn connect(url: &str, cookie: Option<&str>) -> Result<Self> {
            let mut req = url.into_client_request()?;
            if let Some(c) = cookie {
                req.headers_mut()
                    .insert("cookie", HeaderValue::from_str(c)?);
            }
            let (stream, _) = tokio_tungstenite::connect_async(req)
                .await
                .context("ws connect")?;
            Ok(Self { stream })
        }

        pub async fn send<T: Serialize>(&mut self, frame: &T) -> Result<()> {
            let bytes = postcard::to_allocvec(frame)?;
            self.stream.send(Message::Binary(bytes.into())).await?;
            Ok(())
        }

        pub async fn send_raw(&mut self, msg: Message) -> Result<()> {
            self.stream.send(msg).await?;
            Ok(())
        }

        /// Next binary frame, decoded. Errors on timeout or close.
        pub async fn recv<T: DeserializeOwned>(&mut self) -> Result<T> {
            self.recv_timeout(DEFAULT_TIMEOUT).await
        }

        pub async fn recv_timeout<T: DeserializeOwned>(&mut self, t: Duration) -> Result<T> {
            loop {
                let msg = tokio::time::timeout(t, self.stream.next())
                    .await
                    .map_err(|_| anyhow!("timed out waiting for a frame"))?
                    .ok_or_else(|| anyhow!("socket closed"))??;
                match msg {
                    Message::Binary(b) => return Ok(postcard::from_bytes(&b)?),
                    Message::Close(c) => bail!("socket closed: {c:?}"),
                    _ => continue,
                }
            }
        }

        /// Skip frames until `pick` returns `Some`, within `t`.
        pub async fn recv_until<T: DeserializeOwned, R>(
            &mut self,
            t: Duration,
            mut pick: impl FnMut(&T) -> Option<R>,
        ) -> Result<R> {
            let deadline = tokio::time::Instant::now() + t;
            loop {
                let left = deadline.saturating_duration_since(tokio::time::Instant::now());
                if left.is_zero() {
                    bail!("timed out waiting for a matching frame");
                }
                let f: T = self.recv_timeout(left).await?;
                if let Some(r) = pick(&f) {
                    return Ok(r);
                }
            }
        }

        pub async fn close(mut self) -> Result<()> {
            self.stream.close(None).await?;
            Ok(())
        }
    }
}

pub mod world {
    use sim_core::World;

    /// A world with `seed` advanced `steps` times.
    pub fn world_after(seed: u64, steps: u64) -> World {
        let mut w = World::new(seed);
        for _ in 0..steps {
            w.tick();
        }
        w
    }

    /// Golden hash of `seed` after `steps` (for determinism assertions).
    pub fn hash_after(seed: u64, steps: u64) -> u64 {
        world_after(seed, steps).hash()
    }

    #[cfg(test)]
    mod tests {
        #[test]
        fn builders_are_deterministic() {
            assert_eq!(super::hash_after(9, 500), super::hash_after(9, 500));
            assert_ne!(super::hash_after(9, 500), super::hash_after(9, 501));
            assert_eq!(super::world_after(9, 12).step, 12);
        }
    }
}
