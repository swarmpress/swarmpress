//! Users, sessions, companies and the company's executor lease.

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
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

/// Who may hold a company's lease (ADR-0045).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ExecutorKind {
    /// A browser tab on the player's device.
    Browser,
    /// A runner the player hosts.
    #[serde(rename = "self")]
    SelfHosted,
    /// A managed runner.
    Cloud,
}

impl ExecutorKind {
    pub fn as_str(self) -> &'static str {
        match self {
            ExecutorKind::Browser => "browser",
            ExecutorKind::SelfHosted => "self",
            ExecutorKind::Cloud => "cloud",
        }
    }
}

/// What a lease request asks for (ADR-0045 decision 3).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LeaseMode {
    /// Extend the presented lease; the epoch is unchanged.
    Renew,
    /// Take a free, expired or released lease (or the caller's own); epoch + 1.
    Acquire,
    /// Ask the holder to hand over; takes the lease when it is free.
    Request,
    /// Take over immediately; epoch + 1.
    Force,
}

/// The sealed head of the company's history on the executor row: the number
/// of its last entry and that entry's digest (`0`, `None` before anything
/// was sealed). Nothing moves it yet; fenced sync compares and swaps it.
#[derive(Clone, Debug, Default, Serialize, PartialEq, Eq)]
pub struct LogHead {
    pub number: i64,
    pub digest: Option<String>,
}

/// A company's executor lease (ADR-0045): the holder and its fencing epoch.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Lease {
    /// Monotonic; rises on every change of holder.
    pub epoch: i64,
    pub lease_id: String,
    /// The holder's id (a device id for browsers).
    pub holder_id: String,
    pub holder_kind: String,
    /// Unix ms. Liveness only.
    pub expires_at: i64,
    /// Who asked this holder to hand over, if anyone.
    pub handover_by: Option<String>,
    pub head: LogHead,
}

impl Lease {
    /// The fencing token: `<epoch>.<lease_id>`.
    pub fn token(&self) -> String {
        format!("{}.{}", self.epoch, self.lease_id)
    }
}

/// The holder a new grant displaced.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Revoked {
    pub epoch: i64,
    pub holder_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LeaseOutcome {
    /// The caller holds the lease now. `renewed`: the epoch did not change.
    /// `revoked`: the unreleased lease this grant replaced, if any.
    Granted {
        lease: Lease,
        renewed: bool,
        revoked: Option<Revoked>,
    },
    /// Another executor holds an unexpired lease. `handover_requested`: this
    /// call recorded a handover request.
    Held {
        holder: Lease,
        handover_requested: bool,
    },
    /// A renew whose lease is no longer the company's current one.
    NotHeld,
}

