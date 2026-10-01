//! Grid geometry. 1 tile = 1 m = 1000 mm. x grows east, z grows south.
//! Walls are thin and lie on tile boundaries; doors are one tile wide.

use serde::{Deserialize, Serialize};

/// Millimetres per tile.
pub const TILE_MM: i32 = 1000;
/// Half a tile in millimetres.
pub const HALF_TILE_MM: i32 = TILE_MM / 2;

/// A grid cell.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct Tile {
    pub x: i32,
    pub z: i32,
}

impl Tile {
    pub const fn new(x: i32, z: i32) -> Tile {
        Tile { x, z }
    }

    /// Centre of the tile in millimetres.
    pub const fn center(self) -> PosMm {
        PosMm {
            x: self.x * TILE_MM + HALF_TILE_MM,
            z: self.z * TILE_MM + HALF_TILE_MM,
        }
    }

    /// The 4-adjacent tile on `side`.
    pub const fn neighbour(self, side: Side) -> Tile {
        let (dx, dz) = side.delta();
        Tile {
            x: self.x + dx,
            z: self.z + dz,
        }
    }
}

/// A position in millimetres.
#[derive(
    Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize,
)]
pub struct PosMm {
    pub x: i32,
    pub z: i32,
}

impl PosMm {
    pub const fn new(x: i32, z: i32) -> PosMm {
        PosMm { x, z }
    }

    /// Tile containing this point (boundaries belong to the tile east/south).
    pub const fn tile(self) -> Tile {
        Tile {
            x: self.x.div_euclid(TILE_MM),
            z: self.z.div_euclid(TILE_MM),
        }
    }

    /// Manhattan distance in millimetres.
    pub fn manhattan(self, other: PosMm) -> i64 {
        i64::from(self.x.abs_diff(other.x)) + i64::from(self.z.abs_diff(other.z))
    }

    /// Chebyshev distance in millimetres.
    pub fn chebyshev(self, other: PosMm) -> i32 {
        let dx = self.x.abs_diff(other.x);
        let dz = self.z.abs_diff(other.z);
        i32::try_from(dx.max(dz)).unwrap_or(i32::MAX)
    }
}

/// Compass side. North is −z, east is +x.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum Side {
    North,
    East,
    South,
    West,
}

impl Side {
    pub const ALL: [Side; 4] = [Side::North, Side::East, Side::South, Side::West];

    /// Tile delta when stepping through this side.
    pub const fn delta(self) -> (i32, i32) {
        match self {
            Side::North => (0, -1),
            Side::East => (1, 0),
            Side::South => (0, 1),
            Side::West => (-1, 0),
        }
    }

    pub const fn opposite(self) -> Side {
        match self {
            Side::North => Side::South,
            Side::East => Side::West,
            Side::South => Side::North,
            Side::West => Side::East,
        }
    }

    pub const fn index(self) -> usize {
        match self {
            Side::North => 0,
            Side::East => 1,
            Side::South => 2,
            Side::West => 3,
        }
    }

    /// Lower-case name used at the JSON boundary.
    pub const fn slug(self) -> &'static str {
        match self {
            Side::North => "north",
            Side::East => "east",
            Side::South => "south",
            Side::West => "west",
        }
    }
}

/// Axis-aligned rectangle of tiles; `x..x+w`, `z..z+d` (end exclusive).
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct TileRect {
    pub x: i32,
    pub z: i32,
    pub w: i32,
    pub d: i32,
}

impl TileRect {
    pub const fn new(x: i32, z: i32, w: i32, d: i32) -> TileRect {
        TileRect { x, z, w, d }
    }

    pub const fn x_end(&self) -> i32 {
        self.x + self.w
    }

    pub const fn z_end(&self) -> i32 {
        self.z + self.d
    }

    pub const fn contains(&self, t: Tile) -> bool {
        t.x >= self.x && t.x < self.x_end() && t.z >= self.z && t.z < self.z_end()
    }

    pub const fn contains_rect(&self, o: &TileRect) -> bool {
        o.x >= self.x && o.z >= self.z && o.x_end() <= self.x_end() && o.z_end() <= self.z_end()
    }

    pub const fn intersects(&self, o: &TileRect) -> bool {
        self.x < o.x_end() && o.x < self.x_end() && self.z < o.z_end() && o.z < self.z_end()
    }

