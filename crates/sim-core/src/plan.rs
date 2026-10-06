//! The publishing plan's skeleton and the sim ↔ orchestrator job contract
//! (docs/mvp.md, docs/game-design/publishing-plan.md, ADR-0011, ADR-0031).
//!
//! The sim owns every state transition; the orchestrator only reports
//! outcomes. The loop for one article:
//!
//! ```text
//! 09:00 standup ─► Effect::RequestJob(Standup, team) ─► ServerCommand::MeetingOutcome{briefs}
//!   (JobFailed, or no outcome within 60 game minutes: the standup ends
//!    with no briefs and a StandupFailed ticket)
//!   └─► WorkItem(article): Draft(writer) → Review(editor) → Publish
//! Draft   ─► RequestJob(Draft, writer)   ─► JobCompleted{ok}            ─► Review
//! Review  ─► RequestJob(Review, editor)  ─► JobCompleted{score ≥ bar}   ─► the publish gate
//!                                           score < bar: revise (≤ 3), then Blocked + ticket
//! gate (company.policies.autonomy, ADR-0059):
//!   ApproveAll   ─► Approved, Publish stays Pending, PublishApproval ticket
//!   ApproveMajor ─► Publish at once when score ≥ 9 and revision 0, else the ticket
//!   Autonomous   ─► Publish at once
//!   ticket: Publish ─► Publish │ SendBack ─► revision + 1, Draft │ Kill ─► Cancelled
//!           Defer (the default, also on expiry) ─► stays parked; a fresh ticket at 08:30
//! Publish ─► RequestJob(Publish)         ─► JobCompleted{ok}            ─► Scheduled
//! ServerCommand::DeployLanded{work_item} ─► Published, live_pages + 1, feed spotlight
//! ServerCommand::DeployFailed{work_item} ─► Blocked + DeployFailed ticket
//! JobCompleted{ok: false} │ JobFailed    ─► Blocked + ticket (Escalation, NeedsMedia, NeedsPage)
//! ```
//!
//! The weekly editorial board (ADR-0069), when the company's
//! `editorial_board` policy is on:
//!
//! ```text
//! Monday 10:00 (and a project's first 10:00) ─► RequestJob(Board, attendees)
//!   ─► ServerCommand::BoardOutcome{items} ─► WorkItems Planned, unstarted
//!      (a start, a planned publish day, an editor; no writer yet)
//!   (JobFailed, or no outcome within two game hours: a BoardFailed ticket)
//! each standup (and the board's outcome): unstarted items whose start day
//!   has come and whose dependencies are published start their Draft with a
//!   free writer, while the project stays within WIP_LIMIT.
//! ```
//!
//! A phase completes at `max(min time, job done)`: drafts take at least 2
//! game hours, reviews 1, publishing 15 minutes, so the office shows the work
//! even when an executor answers instantly.
//!
//! Commissions are bounded where they are made (`MeetingOutcome`): a project
//! never has more than [`WIP_LIMIT`] open items, parked ones included, and a
//! writer never more than one item in the writing loop. An absent CEO
//! therefore stops new commissions and loses nothing.
//!
//! Effects are an outbox, not state: [`World::drain_effects`] hands them to
//! the executor after each step. They are skipped by serde, so they are not
//! part of the hash or of snapshots; only the job counter and the pending-job
//! table are. A world restored from a snapshot gets the open requests back
//! with [`World::reissue_pending_jobs`].
//!
//! Text (briefs, drafts, minutes) never enters the sim: a brief is an opaque
//! server-side `brief_ref`.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::clock::{Clock, BRIEFING_TIME};
use crate::commands::{AutonomyPolicy, JobDigest, JobFailure};
use crate::ids::{MeetingId, ProjectId, StaffId, TicketId, WorkItemId, WorkstreamId};
use crate::inbox::{TicketKind, TicketOption, TicketSpec};
use crate::roles::Role;
use crate::world::World;

/// A standup waits this long for its outcome, game minutes.
pub const STANDUP_TIMEOUT_MINUTES: u16 = 60;
/// A standup's job is due this long after it was requested, game minutes
/// (ADR-0060; a view for the host's clock, see [`World::job_due_step`]).
pub const STANDUP_DUE_MINUTES: u16 = 30;
/// Failed reviews before an item is blocked and escalated.
pub const MAX_REVISIONS: u8 = 3;
/// Briefs one standup may create.
pub const MAX_BRIEFS_PER_STANDUP: usize = 8;
/// Open work items a project may have at once, parked ones included
/// (ADR-0059). A standup that would exceed it is refused.
pub const WIP_LIMIT: usize = 3;
/// Under `AutonomyPolicy::ApproveMajor` a first draft with at least this
/// review score is published without asking the CEO.
pub const AUTO_PUBLISH_SCORE: u8 = 9;
/// Feed entries kept.
pub const FEED_KEPT: usize = 32;
/// Ticket ids kept on a work item (the newest ones).
pub const ITEM_TICKETS_KEPT: usize = 16;
/// An editorial board waits this long for its outcome, game minutes (ADR-0069).
pub const BOARD_TIMEOUT_MINUTES: u16 = 120;
/// A board's job is due this long after it was requested, game minutes (ADR-0060).
pub const BOARD_DUE_MINUTES: u16 = 90;
/// Items one board may plan.
pub const MAX_BOARD_ITEMS: usize = 7;
/// Planned items not yet started a project may hold.
pub const MAX_PLANNED: usize = 10;
/// The latest day a board may plan for, counted from the board's day.
pub const MAX_BOARD_OFFSET: u8 = 13;
/// Items a planned item may wait for.
pub const MAX_DEPENDS: usize = 2;

/// What a job is for.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum JobKind {
    #[serde(alias = "standup")]
    Standup,
    /// Reserved: a brief written outside a standup.
    #[serde(alias = "brief")]
    Brief,
    #[serde(alias = "draft")]
    Draft,
    #[serde(alias = "review")]
    Review,
    #[serde(alias = "publish")]
    Publish,
    /// The weekly editorial board (ADR-0069).
    #[serde(alias = "board")]
    Board,
}

impl JobKind {
    pub const fn slug(self) -> &'static str {
        match self {
            JobKind::Standup => "standup",
            JobKind::Brief => "brief",
            JobKind::Draft => "draft",
            JobKind::Review => "review",
            JobKind::Publish => "publish",
            JobKind::Board => "board",
        }
    }

    /// A meeting's job: its attendees are its staff, its end is its outcome.
    pub const fn is_meeting(self) -> bool {
        matches!(self, JobKind::Standup | JobKind::Board)
    }
}

/// Something the sim asks the outside world to do. Drained by the server
/// actor; not part of the world hash.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Effect {
    RequestJob {
        /// Sequential, deterministic: the n-th job this world requested.
        job_id: u64,
        kind: JobKind,
        project: ProjectId,
        work_item: Option<WorkItemId>,
        /// Server-side id of the brief text.
        brief_ref: Option<u64>,
        /// 0 for the first draft, n for the n-th revision; for a review,
        /// the revision being reviewed.
        revision: u8,
        /// The standup a `Standup` job runs (utterances reference it).
        meeting: Option<MeetingId>,
        /// Who works on it: the team for a standup, the assignee otherwise.
        staff: Vec<StaffId>,
    },
}

