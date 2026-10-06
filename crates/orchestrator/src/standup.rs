//! The standup as a pitch round (ADR-0062; `docs/design/mvp-pipeline.md`
//! section 2, increments P4 and U5).
//!
//! ```text
//! frame#0       no model: the cap, the free writers and the context pack, fixed by the first run
//!   cap 0  ─►   one system transcript line, MeetingOutcome{briefs: []}, no model call
//! opening#0     the moderator opens over the context pack (free text)
//! pitch#1…N     one structured pitch per free writer, in staff-id order:
//!               {say, title, angle, keywords}; `say` is the speech bubble
//! commission#0  {commission: [{pitch: P1…, target_words}], decisions, escalations}
//!   ─► briefs from the chosen pitches (the assignee is always the pitcher) ─► MeetingOutcome
//! ```
//!
//! - **Cap** ([`agents::meetings::standup_cap`]): the free writers and the
//!   room under the work-in-progress limit come from the sim (the host passes
//!   them in [`StandupContext`]); throughput is host policy (model minutes per
//!   article from the activity record, 1 until measured).
//! - **Context pack** ([`context_pack`], at most [`CONTEXT_PACK_TOKENS`]):
//!   the cap and the desk, items in flight, the last published titles and
//!   counts per category, the season's unpublished calendar topics (by the
//!   wall-clock date the host passes), the least covered places and the place
//!   list; the lowest-priority section is dropped first.
//! - **De-duplication**: each pitch is checked on arrival against the site's
//!   article paths, items in flight and earlier pitches by slug, and by
//!   title-and-keyword overlap ([`TOPIC_OVERLAP`]) against their titles. A
//!   duplicate gets one repair turn naming the conflict ([`PITCH_REPAIRS`]),
//!   then the writer is skipped.
//! - **Repair, not failure**: a truncated opening is cut at its last
//!   sentence (retried once with "two sentences" when nothing is left); a
//!   truncated pitch is retried once the same way; an invalid pitch is
//!   skipped; a failed commissioning call commissions the first `cap` pitches
//!   at [`agents::meetings::DEFAULT_TARGET_WORDS`].
//! - **Total failure is visible**: no valid pitch sends `JobFailed` (the sim
//!   raises `StandupFailed`).
//! - **Turns** are transcript rows `(job, seq)`, seq from 0 in speaking
//!   order. After a row is written its `turn` progress event follows
//!   (`TurnFinished{job_id, seq, speaker, chars}`), which the browser plays
//!   as an `Utterance` command; the words never enter the sim (rule 2).
//! - **Stage store**: every stage is stored under `(company, job, stage,
//!   index)`; a re-run job (a reload) repeats no completed call and replays
//!   no turn. The frame is reused whatever the host says the second time, so
//!   the stored prompts match.
//! - Decisions and escalations are kept as a `minutes` post on the meeting's
//!   thread.

use std::collections::BTreeSet;

use agents::house_style::contains_phrase;
use agents::llm::{structured_with_repair, Repaired};
use agents::meetings::{
    commission_prompt, commission_schema, opening_prompt, pitch_alias, pitch_check_prompt,
    pitch_check_schema, pitch_prompt, pitch_schema, standup_cap, trim_to_sentence,
    CommissionDecision, Pitch, PitchLine, CAP_LABEL, COMMISSION_ANSWER, DEFAULT_TARGET_WORDS,
    MAX_TARGET_WORDS, MIN_TARGET_WORDS, MODEL_MINUTES_PER_DAY, OPENING_ANSWER, PITCH_ANSWER,
    PITCH_REASONING, TWO_SENTENCES,
};
use agents::prompts::{templates, Vars};
use agents::{strip_reasoning, Brief, CallProfile, LlmError, LlmMessage, LlmRequest, Role};
use knowledge::EntityKind;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::article::{bare_title, brief_ref_for, slugify, title_tokens};
use crate::gateway::Gateway;
use crate::run::{corrupt, invalid, persona, role_of, Orchestrator, Result};
use crate::staged::stage_hash;
use crate::store::{BriefRecord, StageRow, Store};
use crate::{BriefOut, JobFailure, JobRequest, Outcome, ProgressState, SiteBinding, StaffRef};

/// The context pack's budget, estimated tokens.
pub const CONTEXT_PACK_TOKENS: u32 = 1200;
/// Repair turns a pitch gets (a duplicate, or an answer that misses its
/// schema), before the writer is skipped.
pub const PITCH_REPAIRS: u32 = 1;
/// Share of the smaller topic's words two topics must share (and at least
/// two words) to be the same topic.
pub const TOPIC_OVERLAP: f64 = 0.6;
/// Published titles the pack lists.
const PUBLISHED_TITLES: usize = 12;
/// Calendar topics the pack lists.
const CALENDAR_TOPICS: usize = 6;
/// Least covered places the pack names.
const UNDER_COVERED: usize = 3;
/// The longest opening kept, characters (cut at a sentence).
const OPENING_CHARS: usize = 600;
/// The site's editorial calendar, carried by the knowledge pack.
pub(crate) const CALENDAR_PATH: &str = "content/config/content-calendar.json";
/// Where the site keeps its articles.
const BLOG_DIR: &str = "content/pages/blog/";

// ---------------------------------------------------------------- what the host says

/// What the host adds to a standup's request (`JobRequest::context`):
///
/// ```json
/// { "today": "2026-10-03",
///   "wip": {"limit": 3, "open": 1, "room": 2, "awaiting_approval": 0,
///           "free_writers": ["staff-1", "staff-2"]},
///   "in_flight": [{"id": "work-item-1", "status": "in-review", "title": "…"}],
///   "minutes_per_article": 7.5, "model_minutes_per_day": 45 }
/// ```
///
/// Every field may be absent: no `wip` leaves the room to the sim, no
/// `free_writers` makes every writer free, no `minutes_per_article` counts
/// one article a day, no `today` leaves out the calendar.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct StandupContext {
    /// The wall-clock date, `YYYY-MM-DD` (seasons come from wall time,
    /// ADR-0048; never the sim's clock).
    #[serde(default)]
    pub today: Option<String>,
    #[serde(default)]
    pub wip: Option<Wip>,
    #[serde(default)]
    pub in_flight: Vec<InFlight>,
    /// Measured model minutes of one article (draft and review), if any.
    #[serde(default)]
    pub minutes_per_article: Option<f64>,
    /// Model minutes a game day may spend; default
    /// [`agents::meetings::MODEL_MINUTES_PER_DAY`].
    #[serde(default)]
    pub model_minutes_per_day: Option<f64>,
}

