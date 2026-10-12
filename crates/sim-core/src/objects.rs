//! Players' own kit designs placed in rooms (ADR-0065 §4 "the sim boundary",
//! construction-kit.md §4, increment K-4; ADR-0087 decision 7).
//!
//! Bricks never enter the sim: a placed design is its **hash** (a reference,
//! like an artifact's sha, never text) and its **summary**, the numbers the
//! kit's compiler derives from the design's geometry (`crates/kit`,
//! `Summary`). Replay applies the summary as logged; it never re-runs the
//! compiler.
//!
//! The summary is the client's word. Nothing in the sim can check it against
//! the design, so a forged summary (a cheap "desk" with eight seats) is
//! accepted here; the central audit of ADR-0065 §4 recomputes every summary
//! from its design (the designs travel with the work records) and refuses a
//! forged one before a company is ranked (leagues, ADR-0055). The sim only
//! bounds the numbers ([`check_summary`]).
//!
//! **Staff use what the bricks provide** (ADR-0088). A floor object whose
//! summary says `workstation` is a home for staff like a built-in `Desk`:
//! hiring hands out free workstations (desks first, then objects, each by
//! id; [`crate::World::free_stations`]) and the person sits at the object's
//! seat ([`PlacedObject::seat_pos`]: its position plus the summary's
//! `seat_at`, turned with the object). A workstation object somebody calls
//! home, or anyone sits at, follows the desk rules: it is not removed while
//! it is someone's home, not moved while someone sits at it or walks to it.
//! Lights and storage of objects only count towards the room's totals
//! ([`room_capabilities`]).
//!
//! **Seats of your own** (ADR-0089). A floor object that seats people and is
//! no workstation (a chair, a bench, a sofa of the player's design) offers
//! [`places`] at meetings and breaks: in a meeting room its places come after
//! the table's seats at that room's meetings, in the kitchen after the
//! kitchen table's at lunch (table seats first, then objects by id and
//! place: `World::room_seats`). Its places lie on its footprint, in a row
//! along its longer side ([`place_offset`]), one per seat its summary counts,
//! at most one per [`PLACE_STUDS`] of that side and [`MAX_OBJECT_PLACES`]
//! in all; each lies [`SEAT_CLEARANCE_MM`] inside the room. A seat object
//! someone sits on or walks to is neither moved nor removed.
//!
//! **Ceiling designs** (ADR-0090, [`Mount::Ceiling`]) hang over the floor:
//! placed with `PlaceObject` like a floor design, they take no floor space
//! and stand clear only of the ceiling's other items (the built-in ceiling
//! lights, each the square of half [`crate::validate::CEILING_LIGHT_SPACING_MM`]
//! around its centre, so two lights keep the sim's spacing; and other
//! ceiling objects' footprints). They hang at most [`MAX_CEILING_HANG`]
//! plates down and seat nobody; their lights count towards the room's.
//!
//! **Desk-top designs** ([`Mount::Surface`]) take a built-in desk's slot
//! (`PlaceObjectOnDesk`): one with a screen takes the screen slot, any other
//! the lamp slot. They sit at the desk's position and turn, move with it and
//! are removed with it, like monitors and lamps; a slot holds one item,
//! equipment or object. They take no floor space.
//!
//! # Placement
//!
//! - [`Mount::Floor`] and [`Mount::Ceiling`] designs are placed with
//!   `PlaceObject`, `Surface` ones on a desk with `PlaceObjectOnDesk`.
//! - `pos` is the footprint's centre in millimetres; `rot` turns it by
//!   quarter turns clockwise seen from above (an odd turn swaps width and
//!   depth). A stud is 62.5 mm, so the footprint is
//!   `footprint[0] × 62.5 mm` along x and `footprint[1] × 62.5 mm` along z at
//!   turn 0. Geometry is exact integer math in quarter millimetres.
//! - The footprint lies inside one room, [`OBJECT_WALL_CLEARANCE_MM`] clear
//!   of its walls (the wall's half thickness: an object may stand against a
//!   wall, it may not stand in it), and off the room's door tiles (the tile
//!   on this room's side of every door edge, the street entrance included),
//!   so doors stay passable.
//! - **Overlaps** are judged as axis-aligned rectangles whose interiors must
//!   not intersect (touching is allowed), the rule the town uses. An object's
//!   rectangle is its turned footprint; a floor equipment item's is the
//!   square the sim's spacing rule already gives it (centre ±
//!   `EquipmentKind::footprint_mm()`, the same square two equipment items
//!   keep apart by Chebyshev distance); a desk's chair is the square
//!   [`CHAIR_HALF_MM`] around its seat position, so nobody's chair is built
//!   over; a workstation object's seat is the same square around its seat
//!   position, and it lies inside the room, [`SEAT_CLEARANCE_MM`] clear of
//!   the walls, like a desk's chair. Items without floor space (desk
//!   attachments, desk-top objects, ceiling lights, ceiling objects) are
//!   ignored; ceiling items are judged among themselves the same way. The
//!   same rule keeps new equipment off objects
//!   (`PlaceEquipment`, `MoveEquipment`, the office designer's builds).
//! - Objects count towards the room's item limit
//!   (`equipment::MAX_ITEMS_PER_ROOM`), as equipment counts towards theirs.

