//! The two channels of the storage API, as JSON messages (ADR-0084 §3, ADR-0078 §3).
//!
//! **storage**: what the fork's seams send from inside the GPL sandbox. Every message carries
//! `op` and the PHP request's `rid`:
//!
//! | op | arguments | reply |
//! |---|---|---|
//! | `query` | `sql` (MySQL) | `columns`, `rows` (text), `rows_affected`, `insert_id` |
//! | `end` | `uri`, `method` | `commit` (the new head, or null) |
//! | `session` | — | `user_id` |
//! | `asset.put` | `path`, `mime`, `data` (base64) | `sha256` |
//! | `asset.get` | `path` | `mime`, `data` (base64) |
//! | `mail` | `to`, `subject`, `message`, `headers` | `queued` |
//! | `http` | `method`, `url`, `headers`, `body`, `timeout` | `status`, `headers`, `body` |
//!
//! Any failure is `{"error": "…"}`; for `query` it becomes `wpdb::$last_error`.
//!
//! **repo**: the governed API the game, the runner and the orchestrator use. WordPress never
//! sees it. Sessions bind a sandbox to a branch and a signed-in user; branches, change requests,
//! merges and releases are the repository's.
//!
//! Who the author of a commit is comes from the session, never from WordPress.

use base64::Engine as _;
use content_repo::{Author, CrStatus, RepoError, LIVE};
use serde_json::{json, Value};
use sha2::{Digest as _, Sha256};

use crate::host::Host;
use crate::projection::Exec;

/// What a sandbox is bound to.
#[derive(Debug, Clone, PartialEq)]
pub struct Session {
    pub branch: String,
    /// The WordPress user signed in (0 for a visitor).
    pub user_id: i64,
    /// Who commits made in this session are attributed to.
    pub author: Author,
}

impl Default for Session {
    fn default() -> Self {
        Session {
            branch: LIVE.into(),
            user_id: 0,
            author: Author::system("install"),
        }
    }
}

/// The platform services behind the storage channel.
pub trait Platform {
    /// Stores bytes in object storage; returns their SHA-256 (hex).
    fn put_bytes(&mut self, bytes: &[u8]) -> Result<String, String>;
    fn get_bytes(&mut self, sha256: &str) -> Result<Vec<u8>, String>;
    /// Records a mail in the outbox.
    fn mail(&mut self, mail: Value) -> Result<(), String>;
    /// Sends an outgoing request through the fetch proxy.
    fn http(&mut self, request: Value) -> Result<Value, String>;
}

