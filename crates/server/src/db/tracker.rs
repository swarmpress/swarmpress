//! Tracker (ADR-0032) storage: projects, salts, raw events, rollups,
//! signals and the analytics read model. Aggregation itself is plain Rust in
//! `crate::tracker` (portable, deterministic); this module only moves rows.

use anyhow::{Context, Result};
use chrono::NaiveDate;
use serde::Serialize;
use sqlx::FromRow;

use super::{new_id, Db};
use crate::tracker::CleanEvent;

// ------------------------------------------------------------ salts

/// Store `salt` for `day` unless a salt exists, then return the stored one.
pub async fn ensure_salt(
    db: &Db,
    day: NaiveDate,
    fresh: &[u8; 32],
    expires_at_ms: i64,
) -> Result<Vec<u8>> {
    sqlx::query(
        "INSERT INTO tracker_salts (day, salt, expires_at) VALUES (?1, ?2, ?3)
         ON CONFLICT (day) DO NOTHING",
    )
    .bind(day)
    .bind(&fresh[..])
    .bind(expires_at_ms)
    .execute(&db.writer)
    .await
    .context("store salt")?;
    sqlx::query_scalar("SELECT salt FROM tracker_salts WHERE day = ?1")
        .bind(day)
        .fetch_one(&db.writer)
        .await
        .context("load salt")
}

pub async fn delete_expired_salts(db: &Db, now_ms: i64) -> Result<u64> {
    Ok(
        sqlx::query("DELETE FROM tracker_salts WHERE expires_at <= ?1")
            .bind(now_ms)
            .execute(&db.writer)
            .await
            .context("delete expired salts")?
            .rows_affected(),
    )
}

pub async fn salt_days(db: &Db) -> Result<Vec<NaiveDate>> {
    sqlx::query_scalar("SELECT day FROM tracker_salts ORDER BY day")
        .fetch_all(&db.reader)
        .await
        .context("list salts")
}

// ------------------------------------------------------------ projects

#[derive(Clone, Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub company_id: String,
    pub sim_project_id: String,
    pub slug: String,
    pub name: String,
    pub domain: Option<String>,
    pub repo: Option<String>,
    pub tracker_key: String,
    /// Unix ms.
    pub created_at: i64,
}

const PROJECT_COLS: &str =
    "id, company_id, sim_project_id, slug, name, domain, repo, tracker_key, created_at";

pub struct NewProjectRow<'a> {
    pub company_id: &'a str,
    pub sim_project_id: &'a str,
    pub slug: &'a str,
    pub name: &'a str,
    pub domain: Option<&'a str>,
    pub repo: Option<&'a str>,
    pub tracker_key: &'a str,
}

/// `Ok(None)` when the sim id or slug is taken in the company.
pub async fn create_project(
    db: &Db,
    p: &NewProjectRow<'_>,
    now_ms: i64,
) -> Result<Option<Project>> {
    sqlx::query_as::<_, Project>(&format!(
        "INSERT INTO projects (id, company_id, sim_project_id, slug, name, domain, repo, tracker_key, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9) ON CONFLICT DO NOTHING
         RETURNING {PROJECT_COLS}"
    ))
    .bind(new_id())
    .bind(p.company_id)
    .bind(p.sim_project_id)
    .bind(p.slug)
    .bind(p.name)
    .bind(p.domain)
    .bind(p.repo)
    .bind(p.tracker_key)
    .bind(now_ms)
    .fetch_optional(&db.writer)
    .await
    .context("create project")
}

pub async fn list_projects(db: &Db, company_id: &str) -> Result<Vec<Project>> {
    sqlx::query_as::<_, Project>(&format!(
        "SELECT {PROJECT_COLS} FROM projects WHERE company_id = ?1 ORDER BY created_at, slug"
    ))
    .bind(company_id)
    .fetch_all(&db.reader)
    .await
    .context("list projects")
}

/// A company's project by id, slug or sim project id.
pub async fn find_project(db: &Db, company_id: &str, key: &str) -> Result<Option<Project>> {
    sqlx::query_as::<_, Project>(&format!(
        "SELECT {PROJECT_COLS} FROM projects
         WHERE company_id = ?1 AND (id = ?2 OR slug = ?2 OR sim_project_id = ?2)"
    ))
    .bind(company_id)
    .bind(key)
    .fetch_optional(&db.reader)
    .await
    .context("find project")
}

