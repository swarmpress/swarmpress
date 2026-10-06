//! The [`World`]: all simulation state, command application and the fixed
//! step.
//!
//! Input ordering: inputs are applied in `(step, seq)` order. A lockstep
//! replica [`World::enqueue`]s server-stamped inputs; they are applied at the
//! start of [`World::step`] when `self.step` reaches their stamp. The local
//! sandbox calls [`World::apply`], which validates and applies immediately at
//! the current step with the next free seq.
//!
//! Step order (one step = 100 ms):
//! 1. apply inputs stamped for the current step, by seq
//! 2. advance the step counter and the clock
//! 3. on a new day: settle accounts (company + per-project ledgers, CFO
//!    alerts, month close every 30 days), staffing check, roll today's
//!    schedules, new candidates
//! 4. per elapsed minute: overtime, fatigue; per hour: morale; the 08:30
//!    briefing task; the Secretary's queue
//! 5. meetings: open the day's rhythm (09:00 project standups, Monday 09:30
//!    KPI review, Friday 16:00 finance review), close finished meetings
//! 6. tickets: apply the default of every ticket past its deadline; when
//!    the clock crosses 08:30, raise a fresh approval ticket for every item
//!    parked at the publish gate without one; then work items whose phase
//!    is done move on
//! 7. staff: move along paths, then decide (FSM) and plan new paths

use std::collections::{BTreeMap, BTreeSet};

use rand_core::RngCore;
use rand_pcg::Pcg32;
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::building::{Building, RoomKind};
use crate::clock::{
    hm, Clock, SimConfig, Weekday, ARRIVAL_START, BOARD_END, BOARD_START, BRIEFING_TIME,
    EVENING_START, FINANCE_REVIEW_END, FINANCE_REVIEW_START, FOLLOW_UP_END, FOLLOW_UP_START,
    KPI_REVIEW_END, KPI_REVIEW_START, LUNCH_MINUTES, STANDUP_END, STANDUP_START,
};
use crate::commands::{
    Command, DemolishTarget, Input, OvertimePolicy, Placement, Policy, ServerCommand,
};
use crate::economy::{self, Company, DaySettlement, Ledger, LedgerKind};
use crate::equipment::{Equipment, EquipmentKind};
use crate::finance::{attribute_day, Finance, PAYROLL_SPIKE_PCT};
use crate::geom::PosMm;
use crate::ids::{
    CandidateId, EquipId, IdGen, MeetingId, PersonaId, ProjectId, RoomId, StaffId, TaskId, TicketId,
};
use crate::inbox::{
    ExecutiveOffice, SecretaryTask, SecretaryTaskKind, Ticket, TicketKind, TicketSpec,
};
use crate::pathfinding::{plan_path, NavGrid, Path};
use crate::plan::{
    can_review, Effect, JobKind, Plan, BOARD_TIMEOUT_MINUTES, STANDUP_TIMEOUT_MINUTES,
};
use crate::projects::{Project, ProjectStatus, MONTH_DAYS};
use crate::staff::{
    persona, salary_for, Activity, Candidate, Role, Schedule, Seniority, Spot, Staff, Traits,
    LATEST_LEAVE, PERSONAS, ROUND_TABLE_SEATS,
};
use crate::validate::{grown_lot, price, validate, validate_server, Reject};

/// Starting cash for a new company, cents ($200,000).
pub const DEFAULT_START_CASH: i64 = 20_000_000;
/// Candidates on the daily hiring shortlist.
pub const CANDIDATES_PER_DAY: usize = 3;
/// Most employees.
pub const MAX_STAFF: usize = 64;
/// Starting morale.
pub const START_MORALE: u16 = 700;
/// `Praise` commands per game day.
pub const PRAISES_PER_DAY: u8 = 3;
/// Morale from one praise, permille (+20% with a CEO office).
pub const PRAISE_MORALE: u16 = 30;
/// People arriving later than this after a meeting starts skip it.
pub const MEETING_GRACE_MINUTES: u16 = 5;

/// Why a meeting happens.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum MeetingKind {
    /// 09:00, one per active project, with that project's team (the lead
    /// moderates, the strategist pitches).
    Standup,
    /// Monday 09:30: the data scientist presents KPIs to the CEO office.
    KpiReview,
    /// Friday 16:00: the CFO's finance review with the CEO office.
    FinanceReview,
    /// Booked by the Secretary (`Delegate{ScheduleMeeting}`).
    Scheduled,
    /// Monday 10:00, one per active project when the `editorial_board`
    /// policy is on (ADR-0069): the strategists, the editors, SEO and
    /// marketing and the CFO plan the week.
    EditorialBoard,
}

impl MeetingKind {
    pub const fn slug(self) -> &'static str {
        match self {
            MeetingKind::Standup => "standup",
            MeetingKind::KpiReview => "kpi-review",
            MeetingKind::FinanceReview => "finance-review",
            MeetingKind::Scheduled => "scheduled",
            MeetingKind::EditorialBoard => "editorial-board",
        }
    }
}

/// A meeting at a room's table.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Meeting {
    pub id: MeetingId,
    pub kind: MeetingKind,
    pub project: Option<ProjectId>,
    pub room: RoomId,
    pub day: u32,
    pub start: u16,
    pub end: u16,
    /// Who is expected. Only they walk over.
    pub attendees: BTreeSet<StaffId>,
    /// The standup's job, while its outcome is awaited.
    pub job: Option<u64>,
    /// Next expected [`ServerCommand::Utterance`] seq. While someone speaks,
    /// the turn on screen is `next_seq - 1`.
    pub next_seq: u32,
    pub speaker: Option<StaffId>,
    /// Step at which `speaker` started the current turn.
    pub speak_from: u64,
    /// Step until which `speaker` is talking.
    pub speak_until: u64,
    /// Length of the current turn, characters (the text itself stays in the
    /// store; the bubble fetches it by meeting and seq).
    pub speak_chars: u32,
}

impl Meeting {
    pub fn is_active(&self, now: Clock) -> bool {
        now.day == self.day && (self.start..self.end).contains(&now.minute)
    }

    /// Not over yet (scheduled or running).
    pub fn is_pending(&self, now: Clock) -> bool {
        (self.day, self.end) > (now.day, now.minute)
    }
}

/// Steps a speech bubble of `chars` characters stays up (≈15 chars per real second).
pub fn utterance_steps(chars: u32) -> u64 {
    10 + u64::from(chars) * 2 / 3
}

/// Where an applied command landed in the input order.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct CmdReceipt {
    pub step: u64,
    pub seq: u32,
}

/// What happened during one [`World::step`].
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct StepReport {
    /// Queued inputs applied this step: `(seq, result)`.
    pub applied: Vec<(u32, Result<(), Reject>)>,
    /// The settlement, when the step crossed midnight.
    pub settlement: Option<DaySettlement>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Error)]