/// One brief agreed in a standup (`ServerCommand::MeetingOutcome`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct BriefStub {
    /// Defaults to `Article` when absent in JSON (the orchestrator's
    /// `BriefOut` has no kind).
    #[serde(default)]
    pub kind: WorkItemKind,
    pub writer: StaffId,
    pub editor: StaffId,
    /// Opaque server-side id of the brief text.
    pub brief_ref: u64,
}

/// One item planned by the editorial board (`ServerCommand::BoardOutcome`,
/// ADR-0069). Days are offsets from the board's day; workstreams and
/// dependencies are indices into the outcome's own lists.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlannedStub {
    #[serde(default)]
    pub kind: WorkItemKind,
    /// Opaque server-side id of the brief text.
    pub brief_ref: u64,
    /// Who reviews and owns it; the writer is chosen when it starts.
    pub editor: StaffId,
    #[serde(default)]
    pub priority: WorkPriority,
    /// Index into the outcome's `workstreams`.
    #[serde(default)]
    pub workstream: Option<u8>,
    /// The day its Draft may start, from the board's day.
    pub start_offset: u8,
    /// The planned publish day, from the board's day.
    pub publish_offset: u8,
    /// Indices of earlier items in the same outcome it waits for.
    #[serde(default)]
    pub depends_on: Vec<u8>,
}

/// A workstream (ADR-0031, ADR-0069). Its title is store text under `text_ref`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Workstream {
    pub id: WorkstreamId,
    pub project: ProjectId,
    pub text_ref: u64,
    pub created_step: u64,
}

#[derive(
    Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize,
)]
pub enum WorkItemKind {
    #[default]
    #[serde(alias = "article")]
    Article,
    /// An existing article brought up to date (ADR-0070); its brief names the page.
    #[serde(alias = "refresh")]
    Refresh,
    /// An existing page's broken internal links removed (ADR-0070), without a model.
    #[serde(alias = "fix")]
    Fix,
}

impl WorkItemKind {
    pub const fn slug(self) -> &'static str {
        match self {
            WorkItemKind::Article => "article",
            WorkItemKind::Refresh => "refresh",
            WorkItemKind::Fix => "fix",
        }
    }

    /// The item makes a new page (a refresh or a fix changes one the site has).
    pub const fn creates_page(self) -> bool {
        matches!(self, WorkItemKind::Article)
    }
}

/// publishing-plan.md §1 statuses.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum WorkItemStatus {
    Backlog,
    Planned,
    InProgress,
    InReview,
    Approved,
    /// Merged, waiting for the deploy.
    Scheduled,
    Published,
    Blocked,
    Cancelled,
}

impl WorkItemStatus {
    pub const fn slug(self) -> &'static str {
        match self {
            WorkItemStatus::Backlog => "backlog",
            WorkItemStatus::Planned => "planned",
            WorkItemStatus::InProgress => "in-progress",
            WorkItemStatus::InReview => "in-review",
            WorkItemStatus::Approved => "approved",
            WorkItemStatus::Scheduled => "scheduled",
            WorkItemStatus::Published => "published",
            WorkItemStatus::Blocked => "blocked",
            WorkItemStatus::Cancelled => "cancelled",
        }
    }

    pub const fn is_closed(self) -> bool {
        matches!(self, WorkItemStatus::Published | WorkItemStatus::Cancelled)
    }
}

#[derive(
    Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize,
)]
pub enum WorkPriority {
    Urgent,
    High,
    #[default]
    Normal,
    Low,
}

