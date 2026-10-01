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
use crate::ids::{CandidateId, EquipId, MeetingId, RoomId, StaffId};
use crate::staff::Spot;
use crate::world::{World, MAX_STAFF};

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
            w.candidates
                .get(candidate)
                .ok_or(Reject::UnknownCandidate(*candidate))?;
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
    }
}

/// Validates a server-injected command.
pub fn validate_server(w: &World, cmd: &ServerCommand) -> Result<(), Reject> {
    match cmd {
        ServerCommand::JobCompleted { .. } => Err(Reject::NotSupported(
            "LLM jobs arrive in M2; no job can be pending in M1",
        )),
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
        Command::Demolish(_) | Command::SetPolicy(_) => 0,
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
    use crate::scenarios::demo_office;

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

    #[test]
    fn rejects_overlap_and_out_of_lot() {
        let w = demo_office(1);
        let place = |rect| Command::PlaceRoom {
            kind: RoomKind::Kitchen,
            rect,
            floor: 0,
            doors: vec![],
            windows: vec![],
        };
        assert_eq!(
            validate(&w, &place(TileRect::new(8, 6, 3, 3))),
            Err(Reject::Overlap)
        );
        assert_eq!(
            validate(&w, &place(TileRect::new(15, 8, 3, 3))),
            Err(Reject::OutOfLot)
        );
        assert!(matches!(
            validate(&w, &place(TileRect::new(i32::MAX, 0, 3, 3))),
            Err(Reject::OutOfLot)
        ));
    }

    #[test]
    fn rejects_unreachable_room() {
        let mut w = demo_office(1);
        w.apply(Command::BuyFloorSpace {
            side: Side::East,
            tiles: 4,
        })
        .unwrap();
        let sealed = Command::PlaceRoom {
            kind: RoomKind::Kitchen,
            rect: TileRect::new(17, 1, 3, 3),
            floor: 0,
            doors: vec![],
            windows: vec![],
        };
        assert!(matches!(validate(&w, &sealed), Err(Reject::Unreachable(_))));
        let open = Command::PlaceRoom {
            kind: RoomKind::Kitchen,
            rect: TileRect::new(16, 5, 4, 5),
            floor: 0,
            doors: vec![Door {
                side: Side::West,
                at: 1,
            }],
            windows: vec![Window {
                side: Side::East,
                at_mm: 1000,
                width_mm: 2000,
            }],
        };
        assert_eq!(validate(&w, &open), Ok(()));
    }

    #[test]
    fn rejects_interior_windows_and_street_doors() {
        let w = demo_office(1);
        let mut b = w.clone();
        b.apply(Command::BuyFloorSpace {
            side: Side::East,
            tiles: 4,
        })
        .unwrap();
        let interior_window = Command::PlaceRoom {
            kind: RoomKind::Kitchen,
            rect: TileRect::new(16, 5, 3, 5),
            floor: 0,
            doors: vec![Door {
                side: Side::West,
                at: 1,
            }],
            windows: vec![Window {
                side: Side::East,
                at_mm: 0,
                width_mm: 1000,
            }],
        };
        assert!(matches!(
            validate(&b, &interior_window),
            Err(Reject::Invalid(_))
        ));
        let street_door = Command::PlaceRoom {
            kind: RoomKind::Kitchen,
            rect: TileRect::new(16, 5, 4, 5),
            floor: 0,
            doors: vec![Door {
                side: Side::East,
                at: 1,
            }],
            windows: vec![],
        };
        assert!(matches!(
            validate(&b, &street_door),
            Err(Reject::Invalid(_))
        ));
    }

    #[test]
    fn prerequisites() {
        let mut w = demo_office(1);
        let locked = Command::PlaceRoom {
            kind: RoomKind::DesignStudio,
            rect: TileRect::new(0, 0, 3, 3),
            floor: 0,
            doors: vec![],
            windows: vec![],
        };
        assert!(matches!(validate(&w, &locked), Err(Reject::Locked { .. })));
        let upper = Command::PlaceRoom {
            kind: RoomKind::Kitchen,
            rect: TileRect::new(0, 0, 3, 3),
            floor: 1,
            doors: vec![],
            windows: vec![],
        };
        assert!(matches!(validate(&w, &upper), Err(Reject::NotSupported(_))));
        // every demo desk is taken
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
                        pos: PosMm::new(8_000, 8_000),
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
                    job_id: crate::ids::JobId(1),
                    digest: crate::commands::JobDigest {
                        ok: true,
                        score: 8,
                        words: 900,
                        qa_defects: 0,
                        artifact_sha: [0; 16]
                    }
                }
            ),
            Err(Reject::NotSupported(_))
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
                        pos: PosMm::new(2_600, 3_100),
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
        // free spot is fine
        assert_eq!(
            validate(
                &w,
                &Command::PlaceEquipment {
                    kind: EquipmentKind::Desk,
                    placement: Placement::Floor {
                        pos: PosMm::new(7_500, 3_000),
                        rot: 0
                    }
                }
            ),
            Ok(())
        );
    }
}
