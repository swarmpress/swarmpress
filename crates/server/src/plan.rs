//! The text side of the media & publishing plan (publishing-plan.md §6–7,
//! ADR-0031).
//!
//! The sim owns the plan skeleton (items, status, phases, todo ids). This
//! module owns the text keyed by those ids: item titles and briefs, todo text,
//! workstream and goal titles, and the append-only thread of typed posts.
//!
//! - [`PlanService`] is the only writer. CEO posts come in over REST; agent
//!   plan ops come from job completion via [`PlanService::complete_job_with_ops`]
//!   (or [`PlanService::apply_agent_ops`]), validated structurally here and for
//!   RBAC by a [`PlanOpValidator`].
//! - Every appended post is broadcast as [`ServerFrame::PlanPost`] to the
//!   company's sockets through the [`PlanHub`]. Clients fetch `GET /api/plan`
//!   once and then follow the stream.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use anyhow::{Context, Result};
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::routing::{get, post, put};
use axum::{Json, Router};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use sqlx::{PgPool, Postgres, Transaction};
use tokio::sync::broadcast;
use uuid::Uuid;

use crate::app::AppState;
use crate::auth::CurrentUser;
use crate::db::{self, Company};
use crate::error::{AppError, AppResult};
use crate::wire::ServerFrame;

/// Post types an agent may emit as plan ops (publishing-plan.md §3). Whether a
/// given actor may emit a given type (for example `decision`) is RBAC and is
/// decided by the [`PlanOpValidator`].
pub const AGENT_OP_TYPES: &[&str] = &[
    "comment",
    "handoff",
    "todo-add",
    "todo-done",
    "question",
    "review",
    "proposal",
    "request-help",
    "minutes",
    "decision",
];

/// Post types the CEO may write over REST.
pub const CEO_POST_TYPES: &[&str] = &["comment", "decision"];

/// Post types only the orchestrator writes (never an LLM, never the CEO).
pub const SYSTEM_POST_TYPES: &[&str] = &["status", "artifact"];

pub const MAX_POST_TEXT_CHARS: usize = 8000;
pub const MAX_CEO_TEXT_CHARS: usize = 4000;
pub const MAX_PAYLOAD_BYTES: usize = 16 * 1024;
/// Posts per item included in `GET /api/plan` (newest; older via `/posts?after=`).
pub const PLAN_POSTS_PER_ITEM: i64 = 50;

/// Sim ids: "work-item-4", "todo-9", "ws-1", "goal-1", "staff-5".
pub fn valid_sim_id(s: &str) -> bool {
    let b = s.as_bytes();
    !b.is_empty()
        && b.len() <= 64
        && b[0].is_ascii_lowercase()
        && b.iter()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == b'-')
}

pub fn valid_staff_id(s: &str) -> bool {
    s.strip_prefix("staff-")
        .is_some_and(|n| !n.is_empty() && n.len() <= 10 && n.bytes().all(|c| c.is_ascii_digit()))
}

/// In-game time of a post.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct GameTime {
    pub day: u32,
    pub minute: u16,
}

/// The company's current game clock, from the wall clock (same formula the
/// actor uses to catch up), so posts carry game time without asking the actor.
pub async fn company_clock(
    pool: &PgPool,
    company_id: Uuid,
    step_period: Duration,
) -> Result<GameTime> {
    let p = db::company_load_params(pool, company_id, step_period)
        .await?
        .context("company not found")?;
    let cfg = sim_core::SimConfig {
        day_real_minutes: u64::from(p.day_real_minutes),
        ..sim_core::SimConfig::default()
    };
    let c = cfg.clock_at(p.wall_step);
    Ok(GameTime {
        day: c.day,
        minute: c.minute,
    })
}

/// One thread post as clients see it (publishing-plan.md §7 `posts`).
#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct Post {
    pub id: String,
    pub item: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub author: String,
    pub day: i32,
    pub minute: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub to: Option<String>,
    pub text: String,
    #[serde(skip_serializing_if = "is_empty_object")]
    pub payload: Value,
    #[serde(rename = "createdAt")]
    pub created_at: DateTime<Utc>,
}

fn is_empty_object(v: &Value) -> bool {
    v.as_object().is_some_and(|m| m.is_empty()) || v.is_null()
}

type PostRow = (
    i64,
    String,
    String,
    String,
    Option<String>,
    Value,
    String,
    i32,
    i32,
    DateTime<Utc>,
);

const POST_COLS: &str =
    "id, item_id, type, author, to_staff, payload, text, game_day, game_minute, created_at";

