//! The storage API in the browser (ADR-0084 §3): the governed side of the WordPress sandbox's
//! storage channel, for the game's storage worker.
//!
//! SQLite is the game's sqlite-wasm, reached through a JS object per projection:
//! `query(sql) → '{"columns":[…],"rows":[[…]]}'`, `execute(sql) → [changes, lastInsertRowid]`,
//! `batch(sql)`. The worker answers the storage ops that need the network or `crypto.subtle`
//! itself (`asset.put`, `asset.get`, `http`) and records uploads here with
//! [`StorageHost::put_asset`]; mail goes to [`StorageHost::take_outbox`].
#![cfg(target_arch = "wasm32")]

use content_repo::{Record, Repo};
use js_sys::{Array, Function, Reflect};
use serde_json::{json, Value};
use storage_api::protocol::{self, Platform, Session};
use storage_api::{Exec, Host, Rows};
use wasm_bindgen::prelude::*;

struct JsExec(JsValue);

fn call(obj: &JsValue, method: &str, sql: &str) -> Result<JsValue, String> {
    let f: Function = Reflect::get(obj, &JsValue::from_str(method))
        .map_err(|e| format!("{e:?}"))?
        .dyn_into()
        .map_err(|_| format!("the SQLite object has no {method}()"))?;
    f.call1(obj, &JsValue::from_str(sql)).map_err(|e| {
        e.as_string()
            .or_else(|| {
                Reflect::get(&e, &"message".into())
                    .ok()
                    .and_then(|m| m.as_string())
            })
            .unwrap_or_else(|| format!("{e:?}"))
    })
}

impl Exec for JsExec {
    fn query(&mut self, sql: &str) -> Result<Rows, String> {
        let text = call(&self.0, "query", sql)?
            .as_string()
            .ok_or("query() must return a JSON string")?;
        let v: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
        let columns = v["columns"]
            .as_array()
            .map(|a| {
                a.iter()
                    .filter_map(|c| c.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default();
        let rows = v["rows"]
            .as_array()
            .map(|a| {
                a.iter()
                    .map(|r| r.as_array().cloned().unwrap_or_default())
                    .collect()
            })
            .unwrap_or_default();
        Ok(Rows { columns, rows })
    }

    fn execute(&mut self, sql: &str) -> Result<(u64, i64), String> {
        let r: Array = call(&self.0, "execute", sql)?
            .dyn_into()
            .map_err(|_| "execute() must return [changes, lastInsertRowid]")?;
        Ok((
            r.get(0).as_f64().unwrap_or(0.0) as u64,
            r.get(1).as_f64().unwrap_or(0.0) as i64,
        ))
    }

    fn batch(&mut self, sql: &str) -> Result<(), String> {
        call(&self.0, "batch", sql).map(|_| ())
    }
}

/// Mail into an outbox; the network-bound ops are the worker's.
#[derive(Default)]
struct Outbox(Vec<Value>);

impl Platform for Outbox {
    fn put_bytes(&mut self, _: &[u8]) -> Result<String, String> {
        Err("asset.put is answered by the storage worker".into())
    }
    fn get_bytes(&mut self, _: &str) -> Result<Vec<u8>, String> {
        Err("asset.get is answered by the storage worker".into())
    }
    fn mail(&mut self, mail: Value) -> Result<(), String> {
        self.0.push(mail);
        Ok(())
    }
    fn http(&mut self, _: Value) -> Result<Value, String> {
        Err("http is answered by the storage worker".into())
    }
}

#[wasm_bindgen]
pub struct StorageHost {
    host: Host<JsExec>,
    session: Session,
    outbox: Outbox,
}

#[wasm_bindgen]
impl StorageHost {
    /// A host over the repository restored from `records` (a JSON array of records, `[]` for a
    /// new company). `open()` returns a new, empty SQLite object for a projection.
    #[wasm_bindgen(constructor)]
    pub fn new(prefix: &str, open: Function, records: &str) -> Result<StorageHost, JsError> {
        let mut repo = Repo::new();
        let records: Vec<Record> =
            serde_json::from_str(records).map_err(|e| JsError::new(&format!("records: {e}")))?;
        repo.apply(records)
            .map_err(|e| JsError::new(&e.to_string()))?;
        let _ = repo.take_records();
        let opener = Box::new(move || {
            open.call0(&JsValue::NULL)
                .map(JsExec)
                .map_err(|e| format!("open(): {e:?}"))
        });
        Ok(StorageHost {
            host: Host::new(repo, prefix, opener),
            session: Session::default(),
            outbox: Outbox::default(),
        })
    }

    /// One storage-channel message from the sandbox (JSON in, JSON out).
    pub fn storage(&mut self, msg: &str) -> String {
        let msg: Value = serde_json::from_str(msg).unwrap_or(Value::Null);
        protocol::storage(&mut self.host, &self.session, &mut self.outbox, &msg).to_string()
    }

    /// One governed-API message (JSON in, JSON out).
    pub fn repo(&mut self, msg: &str) -> String {
        let msg: Value = serde_json::from_str(msg).unwrap_or(Value::Null);
        protocol::repo(&mut self.host, &mut self.session, &msg).to_string()
    }

    /// Records an upload whose bytes the worker stored under `sha256`.
    pub fn put_asset(&mut self, path: &str, sha256: &str, mime: &str, size: f64) -> String {
        match self
            .host
            .put_asset(&self.session.branch, path, sha256, mime, size as u64)
        {
            Ok(()) => json!({"sha256": sha256}).to_string(),
            Err(e) => json!({"error": e.to_string()}).to_string(),
        }
    }

    /// The digest of the upload at `path` on the session's branch.
    pub fn asset_sha(&self, path: &str) -> Option<String> {
        self.host.asset(&self.session.branch, path)
    }

    /// The repository records written since the last call (JSON array), for the company store.
    pub fn take_records(&mut self) -> String {
        serde_json::to_string(&self.host.repo.take_records()).unwrap_or_else(|_| "[]".into())
    }

    /// Mail WordPress sent since the last call (JSON array).
    pub fn take_outbox(&mut self) -> String {
        serde_json::to_string(&std::mem::take(&mut self.outbox.0)).unwrap_or_else(|_| "[]".into())
    }
}