use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};

use crate::building::{Building, WALL_HALF_MM};
use crate::equipment::{DeskSlot, EquipmentKind, MAX_ITEMS_PER_ROOM, SEAT_CLEARANCE_MM};
use crate::geom::{PosMm, Side, Tile, TileRect, TILE_MM};
use crate::ids::{EquipId, ObjectId, RoomId};
use crate::validate::{Reject, MAX_COORD_MM};

/// Quarter millimetres per stud (a stud is 62.5 mm).
pub const STUD_QMM: i64 = 250;
/// Widest object side, studs (12 m).
pub const MAX_OBJECT_STUDS: u32 = 192;
/// Tallest object, plates (a plate is 25 mm).
pub const MAX_OBJECT_HEIGHT: u32 = 480;
/// Most parts in one object.
pub const MAX_OBJECT_PARTS: u32 = 200_000;
/// Dearest object, cents (€100 000).
pub const MAX_OBJECT_COST_CENTS: u64 = 10_000_000;
/// How far an object's footprint keeps from a room's wall lines, mm: the
/// wall's half thickness.
pub const OBJECT_WALL_CLEARANCE_MM: i32 = WALL_HALF_MM;
/// Half the side of the square a desk's chair keeps free, mm (the shipped
/// chair is 50 × 50 cm).
pub const CHAIR_HALF_MM: i32 = 250;
/// How far outside its footprint a workstation's seat may lie, mm (the
/// kit's `SEAT_REACH`, 16 studs).
pub const SEAT_REACH_MM: i32 = 1_000;
/// Most places one seat object offers at meetings and breaks (ADR-0089).
pub const MAX_OBJECT_PLACES: u8 = 8;
/// Width of one place along a seat object's longer side, studs (50 cm).
pub const PLACE_STUDS: u32 = 8;
/// Deepest a ceiling design hangs, plates (80 cm: under a 2.9 m ceiling
/// its lowest part stays above 2.1 m, ADR-0090).
pub const MAX_CEILING_HANG: u32 = 32;
/// Half the side of the square a ceiling light keeps on the ceiling, mm: two
/// lights' squares touch at the sim's light spacing.
pub const CEILING_LIGHT_HALF_MM: i32 = crate::validate::CEILING_LIGHT_SPACING_MM / 2;
/// Labour for moving an object, percent of its parts' price.
pub const OBJECT_MOVE_PCT: u64 = crate::town::MOVE_LABOUR_PCT as u64;

/// Where a design is grounded (the kit's `Mount`). Serde names are the
/// variant names; the kit's kebab-case names are accepted too.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum Mount {
    #[serde(alias = "floor")]
    Floor,
    #[serde(alias = "surface")]
    Surface,
    #[serde(alias = "ceiling")]
    Ceiling,
}

/// What a placed design can do: numbers only, from the kit's compiled
/// `Summary` (construction-kit.md §3 and §12.4).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ObjectSummary {
    /// Declared footprint `[w, d]` at turn 0, studs.
    pub footprint: [u32; 2],
    /// Built height, plates.
    pub height: u32,
    pub mount: Mount,
    pub seats: u8,
    pub workstation: bool,
    /// Where a person sits at a workstation: the seat port relative to the
    /// footprint's centre, mm `[x, z]` at turn 0 (ADR-0088). `None` unless
    /// `workstation`; absent in older JSON.
    #[serde(default)]
    pub seat_at: Option<[i32; 2]>,
    pub lights: u8,
    /// Shelf area, stud².
    pub storage: u32,
    pub screens: u8,
    pub parts: u32,
    /// The parts' price, cents of in-game money.
    pub cost: u64,
}