fn post_from_row(r: PostRow) -> Post {
    Post {
        id: format!("post-{}", r.0),
        item: r.1,
        kind: r.2,
        author: r.3,
        to: r.4,
        payload: r.5,
        text: r.6,
        day: r.7,
        minute: r.8,
        created_at: r.9,
    }
}

/// Fan-out of `PlanPost` frames to every socket of a company. Independent of
/// the company actor, so plan streaming survives actor restarts.
#[derive(Clone, Default)]
pub struct PlanHub {
    inner: Arc<Mutex<HashMap<Uuid, broadcast::Sender<Arc<ServerFrame>>>>>,
}

impl PlanHub {
    pub fn subscribe(&self, company_id: Uuid) -> broadcast::Receiver<Arc<ServerFrame>> {
        let mut m = self.inner.lock().expect("plan hub lock");
        m.retain(|_, tx| tx.receiver_count() > 0);
        m.entry(company_id)
            .or_insert_with(|| broadcast::channel(256).0)
            .subscribe()
    }

    /// Number of receivers that got the frame (0 when nobody listens).
    pub fn publish(&self, company_id: Uuid, frame: ServerFrame) -> usize {
        let m = self.inner.lock().expect("plan hub lock");
        m.get(&company_id)
            .and_then(|tx| tx.send(Arc::new(frame)).ok())
            .unwrap_or(0)
    }
}

/// A plan operation returned by an agent alongside its artifact.
///
/// Parsed leniently from JSON so both a flat `{op, text, to, ...}` and the
/// agents crate's tagged `PlanOp` serialization are accepted: `op` (or `type`)
/// names the post type, `text` (or `notes`) is the body, `to` the addressee,
/// and every other field lands in `payload`.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct PlanOp {
    pub op: String,
    pub text: String,
    pub to: Option<String>,
    pub payload: Value,
}

impl PlanOp {
    pub fn from_json(v: &Value) -> Result<Self, String> {
        let obj = v.as_object().ok_or("plan op must be a JSON object")?;
        let op = obj
            .get("op")
            .or_else(|| obj.get("type"))
            .and_then(Value::as_str)
            .ok_or("plan op needs a string `op`")?
            .to_string();
        let text = obj
            .get("text")
            .or_else(|| obj.get("notes"))
            .map(|t| {
                t.as_str()
                    .map(str::to_string)
                    .ok_or("`text` must be a string")
            })
            .transpose()?
            .unwrap_or_default();
        let to = match obj.get("to") {
            None | Some(Value::Null) => None,
            Some(Value::String(s)) => Some(s.clone()),
            Some(_) => return Err("`to` must be a staff id string".into()),
        };
        let mut payload = Map::new();
        for (k, v) in obj {
            if !matches!(k.as_str(), "op" | "type" | "text" | "notes" | "to") {
                payload.insert(k.clone(), v.clone());
            }
        }
        Ok(Self {
            op,
            text,
            to,
            payload: Value::Object(payload),
        })
    }
}

/// Who is applying ops to which item.
#[derive(Clone, Debug)]
pub struct PlanOpContext {
    pub company_id: Uuid,
    pub item_id: String,
    /// Staff id ("staff-5") or "system".
    pub actor: String,
}

/// RBAC for agent plan ops (a writer can't post a `decision` or approve; a
/// role not on the project team can't take a phase). The real implementation
/// lives with the agents crate (`validate_plan_ops`) and the sim's team data;
/// it is plugged in via [`AppState::with_plan_validator`](crate::app::AppState::with_plan_validator).
pub trait PlanOpValidator: Send + Sync + 'static {
    fn validate(&self, ctx: &PlanOpContext, op: &PlanOp) -> Result<(), String>;
}

/// STUB: accepts every structurally valid op and logs a warning each time,
/// until the agents crate's RBAC validator is wired in.
pub struct PermissivePlanOpValidator;

impl PlanOpValidator for PermissivePlanOpValidator {
    fn validate(&self, ctx: &PlanOpContext, op: &PlanOp) -> Result<(), String> {
        tracing::warn!(company_id = %ctx.company_id, item = %ctx.item_id, actor = %ctx.actor, op = %op.op,
            "PermissivePlanOpValidator: plan op accepted WITHOUT RBAC checks (stub)");
        Ok(())
    }
}

fn check_text(text: &str, max: usize, required: bool) -> Result<(), String> {
    if required && text.trim().is_empty() {
        return Err("text must not be empty".into());
    }
    if text.chars().count() > max {
        return Err(format!("text is longer than {max} characters"));
    }
    Ok(())
}

fn check_payload(payload: &Value, max: usize) -> Result<(), String> {
    if !payload.is_object() {
        return Err("payload must be a JSON object".into());
    }
    if payload.to_string().len() > max {
        return Err(format!("payload is larger than {max} bytes"));
    }
    Ok(())
}