fn err(e: impl std::fmt::Display) -> Value {
    json!({"error": e.to_string()})
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// Handles one storage-channel message from the sandbox bound to `session`.
pub fn storage<E: Exec>(
    host: &mut Host<E>,
    session: &Session,
    platform: &mut dyn Platform,
    msg: &Value,
) -> Value {
    let s = |k: &str| msg.get(k).and_then(Value::as_str).unwrap_or("");
    match s("op") {
        "query" => match host.query(&session.branch, s("sql")) {
            Ok(out) => {
                json!({"columns": out.columns, "rows": out.rows, "rows_affected": out.rows_affected, "insert_id": out.insert_id})
            }
            Err(e) => err(e),
        },
        "end" => {
            let message = format!("{} {}", s("method"), s("uri"));
            match host.end_request(&session.branch, session.author.clone(), message.trim()) {
                Ok(head) => json!({"commit": head}),
                Err(e) => err(e),
            }
        }
        "session" => json!({"user_id": session.user_id}),
        "asset.put" => {
            let bytes = match base64::engine::general_purpose::STANDARD.decode(s("data")) {
                Ok(b) => b,
                Err(e) => return err(format!("asset.put: {e}")),
            };
            let sha = match platform.put_bytes(&bytes) {
                Ok(sha) => sha,
                Err(e) => return err(e),
            };
            match host.put_asset(
                &session.branch,
                s("path"),
                &sha,
                s("mime"),
                bytes.len() as u64,
            ) {
                Ok(()) => json!({"sha256": sha}),
                Err(e) => err(e),
            }
        }
        "asset.get" => {
            let Some(sha) = host.asset(&session.branch, s("path")) else {
                return err(format!("asset.get: no asset at {}", s("path")));
            };
            let mime = host
                .repo
                .get(&session.branch, &format!("asset:{}", s("path")))
                .and_then(|v| v.get("mime").cloned())
                .unwrap_or(Value::Null);
            match platform.get_bytes(&sha) {
                Ok(b) => {
                    json!({"mime": mime, "sha256": sha, "data": base64::engine::general_purpose::STANDARD.encode(b)})
                }
                Err(e) => err(e),
            }
        }
        "mail" => {
            let mut m = msg.clone();
            if let Some(o) = m.as_object_mut() {
                o.remove("op");
                o.remove("rid");
                o.insert("branch".into(), json!(session.branch));
            }
            match platform.mail(m) {
                Ok(()) => json!({"queued": true}),
                Err(e) => err(e),
            }
        }
        "http" => {
            let mut req = msg.clone();
            if let Some(o) = req.as_object_mut() {
                o.remove("op");
                o.remove("rid");
            }
            platform.http(req).unwrap_or_else(err)
        }
        other => err(format!("unknown storage op {other:?}")),
    }
}

fn author_of(v: Option<&Value>) -> Author {
    v.and_then(|a| serde_json::from_value(a.clone()).ok())
        .unwrap_or_else(|| Author::system("api"))
}

fn repo_err(e: RepoError) -> Value {
    match e {
        RepoError::Conflicts(c) => json!({"error": "conflicts", "conflicts": c}),
        other => err(other),
    }
}

/// Handles one governed-API message. `session` is the sandbox's binding, which `session.set`
/// changes.
pub fn repo<E: Exec>(host: &mut Host<E>, session: &mut Session, msg: &Value) -> Value {
    let s = |k: &str| msg.get(k).and_then(Value::as_str).unwrap_or("").to_string();
    match s("op").as_str() {
        "session.set" => {
            if let Some(b) = msg.get("branch").and_then(Value::as_str) {
                session.branch = b.into();
            }
            if let Some(u) = msg.get("user_id").and_then(Value::as_i64) {
                session.user_id = u;
            }
            if msg.get("author").is_some() {
                session.author = author_of(msg.get("author"));
            }
            json!({"branch": session.branch, "user_id": session.user_id, "author": session.author})
        }
        "import.finish" => {
            host.finish_import();
            json!({"importing": false, "live": host.repo.head(LIVE)})
        }
        "branches" => json!(host
            .repo
            .branches()
            .map(|(n, h)| json!({"name": n, "head": h}))
            .collect::<Vec<_>>()),
        "branch.create" => match host.repo.create_branch(
            &s("name"),
            msg.get("from").and_then(Value::as_str).unwrap_or(LIVE),
        ) {
            Ok(head) => json!({"name": s("name"), "head": head}),
            Err(e) => repo_err(e),
        },
        "branch.delete" => {
            host.drop_projection(&s("name"));
            match host.repo.delete_branch(&s("name")) {
                Ok(()) => json!({"deleted": s("name")}),
                Err(e) => repo_err(e),
            }
        }
        "log" => {
            let limit = msg.get("limit").and_then(Value::as_u64).unwrap_or(50) as usize;
            json!(host.repo.log(&s("branch")).into_iter().take(limit).map(|c| json!({"id": c.id, "parents": c.parents, "author": c.author, "message": c.message, "seq": c.seq})).collect::<Vec<_>>())
        }
        "object" => json!({"key": s("key"), "value": host.repo.get(&s("branch"), &s("key"))}),
        "objects" => {
            let prefix = s("prefix");
            json!(host
                .repo
                .materialize(&s("branch"))
                .into_iter()
                .filter(|(k, _)| k.starts_with(&prefix))
                .map(|(k, v)| json!({"key": k, "value": v}))
                .collect::<Vec<_>>())
        }
        "cr.open" => {
            let wi = msg.get("work_item").and_then(Value::as_u64);
            match host.repo.open_change_request(
                &s("source"),
                msg.get("target").and_then(Value::as_str).unwrap_or(LIVE),
                &s("title"),
                author_of(msg.get("author")),
                wi,
            ) {
                Ok(id) => json!({"id": id}),
                Err(e) => repo_err(e),
            }
        }
        "cr.get" => {
            let id = msg.get("id").and_then(Value::as_u64).unwrap_or(0);
            match (
                host.repo.change_request(id).cloned(),
                host.repo.change_request_diff(id),
            ) {
                (Some(cr), Ok(diff)) => json!({"change_request": cr, "diff": diff}),
                (_, Err(e)) => repo_err(e),
                (None, _) => repo_err(RepoError::UnknownChangeRequest(id)),
            }
        }
        "cr.list" => json!(host
            .repo
            .change_requests()
            .filter(|c| msg.get("open").and_then(Value::as_bool) != Some(true)
                || c.status == CrStatus::Open)
            .collect::<Vec<_>>()),
        "cr.merge" => {
            let id = msg.get("id").and_then(Value::as_u64).unwrap_or(0);
            let Some(cr) = host.repo.change_request(id).cloned() else {
                return repo_err(RepoError::UnknownChangeRequest(id));
            };
            // The merge queue: the target's current head, checked again by the compare-and-swap.
            let expected = host.repo.head(&cr.target).cloned();
            match host.repo.merge_change_request(
                id,
                expected.as_ref(),
                author_of(msg.get("author")),
                &crate::derived::recount_terms,
            ) {
                Ok(head) => json!({"id": id, "head": head}),
                Err(e) => repo_err(e),
            }
        }
        "cr.close" => {
            let id = msg.get("id").and_then(Value::as_u64).unwrap_or(0);
            match host.repo.close_change_request(id) {
                Ok(()) => json!({"id": id, "status": "closed"}),
                Err(e) => repo_err(e),
            }
        }
        "release" => match host.repo.release(&s("name")) {
            Ok(r) => json!(r),
            Err(e) => repo_err(e),
        },
        "releases" => json!(host.repo.releases().collect::<Vec<_>>()),
        "rollback" => match host.repo.rollback(
            msg.get("release").and_then(Value::as_u64).unwrap_or(0),
            author_of(msg.get("author")),
        ) {
            Ok(head) => json!({"head": head}),
            Err(e) => repo_err(e),
        },
        other => err(format!("unknown repo op {other:?}")),
    }
}
