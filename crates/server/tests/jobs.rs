//! Postgres job queue: claim (SKIP LOCKED), leases, expiry → requeue,
//! idempotency, retry/backoff, dead letters, NOTIFY wakeups, Claude pool.

use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use serde_json::{json, Value};
use simpress_server::jobs::{
    spawn_claude_pool, ClaudeExecutor, Executor, FailOutcome, Job, JobNotifier, JobQueue, NewJob,
    RetryPolicy, UnconfiguredClaude,
};
use sqlx::PgPool;

fn queue(pool: &PgPool) -> JobQueue {
    JobQueue::new(
        pool.clone(),
        RetryPolicy {
            base: Duration::from_secs(10),
            max: Duration::from_secs(60),
        },
    )
}

const LEASE: Duration = Duration::from_secs(30);

#[sqlx::test(migrations = "./migrations")]
async fn claim_takes_highest_priority_ready_job_once(pool: PgPool) {
    let q = queue(&pool);
    let low = q
        .enqueue(&NewJob::new("research", Executor::Claude, json!({"n": 1})))
        .await
        .unwrap();
    let high = q
        .enqueue(&NewJob::new("research", Executor::Claude, json!({"n": 2})).priority(5))
        .await
        .unwrap();
    let mut later = NewJob::new("research", Executor::Claude, json!({}));
    later.delay = Duration::from_secs(3600);
    q.enqueue(&later).await.unwrap();
    q.enqueue(&NewJob::new("draft", Executor::Browser, json!({})))
        .await
        .unwrap();

    let a = q
        .claim_next(Executor::Claude, None, 0, "w1", LEASE)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(a.id, high.id);
    assert_eq!(a.status, "running");
    assert_eq!(a.attempts, 1);
    assert_eq!(a.lease_owner.as_deref(), Some("w1"));
    assert!(a.lease_until.is_some());
    let b = q
        .claim_next(Executor::Claude, None, 0, "w2", LEASE)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(b.id, low.id);
    // Delayed job not ready; browser job not routed to claude workers.
    assert!(q
        .claim_next(Executor::Claude, None, 0, "w3", LEASE)
        .await
        .unwrap()
        .is_none());
}

#[sqlx::test(migrations = "./migrations")]
async fn concurrent_claims_never_double_claim(pool: PgPool) {
    let q = queue(&pool);
    for i in 0..40 {
        q.enqueue(&NewJob::new("k", Executor::Claude, json!({ "i": i })))
            .await
            .unwrap();
    }
    let mut tasks = Vec::new();
    for w in 0..8 {
        let q = q.clone();
        tasks.push(tokio::spawn(async move {
            let mut got = Vec::new();
            while let Some(j) = q
                .claim_next(Executor::Claude, None, 0, &format!("w{w}"), LEASE)
                .await
                .unwrap()
            {
                got.push(j.id);
            }
            got
        }));
    }
    let mut all = Vec::new();
    for t in tasks {
        all.extend(t.await.unwrap());
    }
    let n = all.len();
    all.sort();
    all.dedup();
    assert_eq!(n, 40);
    assert_eq!(all.len(), 40, "a job was claimed twice");
}

#[sqlx::test(migrations = "./migrations")]
async fn tier_and_company_filters(pool: PgPool) {
    let q = queue(&pool);
    let u = simpress_server::db::upsert_github_user(&pool, 1, "x", None, None)
        .await
        .unwrap();
    let c = simpress_server::db::create_company(&pool, u.id, "C", 1, 60)
        .await
        .unwrap()
        .unwrap();
    let j = q
        .enqueue(
            &NewJob::new("draft", Executor::Browser, json!({}))
                .company(c.id)
                .min_tier(2),
        )
        .await
        .unwrap();
    assert!(q.list_offerable(c.id, 1, 10).await.unwrap().is_empty());
    assert_eq!(q.list_offerable(c.id, 2, 10).await.unwrap().len(), 1);
    assert!(q
        .claim(j.id, Executor::Browser, Some(c.id), 1, "w", LEASE)
        .await
        .unwrap()
        .is_none());
    assert!(q
        .claim(
            j.id,
            Executor::Browser,
            Some(uuid::Uuid::new_v4()),
            3,
            "w",
            LEASE
        )
        .await
        .unwrap()
        .is_none());
    assert!(q
        .claim(j.id, Executor::Browser, Some(c.id), 3, "w", LEASE)
        .await
        .unwrap()
        .is_some());
    assert!(q
        .claim(j.id, Executor::Browser, Some(c.id), 3, "w2", LEASE)
        .await
        .unwrap()
        .is_none());
}