fn payload_str<'a>(payload: &'a Value, key: &str) -> Option<&'a str> {
    payload.get(key).and_then(Value::as_str)
}

fn todo_id_of(payload: &Value) -> Option<&str> {
    payload_str(payload, "todo_id").or_else(|| payload_str(payload, "todoId"))
}

/// Schema checks every agent op must pass regardless of RBAC.
pub fn check_agent_op(op: &PlanOp) -> Result<(), String> {
    if !AGENT_OP_TYPES.contains(&op.op.as_str()) {
        return Err(format!("unknown plan op `{}`", op.op));
    }
    let needs_text = matches!(
        op.op.as_str(),
        "comment" | "handoff" | "question" | "minutes" | "proposal" | "decision" | "todo-add"
    );
    check_text(&op.text, MAX_POST_TEXT_CHARS, needs_text)?;
    if let Some(to) = &op.to {
        if !valid_staff_id(to) {
            return Err(format!("`to` must be a staff id, got `{to}`"));
        }
    }
    check_payload(&op.payload, MAX_PAYLOAD_BYTES)?;
    match op.op.as_str() {
        "review" => {
            match payload_str(&op.payload, "verdict") {
                Some("approve" | "changes" | "reject") => {}
                _ => return Err("review needs verdict approve|changes|reject".into()),
            }
            match op.payload.get("score").and_then(Value::as_u64) {
                Some(s) if s <= 10 => {}
                _ => return Err("review needs an integer score 0-10".into()),
            }
        }
        "todo-add" => {
            if let Some(id) = todo_id_of(&op.payload) {
                if !valid_sim_id(id) {
                    return Err("todo-add: invalid todo_id".into());
                }
            }
        }
        "todo-done" => match todo_id_of(&op.payload) {
            Some(id) if valid_sim_id(id) => {}
            _ => return Err("todo-done needs a todo_id".into()),
        },
        "request-help" => match payload_str(&op.payload, "role") {
            Some(r) if !r.is_empty() && r.len() <= 64 => {}
            _ => return Err("request-help needs a role".into()),
        },
        _ => {}
    }
    Ok(())
}

/// A CEO post from REST.
#[derive(Clone, Debug, Deserialize)]
pub struct CeoPost {
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub to: Option<String>,
    #[serde(default)]
    pub payload: Option<Value>,
}

pub fn check_ceo_post(p: &CeoPost) -> Result<(), String> {
    if !CEO_POST_TYPES.contains(&p.kind.as_str()) {
        return Err(format!(
            "the CEO may post {}; got `{}`",
            CEO_POST_TYPES.join(" or "),
            p.kind
        ));
    }
    check_text(&p.text, MAX_CEO_TEXT_CHARS, true)?;
    if let Some(to) = &p.to {
        if !valid_staff_id(to) {
            return Err(format!("`to` must be a staff id, got `{to}`"));
        }
    }
    if let Some(payload) = &p.payload {
        check_payload(payload, 4096)?;
    }
    Ok(())
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct RejectedOp {
    pub index: usize,
    pub op: String,
    pub reason: String,
}

/// Result of applying an agent's plan ops.
#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct PlanOpsOutcome {
    pub accepted: Vec<Post>,
    pub rejected: Vec<RejectedOp>,
    /// xxh3 of the accepted post ids, for the future `PlanOpsApplied{item, ops_digest}`
    /// server command.
    pub ops_digest: u64,
}

impl PlanOpsOutcome {
    /// Compact summary stored in the job result.
    pub fn summary(&self) -> Value {
        json!({
            "accepted": self.accepted.iter().map(|p| p.id.clone()).collect::<Vec<_>>(),
            "rejected": self.rejected,
            "opsDigest": self.ops_digest.to_string(),
        })
    }
}

/// Fencing for [`PlanService::complete_job_with_ops`]: the job row is updated
/// to `succeeded` with `result` in the same transaction as the posts.
pub struct JobCompletion<'a> {
    pub job_id: Uuid,
    pub owner: &'a str,
    pub result: &'a Value,
}

/// The only writer of plan text.
#[derive(Clone)]
pub struct PlanService {
    pool: PgPool,
    hub: PlanHub,
    validator: Arc<dyn PlanOpValidator>,
    step_period: Duration,
}

impl PlanService {
    pub fn new(
        pool: PgPool,
        hub: PlanHub,
        validator: Arc<dyn PlanOpValidator>,
        step_period: Duration,
    ) -> Self {
        Self {
            pool,
            hub,
            validator,
            step_period,
        }
    }

    pub fn hub(&self) -> &PlanHub {
        &self.hub
    }