impl ObjectSummary {
    /// The parts' price as a ledger amount, cents.
    pub fn price(&self) -> i64 {
        i64::try_from(self.cost).unwrap_or(i64::MAX)
    }

    /// Labour for moving it, cents: [`OBJECT_MOVE_PCT`] of its price.
    pub fn move_cost(&self) -> i64 {
        i64::try_from(self.cost.saturating_mul(OBJECT_MOVE_PCT) / 100).unwrap_or(i64::MAX)
    }
}

/// A design placed in a room.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlacedObject {
    pub id: ObjectId,
    /// The design's hash: 64 lowercase hex characters.
    pub design: String,
    pub room: RoomId,
    /// Footprint centre, mm.
    pub pos: PosMm,
    /// Quarter turns clockwise seen from above, 0..=3.
    pub rot: u8,
    pub summary: ObjectSummary,
    /// A desk-top design's desk and slot (ADR-0088 decision 3); it then
    /// shares the desk's position, turn and room. `None` on the floor.
    #[serde(default)]
    pub on_desk: Option<(EquipId, DeskSlot)>,
}

impl PlacedObject {
    pub fn rect(&self) -> Rect {
        object_rect(&self.summary, self.pos, self.rot)
    }

    /// A floor workstation: a home for staff (ADR-0088 decision 2).
    pub fn is_workstation(&self) -> bool {
        self.on_desk.is_none() && self.summary.workstation && self.summary.seat_at.is_some()
    }

    /// Hung from the ceiling (ADR-0090): no floor space.
    pub fn is_ceiling(&self) -> bool {
        self.summary.mount == Mount::Ceiling
    }

    /// Places it offers at meetings and breaks (ADR-0089); 0 unless it is a
    /// floor seat object.
    pub fn places(&self) -> u8 {
        if self.on_desk.is_some() {
            return 0;
        }
        places(&self.summary)
    }

    /// Where place `n` is: its position plus [`place_offset`], turned with
    /// it. `None` past its places.
    pub fn place_pos(&self, n: u8) -> Option<PosMm> {
        if n >= self.places() {
            return None;
        }
        place_offset(&self.summary, n).map(|a| seat_of(self.pos, self.rot, a))
    }

    /// Where a person sits to work at it: the position plus `seat_at`
    /// turned with the object. `None` unless it is a workstation.
    pub fn seat_pos(&self) -> Option<PosMm> {
        if !self.is_workstation() {
            return None;
        }
        self.summary.seat_at.map(|a| seat_of(self.pos, self.rot, a))
    }

    /// The floor it takes: its footprint and, for a workstation, the square
    /// of its seat. A desk-top object takes none.
    pub fn floor_rects(&self) -> Vec<Rect> {
        if self.on_desk.is_some() || self.is_ceiling() {
            return Vec::new();
        }
        floor_rects(&self.summary, self.pos, self.rot)
    }

    /// The ceiling it takes: its footprint when it hangs, else none.
    pub fn ceiling_rects(&self) -> Vec<Rect> {
        if self.is_ceiling() {
            vec![self.rect()]
        } else {
            Vec::new()
        }
    }
}

/// How many places a design with `summary` offers at meetings and breaks
/// (ADR-0089): a floor design that seats people and is no workstation
/// offers one per seat, at most one per [`PLACE_STUDS`] of its longer side
/// (at least one) and [`MAX_OBJECT_PLACES`] in all.
pub fn places(summary: &ObjectSummary) -> u8 {
    if summary.mount != Mount::Floor || summary.workstation || summary.seats == 0 {
        return 0;
    }
    let long = summary.footprint[0].max(summary.footprint[1]);
    let fit = u8::try_from((long / PLACE_STUDS).max(1)).unwrap_or(u8::MAX);
    summary.seats.min(fit).min(MAX_OBJECT_PLACES)
}

