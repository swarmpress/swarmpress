//! The orchestrator in the browser (ADR-0038, docs/mvp.md): a wasm-bindgen
//! facade whose [`Store`], [`Gateway`] and [`Llm`] are JS objects.
//!
//! It is a separate module from `client-wasm` so that the sim bundle stays
//! inside its own size budget; the game loads it lazily when the first job
//! arrives. The same `pkg/` runs under Bun (the headless runner, ADR-0042).
//!
//! ```ts
//! import init, { OrchestratorHandle } from 'orchestrator-wasm'
//! await init()
//! const orch = new OrchestratorHandle(store, gateway, llm, JSON.stringify(site))
//! orch.setProgress((eventJson) => hud.progress(JSON.parse(eventJson)))   // optional
//! const outcomes = JSON.parse(await orch.run(JSON.stringify(jobRequest)))
//! orch.cancel('timeout')   // P6: the running job stops at its next stage boundary
//! ```
//!
//! Repo writes carry the job's attribution (ADR-0056 decision 8, ADR-0058
//! decision 10) as the gateway's last argument, JSON text.
//!
//! Conventions at the boundary:
//! - Records (briefs, artifacts, posts, the plan) cross as **JSON text**; a JS
//!   method may return JSON text or a plain object, and `null`/`undefined`
//!   for "absent". Stores keep artifact text verbatim: it holds `brief_ref`,
//!   a u64 that a JS number cannot represent exactly.
//! - `brief_ref` crosses as a **decimal string** in method arguments, in
//!   [`OrchestratorHandle::run`]'s outcomes, and may be a string in the job
//!   request (a number is accepted too).
//! - A JS method may return a value or a Promise; a rejection becomes a
//!   store/gateway error (the job can be retried) or `LlmError::Backend`.
//!
//! See `docs/architecture/browser-runtime.md` and the TypeScript interfaces
//! below (`OrchestratorStore`, `OrchestratorGateway`, `OrchestratorLlm`).

#![cfg(target_arch = "wasm32")]

use std::cell::RefCell;
use std::rc::Rc;
use std::sync::Arc;

use agents::llm::DeltaSink;
use agents::{Llm, LlmError, LlmRequest};
use async_trait::async_trait;
use js_sys::{Array, Function, Promise, Reflect, JSON};
use orchestrator::{
    Attribution, DeployState, DraftPr, Gateway, GatewayError, JobFailure, JobRequest, Orchestrator,
    Outcome, Progress, ProgressEvent, Redeploy, SiteBinding, StageRow, Store, StoreError,
};
use serde_json::{json, Value};
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;
use wasm_bindgen_futures::{future_to_promise, JsFuture};

#[wasm_bindgen(typescript_custom_section)]
const TS_INTERFACES: &str = r#"
/** The orchestrator's text store (mirrors `orchestrator::Store`). Records are JSON text. */
export interface OrchestratorStore {
  putBrief(company: string, briefRef: string, recordJson: string): Promise<void> | void
  getBrief(company: string, briefRef: string): Promise<string | object | null> | string | object | null
  claimBrief(company: string, briefRef: string, workItem: string): Promise<boolean> | boolean
  putArtifact(company: string, workItem: string, recordJson: string): Promise<void> | void
  getArtifact(company: string, workItem: string): Promise<string | null> | string | null
  /**
   * Every work item's artifact record, `[{work_item, record}]` with `record` the JSON text
   * `putArtifact` stored (a u64 `brief_ref` survives only as text); the list itself may be
   * JSON text or an array. The Draft job leaves out the heroes of the other open articles.
   */
  listArtifacts(company: string): Promise<string | { work_item: string; record: string }[]> | string | { work_item: string; record: string }[]
  appendTranscript(company: string, jobId: number, seq: number, speaker: string, text: string): Promise<void> | void
  setItemText(company: string, item: string, title: string | null, brief: string | null): Promise<void> | void
  /** Returns the new post id. */
  appendPost(company: string, item: string, postJson: string): Promise<string> | string
  planJson(company: string): Promise<string | object> | string | object
  /** A stage result `{input_hash, value}` of a job (ADR-0058), or null. */
  getStage(company: string, jobId: number, stage: string, index: number):
    Promise<string | object | null> | string | object | null
  /** Stores `rowJson` (`{input_hash, value}`) unless the key has a row (first write wins); returns the stored row. */
  putStage(company: string, jobId: number, stage: string, index: number, rowJson: string):
    Promise<string | object> | string | object
}