    pub fn with_validator(mut self, validator: Arc<dyn PlanOpValidator>) -> Self {
        self.validator = validator;
        self
    }

    async fn clock(&self, company_id: Uuid) -> Result<GameTime> {
        company_clock(&self.pool, company_id, self.step_period).await
    }

    fn broadcast(&self, company_id: Uuid, posts: &[Post]) {
        for p in posts {
            let post_json = serde_json::to_string(p).expect("posts serialize");
            self.hub.publish(
                company_id,
                ServerFrame::PlanPost {
                    item_id: p.item.clone(),
                    post_json,
                },
            );
        }
    }

    #[allow(clippy::too_many_arguments)]
    async fn insert_post(
        tx: &mut Transaction<'_, Postgres>,
        company_id: Uuid,
        item_id: &str,
        kind: &str,
        author: &str,
        to: Option<&str>,
        payload: &Value,
        text: &str,
        at: GameTime,
    ) -> Result<Post> {
        let row: PostRow = sqlx::query_as(&format!(
            "INSERT INTO plan_posts (company_id, item_id, type, author, to_staff, payload, text, game_day, game_minute)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             RETURNING {POST_COLS}"
        ))
        .bind(company_id)
        .bind(item_id)
        .bind(kind)
        .bind(author)
        .bind(to)
        .bind(payload)
        .bind(text)
        .bind(i32::try_from(at.day).unwrap_or(i32::MAX))
        .bind(i32::from(at.minute))
        .fetch_one(&mut **tx)
        .await
        .context("insert plan post")?;
        Ok(post_from_row(row))
    }

    /// Validate agent ops and append the accepted ones (no job fencing).
    pub async fn apply_agent_ops(
        &self,
        company_id: Uuid,
        item_id: &str,
        actor: &str,
        ops: &[Value],
    ) -> Result<PlanOpsOutcome> {
        Ok(self
            .apply_inner(company_id, item_id, actor, ops, None)
            .await?
            .expect("no job fencing"))
    }

    /// Complete a leased job and append its accepted plan ops in ONE
    /// transaction. `Ok(None)` when the lease is no longer `owner`'s (nothing
    /// is written). The stored job result is `result` plus a `planOpsOutcome`
    /// summary (accepted post ids and rejected ops with reasons).
    pub async fn complete_job_with_ops(
        &self,
        company_id: Uuid,
        item_id: &str,
        actor: &str,
        ops: &[Value],
        job: JobCompletion<'_>,
    ) -> Result<Option<PlanOpsOutcome>> {
        self.apply_inner(company_id, item_id, actor, ops, Some(job))
            .await
    }

    async fn apply_inner(
        &self,
        company_id: Uuid,
        item_id: &str,
        actor: &str,
        ops: &[Value],
        job: Option<JobCompletion<'_>>,
    ) -> Result<Option<PlanOpsOutcome>> {
        let ctx = PlanOpContext {
            company_id,
            item_id: item_id.to_string(),
            actor: actor.to_string(),
        };
        let mut accepted_ops = Vec::new();
        let mut rejected = Vec::new();
        let actor_ok = actor == "system" || valid_staff_id(actor);
        for (index, raw) in ops.iter().enumerate() {
            let verdict = if !valid_sim_id(item_id) {
                Err(format!("invalid item id `{item_id}`"))
            } else if !actor_ok {
                Err(format!("invalid actor `{actor}`"))
            } else {
                PlanOp::from_json(raw).and_then(|op| {
                    check_agent_op(&op)?;
                    self.validator.validate(&ctx, &op)?;
                    Ok(op)
                })
            };
            match verdict {
                Ok(op) => accepted_ops.push(op),
                Err(reason) => {
                    let op = raw
                        .get("op")
                        .or_else(|| raw.get("type"))
                        .and_then(Value::as_str)
                        .unwrap_or("?")
                        .to_string();
                    tracing::info!(company_id = %company_id, item = item_id, actor, %op, %reason, "plan op rejected");
                    rejected.push(RejectedOp { index, op, reason });
                }
            }
        }

        let at = self.clock(company_id).await?;
        let mut tx = self.pool.begin().await.context("begin")?;
        let mut accepted = Vec::with_capacity(accepted_ops.len());
        for op in &accepted_ops {
            if op.op == "todo-add" {
                if let Some(todo_id) = todo_id_of(&op.payload) {
                    sqlx::query(
                        "INSERT INTO plan_todos (company_id, todo_id, item_id, text)
                         VALUES ($1, $2, $3, $4) ON CONFLICT (company_id, todo_id) DO NOTHING",
                    )
                    .bind(company_id)
                    .bind(todo_id)
                    .bind(item_id)
                    .bind(&op.text)
                    .execute(&mut *tx)
                    .await
                    .context("insert todo")?;
                }
            }
            accepted.push(
                Self::insert_post(
                    &mut tx,
                    company_id,
                    item_id,
                    &op.op,
                    actor,
                    op.to.as_deref(),
                    &op.payload,
                    &op.text,
                    at,
                )
                .await?,
            );
        }
        let digest_input = accepted
            .iter()
            .map(|p| p.id.as_str())
            .collect::<Vec<_>>()
            .join("\n");
        let outcome = PlanOpsOutcome {
            accepted,
            rejected,
            ops_digest: xxhash_rust::xxh3::xxh3_64(digest_input.as_bytes()),
        };
        if let Some(job) = job {
            let mut result = job.result.clone();
            if let Some(obj) = result.as_object_mut() {
                obj.insert("planOpsOutcome".into(), outcome.summary());
            }
            let done = sqlx::query(
                "UPDATE jobs SET status = 'succeeded', result = $3, error = NULL,
                        lease_owner = NULL, lease_until = NULL, updated_at = now()
                 WHERE id = $1 AND status = 'running' AND lease_owner = $2",
            )
            .bind(job.job_id)
            .bind(job.owner)
            .bind(&result)
            .execute(&mut *tx)
            .await
            .context("complete job")?;
            if done.rows_affected() != 1 {
                tx.rollback().await.ok();
                return Ok(None);
            }
        }
        tx.commit().await.context("commit plan ops")?;
        self.broadcast(company_id, &outcome.accepted);
        Ok(Some(outcome))
    }

