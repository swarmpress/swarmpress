//! `/ws`: cookie-authenticated lockstep stream + browser job worker.
//!
//! One connection = one player tab of the player's company. It receives
//! `Hello` (snapshot), then the company actor's `Commands`/`Hash` broadcast.
//! A tab that sends `WorkerHello` also becomes a browser job worker: it gets
//! `JobOffer`s and may `JobClaim` → `JobProgress`* → `JobResult`/`JobFailed`.
//! Leases held by a connection are released when it disconnects.

use std::collections::HashMap;
use std::time::Duration;

use axum::extract::ws::{Message, WebSocket};
use axum::extract::{State, WebSocketUpgrade};
use axum::response::Response;
use chrono::{DateTime, Utc};
use tokio::sync::broadcast::error::RecvError;
use uuid::Uuid;

use crate::actor::{ActorHandle, CommandError, Subscription};
use crate::app::AppState;
use crate::auth::CurrentUser;
use crate::db::{self, User};
use crate::error::{AppError, AppResult};
use crate::jobs::{parse_artifact, Executor, Job};
use crate::plan::JobCompletion;
use crate::wire::{self, ClientFrame, ServerFrame};

pub async fn ws_handler(
    State(st): State<AppState>,
    CurrentUser(user): CurrentUser,
    ws: WebSocketUpgrade,
) -> AppResult<Response> {
    let company = db::company_for_user(&st.pool, user.id)
        .await?
        .ok_or_else(|| AppError::NotFound("create a company first".into()))?;
    let handle = st.registry.get(company.id).await?;
    Ok(ws.on_upgrade(move |socket| async move {
        let conn_id = Uuid::new_v4();
        let mut conn = Conn {
            st,
            user,
            company_id: company.id,
            handle,
            owner: format!("ws:{conn_id}"),
            worker: None,
        };
        tracing::info!(company_id = %conn.company_id, conn = %conn_id, "ws connected");
        conn.run(socket).await;
        conn.cleanup().await;
        tracing::info!(company_id = %conn.company_id, conn = %conn_id, "ws disconnected");
    }))
}

struct Worker {
    tier: i16,
    /// job id → attempt number at the time we offered it (re-offer on retry).
    offered: HashMap<Uuid, i32>,
    /// Jobs this connection holds a lease on → lease expiry.
    leased: HashMap<Uuid, DateTime<Utc>>,
}

struct Conn {
    st: AppState,
    user: User,
    company_id: Uuid,
    handle: ActorHandle,
    owner: String,
    worker: Option<Worker>,
}

/// Socket write failed: the connection is gone.
struct Closed;

impl Conn {
    async fn send(&self, socket: &mut WebSocket, frame: &ServerFrame) -> Result<(), Closed> {
        socket
            .send(Message::Binary(wire::encode(frame).into()))
            .await
            .map_err(|_| Closed)
    }

    /// Subscribe to the actor, reloading it via the registry if it exited.
    async fn subscribe(&mut self) -> Option<Subscription> {
        if let Ok(s) = self.handle.subscribe().await {
            return Some(s);
        }
        match self.st.registry.get(self.company_id).await {
            Ok(h) => {
                self.handle = h;
                self.handle.subscribe().await.ok()
            }
            Err(e) => {
                tracing::error!(company_id = %self.company_id, error = %e, "could not reload company actor");
                None
            }
        }
    }

