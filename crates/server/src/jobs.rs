//! Durable job queue on Postgres.
//!
//! - Claiming uses `SELECT ... FOR UPDATE SKIP LOCKED` so any number of
//!   workers (server tasks, browser tabs via WS) can claim concurrently.
//! - Every claim takes a lease (`lease_owner`, `lease_until`) and counts an
//!   attempt. Failing or letting the lease expire re-queues with exponential
//!   backoff until `max_attempts`, after which the job is `dead`.
//! - `idempotency_key` (UNIQUE) makes enqueue safe to retry.
//! - Enqueue / requeue fire `NOTIFY simpress_jobs` so idle workers wake up.
//! - Executor routing: `claude` jobs go to the in-process [`ClaudeExecutor`]
//!   pool; `browser` jobs are offered to the company's WS worker.

use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, Result};
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::postgres::PgListener;
use sqlx::{FromRow, PgPool};
use tokio::sync::{broadcast, Semaphore};
use tokio::task::JoinHandle;
use uuid::Uuid;

pub const NOTIFY_CHANNEL: &str = "simpress_jobs";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Executor {
    Browser,
    Claude,
}

impl Executor {
    pub fn as_str(self) -> &'static str {
        match self {
            Executor::Browser => "browser",
            Executor::Claude => "claude",
        }
    }
}

