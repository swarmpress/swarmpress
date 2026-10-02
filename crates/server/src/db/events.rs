//! The per-company offline event inbox.

use anyhow::{Context, Result};
use serde::Serialize;
use serde_json::Value;
use sqlx::FromRow;

use super::Db;

/// One inbox event as stored and as sent to clients.
#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct Event {
    pub seq: i64,
    pub company_id: String,
    pub kind: String,
    pub payload: Value,
    /// Unix ms.
    pub created_at: i64,
}

#[derive(FromRow)]
struct EventRow {
    seq: i64,
    company_id: String,
    kind: String,
    payload: String,
    created_at: i64,
}

impl EventRow {
    fn into_event(self) -> Event {
        Event {
            seq: self.seq,
            company_id: self.company_id,
            kind: self.kind,
            payload: serde_json::from_str(&self.payload).unwrap_or(Value::Null),
            created_at: self.created_at,
        }
    }
}

pub async fn insert_event(
    db: &Db,
    company_id: &str,
    kind: &str,
    payload: &Value,
    now_ms: i64,
) -> Result<Event> {
    insert_event_in(&db.writer, company_id, kind, payload, now_ms).await
}

/// [`insert_event`] on any executor: inside a transaction (`&mut *tx`), the
/// event is stored together with the change it reports, or not at all.
pub async fn insert_event_in<'e, E>(
    executor: E,
    company_id: &str,
    kind: &str,
    payload: &Value,
    now_ms: i64,
) -> Result<Event>
where
    E: sqlx::Executor<'e, Database = sqlx::Sqlite>,
{
    let row = sqlx::query_as::<_, EventRow>(
        "INSERT INTO events (company_id, kind, payload, created_at) VALUES (?1, ?2, ?3, ?4)
         RETURNING seq, company_id, kind, payload, created_at",
    )
    .bind(company_id)
    .bind(kind)
    .bind(payload.to_string())
    .bind(now_ms)
    .fetch_one(executor)
    .await
    .context("insert event")?;
    Ok(row.into_event())
}

/// Events of `company_id` with `seq > after`, oldest first, at most `limit`.
pub async fn events_after(db: &Db, company_id: &str, after: i64, limit: i64) -> Result<Vec<Event>> {
    let rows = sqlx::query_as::<_, EventRow>(
        "SELECT seq, company_id, kind, payload, created_at FROM events
         WHERE company_id = ?1 AND seq > ?2 ORDER BY seq LIMIT ?3",
    )
    .bind(company_id)
    .bind(after)
    .bind(limit)
    .fetch_all(&db.reader)
    .await
    .context("list events")?;
    Ok(rows.into_iter().map(EventRow::into_event).collect())
}
