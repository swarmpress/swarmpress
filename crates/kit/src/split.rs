//! The brick splitter, ported from the prototype
//! (`docs/reference/brick-office/prototype.html`, "DECOMPOSE VOXELS INTO
//! BRICKS").
//!
//! Cells of brick material are split into standard bricks (3 plates), plates
//! and tiles, scanning `y`, then `z`, then `x`. At each unused cell the
//! largest candidate (by volume) that fits cells of the same material,
//! colour and object wins; among equal volumes the one oriented for this
//! course (long side along x on even plates, along z on odd plates) wins.
//! On odd brick courses a run's first brick is at most 4 studs long, so
//! joints overlap like real brickwork. The scan order is deterministic and
//! is also the order bricks are placed in a construction animation.
//!
//! Studs are drawn only on visible top faces: a studded part's top cell gets
//! a stud when the cell above is empty or outside the grid.

use crate::catalogue::PartKind;
use crate::grid::{Grid, Mat};

/// Brick footprints (`[w, d]`), the prototype's `BR`.
pub const BRICKS: [(u32, u32); 11] = [
    (1, 1),
    (1, 2),
    (1, 3),
    (1, 4),
    (1, 6),
    (1, 8),
    (2, 2),
    (2, 3),
    (2, 4),
    (2, 6),
    (2, 8),
];
/// Plates add these to the brick footprints (the prototype's `PLT`).
pub const PLATES_EXTRA: [(u32, u32); 6] = [(4, 4), (4, 6), (4, 8), (6, 6), (6, 8), (8, 8)];
/// Tile footprints, the prototype's `TL`.
pub const TILES: [(u32, u32); 9] = [
    (1, 1),
    (1, 2),
    (1, 3),
    (1, 4),
    (1, 6),
    (1, 8),
    (2, 2),
    (2, 3),
    (2, 4),
];

/// The standard sizes the splitter needs, per kind.
pub fn standard_sizes() -> Vec<(PartKind, Vec<(u32, u32)>)> {
    vec![
        (PartKind::Brick, BRICKS.to_vec()),
        (PartKind::Plate, plates()),
        (PartKind::Tile, TILES.to_vec()),
    ]
}

fn plates() -> Vec<(u32, u32)> {
    BRICKS.iter().chain(PLATES_EXTRA.iter()).copied().collect()
}

/// The prototype's `mk`: both orientations of each footprint, at height `h`.
fn orientations(list: &[(u32, u32)], h: u32) -> Vec<(u32, u32, u32)> {
    let mut out = Vec::new();
    for &(a, b) in list {
        out.push((a, b, h));
        if a != b {
            out.push((b, a, h));
        }
    }
    out
}

fn by_volume_desc(mut v: Vec<(u32, u32, u32)>) -> Vec<(u32, u32, u32)> {
    // Stable, like the prototype's Array.prototype.sort.
    v.sort_by_key(|c| std::cmp::Reverse(c.0 * c.1 * c.2));
    v
}

/// Candidate lists `(x-extent, z-extent, height)`, largest volume first.
pub struct Candidates {
    pub studded: Vec<(u32, u32, u32)>,
    pub plates: Vec<(u32, u32, u32)>,
    pub tiles: Vec<(u32, u32, u32)>,
}

impl Candidates {
    pub fn new() -> Candidates {
        let mut studded = orientations(&BRICKS, 3);
        studded.extend(orientations(&plates(), 1));
        Candidates {
            studded: by_volume_desc(studded),
            plates: by_volume_desc(orientations(&plates(), 1)),
            tiles: by_volume_desc(orientations(&TILES, 1)),
        }
    }
}

impl Default for Candidates {
    fn default() -> Self {
        Candidates::new()
    }
}

/// One standard part from the splitter.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Piece {
    pub x: u32,
    pub y: u32,
    pub z: u32,
    /// Extent along x (studs).
    pub fx: u32,
    /// Extent along z (studs).
    pub fz: u32,
    /// Height (plates).
    pub h: u32,
    pub mat: Mat,
    pub colour: u8,
    pub object: u16,
    /// Owner (op reference) of the first cell, for issues.
    pub owner: u32,
}

impl Piece {
    /// The standard part kind of this piece.
    pub fn kind(&self) -> PartKind {
        match (self.mat, self.h) {
            (Mat::Tile, _) => PartKind::Tile,
            (_, 3) => PartKind::Brick,
            _ => PartKind::Plate,
        }
    }

    /// Quarter turn of the catalogue part (`[w, d]` with `w <= d` at turn 0).
    pub fn turn(&self) -> u8 {
        u8::from(self.fx > self.fz)
    }
}

