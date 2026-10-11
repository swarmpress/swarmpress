//! The object API (ADR-0084 §4, Generation 2): semantic operations the fork's object seams call
//! instead of sending SQL a statement at a time. Each answers in one message what WordPress would
//! otherwise ask in several, read from the branch's projection (so plugins' Generation 1 SQL and
//! these see the same state):
//!
//! - `options.all`: every option with its autoload flag (`wp_load_alloptions`; `get_option` then
//!   knows an option is missing without asking);
//! - `posts.prime {ids, meta, taxonomies}`: post rows, their meta, and their terms of the given
//!   taxonomies with the object ids (`_prime_post_caches`, `update_post_caches`);
//! - `posts.query {sql, meta, taxonomies}`: `WP_Query`'s own final SQL (filters applied, so plugins
//!   keep shaping it), its found rows, and the priming of the posts it found;
//! - `meta.load {type, ids}`: an object type's meta rows (the metadata API's `update_meta_cache`);
//! - `terms.of {ids, taxonomies}`: the objects' terms with their object ids (the term API's
//!   `update_object_term_cache`);
//! - `post.save {data, id?}`: `wp_insert_post` / `wp_update_post`'s row, inserted or updated.
//!
//! Rows are `{columns, rows}` with text values, as the `query` op answers.

use serde_json::{json, Value};

use crate::host::{Host, HostError};
use crate::projection::{Exec, Outcome};

fn table(out: Outcome) -> Value {
    json!({ "columns": out.columns, "rows": out.rows })
}

fn ids_of(msg: &Value, key: &str) -> Vec<i64> {
    msg.get(key)
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_i64)
        .filter(|i| *i > 0)
        .collect()
}

fn quote(s: &str) -> String {
    format!("'{}'", s.replace('\\', "\\\\").replace('\'', "\\'"))
}

fn literal(v: &Value) -> String {
    match v {
        Value::Null => "NULL".into(),
        Value::Bool(b) => (if *b { "1" } else { "0" }).into(),
        Value::Number(n) => n.to_string(),
        Value::String(s) => quote(s),
        other => quote(&other.to_string()),
    }
}

fn empty() -> Value {
    json!({"columns": [], "rows": []})
}

fn id_list(ids: &[i64]) -> String {
    ids.iter().map(i64::to_string).collect::<Vec<_>>().join(",")
}

/// Meta rows of `meta_type` objects (`post`, `term`, `user`, `comment`), as `update_meta_cache` reads them.
fn meta_rows<E: Exec>(
    host: &mut Host<E>,
    branch: &str,
    meta_type: &str,
    ids: &[i64],
) -> Result<Value, HostError> {
    if ids.is_empty() || !matches!(meta_type, "post" | "term" | "user" | "comment") {
        return Ok(empty());
    }
    let p = host.prefix().to_string();
    let id_column = if meta_type == "user" {
        "umeta_id"
    } else {
        "meta_id"
    };
    Ok(table(host.query(branch, &format!("SELECT {meta_type}_id, meta_key, meta_value FROM {p}{meta_type}meta WHERE {meta_type}_id IN ({}) ORDER BY {id_column} ASC", id_list(ids)))?))
}

/// The objects' terms of `taxonomies` with their object ids, by name, as `wp_get_object_terms` gives them.
fn term_rows<E: Exec>(
    host: &mut Host<E>,
    branch: &str,
    ids: &[i64],
    taxonomies: &[String],
) -> Result<Value, HostError> {
    if ids.is_empty() || taxonomies.is_empty() {
        return Ok(empty());
    }
    let p = host.prefix().to_string();
    let tax = taxonomies
        .iter()
        .map(|t| quote(t))
        .collect::<Vec<_>>()
        .join(",");
    Ok(table(host.query(
        branch,
        &format!(
            "SELECT t.*, tt.*, tr.object_id FROM {p}terms AS t INNER JOIN {p}term_taxonomy AS tt ON t.term_id = tt.term_id INNER JOIN {p}term_relationships AS tr ON tr.term_taxonomy_id = tt.term_taxonomy_id WHERE tt.taxonomy IN ({tax}) AND tr.object_id IN ({}) ORDER BY t.name ASC",
            id_list(ids)
        ),
    )?))
}

