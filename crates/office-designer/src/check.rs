//! Deterministic checks on a solved plan (construction-kit.md §7.1 point 3).
//! Each returns issues by placement with a plain message for the model.
//!
//! | Check | Rule |
//! |---|---|
//! | walls | the kit footprint (and a desk's chair) stays inside the walls' inner faces; the sim's clearances hold (centre 0.3 m, a desk's chair 0.2 m from the wall line) |
//! | collisions | two floor items: the sim's rule (centres at least the sum of their spacing radii apart, Chebyshev) **and** their kit footprints and chairs do not overlap; ceiling lights 0.5 m apart |
//! | objects | a floor item keeps off the players' own designs (ADR-0088): neither its sim square (centre ± its spacing radius), a desk's 0.5 m chair square, nor its kit footprint and chair overlap an object's turned footprint or a workstation object's 0.5 m seat square (the sim's `objects::equipment_hits_object`) |
//! | table | in rooms with a table, nothing stands on the table or its seats |
//! | doors | nothing stands in the 1 m in front of a door, over the door's width |
//! | walkability | on a 125 mm grid, with walls, items and the players' floor objects grown by half a person (0.25 m), every new desk's chair, every other door, every table seat, every existing chair and every workstation object's seat can still be reached from door 0 (4-connected, fixed order, as the sim's pathfinding) |
//! | light | every new desk has a ceiling light (or a floor object with a light) within 2.5 m of its centre or a window opening within 3 m |
//! | items | at most the sim's 64 items in the room, objects included |
//! | brief | the room's counts (existing plus planned, workstation objects and screens and shelves of objects included) meet the brief |
//! | cost | the sim's prices of the planned items stay within the brief's budget |
//!
//! Things the room already had wrong are warnings, never errors.

use std::collections::VecDeque;

use serde::{Deserialize, Serialize};

use crate::brief::{Brief, Need};
use crate::catalogue::Catalogue;
use crate::issue::{label, number, Issue, IssueCode};
use crate::model::{
    fmt_cents, fmt_m, seat_pos, DeskSlot, EquipmentDesign, ExistingObject, Pos, Rect, Room, Side,
    BODY_MM, CEILING_LIGHT_SPACING_MM, CHAIR_HALF_MM, LIGHT_REACH_MM, MAX_ITEMS_PER_ROOM, REACH_MM,
    SEAT_CLEARANCE_MM, WALK_CELL_MM, WALL_CLEARANCE_MM, WALL_MM, WINDOW_REACH_MM,
};
use crate::plan::Plan;
use crate::solve::{solve, At, DeskRef, Solution, SolvedItem};

/// A requirement of the brief and what the room will have.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Requirement {
    pub need: Need,
    pub wanted: u32,
    pub have: u32,
}

/// The result of solving and checking a plan: the commands in build order,
/// the issues, and the figures the preview and the Build Approval show.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Evaluation {
    pub items: Vec<SolvedItem>,
    pub issues: Vec<Issue>,
    /// The sim's price of every planned item, cents.
    pub cost_cents: i64,
    /// Kit parts the plan adds (a desk with its chair).
    pub parts: u32,
    pub requirements: Vec<Requirement>,
    /// No errors (warnings allowed).
    pub ok: bool,
}

impl Evaluation {
    pub fn errors(&self) -> impl Iterator<Item = &Issue> {
        self.issues.iter().filter(|i| i.is_error())
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string(self).unwrap_or_default()
    }
}

/// Who a body is.
#[derive(Clone, Debug, PartialEq, Eq)]
enum Who {
    Existing(String),
    Planned { placement: usize, copy: u8 },
}

/// A floor or ceiling item with its geometry.
#[derive(Clone, Debug)]
struct Body {
    who: Who,
    design: EquipmentDesign,
    pos: Pos,
    rot: u8,
    rect: Rect,
    chair: Option<Rect>,
    seat: Option<Pos>,
    /// Copies in its placement (for labels).
    count: u8,
}

