//! The projection mapping (ADR-0084 §3): repository objects ⇄ WordPress's rows.
//!
//! | Object | Rows |
//! |---|---|
//! | `post:ID` | `posts` (content as a block tree), its `postmeta`, its `term_relationships` |
//! | `term:term_id` | `terms`, its `term_taxonomy` rows, its `termmeta` |
//! | `option:name` | one `options` row (settings only; WordPress's own state is scratch) |
//! | `user:ID` | `users` (without the password hash), its `usermeta` |
//! | `comment:ID` | `comments`, its `commentmeta` |
//! | `link:ID` | `links` |
//!
//! Meta rows are keyed by their ids (`{"12": ["_thumbnail_id", "40"]}`) so two branches adding
//! different meta merge field by field. Scratch never becomes an object: auto-drafts,
//! revisions and other [`SCRATCH_POST_TYPES`], transients and cron, sessions, edit locks.
//!
//! Change capture: temporary triggers on the core tables record the object keys a request
//! touched; after the request, those objects are read back and compared with the repository.

use std::collections::{BTreeMap, BTreeSet};

use content_repo::blocks;
use serde_json::{json, Map, Value};

use crate::classify::{
    is_scratch_option, is_scratch_postmeta, is_scratch_usermeta, SCRATCH_POST_TYPES,
};
use crate::projection::Exec;

/// Each core table, the column naming its object, and the object kind.
const CAPTURE: &[(&str, &str, &str)] = &[
    ("posts", "ID", "post"),
    ("postmeta", "post_id", "post"),
    ("term_relationships", "object_id", "post"),
    ("terms", "term_id", "term"),
    ("term_taxonomy", "term_id", "term"),
    ("termmeta", "term_id", "term"),
    ("options", "option_name", "option"),
    ("users", "ID", "user"),
    ("usermeta", "user_id", "user"),
    ("comments", "comment_ID", "comment"),
    ("commentmeta", "comment_id", "comment"),
    ("links", "link_id", "link"),
];

/// Core tables with AUTOINCREMENT keys, whose high-water marks the repository keeps.
pub const ID_TABLES: &[&str] = &[
    "posts",
    "postmeta",
    "terms",
    "term_taxonomy",
    "termmeta",
    "users",
    "usermeta",
    "comments",
    "commentmeta",
    "links",
    "options",
];

fn lit(v: &Value) -> String {
    match v {
        Value::Null => "NULL".into(),
        Value::Bool(b) => (if *b { "1" } else { "0" }).into(),
        Value::Number(n) => n.to_string(),
        Value::String(s) => format!("'{}'", s.replace('\'', "''")),
        other => format!("'{}'", other.to_string().replace('\'', "''")),
    }
}

fn rows(db: &mut dyn Exec, sql: &str) -> Result<Vec<Map<String, Value>>, String> {
    let r = db.query(sql)?;
    Ok(r.rows
        .into_iter()
        .map(|row| r.columns.iter().cloned().zip(row).collect())
        .collect())
}

fn without(mut m: Map<String, Value>, cols: &[&str]) -> Map<String, Value> {
    for c in cols {
        m.remove(*c);
    }
    m
}

/// Installs the capture triggers (temporary: they live with the connection, not the schema).
pub fn install_capture(db: &mut dyn Exec, prefix: &str) -> Result<(), String> {
    let mut sql = String::from("CREATE TEMP TABLE IF NOT EXISTS _sp_changes (k TEXT NOT NULL);\n");
    for (table, col, kind) in CAPTURE {
        let t = format!("{prefix}{table}");
        for (event, rows) in [
            ("INSERT", &["NEW"][..]),
            ("UPDATE", &["NEW", "OLD"][..]),
            ("DELETE", &["OLD"][..]),
        ] {
            let body: String = rows
                .iter()
                .map(|r| format!("INSERT INTO _sp_changes VALUES ('{kind}:' || {r}.\"{col}\");"))
                .collect();
            sql.push_str(&format!("CREATE TEMP TRIGGER IF NOT EXISTS \"_sp_{t}_{e}\" AFTER {event} ON main.\"{t}\" BEGIN {body} END;\n", e = event.to_ascii_lowercase()));
        }
    }
    db.batch(&sql)
}

