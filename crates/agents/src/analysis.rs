//! The data scientist's prompts of the analytics loop (ADR-0071): the
//! follow-up of a published item and the weekly KPI report. The numbers come
//! from the tracker's aggregates; every number in an answer must be one of
//! them ([`crate::jobs::check_number_provenance`]).

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// Answer budgets, tokens.
pub const FOLLOW_UP_ANSWER: u32 = 500;
pub const KPI_REPORT_ANSWER: u32 = 1200;

/// A follow-up's answer: the post's text and a verdict.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FollowUp {
    pub summary: String,
    /// `outperforming`, `on-par`, `underperforming` or `too-early`.
    pub verdict: String,
    #[serde(default)]
    pub suggestion: String,
}

/// The user turn of a follow-up: the page's numbers as a table.
pub fn follow_up_prompt(title: &str, path: &str, numbers: &Value) -> String {
    format!(
        "## Task: content performance\n\nArticle: \u{ab}{title}\u{bb} ({path})\n\n## Its numbers since it was published\n{}\n\n\
Write the follow-up for its thread: `summary` (one or two sentences, for example \"+14 days: … views, … the site's median page\"), \
a `verdict` (`outperforming`, `on-par`, `underperforming` or `too-early`) against the median, and an optional `suggestion` \
(for example a refresh). Use only the numbers above, copied exactly. Answer with JSON only.",
        serde_json::to_string_pretty(numbers).unwrap_or_default()
    )
}

pub fn follow_up_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["summary", "verdict", "suggestion"],
        "properties": {
            "summary": {"type": "string", "minLength": 10, "maxLength": 400},
            "verdict": {"type": "string", "enum": ["outperforming", "on-par", "underperforming", "too-early"]},
            "suggestion": {"type": "string", "maxLength": 300}
        }
    })
}

/// The weekly report's answer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct KpiReport {
    pub headline: String,
    #[serde(default)]
    pub highlights: Vec<String>,
    pub recommendations: Vec<String>,
}

/// The user turn of the weekly KPI report: this week's and last week's aggregates.
pub fn kpi_report_prompt(numbers: &Value) -> String {
    format!(
        "## Task: kpi report\n\n## This week's and last week's numbers\n{}\n\n\
Write the weekly KPI report for the Monday review: a one-sentence `headline`, up to four `highlights` (top and \
bottom pages by path, languages, sources, anything unusual) and exactly three `recommendations` for the editorial \
board (what to write, refresh or promote). Use only the numbers above, copied exactly; say \"not in the data\" rather \
than computing. Answer with JSON only.",
        serde_json::to_string_pretty(numbers).unwrap_or_default()
    )
}

pub fn kpi_report_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["headline", "highlights", "recommendations"],
        "properties": {
            "headline": {"type": "string", "minLength": 10, "maxLength": 300},
            "highlights": {"type": "array", "maxItems": 4, "items": {"type": "string", "minLength": 5, "maxLength": 300}},
            "recommendations": {"type": "array", "minItems": 3, "maxItems": 3,
                                "items": {"type": "string", "minLength": 10, "maxLength": 300}}
        }
    })
}

/// The answer budget of promotion copy, tokens (ADR-0073).
pub const PROMOTION_ANSWER: u32 = 900;

/// Promotion copy for a page that went live (ADR-0073): one text per channel.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Promotion {
    pub newsletter: String,
    pub instagram: String,
    pub x: String,
    pub facebook: String,
}

/// The user turn of promotion copy.
pub fn promotion_prompt(title: &str, angle: &str, url: &str, brand: &str) -> String {
    format!(
        "## Task: promotion\n\nArticle: \u{ab}{title}\u{bb}\nWhat it is about: {angle}\nURL: {url}\nPublication: {brand}\n\n\
Write promotion copy for this article, which just went live: a `newsletter` blurb (two or three sentences ending with \
the URL), an `instagram` caption (a hook, two short lines, three to five hashtags; no URL, the bio links it), an `x` post \
(at most 260 characters including the URL) and a `facebook` post (two sentences and the URL). Promise only what the \
article delivers; no prices, dates or numbers that are not in the title or the description. Answer with JSON only."
    )
}

pub fn promotion_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["newsletter", "instagram", "x", "facebook"],
        "properties": {
            "newsletter": {"type": "string", "minLength": 20, "maxLength": 600},
            "instagram": {"type": "string", "minLength": 20, "maxLength": 600},
            "x": {"type": "string", "minLength": 20, "maxLength": 280},
            "facebook": {"type": "string", "minLength": 20, "maxLength": 600}
        }
    })
}
