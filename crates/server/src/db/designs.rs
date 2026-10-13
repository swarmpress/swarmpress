//! Site design versions (migration 0009, ADR-0093).

use anyhow::Result;

use super::Db;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DesignRow {
    pub version: i64,
    pub hash: String,
    pub source: String,
    pub created_at: i64,
    pub manifest_json: String,
}

type Row = (i64, String, String, i64, String);

fn row((version, hash, source, created_at, manifest_json): Row) -> DesignRow {
    DesignRow {
        version,
        hash,
        source,
        created_at,
        manifest_json,
    }
}

const COLS: &str = "version, hash, source, created_at, manifest_json";

/// Records a version; when the site already has this hash, returns that
/// version and `false` (write-once: a version never changes).
pub async fn insert_design(
    db: &Db,
    site: &str,
    hash: &str,
    source: &str,
    created_at: i64,
    manifest_json: &str,
) -> Result<(i64, bool)> {
    let mut tx = db.begin_immediate().await?;
    let existing: Option<(i64,)> =
        sqlx::query_as("SELECT version FROM site_designs WHERE site_id = ? AND hash = ?")
            .bind(site)
            .bind(hash)
            .fetch_optional(&mut *tx)
            .await?;
    if let Some((v,)) = existing {
        tx.commit().await?;
        return Ok((v, false));
    }
    let (next,): (i64,) =
        sqlx::query_as("SELECT COALESCE(MAX(version), 0) + 1 FROM site_designs WHERE site_id = ?")
            .bind(site)
            .fetch_one(&mut *tx)
            .await?;
    sqlx::query(
        "INSERT INTO site_designs (site_id, version, hash, source, created_at, manifest_json)
         VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(site)
    .bind(next)
    .bind(hash)
    .bind(source)
    .bind(created_at)
    .bind(manifest_json)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok((next, true))
}

pub async fn designs(db: &Db, site: &str) -> Result<Vec<DesignRow>> {
    let rows: Vec<Row> = sqlx::query_as(&format!(
        "SELECT {COLS} FROM site_designs WHERE site_id = ? ORDER BY version"
    ))
    .bind(site)
    .fetch_all(&db.reader)
    .await?;
    Ok(rows.into_iter().map(row).collect())
}

pub async fn design(db: &Db, site: &str, version: i64) -> Result<Option<DesignRow>> {
    let r: Option<Row> = sqlx::query_as(&format!(
        "SELECT {COLS} FROM site_designs WHERE site_id = ? AND version = ?"
    ))
    .bind(site)
    .bind(version)
    .fetch_optional(&db.reader)
    .await?;
    Ok(r.map(row))
}
