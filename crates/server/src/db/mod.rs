//! SQLite access (ADR-0039). Every SQL statement of the server lives in this
//! module tree (repository functions), never in HTTP handlers, and uses the
//! plain SQLite subset Turso also accepts (ADR-0041): no extensions, virtual
//! tables, FTS, generated columns or triggers; JSON1 is fine.
//!
//! Concurrency: one **writer** pool with a single connection (SQLite has one
//! writer; queuing on the pool is the write queue) and a **reader** pool of
//! read-only connections that run in parallel under WAL. Ledger-style
//! mutations that must read-check-write atomically use
//! [`Db::begin_immediate`].
//!
//! Runtime-checked queries only (no `query!` macros), so building needs no
//! database. Conventions: TEXT uuid ids, INTEGER unix-ms instants, TEXT
//! `YYYY-MM-DD` days.

pub mod accounts;
pub mod events;
pub mod gateway;
pub mod sync;
pub mod tracker;

use std::str::FromStr;
use std::time::Duration;

use anyhow::{Context, Result};
use sqlx::sqlite::{
    SqliteConnectOptions, SqliteJournalMode, SqlitePool, SqlitePoolOptions, SqliteSynchronous,
};
use sqlx::{Sqlite, Transaction};

pub use accounts::{Company, Lease, LeaseOutcome, User};

pub static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations");

/// The central database: a single-connection writer pool and a reader pool.
#[derive(Clone, Debug)]
pub struct Db {
    /// All writes (and reads that must see a write in the same request).
    pub writer: SqlitePool,
    /// Read-only connections. For in-memory databases this is the writer.
    pub reader: SqlitePool,
}

fn is_memory(url: &str) -> bool {
    url.contains(":memory:") || url.contains("mode=memory")
}

impl Db {
    /// Open (creating if needed, with `?mode=rwc`) the database at `url`,
    /// e.g. `sqlite://data/simpress.db?mode=rwc`. WAL, `foreign_keys=ON`,
    /// `synchronous=NORMAL`, 5 s busy timeout. Does not migrate.
    pub async fn connect(url: &str) -> Result<Self> {
        let base = SqliteConnectOptions::from_str(url)
            .with_context(|| format!("parse DATABASE_URL {url:?}"))?
            .foreign_keys(true)
            .busy_timeout(Duration::from_secs(5));
        if is_memory(url) {
            // Every connection to `:memory:` is its own database: one
            // connection serves both roles (no WAL for memory databases).
            let pool = SqlitePoolOptions::new()
                .max_connections(1)
                .min_connections(1)
                .idle_timeout(None)
                .max_lifetime(None)
                .connect_with(base)
                .await
                .context("open in-memory SQLite")?;
            return Ok(Self {
                writer: pool.clone(),
                reader: pool,
            });
        }
        if let Some(parent) = base.get_filename().parent() {
            if !parent.as_os_str().is_empty() {
                std::fs::create_dir_all(parent)
                    .with_context(|| format!("create {}", parent.display()))?;
            }
        }
        let writer_opts = base
            .clone()
            .journal_mode(SqliteJournalMode::Wal)
            .synchronous(SqliteSynchronous::Normal)
            .create_if_missing(true);
        let writer = SqlitePoolOptions::new()
            .max_connections(1)
            .acquire_timeout(Duration::from_secs(30))
            .connect_with(writer_opts)
            .await
            .context("open SQLite writer (DATABASE_URL)")?;
        let reader = SqlitePoolOptions::new()
            .max_connections(8)
            .acquire_timeout(Duration::from_secs(10))
            .connect_lazy_with(base.read_only(true).create_if_missing(false));
        Ok(Self { writer, reader })
    }

    /// A fresh private in-memory database, migrated (tests, tools).
    pub async fn memory() -> Result<Self> {
        let db = Self::connect("sqlite::memory:").await?;
        db.migrate().await?;
        Ok(db)
    }

    pub async fn migrate(&self) -> Result<()> {
        MIGRATOR.run(&self.writer).await.context("run migrations")
    }

    /// A write transaction that takes SQLite's write lock up front
    /// (`BEGIN IMMEDIATE`), so a read-check-write (lease takeover, and the
    /// credits ledger later: balance checks, idempotency keys) cannot
    /// interleave with another writer or fail with `SQLITE_BUSY` at commit.
    pub async fn begin_immediate(&self) -> Result<Transaction<'static, Sqlite>> {
        self.writer
            .begin_with("BEGIN IMMEDIATE")
            .await
            .context("BEGIN IMMEDIATE")
    }

    /// `SELECT 1` on both pools.
    pub async fn ping(&self) -> Result<()> {
        sqlx::query("SELECT 1").execute(&self.writer).await?;
        sqlx::query("SELECT 1").execute(&self.reader).await?;
        Ok(())
    }

    /// Close both pools (graceful shutdown, tests that remove the file).
    pub async fn close(&self) {
        self.reader.close().await;
        self.writer.close().await;
    }
}

/// A new random id (uuid v4 as text).
pub fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn memory_db_migrates_and_begin_immediate_works() {
        let db = Db::memory().await.unwrap();
        db.ping().await.unwrap();
        let mut tx = db.begin_immediate().await.unwrap();
        let n: i64 = sqlx::query_scalar("SELECT count(*) FROM users")
            .fetch_one(&mut *tx)
            .await
            .unwrap();
        assert_eq!(n, 0);
        tx.commit().await.unwrap();
        // Re-running migrations is a no-op.
        db.migrate().await.unwrap();
    }

    #[tokio::test]
    async fn file_db_uses_wal_and_foreign_keys() {
        let dir = std::env::temp_dir().join(format!("simpress-db-{}", new_id()));
        let url = format!("sqlite://{}/x.db?mode=rwc", dir.display());
        let db = Db::connect(&url).await.unwrap();
        db.migrate().await.unwrap();
        let mode: String = sqlx::query_scalar("PRAGMA journal_mode")
            .fetch_one(&db.writer)
            .await
            .unwrap();
        assert_eq!(mode.to_ascii_lowercase(), "wal");
        let fk: i64 = sqlx::query_scalar("PRAGMA foreign_keys")
            .fetch_one(&db.reader)
            .await
            .unwrap();
        assert_eq!(fk, 1);
        // Readers are read-only.
        assert!(sqlx::query("DELETE FROM users")
            .execute(&db.reader)
            .await
            .is_err());
        // FK enforced: a session for a missing user is refused.
        assert!(sqlx::query(
            "INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES ('s', 'nobody', 0, 1)"
        )
        .execute(&db.writer)
        .await
        .is_err());
        db.close().await;
        let _ = std::fs::remove_dir_all(dir);
    }
}
