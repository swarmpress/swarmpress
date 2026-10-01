//! Postgres access for users, sessions and companies. Runtime-checked
//! queries only (no `query!` macros) so building needs no live database.

use std::time::Duration;

use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

use crate::actor::LoadParams;

pub static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations");

pub async fn connect(database_url: &str) -> Result<PgPool> {
    sqlx::postgres::PgPoolOptions::new()
        .max_connections(20)
        .acquire_timeout(Duration::from_secs(10))
        .connect(database_url)
        .await
        .context("connect to Postgres (DATABASE_URL)")
}

pub async fn migrate(pool: &PgPool) -> Result<()> {
    MIGRATOR.run(pool).await.context("run migrations")
}

#[derive(Clone, Debug, FromRow, Serialize, PartialEq, Eq)]
pub struct User {
    pub id: Uuid,
    pub github_id: i64,
    pub login: String,
    pub name: Option<String>,
    pub avatar_url: Option<String>,
}

#[derive(Clone, Debug, FromRow, Serialize, PartialEq, Eq)]
pub struct Company {
    pub id: Uuid,
    pub owner_user_id: Uuid,
    pub name: String,
    pub seed: i64,
    pub day_real_minutes: i32,
    pub created_at: DateTime<Utc>,
}

pub async fn upsert_github_user(
    pool: &PgPool,
    github_id: i64,
    login: &str,
    name: Option<&str>,
    avatar_url: Option<&str>,
) -> Result<User> {
    sqlx::query_as::<_, User>(
        "INSERT INTO users (github_id, login, name, avatar_url)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (github_id) DO UPDATE
           SET login = EXCLUDED.login, name = EXCLUDED.name,
               avatar_url = EXCLUDED.avatar_url, updated_at = now()
         RETURNING id, github_id, login, name, avatar_url",
    )
    .bind(github_id)
    .bind(login)
    .bind(name)
    .bind(avatar_url)
    .fetch_one(pool)
    .await
    .context("upsert user")
}

pub async fn create_session(
    pool: &PgPool,
    id_hash: &str,
    user_id: Uuid,
    ttl: Duration,
) -> Result<()> {
    let ttl_secs = i64::try_from(ttl.as_secs()).unwrap_or(i64::MAX / 2);
    sqlx::query(
        "INSERT INTO sessions (id, user_id, expires_at)
         VALUES ($1, $2, now() + ($3::bigint * interval '1 second'))",
    )
    .bind(id_hash)
    .bind(user_id)
    .bind(ttl_secs)
    .execute(pool)
    .await
    .context("create session")?;
    Ok(())
}

pub async fn session_user(pool: &PgPool, id_hash: &str) -> Result<Option<User>> {
    sqlx::query_as::<_, User>(
        "SELECT u.id, u.github_id, u.login, u.name, u.avatar_url
         FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.id = $1 AND s.expires_at > now()",
    )
    .bind(id_hash)
    .fetch_optional(pool)
    .await
    .context("lookup session")
}

pub async fn delete_session(pool: &PgPool, id_hash: &str) -> Result<()> {
    sqlx::query("DELETE FROM sessions WHERE id = $1")
        .bind(id_hash)
        .execute(pool)
        .await
        .context("delete session")?;
    Ok(())
}

pub async fn company_for_user(pool: &PgPool, user_id: Uuid) -> Result<Option<Company>> {
    sqlx::query_as::<_, Company>(
        "SELECT id, owner_user_id, name, seed, day_real_minutes, created_at
         FROM companies WHERE owner_user_id = $1",
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .context("load company")
}

/// Create the user's company. `Ok(None)` if they already have one.
pub async fn create_company(
    pool: &PgPool,
    user_id: Uuid,
    name: &str,
    seed: u64,
    day_real_minutes: u32,
) -> Result<Option<Company>> {
    sqlx::query_as::<_, Company>(
        "INSERT INTO companies (owner_user_id, name, seed, day_real_minutes)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (owner_user_id) DO NOTHING
         RETURNING id, owner_user_id, name, seed, day_real_minutes, created_at",
    )
    .bind(user_id)
    .bind(name)
    .bind(seed as i64)
    .bind(i32::try_from(day_real_minutes).context("day_real_minutes out of range")?)
    .fetch_optional(pool)
    .await
    .context("create company")
}

/// Everything an actor needs to load, including the wall-clock step computed
/// by Postgres (one clock for all server processes).
pub async fn company_load_params(
    pool: &PgPool,
    company_id: Uuid,
    step_period: Duration,
) -> Result<Option<LoadParams>> {
    let row: Option<(i64, i32, i64)> = sqlx::query_as(
        "SELECT seed, day_real_minutes,
                GREATEST(0, (EXTRACT(EPOCH FROM (now() - created_at)) * 1000)::bigint) AS elapsed_ms
         FROM companies WHERE id = $1",
    )
    .bind(company_id)
    .fetch_optional(pool)
    .await
    .context("load company params")?;
    let period_ms = u64::try_from(step_period.as_millis())
        .unwrap_or(u64::MAX)
        .max(1);
    Ok(row.map(|(seed, dm, elapsed_ms)| LoadParams {
        company_id,
        seed: seed as u64,
        day_real_minutes: dm.max(1) as u32,
        wall_step: elapsed_ms.max(0) as u64 / period_ms,
    }))
}