impl Body {
    fn name(&self) -> String {
        match &self.who {
            Who::Existing(id) => format!("equipment:{id} ({})", self.design.slug()),
            Who::Planned { placement, copy } => {
                label(*placement, *copy, self.count, self.design.slug())
            }
        }
    }

    fn planned(&self) -> Option<(usize, u8)> {
        match self.who {
            Who::Planned { placement, copy } => Some((placement, copy)),
            Who::Existing(_) => None,
        }
    }
}

fn body(cat: &Catalogue, who: Who, design: EquipmentDesign, pos: Pos, rot: u8, count: u8) -> Body {
    let (hx, hz) = cat.half(design, rot);
    let seat = cat.info(design).seat_port.then(|| seat_pos(pos, rot));
    let (cx, cz) = cat.chair.half();
    Body {
        who,
        design,
        pos,
        rot,
        rect: Rect::around(pos, hx, hz),
        chair: seat.map(|s| Rect::around(s, cx, cz)),
        seat,
        count,
    }
}

/// Solves `plan` in `room` and runs every check.
pub fn evaluate(room: &Room, plan: &Plan, brief: &Brief, cat: &Catalogue) -> Evaluation {
    let sol = solve(room, plan, cat);
    check(room, plan, &sol, brief, cat)
}

/// Runs every check on a solution.
pub fn check(
    room: &Room,
    plan: &Plan,
    sol: &Solution,
    brief: &Brief,
    cat: &Catalogue,
) -> Evaluation {
    let mut issues = sol.issues.clone();
    let count_of = |i: usize| plan.placements.get(i).map_or(1, |p| p.count);

    let existing: Vec<Body> = room
        .equipment
        .iter()
        .filter(|e| e.on_desk.is_none() && e.design.desk_slot().is_none())
        .map(|e| {
            body(
                cat,
                Who::Existing(e.id.clone()),
                e.design,
                e.pos(),
                e.rot,
                1,
            )
        })
        .collect();
    let planned: Vec<Body> = sol
        .items
        .iter()
        .filter_map(|it| {
            it.floor().map(|(pos, rot)| {
                body(
                    cat,
                    Who::Planned {
                        placement: it.placement,
                        copy: it.copy,
                    },
                    it.design,
                    pos,
                    rot,
                    count_of(it.placement),
                )
            })
        })
        .collect();

    for (n, b) in planned.iter().enumerate() {
        let others = existing.iter().chain(planned[..n].iter());
        if let Some(issue) = walls(room, b) {
            issues.push(issue);
        }
        for o in others {
            if let Some(m) = collision(b, o) {
                issues.push(at(IssueCode::Collision, b, m));
            }
        }
        for o in room.objects.iter().filter(|o| o.is_floor()) {
            if let Some(m) = object_collision(b, o) {
                issues.push(at(IssueCode::Collision, b, m));
            }
        }
        if !b.design.is_ceiling() {
            issues.extend(table(room, cat, b));
            issues.extend(doors(room, b));
        }
    }

    let total = room.equipment.len() + room.objects.len() + sol.items.len();
    if total > MAX_ITEMS_PER_ROOM {
        issues.push(Issue::new(
            IssueCode::TooManyItems,
            None,
            format!(
                "the room would hold {total} items; the sim allows {MAX_ITEMS_PER_ROOM} (monitors, lamps and the CEO's own designs count)"
            ),
        ));
    }

    issues.extend(light(room, &existing, &planned));
    issues.extend(walkability(room, cat, &existing, &planned));
    let requirements = requirements(room, brief, sol);
    issues.extend(requirement_issues(room, &requirements));

    let cost_cents: i64 = sol.items.iter().map(|it| it.design.cost()).sum();
    if let Some(max) = brief.max_cost_cents {
        if cost_cents > max {
            issues.push(Issue::new(
                IssueCode::OverBudget,
                None,
                format!(
                    "the plan costs {}; the budget is {}: drop or swap items ({} over)",
                    fmt_cents(cost_cents),
                    fmt_cents(max),
                    fmt_cents(cost_cents - max)
                ),
            ));
        }
    }
    let parts = sol.items.iter().map(|it| cat.parts(it.design)).sum();
    number(&mut issues);
    let ok = issues.iter().all(|i| !i.is_error());
    Evaluation {
        items: sol.items.clone(),
        issues,
        cost_cents,
        parts,
        requirements,
        ok,
    }
}

