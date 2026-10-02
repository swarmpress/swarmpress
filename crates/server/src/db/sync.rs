//! Index rows for sync blobs (the bytes are files, see `crate::sync`).

use anyhow::{Context, Result};
use serde::Serialize;
use sqlx::FromRow;

use super::Db;

#[derive(Clone, Debug, FromRow, Serialize, PartialEq, Eq)]
pub struct SegmentRow {
    pub segment: i64,
    pub sha256: String,
    pub size: i64,
    pub created_at: i64,
}

#[derive(Clone, Debug, FromRow, Serialize, PartialEq, Eq)]
pub struct SnapshotRow {
    pub step: i64,
    pub sha256: String,
    pub size: i64,
    pub updated_at: i64,
}

/// Insert the segment row unless one exists. Returns `None` when inserted,
/// or the existing row (whose bytes must then be compared by sha).
pub async fn insert_segment(
    db: &Db,
    company_id: &str,
    segment: i64,
    sha256: &str,
    size: i64,
    now_ms: i64,
) -> Result<Option<SegmentRow>> {
    let inserted = sqlx::query(
        "INSERT INTO sync_segments (company_id, segment, sha256, size, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT (company_id, segment) DO NOTHING",
    )
    .bind(company_id)
    .bind(segment)
    .bind(sha256)
    .bind(size)
    .bind(now_ms)
    .execute(&db.writer)
    .await
    .context("insert sync segment")?
    .rows_affected();
    if inserted == 1 {
        return Ok(None);
    }
    get_segment_on(&db.writer, company_id, segment).await
}

async fn get_segment_on(
    pool: &sqlx::SqlitePool,
    company_id: &str,
    segment: i64,
) -> Result<Option<SegmentRow>> {
    sqlx::query_as::<_, SegmentRow>(
        "SELECT segment, sha256, size, created_at FROM sync_segments
         WHERE company_id = ?1 AND segment = ?2",
    )
    .bind(company_id)
    .bind(segment)
    .fetch_optional(pool)
    .await
    .context("load sync segment")
}

pub async fn get_segment(db: &Db, company_id: &str, segment: i64) -> Result<Option<SegmentRow>> {
    get_segment_on(&db.reader, company_id, segment).await
}

/// Remove a segment row (only used to roll back when the file write fails).
pub async fn delete_segment(db: &Db, company_id: &str, segment: i64) -> Result<()> {
    sqlx::query("DELETE FROM sync_segments WHERE company_id = ?1 AND segment = ?2")
        .bind(company_id)
        .bind(segment)
        .execute(&db.writer)
        .await
        .context("delete sync segment")?;
    Ok(())
}

pub async fn list_segments(db: &Db, company_id: &str) -> Result<Vec<SegmentRow>> {
    sqlx::query_as::<_, SegmentRow>(
        "SELECT segment, sha256, size, created_at FROM sync_segments
         WHERE company_id = ?1 ORDER BY segment",
    )
    .bind(company_id)
    .fetch_all(&db.reader)
    .await
    .context("list sync segments")
}

pub async fn upsert_snapshot(
    db: &Db,
    company_id: &str,
    step: i64,
    sha256: &str,
    size: i64,
    now_ms: i64,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO sync_snapshots (company_id, step, sha256, size, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT (company_id) DO UPDATE SET
            step = excluded.step, sha256 = excluded.sha256,
            size = excluded.size, updated_at = excluded.updated_at",
    )
    .bind(company_id)
    .bind(step)
    .bind(sha256)
    .bind(size)
    .bind(now_ms)
    .execute(&db.writer)
    .await
    .context("upsert snapshot")?;
    Ok(())
}

pub async fn get_snapshot(db: &Db, company_id: &str) -> Result<Option<SnapshotRow>> {
    sqlx::query_as::<_, SnapshotRow>(
        "SELECT step, sha256, size, updated_at FROM sync_snapshots WHERE company_id = ?1",
    )
    .bind(company_id)
    .fetch_optional(&db.reader)
    .await
    .context("load snapshot")
}
