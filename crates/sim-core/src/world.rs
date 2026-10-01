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
//! 3. on a new day: settle accounts, roll today's schedules, new candidates
//! 4. per elapsed minute: overtime, fatigue; per hour: morale
//! 5. meetings: open the standup, close finished meetings
//! 6. staff: move along paths, then decide (FSM) and plan new paths

use std::collections::BTreeMap;

use rand_core::RngCore;
use rand_pcg::Pcg32;
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::building::{Building, RoomKind};
use crate::clock::{
    hm, Clock, SimConfig, ARRIVAL_START, EVENING_START, LUNCH_MINUTES, STANDUP_END,
    STANDUP_LATEST_ARRIVAL, STANDUP_START,
};
use crate::commands::{
    Command, DemolishTarget, Input, OvertimePolicy, Placement, Policy, ServerCommand,
};
use crate::economy::{self, Company, DaySettlement, Ledger, LedgerKind};
use crate::equipment::{Equipment, EquipmentKind};
use crate::geom::PosMm;
use crate::ids::{CandidateId, EquipId, IdGen, MeetingId, PersonaId, RoomId, StaffId};
use crate::pathfinding::{plan_path, NavGrid, Path};
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

/// A meeting in a meeting room. M1 knows one kind: the 09:00 standup.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Meeting {
    pub id: MeetingId,
    pub room: RoomId,
    pub day: u32,
    pub start: u16,
    pub end: u16,
    /// Next expected [`ServerCommand::Utterance`] seq.
    pub next_seq: u32,
    pub speaker: Option<StaffId>,
    /// Step until which `speaker` is talking.
    pub speak_until: u64,
}

impl Meeting {
    pub fn is_active(&self, now: Clock) -> bool {
        now.day == self.day && (self.start..self.end).contains(&now.minute)
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
    pub ids: IdGen,
    /// Times a person could not find a path (should stay 0; connectivity is validated).
    pub nav_failures: u32,
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
            ids: IdGen::default(),
            nav_failures: 0,
            pending: BTreeMap::new(),
            seq_step: 0,
            next_seq: 0,
        };
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
                    let desk = self.free_desks().first().copied();
                    self.add_staff(
                        c.persona,
                        c.role,
                        c.seniority,
                        c.traits,
                        c.salary,
                        c.role.base_schedule(),
                        desk,
                    );
                    self.post(LedgerKind::HiringFee, -cost);
                }
            }
            Command::Fire { staff } => {
                self.post(LedgerKind::Severance, -cost);
                if let Some(s) = self.staff.get_mut(&staff) {
                    s.leaving_for_good = true;
                    s.home_desk = None;
                    if !s.is_on_site() {
                        self.staff.remove(&staff);
                    }
                }
            }
            Command::SetPolicy(p) => match p {
                Policy::Overtime(o) => self.company.policies.overtime = o,
                Policy::Autonomy(a) => self.company.policies.autonomy = a,
                Policy::QualityBar(q) => self.company.policies.quality_bar = q,
            },
        }
    }

    fn execute_server(&mut self, cmd: ServerCommand) {
        match cmd {
            // Rejected by validation in M1 (no jobs exist yet).
            ServerCommand::JobCompleted { .. } => {}
            ServerCommand::Utterance {
                meeting,
                speaker,
                chars,
                ..
            } => {
                let until = self.step + utterance_steps(chars);
                if let Some(m) = self.meetings.get_mut(&meeting) {
                    m.speaker = Some(speaker);
                    m.speak_until = until;
                    m.next_seq += 1;
                }
            }
            ServerCommand::SiteSignals(s) => self.company.signals = Some(s),
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
            },
        );
        id
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
        Some(PosMm::new(c.x + dx, c.z + dz))
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
        let mut pool: Vec<PersonaId> = (0..PERSONAS.len())
            .filter_map(|i| u16::try_from(i).ok().map(PersonaId))
            .filter(|p| !self.staff.values().any(|s| s.persona == *p))
            .collect();
        for _ in 0..CANDIDATES_PER_DAY {
            let id = self.ids.candidate();
            let pid = if pool.is_empty() {
                let n = u32::try_from(PERSONAS.len()).unwrap_or(1);
                PersonaId(u16::try_from(self.rng.next_u32() % n).unwrap_or(0))
            } else {
                let n = u32::try_from(pool.len()).unwrap_or(1);
                let i = usize::try_from(self.rng.next_u32() % n).unwrap_or(0);
                pool.remove(i)
            };
            let role = persona(pid).role;
            let seniority = match self.rng.next_u32() % 100 {
                0..=44 => Seniority::Junior,
                45..=79 => Seniority::Mid,
                80..=96 => Seniority::Senior,
                _ if self.company.level >= 5 => Seniority::Star,
                _ => Seniority::Senior,
            };
            let traits = Traits::roll(&mut self.rng);
            let jitter = i64::from(self.rng.next_u32() % 21) - 10;
            let salary = salary_for(role, seniority) * (100 + jitter) / 100;
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

        // 6. staff
        self.update_staff(now);

        report
    }

    fn settle(&mut self, day: u32) -> DaySettlement {
        let s = economy::settle(
            day,
            &mut self.company,
            &mut self.ledger,
            &self.building,
            self.staff.values_mut(),
        );
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
    }

    fn update_meetings(&mut self, now: Clock) {
        if (STANDUP_START..STANDUP_END).contains(&now.minute)
            && !self.meetings.values().any(|m| m.day == now.day)
        {
            if let Some(room) = self
                .building
                .first_room_of(RoomKind::MeetingRoom)
                .map(|r| r.id)
            {
                let id = self.ids.meeting();
                self.meetings.insert(
                    id,
                    Meeting {
                        id,
                        room,
                        day: now.day,
                        start: STANDUP_START,
                        end: STANDUP_END,
                        next_seq: 0,
                        speaker: None,
                        speak_until: 0,
                    },
                );
            }
        }
        let step = self.step;
        let staff = &self.staff;
        self.meetings.retain(|id, m| {
            m.is_active(now)
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
        if s.today.arrive <= STANDUP_LATEST_ARRIVAL {
            if let Some(m) = self.meetings.values().find(|m| m.is_active(now)) {
                return Want::Meeting(m.id);
            }
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
