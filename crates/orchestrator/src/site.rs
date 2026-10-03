//! The site binding from JSON, and the site's knowledge pack in it
//! (ADR-0061, increment K2; `docs/design/mvp-pipeline.md` section 3).
//!
//! The browser and the runner pass the binding as JSON:
//!
//! ```json
//! { "site_id": "cinqueterre.travel", "brand_name": "Cinque Terre Dispatch",
//!   "language": "en", "quality_bar": 7, "simulate_deploy": false, "standup_max_turns": 4,
//!   "knowledge_pack": "<the pack JSON text of GET /api/gateway/knowledge>",
//!   "style_guide": { ... }, "writer_prompt": { ... },
//!   "llm_profile": "local" | "fake" | { "context_tokens": 16384, "reasoning_tokens": 2048, "chars_per_token": 3 },
//!   "review_single_tokens": 3000, "seo_suffix": "The Dispatch" }
//! ```
//!
//! `llm_profile` is the model's budget for the staged jobs (ADR-0058,
//! default `local`); `review_single_tokens` the longest review read in one
//! call ([`crate::REVIEW_SINGLE_TOKENS`]); `seo_suffix` what follows `" | "`
//! in an article's `seo.title` (default: the brand name).
//!
//! `knowledge_pack` (JSON text, or the pack object) is the site at one
//! commit: it is loaded with [`knowledge::pack::load`] into the binding's
//! [`SiteKnowledge`], and the binding's style guide and writer prompt are the
//! site's own `content/config/style-guide.json` and `writer-prompt.json` from
//! it. `style_guide` and `writer_prompt` are the fallback for a binding
//! without a pack (tests, the orchestrator harness) or a site without those
//! files; with neither, the style guide is empty (no banned phrases, no
//! voice) and the writer gets no site layer beyond the house style.

use std::sync::Arc;

use agents::article_prompts::LlmProfile;
use agents::prompts::SiteContext;
use agents::StyleGuide;
use knowledge::pack::{self, Pack, BLOG_INDEX_PATH};
use knowledge::KnowledgeBase;
use serde::Serialize;
use serde_json::{json, Value};

use crate::article::{site_validator, site_validator_v2};
use crate::run::SiteBinding;

/// The site's house style, carried by the pack.
pub const STYLE_GUIDE_PATH: &str = "content/config/style-guide.json";
/// The site's writer-prompt overrides, carried by the pack.
pub const WRITER_PROMPT_PATH: &str = "content/config/writer-prompt.json";

/// Where a binding's style guide or writer prompt came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ConfigSource {
    /// The site's own file, from the knowledge pack.
    Pack,
    /// The binding JSON's `style_guide` / `writer_prompt` (tests, the harness).
    Binding,
    /// Neither: the empty style guide, or no writer-prompt layer.
    Absent,
}

/// One site commit, loaded: what the staged Draft job needs to stay inside
/// the closed world (rule 5).
#[derive(Debug, Clone)]
pub struct SiteKnowledge {
    /// The site commit the pack was built from (the knowledge route's ETag).
    pub commit: String,
    /// Entity, media and page indexes ([`knowledge::pack::load`]): what
    /// [`crate::article_context`] and [`crate::site_validator_v2`] take.
    pub kb: Arc<KnowledgeBase>,
    /// `content/pages/blog-index.json`, parsed, if the site has one: the
    /// `blog_index` argument of [`crate::article_context`].
    pub blog_index: Option<Value>,
    /// The pack itself, for the other carried files (content calendar,
    /// linking policy, media guidelines).
    pub pack: Arc<Pack>,
}

impl SiteKnowledge {
    /// Loads a pack. Fails if a carried index is broken.
    pub fn from_pack(pack: Pack) -> Result<Self, String> {
        let kb = pack::load(&pack).map_err(|e| format!("knowledge pack: {e}"))?;
        let blog_index = pack
            .file_json(BLOG_INDEX_PATH)
            .map_err(|e| format!("knowledge pack: {e}"))?;
        Ok(Self {
            commit: pack.commit.clone(),
            kb: Arc::new(kb),
            blog_index,
            pack: Arc::new(pack),
        })
    }

    /// Loads a pack from its JSON text (`Pack::to_json`).
    pub fn from_json(text: &str) -> Result<Self, String> {
        Self::from_pack(Pack::from_json(text).map_err(|e| e.to_string())?)
    }

    /// A carried file parsed as JSON; `None` when the site does not have it.
    pub fn file_json(&self, path: &str) -> Result<Option<Value>, String> {
        self.pack
            .file_json(path)
            .map_err(|e| format!("knowledge pack: {e}"))
    }
}

/// The value of `key`, unless it is absent or `null`.
fn present<'a>(v: &'a Value, key: &str) -> Option<&'a Value> {
    v.get(key).filter(|x| !x.is_null())
}

