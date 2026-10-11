//! The town around the office (ADR-0086 decision 4, amended by ADR-0087
//! decision 4): the sections' houses (Plan, Building, Factory, Projects) and
//! the town's furniture (trees, street lamps, benches) as company state.
//!
//! The town is seeded at founding with the generic arrangement the renderer
//! used to compute (`apps/game/src/render/bricks/town.ts`, `townSpots` and
//! `townScenery`): the houses in a row on the side opposite the entrance,
//! their fronts to the office, lamps between and at the ends of the row,
//! benches in front of the houses, trees past the row's ends and along the
//! lot's two other sides. Everything is in integer millimetres; the
//! renderer's metres convert exactly.
//!
//! The player then moves any item, and places or removes trees, lamps and
//! benches. Every item lies outside the lot, inside the town plot (the lot
//! grown by [`TOWN_MARGIN_MM`] on each side), off the street in front of the
//! entrance, and clear of every other item. Footprints are axis-aligned
//! rectangles turned by quarter turns; touching is allowed, overlapping is not.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::building::{Building, Entrance, SPAWN_DISTANCE};
use crate::geom::{PosMm, Side, TileRect, HALF_TILE_MM, TILE_MM};
use crate::ids::TownItemId;
use crate::validate::{Reject, MAX_COORD_MM};

/// How far the town reaches past the lot on every side, mm (the renderer's
/// baseplate margin).
pub const TOWN_MARGIN_MM: i32 = 16_000;
/// Most items in the town.
pub const MAX_TOWN_ITEMS: usize = 64;
/// A section's house footprint at turn 0, mm (`town.ts` `HOUSE_W`, `HOUSE_D`).
pub const HOUSE_W_MM: i32 = 5_000;
pub const HOUSE_D_MM: i32 = 4_000;
/// The houses' distance from the lot, mm (`town.ts` `GAP`).
pub const GAP_MM: i32 = 2_500;
/// Labour for moving a piece of equipment or furniture, percent of its price.
pub const MOVE_LABOUR_PCT: i64 = 10;
/// Labour for moving a section's house, cents.
pub const HOUSE_MOVE_CENTS: i64 = 50_000;

/// What a town item is. Serde names are the variant names.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum TownKind {
    PlanHouse,
    BuildingHouse,
    FactoryHouse,
    ProjectsHouse,
    Tree,
    StreetLamp,
    Bench,
}

impl TownKind {
    pub const ALL: [TownKind; 7] = [
        TownKind::PlanHouse,
        TownKind::BuildingHouse,
        TownKind::FactoryHouse,
        TownKind::ProjectsHouse,
        TownKind::Tree,
        TownKind::StreetLamp,
        TownKind::Bench,
    ];

    /// The sections' houses, in the row's order.
    pub const HOUSES: [TownKind; 4] = [
        TownKind::PlanHouse,
        TownKind::BuildingHouse,
        TownKind::FactoryHouse,
        TownKind::ProjectsHouse,
    ];

    /// A section's house: it can move, but is never placed or removed.
    pub const fn is_house(self) -> bool {
        matches!(
            self,
            TownKind::PlanHouse
                | TownKind::BuildingHouse
                | TownKind::FactoryHouse
                | TownKind::ProjectsHouse
        )
    }

    /// Footprint (width along x, depth along z) at turn 0, mm.
    pub const fn size_mm(self) -> (i32, i32) {
        match self {
            TownKind::PlanHouse
            | TownKind::BuildingHouse
            | TownKind::FactoryHouse
            | TownKind::ProjectsHouse => (HOUSE_W_MM, HOUSE_D_MM),
            TownKind::Tree => (1_500, 1_500),
            TownKind::StreetLamp => (250, 250),
            TownKind::Bench => (1_000, 375),
        }
    }

    /// Price of placing one in an economic company, cents (0 for houses,
    /// which cannot be placed).
    pub const fn price(self) -> i64 {
        match self {
            TownKind::Tree => 15_000,
            TownKind::StreetLamp => 25_000,
            TownKind::Bench => 20_000,
            TownKind::PlanHouse
            | TownKind::BuildingHouse
            | TownKind::FactoryHouse
            | TownKind::ProjectsHouse => 0,
        }
    }

