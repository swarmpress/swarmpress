//! Where the orchestrator keeps text: briefs, artifacts, transcripts and the
//! plan thread, keyed by company and sim ids.
//!
//! The trait speaks `serde_json::Value` and strings so that a JS bridge
//! (DuckDB-wasm in the browser) can implement it without sharing Rust types.
//! The shapes are [`BriefRecord`], [`ArtifactRecord`] and the plan post shape
//! documented on [`Store::append_post`].

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use agents::pipeline::EditorReview;
use agents::{Brief, MaybeSendSync};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

/// Post types the orchestrator writes to an item's thread.
pub const POST_TYPES: &[&str] = &["minutes", "artifact", "handoff", "review", "status"];

/// Posts per item included in [`Store::plan_json`] (newest).
pub const PLAN_POSTS_PER_ITEM: usize = 50;

/// A storage failure (I/O, bridge, serialization). The job can be retried.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("store: {0}")]
pub struct StoreError(pub String);

/// A brief agreed in a standup (stored as JSON by [`Store::put_brief`]).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BriefRecord {
    /// The standup job that produced it.
    pub job_id: u64,
    pub brief: Brief,
    /// Sim staff ids.
    pub writer: String,
    pub editor: String,
    /// Standup transcript excerpt: `[{seq, speaker, text}]`.
    #[serde(default)]
    pub minutes: Vec<Value>,
    /// Set by [`Store::claim_brief`] when the first draft job arrives.
    #[serde(default)]
    pub work_item: Option<String>,
}

/// The latest artifacts of one work item (stored as JSON by
/// [`Store::put_artifact`]).
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct ArtifactRecord {
    pub brief_ref: u64,
    /// Latest page JSON (as committed to the draft branch).
    #[serde(default)]
    pub page: Option<Value>,
    /// Latest editor review.
    #[serde(default)]
    pub review: Option<EditorReview>,
    #[serde(default)]
    pub revision: u8,
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub branch: Option<String>,
    #[serde(default)]
    pub pr_number: Option<u64>,
    #[serde(default)]
    pub head_sha: Option<String>,
    /// Set once the PR is merged; publishing again is a no-op.
    #[serde(default)]
    pub merged_sha: Option<String>,
}

/// The orchestrator's storage. All methods are keyed by `company`.
#[cfg_attr(not(target_arch = "wasm32"), async_trait)]
#[cfg_attr(target_arch = "wasm32", async_trait(?Send))]
pub trait Store: MaybeSendSync {
    /// Insert a [`BriefRecord`] if `brief_ref` is new (an existing brief is
    /// kept, so a retried standup is harmless).
    async fn put_brief(
        &self,
        company: &str,
        brief_ref: u64,
        record: Value,
    ) -> Result<(), StoreError>;

    /// The [`BriefRecord`] JSON, if any.
    async fn get_brief(&self, company: &str, brief_ref: u64) -> Result<Option<Value>, StoreError>;

    /// Attach `work_item` to the brief if none is attached yet. `true` when
    /// this call attached it (the first draft of the item).
    async fn claim_brief(
        &self,
        company: &str,
        brief_ref: u64,
        work_item: &str,
    ) -> Result<bool, StoreError>;

    /// Replace the [`ArtifactRecord`] JSON of a work item.
    async fn put_artifact(
        &self,
        company: &str,
        work_item: &str,
        record: Value,
    ) -> Result<(), StoreError>;

    /// The [`ArtifactRecord`] JSON of a work item, if any.
    async fn get_artifact(
        &self,
        company: &str,
        work_item: &str,
    ) -> Result<Option<Value>, StoreError>;

    /// Append one meeting utterance; idempotent on `(job_id, seq)`.
    async fn append_transcript(
        &self,
        company: &str,
        job_id: u64,
        seq: u32,
        speaker: &str,
        text: &str,
    ) -> Result<(), StoreError>;

    /// Set a plan item's title and/or brief (`None` keeps the current value).
    async fn set_item_text(
        &self,
        company: &str,
        item: &str,
        title: Option<&str>,
        brief: Option<&str>,
    ) -> Result<(), StoreError>;

