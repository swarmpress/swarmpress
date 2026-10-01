//! The Inbox and the executive office (organization.md §7, ADR-0028).
//!
//! QuestionTickets are the only channel to the CEO. Every ticket has options,
//! a `default_option` and a `deadline_step`; when the deadline passes the
//! default applies ([`World::expire_tickets`]), so an offline company never
//! stalls.
//!
//! Triage: with an Executive Secretary employed every new ticket is routed
//! through them (`routed_via_secretary`), gets a proposed option, and is
//! answered by the Secretary when the CEO's [`DelegationPolicy`] covers its
//! priority, never when it is High and never when it is financial and above
//! [`FINANCIAL_DELEGATION_THRESHOLD_CENTS`]. Without a Secretary tickets
//! arrive untriaged (priority is still computed by rule) and `Delegate` is
//! rejected.
//!
//! Delegated tasks ([`SecretaryTaskKind`]) queue FIFO; one runs at a time for
//! its duration in game minutes. Text parts (summaries, briefings, drafts)
//! are LLM jobs that arrive with the job queue (M2); the sim effects below
//! are deterministic and complete now.

use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};

use crate::clock::{hm, MINUTES_PER_DAY};
use crate::commands::OvertimePolicy;
use crate::ids::{JobId, ProjectId, StaffId, TaskId, TicketId};
use crate::projects::ProjectStatus;
use crate::roles::Role;
use crate::world::{MeetingKind, World};

/// Financial tickets above this amount always reach the CEO, cents (€5 000).
pub const FINANCIAL_DELEGATION_THRESHOLD_CENTS: i64 = 500_000;
/// Most delegated tasks waiting at once.
pub const MAX_SECRETARY_QUEUE: usize = 16;
/// Finished tasks kept for the UI.
pub const DONE_TASKS_KEPT: usize = 16;
/// Resolved tickets kept for the Inbox history.
pub const RESOLVED_TICKETS_KEPT: usize = 64;
/// Most attendees of a delegated meeting.
pub const MAX_MEETING_ATTENDEES: usize = 12;
/// Length of a meeting the Secretary schedules, minutes.
pub const SCHEDULED_MEETING_MINUTES: u16 = 30;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum TicketKind {
    #[serde(alias = "budget-overrun")]
    BudgetOverrun,
    #[serde(alias = "runway-low")]
    RunwayLow,
    #[serde(alias = "payroll-spike")]
    PayrollSpike,
    #[serde(alias = "loan-offer")]
    LoanOffer,
    #[serde(alias = "missing-role")]
    MissingRole,
    #[serde(alias = "hire-affordability")]
    HireAffordability,
    #[serde(alias = "project-proposal")]
    ProjectProposal,
    #[serde(alias = "escalation")]
    Escalation,
}

impl TicketKind {
    pub const ALL: [TicketKind; 8] = [
        TicketKind::BudgetOverrun,
        TicketKind::RunwayLow,
        TicketKind::PayrollSpike,
        TicketKind::LoanOffer,
        TicketKind::MissingRole,
        TicketKind::HireAffordability,
        TicketKind::ProjectProposal,
        TicketKind::Escalation,
    ];

