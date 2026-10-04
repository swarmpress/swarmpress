//! Where the orchestrator keeps text: briefs, artifacts, transcripts and the
//! plan thread, keyed by company and sim ids.
//!
//! The trait speaks `serde_json::Value` and strings so that a JS bridge
//! (`crates/orchestrator-wasm`, over the browser's CompanyStore) can implement
//! it without sharing Rust types.
//! The shapes are [`BriefRecord`], [`ArtifactRecord`], [`StageRow`] and the
//! plan post shape documented on [`Store::append_post`].

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use agents::article::{
    ArticleParts, Closing, HeroOption, Outline, SectionBlock, SectionDraft, SectionId,
    SectionedReview,
};
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
    /// The writer and editor as the standup saw them (persona, role). Later
    /// jobs may carry only the staff member doing the work (the sim staffs a
    /// draft with its writer, a review with its editor); the other one's
    /// persona comes from here.
    #[serde(default)]
    pub staff: Vec<crate::StaffRef>,
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
    /// What the writer wrote, part by part (ADR-0058): a revision rewrites
    /// only the parts the editor names and assembles the rest unchanged.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parts: Option<StoredParts>,
    /// The latest review with its issues tagged by part; `review` is its
    /// untagged form.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sectioned_review: Option<SectionedReview>,
    /// The id of the latest job of each kind (`draft`, `review`) that worked
    /// on the item, recorded when it starts: a retried phase (a new job id)
    /// adopts the stages its predecessor stored ([`Store::get_stage`]).
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub last_job: BTreeMap<String, u64>,
    /// The model that wrote the committed draft (the backend's
    /// `Llm::model_id`): the squash commit's `Model` trailer names it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
}

impl ArtifactRecord {
    /// The hero image of a draft that is not merged yet, as the media id and
    /// the URL: what another article's hero shortlist must leave out
    /// (`docs/design/mvp-pipeline.md` §3, "Hero selection").
    pub fn hero_in_flight(&self) -> Option<[String; 2]> {
        if self.merged_sha.is_some() || self.pr_number.is_none() {
            return None;
        }
        self.parts
            .as_ref()
            .map(|p| [p.hero.media_id.clone(), p.hero.url.clone()])
    }
}

/// One part of an article as the artifact record keeps it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StoredSection {
    /// `intro`, `s1`, …
    pub id: SectionId,
    /// The outline's heading (empty for the intro).
    pub heading: String,
    pub blocks: Vec<SectionBlock>,
    /// What later parts and the editor's summary are told about it.
    pub digest: String,
    pub words: u32,
}

/// The parts of an article (`ArtifactRecord.parts`): the outline, the intro
/// and sections, the closing, the chosen hero and the shortlists the outline
/// chose from (so a revision assembles the same page around a changed part,
/// whatever the site's indexes say by then).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StoredParts {
    pub outline: Outline,
    /// The intro first, then `s1`…`sN`.
    pub sections: Vec<StoredSection>,
    pub closing: Closing,
    pub hero: HeroOption,
    pub context: crate::article::ArticleContext,
}

impl StoredParts {
    /// The record of `parts` (digests and word counts computed here).
    pub fn new(
        parts: &ArticleParts,
        hero: HeroOption,
        context: crate::article::ArticleContext,
    ) -> Self {
        let mut sections = vec![StoredSection {
            id: SectionId::Intro,
            heading: String::new(),
            blocks: parts.intro.blocks.clone(),
            digest: agents::article_prompts::digest_of(
                &parts.outline,
                SectionId::Intro,
                &parts.intro,
            ),
            words: parts.intro.words(),
        }];
        for (i, (draft, outline)) in parts
            .sections
            .iter()
            .zip(&parts.outline.sections)
            .enumerate()
        {
            let id = SectionId::Section(u8::try_from(i + 1).unwrap_or(u8::MAX));
            sections.push(StoredSection {
                id,
                heading: outline.heading.clone(),
                blocks: draft.blocks.clone(),
                digest: agents::article_prompts::digest_of(&parts.outline, id, draft),
                words: draft.words(),
            });
        }
        Self {
            outline: parts.outline.clone(),
            sections,
            closing: parts.closing.clone(),
            hero,
            context,
        }
    }

