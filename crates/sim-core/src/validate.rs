//! Command validation. [`validate`] is pure; [`crate::World::apply`] calls it
//! first and only mutates on `Ok`, so a command either validates and applies
//! or is rejected and leaves the world untouched (proptest-checked).
//!
//! The client calls the same function through wasm for placement previews.

use thiserror::Error;

use crate::building::{Building, Room, RoomKind, MAX_LOT_SIDE, MAX_OPENINGS, MAX_ROOM_SIDE};
use crate::commands::{Command, DemolishTarget, Input, Placement, Policy, ServerCommand};
use crate::economy::LAND_PER_TILE;
use crate::equipment::{
    seat_pos, EquipmentKind, MAX_ITEMS_PER_ROOM, SEAT_CLEARANCE_MM, WALL_CLEARANCE_MM,
};
use crate::geom::{PosMm, Side, TileRect, TILE_MM};
use crate::ids::{CandidateId, EquipId, MeetingId, ProjectId, RoomId, StaffId, TicketId};
use crate::inbox::{SecretaryTaskKind, MAX_MEETING_ATTENDEES, MAX_SECRETARY_QUEUE};
use crate::projects::{valid_domain, valid_name, valid_slug, ProjectStatus};
use crate::roles::Role;
use crate::staff::{Seniority, Spot, Staff};
use crate::world::{World, MAX_STAFF, PRAISES_PER_DAY};

/// Highest daily salary `SetSalary` accepts, cents (€100 000 a day).
pub const MAX_SALARY_CENTS_PER_DAY: i64 = 10_000_000;
/// Highest monthly project budget, cents (€100 million).
pub const MAX_BUDGET_CENTS: i64 = 10_000_000_000;

/// Largest tile coordinate accepted in a command.
pub const MAX_COORD_TILES: i32 = 10_000;
/// Largest millimetre coordinate accepted in a command.
pub const MAX_COORD_MM: i32 = 1_000_000;
/// Most tiles bought in one go.
pub const MAX_BUY_TILES: u8 = 8;
/// Narrowest window, mm.
pub const MIN_WINDOW_MM: i32 = 500;
/// Most characters in one utterance.
pub const MAX_UTTERANCE_CHARS: u32 = 20_000;
/// Two ceiling lights must be at least this far apart, mm.
pub const CEILING_LIGHT_SPACING_MM: i32 = 500;