pub enum EnqueueError {
    #[error("input stamped for step {stamp} but the world is already at step {now}")]
    TooLate { stamp: u64, now: u64 },
    #[error("an input is already queued at ({0}, {1})")]
    Duplicate(u64, u32),
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct World {
    pub step: u64,
    pub seed: u64,
    pub config: SimConfig,
    rng: Pcg32,
    pub company: Company,
    pub ledger: Ledger,
    pub building: Building,
    pub staff: BTreeMap<StaffId, Staff>,
    pub candidates: BTreeMap<CandidateId, Candidate>,
    pub meetings: BTreeMap<MeetingId, Meeting>,
    /// Publications (ADR-0029).
    pub projects: BTreeMap<ProjectId, Project>,
    /// The Inbox (open and recently resolved tickets).
    pub tickets: BTreeMap<TicketId, Ticket>,
    /// The Secretary's delegated tasks (queued, working, recently done).
    pub secretary_tasks: BTreeMap<TaskId, SecretaryTask>,
    /// CFO, Secretary and the delegation policy.
    pub exec: ExecutiveOffice,
    /// Per-project books, month close.
    pub finance: Finance,
    /// Work items and pending jobs (the publishing plan's skeleton).
    pub plan: Plan,
    /// Effects since the last [`World::drain_effects`]. Not state: skipped
    /// by serde, so outside the hash and snapshots.
    #[serde(skip)]
    pub(crate) effects: Vec<Effect>,
    /// Day the praise counter belongs to, and praises given that day.
    pub praise_day: u32,
    pub praises_today: u8,
    pub ids: IdGen,
    /// Times a person could not find a path (should stay 0; connectivity is validated).
    pub nav_failures: u32,
    /// The latest remark of each person (ADR-0074); a bubble while in progress.
    #[serde(default)]
    pub remarks: BTreeMap<StaffId, crate::remarks::Remark>,
    /// The next remark's seq.
    #[serde(default)]
    pub next_remark: u32,
    pending: BTreeMap<(u64, u32), Input>,
    seq_step: u64,
    next_seq: u32,
}

enum Want {
    Away,
    Desk,
    Meeting(MeetingId),
    Lunch,
}

impl World {
    /// Empty company on the default 16×10 lot.
    pub fn new(seed: u64) -> Self {
        Self::with_config(seed, SimConfig::default())
    }

    pub fn with_config(seed: u64, config: SimConfig) -> Self {
        Self::with_parts(
            seed,
            config,
            Building::default_lot(),
            Company::new(DEFAULT_START_CASH, 1),
        )
    }

    pub fn with_parts(seed: u64, config: SimConfig, building: Building, company: Company) -> Self {
        let mut w = Self {
            step: 0,
            seed,
            config,
            rng: Pcg32::new(seed, 0x0a02_bdbf_7bb3_c0a7),
            ledger: Ledger::new(company.cash),
            company,
            building,
            staff: BTreeMap::new(),
            candidates: BTreeMap::new(),
            meetings: BTreeMap::new(),
            projects: BTreeMap::new(),
            tickets: BTreeMap::new(),
            secretary_tasks: BTreeMap::new(),
            exec: ExecutiveOffice::default(),
            finance: Finance::default(),
            plan: Plan::default(),
            effects: Vec::new(),
            praise_day: 0,
            praises_today: 0,
            ids: IdGen::default(),
            nav_failures: 0,
            remarks: BTreeMap::new(),
            next_remark: 0,
            pending: BTreeMap::new(),
            seq_step: 0,
            next_seq: 0,
        };
        w.finance.month_open_totals = w.ledger.totals.clone();
        w.refresh_candidates();
        w
    }

    /// In-game clock. Integer math: minute = start + step * 1440 / steps_per_day.
    pub fn clock(&self) -> Clock {
        self.config.clock_at(self.step)
    }

    /// Advances the simulation by one fixed step (alias of [`World::step`]).
    pub fn tick(&mut self) {
        self.step();
    }

    /// Stable hash of the whole world state, used for lockstep desync checks.
    pub fn hash(&self) -> u64 {
        let bytes = postcard::to_allocvec(self).expect("world serializes");
        xxhash_rust::xxh3::xxh3_64(&bytes)
    }

    pub fn rng(&mut self) -> &mut Pcg32 {
        &mut self.rng
    }

    // ------------------------------------------------------------------
    // Inputs
    // ------------------------------------------------------------------

    /// Validates and applies a player command now.
    pub fn apply(&mut self, cmd: Command) -> Result<CmdReceipt, Reject> {
        self.apply_input(Input::Player(cmd))
    }

    /// Validates and applies a server command now.
    pub fn apply_server(&mut self, cmd: ServerCommand) -> Result<CmdReceipt, Reject> {
        self.apply_input(Input::Server(cmd))
    }

    /// Validates and applies any input now, stamping it with the next seq of
    /// the current step. Rejected inputs leave the world untouched.
    pub fn apply_input(&mut self, input: Input) -> Result<CmdReceipt, Reject> {
        match &input {
            Input::Player(c) => validate(self, c)?,
            Input::Server(c) => validate_server(self, c)?,
        }
        if self.seq_step != self.step {
            self.seq_step = self.step;
            self.next_seq = 0;
        }
        let receipt = CmdReceipt {
            step: self.step,
            seq: self.next_seq,
        };
        self.next_seq += 1;
        match input {
            Input::Player(c) => self.execute(c),
            Input::Server(c) => self.execute_server(c),
        }
        Ok(receipt)
    }

    /// Queues a server-stamped input for application at the start of `step`.
    pub fn enqueue(&mut self, step: u64, seq: u32, input: Input) -> Result<(), EnqueueError> {
        if step < self.step {
            return Err(EnqueueError::TooLate {
                stamp: step,
                now: self.step,
            });
        }
        if self.pending.contains_key(&(step, seq)) {
            return Err(EnqueueError::Duplicate(step, seq));
        }
        self.pending.insert((step, seq), input);
        Ok(())
    }

    pub fn pending_len(&self) -> usize {
        self.pending.len()
    }