/**
 * A stage of a job, as counts (`orchestrator::ProgressEvent`, JSON text):
 * `{job_id, kind, revision, work_item, staff, persona, role, stage, index, total, state, detail}`
 * with `state` one of `started`, `done`, `reused`, `failed` and `stage` one of `job`,
 * `context`, `outline`, `section` (index 0 is the intro), `closing`, `fix`, `retitle`,
 * `revise`, `review`, `review_section`, `review_summary`, `commit`, and a standup's `opening`,
 * `pitch`, `commission`. `stage: 'turn'` is a meeting turn just written to the transcript
 * (`TurnFinished`, ADR-0062): `detail` is `{seq, speaker, chars, meeting}`.
 */
export type OrchestratorProgress = (eventJson: string) => void

/**
 * Repo operations (the browser's is the central gateway client). `attributionJson` is the
 * `attribution` of the gateway request as JSON text (ADR-0056 decision 8, as narrowed by
 * ADR-0058): on a draft the writer, the job and the model; on a merge the writer, the
 * publish job, `reviewed_by` and `approved_by`. The staged jobs always pass it.
 */
export interface OrchestratorGateway {
  openDraft(contentId: string, path: string, pageJson: string, message: string, workItem: string | null,
    attributionJson?: string | null):
    Promise<{ number: number; branch: string; head_sha: string } | string>
  /** Returns the merge commit sha (or `{merged_sha}`). */
  merge(number: number, headSha: string, attributionJson?: string | null): Promise<string | { merged_sha: string }>
  /**
   * Optional (FEAT-085): the deploy state of a merged PR (`GET /api/gateway/deploy-status`):
   * `open`, `closed`, `pending`, `landed`, `failed` or `unknown`, as a string or `{state}`;
   * `null` when not observed. Without it deploys are not observed and a publish job never
   * redeploys.
   */
  deployState?(number: number): Promise<string | { state: string } | null> | string | { state: string } | null
  /**
   * Optional (FEAT-085): deploy a merge whose deployment failed again
   * (`POST /api/gateway/redeploy`) → `{state, requested, run_id, attempt, detail}`. Rejects when
   * refused (landed, nothing to re-run, GitHub refused). A publish job for a merged item whose
   * deploy state is `failed` calls it; without it that job fails loudly.
   */
  redeploy?(number: number): Promise<{ state: string; requested?: boolean; run_id?: number | null; attempt?: number; detail?: string | null }>
}

/**
 * The LLM (`agents::Llm`). `requestJson` is
 * `{kind: 'generate' | 'structured', request: LlmRequest, schema?: object}` with
 * `LlmRequest = {profile, system: string[], messages: {role: 'user'|'assistant', text}[], max_tokens}`.
 * Answer `{text}` (generate), `{value}` or `{text}` (structured), or
 * `{error: LlmError}` (`{Refusal: {category, explanation}}`, `{Truncated: {partial}}`,
 * `{InvalidOutput: {errors}}`, `{Unavailable: msg}`, `{Timeout: msg}`, `{Backend: msg}`), as
 * JSON text or an object. `Timeout`: the call ran past its limit or was aborted (the staged
 * jobs make it once more); `Unavailable`: the model is gone (the job's run rejects, so the
 * host runs it again once the model is back).
 *
 * A free-text answer that hit the token limit may come back as
 * `{text, truncated: true}`: `text` is then the output cut at its last
 * complete sentence and is accepted as the turn (a long meeting turn must not
 * fail the meeting). `{error: {Truncated}}` is for output with nothing usable.
 *
 * `modelId` (optional) names the model, for the commits' `Model` trailer; `abort()`
 * (optional) aborts the call in flight, which `OrchestratorHandle.cancel` uses.
 */
export interface OrchestratorLlm {
  complete(requestJson: string): Promise<string | object>
  readonly modelId?: string | null
  abort?(): void
}
"#;

// ---------------------------------------------------------------- JS calls

fn js_error_text(e: &JsValue) -> String {
    if let Some(err) = e.dyn_ref::<js_sys::Error>() {
        return String::from(err.message());
    }
    if let Some(s) = e.as_string() {
        return s;
    }
    JSON::stringify(e)
        .ok()
        .and_then(|s| s.as_string())
        .unwrap_or_else(|| format!("{e:?}"))
}

/// `obj[method](...args)`, awaited if it returns a Promise.
async fn call(obj: &JsValue, method: &str, args: &[JsValue]) -> Result<JsValue, String> {
    let f = Reflect::get(obj, &JsValue::from_str(method)).map_err(|e| js_error_text(&e))?;
    let f: Function = f
        .dyn_into()
        .map_err(|_| format!("{method} is not a function"))?;
    let argv: Array = args.iter().collect();
    let ret = f.apply(obj, &argv).map_err(|e| js_error_text(&e))?;
    JsFuture::from(Promise::resolve(&ret))
        .await
        .map_err(|e| format!("{method}: {}", js_error_text(&e)))
}