/// Why a command was refused. `Display` is the player-facing reason.
#[derive(Clone, Debug, PartialEq, Eq, Error)]
pub enum Reject {
    #[error("not enough cash: need {need} cents, have {have}")]
    InsufficientFunds { need: i64, have: i64 },
    #[error("outside the lot")]
    OutOfLot,
    #[error("overlaps something already there")]
    Overlap,
    #[error("{0} would be unreachable from the entrance")]
    Unreachable(RoomId),
    #[error("{0} would be cut off from the entrance")]
    StaffCutOff(StaffId),
    #[error("invalid: {0}")]
    Invalid(&'static str),
    #[error("unknown {0}")]
    UnknownRoom(RoomId),
    #[error("unknown {0}")]
    UnknownEquipment(EquipId),
    #[error("unknown {0}")]
    UnknownCandidate(CandidateId),
    #[error("unknown {0}")]
    UnknownStaff(StaffId),
    #[error("unknown {0}")]
    UnknownMeeting(MeetingId),
    #[error("{kind:?} unlocks at company level {needed}")]
    Locked { kind: RoomKind, needed: u8 },
    #[error("no free desk for a new hire")]
    NoFreeDesk,
    #[error("hiring is frozen (receivership)")]
    HiringFrozen,
    #[error("occupied: {0}")]
    Occupied(&'static str),
    #[error("limit reached: {0}")]
    Limit(&'static str),
    #[error("out of order: expected seq {expected}, got {got}")]
    OutOfOrder { expected: u32, got: u32 },
    #[error("not supported yet: {0}")]
    NotSupported(&'static str),
    #[error("unknown {0}")]
    UnknownProject(ProjectId),
    #[error("unknown {0}")]
    UnknownTicket(TicketId),
    #[error("{staff} would be allocated {total}% (max 100%)")]
    OverAllocated { staff: StaffId, total: u16 },
    #[error("company level {level} allows {limit} project(s)")]
    ProjectLimit { level: u8, limit: usize },
    #[error("there is no Executive Secretary to delegate to")]
    NoSecretary,
}

/// Validates any input.
pub fn validate_input(w: &World, input: &Input) -> Result<(), Reject> {
    match input {
        Input::Player(c) => validate(w, c),
        Input::Server(c) => validate_server(w, c),
    }
}

/// Validates a player command against the current world.
pub fn validate(w: &World, cmd: &Command) -> Result<(), Reject> {
    match cmd {
        Command::BuyFloorSpace { side, tiles } => {
            if *tiles == 0 || *tiles > MAX_BUY_TILES {
                return Err(Reject::Invalid("buy 1..=8 rows of land at a time"));
            }
            if *side == w.building.entrance.side {
                return Err(Reject::Invalid(
                    "the street in front of the entrance cannot be built on",
                ));
            }
            let (lot, strip) = grown_lot(&w.building.lot, *side, i32::from(*tiles));
            if lot.w > MAX_LOT_SIDE || lot.d > MAX_LOT_SIDE {
                return Err(Reject::Limit("lot size"));
            }
            funds(w, price(w, cmd))?;
            no_staff_in(w, &strip.expanded(1))?;
            let mut b = w.building.clone();
            b.lot = lot;
            check_structure(w, &b)
        }
        Command::PlaceRoom {
            kind,
            rect,
            floor,
            doors,
            windows,
        } => {
            sane_rect(rect)?;
            if *floor >= w.building.floors || *floor > 0 {
                return Err(Reject::NotSupported("upper floors need stairs (M2+)"));
            }
            if kind.unlock_level() > w.company.level {
                return Err(Reject::Locked {
                    kind: *kind,
                    needed: kind.unlock_level(),
                });
            }
            let (mw, md) = kind.min_size();
            if rect.w < mw || rect.d < md {
                return Err(Reject::Invalid(
                    "room is smaller than the minimum for its kind",
                ));
            }
            let lot = &w.building.lot;
            if !lot.contains_rect(rect) {
                return Err(Reject::OutOfLot);
            }
            if w.building.rooms.values().any(|r| r.rect.intersects(rect)) {
                return Err(Reject::Overlap);
            }
            if doors.len() > MAX_OPENINGS || windows.len() > MAX_OPENINGS {
                return Err(Reject::Limit("doors/windows per room"));
            }
            for (i, d) in doors.iter().enumerate() {
                if d.at < 0 || d.at >= rect.side_len(d.side) {
                    return Err(Reject::Invalid("door is not on the room's side"));
                }
                if !lot.contains(rect.side_tile(d.side, d.at).neighbour(d.side)) {
                    return Err(Reject::Invalid(
                        "doors open into the lot; the entrance is the only street door",
                    ));
                }
                if doors[..i].contains(d) {
                    return Err(Reject::Invalid("duplicate door"));
                }
            }
            for win in windows {
                if !rect.side_on_boundary_of(lot, win.side) {
                    return Err(Reject::Invalid("windows go on exterior walls only"));
                }
                let side_mm = i64::from(rect.side_len(win.side)) * i64::from(TILE_MM);
                let at = i64::from(win.at_mm);
                let width = i64::from(win.width_mm);
                if at < 0 || width < i64::from(MIN_WINDOW_MM) || at + width > side_mm {
                    return Err(Reject::Invalid("window does not fit its wall"));
                }
            }
            funds(w, price(w, cmd))?;
            no_staff_in(w, &rect.expanded(1))?;
            let mut b = w.building.clone();
            let id = w.ids.peek_room();
            b.rooms.insert(
                id,
                Room {
                    id,
                    kind: *kind,
                    rect: *rect,
                    floor: *floor,
                    level: 1,
                    doors: doors.clone(),
                    windows: windows.clone(),
                },
            );
            check_structure(w, &b)
        }
        Command::Demolish(DemolishTarget::Room(id)) => {
            let room = w.building.rooms.get(id).ok_or(Reject::UnknownRoom(*id))?;
            let in_room = |e: &EquipId| w.building.equipment.get(e).is_some_and(|e| e.room == *id);
            for s in w.staff.values() {
                if s.home_desk.as_ref().is_some_and(in_room) {
                    return Err(Reject::Occupied("someone's desk is in this room"));
                }
                if s.spot.is_some_and(|sp| spot_in_room(w, sp, *id)) {
                    return Err(Reject::Occupied("someone is using this room"));
                }
            }
            if w.meetings.values().any(|m| m.room == *id) {
                return Err(Reject::Occupied("a meeting is booked in this room"));
            }
            no_staff_in(w, &room.rect.expanded(1))?;
            let mut b = w.building.clone();
            b.rooms.remove(id);
            b.equipment.retain(|_, e| e.room != *id);
            check_structure(w, &b)
        }
        Command::Demolish(DemolishTarget::Equipment(id)) => {
            let e = w
                .building
                .equipment
                .get(id)
                .ok_or(Reject::UnknownEquipment(*id))?;
            if e.kind == EquipmentKind::Desk
                && w.staff
                    .values()
                    .any(|s| s.home_desk == Some(*id) || s.spot == Some(Spot::Desk(*id)))
            {
                return Err(Reject::Occupied("this desk is assigned"));
            }
            Ok(())
        }
        Command::PlaceEquipment { kind, placement } => {
            let room_id = match placement {
                Placement::OnDesk(desk_id) => {
                    let Some(slot) = kind.desk_slot() else {
                        return Err(Reject::Invalid("only monitors and lamps sit on desks"));
                    };
                    let desk = w
                        .building
                        .equipment
                        .get(desk_id)
                        .ok_or(Reject::UnknownEquipment(*desk_id))?;
                    if desk.kind != EquipmentKind::Desk {
                        return Err(Reject::Invalid("that is not a desk"));
                    }
                    if w.building.equipment.values().any(|e| {
                        e.attached_to == Some(*desk_id) && e.kind.desk_slot() == Some(slot)
                    }) {
                        return Err(Reject::Occupied("that desk already has one"));
                    }
                    desk.room
                }
                Placement::Floor { pos, rot } => {
                    if kind.desk_slot().is_some() {
                        return Err(Reject::Invalid("monitors and lamps go on a desk"));
                    }
                    if *rot > 3 {
                        return Err(Reject::Invalid("rotation is 0..=3 quarter turns"));
                    }
                    if pos.x.abs() > MAX_COORD_MM || pos.z.abs() > MAX_COORD_MM {
                        return Err(Reject::OutOfLot);
                    }
                    let room_id = w
                        .building
                        .room_at(pos.tile())
                        .ok_or(Reject::Invalid("equipment goes inside a room"))?;
                    let room = &w.building.rooms[&room_id];
                    if let Some(req) = kind.required_room() {
                        if room.kind != req {
                            return Err(Reject::Invalid("this item needs a different room"));
                        }
                    }
                    if !room.rect.contains_pos_inset(*pos, WALL_CLEARANCE_MM) {
                        return Err(Reject::Invalid("too close to a wall"));
                    }
                    if *kind == EquipmentKind::Desk
                        && !room
                            .rect
                            .contains_pos_inset(seat_pos(*pos, *rot), SEAT_CLEARANCE_MM)
                    {
                        return Err(Reject::Invalid("the chair would be in the wall"));
                    }
                    if overlaps(w, room_id, *kind, *pos) {
                        return Err(Reject::Overlap);
                    }
                    room_id
                }
            };
            let items = w
                .building
                .equipment
                .values()
                .filter(|e| e.room == room_id)
                .count();
            if items >= MAX_ITEMS_PER_ROOM {
                return Err(Reject::Limit("items per room"));
            }
            funds(w, price(w, cmd))
        }
        Command::Hire { candidate } => {
            let c = w
                .candidates
                .get(candidate)
                .ok_or(Reject::UnknownCandidate(*candidate))?;
            if c.role == Role::Cfo && w.exec.cfo.is_some() {
                return Err(Reject::Occupied("the company already has a CFO"));
            }
            if c.role == Role::Secretary && w.exec.secretary.is_some() {
                return Err(Reject::Occupied("the company already has a Secretary"));
            }
            if w.company.hiring_frozen() {
                return Err(Reject::HiringFrozen);
            }
            if w.staff.len() >= MAX_STAFF {
                return Err(Reject::Limit("staff"));
            }
            if w.free_desks().is_empty() {
                return Err(Reject::NoFreeDesk);
            }
            funds(w, price(w, cmd))
        }
        Command::Fire { staff } => {
            let s = w.staff.get(staff).ok_or(Reject::UnknownStaff(*staff))?;
            if s.leaving_for_good {
                return Err(Reject::Invalid("already leaving"));
            }
            Ok(())
        }
        Command::SetPolicy(Policy::QualityBar(q)) => {
            if (5..=10).contains(q) {
                Ok(())
            } else {
                Err(Reject::Invalid("quality bar is 5..=10"))
            }
        }
        Command::SetPolicy(_) => Ok(()),
        Command::Promote { staff } => {
            let s = active_staff(w, *staff)?;
            match s.seniority.promoted() {
                None => Err(Reject::Invalid("already a star")),
                Some(Seniority::Star) if w.company.level < 5 => {
                    Err(Reject::Invalid("star contracts unlock at company level 5"))
                }
                Some(_) => Ok(()),
            }
        }
        Command::SetSalary {
            staff,
            cents_per_day,
        } => {
            active_staff(w, *staff)?;
            if !(1..=MAX_SALARY_CENTS_PER_DAY).contains(cents_per_day) {
                return Err(Reject::Invalid("salary is 1 cent to €100 000 a day"));
            }
            Ok(())
        }
        Command::AssignToProject {
            staff,
            project,
            allocation_pct,
        } => {
            let s = active_staff(w, *staff)?;
            let p = open_project(w, *project)?;
            if s.role.is_executive() {
                return Err(Reject::Invalid(
                    "the executive office is not staffed on projects",
                ));
            }
            if *allocation_pct == 0 || *allocation_pct > 100 {
                return Err(Reject::Invalid("allocation is 1..=100%"));
            }
            let others: u16 = s
                .projects
                .iter()
                .filter(|(pid, _)| **pid != p.id)
                .map(|(_, pct)| u16::from(*pct))
                .sum();
            let total = others + u16::from(*allocation_pct);
            if total > 100 {
                return Err(Reject::OverAllocated {
                    staff: *staff,
                    total,
                });
            }
            Ok(())
        }
        Command::RemoveFromProject { staff, project } => {
            let s = w.staff.get(staff).ok_or(Reject::UnknownStaff(*staff))?;
            w.projects
                .get(project)
                .ok_or(Reject::UnknownProject(*project))?;
            if !s.projects.contains_key(project) {
                return Err(Reject::Invalid("not on that project's team"));
            }
            Ok(())
        }
        Command::SetProjectLead { project, staff } => {
            open_project(w, *project)?;
            let s = active_staff(w, *staff)?;
            if s.allocation(*project) == 0 {
                return Err(Reject::Invalid("the lead must be on the project's team"));
            }
            Ok(())
        }
        Command::CreateProject { slug, name, domain } => {
            if !valid_slug(slug) {
                return Err(Reject::Invalid(
                    "slug: 1..=48 lowercase letters, digits and dashes",
                ));
            }
            if !valid_name(name) {
                return Err(Reject::Invalid("name: 1..=64 printable characters"));
            }
            if !valid_domain(domain) {
                return Err(Reject::Invalid(
                    "domain: a lowercase host name like amalfi.travel",
                ));
            }
            if w.projects.values().any(|p| p.slug == *slug) {
                return Err(Reject::Occupied("a project with that slug exists"));
            }
            if w.projects
                .values()
                .any(|p| p.is_open() && p.domain == *domain)
            {
                return Err(Reject::Occupied("a project already runs that domain"));
            }
            project_capacity(w)
        }
        Command::SetProjectStatus { project, status } => {
            let p = w
                .projects
                .get(project)
                .ok_or(Reject::UnknownProject(*project))?;
            if !p.status.can_become(*status) {
                return Err(Reject::Invalid("that status change is not allowed"));
            }
            Ok(())
        }
        Command::SetProjectBudget {
            project,
            monthly_cents,
        } => {
            open_project(w, *project)?;
            if !(0..=MAX_BUDGET_CENTS).contains(monthly_cents) {
                return Err(Reject::Invalid("budget is €0 to €100 million a month"));
            }
            Ok(())
        }
        Command::AnswerTicket { ticket, option } => {
            let t = w
                .tickets
                .get(ticket)
                .ok_or(Reject::UnknownTicket(*ticket))?;
            if !t.is_open() {
                return Err(Reject::Invalid("the ticket is already closed"));
            }
            if !t.options.contains(option) {
                return Err(Reject::Invalid("not an option of this ticket"));
            }
            w.option_feasible(*ticket, *option).map_err(Reject::Invalid)
        }
        Command::Delegate { task } => {
            if w.exec.secretary.is_none() {
                return Err(Reject::NoSecretary);
            }
            if w.pending_tasks() >= MAX_SECRETARY_QUEUE {
                return Err(Reject::Limit("the Secretary's queue is full"));
            }
            match task {
                SecretaryTaskKind::TriageInbox => Ok(()),
                SecretaryTaskKind::ScheduleMeeting { attendees, project } => {
                    if attendees.is_empty() || attendees.len() > MAX_MEETING_ATTENDEES {
                        return Err(Reject::Invalid("a meeting has 1..=12 attendees"));
                    }
                    for (i, a) in attendees.iter().enumerate() {
                        active_staff(w, *a)?;
                        if attendees[..i].contains(a) {
                            return Err(Reject::Invalid("duplicate attendee"));
                        }
                    }
                    if w.building.meeting_rooms().is_empty() {
                        return Err(Reject::Invalid("there is no meeting room"));
                    }
                    if let Some(p) = project {
                        open_project(w, *p)?;
                    }
                    Ok(())
                }
                SecretaryTaskKind::PrepareBriefing { project }
                | SecretaryTaskKind::ArrangeHiring { project, .. } => {
                    if let Some(p) = project {
                        open_project(w, *p)?;
                    }
                    Ok(())
                }
                SecretaryTaskKind::DraftReply { ticket } => {
                    let t = w
                        .tickets
                        .get(ticket)
                        .ok_or(Reject::UnknownTicket(*ticket))?;
                    if !t.is_open() {
                        return Err(Reject::Invalid("the ticket is already closed"));
                    }
                    Ok(())
                }
                SecretaryTaskKind::FollowUp { staff, .. } => active_staff(w, *staff).map(|_| ()),
            }
        }
        Command::SetDelegation { .. } => Ok(()),
        Command::Praise { staff } => {
            active_staff(w, *staff)?;
            if w.praises_today >= PRAISES_PER_DAY {
                return Err(Reject::Limit("praise (3 a day)"));
            }
            Ok(())
        }
    }
}

fn active_staff(w: &World, id: StaffId) -> Result<&Staff, Reject> {
    let s = w.staff.get(&id).ok_or(Reject::UnknownStaff(id))?;
    if s.leaving_for_good {
        return Err(Reject::Invalid("already leaving"));
    }
    Ok(s)
}

fn open_project(w: &World, id: ProjectId) -> Result<&crate::projects::Project, Reject> {
    let p = w.projects.get(&id).ok_or(Reject::UnknownProject(id))?;
    if p.status == ProjectStatus::Archived {
        return Err(Reject::Invalid("the project is archived"));
    }
    Ok(p)
}

/// Room for one more open project at the company's level.
pub(crate) fn project_capacity(w: &World) -> Result<(), Reject> {
    if w.open_projects() >= w.project_limit() {
        return Err(Reject::ProjectLimit {
            level: w.company.level,
            limit: w.project_limit(),
        });
    }
    Ok(())
}

/// Validates a server-injected command.
pub fn validate_server(w: &World, cmd: &ServerCommand) -> Result<(), Reject> {
    match cmd {
        ServerCommand::JobCompleted { job_id, digest } => w.check_job_completed(*job_id, digest),
        ServerCommand::MeetingOutcome { job_id, briefs } => {
            w.check_meeting_outcome(*job_id, briefs)
        }
        ServerCommand::BoardOutcome {
            job_id,
            workstreams,
            items,
        } => w.check_board_outcome(*job_id, workstreams, items),
        ServerCommand::DeployLanded { work_item } | ServerCommand::DeployFailed { work_item } => {
            w.check_deploy_landed(*work_item)
        }
        ServerCommand::JobFailed { job_id, .. } => w.check_job_failed(*job_id),
        ServerCommand::Utterance {
            meeting,
            seq,
            speaker,
            chars,
        } => {
            let m = w
                .meetings
                .get(meeting)
                .ok_or(Reject::UnknownMeeting(*meeting))?;
            if !m.is_active(w.clock()) {
                return Err(Reject::Invalid("meeting is not in session"));
            }
            if *seq != m.next_seq {
                return Err(Reject::OutOfOrder {
                    expected: m.next_seq,
                    got: *seq,
                });
            }
            let s = w.staff.get(speaker).ok_or(Reject::UnknownStaff(*speaker))?;
            let seated = s.path.is_none()
                && matches!(s.spot, Some(Spot::MeetingSeat { meeting: mm, .. }) if mm == *meeting);
            if !seated {
                return Err(Reject::Invalid("speaker is not seated in the meeting"));
            }
            if *chars == 0 || *chars > MAX_UTTERANCE_CHARS {
                return Err(Reject::Invalid("utterance length"));
            }
            Ok(())
        }
        ServerCommand::SiteSignals(_) => Ok(()),
        ServerCommand::AnalyticsSignals {
            project,
            day,
            engagement_pm,
            ..
        } => {
            open_project(w, *project)?;
            if *day > w.clock().day {
                return Err(Reject::Invalid("analytics for a day that has not happened"));
            }
            if *engagement_pm > 1000 {
                return Err(Reject::Invalid("engagement is 0..=1000 permille"));
            }
            Ok(())
        }
    }
}

/// Cash a command costs (0 for free ones). Used by both validation and
/// execution so they can never disagree.
pub(crate) fn price(w: &World, cmd: &Command) -> i64 {
    match cmd {
        Command::BuyFloorSpace { side, tiles } => {
            let (_, strip) = grown_lot(&w.building.lot, *side, i32::from(*tiles));
            strip.area() * LAND_PER_TILE
        }
        Command::PlaceRoom { kind, rect, .. } => rect.area() * kind.build_cost_per_tile(),
        Command::PlaceEquipment { kind, .. } => kind.cost(),
        Command::Hire { candidate } => w.candidates.get(candidate).map_or(0, |c| c.signing_fee()),
        Command::Fire { staff } => w
            .staff
            .get(staff)
            .map_or(0, |s| s.salary * crate::economy::SEVERANCE_DAYS),
        Command::Demolish(_)
        | Command::SetPolicy(_)
        | Command::Promote { .. }
        | Command::SetSalary { .. }
        | Command::AssignToProject { .. }
        | Command::RemoveFromProject { .. }
        | Command::SetProjectLead { .. }
        | Command::CreateProject { .. }
        | Command::SetProjectStatus { .. }
        | Command::SetProjectBudget { .. }
        | Command::AnswerTicket { .. }
        | Command::Delegate { .. }
        | Command::SetDelegation { .. }
        | Command::Praise { .. } => 0,
    }
}

/// The lot after buying `tiles` on `side`, and the newly bought strip.
pub(crate) fn grown_lot(lot: &TileRect, side: Side, tiles: i32) -> (TileRect, TileRect) {
    match side {
        Side::North => (
            TileRect::new(lot.x, lot.z - tiles, lot.w, lot.d + tiles),
            TileRect::new(lot.x, lot.z - tiles, lot.w, tiles),
        ),
        Side::South => (
            TileRect::new(lot.x, lot.z, lot.w, lot.d + tiles),
            TileRect::new(lot.x, lot.z_end(), lot.w, tiles),
        ),
        Side::West => (
            TileRect::new(lot.x - tiles, lot.z, lot.w + tiles, lot.d),
            TileRect::new(lot.x - tiles, lot.z, tiles, lot.d),
        ),
        Side::East => (
            TileRect::new(lot.x, lot.z, lot.w + tiles, lot.d),
            TileRect::new(lot.x_end(), lot.z, tiles, lot.d),
        ),
    }
}

fn sane_rect(r: &TileRect) -> Result<(), Reject> {
    if r.w < 1 || r.d < 1 || r.w > MAX_ROOM_SIDE || r.d > MAX_ROOM_SIDE {
        return Err(Reject::Invalid("room sides are 1..=24 tiles"));
    }
    if r.x.abs() > MAX_COORD_TILES || r.z.abs() > MAX_COORD_TILES {
        return Err(Reject::OutOfLot);
    }
    Ok(())
}

fn funds(w: &World, need: i64) -> Result<(), Reject> {
    if need > w.company.cash {
        Err(Reject::InsufficientFunds {
            need,
            have: w.company.cash,
        })
    } else {
        Ok(())
    }
}

/// Nobody on site may stand inside `area` (where walls are about to change).
fn no_staff_in(w: &World, area: &TileRect) -> Result<(), Reject> {
    if w.staff
        .values()
        .any(|s| s.is_on_site() && area.contains(s.pos.tile()))
    {
        Err(Reject::Occupied(
            "people are standing where the walls would change",
        ))
    } else {
        Ok(())
    }
}

/// After a structural change every room and every person on site must still
/// be reachable from the street entrance.
fn check_structure(w: &World, b: &Building) -> Result<(), Reject> {
    let grid = b.nav_grid();
    let reach = grid.reachable_from(b.entrance.outside_tile());
    let ok = |t| grid.index(t).is_some_and(|i| reach[i]);
    if let Some(r) = b.rooms.values().find(|r| !r.rect.tiles().any(ok)) {
        return Err(Reject::Unreachable(r.id));
    }
    if let Some(s) = w
        .staff
        .values()
        .find(|s| s.is_on_site() && !ok(s.pos.tile()))
    {
        return Err(Reject::StaffCutOff(s.id));
    }
    Ok(())
}

fn spot_in_room(w: &World, spot: Spot, room: RoomId) -> bool {
    match spot {
        Spot::Desk(d) => w.building.equipment.get(&d).is_some_and(|e| e.room == room),
        Spot::MeetingSeat { meeting, .. } => {
            w.meetings.get(&meeting).is_some_and(|m| m.room == room)
        }
        Spot::KitchenSeat { room: r, .. } => r == room,
    }
}

fn overlaps(w: &World, room: RoomId, kind: EquipmentKind, pos: PosMm) -> bool {
    w.building
        .equipment
        .values()
        .filter(|e| e.room == room && e.attached_to.is_none())
        .any(|e| {
            if kind == EquipmentKind::CeilingLight || e.kind == EquipmentKind::CeilingLight {
                kind == e.kind && e.pos.chebyshev(pos) < CEILING_LIGHT_SPACING_MM
            } else {
                let reach = kind.footprint_mm() + e.kind.footprint_mm();
                reach > 0 && e.pos.chebyshev(pos) < reach
            }
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::building::{Door, Window};
    use crate::inbox::{DelegationPolicy, TicketOption};
    use crate::scenarios::{demo_office, DEMO_PROJECT};

    #[test]
    fn grown_lot_strips() {
        let lot = TileRect::new(0, 0, 16, 10);
        let (l, s) = grown_lot(&lot, Side::East, 4);
        assert_eq!(l, TileRect::new(0, 0, 20, 10));
        assert_eq!(s, TileRect::new(16, 0, 4, 10));
        let (l, s) = grown_lot(&lot, Side::North, 2);
        assert_eq!(l, TileRect::new(0, -2, 16, 12));
        assert_eq!(s, TileRect::new(0, -2, 16, 2));
    }

    fn place(kind: RoomKind, rect: TileRect, doors: Vec<Door>, windows: Vec<Window>) -> Command {
        Command::PlaceRoom {
            kind,
            rect,
            floor: 0,
            doors,
            windows,
        }
    }

    #[test]
    fn rejects_overlap_and_out_of_lot() {
        let w = demo_office(1);
        let kitchen = |rect| place(RoomKind::Kitchen, rect, vec![], vec![]);
        assert_eq!(
            validate(&w, &kitchen(TileRect::new(8, 6, 3, 3))),
            Err(Reject::Overlap)
        );
        assert_eq!(
            validate(&w, &kitchen(TileRect::new(22, 14, 3, 3))),
            Err(Reject::OutOfLot)
        );
        assert!(matches!(
            validate(&w, &kitchen(TileRect::new(i32::MAX, 0, 3, 3))),
            Err(Reject::OutOfLot)
        ));
    }

    fn east_annex() -> World {
        let mut w = demo_office(1);
        w.apply(Command::BuyFloorSpace {
            side: Side::East,
            tiles: 4,
        })
        .unwrap();
        w
    }

    #[test]
    fn rejects_unreachable_room() {
        let w = east_annex();
        let sealed = place(
            RoomKind::Archive,
            TileRect::new(25, 1, 3, 3),
            vec![],
            vec![],
        );
        assert!(matches!(validate(&w, &sealed), Err(Reject::Unreachable(_))));
        let open = place(
            RoomKind::Archive,
            TileRect::new(24, 4, 4, 4),
            vec![Door {
                side: Side::West,
                at: 2,
            }],
            vec![Window {
                side: Side::East,
                at_mm: 1000,
                width_mm: 2000,
            }],
        );
        assert_eq!(validate(&w, &open), Ok(()));
    }

    #[test]
    fn rejects_interior_windows_and_street_doors() {
        let w = east_annex();
        let interior_window = place(
            RoomKind::Archive,
            TileRect::new(24, 4, 3, 4),
            vec![Door {
                side: Side::West,
                at: 2,
            }],
            vec![Window {
                side: Side::East,
                at_mm: 0,
                width_mm: 1000,
            }],
        );
        assert!(matches!(
            validate(&w, &interior_window),
            Err(Reject::Invalid(_))
        ));
        let street_door = place(
            RoomKind::Archive,
            TileRect::new(24, 4, 4, 4),
            vec![Door {
                side: Side::East,
                at: 1,
            }],
            vec![],
        );
        assert!(matches!(
            validate(&w, &street_door),
            Err(Reject::Invalid(_))
        ));
    }

    #[test]
    fn prerequisites() {
        let mut w = demo_office(1);
        let locked = place(
            RoomKind::TranslationDesk,
            TileRect::new(0, 0, 3, 3),
            vec![],
            vec![],
        );
        assert!(matches!(validate(&w, &locked), Err(Reject::Locked { .. })));
        let upper = Command::PlaceRoom {
            kind: RoomKind::Kitchen,
            rect: TileRect::new(0, 0, 3, 3),
            floor: 1,
            doors: vec![],
            windows: vec![],
        };
        assert!(matches!(validate(&w, &upper), Err(Reject::NotSupported(_))));
        // remove the three spare desks: no desk for a hire
        for desk in w.free_desks() {
            w.apply(Command::Demolish(DemolishTarget::Equipment(desk)))
                .unwrap();
        }
        let first = *w.candidates.keys().next().unwrap();
        assert_eq!(
            validate(&w, &Command::Hire { candidate: first }),
            Err(Reject::NoFreeDesk)
        );
        w.company.cash = 0;
        assert!(matches!(
            validate(
                &w,
                &Command::PlaceEquipment {
                    kind: EquipmentKind::Plant,
                    placement: Placement::Floor {
                        pos: PosMm::new(2_000, 14_000),
                        rot: 0
                    }
                }
            ),
            Err(Reject::InsufficientFunds { .. })
        ));
        assert!(matches!(
            validate_server(
                &w,
                &ServerCommand::JobCompleted {
                    job_id: 77,
                    digest: crate::commands::JobDigest {
                        ok: true,
                        score: 8,
                        words: 900,
                        qa_defects: 0,
                        artifact_sha: [0; 16]
                    }
                }
            ),
            Err(Reject::Invalid(_))
        ));
    }

    #[test]
    fn equipment_rules() {
        let w = demo_office(1);
        let desk = w
            .building
            .equipment
            .values()
            .find(|e| e.kind == EquipmentKind::Desk)
            .unwrap()
            .id;
        // slot taken
        assert!(matches!(
            validate(
                &w,
                &Command::PlaceEquipment {
                    kind: EquipmentKind::Monitor,
                    placement: Placement::OnDesk(desk)
                }
            ),
            Err(Reject::Occupied(_))
        ));
        // desk on desk
        assert_eq!(
            validate(
                &w,
                &Command::PlaceEquipment {
                    kind: EquipmentKind::Desk,
                    placement: Placement::Floor {
                        pos: PosMm::new(1_600, 1_600),
                        rot: 0
                    }
                }
            ),
            Err(Reject::Overlap)
        );
        // assigned desk cannot be removed
        assert!(matches!(
            validate(&w, &Command::Demolish(DemolishTarget::Equipment(desk))),
            Err(Reject::Occupied(_))
        ));
        // free spot in the meeting room is fine
        assert_eq!(
            validate(
                &w,
                &Command::PlaceEquipment {
                    kind: EquipmentKind::Desk,
                    placement: Placement::Floor {
                        pos: PosMm::new(1_500, 14_000),
                        rot: 0
                    }
                }
            ),
            Ok(())
        );
        // a camera rig only goes into the photo studio
        assert!(matches!(
            validate(
                &w,
                &Command::PlaceEquipment {
                    kind: EquipmentKind::CameraRig,
                    placement: Placement::Floor {
                        pos: PosMm::new(1_500, 14_000),
                        rot: 0
                    }
                }
            ),
            Err(Reject::Invalid(_))
        ));
    }

    #[test]
    fn staffing_rules() {
        let w = demo_office(1);
        let assign = |staff, pct| Command::AssignToProject {
            staff: StaffId(staff),
            project: DEMO_PROJECT,
            allocation_pct: pct,
        };
        // re-allocating the same project replaces, it does not add
        assert_eq!(validate(&w, &assign(1, 60)), Ok(()));
        assert_eq!(
            validate(&w, &assign(1, 0)),
            Err(Reject::Invalid("allocation is 1..=100%"))
        );
        assert_eq!(
            validate(&w, &assign(1, 101)),
            Err(Reject::Invalid("allocation is 1..=100%"))
        );
        // the CFO is not staffed on projects
        assert!(matches!(
            validate(&w, &assign(7, 10)),
            Err(Reject::Invalid(_))
        ));
        assert_eq!(
            validate(&w, &assign(99, 10)),
            Err(Reject::UnknownStaff(StaffId(99)))
        );
        assert_eq!(
            validate(
                &w,
                &Command::AssignToProject {
                    staff: StaffId(1),
                    project: ProjectId(9),
                    allocation_pct: 10
                }
            ),
            Err(Reject::UnknownProject(ProjectId(9)))
        );
        // the lead must be on the team; the strategist is not
        assert!(matches!(
            validate(
                &w,
                &Command::SetProjectLead {
                    project: DEMO_PROJECT,
                    staff: StaffId(9)
                }
            ),
            Err(Reject::Invalid(_))
        ));
        assert!(matches!(
            validate(
                &w,
                &Command::RemoveFromProject {
                    staff: StaffId(9),
                    project: DEMO_PROJECT
                }
            ),
            Err(Reject::Invalid(_))
        ));
        assert!(matches!(
            validate(
                &w,
                &Command::SetProjectBudget {
                    project: DEMO_PROJECT,
                    monthly_cents: -1
                }
            ),
            Err(Reject::Invalid(_))
        ));
    }

    #[test]
    fn over_allocation_is_rejected() {
        let mut w = demo_office(1);
        let p2 = w.add_project("amalfi", "Amalfi", "amalfi.travel", ProjectStatus::Active);
        let assign = |project, pct| Command::AssignToProject {
            staff: StaffId(1),
            project,
            allocation_pct: pct,
        };
        assert_eq!(
            validate(&w, &assign(p2, 1)),
            Err(Reject::OverAllocated {
                staff: StaffId(1),
                total: 101
            })
        );
        w.apply(assign(DEMO_PROJECT, 70)).unwrap();
        assert_eq!(validate(&w, &assign(p2, 30)), Ok(()));
        assert!(matches!(
            validate(&w, &assign(p2, 31)),
            Err(Reject::OverAllocated { total: 101, .. })
        ));
    }

    #[test]
    fn project_portfolio_rules() {
        let mut w = demo_office(1);
        let create = |slug: &str, domain: &str| Command::CreateProject {
            slug: slug.into(),
            name: "Amalfi Dispatch".into(),
            domain: domain.into(),
        };
        assert!(matches!(
            validate(&w, &create("Bad Slug", "amalfi.travel")),
            Err(Reject::Invalid(_))
        ));
        assert!(matches!(
            validate(&w, &create("amalfi", "localhost")),
            Err(Reject::Invalid(_))
        ));
        assert!(matches!(
            validate(&w, &create("cinqueterre-travel", "x.travel")),
            Err(Reject::Occupied(_))
        ));
        assert!(matches!(
            validate(&w, &create("x", "cinqueterre.travel")),
            Err(Reject::Occupied(_))
        ));
        // level 3: two projects
        w.apply(create("amalfi", "amalfi.travel")).unwrap();
        assert_eq!(
            validate(&w, &create("capri", "capri.travel")),
            Err(Reject::ProjectLimit { level: 3, limit: 2 })
        );
        w.company.level = 2;
        assert_eq!(
            validate(&w, &create("capri", "capri.travel")),
            Err(Reject::ProjectLimit { level: 2, limit: 1 })
        );
        w.company.level = 4;
        assert_eq!(validate(&w, &create("capri", "capri.travel")), Ok(()));
        let status = |status| Command::SetProjectStatus {
            project: ProjectId(2),
            status,
        };
        assert!(matches!(
            validate(&w, &status(ProjectStatus::Paused)),
            Err(Reject::Invalid(_))
        ));
        assert_eq!(validate(&w, &status(ProjectStatus::Active)), Ok(()));
        w.apply(status(ProjectStatus::Archived)).unwrap();
        assert!(matches!(
            validate(&w, &status(ProjectStatus::Active)),
            Err(Reject::Invalid(_))
        ));
    }

    #[test]
    fn people_rules() {
        let mut w = demo_office(1);
        // Alessia is mid: promote to senior; star needs level 5
        assert_eq!(
            validate(&w, &Command::Promote { staff: StaffId(12) }),
            Ok(())
        );
        assert!(matches!(
            validate(&w, &Command::Promote { staff: StaffId(1) }),
            Err(Reject::Invalid(_))
        ));
        w.company.level = 5;
        assert_eq!(
            validate(&w, &Command::Promote { staff: StaffId(1) }),
            Ok(())
        );
        let salary = |c| Command::SetSalary {
            staff: StaffId(1),
            cents_per_day: c,
        };
        assert!(matches!(validate(&w, &salary(0)), Err(Reject::Invalid(_))));
        assert_eq!(validate(&w, &salary(20_000)), Ok(()));
        for _ in 0..PRAISES_PER_DAY {
            w.apply(Command::Praise { staff: StaffId(2) }).unwrap();
        }
        assert_eq!(
            validate(&w, &Command::Praise { staff: StaffId(2) }),
            Err(Reject::Limit("praise (3 a day)"))
        );
    }

    #[test]
    fn inbox_rules() {
        let mut w = demo_office(1);
        assert_eq!(
            validate(
                &w,
                &Command::AnswerTicket {
                    ticket: TicketId(1),
                    option: TicketOption::Approve
                }
            ),
            Err(Reject::UnknownTicket(TicketId(1)))
        );
        w.apply(Command::CreateProject {
            slug: "amalfi".into(),
            name: "Amalfi".into(),
            domain: "amalfi.travel".into(),
        })
        .unwrap();
        let t = *w.tickets.keys().next().unwrap();
        assert!(matches!(
            validate(
                &w,
                &Command::AnswerTicket {
                    ticket: t,
                    option: TicketOption::TakeLoan
                }
            ),
            Err(Reject::Invalid(_))
        ));
        w.apply(Command::AnswerTicket {
            ticket: t,
            option: TicketOption::Approve,
        })
        .unwrap();
        assert!(matches!(
            validate(
                &w,
                &Command::AnswerTicket {
                    ticket: t,
                    option: TicketOption::Approve
                }
            ),
            Err(Reject::Invalid(_))
        ));
        // delegation needs a secretary
        let delegate = Command::Delegate {
            task: SecretaryTaskKind::TriageInbox,
        };
        assert_eq!(validate(&w, &delegate), Ok(()));
        let bad_meeting = Command::Delegate {
            task: SecretaryTaskKind::ScheduleMeeting {
                attendees: vec![StaffId(1), StaffId(1)],
                project: None,
            },
        };
        assert!(matches!(
            validate(&w, &bad_meeting),
            Err(Reject::Invalid(_))
        ));
        w.apply(Command::Fire { staff: StaffId(8) }).unwrap();
        assert_eq!(validate(&w, &delegate), Err(Reject::NoSecretary));
        assert_eq!(
            validate(
                &w,
                &Command::SetDelegation {
                    policy: DelegationPolicy::Low
                }
            ),
            Ok(())
        );
    }

    #[test]
    fn analytics_signals_rules() {
        let w = demo_office(1);
        let sig = |project, day, engagement_pm| ServerCommand::AnalyticsSignals {
            project,
            day,
            sessions: 10,
            visitors: 8,
            pageviews: 20,
            engagement_pm,
            top_pages_digest: 0,
        };
        assert_eq!(validate_server(&w, &sig(DEMO_PROJECT, 0, 500)), Ok(()));
        assert!(matches!(
            validate_server(&w, &sig(DEMO_PROJECT, 1, 500)),
            Err(Reject::Invalid(_))
        ));
        assert!(matches!(
            validate_server(&w, &sig(DEMO_PROJECT, 0, 1001)),
            Err(Reject::Invalid(_))
        ));
        assert_eq!(
            validate_server(&w, &sig(ProjectId(5), 0, 500)),
            Err(Reject::UnknownProject(ProjectId(5)))
        );
    }
}