/// (project id, registered domain) for a public tracker key.
pub async fn project_by_key(
    db: &Db,
    tracker_key: &str,
) -> Result<Option<(String, Option<String>)>> {
    sqlx::query_as("SELECT id, domain FROM projects WHERE tracker_key = ?1")
        .bind(tracker_key)
        .fetch_optional(&db.reader)
        .await
        .context("project by key")
}

/// Whether `host` (no `www.`) is a registered project domain or a subdomain of one.
pub async fn domain_registered(db: &Db, host: &str) -> Result<bool> {
    let n: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM projects
         WHERE domain = ?1 OR substr(?1, -length(domain) - 1) = '.' || domain",
    )
    .bind(host)
    .fetch_one(&db.reader)
    .await
    .context("domain lookup")?;
    Ok(n > 0)
}

// ------------------------------------------------------------ raw events

pub async fn insert_event(
    db: &Db,
    project_id: &str,
    ts_ms: i64,
    ev: &CleanEvent,
    visitor: u64,
    session: u64,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO tracker_events (project_id, ts, type, path, lang, ref_domain, utm_source,
            utm_medium, utm_campaign, viewport, engaged_ms, scroll_pct, outbound_domain,
            visitor_hash, session_hash)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
    )
    .bind(project_id)
    .bind(ts_ms)
    .bind(ev.kind)
    .bind(&ev.path)
    .bind(&ev.lang)
    .bind(&ev.ref_domain)
    .bind(&ev.utm_source)
    .bind(&ev.utm_medium)
    .bind(&ev.utm_campaign)
    .bind(ev.viewport)
    .bind(ev.engaged_ms)
    .bind(ev.scroll_pct)
    .bind(&ev.outbound_domain)
    // Hashes are 64-bit patterns; store their bits.
    .bind(visitor as i64)
    .bind(session as i64)
    .execute(&db.writer)
    .await
    .context("insert tracker event")?;
    Ok(())
}

/// A raw event as the rollup reads it.
#[derive(Clone, Debug, FromRow)]
pub struct RawRow {
    pub id: i64,
    pub project_id: String,
    pub ts: i64,
    #[sqlx(rename = "type")]
    pub kind: String,
    pub path: String,
    pub lang: String,
    pub ref_domain: Option<String>,
    pub utm_source: Option<String>,
    pub engaged_ms: Option<i64>,
    pub scroll_pct: Option<i64>,
    pub visitor_hash: i64,
    pub session_hash: i64,
}

/// Raw events with `ts >= from_ms`, ordered by (ts, id).
pub async fn raw_events_since(db: &Db, from_ms: i64) -> Result<Vec<RawRow>> {
    sqlx::query_as::<_, RawRow>(
        "SELECT id, project_id, ts, type, path, lang, ref_domain, utm_source, engaged_ms,
                scroll_pct, visitor_hash, session_hash
         FROM tracker_events WHERE ts >= ?1 ORDER BY ts, id",
    )
    .bind(from_ms)
    .fetch_all(&db.writer)
    .await
    .context("load raw events")
}

/// Raw event rows for tests and tools: (type, path, lang, ref_domain, utm_source, viewport).
pub type EventSummary = (
    String,
    String,
    String,
    Option<String>,
    Option<String>,
    String,
);

pub async fn event_summaries(db: &Db) -> Result<Vec<EventSummary>> {
    sqlx::query_as(
        "SELECT type, path, lang, ref_domain, utm_source, viewport FROM tracker_events ORDER BY id",
    )
    .fetch_all(&db.reader)
    .await
    .context("event summaries")
}

/// (visitor_hash, session_hash) of every raw event, in insertion order.
pub async fn event_hashes(db: &Db) -> Result<Vec<(i64, i64)>> {
    sqlx::query_as("SELECT visitor_hash, session_hash FROM tracker_events ORDER BY id")
        .fetch_all(&db.reader)
        .await
        .context("event hashes")
}

/// Paths of every raw event, oldest first.
pub async fn event_paths(db: &Db) -> Result<Vec<String>> {
    sqlx::query_scalar("SELECT path FROM tracker_events ORDER BY ts, id")
        .fetch_all(&db.reader)
        .await
        .context("event paths")
}

pub async fn event_count(db: &Db) -> Result<i64> {
    sqlx::query_scalar("SELECT count(*) FROM tracker_events")
        .fetch_one(&db.reader)
        .await
        .context("count events")
}

pub async fn delete_events_before(db: &Db, cutoff_ms: i64) -> Result<u64> {
    Ok(sqlx::query("DELETE FROM tracker_events WHERE ts < ?1")
        .bind(cutoff_ms)
        .execute(&db.writer)
        .await
        .context("delete old events")?
        .rows_affected())
}