#[derive(Clone, Debug, FromRow, Serialize)]
pub struct Job {
    pub id: Uuid,
    pub company_id: Option<Uuid>,
    pub kind: String,
    pub executor: String,
    pub min_tier: i16,
    pub priority: i32,
    pub payload: Value,
    pub status: String,
    pub attempts: i32,
    pub max_attempts: i32,
    pub run_after: DateTime<Utc>,
    pub lease_owner: Option<String>,
    pub lease_until: Option<DateTime<Utc>>,
    pub idempotency_key: Option<String>,
    pub result: Option<Value>,
    pub error: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// (id, status, run_after, company_id, executor) returned by requeue updates.
type RequeueRow = (Uuid, String, DateTime<Utc>, Option<Uuid>, String);

const JOB_COLS: &str = "id, company_id, kind, executor, min_tier, priority, payload, status, attempts, \
     max_attempts, run_after, lease_owner, lease_until, idempotency_key, result, error, created_at, updated_at";

#[derive(Clone, Debug)]
pub struct NewJob {
    pub company_id: Option<Uuid>,
    pub kind: String,
    pub executor: Executor,
    pub min_tier: i16,
    pub priority: i32,
    pub payload: Value,
    pub max_attempts: i32,
    pub idempotency_key: Option<String>,
    /// Delay before the job becomes claimable.
    pub delay: Duration,
}

impl NewJob {
    pub fn new(kind: impl Into<String>, executor: Executor, payload: Value) -> Self {
        Self {
            company_id: None,
            kind: kind.into(),
            executor,
            min_tier: 0,
            priority: 0,
            payload,
            max_attempts: 5,
            idempotency_key: None,
            delay: Duration::ZERO,
        }
    }
    pub fn company(mut self, id: Uuid) -> Self {
        self.company_id = Some(id);
        self
    }
    pub fn idempotency_key(mut self, key: impl Into<String>) -> Self {
        self.idempotency_key = Some(key.into());
        self
    }
    pub fn max_attempts(mut self, n: i32) -> Self {
        self.max_attempts = n;
        self
    }
    pub fn min_tier(mut self, t: i16) -> Self {
        self.min_tier = t;
        self
    }
    pub fn priority(mut self, p: i32) -> Self {
        self.priority = p;
        self
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Enqueued {
    pub id: Uuid,
    /// False when an existing job with the same idempotency key was returned.
    pub created: bool,
}

/// Exponential backoff: `base * 2^(attempt-1)`, capped at `max`.
#[derive(Clone, Copy, Debug)]
pub struct RetryPolicy {
    pub base: Duration,
    pub max: Duration,
}

impl Default for RetryPolicy {
    fn default() -> Self {
        Self {
            base: Duration::from_secs(5),
            max: Duration::from_secs(600),
        }
    }
}

impl RetryPolicy {
    pub fn backoff(&self, attempts: u32) -> Duration {
        let shift = attempts.saturating_sub(1).min(30);
        self.base.saturating_mul(1u32 << shift).min(self.max)
    }
    fn base_ms(&self) -> i64 {
        i64::try_from(self.base.as_millis()).unwrap_or(i64::MAX)
    }
    fn max_ms(&self) -> i64 {
        i64::try_from(self.max.as_millis()).unwrap_or(i64::MAX)
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum FailOutcome {
    Requeued { run_after: DateTime<Utc> },
    Dead,
}

fn ms(d: Duration) -> i64 {
    i64::try_from(d.as_millis()).unwrap_or(i64::MAX)
}

#[derive(Clone)]
pub struct JobQueue {
    pool: PgPool,
    retry: RetryPolicy,
}

impl JobQueue {
    pub fn new(pool: PgPool, retry: RetryPolicy) -> Self {
        Self { pool, retry }
    }

    pub fn pool(&self) -> &PgPool {
        &self.pool
    }

    pub fn retry(&self) -> RetryPolicy {
        self.retry
    }

    pub async fn enqueue(&self, job: &NewJob) -> Result<Enqueued> {
        let mut tx = self.pool.begin().await?;
        let inserted: Option<(Uuid,)> = sqlx::query_as(
            "INSERT INTO jobs (company_id, kind, executor, min_tier, priority, payload,
                               max_attempts, idempotency_key, run_after)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now() + ($9::bigint * interval '1 millisecond'))
             ON CONFLICT (idempotency_key) DO NOTHING
             RETURNING id",
        )
        .bind(job.company_id)
        .bind(&job.kind)
        .bind(job.executor.as_str())
        .bind(job.min_tier)
        .bind(job.priority)
        .bind(&job.payload)
        .bind(job.max_attempts)
        .bind(&job.idempotency_key)
        .bind(ms(job.delay))
        .fetch_optional(&mut *tx)
        .await
        .context("insert job")?;
        let out = match inserted {
            Some((id,)) => {
                notify(&mut *tx, job.company_id, job.executor.as_str()).await?;
                Enqueued { id, created: true }
            }
            None => {
                let key = job
                    .idempotency_key
                    .as_deref()
                    .context("insert conflicted without an idempotency key")?;
                let (id,): (Uuid,) =
                    sqlx::query_as("SELECT id FROM jobs WHERE idempotency_key = $1")
                        .bind(key)
                        .fetch_one(&mut *tx)
                        .await
                        .context("load idempotent job")?;
                Enqueued { id, created: false }
            }
        };
        tx.commit().await?;
        Ok(out)
    }

    pub async fn get(&self, id: Uuid) -> Result<Option<Job>> {
        Ok(
            sqlx::query_as::<_, Job>(&format!("SELECT {JOB_COLS} FROM jobs WHERE id = $1"))
                .bind(id)
                .fetch_optional(&self.pool)
                .await?,
        )
    }

    /// Claim the best ready job for `executor` (optionally one company's),
    /// skipping rows other workers have locked.
    pub async fn claim_next(
        &self,
        executor: Executor,
        company: Option<Uuid>,
        max_tier: i16,
        owner: &str,
        lease: Duration,
    ) -> Result<Option<Job>> {
        let sql = format!(
            "UPDATE jobs SET status = 'running', attempts = attempts + 1, lease_owner = $4,
                    lease_until = now() + ($5::bigint * interval '1 millisecond'), updated_at = now()
             WHERE id = (
                SELECT id FROM jobs
                WHERE status = 'queued' AND executor = $1 AND run_after <= now()
                  AND ($2::uuid IS NULL OR company_id = $2) AND min_tier <= $3
                ORDER BY priority DESC, run_after, created_at
                FOR UPDATE SKIP LOCKED
                LIMIT 1)
             RETURNING {JOB_COLS}"
        );
        sqlx::query_as::<_, Job>(&sql)
            .bind(executor.as_str())
            .bind(company)
            .bind(max_tier)
            .bind(owner)
            .bind(ms(lease))
            .fetch_optional(&self.pool)
            .await
            .context("claim_next")
    }

    /// Claim one specific job (a browser `JobClaim`). `None` if it is not
    /// claimable by this worker (already claimed, not ready, tier too low,
    /// wrong company/executor).
    pub async fn claim(
        &self,
        id: Uuid,
        executor: Executor,
        company: Option<Uuid>,
        max_tier: i16,
        owner: &str,
        lease: Duration,
    ) -> Result<Option<Job>> {
        let sql = format!(
            "UPDATE jobs SET status = 'running', attempts = attempts + 1, lease_owner = $5,
                    lease_until = now() + ($6::bigint * interval '1 millisecond'), updated_at = now()
             WHERE id = $1 AND status = 'queued' AND executor = $2 AND run_after <= now()
               AND company_id IS NOT DISTINCT FROM $3 AND min_tier <= $4
             RETURNING {JOB_COLS}"
        );
        sqlx::query_as::<_, Job>(&sql)
            .bind(id)
            .bind(executor.as_str())
            .bind(company)
            .bind(max_tier)
            .bind(owner)
            .bind(ms(lease))
            .fetch_optional(&self.pool)
            .await
            .context("claim")
    }

    /// Extend a held lease. `None` if the lease is no longer ours.
    pub async fn extend_lease(
        &self,
        id: Uuid,
        owner: &str,
        lease: Duration,
    ) -> Result<Option<DateTime<Utc>>> {
        let row: Option<(DateTime<Utc>,)> = sqlx::query_as(
            "UPDATE jobs SET lease_until = now() + ($3::bigint * interval '1 millisecond'), updated_at = now()
             WHERE id = $1 AND status = 'running' AND lease_owner = $2
             RETURNING lease_until",
        )
        .bind(id)
        .bind(owner)
        .bind(ms(lease))
        .fetch_optional(&self.pool)
        .await
        .context("extend_lease")?;
        Ok(row.map(|r| r.0))
    }

    /// Mark a leased job succeeded. False if the lease was lost meanwhile.
    pub async fn complete(&self, id: Uuid, owner: &str, result: &Value) -> Result<bool> {
        let done = sqlx::query(
            "UPDATE jobs SET status = 'succeeded', result = $3, error = NULL,
                    lease_owner = NULL, lease_until = NULL, updated_at = now()
             WHERE id = $1 AND status = 'running' AND lease_owner = $2",
        )
        .bind(id)
        .bind(owner)
        .bind(result)
        .execute(&self.pool)
        .await
        .context("complete")?;
        Ok(done.rows_affected() == 1)
    }

    /// Fail a leased job: re-queue with backoff, or `dead` after max attempts.
    /// `None` if the lease was not ours.
    pub async fn fail(&self, id: Uuid, owner: &str, error: &str) -> Result<Option<FailOutcome>> {
        let row: Option<(String, DateTime<Utc>, Option<Uuid>, String)> = sqlx::query_as(&format!(
            "UPDATE jobs SET {} WHERE id = $1 AND status = 'running' AND lease_owner = $2
             RETURNING status, run_after, company_id, executor",
            fail_set(3, 4, 5)
        ))
        .bind(id)
        .bind(owner)
        .bind(error)
        .bind(self.retry.base_ms())
        .bind(self.retry.max_ms())
        .fetch_optional(&self.pool)
        .await
        .context("fail")?;
        match row {
            None => Ok(None),
            Some((status, run_after, company, executor)) => {
                if status == "queued" {
                    notify(&self.pool, company, &executor).await?;
                    Ok(Some(FailOutcome::Requeued { run_after }))
                } else {
                    tracing::warn!(job_id = %id, error, "job is dead after max attempts");
                    Ok(Some(FailOutcome::Dead))
                }
            }
        }
    }

    /// Re-queue (with backoff) every running job whose lease has expired.
    pub async fn reap_expired(&self) -> Result<Vec<(Uuid, FailOutcome)>> {
        let rows: Vec<RequeueRow> = sqlx::query_as(&format!(
            "UPDATE jobs SET {} WHERE status = 'running' AND lease_until < now()
             RETURNING id, status, run_after, company_id, executor",
            fail_set(1, 2, 3)
        ))
        .bind("lease expired")
        .bind(self.retry.base_ms())
        .bind(self.retry.max_ms())
        .fetch_all(&self.pool)
        .await
        .context("reap_expired")?;
        self.after_requeue(rows).await
    }

    /// Release every job leased by `owner` (worker disconnected). Counts as a
    /// failed attempt, but re-queues without backoff.
    pub async fn release_owner(&self, owner: &str) -> Result<Vec<(Uuid, FailOutcome)>> {
        let rows: Vec<RequeueRow> = sqlx::query_as(&format!(
            "UPDATE jobs SET {} WHERE status = 'running' AND lease_owner = $1
             RETURNING id, status, run_after, company_id, executor",
            fail_set(2, 3, 4)
        ))
        .bind(owner)
        .bind("worker disconnected")
        .bind(0i64)
        .bind(0i64)
        .fetch_all(&self.pool)
        .await
        .context("release_owner")?;
        self.after_requeue(rows).await
    }

    async fn after_requeue(&self, rows: Vec<RequeueRow>) -> Result<Vec<(Uuid, FailOutcome)>> {
        let mut out = Vec::with_capacity(rows.len());
        for (id, status, run_after, company, executor) in rows {
            if status == "queued" {
                tracing::info!(job_id = %id, %run_after, "job re-queued");
                notify(&self.pool, company, &executor).await?;
                out.push((id, FailOutcome::Requeued { run_after }));
            } else {
                tracing::warn!(job_id = %id, "job is dead after max attempts");
                out.push((id, FailOutcome::Dead));
            }
        }
        Ok(out)
    }

    /// Ready browser jobs a worker of `company` at `tier` could claim.
    pub async fn list_offerable(
        &self,
        company: Uuid,
        max_tier: i16,
        limit: i64,
    ) -> Result<Vec<Job>> {
        sqlx::query_as::<_, Job>(&format!(
            "SELECT {JOB_COLS} FROM jobs
             WHERE status = 'queued' AND executor = 'browser' AND company_id = $1
               AND min_tier <= $2 AND run_after <= now()
             ORDER BY priority DESC, run_after, created_at
             LIMIT $3"
        ))
        .bind(company)
        .bind(max_tier)
        .bind(limit)
        .fetch_all(&self.pool)
        .await
        .context("list_offerable")
    }
}

/// Shared SET clause for fail / reap / release, with the bind positions of the
/// error text, backoff base (ms) and backoff cap (ms).
/// Note: `attempts` was already incremented at claim time.
fn fail_set(err: u8, base: u8, max: u8) -> String {
    format!(
        "status = CASE WHEN attempts >= max_attempts THEN 'dead' ELSE 'queued' END,
         run_after = CASE WHEN attempts >= max_attempts THEN run_after
                     ELSE now() + (LEAST(${base}::bigint * (1::bigint << LEAST(GREATEST(attempts - 1, 0), 30)), ${max}::bigint)
                                   * interval '1 millisecond') END,
         lease_owner = NULL, lease_until = NULL, error = ${err}, updated_at = now()"
    )
}

async fn notify<'e, E>(exec: E, company: Option<Uuid>, executor: &str) -> Result<()>
where
    E: sqlx::PgExecutor<'e>,
{
    let payload = serde_json::json!({ "company_id": company, "executor": executor }).to_string();
    sqlx::query("SELECT pg_notify($1, $2)")
        .bind(NOTIFY_CHANNEL)
        .bind(payload)
        .execute(exec)
        .await
        .context("pg_notify")?;
    Ok(())
}

/// A wake-up for workers: something became claimable.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
pub struct JobNotice {
    pub company_id: Option<Uuid>,
    pub executor: String,
}

/// Fans `LISTEN simpress_jobs` out to in-process subscribers.
#[derive(Clone)]
pub struct JobNotifier {
    tx: broadcast::Sender<JobNotice>,
}

impl JobNotifier {
    /// A notifier with no Postgres listener (only [`JobNotifier::publish`]).
    pub fn detached() -> Self {
        Self {
            tx: broadcast::channel(256).0,
        }
    }

    pub async fn start(pool: &PgPool) -> Result<(Self, JoinHandle<()>)> {
        let mut listener = PgListener::connect_with(pool).await.context("PgListener")?;
        listener.listen(NOTIFY_CHANNEL).await.context("LISTEN")?;
        let me = Self::detached();
        let tx = me.tx.clone();
        let join = tokio::spawn(async move {
            loop {
                match listener.recv().await {
                    Ok(n) => match serde_json::from_str::<JobNotice>(n.payload()) {
                        Ok(notice) => {
                            let _ = tx.send(notice);
                        }
                        Err(e) => {
                            tracing::warn!(error = %e, payload = n.payload(), "bad job notice")
                        }
                    },
                    Err(e) => {
                        // PgListener reconnects on the next recv().
                        tracing::warn!(error = %e, "job LISTEN connection error; reconnecting");
                        tokio::time::sleep(Duration::from_secs(1)).await;
                    }
                }
            }
        });
        Ok((me, join))
    }

    pub fn subscribe(&self) -> broadcast::Receiver<JobNotice> {
        self.tx.subscribe()
    }

    pub fn publish(&self, notice: JobNotice) {
        let _ = self.tx.send(notice);
    }
}

/// Periodically re-queue jobs whose lease expired.
pub fn spawn_reaper(queue: JobQueue, every: Duration) -> JoinHandle<()> {
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(every);
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            tick.tick().await;
            if let Err(e) = queue.reap_expired().await {
                tracing::error!(error = %e, "lease reaper failed");
            }
        }
    })
}

