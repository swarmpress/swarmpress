//! The layout solver: placements by relation → the sim's placements
//! (`PlaceEquipment { kind, placement: Floor { pos, rot } | OnDesk(desk) }`),
//! or an issue per placement that cannot be placed. Deterministic: integers,
//! plan order, no hashing.
//!
//! Geometry (the rules the vocabulary doc states):
//! - an item's extent is its kit footprint, turned by `rot` (odd turns swap
//!   w and d); its position is the footprint's centre, as the sim's `pos`;
//! - against a wall, the item's back edge stands `gap` studs off the wall's
//!   inner face (walls are one stud thick inside the room's rect), and never
//!   closer than the sim's wall clearance (centre 0.3 m from the wall line);
//! - a row of `count` items runs along the anchor with `spacing` studs between
//!   neighbours; the step is rounded up to the 2-stud grid;
//! - positions are snapped to the 2-stud (125 mm) grid toward the room's
//!   centre (perpendicular to a wall) or away from where the row starts, so
//!   a snapped item only ever moves away from its anchor.

use serde::{Deserialize, Serialize};

use crate::catalogue::Catalogue;
use crate::issue::{Issue, IssueCode};
use crate::model::{
    fmt_m, snap, snap_toward, studs_mm, EquipmentDesign, Opening, Pos, Rect, Room, Side,
    WALL_CLEARANCE_MM, WALL_MM,
};
use crate::plan::{Anchor, Facing, Placement, Plan};

/// The desk an attachment goes on.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case", tag = "kind")]
pub enum DeskRef {
    /// A desk this plan places: the orchestrator substitutes the sim's id
    /// the desk got when its command was applied.
    Planned { placement: usize, copy: u8 },
    /// A desk already in the room.
    Existing { id: String },
}

/// Where a solved item goes, in the sim's terms.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case", tag = "kind")]
pub enum At {
    /// `Placement::Floor { pos, rot }` (also ceiling lights).
    Floor { x_mm: i32, z_mm: i32, rot: u8 },
    /// `Placement::OnDesk(desk)`.
    OnDesk { desk: DeskRef },
}

/// One `PlaceEquipment` command, in build order.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SolvedItem {
    pub placement: usize,
    pub copy: u8,
    pub design: EquipmentDesign,
    pub at: At,
}