// ------------------------------------------------------------ rollup rows

#[derive(Clone, Debug, PartialEq, Eq, FromRow)]
pub struct DailyRow {
    pub project_id: String,
    pub day: NaiveDate,
    pub path: String,
    pub lang: String,
    pub source: String,
    pub sessions: i64,
    pub visitors: i64,
    pub pageviews: i64,
    pub engaged_ms_sum: i64,
    pub engaged_count: i64,
    pub scroll_75_count: i64,
    pub outbound_count: i64,
}

#[derive(Clone, Debug, PartialEq, Eq, FromRow)]
pub struct TotalsRow {
    pub project_id: String,
    pub day: NaiveDate,
    pub sessions: i64,
    pub visitors: i64,
    pub pageviews: i64,
    pub engaged_sessions: i64,
    pub engaged_ms_sum: i64,
}

/// Replace the rollup of every (project, day) in `totals` with the given
/// rows, in one transaction.
pub async fn replace_rollup(db: &Db, daily: &[DailyRow], totals: &[TotalsRow]) -> Result<()> {
    let mut tx = db.writer.begin().await?;
    for t in totals {
        sqlx::query("DELETE FROM analytics_daily WHERE project_id = ?1 AND day = ?2")
            .bind(&t.project_id)
            .bind(t.day)
            .execute(&mut *tx)
            .await?;
        sqlx::query("DELETE FROM analytics_daily_totals WHERE project_id = ?1 AND day = ?2")
            .bind(&t.project_id)
            .bind(t.day)
            .execute(&mut *tx)
            .await?;
        sqlx::query(
            "INSERT INTO analytics_daily_totals (project_id, day, sessions, visitors, pageviews,
                engaged_sessions, engaged_ms_sum) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        )
        .bind(&t.project_id)
        .bind(t.day)
        .bind(t.sessions)
        .bind(t.visitors)
        .bind(t.pageviews)
        .bind(t.engaged_sessions)
        .bind(t.engaged_ms_sum)
        .execute(&mut *tx)
        .await
        .context("rollup: totals")?;
    }
    for d in daily {
        sqlx::query(
            "INSERT INTO analytics_daily (project_id, day, path, lang, source, sessions, visitors,
                pageviews, engaged_ms_sum, engaged_count, scroll_75_count, outbound_count)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        )
        .bind(&d.project_id)
        .bind(d.day)
        .bind(&d.path)
        .bind(&d.lang)
        .bind(&d.source)
        .bind(d.sessions)
        .bind(d.visitors)
        .bind(d.pageviews)
        .bind(d.engaged_ms_sum)
        .bind(d.engaged_count)
        .bind(d.scroll_75_count)
        .bind(d.outbound_count)
        .execute(&mut *tx)
        .await
        .context("rollup: analytics_daily")?;
    }
    tx.commit().await?;
    Ok(())
}

pub async fn daily_rows(db: &Db, day: NaiveDate) -> Result<Vec<DailyRow>> {
    sqlx::query_as::<_, DailyRow>(
        "SELECT project_id, day, path, lang, source, sessions, visitors, pageviews, engaged_ms_sum,
                engaged_count, scroll_75_count, outbound_count
         FROM analytics_daily WHERE day = ?1 ORDER BY path, lang, source",
    )
    .bind(day)
    .fetch_all(&db.reader)
    .await
    .context("daily rows")
}

pub async fn totals_row(db: &Db, project_id: &str, day: NaiveDate) -> Result<Option<TotalsRow>> {
    sqlx::query_as::<_, TotalsRow>(
        "SELECT project_id, day, sessions, visitors, pageviews, engaged_sessions, engaged_ms_sum
         FROM analytics_daily_totals WHERE project_id = ?1 AND day = ?2",
    )
    .bind(project_id)
    .bind(day)
    .fetch_optional(&db.reader)
    .await
    .context("totals row")
}

// ------------------------------------------------------------ signals

/// (project, day) pairs before `today` with totals but no signal row yet.
pub async fn days_without_signal(db: &Db, today: NaiveDate) -> Result<Vec<(String, NaiveDate)>> {
    sqlx::query_as(
        "SELECT t.project_id, t.day FROM analytics_daily_totals t
         LEFT JOIN analytics_signals s ON s.project_id = t.project_id AND s.day = t.day
         WHERE t.day < ?1 AND s.project_id IS NULL
         ORDER BY t.day, t.project_id",
    )
    .bind(today)
    .fetch_all(&db.writer)
    .await
    .context("days without signal")
}

