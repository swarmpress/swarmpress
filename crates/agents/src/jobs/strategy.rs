//! Strategy and editorial-board jobs: `StrategyPitch`, `ProjectBusinessCase`
//! (organization.md §4, §9), and the Monday board's `WeeklyPlan`
//! (strategist) and `PlanSchedule` (Editor-in-Chief) (publishing-plan.md §4).

use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::office::PROVENANCE_SKIP;
use super::{
    check_number_provenance, closed_object, finish, job_schema, one_of, run_structured, text,
    texts, JobCtx,
};
use crate::llm::{Llm, LlmError};
use crate::plan::{PlanOp, Priority};
use crate::roles::{JobKind, Role};

fn staff_roles() -> Vec<&'static str> {
    Role::staff().map(Role::as_str).collect()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Effort {
    Small,
    Medium,
    Large,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Pitch {
    pub title: String,
    pub angle: String,
    pub audience: String,
    pub why_now: String,
    pub effort: Effort,
    pub owner_role: Role,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StrategyPitch {
    pub pitches: Vec<Pitch>,
    pub plan_ops: Vec<PlanOp>,
}

pub fn strategy_pitch_schema() -> Value {
    job_schema(json!({
        "pitches": {"type": "array", "minItems": 3, "maxItems": 5, "items": closed_object(json!({
            "title": text(),
            "angle": text(),
            "audience": text(),
            "why_now": text(),
            "effort": one_of(&["small", "medium", "large"]),
            "owner_role": one_of(&staff_roles()),
        }))},
    }))
}

/// `context`: the plan summary, seasonal calendar, KPI report and team.
pub async fn strategy_pitch(
    llm: &dyn Llm,
    ctx: JobCtx<'_>,
    context: &Value,
) -> Result<StrategyPitch, LlmError> {
    run_structured(
        llm,
        JobKind::StrategyPitch,
        ctx,
        "Pitch 3 to 5 pieces for the project from the material below.",
        context,
        &strategy_pitch_schema(),
        &super::no_check,
    )
    .await
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TeamNeed {
    pub role: Role,
    pub allocation_pct: u8,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Recommendation {
    Go,
    Pilot,
    NoGo,
}

/// A new-publication business case (reviewed by the CFO, approved by the CEO).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProjectBusinessCase {
    pub project_name: String,
    pub thesis: String,
    pub audience: String,
    pub content_pillars: Vec<String>,
    pub team_needed: Vec<TeamNeed>,
    /// Which provided cost figures apply; numbers copied from the input.
    pub costs_basis: Vec<String>,
    pub risks: Vec<String>,
    pub kpis: Vec<String>,
    pub recommendation: Recommendation,
    pub plan_ops: Vec<PlanOp>,
}

pub fn project_business_case_schema() -> Value {
    job_schema(json!({
        "project_name": text(),
        "thesis": text(),
        "audience": text(),
        "content_pillars": texts(1),
        "team_needed": {"type": "array", "minItems": 1, "items": closed_object(json!({
            "role": one_of(&staff_roles()),
            "allocation_pct": {"type": "integer", "minimum": 5, "maximum": 100}
        }))},
        "costs_basis": texts(1),
        "risks": texts(1),
        "kpis": texts(1),
        "recommendation": one_of(&["go", "pilot", "no-go"]),
    }))
}

/// `input`: the proposal, the cost figures (salary bands, rent, Agency fees)
/// and the current portfolio. Cost statements must quote input figures.
pub async fn project_business_case(
    llm: &dyn Llm,
    ctx: JobCtx<'_>,
    input: &Value,
) -> Result<ProjectBusinessCase, LlmError> {
    let check = |out: &Value| {
        let costs =
            json!({ "costs_basis": out.get("costs_basis").cloned().unwrap_or(Value::Null) });
        check_number_provenance(&costs, input, PROVENANCE_SKIP)
    };
    run_structured(
        llm,
        JobKind::ProjectBusinessCase,
        ctx,
        "Write the business case for this proposed publication. Quote cost figures only from the input.",
        input,
        &project_business_case_schema(),
        &check,
    )
    .await
}

/// The planning window (game days, inclusive).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct DayWindow {
    pub from_day: u32,
    pub to_day: u32,
}

impl DayWindow {
    pub fn contains(&self, day: u64) -> bool {
        (u64::from(self.from_day)..=u64::from(self.to_day)).contains(&day)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WeeklyPlanInput {
    pub window: DayWindow,
    /// Seasonal calendar entries, audits, the KPI report, backlog and team.
    pub context: Value,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ItemProposal {
    pub kind: String,
    pub title: String,
    pub brief: String,
    pub workstream: Option<String>,
    pub priority: Priority,
    pub rationale: String,
    pub publish_day: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BigBet {
    pub title: String,
    pub why_ceo: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WeeklyPlan {
    pub week_theme: String,
    pub proposals: Vec<ItemProposal>,
    pub big_bets: Vec<BigBet>,
    pub plan_ops: Vec<PlanOp>,
}

pub fn weekly_plan_schema() -> Value {
    job_schema(json!({
        "week_theme": text(),
        "proposals": {"type": "array", "minItems": 1, "items": closed_object(json!({
            "kind": text(),
            "title": text(),
            "brief": text(),
            "workstream": {"type": ["string", "null"]},
            "priority": one_of(&["urgent", "high", "normal", "low"]),
            "rationale": text(),
            "publish_day": {"type": ["integer", "null"], "minimum": 0}
        }))},
        "big_bets": {"type": "array", "items": closed_object(json!({
            "title": text(), "why_ceo": text()
        }))},
    }))
}

pub fn weekly_plan_check(input: &WeeklyPlanInput, out: &Value) -> Result<(), Vec<String>> {
    let mut e = Vec::new();
    if let Some(ps) = out.get("proposals").and_then(Value::as_array) {
        for (i, p) in ps.iter().enumerate() {
            if let Some(d) = p.get("publish_day").and_then(Value::as_u64) {
                if d < u64::from(input.window.from_day) {
                    e.push(format!(
                        "/proposals/{i}/publish_day: day {d} is in the past (window starts at day {})",
                        input.window.from_day
                    ));
                }
            }
        }
    }
    finish(e)
}

pub async fn weekly_plan(
    llm: &dyn Llm,
    ctx: JobCtx<'_>,
    input: &WeeklyPlanInput,
) -> Result<WeeklyPlan, LlmError> {
    let check = |out: &Value| weekly_plan_check(input, out);
    run_structured(
        llm,
        JobKind::WeeklyPlan,
        ctx,
        "Propose this week's work items for the Monday editorial board.",
        input,
        &weekly_plan_schema(),
        &check,
    )
    .await
}

/// Which roles may take a phase of a given kind (`None`: any team member).
pub fn phase_roles(phase: &str) -> Option<&'static [Role]> {
    Some(match phase {
        "research" | "outline" | "draft" | "revise" => &[
            Role::Writer,
            Role::Editor,
            Role::EditorInChief,
            Role::Analyst,
        ],
        "review" | "edit" => &[Role::Editor, Role::EditorInChief],
        "fact-check" | "qa" => &[Role::FactChecker, Role::Editor],
        "media" | "photos" | "shoot" => {
            &[Role::Photographer, Role::PhotoEditor, Role::VideoProducer]
        }
        "links" | "seo" => &[Role::SeoSpecialist, Role::MarketingManager],
        "layout" | "design" | "site-change" => {
            &[Role::WebDeveloper, Role::UxDesigner, Role::ArtDirector]
        }
        "translation" | "translate" => &[Role::Translator],
        "deploy" | "ops" => &[Role::ItEngineer, Role::DevOps],
        "publish" => &[Role::EditorInChief, Role::Editor],
        _ => return None,
    })
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BoardPhase {
    pub kind: String,
    #[serde(default)]
    pub assignee: Option<String>,
    pub estimate_min: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BoardItem {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub phases: Vec<BoardPhase>,
    #[serde(default)]
    pub depends_on: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BoardMember {
    pub id: String,
    pub name: String,
    pub role: Role,
    /// Current load, percent of their allocation.
    pub load_pct: u8,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlanScheduleInput {
    pub window: DayWindow,
    pub items: Vec<BoardItem>,
    pub team: Vec<BoardMember>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Assignment {
    pub item: String,
    pub phase: String,
    pub assignee: String,
    pub due_day: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PublishDate {
    pub item: String,
    pub publish_day: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Deferred {
    pub item: String,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlanSchedule {
    pub assignments: Vec<Assignment>,
    pub publish_dates: Vec<PublishDate>,
    pub deferred: Vec<Deferred>,
    pub plan_ops: Vec<PlanOp>,
}

pub fn plan_schedule_schema(input: &PlanScheduleInput) -> Value {
    let items: Vec<&str> = input.items.iter().map(|i| i.id.as_str()).collect();
    let team: Vec<&str> = input.team.iter().map(|m| m.id.as_str()).collect();
    let day = json!({"type": "integer", "minimum": input.window.from_day, "maximum": input.window.to_day});
    job_schema(json!({
        "assignments": {"type": "array", "items": closed_object(json!({
            "item": one_of(&items), "phase": text(), "assignee": one_of(&team), "due_day": day.clone()
        }))},
        "publish_dates": {"type": "array", "items": closed_object(json!({
            "item": one_of(&items), "publish_day": day
        }))},
        "deferred": {"type": "array", "items": closed_object(json!({
            "item": one_of(&items), "reason": text()
        }))},
    }))
}

/// Semantic checks for the EiC's schedule: phases exist on their items,
/// assignees' roles can do the phase, days are in the window, and no item is
/// both scheduled and deferred.
pub fn plan_schedule_check(input: &PlanScheduleInput, out: &Value) -> Result<(), Vec<String>> {
    let mut e = Vec::new();
    let sched: PlanSchedule = match serde_json::from_value(out.clone()) {
        Ok(s) => s,
        Err(err) => return Err(vec![err.to_string()]),
    };
    let mut scheduled = BTreeSet::new();
    for (i, a) in sched.assignments.iter().enumerate() {
        let Some(item) = input.items.iter().find(|x| x.id == a.item) else {
            e.push(format!("/assignments/{i}: unknown item {:?}", a.item));
            continue;
        };
        if !item.phases.iter().any(|p| p.kind == a.phase) {
            e.push(format!(
                "/assignments/{i}: item {} has no phase {:?}",
                a.item, a.phase
            ));
        }
        match input.team.iter().find(|m| m.id == a.assignee) {
            None => e.push(format!(
                "/assignments/{i}: {} is not on the team",
                a.assignee
            )),
            Some(m) => {
                if let Some(roles) = phase_roles(&a.phase) {
                    if !roles.contains(&m.role) {
                        e.push(format!(
                            "/assignments/{i}: {} is a {}, who cannot take a {} phase",
                            m.name, m.role, a.phase
                        ));
                    }
                }
            }
        }
        if !input.window.contains(a.due_day.into()) {
            e.push(format!(
                "/assignments/{i}: due_day {} is outside the window",
                a.due_day
            ));
        }
        scheduled.insert(a.item.as_str());
    }
    for (i, d) in sched.deferred.iter().enumerate() {
        if scheduled.contains(d.item.as_str()) {
            e.push(format!(
                "/deferred/{i}: item {} is both scheduled and deferred",
                d.item
            ));
        }
    }
    finish(e)
}

pub async fn plan_schedule(
    llm: &dyn Llm,
    ctx: JobCtx<'_>,
    input: &PlanScheduleInput,
) -> Result<PlanSchedule, LlmError> {
    let check = |out: &Value| plan_schedule_check(input, out);
    run_structured(
        llm,
        JobKind::PlanSchedule,
        ctx,
        "Schedule and assign this week's work items for the project team.",
        input,
        &plan_schedule_schema(input),
        &check,
    )
    .await
}
