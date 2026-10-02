//! Content-gateway bookkeeping (draft PRs opened per company) and GitHub
//! webhook delivery dedupe.

use anyhow::{Context, Result};
use serde::Serialize;
use sqlx::FromRow;

use super::Db;

#[derive(Clone, Debug, FromRow, Serialize, PartialEq, Eq)]
pub struct GatewayPr {
    pub company_id: String,
    pub number: i64,
    pub content_id: String,
    pub work_item: Option<String>,
    pub path: String,
    pub branch: String,
    pub head_sha: String,
    pub merged_sha: Option<String>,
}

const PR_COLS: &str =
    "company_id, number, content_id, work_item, path, branch, head_sha, merged_sha";

pub struct NewGatewayPr<'a> {
    pub company_id: &'a str,
    pub number: i64,
    pub content_id: &'a str,
    pub work_item: Option<&'a str>,
    pub path: &'a str,
    pub branch: &'a str,
    pub head_sha: &'a str,
}

/// Record (or refresh, on a re-draft) a gateway PR.
pub async fn upsert_pr(db: &Db, pr: &NewGatewayPr<'_>, now_ms: i64) -> Result<()> {
    sqlx::query(
        "INSERT INTO gateway_prs
            (company_id, number, content_id, work_item, path, branch, head_sha, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)
         ON CONFLICT (company_id, number) DO UPDATE SET
            content_id = excluded.content_id,
            work_item = COALESCE(excluded.work_item, gateway_prs.work_item),
            path = excluded.path, branch = excluded.branch,
            head_sha = excluded.head_sha, updated_at = excluded.updated_at",
    )
    .bind(pr.company_id)
    .bind(pr.number)
    .bind(pr.content_id)
    .bind(pr.work_item)
    .bind(pr.path)
    .bind(pr.branch)
    .bind(pr.head_sha)
    .bind(now_ms)
    .execute(&db.writer)
    .await
    .context("record gateway PR")?;
    Ok(())
}

pub async fn get_pr(db: &Db, company_id: &str, number: i64) -> Result<Option<GatewayPr>> {
    sqlx::query_as::<_, GatewayPr>(&format!(
        "SELECT {PR_COLS} FROM gateway_prs WHERE company_id = ?1 AND number = ?2"
    ))
    .bind(company_id)
    .bind(number)
    .fetch_optional(&db.writer)
    .await
    .context("load gateway PR")
}

pub async fn set_merged(
    db: &Db,
    company_id: &str,
    number: i64,
    merged_sha: &str,
    now_ms: i64,
) -> Result<()> {
    sqlx::query(
        "UPDATE gateway_prs SET merged_sha = ?3, updated_at = ?4 WHERE company_id = ?1 AND number = ?2",
    )
    .bind(company_id)
    .bind(number)
    .bind(merged_sha)
    .bind(now_ms)
    .execute(&db.writer)
    .await
    .context("mark gateway PR merged")?;
    Ok(())
}

/// The company's PR whose squash commit is `merged_sha` (deploy webhooks).
pub async fn pr_by_merged_sha(
    db: &Db,
    company_id: &str,
    merged_sha: &str,
) -> Result<Option<GatewayPr>> {
    sqlx::query_as::<_, GatewayPr>(&format!(
        "SELECT {PR_COLS} FROM gateway_prs WHERE company_id = ?1 AND merged_sha = ?2"
    ))
    .bind(company_id)
    .bind(merged_sha)
    .fetch_optional(&db.reader)
    .await
    .context("gateway PR by merged sha")
}

/// Record a webhook delivery id; `true` the first time it is seen.
pub async fn mark_delivery(db: &Db, delivery_id: &str, event: &str, now_ms: i64) -> Result<bool> {
    Ok(sqlx::query(
        "INSERT INTO webhook_deliveries (delivery_id, event, received_at) VALUES (?1, ?2, ?3)
         ON CONFLICT (delivery_id) DO NOTHING",
    )
    .bind(delivery_id)
    .bind(event)
    .bind(now_ms)
    .execute(&db.writer)
    .await
    .context("record webhook delivery")?
    .rows_affected()
        == 1)
}
