//! The voxel grid a design is expanded into: one cell per stud × stud × plate,
//! holding a material, a colour, the object it belongs to and who wrote it.

/// What fills a cell. `Brick`, `Plate` and `Tile` are brick material the
/// splitter turns into standard parts; `Part` cells belong to a placed part.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[repr(u8)]
pub enum Mat {
    #[default]
    Empty = 0,
    Brick = 1,
    Plate = 2,
    Tile = 3,
    Part = 4,
}

impl Mat {
    pub fn is_split(self) -> bool {
        matches!(self, Mat::Brick | Mat::Plate | Mat::Tile)
    }
}

/// Owner tag bit: the owner is a placed part index, not an op reference.
pub const PART_BIT: u32 = 1 << 31;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Cell {
    pub mat: Mat,
    /// Palette index (meaningless when empty).
    pub colour: u8,
    pub object: u16,
    /// Op reference of the write, or `PART_BIT | part index`.
    pub owner: u32,
}

impl Cell {
    pub fn is_empty(&self) -> bool {
        self.mat == Mat::Empty
    }
}

/// A dense grid `w × d × h` (x, z, y), indexed y-major like the prototype.
#[derive(Clone, Debug)]
pub struct Grid {
    pub w: u32,
    pub d: u32,
    pub h: u32,
    pub cells: Vec<Cell>,
}

impl Grid {
    pub fn new(w: u32, d: u32, h: u32) -> Grid {
        let n = (w as usize) * (d as usize) * (h as usize);
        Grid {
            w,
            d,
            h,
            cells: vec![Cell::default(); n],
        }
    }

    #[inline]
    pub fn idx(&self, x: u32, y: u32, z: u32) -> usize {
        ((y as usize) * (self.d as usize) + (z as usize)) * (self.w as usize) + (x as usize)
    }

    #[inline]
    pub fn at(&self, x: u32, y: u32, z: u32) -> Cell {
        self.cells[self.idx(x, y, z)]
    }

    /// The cell coordinates of an index.
    #[inline]
    pub fn coords(&self, i: usize) -> (u32, u32, u32) {
        let w = self.w as usize;
        let d = self.d as usize;
        let x = i % w;
        let z = (i / w) % d;
        let y = i / (w * d);
        (
            u32::try_from(x).unwrap_or(0),
            u32::try_from(y).unwrap_or(0),
            u32::try_from(z).unwrap_or(0),
        )
    }

    /// Whether `(x, y, z)` (possibly out of range) is an occupied cell.
    pub fn occupied(&self, x: i64, y: i64, z: i64) -> bool {
        x >= 0
            && y >= 0
            && z >= 0
            && x < i64::from(self.w)
            && y < i64::from(self.h)
            && z < i64::from(self.d)
            && !self.cells[self.idx(x as u32, y as u32, z as u32)].is_empty()
    }
}