/// A JS answer as JSON: `null`/`undefined` → `None`, a string is JSON text,
/// anything else goes through `JSON.stringify`.
fn json_of(v: &JsValue) -> Result<Option<Value>, String> {
    if v.is_null() || v.is_undefined() {
        return Ok(None);
    }
    let text = match v.as_string() {
        Some(s) => s,
        None => JSON::stringify(v)
            .map_err(|e| js_error_text(&e))?
            .as_string()
            .ok_or("value is not JSON-serialisable")?,
    };
    serde_json::from_str(&text)
        .map(Some)
        .map_err(|e| format!("invalid JSON from JS: {e}"))
}

fn s(v: &str) -> JsValue {
    JsValue::from_str(v)
}

fn opt_s(v: Option<&str>) -> JsValue {
    v.map_or(JsValue::NULL, JsValue::from_str)
}

// ---------------------------------------------------------------- Store

/// [`Store`] over a JS `OrchestratorStore`.
struct JsStore(JsValue);

impl JsStore {
    async fn call(&self, method: &str, args: &[JsValue]) -> Result<JsValue, StoreError> {
        call(&self.0, method, args).await.map_err(StoreError)
    }

    async fn call_json(&self, method: &str, args: &[JsValue]) -> Result<Option<Value>, StoreError> {
        json_of(&self.call(method, args).await?).map_err(|e| StoreError(format!("{method}: {e}")))
    }
}

#[async_trait(?Send)]
impl Store for JsStore {
    async fn put_brief(&self, c: &str, r: u64, record: Value) -> Result<(), StoreError> {
        self.call(
            "putBrief",
            &[s(c), s(&r.to_string()), s(&record.to_string())],
        )
        .await
        .map(drop)
    }

    async fn get_brief(&self, c: &str, r: u64) -> Result<Option<Value>, StoreError> {
        self.call_json("getBrief", &[s(c), s(&r.to_string())]).await
    }

    async fn claim_brief(&self, c: &str, r: u64, w: &str) -> Result<bool, StoreError> {
        let v = self
            .call("claimBrief", &[s(c), s(&r.to_string()), s(w)])
            .await?;
        v.as_bool()
            .ok_or_else(|| StoreError("claimBrief must return a boolean".into()))
    }

    async fn put_artifact(&self, c: &str, w: &str, record: Value) -> Result<(), StoreError> {
        self.call("putArtifact", &[s(c), s(w), s(&record.to_string())])
            .await
            .map(drop)
    }

    async fn get_artifact(&self, c: &str, w: &str) -> Result<Option<Value>, StoreError> {
        self.call_json("getArtifact", &[s(c), s(w)]).await
    }

    async fn artifacts(&self, c: &str) -> Result<Vec<(String, Value)>, StoreError> {
        let bad = |what: &str| StoreError(format!("listArtifacts: {what}"));
        let Some(Value::Array(rows)) = self.call_json("listArtifacts", &[s(c)]).await? else {
            return Err(bad("must return an array"));
        };
        rows.into_iter()
            .map(|row| {
                let item = row["work_item"]
                    .as_str()
                    .ok_or_else(|| bad("a row has no work_item"))?
                    .to_string();
                // The record is the text putArtifact stored; an object is accepted too.
                let record = match &row["record"] {
                    Value::String(t) => serde_json::from_str(t).map_err(|e| bad(&e.to_string()))?,
                    Value::Object(_) => row["record"].clone(),
                    _ => return Err(bad("a row has no record")),
                };
                Ok((item, record))
            })
            .collect()
    }

    async fn append_transcript(
        &self,
        c: &str,
        job_id: u64,
        seq: u32,
        speaker: &str,
        text: &str,
    ) -> Result<(), StoreError> {
        // Job ids are sim counters, far below 2^53.
        #[allow(clippy::cast_precision_loss)]
        let job = JsValue::from_f64(job_id as f64);
        self.call(
            "appendTranscript",
            &[s(c), job, JsValue::from(seq), s(speaker), s(text)],
        )
        .await
        .map(drop)
    }

    async fn set_item_text(
        &self,
        c: &str,
        item: &str,
        title: Option<&str>,
        brief: Option<&str>,
    ) -> Result<(), StoreError> {
        self.call("setItemText", &[s(c), s(item), opt_s(title), opt_s(brief)])
            .await
            .map(drop)
    }

    async fn append_post(&self, c: &str, item: &str, post: Value) -> Result<String, StoreError> {
        let v = self
            .call("appendPost", &[s(c), s(item), s(&post.to_string())])
            .await?;
        v.as_string()
            .ok_or_else(|| StoreError("appendPost must return the post id".into()))
    }

    async fn plan_json(&self, c: &str) -> Result<Value, StoreError> {
        self.call_json("planJson", &[s(c)])
            .await?
            .ok_or_else(|| StoreError("planJson returned nothing".into()))
    }

