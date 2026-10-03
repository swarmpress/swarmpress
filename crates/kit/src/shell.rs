//! Room shells: the floor, walls, windows, doors and skirting of a sim room
//! (construction-kit.md §2.3), generated as brick script from the room's
//! rect, doors and windows and its kind's style (`kit/rooms.json`), and
//! compiled like any other design.
//!
//! A shell's origin is the room rect's north-west corner on the floor; it is
//! 118 plates (2.95 m) tall. Walls are one stud thick and lie inside the
//! rect, so two rooms back to back make a 12.5 cm wall. Doors and windows
//! stay sim facts: a door is a 1 m (16-stud) opening with a door leaf in the
//! room that declares it; the room on the other side gets a doorway (the
//! opening without a leaf), which [`room_specs`] works out from the layout.
//! Rooms larger than 8 m on a side are cut into chunks of at most 8 × 8 m so
//! every grid stays small.

use serde::{Deserialize, Serialize};

use crate::catalogue::{Floor, Kit, ShellStyle};
use crate::design::{
    valid_id, Design, Mount, Op, PartOp, Provenance, Region, Shape, DESIGN_FORMAT,
};
use crate::expr::Num;
use crate::issue::{Issue, IssueCode};

/// Wall height, plates (2.95 m).
pub const WALL_TOP: i64 = 118;
/// Largest chunk side, studs (8 m).
pub const CHUNK: i64 = 128;
/// Studs per metre.
pub const STUDS_PER_M: i64 = 16;
/// Window sill height, plates (0.9 m).
pub const SILL: i64 = 36;
/// Window module (`window-4x1x18`): 4 studs wide, 18 plates tall; three rows.
const MODULE_W: i64 = 4;
const MODULE_H: i64 = 18;
const WINDOW_ROWS: i64 = 3;
/// Door opening: 16 studs wide (1 m), 84 plates tall (2.1 m) above the floor.
const DOOR_W: i64 = 16;
const DOOR_H: i64 = 84;
/// Wall bands: wainscot from the baseplate up to the rail, rail, wall, cap.
const RAIL_Y: i64 = 38;
const WALL_Y: i64 = 40;
/// The floor's top: baseplate (y 0) plus the floor layer (y 1).
const FLOOR_Y: i64 = 1;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Side {
    North,
    East,
    South,
    West,
}

impl Side {
    pub const fn opposite(self) -> Side {
        match self {
            Side::North => Side::South,
            Side::East => Side::West,
            Side::South => Side::North,
            Side::West => Side::East,
        }
    }

    /// The turn a door or window part takes in this wall: its front faces into the room.
    const fn inward_turn(self) -> u8 {
        match self {
            Side::North => 0,
            Side::East => 1,
            Side::South => 2,
            Side::West => 3,
        }
    }
}

/// A door, doorway or window on a room side: offset from the side's start
/// (the west end of north/south sides, the north end of east/west sides) and
/// width, millimetres (the sim's convention).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Opening {
    pub side: Side,
    pub at_mm: i32,
    pub width_mm: i32,
}

/// A room as the shell generator needs it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct RoomSpec {
    /// The sim's room id (`room-1`).
    pub id: String,
    /// The sim's room kind slug (`newsroom`).
    pub kind: String,
    pub w_mm: i32,
    pub d_mm: i32,
    /// Doors this room declares (opening and door leaf).
    #[serde(default)]
    pub doors: Vec<Opening>,
    /// Openings without a leaf: other rooms' doors into this one.
    #[serde(default)]
    pub doorways: Vec<Opening>,
    #[serde(default)]
    pub windows: Vec<Opening>,
}

/// A room of the building layout (position included), millimetres.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct LayoutRoom {
    pub id: String,
    pub kind: String,
    pub x_mm: i32,
    pub z_mm: i32,
    pub w_mm: i32,
    pub d_mm: i32,
    #[serde(default)]
    pub doors: Vec<Opening>,
    #[serde(default)]
    pub windows: Vec<Opening>,
}

impl LayoutRoom {
    /// The wall line of a side (z for north/south, x for east/west) and the
    /// side's extent along it.
    fn side_line(&self, side: Side) -> (i32, i32, i32) {
        match side {
            Side::North => (self.z_mm, self.x_mm, self.x_mm + self.w_mm),
            Side::South => (self.z_mm + self.d_mm, self.x_mm, self.x_mm + self.w_mm),
            Side::West => (self.x_mm, self.z_mm, self.z_mm + self.d_mm),
            Side::East => (self.x_mm + self.w_mm, self.z_mm, self.z_mm + self.d_mm),
        }
    }
}