fn at(code: IssueCode, b: &Body, message: String) -> Issue {
    let (p, k) = b.planned().unwrap_or((0, 0));
    Issue::at(code, p, k, format!("{}: {message}", b.name()))
}

/// How far a rect reaches past the inner faces, per side.
fn excess(inner: &Rect, r: &Rect) -> Option<(Side, i32)> {
    [
        (Side::North, inner.z0 - r.z0),
        (Side::East, r.x1 - inner.x1),
        (Side::South, r.z1 - inner.z1),
        (Side::West, inner.x0 - r.x0),
    ]
    .into_iter()
    .filter(|(_, d)| *d > 0)
    .max_by_key(|(_, d)| *d)
}

fn inset_ok(room: &Room, p: Pos, inset: i32) -> bool {
    let r = room.rect();
    p.x >= r.x0 + inset && p.x <= r.x1 - inset && p.z >= r.z0 + inset && p.z <= r.z1 - inset
}

fn walls(room: &Room, b: &Body) -> Option<Issue> {
    let inner = room.inner();
    if let Some((side, d)) = excess(&inner, &b.rect) {
        return Some(at(
            IssueCode::IntoWall,
            b,
            format!(
                "it reaches {} into wall:{}; move it away from that wall",
                fmt_m(i64::from(d)),
                side.slug()
            ),
        ));
    }
    if let Some((side, d)) = b.chair.and_then(|c| excess(&inner, &c)) {
        return Some(at(
            IssueCode::IntoWall,
            b,
            format!(
                "its chair reaches {} into wall:{}; turn it or move it away from that wall",
                fmt_m(i64::from(d)),
                side.slug()
            ),
        ));
    }
    if !inset_ok(room, b.pos, WALL_CLEARANCE_MM) {
        return Some(at(
            IssueCode::WallClearance,
            b,
            format!(
                "its centre is closer than {} to a wall, which the sim refuses",
                fmt_m(i64::from(WALL_CLEARANCE_MM))
            ),
        ));
    }
    if let Some(s) = b.seat {
        if !inset_ok(room, s, SEAT_CLEARANCE_MM) {
            return Some(at(
                IssueCode::WallClearance,
                b,
                format!(
                    "its chair would stand in the wall (the sim keeps a chair {} from the walls); turn it to face into the room",
                    fmt_m(i64::from(SEAT_CLEARANCE_MM))
                ),
            ));
        }
    }
    None
}

fn collision(b: &Body, o: &Body) -> Option<String> {
    let (bc, oc) = (b.design.is_ceiling(), o.design.is_ceiling());
    if bc || oc {
        if bc && oc && b.pos.chebyshev(o.pos) < CEILING_LIGHT_SPACING_MM {
            return Some(format!(
                "it hangs {} from {}; ceiling lights stay {} apart",
                fmt_m(i64::from(b.pos.chebyshev(o.pos))),
                o.name(),
                fmt_m(i64::from(CEILING_LIGHT_SPACING_MM))
            ));
        }
        return None;
    }
    let reach = b.design.sim_footprint_mm() + o.design.sim_footprint_mm();
    let d = b.pos.chebyshev(o.pos);
    if reach > 0 && d < reach {
        return Some(format!(
            "it stands {} from {} (centre to centre, along the longer axis); the sim keeps them {} apart",
            fmt_m(i64::from(d)),
            o.name(),
            fmt_m(i64::from(reach))
        ));
    }
    if b.rect.intersects(&o.rect) {
        let (ox, oz) = b.rect.overlap(&o.rect);
        return Some(format!(
            "it overlaps {} by {} × {}",
            o.name(),
            fmt_m(i64::from(ox)),
            fmt_m(i64::from(oz))
        ));
    }
    if o.chair.is_some_and(|c| b.rect.intersects(&c)) {
        return Some(format!("it stands on the chair of {}", o.name()));
    }
    if let Some(c) = b.chair {
        if c.intersects(&o.rect) {
            return Some(format!("its chair runs into {}", o.name()));
        }
        if o.chair.is_some_and(|oc| c.intersects(&oc)) {
            return Some(format!("its chair and the chair of {} collide", o.name()));
        }
    }
    None
}