    fn execute(&mut self, cmd: Command) {
        let cost = price(self, &cmd);
        match cmd {
            Command::BuyFloorSpace { side, tiles } => {
                let (lot, _) = grown_lot(&self.building.lot, side, i32::from(tiles));
                self.building.lot = lot;
                self.post(LedgerKind::Land, -cost);
                self.replan_walkers();
            }
            Command::PlaceRoom {
                kind,
                rect,
                floor,
                doors,
                windows,
            } => {
                let id = self.ids.room();
                self.building.rooms.insert(
                    id,
                    crate::building::Room {
                        id,
                        kind,
                        rect,
                        floor,
                        level: 1,
                        doors,
                        windows,
                    },
                );
                for pos in Building::auto_light_positions(&rect) {
                    let eid = self.ids.equip();
                    self.building.equipment.insert(
                        eid,
                        Equipment {
                            id: eid,
                            kind: EquipmentKind::CeilingLight,
                            room: id,
                            pos,
                            rot: 0,
                            attached_to: None,
                        },
                    );
                }
                self.post(LedgerKind::Construction, -cost);
                self.replan_walkers();
            }
            Command::Demolish(DemolishTarget::Room(id)) => {
                self.building.equipment.retain(|_, e| e.room != id);
                self.building.rooms.remove(&id);
                self.replan_walkers();
            }
            Command::Demolish(DemolishTarget::Equipment(id)) => {
                self.building
                    .equipment
                    .retain(|_, e| e.id != id && e.attached_to != Some(id));
            }
            Command::PlaceEquipment { kind, placement } => {
                let (room, pos, rot, attached_to) = match placement {
                    Placement::OnDesk(d) => {
                        let desk = &self.building.equipment[&d];
                        (desk.room, desk.pos, desk.rot, Some(d))
                    }
                    Placement::Floor { pos, rot } => {
                        let room = self.building.room_at(pos.tile()).unwrap_or_default();
                        (room, pos, rot, None)
                    }
                };
                let id = self.ids.equip();
                self.building.equipment.insert(
                    id,
                    Equipment {
                        id,
                        kind,
                        room,
                        pos,
                        rot,
                        attached_to,
                    },
                );
                self.post(LedgerKind::Equipment, -cost);
            }
            Command::Hire { candidate } => {
                if let Some(c) = self.candidates.remove(&candidate) {
                    let payroll_before = self.payroll_cents_per_day();
                    let desk = self.free_desks().first().copied();
                    let id = self.add_staff(
                        c.persona,
                        c.role,
                        c.seniority,
                        c.traits,
                        c.salary,
                        c.role.base_schedule(),
                        desk,
                    );
                    self.post(LedgerKind::HiringFee, -cost);
                    self.hire_alerts(id, c.salary, payroll_before);
                }
            }
            Command::Fire { staff } => {
                self.post(LedgerKind::Severance, -cost);
                self.unstaff(staff);
                if self.exec.cfo == Some(staff) {
                    self.exec.cfo = None;
                }
                if self.exec.secretary == Some(staff) {
                    self.exec.secretary = None;
                    // nobody left to do them
                    self.secretary_tasks
                        .retain(|_, t| t.status == crate::inbox::TaskStatus::Done);
                }
                if let Some(s) = self.staff.get_mut(&staff) {
                    s.leaving_for_good = true;
                    s.home_desk = None;
                    if !s.is_on_site() {
                        self.staff.remove(&staff);
                    }
                }
                self.check_staffing();
            }
            Command::SetPolicy(p) => match p {
                Policy::Overtime(o) => self.company.policies.overtime = o,
                Policy::Autonomy(a) => self.company.policies.autonomy = a,
                Policy::QualityBar(q) => self.company.policies.quality_bar = q,
                Policy::EditorialBoard(on) => self.company.policies.editorial_board = on,
                Policy::Analytics(on) => self.company.policies.analytics = on,
                Policy::Distribution(on) => self.company.policies.distribution = on,
            },
            Command::Promote { staff } => {
                if let Some(s) = self.staff.get_mut(&staff) {
                    if let Some(next) = s.seniority.promoted() {
                        s.seniority = next;
                        s.salary += s.salary * 15 / 100;
                        s.morale = s.morale.saturating_add(100).min(1000);
                    }
                }
            }
            Command::SetSalary {
                staff,
                cents_per_day,
            } => {
                if let Some(s) = self.staff.get_mut(&staff) {
                    let old = s.salary.max(1);
                    let change_pct = (cents_per_day - old) * 100 / old;
                    let delta = (change_pct * 5).clamp(-200, 150);
                    let m = i64::from(s.morale) + delta;
                    s.morale = u16::try_from(m.clamp(0, 1000)).unwrap_or(0);
                    s.salary = cents_per_day;
                }
            }
            Command::AssignToProject {
                staff,
                project,
                allocation_pct,
            } => {
                if let Some(s) = self.staff.get_mut(&staff) {
                    s.projects.insert(project, allocation_pct);
                }
            }
            Command::RemoveFromProject { staff, project } => {
                if let Some(s) = self.staff.get_mut(&staff) {
                    s.projects.remove(&project);
                }
                if let Some(p) = self.projects.get_mut(&project) {
                    if p.lead == Some(staff) {
                        p.lead = None;
                    }
                }
                self.check_staffing();
            }
            Command::SetProjectLead { project, staff } => {
                if let Some(p) = self.projects.get_mut(&project) {
                    p.lead = Some(staff);
                }
            }
            Command::CreateProject { slug, name, domain } => {
                let id = self.ids.project();
                let day = self.clock().day;
                self.projects.insert(
                    id,
                    Project::new(id, &slug, &name, &domain, ProjectStatus::Proposed, day),
                );
                let from = self
                    .staff
                    .values()
                    .find(|s| s.is_active() && s.role == Role::Strategist)
                    .map(|s| s.id);
                self.raise_ticket(TicketSpec {
                    kind: TicketKind::ProjectProposal,
                    project: Some(id),
                    from,
                    role: None,
                    amount_cents: 0,
                    work_item: None,
                });
            }
            Command::SetProjectStatus { project, status } => {
                self.close_proposal_ticket(project, status != ProjectStatus::Archived);
                self.set_project_status(project, status);
            }
            Command::SetProjectBudget {
                project,
                monthly_cents,
            } => {
                if let Some(p) = self.projects.get_mut(&project) {
                    p.budget_monthly_cents = monthly_cents;
                }
            }
            Command::AnswerTicket { ticket, option } => {
                self.resolve_ticket(ticket, option, crate::inbox::ResolvedBy::Ceo);
            }
            Command::Delegate { task } => {
                self.enqueue_task(task);
            }
            Command::SetDelegation { policy } => {
                self.exec.delegation = policy;
                self.secretary_answers();
            }
            Command::UpdateWorkItem { item, update } => self.update_item(item, update),
            Command::Praise { staff } => {
                let bonus = if self.building.first_room_of(RoomKind::CeoOffice).is_some() {
                    PRAISE_MORALE + PRAISE_MORALE / 5
                } else {
                    PRAISE_MORALE
                };
                if let Some(s) = self.staff.get_mut(&staff) {
                    s.morale = s.morale.saturating_add(bonus).min(1000);
                }
                self.praises_today += 1;
            }
        }
    }

    /// Changes a project's status (validated by the caller). Archiving
    /// releases the team; activating checks staffing.
    pub(crate) fn set_project_status(&mut self, project: ProjectId, status: ProjectStatus) {
        let Some(p) = self.projects.get_mut(&project) else {
            return;
        };
        if !p.status.can_become(status) {
            return;
        }
        if status == ProjectStatus::Active
            && p.status == ProjectStatus::Proposed
            && self
                .projects
                .values()
                .filter(|q| q.status == ProjectStatus::Active || q.status == ProjectStatus::Paused)
                .count()
                >= self.project_limit()
        {
            return;
        }
        if let Some(p) = self.projects.get_mut(&project) {
            p.status = status;
        }
        match status {
            ProjectStatus::Archived => self.release_team(project),
            ProjectStatus::Active => self.check_staffing(),
            _ => {}
        }
    }

    /// Today's payroll, cents.
    pub fn payroll_cents_per_day(&self) -> i64 {
        self.staff
            .values()
            .filter(|s| s.is_active())
            .map(|s| s.salary)
            .sum()
    }

    /// CFO comments on a hire: affordability (always) and a payroll spike
    /// when one hire raises payroll by more than 15%.
    fn hire_alerts(&mut self, hired: StaffId, salary: i64, payroll_before: i64) {
        let Some(cfo) = self.exec.cfo.filter(|c| *c != hired) else {
            return;
        };
        self.raise_ticket(TicketSpec {
            kind: TicketKind::HireAffordability,
            project: None,
            from: Some(cfo),
            role: self.staff.get(&hired).map(|s| s.role),
            amount_cents: salary * i64::from(MONTH_DAYS),
            work_item: None,
        });
        if salary * 100 > payroll_before * PAYROLL_SPIKE_PCT {
            self.raise_ticket(TicketSpec {
                kind: TicketKind::PayrollSpike,
                project: None,
                from: Some(cfo),
                role: self.staff.get(&hired).map(|s| s.role),
                amount_cents: salary * i64::from(MONTH_DAYS),
                work_item: None,
            });
        }
    }