impl SolvedItem {
    pub fn floor(&self) -> Option<(Pos, u8)> {
        match self.at {
            At::Floor { x_mm, z_mm, rot } => Some((Pos::new(x_mm, z_mm), rot)),
            At::OnDesk { .. } => None,
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Solution {
    /// Every item of every placement that could be placed, in plan order
    /// (a desk always before what goes on it).
    pub items: Vec<SolvedItem>,
    /// Why placements could not be placed (unnumbered until evaluation).
    pub issues: Vec<Issue>,
    /// Placements that could not be placed.
    pub failed: Vec<usize>,
}

/// What an item anchor resolves to.
struct Target {
    rect: Rect,
    centre: Pos,
    front: Side,
    desks: Vec<DeskRef>,
    name: String,
}

enum Placed {
    Floor(Vec<(Pos, u8)>),
    Attach,
    Failed,
}

/// Solves a plan against a room.
pub fn solve(room: &Room, plan: &Plan, cat: &Catalogue) -> Solution {
    let mut sol = Solution::default();
    let mut placed: Vec<Placed> = Vec::with_capacity(plan.placements.len());
    for (i, p) in plan.placements.iter().enumerate() {
        match solve_one(room, plan, cat, i, p, &placed, &sol.items) {
            Ok(Solved::Floor(spots)) => {
                for (k, (pos, rot)) in spots.iter().enumerate() {
                    sol.items.push(SolvedItem {
                        placement: i,
                        copy: u8::try_from(k).unwrap_or(u8::MAX),
                        design: p.design,
                        at: At::Floor {
                            x_mm: pos.x,
                            z_mm: pos.z,
                            rot: *rot,
                        },
                    });
                }
                placed.push(Placed::Floor(spots));
            }
            Ok(Solved::Attach(desks)) => {
                for (k, desk) in desks.into_iter().enumerate() {
                    sol.items.push(SolvedItem {
                        placement: i,
                        copy: u8::try_from(k).unwrap_or(u8::MAX),
                        design: p.design,
                        at: At::OnDesk { desk },
                    });
                }
                placed.push(Placed::Attach);
            }
            Err(issue) => {
                sol.issues.push(issue);
                sol.failed.push(i);
                placed.push(Placed::Failed);
            }
        }
    }
    sol
}

enum Solved {
    Floor(Vec<(Pos, u8)>),
    Attach(Vec<DeskRef>),
}

fn rel(i: usize, m: String) -> Issue {
    Issue::new(
        IssueCode::BadRelation,
        Some(i),
        format!("placement {i}: {m}"),
    )
}

fn solve_one(
    room: &Room,
    plan: &Plan,
    cat: &Catalogue,
    i: usize,
    p: &Placement,
    placed: &[Placed],
    items: &[SolvedItem],
) -> Result<Solved, Issue> {
    let d = p.design;
    if let Some(issue) = p.limits(i).into_iter().next() {
        return Err(issue);
    }
    if !d.allowed_in(room.kind) {
        let only = d.required_room().map(|r| r.label()).unwrap_or_default();
        return Err(Issue::new(
            IssueCode::WrongRoom,
            Some(i),
            format!(
                "placement {i}: a {} only goes into a {}; this is a {}",
                d.slug(),
                only.to_lowercase(),
                room.kind.label().to_lowercase()
            ),
        ));
    }
    if let Some(slot) = d.desk_slot() {
        return attach(room, plan, cat, i, p, slot, placed, items);
    }
    let spots = match &p.anchor {
        Anchor::Wall(side) => wall_row(room, plan, cat, i, p, *side, p.from.as_ref(), placed)?,
        Anchor::Window(n) => {
            let w = opening(&room.windows, *n, i, "window")?;
            wall_row(
                room,
                plan,
                cat,
                i,
                p,
                w.side,
                Some(&Anchor::Window(*n)),
                placed,
            )?
        }
        Anchor::Door(n) => {
            let o = opening(&room.doors, *n, i, "door")?;
            wall_row(
                room,
                plan,
                cat,
                i,
                p,
                o.side,
                Some(&Anchor::Door(*n)),
                placed,
            )?
        }
        Anchor::Placement(_) | Anchor::Equipment(_) => {
            let t = target(room, plan, cat, i, &p.anchor, placed)?;
            item_row(room, cat, i, p, &t)?
        }
        Anchor::RoomCentre => centre_row(room, cat, i, p)?,
    };
    Ok(Solved::Floor(spots))
}

fn opening(list: &[Opening], n: usize, i: usize, what: &str) -> Result<Opening, Issue> {
    list.get(n).copied().ok_or_else(|| {
        let have = if list.is_empty() {
            format!("the room has no {what}s")
        } else {
            format!("the room has {what}:0 to {what}:{}", list.len() - 1)
        };
        Issue::new(
            IssueCode::UnknownAnchor,
            Some(i),
            format!("placement {i}: there is no {what}:{n}; {have}"),
        )
    })
}

#[allow(clippy::too_many_arguments)]
fn attach(
    room: &Room,
    plan: &Plan,
    cat: &Catalogue,
    i: usize,
    p: &Placement,
    slot: crate::model::DeskSlot,
    placed: &[Placed],
    items: &[SolvedItem],
) -> Result<Solved, Issue> {
    let d = p.design;
    if !matches!(p.anchor, Anchor::Placement(_) | Anchor::Equipment(_)) {
        return Err(rel(
            i,
            format!(
                "a {} goes on a desk: anchor it to placement:N (a desk of this plan) or equipment:ID (a desk in the room), not {}",
                d.slug(),
                p.anchor
            ),
        ));
    }
    let t = target(room, plan, cat, i, &p.anchor, placed)?;
    if t.desks.is_empty() {
        return Err(Issue::new(
            IssueCode::NotADesk,
            Some(i),
            format!(
                "placement {i}: {} is not a desk; a {} goes on a desk",
                t.name,
                d.slug()
            ),
        ));
    }
    for desk in &t.desks {
        let taken_existing = match desk {
            DeskRef::Existing { id } => room
                .equipment
                .iter()
                .find(|e| e.on_desk.as_deref() == Some(id) && e.design.desk_slot() == Some(slot))
                .map(|e| format!("equipment:{} ({})", e.id, e.design.slug()))
                .or_else(|| {
                    // a player's desk-top design holds the slot too (ADR-0088 decision 3)
                    room.objects
                        .iter()
                        .find(|o| {
                            o.on_desk
                                .as_ref()
                                .is_some_and(|d| d.desk == *id && d.slot == slot)
                        })
                        .map(crate::check::object_name)
                }),
            DeskRef::Planned { .. } => None,
        };
        let taken_planned = items
            .iter()
            .find(|it| {
                it.design.desk_slot() == Some(slot)
                    && matches!(&it.at, At::OnDesk { desk: x } if x == desk)
            })
            .map(|it| format!("placement {} ({})", it.placement, it.design.slug()));
        if let Some(by) = taken_existing.or(taken_planned) {
            let slot = match slot {
                crate::model::DeskSlot::Screen => "screen",
                crate::model::DeskSlot::Lamp => "lamp",
            };
            return Err(Issue::new(
                IssueCode::SlotTaken,
                Some(i),
                format!(
                    "placement {i}: the {slot} slot of {} is taken by {by}; a desk holds one screen and one lamp",
                    t.name
                ),
            ));
        }
    }
    Ok(Solved::Attach(t.desks))
}

/// Resolves `placement:N` or `equipment:ID` to the item it names.
fn target(
    room: &Room,
    plan: &Plan,
    cat: &Catalogue,
    i: usize,
    anchor: &Anchor,
    placed: &[Placed],
) -> Result<Target, Issue> {
    match anchor {
        Anchor::Placement(j) => {
            let j = *j;
            if j >= i {
                return Err(Issue::new(
                    IssueCode::ForwardReference,
                    Some(i),
                    format!(
                        "placement {i}: placement:{j} must come before it; refer only to placements 0 to {}",
                        i.saturating_sub(1)
                    ),
                ));
            }
            let pj = &plan.placements[j];
            match &placed[j] {
                Placed::Failed => Err(Issue::new(
                    IssueCode::DependsOnFailed,
                    Some(i),
                    format!(
                        "placement {i}: it depends on placement {j}, which could not be placed"
                    ),
                )),
                Placed::Attach => Err(rel(
                    i,
                    format!(
                        "placement:{j} is a {} on a desk; anchor to the desk instead",
                        pj.design.slug()
                    ),
                )),
                Placed::Floor(spots) => {
                    let mut rect: Option<Rect> = None;
                    for (pos, rot) in spots {
                        let (hx, hz) = cat.half(pj.design, *rot);
                        let r = Rect::around(*pos, hx, hz);
                        rect = Some(rect.map_or(r, |u| u.union(&r)));
                    }
                    let rect = rect.unwrap_or(Rect::new(0, 0, 0, 0));
                    let front = spots.first().map_or(Side::South, |(_, r)| Side::of_rot(*r));
                    let desks = if pj.design == EquipmentDesign::Desk {
                        (0..spots.len())
                            .map(|k| DeskRef::Planned {
                                placement: j,
                                copy: u8::try_from(k).unwrap_or(u8::MAX),
                            })
                            .collect()
                    } else {
                        Vec::new()
                    };
                    Ok(Target {
                        rect,
                        centre: rect.centre(),
                        front,
                        desks,
                        name: format!("placement {j} ({})", pj.design.slug()),
                    })
                }
            }
        }
        Anchor::Equipment(id) if room.existing(id).is_none() && room.object(id).is_some() => {
            let o = room
                .object(id)
                .ok_or_else(|| rel(i, format!("{anchor} is not an item")))?;
            if let Some(d) = &o.on_desk {
                return Err(rel(
                    i,
                    format!(
                        "equipment:{} is the CEO's own design on {}; anchor to equipment:{} instead",
                        o.id, d.desk, d.desk
                    ),
                ));
            }
            // a workstation's front is its seat's side
            let front = o
                .seat()
                .and_then(|s| toward(o.pos(), s))
                .unwrap_or(Side::of_rot(o.rot));
            Ok(Target {
                rect: o.rect(),
                centre: o.pos(),
                front,
                desks: Vec::new(),
                name: crate::check::object_name(o),
            })
        }
        Anchor::Equipment(id) => {
            let e = room.existing(id).ok_or_else(|| {
                let ids: Vec<String> = room
                    .equipment
                    .iter()
                    .filter(|e| e.on_desk.is_none())
                    .map(|e| format!("equipment:{}", e.id))
                    .chain(
                        room.objects
                            .iter()
                            .filter(|o| o.is_floor())
                            .map(|o| format!("equipment:{}", o.id)),
                    )
                    .collect();
                let have = if ids.is_empty() {
                    "the room has no equipment".to_string()
                } else {
                    format!("the room has {}", ids.join(", "))
                };
                Issue::new(
                    IssueCode::UnknownAnchor,
                    Some(i),
                    format!("placement {i}: there is no equipment:{id}; {have}"),
                )
            })?;
            if let Some(desk) = &e.on_desk {
                return Err(rel(
                    i,
                    format!(
                        "equipment:{} is a {} on {desk}; anchor to equipment:{desk} instead",
                        e.id,
                        e.design.slug()
                    ),
                ));
            }
            let (hx, hz) = cat.half(e.design, e.rot);
            let rect = Rect::around(e.pos(), hx, hz);
            Ok(Target {
                rect,
                centre: e.pos(),
                front: Side::of_rot(e.rot),
                desks: if e.design == EquipmentDesign::Desk {
                    vec![DeskRef::Existing { id: e.id.clone() }]
                } else {
                    Vec::new()
                },
                name: format!("equipment:{} ({})", e.id, e.design.slug()),
            })
        }
        _ => Err(rel(i, format!("{anchor} is not an item"))),
    }
}

fn rot_for(design: EquipmentDesign, front: Side) -> u8 {
    if design.is_ceiling() {
        0
    } else {
        front.front_rot()
    }
}

/// The row's step: the item's length along the row plus the spacing,
/// rounded up to the grid.
fn stride(len: i32, spacing: u16) -> i32 {
    snap(len + studs_mm(spacing), true).max(crate::model::GRID_MM)
}

/// Along-axis centres of a row of `n` starting at `first` in direction `dir`.
fn row(first: i32, dir: i32, stride: i32, n: u8) -> Vec<i32> {
    (0..i32::from(n))
        .map(|k| first + dir * k * stride)
        .collect()
}

/// The first centre of a row of `n` centred on `mid`.
fn centred_first(mid: i32, stride: i32, n: u8, toward: i32) -> i32 {
    snap_toward(mid - (i32::from(n) - 1) * stride / 2, toward)
}

fn fits(centres: &[i32], half: i32, lo: i32, hi: i32) -> bool {
    centres.iter().all(|c| c - half >= lo && c + half <= hi)
}

fn row_text(p: &Placement) -> String {
    if p.count > 1 {
        format!("the row of {} {}s", p.count, p.design.slug())
    } else {
        format!("the {}", p.design.slug())
    }
}

#[allow(clippy::too_many_arguments)]
fn wall_row(
    room: &Room,
    plan: &Plan,
    cat: &Catalogue,
    i: usize,
    p: &Placement,
    side: Side,
    from: Option<&Anchor>,
    placed: &[Placed],
) -> Result<Vec<(Pos, u8)>, Issue> {
    let front = match p.facing.unwrap_or(Facing::Away) {
        Facing::Away | Facing::RoomCentre => side.opposite(),
        Facing::Toward => side,
        f => f.compass().unwrap_or(side.opposite()),
    };
    let rot = rot_for(p.design, front);
    let (hx, hz) = cat.half(p.design, rot);
    let along_x = side.runs_along_x();
    let (hp, ha) = if along_x { (hz, hx) } else { (hx, hz) };
    let r = room.rect();
    let inner = room.inner();
    let c = room.centre();
    let gap = studs_mm(p.gap);
    let (perp, perp_lo, perp_hi, perp_c) = match side {
        Side::North => (
            (r.z0 + WALL_MM + gap + hp).max(r.z0 + WALL_CLEARANCE_MM),
            inner.z0,
            inner.z1,
            c.z,
        ),
        Side::South => (
            (r.z1 - WALL_MM - gap - hp).min(r.z1 - WALL_CLEARANCE_MM),
            inner.z0,
            inner.z1,
            c.z,
        ),
        Side::West => (
            (r.x0 + WALL_MM + gap + hp).max(r.x0 + WALL_CLEARANCE_MM),
            inner.x0,
            inner.x1,
            c.x,
        ),
        Side::East => (
            (r.x1 - WALL_MM - gap - hp).min(r.x1 - WALL_CLEARANCE_MM),
            inner.x0,
            inner.x1,
            c.x,
        ),
    };
    let perp = snap_toward(perp, perp_c);
    if perp - hp < perp_lo || perp + hp > perp_hi {
        return Err(Issue::new(
            IssueCode::DoesNotFit,
            Some(i),
            format!(
                "placement {i}: {} is {} deep; {} from wall:{} the room has only {} before the opposite wall",
                row_text(p),
                fmt_m(i64::from(2 * hp)),
                fmt_m(i64::from(gap)),
                side.slug(),
                fmt_m(i64::from(perp_hi - perp_lo - gap)),
            ),
        ));
    }
    let (lo, hi) = inner.span(along_x);
    let (outer_lo, outer_hi) = room.along(side);
    let mid = if along_x { c.x } else { c.z };
    let step = stride(2 * ha, p.spacing);
    let offset = studs_mm(p.offset);
    let parallel = |s: Side| s == side || s == side.opposite();
    // Where the row starts: (first centre, direction)
    let beside = |a: i32, b: i32| -> (i32, i32) {
        if hi - b >= a - lo {
            (snap(b + offset + ha, true), 1)
        } else {
            (snap(a - offset - ha, false), -1)
        }
    };
    let (first, dir) = match from {
        None | Some(Anchor::RoomCentre) => (centred_first(mid, step, p.count, mid), 1),
        Some(Anchor::Wall(s2)) => {
            if parallel(*s2) {
                let meets = if along_x {
                    "west or east"
                } else {
                    "north or south"
                };
                return Err(rel(
                    i,
                    format!(
                        "from wall:{} does not meet wall:{}; use a wall that meets it ({meets})",
                        s2.slug(),
                        side.slug()
                    ),
                ));
            }
            if matches!(s2, Side::West | Side::North) {
                (
                    snap((lo + offset + ha).max(outer_lo + WALL_CLEARANCE_MM), true),
                    1,
                )
            } else {
                (
                    snap((hi - offset - ha).min(outer_hi - WALL_CLEARANCE_MM), false),
                    -1,
                )
            }
        }
        Some(Anchor::Window(n)) => {
            let w = opening(&room.windows, *n, i, "window")?;
            if !parallel(w.side) {
                return Err(rel(
                    i,
                    format!(
                        "window:{n} is in wall:{}, which does not run along wall:{}",
                        w.side.slug(),
                        side.slug()
                    ),
                ));
            }
            let (a, b) = room.span(&w);
            let m = a + (b - a) / 2;
            (centred_first(m, step, p.count, mid), 1)
        }
        Some(Anchor::Door(n)) => {
            let o = opening(&room.doors, *n, i, "door")?;
            if !parallel(o.side) {
                return Err(rel(
                    i,
                    format!(
                        "door:{n} is in wall:{}, which does not run along wall:{}",
                        o.side.slug(),
                        side.slug()
                    ),
                ));
            }
            let (a, b) = room.span(&o);
            beside(a, b)
        }
        Some(a @ (Anchor::Placement(_) | Anchor::Equipment(_))) => {
            let t = target(room, plan, cat, i, a, placed)?;
            let (a, b) = t.rect.span(along_x);
            beside(a, b)
        }
    };
    let centres = row(first, dir, step, p.count);
    if !fits(&centres, ha, lo, hi) {
        let need = (i32::from(p.count) - 1) * step + 2 * ha;
        let room_left = if dir > 0 {
            hi - (first - ha)
        } else {
            (first + ha) - lo
        };
        return Err(Issue::new(
            IssueCode::DoesNotFit,
            Some(i),
            format!(
                "placement {i}: {} needs {} along wall:{}, but only {} are free from where it starts (the wall is {} inside)",
                row_text(p),
                fmt_m(i64::from(need)),
                side.slug(),
                fmt_m(i64::from(room_left.min(hi - lo).max(0))),
                fmt_m(i64::from(hi - lo)),
            ),
        ));
    }
    Ok(centres
        .into_iter()
        .map(|a| {
            let pos = if along_x {
                Pos::new(a, perp)
            } else {
                Pos::new(perp, a)
            };
            (pos, rot)
        })
        .collect())
}

/// Dominant compass direction from `a` to `b`; `None` if they coincide.
fn toward(a: Pos, b: Pos) -> Option<Side> {
    let (dx, dz) = (b.x - a.x, b.z - a.z);
    if dx == 0 && dz == 0 {
        None
    } else if dx.abs() > dz.abs() {
        Some(if dx > 0 { Side::East } else { Side::West })
    } else {
        Some(if dz > 0 { Side::South } else { Side::North })
    }
}

fn item_row(
    room: &Room,
    cat: &Catalogue,
    i: usize,
    p: &Placement,
    t: &Target,
) -> Result<Vec<(Pos, u8)>, Issue> {
    let inner = room.inner();
    let c = room.centre();
    let step_for = |len: i32| stride(len, p.spacing);
    // A ceiling light without a side hangs over the item.
    if p.design.is_ceiling() && p.side.is_none() {
        let (hx, _) = cat.half(p.design, 0);
        let step = step_for(2 * hx);
        let first = centred_first(t.centre.x, step, p.count, c.x);
        let z = snap_toward(t.centre.z, c.z);
        let centres = row(first, 1, step, p.count);
        if !fits(&centres, hx, inner.x0, inner.x1) {
            return Err(Issue::new(
                IssueCode::DoesNotFit,
                Some(i),
                format!(
                    "placement {i}: {} over {} does not fit in the room",
                    row_text(p),
                    t.name
                ),
            ));
        }
        return Ok(centres.into_iter().map(|x| (Pos::new(x, z), 0)).collect());
    }
    let side = p.side.unwrap_or(t.front.opposite());
    let front = match p.facing.unwrap_or(Facing::Away) {
        Facing::Away => side,
        Facing::Toward => side.opposite(),
        Facing::RoomCentre => toward(t.centre, c).unwrap_or(side),
        f => f.compass().unwrap_or(side),
    };
    let rot = rot_for(p.design, front);
    let (hx, hz) = cat.half(p.design, rot);
    let gap = studs_mm(p.gap);
    let perp = match side {
        Side::South => snap(t.rect.z1 + gap + hz, true),
        Side::North => snap(t.rect.z0 - gap - hz, false),
        Side::East => snap(t.rect.x1 + gap + hx, true),
        Side::West => snap(t.rect.x0 - gap - hx, false),
    };
    // the row runs across the side direction (along x for an item north or
    // south of the anchor), centred on the anchor
    let along_x = side.runs_along_x();
    let (ha, mid, cmid, lo, hi) = if along_x {
        (hx, t.centre.x, c.x, inner.x0, inner.x1)
    } else {
        (hz, t.centre.z, c.z, inner.z0, inner.z1)
    };
    let step = step_for(2 * ha);
    let first = centred_first(mid, step, p.count, cmid);
    let centres = row(first, 1, step, p.count);
    let spots: Vec<(Pos, u8)> = centres
        .iter()
        .map(|a| {
            let pos = if along_x {
                Pos::new(*a, perp)
            } else {
                Pos::new(perp, *a)
            };
            (pos, rot)
        })
        .collect();
    let inside = spots.iter().all(|(pos, _)| {
        let (hx, hz) = cat.half(p.design, rot);
        inner.contains_rect(&Rect::around(*pos, hx, hz))
    });
    if !inside || !fits(&centres, ha, lo, hi) {
        return Err(Issue::new(
            IssueCode::DoesNotFit,
            Some(i),
            format!(
                "placement {i}: {} does not fit {} of {} ({} gap); try another side or a wall anchor",
                row_text(p),
                side.slug(),
                t.name,
                fmt_m(i64::from(gap))
            ),
        ));
    }
    Ok(spots)
}

fn centre_row(
    room: &Room,
    cat: &Catalogue,
    i: usize,
    p: &Placement,
) -> Result<Vec<(Pos, u8)>, Issue> {
    let front = p.facing.and_then(Facing::compass).unwrap_or(Side::South);
    let rot = rot_for(p.design, front);
    let (hx, hz) = cat.half(p.design, rot);
    let inner = room.inner();
    let c = room.centre();
    let along_x = room.w_mm >= room.d_mm;
    let (ha, mid, perp, lo, hi) = if along_x {
        (hx, c.x, snap_toward(c.z, c.z), inner.x0, inner.x1)
    } else {
        (hz, c.z, snap_toward(c.x, c.x), inner.z0, inner.z1)
    };
    let step = stride(2 * ha, p.spacing);
    let first = centred_first(mid, step, p.count, mid);
    let centres = row(first, 1, step, p.count);
    if !fits(&centres, ha, lo, hi) {
        return Err(Issue::new(
            IssueCode::DoesNotFit,
            Some(i),
            format!(
                "placement {i}: {} needs {} across the middle; the room has {}",
                row_text(p),
                fmt_m(i64::from((i32::from(p.count) - 1) * step + 2 * ha)),
                fmt_m(i64::from(hi - lo))
            ),
        ));
    }
    Ok(centres
        .into_iter()
        .map(|a| {
            let pos = if along_x {
                Pos::new(a, perp)
            } else {
                Pos::new(perp, a)
            };
            (pos, rot)
        })
        .collect())
}
