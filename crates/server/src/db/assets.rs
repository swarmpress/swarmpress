//! Asset rows and web grants (migration 0008).

use anyhow::Result;

use super::Db;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AssetRow {
    pub sha256: String,
    pub content_type: String,
    pub size: i64,
}

/// Records an asset; returns false when the company already had it (first write wins).
pub async fn insert_asset(db: &Db, company: &str, a: &AssetRow, now_ms: i64) -> Result<bool> {
    let r = sqlx::query(
        "INSERT INTO assets (company_id, sha256, content_type, size, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (company_id, sha256) DO NOTHING",
    )
    .bind(company)
    .bind(&a.sha256)
    .bind(&a.content_type)
    .bind(a.size)
    .bind(now_ms)
    .execute(&db.writer)
    .await?;
    Ok(r.rows_affected() == 1)
}

pub async fn asset(db: &Db, company: &str, sha256: &str) -> Result<Option<AssetRow>> {
    let row: Option<(String, String, i64)> = sqlx::query_as(
        "SELECT sha256, content_type, size FROM assets WHERE company_id = ? AND sha256 = ?",
    )
    .bind(company)
    .bind(sha256)
    .fetch_optional(&db.reader)
    .await?;
    Ok(row.map(|(sha256, content_type, size)| AssetRow {
        sha256,
        content_type,
        size,
    }))
}

/// Replaces the company's granted hosts.
pub async fn set_grants(db: &Db, company: &str, hosts: &[String], now_ms: i64) -> Result<()> {
    let mut tx = db.writer.begin().await?;
    sqlx::query("DELETE FROM web_grants WHERE company_id = ?")
        .bind(company)
        .execute(&mut *tx)
        .await?;
    for h in hosts {
        sqlx::query("INSERT INTO web_grants (company_id, host, granted_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING")
            .bind(company)
            .bind(h)
            .bind(now_ms)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    Ok(())
}

pub async fn grants(db: &Db, company: &str) -> Result<Vec<String>> {
    let rows: Vec<(String,)> =
        sqlx::query_as("SELECT host FROM web_grants WHERE company_id = ? ORDER BY host")
            .bind(company)
            .fetch_all(&db.reader)
            .await?;
    Ok(rows.into_iter().map(|(h,)| h).collect())
}