/// Place `n` of a seat design relative to its footprint's centre, mm at
/// turn 0: the middle of the `n`-th of [`places`] equal stretches of its
/// longer side (x when the sides are equal), on its middle line; truncated
/// towards zero, so a row is symmetric. `None` past its places.
pub fn place_offset(summary: &ObjectSummary, n: u8) -> Option<[i32; 2]> {
    let count = places(summary);
    if n >= count {
        return None;
    }
    let [w, d] = summary.footprint;
    let (long, along_x) = if w >= d { (w, true) } else { (d, false) };
    // (2n + 1 − count) × long × 62.5 mm / (2 count)
    //   = (2n + 1 − count) × long × 250 qmm / (8 count)
    let k = 2 * i64::from(n) + 1 - i64::from(count);
    let off = k * i64::from(long) * STUD_QMM / (8 * i64::from(count));
    let off = i32::try_from(off).unwrap_or(0);
    Some(if along_x { [off, 0] } else { [0, off] })
}

/// `offset` (mm, at turn 0) turned `rot` quarter turns clockwise seen from
/// above, the turn of desks' chairs (`equipment::seat_pos`): `(x, z)` →
/// `(−z, x)` per quarter turn.
pub const fn turn_offset(offset: [i32; 2], rot: u8) -> [i32; 2] {
    let [x, z] = offset;
    match rot % 4 {
        0 => [x, z],
        1 => [-z, x],
        2 => [-x, -z],
        _ => [z, -x],
    }
}

/// The seat of a workstation at `pos` turned `rot` whose summary puts the
/// seat at `seat_at`.
pub const fn seat_of(pos: PosMm, rot: u8, seat_at: [i32; 2]) -> PosMm {
    let [dx, dz] = turn_offset(seat_at, rot);
    PosMm::new(pos.x + dx, pos.z + dz)
}

/// The floor a floor design takes at `pos` turned `rot`: its footprint,
/// and its seat's square when it is a workstation.
fn floor_rects(summary: &ObjectSummary, pos: PosMm, rot: u8) -> Vec<Rect> {
    let mut v = vec![object_rect(summary, pos, rot)];
    if let (true, Some(a)) = (summary.workstation, summary.seat_at) {
        v.push(Rect::square(seat_of(pos, rot, a), CHAIR_HALF_MM));
    }
    v
}

/// The slot a desk-top design takes: the screen slot when it has a screen,
/// the lamp slot otherwise (ADR-0088 decision 3).
pub const fn desk_slot_for(summary: &ObjectSummary) -> DeskSlot {
    if summary.screens > 0 {
        DeskSlot::Screen
    } else {
        DeskSlot::Lamp
    }
}

/// Whether `desk`'s `slot` holds equipment (other than `except`) or an
/// object.
pub fn desk_slot_taken(
    b: &Building,
    desk: EquipId,
    slot: DeskSlot,
    except: Option<EquipId>,
) -> bool {
    b.equipment.values().any(|e| {
        Some(e.id) != except && e.attached_to == Some(desk) && e.kind.desk_slot() == Some(slot)
    }) || b.objects.values().any(|o| o.on_desk == Some((desk, slot)))
}

/// Capabilities of a room's objects, totalled.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ObjectCapabilities {
    pub seats: u32,
    /// Places at meetings and breaks its seat objects offer (ADR-0089).
    #[serde(default)]
    pub places: u32,
    pub workstations: u32,
    pub lights: u32,
    /// Stud².
    pub storage: u64,
    pub screens: u32,
}

/// An axis-aligned rectangle in quarter millimetres, ends exclusive.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Rect {
    pub x0: i64,
    pub z0: i64,
    pub x1: i64,
    pub z1: i64,
}

impl Rect {
    /// Interiors intersect (touching edges do not count).
    pub const fn overlaps(&self, o: &Rect) -> bool {
        self.x0 < o.x1 && o.x0 < self.x1 && self.z0 < o.z1 && o.z0 < self.z1
    }

    pub const fn contains(&self, o: &Rect) -> bool {
        o.x0 >= self.x0 && o.z0 >= self.z0 && o.x1 <= self.x1 && o.z1 <= self.z1
    }

    /// The square of half side `half_mm` around `pos`.
    pub fn square(pos: PosMm, half_mm: i32) -> Rect {
        let (x, z, h) = (
            4 * i64::from(pos.x),
            4 * i64::from(pos.z),
            4 * i64::from(half_mm),
        );
        Rect {
            x0: x - h,
            z0: z - h,
            x1: x + h,
            z1: z + h,
        }
    }

    /// A tile rect shrunk by `inset_mm` on every side.
    pub fn of_tiles(r: &TileRect, inset_mm: i32) -> Rect {
        let t = 4 * i64::from(TILE_MM);
        let i = 4 * i64::from(inset_mm);
        Rect {
            x0: i64::from(r.x) * t + i,
            z0: i64::from(r.z) * t + i,
            x1: i64::from(r.x_end()) * t - i,
            z1: i64::from(r.z_end()) * t - i,
        }
    }