/// Posts (unless `posts` is false), meta and terms for `ids`: one message for the caller.
fn prime<E: Exec>(
    host: &mut Host<E>,
    branch: &str,
    ids: &[i64],
    posts: bool,
    meta: bool,
    taxonomies: &[String],
) -> Result<Value, HostError> {
    let p = host.prefix().to_string();
    let rows = if posts && !ids.is_empty() {
        table(host.query(
            branch,
            &format!(
                "SELECT {p}posts.* FROM {p}posts WHERE ID IN ({})",
                id_list(ids)
            ),
        )?)
    } else {
        empty()
    };
    let meta = if meta {
        meta_rows(host, branch, "post", ids)?
    } else {
        empty()
    };
    Ok(json!({ "posts": rows, "meta": meta, "terms": term_rows(host, branch, ids, taxonomies)? }))
}

/// Handles an object-API message; `None` when `op` is not one.
pub fn handle<E: Exec>(host: &mut Host<E>, branch: &str, msg: &Value) -> Option<Value> {
    let op = msg.get("op").and_then(Value::as_str)?;
    let taxonomies: Vec<String> = msg
        .get("taxonomies")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(String::from)
        .collect();
    let meta = msg.get("meta").and_then(Value::as_bool).unwrap_or(true);
    let result: Result<Value, HostError> = match op {
        "options.all" => {
            let p = host.prefix().to_string();
            host.query(
                branch,
                &format!("SELECT option_name, option_value, autoload FROM {p}options"),
            )
            .map(table)
        }
        "posts.prime" => prime(
            host,
            branch,
            &ids_of(msg, "ids"),
            msg.get("posts").and_then(Value::as_bool).unwrap_or(true),
            meta,
            &taxonomies,
        ),
        "meta.load" => meta_rows(
            host,
            branch,
            msg.get("type").and_then(Value::as_str).unwrap_or(""),
            &ids_of(msg, "ids"),
        ),
        "terms.of" => term_rows(host, branch, &ids_of(msg, "ids"), &taxonomies),
        "posts.query" => (|| {
            let sql = msg.get("sql").and_then(Value::as_str).unwrap_or("");
            let found = host.query(branch, sql)?;
            let found_rows = host
                .query(branch, "SELECT FOUND_ROWS()")?
                .rows
                .first()
                .and_then(|r| r.first())
                .and_then(|v| {
                    v.as_str()
                        .and_then(|s| s.parse::<i64>().ok())
                        .or_else(|| v.as_i64())
                })
                .unwrap_or(found.rows.len() as i64);
            let ids: Vec<i64> = found
                .rows
                .iter()
                .filter_map(|r| r.first())
                .filter_map(|v| {
                    v.as_str()
                        .and_then(|s| s.parse().ok())
                        .or_else(|| v.as_i64())
                })
                .collect();
            let mut out = prime(host, branch, &ids, true, meta, &taxonomies)?;
            out["ids"] = json!(ids);
            out["found_rows"] = json!(found_rows);
            Ok(out)
        })(),
        "post.save" => (|| {
            let p = host.prefix().to_string();
            let data = msg
                .get("data")
                .and_then(Value::as_object)
                .cloned()
                .unwrap_or_default();
            let id = msg.get("id").and_then(Value::as_i64).filter(|i| *i > 0);
            let sql = match id {
                Some(id) => format!(
                    "UPDATE `{p}posts` SET {} WHERE `ID` = {id}",
                    data.iter()
                        .map(|(k, v)| format!("`{k}` = {}", literal(v)))
                        .collect::<Vec<_>>()
                        .join(", ")
                ),
                None => format!(
                    "INSERT INTO `{p}posts` ({}) VALUES ({})",
                    data.keys()
                        .map(|k| format!("`{k}`"))
                        .collect::<Vec<_>>()
                        .join(", "),
                    data.values().map(literal).collect::<Vec<_>>().join(", ")
                ),
            };
            let out = host.query(branch, &sql)?;
            Ok(json!({ "id": id.unwrap_or(out.insert_id), "rows_affected": out.rows_affected }))
        })(),
        _ => return None,
    };
    Some(result.unwrap_or_else(|e| json!({ "error": e.to_string() })))
}