/// The object keys touched since the last call.
pub fn take_changes(db: &mut dyn Exec) -> Result<BTreeSet<String>, String> {
    let r = db.query("SELECT DISTINCT k FROM _sp_changes")?;
    db.batch("DELETE FROM _sp_changes")?;
    Ok(r.rows
        .into_iter()
        .filter_map(|row| row[0].as_str().map(str::to_string))
        .collect())
}

fn meta(
    db: &mut dyn Exec,
    table: &str,
    id_col: &str,
    owner_col: &str,
    owner: &Value,
    scratch: &dyn Fn(&str) -> bool,
) -> Result<Map<String, Value>, String> {
    let mut m = Map::new();
    for r in rows(db, &format!("SELECT \"{id_col}\" AS id, meta_key, meta_value FROM \"{table}\" WHERE \"{owner_col}\" = {} ORDER BY \"{id_col}\"", lit(owner)))? {
        let key = r.get("meta_key").and_then(Value::as_str).unwrap_or("");
        if scratch(key) {
            continue;
        }
        let id = r.get("id").map(|v| v.to_string()).unwrap_or_default();
        m.insert(id, json!([r.get("meta_key").cloned().unwrap_or(Value::Null), r.get("meta_value").cloned().unwrap_or(Value::Null)]));
    }
    Ok(m)
}