    fn of_tile(t: Tile) -> Rect {
        Rect::of_tiles(&TileRect::new(t.x, t.z, 1, 1), 0)
    }
}

/// The footprint of `summary` centred at `pos`, turned `rot` quarter turns.
pub fn object_rect(summary: &ObjectSummary, pos: PosMm, rot: u8) -> Rect {
    let [w, d] = summary.footprint;
    let (w, d) = if rot & 1 == 0 { (w, d) } else { (d, w) };
    // half of n studs = n × 125 quarter millimetres
    let (hw, hd) = (i64::from(w) * STUD_QMM / 2, i64::from(d) * STUD_QMM / 2);
    let (x, z) = (4 * i64::from(pos.x), 4 * i64::from(pos.z));
    Rect {
        x0: x - hw,
        z0: z - hd,
        x1: x + hw,
        z1: z + hd,
    }
}

/// Whether `s` is a design hash: 64 lowercase hex characters.
pub fn valid_design_hash(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

/// Bounds on a summary's numbers (the sim cannot check them against the
/// design; see the module docs). The mount is the command's to check. A
/// ceiling design hangs at most [`MAX_CEILING_HANG`] plates and seats nobody
/// (ADR-0090).
///
/// A workstation carries its seat position, at most [`SEAT_REACH_MM`]
/// outside its footprint on each axis; anything else carries none. A
/// workstation is one home whatever its `seats` say (ADR-0088 decision 5),
/// and a desk-top design is never one.
pub fn check_summary(s: &ObjectSummary) -> Result<(), Reject> {
    let side = 1..=MAX_OBJECT_STUDS;
    if !side.contains(&s.footprint[0]) || !side.contains(&s.footprint[1]) {
        return Err(Reject::Invalid("a footprint side is 1..=192 studs"));
    }
    if s.height > MAX_OBJECT_HEIGHT {
        return Err(Reject::Invalid("an object is at most 480 plates high"));
    }
    if s.parts == 0 || s.parts > MAX_OBJECT_PARTS {
        return Err(Reject::Invalid("an object has 1..=200000 parts"));
    }
    if s.cost > MAX_OBJECT_COST_CENTS {
        return Err(Reject::Invalid("an object costs at most €100 000"));
    }
    if s.mount == Mount::Ceiling {
        if s.height > MAX_CEILING_HANG {
            return Err(Reject::Invalid(
                "a ceiling design hangs at most 32 plates (80 cm)",
            ));
        }
        if s.seats > 0 {
            return Err(Reject::Invalid("a ceiling design seats nobody"));
        }
    }
    match (s.workstation, s.seat_at) {
        (false, Some(_)) => {
            return Err(Reject::Invalid("only a workstation has a seat position"));
        }
        (true, None) => return Err(Reject::Invalid("a workstation needs its seat position")),
        (true, Some([x, z])) => {
            // half a side of n studs = n × 125 quarter millimetres
            let reach = 4 * i64::from(SEAT_REACH_MM);
            let within = |v: i32, studs: u32| {
                4 * i64::from(v).abs() <= i64::from(studs) * STUD_QMM / 2 + reach
            };
            if !within(x, s.footprint[0]) || !within(z, s.footprint[1]) {
                return Err(Reject::Invalid(
                    "a workstation's seat is at most 1 m outside its footprint",
                ));
            }
            match s.mount {
                Mount::Floor => {}
                Mount::Surface => {
                    return Err(Reject::Invalid("a desk-top design is not a workstation"));
                }
                Mount::Ceiling => {
                    return Err(Reject::Invalid("a ceiling design is not a workstation"));
                }
            }
        }
        (false, None) => {}
    }
    Ok(())
}

/// The floor squares that equipment in `room` takes: floor items with a
/// spacing radius, and every desk's chair.
fn equipment_rects(b: &Building, room: RoomId) -> impl Iterator<Item = Rect> + '_ {
    b.equipment
        .values()
        .filter(move |e| e.room == room && e.attached_to.is_none())
        .flat_map(|e| {
            let body =
                (e.kind.footprint_mm() > 0).then(|| Rect::square(e.pos, e.kind.footprint_mm()));
            let chair =
                (e.kind == EquipmentKind::Desk).then(|| Rect::square(e.seat_pos(), CHAIR_HALF_MM));
            body.into_iter().chain(chair)
        })
}