    pub const fn slug(self) -> &'static str {
        match self {
            TicketKind::BudgetOverrun => "budget-overrun",
            TicketKind::RunwayLow => "runway-low",
            TicketKind::PayrollSpike => "payroll-spike",
            TicketKind::LoanOffer => "loan-offer",
            TicketKind::MissingRole => "missing-role",
            TicketKind::HireAffordability => "hire-affordability",
            TicketKind::ProjectProposal => "project-proposal",
            TicketKind::Escalation => "escalation",
        }
    }

    /// Priority by rule (§7): High for legal, financial alarms, high-risk
    /// and critical blockers; Medium for strategy and resourcing; Low for
    /// information. A new publication is a big bet (RACI: the CEO is
    /// accountable), so proposals are High and never delegated.
    pub const fn priority(self) -> Priority {
        match self {
            TicketKind::BudgetOverrun
            | TicketKind::RunwayLow
            | TicketKind::LoanOffer
            | TicketKind::ProjectProposal
            | TicketKind::Escalation => Priority::High,
            TicketKind::PayrollSpike | TicketKind::MissingRole => Priority::Medium,
            TicketKind::HireAffordability => Priority::Low,
        }
    }

    /// Carries money; delegation stops at the threshold.
    pub const fn is_financial(self) -> bool {
        matches!(
            self,
            TicketKind::BudgetOverrun
                | TicketKind::RunwayLow
                | TicketKind::PayrollSpike
                | TicketKind::LoanOffer
                | TicketKind::HireAffordability
        )
    }

    /// Options, the default first among equals.
    pub const fn options(self) -> &'static [TicketOption] {
        use TicketOption::*;
        match self {
            TicketKind::BudgetOverrun => &[ApproveOverrun, CutScope],
            TicketKind::RunwayLow => &[Acknowledge, CutCosts],
            TicketKind::PayrollSpike => &[Acknowledge, CutCosts],
            TicketKind::LoanOffer => &[TakeLoan, CutCosts],
            TicketKind::MissingRole => &[ArrangeHiring, Ignore],
            TicketKind::HireAffordability => &[Acknowledge, CutCosts],
            TicketKind::ProjectProposal => &[Approve, Reject],
            TicketKind::Escalation => &[Retry, Kill],
        }
    }

    /// Applied when the deadline passes.
    pub const fn default_option(self) -> TicketOption {
        match self {
            TicketKind::BudgetOverrun => TicketOption::CutScope,
            TicketKind::RunwayLow | TicketKind::PayrollSpike | TicketKind::HireAffordability => {
                TicketOption::Acknowledge
            }
            TicketKind::LoanOffer => TicketOption::CutCosts,
            TicketKind::MissingRole => TicketOption::ArrangeHiring,
            TicketKind::ProjectProposal => TicketOption::Reject,
            TicketKind::Escalation => TicketOption::Kill,
        }
    }

    /// Game days until the default applies.
    pub const fn deadline_days(self) -> u64 {
        match self {
            TicketKind::MissingRole | TicketKind::ProjectProposal => 2,
            _ => 1,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum Priority {
    #[serde(alias = "low")]
    Low,
    #[serde(alias = "medium")]
    Medium,
    #[serde(alias = "high")]
    High,
}

impl Priority {
    pub const fn slug(self) -> &'static str {
        match self {
            Priority::Low => "low",
            Priority::Medium => "medium",
            Priority::High => "high",
        }
    }
}

/// A ticket answer. Effects ([`World::resolve_ticket`]):
/// - `ApproveOverrun`: the project's monthly budget rises by 20%;
/// - `CutScope`: recorded; scope cuts act on work items (publishing plan);
/// - `Acknowledge`, `Ignore`, `Retry`, `Kill`: recorded only (no work items
///   or jobs exist in the sim yet);
/// - `CutCosts`: overtime policy becomes Never;
/// - `TakeLoan`: the bank loan of the ticket's amount is paid out;
/// - `ArrangeHiring`: a candidate for the missing role joins today's
///   shortlist;
/// - `Approve` / `Reject`: the proposed project becomes Active / Archived.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum TicketOption {
    #[serde(alias = "approve-overrun")]
    ApproveOverrun,
    #[serde(alias = "cut-scope")]
    CutScope,
    #[serde(alias = "acknowledge")]
    Acknowledge,
    #[serde(alias = "cut-costs")]
    CutCosts,
    #[serde(alias = "take-loan")]
    TakeLoan,
    #[serde(alias = "arrange-hiring")]
    ArrangeHiring,
    #[serde(alias = "ignore")]
    Ignore,
    #[serde(alias = "approve")]
    Approve,
    #[serde(alias = "reject")]
    Reject,
    #[serde(alias = "retry")]
    Retry,
    #[serde(alias = "kill")]
    Kill,
}