/// Split every brick-material cell of `grid` into standard parts.
pub fn split(grid: &Grid, cands: &Candidates) -> Vec<Piece> {
    let (w, d, h) = (grid.w, grid.d, grid.h);
    let mut used = vec![false; grid.cells.len()];
    let mut out = Vec::new();
    for y in 0..h {
        for z in 0..d {
            for x in 0..w {
                let i = grid.idx(x, y, z);
                let cell = grid.cells[i];
                if !cell.mat.is_split() || used[i] {
                    continue;
                }
                let same = |j: usize| {
                    let o = grid.cells[j];
                    o.mat == cell.mat && o.colour == cell.colour && o.object == cell.object
                };
                let par = (y / 3) % 2 == 1;
                let sx = x == 0 || !same(grid.idx(x - 1, y, z));
                let sz = z == 0 || !same(grid.idx(x, y, z - 1));
                let list = match cell.mat {
                    Mat::Brick => &cands.studded,
                    Mat::Plate => &cands.plates,
                    _ => &cands.tiles,
                };
                let mut best: Option<(u32, u32, u32)> = None;
                let (mut bv, mut bp) = (0, 0);
                for &(cx, cz, ch) in list {
                    let vv = cx * cz * ch;
                    if best.is_some() && vv < bv {
                        break;
                    }
                    if par && ((sx && cx > 4) || (sz && cz > 4)) {
                        continue;
                    }
                    if x + cx > w || z + cz > d || y + ch > h {
                        continue;
                    }
                    let fits = (0..ch).all(|dy| {
                        (0..cx).all(|a| {
                            (0..cz).all(|b| {
                                let j = grid.idx(x + a, y + dy, z + b);
                                same(j) && !used[j]
                            })
                        })
                    });
                    if !fits {
                        continue;
                    }
                    let pref = u8::from((y % 2 == 0) == (cx >= cz));
                    if best.is_none() || pref > bp {
                        best = Some((cx, cz, ch));
                        bv = vv;
                        bp = pref;
                    }
                }
                // A 1 × 1 always fits its own cell.
                let (cx, cz, ch) = best.unwrap_or((1, 1, 1));
                for dy in 0..ch {
                    for a in 0..cx {
                        for b in 0..cz {
                            used[grid.idx(x + a, y + dy, z + b)] = true;
                        }
                    }
                }
                out.push(Piece {
                    x,
                    y,
                    z,
                    fx: cx,
                    fz: cz,
                    h: ch,
                    mat: cell.mat,
                    colour: cell.colour,
                    object: cell.object,
                    owner: cell.owner,
                });
            }
        }
    }
    out
}

/// Whether the top face of cell column `(x, z)` at height `top` is visible:
/// the cell above is empty or outside the grid.
#[inline]
pub fn top_visible(grid: &Grid, x: u32, top: u32, z: u32) -> bool {
    top >= grid.h || grid.at(x, top, z).is_empty()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::grid::Cell;

    #[test]
    fn candidate_order_matches_the_prototype() {
        let c = Candidates::new();
        // 8×8 plates (volume 64) first, then the 48s: bricks before plates (stable sort).
        assert_eq!(c.studded[0], (8, 8, 1));
        assert_eq!(
            &c.studded[1..5],
            &[(2, 8, 3), (8, 2, 3), (6, 8, 1), (8, 6, 1)]
        );
        assert_eq!(&c.tiles[..4], &[(1, 8, 1), (8, 1, 1), (2, 4, 1), (4, 2, 1)]);
        assert_eq!(*c.studded.last().unwrap(), (1, 1, 1));
        // 11 brick footprints (2 square) and 17 plate footprints (5 square), both ways round.
        assert_eq!(c.studded.len(), (2 * 11 - 2) + (2 * 17 - 5));
    }

    #[test]
    fn a_wall_staggers_its_joints() {
        // A 1-stud-thick wall 16 long and 6 plates (2 courses) high.
        let mut g = Grid::new(16, 1, 6);
        g.cells.fill(Cell {
            mat: Mat::Brick,
            colour: 1,
            object: 0,
            owner: 0,
        });
        let p = split(&g, &Candidates::new());
        let course = |y| {
            p.iter()
                .filter(|b| b.y == y)
                .map(|b| b.fx)
                .collect::<Vec<_>>()
        };
        assert_eq!(course(0), vec![8, 8]);
        // Odd course: the run starts with at most 4 studs, so the joints overlap.
        assert_eq!(course(3), vec![4, 8, 4]);
        assert!(p.iter().all(|b| b.h == 3));
    }
}