impl SiteBinding {
    /// The binding of the module docs. Errors name the field.
    pub fn from_json(v: &Value) -> Result<SiteBinding, String> {
        let text = |k: &str| -> Result<String, String> {
            v.get(k)
                .and_then(Value::as_str)
                .map(String::from)
                .ok_or_else(|| format!("site.{k} (string) is required"))
        };
        let site_id = text("site_id")?;
        let brand_name = text("brand_name")?;

        let knowledge = match present(v, "knowledge_pack") {
            None => None,
            Some(Value::String(t)) => Some(SiteKnowledge::from_json(t)?),
            Some(obj @ Value::Object(_)) => Some(SiteKnowledge::from_pack(
                serde_json::from_value(obj.clone()).map_err(|e| format!("knowledge pack: {e}"))?,
            )?),
            Some(_) => {
                return Err("site.knowledge_pack must be the pack JSON (text or object)".into())
            }
        };

        let from_pack = |path: &str| -> Result<Option<Value>, String> {
            match &knowledge {
                Some(k) => k.file_json(path),
                None => Ok(None),
            }
        };
        let (style, style_source) = match (from_pack(STYLE_GUIDE_PATH)?, present(v, "style_guide"))
        {
            (Some(doc), _) => (
                StyleGuide::from_json_str(&doc.to_string())
                    .map_err(|e| format!("knowledge pack {STYLE_GUIDE_PATH}: {e}"))?,
                ConfigSource::Pack,
            ),
            (None, Some(doc)) => (
                StyleGuide::from_json_str(&doc.to_string())
                    .map_err(|e| format!("site.style_guide: {e}"))?,
                ConfigSource::Binding,
            ),
            (None, None) => (StyleGuide::default(), ConfigSource::Absent),
        };
        let (writer_prompt, writer_prompt_source) =
            match (from_pack(WRITER_PROMPT_PATH)?, present(v, "writer_prompt")) {
                (Some(doc), _) => (Some(doc), ConfigSource::Pack),
                (None, Some(doc)) => (Some(doc.clone()), ConfigSource::Binding),
                (None, None) => (None, ConfigSource::Absent),
            };
        let context = SiteContext::new(&site_id, style, writer_prompt.as_ref()).map_err(|e| {
            let what = match writer_prompt_source {
                ConfigSource::Pack => format!("knowledge pack {WRITER_PROMPT_PATH}"),
                _ => "site context".to_string(),
            };
            format!("{what}: {e}")
        })?;

        let llm = match present(v, "llm_profile") {
            None => LlmProfile::default(),
            Some(Value::String(name)) => LlmProfile::preset(name)
                .ok_or_else(|| format!("site.llm_profile {name:?} is not `local` or `fake`"))?,
            Some(obj) => {
                serde_json::from_value(obj.clone()).map_err(|e| format!("site.llm_profile: {e}"))?
            }
        };
        let article_guidance = writer_prompt
            .as_ref()
            .and_then(|w| w.pointer("/page_prompts/blog_article/writing_prompt"))
            .and_then(Value::as_str)
            .map(String::from);
        let validator_v2 = knowledge
            .as_ref()
            .map(|k| site_validator_v2(&context, k.kb.clone()));

        let seo_suffix = v
            .get("seo_suffix")
            .and_then(Value::as_str)
            .unwrap_or(&brand_name)
            .to_string();

        let small = |k: &str, d: u64| v.get(k).and_then(Value::as_u64).unwrap_or(d);
        Ok(SiteBinding {
            brand_name,
            language: v
                .get("language")
                .and_then(Value::as_str)
                .unwrap_or("en")
                .to_string(),
            validator: site_validator(&context),
            context,
            site_id,
            quality_bar: u8::try_from(small("quality_bar", 7)).map_err(|e| e.to_string())?,
            simulate_deploy: v
                .get("simulate_deploy")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            standup_max_turns: u32::try_from(small("standup_max_turns", 4))
                .map_err(|e| e.to_string())?,
            validator_v2,
            llm,
            review_single_tokens: u32::try_from(small(
                "review_single_tokens",
                u64::from(crate::REVIEW_SINGLE_TOKENS),
            ))
            .map_err(|e| e.to_string())?,
            seo_suffix,
            article_guidance,
            knowledge,
            style_source,
            writer_prompt_source,
        })
    }

    /// The loaded closed world, when the binding has a pack.
    pub fn kb(&self) -> Option<&Arc<KnowledgeBase>> {
        self.knowledge.as_ref().map(|k| &k.kb)
    }

    /// What the binding was built from, for diagnostics (the browser's
    /// session hook): `{site_id, commit, pages, media, entities,
    /// style_guide, writer_prompt}`; `commit` and the counts are `null`
    /// without a pack.
    pub fn summary(&self) -> Value {
        let k = self.knowledge.as_ref();
        json!({
            "site_id": self.site_id,
            "commit": k.map(|k| k.commit.as_str()),
            "pages": k.map(|k| k.kb.pages.len()),
            "media": k.map(|k| k.kb.media.len()),
            "entities": k.map(|k| k.kb.entities.entities.len()),
            "blog_index": k.map(|k| k.blog_index.is_some()),
            "style_guide": self.style_source,
            "writer_prompt": self.writer_prompt_source,
        })
    }
}
