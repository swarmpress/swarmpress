//! Deterministic A* on the tile grid. Movement is 4-connected between tile
//! centres and crosses room boundaries only through doors. Paths are
//! axis-aligned polylines in millimetres, so their length is exact integer
//! Manhattan length and the renderer can interpolate them without drift.
//!
//! Determinism: the open set is a binary heap keyed by `(f, h, node index)`
//! and neighbours are expanded in the fixed order N, E, S, W. A small turn
//! penalty makes the chosen shortest path the one with fewest corners.

use std::cmp::Reverse;
use std::collections::BinaryHeap;

use serde::{Deserialize, Serialize};

use crate::building::{Building, Zone};
use crate::geom::{PosMm, Side, Tile, TileRect};

/// Cost of one tile step.
const STEP_COST: u32 = 10;
/// Extra cost for changing direction (keeps paths straight).
const TURN_COST: u32 = 1;
/// "No direction yet" marker for the start node.
const NO_DIR: usize = 4;
const DIR_STATES: usize = 5;

/// Walkability of the grid around a building: per cell, a bitmask of the
/// sides (bit = [`Side::index`]) one may step through.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NavGrid {
    pub bounds: TileRect,
    open: Vec<u8>,
}

impl NavGrid {
    pub fn build(b: &Building) -> NavGrid {
        let bounds = b.nav_bounds();
        let n = usize::try_from(bounds.area()).unwrap_or(0);
        let mut zones = vec![Zone::Street; n];
        let idx = |t: Tile| -> usize {
            usize::try_from((t.z - bounds.z) * bounds.w + (t.x - bounds.x)).unwrap_or(0)
        };
        for t in b.lot.tiles() {
            zones[idx(t)] = Zone::Hallway;
        }
        for r in b.rooms.values() {
            for t in r.rect.tiles() {
                if bounds.contains(t) {
                    zones[idx(t)] = Zone::Room(r.id);
                }
            }
        }
        let doors = b.door_edges();
        let mut open = vec![0u8; n];
        for t in bounds.tiles() {
            let i = idx(t);
            let mut mask = 0u8;
            for side in Side::ALL {
                let nb = t.neighbour(side);
                if !bounds.contains(nb) {
                    continue;
                }
                let same = zones[i] == zones[idx(nb)];
                if same || doors.contains(&crate::building::EdgeKey::of(t, side)) {
                    mask |= 1 << side.index();
                }
            }
            open[i] = mask;
        }
        NavGrid { bounds, open }
    }

    pub fn index(&self, t: Tile) -> Option<usize> {
        if self.bounds.contains(t) {
            usize::try_from((t.z - self.bounds.z) * self.bounds.w + (t.x - self.bounds.x)).ok()
        } else {
            None
        }
    }

    fn tile_of(&self, i: usize) -> Tile {
        let w = usize::try_from(self.bounds.w).unwrap_or(1).max(1);
        let x = i32::try_from(i % w).unwrap_or(0);
        let z = i32::try_from(i / w).unwrap_or(0);
        Tile::new(self.bounds.x + x, self.bounds.z + z)
    }

    pub fn can_move(&self, t: Tile, side: Side) -> bool {
        self.index(t)
            .is_some_and(|i| self.open[i] & (1 << side.index()) != 0)
    }

    /// Flood fill from `start`; `result[index(t)]` says whether `t` is reachable.
    pub fn reachable_from(&self, start: Tile) -> Vec<bool> {
        let mut seen = vec![false; self.open.len()];
        let Some(s) = self.index(start) else {
            return seen;
        };
        seen[s] = true;
        let mut stack = vec![s];
        while let Some(i) = stack.pop() {
            let t = self.tile_of(i);
            for side in Side::ALL {
                if self.open[i] & (1 << side.index()) == 0 {
                    continue;
                }
                if let Some(j) = self.index(t.neighbour(side)) {
                    if !seen[j] {
                        seen[j] = true;
                        stack.push(j);
                    }
                }
            }
        }
        seen
    }