// ---------------------------------------------------------------------------
// Artifact validation (browser results)
// ---------------------------------------------------------------------------

/// Validates artifacts returned by browser workers before they are stored.
/// The server never trusts client output (ADR-0025).
pub trait ArtifactValidator: Send + Sync + 'static {
    fn validate(&self, job: &Job, artifact: &Value) -> Result<(), String>;
}

/// STUB: accepts every well-formed artifact. Logged loudly on every use until
/// real per-kind schema / closed-world validation lands.
pub struct PermissiveValidator;

impl ArtifactValidator for PermissiveValidator {
    fn validate(&self, job: &Job, _artifact: &Value) -> Result<(), String> {
        tracing::warn!(job_id = %job.id, kind = %job.kind,
            "PermissiveValidator: artifact accepted WITHOUT schema/closed-world/safety validation (stub)");
        Ok(())
    }
}

/// Structural checks every artifact must pass regardless of validator:
/// size limit, valid JSON, top-level object.
pub fn parse_artifact(text: &str, max_bytes: usize) -> Result<Value, String> {
    if text.len() > max_bytes {
        return Err(format!(
            "artifact is {} bytes, limit is {max_bytes}",
            text.len()
        ));
    }
    let v: Value =
        serde_json::from_str(text).map_err(|e| format!("artifact is not valid JSON: {e}"))?;
    if !v.is_object() {
        return Err("artifact must be a JSON object".into());
    }
    Ok(v)
}

