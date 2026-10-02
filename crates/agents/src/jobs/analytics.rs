//! Data Scientist jobs (organization.md §6a, ADR-0032): `KpiReport`,
//! `ContentPerformance`, `ExperimentReadout`.
//!
//! Inputs are **aggregated tables only**, rolled up from the platform's own
//! first-party tracker (`analytics_daily`: project × day × page × language ×
//! source; metrics `sessions`, `visitors`, `pageviews`, `engagement_time_s`,
//! `scroll_depth_pct`, `outbound_clicks`). Raw events never reach a model:
//! rows are a closed schema and [`AnalyticsInput::validate`] refuses
//! anything that looks user-level. Outputs may only use numbers present in
//! the tables (same validator as the CFO).

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::office::PROVENANCE_SKIP;
use super::{
    check_number_provenance, closed_object, finish, job_schema, one_of, run_structured, text,
    texts, JobCtx,
};
use crate::llm::{Llm, LlmError};
use crate::plan::PlanOp;
use crate::roles::JobKind;

/// Column names that would mean user-level data; refused in derived columns.
pub const USER_LEVEL_MARKERS: &[&str] = &[
    "user",
    "visitor_id",
    "session_id",
    "ip",
    "email",
    "cookie",
    "fingerprint",
    "device_id",
    "user_agent",
    "salt",
    "event_id",
];

/// One aggregated row of `analytics_daily` (or a rollup of it). Dimension
/// columns are optional (a rollup by page has no `source`); metrics are the
/// tracker's. `derived` holds precomputed numeric columns the server adds
/// (`wow_change_pct`, `share_pct`, `engaged_pct`, `goal_progress_pct` …).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AnalyticsRow {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub day: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    pub sessions: u64,
    pub visitors: u64,
    pub pageviews: u64,
    pub engagement_time_s: f64,
    pub scroll_depth_pct: f64,
    pub outbound_clicks: u64,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub derived: BTreeMap<String, f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AnalyticsTable {
    /// e.g. `"by_page_this_week"`, `"by_language"`, `"by_source"`, `"totals_vs_last_week"`.
    pub name: String,
    pub description: String,
    pub rows: Vec<AnalyticsRow>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GoalProgress {
    pub goal: String,
    pub metric: String,
    pub target: f64,
    pub current: f64,
}

/// Aggregated analytics for one project and period.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AnalyticsInput {
    pub project: String,
    /// Human label, e.g. `"days 22–28"`.
    pub period: String,
    pub tables: Vec<AnalyticsTable>,
    #[serde(default)]
    pub goals: Vec<GoalProgress>,
}

impl AnalyticsInput {
    /// Refuses empty input and anything that looks user-level.
    pub fn validate(&self) -> Result<(), Vec<String>> {
        let mut e = Vec::new();
        if self.tables.iter().all(|t| t.rows.is_empty()) {
            e.push("no aggregated rows: the tracker has no data yet".into());
        }
        for t in &self.tables {
            for (i, r) in t.rows.iter().enumerate() {
                for k in r.derived.keys() {
                    let l = k.to_lowercase();
                    if USER_LEVEL_MARKERS.iter().any(|m| l.contains(m)) {
                        e.push(format!(
                            "{}[{i}].derived.{k}: user-level columns never reach a model",
                            t.name
                        ));
                    }
                }
            }
        }
        finish(e)
    }