/// The rooms of a layout as shell inputs: each room's own doors and windows,
/// plus a doorway wherever another room's door opens into it.
pub fn room_specs(rooms: &[LayoutRoom]) -> Vec<RoomSpec> {
    let mut specs: Vec<RoomSpec> = rooms
        .iter()
        .map(|r| RoomSpec {
            id: r.id.clone(),
            kind: r.kind.clone(),
            w_mm: r.w_mm,
            d_mm: r.d_mm,
            doors: r.doors.clone(),
            doorways: Vec::new(),
            windows: r.windows.clone(),
        })
        .collect();
    for (i, a) in rooms.iter().enumerate() {
        for door in &a.doors {
            let (line, start, _) = a.side_line(door.side);
            let (s0, s1) = (start + door.at_mm, start + door.at_mm + door.width_mm);
            for (j, b) in rooms.iter().enumerate() {
                if i == j {
                    continue;
                }
                let side = door.side.opposite();
                let (b_line, b0, b1) = b.side_line(side);
                let (o0, o1) = (s0.max(b0), s1.min(b1));
                if b_line == line && o0 < o1 {
                    specs[j].doorways.push(Opening {
                        side,
                        at_mm: o0 - b0,
                        width_mm: o1 - o0,
                    });
                }
            }
        }
    }
    specs
}

/// One shell design and where it goes: `at` is `[x, z]` in studs from the
/// room's north-west corner.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ShellChunk {
    pub at: [u32; 2],
    pub design: Design,
}

/// A brick box, before chunking.
struct BoxItem {
    at: [i64; 3],
    size: [i64; 3],
    mat: &'static str,
    colour: Option<String>,
}

/// A part, before chunking; `carve` empties its cells first (window modules).
struct PartItem {
    part: &'static str,
    at: [i64; 3],
    dims: [i64; 3],
    turn: u8,
    colour: String,
    carve: bool,
}

enum Item {
    Box(BoxItem),
    Part(PartItem),
}

fn num3(v: [i64; 3]) -> [Num; 3] {
    v.map(Num::Int)
}

fn mm_to_studs(mm: i32) -> i64 {
    i64::from(mm) * STUDS_PER_M / 1000
}

/// A box along a side: `o..o+len` along it, `inset..inset+depth` cells in
/// from the wall line, `y0..y0+h` up.
#[allow(clippy::too_many_arguments)]
fn side_box(
    side: Side,
    w: i64,
    d: i64,
    o: i64,
    len: i64,
    inset: i64,
    depth: i64,
    y0: i64,
    h: i64,
) -> ([i64; 3], [i64; 3]) {
    match side {
        Side::North => ([o, inset, y0], [len, depth, h]),
        Side::South => ([o, d - inset - depth, y0], [len, depth, h]),
        Side::West => ([inset, o, y0], [depth, len, h]),
        Side::East => ([w - inset - depth, o, y0], [depth, len, h]),
    }
}

fn side_len(side: Side, w: i64, d: i64) -> i64 {
    match side {
        Side::North | Side::South => w,
        Side::East | Side::West => d,
    }
}

struct Builder<'s> {
    w: i64,
    d: i64,
    style: &'s ShellStyle,
    items: Vec<Item>,
}

