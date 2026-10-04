//! Content-gateway bookkeeping (draft PRs opened per company, and what
//! became of them: merged, deployed, closed) and GitHub webhook delivery
//! dedupe.

use anyhow::{Context, Result};
use serde::Serialize;
use serde_json::Value;
use sqlx::FromRow;

use super::events::{insert_event_in, Event};
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
    /// Unix ms; when the current wait for a deployment began, if not at
    /// `merged_at` (a redeploy).
    pub deploy_since: Option<i64>,
    /// The commit whose deployment failed (this merge, or the later merge
    /// whose deployment superseded it); what a redeploy re-runs.
    pub deploy_failed_sha: Option<String>,
    /// How many redeploys were requested ([`redeploy`]).
    pub deploy_attempt: i64,
    /// The workflow run attempt the last redeploy re-ran, `<run id>:<attempt>`.
    pub deploy_rerun: Option<String>,
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
     closed_at, final_head, deploy_since, deploy_failed_sha, deploy_attempt, deploy_rerun";

/// [`PR_COLS`] of `gateway_prs p` in a join.
const P_COLS: &str = "p.company_id, p.number, p.content_id, p.work_item, p.path, p.branch, \
     p.head_sha, p.merged_sha, p.merged_at, p.landed_at, p.deploy_state, p.deploy_detail, \
     p.deploy_checked_at, p.closed_at, p.final_head, p.deploy_since, p.deploy_failed_sha, \
     p.deploy_attempt, p.deploy_rerun";

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
            final_head = CASE WHEN excluded.head_sha = gateway_prs.head_sha
                              THEN gateway_prs.final_head END,
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

