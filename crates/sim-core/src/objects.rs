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
//! **Capabilities do not change staff behaviour yet.** Staff still look for
//! equipment kinds (a `Desk` to work at, the meeting room's table, the
//! kitchen); an object's seats, workstation, lights, storage and screens are
//! recorded and totalled per room ([`room_capabilities`], shown by the UI)
//! but nobody sits at, works at or is lit by an object until the equipment
//! kinds become capability tags (K-4's second half).
//!
//! # Placement
//!
//! - Only [`Mount::Floor`] designs are placed; `Surface` and `Ceiling` are
//!   `NotSupported` until objects can sit on other objects or hang.
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
//!   over. Items without floor space (desk attachments, ceiling lights) are
//!   ignored. The same rule keeps new equipment off objects
//!   (`PlaceEquipment`, `MoveEquipment`, the office designer's builds).
//! - Objects count towards the room's item limit
//!   (`equipment::MAX_ITEMS_PER_ROOM`), as equipment counts towards theirs.

use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};

use crate::building::{Building, WALL_HALF_MM};
use crate::equipment::{EquipmentKind, MAX_ITEMS_PER_ROOM};
use crate::geom::{PosMm, Side, Tile, TileRect, TILE_MM};
use crate::ids::{ObjectId, RoomId};
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
}

impl PlacedObject {
    pub fn rect(&self) -> Rect {
        object_rect(&self.summary, self.pos, self.rot)
    }
}

/// Capabilities of a room's objects, totalled.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ObjectCapabilities {
    pub seats: u32,
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
/// design; see the module docs).
pub fn check_summary(s: &ObjectSummary) -> Result<(), Reject> {
    if s.mount != Mount::Floor {
        return Err(Reject::NotSupported(
            "only floor designs can be placed for now",
        ));
    }
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
    if kind.desk_slot().is_some() || kind == EquipmentKind::CeilingLight {
        return false;
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
        .any(|o| rects.iter().any(|r| r.overlaps(&o.rect())))
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

/// Whether a design with `summary` may stand at `pos` turned `rot` in `b`,
/// ignoring the object `except` (the one being moved). Returns its room.
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
    if door_tiles(b, &room.rect)
        .into_iter()
        .any(|t| Rect::of_tile(t).overlaps(&fp))
    {
        return Err(Reject::Invalid("the object would block a door"));
    }
    if equipment_rects(b, room_id).any(|r| r.overlaps(&fp)) {
        return Err(Reject::Overlap);
    }
    if b.objects
        .values()
        .any(|o| Some(o.id) != except && o.room == room_id && o.rect().overlaps(&fp))
    {
        return Err(Reject::Overlap);
    }
    let moving_within = except
        .and_then(|id| b.objects.get(&id))
        .is_some_and(|o| o.room == room_id);
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
        c.workstations += u32::from(s.workstation);
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
        assert!(matches!(check_summary(&s), Err(Reject::NotSupported(_))));
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
