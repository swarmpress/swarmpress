//! Users, sessions, companies and company leases.

use anyhow::{Context, Result};
use serde::Serialize;
use sqlx::FromRow;

use super::{new_id, Db};

#[derive(Clone, Debug, FromRow, Serialize, PartialEq, Eq)]
pub struct User {
    pub id: String,
    pub github_id: Option<i64>,
    pub login: String,
    pub name: Option<String>,
    pub avatar_url: Option<String>,
}

const USER_COLS: &str = "id, github_id, login, name, avatar_url";

#[derive(Clone, Debug, FromRow, Serialize, PartialEq, Eq)]
pub struct Company {
    pub id: String,
    pub owner_user_id: String,
    pub name: String,
    pub seed: i64,
    /// `owner/name` of the site repo the content gateway writes to.
    pub site_repo: String,
    pub site_base_branch: String,
    /// Unix ms.
    pub created_at: i64,
}

const COMPANY_COLS: &str = "id, owner_user_id, name, seed, site_repo, site_base_branch, created_at";

/// The device holding a company (ADR-0038).
#[derive(Clone, Debug, FromRow, Serialize, PartialEq, Eq)]
pub struct Lease {
    pub lease_id: String,
    /// The holding device id.
    #[serde(rename = "holder")]
    pub device_id: String,
    /// Unix ms.
    pub expires_at: i64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LeaseOutcome {
    /// The caller holds the lease now (`renewed`: it already held it).
    Granted { lease: Lease, renewed: bool },
    /// Another device holds an unexpired lease.
    Held(Lease),
}

// ------------------------------------------------------------ users

pub async fn upsert_github_user(
    db: &Db,
    github_id: i64,
    login: &str,
    name: Option<&str>,
    avatar_url: Option<&str>,
    now_ms: i64,
) -> Result<User> {
    sqlx::query_as::<_, User>(&format!(
        "INSERT INTO users (id, github_id, login, name, avatar_url, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
         ON CONFLICT (github_id) DO UPDATE
           SET login = excluded.login, name = excluded.name,
               avatar_url = excluded.avatar_url, updated_at = excluded.updated_at
         RETURNING {USER_COLS}"
    ))
    .bind(new_id())
    .bind(github_id)
    .bind(login)
    .bind(name)
    .bind(avatar_url)
    .bind(now_ms)
    .fetch_one(&db.writer)
    .await
    .context("upsert github user")
}

/// Create or fetch the development user `login` (SWARMPRESS_DEV_AUTH=1 only).
pub async fn upsert_dev_user(db: &Db, login: &str, now_ms: i64) -> Result<User> {
    sqlx::query_as::<_, User>(&format!(
        "INSERT INTO users (id, dev_login, login, created_at, updated_at)
         VALUES (?1, ?2, ?2, ?3, ?3)
         ON CONFLICT (dev_login) DO UPDATE SET updated_at = excluded.updated_at
         RETURNING {USER_COLS}"
    ))
    .bind(new_id())
    .bind(login)
    .bind(now_ms)
    .fetch_one(&db.writer)
    .await
    .context("upsert dev user")
}

// ------------------------------------------------------------ sessions

pub async fn create_session(
    db: &Db,
    id_hash: &str,
    user_id: &str,
    now_ms: i64,
    ttl_ms: i64,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)",
    )
    .bind(id_hash)
    .bind(user_id)
    .bind(now_ms)
    .bind(now_ms.saturating_add(ttl_ms))
    .execute(&db.writer)
    .await
    .context("create session")?;
    Ok(())
}

pub async fn session_user(db: &Db, id_hash: &str, now_ms: i64) -> Result<Option<User>> {
    sqlx::query_as::<_, User>(
        "SELECT u.id, u.github_id, u.login, u.name, u.avatar_url
         FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.id = ?1 AND s.expires_at > ?2",
    )
    .bind(id_hash)
    .bind(now_ms)
    .fetch_optional(&db.reader)
    .await
    .context("lookup session")
}