/// Whether a floor equipment item of `kind` at `pos` turned `rot` in `room`
/// would stand on an object (its spacing square, or a desk's chair square).
pub fn equipment_hits_object(
    b: &Building,
    room: RoomId,
    kind: EquipmentKind,
    pos: PosMm,
    rot: u8,
) -> bool {
    if kind.desk_slot().is_some() {
        return false;
    }
    if kind == EquipmentKind::CeilingLight {
        let light = Rect::square(pos, CEILING_LIGHT_HALF_MM);
        return b
            .objects
            .values()
            .filter(|o| o.room == room)
            .flat_map(PlacedObject::ceiling_rects)
            .any(|o| o.overlaps(&light));
    }
    let mut rects = Vec::new();
    if kind.footprint_mm() > 0 {
        rects.push(Rect::square(pos, kind.footprint_mm()));
    }
    if kind == EquipmentKind::Desk {
        rects.push(Rect::square(
            crate::equipment::seat_pos(pos, rot),
            CHAIR_HALF_MM,
        ));
    }
    b.objects
        .values()
        .filter(|o| o.room == room)
        .flat_map(PlacedObject::floor_rects)
        .any(|o| rects.iter().any(|r| r.overlaps(&o)))
}

/// Items in `room`: equipment and objects.
pub fn items_in_room(b: &Building, room: RoomId) -> usize {
    b.equipment.values().filter(|e| e.room == room).count()
        + b.objects.values().filter(|o| o.room == room).count()
}

/// The tiles of `room` next to a door edge (any room's door, or the street
/// entrance), which objects keep clear.
fn door_tiles(b: &Building, room: &TileRect) -> BTreeSet<Tile> {
    let mut out = BTreeSet::new();
    for edge in b.door_edges() {
        let other = edge
            .tile
            .neighbour(if edge.east { Side::East } else { Side::South });
        for t in [edge.tile, other] {
            if room.contains(t) {
                out.insert(t);
            }
        }
    }
    out
}

/// The ceiling squares that `room`'s built-in ceiling lights take.
fn ceiling_light_rects(b: &Building, room: RoomId) -> impl Iterator<Item = Rect> + '_ {
    b.equipment
        .values()
        .filter(move |e| e.room == room && e.kind == EquipmentKind::CeilingLight)
        .map(|e| Rect::square(e.pos, CEILING_LIGHT_HALF_MM))
}

/// Whether a design with `summary` may stand (or, a ceiling design, hang) at
/// `pos` turned `rot` in `b`, ignoring the object `except` (the one being
/// moved). Returns its room.
pub fn check_spot(
    b: &Building,
    summary: &ObjectSummary,
    pos: PosMm,
    rot: u8,
    except: Option<ObjectId>,
) -> Result<RoomId, Reject> {
    if rot > 3 {
        return Err(Reject::Invalid("rotation is 0..=3 quarter turns"));
    }
    if pos.x.abs() > MAX_COORD_MM || pos.z.abs() > MAX_COORD_MM {
        return Err(Reject::OutOfLot);
    }
    let room_id = b
        .room_at(pos.tile())
        .ok_or(Reject::Invalid("an object goes inside a room"))?;
    let room = &b.rooms[&room_id];
    let fp = object_rect(summary, pos, rot);
    if !Rect::of_tiles(&room.rect, OBJECT_WALL_CLEARANCE_MM).contains(&fp) {
        return Err(Reject::Invalid("the object does not fit inside the room"));
    }
    let moving_within = except
        .and_then(|id| b.objects.get(&id))
        .is_some_and(|o| o.room == room_id);
    if summary.mount == Mount::Ceiling {
        // On the ceiling (ADR-0090): clear of the lights and the other
        // ceiling objects only; floor items and doors are below it.
        if ceiling_light_rects(b, room_id).any(|r| r.overlaps(&fp))
            || b.objects
                .values()
                .filter(|o| Some(o.id) != except && o.room == room_id)
                .flat_map(PlacedObject::ceiling_rects)
                .any(|r| r.overlaps(&fp))
        {
            return Err(Reject::Overlap);
        }
        if !moving_within && items_in_room(b, room_id) >= MAX_ITEMS_PER_ROOM {
            return Err(Reject::Limit("items per room"));
        }
        return Ok(room_id);
    }
    if let (true, Some(a)) = (summary.workstation, summary.seat_at) {
        if !room
            .rect
            .contains_pos_inset(seat_of(pos, rot, a), SEAT_CLEARANCE_MM)
        {
            return Err(Reject::Invalid("the seat would be in the wall"));
        }
    }
    // a seat object's places (ADR-0089): on its footprint, clear of the walls
    if (0..places(summary))
        .filter_map(|n| place_offset(summary, n))
        .any(|a| {
            !room
                .rect
                .contains_pos_inset(seat_of(pos, rot, a), SEAT_CLEARANCE_MM)
        })
    {
        return Err(Reject::Invalid("a seat would be too close to the wall"));
    }
    let rects = floor_rects(summary, pos, rot);
    if door_tiles(b, &room.rect)
        .into_iter()
        .any(|t| Rect::of_tile(t).overlaps(&fp))
    {
        return Err(Reject::Invalid("the object would block a door"));
    }
    let hits = |r: &Rect| rects.iter().any(|m| m.overlaps(r));
    if equipment_rects(b, room_id).any(|r| hits(&r)) {
        return Err(Reject::Overlap);
    }
    if b.objects
        .values()
        .filter(|o| Some(o.id) != except && o.room == room_id)
        .flat_map(PlacedObject::floor_rects)
        .any(|r| hits(&r))
    {
        return Err(Reject::Overlap);
    }
    if !moving_within && items_in_room(b, room_id) >= MAX_ITEMS_PER_ROOM {
        return Err(Reject::Limit("items per room"));
    }
    Ok(room_id)
}