/// Reads an object from the projection; `None` if it does not exist or is scratch.
pub fn read_object(db: &mut dyn Exec, prefix: &str, key: &str) -> Result<Option<Value>, String> {
    let (kind, id) = key
        .split_once(':')
        .ok_or_else(|| format!("bad key {key}"))?;
    let t = |n: &str| format!("{prefix}{n}");
    let num = |s: &str| {
        s.parse::<i64>()
            .map(Value::from)
            .map_err(|_| format!("bad id in {key}"))
    };
    let never = |_: &str| false;
    Ok(match kind {
        "post" => {
            let idv = num(id)?;
            let Some(row) = rows(
                db,
                &format!("SELECT * FROM \"{}\" WHERE ID = {}", t("posts"), lit(&idv)),
            )?
            .pop() else {
                return Ok(None);
            };
            let status = row.get("post_status").and_then(Value::as_str).unwrap_or("");
            let ptype = row.get("post_type").and_then(Value::as_str).unwrap_or("");
            if status == "auto-draft" || SCRATCH_POST_TYPES.contains(&ptype) {
                return Ok(None);
            }
            let content = row
                .get("post_content")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let mut terms = Map::new();
            for r in rows(
                db,
                &format!(
                    "SELECT term_taxonomy_id, term_order FROM \"{}\" WHERE object_id = {}",
                    t("term_relationships"),
                    lit(&idv)
                ),
            )? {
                terms.insert(
                    r.get("term_taxonomy_id")
                        .map(|v| v.to_string())
                        .unwrap_or_default(),
                    r.get("term_order").cloned().unwrap_or(Value::from(0)),
                );
            }
            Some(json!({
                "row": without(row, &["ID", "post_content"]),
                "blocks": blocks::parse(&content),
                "meta": meta(db, &t("postmeta"), "meta_id", "post_id", &idv, &is_scratch_postmeta)?,
                "terms": terms,
            }))
        }
        "term" => {
            let idv = num(id)?;
            let Some(row) = rows(
                db,
                &format!(
                    "SELECT * FROM \"{}\" WHERE term_id = {}",
                    t("terms"),
                    lit(&idv)
                ),
            )?
            .pop() else {
                return Ok(None);
            };
            let mut tax = Map::new();
            for r in rows(
                db,
                &format!(
                    "SELECT * FROM \"{}\" WHERE term_id = {}",
                    t("term_taxonomy"),
                    lit(&idv)
                ),
            )? {
                let tt = r
                    .get("term_taxonomy_id")
                    .map(|v| v.to_string())
                    .unwrap_or_default();
                tax.insert(
                    tt,
                    Value::Object(without(r, &["term_taxonomy_id", "term_id"])),
                );
            }
            Some(
                json!({"row": without(row, &["term_id"]), "taxonomies": tax, "meta": meta(db, &t("termmeta"), "meta_id", "term_id", &idv, &never)?}),
            )
        }
        "option" => {
            if is_scratch_option(id) {
                return Ok(None);
            }
            let Some(row) = rows(
                db,
                &format!(
                    "SELECT option_value, autoload FROM \"{}\" WHERE option_name = {}",
                    t("options"),
                    lit(&Value::from(id))
                ),
            )?
            .pop() else {
                return Ok(None);
            };
            Some(json!({"value": row.get("option_value"), "autoload": row.get("autoload")}))
        }
        "user" => {
            let idv = num(id)?;
            let Some(row) = rows(
                db,
                &format!("SELECT * FROM \"{}\" WHERE ID = {}", t("users"), lit(&idv)),
            )?
            .pop() else {
                return Ok(None);
            };
            // The password hash and reset key never leave the sandbox: sign-in is the governed layer's.
            Some(
                json!({"row": without(row, &["ID", "user_pass", "user_activation_key"]), "meta": meta(db, &t("usermeta"), "umeta_id", "user_id", &idv, &is_scratch_usermeta)?}),
            )
        }
        "comment" => {
            let idv = num(id)?;
            let Some(row) = rows(
                db,
                &format!(
                    "SELECT * FROM \"{}\" WHERE comment_ID = {}",
                    t("comments"),
                    lit(&idv)
                ),
            )?
            .pop() else {
                return Ok(None);
            };
            Some(
                json!({"row": without(row, &["comment_ID"]), "meta": meta(db, &t("commentmeta"), "meta_id", "comment_id", &idv, &never)?}),
            )
        }
        "link" => {
            let idv = num(id)?;
            let Some(row) = rows(
                db,
                &format!(
                    "SELECT * FROM \"{}\" WHERE link_id = {}",
                    t("links"),
                    lit(&idv)
                ),
            )?
            .pop() else {
                return Ok(None);
            };
            Some(json!({"row": without(row, &["link_id"])}))
        }
        other => return Err(format!("unknown object kind {other}")),
    })
}

fn insert(db: &mut dyn Exec, table: &str, cols: &Map<String, Value>) -> Result<(), String> {
    let names: Vec<String> = cols.keys().map(|k| format!("\"{k}\"")).collect();
    let values: Vec<String> = cols.values().map(lit).collect();
    db.execute(&format!(
        "INSERT INTO \"{table}\" ({}) VALUES ({})",
        names.join(", "),
        values.join(", ")
    ))
    .map(|_| ())
}

fn insert_meta(
    db: &mut dyn Exec,
    table: &str,
    id_col: &str,
    owner_col: &str,
    owner: &Value,
    meta: Option<&Value>,
) -> Result<(), String> {
    for (mid, kv) in meta.and_then(Value::as_object).into_iter().flatten() {
        let mut m = Map::new();
        if let Ok(n) = mid.parse::<i64>() {
            m.insert(id_col.into(), Value::from(n));
        }
        m.insert(owner_col.into(), owner.clone());
        m.insert("meta_key".into(), kv.get(0).cloned().unwrap_or(Value::Null));
        m.insert(
            "meta_value".into(),
            kv.get(1).cloned().unwrap_or(Value::Null),
        );
        insert(db, table, &m)?;
    }
    Ok(())
}