impl TicketOption {
    pub const fn slug(self) -> &'static str {
        match self {
            TicketOption::ApproveOverrun => "approve-overrun",
            TicketOption::CutScope => "cut-scope",
            TicketOption::Acknowledge => "acknowledge",
            TicketOption::CutCosts => "cut-costs",
            TicketOption::TakeLoan => "take-loan",
            TicketOption::ArrangeHiring => "arrange-hiring",
            TicketOption::Ignore => "ignore",
            TicketOption::Approve => "approve",
            TicketOption::Reject => "reject",
            TicketOption::Retry => "retry",
            TicketOption::Kill => "kill",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum TicketStatus {
    Open,
    Answered,
    Expired,
}

impl TicketStatus {
    pub const fn slug(self) -> &'static str {
        match self {
            TicketStatus::Open => "open",
            TicketStatus::Answered => "answered",
            TicketStatus::Expired => "expired",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum ResolvedBy {
    Ceo,
    Secretary,
    /// The deadline passed; the default option applied.
    Default,
}

impl ResolvedBy {
    pub const fn slug(self) -> &'static str {
        match self {
            ResolvedBy::Ceo => "ceo",
            ResolvedBy::Secretary => "secretary",
            ResolvedBy::Default => "default",
        }
    }
}

/// A QuestionTicket.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Ticket {
    pub id: TicketId,
    pub kind: TicketKind,
    pub priority: Priority,
    pub project: Option<ProjectId>,
    /// Who raised it (`None`: the system).
    pub from: Option<StaffId>,
    /// The role a `missing-role` ticket is about.
    pub role: Option<Role>,
    /// Money at stake, cents (financial tickets).
    pub amount_cents: i64,
    /// The Secretary's summary (an LLM job, M2). `None` until it exists.
    pub summary_ref: Option<JobId>,
    pub options: Vec<TicketOption>,
    pub default_option: TicketOption,
    /// The Secretary's proposal (triaged tickets only).
    pub proposed_option: Option<TicketOption>,
    /// A reply was drafted by the Secretary (`DraftReply`).
    pub reply_drafted: bool,
    pub created_step: u64,
    pub deadline_step: u64,
    pub routed_via_secretary: bool,
    pub status: TicketStatus,
    pub resolved_by: Option<ResolvedBy>,
    pub answer: Option<TicketOption>,
    pub resolved_step: Option<u64>,
}

impl Ticket {
    pub fn is_open(&self) -> bool {
        self.status == TicketStatus::Open
    }

    /// Financial and above the threshold: always the CEO's call.
    pub fn over_threshold(&self) -> bool {
        self.kind.is_financial() && self.amount_cents > FINANCIAL_DELEGATION_THRESHOLD_CENTS
    }
}

/// What a ticket is about, before it gets an id and rules applied.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TicketSpec {
    pub kind: TicketKind,
    pub project: Option<ProjectId>,
    pub from: Option<StaffId>,
    pub role: Option<Role>,
    pub amount_cents: i64,
}

/// How much of the Inbox the Secretary may answer.
#[derive(
    Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize,
)]
pub enum DelegationPolicy {
    /// The CEO answers everything.
    #[default]
    #[serde(alias = "off")]
    Off,
    /// The Secretary answers Low tickets with the proposed option.
    #[serde(alias = "low")]
    Low,
    /// … and Medium ones.
    #[serde(alias = "low-and-medium")]
    LowAndMedium,
}

impl DelegationPolicy {
    pub const fn slug(self) -> &'static str {
        match self {
            DelegationPolicy::Off => "off",
            DelegationPolicy::Low => "low",
            DelegationPolicy::LowAndMedium => "low-and-medium",
        }
    }

    /// Whether this policy covers a priority. High is never covered.
    pub const fn covers(self, p: Priority) -> bool {
        matches!(
            (self, p),
            (DelegationPolicy::Low, Priority::Low)
                | (
                    DelegationPolicy::LowAndMedium,
                    Priority::Low | Priority::Medium
                )
        )
    }
}

/// The CEO's office: two named people and the delegation setting.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExecutiveOffice {
    pub cfo: Option<StaffId>,
    pub secretary: Option<StaffId>,
    pub delegation: DelegationPolicy,
    /// Morning briefings prepared so far.
    pub briefings_prepared: u32,
    pub last_briefing_day: Option<u32>,
    /// Day the 08:30 briefing task was last queued.
    pub briefing_queued_day: Option<u32>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum FollowUpTopic {
    #[serde(alias = "morale")]
    Morale,
    #[serde(alias = "workload")]
    Workload,
    #[serde(alias = "performance")]
    Performance,
    #[serde(alias = "salary")]
    Salary,
}