/// The capabilities of `room`'s objects, totalled.
pub fn room_capabilities(b: &Building, room: RoomId) -> ObjectCapabilities {
    let mut c = ObjectCapabilities::default();
    for o in b.objects.values().filter(|o| o.room == room) {
        let s = &o.summary;
        c.seats += u32::from(s.seats);
        c.places += u32::from(o.places());
        c.workstations += u32::from(o.is_workstation());
        c.lights += u32::from(s.lights);
        c.storage += u64::from(s.storage);
        c.screens += u32::from(s.screens);
    }
    c
}

#[cfg(test)]
mod tests {
    use super::*;

    fn summary(w: u32, d: u32) -> ObjectSummary {
        ObjectSummary {
            footprint: [w, d],
            height: 30,
            mount: Mount::Floor,
            seats: 0,
            workstation: false,
            seat_at: None,
            lights: 0,
            storage: 0,
            screens: 0,
            parts: 10,
            cost: 1_000,
        }
    }

    #[test]
    fn footprints_turn_and_stay_exact() {
        // 3 × 2 studs = 187.5 × 125 mm around (1000, 1000)
        let s = summary(3, 2);
        let r = object_rect(&s, PosMm::new(1_000, 1_000), 0);
        assert_eq!(
            r,
            Rect {
                x0: 3_625,
                z0: 3_750,
                x1: 4_375,
                z1: 4_250
            }
        );
        let r = object_rect(&s, PosMm::new(1_000, 1_000), 1);
        assert_eq!(
            r,
            Rect {
                x0: 3_750,
                z0: 3_625,
                x1: 4_250,
                z1: 4_375
            }
        );
        // touching is not overlapping
        let a = object_rect(&summary(16, 16), PosMm::new(0, 0), 0);
        let b = object_rect(&summary(16, 16), PosMm::new(1_000, 0), 0);
        assert!(!a.overlaps(&b));
        let c = object_rect(&summary(16, 16), PosMm::new(999, 0), 0);
        assert!(a.overlaps(&c));
    }