/// How a player's design is named to the model (it anchors as `equipment:ID`).
pub(crate) fn object_name(o: &ExistingObject) -> String {
    format!("equipment:{} (the CEO's own design)", o.id)
}

/// A planned floor item against a player's floor object: the sim's rule
/// (`objects::equipment_hits_object`: the item's spacing square and a desk's
/// chair square must not overlap the object's footprint or a workstation's
/// seat square) and the kit's (its footprint and chair likewise).
fn object_collision(b: &Body, o: &ExistingObject) -> Option<String> {
    if b.design.is_ceiling() || !b.design.is_floor() {
        return None;
    }
    let f = b.design.sim_footprint_mm();
    let mut body = vec![b.rect];
    if f > 0 {
        body.push(Rect::around(b.pos, f, f));
    }
    let mut chair: Vec<Rect> = b.chair.into_iter().collect();
    if b.design == EquipmentDesign::Desk {
        chair.push(Rect::around(
            seat_pos(b.pos, b.rot),
            CHAIR_HALF_MM,
            CHAIR_HALF_MM,
        ));
    }
    let name = object_name(o);
    let fp = o.rect();
    if body.iter().any(|r| r.intersects(&fp)) {
        let (ox, oz) = b.rect.overlap(&fp);
        return Some(if ox > 0 && oz > 0 {
            format!(
                "it overlaps {name} by {} × {}; keep off it",
                fmt_m(i64::from(ox)),
                fmt_m(i64::from(oz))
            )
        } else {
            format!(
                "its centre is closer than {} to {name}; the sim keeps a {}'s centre that far from it",
                fmt_m(i64::from(f)),
                b.design.slug()
            )
        });
    }
    if chair.iter().any(|r| r.intersects(&fp)) {
        return Some(format!("its chair runs into {name}"));
    }
    if let Some(s) = o.seat() {
        let seat = Rect::around(s, CHAIR_HALF_MM, CHAIR_HALF_MM);
        if body.iter().any(|r| r.intersects(&seat)) {
            return Some(format!(
                "it stands on the seat of {name}, a workstation; keep {} around that seat free",
                fmt_m(i64::from(2 * CHAIR_HALF_MM))
            ));
        }
        if chair.iter().any(|r| r.intersects(&seat)) {
            return Some(format!("its chair and the seat of {name} collide"));
        }
    }
    None
}

fn table_rect(room: &Room, cat: &Catalogue) -> Rect {
    let (hx, hz) = cat.table.half();
    Rect::around(room.centre(), hx, hz)
}

fn table(room: &Room, cat: &Catalogue, b: &Body) -> Vec<Issue> {
    if room.table_seats() == 0 {
        return Vec::new();
    }
    let hits = |r: &Rect| b.rect.intersects(r) || b.chair.is_some_and(|c| c.intersects(r));
    if hits(&table_rect(room, cat)) {
        return vec![at(
            IssueCode::BlocksTable,
            b,
            "it stands on the table in the middle of the room; keep the middle clear".into(),
        )];
    }
    let (sx, sz) = cat.stool.half();
    for (n, s) in room.table_seat_positions().iter().enumerate() {
        if hits(&Rect::around(*s, sx, sz)) {
            return vec![at(
                IssueCode::BlocksTable,
                b,
                format!(
                    "it stands on seat {} of the table ({} from the west wall, {} from the north wall); keep the seats clear",
                    n + 1,
                    fmt_m(i64::from(s.x - room.x_mm)),
                    fmt_m(i64::from(s.z - room.z_mm))
                ),
            )];
        }
    }
    Vec::new()
}