    /// Labour for moving one in an economic company, cents.
    pub const fn move_cost(self) -> i64 {
        if self.is_house() {
            HOUSE_MOVE_CENTS
        } else {
            self.price() * MOVE_LABOUR_PCT / 100
        }
    }
}

/// One piece of the town.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TownItem {
    pub id: TownItemId,
    pub kind: TownKind,
    /// Footprint centre.
    pub pos: PosMm,
    /// Quarter turns clockwise seen from above, 0..=3 (the convention of
    /// equipment's `rot`; a house's front faces +z at 0).
    pub rot: u8,
}

/// An axis-aligned rectangle in **half** millimetres (doubled coordinates,
/// so odd sizes such as a bench's 375 mm stay exact). Ends exclusive.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Footprint {
    pub x0: i64,
    pub z0: i64,
    pub x1: i64,
    pub z1: i64,
}

impl Footprint {
    /// Interiors intersect (touching edges do not count).
    pub const fn overlaps(&self, o: &Footprint) -> bool {
        self.x0 < o.x1 && o.x0 < self.x1 && self.z0 < o.z1 && o.z0 < self.z1
    }

    pub const fn contains(&self, o: &Footprint) -> bool {
        o.x0 >= self.x0 && o.z0 >= self.z0 && o.x1 <= self.x1 && o.z1 <= self.z1
    }

    /// A rect given in millimetres.
    pub const fn from_mm(x: i64, z: i64, w: i64, d: i64) -> Footprint {
        Footprint {
            x0: 2 * x,
            z0: 2 * z,
            x1: 2 * (x + w),
            z1: 2 * (z + d),
        }
    }

    /// A tile rect grown by `margin_mm` on every side.
    pub fn of_tiles(r: &TileRect, margin_mm: i32) -> Footprint {
        let t = i64::from(TILE_MM);
        let m = i64::from(margin_mm);
        Footprint::from_mm(
            i64::from(r.x) * t - m,
            i64::from(r.z) * t - m,
            i64::from(r.w) * t + 2 * m,
            i64::from(r.d) * t + 2 * m,
        )
    }
}

/// The footprint of a `kind` centred at `pos`, turned `rot` quarter turns.
pub fn footprint(kind: TownKind, pos: PosMm, rot: u8) -> Footprint {
    let (w, d) = kind.size_mm();
    let (w, d) = if rot & 1 == 0 { (w, d) } else { (d, w) };
    let (x, z) = (2 * i64::from(pos.x), 2 * i64::from(pos.z));
    Footprint {
        x0: x - i64::from(w),
        z0: z - i64::from(d),
        x1: x + i64::from(w),
        z1: z + i64::from(d),
    }
}

impl TownItem {
    pub fn footprint(&self) -> Footprint {
        footprint(self.kind, self.pos, self.rot)
    }
}

/// How far the street reaches out from the entrance's side, mm: the
/// renderer's `groundRects` (`office.ts`): the distance from the entrance
/// door to the spawn point plus a metre, at least two, rounded up to whole
/// metres.
pub const fn street_depth_mm() -> i32 {
    let door_to_spawn = SPAWN_DISTANCE * TILE_MM - HALF_TILE_MM;
    let reach = if door_to_spawn + 1_000 > 2_000 {
        door_to_spawn + 1_000
    } else {
        2_000
    };
    (reach + TILE_MM - 1) / TILE_MM * TILE_MM
}

/// The street in front of the entrance (`office.ts` `groundRects`, the
/// `street` rect): along the whole entrance side and two metres past each
/// corner, [`street_depth_mm`] deep.
pub fn street(lot: &TileRect, entrance: &Entrance) -> Footprint {
    let t = i64::from(TILE_MM);
    let (ox, oz) = (i64::from(lot.x) * t, i64::from(lot.z) * t);
    let (w, d) = (i64::from(lot.w) * t, i64::from(lot.d) * t);
    let out = i64::from(street_depth_mm());
    match entrance.side {
        Side::North => Footprint::from_mm(ox - 2_000, oz - out, w + 4_000, out),
        Side::South => Footprint::from_mm(ox - 2_000, oz + d, w + 4_000, out),
        Side::West => Footprint::from_mm(ox - out, oz - 2_000, out, d + 4_000),
        Side::East => Footprint::from_mm(ox + w, oz - 2_000, out, d + 4_000),
    }
}