pub async fn delete_session(db: &Db, id_hash: &str) -> Result<()> {
    sqlx::query("DELETE FROM sessions WHERE id = ?1")
        .bind(id_hash)
        .execute(&db.writer)
        .await
        .context("delete session")?;
    Ok(())
}

/// Delete expired sessions; returns how many.
pub async fn delete_expired_sessions(db: &Db, now_ms: i64) -> Result<u64> {
    Ok(sqlx::query("DELETE FROM sessions WHERE expires_at <= ?1")
        .bind(now_ms)
        .execute(&db.writer)
        .await
        .context("delete expired sessions")?
        .rows_affected())
}

/// Whether a session row with this hash exists (tests: tokens are hashed).
pub async fn session_exists(db: &Db, id_hash: &str) -> Result<bool> {
    let n: i64 = sqlx::query_scalar("SELECT count(*) FROM sessions WHERE id = ?1")
        .bind(id_hash)
        .fetch_one(&db.reader)
        .await?;
    Ok(n > 0)
}

// ------------------------------------------------------------ companies

pub async fn company_for_user(db: &Db, user_id: &str) -> Result<Option<Company>> {
    sqlx::query_as::<_, Company>(&format!(
        "SELECT {COMPANY_COLS} FROM companies WHERE owner_user_id = ?1"
    ))
    .bind(user_id)
    .fetch_optional(&db.reader)
    .await
    .context("load company")
}

pub async fn company_by_id(db: &Db, id: &str) -> Result<Option<Company>> {
    sqlx::query_as::<_, Company>(&format!(
        "SELECT {COMPANY_COLS} FROM companies WHERE id = ?1"
    ))
    .bind(id)
    .fetch_optional(&db.reader)
    .await
    .context("load company")
}

/// Companies bound to the repo `owner/name` (case-insensitive; webhooks).
pub async fn companies_by_repo(db: &Db, full_name: &str) -> Result<Vec<Company>> {
    sqlx::query_as::<_, Company>(&format!(
        "SELECT {COMPANY_COLS} FROM companies WHERE lower(site_repo) = lower(?1) ORDER BY created_at"
    ))
    .bind(full_name)
    .fetch_all(&db.reader)
    .await
    .context("companies by repo")
}

/// Create the user's company. `Ok(None)` if they already own one.
pub async fn create_company(
    db: &Db,
    user_id: &str,
    name: &str,
    seed: u64,
    site_repo: &str,
    site_base_branch: &str,
    now_ms: i64,
) -> Result<Option<Company>> {
    sqlx::query_as::<_, Company>(&format!(
        "INSERT INTO companies (id, owner_user_id, name, seed, site_repo, site_base_branch, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT (owner_user_id) DO NOTHING
         RETURNING {COMPANY_COLS}"
    ))
    .bind(new_id())
    .bind(user_id)
    .bind(name)
    // The seed is an opaque 64-bit pattern; store its bits.
    .bind(seed as i64)
    .bind(site_repo)
    .bind(site_base_branch)
    .bind(now_ms)
    .fetch_optional(&db.writer)
    .await
    .context("create company")
}

// ------------------------------------------------------------ leases