fn doors(room: &Room, b: &Body) -> Vec<Issue> {
    for (n, d) in room.doors.iter().enumerate() {
        let z = room.door_zone(d);
        if b.rect.intersects(&z) || b.chair.is_some_and(|c| c.intersects(&z)) {
            return vec![at(
                IssueCode::BlocksDoor,
                b,
                format!("it stands in front of door:{n}; keep 1 m in front of a door clear"),
            )];
        }
    }
    Vec::new()
}

fn light(room: &Room, existing: &[Body], planned: &[Body]) -> Vec<Issue> {
    let mut lights: Vec<Pos> = existing
        .iter()
        .chain(planned)
        .filter(|b| b.design.is_ceiling())
        .map(|b| b.pos)
        .collect();
    // a player's floor design with a light lights from where it stands
    lights.extend(
        room.objects
            .iter()
            .filter(|o| o.is_floor() && o.lights > 0)
            .map(ExistingObject::pos),
    );
    let l2 = i64::from(LIGHT_REACH_MM) * i64::from(LIGHT_REACH_MM);
    let w2 = i64::from(WINDOW_REACH_MM) * i64::from(WINDOW_REACH_MM);
    let mut out = Vec::new();
    for b in planned.iter().filter(|b| b.design == EquipmentDesign::Desk) {
        let by_light = lights.iter().any(|l| {
            let (dx, dz) = (i64::from(l.x - b.pos.x), i64::from(l.z - b.pos.z));
            dx * dx + dz * dz <= l2
        });
        let by_window = room
            .windows
            .iter()
            .any(|w| room.window_segment(w).dist2(b.pos) <= w2);
        if !by_light && !by_window {
            let anchor = b.planned().map_or(0, |(p, _)| p);
            out.push(at(
                IssueCode::NoLight,
                b,
                format!(
                    "no ceiling light within {} and no window within {}; add a ceiling-light anchored to placement:{anchor}, or move the desk near a window",
                    fmt_m(i64::from(LIGHT_REACH_MM)),
                    fmt_m(i64::from(WINDOW_REACH_MM))
                ),
            ));
        }
    }
    out
}

// ------------------------------------------------------------------ walkability

struct Grid {
    x0: i32,
    z0: i32,
    cols: i32,
    rows: i32,
    blocked: Vec<bool>,
}

impl Grid {
    fn centre(&self, c: i32, r: i32) -> Pos {
        Pos::new(
            self.x0 + c * WALK_CELL_MM + WALK_CELL_MM / 2,
            self.z0 + r * WALK_CELL_MM + WALK_CELL_MM / 2,
        )
    }

    fn index(&self, c: i32, r: i32) -> Option<usize> {
        if c < 0 || r < 0 || c >= self.cols || r >= self.rows {
            None
        } else {
            usize::try_from(r * self.cols + c).ok()
        }
    }

    fn build(room: &Room, obstacles: &[Rect]) -> Grid {
        let rr = room.rect();
        let cols = room.w_mm / WALK_CELL_MM;
        let rows = room.d_mm / WALK_CELL_MM;
        let mut g = Grid {
            x0: rr.x0,
            z0: rr.z0,
            cols,
            rows,
            blocked: Vec::new(),
        };
        let band = WALL_MM + BODY_MM;
        let grown: Vec<Rect> = obstacles.iter().map(|o| o.inflate(BODY_MM)).collect();
        for r in 0..rows {
            for c in 0..cols {
                let p = g.centre(c, r);
                let mut blocked = grown.iter().any(|o| o.contains_strict(p));
                if !blocked {
                    for side in Side::ALL {
                        let (dist, along) = match side {
                            Side::North => (p.z - rr.z0, p.x),
                            Side::South => (rr.z1 - p.z, p.x),
                            Side::West => (p.x - rr.x0, p.z),
                            Side::East => (rr.x1 - p.x, p.z),
                        };
                        if dist < band {
                            let in_door = room.doors.iter().any(|d| {
                                let (a, b) = room.span(d);
                                d.side == side && along >= a + BODY_MM && along <= b - BODY_MM
                            });
                            if !in_door {
                                blocked = true;
                                break;
                            }
                        }
                    }
                }
                g.blocked.push(blocked);
            }
        }
        g
    }