    async fn get_stage(
        &self,
        c: &str,
        job_id: u64,
        stage: &str,
        index: u32,
    ) -> Result<Option<StageRow>, StoreError> {
        #[allow(clippy::cast_precision_loss)]
        let job = JsValue::from_f64(job_id as f64);
        self.call_json("getStage", &[s(c), job, s(stage), JsValue::from(index)])
            .await?
            .map(|v| serde_json::from_value(v).map_err(|e| StoreError(format!("getStage: {e}"))))
            .transpose()
    }

    async fn put_stage(
        &self,
        c: &str,
        job_id: u64,
        stage: &str,
        index: u32,
        row: StageRow,
    ) -> Result<StageRow, StoreError> {
        #[allow(clippy::cast_precision_loss)]
        let job = JsValue::from_f64(job_id as f64);
        let text = serde_json::to_string(&row).map_err(|e| StoreError(e.to_string()))?;
        let stored = self
            .call_json(
                "putStage",
                &[s(c), job, s(stage), JsValue::from(index), s(&text)],
            )
            .await?;
        match stored {
            Some(v) => serde_json::from_value(v).map_err(|e| StoreError(format!("putStage: {e}"))),
            None => Ok(row),
        }
    }
}

// ---------------------------------------------------------------- Progress

/// [`Progress`] over the JS function set with `setProgress` (none: silent).
/// A throwing listener is ignored: progress never fails a job.
struct JsProgress(Rc<RefCell<Option<Function>>>);

impl Progress for JsProgress {
    fn report(&self, event: &ProgressEvent) {
        let Some(f) = self.0.borrow().clone() else {
            return;
        };
        if let Ok(text) = serde_json::to_string(event) {
            let _ = f.call1(&JsValue::NULL, &JsValue::from_str(&text));
        }
    }
}

// ---------------------------------------------------------------- Gateway

/// [`Gateway`] over a JS `OrchestratorGateway`. The trait carries no work
/// item, but the central gateway echoes it in `DeployLanded`; the handle sets
/// it from the job being run.
struct JsGateway {
    obj: JsValue,
    work_item: Rc<RefCell<Option<String>>>,
}

fn gw(e: String) -> GatewayError {
    GatewayError(e)
}

/// An attribution as the JS gateway's last argument: its JSON text. Checked
/// here first, so a malformed one never leaves the module.
fn attribution_arg(a: Option<&Attribution>) -> Result<Option<JsValue>, GatewayError> {
    let Some(a) = a else {
        return Ok(None);
    };
    a.check().map_err(gw)?;
    let text = serde_json::to_string(a).map_err(|e| gw(e.to_string()))?;
    Ok(Some(s(&text)))
}

#[async_trait(?Send)]
impl Gateway for JsGateway {
    async fn open_draft(
        &self,
        content_id: &str,
        path: &str,
        page: &Value,
        message: &str,
    ) -> Result<DraftPr, GatewayError> {
        self.open_draft_as(content_id, path, page, message, None)
            .await
    }

    async fn merge(&self, pr_number: u64, head_sha: &str) -> Result<String, GatewayError> {
        self.merge_as(pr_number, head_sha, None).await
    }

    async fn open_draft_as(
        &self,
        content_id: &str,
        path: &str,
        page: &Value,
        message: &str,
        attribution: Option<&Attribution>,
    ) -> Result<DraftPr, GatewayError> {
        let work_item = self.work_item.borrow().clone();
        let mut args = vec![
            s(content_id),
            s(path),
            s(&page.to_string()),
            s(message),
            opt_s(work_item.as_deref()),
        ];
        args.extend(attribution_arg(attribution)?);
        let v = call(&self.obj, "openDraft", &args).await.map_err(gw)?;
        let v = json_of(&v)
            .map_err(gw)?
            .ok_or_else(|| gw("openDraft returned nothing".into()))?;
        serde_json::from_value(v).map_err(|e| gw(format!("openDraft answer: {e}")))
    }

    async fn merge_as(
        &self,
        pr_number: u64,
        head_sha: &str,
        attribution: Option<&Attribution>,
    ) -> Result<String, GatewayError> {
        #[allow(clippy::cast_precision_loss)]
        let n = JsValue::from_f64(pr_number as f64);
        let mut args = vec![n, s(head_sha)];
        args.extend(attribution_arg(attribution)?);
        let v = call(&self.obj, "merge", &args).await.map_err(gw)?;
        if let Some(sha) = v.as_string() {
            return Ok(sha);
        }
        json_of(&v)
            .map_err(gw)?
            .and_then(|v| {
                v.get("merged_sha")
                    .and_then(Value::as_str)
                    .map(String::from)
            })
            .ok_or_else(|| gw("merge must return the merged sha".into()))
    }