// ---------------------------------------------------------------------------
// Claude executor pool
// ---------------------------------------------------------------------------

#[async_trait]
pub trait ClaudeExecutor: Send + Sync + 'static {
    async fn execute(&self, job: &Job) -> Result<Value, String>;
}

/// STUB: the Claude runtime is not wired yet. Every job fails loudly (and is
/// retried with backoff until dead) rather than pretending to succeed.
pub struct UnconfiguredClaude;

#[async_trait]
impl ClaudeExecutor for UnconfiguredClaude {
    async fn execute(&self, job: &Job) -> Result<Value, String> {
        tracing::error!(job_id = %job.id, kind = %job.kind,
            "ClaudeExecutor is not implemented: failing Claude job");
        Err("not implemented: ClaudeExecutor".into())
    }
}

/// Runs claude jobs with bounded concurrency, extending leases while they run.
pub fn spawn_claude_pool(
    queue: JobQueue,
    executor: Arc<dyn ClaudeExecutor>,
    notifier: JobNotifier,
    concurrency: usize,
    lease: Duration,
    poll: Duration,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        let sem = Arc::new(Semaphore::new(concurrency.max(1)));
        let owner = format!("claude:{}", Uuid::new_v4());
        let mut notices = notifier.subscribe();
        loop {
            let permit = match sem.clone().acquire_owned().await {
                Ok(p) => p,
                Err(_) => return,
            };
            match queue
                .claim_next(Executor::Claude, None, i16::MAX, &owner, lease)
                .await
            {
                Ok(Some(job)) => {
                    let queue = queue.clone();
                    let executor = executor.clone();
                    let owner = owner.clone();
                    tokio::spawn(async move {
                        run_claude_job(&queue, executor.as_ref(), &owner, lease, job).await;
                        drop(permit);
                    });
                }
                Ok(None) => {
                    drop(permit);
                    // Sleep until a claude notice or the poll interval.
                    let _ = tokio::time::timeout(poll, async {
                        loop {
                            match notices.recv().await {
                                Ok(n) if n.executor == "claude" => break,
                                Ok(_) => continue,
                                Err(broadcast::error::RecvError::Lagged(_)) => break,
                                Err(broadcast::error::RecvError::Closed) => {
                                    std::future::pending::<()>().await
                                }
                            }
                        }
                    })
                    .await;
                }
                Err(e) => {
                    drop(permit);
                    tracing::error!(error = %e, "claude pool: claim failed");
                    tokio::time::sleep(poll).await;
                }
            }
        }
    })
}

