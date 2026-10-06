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
//! The publish gate and the failure tickets (ADR-0059) are all High, so they
//! always reach the CEO: `PublishApproval` (whose default, `Defer`, never
//! publishes, and which the Secretary may never answer by rule as well),
//! `StandupFailed`, `DeployFailed`, `NeedsMedia` and `NeedsPage`. What an
//! option does is decided by the ticket's kind, not by the option alone.
//!
//! Delegated tasks ([`SecretaryTaskKind`]) queue FIFO; one runs at a time for
//! its duration in game minutes. Text parts (summaries, briefings, drafts)
//! are LLM jobs that arrive with the job queue (M2); the sim effects below
//! are deterministic and complete now.

use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};

use crate::clock::{hm, MINUTES_PER_DAY};
use crate::commands::{JobFailure, OvertimePolicy};
use crate::ids::{JobId, ProjectId, StaffId, TaskId, TicketId, WorkItemId};
use crate::plan::MAX_REVISIONS;
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
    /// An article passed its review and waits for the CEO's yes (ADR-0059).
    #[serde(alias = "publish-approval")]
    PublishApproval,
    /// A standup's job failed or timed out: no briefs that day.
    #[serde(alias = "standup-failed")]
    StandupFailed,
    /// The deploy carrying a merged article failed.
    #[serde(alias = "deploy-failed")]
    DeployFailed,
    /// A job needs media the site's index does not have (rule 5).
    #[serde(alias = "needs-media")]
    NeedsMedia,
    /// A job needs a page the site does not have (rule 5).
    #[serde(alias = "needs-page")]
    NeedsPage,
    /// The weekly editorial board's job failed or timed out: nothing was
    /// planned that week (ADR-0069).
    #[serde(alias = "board-failed")]
    BoardFailed,
}

