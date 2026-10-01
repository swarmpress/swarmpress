//! Persistence for the event-sourced sim: command log + snapshots.
//!
//! [`PgStore`] is the production store. [`MemoryStore`] exists for actor tests
//! that run under `tokio::time::pause` (where real DB I/O and paused timers do
//! not mix) and must not be used in production.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use anyhow::{Context, Result};
use async_trait::async_trait;
use sqlx::{PgPool, Postgres, Row, Transaction};
use uuid::Uuid;

use crate::wire::CommandEntry;

/// Latest usable snapshot plus every command after it.
#[derive(Clone, Debug, Default)]
pub struct LoadedLog {
    /// (step, payload)
    pub snapshot: Option<(u64, Vec<u8>)>,
    /// Commands with `step >= snapshot step`, ordered by (step, seq).
    pub commands: Vec<CommandEntry>,
}

/// A command inserted inside an open transaction; commit = accepted.
#[async_trait]
pub trait PendingCommand: Send {
    async fn commit(self: Box<Self>) -> Result<()>;
    async fn rollback(self: Box<Self>) -> Result<()>;
}

#[async_trait]
pub trait SimStore: Send + Sync + 'static {
    /// Load the newest snapshot at or below `upto` (any if `None`) plus the
    /// commands after it (up to and including `upto`).
    async fn load(&self, company: Uuid, upto: Option<u64>) -> Result<LoadedLog>;
    /// Insert a command in a new transaction; the caller commits only once
    /// the simulation has accepted it.
    async fn begin_command(
        &self,
        company: Uuid,
        user: Option<Uuid>,
        entry: &CommandEntry,
    ) -> Result<Box<dyn PendingCommand>>;
    async fn save_snapshot(&self, company: Uuid, step: u64, hash: u64, bytes: &[u8]) -> Result<()>;
}

fn to_i64(v: u64) -> Result<i64> {
    i64::try_from(v).context("step out of i64 range")
}

#[derive(Clone)]
pub struct PgStore {
    pool: PgPool,
}

impl PgStore {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

struct PgPending {
    tx: Transaction<'static, Postgres>,
}

#[async_trait]
impl PendingCommand for PgPending {
    async fn commit(self: Box<Self>) -> Result<()> {
        self.tx.commit().await.context("commit sim command")
    }
    async fn rollback(self: Box<Self>) -> Result<()> {
        self.tx.rollback().await.context("rollback sim command")
    }
}

#[async_trait]
impl SimStore for PgStore {
    async fn load(&self, company: Uuid, upto: Option<u64>) -> Result<LoadedLog> {
        let upto = match upto {
            Some(u) => to_i64(u)?,
            None => i64::MAX,
        };
        let snap = sqlx::query(
            "SELECT step, payload FROM sim_snapshots
             WHERE company_id = $1 AND step <= $2
             ORDER BY step DESC LIMIT 1",
        )
        .bind(company)
        .bind(upto)
        .fetch_optional(&self.pool)
        .await
        .context("load snapshot")?;
        let snapshot = match snap {
            Some(row) => {
                let step: i64 = row.get("step");
                let payload: Vec<u8> = row.get("payload");
                Some((step as u64, payload))
            }
            None => None,
        };
        let from = snapshot.as_ref().map(|(s, _)| *s as i64).unwrap_or(0);
        let rows = sqlx::query(
            "SELECT step, seq, payload FROM sim_commands
             WHERE company_id = $1 AND step >= $2 AND step <= $3
             ORDER BY step, seq",
        )
        .bind(company)
        .bind(from)
        .bind(upto)
        .fetch_all(&self.pool)
        .await
        .context("load commands")?;
        let commands = rows
            .into_iter()
            .map(|r| CommandEntry {
                step: r.get::<i64, _>("step") as u64,
                seq: r.get::<i32, _>("seq") as u32,
                payload: r.get("payload"),
            })
            .collect();
        Ok(LoadedLog { snapshot, commands })
    }

    async fn begin_command(
        &self,
        company: Uuid,
        user: Option<Uuid>,
        entry: &CommandEntry,
    ) -> Result<Box<dyn PendingCommand>> {
        let mut tx = self.pool.begin().await.context("begin sim command tx")?;
        sqlx::query(
            "INSERT INTO sim_commands (company_id, step, seq, payload, user_id)
             VALUES ($1, $2, $3, $4, $5)",
        )
        .bind(company)
        .bind(to_i64(entry.step)?)
        .bind(i32::try_from(entry.seq).context("seq out of range")?)
        .bind(&entry.payload)
        .bind(user)
        .execute(&mut *tx)
        .await
        .context("insert sim command")?;
        Ok(Box::new(PgPending { tx }))
    }