    /// `deployState(number)`, optional: without it deploys are not observed.
    async fn deploy_state(&self, pr_number: u64) -> Result<Option<DeployState>, GatewayError> {
        if !has_method(&self.obj, "deployState") {
            return Ok(None);
        }
        #[allow(clippy::cast_precision_loss)]
        let n = JsValue::from_f64(pr_number as f64);
        let v = call(&self.obj, "deployState", &[n]).await.map_err(gw)?;
        // A state name, or `{state}` (an object or its JSON text).
        let state = match v.as_string().filter(|s| !s.trim_start().starts_with('{')) {
            Some(s) => Some(Value::String(s)),
            None => json_of(&v).map_err(gw)?.map(|v| match v.get("state") {
                Some(s) => s.clone(),
                None => v,
            }),
        };
        state
            .filter(|s| !s.is_null())
            .map(|s| serde_json::from_value(s).map_err(|e| gw(format!("deployState answer: {e}"))))
            .transpose()
    }

    /// `redeploy(number)`, optional: without it a redeploy fails loudly.
    async fn redeploy(&self, pr_number: u64) -> Result<Redeploy, GatewayError> {
        if !has_method(&self.obj, "redeploy") {
            return Err(gw(format!(
                "the gateway has no redeploy: PR #{pr_number} cannot be deployed again"
            )));
        }
        #[allow(clippy::cast_precision_loss)]
        let n = JsValue::from_f64(pr_number as f64);
        let v = call(&self.obj, "redeploy", &[n]).await.map_err(gw)?;
        let v = json_of(&v)
            .map_err(gw)?
            .ok_or_else(|| gw("redeploy returned nothing".into()))?;
        serde_json::from_value(v).map_err(|e| gw(format!("redeploy answer: {e}")))
    }
}

/// Whether the JS object has a callable `name`.
fn has_method(obj: &JsValue, name: &str) -> bool {
    Reflect::get(obj, &JsValue::from_str(name)).is_ok_and(|f| f.is_function())
}

// ---------------------------------------------------------------- Llm

/// [`Llm`] over a JS `OrchestratorLlm`.
struct JsLlm(JsValue);

impl JsLlm {
    async fn complete(&self, body: Value) -> Result<Value, LlmError> {
        let v = call(&self.0, "complete", &[s(&body.to_string())])
            .await
            .map_err(LlmError::Backend)?;
        let v = json_of(&v)
            .map_err(LlmError::Backend)?
            .ok_or_else(|| LlmError::Backend("complete returned nothing".into()))?;
        if let Some(err) = v.get("error") {
            return Err(serde_json::from_value(err.clone())
                .unwrap_or_else(|_| LlmError::Backend(err.to_string())));
        }
        Ok(v)
    }
}

#[async_trait(?Send)]
impl Llm for JsLlm {
    async fn generate(
        &self,
        req: &LlmRequest,
        on_delta: Option<DeltaSink<'_>>,
    ) -> Result<String, LlmError> {
        let v = self
            .complete(json!({"kind": "generate", "request": req}))
            .await?;
        let text = match v.get("text") {
            Some(Value::String(t)) => t.clone(),
            _ => return Err(LlmError::Backend("generate answer has no text".into())),
        };
        if let Some(sink) = on_delta {
            sink(&text);
        }
        Ok(text)
    }

    async fn structured(&self, req: &LlmRequest, schema: &Value) -> Result<Value, LlmError> {
        let v = self
            .complete(json!({"kind": "structured", "request": req, "schema": schema}))
            .await?;
        let value = match (v.get("value"), v.get("text")) {
            (Some(value), _) => value.clone(),
            (None, Some(Value::String(t))) => {
                let answer = agents::strip_reasoning(t);
                claude::extract_json(&answer).map_err(|e| LlmError::InvalidOutput {
                    errors: vec![e],
                    answer: Some(answer.clone()),
                })?
            }
            _ => return Err(LlmError::Backend("structured answer has no value".into())),
        };
        // The JS side may validate a subset of JSON Schema; the full check is here.
        claude::SchemaValidator::new(schema)
            .map_err(|e| LlmError::Backend(format!("bad schema: {e}")))?
            .validate(&value)
            .map_err(|errors| LlmError::InvalidOutput {
                errors,
                answer: Some(value.to_string()),
            })?;
        Ok(value)
    }