    /// Append a CEO `comment` or `decision`. `Err(AppError::BadRequest)` on
    /// validation failure.
    pub async fn append_ceo_post(
        &self,
        company_id: Uuid,
        item_id: &str,
        p: &CeoPost,
    ) -> AppResult<Post> {
        if !valid_sim_id(item_id) {
            return Err(AppError::BadRequest(format!("invalid item id `{item_id}`")));
        }
        check_ceo_post(p).map_err(AppError::BadRequest)?;
        let payload = p.payload.clone().unwrap_or_else(|| json!({}));
        self.append(
            company_id,
            item_id,
            &p.kind,
            "ceo",
            p.to.as_deref(),
            &payload,
            p.text.trim(),
        )
        .await
        .map_err(AppError::Internal)
    }

    /// Append an orchestrator post (`status` or `artifact`), author `system`.
    pub async fn append_system_post(
        &self,
        company_id: Uuid,
        item_id: &str,
        kind: &str,
        text: &str,
        payload: &Value,
    ) -> Result<Post> {
        anyhow::ensure!(
            SYSTEM_POST_TYPES.contains(&kind),
            "not a system post type: {kind}"
        );
        anyhow::ensure!(valid_sim_id(item_id), "invalid item id {item_id}");
        check_payload(payload, MAX_PAYLOAD_BYTES).map_err(anyhow::Error::msg)?;
        self.append(company_id, item_id, kind, "system", None, payload, text)
            .await
    }

    #[allow(clippy::too_many_arguments)]
    async fn append(
        &self,
        company_id: Uuid,
        item_id: &str,
        kind: &str,
        author: &str,
        to: Option<&str>,
        payload: &Value,
        text: &str,
    ) -> Result<Post> {
        let at = self.clock(company_id).await?;
        let mut tx = self.pool.begin().await?;
        let post = Self::insert_post(
            &mut tx, company_id, item_id, kind, author, to, payload, text, at,
        )
        .await?;
        tx.commit().await?;
        self.broadcast(company_id, std::slice::from_ref(&post));
        Ok(post)
    }

    /// Set an item's title and/or brief (absent fields are kept).
    pub async fn set_item_text(
        &self,
        company_id: Uuid,
        item_id: &str,
        title: Option<&str>,
        brief: Option<&str>,
    ) -> Result<()> {
        sqlx::query(
            "INSERT INTO plan_items (company_id, item_id, title, brief)
             VALUES ($1, $2, COALESCE($3, ''), COALESCE($4, ''))
             ON CONFLICT (company_id, item_id) DO UPDATE
               SET title = COALESCE($3, plan_items.title),
                   brief = COALESCE($4, plan_items.brief),
                   updated_at = now()",
        )
        .bind(company_id)
        .bind(item_id)
        .bind(title)
        .bind(brief)
        .execute(&self.pool)
        .await
        .context("set item text")?;
        Ok(())
    }