async fn run_claude_job(
    queue: &JobQueue,
    executor: &dyn ClaudeExecutor,
    owner: &str,
    lease: Duration,
    job: Job,
) {
    let id = job.id;
    let heartbeat = async {
        let mut t = tokio::time::interval((lease / 3).max(Duration::from_millis(100)));
        t.tick().await;
        loop {
            t.tick().await;
            match queue.extend_lease(id, owner, lease).await {
                Ok(Some(_)) => {}
                Ok(None) => {
                    tracing::warn!(job_id = %id, "lost lease on claude job");
                    return;
                }
                Err(e) => tracing::warn!(job_id = %id, error = %e, "lease extension failed"),
            }
        }
    };
    let outcome = tokio::select! {
        r = executor.execute(&job) => Some(r),
        _ = heartbeat => None,
    };
    let res = match outcome {
        None => return,
        Some(Ok(v)) => queue.complete(id, owner, &v).await.map(|_| ()),
        Some(Err(e)) => queue.fail(id, owner, &e).await.map(|_| ()),
    };
    if let Err(e) = res {
        tracing::error!(job_id = %id, error = %e, "could not record claude job outcome");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backoff_doubles_and_caps() {
        let p = RetryPolicy {
            base: Duration::from_secs(2),
            max: Duration::from_secs(30),
        };
        assert_eq!(p.backoff(1), Duration::from_secs(2));
        assert_eq!(p.backoff(2), Duration::from_secs(4));
        assert_eq!(p.backoff(4), Duration::from_secs(16));
        assert_eq!(p.backoff(5), Duration::from_secs(30));
        assert_eq!(p.backoff(500), Duration::from_secs(30));
    }

    #[test]
    fn artifact_structural_checks() {
        assert!(parse_artifact("{\"a\":1}", 100).is_ok());
        assert!(parse_artifact("not json", 100)
            .unwrap_err()
            .contains("not valid JSON"));
        assert!(parse_artifact("[1]", 100).unwrap_err().contains("object"));
        assert!(parse_artifact("{\"a\":\"xxxxxxxxxxxx\"}", 10)
            .unwrap_err()
            .contains("limit"));
    }

    #[test]
    fn executor_serde_is_lowercase() {
        assert_eq!(
            serde_json::to_string(&Executor::Browser).unwrap(),
            "\"browser\""
        );
        assert_eq!(Executor::Claude.as_str(), "claude");
    }
}