/// Removes an object's rows.
pub fn delete_object(db: &mut dyn Exec, prefix: &str, key: &str) -> Result<(), String> {
    let (kind, id) = key
        .split_once(':')
        .ok_or_else(|| format!("bad key {key}"))?;
    let t = |n: &str| format!("{prefix}{n}");
    let v = if kind == "option" {
        lit(&Value::from(id))
    } else {
        id.parse::<i64>()
            .map_err(|_| format!("bad id in {key}"))?
            .to_string()
    };
    let stmts: Vec<String> = match kind {
        "post" => vec![
            format!("DELETE FROM \"{}\" WHERE ID = {v}", t("posts")),
            format!("DELETE FROM \"{}\" WHERE post_id = {v}", t("postmeta")),
            format!(
                "DELETE FROM \"{}\" WHERE object_id = {v}",
                t("term_relationships")
            ),
        ],
        "term" => vec![
            format!("DELETE FROM \"{}\" WHERE term_id = {v}", t("terms")),
            format!("DELETE FROM \"{}\" WHERE term_id = {v}", t("term_taxonomy")),
            format!("DELETE FROM \"{}\" WHERE term_id = {v}", t("termmeta")),
        ],
        "option" => vec![format!(
            "DELETE FROM \"{}\" WHERE option_name = {v}",
            t("options")
        )],
        "user" => vec![
            format!("DELETE FROM \"{}\" WHERE ID = {v}", t("users")),
            format!("DELETE FROM \"{}\" WHERE user_id = {v}", t("usermeta")),
        ],
        "comment" => vec![
            format!("DELETE FROM \"{}\" WHERE comment_ID = {v}", t("comments")),
            format!(
                "DELETE FROM \"{}\" WHERE comment_id = {v}",
                t("commentmeta")
            ),
        ],
        "link" => vec![format!(
            "DELETE FROM \"{}\" WHERE link_id = {v}",
            t("links")
        )],
        other => return Err(format!("unknown object kind {other}")),
    };
    for s in stmts {
        db.execute(&s)?;
    }
    Ok(())
}

/// Writes an object's rows (after [`delete_object`] when it replaces one).
pub fn write_object(db: &mut dyn Exec, prefix: &str, key: &str, v: &Value) -> Result<(), String> {
    let (kind, id) = key
        .split_once(':')
        .ok_or_else(|| format!("bad key {key}"))?;
    let t = |n: &str| format!("{prefix}{n}");
    let row = |col: &str, idv: Value| {
        let mut m = v
            .get("row")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        m.insert(col.into(), idv);
        m
    };
    let num = || {
        id.parse::<i64>()
            .map(Value::from)
            .map_err(|_| format!("bad id in {key}"))
    };
    match kind {
        "post" => {
            let idv = num()?;
            let mut r = row("ID", idv.clone());
            let tree: Vec<blocks::Node> =
                serde_json::from_value(v.get("blocks").cloned().unwrap_or(json!([])))
                    .map_err(|e| e.to_string())?;
            r.insert(
                "post_content".into(),
                Value::String(blocks::serialize(&tree)),
            );
            insert(db, &t("posts"), &r)?;
            insert_meta(
                db,
                &t("postmeta"),
                "meta_id",
                "post_id",
                &idv,
                v.get("meta"),
            )?;
            for (tt, order) in v
                .get("terms")
                .and_then(Value::as_object)
                .into_iter()
                .flatten()
            {
                let mut m = Map::new();
                m.insert("object_id".into(), idv.clone());
                m.insert(
                    "term_taxonomy_id".into(),
                    tt.parse::<i64>().map(Value::from).unwrap_or(Value::Null),
                );
                m.insert("term_order".into(), order.clone());
                insert(db, &t("term_relationships"), &m)?;
            }
        }
        "term" => {
            let idv = num()?;
            insert(db, &t("terms"), &row("term_id", idv.clone()))?;
            for (tt, tax) in v
                .get("taxonomies")
                .and_then(Value::as_object)
                .into_iter()
                .flatten()
            {
                let mut m = tax.as_object().cloned().unwrap_or_default();
                m.insert(
                    "term_taxonomy_id".into(),
                    tt.parse::<i64>().map(Value::from).unwrap_or(Value::Null),
                );
                m.insert("term_id".into(), idv.clone());
                insert(db, &t("term_taxonomy"), &m)?;
            }
            insert_meta(
                db,
                &t("termmeta"),
                "meta_id",
                "term_id",
                &idv,
                v.get("meta"),
            )?;
        }
        "option" => {
            let mut m = Map::new();
            m.insert("option_name".into(), Value::from(id));
            m.insert(
                "option_value".into(),
                v.get("value").cloned().unwrap_or(Value::from("")),
            );
            m.insert(
                "autoload".into(),
                v.get("autoload").cloned().unwrap_or(Value::from("yes")),
            );
            insert(db, &t("options"), &m)?;
        }
        "user" => {
            let idv = num()?;
            // No password: nobody signs in to the sandbox with one (the governed layer does sign-in).
            insert(db, &t("users"), &row("ID", idv.clone()))?;
            insert_meta(
                db,
                &t("usermeta"),
                "umeta_id",
                "user_id",
                &idv,
                v.get("meta"),
            )?;
        }
        "comment" => {
            let idv = num()?;
            insert(db, &t("comments"), &row("comment_ID", idv.clone()))?;
            insert_meta(
                db,
                &t("commentmeta"),
                "meta_id",
                "comment_id",
                &idv,
                v.get("meta"),
            )?;
        }
        "link" => insert(db, &t("links"), &row("link_id", num()?))?,
        other => return Err(format!("unknown object kind {other}")),
    }
    Ok(())
}