    pub async fn set_workstream_text(
        &self,
        company_id: Uuid,
        id: &str,
        title: Option<&str>,
        description: Option<&str>,
    ) -> Result<()> {
        sqlx::query(
            "INSERT INTO plan_workstreams (company_id, workstream_id, title, description)
             VALUES ($1, $2, COALESCE($3, ''), COALESCE($4, ''))
             ON CONFLICT (company_id, workstream_id) DO UPDATE
               SET title = COALESCE($3, plan_workstreams.title),
                   description = COALESCE($4, plan_workstreams.description),
                   updated_at = now()",
        )
        .bind(company_id)
        .bind(id)
        .bind(title)
        .bind(description)
        .execute(&self.pool)
        .await
        .context("set workstream text")?;
        Ok(())
    }

    pub async fn set_goal_text(&self, company_id: Uuid, id: &str, title: &str) -> Result<()> {
        sqlx::query(
            "INSERT INTO plan_goals (company_id, goal_id, title) VALUES ($1, $2, $3)
             ON CONFLICT (company_id, goal_id) DO UPDATE SET title = $3, updated_at = now()",
        )
        .bind(company_id)
        .bind(id)
        .bind(title)
        .execute(&self.pool)
        .await
        .context("set goal text")?;
        Ok(())
    }

    /// Add todo text (CEO) and record a `todo-add` post in the item's thread.
    /// `Ok(None)` if the todo id already exists.
    pub async fn add_ceo_todo(
        &self,
        company_id: Uuid,
        item_id: &str,
        todo_id: &str,
        text: &str,
    ) -> Result<Option<Post>> {
        let at = self.clock(company_id).await?;
        let mut tx = self.pool.begin().await?;
        let inserted = sqlx::query(
            "INSERT INTO plan_todos (company_id, todo_id, item_id, text)
             VALUES ($1, $2, $3, $4) ON CONFLICT (company_id, todo_id) DO NOTHING",
        )
        .bind(company_id)
        .bind(todo_id)
        .bind(item_id)
        .bind(text)
        .execute(&mut *tx)
        .await
        .context("insert todo")?;
        if inserted.rows_affected() == 0 {
            tx.rollback().await.ok();
            return Ok(None);
        }
        let post = Self::insert_post(
            &mut tx,
            company_id,
            item_id,
            "todo-add",
            "ceo",
            None,
            &json!({ "todo_id": todo_id }),
            text,
            at,
        )
        .await?;
        tx.commit().await?;
        self.broadcast(company_id, std::slice::from_ref(&post));
        Ok(Some(post))
    }

    /// Posts of one item with id > `after`, oldest first.
    pub async fn posts_after(
        &self,
        company_id: Uuid,
        item_id: &str,
        after: i64,
        limit: i64,
    ) -> Result<Vec<Post>> {
        let rows: Vec<PostRow> = sqlx::query_as(&format!(
            "SELECT {POST_COLS} FROM plan_posts
             WHERE company_id = $1 AND item_id = $2 AND id > $3
             ORDER BY id LIMIT $4"
        ))
        .bind(company_id)
        .bind(item_id)
        .bind(after)
        .bind(limit)
        .fetch_all(&self.pool)
        .await
        .context("list posts")?;
        Ok(rows.into_iter().map(post_from_row).collect())
    }

    /// Every text map of the company's plan (publishing-plan.md §7 PlanStore).
    pub async fn plan_store(&self, company_id: Uuid) -> Result<Value> {
        let items: Vec<(String, String, String)> = sqlx::query_as(
            "SELECT item_id, title, brief FROM plan_items WHERE company_id = $1 ORDER BY item_id",
        )
        .bind(company_id)
        .fetch_all(&self.pool)
        .await?;
        let todos: Vec<(String, String, String)> = sqlx::query_as(
            "SELECT todo_id, item_id, text FROM plan_todos WHERE company_id = $1 ORDER BY todo_id",
        )
        .bind(company_id)
        .fetch_all(&self.pool)
        .await?;
        let workstreams: Vec<(String, String, String)> = sqlx::query_as(
            "SELECT workstream_id, title, description FROM plan_workstreams
             WHERE company_id = $1 ORDER BY workstream_id",
        )
        .bind(company_id)
        .fetch_all(&self.pool)
        .await?;
        let goals: Vec<(String, String)> = sqlx::query_as(
            "SELECT goal_id, title FROM plan_goals WHERE company_id = $1 ORDER BY goal_id",
        )
        .bind(company_id)
        .fetch_all(&self.pool)
        .await?;
        let posts: Vec<PostRow> = sqlx::query_as(&format!(
            "SELECT {POST_COLS} FROM (
                SELECT *, row_number() OVER (PARTITION BY item_id ORDER BY id DESC) AS rn
                FROM plan_posts WHERE company_id = $1
             ) p WHERE rn <= $2 ORDER BY item_id, id"
        ))
        .bind(company_id)
        .bind(PLAN_POSTS_PER_ITEM)
        .fetch_all(&self.pool)
        .await?;

