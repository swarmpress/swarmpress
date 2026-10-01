//! Browser job-worker protocol over /ws (plan section D) with a
//! `FakeBrowserWorker`: offer → claim → lease → progress → result, invalid
//! artifact rejection, lease expiry and disconnect re-queue, tiers.

mod common;

use std::sync::Arc;
use std::time::Duration;

use common::{Opts, TestServer};
use serde_json::{json, Value};
use simpress_server::jobs::{ArtifactValidator, Executor, Job, NewJob, RetryPolicy};
use simpress_server::wire::{ClientFrame, ServerFrame};
use sqlx::PgPool;
use testkit::ws::WsClient;
use uuid::Uuid;

const T: Duration = Duration::from_secs(5);

/// Requires `{"title": "<non-empty string>"}`.
struct TitleValidator;

impl ArtifactValidator for TitleValidator {
    fn validate(&self, _job: &Job, a: &Value) -> Result<(), String> {
        match a.get("title").and_then(Value::as_str) {
            Some(t) if !t.is_empty() => Ok(()),
            _ => Err("artifact.title must be a non-empty string".into()),
        }
    }
}

fn opts(validator: Arc<dyn ArtifactValidator>, lease: Duration) -> Opts {
    Opts {
        validator,
        tweak: Box::new(move |c| {
            c.job_lease = lease;
            c.job_retry = RetryPolicy {
                base: Duration::ZERO,
                max: Duration::ZERO,
            };
        }),
        background: false,
    }
}

/// A scripted browser tab acting as the company's job worker.
struct FakeBrowserWorker {
    ws: WsClient,
}

impl FakeBrowserWorker {
    async fn connect(s: &TestServer, cookie: &str, tier: u8) -> Self {
        let mut ws = s.ws(cookie).await;
        let hello: ServerFrame = ws.recv().await.unwrap();
        assert!(matches!(hello, ServerFrame::Hello { .. }));
        ws.send(&ClientFrame::WorkerHello { tier }).await.unwrap();
        Self { ws }
    }

    async fn next_offer(&mut self) -> anyhow::Result<(String, String, u32)> {
        self.next_offer_within(T).await
    }

    async fn next_offer_within(&mut self, t: Duration) -> anyhow::Result<(String, String, u32)> {
        self.ws
            .recv_until(t, |f: &ServerFrame| match f {
                ServerFrame::JobOffer {
                    job_id,
                    payload_json,
                    attempt,
                    ..
                } => Some((job_id.clone(), payload_json.clone(), *attempt)),
                _ => None,
            })
            .await
    }

    /// Next job-related reply (anything but lockstep/offer traffic).
    async fn next_job_reply(&mut self) -> ServerFrame {
        self.ws
            .recv_until(T, |f: &ServerFrame| match f {
                ServerFrame::JobLease { .. }
                | ServerFrame::JobRevoked { .. }
                | ServerFrame::JobAccepted { .. }
                | ServerFrame::JobRejected { .. }
                | ServerFrame::Error { .. } => Some(f.clone()),
                _ => None,
            })
            .await
            .unwrap()
    }

    async fn claim(&mut self, job_id: &str) -> ServerFrame {
        self.ws
            .send(&ClientFrame::JobClaim {
                job_id: job_id.into(),
            })
            .await
            .unwrap();
        self.next_job_reply().await
    }

    async fn result(&mut self, job_id: &str, artifact: &str) -> ServerFrame {
        self.ws
            .send(&ClientFrame::JobResult {
                job_id: job_id.into(),
                artifact_json: artifact.into(),
            })
            .await
            .unwrap();
        self.next_job_reply().await
    }
}

async fn enqueue(s: &TestServer, company: Uuid, tier: i16) -> Uuid {
    s.st.jobs
        .enqueue(
            &NewJob::new(
                "draft_article",
                Executor::Browser,
                json!({ "brief": "Sentiero Azzurro at dusk" }),
            )
            .company(company)
            .min_tier(tier)
            .max_attempts(5),
        )
        .await
        .unwrap()
        .id
}