    async fn run(&mut self, mut socket: WebSocket) {
        let Some(sub) = self.subscribe().await else {
            let _ = self
                .send(
                    &mut socket,
                    &ServerFrame::Error {
                        message: "company unavailable".into(),
                    },
                )
                .await;
            return;
        };
        let hello = ServerFrame::Hello {
            proto_version: protocol::PROTO_VERSION,
            server_version: env!("CARGO_PKG_VERSION").into(),
            company_id: self.company_id.to_string(),
            step: sub.step,
            next_seq: sub.next_seq,
            snapshot: sub.snapshot,
        };
        if self.send(&mut socket, &hello).await.is_err() {
            return;
        }
        let mut rx = sub.rx;
        let mut plan_rx = self.st.plan.hub().subscribe(self.company_id);
        let mut notices = self.st.notifier.subscribe();
        let mut offer_tick = tokio::time::interval(Duration::from_secs(5));
        offer_tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

        loop {
            let res: Result<(), Closed> = tokio::select! {
                msg = socket.recv() => match msg {
                    None | Some(Err(_)) | Some(Ok(Message::Close(_))) => return,
                    Some(Ok(Message::Binary(b))) => match wire::decode::<ClientFrame>(&b) {
                        Ok(frame) => self.on_client(&mut socket, &mut rx, frame).await,
                        Err(e) => self.send(&mut socket, &ServerFrame::Error {
                            message: format!("undecodable frame: {e}"),
                        }).await,
                    },
                    Some(Ok(Message::Text(_))) => self.send(&mut socket, &ServerFrame::Error {
                        message: "binary postcard frames only".into(),
                    }).await,
                    Some(Ok(_)) => Ok(()), // ping/pong handled by axum
                },
                f = rx.recv() => match f {
                    Ok(frame) => self.send(&mut socket, &frame).await,
                    Err(RecvError::Lagged(n)) => {
                        tracing::warn!(company_id = %self.company_id, lagged = n, "client lagged; resnapshot");
                        self.resnapshot(&mut socket, &mut rx).await
                    }
                    Err(RecvError::Closed) => {
                        // Actor exited (restart/unload): reload and resync.
                        self.resnapshot(&mut socket, &mut rx).await
                    }
                },
                p = plan_rx.recv() => match p {
                    Ok(frame) => self.send(&mut socket, &frame).await,
                    Err(RecvError::Lagged(n)) => {
                        tracing::warn!(company_id = %self.company_id, lagged = n, "plan stream lagged");
                        self.send(&mut socket, &ServerFrame::Error {
                            message: "plan stream lagged; refetch /api/plan".into(),
                        }).await
                    }
                    Err(RecvError::Closed) => {
                        plan_rx = self.st.plan.hub().subscribe(self.company_id);
                        Ok(())
                    }
                },
                n = notices.recv() => match n {
                    Ok(n) if n.executor == "browser" && n.company_id == Some(self.company_id) => {
                        self.offer_jobs(&mut socket).await
                    }
                    Ok(_) => Ok(()),
                    Err(RecvError::Lagged(_)) => self.offer_jobs(&mut socket).await,
                    Err(RecvError::Closed) => Ok(()),
                },
                _ = offer_tick.tick(), if self.worker.is_some() => self.offer_jobs(&mut socket).await,
            };
            if res.is_err() {
                return;
            }
        }
    }

    async fn resnapshot(
        &mut self,
        socket: &mut WebSocket,
        rx: &mut tokio::sync::broadcast::Receiver<std::sync::Arc<ServerFrame>>,
    ) -> Result<(), Closed> {
        let Some(sub) = self.subscribe().await else {
            let _ = self
                .send(
                    socket,
                    &ServerFrame::Error {
                        message: "company unavailable".into(),
                    },
                )
                .await;
            return Err(Closed);
        };
        *rx = sub.rx;
        self.send(
            socket,
            &ServerFrame::Resnapshot {
                step: sub.step,
                next_seq: sub.next_seq,
                snapshot: sub.snapshot,
            },
        )
        .await
    }

    async fn on_client(
        &mut self,
        socket: &mut WebSocket,
        rx: &mut tokio::sync::broadcast::Receiver<std::sync::Arc<ServerFrame>>,
        frame: ClientFrame,
    ) -> Result<(), Closed> {
        match frame {
            ClientFrame::Cmd {
                client_seq,
                payload,
            } => {
                let reply = match self.handle.command(Some(self.user.id), payload).await {
                    Ok((step, seq)) => ServerFrame::Ack {
                        client_seq,
                        step,
                        seq,
                    },
                    Err(CommandError::Rejected(reason)) => {
                        ServerFrame::Reject { client_seq, reason }
                    }
                    Err(e @ (CommandError::Storage(_) | CommandError::Gone)) => {
                        ServerFrame::Reject {
                            client_seq,
                            reason: format!("retry: {e}"),
                        }
                    }
                };
                self.send(socket, &reply).await
            }
            ClientFrame::HashReport { step, h } => match self.handle.hash_at(step).await {
                Ok(Some(expected)) if expected != h => {
                    tracing::warn!(company_id = %self.company_id, step, expected, got = h,
                        "client desync detected; resnapshot");
                    self.resnapshot(socket, rx).await
                }
                _ => Ok(()),
            },
            ClientFrame::RequestResnapshot => self.resnapshot(socket, rx).await,
            ClientFrame::WorkerHello { tier } => {
                self.worker = Some(Worker {
                    tier: i16::from(tier),
                    offered: HashMap::new(),
                    leased: HashMap::new(),
                });
                self.offer_jobs(socket).await
            }
            ClientFrame::JobClaim { job_id } => self.on_claim(socket, &job_id).await,
            ClientFrame::JobProgress { job_id, delta } => {
                self.on_progress(socket, &job_id, &delta).await
            }
            ClientFrame::JobResult {
                job_id,
                artifact_json,
            } => self.on_result(socket, &job_id, &artifact_json).await,
            ClientFrame::JobFailed { job_id, error } => {
                let Some(id) = self.leased_job(&job_id) else {
                    return self.revoke(socket, &job_id, "not your job").await;
                };
                if let Some(w) = self.worker.as_mut() {
                    w.leased.remove(&id);
                }
                if let Err(e) = self
                    .st
                    .jobs
                    .fail(id, &self.owner, &format!("browser: {error}"))
                    .await
                {
                    tracing::error!(job_id = %id, error = %e, "recording job failure failed");
                }
                self.offer_jobs(socket).await
            }
        }
    }