    fn execute_server(&mut self, cmd: ServerCommand) {
        match cmd {
            ServerCommand::JobCompleted { job_id, digest } => {
                self.apply_job_completed(job_id, digest);
            }
            ServerCommand::MeetingOutcome { job_id, briefs } => {
                self.apply_meeting_outcome(job_id, &briefs);
            }
            ServerCommand::BoardOutcome {
                job_id,
                workstreams,
                items,
            } => self.apply_board_outcome(job_id, &workstreams, &items),
            ServerCommand::DeployLanded { work_item } => self.apply_deploy_landed(work_item),
            ServerCommand::JobFailed { job_id, reason } => self.apply_job_failed(job_id, reason),
            ServerCommand::DeployFailed { work_item } => self.apply_deploy_failed(work_item),
            ServerCommand::Utterance {
                meeting,
                speaker,
                chars,
                ..
            } => {
                let from = self.step;
                if let Some(m) = self.meetings.get_mut(&meeting) {
                    m.speaker = Some(speaker);
                    m.speak_from = from;
                    m.speak_until = from + utterance_steps(chars);
                    m.speak_chars = chars;
                    m.next_seq += 1;
                }
            }
            ServerCommand::SiteSignals(s) => self.company.signals = Some(s),
            ServerCommand::Remark {
                speaker,
                listener,
                seq,
                chars,
            } => self.apply_remark(speaker, listener, seq, chars),
            ServerCommand::AnalyticsSignals {
                project,
                day,
                sessions,
                visitors,
                pageviews,
                engagement_pm,
                top_pages_digest,
            } => {
                if let Some(p) = self.projects.get_mut(&project) {
                    p.analytics.record(crate::projects::AnalyticsDay {
                        day,
                        sessions,
                        visitors,
                        pageviews,
                        engagement_pm,
                        top_pages_digest,
                    });
                    p.refresh_kpis();
                }
                self.refresh_revenue_estimate(project);
            }
        }
    }

    fn post(&mut self, kind: LedgerKind, amount: i64) {
        self.ledger.post(&mut self.company.cash, kind, amount);
    }

    // ------------------------------------------------------------------
    // Staff management helpers
    // ------------------------------------------------------------------

    /// Adds an employee directly (scenario builders; `Hire` goes through
    /// [`World::apply`]). Today's schedule is rolled from the world RNG.
    #[allow(clippy::too_many_arguments)]
    pub fn add_staff(
        &mut self,
        persona_id: PersonaId,
        role: Role,
        seniority: Seniority,
        traits: Traits,
        salary: i64,
        base_schedule: Schedule,
        home_desk: Option<EquipId>,
    ) -> StaffId {
        let id = self.ids.staff();
        let today = base_schedule.jittered(&mut self.rng);
        let spawn = self.building.spawn_pos();
        self.staff.insert(
            id,
            Staff {
                id,
                persona: persona_id,
                role,
                seniority,
                traits,
                morale: START_MORALE,
                fatigue: 0,
                salary,
                home_desk,
                base_schedule,
                today,
                activity: Activity::OffSite,
                spot: None,
                pos: spawn,
                path: None,
                overtime_minutes: 0,
                leaving_for_good: false,
                projects: BTreeMap::new(),
            },
        );
        match role {
            Role::Cfo if self.exec.cfo.is_none() => self.exec.cfo = Some(id),
            Role::Secretary if self.exec.secretary.is_none() => {
                self.exec.secretary = Some(id);
                if self
                    .tickets
                    .values()
                    .any(|t| t.is_open() && !t.routed_via_secretary)
                {
                    self.enqueue_task(SecretaryTaskKind::TriageInbox);
                }
            }
            _ => {}
        }
        id
    }

    /// Adds a candidate for `role` to today's shortlist: a pool persona with
    /// that role nobody plays yet, else a generic one.
    pub fn add_candidate_for_role(&mut self, role: Role) {
        let taken = |p: PersonaId, w: &World| {
            w.staff.values().any(|s| s.persona == p)
                || w.candidates.values().any(|c| c.persona == p)
        };
        let pid = PERSONAS
            .iter()
            .filter(|p| p.role == role)
            .map(|p| p.persona_id())
            .find(|p| !taken(*p, self))
            .unwrap_or(PersonaId(0));
        let seniority = persona(pid).map_or(Seniority::Mid, |p| p.seniority);
        let seniority = if seniority == Seniority::Star && self.company.level < 5 {
            Seniority::Senior
        } else {
            seniority
        };
        let traits = Traits::roll(&mut self.rng);
        let salary = persona(pid).map_or(salary_for(role, seniority), |p| p.salary_cents_per_day());
        let id = self.ids.candidate();
        self.candidates.insert(
            id,
            Candidate {
                id,
                persona: pid,
                role,
                seniority,
                traits,
                salary,
            },
        );
    }

    /// Desks nobody calls home, lowest id first.
    pub fn free_desks(&self) -> Vec<EquipId> {
        self.building
            .equipment
            .values()
            .filter(|e| e.kind == EquipmentKind::Desk)
            .filter(|e| !self.staff.values().any(|s| s.home_desk == Some(e.id)))
            .map(|e| e.id)
            .collect()
    }

    /// Floor position of a spot.
    pub fn spot_pos(&self, spot: Spot) -> Option<PosMm> {
        match spot {
            Spot::Desk(d) => self.building.equipment.get(&d).map(Equipment::seat_pos),
            Spot::MeetingSeat { meeting, seat } => {
                let m = self.meetings.get(&meeting)?;
                self.table_seat(m.room, seat)
            }
            Spot::KitchenSeat { room, seat } => self.table_seat(room, seat),
        }
    }

    fn table_seat(&self, room: RoomId, seat: u8) -> Option<PosMm> {
        let r = self.building.rooms.get(&room)?;
        let (dx, dz) = ROUND_TABLE_SEATS.get(usize::from(seat))?;
        let c = r.rect.center_mm();
        // keep every seat at least 400 mm off the walls
        let hx = (r.rect.w * crate::geom::TILE_MM / 2 - 400).max(0);
        let hz = (r.rect.d * crate::geom::TILE_MM / 2 - 400).max(0);
        Some(PosMm::new(
            c.x + (*dx).clamp(-hx, hx),
            c.z + (*dz).clamp(-hz, hz),
        ))
    }

    fn table_size(&self, room: RoomId) -> u8 {
        self.building.rooms.get(&room).map_or(0, |r| {
            u8::try_from(usize::from(r.capacity()).min(ROUND_TABLE_SEATS.len())).unwrap_or(0)
        })
    }

    /// Replaces the hiring shortlist with fresh seeded candidates.
    pub fn refresh_candidates(&mut self) {
        self.candidates.clear();
        // Prefer personas nobody on staff (or on the shortlist) already plays.
        // The executive office is filled deliberately, not from the daily list.
        let mut pool: Vec<PersonaId> = PERSONAS
            .iter()
            .filter(|p| !p.role.is_executive())
            .map(|p| p.persona_id())
            .filter(|p| !self.staff.values().any(|s| s.persona == *p))
            .collect();
        for _ in 0..CANDIDATES_PER_DAY {
            let id = self.ids.candidate();
            let pid = if pool.is_empty() {
                let n = u32::try_from(PERSONAS.len()).unwrap_or(1);
                let i = usize::try_from(self.rng.next_u32() % n).unwrap_or(0);
                PERSONAS[i].persona_id()
            } else {
                let n = u32::try_from(pool.len()).unwrap_or(1);
                let i = usize::try_from(self.rng.next_u32() % n).unwrap_or(0);
                pool.remove(i)
            };
            // Candidates are catalog personas: their role, seniority and
            // asking salary (± 10%) come from the catalog (ADR-0030).
            let (role, seniority, asking) = persona(pid).map_or(
                (
                    Role::Writer,
                    Seniority::Junior,
                    salary_for(Role::Writer, Seniority::Junior),
                ),
                |p| (p.role, p.seniority, p.salary_cents_per_day()),
            );
            let seniority = if seniority == Seniority::Star && self.company.level < 5 {
                Seniority::Senior
            } else {
                seniority
            };
            let traits = Traits::roll(&mut self.rng);
            let jitter = i64::from(self.rng.next_u32() % 21) - 10;
            let salary = asking * (100 + jitter) / 100;
            self.candidates.insert(
                id,
                Candidate {
                    id,
                    persona: pid,
                    role,
                    seniority,
                    traits,
                    salary,
                },
            );
        }
    }