#[sqlx::test(migrations = "./migrations")]
async fn idempotency_key_dedupes_enqueue(pool: PgPool) {
    let q = queue(&pool);
    let job = NewJob::new("publish", Executor::Claude, json!({"a": 1})).idempotency_key("pub:42");
    let a = q.enqueue(&job).await.unwrap();
    let b = q.enqueue(&job).await.unwrap();
    assert!(a.created);
    assert!(!b.created);
    assert_eq!(a.id, b.id);
    // Still deduped after the job ran.
    let j = q
        .claim_next(Executor::Claude, None, 0, "w", LEASE)
        .await
        .unwrap()
        .unwrap();
    q.complete(j.id, "w", &json!({"ok": true})).await.unwrap();
    let c = q.enqueue(&job).await.unwrap();
    assert_eq!(c.id, a.id);
    assert!(!c.created);
    let n: (i64,) = sqlx::query_as("SELECT count(*) FROM jobs")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(n.0, 1);
}

#[sqlx::test(migrations = "./migrations")]
async fn lease_expiry_requeues_and_old_owner_is_fenced(pool: PgPool) {
    let q = queue(&pool);
    let id = q
        .enqueue(&NewJob::new("k", Executor::Claude, json!({})))
        .await
        .unwrap()
        .id;
    let j = q
        .claim_next(Executor::Claude, None, 0, "slow", Duration::from_millis(50))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(j.id, id);
    assert!(
        q.reap_expired().await.unwrap().is_empty(),
        "not expired yet"
    );
    tokio::time::sleep(Duration::from_millis(120)).await;
    let reaped = q.reap_expired().await.unwrap();
    assert_eq!(reaped.len(), 1);
    assert!(matches!(reaped[0], (rid, FailOutcome::Requeued { .. }) if rid == id));
    let row = q.get(id).await.unwrap().unwrap();
    assert_eq!(row.status, "queued");
    assert_eq!(row.error.as_deref(), Some("lease expired"));
    assert!(row.lease_owner.is_none());

    // The expired worker can no longer complete, extend or fail it.
    assert!(!q.complete(id, "slow", &json!({})).await.unwrap());
    assert!(q.extend_lease(id, "slow", LEASE).await.unwrap().is_none());
    assert!(q.fail(id, "slow", "x").await.unwrap().is_none());
}

#[sqlx::test(migrations = "./migrations")]
async fn retry_backoff_then_dead(pool: PgPool) {
    let q = queue(&pool);
    let id = q
        .enqueue(&NewJob::new("k", Executor::Claude, json!({})).max_attempts(3))
        .await
        .unwrap()
        .id;
    let mut delays = Vec::new();
    for attempt in 1..=3 {
        // Make it ready regardless of backoff.
        sqlx::query("UPDATE jobs SET run_after = now() WHERE id = $1")
            .bind(id)
            .execute(&pool)
            .await
            .unwrap();
        let j = q
            .claim_next(Executor::Claude, None, 0, "w", LEASE)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(j.attempts, attempt);
        let out = q
            .fail(id, "w", &format!("boom {attempt}"))
            .await
            .unwrap()
            .unwrap();
        match out {
            FailOutcome::Requeued { run_after } => {
                let d = (run_after - chrono::Utc::now()).num_milliseconds();
                delays.push(d);
                // Not claimable before backoff elapses.
                assert!(q
                    .claim_next(Executor::Claude, None, 0, "w", LEASE)
                    .await
                    .unwrap()
                    .is_none());
            }
            FailOutcome::Dead => assert_eq!(attempt, 3),
        }
    }
    // 10 s then 20 s (base 10 s, doubling).
    assert_eq!(delays.len(), 2);
    assert!((9_000..=10_500).contains(&delays[0]), "{delays:?}");
    assert!((19_000..=20_500).contains(&delays[1]), "{delays:?}");
    let row = q.get(id).await.unwrap().unwrap();
    assert_eq!(row.status, "dead");
    assert_eq!(row.error.as_deref(), Some("boom 3"));
}