    /// Every page path in the tables.
    pub fn pages(&self) -> BTreeSet<&str> {
        self.tables
            .iter()
            .flat_map(|t| t.rows.iter().filter_map(|r| r.page.as_deref()))
            .collect()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Kpi {
    pub metric: String,
    pub value: String,
    pub comparison: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PageNote {
    pub page: String,
    pub note: String,
}

/// The weekly KPI report to the CEO.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct KpiReport {
    pub headline: String,
    pub kpis: Vec<Kpi>,
    pub top_pages: Vec<PageNote>,
    pub bottom_pages: Vec<PageNote>,
    pub languages: Vec<String>,
    pub sources: Vec<String>,
    pub anomalies: Vec<String>,
    pub recommendations: Vec<String>,
    pub plan_ops: Vec<PlanOp>,
}

fn page_note() -> Value {
    closed_object(json!({"page": text(), "note": text()}))
}

pub fn kpi_report_schema() -> Value {
    job_schema(json!({
        "headline": text(),
        "kpis": {"type": "array", "minItems": 1, "items": closed_object(json!({
            "metric": text(), "value": text(), "comparison": text()
        }))},
        "top_pages": {"type": "array", "items": page_note()},
        "bottom_pages": {"type": "array", "items": page_note()},
        "languages": texts(0),
        "sources": texts(0),
        "anomalies": texts(0),
        "recommendations": {"type": "array", "minItems": 3, "maxItems": 3, "items": text()},
    }))
}

fn pages_known(out: &Value, input: &AnalyticsInput, arrays: &[&str]) -> Vec<String> {
    let known = input.pages();
    arrays
        .iter()
        .flat_map(|a| {
            super::strings_at(out, a, "page")
                .into_iter()
                .filter(|p| !known.contains(p))
                .map(move |p| format!("/{a}: page {p:?} is not in the analytics tables"))
        })
        .collect()
}

fn analytics_check(
    out: &Value,
    input: &AnalyticsInput,
    page_arrays: &[&str],
) -> Result<(), Vec<String>> {
    let data = serde_json::to_value(input).unwrap_or(Value::Null);
    let mut e = check_number_provenance(out, &data, PROVENANCE_SKIP)
        .err()
        .unwrap_or_default();
    e.extend(pages_known(out, input, page_arrays));
    finish(e)
}

pub async fn kpi_report(
    llm: &dyn Llm,
    ctx: JobCtx<'_>,
    input: &AnalyticsInput,
) -> Result<KpiReport, LlmError> {
    input
        .validate()
        .map_err(|errors| LlmError::InvalidOutput { errors })?;
    let check = |out: &Value| analytics_check(out, input, &["top_pages", "bottom_pages"]);
    run_structured(
        llm,
        JobKind::KpiReport,
        ctx,
        "Write this week's KPI report for the CEO from the aggregated tables below. Use only numbers that appear in them.",
        input,
        &kpi_report_schema(),
        &check,
    )
    .await
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PerformanceVerdict {
    Outperforming,
    OnPar,
    Underperforming,
    TooEarly,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ContentPerformanceInput {
    /// Work item id.
    pub item: String,
    pub page: String,
    pub days_since_publish: u32,
    /// The page's rows and the comparison rows (e.g. workstream median).
    pub analytics: AnalyticsInput,
}

/// The follow-up post for a published work item.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ContentPerformance {
    pub summary: String,
    pub verdict: PerformanceVerdict,
    pub suggestion: Option<String>,
    pub plan_ops: Vec<PlanOp>,
}

pub fn content_performance_schema() -> Value {
    job_schema(json!({
        "summary": text(),
        "verdict": one_of(&["outperforming", "on-par", "underperforming", "too-early"]),
        "suggestion": {"type": ["string", "null"]},
    }))
}

pub async fn content_performance(
    llm: &dyn Llm,
    ctx: JobCtx<'_>,
    input: &ContentPerformanceInput,
) -> Result<ContentPerformance, LlmError> {
    input
        .analytics
        .validate()
        .map_err(|errors| LlmError::InvalidOutput { errors })?;
    let data = serde_json::to_value(input).unwrap_or(Value::Null);
    let check = |out: &Value| check_number_provenance(out, &data, PROVENANCE_SKIP);
    run_structured(
        llm,
        JobKind::ContentPerformance,
        ctx,
        "Write the follow-up performance post for this published item from the tables below. Use only numbers that appear in them.",
        input,
        &content_performance_schema(),
        &check,
    )
    .await
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ExperimentVerdict {
    Improved,
    NoClearChange,
    Worse,
    Inconclusive,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Confidence {
    Low,
    Medium,
    High,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ExperimentInput {
    /// What shipped ("new hero layout on village pages").
    pub change: String,
    pub shipped_day: u32,
    pub pages: Vec<String>,
    pub before: AnalyticsInput,
    pub after: AnalyticsInput,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExperimentReadout {
    pub change: String,
    pub pages: Vec<String>,
    pub before: Vec<String>,
    pub after: Vec<String>,
    pub verdict: ExperimentVerdict,
    pub confidence: Confidence,
    pub caveats: Vec<String>,
    pub plan_ops: Vec<PlanOp>,
}

pub fn experiment_readout_schema(input: &ExperimentInput) -> Value {
    let pages: Vec<&str> = input.pages.iter().map(String::as_str).collect();
    job_schema(json!({
        "change": text(),
        "pages": {"type": "array", "minItems": 1, "items": one_of(&pages)},
        "before": texts(1),
        "after": texts(1),
        "verdict": one_of(&["improved", "no-clear-change", "worse", "inconclusive"]),
        "confidence": one_of(&["low", "medium", "high"]),
        "caveats": texts(0),
    }))
}

pub async fn experiment_readout(
    llm: &dyn Llm,
    ctx: JobCtx<'_>,
    input: &ExperimentInput,
) -> Result<ExperimentReadout, LlmError> {
    let mut errors = input.before.validate().err().unwrap_or_default();
    errors.extend(input.after.validate().err().unwrap_or_default());
    if !errors.is_empty() {
        return Err(LlmError::InvalidOutput { errors });
    }
    let data = serde_json::to_value(input).unwrap_or(Value::Null);
    let check = |out: &Value| check_number_provenance(out, &data, PROVENANCE_SKIP);
    run_structured(
        llm,
        JobKind::ExperimentReadout,
        ctx,
        "Write the before/after readout for this change from the tables below. Use only numbers that appear in them.",
        input,
        &experiment_readout_schema(input),
        &check,
    )
    .await
}