    /// Append a post to an item's thread and return its id. `post` is
    /// `{type, author, to?, text, payload}` with `type` one of
    /// [`POST_TYPES`]; the store adds `id` and `item` (and, if it knows the
    /// game clock, `day`/`minute`).
    async fn append_post(
        &self,
        company: &str,
        item: &str,
        post: Value,
    ) -> Result<String, StoreError>;

    /// The plan text view (publishing-plan.md §7 PlanStore):
    /// `{items: {id: {title, brief}}, todos: {}, workstreams: {}, goals: {},
    /// posts: {id: [post, ...]}}`, posts oldest first, at most
    /// [`PLAN_POSTS_PER_ITEM`] per item.
    async fn plan_json(&self, company: &str) -> Result<Value, StoreError>;
}

macro_rules! forward_store {
    ($ty:ty) => {
        #[cfg_attr(not(target_arch = "wasm32"), async_trait)]
        #[cfg_attr(target_arch = "wasm32", async_trait(?Send))]
        impl<T: Store + ?Sized> Store for $ty {
            async fn put_brief(&self, c: &str, r: u64, v: Value) -> Result<(), StoreError> {
                (**self).put_brief(c, r, v).await
            }
            async fn get_brief(&self, c: &str, r: u64) -> Result<Option<Value>, StoreError> {
                (**self).get_brief(c, r).await
            }
            async fn claim_brief(&self, c: &str, r: u64, w: &str) -> Result<bool, StoreError> {
                (**self).claim_brief(c, r, w).await
            }
            async fn put_artifact(&self, c: &str, w: &str, v: Value) -> Result<(), StoreError> {
                (**self).put_artifact(c, w, v).await
            }
            async fn get_artifact(&self, c: &str, w: &str) -> Result<Option<Value>, StoreError> {
                (**self).get_artifact(c, w).await
            }
            async fn append_transcript(
                &self,
                c: &str,
                j: u64,
                s: u32,
                sp: &str,
                t: &str,
            ) -> Result<(), StoreError> {
                (**self).append_transcript(c, j, s, sp, t).await
            }
            async fn set_item_text(
                &self,
                c: &str,
                i: &str,
                t: Option<&str>,
                b: Option<&str>,
            ) -> Result<(), StoreError> {
                (**self).set_item_text(c, i, t, b).await
            }
            async fn append_post(&self, c: &str, i: &str, p: Value) -> Result<String, StoreError> {
                (**self).append_post(c, i, p).await
            }
            async fn plan_json(&self, c: &str) -> Result<Value, StoreError> {
                (**self).plan_json(c).await
            }
        }
    };
}

forward_store!(Arc<T>);
forward_store!(&T);

#[derive(Debug, Default)]
struct Company {
    briefs: BTreeMap<u64, Value>,
    artifacts: BTreeMap<String, Value>,
    /// (job_id, seq) → (speaker, text)
    transcripts: BTreeMap<(u64, u32), (String, String)>,
    /// item → (title, brief)
    items: BTreeMap<String, (String, String)>,
    posts: BTreeMap<String, Vec<Value>>,
}

#[derive(Debug, Default)]
struct Inner {
    companies: BTreeMap<String, Company>,
    next_post: u64,
}

/// In-memory [`Store`] (tests, dev, and the reference for other stores).
#[derive(Debug, Default)]
pub struct MemStore {
    inner: Mutex<Inner>,
}

impl MemStore {
    pub fn new() -> Self {
        Self::default()
    }

    fn with<R>(&self, company: &str, f: impl FnOnce(&mut Company, &mut u64) -> R) -> R {
        let mut g = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        let Inner {
            companies,
            next_post,
        } = &mut *g;
        f(companies.entry(company.to_string()).or_default(), next_post)
    }

    /// Every transcript line of a company, `[{job_id, seq, speaker, text}]`
    /// in `(job_id, seq)` order.
    pub fn transcripts(&self, company: &str) -> Vec<Value> {
        self.with(company, |c, _| {
            c.transcripts
                .iter()
                .map(|((job, seq), (speaker, text))| {
                    json!({"job_id": job, "seq": seq, "speaker": speaker, "text": text})
                })
                .collect()
        })
    }
}

