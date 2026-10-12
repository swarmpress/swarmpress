//! The office designer's rooms (ADR-0087 decision 6, FEAT-084): a room
//! furnished by a staff member with the construction kit. The plan is the
//! designer's artifact (store text, rule 2); only its placements enter the
//! sim, as numbers, and the sim builds them itself, one by one, validating
//! each like the CEO's own `PlaceEquipment` (rule 3).
//!
//! ```text
//! Command::CommissionInterior{room, brief_ref}   the CEO's words and brief are store text
//!   └─► WorkItem(Interior): Draft(office designer) → gate → Publish (the construction)
//!       no office designer on the staff: the item waits (unstarted) and a
//!       MissingRole ticket asks for one; it starts when one is hired
//! Draft   ─► RequestJob(InteriorDesign) ─► ServerCommand::InteriorPlan{job_id, items}
//!                                       ─► JobCompleted{ok}
//!   no plan with the completion: Blocked + Escalation (rule 11)
//! gate: economic company ─► parked, BuildApproval ticket (amount: the plan's price)
//!         Build ─► the construction │ Decline ─► Cancelled
//!         Defer (the default, also on expiry) ─► parked; a fresh ticket at 08:30
//!       sandbox company  ─► the construction at once, no ticket
//! Publish ─► RequestJob(Construct) (the job reports the build in the thread)
//!   every MINUTES_PER_PLACEMENT game minutes the next item is placed as a
//!   `PlaceEquipment` (charged at its own price in an economic company);
//!   an item on a planned desk goes on the id that desk got.
//!   a refused placement (the room changed) ─► Blocked + Escalation naming
//!     the item; Retry resumes with the item that was refused
//!   the last item placed and the job's result in ─► Published
//! ```

use serde::{Deserialize, Serialize};

use crate::commands::{Command, Placement};
use crate::economy::BuildMode;
use crate::equipment::{DeskSlot, EquipmentKind, MAX_ITEMS_PER_ROOM};
use crate::geom::{PosMm, Side, TILE_MM};
use crate::ids::{EquipId, ProjectId, RoomId, StaffId, WorkItemId};
use crate::inbox::{TicketKind, TicketSpec};
use crate::plan::{
    JobKind, Phase, PhaseKind, PhaseState, WorkItem, WorkItemKind, WorkItemStatus, WorkPriority,
};
use crate::projects::ProjectStatus;
use crate::roles::Role;
use crate::validate::{validate, Reject, MAX_COORD_MM};
use crate::world::World;

/// Game minutes between two placements of a construction.
pub const MINUTES_PER_PLACEMENT: u16 = 5;
/// Rooms being designed or built at once.
pub const MAX_OPEN_INTERIORS: usize = 4;

/// Where a planned item goes.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum PlannedAt {
    /// On the floor (or the ceiling) at `pos`, `rot` quarter turns.
    Floor { pos: PosMm, rot: u8 },
    /// On a desk this plan places: the index of that desk in the plan.
    OnPlanned(u16),
    /// On a desk already in the room.
    OnDesk(EquipId),
}

/// One item of a room plan, in build order.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlannedEquipment {
    pub kind: EquipmentKind,
    pub at: PlannedAt,
}

/// An `Interior` item's room, its plan and how far the construction is.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Interior {
    pub room: RoomId,
    /// The plan's placements (empty until the Draft's `InteriorPlan`).
    pub items: Vec<PlannedEquipment>,
    /// The sim's price of every item, cents (what an economic build costs).
    pub cost_cents: i64,
    /// The ids the items placed so far got, in plan order.
    pub placed: Vec<EquipId>,
    /// The step the next item is placed at, while the construction runs.
    pub next_step: Option<u64>,
    /// The plan index of the item the sim refused (the build stopped).
    pub refused: Option<u16>,
}

impl Interior {
    /// Items still to place.
    pub fn remaining(&self) -> usize {
        self.items.len().saturating_sub(self.placed.len())
    }

    /// The price of the items still to place, cents.
    pub fn remaining_cost(&self) -> i64 {
        self.items[self.placed.len().min(self.items.len())..]
            .iter()
            .map(|i| i.kind.cost())
            .sum()
    }
}

/// A door or window in a room's wall, as the office designer sees it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct DesignerOpening {
    /// `north`, `east`, `south`, `west`.
    pub side: String,
    /// From the side's west (north and south walls) or north end, mm.
    pub at_mm: i32,
    pub width_mm: i32,
}