    /// Back to the parts the page is assembled from.
    pub fn to_parts(&self) -> ArticleParts {
        let draft = |s: &StoredSection| SectionDraft {
            blocks: s.blocks.clone(),
        };
        let intro = self
            .sections
            .iter()
            .find(|s| s.id == SectionId::Intro)
            .map(draft)
            .unwrap_or(SectionDraft { blocks: Vec::new() });
        ArticleParts {
            outline: self.outline.clone(),
            intro,
            sections: self
                .sections
                .iter()
                .filter(|s| matches!(s.id, SectionId::Section(_)))
                .map(draft)
                .collect(),
            closing: self.closing.clone(),
        }
    }
}

/// A stored stage result ([`Store::put_stage`]): the input hash it was
/// computed from and its value.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StageRow {
    pub input_hash: String,
    pub value: Value,
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

    /// Every work item's [`ArtifactRecord`] JSON, as `(work_item, record)`:
    /// the Draft job leaves out the heroes of the company's other open
    /// articles ([`ArtifactRecord::hero_in_flight`]).
    async fn artifacts(&self, company: &str) -> Result<Vec<(String, Value)>, StoreError>;

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
    /// `{type, author, to?, text, payload, dedupe?, job_id?}` with `type` one
    /// of [`POST_TYPES`]; the store adds `id` and `item` (and, if it knows
    /// the game clock, `day`/`minute`). A post with a `dedupe` key that the
    /// company already has is not written again: the existing post's id is
    /// returned (a re-run job never posts twice).
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

    /// A stage result of a job (ADR-0058 decision 7), keyed
    /// `(company, job_id, stage, index)`.
    async fn get_stage(
        &self,
        company: &str,
        job_id: u64,
        stage: &str,
        index: u32,
    ) -> Result<Option<StageRow>, StoreError>;

    /// Stores a stage result unless the key has one: the first write wins,
    /// and the stored row is returned.
    async fn put_stage(
        &self,
        company: &str,
        job_id: u64,
        stage: &str,
        index: u32,
        row: StageRow,
    ) -> Result<StageRow, StoreError>;
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
            async fn artifacts(&self, c: &str) -> Result<Vec<(String, Value)>, StoreError> {
                (**self).artifacts(c).await
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
            async fn get_stage(
                &self,
                c: &str,
                j: u64,
                s: &str,
                i: u32,
            ) -> Result<Option<StageRow>, StoreError> {
                (**self).get_stage(c, j, s, i).await
            }
            async fn put_stage(
                &self,
                c: &str,
                j: u64,
                s: &str,
                i: u32,
                r: StageRow,
            ) -> Result<StageRow, StoreError> {
                (**self).put_stage(c, j, s, i, r).await
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
    /// dedupe key → post id
    dedupe: BTreeMap<String, String>,
    /// (job_id, stage, index) → row
    stages: BTreeMap<(u64, String, u32), StageRow>,
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

    /// Stage keys of a company, `(job_id, stage, index)` in order.
    pub fn stages(&self, company: &str) -> Vec<(u64, String, u32)> {
        self.with(company, |c, _| c.stages.keys().cloned().collect())
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

    async fn artifacts(&self, company: &str) -> Result<Vec<(String, Value)>, StoreError> {
        Ok(self.with(company, |c, _| {
            c.artifacts
                .iter()
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect()
        }))
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
        let dedupe = obj.get("dedupe").and_then(Value::as_str).map(String::from);
        Ok(self.with(company, |c, next| {
            if let Some(id) = dedupe.as_ref().and_then(|k| c.dedupe.get(k)) {
                return id.clone();
            }
            *next += 1;
            let id = format!("post-{next}");
            obj.insert("id".into(), json!(id));
            obj.insert("item".into(), json!(item));
            if let Some(k) = dedupe {
                c.dedupe.insert(k, id.clone());
            }
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

    async fn get_stage(
        &self,
        company: &str,
        job_id: u64,
        stage: &str,
        index: u32,
    ) -> Result<Option<StageRow>, StoreError> {
        Ok(self.with(company, |c, _| {
            c.stages.get(&(job_id, stage.to_string(), index)).cloned()
        }))
    }

    async fn put_stage(
        &self,
        company: &str,
        job_id: u64,
        stage: &str,
        index: u32,
        row: StageRow,
    ) -> Result<StageRow, StoreError> {
        Ok(self.with(company, |c, _| {
            c.stages
                .entry((job_id, stage.to_string(), index))
                .or_insert(row)
                .clone()
        }))
    }
}