#[cfg_attr(not(target_arch = "wasm32"), async_trait)]
#[cfg_attr(target_arch = "wasm32", async_trait(?Send))]
impl Store for MemStore {
    async fn put_brief(
        &self,
        company: &str,
        brief_ref: u64,
        record: Value,
    ) -> Result<(), StoreError> {
        self.with(company, |c, _| {
            c.briefs.entry(brief_ref).or_insert(record);
        });
        Ok(())
    }

    async fn get_brief(&self, company: &str, brief_ref: u64) -> Result<Option<Value>, StoreError> {
        Ok(self.with(company, |c, _| c.briefs.get(&brief_ref).cloned()))
    }

    async fn claim_brief(
        &self,
        company: &str,
        brief_ref: u64,
        work_item: &str,
    ) -> Result<bool, StoreError> {
        self.with(company, |c, _| {
            let b = c
                .briefs
                .get_mut(&brief_ref)
                .ok_or_else(|| StoreError(format!("unknown brief_ref {brief_ref}")))?;
            let obj = b
                .as_object_mut()
                .ok_or_else(|| StoreError("brief record is not an object".into()))?;
            match obj.get("work_item") {
                Some(Value::String(_)) => Ok(false),
                _ => {
                    obj.insert("work_item".into(), json!(work_item));
                    Ok(true)
                }
            }
        })
    }

    async fn put_artifact(
        &self,
        company: &str,
        work_item: &str,
        record: Value,
    ) -> Result<(), StoreError> {
        self.with(company, |c, _| {
            c.artifacts.insert(work_item.to_string(), record);
        });
        Ok(())
    }

    async fn get_artifact(
        &self,
        company: &str,
        work_item: &str,
    ) -> Result<Option<Value>, StoreError> {
        Ok(self.with(company, |c, _| c.artifacts.get(work_item).cloned()))
    }

    async fn append_transcript(
        &self,
        company: &str,
        job_id: u64,
        seq: u32,
        speaker: &str,
        text: &str,
    ) -> Result<(), StoreError> {
        self.with(company, |c, _| {
            c.transcripts
                .entry((job_id, seq))
                .or_insert_with(|| (speaker.to_string(), text.to_string()));
        });
        Ok(())
    }

    async fn set_item_text(
        &self,
        company: &str,
        item: &str,
        title: Option<&str>,
        brief: Option<&str>,
    ) -> Result<(), StoreError> {
        self.with(company, |c, _| {
            let e = c.items.entry(item.to_string()).or_default();
            if let Some(t) = title {
                e.0 = t.to_string();
            }
            if let Some(b) = brief {
                e.1 = b.to_string();
            }
        });
        Ok(())
    }

    async fn append_post(
        &self,
        company: &str,
        item: &str,
        post: Value,
    ) -> Result<String, StoreError> {
        let Value::Object(mut obj) = post else {
            return Err(StoreError("post must be a JSON object".into()));
        };
        match obj.get("type").and_then(Value::as_str) {
            Some(t) if POST_TYPES.contains(&t) => {}
            other => return Err(StoreError(format!("unknown post type {other:?}"))),
        }
        Ok(self.with(company, |c, next| {
            *next += 1;
            let id = format!("post-{next}");
            obj.insert("id".into(), json!(id));
            obj.insert("item".into(), json!(item));
            c.posts
                .entry(item.to_string())
                .or_default()
                .push(Value::Object(obj));
            id
        }))
    }

    async fn plan_json(&self, company: &str) -> Result<Value, StoreError> {
        Ok(self.with(company, |c, _| {
            let items: Map<String, Value> = c
                .items
                .iter()
                .map(|(id, (title, brief))| (id.clone(), json!({"title": title, "brief": brief})))
                .collect();
            let posts: Map<String, Value> = c
                .posts
                .iter()
                .map(|(id, ps)| {
                    let skip = ps.len().saturating_sub(PLAN_POSTS_PER_ITEM);
                    (id.clone(), Value::Array(ps[skip..].to_vec()))
                })
                .collect();
            json!({"items": items, "todos": {}, "workstreams": {}, "goals": {}, "posts": posts})
        }))
    }
}