    pub fn area(&self) -> i64 {
        i64::from(self.w) * i64::from(self.d)
    }

    /// Length of a side in tiles.
    pub const fn side_len(&self, side: Side) -> i32 {
        match side {
            Side::North | Side::South => self.w,
            Side::East | Side::West => self.d,
        }
    }

    /// The tile inside the rect that touches `side` at offset `at` (tiles,
    /// measured from the rect's west end for north/south and north end for
    /// east/west).
    pub const fn side_tile(&self, side: Side, at: i32) -> Tile {
        match side {
            Side::North => Tile::new(self.x + at, self.z),
            Side::South => Tile::new(self.x + at, self.z_end() - 1),
            Side::West => Tile::new(self.x, self.z + at),
            Side::East => Tile::new(self.x_end() - 1, self.z + at),
        }
    }

    /// Whether this rect's `side` lies on the same side of `outer`'s boundary.
    pub const fn side_on_boundary_of(&self, outer: &TileRect, side: Side) -> bool {
        match side {
            Side::North => self.z == outer.z,
            Side::South => self.z_end() == outer.z_end(),
            Side::West => self.x == outer.x,
            Side::East => self.x_end() == outer.x_end(),
        }
    }

    pub const fn expanded(&self, n: i32) -> TileRect {
        TileRect {
            x: self.x - n,
            z: self.z - n,
            w: self.w + 2 * n,
            d: self.d + 2 * n,
        }
    }

    /// Whether a millimetre point lies inside the rect shrunk by `inset_mm`.
    pub const fn contains_pos_inset(&self, p: PosMm, inset_mm: i32) -> bool {
        p.x >= self.x * TILE_MM + inset_mm
            && p.x <= self.x_end() * TILE_MM - inset_mm
            && p.z >= self.z * TILE_MM + inset_mm
            && p.z <= self.z_end() * TILE_MM - inset_mm
    }

    /// Centre of the rect in millimetres.
    pub const fn center_mm(&self) -> PosMm {
        PosMm {
            x: self.x * TILE_MM + self.w * HALF_TILE_MM,
            z: self.z * TILE_MM + self.d * HALF_TILE_MM,
        }
    }

    /// Tiles in row-major order (z, then x).
    pub fn tiles(&self) -> impl Iterator<Item = Tile> + '_ {
        (self.z..self.z_end())
            .flat_map(move |z| (self.x..self.x_end()).map(move |x| Tile::new(x, z)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tile_of_position_floors_towards_negative() {
        assert_eq!(PosMm::new(0, 0).tile(), Tile::new(0, 0));
        assert_eq!(PosMm::new(999, 1000).tile(), Tile::new(0, 1));
        assert_eq!(PosMm::new(-1, -1000).tile(), Tile::new(-1, -1));
        assert_eq!(Tile::new(2, 3).center(), PosMm::new(2500, 3500));
    }

    #[test]
    fn rect_relations() {
        let a = TileRect::new(0, 0, 10, 10);
        let b = TileRect::new(10, 0, 6, 5);
        assert!(!a.intersects(&b));
        assert!(a.intersects(&TileRect::new(9, 9, 2, 2)));
        assert!(TileRect::new(0, 0, 16, 10).contains_rect(&b));
        assert_eq!(a.side_tile(Side::East, 2), Tile::new(9, 2));
        assert_eq!(b.side_tile(Side::West, 2), Tile::new(10, 2));
        assert_eq!(a.side_tile(Side::South, 4), Tile::new(4, 9));
        assert!(b.side_on_boundary_of(&TileRect::new(0, 0, 16, 10), Side::North));
        assert!(!b.side_on_boundary_of(&TileRect::new(0, 0, 16, 10), Side::South));
        assert_eq!(b.center_mm(), PosMm::new(13000, 2500));
        assert_eq!(TileRect::new(1, 1, 2, 2).tiles().count(), 4);
    }

    #[test]
    fn sides_round_trip() {
        for s in Side::ALL {
            assert_eq!(s.opposite().opposite(), s);
            let t = Tile::new(3, 3);
            assert_eq!(t.neighbour(s).neighbour(s.opposite()), t);
        }
    }
}