/// (company id, sim project id) of a project.
pub async fn project_owner(db: &Db, project_id: &str) -> Result<Option<(String, String)>> {
    sqlx::query_as("SELECT company_id, sim_project_id FROM projects WHERE id = ?1")
        .bind(project_id)
        .fetch_optional(&db.writer)
        .await
        .context("project owner")
}

/// The top `limit` paths of a project/day by pageviews (desc), then path.
pub async fn top_paths(
    db: &Db,
    project_id: &str,
    day: NaiveDate,
    limit: i64,
) -> Result<Vec<String>> {
    sqlx::query_scalar(
        "SELECT path FROM analytics_daily WHERE project_id = ?1 AND day = ?2
         GROUP BY path ORDER BY sum(pageviews) DESC, path ASC LIMIT ?3",
    )
    .bind(project_id)
    .bind(day)
    .bind(limit)
    .fetch_all(&db.writer)
    .await
    .context("top paths")
}

#[derive(Clone, Debug, PartialEq, Eq, FromRow)]
pub struct SignalRow {
    pub project_id: String,
    pub day: NaiveDate,
    pub company_id: String,
    pub sim_project_id: String,
    pub sessions: i64,
    pub visitors: i64,
    pub pageviews: i64,
    pub engagement_pm: i64,
    pub top_pages_digest: i64,
}

/// Insert a pending signal; returns 1 if inserted, 0 if it existed.
#[allow(clippy::too_many_arguments)]
pub async fn insert_signal(
    db: &Db,
    project_id: &str,
    day: NaiveDate,
    sessions: u32,
    visitors: u32,
    pageviews: u32,
    engagement_pm: u32,
    top_pages_digest: u64,
    now_ms: i64,
) -> Result<u64> {
    Ok(sqlx::query(
        "INSERT INTO analytics_signals (project_id, day, sessions, visitors, pageviews,
            engagement_pm, top_pages_digest, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) ON CONFLICT (project_id, day) DO NOTHING",
    )
    .bind(project_id)
    .bind(day)
    .bind(i64::from(sessions))
    .bind(i64::from(visitors))
    .bind(i64::from(pageviews))
    .bind(i64::from(engagement_pm))
    .bind(top_pages_digest as i64)
    .bind(now_ms)
    .execute(&db.writer)
    .await
    .context("insert signal")?
    .rows_affected())
}

pub async fn pending_signals(db: &Db) -> Result<Vec<SignalRow>> {
    sqlx::query_as::<_, SignalRow>(
        "SELECT s.project_id, s.day, p.company_id, p.sim_project_id, s.sessions, s.visitors,
                s.pageviews, s.engagement_pm, s.top_pages_digest
         FROM analytics_signals s JOIN projects p ON p.id = s.project_id
         WHERE s.status = 'pending' ORDER BY s.day, s.project_id",
    )
    .fetch_all(&db.writer)
    .await
    .context("pending signals")
}

pub async fn mark_signal_applied(
    db: &Db,
    project_id: &str,
    day: NaiveDate,
    now_ms: i64,
) -> Result<()> {
    sqlx::query(
        "UPDATE analytics_signals SET status = 'applied', applied_at = ?3
         WHERE project_id = ?1 AND day = ?2 AND status = 'pending'",
    )
    .bind(project_id)
    .bind(day)
    .bind(now_ms)
    .execute(&db.writer)
    .await
    .context("mark signal applied")?;
    Ok(())
}

pub async fn signal_statuses(db: &Db) -> Result<Vec<String>> {
    sqlx::query_scalar("SELECT status FROM analytics_signals ORDER BY day, project_id")
        .fetch_all(&db.reader)
        .await
        .context("signal statuses")
}

// ------------------------------------------------------------ analytics read model

/// Per-day totals of a project in `[from, to]`, with the engagement rate
/// (engaged sessions / sessions, 4 decimals) computed by SQLite.
#[derive(Clone, Debug, FromRow)]
pub struct DaySeriesRow {
    pub day: NaiveDate,
    pub sessions: i64,
    pub visitors: i64,
    pub pageviews: i64,
    pub engaged_sessions: i64,
    pub engagement_rate: f64,
}