    fn leased_job(&self, job_id: &str) -> Option<Uuid> {
        let id = Uuid::parse_str(job_id).ok()?;
        self.worker.as_ref()?.leased.contains_key(&id).then_some(id)
    }

    async fn revoke(
        &self,
        socket: &mut WebSocket,
        job_id: &str,
        reason: &str,
    ) -> Result<(), Closed> {
        self.send(
            socket,
            &ServerFrame::JobRevoked {
                job_id: job_id.into(),
                reason: reason.into(),
            },
        )
        .await
    }

    async fn offer_jobs(&mut self, socket: &mut WebSocket) -> Result<(), Closed> {
        let Some(tier) = self.worker.as_ref().map(|w| w.tier) else {
            return Ok(());
        };
        let jobs = match self.st.jobs.list_offerable(self.company_id, tier, 16).await {
            Ok(j) => j,
            Err(e) => {
                tracing::error!(error = %e, "listing offerable jobs failed");
                return Ok(());
            }
        };
        for job in jobs {
            let fresh = {
                let w = self.worker.as_mut().expect("worker");
                w.offered.insert(job.id, job.attempts) != Some(job.attempts)
            };
            if !fresh {
                continue;
            }
            self.send(
                socket,
                &ServerFrame::JobOffer {
                    job_id: job.id.to_string(),
                    kind: job.kind.clone(),
                    min_tier: u8::try_from(job.min_tier).unwrap_or(u8::MAX),
                    priority: job.priority,
                    attempt: u32::try_from(job.attempts + 1).unwrap_or(0),
                    payload_json: job.payload.to_string(),
                },
            )
            .await?;
        }
        Ok(())
    }

    async fn on_claim(&mut self, socket: &mut WebSocket, job_id: &str) -> Result<(), Closed> {
        let Some(tier) = self.worker.as_ref().map(|w| w.tier) else {
            return self.revoke(socket, job_id, "send WorkerHello first").await;
        };
        let Ok(id) = Uuid::parse_str(job_id) else {
            return self.revoke(socket, job_id, "bad job id").await;
        };
        let claimed = self
            .st
            .jobs
            .claim(
                id,
                Executor::Browser,
                Some(self.company_id),
                tier,
                &self.owner,
                self.st.cfg.job_lease,
            )
            .await;
        match claimed {
            Ok(Some(job)) => {
                let until = job.lease_until.unwrap_or_else(Utc::now);
                self.worker
                    .as_mut()
                    .expect("worker")
                    .leased
                    .insert(id, until);
                tracing::info!(job_id = %id, kind = %job.kind, attempt = job.attempts, "browser job claimed");
                self.send(
                    socket,
                    &ServerFrame::JobLease {
                        job_id: job_id.into(),
                        until_ms: until.timestamp_millis(),
                    },
                )
                .await
            }
            Ok(None) => self.revoke(socket, job_id, "not claimable").await,
            Err(e) => {
                tracing::error!(job_id = %id, error = %e, "claim failed");
                self.revoke(socket, job_id, "claim failed").await
            }
        }
    }

    async fn on_progress(
        &mut self,
        socket: &mut WebSocket,
        job_id: &str,
        delta: &str,
    ) -> Result<(), Closed> {
        let Some(id) = self.leased_job(job_id) else {
            return self.revoke(socket, job_id, "not your job").await;
        };
        tracing::trace!(job_id = %id, len = delta.len(), "job progress");
        // Extend the lease once less than half of it remains.
        let lease = self.st.cfg.job_lease;
        let until = self
            .worker
            .as_ref()
            .and_then(|w| w.leased.get(&id))
            .copied();
        let half = chrono::Duration::from_std(lease / 2).unwrap_or_default();
        if until.is_some_and(|u| u - Utc::now() > half) {
            return Ok(());
        }
        match self.st.jobs.extend_lease(id, &self.owner, lease).await {
            Ok(Some(u)) => {
                self.worker.as_mut().expect("worker").leased.insert(id, u);
                self.send(
                    socket,
                    &ServerFrame::JobLease {
                        job_id: job_id.into(),
                        until_ms: u.timestamp_millis(),
                    },
                )
                .await
            }
            Ok(None) => {
                self.worker.as_mut().expect("worker").leased.remove(&id);
                self.revoke(socket, job_id, "lease lost").await
            }
            Err(e) => {
                tracing::error!(job_id = %id, error = %e, "lease extension failed");
                Ok(())
            }
        }
    }