    /// Free cells in a door's opening.
    fn door_cells(&self, room: &Room, door: usize) -> Vec<usize> {
        let Some(d) = room.doors.get(door) else {
            return Vec::new();
        };
        let rr = room.rect();
        let (a, b) = room.span(d);
        let band = WALL_MM + BODY_MM;
        let mut out = Vec::new();
        for r in 0..self.rows {
            for c in 0..self.cols {
                let p = self.centre(c, r);
                let (dist, along) = match d.side {
                    Side::North => (p.z - rr.z0, p.x),
                    Side::South => (rr.z1 - p.z, p.x),
                    Side::West => (p.x - rr.x0, p.z),
                    Side::East => (rr.x1 - p.x, p.z),
                };
                if dist < band && along >= a + BODY_MM && along <= b - BODY_MM {
                    if let Some(i) = self.index(c, r) {
                        if !self.blocked[i] {
                            out.push(i);
                        }
                    }
                }
            }
        }
        out
    }

    /// Breadth-first from `starts`, neighbours in the fixed order N, E, S, W.
    fn reach(&self, starts: &[usize]) -> Vec<bool> {
        let mut seen = vec![false; self.blocked.len()];
        let mut q = VecDeque::new();
        for &s in starts {
            if !seen[s] {
                seen[s] = true;
                q.push_back(s);
            }
        }
        let cols = usize::try_from(self.cols).unwrap_or(0);
        while let Some(i) = q.pop_front() {
            let (c, r) = (i % cols, i / cols);
            let (c, r) = (i32::try_from(c).unwrap_or(0), i32::try_from(r).unwrap_or(0));
            for side in Side::ALL {
                let (dx, dz) = side.delta();
                if let Some(n) = self.index(c + dx, r + dz) {
                    if !seen[n] && !self.blocked[n] {
                        seen[n] = true;
                        q.push_back(n);
                    }
                }
            }
        }
        seen
    }

    fn reached(&self, seen: &[bool], t: Pos) -> bool {
        let c0 = (t.x - REACH_MM - self.x0).div_euclid(WALK_CELL_MM);
        let c1 = (t.x + REACH_MM - self.x0).div_euclid(WALK_CELL_MM);
        let r0 = (t.z - REACH_MM - self.z0).div_euclid(WALK_CELL_MM);
        let r1 = (t.z + REACH_MM - self.z0).div_euclid(WALK_CELL_MM);
        for r in r0..=r1 {
            for c in c0..=c1 {
                if let Some(i) = self.index(c, r) {
                    if seen[i] && self.centre(c, r).chebyshev(t) <= REACH_MM {
                        return true;
                    }
                }
            }
        }
        false
    }
}

enum Goal {
    Door(usize),
    Point(Pos, String),
}