    // ------------------------------------------------------------------
    // The step
    // ------------------------------------------------------------------

    /// Advances the simulation by one fixed step (100 ms).
    pub fn step(&mut self) -> StepReport {
        let mut report = StepReport::default();

        // 1. queued inputs for this step, in seq order
        while let Some(entry) = self.pending.first_entry() {
            if entry.key().0 != self.step {
                break;
            }
            let ((_, seq), input) = entry.remove_entry();
            let result = self.apply_input(input).map(|_| ());
            report.applied.push((seq, result));
        }

        // 2. clock
        let before = self.clock();
        self.step += 1;
        let now = self.clock();

        // 3. new day
        if now.day != before.day {
            report.settlement = Some(self.settle(before.day));
        }

        // 4. per-minute effects
        if now.total_minutes() > before.total_minutes() {
            self.minute_effects(before, now);
        }

        // 5. meetings
        self.update_meetings(now);

        // 6. tickets past their deadline; at 08:30 parked items go back on
        //    the CEO's desk; work items whose phase is done
        self.expire_tickets();
        self.raise_morning_approvals(before, now);
        self.advance_work();

        // 7. staff
        self.update_staff(now);

        report
    }

    fn settle(&mut self, day: u32) -> DaySettlement {
        let attribution = attribute_day(
            &self.staff,
            &self.projects,
            self.building.lot.area() * economy::RENT_PER_TILE,
            economy::upkeep(&self.building),
            economy::revenue_stub(),
        );
        let s = economy::settle(
            day,
            &mut self.company,
            &mut self.ledger,
            &self.building,
            self.staff.values_mut(),
        );
        self.book_day(&s, attribution);
        self.finance_alerts();
        // (`%` instead of `is_multiple_of` keeps MSRV 1.85)
        if let 0 = (day + 1) % MONTH_DAYS {
            self.month_close(day);
        }
        self.check_staffing();
        self.praise_day = day + 1;
        self.praises_today = 0;
        for st in self.staff.values_mut() {
            st.today = st.base_schedule.jittered(&mut self.rng);
        }
        self.refresh_candidates();
        s
    }

    fn minute_effects(&mut self, before: Clock, now: Clock) {
        let delta = u32::try_from(now.total_minutes() - before.total_minutes()).unwrap_or(1);
        let evening = now.minute >= EVENING_START || now.minute < ARRIVAL_START;
        let hour_changed = before.total_minutes() / 60 != now.total_minutes() / 60;
        let crunch = self.company.policies.overtime == OvertimePolicy::Crunch;
        for s in self.staff.values_mut() {
            if s.is_on_site() && evening {
                s.overtime_minutes = s.overtime_minutes.saturating_add(delta);
            }
            let d16 = u16::try_from(delta).unwrap_or(u16::MAX);
            if s.activity.is_work() {
                let inc = if evening { d16.saturating_mul(2) } else { d16 };
                s.fatigue = s.fatigue.saturating_add(inc).min(1000);
            } else if !s.is_on_site() {
                s.fatigue = s.fatigue.saturating_sub(d16.saturating_mul(2));
            }
            if hour_changed {
                let penalty: i32 = if crunch { 150 } else { 0 };
                let target = (750 - i32::from(s.fatigue) / 3 - penalty).clamp(0, 1000);
                let m = i32::from(s.morale);
                let next = m + (target - m).clamp(-10, 10);
                s.morale = u16::try_from(next).unwrap_or(0);
            }
        }
        // 08:30: the Secretary prepares the CEO briefing.
        if self.exec.secretary.is_some()
            && now.minute >= BRIEFING_TIME
            && self.exec.briefing_queued_day != Some(now.day)
        {
            self.exec.briefing_queued_day = Some(now.day);
            self.enqueue_task(SecretaryTaskKind::PrepareBriefing { project: None });
        }
        self.process_secretary();
    }

    /// Books a meeting.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn open_meeting(
        &mut self,
        kind: MeetingKind,
        project: Option<ProjectId>,
        room: RoomId,
        day: u32,
        start: u16,
        end: u16,
        attendees: BTreeSet<StaffId>,
    ) -> MeetingId {
        let id = self.ids.meeting();
        self.meetings.insert(
            id,
            Meeting {
                id,
                kind,
                project,
                room,
                day,
                start,
                end,
                attendees,
                job: None,
                next_seq: 0,
                speaker: None,
                speak_from: 0,
                speak_until: 0,
                speak_chars: 0,
            },
        );
        id
    }

    fn has_meeting(&self, kind: MeetingKind, project: Option<ProjectId>, day: u32) -> bool {
        self.meetings
            .values()
            .any(|m| m.kind == kind && m.project == project && m.day == day)
    }

    /// A meeting-capable room with no meeting overlapping `start..end` today.
    fn free_meeting_room(
        &self,
        day: u32,
        start: u16,
        end: u16,
        prefer: Option<RoomId>,
    ) -> Option<RoomId> {
        let free = |r: &RoomId| {
            !self
                .meetings
                .values()
                .any(|m| m.room == *r && m.day == day && m.start < end && start < m.end)
        };
        prefer
            .into_iter()
            .chain(self.building.meeting_rooms())
            .find(free)
    }

    fn active_with_role(&self, role: Role) -> Vec<StaffId> {
        self.staff
            .values()
            .filter(|s| s.is_active() && s.role == role)
            .map(|s| s.id)
            .collect()
    }

    /// Who sits in a project's standup: its active team plus the
    /// strategists. Empty when the project has no team.
    fn standup_team(&self, project: ProjectId) -> BTreeSet<StaffId> {
        let mut team: BTreeSet<StaffId> = self
            .project_team(project)
            .into_keys()
            .filter(|s| self.staff.get(s).is_some_and(|s| s.is_active()))
            .collect();
        if !team.is_empty() {
            team.extend(self.active_with_role(Role::Strategist));
        }
        team
    }

    /// A standup from `start` on `day`: at most an hour, never past midnight.
    fn standup_end(start: u16) -> u16 {
        (start + STANDUP_TIMEOUT_MINUTES).min(hm(24, 0))
    }