    async fn on_result(
        &mut self,
        socket: &mut WebSocket,
        job_id: &str,
        artifact_json: &str,
    ) -> Result<(), Closed> {
        let Some(id) = self.leased_job(job_id) else {
            return self.revoke(socket, job_id, "not your job").await;
        };
        self.worker.as_mut().expect("worker").leased.remove(&id);
        let job = match self.st.jobs.get(id).await {
            Ok(Some(j))
                if j.status == "running"
                    && j.lease_owner.as_deref() == Some(self.owner.as_str()) =>
            {
                j
            }
            Ok(_) => return self.revoke(socket, job_id, "lease lost").await,
            Err(e) => {
                tracing::error!(job_id = %id, error = %e, "loading job failed");
                return self.revoke(socket, job_id, "server error").await;
            }
        };
        let verdict = parse_artifact(artifact_json, self.st.cfg.max_artifact_bytes)
            .and_then(|v| self.st.validator.validate(&job, &v).map(|()| v));
        let reply = match verdict {
            Ok(artifact) => match self.complete(&job, &artifact).await {
                Ok(true) => {
                    tracing::info!(job_id = %id, kind = %job.kind, "browser job completed");
                    // STUB: the sim command `JobCompleted{digest}` does not exist
                    // yet in sim-core/protocol; nothing is injected into the sim.
                    tracing::warn!(job_id = %id, "JobCompleted sim injection not implemented");
                    ServerFrame::JobAccepted {
                        job_id: job_id.into(),
                    }
                }
                Ok(false) => ServerFrame::JobRevoked {
                    job_id: job_id.into(),
                    reason: "lease lost".into(),
                },
                Err(e) => {
                    tracing::error!(job_id = %id, error = %e, "storing job result failed");
                    ServerFrame::JobRevoked {
                        job_id: job_id.into(),
                        reason: "server error".into(),
                    }
                }
            },
            Err(reason) => {
                tracing::warn!(job_id = %id, kind = %job.kind, %reason, "browser artifact rejected");
                if let Err(e) = self
                    .st
                    .jobs
                    .fail(id, &self.owner, &format!("invalid artifact: {reason}"))
                    .await
                {
                    tracing::error!(job_id = %id, error = %e, "recording rejection failed");
                }
                ServerFrame::JobRejected {
                    job_id: job_id.into(),
                    reason,
                }
            }
        };
        self.send(socket, &reply).await?;
        self.offer_jobs(socket).await
    }

    /// Store an accepted artifact. When the job targets a plan item
    /// (`payload.item_id` + `payload.actor`) and the artifact carries
    /// `planOps`, the ops are validated and appended in the same transaction
    /// as the job completion (publishing-plan.md §3).
    async fn complete(&self, job: &Job, artifact: &serde_json::Value) -> anyhow::Result<bool> {
        let item = job
            .payload
            .get("item_id")
            .or_else(|| job.payload.get("itemId"))
            .and_then(|v| v.as_str());
        let actor = job.payload.get("actor").and_then(|v| v.as_str());
        let ops = artifact
            .get("planOps")
            .or_else(|| artifact.get("plan_ops"))
            .and_then(|v| v.as_array());
        match (job.company_id, item, actor, ops) {
            (Some(company), Some(item), Some(actor), Some(ops)) => {
                let outcome = self
                    .st
                    .plan
                    .complete_job_with_ops(
                        company,
                        item,
                        actor,
                        ops,
                        JobCompletion {
                            job_id: job.id,
                            owner: &self.owner,
                            result: artifact,
                        },
                    )
                    .await?;
                if let Some(o) = &outcome {
                    tracing::info!(job_id = %job.id, item, accepted = o.accepted.len(),
                        rejected = o.rejected.len(), "plan ops applied with job result");
                }
                Ok(outcome.is_some())
            }
            _ => self.st.jobs.complete(job.id, &self.owner, artifact).await,
        }
    }

    async fn cleanup(&mut self) {
        if self.worker.is_some() {
            match self.st.jobs.release_owner(&self.owner).await {
                Ok(released) if !released.is_empty() => {
                    tracing::info!(
                        count = released.len(),
                        "released jobs of disconnected worker"
                    );
                }
                Ok(_) => {}
                Err(e) => tracing::error!(error = %e, "releasing worker jobs failed"),
            }
        }
    }
}
