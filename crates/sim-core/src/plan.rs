//! The publishing plan's skeleton and the sim ↔ orchestrator job contract
//! (docs/mvp.md, docs/game-design/publishing-plan.md, ADR-0011, ADR-0031).
//!
//! The sim owns every state transition; the orchestrator only reports
//! outcomes. The loop for one article:
//!
//! ```text
//! 09:00 standup ─► Effect::RequestJob(Standup, team) ─► ServerCommand::MeetingOutcome{briefs}
//!   (no outcome within 60 game minutes: the standup ends with no briefs)
//!   └─► WorkItem(article): Draft(writer) → Review(editor) → Publish
//! Draft   ─► RequestJob(Draft, writer)   ─► JobCompleted{ok}            ─► Review
//! Review  ─► RequestJob(Review, editor)  ─► JobCompleted{score ≥ bar}   ─► Publish
//!                                           score < bar: revise (≤ 3), then Blocked + ticket
//! Publish ─► RequestJob(Publish)         ─► JobCompleted{ok}            ─► Scheduled
//! ServerCommand::DeployLanded{work_item} ─► Published, live_pages + 1, feed spotlight
//! any JobCompleted{ok: false}            ─► Blocked + escalation ticket
//! ```
//!
//! A phase completes at `max(min time, job done)`: drafts take at least 2
//! game hours, reviews 1, publishing 15 minutes, so the office shows the work
//! even when an executor answers instantly.
//!
//! Effects are an outbox, not state: [`World::drain_effects`] hands them to
//! the server actor after each step (replicas drain and drop them). They are
//! skipped by serde, so they are not part of the hash or of snapshots; only
//! the job counter and the pending-job table are.
//!
//! Text (briefs, drafts, minutes) never enters the sim: a brief is an opaque
//! server-side `brief_ref`.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::commands::JobDigest;
use crate::ids::{MeetingId, ProjectId, StaffId, TicketId, WorkItemId};
use crate::inbox::{TicketKind, TicketSpec};
use crate::roles::Role;
use crate::world::World;

/// A standup waits this long for its outcome, game minutes.
pub const STANDUP_TIMEOUT_MINUTES: u16 = 60;
/// Failed reviews before an item is blocked and escalated.
pub const MAX_REVISIONS: u8 = 3;
/// Briefs one standup may create.
pub const MAX_BRIEFS_PER_STANDUP: usize = 8;
/// Feed entries kept.
pub const FEED_KEPT: usize = 32;

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
}

impl JobKind {
    pub const fn slug(self) -> &'static str {
        match self {
            JobKind::Standup => "standup",
            JobKind::Brief => "brief",
            JobKind::Draft => "draft",
            JobKind::Review => "review",
            JobKind::Publish => "publish",
        }
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

#[derive(
    Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize,
)]
pub enum WorkItemKind {
    #[default]
    #[serde(alias = "article")]
    Article,
}

impl WorkItemKind {
    pub const fn slug(self) -> &'static str {
        match self {
            WorkItemKind::Article => "article",
        }
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
    pub tickets: Vec<TicketId>,
    /// Last review score.
    pub last_score: Option<u8>,
    pub created_step: u64,
    pub published_step: Option<u64>,
}

impl WorkItem {
    pub fn phase(&self) -> Option<&Phase> {
        self.phases.get(self.current)
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
        // the standup ends now
        let now = self.clock();
        if let Some(m) = job.meeting.and_then(|m| self.meetings.get_mut(&m)) {
            if m.is_active(now) {
                m.end = now.minute.max(m.start);
            }
            m.job = None;
        }
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
                created_step: self.step,
                published_step: None,
            };
            self.plan.items.insert(id, item);
            self.start_phase(id, 0);
        }
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
            self.block_item(id);
        }
    }

    /// Blocks an item and escalates it to the CEO.
    fn block_item(&mut self, id: WorkItemId) {
        let step = self.step;
        let Some(item) = self.plan.items.get_mut(&id) else {
            return;
        };
        item.status = WorkItemStatus::Blocked;
        let current = item.current;
        if let Some(p) = item.phases.get_mut(current) {
            p.state = PhaseState::Blocked;
        }
        let (project, owner) = (item.project, item.owner);
        self.push_feed(FeedEntry {
            step,
            kind: FeedKind::Blocked,
            project,
            work_item: id,
        });
        let ticket = self.raise_ticket(TicketSpec {
            kind: TicketKind::Escalation,
            project: Some(project),
            from: owner,
            role: None,
            amount_cents: 0,
            work_item: Some(id),
        });
        if let Some(item) = self.plan.items.get_mut(&id) {
            item.tickets.push(ticket);
        }
    }

    /// Escalation answers: `Retry` restarts the blocked phase with a new
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
        if let Some(p) = self.projects.get_mut(&project) {
            p.kpis.live_pages += 1;
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
        enum Next {
            Phase(usize),
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
                        Next::Phase(current + 1)
                    } else if item.revision >= MAX_REVISIONS {
                        Next::Block
                    } else {
                        item.revision += 1;
                        for p in &mut item.phases {
                            if p.kind != PhaseKind::Publish {
                                p.state = PhaseState::Pending;
                                p.result = None;
                            }
                        }
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
                Next::Block => self.block_item(id),
                Next::Wait => {}
            }
        }
    }

    /// Ends standups whose outcome never came: no briefs, the job is dropped.
    pub(crate) fn time_out_standups(&mut self) {
        let now = self.clock();
        let meetings = &self.meetings;
        self.plan.jobs.retain(|_, j| {
            j.kind != JobKind::Standup
                || j.meeting
                    .and_then(|m| meetings.get(&m))
                    .is_some_and(|m| m.is_active(now))
        });
        let jobs = &self.plan.jobs;
        for m in self.meetings.values_mut() {
            if m.job.is_some_and(|j| !jobs.contains_key(&j)) {
                m.job = None;
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
        for b in briefs {
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
        }
        Ok(())
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
        if digest.score > 10 {
            return Err(Reject::Invalid("score is 0..=10"));
        }
        Ok(())
    }

    /// Validates a deploy notice (pure).
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