/// A piece of equipment in the room, as the office designer sees it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct DesignerItem {
    /// `equip-12`.
    pub id: String,
    /// The equipment slug (`desk`).
    pub design: String,
    pub x_mm: i32,
    pub z_mm: i32,
    pub rot: u8,
    /// The desk an attachment sits on.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub on_desk: Option<String>,
}

/// A desk-top object's desk and slot, as the office designer sees it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct DesignerDeskSpot {
    /// `equip-3`.
    pub desk: String,
    /// `screen` or `lamp`.
    pub slot: String,
}

/// A player's own design placed in the room (ADR-0087 decision 7,
/// ADR-0088), as the office designer sees it: numbers only, never the
/// design itself.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct DesignerObject {
    /// `object-3`.
    pub id: String,
    /// Footprint centre (a desk-top object's: its desk's), mm.
    pub x_mm: i32,
    pub z_mm: i32,
    pub rot: u8,
    /// `[w, d]` at turn 0, mm: studs × 62.5, rounded up (the sim's own
    /// rectangle, in quarter millimetres, never reaches past it).
    pub footprint_mm: [i32; 2],
    /// A floor workstation: a home for staff.
    pub workstation: bool,
    /// Where its seat is, relative to the centre at turn 0, mm.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seat_at_mm: Option<[i32; 2]>,
    /// A desk-top object's desk and slot.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub on_desk: Option<DesignerDeskSpot>,
    /// Hung from the ceiling (ADR-0090): it takes no floor, keeps clear of
    /// ceiling lights, and its lights light the room from where it hangs.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub ceiling: bool,
    pub seats: u8,
    /// Places it offers at meetings and breaks (ADR-0089): a seat object's.
    #[serde(default, skip_serializing_if = "is_zero")]
    pub places: u8,
    pub lights: u8,
    /// Shelf area, stud².
    pub storage: u32,
    pub screens: u8,
}

/// A room as the office designer plans for it: the JSON shape of
/// `office_designer::Room` (millimetres; every door in its walls, its own
/// and those other rooms open into it; the windows that face outside; its
/// equipment and the players' own designs in it). A view, never stored.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct DesignerRoom {
    /// The room kind's slug.
    pub kind: String,
    pub x_mm: i32,
    pub z_mm: i32,
    pub w_mm: i32,
    pub d_mm: i32,
    pub doors: Vec<DesignerOpening>,
    pub windows: Vec<DesignerOpening>,
    pub equipment: Vec<DesignerItem>,
    /// Absent in older JSON.
    #[serde(default)]
    pub objects: Vec<DesignerObject>,
}

const fn side_slug(s: Side) -> &'static str {
    match s {
        Side::North => "north",
        Side::East => "east",
        Side::South => "south",
        Side::West => "west",
    }
}

impl World {
    /// The office designer's view of a room ([`DesignerRoom`]); `None` for
    /// an unknown room.
    pub fn designer_room(&self, id: RoomId) -> Option<DesignerRoom> {
        let b = &self.building;
        let r = b.rooms.get(&id)?;
        let opening = |side: Side, at_mm: i32, width_mm: i32| DesignerOpening {
            side: side_slug(side).to_string(),
            at_mm,
            width_mm,
        };
        let mut doors: Vec<DesignerOpening> = r
            .doors
            .iter()
            .map(|d| opening(d.side, d.at * TILE_MM, TILE_MM))
            .collect();
        for o in b.rooms.values().filter(|o| o.id != id) {
            for d in &o.doors {
                let t = o.rect.side_tile(d.side, d.at).neighbour(d.side);
                if r.rect.contains(t) {
                    let s = d.side.opposite();
                    let at = if matches!(s, Side::North | Side::South) {
                        t.x - r.rect.x
                    } else {
                        t.z - r.rect.z
                    };
                    doors.push(opening(s, at * TILE_MM, TILE_MM));
                }
            }
        }
        let windows = r
            .windows
            .iter()
            .filter(|win| r.rect.side_on_boundary_of(&b.lot, win.side))
            .map(|win| opening(win.side, win.at_mm, win.width_mm))
            .collect();
        let equipment = b
            .equipment
            .values()
            .filter(|e| e.room == id)
            .map(|e| DesignerItem {
                id: e.id.to_string(),
                design: e.kind.slug().to_string(),
                x_mm: e.pos.x,
                z_mm: e.pos.z,
                rot: e.rot,
                on_desk: e.attached_to.map(|d| d.to_string()),
            })
            .collect();
        // half up, as studs × 62.5 mm: the sim's exact side never exceeds it
        let stud_mm = |n: u32| i32::try_from((u64::from(n) * 125).div_ceil(2)).unwrap_or(i32::MAX);
        let objects = b
            .objects
            .values()
            .filter(|o| o.room == id)
            .map(|o| DesignerObject {
                id: o.id.to_string(),
                x_mm: o.pos.x,
                z_mm: o.pos.z,
                rot: o.rot,
                footprint_mm: [
                    stud_mm(o.summary.footprint[0]),
                    stud_mm(o.summary.footprint[1]),
                ],
                workstation: o.is_workstation(),
                seat_at_mm: if o.is_workstation() {
                    o.summary.seat_at
                } else {
                    None
                },
                on_desk: o.on_desk.map(|(desk, slot)| DesignerDeskSpot {
                    desk: desk.to_string(),
                    slot: match slot {
                        DeskSlot::Screen => "screen",
                        DeskSlot::Lamp => "lamp",
                    }
                    .to_string(),
                }),
                ceiling: o.is_ceiling(),
                seats: o.summary.seats,
                places: o.places(),
                lights: o.summary.lights,
                storage: o.summary.storage,
                screens: o.summary.screens,
            })
            .collect();
        Some(DesignerRoom {
            kind: r.kind.slug().to_string(),
            x_mm: r.rect.x * TILE_MM,
            z_mm: r.rect.z * TILE_MM,
            w_mm: r.rect.w * TILE_MM,
            d_mm: r.rect.d * TILE_MM,
            doors,
            windows,
            equipment,
            objects,
        })
    }