/// The turn that points a house's front (+z at turn 0) towards the lot from
/// a row on `side` (`town.ts` `FACING_LOT`).
pub const fn facing_lot(side: Side) -> u8 {
    match side {
        Side::North => 0,
        Side::South => 2,
        Side::West => 3,
        Side::East => 1,
    }
}

/// The founding arrangement: `(kind, pos, rot)` in id order (houses, lamps,
/// benches, trees), exactly `townSpots` + `townScenery` of `town.ts`.
pub fn seed_arrangement(lot: &TileRect, entrance: &Entrance) -> Vec<(TownKind, PosMm, u8)> {
    let side = entrance.side.opposite();
    let t = i64::from(TILE_MM);
    let (ox, oz) = (i64::from(lot.x) * t, i64::from(lot.z) * t);
    let (w, d) = (i64::from(lot.w) * t, i64::from(lot.d) * t);
    let along_x = matches!(side, Side::North | Side::South);
    let length = if along_x { w } else { d };
    let turn = facing_lot(side);
    let (hw, hd) = (i64::from(HOUSE_W_MM), i64::from(HOUSE_D_MM));
    let along = if turn & 1 == 0 { hw } else { hd };
    let across = if turn & 1 == 0 { hd } else { hw };
    let n = TownKind::HOUSES.len() as i64;
    let step = (along + 1_000).max(length / n);
    let start = (if along_x { ox } else { oz }) + (length - step * (n - 1) - along) / 2;
    // (u along the row, v away from the lot) → world position
    let at = |u: i64, v: i64| -> PosMm {
        let (x, z) = match side {
            Side::North => (u, oz - v),
            Side::South => (u, oz + d + v),
            Side::West => (ox - v, u),
            Side::East => (ox + w + v, u),
        };
        PosMm::new(
            i32::try_from(x).unwrap_or(i32::MAX),
            i32::try_from(z).unwrap_or(i32::MAX),
        )
    };
    let mut out = Vec::new();
    let us: Vec<i64> = (0..n).map(|i| start + i * step + along / 2).collect();
    for (kind, u) in TownKind::HOUSES.iter().zip(&us) {
        out.push((*kind, at(*u, i64::from(GAP_MM) + across / 2), turn));
    }
    // a street lamp at the row's ends and between every two houses
    let half = step / 2;
    let first = us[0];
    let last = us[us.len() - 1];
    out.push((TownKind::StreetLamp, at(first - half, 1_700), 0));
    for pair in us.windows(2) {
        out.push((TownKind::StreetLamp, at((pair[0] + pair[1]) / 2, 1_700), 0));
    }
    out.push((TownKind::StreetLamp, at(last + half, 1_700), 0));
    // a bench in front of each house, looking at the office
    for u in &us {
        out.push((TownKind::Bench, at(u + 1_700, 1_100), turn));
    }
    // trees past the row's ends, then along the lot's two other sides
    let mut trees: Vec<(i64, i64)> = Vec::new();
    let reach = along / 2 + 2_200;
    trees.push((first - reach - 800, 4_500));
    trees.push((last + reach + 800, 4_500));
    let across_lot = if along_x { d } else { w };
    let lo = if along_x { ox } else { oz };
    let hi = if along_x { ox + w } else { oz + d };
    for (num, den) in [(1, 5), (11, 20)] {
        let v = -across_lot * num / den;
        trees.push((lo - 2_200, v));
        trees.push((hi + 2_200, v));
    }
    for (i, (u, v)) in trees.into_iter().enumerate() {
        out.push((TownKind::Tree, at(u, v), (i % 4) as u8));
    }
    out
}