#[sqlx::test(migrations = "./migrations")]
async fn notify_wakes_listeners(pool: PgPool) {
    let (notifier, task) = JobNotifier::start(&pool).await.unwrap();
    let mut rx = notifier.subscribe();
    let q = queue(&pool);
    let company = None;
    q.enqueue(&NewJob::new("k", Executor::Browser, json!({})))
        .await
        .unwrap();
    let n = tokio::time::timeout(Duration::from_secs(5), rx.recv())
        .await
        .expect("notice")
        .unwrap();
    assert_eq!(n.executor, "browser");
    assert_eq!(n.company_id, company);
    task.abort();
}

struct EchoClaude;

#[async_trait]
impl ClaudeExecutor for EchoClaude {
    async fn execute(&self, job: &Job) -> Result<Value, String> {
        Ok(json!({ "echo": job.payload }))
    }
}

async fn wait_status(q: &JobQueue, id: uuid::Uuid, pred: impl Fn(&Job) -> bool) -> Job {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
    loop {
        let j = q.get(id).await.unwrap().unwrap();
        if pred(&j) {
            return j;
        }
        assert!(tokio::time::Instant::now() < deadline, "timed out: {j:?}");
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

#[sqlx::test(migrations = "./migrations")]
async fn claude_pool_runs_jobs_woken_by_notify(pool: PgPool) {
    let (notifier, ntask) = JobNotifier::start(&pool).await.unwrap();
    let q = queue(&pool);
    // Long poll interval: completion within the deadline proves NOTIFY woke it.
    let pool_task = spawn_claude_pool(
        q.clone(),
        Arc::new(EchoClaude),
        notifier,
        2,
        LEASE,
        Duration::from_secs(60),
    );
    tokio::time::sleep(Duration::from_millis(200)).await;
    let id = q
        .enqueue(&NewJob::new(
            "research",
            Executor::Claude,
            json!({"q": "cinque terre"}),
        ))
        .await
        .unwrap()
        .id;
    let j = wait_status(&q, id, |j| j.status == "succeeded").await;
    assert_eq!(j.result, Some(json!({"echo": {"q": "cinque terre"}})));
    // Browser jobs are never picked up by the Claude pool.
    let b = q
        .enqueue(&NewJob::new("draft", Executor::Browser, json!({})))
        .await
        .unwrap()
        .id;
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert_eq!(q.get(b).await.unwrap().unwrap().status, "queued");
    pool_task.abort();
    ntask.abort();
}

#[sqlx::test(migrations = "./migrations")]
async fn unconfigured_claude_fails_loudly(pool: PgPool) {
    let q = queue(&pool);
    let pool_task = spawn_claude_pool(
        q.clone(),
        Arc::new(UnconfiguredClaude),
        JobNotifier::detached(),
        1,
        LEASE,
        Duration::from_millis(50),
    );
    let id = q
        .enqueue(&NewJob::new("research", Executor::Claude, json!({})).max_attempts(1))
        .await
        .unwrap()
        .id;
    let j = wait_status(&q, id, |j| j.status == "dead").await;
    assert!(j.error.unwrap().contains("not implemented"));
    pool_task.abort();
}
