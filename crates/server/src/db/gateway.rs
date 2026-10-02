//! Content-gateway bookkeeping (draft PRs opened per company, and what
//! became of them: merged, deployed, closed) and GitHub webhook delivery
//! dedupe.

use anyhow::{Context, Result};
use serde::Serialize;
use sqlx::FromRow;

use super::Db;

/// One pull request the gateway opened (`gateway_prs`).
#[derive(Clone, Debug, FromRow, Serialize, PartialEq, Eq)]
pub struct GatewayPr {
    pub company_id: String,
    pub number: i64,
    pub content_id: String,
    pub work_item: Option<String>,
    pub path: String,
    pub branch: String,
    /// The head after the last draft: what a review looked at.
    pub head_sha: String,
    pub merged_sha: Option<String>,
    /// Unix ms; orders the merges of a repository.
    pub merged_at: Option<i64>,
    /// Unix ms; a deployment containing the merge succeeded.
    pub landed_at: Option<i64>,
    /// `None` until merged; then `pending`, `landed`, `failed`, or `unknown`
    /// for a merge older than deploy observation.
    pub deploy_state: Option<String>,
    pub deploy_detail: Option<String>,
    pub deploy_checked_at: Option<i64>,
    /// Unix ms; closed without a merge.
    pub closed_at: Option<i64>,
    /// The branch head after the gateway's own finalise commits.
    pub final_head: Option<String>,
}

impl GatewayPr {
    /// Where the pull request stands: `open`, `closed`, or once merged its
    /// deploy state (`pending`, `landed`, `failed`, `unknown`).
    pub fn state(&self) -> &str {
        if self.merged_sha.is_some() {
            self.deploy_state.as_deref().unwrap_or("unknown")
        } else if self.closed_at.is_some() {
            "closed"
        } else {
            "open"
        }
    }
}

const PR_COLS: &str = "company_id, number, content_id, work_item, path, branch, head_sha, \
     merged_sha, merged_at, landed_at, deploy_state, deploy_detail, deploy_checked_at, \
     closed_at, final_head";

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

/// The company's open (neither merged nor closed) gateway PRs that target
/// `path`, other than the draft lineage of `content_id` itself (create-only
/// article paths, ADR-0061 decision 5). Paths are compared without case.
pub async fn open_prs_for_path(
    db: &Db,
    company_id: &str,
    path: &str,
    content_id: &str,
) -> Result<Vec<GatewayPr>> {
    sqlx::query_as::<_, GatewayPr>(&format!(
        "SELECT {PR_COLS} FROM gateway_prs
         WHERE company_id = ?1 AND lower(path) = lower(?2) AND content_id <> ?3
           AND merged_sha IS NULL AND closed_at IS NULL
         ORDER BY number"
    ))
    .bind(company_id)
    .bind(path)
    .bind(content_id)
    .fetch_all(&db.writer)
    .await
    .context("open gateway PRs for a path")
}

/// The company's open (neither merged nor closed) gateway PRs of
/// `content_id`, newest first.
pub async fn open_prs_for_content(
    db: &Db,
    company_id: &str,
    content_id: &str,
) -> Result<Vec<GatewayPr>> {
    sqlx::query_as::<_, GatewayPr>(&format!(
        "SELECT {PR_COLS} FROM gateway_prs
         WHERE company_id = ?1 AND content_id = ?2
           AND merged_sha IS NULL AND closed_at IS NULL
         ORDER BY number DESC"
    ))
    .bind(company_id)
    .bind(content_id)
    .fetch_all(&db.writer)
    .await
    .context("open gateway PRs of a content id")
}

/// Record that an unmerged pull request was closed (the first time counts).
pub async fn set_closed(db: &Db, company_id: &str, number: i64, now_ms: i64) -> Result<()> {
    sqlx::query(
        "UPDATE gateway_prs SET closed_at = COALESCE(closed_at, ?3), updated_at = ?3
          WHERE company_id = ?1 AND number = ?2 AND merged_sha IS NULL",
    )
    .bind(company_id)
    .bind(number)
    .bind(now_ms)
    .execute(&db.writer)
    .await
    .context("mark gateway PR closed")?;
    Ok(())
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

#[cfg(test)]
mod tests {
    use super::*;

    /// `0003_deploys.sql` on a database that already holds gateway pull
    /// requests: the rows survive, and an old merge is `unknown`, not
    /// `pending` (nobody watched its deployment, and nobody will).
    #[tokio::test]
    async fn the_deploys_migration_keeps_existing_rows() {
        let db = Db::connect("sqlite::memory:").await.unwrap();
        for sql in [
            include_str!("../../migrations/0001_init.sql"),
            include_str!("../../migrations/0002_executor.sql"),
            "INSERT INTO users (id, dev_login, login, created_at, updated_at)
                  VALUES ('u', 'ada', 'ada', 1, 1);
             INSERT INTO companies (id, owner_user_id, name, seed, site_repo, created_at)
                  VALUES ('co', 'u', 'Gazette', 1, 'o/r', 1);
             INSERT INTO gateway_prs
                    (company_id, number, content_id, path, branch, head_sha, merged_sha,
                     created_at, updated_at)
                  VALUES ('co', 1, 'c1', 'content/a.json', 'drafts/content-c1', 'h1', 'm1', 10, 20),
                         ('co', 2, 'c2', 'content/b.json', 'drafts/content-c2', 'h2', NULL, 30, 40);",
            include_str!("../../migrations/0003_deploys.sql"),
        ] {
            sqlx::raw_sql(sql).execute(&db.writer).await.unwrap();
        }
        let merged = get_pr(&db, "co", 1).await.unwrap().unwrap();
        assert_eq!(merged.merged_at, Some(20));
        assert_eq!(merged.state(), "unknown");
        assert_eq!((merged.landed_at, merged.closed_at), (None, None));
        let open = get_pr(&db, "co", 2).await.unwrap().unwrap();
        assert_eq!(open.state(), "open");
        assert_eq!((open.merged_at, open.deploy_state), (None, None));

        // Closing is recorded once, and never for a merged pull request.
        set_closed(&db, "co", 2, 50).await.unwrap();
        set_closed(&db, "co", 2, 60).await.unwrap();
        set_closed(&db, "co", 1, 60).await.unwrap();
        let closed = get_pr(&db, "co", 2).await.unwrap().unwrap();
        assert_eq!((closed.state(), closed.closed_at), ("closed", Some(50)));
        assert_eq!(get_pr(&db, "co", 1).await.unwrap().unwrap().closed_at, None);
        assert!(open_prs_for_content(&db, "co", "c2")
            .await
            .unwrap()
            .is_empty());
        assert!(open_prs_for_path(&db, "co", "content/b.json", "other")
            .await
            .unwrap()
            .is_empty());
    }
}