    /// `{kind: "research", request, schema}`: the page answers with web search
    /// (the hosted backend) as `{value, sources, searches}`; a backend that
    /// cannot search answers `{error: {Unavailable: …}}`.
    async fn research(
        &self,
        req: &LlmRequest,
        schema: &Value,
    ) -> Result<agents::Researched, LlmError> {
        let v = self
            .complete(json!({"kind": "research", "request": req, "schema": schema}))
            .await?;
        let value = v
            .get("value")
            .cloned()
            .ok_or_else(|| LlmError::Backend("research answer has no value".into()))?;
        claude::SchemaValidator::new(schema)
            .map_err(|e| LlmError::Backend(format!("bad schema: {e}")))?
            .validate(&value)
            .map_err(|errors| LlmError::InvalidOutput {
                errors,
                answer: Some(value.to_string()),
            })?;
        let sources = v
            .get("sources")
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .filter_map(Value::as_str)
                    .map(agents::normalize_source_url)
                    .collect()
            })
            .unwrap_or_default();
        let searches = v.get("searches").and_then(Value::as_u64).unwrap_or(0);
        Ok(agents::Researched {
            value,
            sources,
            searches: u32::try_from(searches).unwrap_or(u32::MAX),
        })
    }

    /// The JS object's `modelId` (a property or a method), if it has one.
    fn model_id(&self) -> Option<String> {
        let v = Reflect::get(&self.0, &JsValue::from_str("modelId")).ok()?;
        let v = match v.dyn_ref::<Function>() {
            Some(f) => f.call0(&self.0).ok()?,
            None => v,
        };
        v.as_string().filter(|m| !m.trim().is_empty())
    }
}

// ---------------------------------------------------------------- site + JSON shims

/// `{site_id, brand_name, language?, knowledge_pack?, style_guide?,
/// writer_prompt?, quality_bar?, simulate_deploy?, standup_max_turns?,
/// llm_profile?, review_single_tokens?, seo_suffix?, executor?}`
/// (`orchestrator::SiteBinding::from_json`): with `knowledge_pack` (the pack
/// JSON text of `GET /api/gateway/knowledge`) the style guide and the writer
/// prompt are the site's own files and the binding carries the loaded
/// closed world; `style_guide` / `writer_prompt` are the fallback without a
/// pack, and without either the house style is empty.
fn site_binding(site_json: &str) -> Result<SiteBinding, String> {
    let v: Value = serde_json::from_str(site_json).map_err(|e| format!("site JSON: {e}"))?;
    SiteBinding::from_json(&v)
}

/// Parse a job request; `brief_ref` may be a decimal string.
pub fn parse_job(job_json: &str) -> Result<JobRequest, String> {
    let mut v: Value = serde_json::from_str(job_json).map_err(|e| format!("job JSON: {e}"))?;
    if let Some(Value::String(r)) = v.get("brief_ref") {
        let n: u64 = r
            .parse()
            .map_err(|_| format!("brief_ref {r:?} is not a u64"))?;
        v["brief_ref"] = json!(n);
    }
    serde_json::from_value(v).map_err(|e| format!("job request: {e}"))
}

/// Splits the sim's `drain_effects_json()` into job request JSON texts for
/// [`OrchestratorHandle::run`]: `company_id` added, `brief_ref` as a decimal
/// string (exact in JS). Done here because a JS `JSON.parse` of the effects
/// would round a u64 `brief_ref`.
#[wasm_bindgen(js_name = jobsFromEffects)]
pub fn jobs_from_effects(effects_json: &str, company_id: &str) -> Result<Vec<String>, JsError> {
    let v: Value = serde_json::from_str(effects_json)
        .map_err(|e| JsError::new(&format!("effects JSON: {e}")))?;
    let Value::Array(effects) = v else {
        return Err(JsError::new("effects JSON must be an array"));
    };
    Ok(effects
        .into_iter()
        .filter(|e| {
            e.get("effect")
                .and_then(Value::as_str)
                .unwrap_or("request-job")
                == "request-job"
        })
        .map(|mut e| {
            e["company_id"] = json!(company_id);
            if let Some(n) = e.get("brief_ref").and_then(Value::as_u64) {
                e["brief_ref"] = json!(n.to_string());
            }
            e.to_string()
        })
        .collect())
}

/// Turns [`OrchestratorHandle::run`]'s outcomes into one JSON text per
/// outcome with numeric `brief_ref`s, as the sim's `apply_command_json`
/// takes them.
#[wasm_bindgen(js_name = outcomesForSim)]
pub fn outcomes_for_sim(outcomes_json: &str) -> Result<Vec<String>, JsError> {
    fn walk(v: &mut Value) {
        match v {
            Value::Object(m) => {
                for (k, x) in m.iter_mut() {
                    let numeric = match (k.as_str(), &*x) {
                        ("brief_ref", Value::String(s)) => s.parse::<u64>().ok(),
                        _ => None,
                    };
                    match numeric {
                        Some(n) => *x = json!(n),
                        None => walk(x),
                    }
                }
            }
            Value::Array(a) => a.iter_mut().for_each(walk),
            _ => {}
        }
    }
    let mut v: Value = serde_json::from_str(outcomes_json)
        .map_err(|e| JsError::new(&format!("outcomes JSON: {e}")))?;
    walk(&mut v);
    match v {
        Value::Array(a) => Ok(a.iter().map(Value::to_string).collect()),
        _ => Err(JsError::new("outcomes JSON must be an array")),
    }
}