        let mut posts_by_item: Map<String, Value> = Map::new();
        for p in posts.into_iter().map(post_from_row) {
            let entry = posts_by_item
                .entry(p.item.clone())
                .or_insert_with(|| Value::Array(vec![]));
            if let Value::Array(a) = entry {
                a.push(serde_json::to_value(&p)?);
            }
        }
        Ok(json!({
            "items": items.into_iter().map(|(id, title, brief)| (id, json!({ "title": title, "brief": brief }))).collect::<Map<_, _>>(),
            "todos": todos.into_iter().map(|(id, _item, text)| (id, Value::String(text))).collect::<Map<_, _>>(),
            "workstreams": workstreams.into_iter().map(|(id, title, d)| (id, json!({ "title": title, "description": d }))).collect::<Map<_, _>>(),
            "goals": goals.into_iter().map(|(id, title)| (id, json!({ "title": title }))).collect::<Map<_, _>>(),
            "posts": posts_by_item,
        }))
    }
}

// ---------------------------------------------------------------- REST

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/plan", get(get_plan))
        .route("/api/plan/items/{id}", put(put_item))
        .route(
            "/api/plan/items/{id}/posts",
            get(list_posts).post(create_post),
        )
        .route("/api/plan/todos", post(create_todo))
        .route("/api/plan/workstreams/{id}", put(put_workstream))
        .route("/api/plan/goals/{id}", put(put_goal))
}

/// The caller's company, or 404.
pub async fn require_company(st: &AppState, user_id: Uuid) -> AppResult<Company> {
    db::company_for_user(&st.pool, user_id)
        .await?
        .ok_or_else(|| AppError::NotFound("create a company first".into()))
}

fn require_sim_id(id: &str, what: &str) -> AppResult<()> {
    if valid_sim_id(id) {
        Ok(())
    } else {
        Err(AppError::BadRequest(format!("invalid {what} id `{id}`")))
    }
}

fn check_opt_len(v: Option<&str>, max: usize, what: &str) -> AppResult<()> {
    match v {
        Some(s) if s.chars().count() > max => Err(AppError::BadRequest(format!(
            "{what} is longer than {max} characters"
        ))),
        _ => Ok(()),
    }
}