/// Every governed object in the projection (an import of an existing WordPress database).
pub fn read_all(db: &mut dyn Exec, prefix: &str) -> Result<BTreeMap<String, Value>, String> {
    let mut keys = Vec::new();
    for (table, col, kind) in [
        ("posts", "ID", "post"),
        ("terms", "term_id", "term"),
        ("options", "option_name", "option"),
        ("users", "ID", "user"),
        ("comments", "comment_ID", "comment"),
        ("links", "link_id", "link"),
    ] {
        let r = db.query(&format!(
            "SELECT \"{col}\" FROM \"{prefix}{table}\" ORDER BY 1"
        ))?;
        for row in r.rows {
            let id = match &row[0] {
                Value::String(s) => s.clone(),
                other => other.to_string(),
            };
            keys.push(format!("{kind}:{id}"));
        }
    }
    let mut out = BTreeMap::new();
    for k in keys {
        if let Some(v) = read_object(db, prefix, &k)? {
            out.insert(k, v);
        }
    }
    Ok(out)
}

/// The table's AUTOINCREMENT high-water marks in the projection.
pub fn sequences(db: &mut dyn Exec, prefix: &str) -> Result<BTreeMap<String, i64>, String> {
    let r = db.query("SELECT name, seq FROM sqlite_sequence")?;
    Ok(r.rows
        .into_iter()
        .filter_map(|row| {
            let name = row[0].as_str()?.strip_prefix(prefix)?.to_string();
            ID_TABLES
                .contains(&name.as_str())
                .then(|| (name, row[1].as_i64().unwrap_or(0)))
        })
        .collect())
}

/// Moves the AUTOINCREMENT counters to at least the repository's high-water marks, so a branch
/// never hands out an id another branch already used.
pub fn raise_sequences(
    db: &mut dyn Exec,
    prefix: &str,
    marks: &BTreeMap<String, i64>,
) -> Result<(), String> {
    for (table, id) in marks {
        let t = format!("{prefix}{table}");
        db.execute(&format!(
            "UPDATE sqlite_sequence SET seq = max(seq, {id}) WHERE name = '{t}'"
        ))?;
        db.execute(&format!("INSERT INTO sqlite_sequence (name, seq) SELECT '{t}', {id} WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = '{t}')"))?;
    }
    Ok(())
}