impl TicketKind {
    pub const ALL: [TicketKind; 14] = [
        TicketKind::BudgetOverrun,
        TicketKind::RunwayLow,
        TicketKind::PayrollSpike,
        TicketKind::LoanOffer,
        TicketKind::MissingRole,
        TicketKind::HireAffordability,
        TicketKind::ProjectProposal,
        TicketKind::Escalation,
        TicketKind::PublishApproval,
        TicketKind::StandupFailed,
        TicketKind::DeployFailed,
        TicketKind::NeedsMedia,
        TicketKind::NeedsPage,
        TicketKind::BoardFailed,
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
            TicketKind::PublishApproval => "publish-approval",
            TicketKind::StandupFailed => "standup-failed",
            TicketKind::DeployFailed => "deploy-failed",
            TicketKind::NeedsMedia => "needs-media",
            TicketKind::NeedsPage => "needs-page",
            TicketKind::BoardFailed => "board-failed",
        }
    }

    /// Priority by rule (§7): High for legal, financial alarms, high-risk
    /// and critical blockers; Medium for strategy and resourcing; Low for
    /// information. A new publication is a big bet (RACI: the CEO is
    /// accountable), so proposals are High and never delegated. Publishing
    /// to the live site is the CEO's call, and every failure is something
    /// the CEO must see (ADR-0059): those are High too.
    pub const fn priority(self) -> Priority {
        match self {
            TicketKind::BudgetOverrun
            | TicketKind::RunwayLow
            | TicketKind::LoanOffer
            | TicketKind::ProjectProposal
            | TicketKind::Escalation
            | TicketKind::PublishApproval
            | TicketKind::StandupFailed
            | TicketKind::DeployFailed
            | TicketKind::NeedsMedia
            | TicketKind::NeedsPage
            | TicketKind::BoardFailed => Priority::High,
            TicketKind::PayrollSpike | TicketKind::MissingRole => Priority::Medium,
            TicketKind::HireAffordability => Priority::Low,
        }
    }

    /// Only the CEO answers it, whatever its priority and the delegation
    /// policy: nothing reaches the live site on the Secretary's word.
    pub const fn ceo_only(self) -> bool {
        matches!(self, TicketKind::PublishApproval)
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
            TicketKind::PublishApproval => &[Publish, SendBack, Kill, Defer],
            TicketKind::StandupFailed | TicketKind::BoardFailed => &[Retry, Skip],
            TicketKind::DeployFailed => &[Retry, Acknowledge],
            TicketKind::NeedsMedia | TicketKind::NeedsPage => &[Retry, Kill],
        }
    }

    /// Applied when the deadline passes. An item's first `Escalation`
    /// overrides this with `Retry` (see [`World::raise_ticket_with`]). The
    /// default of a `PublishApproval` never publishes.
    pub const fn default_option(self) -> TicketOption {
        match self {
            TicketKind::BudgetOverrun => TicketOption::CutScope,
            TicketKind::RunwayLow | TicketKind::PayrollSpike | TicketKind::HireAffordability => {
                TicketOption::Acknowledge
            }
            TicketKind::LoanOffer => TicketOption::CutCosts,
            TicketKind::MissingRole => TicketOption::ArrangeHiring,
            TicketKind::ProjectProposal => TicketOption::Reject,
            TicketKind::Escalation | TicketKind::NeedsMedia | TicketKind::NeedsPage => {
                TicketOption::Kill
            }
            TicketKind::PublishApproval => TicketOption::Defer,
            TicketKind::StandupFailed | TicketKind::BoardFailed => TicketOption::Skip,
            TicketKind::DeployFailed => TicketOption::Acknowledge,
        }
    }

    /// Game days until the default applies. Missing media or a missing page
    /// needs work on the site itself, so those wait two days.
    pub const fn deadline_days(self) -> u64 {
        match self {
            TicketKind::MissingRole
            | TicketKind::ProjectProposal
            | TicketKind::NeedsMedia
            | TicketKind::NeedsPage => 2,
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

/// A ticket answer. What an option does depends on the ticket's kind
/// ([`World::resolve_ticket`]):
/// - `ApproveOverrun` (budget overrun): the project's monthly budget rises
///   by 20%;
/// - `CutScope`: recorded; scope cuts act on work items (publishing plan);
/// - `Acknowledge`, `Ignore`, `Skip`, `Defer`: recorded only. On a
///   `DeployFailed` ticket `Acknowledge` puts the item back to `Scheduled`
///   (merged, waiting for the next deploy that carries it); a deferred
///   `PublishApproval` leaves the item parked and a fresh ticket is raised
///   at the next 08:30;
/// - `Retry` / `Kill` (`Escalation`, `NeedsMedia`, `NeedsPage`): restart the
///   blocked phase with a new job / cancel the item. `Retry` on
///   `DeployFailed` requests the Publish job again; on `StandupFailed` it
///   opens a standup now and requests its job;
/// - `Publish` / `SendBack` / `Kill` (`PublishApproval`): start the Publish
///   phase / restart Draft with the revision incremented / cancel the item;
/// - `CutCosts`: overtime policy becomes Never;
/// - `TakeLoan`: the bank loan of the ticket's amount is paid out;
/// - `ArrangeHiring`: a candidate for the missing role joins today's
///   shortlist;
/// - `Approve` / `Reject` (project proposal): the proposed project becomes
///   Active / Archived.
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
    #[serde(alias = "publish")]
    Publish,
    #[serde(alias = "send-back")]
    SendBack,
    #[serde(alias = "defer")]
    Defer,
    #[serde(alias = "skip")]
    Skip,
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
            TicketOption::Publish => "publish",
            TicketOption::SendBack => "send-back",
            TicketOption::Defer => "defer",
            TicketOption::Skip => "skip",
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
    /// The work item the ticket is about (escalations, approvals, failures).
    pub work_item: Option<WorkItemId>,
    /// Why the job behind the ticket failed (`ServerCommand::JobFailed`, or
    /// `Timeout` for a standup the sim timed out).
    pub failure: Option<JobFailure>,
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
    pub work_item: Option<WorkItemId>,
}

/// What an answer acts on (the parts of a ticket [`World::resolve_ticket`]
/// hands to the effect).
#[derive(Clone, Copy)]
struct TicketAbout {
    kind: TicketKind,
    project: Option<ProjectId>,
    role: Option<Role>,
    amount: i64,
    item: Option<WorkItemId>,
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
        self.raise_ticket_with(spec, None, None)
    }

    /// [`World::raise_ticket`] with a default other than the kind's (it must
    /// be one of the kind's options, else the kind's default stays) and the
    /// failure the ticket reports.
    pub(crate) fn raise_ticket_with(
        &mut self,
        spec: TicketSpec,
        default: Option<TicketOption>,
        failure: Option<JobFailure>,
    ) -> TicketId {
        let id = self.ids.ticket();
        let days = spec.kind.deadline_days();
        let deadline = self.step + days * self.config.steps_per_day();
        let triaged = self.exec.secretary.is_some();
        let default_option = default
            .filter(|d| spec.kind.options().contains(d))
            .unwrap_or(spec.kind.default_option());
        let t = Ticket {
            id,
            kind: spec.kind,
            priority: spec.kind.priority(),
            project: spec.project,
            from: spec.from,
            role: spec.role,
            amount_cents: spec.amount_cents,
            work_item: spec.work_item,
            failure,
            summary_ref: None,
            options: spec.kind.options().to_vec(),
            default_option,
            proposed_option: triaged.then_some(default_option),
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

    /// Whether the Secretary may answer this ticket now. Never a High one,
    /// never a CEO-only kind (the publish gate), under any delegation policy.
    pub fn secretary_may_answer(&self, t: &Ticket) -> bool {
        self.exec.secretary.is_some()
            && t.is_open()
            && t.routed_via_secretary
            && t.priority != Priority::High
            && !t.kind.ceo_only()
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
        match (t.kind, option) {
            (TicketKind::ProjectProposal, TicketOption::Approve) => {
                let p = t
                    .project
                    .and_then(|p| self.projects.get(&p))
                    .ok_or("the proposal has no project")?;
                if !p.status.can_become(ProjectStatus::Active) {
                    return Err("the project cannot become active");
                }
                Ok(())
            }
            (_, TicketOption::TakeLoan) if self.company.loan.is_some() => {
                Err("a loan is already outstanding")
            }
            (_, TicketOption::TakeLoan) if t.amount_cents <= 0 => Err("nothing to borrow"),
            (TicketKind::PublishApproval, TicketOption::Publish | TicketOption::SendBack) => {
                let item = t
                    .work_item
                    .and_then(|i| self.plan.items.get(&i))
                    .ok_or("the ticket has no work item")?;
                if !item.awaiting_approval() {
                    return Err("the item is not waiting for approval");
                }
                if option == TicketOption::SendBack && item.revision >= MAX_REVISIONS {
                    return Err("the item has no revision left: publish it or kill it");
                }
                Ok(())
            }
            (TicketKind::StandupFailed, TicketOption::Retry) => {
                let project = t.project.ok_or("the ticket has no project")?;
                self.standup_possible(project)
            }
            (TicketKind::BoardFailed, TicketOption::Retry) => {
                let project = t.project.ok_or("the ticket has no project")?;
                self.board_possible(project)
            }
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
        let about = TicketAbout {
            kind: t.kind,
            project: t.project,
            role: t.role,
            amount: t.amount_cents,
            item: t.work_item,
        };
        if feasible {
            self.apply_option(about, option);
        }
        self.prune_tickets();
    }

    /// The effect of an answer. Dispatches on the ticket's kind first: the
    /// same option means different things on different tickets (`Retry` on
    /// an escalation restarts a phase, on a failed standup it opens a
    /// meeting), and an option a kind does not offer does nothing.
    fn apply_option(&mut self, t: TicketAbout, option: TicketOption) {
        use TicketOption as O;
        match t.kind {
            TicketKind::BudgetOverrun => {
                if option == O::ApproveOverrun {
                    if let Some(p) = t.project.and_then(|p| self.projects.get_mut(&p)) {
                        p.budget_monthly_cents += p.budget_monthly_cents / 5;
                    }
                }
            }
            TicketKind::RunwayLow | TicketKind::PayrollSpike | TicketKind::HireAffordability => {
                if option == O::CutCosts {
                    self.company.policies.overtime = OvertimePolicy::Never;
                }
            }
            TicketKind::LoanOffer => match option {
                O::TakeLoan => self.take_loan(t.amount),
                O::CutCosts => self.company.policies.overtime = OvertimePolicy::Never,
                _ => {}
            },
            TicketKind::MissingRole => {
                if let (O::ArrangeHiring, Some(r)) = (option, t.role) {
                    self.add_candidate_for_role(r);
                }
            }
            TicketKind::ProjectProposal => match (option, t.project) {
                (O::Approve, Some(p)) => self.set_project_status(p, ProjectStatus::Active),
                (O::Reject, Some(p)) => self.set_project_status(p, ProjectStatus::Archived),
                _ => {}
            },
            TicketKind::Escalation | TicketKind::NeedsMedia | TicketKind::NeedsPage => {
                match (option, t.item) {
                    (O::Retry, Some(id)) => self.retry_item(id),
                    (O::Kill, Some(id)) => self.cancel_item(id),
                    _ => {}
                }
            }
            TicketKind::DeployFailed => match (option, t.item) {
                (O::Retry, Some(id)) => self.retry_item(id),
                (O::Acknowledge, Some(id)) => self.await_next_deploy(id),
                _ => {}
            },
            TicketKind::PublishApproval => match (option, t.item) {
                (O::Publish, Some(id)) => self.publish_item(id),
                (O::SendBack, Some(id)) => self.send_back_item(id),
                (O::Kill, Some(id)) => self.cancel_item(id),
                // Defer: the item stays parked; `raise_morning_approvals`
                // puts it back on the CEO's desk at the next 08:30.
                _ => {}
            },
            TicketKind::StandupFailed => {
                if let (O::Retry, Some(p)) = (option, t.project) {
                    self.retry_standup(p);
                }
            }
            TicketKind::BoardFailed => {
                if let (O::Retry, Some(p)) = (option, t.project) {
                    self.retry_board(p);
                }
            }
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
        // slugs are unique and parse back (the JSON views and commands use them)
        let mut slugs: Vec<&str> = TicketKind::ALL.iter().map(|k| k.slug()).collect();
        slugs.sort_unstable();
        slugs.dedup();
        assert_eq!(slugs.len(), TicketKind::ALL.len());
        for k in TicketKind::ALL {
            let back: TicketKind = serde_json::from_str(&format!("\"{}\"", k.slug())).unwrap();
            assert_eq!(back, k);
            for o in k.options() {
                let back: TicketOption =
                    serde_json::from_str(&format!("\"{}\"", o.slug())).unwrap();
                assert_eq!(back, *o);
            }
        }
    }

    /// ADR-0059: the gate and every failure reach the CEO; the default of a
    /// publish approval never publishes.
    #[test]
    fn gate_and_failure_tickets() {
        use TicketKind::*;
        assert_eq!(
            PublishApproval.options(),
            &[
                TicketOption::Publish,
                TicketOption::SendBack,
                TicketOption::Kill,
                TicketOption::Defer
            ]
        );
        assert_eq!(PublishApproval.default_option(), TicketOption::Defer);
        assert_eq!(PublishApproval.deadline_days(), 1);
        assert!(PublishApproval.ceo_only());
        assert_eq!(
            StandupFailed.options(),
            &[TicketOption::Retry, TicketOption::Skip]
        );
        assert_eq!(StandupFailed.default_option(), TicketOption::Skip);
        assert_eq!(StandupFailed.deadline_days(), 1);
        assert_eq!(
            DeployFailed.options(),
            &[TicketOption::Retry, TicketOption::Acknowledge]
        );
        assert_eq!(DeployFailed.default_option(), TicketOption::Acknowledge);
        for k in [NeedsMedia, NeedsPage] {
            assert_eq!(k.options(), &[TicketOption::Retry, TicketOption::Kill]);
            assert_eq!(k.default_option(), TicketOption::Kill);
            assert_eq!(k.deadline_days(), 2);
        }
        for k in [
            PublishApproval,
            StandupFailed,
            DeployFailed,
            NeedsMedia,
            NeedsPage,
            Escalation,
        ] {
            assert_eq!(k.priority(), Priority::High, "{k:?}");
            assert!(!k.is_financial());
        }
        // Escalation's rule default stays the conservative one; an item's
        // first escalation overrides it (tests/publish_gate.rs).
        assert_eq!(Escalation.default_option(), TicketOption::Kill);
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