impl Builder<'_> {
    fn bx(&mut self, at: [i64; 3], size: [i64; 3], mat: &'static str, colour: Option<&str>) {
        if size.iter().all(|&s| s > 0) {
            self.items.push(Item::Box(BoxItem {
                at,
                size,
                mat,
                colour: colour.map(str::to_string),
            }));
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn side(
        &mut self,
        side: Side,
        o: i64,
        len: i64,
        inset: i64,
        depth: i64,
        y0: i64,
        h: i64,
        mat: &'static str,
        colour: Option<&str>,
    ) {
        let (at, size) = side_box(side, self.w, self.d, o, len, inset, depth, y0, h);
        self.bx(at, size, mat, colour);
    }

    fn baseplates(&mut self) {
        let base = self.style.base.clone();
        for bz in (0..self.d).step_by(32) {
            for bx in (0..self.w).step_by(32) {
                if bx + 32 <= self.w && bz + 32 <= self.d {
                    self.part("baseplate-32x32", [bx, bz, 0], [32, 32, 1], 0, &base, false);
                    continue;
                }
                for z in (bz..(bz + 32).min(self.d)).step_by(16) {
                    for x in (bx..(bx + 32).min(self.w)).step_by(16) {
                        self.part("baseplate-16x16", [x, z, 0], [16, 16, 1], 0, &base, false);
                    }
                }
            }
        }
    }

    fn part(
        &mut self,
        part: &'static str,
        at: [i64; 3],
        dims: [i64; 3],
        turn: u8,
        colour: &str,
        carve: bool,
    ) {
        self.items.push(Item::Part(PartItem {
            part,
            at,
            dims,
            turn,
            colour: colour.to_string(),
            carve,
        }));
    }

    fn floor(&mut self) {
        let (w, d) = (self.w, self.d);
        let y = FLOOR_Y;
        match self.style.floor.clone() {
            Floor::Planks { colours } => {
                // The prototype's planks: 20 studs long, rows staggered by 7.
                for z in 1..d - 1 {
                    let shift = (z * 7) % 20;
                    let mut x = 1;
                    while x < w - 1 {
                        let s = (x + shift) / 20;
                        let end = ((s + 1) * 20 - shift).min(w - 1);
                        let pick = ((z as u64 * 92_821) ^ (s as u64 * 40_503)) % 4;
                        let c = colours[pick as usize].clone();
                        self.bx([x, z, y], [end - x, 1, 1], "tile", Some(&c));
                        x = end;
                    }
                }
            }
            Floor::Checker { colours } => {
                for z0 in (1..d - 1).step_by(4) {
                    for x0 in (1..w - 1).step_by(4) {
                        let c = colours[(((x0 / 4) + (z0 / 4)) % 2) as usize].clone();
                        let size = [(w - 1 - x0).min(4), (d - 1 - z0).min(4), 1];
                        self.bx([x0, z0, y], size, "tile", Some(&c));
                    }
                }
            }
            Floor::Carpet { field, border } => {
                self.bx([1, 1, y], [w - 2, d - 2, 1], "tile", Some(&field));
                let b = 2.min((w - 2) / 2).min((d - 2) / 2);
                self.bx([1, 1, y], [w - 2, b, 1], "tile", Some(&border));
                self.bx([1, d - 1 - b, y], [w - 2, b, 1], "tile", Some(&border));
                self.bx([1, 1, y], [b, d - 2, 1], "tile", Some(&border));
                self.bx([w - 1 - b, 1, y], [b, d - 2, 1], "tile", Some(&border));
            }
            Floor::Plain { colour } => {
                self.bx([1, 1, y], [w - 2, d - 2, 1], "tile", Some(&colour));
            }
        }
    }

    fn walls(&mut self) {
        let s = self.style.clone();
        for side in [Side::North, Side::East, Side::South, Side::West] {
            let len = side_len(side, self.w, self.d);
            self.side(
                side,
                0,
                len,
                0,
                1,
                1,
                RAIL_Y - 1,
                "brick",
                Some(&s.wainscot),
            );
            self.side(
                side,
                0,
                len,
                0,
                1,
                RAIL_Y,
                WALL_Y - RAIL_Y,
                "brick",
                Some(&s.rail),
            );
            self.side(
                side,
                0,
                len,
                0,
                1,
                WALL_Y,
                WALL_TOP - 1 - WALL_Y,
                "brick",
                Some(&s.wall),
            );
            self.side(side, 0, len, 0, 1, WALL_TOP - 1, 1, "tile", Some(&s.cap));
        }
        for side in [Side::North, Side::East, Side::South, Side::West] {
            let len = side_len(side, self.w, self.d);
            self.side(
                side,
                1,
                len - 2,
                1,
                1,
                FLOOR_Y + 1,
                3,
                "tile",
                Some(&s.skirting),
            );
        }
    }

    /// A door opening (with a leaf when `leaf`), or an error message.
    fn door(&mut self, o: &Opening, leaf: bool) -> Result<(), String> {
        let len = side_len(o.side, self.w, self.d);
        let at = mm_to_studs(o.at_mm);
        let wd = mm_to_studs(o.width_mm);
        if wd < 1 || at < 0 || at + wd > len {
            return Err(format!(
                "{:?} opening at {} mm is outside the side",
                o.side, o.at_mm
            ));
        }
        let s = self.style.clone();
        let (f0, f1) = ((at - 2).max(0), (at + wd + 2).min(len));
        let top = FLOOR_Y + 1 + DOOR_H;
        self.side(
            o.side,
            f0,
            f1 - f0,
            0,
            1,
            FLOOR_Y,
            top + 2 - FLOOR_Y,
            "brick",
            Some(&s.frame),
        );
        self.side(o.side, at, wd, 0, 2, FLOOR_Y, top - FLOOR_Y, "empty", None);
        self.side(o.side, at, wd, 0, 2, FLOOR_Y, 1, "tile", Some(&s.frame));
        if leaf && wd == DOOR_W {
            let (p, _) = side_box(
                o.side,
                self.w,
                self.d,
                at,
                DOOR_W,
                0,
                1,
                FLOOR_Y + 1,
                DOOR_H,
            );
            let turn = o.side.inward_turn();
            let dims = if turn.is_multiple_of(2) {
                [DOOR_W, 1, DOOR_H]
            } else {
                [1, DOOR_W, DOOR_H]
            };
            self.part("door-16x1x84", p, dims, turn, &s.door, false);
        }
        Ok(())
    }

    fn window(&mut self, o: &Opening) -> Result<(), String> {
        let len = side_len(o.side, self.w, self.d);
        let wd = mm_to_studs(o.width_mm);
        let n = wd / MODULE_W;
        let at = mm_to_studs(o.at_mm) + (wd - n * MODULE_W) / 2;
        if n < 1 || at < 1 || at + n * MODULE_W > len - 1 {
            return Err(format!(
                "{:?} window at {} mm is outside the side",
                o.side, o.at_mm
            ));
        }
        let s = self.style.clone();
        let turn = o.side.inward_turn();
        for col in 0..n {
            for row in 0..WINDOW_ROWS {
                let (p, size) = side_box(
                    o.side,
                    self.w,
                    self.d,
                    at + col * MODULE_W,
                    MODULE_W,
                    0,
                    1,
                    SILL + row * MODULE_H,
                    MODULE_H,
                );
                self.part("window-4x1x18", p, size, turn, &s.window, true);
            }
        }
        let (s0, s1) = ((at - 1).max(1), (at + n * MODULE_W + 1).min(len - 1));
        self.side(
            o.side,
            s0,
            s1 - s0,
            1,
            1,
            SILL - 1,
            1,
            "tile",
            Some(&s.frame),
        );
        Ok(())
    }
}

/// Clip an item to a chunk and move it into the chunk's coordinates.
fn chunk_ops(items: &[Item], cx: i64, cz: i64, cw: i64, cd: i64) -> Vec<Op> {
    let mut ops = Vec::new();
    for it in items {
        match it {
            Item::Box(b) => {
                let x0 = b.at[0].max(cx);
                let z0 = b.at[1].max(cz);
                let x1 = (b.at[0] + b.size[0]).min(cx + cw);
                let z1 = (b.at[1] + b.size[1]).min(cz + cd);
                if x0 < x1 && z0 < z1 {
                    ops.push(Op::Box(Region {
                        at: num3([x0 - cx, z0 - cz, b.at[2]]),
                        size: num3([x1 - x0, z1 - z0, b.size[2]]),
                        part: b.mat.to_string(),
                        colour: b.colour.clone(),
                        shape: Shape::Box,
                    }));
                }
            }
            Item::Part(p) => {
                let inside = p.at[0] >= cx
                    && p.at[1] >= cz
                    && p.at[0] + p.dims[0] <= cx + cw
                    && p.at[1] + p.dims[1] <= cz + cd;
                if !inside {
                    // Parts that straddle a chunk edge are left out (and the
                    // wall stays closed there): only window modules can.
                    continue;
                }
                let at = [p.at[0] - cx, p.at[1] - cz, p.at[2]];
                if p.carve {
                    ops.push(Op::Box(Region {
                        at: num3(at),
                        size: num3(p.dims),
                        part: "empty".into(),
                        colour: None,
                        shape: Shape::Box,
                    }));
                }
                ops.push(Op::Part(PartOp {
                    part: p.part.to_string(),
                    at: num3(at),
                    turn: Num::Int(i64::from(p.turn)),
                    colour: Some(p.colour.clone()),
                    surface: None,
                }));
            }
        }
    }
    ops
}

/// The shell of a room as one or more designs.
pub fn room_shell(room: &RoomSpec, kit: &Kit) -> Result<Vec<ShellChunk>, Vec<Issue>> {
    let base_id = format!("shell-{}", room.id);
    let fail = |m: String| vec![Issue::design(IssueCode::BadParam, &base_id, m)];
    if !valid_id(&base_id) {
        return Err(fail(format!(
            "room id {:?} is not usable in a design id",
            room.id
        )));
    }
    let style = kit
        .rooms()
        .styles
        .get(&room.kind)
        .ok_or_else(|| fail(format!("no shell style for room kind {:?}", room.kind)))?;
    let exact = |mm: i32| i64::from(mm) * STUDS_PER_M % 1000 == 0;
    let (w, d) = (mm_to_studs(room.w_mm), mm_to_studs(room.d_mm));
    if !exact(room.w_mm) || !exact(room.d_mm) || w < STUDS_PER_M || d < STUDS_PER_M {
        return Err(fail(format!(
            "room size {} × {} mm must be whole studs and at least 1 m",
            room.w_mm, room.d_mm
        )));
    }
    let mut b = Builder {
        w,
        d,
        style,
        items: Vec::new(),
    };
    b.baseplates();
    b.floor();
    b.walls();
    let mut errs = Vec::new();
    for o in &room.doors {
        if let Err(e) = b.door(o, true) {
            errs.push(e);
        }
    }
    for o in &room.doorways {
        if let Err(e) = b.door(o, false) {
            errs.push(e);
        }
    }
    for o in &room.windows {
        if let Err(e) = b.window(o) {
            errs.push(e);
        }
    }
    if !errs.is_empty() {
        return Err(errs.into_iter().flat_map(fail).collect());
    }
    let chunks_x: Vec<i64> = (0..w).step_by(CHUNK as usize).collect();
    let chunks_z: Vec<i64> = (0..d).step_by(CHUNK as usize).collect();
    let single = chunks_x.len() == 1 && chunks_z.len() == 1;
    let mut out = Vec::new();
    for &cz in &chunks_z {
        for &cx in &chunks_x {
            let (cw, cd) = ((w - cx).min(CHUNK), (d - cz).min(CHUNK));
            let id = if single {
                base_id.clone()
            } else {
                format!("{base_id}-{}-{}", cx / CHUNK, cz / CHUNK)
            };
            let design = Design {
                schema: None,
                format: DESIGN_FORMAT.to_string(),
                id,
                name: format!("Shell of {} ({})", room.id, room.kind),
                mount: Mount::Floor,
                footprint: [Num::Int(cw), Num::Int(cd)],
                height: Num::Int(WALL_TOP),
                params: Default::default(),
                ops: chunk_ops(&b.items, cx, cz, cw, cd),
                ports: Vec::new(),
                tags: vec!["shell".to_string()],
                budget: None,
                provenance: Provenance::Kit,
            };
            out.push(ShellChunk {
                at: [cx as u32, cz as u32],
                design,
            });
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn room(id: &str, x: i32, z: i32, w: i32, d: i32, doors: Vec<Opening>) -> LayoutRoom {
        LayoutRoom {
            id: id.into(),
            kind: "newsroom".into(),
            x_mm: x,
            z_mm: z,
            w_mm: w,
            d_mm: d,
            doors,
            windows: vec![],
        }
    }

    #[test]
    fn a_door_becomes_a_doorway_next_door() {
        // The demo's server room opens north into the SEO lab.
        let rooms = [
            room("room-10", 19_000, 8_000, 5_000, 4_000, vec![]),
            room(
                "room-11",
                19_000,
                12_000,
                5_000,
                4_000,
                vec![Opening {
                    side: Side::North,
                    at_mm: 2_000,
                    width_mm: 1_000,
                }],
            ),
        ];
        let specs = room_specs(&rooms);
        assert_eq!(
            specs[0].doorways,
            vec![Opening {
                side: Side::South,
                at_mm: 2_000,
                width_mm: 1_000
            }]
        );
        assert!(specs[1].doorways.is_empty());
    }

    #[test]
    fn side_boxes_lie_on_their_wall() {
        assert_eq!(
            side_box(Side::South, 64, 48, 8, 16, 0, 2, 1, 5),
            ([8, 46, 1], [16, 2, 5])
        );
        assert_eq!(
            side_box(Side::East, 64, 48, 8, 16, 1, 1, 1, 5),
            ([62, 8, 1], [1, 16, 5])
        );
    }
}
