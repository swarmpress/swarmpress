//! Executive Office jobs: the CFO's `FinanceReport` and
//! `HiringAffordability` (organization.md §6) and the Secretary's
//! `SecretaryTriage`, `CeoBriefing`, `DraftReply` and `ThreadSummary` (§7,
//! publishing-plan.md §3).

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::{
    check_number_provenance, finish, job_schema, one_of, run_structured, text, texts, JobCtx,
};
use crate::llm::{Llm, LlmError};
use crate::plan::PlanOp;
use crate::roles::JobKind;

/// Structural numbers exempt from the provenance check (review scores in
/// plan ops). Text inside plan ops is checked like everything else.
pub const PROVENANCE_SKIP: &[&str] = &["score"];

// ---------------------------------------------------------------------------
// CFO
// ---------------------------------------------------------------------------

/// The CFO's monthly narrative. Every figure in it comes from the input.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FinanceReport {
    pub headline: String,
    pub observations: Vec<String>,
    pub risks: Vec<String>,
    pub recommendations: Vec<String>,
    pub plan_ops: Vec<PlanOp>,
}

pub fn finance_report_schema() -> Value {
    job_schema(json!({
        "headline": text(),
        "observations": texts(1),
        "risks": texts(0),
        "recommendations": texts(1),
    }))
}

/// Writes the monthly finance report from the month-close data (the sim's
/// `finance_json()` plus month-close records). Rejects (with repair turns on
/// Claude) any figure that is not in `data`.
pub async fn finance_report(
    llm: &dyn Llm,
    ctx: JobCtx<'_>,
    data: &Value,
) -> Result<FinanceReport, LlmError> {
    let check = |out: &Value| check_number_provenance(out, data, PROVENANCE_SKIP);
    run_structured(
        llm,
        JobKind::FinanceReport,
        ctx,
        "Write the monthly finance report from the month-close data below. Use only figures that appear in it.",
        data,
        &finance_report_schema(),
        &check,
    )
    .await
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Affordability {
    Affordable,
    Tight,
    Unaffordable,
}

/// The CFO's note on a hire ticket.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HiringAffordability {
    pub verdict: Affordability,
    pub summary: String,
    pub payroll_note: String,
    pub runway_note: String,
    pub conditions: Vec<String>,
    pub plan_ops: Vec<PlanOp>,
}

pub fn hiring_affordability_schema() -> Value {
    job_schema(json!({
        "verdict": one_of(&["affordable", "tight", "unaffordable"]),
        "summary": text(),
        "payroll_note": text(),
        "runway_note": text(),
        "conditions": texts(0),
    }))
}

/// `data`: the candidate (role, seniority, asking salary) plus the company's
/// payroll, cash, burn and runway figures and any precomputed impact.
pub async fn hiring_affordability(
    llm: &dyn Llm,
    ctx: JobCtx<'_>,
    data: &Value,
) -> Result<HiringAffordability, LlmError> {
    let check = |out: &Value| check_number_provenance(out, data, PROVENANCE_SKIP);
    run_structured(
        llm,
        JobKind::HiringAffordability,
        ctx,
        "Assess whether the company can afford this hire, from the figures below only.",
        data,
        &hiring_affordability_schema(),
        &check,
    )
    .await
}

// ---------------------------------------------------------------------------
// Secretary
// ---------------------------------------------------------------------------

/// Ticket priority (organization.md §7; the legacy CEO-assistant rubric).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TicketPriority {
    Low,
    Medium,
    High,
}

/// Tags the orchestrator attaches to tickets from their kind and origin.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TicketTag {
    Legal,
    Financial,
    HighRisk,
    Blocker,
    Strategy,
    Resourcing,
    Policy,
    Informational,
}

impl TicketTag {
    /// Tags that force High priority (HIGH: legal, financial, high-risk,
    /// critical blockers).
    pub fn forces_high(self) -> bool {
        matches!(
            self,
            TicketTag::Legal | TicketTag::Financial | TicketTag::HighRisk | TicketTag::Blocker
        )
    }
}