/// Outcomes as JSON with every `brief_ref` as a decimal string.
pub fn outcomes_json(out: &[Outcome]) -> String {
    fn walk(v: &mut Value) {
        match v {
            Value::Object(m) => {
                for (k, x) in m.iter_mut() {
                    if k == "brief_ref" {
                        if let Some(n) = x.as_u64() {
                            *x = Value::String(n.to_string());
                        }
                    } else {
                        walk(x);
                    }
                }
            }
            Value::Array(a) => a.iter_mut().for_each(walk),
            _ => {}
        }
    }
    let mut v = serde_json::to_value(out).unwrap_or(Value::Null);
    walk(&mut v);
    v.to_string()
}

// ---------------------------------------------------------------- handle

/// Validates `value_json` against the JSON Schema `schema_json` with the same
/// validator [`Llm::structured`] applies to every structured answer (full
/// JSON Schema, including `anyOf`). Returns the problems, empty when valid.
///
/// The browser's structured-output loop uses it for its repair turns, so a
/// value never passes there and then fails here without a repair
/// (`apps/game/src/llm/structured.ts` only has a subset validator of its own).
#[wasm_bindgen(js_name = validateJson)]
pub fn validate_json(schema_json: &str, value_json: &str) -> Result<Vec<String>, JsError> {
    let schema: Value = serde_json::from_str(schema_json)
        .map_err(|e| JsError::new(&format!("schema JSON: {e}")))?;
    let value: Value =
        serde_json::from_str(value_json).map_err(|e| JsError::new(&format!("value JSON: {e}")))?;
    let validator = claude::SchemaValidator::new(&schema)
        .map_err(|e| JsError::new(&format!("bad schema: {e}")))?;
    Ok(validator.validate(&value).err().unwrap_or_default())
}

/// [`OrchestratorHandle::eval_op`] over JSON values.
fn eval_op(site: &SiteBinding, op: &str, args_json: &str) -> Result<String, String> {
    use orchestrator::eval;
    let args: Value = serde_json::from_str(args_json).map_err(|e| format!("{op} args: {e}"))?;
    let field = |k: &str| args.get(k).cloned().unwrap_or(Value::Null);
    let text = |k: &str| field(k).as_str().unwrap_or_default().to_string();
    let out = match op {
        "gateway_checks" => json!(eval::gateway_checks(
            site,
            &text("content_id"),
            &text("path"),
            &field("page")
        )),
        "checks" => {
            let brief =
                serde_json::from_value(field("brief")).map_err(|e| format!("brief: {e}"))?;
            let record =
                serde_json::from_value(field("record")).map_err(|e| format!("record: {e}"))?;
            json!(eval::eval_checks(site, &brief, &record))
        }
        "reference" => json!(eval::reference_article(
            site,
            &text("path"),
            &field("page")
        )?),
        "seeded_bad" => {
            let good =
                serde_json::from_value(field("article")).map_err(|e| format!("article: {e}"))?;
            json!(eval::seeded_bad(site, &good, &text("kind"))?)
        }
        other => return Err(format!("unknown eval op {other:?}")),
    };
    Ok(out.to_string())
}

/// The module version (the crate version).
#[wasm_bindgen]
pub fn version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// One orchestrator over JS store, gateway and LLM objects.
#[wasm_bindgen]
pub struct OrchestratorHandle {
    orch: Rc<Orchestrator<JsStore, JsGateway>>,
    work_item: Rc<RefCell<Option<String>>>,
    progress: Rc<RefCell<Option<Function>>>,
    /// The job `run` is running, for `cancel`.
    running: Rc<RefCell<Option<u64>>>,
    /// The JS LLM object, whose `abort()` `cancel` calls.
    llm: JsValue,
}