/// Whether `kind` may stand at `pos` turned `rot` in `b`'s town, ignoring
/// the item `except` (the one being moved).
pub fn check_spot(
    b: &Building,
    kind: TownKind,
    pos: PosMm,
    rot: u8,
    except: Option<TownItemId>,
) -> Result<(), Reject> {
    if rot > 3 {
        return Err(Reject::Invalid("rotation is 0..=3 quarter turns"));
    }
    if pos.x.abs() > MAX_COORD_MM || pos.z.abs() > MAX_COORD_MM {
        return Err(Reject::Invalid("outside the town"));
    }
    let fp = footprint(kind, pos, rot);
    if fp.overlaps(&Footprint::of_tiles(&b.lot, 0)) {
        return Err(Reject::Invalid("the town stands outside the office's lot"));
    }
    if !Footprint::of_tiles(&b.lot, TOWN_MARGIN_MM).contains(&fp) {
        return Err(Reject::Invalid("outside the town"));
    }
    if fp.overlaps(&street(&b.lot, &b.entrance)) {
        return Err(Reject::Invalid(
            "that is the street in front of the entrance",
        ));
    }
    if b.town
        .values()
        .any(|o| Some(o.id) != except && o.footprint().overlaps(&fp))
    {
        return Err(Reject::Overlap);
    }
    Ok(())
}