    #[test]
    fn hashes_and_summaries() {
        assert!(valid_design_hash(&"0123456789abcdef".repeat(4)));
        assert!(!valid_design_hash(&"0123456789ABCDEF".repeat(4)));
        assert!(!valid_design_hash(&"ab".repeat(31)));
        assert!(!valid_design_hash(&"g".repeat(64)));
        assert_eq!(check_summary(&summary(24, 12)), Ok(()));
        let mut s = summary(24, 12);
        s.mount = Mount::Ceiling;
        assert_eq!(check_summary(&s), Ok(()), "ceiling designs hang (ADR-0090)");
        s.height = MAX_CEILING_HANG + 1;
        assert!(check_summary(&s).is_err(), "too deep a hang");
        s.height = 24;
        s.seats = 1;
        assert!(check_summary(&s).is_err(), "a ceiling design seats nobody");
        s.seats = 0;
        s.mount = Mount::Surface;
        assert_eq!(check_summary(&s), Ok(()));
        // a workstation's seat: present, and within 1 m of its footprint
        // (24 × 12 studs: 750 × 375 mm half sides)
        let mut s = summary(24, 12);
        s.workstation = true;
        assert!(check_summary(&s).is_err());
        s.seat_at = Some([0, 750]);
        assert_eq!(check_summary(&s), Ok(()));
        s.seat_at = Some([-1_750, 1_375]);
        assert_eq!(check_summary(&s), Ok(()));
        s.seat_at = Some([-1_751, 0]);
        assert!(check_summary(&s).is_err());
        s.seat_at = Some([0, 1_376]);
        assert!(check_summary(&s).is_err());
        s.seat_at = Some([0, 750]);
        s.mount = Mount::Surface;
        assert!(check_summary(&s).is_err());
        let mut s = summary(24, 12);
        s.seat_at = Some([0, 750]);
        assert!(check_summary(&s).is_err(), "a seat without a workstation");
        assert!(check_summary(&summary(0, 12)).is_err());
        assert!(check_summary(&summary(193, 12)).is_err());
        let mut s = summary(2, 2);
        s.parts = 0;
        assert!(check_summary(&s).is_err());
        s.parts = 1;
        s.height = 481;
        assert!(check_summary(&s).is_err());
        s.height = 480;
        s.cost = MAX_OBJECT_COST_CENTS + 1;
        assert!(check_summary(&s).is_err());
        s.cost = 3_199;
        assert_eq!(s.price(), 3_199);
        assert_eq!(s.move_cost(), 319);
    }

    #[test]
    fn seat_objects_offer_places_in_a_row() {
        let mut chair = summary(8, 8);
        chair.seats = 1;
        assert_eq!(places(&chair), 1);
        assert_eq!(place_offset(&chair, 0), Some([0, 0]));
        assert_eq!(place_offset(&chair, 1), None);
        // a bench 1.5 m long and 0.5 m deep: three places along x
        let mut bench = summary(24, 8);
        bench.seats = 3;
        assert_eq!(places(&bench), 3);
        let row: Vec<_> = (0..3).filter_map(|n| place_offset(&bench, n)).collect();
        assert_eq!(row, vec![[-500, 0], [0, 0], [500, 0]]);
        // two seats on it: halves; along z when it is deeper than wide
        bench.seats = 2;
        assert_eq!(place_offset(&bench, 0), Some([-375, 0]));
        bench.footprint = [8, 24];
        assert_eq!(place_offset(&bench, 1), Some([0, 375]));
        // a forged count is bounded by the length and the cap
        bench.seats = 200;
        assert_eq!(places(&bench), 3);
        bench.footprint = [192, 8];
        assert_eq!(places(&bench), MAX_OBJECT_PLACES);
        // a tiny object still seats one; workstations, desk-top and
        // ceiling designs offer none
        let mut tiny = summary(2, 2);
        tiny.seats = 4;
        assert_eq!(places(&tiny), 1);
        tiny.workstation = true;
        assert_eq!(places(&tiny), 0);
        tiny.workstation = false;
        tiny.mount = Mount::Surface;
        assert_eq!(places(&tiny), 0);
        assert_eq!(places(&summary(8, 8)), 0, "no seats");
    }

    #[test]
    fn seats_turn_like_desk_chairs() {
        let p = PosMm::new(13_000, 2_500);
        for rot in 0..4 {
            assert_eq!(
                seat_of(p, rot, [0, crate::equipment::SEAT_OFFSET_MM]),
                crate::equipment::seat_pos(p, rot)
            );
        }
        assert_eq!(turn_offset([100, 40], 1), [-40, 100]);
        assert_eq!(turn_offset([100, 40], 2), [-100, -40]);
        assert_eq!(turn_offset([100, 40], 3), [40, -100]);
    }

    #[test]
    fn mount_reads_the_kits_names() {
        let m: Mount = serde_json::from_str("\"floor\"").unwrap();
        assert_eq!(m, Mount::Floor);
        let m: Mount = serde_json::from_str("\"Ceiling\"").unwrap();
        assert_eq!(m, Mount::Ceiling);
        assert_eq!(
            serde_json::to_string(&Mount::Surface).unwrap(),
            "\"Surface\""
        );
    }
}