/// Record the branch head the gateway's finalise step just produced for the
/// reviewed head `head_sha`. A new draft (another `head_sha`) forgets it
/// ([`upsert_pr`]).
pub async fn set_final_head(db: &Db, company_id: &str, number: i64, sha: &str) -> Result<()> {
    sqlx::query("UPDATE gateway_prs SET final_head = ?3 WHERE company_id = ?1 AND number = ?2")
        .bind(company_id)
        .bind(number)
        .bind(sha)
        .execute(&db.writer)
        .await
        .context("record finalised head")?;
    Ok(())
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

/// Record the squash merge. The first time, the pull request becomes
/// `pending` (its deployment is awaited) and gets its `merged_at`.
///
/// `merged_at` orders the merges of a repository for the "at or before"
/// rule, so it is kept strictly increasing per repository: `now_ms`, or one
/// more than the latest merge when the clock did not move (or went back).
pub async fn set_merged(
    db: &Db,
    company_id: &str,
    number: i64,
    merged_sha: &str,
    now_ms: i64,
) -> Result<()> {
    sqlx::query(
        "UPDATE gateway_prs
            SET merged_sha = ?3,
                merged_at = COALESCE(merged_at, max(?4, COALESCE((
                    SELECT max(p.merged_at) + 1
                      FROM gateway_prs p JOIN companies c ON c.id = p.company_id
                     WHERE lower(c.site_repo) =
                           (SELECT lower(site_repo) FROM companies WHERE id = ?1)), 0))),
                deploy_state = COALESCE(deploy_state, 'pending'),
                updated_at = ?4
          WHERE company_id = ?1 AND number = ?2",
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

// ---------------------------------------------------------------- deploys

/// A merged pull request the poller watches, with its repository.
#[derive(Clone, Debug, FromRow, PartialEq, Eq)]
pub struct WatchedPr {
    #[sqlx(flatten)]
    pub pr: GatewayPr,
    /// `owner/name` of the company's site repo.
    pub site_repo: String,
}

/// Merged pull requests whose deployment is still open: `pending` or
/// `failed` (a failed one lands when a later deployment succeeds), not
/// landed, merged (or redeployed, `deploy_since`) at or after `since_ms`.
/// Oldest merge first.
pub async fn watched_prs(db: &Db, since_ms: i64) -> Result<Vec<WatchedPr>> {
    sqlx::query_as::<_, WatchedPr>(&format!(
        "SELECT {P_COLS}, c.site_repo AS site_repo
           FROM gateway_prs p JOIN companies c ON c.id = p.company_id
          WHERE p.merged_sha IS NOT NULL AND p.landed_at IS NULL
            AND p.deploy_state IN ('pending', 'failed')
            AND COALESCE(p.deploy_since, p.merged_at) >= ?1
          ORDER BY p.merged_at, p.number"
    ))
    .bind(since_ms)
    .fetch_all(&db.writer)
    .await
    .context("watched gateway PRs")
}

/// Pending pull requests merged (or redeployed) before `before_ms`: nobody
/// saw their deployment in time.
pub async fn stale_pending(db: &Db, before_ms: i64) -> Result<Vec<GatewayPr>> {
    sqlx::query_as::<_, GatewayPr>(&format!(
        "SELECT {PR_COLS} FROM gateway_prs
          WHERE merged_sha IS NOT NULL AND landed_at IS NULL
            AND deploy_state = 'pending' AND COALESCE(deploy_since, merged_at) < ?1
          ORDER BY merged_at, number"
    ))
    .bind(before_ms)
    .fetch_all(&db.writer)
    .await
    .context("stale pending gateway PRs")
}

/// The gateway pull request, of any company bound to `repo` (`owner/name`),
/// whose squash commit is `merged_sha`.
pub async fn merged_pr_in_repo(db: &Db, repo: &str, merged_sha: &str) -> Result<Option<GatewayPr>> {
    sqlx::query_as::<_, GatewayPr>(&format!(
        "SELECT {P_COLS}
           FROM gateway_prs p JOIN companies c ON c.id = p.company_id
          WHERE lower(c.site_repo) = lower(?1) AND p.merged_sha = ?2
          ORDER BY p.merged_at LIMIT 1"
    ))
    .bind(repo)
    .bind(merged_sha)
    .fetch_optional(&db.writer)
    .await
    .context("gateway PR by merged sha in a repo")
}

/// Which merges a successful deployment contains.
#[derive(Clone, Copy, Debug)]
pub enum Land<'a> {
    /// One pull request (a simulated deploy).
    Pr { company_id: &'a str, number: i64 },
    /// Every pull request of the repository `repo` (`owner/name`, any
    /// company bound to it) merged at or before `merged_at`.
    RepoThrough { repo: &'a str, merged_at: i64 },
}

/// Land the merged, unlanded pull requests in `scope` and store one event of
/// `kind` per pull request (`payload` builds it), in one transaction: a pull
/// request lands exactly once, whoever reports the deployment. Returns what
/// landed, oldest first.
pub async fn land(
    db: &Db,
    scope: Land<'_>,
    now_ms: i64,
    detail: Option<&str>,
    kind: &str,
    payload: &(dyn Fn(&GatewayPr) -> Value + Sync),
) -> Result<Vec<(GatewayPr, Event)>> {
    let mut tx = db.begin_immediate().await?;
    let rows = match scope {
        Land::Pr { company_id, number } => {
            sqlx::query_as::<_, GatewayPr>(&format!(
                "SELECT {PR_COLS} FROM gateway_prs
                  WHERE company_id = ?1 AND number = ?2
                    AND merged_sha IS NOT NULL AND landed_at IS NULL"
            ))
            .bind(company_id)
            .bind(number)
            .fetch_all(&mut *tx)
            .await
        }
        Land::RepoThrough { repo, merged_at } => {
            sqlx::query_as::<_, GatewayPr>(&format!(
                "SELECT {P_COLS}
                   FROM gateway_prs p JOIN companies c ON c.id = p.company_id
                  WHERE lower(c.site_repo) = lower(?1)
                    AND p.merged_sha IS NOT NULL AND p.landed_at IS NULL
                    AND p.deploy_state IN ('pending', 'failed') AND p.merged_at <= ?2
                  ORDER BY p.merged_at, p.number"
            ))
            .bind(repo)
            .bind(merged_at)
            .fetch_all(&mut *tx)
            .await
        }
    }
    .context("gateway PRs to land")?;
    let mut out = Vec::with_capacity(rows.len());
    for mut pr in rows {
        sqlx::query(
            "UPDATE gateway_prs
                SET landed_at = ?3, deploy_state = 'landed', deploy_detail = ?4, updated_at = ?3
              WHERE company_id = ?1 AND number = ?2",
        )
        .bind(&pr.company_id)
        .bind(pr.number)
        .bind(now_ms)
        .bind(detail)
        .execute(&mut *tx)
        .await
        .context("land gateway PR")?;
        pr.landed_at = Some(now_ms);
        pr.deploy_state = Some("landed".into());
        pr.deploy_detail = detail.map(String::from);
        let event = insert_event_in(&mut *tx, &pr.company_id, kind, &payload(&pr), now_ms).await?;
        out.push((pr, event));
    }
    tx.commit().await.context("commit landed gateway PRs")?;
    Ok(out)
}

/// A pending merge failed to deploy: mark it (with `failed_sha`, the commit
/// whose deployment failed) and store its event, in one transaction. `None`
/// when the pull request was not pending (it already landed or failed):
/// nothing changes and no event is stored.
#[allow(clippy::too_many_arguments)]
pub async fn fail(
    db: &Db,
    company_id: &str,
    number: i64,
    detail: &str,
    failed_sha: Option<&str>,
    now_ms: i64,
    kind: &str,
    payload: &Value,
) -> Result<Option<Event>> {
    let mut tx = db.begin_immediate().await?;
    let changed = sqlx::query(
        "UPDATE gateway_prs
            SET deploy_state = 'failed', deploy_detail = ?3, deploy_failed_sha = ?5,
                updated_at = ?4
          WHERE company_id = ?1 AND number = ?2
            AND deploy_state = 'pending' AND landed_at IS NULL",
    )
    .bind(company_id)
    .bind(number)
    .bind(detail)
    .bind(now_ms)
    .bind(failed_sha)
    .execute(&mut *tx)
    .await
    .context("fail gateway PR")?
    .rows_affected();
    if changed == 0 {
        return Ok(None);
    }
    let event = insert_event_in(&mut *tx, company_id, kind, payload, now_ms).await?;
    tx.commit().await.context("commit failed gateway PR")?;
    Ok(Some(event))
}

/// A failed merge is deployed again (`POST /api/gateway/redeploy`): it is
/// `pending` from `now_ms` (the poller's age limit counts from there),
/// `deploy_attempt` counts up, and `rerun` (`<run id>:<attempt>`, the
/// workflow run attempt that was re-run) is recorded. Returns the row as it
/// is now, or `None` when the pull request was not `failed` (nothing
/// changes).
pub async fn redeploy(
    db: &Db,
    company_id: &str,
    number: i64,
    rerun: Option<&str>,
    detail: &str,
    now_ms: i64,
) -> Result<Option<GatewayPr>> {
    let changed = sqlx::query(
        "UPDATE gateway_prs
            SET deploy_state = 'pending', deploy_since = ?5, deploy_detail = ?4,
                deploy_checked_at = NULL, deploy_attempt = deploy_attempt + 1,
                deploy_rerun = COALESCE(?3, deploy_rerun), updated_at = ?5
          WHERE company_id = ?1 AND number = ?2
            AND deploy_state = 'failed' AND landed_at IS NULL",
    )
    .bind(company_id)
    .bind(number)
    .bind(rerun)
    .bind(detail)
    .bind(now_ms)
    .execute(&db.writer)
    .await
    .context("redeploy gateway PR")?
    .rows_affected();
    if changed == 0 {
        return Ok(None);
    }
    get_pr(db, company_id, number).await
}

/// Record that the poller asked GitHub about these pull requests.
pub async fn touch_checked(db: &Db, prs: &[(String, i64)], now_ms: i64) -> Result<()> {
    for (company_id, number) in prs {
        sqlx::query(
            "UPDATE gateway_prs SET deploy_checked_at = ?3 WHERE company_id = ?1 AND number = ?2",
        )
        .bind(company_id)
        .bind(number)
        .bind(now_ms)
        .execute(&db.writer)
        .await
        .context("record deploy check")?;
    }
    Ok(())
}

/// The company's newest gateway pull request for a sim work item.
pub async fn latest_pr_for_work_item(
    db: &Db,
    company_id: &str,
    work_item: &str,
) -> Result<Option<GatewayPr>> {
    sqlx::query_as::<_, GatewayPr>(&format!(
        "SELECT {PR_COLS} FROM gateway_prs
          WHERE company_id = ?1 AND work_item = ?2
          ORDER BY number DESC LIMIT 1"
    ))
    .bind(company_id)
    .bind(work_item)
    .fetch_optional(&db.writer)
    .await
    .context("gateway PR by work item")
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
            include_str!("../../migrations/0004_site_binding.sql"),
            include_str!("../../migrations/0005_redeploy.sql"),
        ] {
            sqlx::raw_sql(sql).execute(&db.writer).await.unwrap();
        }
        let merged = get_pr(&db, "co", 1).await.unwrap().unwrap();
        assert_eq!(merged.merged_at, Some(20));
        assert_eq!(merged.state(), "unknown");
        assert_eq!((merged.landed_at, merged.closed_at), (None, None));
        // 0005: no redeploy yet.
        assert_eq!(
            (
                merged.deploy_since,
                merged.deploy_attempt,
                merged.deploy_rerun
            ),
            (None, 0, None)
        );
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