    async fn save_snapshot(&self, company: Uuid, step: u64, hash: u64, bytes: &[u8]) -> Result<()> {
        sqlx::query(
            "INSERT INTO sim_snapshots (company_id, step, hash, payload)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (company_id, step) DO UPDATE SET hash = EXCLUDED.hash, payload = EXCLUDED.payload",
        )
        .bind(company)
        .bind(to_i64(step)?)
        .bind(hash as i64)
        .bind(bytes)
        .execute(&self.pool)
        .await
        .context("save snapshot")?;
        Ok(())
    }
}

/// In-memory store for tests (see module docs).
#[derive(Clone, Default)]
pub struct MemoryStore {
    inner: Arc<Mutex<MemInner>>,
}

#[derive(Default)]
struct MemInner {
    commands: BTreeMap<(Uuid, u64, u32), Vec<u8>>,
    snapshots: BTreeMap<(Uuid, u64), (u64, Vec<u8>)>,
    /// Make the next `begin_command` fail (to test persistence failures).
    fail_next_command: bool,
}

impl MemoryStore {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn command_count(&self, company: Uuid) -> usize {
        let g = self.inner.lock().expect("lock");
        g.commands.keys().filter(|(c, _, _)| *c == company).count()
    }

    pub fn snapshot_steps(&self, company: Uuid) -> Vec<u64> {
        let g = self.inner.lock().expect("lock");
        g.snapshots
            .keys()
            .filter(|(c, _)| *c == company)
            .map(|(_, s)| *s)
            .collect()
    }

    pub fn fail_next_command(&self) {
        self.inner.lock().expect("lock").fail_next_command = true;
    }
}

struct MemPending {
    inner: Arc<Mutex<MemInner>>,
    key: (Uuid, u64, u32),
    payload: Vec<u8>,
}

#[async_trait]
impl PendingCommand for MemPending {
    async fn commit(self: Box<Self>) -> Result<()> {
        let mut g = self.inner.lock().expect("lock");
        anyhow::ensure!(
            !g.commands.contains_key(&self.key),
            "duplicate command key {:?}",
            self.key
        );
        g.commands.insert(self.key, self.payload);
        Ok(())
    }
    async fn rollback(self: Box<Self>) -> Result<()> {
        Ok(())
    }
}

#[async_trait]
impl SimStore for MemoryStore {
    async fn load(&self, company: Uuid, upto: Option<u64>) -> Result<LoadedLog> {
        let upto = upto.unwrap_or(u64::MAX);
        let g = self.inner.lock().expect("lock");
        let snapshot = g
            .snapshots
            .range((company, 0)..=(company, upto))
            .next_back()
            .map(|((_, step), (_, bytes))| (*step, bytes.clone()));
        let from = snapshot.as_ref().map(|(s, _)| *s).unwrap_or(0);
        let commands = g
            .commands
            .range((company, from, 0)..=(company, upto, u32::MAX))
            .map(|((_, step, seq), p)| CommandEntry {
                step: *step,
                seq: *seq,
                payload: p.clone(),
            })
            .collect();
        Ok(LoadedLog { snapshot, commands })
    }

    async fn begin_command(
        &self,
        company: Uuid,
        _user: Option<Uuid>,
        entry: &CommandEntry,
    ) -> Result<Box<dyn PendingCommand>> {
        {
            let mut g = self.inner.lock().expect("lock");
            if std::mem::take(&mut g.fail_next_command) {
                anyhow::bail!("MemoryStore: injected command failure");
            }
        }
        Ok(Box::new(MemPending {
            inner: self.inner.clone(),
            key: (company, entry.step, entry.seq),
            payload: entry.payload.clone(),
        }))
    }

    async fn save_snapshot(&self, company: Uuid, step: u64, hash: u64, bytes: &[u8]) -> Result<()> {
        self.inner
            .lock()
            .expect("lock")
            .snapshots
            .insert((company, step), (hash, bytes.to_vec()));
        Ok(())
    }
}