/// Take or renew the company lease for `device_id` (atomic, `BEGIN IMMEDIATE`).
///
/// * no lease, or an expired one → a new lease for this device;
/// * this device's unexpired lease → renewed (same `lease_id`);
/// * another device's unexpired lease → [`LeaseOutcome::Held`], unless
///   `force`, which takes it over with a new `lease_id`.
pub async fn acquire_lease(
    db: &Db,
    company_id: &str,
    device_id: &str,
    force: bool,
    now_ms: i64,
    ttl_ms: i64,
) -> Result<LeaseOutcome> {
    let mut tx = db.begin_immediate().await?;
    let current = sqlx::query_as::<_, Lease>(
        "SELECT lease_id, device_id, expires_at FROM company_leases WHERE company_id = ?1",
    )
    .bind(company_id)
    .fetch_optional(&mut *tx)
    .await
    .context("load lease")?;
    let expires_at = now_ms.saturating_add(ttl_ms);
    let outcome = match current {
        Some(cur) if cur.expires_at > now_ms && cur.device_id == device_id => {
            sqlx::query(
                "UPDATE company_leases SET renewed_at = ?2, expires_at = ?3 WHERE company_id = ?1",
            )
            .bind(company_id)
            .bind(now_ms)
            .bind(expires_at)
            .execute(&mut *tx)
            .await
            .context("renew lease")?;
            LeaseOutcome::Granted {
                lease: Lease { expires_at, ..cur },
                renewed: true,
            }
        }
        Some(cur) if cur.expires_at > now_ms && !force => LeaseOutcome::Held(cur),
        _ => {
            let lease = Lease {
                lease_id: new_id(),
                device_id: device_id.to_string(),
                expires_at,
            };
            sqlx::query(
                "INSERT INTO company_leases
                    (company_id, lease_id, device_id, acquired_at, renewed_at, expires_at)
                 VALUES (?1, ?2, ?3, ?4, ?4, ?5)
                 ON CONFLICT (company_id) DO UPDATE SET
                    lease_id = excluded.lease_id, device_id = excluded.device_id,
                    acquired_at = excluded.acquired_at, renewed_at = excluded.renewed_at,
                    expires_at = excluded.expires_at",
            )
            .bind(company_id)
            .bind(&lease.lease_id)
            .bind(&lease.device_id)
            .bind(now_ms)
            .bind(expires_at)
            .execute(&mut *tx)
            .await
            .context("take lease")?;
            LeaseOutcome::Granted {
                lease,
                renewed: false,
            }
        }
    };
    tx.commit().await.context("commit lease")?;
    Ok(outcome)
}

/// The unexpired lease of a company, if any.
pub async fn active_lease(db: &Db, company_id: &str, now_ms: i64) -> Result<Option<Lease>> {
    sqlx::query_as::<_, Lease>(
        "SELECT lease_id, device_id, expires_at FROM company_leases
         WHERE company_id = ?1 AND expires_at > ?2",
    )
    .bind(company_id)
    .bind(now_ms)
    .fetch_optional(&db.reader)
    .await
    .context("load lease")
}

/// Release `lease_id` if it is the company's current lease. Returns whether
/// a lease was released.
pub async fn release_lease(db: &Db, company_id: &str, lease_id: &str) -> Result<bool> {
    Ok(
        sqlx::query("DELETE FROM company_leases WHERE company_id = ?1 AND lease_id = ?2")
            .bind(company_id)
            .bind(lease_id)
            .execute(&db.writer)
            .await
            .context("release lease")?
            .rows_affected()
            > 0,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn users_companies_and_leases() {
        let db = Db::memory().await.unwrap();
        let a = upsert_dev_user(&db, "ada", 1).await.unwrap();
        let again = upsert_dev_user(&db, "ada", 2).await.unwrap();
        assert_eq!(a.id, again.id);
        assert_eq!(a.github_id, None);
        let g = upsert_github_user(&db, 42, "gh", None, None, 1)
            .await
            .unwrap();
        assert_ne!(g.id, a.id);

        let c = create_company(&db, &a.id, "Gazette", u64::MAX, "o/r", "main", 5)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(c.seed as u64, u64::MAX, "seed bits round-trip");
        assert!(create_company(&db, &a.id, "Two", 1, "o/r", "main", 5)
            .await
            .unwrap()
            .is_none());
        assert_eq!(
            companies_by_repo(&db, "O/R").await.unwrap(),
            vec![c.clone()]
        );

        let LeaseOutcome::Granted { lease, renewed } =
            acquire_lease(&db, &c.id, "dev-a", false, 1000, 90_000)
                .await
                .unwrap()
        else {
            panic!("granted")
        };
        assert!(!renewed);
        assert_eq!(lease.expires_at, 91_000);
        assert_eq!(
            acquire_lease(&db, &c.id, "dev-b", false, 2000, 90_000)
                .await
                .unwrap(),
            LeaseOutcome::Held(lease.clone())
        );
        assert!(release_lease(&db, &c.id, &lease.lease_id).await.unwrap());
        assert!(active_lease(&db, &c.id, 2000).await.unwrap().is_none());
    }
}