impl WorkPriority {
    pub const fn slug(self) -> &'static str {
        match self {
            WorkPriority::Urgent => "urgent",
            WorkPriority::High => "high",
            WorkPriority::Normal => "normal",
            WorkPriority::Low => "low",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum PhaseKind {
    Draft,
    Review,
    Publish,
}

impl PhaseKind {
    pub const fn slug(self) -> &'static str {
        match self {
            PhaseKind::Draft => "draft",
            PhaseKind::Review => "review",
            PhaseKind::Publish => "publish",
        }
    }

    /// Minimum sim time, game minutes (also the estimate shown in the plan).
    pub const fn min_minutes(self) -> u16 {
        match self {
            PhaseKind::Draft => 120,
            PhaseKind::Review => 60,
            PhaseKind::Publish => 15,
        }
    }

    pub const fn job(self) -> JobKind {
        match self {
            PhaseKind::Draft => JobKind::Draft,
            PhaseKind::Review => JobKind::Review,
            PhaseKind::Publish => JobKind::Publish,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum PhaseState {
    Pending,
    Working,
    Done,
    Blocked,
}

impl PhaseState {
    pub const fn slug(self) -> &'static str {
        match self {
            PhaseState::Pending => "pending",
            PhaseState::Working => "working",
            PhaseState::Done => "done",
            PhaseState::Blocked => "blocked",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Phase {
    pub kind: PhaseKind,
    pub assignee: Option<StaffId>,
    pub state: PhaseState,
    pub estimate_min: u16,
    pub started_step: Option<u64>,
    /// The phase cannot complete before this step.
    pub min_done_step: Option<u64>,
    /// The job working on it.
    pub job: Option<u64>,
    /// The job's result, once it arrived.
    pub result: Option<JobDigest>,
}

impl Phase {
    fn new(kind: PhaseKind, assignee: Option<StaffId>) -> Phase {
        Phase {
            kind,
            assignee,
            state: PhaseState::Pending,
            estimate_min: kind.min_minutes(),
            started_step: None,
            min_done_step: None,
            job: None,
            result: None,
        }
    }

    /// Progress, permille: elapsed share of the minimum time, held below
    /// 1000 until the job result is in.
    pub fn progress_pm(&self, step: u64) -> u16 {
        match self.state {
            PhaseState::Done => 1000,
            PhaseState::Pending => 0,
            PhaseState::Working | PhaseState::Blocked => {
                let (Some(start), Some(min)) = (self.started_step, self.min_done_step) else {
                    return 0;
                };
                let span = min.saturating_sub(start).max(1);
                let pm = step.saturating_sub(start) * 1000 / span;
                let cap = if self.result.is_some() { 1000 } else { 950 };
                u16::try_from(pm.min(cap)).unwrap_or(cap as u16)
            }
        }
    }
}

/// The unit of planned work (publishing-plan.md §1).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorkItem {
    pub id: WorkItemId,
    pub project: ProjectId,
    pub kind: WorkItemKind,
    pub status: WorkItemStatus,
    pub priority: WorkPriority,
    /// Accountable person (the editor for an article).
    pub owner: Option<StaffId>,
    pub brief_ref: Option<u64>,
    /// Failed reviews so far.
    pub revision: u8,
    pub phases: Vec<Phase>,
    /// Index of the current phase.
    pub current: usize,
    /// The standup that created it.
    pub meeting: Option<MeetingId>,
    /// Tickets raised about it, oldest first (the newest
    /// [`ITEM_TICKETS_KEPT`]).
    pub tickets: Vec<TicketId>,
    /// Last review score.
    pub last_score: Option<u8>,
    /// `Escalation` tickets raised about it so far: the first defaults to
    /// `Retry`, any later one to `Kill`.
    pub escalations: u8,
    pub created_step: u64,
    pub published_step: Option<u64>,
    /// The board's workstream (ADR-0069).
    #[serde(default)]
    pub workstream: Option<WorkstreamId>,
    /// The day its Draft may start (planned items).
    #[serde(default)]
    pub start_day: Option<u32>,
    /// The day it should be ready (the day before its planned publish day).
    #[serde(default)]
    pub due_day: Option<u32>,
    /// The planned publish day.
    #[serde(default)]
    pub publish_day: Option<u32>,
    /// Items that must be published before it starts.
    #[serde(default)]
    pub depends_on: Vec<WorkItemId>,
}

impl WorkItem {
    /// Planned by the board and not started: its Draft has neither begun nor
    /// a writer. It does not count against [`WIP_LIMIT`].
    pub fn is_unstarted(&self) -> bool {
        self.status == WorkItemStatus::Planned
            && self.current == 0
            && self
                .phases
                .first()
                .is_some_and(|p| p.state == PhaseState::Pending && p.job.is_none())
    }

    pub fn phase(&self) -> Option<&Phase> {
        self.phases.get(self.current)
    }

    /// Who drafts it.
    pub fn writer(&self) -> Option<StaffId> {
        self.phases
            .iter()
            .find(|p| p.kind == PhaseKind::Draft)
            .and_then(|p| p.assignee)
    }

    /// Passed its review and parked at the publish gate: `Approved`, with
    /// the Publish phase not started. No job is pending for it.
    pub fn awaiting_approval(&self) -> bool {
        self.status == WorkItemStatus::Approved
            && self
                .phase()
                .is_some_and(|p| p.kind == PhaseKind::Publish && p.state == PhaseState::Pending)
    }

    /// Open and not past the gate: a failed review or a `SendBack` can still
    /// restart its Draft, so its writer is not free for another item.
    pub fn in_writing_loop(&self) -> bool {
        // a planned item the board made is not in it until it starts (ADR-0069)
        !self.status.is_closed()
            && !self.is_unstarted()
            && self
                .phases
                .iter()
                .any(|p| p.kind == PhaseKind::Publish && p.state == PhaseState::Pending)
    }

    /// A new revision: Draft and Review start over.
    fn reopen_for_revision(&mut self) {
        self.revision += 1;
        for p in &mut self.phases {
            if p.kind != PhaseKind::Publish {
                p.state = PhaseState::Pending;
                p.result = None;
            }
        }
    }
}

/// A job the sim is waiting for.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PendingJob {
    pub job_id: u64,
    pub kind: JobKind,
    pub project: ProjectId,
    pub work_item: Option<WorkItemId>,
    pub meeting: Option<MeetingId>,
    pub requested_step: u64,
}

/// The CEO feed's spotlight entries.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum FeedKind {
    Published,
    Blocked,
}

impl FeedKind {
    pub const fn slug(self) -> &'static str {
        match self {
            FeedKind::Published => "published",
            FeedKind::Blocked => "blocked",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct FeedEntry {
    pub step: u64,
    pub kind: FeedKind,
    pub project: ProjectId,
    pub work_item: WorkItemId,
}

/// Plan state on the [`World`].
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Plan {
    pub items: BTreeMap<WorkItemId, WorkItem>,
    /// Jobs requested and not yet answered.
    pub jobs: BTreeMap<u64, PendingJob>,
    /// Jobs requested so far (the last job id).
    pub jobs_requested: u64,
    pub next_item: u32,
    pub feed: Vec<FeedEntry>,
    /// The day each project last held its standup: one standup job per
    /// project per day, even if the meeting ends early and is cleared.
    pub standup_days: BTreeMap<ProjectId, u32>,
    /// Workstreams (ADR-0069).
    #[serde(default)]
    pub workstreams: BTreeMap<WorkstreamId, Workstream>,
    #[serde(default)]
    pub next_workstream: u32,
    /// The day each project last held its editorial board (ADR-0069).
    #[serde(default)]
    pub board_days: BTreeMap<ProjectId, u32>,
}

/// Roles that may write a brief's draft.
pub const fn can_draft(role: Role) -> bool {
    matches!(
        role,
        Role::Writer | Role::Editor | Role::EditorInChief | Role::Translator
    )
}

/// Roles that may review.
pub const fn can_review(role: Role) -> bool {
    matches!(role, Role::Editor | Role::EditorInChief)
}

impl World {
    /// Takes the effects emitted since the last drain.
    pub fn drain_effects(&mut self) -> Vec<Effect> {
        std::mem::take(&mut self.effects)
    }

    /// Effects waiting to be drained.
    pub fn effects(&self) -> &[Effect] {
        &self.effects
    }

    /// The request of a pending job, rebuilt from state. Everything a
    /// [`Effect::RequestJob`] carries beyond the [`PendingJob`] row is still
    /// in the world while the job is pending: the brief and the revision on
    /// the work item, the assignee on the phase that holds the job, the team
    /// on the standup's meeting.
    fn job_effect(&self, job: &PendingJob) -> Effect {
        let item = job.work_item.and_then(|id| self.plan.items.get(&id));
        let staff: Vec<StaffId> = match job.kind {
            JobKind::Standup | JobKind::Board => job
                .meeting
                .and_then(|m| self.meetings.get(&m))
                .map(|m| m.attendees.iter().copied().collect())
                .unwrap_or_default(),
            _ => item
                .and_then(|i| i.phases.iter().find(|p| p.job == Some(job.job_id)))
                .and_then(|p| p.assignee)
                .into_iter()
                .collect(),
        };
        Effect::RequestJob {
            job_id: job.job_id,
            kind: job.kind,
            project: job.project,
            work_item: job.work_item,
            brief_ref: item.and_then(|i| i.brief_ref),
            revision: item.map_or(0, |i| i.revision),
            meeting: job.meeting,
            staff,
        }
    }

    /// Emits the request of every pending job again, in job-id order, except
    /// those whose effect is still waiting to be drained. For a world that
    /// lost its outbox: effects are not part of a snapshot, so a restored
    /// world would otherwise wait forever for jobs nobody was asked to run.
    /// The job ids are the original ones. Not a state change: the hash stays.
    /// Returns how many requests were emitted.
    pub fn reissue_pending_jobs(&mut self) -> usize {
        let queued: Vec<u64> = self
            .effects
            .iter()
            .map(|Effect::RequestJob { job_id, .. }| *job_id)
            .collect();
        let again: Vec<Effect> = self
            .plan
            .jobs
            .values()
            .filter(|j| !queued.contains(&j.job_id))
            .map(|j| self.job_effect(j))
            .collect();
        let n = again.len();
        self.effects.extend(again);
        n
    }

    /// Requests a job: records it as pending and emits the effect.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn request_job(
        &mut self,
        kind: JobKind,
        project: ProjectId,
        work_item: Option<WorkItemId>,
        brief_ref: Option<u64>,
        revision: u8,
        meeting: Option<MeetingId>,
        staff: Vec<StaffId>,
    ) -> u64 {
        self.plan.jobs_requested += 1;
        let job_id = self.plan.jobs_requested;
        self.plan.jobs.insert(
            job_id,
            PendingJob {
                job_id,
                kind,
                project,
                work_item,
                meeting,
                requested_step: self.step,
            },
        );
        self.effects.push(Effect::RequestJob {
            job_id,
            kind,
            project,
            work_item,
            brief_ref,
            revision,
            meeting,
            staff,
        });
        job_id
    }

    /// Who publishes for a project: an IT engineer or DevOps on the team,
    /// else the web developer, else the item's editor.
    fn publisher(&self, project: ProjectId, editor: StaffId) -> StaffId {
        [Role::ItEngineer, Role::DevOps, Role::WebDeveloper]
            .into_iter()
            .find_map(|r| self.project_members_with_role(project, r).first().copied())
            .unwrap_or(editor)
    }

    /// Creates the work items of a standup's briefs and starts their drafts.
    pub(crate) fn apply_meeting_outcome(&mut self, job_id: u64, briefs: &[BriefStub]) {
        let Some(job) = self.plan.jobs.remove(&job_id) else {
            return;
        };
        self.end_standup(&job);
        for b in briefs {
            self.plan.next_item += 1;
            let id = WorkItemId(self.plan.next_item);
            let publisher = self.publisher(job.project, b.editor);
            let item = WorkItem {
                id,
                project: job.project,
                kind: b.kind,
                status: WorkItemStatus::Planned,
                priority: WorkPriority::Normal,
                owner: Some(b.editor),
                brief_ref: Some(b.brief_ref),
                revision: 0,
                phases: vec![
                    Phase::new(PhaseKind::Draft, Some(b.writer)),
                    Phase::new(PhaseKind::Review, Some(b.editor)),
                    Phase::new(PhaseKind::Publish, Some(publisher)),
                ],
                current: 0,
                meeting: job.meeting,
                tickets: Vec::new(),
                last_score: None,
                escalations: 0,
                created_step: self.step,
                published_step: None,
                workstream: None,
                start_day: None,
                due_day: None,
                publish_day: None,
                depends_on: Vec::new(),
            };
            self.plan.items.insert(id, item);
            self.start_phase(id, 0);
        }
    }

    /// Creates the work items the editorial board planned (ADR-0069): Planned
    /// and unstarted, with their days, editor, workstream and dependencies;
    /// then starts those that are due.
    pub(crate) fn apply_board_outcome(
        &mut self,
        job_id: u64,
        workstreams: &[u64],
        items: &[PlannedStub],
    ) {
        let Some(job) = self.plan.jobs.remove(&job_id) else {
            return;
        };
        self.end_standup(&job);
        let project = job.project;
        let today = self.clock().day;
        let streams: Vec<WorkstreamId> = workstreams
            .iter()
            .map(|r| self.workstream_for(project, *r))
            .collect();
        let mut created: Vec<WorkItemId> = Vec::new();
        for stub in items {
            self.plan.next_item += 1;
            let id = WorkItemId(self.plan.next_item);
            let publisher = self.publisher(project, stub.editor);
            let publish_day = today + u32::from(stub.publish_offset);
            let item = WorkItem {
                id,
                project,
                kind: stub.kind,
                status: WorkItemStatus::Planned,
                priority: stub.priority,
                owner: Some(stub.editor),
                brief_ref: Some(stub.brief_ref),
                revision: 0,
                phases: vec![
                    Phase::new(PhaseKind::Draft, None),
                    Phase::new(PhaseKind::Review, Some(stub.editor)),
                    Phase::new(PhaseKind::Publish, Some(publisher)),
                ],
                current: 0,
                meeting: job.meeting,
                tickets: Vec::new(),
                last_score: None,
                escalations: 0,
                created_step: self.step,
                published_step: None,
                workstream: stub
                    .workstream
                    .and_then(|i| streams.get(usize::from(i)).copied()),
                start_day: Some(today + u32::from(stub.start_offset)),
                due_day: Some(publish_day.saturating_sub(1).max(today)),
                publish_day: Some(publish_day),
                depends_on: stub
                    .depends_on
                    .iter()
                    .filter_map(|i| created.get(usize::from(*i)).copied())
                    .collect(),
            };
            self.plan.items.insert(id, item);
            created.push(id);
        }
        self.start_due_planned(project, today);
    }

    /// The project's workstream with `text_ref`, created when new.
    fn workstream_for(&mut self, project: ProjectId, text_ref: u64) -> WorkstreamId {
        if let Some(w) = self
            .plan
            .workstreams
            .values()
            .find(|w| w.project == project && w.text_ref == text_ref)
        {
            return w.id;
        }
        self.plan.next_workstream += 1;
        let id = WorkstreamId(self.plan.next_workstream);
        self.plan.workstreams.insert(
            id,
            Workstream {
                id,
                project,
                text_ref,
                created_step: self.step,
            },
        );
        id
    }

    /// Starts the project's planned items that are due (ADR-0069): unstarted,
    /// start day reached, every dependency published; by priority, then
    /// planned publish day, then id; each with the lowest-id free drafter on
    /// the team who is not its editor; while the project stays within
    /// [`WIP_LIMIT`]. Deterministic, no model involved.
    pub(crate) fn start_due_planned(&mut self, project: ProjectId, day: u32) {
        let mut due: Vec<(WorkPriority, u32, WorkItemId)> = self
            .plan
            .items
            .values()
            .filter(|i| i.project == project && i.is_unstarted())
            .filter(|i| i.start_day.is_some_and(|d| d <= day))
            .filter(|i| {
                i.depends_on.iter().all(|d| {
                    self.plan
                        .items
                        .get(d)
                        .is_none_or(|o| o.status == WorkItemStatus::Published)
                })
            })
            .map(|i| (i.priority, i.publish_day.unwrap_or(u32::MAX), i.id))
            .collect();
        due.sort();
        for (_, _, id) in due {
            if self.open_items(project) >= WIP_LIMIT {
                break;
            }
            let editor = self.plan.items.get(&id).and_then(|i| i.owner);
            let writer = self
                .staff
                .values()
                .filter(|s| s.is_active() && can_draft(s.role) && s.allocation(project) > 0)
                .map(|s| s.id)
                .find(|s| Some(*s) != editor && self.writing(*s).is_none());
            let Some(writer) = writer else {
                break;
            };
            if let Some(p) = self
                .plan
                .items
                .get_mut(&id)
                .and_then(|i| i.phases.first_mut())
            {
                p.assignee = Some(writer);
            }
            self.start_phase(id, 0);
        }
    }

    /// The board of `job` produced nothing: tell the CEO (rule 11). `Retry`
    /// holds the board again now, `Skip` (the default) waits for next Monday.
    fn raise_board_failed(&mut self, project: ProjectId, failure: JobFailure) {
        let from = self.projects.get(&project).and_then(|p| p.lead);
        self.raise_ticket_with(
            TicketSpec {
                kind: TicketKind::BoardFailed,
                project: Some(project),
                from,
                role: None,
                amount_cents: 0,
                work_item: None,
            },
            None,
            Some(failure),
        );
    }

    /// The standup of `job` ends now (its outcome or its failure arrived).
    fn end_standup(&mut self, job: &PendingJob) {
        let now = self.clock();
        if let Some(m) = job.meeting.and_then(|m| self.meetings.get_mut(&m)) {
            if m.is_active(now) {
                m.end = now.minute.max(m.start);
            }
            m.job = None;
        }
    }

    /// A standup produced nothing: tell the CEO (rule 11). `Retry` opens a
    /// standup again, `Skip` (the default) lets the day pass.
    fn raise_standup_failed(&mut self, project: ProjectId, failure: JobFailure) {
        let from = self.projects.get(&project).and_then(|p| p.lead);
        self.raise_ticket_with(
            TicketSpec {
                kind: TicketKind::StandupFailed,
                project: Some(project),
                from,
                role: None,
                amount_cents: 0,
                work_item: None,
            },
            None,
            Some(failure),
        );
    }

    /// Open items of a project: everything not published or cancelled,
    /// parked and blocked ones included; planned items not yet started are
    /// not counted (ADR-0069 amends ADR-0059).
    pub fn open_items(&self, project: ProjectId) -> usize {
        self.plan
            .items
            .values()
            .filter(|i| i.project == project && !i.status.is_closed() && !i.is_unstarted())
            .count()
    }

    /// Planned items of a project that have not started (ADR-0069).
    pub fn unstarted_items(&self, project: ProjectId) -> usize {
        self.plan
            .items
            .values()
            .filter(|i| i.project == project && i.is_unstarted())
            .count()
    }

    /// The item that keeps `staff` in the writing loop as its writer, if any
    /// (at most one: `MeetingOutcome` refuses a second).
    pub fn writing(&self, staff: StaffId) -> Option<WorkItemId> {
        self.plan
            .items
            .values()
            .find(|i| i.in_writing_loop() && i.writer() == Some(staff))
            .map(|i| i.id)
    }

    /// The step at which a pending job is due: the minimum-done step of the
    /// phase a work-item job works on, or [`STANDUP_DUE_MINUTES`] after a
    /// standup's request. A view for the host's clock (ADR-0060): the sim
    /// itself never waits on it, and it is not part of the hash.
    pub fn job_due_step(&self, job: &PendingJob) -> u64 {
        if job.kind == JobKind::Standup {
            return job.requested_step + self.minutes_to_steps(STANDUP_DUE_MINUTES);
        }
        if job.kind == JobKind::Board {
            return job.requested_step + self.minutes_to_steps(BOARD_DUE_MINUTES);
        }
        job.work_item
            .and_then(|id| self.plan.items.get(&id))
            .and_then(|i| i.phases.iter().find(|p| p.job == Some(job.job_id)))
            .and_then(|p| p.min_done_step)
            .unwrap_or(job.requested_step)
    }

    /// The earliest [`World::job_due_step`] of the pending jobs.
    pub fn next_due_step(&self) -> Option<u64> {
        self.plan.jobs.values().map(|j| self.job_due_step(j)).min()
    }

    /// Starts phase `index` of an item: state, timers, job.
    fn start_phase(&mut self, id: WorkItemId, index: usize) {
        let step = self.step;
        let Some(kind) = self
            .plan
            .items
            .get(&id)
            .and_then(|i| i.phases.get(index))
            .map(|p| p.kind)
        else {
            return;
        };
        let min_steps = self.minutes_to_steps(kind.min_minutes());
        let Some(item) = self.plan.items.get_mut(&id) else {
            return;
        };
        item.current = index;
        item.status = match kind {
            PhaseKind::Draft => WorkItemStatus::InProgress,
            PhaseKind::Review => WorkItemStatus::InReview,
            PhaseKind::Publish => WorkItemStatus::Approved,
        };
        let (project, brief_ref, revision) = (item.project, item.brief_ref, item.revision);
        let phase = &mut item.phases[index];
        phase.state = PhaseState::Working;
        phase.started_step = Some(step);
        phase.min_done_step = Some(step + min_steps);
        phase.result = None;
        let staff: Vec<StaffId> = phase.assignee.into_iter().collect();
        let job = self.request_job(
            kind.job(),
            project,
            Some(id),
            brief_ref,
            revision,
            None,
            staff,
        );
        if let Some(p) = self
            .plan
            .items
            .get_mut(&id)
            .and_then(|i| i.phases.get_mut(index))
        {
            p.job = Some(job);
        }
    }

    /// A job result arrived (validated by the caller).
    pub(crate) fn apply_job_completed(&mut self, job_id: u64, digest: JobDigest) {
        let Some(job) = self.plan.jobs.remove(&job_id) else {
            return;
        };
        let Some(id) = job.work_item else {
            return;
        };
        if let Some(phase) = self
            .plan
            .items
            .get_mut(&id)
            .and_then(|i| i.phases.iter_mut().find(|p| p.job == Some(job_id)))
        {
            phase.result = Some(digest);
        }
        // a failed job blocks at once; successes wait for the minimum time
        if !digest.ok {
            self.block_item(id, TicketKind::Escalation, None);
        }
    }

    /// A job failed (validated by the caller): a standup ends with a
    /// `StandupFailed` ticket, a work item is blocked with the ticket its
    /// reason calls for.
    pub(crate) fn apply_job_failed(&mut self, job_id: u64, reason: JobFailure) {
        let Some(job) = self.plan.jobs.remove(&job_id) else {
            return;
        };
        match (job.kind, job.work_item) {
            (JobKind::Standup, _) => {
                self.end_standup(&job);
                self.raise_standup_failed(job.project, reason);
            }
            (JobKind::Board, _) => {
                self.end_standup(&job);
                self.raise_board_failed(job.project, reason);
            }
            (_, Some(id)) => {
                let kind = match reason {
                    JobFailure::NeedsMedia => TicketKind::NeedsMedia,
                    JobFailure::NeedsPage => TicketKind::NeedsPage,
                    _ => TicketKind::Escalation,
                };
                self.block_item(id, kind, Some(reason));
            }
            (_, None) => {}
        }
    }

    /// The deploy that carries a merged item failed (validated by the
    /// caller): blocked, with a `DeployFailed` ticket.
    pub(crate) fn apply_deploy_failed(&mut self, id: WorkItemId) {
        self.block_item(id, TicketKind::DeployFailed, None);
    }

    /// Blocks an item's current phase and raises a ticket of `kind` about
    /// it. An item's first `Escalation` defaults to `Retry` (a transient
    /// failure is the common case), any later one to `Kill`.
    fn block_item(&mut self, id: WorkItemId, kind: TicketKind, failure: Option<JobFailure>) {
        let step = self.step;
        let Some(item) = self.plan.items.get_mut(&id) else {
            return;
        };
        item.status = WorkItemStatus::Blocked;
        let current = item.current;
        if let Some(p) = item.phases.get_mut(current) {
            p.state = PhaseState::Blocked;
        }
        let default = (kind == TicketKind::Escalation).then(|| {
            item.escalations = item.escalations.saturating_add(1);
            if item.escalations == 1 {
                TicketOption::Retry
            } else {
                TicketOption::Kill
            }
        });
        let (project, owner) = (item.project, item.owner);
        self.push_feed(FeedEntry {
            step,
            kind: FeedKind::Blocked,
            project,
            work_item: id,
        });
        let ticket = self.raise_ticket_with(
            TicketSpec {
                kind,
                project: Some(project),
                from: owner,
                role: None,
                amount_cents: 0,
                work_item: Some(id),
            },
            default,
            failure,
        );
        self.note_ticket(id, ticket);
    }

    /// Records a ticket on the item it is about, keeping the newest
    /// [`ITEM_TICKETS_KEPT`] (a parked item gets one every morning).
    fn note_ticket(&mut self, id: WorkItemId, ticket: TicketId) {
        if let Some(item) = self.plan.items.get_mut(&id) {
            item.tickets.push(ticket);
            if item.tickets.len() > ITEM_TICKETS_KEPT {
                item.tickets.remove(0);
            }
        }
    }

    /// Parks an item that passed its review at the publish gate: `Approved`,
    /// the Publish phase (`index`) not started, a ticket for the CEO.
    fn park_for_approval(&mut self, id: WorkItemId, index: usize) {
        let Some(item) = self.plan.items.get_mut(&id) else {
            return;
        };
        if item.phases.get(index).map(|p| p.kind) != Some(PhaseKind::Publish) {
            return;
        }
        item.current = index;
        item.status = WorkItemStatus::Approved;
        self.raise_publish_approval(id);
    }

    /// Asks the CEO whether a parked item may be published.
    fn raise_publish_approval(&mut self, id: WorkItemId) {
        let Some((project, owner)) = self.plan.items.get(&id).map(|i| (i.project, i.owner)) else {
            return;
        };
        let ticket = self.raise_ticket(TicketSpec {
            kind: TicketKind::PublishApproval,
            project: Some(project),
            from: owner,
            role: None,
            amount_cents: 0,
            work_item: Some(id),
        });
        self.note_ticket(id, ticket);
    }

    /// When the clock crosses 08:30: every parked item without an open
    /// approval ticket (deferred, or its ticket expired) goes back on the
    /// CEO's desk. Runs after the day's expiries, so a ticket raised at
    /// 08:30 and never answered is replaced the next morning without a gap.
    pub(crate) fn raise_morning_approvals(&mut self, before: Clock, now: Clock) {
        let crossed =
            now.minute >= BRIEFING_TIME && (before.day != now.day || before.minute < BRIEFING_TIME);
        if !crossed {
            return;
        }
        let asked: Vec<WorkItemId> = self
            .tickets
            .values()
            .filter(|t| t.is_open() && t.kind == TicketKind::PublishApproval)
            .filter_map(|t| t.work_item)
            .collect();
        let parked: Vec<WorkItemId> = self
            .plan
            .items
            .values()
            .filter(|i| i.awaiting_approval() && !asked.contains(&i.id))
            .map(|i| i.id)
            .collect();
        for id in parked {
            self.raise_publish_approval(id);
        }
    }

    /// `PublishApproval` answer `Publish`: the Publish phase starts.
    pub(crate) fn publish_item(&mut self, id: WorkItemId) {
        let Some(item) = self.plan.items.get(&id) else {
            return;
        };
        if item.awaiting_approval() {
            let current = item.current;
            self.start_phase(id, current);
        }
    }

    /// `PublishApproval` answer `SendBack`: a new revision, Draft restarts.
    /// (The CEO's note is a store post the revision job reads.)
    pub(crate) fn send_back_item(&mut self, id: WorkItemId) {
        let Some(item) = self.plan.items.get_mut(&id) else {
            return;
        };
        if !item.awaiting_approval() || item.revision >= MAX_REVISIONS {
            return;
        }
        item.reopen_for_revision();
        self.start_phase(id, 0);
    }

    /// `DeployFailed` answer `Acknowledge` (also its default): the merge
    /// stands, so the item is `Scheduled` again and lands with the next
    /// deploy that carries it.
    pub(crate) fn await_next_deploy(&mut self, id: WorkItemId) {
        let Some(item) = self.plan.items.get_mut(&id) else {
            return;
        };
        let current = item.current;
        let publishing = item
            .phases
            .get(current)
            .is_some_and(|p| p.kind == PhaseKind::Publish);
        if item.status != WorkItemStatus::Blocked || !publishing {
            return;
        }
        item.status = WorkItemStatus::Scheduled;
        item.phases[current].state = PhaseState::Done;
    }

    /// `Retry` on an item's ticket restarts the blocked phase with a new
    /// job, `Kill` cancels the item.
    pub(crate) fn retry_item(&mut self, id: WorkItemId) {
        let Some(item) = self.plan.items.get(&id) else {
            return;
        };
        if item.status != WorkItemStatus::Blocked {
            return;
        }
        let current = item.current;
        self.start_phase(id, current);
    }

    pub(crate) fn cancel_item(&mut self, id: WorkItemId) {
        if let Some(item) = self.plan.items.get_mut(&id) {
            if !item.status.is_closed() {
                item.status = WorkItemStatus::Cancelled;
            }
        }
        self.plan.jobs.retain(|_, j| j.work_item != Some(id));
    }

    /// The deploy that carries the item is live.
    pub(crate) fn apply_deploy_landed(&mut self, id: WorkItemId) {
        let step = self.step;
        let Some(item) = self.plan.items.get_mut(&id) else {
            return;
        };
        item.status = WorkItemStatus::Published;
        item.published_step = Some(step);
        let project = item.project;
        let new_page = item.kind.creates_page();
        if let Some(p) = self.projects.get_mut(&project) {
            if new_page {
                p.kpis.live_pages += 1;
            }
        }
        self.push_feed(FeedEntry {
            step,
            kind: FeedKind::Published,
            project,
            work_item: id,
        });
    }

    fn push_feed(&mut self, e: FeedEntry) {
        self.plan.feed.push(e);
        if self.plan.feed.len() > FEED_KEPT {
            self.plan.feed.remove(0);
        }
    }

    /// Completes every working phase whose job is in and whose minimum time
    /// has passed, and applies the outcome (next phase, revision, block).
    pub(crate) fn advance_work(&mut self) {
        let step = self.step;
        let ready: Vec<(WorkItemId, PhaseKind, JobDigest)> = self
            .plan
            .items
            .values()
            .filter(|i| !i.status.is_closed() && i.status != WorkItemStatus::Blocked)
            .filter_map(|i| {
                let p = i.phase()?;
                let result = p.result?;
                (p.state == PhaseState::Working && p.min_done_step.is_some_and(|m| step >= m))
                    .then_some((i.id, p.kind, result))
            })
            .collect();
        let bar = self.company.policies.quality_bar;
        let autonomy = self.company.policies.autonomy;
        enum Next {
            Phase(usize),
            /// The publish gate: park before phase `usize` and ask the CEO.
            Gate(usize),
            Block,
            Wait,
        }
        for (id, kind, result) in ready {
            let Some(item) = self.plan.items.get_mut(&id) else {
                continue;
            };
            let current = item.current;
            item.phases[current].state = PhaseState::Done;
            let next = match kind {
                PhaseKind::Draft => Next::Phase(current + 1),
                PhaseKind::Review => {
                    item.last_score = Some(result.score);
                    if result.score >= bar {
                        let unasked = match autonomy {
                            AutonomyPolicy::ApproveAll => false,
                            AutonomyPolicy::ApproveMajor => {
                                result.score >= AUTO_PUBLISH_SCORE && item.revision == 0
                            }
                            AutonomyPolicy::Autonomous => true,
                        };
                        if unasked {
                            Next::Phase(current + 1)
                        } else {
                            Next::Gate(current + 1)
                        }
                    } else if item.revision >= MAX_REVISIONS {
                        Next::Block
                    } else {
                        item.reopen_for_revision();
                        Next::Phase(0)
                    }
                }
                PhaseKind::Publish => {
                    item.status = WorkItemStatus::Scheduled;
                    Next::Wait
                }
            };
            match next {
                Next::Phase(i) => self.start_phase(id, i),
                Next::Gate(i) => self.park_for_approval(id, i),
                Next::Block => self.block_item(id, TicketKind::Escalation, None),
                Next::Wait => {}
            }
        }
    }

    /// Ends standups and boards whose outcome never came: nothing is
    /// planned, the job is dropped, and a `StandupFailed` or `BoardFailed`
    /// ticket says so (rule 11).
    pub(crate) fn time_out_standups(&mut self) {
        let now = self.clock();
        let timed_out: Vec<(u64, JobKind, ProjectId)> = self
            .plan
            .jobs
            .values()
            .filter(|j| {
                j.kind.is_meeting()
                    && !j
                        .meeting
                        .and_then(|m| self.meetings.get(&m))
                        .is_some_and(|m| m.is_active(now))
            })
            .map(|j| (j.job_id, j.kind, j.project))
            .collect();
        for (job, kind, project) in timed_out {
            self.plan.jobs.remove(&job);
            for m in self.meetings.values_mut() {
                if m.job == Some(job) {
                    m.job = None;
                }
            }
            if kind == JobKind::Board {
                self.raise_board_failed(project, JobFailure::Timeout);
            } else {
                self.raise_standup_failed(project, JobFailure::Timeout);
            }
        }
    }

    /// The work item a person's active phase belongs to (drives the typing
    /// pose and "clicking a person opens their item").
    pub fn busy_with(&self, staff: StaffId) -> Option<WorkItemId> {
        self.plan
            .items
            .values()
            .find(|i| {
                i.phase()
                    .is_some_and(|p| p.state == PhaseState::Working && p.assignee == Some(staff))
            })
            .map(|i| i.id)
    }

    /// Validates a standup outcome (pure).
    pub(crate) fn check_meeting_outcome(
        &self,
        job_id: u64,
        briefs: &[BriefStub],
    ) -> Result<(), crate::Reject> {
        use crate::Reject;
        let job = self
            .plan
            .jobs
            .get(&job_id)
            .ok_or(Reject::Invalid("no pending job with that id"))?;
        if job.kind != JobKind::Standup {
            return Err(Reject::Invalid("not a standup job"));
        }
        if briefs.len() > MAX_BRIEFS_PER_STANDUP {
            return Err(Reject::Limit("briefs per standup"));
        }
        // Parked items count: an absent CEO stops new commissions.
        if self.open_items(job.project) + briefs.len() > WIP_LIMIT {
            return Err(Reject::Limit("work in progress (open items per project)"));
        }
        for (n, b) in briefs.iter().enumerate() {
            let on_team = |s: StaffId, ok: fn(Role) -> bool| {
                self.staff
                    .get(&s)
                    .is_some_and(|p| p.is_active() && ok(p.role) && p.allocation(job.project) > 0)
            };
            if !on_team(b.writer, can_draft) {
                return Err(Reject::Invalid(
                    "the writer must be a writer or editor on the project's team",
                ));
            }
            if !on_team(b.editor, can_review) {
                return Err(Reject::Invalid(
                    "the editor must be an editor on the project's team",
                ));
            }
            if b.writer == b.editor {
                return Err(Reject::Invalid("nobody reviews their own draft"));
            }
            // One active draft per writer: an item keeps its writer until it
            // is past the gate (a failed review or a SendBack restarts Draft).
            if self.writing(b.writer).is_some() || briefs[..n].iter().any(|o| o.writer == b.writer)
            {
                return Err(Reject::Occupied(
                    "the writer already has an item in the writing loop",
                ));
            }
        }
        Ok(())
    }

    /// Validates the CEO's change to a work item (pure).
    pub(crate) fn check_update_item(
        &self,
        id: WorkItemId,
        update: &crate::commands::WorkItemUpdate,
    ) -> Result<(), crate::Reject> {
        use crate::commands::WorkItemUpdate as U;
        use crate::Reject;
        let item = self
            .plan
            .items
            .get(&id)
            .ok_or(Reject::Invalid("no such work item"))?;
        if item.status.is_closed() {
            return Err(Reject::Invalid(
                "the item is already published or cancelled",
            ));
        }
        match *update {
            U::Priority(_) => Ok(()),
            U::Owner(editor) => {
                if !item.is_unstarted() {
                    return Err(Reject::Invalid(
                        "the editor can change only before the item starts",
                    ));
                }
                let ok = self.staff.get(&editor).is_some_and(|p| {
                    p.is_active() && can_review(p.role) && p.allocation(item.project) > 0
                });
                if ok {
                    Ok(())
                } else {
                    Err(Reject::Invalid(
                        "the editor must be an editor on the project's team",
                    ))
                }
            }
            U::DueDay(day) => {
                let today = self.clock().day;
                if day < today {
                    Err(Reject::Invalid("the due day is in the past"))
                } else if day > today + u32::from(MAX_BOARD_OFFSET) {
                    Err(Reject::Invalid("a due day is at most two weeks ahead"))
                } else {
                    Ok(())
                }
            }
            U::Status(WorkItemStatus::Cancelled) => {
                if item.status == WorkItemStatus::Scheduled {
                    return Err(Reject::Invalid(
                        "the item is merged and waits for its deploy",
                    ));
                }
                if item
                    .tickets
                    .iter()
                    .any(|t| self.tickets.get(t).is_some_and(|t| t.is_open()))
                {
                    return Err(Reject::Invalid(
                        "the item has an open ticket: answer it instead",
                    ));
                }
                Ok(())
            }
            U::Status(_) => Err(Reject::Invalid(
                "only cancelling is the CEO's; the pipeline sets every other status",
            )),
        }
    }

    /// Applies the CEO's change to a work item (checked).
    pub(crate) fn update_item(&mut self, id: WorkItemId, update: crate::commands::WorkItemUpdate) {
        use crate::commands::WorkItemUpdate as U;
        let today = self.clock().day;
        match update {
            U::Priority(p) => {
                if let Some(i) = self.plan.items.get_mut(&id) {
                    i.priority = p;
                }
            }
            U::Owner(editor) => {
                let Some(project) = self.plan.items.get(&id).map(|i| i.project) else {
                    return;
                };
                let publisher = self.publisher(project, editor);
                if let Some(i) = self.plan.items.get_mut(&id) {
                    i.owner = Some(editor);
                    for p in &mut i.phases {
                        match p.kind {
                            PhaseKind::Review => p.assignee = Some(editor),
                            PhaseKind::Publish => p.assignee = Some(publisher),
                            PhaseKind::Draft => {}
                        }
                    }
                }
            }
            U::DueDay(day) => {
                if let Some(i) = self.plan.items.get_mut(&id) {
                    i.due_day = Some(day);
                    i.publish_day = Some(day + 1);
                    if i.is_unstarted() {
                        i.start_day = Some(i.start_day.map_or(today, |s| s.min(day)));
                    }
                }
            }
            U::Status(_) => self.cancel_item(id),
        }
        // A planned item moved earlier, or a cancelled one freed room.
        if matches!(update, U::DueDay(_) | U::Status(_)) {
            if let Some(project) = self.plan.items.get(&id).map(|i| i.project) {
                self.start_due_planned(project, today);
            }
        }
    }

    /// Validates an editorial board's outcome (pure, ADR-0069).
    pub(crate) fn check_board_outcome(
        &self,
        job_id: u64,
        workstreams: &[u64],
        items: &[PlannedStub],
    ) -> Result<(), crate::Reject> {
        use crate::Reject;
        let job = self
            .plan
            .jobs
            .get(&job_id)
            .ok_or(Reject::Invalid("no pending job with that id"))?;
        if job.kind != JobKind::Board {
            return Err(Reject::Invalid("not a board job"));
        }
        if items.len() > MAX_BOARD_ITEMS {
            return Err(Reject::Limit("items per board"));
        }
        if workstreams.len() > MAX_BOARD_ITEMS {
            return Err(Reject::Limit("workstreams per board"));
        }
        if self.unstarted_items(job.project) + items.len() > MAX_PLANNED {
            return Err(Reject::Limit("planned items not yet started per project"));
        }
        for (n, it) in items.iter().enumerate() {
            let editor_ok = self.staff.get(&it.editor).is_some_and(|p| {
                p.is_active() && can_review(p.role) && p.allocation(job.project) > 0
            });
            if !editor_ok {
                return Err(Reject::Invalid(
                    "the editor must be an editor on the project's team",
                ));
            }
            if it.publish_offset > MAX_BOARD_OFFSET {
                return Err(Reject::Invalid("a board plans at most two weeks ahead"));
            }
            if it.start_offset > it.publish_offset {
                return Err(Reject::Invalid(
                    "an item cannot start after its publish day",
                ));
            }
            if it
                .workstream
                .is_some_and(|w| usize::from(w) >= workstreams.len())
            {
                return Err(Reject::Invalid("unknown workstream index"));
            }
            if it.depends_on.len() > MAX_DEPENDS {
                return Err(Reject::Limit("dependencies per item"));
            }
            if it.depends_on.iter().any(|d| usize::from(*d) >= n) {
                return Err(Reject::Invalid(
                    "an item may only wait for an earlier item of the same board",
                ));
            }
            if items[..n].iter().any(|o| o.brief_ref == it.brief_ref)
                || self
                    .plan
                    .items
                    .values()
                    .any(|i| i.brief_ref == Some(it.brief_ref))
            {
                return Err(Reject::Invalid("a brief is planned once"));
            }
        }
        Ok(())
    }

    /// Validates a job failure (pure): any pending job may fail, once.
    pub(crate) fn check_job_failed(&self, job_id: u64) -> Result<(), crate::Reject> {
        self.plan
            .jobs
            .get(&job_id)
            .map(|_| ())
            .ok_or(crate::Reject::Invalid("no pending job with that id"))
    }

    /// Validates a job result (pure).
    pub(crate) fn check_job_completed(
        &self,
        job_id: u64,
        digest: &JobDigest,
    ) -> Result<(), crate::Reject> {
        use crate::Reject;
        let job = self
            .plan
            .jobs
            .get(&job_id)
            .ok_or(Reject::Invalid("no pending job with that id"))?;
        if matches!(job.kind, JobKind::Standup) {
            return Err(Reject::Invalid("a standup ends with a MeetingOutcome"));
        }
        if matches!(job.kind, JobKind::Board) {
            return Err(Reject::Invalid("a board ends with a BoardOutcome"));
        }
        if digest.score > 10 {
            return Err(Reject::Invalid("score is 0..=10"));
        }
        Ok(())
    }

    /// Validates a deploy notice, landed or failed (pure): the item must be
    /// merged and waiting for its deploy.
    pub(crate) fn check_deploy_landed(&self, id: WorkItemId) -> Result<(), crate::Reject> {
        use crate::Reject;
        let item = self
            .plan
            .items
            .get(&id)
            .ok_or(Reject::Invalid("unknown work item"))?;
        if item.status != WorkItemStatus::Scheduled {
            return Err(Reject::Invalid(
                "the item is not merged and waiting for a deploy",
            ));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn phase_rules() {
        assert_eq!(PhaseKind::Draft.min_minutes(), 120);
        assert_eq!(PhaseKind::Review.min_minutes(), 60);
        assert_eq!(PhaseKind::Review.job(), JobKind::Review);
        let mut p = Phase::new(PhaseKind::Draft, Some(StaffId(1)));
        assert_eq!(p.progress_pm(10), 0);
        p.state = PhaseState::Working;
        p.started_step = Some(100);
        p.min_done_step = Some(200);
        assert_eq!(p.progress_pm(150), 500);
        assert_eq!(p.progress_pm(400), 950, "held until the job is in");
        p.result = Some(JobDigest {
            ok: true,
            score: 0,
            words: 900,
            qa_defects: 0,
            artifact_sha: [0; 16],
        });
        assert_eq!(p.progress_pm(400), 1000);
        assert!(can_draft(Role::Writer) && !can_draft(Role::Photographer));
        assert!(can_review(Role::EditorInChief) && !can_review(Role::Writer));
        assert!(WorkItemStatus::Published.is_closed());
        assert_eq!(WorkItemStatus::InReview.slug(), "in-review");
    }
}