/// The sim's work in progress for the project (`Sim.plan_json().wip`).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Wip {
    #[serde(default)]
    pub limit: Option<usize>,
    #[serde(default)]
    pub open: Option<usize>,
    #[serde(default)]
    pub room: Option<usize>,
    #[serde(default)]
    pub awaiting_approval: Option<usize>,
    /// Staff ids free to take an article.
    #[serde(default)]
    pub free_writers: Option<Vec<String>>,
}

/// An open work item and its status (title from the plan store, if known).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct InFlight {
    pub id: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub title: Option<String>,
}

impl StandupContext {
    /// The context of a request (`null`: none). A malformed one is an
    /// invalid job: the host is wrong, and guessing would hide it.
    pub fn of(req: &JobRequest) -> Result<Self> {
        if req.context.is_null() {
            return Ok(Self::default());
        }
        serde_json::from_value(req.context.clone())
            .map_err(|e| invalid(format!("standup context: {e}")))
    }

    /// Room under the work-in-progress limit, if the host said.
    pub fn room(&self) -> Option<usize> {
        let w = self.wip.as_ref()?;
        w.room
            .or_else(|| Some(w.limit?.saturating_sub(w.open.unwrap_or(0))))
    }
}

// ---------------------------------------------------------------- the context pack

/// The standup's context pack (design section 2): sections in priority
/// order, within [`CONTEXT_PACK_TOKENS`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ContextPack {
    pub text: String,
    /// Estimated tokens of `text` ([`agents::article_prompts::LlmProfile::tokens`]).
    pub tokens: u32,
    /// The sections kept, highest priority first.
    pub sections: Vec<String>,
    /// The sections dropped to fit, lowest priority first.
    pub dropped: Vec<String>,
}

/// One published article as the pack and the de-duplication see it.
#[derive(Debug, Clone)]
pub(crate) struct Published {
    pub(crate) title: String,
    pub(crate) category: Option<String>,
    pub(crate) slug: String,
}

/// `Oct 15, 2023` or `2023-10-15` as `(year, month, day)`; unknown: zeros.
fn story_date(s: &str) -> (u32, u32, u32) {
    const MONTHS: [&str; 12] = [
        "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec",
    ];
    let num = |t: &str| t.trim().parse::<u32>().unwrap_or(0);
    let parts: Vec<&str> = s.split('-').collect();
    if parts.len() == 3 && parts[0].len() == 4 {
        return (num(parts[0]), num(parts[1]), num(parts[2]));
    }
    let words: Vec<&str> = s
        .split(|c: char| c.is_whitespace() || c == ',')
        .filter(|w| !w.is_empty())
        .collect();
    match words.as_slice() {
        [m, d, y, ..] => {
            let lower = m.to_lowercase();
            let month = MONTHS
                .iter()
                .position(|x| lower.starts_with(x))
                .map_or(0, |i| u32::try_from(i + 1).unwrap_or(0));
            (num(y), month, num(d))
        }
        _ => (0, 0, 0),
    }
}

/// The site's articles, newest first: the blog index's stories by date
/// (then id), then article pages the index does not list yet.
pub(crate) fn published(site: &SiteBinding) -> Vec<Published> {
    let Some(k) = site.knowledge.as_ref() else {
        return Vec::new();
    };
    let mut stories: Vec<((u32, u32, u32), i64, Published)> = k
        .blog_index
        .as_ref()
        .and_then(|page| page["body"].as_array())
        .into_iter()
        .flatten()
        .filter(|b| b["type"] == "blog-index")
        .filter_map(|b| b["stories"].as_array())
        .flatten()
        .filter_map(|s| {
            let title = s["title"].as_str()?.trim();
            (!title.is_empty()).then(|| {
                (
                    story_date(s["date"].as_str().unwrap_or("")),
                    s["id"].as_i64().unwrap_or(0),
                    Published {
                        title: title.to_string(),
                        category: s["category"].as_str().map(String::from),
                        slug: s["slug"].as_str().unwrap_or("").to_string(),
                    },
                )
            })
        })
        .collect();
    stories.sort_by(|a, b| b.0.cmp(&a.0).then(b.1.cmp(&a.1)));
    let mut out: Vec<Published> = stories.into_iter().map(|(_, _, p)| p).collect();
    let listed: BTreeSet<String> = out.iter().map(|p| p.slug.clone()).collect();
    for page in &k.kb.pages.pages {
        let Some(slug) = page
            .path
            .strip_prefix(BLOG_DIR)
            .and_then(|f| f.strip_suffix(".json"))
        else {
            continue;
        };
        if listed.contains(slug) {
            continue;
        }
        out.push(Published {
            title: bare_title(page.title(&site.language)).to_string(),
            category: None,
            slug: slug.to_string(),
        });
    }
    out
}

/// A calendar topic: its title and keywords.
type Topic = (String, Vec<String>);

/// A valid pitch of the round: its alias, the writer, their name, the pitch.
type Pitched<'a> = (String, &'a StaffRef, String, Pitch);

/// The answer budget of a pitch check (ADR-0068).
pub(crate) const CHECK_ANSWER: u32 = 900;

/// What a pitch check found (ADR-0068), as stored for a re-run.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct PitchCheck {
    /// `Some(false)`: the promise could not be verified; `None`: the check failed.
    pub(crate) verifiable: Option<bool>,
    pub(crate) note: String,
    /// Claims whose source the search returned.
    pub(crate) claims: usize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) error: Option<String>,
}

impl PitchCheck {
    /// A pitch counts as verifiable only with at least one claim whose source the search returned.
    pub(crate) fn from_answer(value: &Value, sources: &[String]) -> Self {
        let said = value["verifiable"].as_bool().unwrap_or(false);
        let claims = agents::research::dossier_from(
            &json!({"claims": value["claims"].clone()}),
            sources,
            &[],
        )
        .added
        .len();
        Self {
            verifiable: Some(said && claims > 0),
            note: value["note"].as_str().unwrap_or("").trim().to_string(),
            claims,
            error: None,
        }
    }
}

/// Slugs of the site's article files (`content/pages/blog/<slug>.json`).
fn article_slugs(site: &SiteBinding) -> BTreeSet<String> {
    site.knowledge
        .as_ref()
        .map(|k| {
            k.kb.pages
                .pages
                .iter()
                .filter_map(|p| p.path.strip_prefix(BLOG_DIR)?.strip_suffix(".json"))
                .map(String::from)
                .collect()
        })
        .unwrap_or_default()
}