#[wasm_bindgen]
impl OrchestratorHandle {
    /// `store: OrchestratorStore`, `gateway: OrchestratorGateway`,
    /// `llm: OrchestratorLlm`, `site_json`: the site binding (see module docs).
    #[wasm_bindgen(constructor)]
    pub fn new(
        store: JsValue,
        gateway: JsValue,
        llm: JsValue,
        site_json: &str,
    ) -> Result<OrchestratorHandle, JsError> {
        let site = site_binding(site_json).map_err(|e| JsError::new(&e))?;
        let work_item = Rc::new(RefCell::new(None));
        let gateway = JsGateway {
            obj: gateway,
            work_item: work_item.clone(),
        };
        #[allow(clippy::arc_with_non_send_sync)] // wasm32: one thread
        let model: Arc<dyn Llm> = Arc::new(JsLlm(llm.clone()));
        let progress = Rc::new(RefCell::new(None));
        #[allow(clippy::arc_with_non_send_sync)] // wasm32: one thread
        let sink: Arc<dyn Progress> = Arc::new(JsProgress(progress.clone()));
        Ok(OrchestratorHandle {
            orch: Rc::new(
                Orchestrator::new(JsStore(store), gateway, model, site).with_progress(sink),
            ),
            work_item,
            progress,
            running: Rc::new(RefCell::new(None)),
            llm,
        })
    }

    /// Stops the job `run` is running (P6): the job ends at its next stage
    /// boundary with `JobFailed{reason}` (`'timeout'`, else `Cancelled`), and
    /// the LLM's call in flight is aborted (its `abort()`, if it has one).
    /// Completed stages stay stored. Returns the job id, or `undefined` when
    /// no job is running.
    pub fn cancel(&self, reason: Option<String>) -> Option<f64> {
        let job = (*self.running.borrow())?;
        let reason = match reason.as_deref() {
            Some(r) if r.eq_ignore_ascii_case("timeout") => JobFailure::Timeout,
            _ => JobFailure::Cancelled,
        };
        self.orch.cancel(job, reason);
        if let Ok(f) = Reflect::get(&self.llm, &JsValue::from_str("abort")) {
            if let Some(f) = f.dyn_ref::<Function>() {
                // An abort that throws is ignored: the flag stops the job anyway.
                let _ = f.call0(&self.llm);
            }
        }
        // Job ids are sim counters, far below 2^53.
        #[allow(clippy::cast_precision_loss)]
        Some(job as f64)
    }

    /// Hears every stage of every job (`OrchestratorProgress`: one
    /// `ProgressEvent` as JSON text per call); `null` stops it.
    #[wasm_bindgen(js_name = setProgress)]
    pub fn set_progress(&self, listener: JsValue) -> Result<(), JsError> {
        let f = if listener.is_null() || listener.is_undefined() {
            None
        } else {
            Some(
                listener
                    .dyn_into::<Function>()
                    .map_err(|_| JsError::new("setProgress takes a function or null"))?,
            )
        };
        *self.progress.borrow_mut() = f;
        Ok(())
    }

    /// What the site binding was built from, as JSON text:
    /// `{site_id, commit, pages, media, entities, blog_index, style_guide,
    /// writer_prompt}` (`commit` and the counts are `null` without a
    /// knowledge pack; the sources are `pack`, `binding` or `absent`).
    #[wasm_bindgen(js_name = siteSummary)]
    pub fn site_summary(&self) -> String {
        self.orch.site().summary().to_string()
    }

    /// The eval harness (FEAT-036, `orchestrator::eval`). `op` is one of:
    /// `gateway_checks` `{content_id, path, page}` → `[issue]`;
    /// `checks` `{brief, record}` → `EvalChecks`;
    /// `reference` `{path, page}` → `EvalArticle`;
    /// `seeded_bad` `{article, kind}` → `EvalArticle`. JSON text in and out.
    #[wasm_bindgen(js_name = evalOp)]
    pub fn eval_op(&self, op: &str, args_json: &str) -> Result<String, JsError> {
        eval_op(self.orch.site(), op, args_json).map_err(|e| JsError::new(&e))
    }

    /// Run one job request (JSON); resolves to the outcomes as JSON text,
    /// e.g. `[{"MeetingOutcome":{"job_id":1,"briefs":[{"brief_ref":"…",…}]}}]`.
    /// Rejects with an `Error` on infrastructure failures (store, gateway,
    /// invalid job), which the caller may retry; agent failures resolve as
    /// `ok: false` digests. Jobs must not overlap on one handle.
    pub fn run(&self, job_json: &str) -> Promise {
        let job = parse_job(job_json);
        let orch = self.orch.clone();
        let work_item = self.work_item.clone();
        let running = self.running.clone();
        future_to_promise(async move {
            let job = job.map_err(|e| JsValue::from(js_sys::Error::new(&e)))?;
            *work_item.borrow_mut() = job.work_item.clone();
            *running.borrow_mut() = Some(job.job_id);
            let res = orch.run(&job).await;
            *work_item.borrow_mut() = None;
            if *running.borrow() == Some(job.job_id) {
                *running.borrow_mut() = None;
            }
            match res {
                Ok(out) => Ok(JsValue::from_str(&outcomes_json(&out))),
                Err(e) => Err(js_sys::Error::new(&e.to_string()).into()),
            }
        })
    }
}