/// Split a fencing token `<epoch>.<lease_id>`.
pub fn parse_lease_token(token: &str) -> Option<(i64, &str)> {
    let (epoch, lease_id) = token.split_once('.')?;
    let epoch = epoch.parse::<i64>().ok().filter(|e| *e > 0)?;
    (!lease_id.is_empty()).then_some((epoch, lease_id))
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

#[derive(FromRow)]
struct ExecutorRow {
    epoch: i64,
    holder_kind: Option<String>,
    holder_id: Option<String>,
    lease_id: Option<String>,
    expires_at: Option<i64>,
    head_number: i64,
    head_digest: Option<String>,
    handover_by: Option<String>,
}

const EXECUTOR_COLS: &str = "epoch, holder_kind, holder_id, lease_id, expires_at, \
     head_number, head_digest, handover_by";

impl ExecutorRow {
    fn head(&self) -> LogHead {
        LogHead {
            number: self.head_number,
            digest: self.head_digest.clone(),
        }
    }

    /// The lease on this row, if it has not been released.
    fn lease(&self) -> Option<Lease> {
        Some(Lease {
            epoch: self.epoch,
            lease_id: self.lease_id.clone()?,
            holder_id: self.holder_id.clone()?,
            holder_kind: self.holder_kind.clone()?,
            expires_at: self.expires_at?,
            handover_by: self.handover_by.clone(),
            head: self.head(),
        })
    }
}

/// A lease request (see [`lease_op`]).
pub struct LeaseRequest<'a> {
    pub mode: LeaseMode,
    pub holder_id: &'a str,
    pub kind: ExecutorKind,
    /// The presented fencing token (`renew` only).
    pub presented: Option<(i64, &'a str)>,
    pub now_ms: i64,
    pub ttl_ms: i64,
}

/// Renew, acquire, request or force the company lease (atomic,
/// `BEGIN IMMEDIATE`; ADR-0045 decision 3).
///
/// * `renew`: the presented `<epoch>.<lease_id>` is still the row's lease →
///   extended, even past expiry; otherwise [`LeaseOutcome::NotHeld`].
/// * `acquire`: free, expired, released, or held by this same holder → a new
///   lease at epoch + 1; another holder's unexpired lease →
///   [`LeaseOutcome::Held`].
/// * `request`: like `acquire`, but a held lease also records the handover
///   request, which its holder sees on its next renew.
/// * `force`: a new lease at epoch + 1, whoever holds it.
///
/// The epoch rises on every grant that is not a renew and is never reset.
pub async fn lease_op(db: &Db, company_id: &str, req: LeaseRequest<'_>) -> Result<LeaseOutcome> {
    let mut tx = db.begin_immediate().await?;
    let row = sqlx::query_as::<_, ExecutorRow>(&format!(
        "SELECT {EXECUTOR_COLS} FROM company_executors WHERE company_id = ?1"
    ))
    .bind(company_id)
    .fetch_optional(&mut *tx)
    .await
    .context("load executor")?;
    let current = row.as_ref().and_then(ExecutorRow::lease);
    let expires_at = req.now_ms.saturating_add(req.ttl_ms);

    if req.mode == LeaseMode::Renew {
        let outcome = match (current, req.presented) {
            (Some(cur), Some((epoch, lease_id)))
                if cur.epoch == epoch && cur.lease_id == lease_id =>
            {
                sqlx::query(
                    "UPDATE company_executors SET renewed_at = ?2, expires_at = ?3
                     WHERE company_id = ?1",
                )
                .bind(company_id)
                .bind(req.now_ms)
                .bind(expires_at)
                .execute(&mut *tx)
                .await
                .context("renew lease")?;
                LeaseOutcome::Granted {
                    lease: Lease { expires_at, ..cur },
                    renewed: true,
                    revoked: None,
                }
            }
            _ => LeaseOutcome::NotHeld,
        };
        tx.commit().await.context("commit lease")?;
        return Ok(outcome);
    }

    let held_by_other = current
        .as_ref()
        .is_some_and(|cur| cur.expires_at > req.now_ms && cur.holder_id != req.holder_id);
    let outcome = match current {
        Some(mut holder) if held_by_other && req.mode != LeaseMode::Force => {
            let handover_requested = req.mode == LeaseMode::Request;
            if handover_requested {
                sqlx::query(
                    "UPDATE company_executors SET handover_by = ?2, handover_deadline = ?3
                     WHERE company_id = ?1",
                )
                .bind(company_id)
                .bind(req.holder_id)
                .bind(expires_at)
                .execute(&mut *tx)
                .await
                .context("request handover")?;
                holder.handover_by = Some(req.holder_id.to_string());
            }
            LeaseOutcome::Held {
                holder,
                handover_requested,
            }
        }
        current => {
            let epoch = row.as_ref().map_or(0, |r| r.epoch).saturating_add(1);
            let head = row.as_ref().map(ExecutorRow::head).unwrap_or_default();
            let lease = Lease {
                epoch,
                lease_id: new_id(),
                holder_id: req.holder_id.to_string(),
                holder_kind: req.kind.as_str().to_string(),
                expires_at,
                handover_by: None,
                head,
            };
            sqlx::query(
                "INSERT INTO company_executors
                    (company_id, epoch, holder_kind, holder_id, lease_id,
                     acquired_at, renewed_at, expires_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, ?7)
                 ON CONFLICT (company_id) DO UPDATE SET
                    epoch = excluded.epoch, holder_kind = excluded.holder_kind,
                    holder_id = excluded.holder_id, lease_id = excluded.lease_id,
                    acquired_at = excluded.acquired_at, renewed_at = excluded.renewed_at,
                    expires_at = excluded.expires_at,
                    handover_by = NULL, handover_deadline = NULL",
            )
            .bind(company_id)
            .bind(lease.epoch)
            .bind(&lease.holder_kind)
            .bind(&lease.holder_id)
            .bind(&lease.lease_id)
            .bind(req.now_ms)
            .bind(expires_at)
            .execute(&mut *tx)
            .await
            .context("take lease")?;
            LeaseOutcome::Granted {
                lease,
                renewed: false,
                revoked: current.map(|cur| Revoked {
                    epoch: cur.epoch,
                    holder_id: cur.holder_id,
                }),
            }
        }
    };
    tx.commit().await.context("commit lease")?;
    Ok(outcome)
}

/// The company's unreleased lease, expired or not.
pub async fn current_lease(db: &Db, company_id: &str) -> Result<Option<Lease>> {
    Ok(sqlx::query_as::<_, ExecutorRow>(&format!(
        "SELECT {EXECUTOR_COLS} FROM company_executors WHERE company_id = ?1"
    ))
    .bind(company_id)
    .fetch_optional(&db.reader)
    .await
    .context("load executor")?
    .as_ref()
    .and_then(ExecutorRow::lease))
}

/// The company's lease if `epoch.lease_id` is its current, unexpired one.
pub async fn fenced_lease(
    db: &Db,
    company_id: &str,
    epoch: i64,
    lease_id: &str,
    now_ms: i64,
) -> Result<Option<Lease>> {
    Ok(current_lease(db, company_id)
        .await?
        .filter(|l| l.epoch == epoch && l.lease_id == lease_id && l.expires_at > now_ms))
}

/// Release `epoch.lease_id` if it is the company's current lease. The row and
/// its epoch stay. Returns whether a lease was released.
pub async fn release_lease(db: &Db, company_id: &str, epoch: i64, lease_id: &str) -> Result<bool> {
    Ok(sqlx::query(
        "UPDATE company_executors SET
            holder_kind = NULL, holder_id = NULL, lease_id = NULL,
            expires_at = NULL, handover_by = NULL, handover_deadline = NULL
         WHERE company_id = ?1 AND epoch = ?2 AND lease_id = ?3",
    )
    .bind(company_id)
    .bind(epoch)
    .bind(lease_id)
    .execute(&db.writer)
    .await
    .context("release lease")?
    .rows_affected()
        > 0)
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

        let req = |mode, holder_id| LeaseRequest {
            mode,
            holder_id,
            kind: ExecutorKind::Browser,
            presented: None,
            now_ms: 1000,
            ttl_ms: 90_000,
        };
        let LeaseOutcome::Granted {
            lease,
            renewed,
            revoked,
        } = lease_op(&db, &c.id, req(LeaseMode::Acquire, "dev-a"))
            .await
            .unwrap()
        else {
            panic!("granted")
        };
        assert!(!renewed);
        assert_eq!(revoked, None);
        assert_eq!((lease.epoch, lease.expires_at), (1, 91_000));
        assert_eq!(
            parse_lease_token(&lease.token()),
            Some((1, lease.lease_id.as_str()))
        );
        assert_eq!(
            lease_op(&db, &c.id, req(LeaseMode::Acquire, "dev-b"))
                .await
                .unwrap(),
            LeaseOutcome::Held {
                holder: lease.clone(),
                handover_requested: false
            }
        );
        assert!(!release_lease(&db, &c.id, 2, &lease.lease_id).await.unwrap());
        assert!(release_lease(&db, &c.id, 1, &lease.lease_id).await.unwrap());
        assert!(current_lease(&db, &c.id).await.unwrap().is_none());
        // The epoch survives the release.
        let LeaseOutcome::Granted { lease, .. } =
            lease_op(&db, &c.id, req(LeaseMode::Acquire, "dev-b"))
                .await
                .unwrap()
        else {
            panic!("granted")
        };
        assert_eq!(lease.epoch, 2);
        assert_eq!(parse_lease_token("nope"), None);
        assert_eq!(parse_lease_token("0.x"), None);
        assert_eq!(parse_lease_token("3."), None);
    }
}