/// What the CEO can delegate (`Command::Delegate`). Agenda text and other
/// prose stay outside the sim.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum SecretaryTaskKind {
    /// Triage every untriaged open ticket.
    TriageInbox,
    /// Book a 30-minute meeting at the next free half hour.
    ScheduleMeeting {
        attendees: Vec<StaffId>,
        project: Option<ProjectId>,
    },
    /// Morning brief: what happened, decisions due, budget status.
    PrepareBriefing { project: Option<ProjectId> },
    /// Draft a reply to a ticket.
    DraftReply { ticket: TicketId },
    /// Ask for a candidate for a role.
    ArrangeHiring {
        role: Role,
        project: Option<ProjectId>,
    },
    /// Check in with someone.
    FollowUp {
        staff: StaffId,
        topic: FollowUpTopic,
    },
}

impl SecretaryTaskKind {
    pub const fn slug(&self) -> &'static str {
        match self {
            SecretaryTaskKind::TriageInbox => "triage-inbox",
            SecretaryTaskKind::ScheduleMeeting { .. } => "schedule-meeting",
            SecretaryTaskKind::PrepareBriefing { .. } => "prepare-briefing",
            SecretaryTaskKind::DraftReply { .. } => "draft-reply",
            SecretaryTaskKind::ArrangeHiring { .. } => "arrange-hiring",
            SecretaryTaskKind::FollowUp { .. } => "follow-up",
        }
    }

    /// How long the Secretary works on it, game minutes.
    pub const fn duration_minutes(&self) -> u16 {
        match self {
            SecretaryTaskKind::TriageInbox | SecretaryTaskKind::PrepareBriefing { .. } => 30,
            SecretaryTaskKind::ScheduleMeeting { .. } => 15,
            SecretaryTaskKind::DraftReply { .. } => 20,
            SecretaryTaskKind::ArrangeHiring { .. } => 120,
            SecretaryTaskKind::FollowUp { .. } => 30,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum TaskStatus {
    Queued,
    Working,
    Done,
}

impl TaskStatus {
    pub const fn slug(self) -> &'static str {
        match self {
            TaskStatus::Queued => "queued",
            TaskStatus::Working => "working",
            TaskStatus::Done => "done",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SecretaryTask {
    pub id: TaskId,
    pub kind: SecretaryTaskKind,
    pub status: TaskStatus,
    pub created_step: u64,
    pub started_step: Option<u64>,
    /// When a working task completes.
    pub due_step: Option<u64>,
    pub done_step: Option<u64>,
}

impl World {
    /// The Executive Secretary, if one is employed.
    pub fn secretary(&self) -> Option<StaffId> {
        self.exec.secretary
    }

    pub fn has_open_ticket(&self, kind: TicketKind) -> bool {
        self.tickets.values().any(|t| t.is_open() && t.kind == kind)
    }

    /// Opens a ticket: rules set priority, options, default and deadline;
    /// the Secretary (if any) triages and, under delegation, answers it.
    pub fn raise_ticket(&mut self, spec: TicketSpec) -> TicketId {
        let id = self.ids.ticket();
        let days = spec.kind.deadline_days();
        let deadline = self.step + days * self.config.steps_per_day();
        let triaged = self.exec.secretary.is_some();
        let t = Ticket {
            id,
            kind: spec.kind,
            priority: spec.kind.priority(),
            project: spec.project,
            from: spec.from,
            role: spec.role,
            amount_cents: spec.amount_cents,
            summary_ref: None,
            options: spec.kind.options().to_vec(),
            default_option: spec.kind.default_option(),
            proposed_option: triaged.then(|| spec.kind.default_option()),
            reply_drafted: false,
            created_step: self.step,
            deadline_step: deadline,
            routed_via_secretary: triaged,
            status: TicketStatus::Open,
            resolved_by: None,
            answer: None,
            resolved_step: None,
        };
        self.tickets.insert(id, t);
        self.secretary_answers();
        id
    }

    /// Whether the Secretary may answer this ticket now.
    pub fn secretary_may_answer(&self, t: &Ticket) -> bool {
        self.exec.secretary.is_some()
            && t.is_open()
            && t.routed_via_secretary
            && t.priority != Priority::High
            && !t.over_threshold()
            && self.exec.delegation.covers(t.priority)
    }

    /// Answers every ticket the delegation policy covers with the
    /// Secretary's proposed option.
    pub(crate) fn secretary_answers(&mut self) {
        let due: Vec<(TicketId, TicketOption)> = self
            .tickets
            .values()
            .filter(|t| self.secretary_may_answer(t))
            .map(|t| (t.id, t.proposed_option.unwrap_or(t.default_option)))
            .collect();
        for (id, option) in due {
            if self.option_feasible(id, option).is_ok() {
                self.resolve_ticket(id, option, ResolvedBy::Secretary);
            }
        }
    }

    /// Applies the default option of every open ticket past its deadline.
    pub(crate) fn expire_tickets(&mut self) {
        let step = self.step;
        let due: Vec<(TicketId, TicketOption)> = self
            .tickets
            .values()
            .filter(|t| t.is_open() && t.deadline_step <= step)
            .map(|t| (t.id, t.default_option))
            .collect();
        for (id, option) in due {
            self.resolve_ticket(id, option, ResolvedBy::Default);
        }
    }

    /// Whether `option` can be applied to ticket `id` now (pure).
    pub(crate) fn option_feasible(
        &self,
        id: TicketId,
        option: TicketOption,
    ) -> Result<(), &'static str> {
        let t = self.tickets.get(&id).ok_or("unknown ticket")?;
        match option {
            TicketOption::Approve => {
                let p = t
                    .project
                    .and_then(|p| self.projects.get(&p))
                    .ok_or("the proposal has no project")?;
                if !p.status.can_become(ProjectStatus::Active) {
                    return Err("the project cannot become active");
                }
                Ok(())
            }
            TicketOption::TakeLoan if self.company.loan.is_some() => {
                Err("a loan is already outstanding")
            }
            TicketOption::TakeLoan if t.amount_cents <= 0 => Err("nothing to borrow"),
            _ => Ok(()),
        }
    }

    /// Closes a ticket with `option` and applies its effect. The default
    /// path never fails: an infeasible effect is skipped (recorded only).
    pub(crate) fn resolve_ticket(&mut self, id: TicketId, option: TicketOption, by: ResolvedBy) {
        let feasible = self.option_feasible(id, option).is_ok();
        let step = self.step;
        let Some(t) = self.tickets.get_mut(&id) else {
            return;
        };
        if !t.is_open() {
            return;
        }
        t.status = if by == ResolvedBy::Default {
            TicketStatus::Expired
        } else {
            TicketStatus::Answered
        };
        t.resolved_by = Some(by);
        t.answer = Some(option);
        t.resolved_step = Some(step);
        let (project, role, amount) = (t.project, t.role, t.amount_cents);
        if feasible {
            self.apply_option(option, project, role, amount);
        }
        self.prune_tickets();
    }

    fn apply_option(
        &mut self,
        option: TicketOption,
        project: Option<ProjectId>,
        role: Option<Role>,
        amount: i64,
    ) {
        match option {
            TicketOption::ApproveOverrun => {
                if let Some(p) = project.and_then(|p| self.projects.get_mut(&p)) {
                    p.budget_monthly_cents += p.budget_monthly_cents / 5;
                }
            }
            TicketOption::CutCosts => {
                self.company.policies.overtime = OvertimePolicy::Never;
            }
            TicketOption::TakeLoan => self.take_loan(amount),
            TicketOption::ArrangeHiring => {
                if let Some(r) = role {
                    self.add_candidate_for_role(r);
                }
            }
            TicketOption::Approve => {
                if let Some(p) = project {
                    self.set_project_status(p, ProjectStatus::Active);
                }
            }
            TicketOption::Reject => {
                if let Some(p) = project {
                    self.set_project_status(p, ProjectStatus::Archived);
                }
            }
            TicketOption::CutScope
            | TicketOption::Acknowledge
            | TicketOption::Ignore
            | TicketOption::Retry
            | TicketOption::Kill => {}
        }
    }

    /// Closes an open proposal ticket for `project` when the CEO decides the
    /// status directly.
    pub(crate) fn close_proposal_ticket(&mut self, project: ProjectId, approved: bool) {
        let step = self.step;
        for t in self.tickets.values_mut() {
            if t.is_open() && t.kind == TicketKind::ProjectProposal && t.project == Some(project) {
                t.status = TicketStatus::Answered;
                t.resolved_by = Some(ResolvedBy::Ceo);
                t.answer = Some(if approved {
                    TicketOption::Approve
                } else {
                    TicketOption::Reject
                });
                t.resolved_step = Some(step);
            }
        }
    }

    fn prune_tickets(&mut self) {
        let resolved: Vec<TicketId> = self
            .tickets
            .values()
            .filter(|t| !t.is_open())
            .map(|t| t.id)
            .collect();
        if resolved.len() > RESOLVED_TICKETS_KEPT {
            for id in &resolved[..resolved.len() - RESOLVED_TICKETS_KEPT] {
                self.tickets.remove(id);
            }
        }
    }

    /// Queues a delegated task.
    pub(crate) fn enqueue_task(&mut self, kind: SecretaryTaskKind) -> TaskId {
        let id = self.ids.task();
        self.secretary_tasks.insert(
            id,
            SecretaryTask {
                id,
                kind,
                status: TaskStatus::Queued,
                created_step: self.step,
                started_step: None,
                due_step: None,
                done_step: None,
            },
        );
        id
    }

    /// Tasks not yet done.
    pub fn pending_tasks(&self) -> usize {
        self.secretary_tasks
            .values()
            .filter(|t| t.status != TaskStatus::Done)
            .count()
    }

    /// Advances the Secretary's queue: finishes the working task when due,
    /// then starts the next one.
    pub(crate) fn process_secretary(&mut self) {
        if self.exec.secretary.is_none() {
            return;
        }
        let step = self.step;
        let working = self
            .secretary_tasks
            .values()
            .find(|t| t.status == TaskStatus::Working)
            .map(|t| (t.id, t.due_step.unwrap_or(0)));
        match working {
            Some((id, due)) if step >= due => self.finish_task(id),
            Some(_) => return,
            None => {}
        }
        let next = self
            .secretary_tasks
            .values()
            .find(|t| t.status == TaskStatus::Queued)
            .map(|t| (t.id, t.kind.duration_minutes()));
        if let Some((id, minutes)) = next {
            let steps = self.minutes_to_steps(minutes);
            if let Some(t) = self.secretary_tasks.get_mut(&id) {
                t.status = TaskStatus::Working;
                t.started_step = Some(step);
                t.due_step = Some(step + steps);
            }
        }
    }

    /// Game minutes → steps (at least one).
    pub fn minutes_to_steps(&self, minutes: u16) -> u64 {
        (u64::from(minutes) * self.config.steps_per_day() / MINUTES_PER_DAY).max(1)
    }

    fn finish_task(&mut self, id: TaskId) {
        let step = self.step;
        let Some(kind) = self.secretary_tasks.get(&id).map(|t| t.kind.clone()) else {
            return;
        };
        match kind {
            SecretaryTaskKind::TriageInbox => {
                for t in self.tickets.values_mut().filter(|t| t.is_open()) {
                    if !t.routed_via_secretary {
                        t.routed_via_secretary = true;
                        t.proposed_option = Some(t.default_option);
                    }
                }
                self.secretary_answers();
            }
            SecretaryTaskKind::ScheduleMeeting { attendees, project } => {
                let attendees: BTreeSet<StaffId> = attendees
                    .into_iter()
                    .filter(|s| self.staff.get(s).is_some_and(|s| s.is_active()))
                    .collect();
                self.schedule_meeting(attendees, project);
            }
            SecretaryTaskKind::PrepareBriefing { .. } => {
                let day = self.clock().day;
                self.exec.briefings_prepared += 1;
                self.exec.last_briefing_day = Some(day);
            }
            SecretaryTaskKind::DraftReply { ticket } => {
                if let Some(t) = self.tickets.get_mut(&ticket) {
                    if t.is_open() {
                        t.reply_drafted = true;
                        t.proposed_option.get_or_insert(t.default_option);
                    }
                }
            }
            SecretaryTaskKind::ArrangeHiring { role, .. } => self.add_candidate_for_role(role),
            SecretaryTaskKind::FollowUp { staff, topic } => {
                let bonus = if topic == FollowUpTopic::Morale {
                    40
                } else {
                    20
                };
                if let Some(s) = self.staff.get_mut(&staff) {
                    s.morale = s.morale.saturating_add(bonus).min(1000);
                }
            }
        }
        if let Some(t) = self.secretary_tasks.get_mut(&id) {
            t.status = TaskStatus::Done;
            t.done_step = Some(step);
        }
        let done: Vec<TaskId> = self
            .secretary_tasks
            .values()
            .filter(|t| t.status == TaskStatus::Done)
            .map(|t| t.id)
            .collect();
        if done.len() > DONE_TASKS_KEPT {
            for id in &done[..done.len() - DONE_TASKS_KEPT] {
                self.secretary_tasks.remove(id);
            }
        }
    }

    /// Books a 30-minute meeting at the next free half hour between 10:00
    /// and 17:30 (today, else tomorrow 10:00) in the first meeting room.
    fn schedule_meeting(&mut self, attendees: BTreeSet<StaffId>, project: Option<ProjectId>) {
        if attendees.is_empty() {
            return;
        }
        let Some(room) = self.building.meeting_rooms().first().copied() else {
            return;
        };
        let now = self.clock();
        let earliest = (now.minute / 30 + 1) * 30;
        let (day, start) = if earliest.max(hm(10, 0)) + SCHEDULED_MEETING_MINUTES <= hm(17, 30) {
            (now.day, earliest.max(hm(10, 0)))
        } else {
            (now.day + 1, hm(10, 0))
        };
        // avoid double-booking the room
        let mut start = start;
        while self.meetings.values().any(|m| {
            m.room == room
                && m.day == day
                && m.start < start + SCHEDULED_MEETING_MINUTES
                && start < m.end
        }) {
            start += 30;
        }
        if start + SCHEDULED_MEETING_MINUTES > hm(18, 0) {
            return;
        }
        self.open_meeting(
            MeetingKind::Scheduled,
            project,
            room,
            day,
            start,
            start + SCHEDULED_MEETING_MINUTES,
            attendees,
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rules_are_consistent() {
        for k in TicketKind::ALL {
            assert!(k.options().contains(&k.default_option()), "{k:?}");
            assert!(k.deadline_days() >= 1);
            assert!(!k.slug().is_empty());
        }
        assert_eq!(TicketKind::BudgetOverrun.priority(), Priority::High);
        assert_eq!(TicketKind::HireAffordability.priority(), Priority::Low);
        assert_eq!(TicketKind::MissingRole.priority(), Priority::Medium);
    }

    #[test]
    fn delegation_never_covers_high() {
        for p in [
            DelegationPolicy::Off,
            DelegationPolicy::Low,
            DelegationPolicy::LowAndMedium,
        ] {
            assert!(!p.covers(Priority::High));
        }
        assert!(DelegationPolicy::Low.covers(Priority::Low));
        assert!(!DelegationPolicy::Low.covers(Priority::Medium));
        assert!(DelegationPolicy::LowAndMedium.covers(Priority::Medium));
        assert!(!DelegationPolicy::Off.covers(Priority::Low));
    }

    #[test]
    fn options_accept_slugs_in_json() {
        let o: TicketOption = serde_json::from_str("\"cut-scope\"").unwrap();
        assert_eq!(o, TicketOption::CutScope);
        let o: TicketOption = serde_json::from_str("\"CutScope\"").unwrap();
        assert_eq!(o, TicketOption::CutScope);
        let d: DelegationPolicy = serde_json::from_str("\"low-and-medium\"").unwrap();
        assert_eq!(d, DelegationPolicy::LowAndMedium);
    }

    #[test]
    fn task_durations() {
        assert_eq!(SecretaryTaskKind::TriageInbox.duration_minutes(), 30);
        assert_eq!(
            SecretaryTaskKind::PrepareBriefing { project: None }.slug(),
            "prepare-briefing"
        );
    }
}
