//! The offline event inbox (ADR-0038): central things that happened to a
//! company while its browser was away (deploys, webhook outcomes, ...).
//!
//! - Stored in the `events` table with a global monotonic `seq`.
//! - `GET /api/events?after=<seq>&limit=` polls (oldest first).
//! - `GET /ws/events?after=<seq>` (WebSocket, cookie auth) sends the backlog
//!   after `seq`, then pushes new events as they are published (JSON text
//!   frames, one [`Event`] each). One server process, so an in-process
//!   `tokio::sync::broadcast` is the notification bus (ADR-0039).

use std::sync::Arc;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Query, State};
use axum::response::Response;
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::sync::broadcast;

use crate::app::{require_company, AppState};
use crate::auth::CurrentUser;
use crate::db::events as store;
pub use crate::db::events::Event;
use crate::error::AppResult;

/// Event kinds (`events.kind`).
pub mod kinds {
    /// A merged content PR is live: `{content_id, work_item, merged_sha, number, source}`.
    pub const DEPLOY_LANDED: &str = "DeployLanded";
    /// A deployment of a merged sha failed: `{content_id, work_item, merged_sha, state, source}`.
    pub const DEPLOY_FAILED: &str = "DeployFailed";
    /// A new grant displaced an unreleased lease (ADR-0045):
    /// `{epoch, holder, new_epoch, by}`. Only the executor whose epoch is
    /// `epoch` acts on it; later readers of the inbox ignore it.
    pub const LEASE_REVOKED: &str = "LeaseRevoked";
    /// Another executor asked the holder to hand over: `{epoch, holder, by}`.
    pub const HANDOVER_REQUESTED: &str = "HandoverRequested";
}

const PAGE: i64 = 500;

/// In-process fan-out of freshly stored events.
#[derive(Clone)]
pub struct EventHub {
    tx: broadcast::Sender<Arc<Event>>,
}

impl Default for EventHub {
    fn default() -> Self {
        let (tx, _) = broadcast::channel(1024);
        Self { tx }
    }
}

impl EventHub {
    pub fn subscribe(&self) -> broadcast::Receiver<Arc<Event>> {
        self.tx.subscribe()
    }

    fn send(&self, ev: Event) {
        // No receivers is fine: the event is in the inbox for the next poll.
        let _ = self.tx.send(Arc::new(ev));
    }
}

/// Store an event in the company's inbox and push it to connected sockets.
pub async fn publish(
    st: &AppState,
    company_id: &str,
    kind: &str,
    payload: Value,
) -> AppResult<Event> {
    let ev = store::insert_event(&st.db, company_id, kind, &payload, st.now_ms()).await?;
    tracing::info!(company_id, kind, seq = ev.seq, "event published");
    st.events.send(ev.clone());
    Ok(ev)
}

#[derive(Deserialize)]
pub struct EventsQuery {
    #[serde(default)]
    pub after: Option<i64>,
    #[serde(default)]
    pub limit: Option<i64>,
}

/// `GET /api/events?after=&limit=` → `{events, last_seq}`.
pub async fn list(
    State(st): State<AppState>,
    CurrentUser(user): CurrentUser,
    Query(q): Query<EventsQuery>,
) -> AppResult<Json<Value>> {
    let c = require_company(&st, &user.id).await?;
    let after = q.after.unwrap_or(0).max(0);
    let events =
        store::events_after(&st.db, &c.id, after, q.limit.unwrap_or(PAGE).clamp(1, PAGE)).await?;
    let last_seq = events.last().map_or(after, |e| e.seq);
    Ok(Json(json!({ "events": events, "last_seq": last_seq })))
}

/// `GET /ws/events?after=` (WebSocket upgrade, cookie auth).
pub async fn ws(
    State(st): State<AppState>,
    CurrentUser(user): CurrentUser,
    Query(q): Query<EventsQuery>,
    upgrade: WebSocketUpgrade,
) -> AppResult<Response> {
    let c = require_company(&st, &user.id).await?;
    let after = q.after.unwrap_or(0).max(0);
    Ok(upgrade.on_upgrade(move |socket| async move {
        if let Err(e) = pump(st, c.id, after, socket).await {
            tracing::debug!(error = %e, "events socket closed");
        }
    }))
}

async fn send_event(socket: &mut WebSocket, ev: &Event) -> anyhow::Result<()> {
    let text = serde_json::to_string(ev)?;
    socket.send(Message::Text(text.into())).await?;
    Ok(())
}

/// Send everything after `last` from the inbox; returns the new `last`.
async fn backlog(
    st: &AppState,
    company: &str,
    mut last: i64,
    socket: &mut WebSocket,
) -> anyhow::Result<i64> {
    loop {
        let page = store::events_after(&st.db, company, last, PAGE).await?;
        let n = page.len();
        for ev in &page {
            send_event(socket, ev).await?;
            last = ev.seq;
        }
        if i64::try_from(n).unwrap_or(0) < PAGE {
            return Ok(last);
        }
    }
}

async fn pump(
    st: AppState,
    company: String,
    after: i64,
    mut socket: WebSocket,
) -> anyhow::Result<()> {
    // Subscribe first, then read the backlog: nothing published in between is lost.
    let mut rx = st.events.subscribe();
    let mut last = backlog(&st, &company, after, &mut socket).await?;
    loop {
        tokio::select! {
            got = rx.recv() => match got {
                Ok(ev) => {
                    if ev.company_id == company && ev.seq > last {
                        send_event(&mut socket, &ev).await?;
                        last = ev.seq;
                    }
                }
                Err(broadcast::error::RecvError::Lagged(_)) => {
                    last = backlog(&st, &company, last, &mut socket).await?;
                }
                Err(broadcast::error::RecvError::Closed) => return Ok(()),
            },
            msg = socket.recv() => match msg {
                None | Some(Err(_)) | Some(Ok(Message::Close(_))) => return Ok(()),
                Some(Ok(Message::Ping(p))) => socket.send(Message::Pong(p)).await?,
                Some(Ok(_)) => {}
            },
        }
    }
}