fn walkability(room: &Room, cat: &Catalogue, existing: &[Body], planned: &[Body]) -> Vec<Issue> {
    if room.doors.is_empty() {
        return Vec::new();
    }
    let mut fixed: Vec<Rect> = existing
        .iter()
        .filter(|b| !b.design.is_ceiling())
        .map(|b| b.rect)
        .collect();
    fixed.extend(
        room.objects
            .iter()
            .filter(|o| o.is_floor())
            .map(ExistingObject::rect),
    );
    if room.table_seats() > 0 {
        fixed.push(table_rect(room, cat));
    }
    let mut all = fixed.clone();
    all.extend(
        planned
            .iter()
            .filter(|b| !b.design.is_ceiling())
            .map(|b| b.rect),
    );
    let before = Grid::build(room, &fixed);
    let after = Grid::build(room, &all);
    let seen_before = before.reach(&before.door_cells(room, 0));
    let seen_after = after.reach(&after.door_cells(room, 0));
    let door_reached = |g: &Grid, seen: &[bool], n: usize| {
        let cells = g.door_cells(room, n);
        cells.iter().any(|i| seen[*i])
    };

    let mut goals = Vec::new();
    for n in 1..room.doors.len() {
        goals.push(Goal::Door(n));
    }
    for (n, s) in room.table_seat_positions().iter().enumerate() {
        goals.push(Goal::Point(*s, format!("seat {} of the table", n + 1)));
    }
    for b in existing {
        if let Some(s) = b.seat {
            goals.push(Goal::Point(s, format!("the chair of {}", b.name())));
        }
    }
    for o in &room.objects {
        if let Some(s) = o.seat() {
            goals.push(Goal::Point(s, format!("the seat of {}", object_name(o))));
        }
    }
    let mut out = Vec::new();
    let room_open = door_reached(&before, &seen_before, 0);
    if !room_open {
        out.push(Issue::warning(
            IssueCode::Unreachable,
            "door:0 is already blocked by what stands in the room; walking paths were not checked",
        ));
        return out;
    }
    if !door_reached(&after, &seen_after, 0) {
        let door = room.door_zone(&room.doors[0]);
        let culprit = planned
            .iter()
            .filter(|b| !b.design.is_ceiling())
            .min_by_key(|b| b.rect.chebyshev(door.centre()));
        let m = "nobody can get in through door:0 any more; keep the doorway clear";
        out.push(match culprit {
            Some(b) => at(IssueCode::Unreachable, b, format!("it blocks the way: {m}")),
            None => Issue::new(IssueCode::Unreachable, None, m),
        });
        return out;
    }
    // unreachable goals, grouped by the planned item nearest to them
    let mut cut: Vec<(Option<usize>, Vec<String>)> = Vec::new();
    let mut already: Vec<String> = Vec::new();
    for g in &goals {
        let (was, is, what, at_pos) = match g {
            Goal::Door(n) => (
                door_reached(&before, &seen_before, *n),
                door_reached(&after, &seen_after, *n),
                format!("door:{n}"),
                room.door_zone(&room.doors[*n]).centre(),
            ),
            Goal::Point(p, what) => (
                before.reached(&seen_before, *p),
                after.reached(&seen_after, *p),
                what.clone(),
                *p,
            ),
        };
        if !was {
            already.push(what);
        } else if !is {
            let culprit = planned
                .iter()
                .enumerate()
                .filter(|(_, b)| !b.design.is_ceiling())
                .min_by_key(|(_, b)| b.rect.chebyshev(at_pos))
                .filter(|(_, b)| b.rect.chebyshev(at_pos) <= 1500)
                .map(|(n, _)| n);
            match cut.iter_mut().find(|(c, _)| *c == culprit) {
                Some((_, list)) => list.push(what),
                None => cut.push((culprit, vec![what])),
            }
        }
    }
    if !already.is_empty() {
        out.push(Issue::warning(
            IssueCode::Unreachable,
            format!(
                "{} already cannot be reached on foot from door:0 because of what stands in the room; the plan does not change that",
                already.join(", ")
            ),
        ));
    }
    for (culprit, list) in cut {
        let m = format!(
            "{} can no longer be reached on foot from door:0; leave a path at least {} wide",
            list.join(", "),
            fmt_m(i64::from(2 * BODY_MM))
        );
        out.push(match culprit {
            Some(n) => at(
                IssueCode::Unreachable,
                &planned[n],
                format!("it blocks the way: {m}"),
            ),
            None => Issue::new(IssueCode::Unreachable, None, m),
        });
    }
    for b in planned {
        if let Some(s) = b.seat {
            if !after.reached(&seen_after, s) {
                out.push(at(
                    IssueCode::Unreachable,
                    b,
                    format!(
                        "its chair cannot be reached on foot from door:0; leave a path at least {} wide",
                        fmt_m(i64::from(2 * BODY_MM))
                    ),
                ));
            }
        }
    }
    out
}

// ------------------------------------------------------------------ the brief