    /// The company's office designer: the first active one.
    pub fn office_designer(&self) -> Option<StaffId> {
        self.staff
            .values()
            .find(|s| s.is_active() && s.role == Role::OfficeDesigner)
            .map(|s| s.id)
    }

    /// The project an interior item is filed under: the first active one.
    fn interior_project(&self) -> Option<ProjectId> {
        self.projects
            .values()
            .find(|p| p.status == ProjectStatus::Active)
            .map(|p| p.id)
    }

    /// The open interior item of a room, if any.
    pub fn interior_of_room(&self, room: RoomId) -> Option<WorkItemId> {
        self.plan
            .interiors
            .iter()
            .find(|(id, b)| {
                b.room == room
                    && self
                        .plan
                        .items
                        .get(id)
                        .is_some_and(|i| !i.status.is_closed())
            })
            .map(|(id, _)| *id)
    }

    /// Whether `Command::CommissionInterior` can be applied (pure). A
    /// missing office designer is not a reason: the item then waits for one.
    pub(crate) fn check_commission_interior(&self, room: RoomId) -> Result<(), Reject> {
        if !self.building.rooms.contains_key(&room) {
            return Err(Reject::UnknownRoom(room));
        }
        if self.interior_of_room(room).is_some() {
            return Err(Reject::Occupied(
                "the room already has a design in progress",
            ));
        }
        let open = self
            .plan
            .interiors
            .keys()
            .filter(|id| {
                self.plan
                    .items
                    .get(id)
                    .is_some_and(|i| !i.status.is_closed())
            })
            .count();
        if open >= MAX_OPEN_INTERIORS {
            return Err(Reject::Limit("rooms being designed at once (4)"));
        }
        if self.interior_project().is_none() {
            return Err(Reject::Invalid("there is no active project"));
        }
        Ok(())
    }

    /// `Command::CommissionInterior` (validated): an `Interior` item; its
    /// Draft starts at once with the office designer, or waits for one.
    pub(crate) fn commission_interior(&mut self, room: RoomId, brief_ref: u64) {
        if self.check_commission_interior(room).is_err() {
            return;
        }
        let Some(project) = self.interior_project() else {
            return;
        };
        let designer = self.office_designer();
        self.plan.next_item += 1;
        let id = WorkItemId(self.plan.next_item);
        let item = WorkItem {
            id,
            project,
            kind: WorkItemKind::Interior,
            status: WorkItemStatus::Planned,
            priority: WorkPriority::Normal,
            owner: designer,
            brief_ref: Some(brief_ref),
            revision: 0,
            phases: vec![
                Phase::new(PhaseKind::Draft, designer),
                Phase::new(PhaseKind::Publish, designer),
            ],
            current: 0,
            meeting: None,
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
            performance: None,
            followed_up: false,
        };
        self.plan.items.insert(id, item);
        self.plan.interiors.insert(
            id,
            Interior {
                room,
                items: Vec::new(),
                cost_cents: 0,
                placed: Vec::new(),
                next_step: None,
                refused: None,
            },
        );
        if designer.is_some() {
            self.start_phase(id, 0);
        } else {
            self.ask_for_designer(project);
        }
    }