#[sqlx::test(migrations = "./migrations")]
async fn offer_claim_progress_result(pool: PgPool) {
    let s = TestServer::start_with(
        pool,
        opts(Arc::new(TitleValidator), Duration::from_secs(30)),
    )
    .await;
    let (cookie, company) = s.player(1).await;

    // Queued before the worker connects: offered on WorkerHello ("morning rush").
    let early = enqueue(&s, company, 0).await;
    let mut w = FakeBrowserWorker::connect(&s, &cookie, 1).await;
    let (id, payload, attempt) = w.next_offer().await.unwrap();
    assert_eq!(id, early.to_string());
    assert_eq!(attempt, 1);
    assert_eq!(
        serde_json::from_str::<Value>(&payload).unwrap()["brief"],
        "Sentiero Azzurro at dusk"
    );

    // Enqueued while connected: offered via LISTEN/NOTIFY.
    let late = enqueue(&s, company, 0).await;
    let (id2, _, _) = w.next_offer().await.unwrap();
    assert_eq!(id2, late.to_string());

    match w.claim(&id).await {
        ServerFrame::JobLease { job_id, until_ms } => {
            assert_eq!(job_id, id);
            assert!(until_ms > chrono::Utc::now().timestamp_millis());
        }
        other => panic!("{other:?}"),
    }
    for tok in ["Last ", "light ", "on the path"] {
        w.ws.send(&ClientFrame::JobProgress {
            job_id: id.clone(),
            delta: tok.into(),
        })
        .await
        .unwrap();
    }
    let reply = w.result(&id, r#"{"title":"Last light","body":[]}"#).await;
    assert_eq!(reply, ServerFrame::JobAccepted { job_id: id.clone() });
    let row = s.st.jobs.get(early).await.unwrap().unwrap();
    assert_eq!(row.status, "succeeded");
    assert_eq!(row.result.unwrap()["title"], "Last light");
    assert_eq!(row.attempts, 1);

    // Results for jobs we never claimed are refused.
    let reply = w.result(&id2, r#"{"title":"x"}"#).await;
    assert!(matches!(reply, ServerFrame::JobRevoked { .. }), "{reply:?}");
    assert_eq!(s.st.jobs.get(late).await.unwrap().unwrap().status, "queued");
}

#[sqlx::test(migrations = "./migrations")]
async fn only_one_worker_wins_a_claim(pool: PgPool) {
    let s = TestServer::start_with(
        pool,
        opts(Arc::new(TitleValidator), Duration::from_secs(30)),
    )
    .await;
    let (cookie, company) = s.player(2).await;
    let mut a = FakeBrowserWorker::connect(&s, &cookie, 1).await;
    let mut b = FakeBrowserWorker::connect(&s, &cookie, 1).await;
    let job = enqueue(&s, company, 0).await.to_string();
    assert_eq!(a.next_offer().await.unwrap().0, job);
    assert_eq!(b.next_offer().await.unwrap().0, job);
    assert!(matches!(a.claim(&job).await, ServerFrame::JobLease { .. }));
    assert!(matches!(
        b.claim(&job).await,
        ServerFrame::JobRevoked { .. }
    ));

    // A tab that never sent WorkerHello cannot claim.
    let mut plain = s.ws(&cookie).await;
    let _: ServerFrame = plain.recv().await.unwrap();
    plain
        .send(&ClientFrame::JobClaim {
            job_id: job.clone(),
        })
        .await
        .unwrap();
    let r = plain
        .recv_until(T, |f: &ServerFrame| {
            matches!(f, ServerFrame::JobRevoked { .. }).then(|| f.clone())
        })
        .await
        .unwrap();
    assert!(matches!(r, ServerFrame::JobRevoked { reason, .. } if reason.contains("WorkerHello")));

    // Another company's worker never sees or claims it.
    let (other_cookie, _) = s.player(3).await;
    let mut o = FakeBrowserWorker::connect(&s, &other_cookie, 9).await;
    assert!(o
        .next_offer_within(Duration::from_millis(700))
        .await
        .is_err());
    assert!(matches!(
        o.claim(&job).await,
        ServerFrame::JobRevoked { .. }
    ));
}

#[sqlx::test(migrations = "./migrations")]
async fn invalid_artifact_is_rejected_and_requeued(pool: PgPool) {
    let s = TestServer::start_with(
        pool,
        opts(Arc::new(TitleValidator), Duration::from_secs(30)),
    )
    .await;
    let (cookie, company) = s.player(4).await;
    let mut w = FakeBrowserWorker::connect(&s, &cookie, 1).await;
    let job = enqueue(&s, company, 0).await;
    let id = w.next_offer().await.unwrap().0;
    assert!(matches!(w.claim(&id).await, ServerFrame::JobLease { .. }));

    // Validator rejects (schema), job goes back to the queue.
    match w.result(&id, r#"{"body":"no title"}"#).await {
        ServerFrame::JobRejected { job_id, reason } => {
            assert_eq!(job_id, id);
            assert!(reason.contains("title"), "{reason}");
        }
        other => panic!("{other:?}"),
    }
    let row = s.st.jobs.get(job).await.unwrap().unwrap();
    assert_eq!(row.status, "queued");
    assert!(row.error.unwrap().contains("invalid artifact"));
    assert!(row.result.is_none());

    // Re-offered as attempt 2; structural checks reject non-JSON outright.
    let (again, _, attempt) = w.next_offer().await.unwrap();
    assert_eq!((again.as_str(), attempt), (id.as_str(), 2));
    assert!(matches!(w.claim(&id).await, ServerFrame::JobLease { .. }));
    match w.result(&id, "<script>alert(1)</script>").await {
        ServerFrame::JobRejected { reason, .. } => {
            assert!(reason.contains("not valid JSON"), "{reason}")
        }
        other => panic!("{other:?}"),
    }

    // Third attempt succeeds.
    let (_, _, attempt) = w.next_offer().await.unwrap();
    assert_eq!(attempt, 3);
    assert!(matches!(w.claim(&id).await, ServerFrame::JobLease { .. }));
    assert!(matches!(
        w.result(&id, r#"{"title":"ok"}"#).await,
        ServerFrame::JobAccepted { .. }
    ));
    assert_eq!(
        s.st.jobs.get(job).await.unwrap().unwrap().status,
        "succeeded"
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn oversized_artifact_rejected_even_with_permissive_validator(pool: PgPool) {
    let mut o = opts(
        Arc::new(simpress_server::jobs::PermissiveValidator),
        Duration::from_secs(30),
    );
    let inner = std::mem::replace(&mut o.tweak, Box::new(|_| {}));
    o.tweak = Box::new(move |c| {
        inner(c);
        c.max_artifact_bytes = 64;
    });
    let s = TestServer::start_with(pool, o).await;
    let (cookie, company) = s.player(5).await;
    let mut w = FakeBrowserWorker::connect(&s, &cookie, 1).await;
    enqueue(&s, company, 0).await;
    let id = w.next_offer().await.unwrap().0;
    assert!(matches!(w.claim(&id).await, ServerFrame::JobLease { .. }));
    let big = format!(r#"{{"title":"{}"}}"#, "x".repeat(100));
    match w.result(&id, &big).await {
        ServerFrame::JobRejected { reason, .. } => assert!(reason.contains("limit"), "{reason}"),
        other => panic!("{other:?}"),
    }
    let _ = w.next_offer().await.unwrap();
    assert!(matches!(w.claim(&id).await, ServerFrame::JobLease { .. }));
    // Permissive validator accepts any well-formed object (and logs loudly).
    assert!(matches!(
        w.result(&id, r#"{"anything":1}"#).await,
        ServerFrame::JobAccepted { .. }
    ));
}

#[sqlx::test(migrations = "./migrations")]
async fn lease_expiry_requeues_to_another_worker(pool: PgPool) {
    let s = TestServer::start_with(
        pool,
        opts(Arc::new(TitleValidator), Duration::from_millis(300)),
    )
    .await;
    let (cookie, company) = s.player(6).await;
    let mut slow = FakeBrowserWorker::connect(&s, &cookie, 1).await;
    let job = enqueue(&s, company, 0).await;
    let id = slow.next_offer().await.unwrap().0;
    assert!(matches!(
        slow.claim(&id).await,
        ServerFrame::JobLease { .. }
    ));

    let mut fast = FakeBrowserWorker::connect(&s, &cookie, 1).await;
    tokio::time::sleep(Duration::from_millis(450)).await;
    let reaped = s.st.jobs.reap_expired().await.unwrap();
    assert_eq!(reaped.len(), 1);
    assert_eq!(reaped[0].0, job);

    // NOTIFY → re-offered as attempt 2; the other tab takes it.
    let (again, _, attempt) = fast.next_offer().await.unwrap();
    assert_eq!((again.as_str(), attempt), (id.as_str(), 2));
    assert!(matches!(
        fast.claim(&id).await,
        ServerFrame::JobLease { .. }
    ));

    // The slow worker's late result is fenced off.
    match slow.result(&id, r#"{"title":"late"}"#).await {
        ServerFrame::JobRevoked { reason, .. } => {
            assert!(reason.contains("lease lost"), "{reason}")
        }
        other => panic!("{other:?}"),
    }
    assert!(matches!(
        fast.result(&id, r#"{"title":"fast"}"#).await,
        ServerFrame::JobAccepted { .. }
    ));
    let row = s.st.jobs.get(job).await.unwrap().unwrap();
    assert_eq!(row.result.unwrap()["title"], "fast");
}

#[sqlx::test(migrations = "./migrations")]
async fn progress_extends_lease(pool: PgPool) {
    let s = TestServer::start_with(
        pool,
        opts(Arc::new(TitleValidator), Duration::from_millis(1000)),
    )
    .await;
    let (cookie, company) = s.player(7).await;
    let mut w = FakeBrowserWorker::connect(&s, &cookie, 1).await;
    let job = enqueue(&s, company, 0).await;
    let id = w.next_offer().await.unwrap().0;
    let first = match w.claim(&id).await {
        ServerFrame::JobLease { until_ms, .. } => until_ms,
        other => panic!("{other:?}"),
    };
    tokio::time::sleep(Duration::from_millis(650)).await;
    w.ws.send(&ClientFrame::JobProgress {
        job_id: id.clone(),
        delta: "tok".into(),
    })
    .await
    .unwrap();
    let second = match w.next_job_reply().await {
        ServerFrame::JobLease { until_ms, .. } => until_ms,
        other => panic!("{other:?}"),
    };
    assert!(second > first + 400, "lease extended: {first} → {second}");
    tokio::time::sleep(Duration::from_millis(500)).await;
    assert!(
        s.st.jobs.reap_expired().await.unwrap().is_empty(),
        "extended lease not reaped"
    );
    assert_eq!(s.st.jobs.get(job).await.unwrap().unwrap().status, "running");
}

#[sqlx::test(migrations = "./migrations")]
async fn disconnect_requeues_held_jobs(pool: PgPool) {
    let s = TestServer::start_with(
        pool,
        opts(Arc::new(TitleValidator), Duration::from_secs(30)),
    )
    .await;
    let (cookie, company) = s.player(8).await;
    let mut w = FakeBrowserWorker::connect(&s, &cookie, 1).await;
    let job = enqueue(&s, company, 0).await;
    let id = w.next_offer().await.unwrap().0;
    assert!(matches!(w.claim(&id).await, ServerFrame::JobLease { .. }));
    assert_eq!(s.st.jobs.get(job).await.unwrap().unwrap().status, "running");
    w.ws.close().await.unwrap();

    let deadline = tokio::time::Instant::now() + T;
    loop {
        let row = s.st.jobs.get(job).await.unwrap().unwrap();
        if row.status == "queued" {
            assert_eq!(row.error.as_deref(), Some("worker disconnected"));
            assert!(row.lease_owner.is_none());
            break;
        }
        assert!(
            tokio::time::Instant::now() < deadline,
            "not released: {row:?}"
        );
        tokio::time::sleep(Duration::from_millis(50)).await;
    }

    // Reconnecting drains the queue again.
    let mut w2 = FakeBrowserWorker::connect(&s, &cookie, 1).await;
    assert_eq!(w2.next_offer().await.unwrap().0, id);
}

#[sqlx::test(migrations = "./migrations")]
async fn jobs_above_device_tier_are_not_offered(pool: PgPool) {
    let s = TestServer::start_with(
        pool,
        opts(Arc::new(TitleValidator), Duration::from_secs(30)),
    )
    .await;
    let (cookie, company) = s.player(9).await;
    let mut low = FakeBrowserWorker::connect(&s, &cookie, 1).await;
    let heavy = enqueue(&s, company, 3).await.to_string();
    assert!(low
        .next_offer_within(Duration::from_millis(800))
        .await
        .is_err());
    assert!(matches!(
        low.claim(&heavy).await,
        ServerFrame::JobRevoked { .. }
    ));
    let mut high = FakeBrowserWorker::connect(&s, &cookie, 3).await;
    assert_eq!(high.next_offer().await.unwrap().0, heavy);
}