    /// Shortest tile path from `from` to `to` inclusive, fewest turns among
    /// equals. `None` when unreachable or out of bounds.
    pub fn find_tile_path(&self, from: Tile, to: Tile) -> Option<Vec<Tile>> {
        let start = self.index(from)?;
        let goal = self.index(to)?;
        if start == goal {
            return Some(vec![from]);
        }
        let n = self.open.len() * DIR_STATES;
        let mut g = vec![u32::MAX; n];
        let mut came: Vec<Option<usize>> = vec![None; n];
        let mut closed = vec![false; n];
        let h = |i: usize| -> u32 {
            let t = self.tile_of(i);
            (t.x.abs_diff(to.x) + t.z.abs_diff(to.z)) * STEP_COST
        };
        let node = |cell: usize, dir: usize| cell * DIR_STATES + dir;
        let s = node(start, NO_DIR);
        g[s] = 0;
        let mut heap = BinaryHeap::new();
        heap.push(Reverse((h(start), h(start), s)));
        while let Some(Reverse((_, _, cur))) = heap.pop() {
            if closed[cur] {
                continue;
            }
            closed[cur] = true;
            let cell = cur / DIR_STATES;
            let dir = cur % DIR_STATES;
            if cell == goal {
                let mut cells = vec![cell];
                let mut at = cur;
                while let Some(prev) = came[at] {
                    cells.push(prev / DIR_STATES);
                    at = prev;
                }
                cells.reverse();
                return Some(cells.into_iter().map(|c| self.tile_of(c)).collect());
            }
            let t = self.tile_of(cell);
            for side in Side::ALL {
                if self.open[cell] & (1 << side.index()) == 0 {
                    continue;
                }
                let Some(nc) = self.index(t.neighbour(side)) else {
                    continue;
                };
                let nd = side.index();
                let next = node(nc, nd);
                if closed[next] {
                    continue;
                }
                let turn = if dir != NO_DIR && dir != nd {
                    TURN_COST
                } else {
                    0
                };
                let cost = g[cur] + STEP_COST + turn;
                if cost < g[next] {
                    g[next] = cost;
                    came[next] = Some(cur);
                    let hn = h(nc);
                    heap.push(Reverse((cost + hn, hn, next)));
                }
            }
        }
        None
    }
}

/// Plans a millimetre polyline from `from` to `to`: an L into the start tile's
/// centre, tile centres along the A* path (corners only), an L out to `to`.
pub fn plan_path(grid: &NavGrid, from: PosMm, to: PosMm) -> Option<Vec<PosMm>> {
    let tiles = grid.find_tile_path(from.tile(), to.tile())?;
    let mut pts = Vec::with_capacity(tiles.len() + 6);
    pts.push(from);
    let c0 = from.tile().center();
    pts.push(PosMm::new(c0.x, from.z));
    for t in &tiles {
        pts.push(t.center());
    }
    let c1 = to.tile().center();
    pts.push(PosMm::new(to.x, c1.z));
    pts.push(to);
    Some(simplify(pts))
}

/// Drops repeated points and middle points of collinear runs.
fn simplify(pts: Vec<PosMm>) -> Vec<PosMm> {
    let mut out: Vec<PosMm> = Vec::with_capacity(pts.len());
    for p in pts {
        if out.last() == Some(&p) {
            continue;
        }
        if out.len() >= 2 {
            let a = out[out.len() - 2];
            let b = out[out.len() - 1];
            if (a.x == b.x && b.x == p.x) || (a.z == b.z && b.z == p.z) {
                out.pop();
            }
        }
        out.push(p);
    }
    out
}

/// A walk in progress: axis-aligned waypoints traversed at a fixed speed from
/// `start_step`. Position at any step is a pure function of these fields,
/// which is exactly what the renderer interpolates.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Path {
    pub waypoints: Vec<PosMm>,
    pub start_step: u64,
    pub speed_mm_per_step: i32,
}

impl Path {
    pub fn new(waypoints: Vec<PosMm>, start_step: u64, speed_mm_per_step: i32) -> Path {
        Path {
            waypoints,
            start_step,
            speed_mm_per_step: speed_mm_per_step.max(1),
        }
    }

    pub fn length_mm(&self) -> i64 {
        self.waypoints
            .windows(2)
            .map(|w| w[0].manhattan(w[1]))
            .sum()
    }

    /// Step at which the walk ends.
    pub fn arrival_step(&self) -> u64 {
        let speed = i64::from(self.speed_mm_per_step);
        let steps = (self.length_mm() + speed - 1) / speed;
        self.start_step + u64::try_from(steps).unwrap_or(0)
    }

    pub fn destination(&self) -> Option<PosMm> {
        self.waypoints.last().copied()
    }