/// CEO delegation policy (organization.md §7).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Delegation {
    Off,
    Low,
    LowAndMedium,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TicketOption {
    pub id: String,
    pub label: String,
}

/// A ticket as the Secretary sees it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TicketInput {
    pub id: String,
    pub kind: String,
    /// Staff id or `"system"`.
    pub from: String,
    #[serde(default)]
    pub project: Option<String>,
    pub title: String,
    pub body: String,
    pub options: Vec<TicketOption>,
    pub default_option: String,
    #[serde(default)]
    pub tags: Vec<TicketTag>,
    #[serde(default)]
    pub deadline_minute: Option<u32>,
}

impl TicketInput {
    fn option_ids(&self) -> Vec<&str> {
        self.options.iter().map(|o| o.id.as_str()).collect()
    }
}

/// The Secretary's triage of one ticket.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TriageOutput {
    pub priority: TicketPriority,
    pub summary: String,
    pub proposed_option: String,
    pub reasoning: String,
    pub plan_ops: Vec<PlanOp>,
}

impl TriageOutput {
    /// Whether the Secretary may answer the ticket with the proposed option
    /// under `policy`. High priority and financial tickets always reach the
    /// CEO.
    pub fn secretary_may_answer(&self, ticket: &TicketInput, policy: Delegation) -> bool {
        if ticket.tags.contains(&TicketTag::Financial) {
            return false;
        }
        match (policy, self.priority) {
            (_, TicketPriority::High) | (Delegation::Off, _) => false,
            (Delegation::Low, p) => p == TicketPriority::Low,
            (Delegation::LowAndMedium, _) => true,
        }
    }
}

pub fn triage_schema(ticket: &TicketInput) -> Value {
    job_schema(json!({
        "priority": one_of(&["high", "medium", "low"]),
        "summary": text(),
        "proposed_option": one_of(&ticket.option_ids()),
        "reasoning": text(),
    }))
}

/// Deterministic floor of the rubric: a ticket tagged legal, financial,
/// high-risk or blocker must be triaged High.
pub fn triage_check(ticket: &TicketInput, out: &Value) -> Result<(), Vec<String>> {
    let mut e = Vec::new();
    let forced = ticket.tags.iter().find(|t| t.forces_high());
    if let Some(tag) = forced {
        if out.get("priority").and_then(Value::as_str) != Some("high") {
            e.push(format!(
                "/priority: the ticket is tagged {} and must be high (rubric: legal, financial, high-risk and critical blockers are HIGH)",
                serde_json::to_value(tag).ok().and_then(|v| v.as_str().map(str::to_owned)).unwrap_or_default()
            ));
        }
    }
    if let Some(s) = out.get("summary").and_then(Value::as_str) {
        if s.contains("\n\n") {
            e.push("/summary: write one paragraph".into());
        }
    }
    finish(e)
}