fn requirements(room: &Room, brief: &Brief, sol: &Solution) -> Vec<Requirement> {
    let screen_on = |desk: &DeskRef| -> bool {
        let planned = sol.items.iter().any(|it| {
            it.design.desk_slot() == Some(DeskSlot::Screen)
                && matches!(&it.at, At::OnDesk { desk: d } if d == desk)
        });
        let existing = match desk {
            DeskRef::Existing { id } => {
                room.equipment.iter().any(|e| {
                    e.on_desk.as_deref() == Some(id.as_str())
                        && e.design.desk_slot() == Some(DeskSlot::Screen)
                }) || room.objects.iter().any(|o| {
                    o.screens > 0
                        && o.on_desk
                            .as_ref()
                            .is_some_and(|d| d.desk == *id && d.slot == DeskSlot::Screen)
                })
            }
            DeskRef::Planned { .. } => false,
        };
        planned || existing
    };
    let mut desks: Vec<DeskRef> = room
        .equipment
        .iter()
        .filter(|e| e.design == EquipmentDesign::Desk)
        .map(|e| DeskRef::Existing { id: e.id.clone() })
        .collect();
    desks.extend(
        sol.items
            .iter()
            .filter(|it| it.design == EquipmentDesign::Desk)
            .map(|it| DeskRef::Planned {
                placement: it.placement,
                copy: it.copy,
            }),
    );
    let count = |f: &dyn Fn(EquipmentDesign) -> bool| -> u32 {
        let n = room.equipment.iter().filter(|e| f(e.design)).count()
            + sol.items.iter().filter(|it| f(it.design)).count();
        u32::try_from(n).unwrap_or(u32::MAX)
    };
    let objects = |f: &dyn Fn(&ExistingObject) -> bool| -> u32 {
        u32::try_from(room.objects.iter().filter(|o| f(o)).count()).unwrap_or(u32::MAX)
    };
    Need::ALL
        .into_iter()
        .filter(|n| brief.wants(*n) > 0)
        .map(|need| {
            let have = match need {
                Need::Workstations => u32::try_from(desks.iter().filter(|d| screen_on(d)).count())
                    .unwrap_or(0)
                    .saturating_add(objects(&ExistingObject::is_workstation)),
                // seats of objects seat nobody at the table yet (ADR-0088 decision 4)
                Need::MeetingSeats => u32::try_from(room.table_seats()).unwrap_or(0),
                Need::Storage => count(&|d| d == EquipmentDesign::ArchiveShelf)
                    .saturating_add(objects(&|o| o.is_floor() && o.storage > 0)),
                Need::WritingSurfaces => count(&|d| {
                    matches!(
                        d,
                        EquipmentDesign::Whiteboard | EquipmentDesign::MoodBoardWall
                    )
                }),
                Need::Coffee => count(&|d| d == EquipmentDesign::CoffeeMachine),
                Need::Plants => count(&|d| d == EquipmentDesign::Plant),
            };
            Requirement {
                need,
                wanted: u32::from(brief.wants(need)),
                have,
            }
        })
        .collect()
}

fn requirement_issues(room: &Room, reqs: &[Requirement]) -> Vec<Issue> {
    let mut out = Vec::new();
    for r in reqs.iter().filter(|r| r.have < r.wanted) {
        let issue = match r.need {
            Need::MeetingSeats => Issue::new(
                IssueCode::RoomTooSmall,
                None,
                if room.kind.holds_table() {
                    format!(
                        "the brief asks for {} meeting seats; this room's table seats {} (one seat per {} m² of floor): the room is too small, no plan can change that",
                        r.wanted,
                        r.have,
                        room.kind.tiles_per_person()
                    )
                } else {
                    format!(
                        "the brief asks for {} meeting seats; a {} has no table",
                        r.wanted,
                        room.kind.label().to_lowercase()
                    )
                },
            ),
            Need::Workstations => Issue::new(
                IssueCode::RequirementMissing,
                None,
                format!(
                    "the brief asks for {} workstations; the room will have {} (a workstation is a desk with a monitor or color-monitor on it, or the CEO's own workstation design)",
                    r.wanted, r.have
                ),
            ),
            n => Issue::new(
                IssueCode::RequirementMissing,
                None,
                format!(
                    "the brief asks for {} {}; the room will have {}",
                    r.wanted,
                    n.words(),
                    r.have
                ),
            ),
        };
        out.push(issue);
    }
    out
}