    /// Position at `step` and whether the walk is finished.
    pub fn sample(&self, step: u64) -> (PosMm, bool) {
        let Some(&first) = self.waypoints.first() else {
            return (PosMm::default(), true);
        };
        let elapsed = i64::try_from(step.saturating_sub(self.start_step)).unwrap_or(i64::MAX);
        let mut left = elapsed.saturating_mul(i64::from(self.speed_mm_per_step));
        let mut at = first;
        for w in self.waypoints.windows(2) {
            let seg = w[0].manhattan(w[1]);
            if left < seg {
                let k = i32::try_from(left).unwrap_or(0);
                let p = PosMm::new(
                    w[0].x + k * (w[1].x - w[0].x).signum(),
                    w[0].z + k * (w[1].z - w[0].z).signum(),
                );
                return (p, false);
            }
            left -= seg;
            at = w[1];
        }
        (at, true)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::building::{Door, Room, RoomKind};
    use crate::ids::RoomId;

    fn office() -> Building {
        let mut b = Building::default_lot();
        b.rooms.insert(
            RoomId(1),
            Room {
                id: RoomId(1),
                kind: RoomKind::Newsroom,
                rect: TileRect::new(0, 0, 10, 10),
                floor: 0,
                level: 1,
                doors: vec![Door {
                    side: Side::East,
                    at: 2,
                }],
                windows: vec![],
            },
        );
        b.rooms.insert(
            RoomId(2),
            Room {
                id: RoomId(2),
                kind: RoomKind::EditorOffice,
                rect: TileRect::new(10, 0, 6, 5),
                floor: 0,
                level: 1,
                doors: vec![],
                windows: vec![],
            },
        );
        b
    }

    #[test]
    fn path_goes_through_doors() {
        let b = office();
        let grid = b.nav_grid();
        let tiles = grid
            .find_tile_path(Tile::new(5, 5), Tile::new(13, 1))
            .unwrap();
        // must cross from (9,2) to (10,2)
        assert!(tiles
            .windows(2)
            .any(|w| w[0] == Tile::new(9, 2) && w[1] == Tile::new(10, 2)));
        // 4-connected
        for w in tiles.windows(2) {
            assert_eq!(w[0].x.abs_diff(w[1].x) + w[0].z.abs_diff(w[1].z), 1);
        }
        // shortest: manhattan via the door: |5-9|+|5-2| + 1 + |10-13|+|2-1| = 12 moves
        assert_eq!(tiles.len(), 13);
    }

    #[test]
    fn path_from_street_through_entrance() {
        let b = office();
        let grid = b.nav_grid();
        let pts = plan_path(&grid, b.spawn_pos(), PosMm::new(2_500, 3_750)).unwrap();
        assert_eq!(pts.first(), Some(&b.spawn_pos()));
        assert_eq!(pts.last(), Some(&PosMm::new(2_500, 3_750)));
        for w in pts.windows(2) {
            assert!(w[0].x == w[1].x || w[0].z == w[1].z, "axis aligned");
        }
        let path = Path::new(pts, 0, 100);
        for s in 0..=path.arrival_step() {
            let (p, _) = path.sample(s);
            assert!(!b.point_in_wall(p), "{p:?} in wall at step {s}");
        }
    }

    #[test]
    fn unreachable_returns_none() {
        let mut b = office();
        b.rooms.get_mut(&RoomId(1)).unwrap().doors.clear();
        let grid = b.nav_grid();
        assert!(grid
            .find_tile_path(Tile::new(5, 5), Tile::new(13, 1))
            .is_none());
    }

    #[test]
    fn deterministic_and_straight() {
        let b = Building::default_lot();
        let grid = b.nav_grid();
        let a = grid.find_tile_path(Tile::new(0, 0), Tile::new(7, 7));
        let c = grid.find_tile_path(Tile::new(0, 0), Tile::new(7, 7));
        assert_eq!(a, c);
        let simplified = simplify(a.unwrap().iter().map(|t| t.center()).collect());
        // open hallway: one corner
        assert_eq!(simplified.len(), 3);
    }

    #[test]
    fn sampling() {
        let p = Path::new(
            vec![PosMm::new(0, 0), PosMm::new(1000, 0), PosMm::new(1000, 500)],
            10,
            100,
        );
        assert_eq!(p.length_mm(), 1500);
        assert_eq!(p.arrival_step(), 25);
        assert_eq!(p.sample(0), (PosMm::new(0, 0), false));
        assert_eq!(p.sample(15), (PosMm::new(500, 0), false));
        assert_eq!(p.sample(22), (PosMm::new(1000, 200), false));
        assert_eq!(p.sample(25), (PosMm::new(1000, 500), true));
        assert_eq!(p.sample(1000), (PosMm::new(1000, 500), true));
    }

    #[test]
    fn simplify_removes_collinear() {
        let pts = vec![
            PosMm::new(0, 0),
            PosMm::new(0, 0),
            PosMm::new(5, 0),
            PosMm::new(9, 0),
            PosMm::new(9, 4),
        ];
        assert_eq!(
            simplify(pts),
            vec![PosMm::new(0, 0), PosMm::new(9, 0), PosMm::new(9, 4)]
        );
    }
}