async fn get_plan(
    State(st): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> AppResult<Json<Value>> {
    let c = require_company(&st, user.id).await?;
    Ok(Json(st.plan.plan_store(c.id).await?))
}

#[derive(Deserialize)]
struct AfterQuery {
    after: Option<String>,
    limit: Option<i64>,
}

fn parse_after(s: Option<&str>) -> AppResult<i64> {
    match s {
        None | Some("") => Ok(0),
        Some(s) => s
            .strip_prefix("post-")
            .unwrap_or(s)
            .parse::<i64>()
            .map_err(|_| AppError::BadRequest("after must be a post id".into())),
    }
}

async fn list_posts(
    State(st): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(item): Path<String>,
    Query(q): Query<AfterQuery>,
) -> AppResult<Json<Value>> {
    let c = require_company(&st, user.id).await?;
    require_sim_id(&item, "item")?;
    let after = parse_after(q.after.as_deref())?;
    let limit = q.limit.unwrap_or(200).clamp(1, 500);
    let posts = st.plan.posts_after(c.id, &item, after, limit).await?;
    Ok(Json(json!({ "item": item, "posts": posts })))
}

async fn create_post(
    State(st): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(item): Path<String>,
    Json(body): Json<CeoPost>,
) -> AppResult<(StatusCode, Json<Post>)> {
    let c = require_company(&st, user.id).await?;
    let post = st.plan.append_ceo_post(c.id, &item, &body).await?;
    Ok((StatusCode::CREATED, Json(post)))
}

#[derive(Deserialize)]
struct ItemText {
    title: Option<String>,
    brief: Option<String>,
}

async fn put_item(
    State(st): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(item): Path<String>,
    Json(body): Json<ItemText>,
) -> AppResult<Json<Value>> {
    let c = require_company(&st, user.id).await?;
    require_sim_id(&item, "item")?;
    if body.title.is_none() && body.brief.is_none() {
        return Err(AppError::BadRequest("title or brief required".into()));
    }
    check_opt_len(body.title.as_deref(), 200, "title")?;
    check_opt_len(body.brief.as_deref(), 20_000, "brief")?;
    st.plan
        .set_item_text(c.id, &item, body.title.as_deref(), body.brief.as_deref())
        .await?;
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NewTodo {
    item_id: String,
    /// The sim's todo id (from `AddTodo`). Generated when absent.
    todo_id: Option<String>,
    text: String,
}

async fn create_todo(
    State(st): State<AppState>,
    CurrentUser(user): CurrentUser,
    Json(body): Json<NewTodo>,
) -> AppResult<(StatusCode, Json<Value>)> {
    let c = require_company(&st, user.id).await?;
    require_sim_id(&body.item_id, "item")?;
    let todo_id = match body.todo_id {
        Some(t) => {
            require_sim_id(&t, "todo")?;
            t
        }
        None => format!("todo-c{}", &Uuid::new_v4().simple().to_string()[..12]),
    };
    let text = body.text.trim();
    check_text(text, 500, true).map_err(AppError::BadRequest)?;
    match st
        .plan
        .add_ceo_todo(c.id, &body.item_id, &todo_id, text)
        .await?
    {
        Some(post) => Ok((
            StatusCode::CREATED,
            Json(json!({ "todoId": todo_id, "post": post })),
        )),
        None => Err(AppError::Conflict(format!("todo {todo_id} already exists"))),
    }
}

#[derive(Deserialize)]
struct WorkstreamText {
    title: Option<String>,
    description: Option<String>,
}

async fn put_workstream(
    State(st): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
    Json(body): Json<WorkstreamText>,
) -> AppResult<Json<Value>> {
    let c = require_company(&st, user.id).await?;
    require_sim_id(&id, "workstream")?;
    check_opt_len(body.title.as_deref(), 200, "title")?;
    check_opt_len(body.description.as_deref(), 20_000, "description")?;
    st.plan
        .set_workstream_text(
            c.id,
            &id,
            body.title.as_deref(),
            body.description.as_deref(),
        )
        .await?;
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
struct GoalText {
    title: String,
}

async fn put_goal(
    State(st): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
    Json(body): Json<GoalText>,
) -> AppResult<Json<Value>> {
    let c = require_company(&st, user.id).await?;
    require_sim_id(&id, "goal")?;
    check_opt_len(Some(&body.title), 200, "title")?;
    st.plan.set_goal_text(c.id, &id, &body.title).await?;
    Ok(Json(json!({ "ok": true })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids() {
        assert!(valid_sim_id("work-item-4"));
        assert!(!valid_sim_id("Work"));
        assert!(!valid_sim_id("4x"));
        assert!(!valid_sim_id(""));
        assert!(valid_staff_id("staff-12"));
        assert!(!valid_staff_id("staff-"));
        assert!(!valid_staff_id("ceo"));
    }

    #[test]
    fn plan_op_parsing_is_lenient() {
        let op = PlanOp::from_json(&json!({
            "type": "review", "notes": "good", "verdict": "approve", "score": 8
        }))
        .unwrap();
        assert_eq!(op.op, "review");
        assert_eq!(op.text, "good");
        assert_eq!(op.payload, json!({ "verdict": "approve", "score": 8 }));
        assert!(check_agent_op(&op).is_ok());
        assert!(PlanOp::from_json(&json!("x")).is_err());
        assert!(PlanOp::from_json(&json!({ "text": "no op" })).is_err());
    }

    #[test]
    fn agent_op_schema() {
        let bad = |v: Value| check_agent_op(&PlanOp::from_json(&v).unwrap()).is_err();
        assert!(bad(json!({ "op": "status", "text": "x" })));
        assert!(bad(json!({ "op": "comment", "text": "  " })));
        assert!(bad(json!({ "op": "review", "verdict": "meh", "score": 3 })));
        assert!(bad(
            json!({ "op": "review", "verdict": "approve", "score": 11 })
        ));
        assert!(bad(json!({ "op": "todo-done" })));
        assert!(bad(json!({ "op": "comment", "text": "x", "to": "bob" })));
        assert!(bad(json!({ "op": "request-help" })));
        assert!(!bad(
            json!({ "op": "handoff", "text": "draft in", "to": "staff-6" })
        ));
        assert!(!bad(json!({ "op": "todo-done", "todo_id": "todo-9" })));
    }

    #[test]
    fn ceo_post_schema() {
        let p = |kind: &str, text: &str| CeoPost {
            kind: kind.into(),
            text: text.into(),
            to: None,
            payload: None,
        };
        assert!(check_ceo_post(&p("comment", "hi")).is_ok());
        assert!(check_ceo_post(&p("decision", "cut to 8")).is_ok());
        assert!(check_ceo_post(&p("review", "x")).is_err());
        assert!(check_ceo_post(&p("comment", "")).is_err());
        assert!(check_ceo_post(&p("comment", &"x".repeat(4001))).is_err());
    }
}
