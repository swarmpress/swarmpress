//! Department production jobs: Photo & Video (`PhotoSelection`,
//! `PhotoBrief`), Web Development (`SiteChange`), IT & Operations
//! (`OpsCheck`) and SEO & Marketing (`SeoPlan`, `MarketingPlan`,
//! `Newsletter`).

use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::office::PROVENANCE_SKIP;
use super::{
    check_number_provenance, closed_object, finish, job_schema, one_of, run_structured, text,
    texts, JobCtx,
};
use crate::llm::{Llm, LlmError};
use crate::plan::PlanOp;
use crate::roles::{JobKind, Role};

// ---------------------------------------------------------------------------
// Photo & Video
// ---------------------------------------------------------------------------

/// One image of the closed-world media index (ADR-0013).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MediaEntry {
    pub id: String,
    pub description: String,
    pub subject: String,
    pub location: String,
    pub orientation: String,
    pub licence: String,
    pub credit: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PhotoSelectionInput {
    pub page: String,
    pub page_summary: String,
    /// Slot names, e.g. `hero`, `inline-1`, `gallery-1`.
    pub slots: Vec<String>,
    pub media: Vec<MediaEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PhotoChoice {
    pub slot: String,
    pub media_id: String,
    pub alt: String,
    pub caption: String,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PhotoSelection {
    pub selections: Vec<PhotoChoice>,
    pub gaps: Vec<String>,
    pub plan_ops: Vec<PlanOp>,
}

pub fn photo_selection_schema(input: &PhotoSelectionInput) -> Value {
    let slots: Vec<&str> = input.slots.iter().map(String::as_str).collect();
    let ids: Vec<&str> = input.media.iter().map(|m| m.id.as_str()).collect();
    let media_id = if ids.is_empty() {
        json!({"type": "string", "enum": [""]})
    } else {
        one_of(&ids)
    };
    job_schema(json!({
        "selections": {"type": "array", "items": closed_object(json!({
            "slot": one_of(&slots),
            "media_id": media_id,
            "alt": text(),
            "caption": text(),
            "reason": text(),
        }))},
        "gaps": {"type": "array", "items": one_of(&slots)},
    }))
}

/// Each slot and each image at most once; alt text is not "image of …".
pub fn photo_selection_check(out: &Value) -> Result<(), Vec<String>> {
    let mut e = Vec::new();
    let mut slots = BTreeSet::new();
    let mut ids = BTreeSet::new();
    for (i, s) in out
        .get("selections")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .enumerate()
    {
        let slot = s.get("slot").and_then(Value::as_str).unwrap_or_default();
        let id = s
            .get("media_id")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if id.is_empty() {
            e.push(format!(
                "/selections/{i}: no image fits; list the slot in gaps instead"
            ));
        }
        if !slots.insert(slot) {
            e.push(format!("/selections/{i}: slot {slot:?} filled twice"));
        }
        if !id.is_empty() && !ids.insert(id) {
            e.push(format!(
                "/selections/{i}: image {id:?} used twice on the page"
            ));
        }
        let alt = s
            .get("alt")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_lowercase();
        if alt.starts_with("image of")
            || alt.starts_with("photo of")
            || alt.starts_with("picture of")
        {
            e.push(format!(
                "/selections/{i}/alt: describe what it shows, not that it is an image"
            ));
        }
    }
    finish(e)
}

pub async fn photo_selection(
    llm: &dyn Llm,
    ctx: JobCtx<'_>,
    input: &PhotoSelectionInput,
) -> Result<PhotoSelection, LlmError> {
    run_structured(
        llm,
        JobKind::PhotoSelection,
        ctx,
        "Choose images for the page's slots from the media index below only.",
        input,
        &photo_selection_schema(input),
        &photo_selection_check,
    )
    .await
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Shot {
    pub subject: String,
    pub location: String,
    pub time_of_day: String,
    pub notes: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PhotoBrief {
    pub title: String,
    pub purpose: String,
    pub shots: Vec<Shot>,
    pub rights_note: String,
    pub plan_ops: Vec<PlanOp>,
}

pub fn photo_brief_schema() -> Value {
    job_schema(json!({
        "title": text(),
        "purpose": text(),
        "shots": {"type": "array", "minItems": 1, "items": closed_object(json!({
            "subject": text(), "location": text(), "time_of_day": text(), "notes": text()
        }))},
        "rights_note": text(),
    }))
}

/// `input`: the gaps from a selection, the pages and any season/time notes.
pub async fn photo_brief(
    llm: &dyn Llm,
    ctx: JobCtx<'_>,
    input: &Value,
) -> Result<PhotoBrief, LlmError> {
    run_structured(
        llm,
        JobKind::PhotoBrief,
        ctx,
        "Brief a shoot to fill these image gaps.",
        input,
        &photo_brief_schema(),
        &super::no_check,
    )
    .await
}

// ---------------------------------------------------------------------------
// Web Development
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Risk {
    Low,
    Medium,
    High,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum FileChange {
    Add,
    Modify,
    Delete,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChangedFile {
    pub path: String,
    pub change: FileChange,
    pub description: String,
    pub content: Option<String>,
}

/// A site change proposal: an artifact the orchestrator turns into a PR.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SiteChange {
    pub summary: String,
    pub rationale: String,
    pub risk: Risk,
    pub requires_ceo_approval: bool,
    pub files: Vec<ChangedFile>,
    pub test_plan: Vec<String>,
    pub plan_ops: Vec<PlanOp>,
}

pub fn site_change_schema() -> Value {
    job_schema(json!({
        "summary": text(),
        "rationale": text(),
        "risk": one_of(&["low", "medium", "high"]),
        "requires_ceo_approval": {"type": "boolean"},
        "files": {"type": "array", "minItems": 1, "items": closed_object(json!({
            "path": text(),
            "change": one_of(&["add", "modify", "delete"]),
            "description": text(),
            "content": {"type": ["string", "null"]}
        }))},
        "test_plan": texts(1),
    }))
}

/// Repo-relative paths only, no secrets, content present iff added or
/// modified, and high-risk changes (or anything touching the deploy
/// workflow) flagged for CEO approval.
pub fn site_change_check(out: &Value) -> Result<(), Vec<String>> {
    let sc: SiteChange = match serde_json::from_value(out.clone()) {
        Ok(s) => s,
        Err(err) => return Err(vec![err.to_string()]),
    };
    let mut e = Vec::new();
    let mut touches_workflow = false;
    for (i, f) in sc.files.iter().enumerate() {
        let p = f.path.as_str();
        if p.starts_with('/') || p.contains('\\') || p.split('/').any(|s| s == ".." || s.is_empty())
        {
            e.push(format!(
                "/files/{i}/path: {p:?} must be a clean repo-relative path"
            ));
        }
        let name = p.rsplit('/').next().unwrap_or(p);
        if name.starts_with(".env")
            || name.ends_with(".pem")
            || name.ends_with(".key")
            || p.contains("secrets")
        {
            e.push(format!(
                "/files/{i}/path: {p:?} looks like a secret; never touch secrets"
            ));
        }
        if p.starts_with(".github/workflows/") {
            touches_workflow = true;
        }
        match (f.change, &f.content) {
            (FileChange::Delete, Some(_)) => {
                e.push(format!("/files/{i}/content: a deletion has no content"))
            }
            (FileChange::Add | FileChange::Modify, None) => {
                e.push(format!("/files/{i}/content: give the full new content"))
            }
            _ => {}
        }
    }
    if touches_workflow && sc.risk != Risk::High {
        e.push("/risk: changes to .github/workflows are high risk".into());
    }
    if (sc.risk == Risk::High || touches_workflow) && !sc.requires_ceo_approval {
        e.push("/requires_ceo_approval: high-risk changes need CEO approval".into());
    }
    finish(e)
}

/// `input`: the issue or audit finding, relevant file contents and
/// constraints.
pub async fn site_change(
    llm: &dyn Llm,
    ctx: JobCtx<'_>,
    input: &Value,
) -> Result<SiteChange, LlmError> {
    run_structured(
        llm,
        JobKind::SiteChange,
        ctx,
        "Propose a site change for this issue as reviewable files (artifacts only; you never push or deploy).",
        input,
        &site_change_schema(),
        &site_change_check,
    )
    .await
}

// ---------------------------------------------------------------------------
// IT & Operations
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum OpsStatus {
    Green,
    Amber,
    Red,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CheckStatus {
    Ok,
    Warn,
    Fail,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ActionPriority {
    Now,
    ThisWeek,
    Later,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OpsCheckItem {
    pub name: String,
    pub status: CheckStatus,
    pub detail: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OpsAction {
    pub action: String,
    pub priority: ActionPriority,
    pub owner_role: Role,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OpsCheck {
    pub status: OpsStatus,
    pub checks: Vec<OpsCheckItem>,
    pub incidents: Vec<String>,
    pub actions: Vec<OpsAction>,
    pub plan_ops: Vec<PlanOp>,
}

pub fn ops_check_schema() -> Value {
    let roles: Vec<&str> = Role::staff().map(Role::as_str).collect();
    job_schema(json!({
        "status": one_of(&["green", "amber", "red"]),
        "checks": {"type": "array", "minItems": 1, "items": closed_object(json!({
            "name": text(), "status": one_of(&["ok", "warn", "fail"]), "detail": text()
        }))},
        "incidents": texts(0),
        "actions": {"type": "array", "items": closed_object(json!({
            "action": text(),
            "priority": one_of(&["now", "this-week", "later"]),
            "owner_role": one_of(&roles)
        }))},
    }))
}

/// Numbers only from the signals; a failing check can't be reported green.
pub fn ops_check_check(signals: &Value, out: &Value) -> Result<(), Vec<String>> {
    let mut e = check_number_provenance(out, signals, PROVENANCE_SKIP)
        .err()
        .unwrap_or_default();
    let any_fail = out
        .get("checks")
        .and_then(Value::as_array)
        .is_some_and(|c| {
            c.iter()
                .any(|x| x.get("status").and_then(Value::as_str) == Some("fail"))
        });
    if any_fail && out.get("status").and_then(Value::as_str) == Some("green") {
        e.push("/status: a failing check cannot be reported green".into());
    }
    finish(e)
}

/// `signals`: CI runs, deploy statuses, uptime, link audit, certificates,
/// dependency alerts, incidents.
pub async fn ops_check(
    llm: &dyn Llm,
    ctx: JobCtx<'_>,
    signals: &Value,
) -> Result<OpsCheck, LlmError> {
    let check = |out: &Value| ops_check_check(signals, out);
    run_structured(
        llm,
        JobKind::OpsCheck,
        ctx,
        "Write this week's ops check from the signals below. Report only what they show.",
        signals,
        &ops_check_schema(),
        &check,
    )
    .await
}

// ---------------------------------------------------------------------------
// SEO & Marketing
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SeoPlanInput {
    /// The closed-world page registry (paths).
    pub pages: Vec<String>,
    /// Audits, search-console style aggregates, the work item's targets.
    pub data: Value,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SearchIntent {
    Informational,
    Navigational,
    Transactional,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FocusKeyword {
    pub keyword: String,
    pub intent: SearchIntent,
    pub target_page: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MetadataFix {
    pub page: String,
    pub issue: String,
    pub fix: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct InternalLink {
    pub from: String,
    pub to: String,
    pub anchor: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SeoPlan {
    pub focus_keywords: Vec<FocusKeyword>,
    pub metadata_fixes: Vec<MetadataFix>,
    pub internal_links: Vec<InternalLink>,
    pub priorities: Vec<String>,
    pub plan_ops: Vec<PlanOp>,
}

pub fn seo_plan_schema(input: &SeoPlanInput) -> Value {
    let pages: Vec<&str> = input.pages.iter().map(String::as_str).collect();
    job_schema(json!({
        "focus_keywords": {"type": "array", "items": closed_object(json!({
            "keyword": text(),
            "intent": one_of(&["informational", "navigational", "transactional"]),
            "target_page": one_of(&pages)
        }))},
        "metadata_fixes": {"type": "array", "items": closed_object(json!({
            "page": one_of(&pages), "issue": text(), "fix": text()
        }))},
        "internal_links": {"type": "array", "items": closed_object(json!({
            "from": one_of(&pages), "to": one_of(&pages), "anchor": text()
        }))},
        "priorities": {"type": "array", "minItems": 1, "maxItems": 3, "items": text()},
    }))
}

pub fn seo_plan_check(out: &Value) -> Result<(), Vec<String>> {
    let mut e = Vec::new();
    for (i, l) in out
        .get("internal_links")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .enumerate()
    {
        if l.get("from") == l.get("to") {
            e.push(format!("/internal_links/{i}: a page cannot link to itself"));
        }
        let anchor = l
            .get("anchor")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_lowercase();
        if ["click here", "here", "read more", "this page"].contains(&anchor.trim()) {
            e.push(format!(
                "/internal_links/{i}/anchor: use descriptive anchor text"
            ));
        }
    }
    finish(e)
}

pub async fn seo_plan(
    llm: &dyn Llm,
    ctx: JobCtx<'_>,
    input: &SeoPlanInput,
) -> Result<SeoPlan, LlmError> {
    run_structured(
        llm,
        JobKind::SeoPlan,
        ctx,
        "Write the SEO plan for this work item. Link only to pages in the registry.",
        input,
        &seo_plan_schema(input),
        &seo_plan_check,
    )
    .await
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Channel {
    pub channel: String,
    pub tactic: String,
    pub cadence: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Campaign {
    pub name: String,
    pub message: String,
    pub timing: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MarketingPlan {
    pub goal: String,
    pub audiences: Vec<String>,
    pub channels: Vec<Channel>,
    pub campaigns: Vec<Campaign>,
    pub measure: Vec<String>,
    pub plan_ops: Vec<PlanOp>,
}

pub fn marketing_plan_schema() -> Value {
    job_schema(json!({
        "goal": text(),
        "audiences": texts(1),
        "channels": {"type": "array", "minItems": 1, "items": closed_object(json!({
            "channel": text(), "tactic": text(), "cadence": text()
        }))},
        "campaigns": {"type": "array", "items": closed_object(json!({
            "name": text(), "message": text(), "timing": text()
        }))},
        "measure": texts(1),
    }))
}

/// `input`: goals, seasonal calendar, audience aggregates, budget figures.
/// Figures must come from the input.
pub async fn marketing_plan(
    llm: &dyn Llm,
    ctx: JobCtx<'_>,
    input: &Value,
) -> Result<MarketingPlan, LlmError> {
    let check = |out: &Value| check_number_provenance(out, input, PROVENANCE_SKIP);
    run_structured(
        llm,
        JobKind::MarketingPlan,
        ctx,
        "Write the marketing plan from the goals, calendar and data below.",
        input,
        &marketing_plan_schema(),
        &check,
    )
    .await
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PublishedPage {
    pub path: String,
    pub title: String,
    pub summary: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NewsletterInput {
    pub theme: String,
    pub published_pages: Vec<PublishedPage>,
    #[serde(default)]
    pub notes: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NewsletterItem {
    pub headline: String,
    pub blurb: String,
    pub page: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Newsletter {
    pub subject: String,
    pub preheader: String,
    pub intro: String,
    pub items: Vec<NewsletterItem>,
    pub sign_off: String,
    pub plan_ops: Vec<PlanOp>,
}

pub fn newsletter_schema(input: &NewsletterInput) -> Value {
    let pages: Vec<&str> = input
        .published_pages
        .iter()
        .map(|p| p.path.as_str())
        .collect();
    job_schema(json!({
        "subject": {"type": "string", "minLength": 1, "maxLength": 80},
        "preheader": {"type": "string", "minLength": 1, "maxLength": 120},
        "intro": text(),
        "items": {"type": "array", "minItems": 3, "maxItems": 6, "items": closed_object(json!({
            "headline": text(), "blurb": text(), "page": one_of(&pages)
        }))},
        "sign_off": text(),
    }))
}

pub async fn newsletter(
    llm: &dyn Llm,
    ctx: JobCtx<'_>,
    input: &NewsletterInput,
) -> Result<Newsletter, LlmError> {
    let check = |out: &Value| {
        let mut seen = BTreeSet::new();
        let dups: Vec<String> = super::strings_at(out, "items", "page")
            .into_iter()
            .filter(|p| !seen.insert(*p))
            .map(|p| format!("/items: page {p:?} appears twice"))
            .collect();
        finish(dups)
    };
    run_structured(
        llm,
        JobKind::Newsletter,
        ctx,
        "Write this edition of the newsletter from the published pages below.",
        input,
        &newsletter_schema(input),
        &check,
    )
    .await
}