    /// Rule 11: nobody can design the room, so the CEO is asked to hire
    /// (one open ticket at a time).
    fn ask_for_designer(&mut self, project: ProjectId) {
        let open = self.tickets.values().any(|t| {
            t.is_open() && t.kind == TicketKind::MissingRole && t.role == Some(Role::OfficeDesigner)
        });
        if open {
            return;
        }
        let from = self.projects.get(&project).and_then(|p| p.lead);
        self.raise_ticket(TicketSpec {
            kind: TicketKind::MissingRole,
            project: Some(project),
            from,
            role: Some(Role::OfficeDesigner),
            amount_cents: 0,
            work_item: None,
        });
    }

    /// Interior items waiting for an office designer start once one is on
    /// the staff (oldest first; the designer takes them all).
    pub(crate) fn start_waiting_interiors(&mut self) {
        let waiting: Vec<WorkItemId> = self
            .plan
            .items
            .values()
            .filter(|i| i.kind == WorkItemKind::Interior && i.is_unstarted())
            .filter(|i| i.phases.first().is_some_and(|p| p.assignee.is_none()))
            .map(|i| i.id)
            .collect();
        if waiting.is_empty() {
            return;
        }
        let Some(designer) = self.office_designer() else {
            return;
        };
        for id in waiting {
            if let Some(i) = self.plan.items.get_mut(&id) {
                i.owner = Some(designer);
                for p in &mut i.phases {
                    p.assignee = Some(designer);
                }
            }
            self.start_phase(id, 0);
        }
    }

    /// Validates a room plan (`ServerCommand::InteriorPlan`, pure): the job
    /// is an interior Draft the sim waits for; the plan's shape is sound.
    /// Whether each item fits is the construction's to check, item by item.
    pub(crate) fn check_interior_plan(
        &self,
        job_id: u64,
        items: &[PlannedEquipment],
    ) -> Result<(), Reject> {
        let job = self
            .plan
            .jobs
            .get(&job_id)
            .ok_or(Reject::Invalid("no pending job with that id"))?;
        if job.kind != JobKind::InteriorDesign {
            return Err(Reject::Invalid("not an office designer's job"));
        }
        if !job
            .work_item
            .is_some_and(|id| self.plan.interiors.contains_key(&id))
        {
            return Err(Reject::Invalid("the job's item has no room"));
        }
        if items.is_empty() {
            return Err(Reject::Invalid("a room plan places at least one item"));
        }
        if items.len() > MAX_ITEMS_PER_ROOM {
            return Err(Reject::Limit("items per room"));
        }
        for (n, it) in items.iter().enumerate() {
            let attachment = it.kind.desk_slot().is_some();
            match it.at {
                PlannedAt::Floor { pos, rot } => {
                    if attachment {
                        return Err(Reject::Invalid("monitors and lamps go on a desk"));
                    }
                    if rot > 3 {
                        return Err(Reject::Invalid("rotation is 0..=3 quarter turns"));
                    }
                    if pos.x.abs() > MAX_COORD_MM || pos.z.abs() > MAX_COORD_MM {
                        return Err(Reject::OutOfLot);
                    }
                }
                PlannedAt::OnPlanned(i) => {
                    if !attachment {
                        return Err(Reject::Invalid("only monitors and lamps sit on desks"));
                    }
                    let desk = items
                        .get(usize::from(i))
                        .filter(|_| usize::from(i) < n)
                        .ok_or(Reject::Invalid(
                            "an item may only go on a desk placed before it",
                        ))?;
                    if desk.kind != EquipmentKind::Desk {
                        return Err(Reject::Invalid("that is not a desk"));
                    }
                }
                PlannedAt::OnDesk(_) => {
                    if !attachment {
                        return Err(Reject::Invalid("only monitors and lamps sit on desks"));
                    }
                }
            }
        }
        Ok(())
    }

    /// `ServerCommand::InteriorPlan` (validated): the plan replaces any
    /// earlier one of the item, priced by the sim.
    pub(crate) fn apply_interior_plan(&mut self, job_id: u64, items: &[PlannedEquipment]) {
        let Some(id) = self.plan.jobs.get(&job_id).and_then(|j| j.work_item) else {
            return;
        };
        if let Some(b) = self.plan.interiors.get_mut(&id) {
            b.items = items.to_vec();
            b.cost_cents = items.iter().map(|i| i.kind.cost()).sum();
            b.placed.clear();
            b.next_step = None;
            b.refused = None;
        }
    }