    /// Opens a project's standup at `start` and requests its job. Does
    /// nothing without a team or a free meeting room.
    fn open_standup(&mut self, project: ProjectId, day: u32, start: u16) {
        // Planned work comes first: the standup pitches into what is left.
        self.start_due_planned(project, day);
        let attendees = self.standup_team(project);
        let end = Self::standup_end(start);
        let Some(room) = (!attendees.is_empty())
            .then(|| self.free_meeting_room(day, start, end, None))
            .flatten()
        else {
            return;
        };
        let staff: Vec<StaffId> = attendees.iter().copied().collect();
        let mid = self.open_meeting(
            MeetingKind::Standup,
            Some(project),
            room,
            day,
            start,
            end,
            attendees,
        );
        self.plan.standup_days.insert(project, day);
        let job = self.request_job(JobKind::Standup, project, None, None, 0, Some(mid), staff);
        if let Some(m) = self.meetings.get_mut(&mid) {
            m.job = Some(job);
        }
    }

    /// Whether a `StandupFailed` ticket's `Retry` can open a standup for
    /// `project` now (pure).
    pub(crate) fn standup_possible(&self, project: ProjectId) -> Result<(), &'static str> {
        let active = self
            .projects
            .get(&project)
            .is_some_and(|p| p.status == ProjectStatus::Active);
        if !active {
            return Err("the project is not active");
        }
        if self
            .plan
            .jobs
            .values()
            .any(|j| j.kind == JobKind::Standup && j.project == project)
        {
            return Err("a standup of this project is already running");
        }
        if self.standup_team(project).is_empty() {
            return Err("the project has no team");
        }
        let now = self.clock();
        let end = Self::standup_end(now.minute);
        if self
            .free_meeting_room(now.day, now.minute, end, None)
            .is_none()
        {
            return Err("no meeting room is free");
        }
        Ok(())
    }

    /// `StandupFailed` answer `Retry`: the standup is held again, starting
    /// now, with a new job.
    pub(crate) fn retry_standup(&mut self, project: ProjectId) {
        if self.standup_possible(project).is_ok() {
            let now = self.clock();
            self.open_standup(project, now.day, now.minute);
        }
    }

    /// Who sits on a project's editorial board (ADR-0069): the strategists,
    /// the editors-in-chief, the project's editors and its SEO and marketing
    /// staff, and the CFO. Empty when the project has no editor to plan for.
    fn board_team(&self, project: ProjectId) -> BTreeSet<StaffId> {
        let team: BTreeSet<StaffId> = self
            .project_team(project)
            .into_keys()
            .filter(|s| {
                self.staff.get(s).is_some_and(|s| {
                    s.is_active()
                        && matches!(
                            s.role,
                            Role::Editor
                                | Role::EditorInChief
                                | Role::SeoSpecialist
                                | Role::MarketingManager
                        )
                })
            })
            .collect();
        let has_editor = team
            .iter()
            .any(|s| self.staff.get(s).is_some_and(|s| can_review(s.role)));
        if !has_editor {
            return BTreeSet::new();
        }
        team.into_iter()
            .chain(self.active_with_role(Role::Strategist))
            .chain(self.active_with_role(Role::EditorInChief))
            .chain(
                self.exec
                    .cfo
                    .filter(|c| self.staff.get(c).is_some_and(|s| s.is_active())),
            )
            .collect()
    }

    /// A board from `start`: at most two hours, never past midnight.
    fn board_end(start: u16) -> u16 {
        (start + BOARD_TIMEOUT_MINUTES).min(hm(24, 0))
    }

    /// Opens a project's editorial board at `start` and requests its job.
    /// Does nothing without a team or a free meeting room.
    fn open_board(&mut self, project: ProjectId, day: u32, start: u16) {
        let attendees = self.board_team(project);
        let end = Self::board_end(start);
        let Some(room) = (!attendees.is_empty())
            .then(|| self.free_meeting_room(day, start, end, None))
            .flatten()
        else {
            return;
        };
        let staff: Vec<StaffId> = attendees.iter().copied().collect();
        let mid = self.open_meeting(
            MeetingKind::EditorialBoard,
            Some(project),
            room,
            day,
            start,
            end,
            attendees,
        );
        self.plan.board_days.insert(project, day);
        let job = self.request_job(JobKind::Board, project, None, None, 0, Some(mid), staff);
        if let Some(m) = self.meetings.get_mut(&mid) {
            m.job = Some(job);
        }
    }

    /// Whether a `BoardFailed` ticket's `Retry` can hold the board for
    /// `project` now (pure).
    pub(crate) fn board_possible(&self, project: ProjectId) -> Result<(), &'static str> {
        let active = self
            .projects
            .get(&project)
            .is_some_and(|p| p.status == ProjectStatus::Active);
        if !active {
            return Err("the project is not active");
        }
        if !self.company.policies.editorial_board {
            return Err("the editorial board is off");
        }
        if self
            .plan
            .jobs
            .values()
            .any(|j| j.kind == JobKind::Board && j.project == project)
        {
            return Err("a board of this project is already running");
        }
        if self.board_team(project).is_empty() {
            return Err("the project has no editor");
        }
        let now = self.clock();
        let end = Self::board_end(now.minute);
        if self
            .free_meeting_room(now.day, now.minute, end, None)
            .is_none()
        {
            return Err("no meeting room is free");
        }
        Ok(())
    }

    /// `BoardFailed` answer `Retry`: the board is held again, starting now.
    pub(crate) fn retry_board(&mut self, project: ProjectId) {
        if self.board_possible(project).is_ok() {
            let now = self.clock();
            self.open_board(project, now.day, now.minute);
        }
    }

    /// The daily rhythm (organization.md §8).
    fn schedule_rituals(&mut self, now: Clock) {
        let day = now.day;
        // 09:00: one standup per active project, with its team; the
        // strategists pitch in.
        if (STANDUP_START..STANDUP_END).contains(&now.minute) {
            let active: Vec<ProjectId> = self
                .projects
                .values()
                .filter(|p| p.status == ProjectStatus::Active)
                .map(|p| p.id)
                .collect();
            for pid in active {
                if self.has_meeting(MeetingKind::Standup, Some(pid), day)
                    || self.plan.standup_days.get(&pid) == Some(&day)
                {
                    continue;
                }
                // The standup runs until its outcome arrives, at most an hour.
                self.open_standup(pid, day, STANDUP_START);
            }
        }
        // 11:00: the data scientist's follow-ups of items published 14 days ago (ADR-0071).
        if self.company.policies.analytics && (FOLLOW_UP_START..FOLLOW_UP_END).contains(&now.minute)
        {
            self.request_follow_ups(day);
        }
        // Monday 10:00, and a project's first 10:00: the editorial board
        // plans the week (ADR-0069), when the policy is on.
        if self.company.policies.editorial_board && (BOARD_START..BOARD_END).contains(&now.minute) {
            let active: Vec<ProjectId> = self
                .projects
                .values()
                .filter(|p| p.status == ProjectStatus::Active)
                .map(|p| p.id)
                .collect();
            for pid in active {
                let last = self.plan.board_days.get(&pid).copied();
                let due = match last {
                    None => true,
                    Some(d) => d != day && now.weekday() == Weekday::Monday,
                };
                if !due || self.has_meeting(MeetingKind::EditorialBoard, Some(pid), day) {
                    continue;
                }
                self.open_board(pid, day, BOARD_START);
            }
        }
        let office: Vec<StaffId> = self
            .exec
            .cfo
            .into_iter()
            .chain(self.exec.secretary)
            .collect();
        // Monday 09:30: KPI review, only with a data scientist.
        if now.weekday() == Weekday::Monday
            && (KPI_REVIEW_START..KPI_REVIEW_END).contains(&now.minute)
            && !self.has_meeting(MeetingKind::KpiReview, None, day)
        {
            let scientists = self.active_with_role(Role::DataScientist);
            if !scientists.is_empty() {
                let attendees: BTreeSet<StaffId> = scientists
                    .into_iter()
                    .chain(office.iter().copied())
                    .collect();
                if let Some(room) =
                    self.free_meeting_room(day, KPI_REVIEW_START, KPI_REVIEW_END, None)
                {
                    let mid = self.open_meeting(
                        MeetingKind::KpiReview,
                        None,
                        room,
                        day,
                        KPI_REVIEW_START,
                        KPI_REVIEW_END,
                        attendees,
                    );
                    // The data scientist's report (ADR-0071), for the first active project.
                    let project = self
                        .projects
                        .values()
                        .find(|p| p.status == ProjectStatus::Active)
                        .map(|p| p.id);
                    if let (true, Some(project), Some(ds)) = (
                        self.company.policies.analytics,
                        project,
                        self.data_scientist(),
                    ) {
                        let job = self.request_job(
                            JobKind::KpiReport,
                            project,
                            None,
                            None,
                            0,
                            Some(mid),
                            vec![ds],
                        );
                        if let Some(m) = self.meetings.get_mut(&mid) {
                            m.job = Some(job);
                        }
                    }
                }
            }
        }
        // Friday 16:00: finance review, only with a CFO.
        if now.weekday() == Weekday::Friday
            && (FINANCE_REVIEW_START..FINANCE_REVIEW_END).contains(&now.minute)
            && self.exec.cfo.is_some()
            && !self.has_meeting(MeetingKind::FinanceReview, None, day)
        {
            let attendees: BTreeSet<StaffId> = office.iter().copied().collect();
            let prefer = self
                .building
                .first_room_of(RoomKind::FinanceOffice)
                .map(|r| r.id);
            if let Some(room) =
                self.free_meeting_room(day, FINANCE_REVIEW_START, FINANCE_REVIEW_END, prefer)
            {
                self.open_meeting(
                    MeetingKind::FinanceReview,
                    None,
                    room,
                    day,
                    FINANCE_REVIEW_START,
                    FINANCE_REVIEW_END,
                    attendees,
                );
            }
        }
    }

    fn update_meetings(&mut self, now: Clock) {
        self.schedule_rituals(now);
        self.time_out_standups();
        let step = self.step;
        let staff = &self.staff;
        self.meetings.retain(|id, m| {
            m.is_pending(now)
                || staff.values().any(
                    |s| matches!(s.spot, Some(Spot::MeetingSeat { meeting, .. }) if meeting == *id),
                )
        });
        for m in self.meetings.values_mut() {
            if m.speaker.is_some() && step >= m.speak_until {
                m.speaker = None;
            }
        }
    }

    fn effective_leave(&self, leave: u16) -> u16 {
        match self.company.policies.overtime {
            OvertimePolicy::Never => leave.min(hm(18, 30)),
            OvertimePolicy::Allow => leave,
            OvertimePolicy::Crunch => leave.max(hm(20, 0)).min(LATEST_LEAVE),
        }
    }

    fn want(&self, s: &Staff, now: Clock) -> Want {
        if s.leaving_for_good || s.home_desk.is_none() {
            return Want::Away;
        }
        let leave = self.effective_leave(s.today.leave);
        if now.minute < s.today.arrive || now.minute >= leave {
            return Want::Away;
        }
        if let Some(m) = self.meetings.values().find(|m| {
            m.is_active(now)
                && m.attendees.contains(&s.id)
                && s.today.arrive <= m.start + MEETING_GRACE_MINUTES
        }) {
            return Want::Meeting(m.id);
        }
        if now.minute >= s.today.lunch && now.minute < s.today.lunch + LUNCH_MINUTES {
            return Want::Lunch;
        }
        Want::Desk
    }

    /// Lowest free seat at a table, keeping the person's current seat.
    fn free_seat(
        &self,
        me: StaffId,
        current: Option<u8>,
        taken: impl Fn(&Spot) -> Option<u8>,
        size: u8,
    ) -> Option<u8> {
        if current.is_some() {
            return current;
        }
        (0..size).find(|seat| {
            !self
                .staff
                .values()
                .any(|s| s.id != me && s.spot.as_ref().and_then(&taken) == Some(*seat))
        })
    }

    /// Target spot, the activity once there, and the activity while walking there.
    fn resolve(&self, s: &Staff, want: Want) -> Option<(Spot, Activity, Activity)> {
        let desk = s.home_desk?;
        let at_desk = |activity| Some((Spot::Desk(desk), activity, Activity::ReturningToDesk));
        match want {
            Want::Away => None,
            Want::Desk => at_desk(Activity::Working),
            Want::Meeting(mid) => {
                let room = self.meetings.get(&mid)?.room;
                let current = match s.spot {
                    Some(Spot::MeetingSeat { meeting, seat }) if meeting == mid => Some(seat),
                    _ => None,
                };
                let taken = |sp: &Spot| match *sp {
                    Spot::MeetingSeat { meeting, seat } if meeting == mid => Some(seat),
                    _ => None,
                };
                match self.free_seat(s.id, current, taken, self.table_size(room)) {
                    Some(seat) => Some((
                        Spot::MeetingSeat { meeting: mid, seat },
                        Activity::InMeeting,
                        Activity::WalkingToMeeting,
                    )),
                    None => at_desk(Activity::Working),
                }
            }
            Want::Lunch => {
                let Some(kitchen) = self.building.first_room_of(RoomKind::Kitchen).map(|r| r.id)
                else {
                    return at_desk(Activity::Lunch);
                };
                let current = match s.spot {
                    Some(Spot::KitchenSeat { room, seat }) if room == kitchen => Some(seat),
                    _ => None,
                };
                let taken = |sp: &Spot| match *sp {
                    Spot::KitchenSeat { room, seat } if room == kitchen => Some(seat),
                    _ => None,
                };
                match self.free_seat(s.id, current, taken, self.table_size(kitchen)) {
                    Some(seat) => Some((
                        Spot::KitchenSeat {
                            room: kitchen,
                            seat,
                        },
                        Activity::Lunch,
                        Activity::WalkingToLunch,
                    )),
                    None => at_desk(Activity::Lunch),
                }
            }
        }
    }

    fn update_staff(&mut self, now: Clock) {
        let step = self.step;
        let spawn = self.building.spawn_pos();
        let mut grid: Option<NavGrid> = None;
        let ids: Vec<StaffId> = self.staff.keys().copied().collect();
        for id in ids {
            // movement
            let Some(s) = self.staff.get_mut(&id) else {
                continue;
            };
            if let Some(path) = &s.path {
                let (pos, done) = path.sample(step);
                s.pos = pos;
                if !done {
                    continue;
                }
                s.path = None;
                if s.activity == Activity::Leaving {
                    s.activity = Activity::OffSite;
                    s.spot = None;
                    s.pos = spawn;
                    if s.leaving_for_good {
                        self.staff.remove(&id);
                        continue;
                    }
                }
            }

            // decision
            let s = &self.staff[&id];
            let want = self.want(s, now);
            let target = self.resolve(s, want);
            let on_site = s.is_on_site();
            let (pos, cur_spot, speed) = (s.pos, s.spot, s.traits.walk_speed());
            let plan = match target {
                None if !on_site => continue,
                None => Some((None, Activity::Leaving, spawn)),
                Some((spot, at, _)) if on_site && cur_spot == Some(spot) => {
                    if let Some(s) = self.staff.get_mut(&id) {
                        s.activity = at;
                    }
                    continue;
                }
                Some((spot, _, walk)) => {
                    let walk = if on_site { walk } else { Activity::Arriving };
                    self.spot_pos(spot).map(|p| (Some(spot), walk, p))
                }
            };
            let Some((spot, activity, dest)) = plan else {
                self.nav_failures = self.nav_failures.saturating_add(1);
                continue;
            };
            let from = if on_site { pos } else { spawn };
            let g = grid.get_or_insert_with(|| self.building.nav_grid());
            let waypoints = plan_path(g, from, dest);
            let Some(s) = self.staff.get_mut(&id) else {
                continue;
            };
            match waypoints {
                Some(wp) => {
                    s.pos = from;
                    s.path = Some(Path::new(wp, step, speed));
                    s.spot = spot;
                    s.activity = activity;
                }
                None if activity == Activity::Leaving => {
                    // Cannot happen with validated buildings; never strand anyone.
                    s.activity = Activity::OffSite;
                    s.spot = None;
                    s.pos = spawn;
                    self.nav_failures = self.nav_failures.saturating_add(1);
                }
                None => self.nav_failures = self.nav_failures.saturating_add(1),
            }
        }
    }

    /// After walls change, re-plan every walk in progress from where the
    /// walker is now to the same destination.
    fn replan_walkers(&mut self) {
        let grid = self.building.nav_grid();
        let step = self.step;
        let mut failures = 0u32;
        for s in self.staff.values_mut() {
            let Some(path) = &s.path else {
                continue;
            };
            let (pos, _) = path.sample(step);
            let Some(dest) = path.destination() else {
                continue;
            };
            match plan_path(&grid, pos, dest) {
                Some(wp) => {
                    s.pos = pos;
                    s.path = Some(Path::new(wp, step, path.speed_mm_per_step));
                }
                None => failures += 1,
            }
        }
        self.nav_failures = self.nav_failures.saturating_add(failures);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clock::MINUTES_PER_DAY;
    use crate::scenarios::demo_office;

    #[test]
    fn same_seed_same_hash() {
        let mut a = World::new(42);
        let mut b = World::new(42);
        for _ in 0..1000 {
            a.tick();
            b.tick();
        }
        assert_eq!(a.hash(), b.hash());
    }

    #[test]
    fn different_seed_different_hash() {
        assert_ne!(World::new(1).hash(), World::new(2).hash());
    }

    #[test]
    fn clock_advances_one_day_per_configured_period() {
        let mut w = World::new(1);
        assert_eq!(
            w.clock(),
            Clock {
                day: 0,
                minute: 420
            }
        );
        for _ in 0..w.config.steps_per_day() {
            w.tick();
        }
        assert_eq!(
            w.clock(),
            Clock {
                day: 1,
                minute: 420
            }
        );
    }

    #[test]
    fn clock_wraps_at_midnight() {
        let mut w = World::with_config(
            1,
            SimConfig {
                day_real_minutes: 144,
                start_minute: 23 * 60 + 59,
            },
        );
        let per_minute = w.config.steps_per_day() / MINUTES_PER_DAY;
        assert!(per_minute > 0);
        for _ in 0..per_minute {
            w.tick();
        }
        assert_eq!(w.clock(), Clock { day: 1, minute: 0 });
    }

    #[test]
    fn enqueue_orders_by_step_and_seq() {
        let mut w = World::new(3);
        let p = |o| Input::Player(Command::SetPolicy(Policy::Overtime(o)));
        w.enqueue(2, 1, p(OvertimePolicy::Never)).unwrap();
        w.enqueue(2, 0, p(OvertimePolicy::Crunch)).unwrap();
        assert_eq!(
            w.enqueue(2, 0, p(OvertimePolicy::Allow)),
            Err(EnqueueError::Duplicate(2, 0))
        );
        w.step();
        w.step();
        assert_eq!(w.pending_len(), 2);
        let r = w.step();
        assert_eq!(r.applied, vec![(0, Ok(())), (1, Ok(()))]);
        // seq 1 (Never) applied last
        assert_eq!(w.company.policies.overtime, OvertimePolicy::Never);
        assert!(matches!(
            w.enqueue(0, 0, p(OvertimePolicy::Allow)),
            Err(EnqueueError::TooLate { .. })
        ));
    }

    #[test]
    fn apply_receipts_count_per_step() {
        let mut w = World::new(3);
        let c = Command::SetPolicy(Policy::QualityBar(8));
        assert_eq!(w.apply(c.clone()).unwrap(), CmdReceipt { step: 0, seq: 0 });
        assert_eq!(w.apply(c.clone()).unwrap(), CmdReceipt { step: 0, seq: 1 });
        assert!(w.apply(Command::SetPolicy(Policy::QualityBar(42))).is_err());
        w.step();
        assert_eq!(w.apply(c).unwrap(), CmdReceipt { step: 1, seq: 0 });
    }

    #[test]
    fn rejected_command_leaves_world_untouched() {
        let mut w = demo_office(5);
        let h = w.hash();
        assert!(w
            .apply(Command::Fire {
                staff: StaffId(999)
            })
            .is_err());
        assert_eq!(w.hash(), h);
    }

    #[test]
    fn settlement_runs_at_midnight_and_conserves_cash() {
        let mut w = demo_office(5);
        let mut settlements = 0;
        for _ in 0..w.config.steps_per_day() {
            if let Some(s) = w.step().settlement {
                settlements += 1;
                assert_eq!(s.day, 0);
                assert!(s.revenue_stubbed);
                assert_eq!(s.salaries, w.staff.values().map(|s| s.salary).sum::<i64>());
                assert!(s.overtime > 0, "Marco works late");
            }
        }
        assert_eq!(settlements, 1);
        assert_eq!(w.ledger.opening_cash + w.ledger.total(), w.company.cash);
    }

    #[test]
    fn utterance_makes_speaker_talk() {
        let mut w = demo_office(7);
        // run to 09:10 on day 0
        while w.clock().minute < hm(9, 10) {
            w.step();
        }
        let m = *w.meetings.keys().next().expect("standup open");
        let speaker = w
            .staff
            .values()
            .find(|s| s.path.is_none() && matches!(s.spot, Some(Spot::MeetingSeat { .. })))
            .expect("someone seated")
            .id;
        let bad_seq = ServerCommand::Utterance {
            meeting: m,
            seq: 3,
            speaker,
            chars: 90,
        };
        assert!(matches!(
            w.apply_server(bad_seq),
            Err(Reject::OutOfOrder { .. })
        ));
        w.apply_server(ServerCommand::Utterance {
            meeting: m,
            seq: 0,
            speaker,
            chars: 90,
        })
        .unwrap();
        assert_eq!(w.meetings[&m].speaker, Some(speaker));
        for _ in 0..utterance_steps(90) {
            w.step();
        }
        assert_eq!(w.meetings[&m].speaker, None);
    }

    #[test]
    fn fire_walks_out_and_frees_desk() {
        let mut w = demo_office(9);
        while w.clock().minute < hm(11, 0) {
            w.step();
        }
        let id = StaffId(1);
        let desk = w.staff[&id].home_desk.unwrap();
        w.apply(Command::Fire { staff: id }).unwrap();
        assert!(w.free_desks().contains(&desk));
        assert!(w.staff.contains_key(&id), "still walking out");
        for _ in 0..2_000 {
            w.step();
        }
        assert!(!w.staff.contains_key(&id));
        assert_eq!(w.nav_failures, 0);
    }
}