pub async fn secretary_triage(
    llm: &dyn Llm,
    ctx: JobCtx<'_>,
    ticket: &TicketInput,
) -> Result<TriageOutput, LlmError> {
    let check = |out: &Value| triage_check(ticket, out);
    run_structured(
        llm,
        JobKind::SecretaryTriage,
        ctx,
        "Triage this ticket for the CEO: priority by the rubric, a one-paragraph summary, and the option you propose.",
        ticket,
        &triage_schema(ticket),
        &check,
    )
    .await
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BriefingTicket {
    pub id: String,
    pub title: String,
    pub priority: TicketPriority,
    #[serde(default)]
    pub deadline_minute: Option<u32>,
}

/// Input of the CEO morning briefing.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BriefingInput {
    pub day: u32,
    /// What happened since the last briefing (one line each).
    pub events: Vec<String>,
    pub open_tickets: Vec<BriefingTicket>,
    /// The sim's `finance_json()` (or `null` without a CFO: "books not kept").
    pub finance: Value,
    #[serde(default)]
    pub project: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DecisionDue {
    pub ticket: String,
    pub summary: String,
    pub deadline_minute: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CeoBriefing {
    pub greeting: String,
    pub happened: Vec<String>,
    pub decisions_due: Vec<DecisionDue>,
    pub budget_status: String,
    pub suggested_focus: String,
    pub plan_ops: Vec<PlanOp>,
}

pub fn ceo_briefing_schema(input: &BriefingInput) -> Value {
    let ids: Vec<&str> = input.open_tickets.iter().map(|t| t.id.as_str()).collect();
    let ticket = if ids.is_empty() {
        json!({"type": "string", "enum": [""]})
    } else {
        one_of(&ids)
    };
    job_schema(json!({
        "greeting": text(),
        "happened": texts(0),
        "decisions_due": {"type": "array", "items": super::closed_object(json!({
            "ticket": ticket,
            "summary": text(),
            "deadline_minute": {"type": ["integer", "null"], "minimum": 0}
        }))},
        "budget_status": text(),
        "suggested_focus": text(),
    }))
}

pub async fn ceo_briefing(
    llm: &dyn Llm,
    ctx: JobCtx<'_>,
    input: &BriefingInput,
) -> Result<CeoBriefing, LlmError> {
    let data = serde_json::to_value(input).unwrap_or(Value::Null);
    let check = |out: &Value| check_number_provenance(out, &data, PROVENANCE_SKIP);
    run_structured(
        llm,
        JobKind::CeoBriefing,
        ctx,
        "Prepare the CEO's morning briefing: what happened, decisions due, budget status and a suggested focus. Use only figures from the data.",
        input,
        &ceo_briefing_schema(input),
        &check,
    )
    .await
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DraftReplyInput {
    pub ticket: TicketInput,
    /// The CEO's steer, if any ("say yes but cap the budget").
    #[serde(default)]
    pub ceo_notes: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DraftReply {
    pub option: String,
    pub reply: String,
    pub plan_ops: Vec<PlanOp>,
}

pub fn draft_reply_schema(input: &DraftReplyInput) -> Value {
    job_schema(json!({
        "option": one_of(&input.ticket.option_ids()),
        "reply": text(),
    }))
}

pub async fn draft_reply(
    llm: &dyn Llm,
    ctx: JobCtx<'_>,
    input: &DraftReplyInput,
) -> Result<DraftReply, LlmError> {
    run_structured(
        llm,
        JobKind::DraftReply,
        ctx,
        "Draft the CEO's reply to this ticket for the CEO to review.",
        input,
        &draft_reply_schema(input),
        &super::no_check,
    )
    .await
}

/// The Secretary's summary of a long work-item thread (ADR-0031).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ThreadSummary {
    pub summary: String,
    pub open_questions: Vec<String>,
    pub decisions: Vec<String>,
    pub next_steps: Vec<String>,
    pub plan_ops: Vec<PlanOp>,
}

pub fn thread_summary_schema() -> Value {
    job_schema(json!({
        "summary": text(),
        "open_questions": texts(0),
        "decisions": texts(0),
        "next_steps": texts(0),
    }))
}

/// Summarises the thread of `ctx.plan` (required). `older_posts` are the
/// posts not already in the context window, if the orchestrator passes them.
pub async fn thread_summary(
    llm: &dyn Llm,
    ctx: JobCtx<'_>,
    older_posts: &[crate::plan::PlanPost],
) -> Result<ThreadSummary, LlmError> {
    if ctx.plan.is_none() {
        return Err(LlmError::Backend(
            "thread-summary needs the work item's plan context".into(),
        ));
    }
    run_structured(
        llm,
        JobKind::ThreadSummary,
        ctx,
        "Summarise this work item's thread for colleagues joining it. Report only what the posts say.",
        &json!({ "older_posts": older_posts }),
        &thread_summary_schema(),
        &super::no_check,
    )
    .await
}