    /// Whether an approved room plan can be built now (pure): it has items
    /// left, and an economic company has the cash for them.
    pub(crate) fn check_construction(&self, id: WorkItemId) -> Result<(), &'static str> {
        let b = self
            .plan
            .interiors
            .get(&id)
            .ok_or("the item has no room plan")?;
        if b.remaining() == 0 {
            return Err("the room plan has nothing left to build");
        }
        if self.company.build_mode == BuildMode::Economic && self.company.cash < b.remaining_cost()
        {
            return Err("not enough cash to build this room");
        }
        Ok(())
    }

    /// The construction (re)starts: the next item is placed one interval
    /// from now. Returns the steps the rest of the build takes.
    pub(crate) fn start_construction(&mut self, id: WorkItemId) -> u64 {
        let per = self.minutes_to_steps(MINUTES_PER_PLACEMENT);
        let step = self.step;
        let Some(b) = self.plan.interiors.get_mut(&id) else {
            return per;
        };
        b.next_step = Some(step + per);
        b.refused = None;
        per * u64::try_from(b.remaining().max(1)).unwrap_or(1)
    }

    /// Every item of the item's plan stands.
    pub fn construction_done(&self, id: WorkItemId) -> bool {
        self.plan
            .interiors
            .get(&id)
            .is_some_and(|b| !b.items.is_empty() && b.remaining() == 0)
    }

    /// The command that places plan item `index`, or why it cannot be.
    fn placement_command(&self, b: &Interior, index: usize) -> Result<Command, Reject> {
        let it = b.items.get(index).ok_or(Reject::Invalid("no such item"))?;
        let placement = match it.at {
            PlannedAt::Floor { pos, rot } => {
                if self.building.room_at(pos.tile()) != Some(b.room) {
                    return Err(Reject::Invalid("the item is no longer inside its room"));
                }
                Placement::Floor { pos, rot }
            }
            PlannedAt::OnPlanned(i) => Placement::OnDesk(
                *b.placed
                    .get(usize::from(i))
                    .ok_or(Reject::Invalid("its desk was not placed"))?,
            ),
            PlannedAt::OnDesk(d) => Placement::OnDesk(d),
        };
        Ok(Command::PlaceEquipment {
            kind: it.kind,
            placement,
        })
    }

    /// Places the next item of every running construction whose time has
    /// come, validated like the CEO's `PlaceEquipment` and charged at its
    /// price in an economic company. A refusal stops the build: the item is
    /// blocked with an escalation, and the plan records which item it was.
    /// Plans of closed items are dropped.
    pub(crate) fn advance_construction(&mut self) {
        let items = &self.plan.items;
        self.plan
            .interiors
            .retain(|id, _| items.get(id).is_some_and(|i| !i.status.is_closed()));
        let step = self.step;
        let due: Vec<WorkItemId> = self
            .plan
            .interiors
            .iter()
            .filter(|(_, b)| b.remaining() > 0 && b.next_step.is_some_and(|s| step >= s))
            .filter(|(id, _)| {
                self.plan.items.get(id).is_some_and(|i| {
                    i.status == WorkItemStatus::Approved
                        && i.phase().is_some_and(|p| {
                            p.kind == PhaseKind::Publish && p.state == PhaseState::Working
                        })
                })
            })
            .map(|(id, _)| *id)
            .collect();
        if due.is_empty() {
            return;
        }
        let per = self.minutes_to_steps(MINUTES_PER_PLACEMENT);
        for id in due {
            let Some(b) = self.plan.interiors.get(&id) else {
                continue;
            };
            let index = b.placed.len();
            let cmd = self
                .placement_command(b, index)
                .and_then(|c| validate(self, &c).map(|()| c));
            match cmd {
                Ok(cmd) => {
                    let equip = self.ids.peek_equip();
                    self.execute(cmd);
                    if let Some(b) = self.plan.interiors.get_mut(&id) {
                        b.placed.push(equip);
                        b.next_step = (b.remaining() > 0).then_some(step + per);
                    }
                }
                Err(_) => {
                    if let Some(b) = self.plan.interiors.get_mut(&id) {
                        b.refused = u16::try_from(index).ok();
                        b.next_step = None;
                    }
                    self.block_item(id, TicketKind::Escalation, None);
                }
            }
        }
    }
}

#[allow(clippy::trivially_copy_pass_by_ref)]
fn is_zero(n: &u8) -> bool {
    *n == 0
}