/// Two topics are the same when they share at least two words and at least
/// [`TOPIC_OVERLAP`] of the smaller one's words.
#[allow(clippy::float_arithmetic)]
fn same_topic(a: &BTreeSet<String>, b: &BTreeSet<String>) -> bool {
    let shared = a.intersection(b).count();
    let smaller = a.len().min(b.len());
    #[allow(clippy::cast_precision_loss)] // word counts
    let share = if smaller == 0 {
        0.0
    } else {
        shared as f64 / smaller as f64
    };
    shared >= 2 && share >= TOPIC_OVERLAP
}

/// The season `today` (`YYYY-MM-DD`) falls in: the calendar's own publish
/// windows (`MM-DD`, wrapping over new year), else by month.
pub(crate) fn season<'v>(
    seasons: &'v serde_json::Map<String, Value>,
    today: &str,
) -> Option<&'v Value> {
    let md = today.get(5..10)?;
    let in_window = |s: &Value| {
        let start = s.pointer("/publish_window/start")?.as_str()?;
        let end = s.pointer("/publish_window/end")?.as_str()?;
        Some(if start <= end {
            (start..=end).contains(&md)
        } else {
            md >= start || md <= end
        })
    };
    if let Some(s) = seasons.values().find(|s| in_window(s) == Some(true)) {
        return Some(s);
    }
    let names: &[&str] = match today.get(5..7)? {
        "03" | "04" | "05" => &["spring"],
        "06" | "07" | "08" => &["summer"],
        "09" | "10" | "11" => &["autumn", "fall"],
        _ => &["winter"],
    };
    names.iter().find_map(|n| seasons.get(*n))
}