/// The town after the lot grows by `tiles` on `side` (`BuyFloorSpace`): every
/// item whose centre lies on or past the lot's old edge on that side moves
/// out with the edge, so the arrangement keeps its distance from the office.
/// Items moved the same way keep their mutual distances, and an item moved
/// away from one that stays can only get further from it.
pub fn after_growth(
    town: &BTreeMap<TownItemId, TownItem>,
    lot: &TileRect,
    side: Side,
    tiles: i32,
) -> BTreeMap<TownItemId, TownItem> {
    let by = tiles * TILE_MM;
    let mut out = town.clone();
    for item in out.values_mut() {
        let p = &mut item.pos;
        match side {
            Side::North if p.z <= lot.z * TILE_MM => p.z -= by,
            Side::South if p.z >= lot.z_end() * TILE_MM => p.z += by,
            Side::West if p.x <= lot.x * TILE_MM => p.x -= by,
            Side::East if p.x >= lot.x_end() * TILE_MM => p.x += by,
            _ => {}
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::geom::Tile;

    fn demo_lot() -> (TileRect, Entrance) {
        (
            TileRect::new(0, 0, 24, 16),
            Entrance {
                tile: Tile::new(10, 15),
                side: Side::South,
            },
        )
    }

    /// The demo office's town, worked out by hand from `town.ts` for a 24×16
    /// m lot at the origin with the entrance on the south side: the row is
    /// on the north side, step 6 m, the first house's centre at x = 3 m.
    #[test]
    fn seed_matches_the_renderers_arrangement_for_the_demo_lot() {
        let (lot, entrance) = demo_lot();
        let p = PosMm::new;
        use TownKind::*;
        assert_eq!(
            seed_arrangement(&lot, &entrance),
            vec![
                (PlanHouse, p(3_000, -4_500), 0),
                (BuildingHouse, p(9_000, -4_500), 0),
                (FactoryHouse, p(15_000, -4_500), 0),
                (ProjectsHouse, p(21_000, -4_500), 0),
                (StreetLamp, p(0, -1_700), 0),
                (StreetLamp, p(6_000, -1_700), 0),
                (StreetLamp, p(12_000, -1_700), 0),
                (StreetLamp, p(18_000, -1_700), 0),
                (StreetLamp, p(24_000, -1_700), 0),
                (Bench, p(4_700, -1_100), 0),
                (Bench, p(10_700, -1_100), 0),
                (Bench, p(16_700, -1_100), 0),
                (Bench, p(22_700, -1_100), 0),
                (Tree, p(-2_500, -4_500), 0),
                (Tree, p(26_500, -4_500), 1),
                (Tree, p(-2_200, 3_200), 2),
                (Tree, p(26_200, 3_200), 3),
                (Tree, p(-2_200, 8_800), 0),
                (Tree, p(26_200, 8_800), 1),
            ]
        );
    }

    #[test]
    fn seed_on_the_default_lot_and_on_the_other_sides() {
        // 16×10 lot, entrance south: step max(6, 4) = 6, start -3.5 m
        let lot = TileRect::new(0, 0, 16, 10);
        let south = Entrance {
            tile: Tile::new(4, 9),
            side: Side::South,
        };
        let s = seed_arrangement(&lot, &south);
        assert_eq!(s.len(), 19);
        assert_eq!(s[0], (TownKind::PlanHouse, PosMm::new(-1_000, -4_500), 0));
        assert_eq!(
            s[3],
            (TownKind::ProjectsHouse, PosMm::new(17_000, -4_500), 0)
        );
        assert_eq!(s[4], (TownKind::StreetLamp, PosMm::new(-4_000, -1_700), 0));
        // entrance east: the row on the west side, houses turned 3, 4 m along
        // z: step max(5, 2.5) = 5, start (10 - 15 - 4) / 2 = -4.5 m
        let east = Entrance {
            tile: Tile::new(15, 4),
            side: Side::East,
        };
        let s = seed_arrangement(&lot, &east);
        assert_eq!(s[0], (TownKind::PlanHouse, PosMm::new(-5_000, -2_500), 3));
        assert_eq!(
            s[1],
            (TownKind::BuildingHouse, PosMm::new(-5_000, 2_500), 3)
        );
        assert_eq!(s[9], (TownKind::Bench, PosMm::new(-1_100, -800), 3));
        // the side trees stand past the lot's north and south ends (z = -2.2 m
        // and 12.2 m), 16 × 0.2 = 3.2 m in from the row's side
        assert_eq!(s[15], (TownKind::Tree, PosMm::new(3_200, -2_200), 2));
        assert_eq!(s[16], (TownKind::Tree, PosMm::new(3_200, 12_200), 3));
    }

    #[test]
    fn every_seeded_item_is_a_valid_spot() {
        for (lot, entrance) in [
            demo_lot(),
            (
                TileRect::new(0, 0, 16, 10),
                Entrance {
                    tile: Tile::new(4, 9),
                    side: Side::South,
                },
            ),
            (
                TileRect::new(0, 0, 16, 10),
                Entrance {
                    tile: Tile::new(0, 4),
                    side: Side::West,
                },
            ),
            (
                TileRect::new(2, 3, 20, 12),
                Entrance {
                    tile: Tile::new(8, 3),
                    side: Side::North,
                },
            ),
        ] {
            let mut b = Building::new(lot, entrance);
            for (i, (kind, pos, rot)) in seed_arrangement(&lot, &entrance).into_iter().enumerate() {
                assert_eq!(
                    check_spot(&b, kind, pos, rot, None),
                    Ok(()),
                    "{kind:?} {pos:?}"
                );
                let id = TownItemId(u32::try_from(i).unwrap() + 1);
                b.town.insert(id, TownItem { id, kind, pos, rot });
            }
        }
    }

    #[test]
    fn footprints_turn_and_touching_is_not_overlapping() {
        let a = footprint(TownKind::Bench, PosMm::new(0, 0), 0);
        assert_eq!(
            a,
            Footprint {
                x0: -1_000,
                z0: -375,
                x1: 1_000,
                z1: 375
            }
        );
        let turned = footprint(TownKind::Bench, PosMm::new(0, 0), 1);
        assert_eq!((turned.x1, turned.z1), (375, 1_000));
        let next = footprint(TownKind::Bench, PosMm::new(1_000, 0), 0);
        assert!(!a.overlaps(&next));
        let close = footprint(TownKind::Bench, PosMm::new(999, 0), 0);
        assert!(a.overlaps(&close));
    }

    #[test]
    fn the_street_is_four_metres_deep() {
        assert_eq!(street_depth_mm(), 4_000);
        let (lot, entrance) = demo_lot();
        assert_eq!(
            street(&lot, &entrance),
            Footprint::from_mm(-2_000, 16_000, 28_000, 4_000)
        );
    }
}