pub async fn day_series(
    db: &Db,
    project_id: &str,
    from: NaiveDate,
    to: NaiveDate,
) -> Result<Vec<DaySeriesRow>> {
    sqlx::query_as::<_, DaySeriesRow>(
        "SELECT day, sessions, visitors, pageviews, engaged_sessions,
                CASE WHEN sessions > 0
                     THEN round(CAST(engaged_sessions AS REAL) / sessions, 4)
                     ELSE 0.0 END AS engagement_rate
         FROM analytics_daily_totals
         WHERE project_id = ?1 AND day >= ?2 AND day <= ?3 ORDER BY day",
    )
    .bind(project_id)
    .bind(from)
    .bind(to)
    .fetch_all(&db.reader)
    .await
    .context("day series")
}

/// (path, pageviews, sessions, avg engaged ms) since `from`, top 10.
pub async fn top_pages(
    db: &Db,
    project_id: &str,
    from: NaiveDate,
) -> Result<Vec<(String, i64, i64, i64)>> {
    sqlx::query_as(
        "SELECT path, sum(pageviews), sum(sessions),
                COALESCE(sum(engaged_ms_sum) / NULLIF(sum(engaged_count), 0), 0)
         FROM analytics_daily WHERE project_id = ?1 AND day >= ?2
         GROUP BY path ORDER BY sum(pageviews) DESC, path LIMIT 10",
    )
    .bind(project_id)
    .bind(from)
    .fetch_all(&db.reader)
    .await
    .context("top pages")
}

pub async fn languages(db: &Db, project_id: &str, from: NaiveDate) -> Result<Vec<(String, i64)>> {
    sqlx::query_as(
        "SELECT lang, sum(pageviews) FROM analytics_daily
         WHERE project_id = ?1 AND day >= ?2
         GROUP BY lang ORDER BY sum(pageviews) DESC, lang",
    )
    .bind(project_id)
    .bind(from)
    .fetch_all(&db.reader)
    .await
    .context("languages")
}

pub async fn sources(
    db: &Db,
    project_id: &str,
    from: NaiveDate,
) -> Result<Vec<(String, i64, i64)>> {
    sqlx::query_as(
        "SELECT source, sum(sessions), sum(pageviews) FROM analytics_daily
         WHERE project_id = ?1 AND day >= ?2
         GROUP BY source ORDER BY sum(pageviews) DESC, source LIMIT 20",
    )
    .bind(project_id)
    .bind(from)
    .fetch_all(&db.reader)
    .await
    .context("sources")
}

/// Every (table, column) of the schema (privacy test).
pub async fn schema_columns(db: &Db) -> Result<Vec<(String, String)>> {
    let tables: Vec<String> = sqlx::query_scalar(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .fetch_all(&db.reader)
    .await?;
    let mut out = Vec::new();
    for t in tables {
        // Table names come from sqlite_master, not from input.
        let rows: Vec<(i64, String, String, i64, Option<String>, i64)> =
            sqlx::query_as(&format!("PRAGMA table_info(\"{t}\")"))
                .fetch_all(&db.reader)
                .await?;
        out.extend(rows.into_iter().map(|r| (t.clone(), r.1)));
    }
    Ok(out)
}

/// One page's numbers since a day (ADR-0071).
#[derive(Clone, Debug, Default, PartialEq, Eq, FromRow)]
pub struct PageStats {
    pub pageviews: i64,
    pub sessions: i64,
    pub avg_engaged_ms: i64,
    pub scroll_75: i64,
    /// Days with any view.
    pub days: i64,
}

pub async fn page_stats(
    db: &Db,
    project_id: &str,
    path: &str,
    from: NaiveDate,
) -> Result<PageStats> {
    sqlx::query_as::<_, PageStats>(
        "SELECT COALESCE(sum(pageviews), 0) AS pageviews, COALESCE(sum(sessions), 0) AS sessions,
                COALESCE(sum(engaged_ms_sum) / NULLIF(sum(engaged_count), 0), 0) AS avg_engaged_ms,
                COALESCE(sum(scroll_75_count), 0) AS scroll_75,
                count(DISTINCT day) AS days
         FROM analytics_daily WHERE project_id = ?1 AND path = ?2 AND day >= ?3",
    )
    .bind(project_id)
    .bind(path)
    .bind(from)
    .fetch_one(&db.reader)
    .await
    .context("page stats")
}

/// Page views per path of a project since a day (for the median, ADR-0071).
pub async fn per_path_pageviews(db: &Db, project_id: &str, from: NaiveDate) -> Result<Vec<i64>> {
    sqlx::query_scalar(
        "SELECT sum(pageviews) FROM analytics_daily WHERE project_id = ?1 AND day >= ?2 GROUP BY path",
    )
    .bind(project_id)
    .bind(from)
    .fetch_all(&db.reader)
    .await
    .context("per-path page views")
}