/// Up to [`CALENDAR_TOPICS`] calendar topics of the season that are not
/// published or in flight: `(season name, [(title, keywords)])`.
fn calendar_topics(
    site: &SiteBinding,
    today: Option<&str>,
    taken: &Taken,
) -> Option<(String, Vec<Topic>)> {
    let k = site.knowledge.as_ref()?;
    let calendar = k.file_json(CALENDAR_PATH).ok()??;
    let seasons = calendar["seasonal_content"].as_object()?;
    let s = season(seasons, today?)?;
    let name = s["season_name"]
        .as_str()
        .unwrap_or("the season")
        .to_string();
    let topics: Vec<(String, Vec<String>)> = s["topics"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|t| {
            let title = t["title"].as_str()?.trim().to_string();
            let keywords: Vec<String> = t["keywords"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .map(String::from)
                .collect();
            let slug = t["slug"]
                .as_str()
                .map_or_else(|| slugify(&title), String::from);
            let probe = Pitch {
                say: String::new(),
                title: title.clone(),
                angle: String::new(),
                keywords: keywords.clone(),
            };
            let fresh = !taken.paths.contains(&slug) && taken.conflict(&probe).is_none();
            fresh.then_some((title, keywords))
        })
        .take(CALENDAR_TOPICS)
        .collect();
    (!topics.is_empty()).then_some((name, topics))
}

/// The pack for a standup with `cap` commissions (design section 2).
pub fn context_pack(site: &SiteBinding, ctx: &StandupContext, cap: usize) -> ContextPack {
    let published = published(site);
    let taken = Taken::new(site, ctx, &published);
    let lang = site.language.as_str();
    // (name, text), highest priority first; the first is never dropped.
    let mut sections: Vec<(&'static str, String)> = Vec::new();

    let mut today = format!("## Today\n{CAP_LABEL}{cap}");
    if let Some(w) = ctx.wip.as_ref() {
        if let (Some(open), Some(limit)) = (w.open, w.limit) {
            today.push_str(&format!(
                "\nDesk: {open} of {limit} articles open, {} waiting for the CEO.",
                w.awaiting_approval.unwrap_or(0)
            ));
        }
    }
    if let Some(d) = ctx.today.as_deref() {
        today.push_str(&format!("\nDate: {d}"));
    }
    sections.push(("today", today));

    if !ctx.in_flight.is_empty() {
        let lines: Vec<String> = ctx
            .in_flight
            .iter()
            .map(
                |i| match i.title.as_deref().filter(|t| !t.trim().is_empty()) {
                    Some(t) => format!("- «{}» ({})", t.trim(), i.status),
                    None => format!("- {} ({})", i.id, i.status),
                },
            )
            .collect();
        sections.push(("in_flight", format!("## In flight\n{}", lines.join("\n"))));
    }

    if !published.is_empty() {
        let mut text = String::from("## Published (newest first)");
        for p in published.iter().take(PUBLISHED_TITLES) {
            match p.category.as_deref() {
                Some(c) => text.push_str(&format!("\n- «{}» ({c})", p.title)),
                None => text.push_str(&format!("\n- «{}»", p.title)),
            }
        }
        let mut counts: Vec<(String, usize)> = Vec::new();
        for c in published.iter().filter_map(|p| p.category.clone()) {
            match counts.iter_mut().find(|(n, _)| *n == c) {
                Some((_, n)) => *n += 1,
                None => counts.push((c, 1)),
            }
        }
        counts.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
        if !counts.is_empty() {
            let by: Vec<String> = counts.iter().map(|(c, n)| format!("{c} {n}")).collect();
            text.push_str(&format!(
                "\nAll {} articles by category: {}",
                published.len(),
                by.join(", ")
            ));
        }
        sections.push(("published", text));
    }

    if let Some((season, topics)) = calendar_topics(site, ctx.today.as_deref(), &taken) {
        let lines: Vec<String> = topics
            .iter()
            .map(|(t, k)| {
                if k.is_empty() {
                    format!("- «{t}»")
                } else {
                    format!("- «{t}» — keywords: {}", k.join(", "))
                }
            })
            .collect();
        sections.push((
            "calendar",
            format!(
                "## Calendar topics for {season} (not yet published)\n{}",
                lines.join("\n")
            ),
        ));
    }

    if let Some(k) = site.knowledge.as_ref() {
        let titles: Vec<String> = published.iter().map(|p| p.title.to_lowercase()).collect();
        let places: Vec<(usize, &knowledge::Entity)> =
            k.kb.entities
                .entities
                .iter()
                .filter(|e| e.kind != EntityKind::Category)
                .map(|e| {
                    let mut names = vec![e.name.get(lang).to_lowercase()];
                    names.extend(e.aliases.iter().map(|a| a.to_lowercase()));
                    let n = titles
                        .iter()
                        .filter(|t| names.iter().any(|n| contains_phrase(t, n)))
                        .count();
                    (n, e)
                })
                .collect();
        if !places.is_empty() {
            let mut least: Vec<&(usize, &knowledge::Entity)> = places.iter().collect();
            least.sort_by_key(|(n, _)| *n);
            let least: Vec<String> = least
                .iter()
                .take(UNDER_COVERED)
                .map(|(n, e)| {
                    let s = if *n == 1 { "" } else { "s" };
                    format!("{} ({n} article{s})", e.name.get(lang))
                })
                .collect();
            let all: Vec<&str> = places.iter().map(|(_, e)| e.name.get(lang)).collect();
            sections.push((
                "places",
                format!(
                    "## Places\nLeast covered: {}\nAll places: {}",
                    least.join(", "),
                    all.join(", ")
                ),
            ));
        }
    }

    let tokens = |s: &[(&str, String)]| {
        site.llm.tokens(
            &s.iter()
                .map(|(_, t)| t.as_str())
                .collect::<Vec<_>>()
                .join("\n\n"),
        )
    };
    let mut dropped = Vec::new();
    while sections.len() > 1 && tokens(&sections[..]) > CONTEXT_PACK_TOKENS {
        if let Some((name, _)) = sections.pop() {
            dropped.push(name.to_string());
        }
    }
    let text = sections
        .iter()
        .map(|(_, t)| t.as_str())
        .collect::<Vec<_>>()
        .join("\n\n");
    ContextPack {
        tokens: site.llm.tokens(&text),
        text,
        sections: sections.iter().map(|(n, _)| (*n).to_string()).collect(),
        dropped,
    }
}

// ---------------------------------------------------------------- de-duplication

/// A topic someone already has.
#[derive(Debug, Clone)]
struct Seen {
    title: String,
    slug: String,
    words: BTreeSet<String>,
    /// `published`, `in flight`, `pitched by Giulia`.
    whose: String,
}

/// What a pitch must not repeat.
#[derive(Debug, Clone, Default)]
pub(crate) struct Taken {
    /// Slugs of the site's article files.
    pub(crate) paths: BTreeSet<String>,
    seen: Vec<Seen>,
}

fn topic_words(title: &str, keywords: &[String]) -> BTreeSet<String> {
    title_tokens(&format!("{title} {}", keywords.join(" ")))
}

impl Taken {
    pub(crate) fn new(site: &SiteBinding, ctx: &StandupContext, published: &[Published]) -> Self {
        let mut seen: Vec<Seen> = published
            .iter()
            .map(|p| Seen {
                title: p.title.clone(),
                slug: if p.slug.is_empty() {
                    slugify(&p.title)
                } else {
                    p.slug.clone()
                },
                words: title_tokens(&p.title),
                whose: "published".into(),
            })
            .collect();
        for i in &ctx.in_flight {
            if let Some(t) = i.title.as_deref().filter(|t| !t.trim().is_empty()) {
                seen.push(Seen {
                    title: t.trim().to_string(),
                    slug: slugify(t),
                    words: title_tokens(t),
                    whose: "in flight".into(),
                });
            }
        }
        Self {
            paths: article_slugs(site),
            seen,
        }
    }

    pub(crate) fn pitched(&mut self, by: &str, p: &Pitch) {
        self.seen.push(Seen {
            title: p.title.clone(),
            slug: slugify(&p.title),
            words: topic_words(&p.title, &p.keywords),
            whose: format!("pitched by {by}"),
        });
    }

    /// The conflict a pitch runs into, named for the repair turn.
    pub(crate) fn conflict(&self, p: &Pitch) -> Option<String> {
        let slug = slugify(&p.title);
        if slug.is_empty() {
            return Some(format!(
                "The title «{}» has no letters to make a page path from.",
                p.title
            ));
        }
        if self.paths.contains(&slug) {
            return Some(format!(
                "«{}» would be {BLOG_DIR}{slug}.json, which the site already has. Pitch a different article.",
                p.title
            ));
        }
        let words = topic_words(&p.title, &p.keywords);
        self.seen.iter().find_map(|s| {
            if s.slug == slug {
                Some(format!(
                    "«{}» is «{}» again ({}). Pitch a different article.",
                    p.title, s.title, s.whose
                ))
            } else if same_topic(&words, &s.words) {
                Some(format!(
                    "«{}» covers the same ground as «{}» ({}). Pitch a different article.",
                    p.title, s.title, s.whose
                ))
            } else {
                None
            }
        })
    }
}

// ---------------------------------------------------------------- the round

/// The first run's frame (`frame#0`), reused by every re-run.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
struct Frame {
    cap: usize,
    /// Free writers' staff ids, in speaking order.
    writers: Vec<String>,
    pack: ContextPack,
    /// Why nothing can be commissioned (cap 0).
    #[serde(default)]
    why_not: String,
}

/// A stored turn of the round: `{text}` / `{pitch}` / `{skipped, failure}`.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
struct Turn {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pitch: Option<Pitch>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    skipped: Option<String>,
    /// `model`, `invalid-output` or `infrastructure`, when skipped.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    failure: Option<String>,
}

/// The stored commissioning stage.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
struct Commissioned {
    decision: CommissionDecision,
    /// The call failed and the first pitches were commissioned.
    fallback: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

pub(crate) fn failure_of(e: &LlmError) -> &'static str {
    match e {
        LlmError::InvalidOutput { .. } => "invalid-output",
        LlmError::Unavailable(_) | LlmError::Backend(_) => "infrastructure",
        LlmError::Refusal { .. } | LlmError::Truncated { .. } => "model",
        LlmError::Timeout(_) => "timeout",
    }
}

/// Staff ids in number order (`staff-2` before `staff-10`).
pub(crate) fn staff_order(id: &str) -> (u64, &str) {
    let n = id
        .rsplit('-')
        .next()
        .and_then(|d| d.parse().ok())
        .unwrap_or(u64::MAX);
    (n, id)
}

fn cut_chars(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_string();
    }
    let cut: String = text.chars().take(max).collect();
    let whole = trim_to_sentence(&cut);
    if whole.is_empty() {
        cut.trim_end().to_string()
    } else {
        whole
    }
}

/// One spoken line of the transcript.
pub(crate) struct Line {
    pub(crate) seq: u32,
    pub(crate) speaker: String,
    pub(crate) text: String,
}

impl<S: Store, G: Gateway> Orchestrator<S, G> {
    /// A stage row of this job, if stored (`hash`: only when it matches).
    pub(crate) async fn recall(
        &self,
        req: &JobRequest,
        stage: &str,
        index: u32,
        hash: Option<&str>,
    ) -> Result<Option<Value>> {
        Ok(self
            .store
            .get_stage(&req.company_id, req.job_id, stage, index)
            .await?
            .filter(|row| hash.is_none_or(|h| row.input_hash == h))
            .map(|row| row.value))
    }

    /// Stores a stage row (first write wins) and returns what is stored.
    pub(crate) async fn remember<T: Serialize + serde::de::DeserializeOwned>(
        &self,
        req: &JobRequest,
        stage: &str,
        index: u32,
        hash: String,
        value: &T,
    ) -> Result<T> {
        let row = StageRow {
            input_hash: hash,
            value: serde_json::to_value(value).map_err(corrupt)?,
        };
        let kept = self
            .store
            .put_stage(&req.company_id, req.job_id, stage, index, row)
            .await?;
        serde_json::from_value(kept.value).map_err(corrupt)
    }

    /// Writes a transcript row; a turn made by this run (`fresh`) is then
    /// reported as `TurnFinished` for the speech bubble.
    pub(crate) async fn spoke(
        &self,
        req: &JobRequest,
        line: &Line,
        who: Option<&StaffRef>,
        fresh: bool,
    ) -> Result<()> {
        self.store
            .append_transcript(
                &req.company_id,
                req.job_id,
                line.seq,
                &line.speaker,
                &line.text,
            )
            .await?;
        if let (true, Some(who)) = (fresh, who) {
            let chars = u32::try_from(line.text.chars().count()).unwrap_or(u32::MAX);
            self.report(
                req,
                Some(who),
                "turn",
                line.seq,
                0,
                ProgressState::Done,
                json!({"seq": line.seq, "speaker": who.id, "chars": chars, "meeting": req.meeting}),
            );
        }
        Ok(())
    }

    fn call_profile(&self, who: &StaffRef, fallback: Role) -> Result<CallProfile> {
        let p = persona(&who.persona)?;
        Ok(CallProfile {
            job: agents::JobKind::Standup,
            role: role_of(&who.role).unwrap_or(fallback),
            seniority: Some(p.seniority),
            staff_id: Some(who.id.clone()),
        })
    }

    pub(crate) fn name_of(who: &StaffRef) -> String {
        persona(&who.persona).map_or_else(|_| who.id.clone(), |p| p.name)
    }

    /// The standup job: a pitch round (module docs).
    pub(crate) async fn standup(&self, req: &JobRequest) -> Result<Vec<Outcome>> {
        let moderator = self
            .find(req, "editor-in-chief")
            .or_else(|| self.find(req, "editor"))
            .ok_or_else(|| invalid("standup without an editor-in-chief or editor"))?;
        let editor = self.find(req, "editor").unwrap_or(moderator);
        let ctx = StandupContext::of(req)?;

        // frame#0: fixed by the first run, whatever the host says later.
        let frame: Frame = match self.recall(req, "frame", 0, None).await? {
            Some(v) => serde_json::from_value(v).map_err(corrupt)?,
            None => {
                let frame = self.frame(req, &ctx);
                let hash = stage_hash(&["frame", &req.context.to_string()]);
                self.remember(req, "frame", 0, hash, &frame).await?
            }
        };
        if frame.cap == 0 {
            let line = Line {
                seq: 0,
                speaker: "system".into(),
                text: format!("No pitches today. {}", frame.why_not),
            };
            self.spoke(req, &line, None, false).await?;
            return Ok(vec![Outcome::MeetingOutcome {
                job_id: req.job_id,
                briefs: vec![],
            }]);
        }
        let writers: Vec<&StaffRef> = frame
            .writers
            .iter()
            .filter_map(|id| req.staff.iter().find(|s| &s.id == id))
            .collect();
        let pack = frame.pack.text.as_str();
        let mod_persona = persona(&moderator.persona)?;
        let mut agenda = Vars::new();
        agenda.insert(
            "agenda".into(),
            json!(format!(
                "Daily standup for {}: each free writer pitches one article; you commission at most {} of them.",
                self.site.brand_name, frame.cap
            )),
        );
        agenda.insert(
            "participants".into(),
            json!(writers
                .iter()
                .map(|s| format!("{} ({}, {})", s.id, Self::name_of(s), s.role))
                .collect::<Vec<_>>()
                .join(", ")),
        );
        agenda.insert("max_turns".into(), json!(writers.len()));
        let mod_system = self.system_prompt(&templates::editor_in_chief(), &mod_persona, agenda)?;
        let mod_call = self.call_profile(moderator, Role::EditorInChief)?;

        let mut lines: Vec<Line> = Vec::new();
        let mut seq = 0u32;

        // opening#0
        let names: Vec<String> = writers.iter().map(|s| Self::name_of(s)).collect();
        let name_refs: Vec<&str> = names.iter().map(String::as_str).collect();
        let user = opening_prompt(pack, &name_refs);
        let request = LlmRequest {
            profile: mod_call.clone(),
            system: vec![mod_system.clone()],
            messages: vec![LlmMessage::user(user.clone())],
            max_tokens: OPENING_ANSWER,
            reasoning_tokens: Some(0),
        };
        let hash = stage_hash(&["opening", &mod_system, &user]);
        let (opening, fresh): (Turn, bool) =
            match self.recall(req, "opening", 0, Some(&hash)).await? {
                Some(v) => {
                    self.report(
                        req,
                        Some(moderator),
                        "opening",
                        0,
                        1,
                        ProgressState::Reused,
                        json!({}),
                    );
                    (serde_json::from_value(v).map_err(corrupt)?, false)
                }
                None => {
                    self.report(
                        req,
                        Some(moderator),
                        "opening",
                        0,
                        1,
                        ProgressState::Started,
                        json!({}),
                    );
                    let turn = self.opening(&request).await;
                    let state = if turn.text.is_some() {
                        ProgressState::Done
                    } else {
                        ProgressState::Failed
                    };
                    self.report(
                        req,
                        Some(moderator),
                        "opening",
                        0,
                        1,
                        state,
                        json!({"skipped": turn.skipped}),
                    );
                    (self.remember(req, "opening", 0, hash, &turn).await?, true)
                }
            };
        if let Some(text) = opening.text.clone() {
            let line = Line {
                seq,
                speaker: moderator.id.clone(),
                text,
            };
            self.spoke(req, &line, Some(moderator), fresh).await?;
            lines.push(line);
            seq += 1;
        }

        // pitch#1…N
        let published = published(&self.site);
        let mut taken = Taken::new(&self.site, &ctx, &published);
        // (alias, writer, name, pitch)
        let mut valid: Vec<Pitched<'_>> = Vec::new();
        let mut failures: Vec<String> = Vec::new();
        let total = u32::try_from(writers.len()).unwrap_or(u32::MAX);
        for (i, writer) in writers.iter().enumerate() {
            let index = u32::try_from(i + 1).unwrap_or(u32::MAX);
            let name = Self::name_of(writer);
            let earlier: Vec<PitchLine<'_>> = valid
                .iter()
                .map(|(alias, w, n, p)| PitchLine {
                    alias,
                    name: n,
                    id: &w.id,
                    pitch: p,
                })
                .collect();
            let user = pitch_prompt(pack, &name, &writer.id, opening.text.as_deref(), &earlier);
            let p = persona(&writer.persona)?;
            let system = self.system_prompt(&templates::meeting_speaker(), &p, Vars::new())?;
            let request = LlmRequest {
                profile: self.call_profile(writer, Role::Writer)?,
                system: vec![system.clone()],
                messages: vec![LlmMessage::user(user.clone())],
                max_tokens: PITCH_ANSWER,
                reasoning_tokens: Some(PITCH_REASONING),
            };
            let schema = pitch_schema();
            let hash = stage_hash(&["pitch", &system, &user, &schema.to_string()]);
            let (turn, fresh): (Turn, bool) =
                match self.recall(req, "pitch", index, Some(&hash)).await? {
                    Some(v) => {
                        self.report(
                            req,
                            Some(writer),
                            "pitch",
                            index,
                            total,
                            ProgressState::Reused,
                            json!({}),
                        );
                        (serde_json::from_value(v).map_err(corrupt)?, false)
                    }
                    None => {
                        self.report(
                            req,
                            Some(writer),
                            "pitch",
                            index,
                            total,
                            ProgressState::Started,
                            json!({}),
                        );
                        let (turn, detail) = self.pitch(&request, &schema, &taken).await;
                        let state = if turn.pitch.is_some() {
                            ProgressState::Done
                        } else {
                            ProgressState::Failed
                        };
                        self.report(req, Some(writer), "pitch", index, total, state, detail);
                        (self.remember(req, "pitch", index, hash, &turn).await?, true)
                    }
                };
            match turn.pitch {
                Some(pitch) => {
                    let line = Line {
                        seq,
                        speaker: writer.id.clone(),
                        text: pitch.say.clone(),
                    };
                    self.spoke(req, &line, Some(writer), fresh).await?;
                    lines.push(line);
                    seq += 1;
                    taken.pitched(&name, &pitch);
                    valid.push((pitch_alias(valid.len()), *writer, name, pitch));
                }
                None => failures.push(turn.failure.unwrap_or_else(|| "invalid-output".into())),
            }
        }

        // check#1…N (ADR-0068): each pitch's central promise is checked on the
        // web. An unverifiable pitch is set aside; a check that fails (a timeout,
        // a backend that cannot search) keeps the pitch, unchecked.
        if !valid.is_empty() {
            let total = u32::try_from(valid.len()).unwrap_or(u32::MAX);
            let mut kept: Vec<Pitched<'_>> = Vec::new();
            for (i, (alias, writer, name, pitch)) in
                std::mem::take(&mut valid).into_iter().enumerate()
            {
                let index = u32::try_from(i + 1).unwrap_or(u32::MAX);
                let user = pitch_check_prompt(pack, &pitch);
                let schema = pitch_check_schema();
                let request = LlmRequest {
                    profile: mod_call.clone(),
                    system: vec![mod_system.clone()],
                    messages: vec![LlmMessage::user(user.clone())],
                    max_tokens: CHECK_ANSWER,
                    reasoning_tokens: Some(PITCH_REASONING),
                };
                let hash = stage_hash(&["check", &mod_system, &user, &schema.to_string()]);
                let check: PitchCheck = match self.recall(req, "check", index, Some(&hash)).await? {
                    Some(v) => {
                        self.report(
                            req,
                            Some(moderator),
                            "check",
                            index,
                            total,
                            ProgressState::Reused,
                            json!({}),
                        );
                        serde_json::from_value(v).map_err(corrupt)?
                    }
                    None => {
                        self.report(
                            req,
                            Some(moderator),
                            "check",
                            index,
                            total,
                            ProgressState::Started,
                            json!({}),
                        );
                        let c = match self.llm.research(&request, &schema).await {
                            Ok(r) => PitchCheck::from_answer(&r.value, &r.sources),
                            Err(e) => PitchCheck {
                                verifiable: None,
                                note: String::new(),
                                claims: 0,
                                error: Some(e.to_string()),
                            },
                        };
                        let state = if c.error.is_some() {
                            ProgressState::Failed
                        } else {
                            ProgressState::Done
                        };
                        let detail = json!({"title": pitch.title, "verifiable": c.verifiable, "claims": c.claims, "error": c.error});
                        self.report(req, Some(moderator), "check", index, total, state, detail);
                        self.remember(req, "check", index, hash, &c).await?
                    }
                };
                if check.verifiable == Some(false) {
                    let why = if check.note.is_empty() {
                        "nothing on the web verifies what it promises".to_string()
                    } else {
                        check.note.clone()
                    };
                    let line = Line {
                        seq,
                        speaker: "system".into(),
                        text: format!("\u{ab}{}\u{bb} is set aside: {why}", pitch.title),
                    };
                    self.spoke(req, &line, None, false).await?;
                    lines.push(line);
                    seq += 1;
                } else {
                    kept.push((alias, writer, name, pitch));
                }
            }
            valid = kept
                .into_iter()
                .enumerate()
                .map(|(i, (_, w, n, p))| (pitch_alias(i), w, n, p))
                .collect();
            if valid.is_empty() {
                let line = Line {
                    seq,
                    speaker: "system".into(),
                    text: "No pitch could be verified; the standup commissions nothing today."
                        .into(),
                };
                self.spoke(req, &line, None, false).await?;
                return Ok(vec![Outcome::MeetingOutcome {
                    job_id: req.job_id,
                    briefs: Vec::new(),
                }]);
            }
        }

        if valid.is_empty() {
            let reason = if !failures.is_empty() && failures.iter().all(|f| f == "infrastructure") {
                JobFailure::Infrastructure
            } else if failures.iter().any(|f| f == "model") {
                JobFailure::Model
            } else {
                JobFailure::InvalidOutput
            };
            let line = Line {
                seq,
                speaker: "system".into(),
                text:
                    "No pitch could be used; the standup commissions nothing and the CEO is told."
                        .into(),
            };
            self.spoke(req, &line, None, false).await?;
            return Ok(vec![Outcome::JobFailed {
                job_id: req.job_id,
                reason,
            }]);
        }

        // commission#0
        let pitch_lines: Vec<PitchLine<'_>> = valid
            .iter()
            .map(|(alias, w, n, p)| PitchLine {
                alias,
                name: n,
                id: &w.id,
                pitch: p,
            })
            .collect();
        let user = commission_prompt(pack, &pitch_lines);
        let schema = commission_schema(valid.len(), frame.cap);
        let request = LlmRequest {
            profile: mod_call,
            system: vec![mod_system.clone()],
            messages: vec![LlmMessage::user(user.clone())],
            max_tokens: COMMISSION_ANSWER,
            reasoning_tokens: Some(PITCH_REASONING),
        };
        let hash = stage_hash(&["commission", &mod_system, &user, &schema.to_string()]);
        let (commissioned, fresh): (Commissioned, bool) =
            match self.recall(req, "commission", 0, Some(&hash)).await? {
                Some(v) => {
                    self.report(
                        req,
                        Some(moderator),
                        "commission",
                        0,
                        1,
                        ProgressState::Reused,
                        json!({}),
                    );
                    (serde_json::from_value(v).map_err(corrupt)?, false)
                }
                None => {
                    self.report(
                        req,
                        Some(moderator),
                        "commission",
                        0,
                        1,
                        ProgressState::Started,
                        json!({}),
                    );
                    let c = match structured_with_repair(
                        self.llm.as_ref(),
                        &request,
                        &schema,
                        &|_: &Value| Ok(()),
                        1,
                    )
                    .await
                    {
                        Ok(Repaired { value, .. }) => {
                            match serde_json::from_value::<CommissionDecision>(value) {
                                Ok(decision) => Commissioned {
                                    decision,
                                    fallback: false,
                                    error: None,
                                },
                                Err(e) => fallback(&valid, frame.cap, e.to_string()),
                            }
                        }
                        Err(f) => fallback(&valid, frame.cap, f.error.to_string()),
                    };
                    let state = if c.fallback {
                        ProgressState::Failed
                    } else {
                        ProgressState::Done
                    };
                    self.report(
                        req,
                        Some(moderator),
                        "commission",
                        0,
                        1,
                        state,
                        json!({"fallback": c.fallback, "error": c.error}),
                    );
                    (self.remember(req, "commission", 0, hash, &c).await?, true)
                }
            };

        // The commissions, each pitch once, at most `cap`.
        let mut chosen: Vec<(&Pitched<'_>, u32)> = Vec::new();
        for c in &commissioned.decision.commission {
            if chosen.len() >= frame.cap {
                break;
            }
            let Some(v) = valid.iter().find(|(alias, ..)| *alias == c.pitch) else {
                continue;
            };
            if chosen.iter().any(|(x, _)| x.0 == v.0) {
                continue;
            }
            chosen.push((v, c.target_words.clamp(MIN_TARGET_WORDS, MAX_TARGET_WORDS)));
        }

        // The moderator closes with what was decided.
        let said: Vec<String> = chosen
            .iter()
            .map(|((_, _, name, p), words)| {
                format!("{name} takes «{}», about {words} words", p.title)
            })
            .collect();
        let closing = if said.is_empty() {
            "Nothing is commissioned today.".to_string()
        } else if commissioned.fallback {
            format!("Let us go with the first pitches: {}.", said.join("; "))
        } else {
            format!("{}.", said.join("; "))
        };
        let line = Line {
            seq,
            speaker: moderator.id.clone(),
            text: closing,
        };
        self.spoke(req, &line, Some(moderator), fresh).await?;
        lines.push(line);

        let minutes: Vec<Value> = lines
            .iter()
            .map(|l| json!({"seq": l.seq, "speaker": l.speaker, "text": l.text}))
            .collect();
        let decision = &commissioned.decision;
        if !decision.decisions.is_empty() || !decision.escalations.is_empty() {
            let mut text: Vec<String> = decision
                .decisions
                .iter()
                .map(|d| format!("Decided: {d}"))
                .collect();
            text.extend(
                decision
                    .escalations
                    .iter()
                    .map(|e| format!("For the CEO ({}): {}", e.kind, e.summary)),
            );
            let item = req
                .meeting
                .clone()
                .unwrap_or_else(|| format!("standup-{}", req.job_id));
            let key = format!("{}:minutes:0", req.job_id);
            self.post(
                req,
                &item,
                "minutes",
                &moderator.id,
                None,
                &text.join("\n"),
                json!({"job": req.job_id, "decisions": decision.decisions, "escalations": decision.escalations}),
                Some(&key),
            )
            .await?;
        }

        let mut briefs = Vec::new();
        for (i, ((_, writer, _, pitch), words)) in chosen.iter().enumerate() {
            let brief_ref = brief_ref_for(&req.company_id, req.job_id, i);
            let record = BriefRecord {
                job_id: req.job_id,
                brief: Brief {
                    content_id: format!("content-{brief_ref:x}"),
                    title: pitch.title.clone(),
                    slug: slugify(&pitch.title),
                    angle: pitch.angle.clone(),
                    keywords: pitch.keywords.clone(),
                    target_words: *words,
                    language: self.site.language.clone(),
                    notes: String::new(),
                },
                writer: writer.id.clone(),
                editor: editor.id.clone(),
                minutes: minutes.clone(),
                work_item: None,
                staff: vec![(*writer).clone(), editor.clone()],
            };
            self.store
                .put_brief(
                    &req.company_id,
                    brief_ref,
                    serde_json::to_value(&record).map_err(corrupt)?,
                )
                .await?;
            briefs.push(BriefOut {
                brief_ref,
                writer: writer.id.clone(),
                editor: editor.id.clone(),
            });
        }
        Ok(vec![Outcome::MeetingOutcome {
            job_id: req.job_id,
            briefs,
        }])
    }

    /// The frame of a first run: who pitches, the cap and the pack.
    fn frame(&self, req: &JobRequest, ctx: &StandupContext) -> Frame {
        let free = ctx.wip.as_ref().and_then(|w| w.free_writers.as_ref());
        let mut writers: Vec<&StaffRef> = req
            .staff
            .iter()
            .filter(|s| s.role == "writer")
            .filter(|s| free.is_none_or(|f| f.contains(&s.id)))
            .collect();
        writers.sort_by(|a, b| staff_order(&a.id).cmp(&staff_order(&b.id)));
        let any_writer = req.staff.iter().any(|s| s.role == "writer");
        let room = ctx.room();
        let cap = standup_cap(
            writers.len(),
            room,
            ctx.minutes_per_article,
            ctx.model_minutes_per_day.unwrap_or(MODEL_MINUTES_PER_DAY),
        );
        let why_not = if cap > 0 {
            String::new()
        } else if room == Some(0) {
            let w = ctx.wip.clone().unwrap_or_default();
            format!(
                "The desk is full: {} articles are open, {} waiting for the CEO.",
                w.open.unwrap_or(0),
                w.awaiting_approval.unwrap_or(0)
            )
        } else if any_writer {
            "Every writer has an article in hand.".into()
        } else {
            "Nobody on the team writes.".into()
        };
        let pack = if cap > 0 {
            context_pack(&self.site, ctx, cap)
        } else {
            ContextPack {
                text: String::new(),
                tokens: 0,
                sections: Vec::new(),
                dropped: Vec::new(),
            }
        };
        Frame {
            cap,
            writers: writers.iter().map(|s| s.id.clone()).collect(),
            pack,
            why_not,
        }
    }

    /// The opening: kept whole, cut at its last sentence when it ran out of
    /// tokens, retried once with [`TWO_SENTENCES`] when nothing was left;
    /// skipped otherwise.
    async fn opening(&self, request: &LlmRequest) -> Turn {
        let cut = |partial: &str| trim_to_sentence(&strip_reasoning(partial));
        let text = match self.llm.generate(request, None).await {
            Ok(t) => Ok(strip_reasoning(&t)),
            Err(LlmError::Truncated { partial }) if !cut(&partial).is_empty() => Ok(cut(&partial)),
            Err(LlmError::Truncated { .. }) => {
                let mut again = request.clone();
                if let Some(m) = again.messages.last_mut() {
                    m.text = format!("{}\n\n{TWO_SENTENCES}", m.text);
                }
                match self.llm.generate(&again, None).await {
                    Ok(t) => Ok(strip_reasoning(&t)),
                    Err(LlmError::Truncated { partial }) => Ok(cut(&partial)),
                    Err(e) => Err(e),
                }
            }
            Err(e) => Err(e),
        };
        match text {
            Ok(t) if !t.trim().is_empty() => Turn {
                text: Some(cut_chars(t.trim(), OPENING_CHARS)),
                ..Turn::default()
            },
            Ok(_) => Turn {
                skipped: Some("the opening was cut off before its first sentence".into()),
                failure: Some("model".into()),
                ..Turn::default()
            },
            Err(e) => Turn {
                skipped: Some(e.to_string()),
                failure: Some(failure_of(&e).into()),
                ..Turn::default()
            },
        }
    }

    /// One pitch, checked on arrival against what is taken, with
    /// [`PITCH_REPAIRS`] repair turns; one retry with [`TWO_SENTENCES`] when
    /// it ran out of tokens. Returns the turn and the progress detail.
    async fn pitch(&self, request: &LlmRequest, schema: &Value, taken: &Taken) -> (Turn, Value) {
        let check = |v: &Value| -> std::result::Result<(), Vec<String>> {
            let p: Pitch = serde_json::from_value(v.clone()).map_err(|e| vec![e.to_string()])?;
            match taken.conflict(&clean(p)) {
                Some(problem) => Err(vec![problem]),
                None => Ok(()),
            }
        };
        let mut r =
            structured_with_repair(self.llm.as_ref(), request, schema, &check, PITCH_REPAIRS).await;
        let mut calls = match &r {
            Ok(x) => x.calls,
            Err(f) => f.calls,
        };
        if matches!(&r, Err(f) if matches!(f.error, LlmError::Truncated { .. })) {
            let mut again = request.clone();
            if let Some(m) = again.messages.last_mut() {
                m.text = format!(
                    "{}\n\n{TWO_SENTENCES} The angle in one short sentence.",
                    m.text
                );
            }
            again.reasoning_tokens = Some(0);
            r = structured_with_repair(self.llm.as_ref(), &again, schema, &check, PITCH_REPAIRS)
                .await;
            calls += match &r {
                Ok(x) => x.calls,
                Err(f) => f.calls,
            };
        }
        match r {
            Ok(x) => match serde_json::from_value::<Pitch>(x.value) {
                Ok(p) => (
                    Turn {
                        pitch: Some(clean(p)),
                        ..Turn::default()
                    },
                    json!({"calls": calls, "repairs": x.repairs}),
                ),
                Err(e) => (
                    Turn {
                        skipped: Some(e.to_string()),
                        failure: Some("invalid-output".into()),
                        ..Turn::default()
                    },
                    json!({"calls": calls, "error": e.to_string()}),
                ),
            },
            Err(f) => (
                Turn {
                    skipped: Some(f.error.to_string()),
                    failure: Some(failure_of(&f.error).into()),
                    ..Turn::default()
                },
                json!({"calls": calls, "error": f.error.to_string(), "no_progress": f.no_progress}),
            ),
        }
    }
}

/// A pitch with its text trimmed and its keywords once each.
pub(crate) fn clean(p: Pitch) -> Pitch {
    let mut keywords: Vec<String> = Vec::new();
    for k in p.keywords {
        let k = k.trim().to_string();
        if !k.is_empty() && !keywords.iter().any(|x| x.eq_ignore_ascii_case(&k)) {
            keywords.push(k);
        }
    }
    Pitch {
        say: p.say.trim().to_string(),
        title: p.title.trim().to_string(),
        angle: p.angle.trim().to_string(),
        keywords,
    }
}

/// The commissioning call failed: the first `cap` pitches, at the default
/// length.
fn fallback(valid: &[Pitched<'_>], cap: usize, error: String) -> Commissioned {
    Commissioned {
        decision: CommissionDecision {
            commission: valid
                .iter()
                .take(cap)
                .map(|(alias, ..)| agents::meetings::Commission {
                    pitch: alias.clone(),
                    target_words: DEFAULT_TARGET_WORDS,
                })
                .collect(),
            decisions: Vec::new(),
            escalations: Vec::new(),
        },
        fallback: true,
        error: Some(error),
    }
}
