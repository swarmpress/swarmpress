//! The compiler: design + params → voxel grid → validation → brick splitter →
//! bricks per colour, studs, surfaces and a [`Summary`] (construction-kit.md §3).
//!
//! Everything here is integer arithmetic over ordered collections, so the same
//! design, parameters and catalogue give the same output natively and in wasm.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

use crate::catalogue::{Face, Kit, PartKind, PartTag, Top};
use crate::design::{
    valid_id, valid_param_name, Arg, Axis, Design, Mount, Op, ParamDef, ParamValue, Params, PartOp,
    Region, Shape, UseOp, DESIGN_FORMAT,
};
use crate::expr::{Env, Num};
use crate::grid::{Cell, Grid, Mat, PART_BIT};
use crate::issue::{Issue, IssueCode};
use crate::split::{split, standard_sizes, top_visible, Candidates};
use crate::summary::{
    PortSummary, Summary, CAPABILITIES, DESK_TOP, MIN_WORK_SURFACE, SEAT_REACH, SEAT_TOP,
};

/// Compile budgets. The defaults hold every shipped design and an 8 × 8 m room shell.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Limits {
    /// Deepest `use` nesting.
    pub max_depth: u32,
    /// Most parts in one build (a design's own `budget` may lower it).
    pub max_parts: u32,
    /// Largest grid (footprint × height), cells.
    pub max_cells: u64,
    /// Most primitive writes (`box`, `fill`, `part`) after expansion.
    pub max_writes: u32,
    /// Largest `repeat` count.
    pub max_repeat: i64,
    /// Longest footprint side, studs (64 m).
    pub max_side: i64,
    /// Tallest build, plates (12 m).
    pub max_height: i64,
    /// Issues collected before the compiler stops.
    pub max_issues: usize,
}

impl Default for Limits {
    fn default() -> Limits {
        Limits {
            max_depth: 8,
            max_parts: 60_000,
            max_cells: 4_000_000,
            max_writes: 200_000,
            max_repeat: 1_024,
            max_side: 1_024,
            max_height: 480,
            max_issues: 64,
        }
    }
}

/// One part in the build. `at` is the min corner `[x, z, y]` (studs, studs,
/// plates); `turn` quarter turns clockwise seen from above.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Brick {
    pub part: String,
    pub at: [u32; 3],
    pub turn: u8,
    pub object: u16,
    /// Construction order (bottom-up: y, then z, then x).
    pub seq: u32,
}

/// Bricks and studs of one colour.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ColourGroup {
    pub colour: String,
    pub bricks: Vec<Brick>,
    /// Stud positions `[x2, z2, y]`: x and z in half studs (a stud on cell
    /// `(x, z)` is at `2x + 1`), y the plate it stands on.
    pub studs: Vec<[u32; 3]>,
}

/// A named information surface on a part (ADR-0063).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Surface {
    pub name: String,
    pub object: u16,
    pub part: String,
    pub seq: u32,
    pub face: Face,
    /// The part's turn: with `face: front` the surface faces south (`+z`) at
    /// turn 0, west at 1, north at 2, east at 3.
    pub turn: u8,
    /// The part's box: min corner `[x, z, y]` and size `[w, d, h]` as built.
    pub at: [u32; 3],
    pub size: [u32; 3],
}

/// A named object: the design itself (id 0) or one `use` of another design.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Object {
    pub id: u16,
    pub name: String,
    pub parent: Option<u16>,
    pub design: String,
}

/// A port with its position evaluated (`[x, z, y]`, a grid point).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PortOut {
    pub id: String,
    pub at: [i64; 3],
    pub accepts: Vec<String>,
    pub turn: u8,
}

/// The compiler's output.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Compiled {
    pub design: String,
    pub hash: String,
    /// Catalogue digest the build was made with.
    pub catalogue: String,
    /// Parameter values used (defaults filled in).
    pub params: Params,
    pub mount: Mount,
    /// `[w, d, h]`: footprint in studs, height in plates.
    pub bounds: [u32; 3],
    /// One group per colour used, in palette order.
    pub groups: Vec<ColourGroup>,
    pub surfaces: Vec<Surface>,
    pub objects: Vec<Object>,
    pub ports: Vec<PortOut>,
    pub summary: Summary,
}

impl Compiled {
    /// Every brick, in construction order, with its colour.
    pub fn bricks(&self) -> Vec<(&str, &Brick)> {
        let mut all: Vec<(&str, &Brick)> = self
            .groups
            .iter()
            .flat_map(|g| g.bricks.iter().map(move |b| (g.colour.as_str(), b)))
            .collect();
        all.sort_by_key(|(_, b)| b.seq);
        all
    }
}

/// Compile a design with the default [`Limits`].
pub fn compile(design: &Design, params: &Params, kit: &Kit) -> Result<Compiled, Vec<Issue>> {
    compile_with(design, params, kit, &Limits::default())
}

/// The summary of a compiled design.
pub fn summary(c: &Compiled) -> Summary {
    c.summary.clone()
}

/// An integer transform of the x/z plane plus a y offset, and its orientation
/// as a quarter-turn count and a mirror flag (the dihedral group of the square).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Xf {
    m: [i64; 4],
    t: [i64; 3],
    rot: u8,
    mirror: bool,
}

impl Xf {
    const ID: Xf = Xf {
        m: [1, 0, 0, 1],
        t: [0, 0, 0],
        rot: 0,
        mirror: false,
    };

    fn translate(t: [i64; 3]) -> Xf {
        Xf { t, ..Xf::ID }
    }

    /// Turn a `w × d` footprint `turn` quarter turns clockwise (seen from
    /// above, x east, z south), keeping its min corner at the origin.
    fn turn_within(turn: u8, w: i64, d: i64) -> Xf {
        match turn % 4 {
            0 => Xf::ID,
            1 => Xf {
                m: [0, -1, 1, 0],
                t: [d, 0, 0],
                rot: 1,
                mirror: false,
            },
            2 => Xf {
                m: [-1, 0, 0, -1],
                t: [w, d, 0],
                rot: 2,
                mirror: false,
            },
            _ => Xf {
                m: [0, 1, -1, 0],
                t: [0, w, 0],
                rot: 3,
                mirror: false,
            },
        }
    }

    fn mirror_within(axis: Axis, w: i64, d: i64) -> Xf {
        match axis {
            Axis::X => Xf {
                m: [-1, 0, 0, 1],
                t: [w, 0, 0],
                rot: 0,
                mirror: true,
            },
            Axis::Z => Xf {
                m: [1, 0, 0, -1],
                t: [0, d, 0],
                rot: 2,
                mirror: true,
            },
        }
    }

    /// `self ∘ inner`.
    fn then(&self, inner: &Xf) -> Xf {
        let [a, b, c, d] = self.m;
        let [e, f, g, h] = inner.m;
        // Matrix entries are -1, 0 or 1; translations saturate so absurd
        // expression values fail the bounds checks instead of overflowing.
        let lin = |p: i64, q: i64, u: i64, v: i64, t: i64| {
            p.saturating_mul(u)
                .saturating_add(q.saturating_mul(v))
                .saturating_add(t)
        };
        Xf {
            m: [a * e + b * g, a * f + b * h, c * e + d * g, c * f + d * h],
            t: [
                lin(a, b, inner.t[0], inner.t[1], self.t[0]),
                lin(c, d, inner.t[0], inner.t[1], self.t[1]),
                inner.t[2].saturating_add(self.t[2]),
            ],
            rot: self.turn(inner.rot),
            mirror: self.mirror ^ inner.mirror,
        }
    }

    /// The final turn of a part turned `t` inside this transform (parts are
    /// left-right symmetric, so a mirror only changes their turn).
    fn turn(&self, t: u8) -> u8 {
        let t = t % 4;
        let t = if self.mirror { (4 - t) % 4 } else { t };
        (self.rot + t) % 4
    }

    fn point(&self, x: i64, z: i64) -> (i64, i64) {
        let [a, b, c, d] = self.m;
        let lin = |p: i64, q: i64, t: i64| {
            p.saturating_mul(x)
                .saturating_add(q.saturating_mul(z))
                .saturating_add(t)
        };
        (lin(a, b, self.t[0]), lin(c, d, self.t[1]))
    }

    /// Map the box `lo..hi` (`[x, z, y]`).
    fn map_box(&self, lo: [i64; 3], hi: [i64; 3]) -> ([i64; 3], [i64; 3]) {
        let (x0, z0) = self.point(lo[0], lo[1]);
        let (x1, z1) = self.point(hi[0], hi[1]);
        (
            [x0.min(x1), z0.min(z1), lo[2].saturating_add(self.t[2])],
            [x0.max(x1), z0.max(z1), hi[2].saturating_add(self.t[2])],
        )
    }
}

/// Whether cell `(i, j)` of a `w × d` box lies in the inscribed ellipse.
fn in_disc(i: i64, j: i64, w: i64, d: i64) -> bool {
    let u = 2 * i + 1 - w;
    let v = 2 * j + 1 - d;
    u * u * d * d + v * v * w * w <= w * w * d * d
}

fn inside(lo: [i64; 3], hi: [i64; 3], bounds: [i64; 3]) -> bool {
    (0..3).all(|k| lo[k] >= 0 && hi[k] <= bounds[k])
}

#[derive(Clone, Debug)]
struct Placed {
    part: u16,
    x: u32,
    y: u32,
    z: u32,
    fx: u32,
    fz: u32,
    h: u32,
    turn: u8,
    colour: u8,
    object: u16,
    surface: Option<String>,
    owner: u32,
}

struct Frame<'d> {
    design: &'d Design,
    env: Env,
    /// `[w, d, h]` of this design.
    bounds: [i64; 3],
    object: u16,
    /// This design's coordinates → the grid's.
    xf: Xf,
}

struct Expander<'k> {
    kit: &'k Kit,
    limits: Limits,
    grid: Grid,
    placed: Vec<Placed>,
    objects: Vec<Object>,
    op_refs: Vec<(String, Vec<u32>)>,
    op_ref_ix: BTreeMap<(String, Vec<u32>), u32>,
    issues: Vec<Issue>,
    stack: Vec<String>,
    writes: u32,
    over_budget: bool,
    surfaces: BTreeSet<(u16, String)>,
}

/// Bind parameter values to a design's declarations. Messages, not issues:
/// the caller knows which design and op they belong to.
fn bind(design: &Design, given: &Params, kit: &Kit) -> Result<(Env, Params), Vec<String>> {
    let mut errs = Vec::new();
    for k in given.keys() {
        if !design.params.contains_key(k) {
            errs.push(format!("unknown parameter {k}"));
        }
    }
    let mut env = Env::default();
    let mut used = Params::new();
    for (name, def) in &design.params {
        if !valid_param_name(name) {
            errs.push(format!("bad parameter name {name:?}"));
            continue;
        }
        let value = given.get(name);
        match def {
            ParamDef::Int { min, max, default } => {
                if !(min <= default && default <= max) {
                    errs.push(format!("{name}: default {default} outside {min}..={max}"));
                    continue;
                }
                match value {
                    None => {
                        env.ints.insert(name.clone(), *default);
                    }
                    Some(ParamValue::Int(v)) if (min..=max).contains(&v) => {
                        env.ints.insert(name.clone(), *v);
                    }
                    Some(ParamValue::Int(v)) => {
                        errs.push(format!("{name} = {v} is outside {min}..={max}"));
                    }
                    Some(ParamValue::Str(s)) => {
                        errs.push(format!("{name} is an integer, got {s:?}"));
                    }
                }
                if let Some(v) = env.ints.get(name) {
                    used.insert(name.clone(), ParamValue::Int(*v));
                }
            }
            ParamDef::Enum { values, default } => {
                if values.is_empty()
                    || !values.iter().all(|v| valid_id(v))
                    || !values.contains(default)
                {
                    errs.push(format!(
                        "{name}: enum values must be ids and hold the default"
                    ));
                    continue;
                }
                match value {
                    None => {
                        env.others.insert(name.clone(), default.clone());
                    }
                    Some(ParamValue::Str(s)) if values.contains(s) => {
                        env.others.insert(name.clone(), s.clone());
                    }
                    Some(v) => errs.push(format!("{name} must be one of {values:?}, got {v:?}")),
                }
                if let Some(v) = env.others.get(name) {
                    used.insert(name.clone(), ParamValue::Str(v.clone()));
                }
            }
            ParamDef::Colour { default, allowed } => {
                let ok = |c: &String| {
                    kit.colour_index(c).is_some() && (allowed.is_empty() || allowed.contains(c))
                };
                if !ok(default) || !allowed.iter().all(|c| kit.colour_index(c).is_some()) {
                    errs.push(format!(
                        "{name}: unknown or disallowed default colour {default}"
                    ));
                    continue;
                }
                match value {
                    None => {
                        env.others.insert(name.clone(), default.clone());
                    }
                    Some(ParamValue::Str(s)) if ok(s) => {
                        env.others.insert(name.clone(), s.clone());
                    }
                    Some(v) => errs.push(format!("{name}: {v:?} is not an allowed colour")),
                }
                if let Some(v) = env.others.get(name) {
                    used.insert(name.clone(), ParamValue::Str(v.clone()));
                }
            }
        }
    }
    if errs.is_empty() {
        Ok((env, used))
    } else {
        Err(errs)
    }
}

impl<'k> Expander<'k> {
    fn stopped(&self) -> bool {
        self.over_budget || self.issues.len() >= self.limits.max_issues
    }

    fn issue(&mut self, code: IssueCode, design: &str, path: &[u32], msg: impl Into<String>) {
        if self.issues.len() < self.limits.max_issues {
            self.issues.push(Issue::new(code, design, path, msg));
        }
    }

    fn op_ref(&mut self, design: &str, path: &[u32]) -> u32 {
        let key = (design.to_string(), path.to_vec());
        if let Some(&r) = self.op_ref_ix.get(&key) {
            return r;
        }
        let r = u32::try_from(self.op_refs.len()).unwrap_or(u32::MAX >> 1);
        self.op_refs.push(key.clone());
        self.op_ref_ix.insert(key, r);
        r
    }

    /// `(design, path)` of a cell owner.
    fn owner_op(&self, owner: u32) -> (String, Vec<u32>) {
        let r = if owner & PART_BIT != 0 {
            self.placed[(owner & !PART_BIT) as usize].owner
        } else {
            owner
        };
        self.op_refs.get(r as usize).cloned().unwrap_or_default()
    }

    fn describe_owner(&self, owner: u32) -> String {
        let (d, p) = self.owner_op(owner);
        let what = if owner & PART_BIT != 0 {
            let pl = &self.placed[(owner & !PART_BIT) as usize];
            format!("part {}", self.kit.part(pl.part).id)
        } else {
            "bricks".to_string()
        };
        let path: Vec<String> = p.iter().map(u32::to_string).collect();
        format!("{what} of {d} ops[{}]", path.join("]["))
    }

    fn eval(&mut self, f: &Frame, n: &Num, path: &[u32], what: &str) -> Option<i64> {
        match n.eval(&f.env) {
            Ok(v) => Some(v),
            Err(e) => {
                self.issue(
                    IssueCode::BadExpression,
                    &f.design.id,
                    path,
                    format!("{what}: {e}"),
                );
                None
            }
        }
    }

    fn eval3(&mut self, f: &Frame, n: &[Num; 3], path: &[u32], what: &str) -> Option<[i64; 3]> {
        let a = self.eval(f, &n[0], path, what);
        let b = self.eval(f, &n[1], path, what);
        let c = self.eval(f, &n[2], path, what);
        Some([a?, b?, c?])
    }

    fn turn(&mut self, f: &Frame, n: &Num, path: &[u32]) -> Option<u8> {
        let t = self.eval(f, n, path, "turn")?;
        match u8::try_from(t) {
            Ok(t) if t < 4 => Some(t),
            _ => {
                self.issue(
                    IssueCode::BadOp,
                    &f.design.id,
                    path,
                    format!("turn {t} is not 0..=3"),
                );
                None
            }
        }
    }

    /// A string that may be `$param` (an enum or colour parameter).
    fn resolve(&mut self, f: &Frame, s: &str, path: &[u32], what: &str) -> Option<String> {
        let Some(name) = s.strip_prefix('$') else {
            return Some(s.to_string());
        };
        if let Some(v) = f.env.others.get(name) {
            return Some(v.clone());
        }
        let msg = if f.env.ints.contains_key(name) {
            format!("{what}: ${name} is an integer parameter")
        } else {
            format!("{what}: unknown parameter ${name}")
        };
        self.issue(IssueCode::BadParam, &f.design.id, path, msg);
        None
    }

    fn colour(&mut self, f: &Frame, s: &str, path: &[u32]) -> Option<u8> {
        let id = self.resolve(f, s, path, "colour")?;
        match self.kit.colour_index(&id) {
            Some(ix) => Some(ix),
            None => {
                self.issue(
                    IssueCode::UnknownColour,
                    &f.design.id,
                    path,
                    format!("unknown colour {id}"),
                );
                None
            }
        }
    }

    fn count_write(&mut self, f: &Frame, path: &[u32]) -> bool {
        self.writes += 1;
        if self.writes > self.limits.max_writes {
            if !self.over_budget {
                self.issue(
                    IssueCode::OverBudget,
                    &f.design.id,
                    path,
                    format!(
                        "more than {} writes after expansion",
                        self.limits.max_writes
                    ),
                );
            }
            self.over_budget = true;
            return false;
        }
        true
    }

    fn outside(&mut self, f: &Frame, path: &[u32], lo: [i64; 3], hi: [i64; 3]) {
        self.issue(
            IssueCode::OutsideFootprint,
            &f.design.id,
            path,
            format!(
                "[{}, {}, {}]..[{}, {}, {}] is outside 0..[{}, {}, {}]",
                lo[0], lo[1], lo[2], hi[0], hi[1], hi[2], f.bounds[0], f.bounds[1], f.bounds[2]
            ),
        );
    }

    /// Whether a root box lies in the grid (always, when the frames nest).
    fn in_grid(&self, lo: [i64; 3], hi: [i64; 3]) -> bool {
        inside(
            lo,
            hi,
            [
                i64::from(self.grid.w),
                i64::from(self.grid.d),
                i64::from(self.grid.h),
            ],
        )
    }

    /// Run `ops` of frame `f`; `lxf` is the transform of enclosing `repeat`
    /// and `mirror` ops inside the frame's own coordinates.
    fn run(&mut self, f: &Frame, ops: &[Op], path: &mut Vec<u32>, lxf: Xf) {
        for (i, op) in ops.iter().enumerate() {
            if self.stopped() {
                return;
            }
            path.push(u32::try_from(i).unwrap_or(u32::MAX));
            match op {
                Op::Box(r) => self.region(f, r, path, &lxf, false),
                Op::Fill(r) => self.region(f, r, path, &lxf, true),
                Op::Part(p) => self.part(f, p, path, &lxf),
                Op::Use(u) => self.use_op(f, u, path, &lxf),
                Op::Mirror(m) => {
                    self.run(f, &m.ops, path, lxf);
                    let mx = lxf.then(&Xf::mirror_within(m.axis, f.bounds[0], f.bounds[1]));
                    self.run(f, &m.ops, path, mx);
                }
                Op::Repeat(r) => {
                    let count = self.eval(f, &r.count, path, "count");
                    let step = self.eval3(f, &r.step, path, "step");
                    if let (Some(count), Some(step)) = (count, step) {
                        if !(0..=self.limits.max_repeat).contains(&count) {
                            self.issue(
                                IssueCode::BadOp,
                                &f.design.id,
                                path,
                                format!(
                                    "repeat count {count} is not 0..={}",
                                    self.limits.max_repeat
                                ),
                            );
                        } else {
                            for k in 0..count {
                                let t = step.map(|s| s.saturating_mul(k));
                                self.run(f, &r.ops, path, lxf.then(&Xf::translate(t)));
                                if self.stopped() {
                                    break;
                                }
                            }
                        }
                    }
                }
            }
            path.pop();
        }
    }

    fn region(&mut self, f: &Frame, r: &Region, path: &[u32], lxf: &Xf, fill: bool) {
        let at = self.eval3(f, &r.at, path, "at");
        let size = self.eval3(f, &r.size, path, "size");
        let (Some(at), Some(size)) = (at, size) else {
            return;
        };
        let id = f.design.id.as_str();
        if size.iter().any(|&s| s < 1) {
            self.issue(IssueCode::BadOp, id, path, "every size must be at least 1");
            return;
        }
        let mat = match r.part.as_str() {
            "brick" => Mat::Brick,
            "plate" => Mat::Plate,
            "tile" => Mat::Tile,
            "empty" if !fill => Mat::Empty,
            other => {
                let msg = format!(
                    "material {other:?} is not brick, plate, tile{}",
                    if fill { "" } else { " or empty" }
                );
                self.issue(IssueCode::UnknownPart, id, path, msg);
                return;
            }
        };
        let colour = if mat == Mat::Empty {
            if r.colour.is_some() {
                self.issue(IssueCode::BadOp, id, path, "an empty box has no colour");
                return;
            }
            0
        } else {
            let Some(c) = &r.colour else {
                self.issue(IssueCode::BadOp, id, path, "a colour is required");
                return;
            };
            let Some(ix) = self.colour(f, c, path) else {
                return;
            };
            let kind = match mat {
                Mat::Brick => PartKind::Brick,
                Mat::Plate => PartKind::Plate,
                _ => PartKind::Tile,
            };
            let class = self.kit.colour(ix).class;
            if !self.kit.material_allows(kind, class) {
                let msg = format!("{} does not come in {}", r.part, self.kit.colour(ix).id);
                self.issue(IssueCode::ColourNotAllowed, id, path, msg);
                return;
            }
            ix
        };
        let (lo, hi) = lxf.map_box(
            at,
            [
                at[0].saturating_add(size[0]),
                at[1].saturating_add(size[1]),
                at[2].saturating_add(size[2]),
            ],
        );
        if !inside(lo, hi, f.bounds) {
            self.outside(f, path, lo, hi);
            return;
        }
        if !self.count_write(f, path) {
            return;
        }
        let (lo, hi) = f.xf.map_box(lo, hi);
        if !self.in_grid(lo, hi) {
            self.outside(f, path, lo, hi);
            return;
        }
        let owner = self.op_ref(id, path);
        let (rw, rd) = (hi[0] - lo[0], hi[1] - lo[1]);
        let mut overlap = None;
        for y in lo[2]..hi[2] {
            for z in lo[1]..hi[1] {
                for x in lo[0]..hi[0] {
                    if r.shape == Shape::Disc && !in_disc(x - lo[0], z - lo[1], rw, rd) {
                        continue;
                    }
                    let i = self.grid.idx(x as u32, y as u32, z as u32);
                    let c = self.grid.cells[i];
                    if fill && !c.is_empty() {
                        continue;
                    }
                    if c.mat == Mat::Part {
                        overlap.get_or_insert(c.owner);
                        continue;
                    }
                    self.grid.cells[i] = if mat == Mat::Empty {
                        Cell::default()
                    } else {
                        Cell {
                            mat,
                            colour,
                            object: f.object,
                            owner,
                        }
                    };
                }
            }
        }
        if let Some(o) = overlap {
            let msg = format!("writes into {}", self.describe_owner(o));
            self.issue(IssueCode::Overlap, id, path, msg);
        }
    }

    fn part(&mut self, f: &Frame, p: &PartOp, path: &[u32], lxf: &Xf) {
        let kit = self.kit;
        let id = f.design.id.as_str();
        let Some(pid) = self.resolve(f, &p.part, path, "part") else {
            return;
        };
        let Some(pix) = kit.part_index(&pid) else {
            self.issue(
                IssueCode::UnknownPart,
                id,
                path,
                format!("unknown part {pid}"),
            );
            return;
        };
        let def = kit.part(pix);
        let colour = match (&p.colour, &def.colour) {
            (Some(c), _) => self.colour(f, c, path),
            (None, Some(c)) => kit.colour_index(c),
            (None, None) => {
                self.issue(IssueCode::BadOp, id, path, format!("{pid} needs a colour"));
                None
            }
        };
        let turn = self.turn(f, &p.turn, path);
        let at = self.eval3(f, &p.at, path, "at");
        let (Some(colour), Some(turn), Some(at)) = (colour, turn, at) else {
            return;
        };
        if !def.colours.contains(&kit.colour(colour).class) {
            let msg = format!("{pid} does not come in {}", kit.colour(colour).id);
            self.issue(IssueCode::ColourNotAllowed, id, path, msg);
            return;
        }
        let [w, d, h] = def.size.map(i64::from);
        let (fx, fz) = if turn.is_multiple_of(2) {
            (w, d)
        } else {
            (d, w)
        };
        let (lo, hi) = lxf.map_box(
            at,
            [
                at[0].saturating_add([fx, fz, h][0]),
                at[1].saturating_add([fx, fz, h][1]),
                at[2].saturating_add([fx, fz, h][2]),
            ],
        );
        if !inside(lo, hi, f.bounds) {
            self.outside(f, path, lo, hi);
            return;
        }
        if !self.count_write(f, path) {
            return;
        }
        let (lo, hi) = f.xf.map_box(lo, hi);
        if !self.in_grid(lo, hi) {
            self.outside(f, path, lo, hi);
            return;
        }
        let mut hit = None;
        'scan: for y in lo[2]..hi[2] {
            for z in lo[1]..hi[1] {
                for x in lo[0]..hi[0] {
                    let c = self.grid.at(x as u32, y as u32, z as u32);
                    if !c.is_empty() {
                        hit = Some(c.owner);
                        break 'scan;
                    }
                }
            }
        }
        if let Some(o) = hit {
            let msg = format!("{pid} overlaps {}", self.describe_owner(o));
            self.issue(IssueCode::Overlap, id, path, msg);
            return;
        }
        if let Some(name) = &p.surface {
            if def.surface.is_none() {
                self.issue(
                    IssueCode::BadSurface,
                    id,
                    path,
                    format!("{pid} has no surface face"),
                );
                return;
            }
            if !valid_id(name) || !self.surfaces.insert((f.object, name.clone())) {
                let msg = format!("surface name {name:?} is not a new id in this object");
                self.issue(IssueCode::BadSurface, id, path, msg);
                return;
            }
        }
        let owner = self.op_ref(id, path);
        let ix = u32::try_from(self.placed.len()).unwrap_or(0) | PART_BIT;
        for y in lo[2]..hi[2] {
            for z in lo[1]..hi[1] {
                for x in lo[0]..hi[0] {
                    let i = self.grid.idx(x as u32, y as u32, z as u32);
                    self.grid.cells[i] = Cell {
                        mat: Mat::Part,
                        colour,
                        object: f.object,
                        owner: ix,
                    };
                }
            }
        }
        self.placed.push(Placed {
            part: pix,
            x: lo[0] as u32,
            y: lo[2] as u32,
            z: lo[1] as u32,
            fx: (hi[0] - lo[0]) as u32,
            fz: (hi[1] - lo[1]) as u32,
            h: h as u32,
            turn: f.xf.turn(lxf.turn(turn)),
            colour,
            object: f.object,
            surface: p.surface.clone(),
            owner,
        });
    }

    fn use_op(&mut self, f: &Frame, u: &UseOp, path: &mut Vec<u32>, lxf: &Xf) {
        let kit = self.kit;
        let id = f.design.id.as_str();
        let Some(did) = self.resolve(f, &u.design, path, "design") else {
            return;
        };
        let Some(child) = kit.design(&did) else {
            self.issue(
                IssueCode::UnknownDesign,
                id,
                path,
                format!("no design {did}"),
            );
            return;
        };
        if self.stack.contains(&did) {
            let chain = format!("{} → {did}", self.stack.join(" → "));
            self.issue(IssueCode::CyclicUse, id, path, chain);
            return;
        }
        if u32::try_from(self.stack.len()).unwrap_or(u32::MAX) >= self.limits.max_depth {
            let msg = format!("use is nested deeper than {}", self.limits.max_depth);
            self.issue(IssueCode::DepthExceeded, id, path, msg);
            return;
        }
        if let Some(h) = &u.hash {
            if kit.design_hash(&did) != Some(h.as_str()) {
                let msg = format!("{did} does not have hash {h}");
                self.issue(IssueCode::HashMismatch, id, path, msg);
                return;
            }
        }
        let mut values = Params::new();
        let mut ok = true;
        for (name, arg) in &u.params {
            let Some(def) = child.params.get(name) else {
                self.issue(
                    IssueCode::BadParam,
                    id,
                    path,
                    format!("{did} has no parameter {name}"),
                );
                ok = false;
                continue;
            };
            let v = match (def, arg) {
                (ParamDef::Int { .. }, Arg::Int(n)) => Some(ParamValue::Int(*n)),
                (ParamDef::Int { .. }, Arg::Str(s)) => self
                    .eval(f, &Num::Expr(s.clone()), path, name)
                    .map(ParamValue::Int),
                (_, Arg::Str(s)) => self.resolve(f, s, path, name).map(ParamValue::Str),
                (_, Arg::Int(n)) => {
                    let msg = format!("{did}.{name} takes an id, got {n}");
                    self.issue(IssueCode::BadParam, id, path, msg);
                    None
                }
            };
            match v {
                Some(v) => {
                    values.insert(name.clone(), v);
                }
                None => ok = false,
            }
        }
        if !ok {
            return;
        }
        let env = match bind(child, &values, kit) {
            Ok((env, _)) => env,
            Err(errs) => {
                for e in errs {
                    self.issue(IssueCode::BadParam, id, path, format!("{did}: {e}"));
                }
                return;
            }
        };
        let cf0 = Frame {
            design: child,
            env,
            bounds: [0, 0, 0],
            object: f.object,
            xf: Xf::ID,
        };
        let cw = self.eval(&cf0, &child.footprint[0], path, "footprint");
        let cd = self.eval(&cf0, &child.footprint[1], path, "footprint");
        let ch = self.eval(&cf0, &child.height, path, "height");
        let turn = self.turn(f, &u.turn, path);
        let at = self.eval3(f, &u.at, path, "at");
        let (Some(cw), Some(cd), Some(ch), Some(turn), Some(at)) = (cw, cd, ch, turn, at) else {
            return;
        };
        if cw < 1 || cd < 1 || ch < 1 {
            self.issue(
                IssueCode::BadOp,
                &did,
                path,
                "footprint and height must be at least 1",
            );
            return;
        }
        let (fx, fz) = if turn.is_multiple_of(2) {
            (cw, cd)
        } else {
            (cd, cw)
        };
        let (lo, hi) = lxf.map_box(
            at,
            [
                at[0].saturating_add([fx, fz, ch][0]),
                at[1].saturating_add([fx, fz, ch][1]),
                at[2].saturating_add([fx, fz, ch][2]),
            ],
        );
        if !inside(lo, hi, f.bounds) {
            self.outside(f, path, lo, hi);
            return;
        }
        let Ok(oid) = u16::try_from(self.objects.len()) else {
            self.issue(IssueCode::OverBudget, id, path, "more than 65,535 objects");
            self.over_budget = true;
            return;
        };
        self.objects.push(Object {
            id: oid,
            name: u.name.clone().unwrap_or_else(|| did.clone()),
            parent: Some(f.object),
            design: did.clone(),
        });
        let cxf =
            f.xf.then(lxf)
                .then(&Xf::translate(at))
                .then(&Xf::turn_within(turn, cw, cd));
        let cf = Frame {
            design: child,
            env: cf0.env,
            bounds: [cw, cd, ch],
            object: oid,
            xf: cxf,
        };
        self.stack.push(did);
        self.run(&cf, &child.ops, path, Xf::ID);
        self.stack.pop();
    }
}

/// Unground components: `(owner of the first cell in scan order, cells)`.
fn floating(grid: &Grid, mount: Mount) -> Vec<(u32, usize)> {
    let n = grid.cells.len();
    let (w, d, h) = (grid.w as usize, grid.d as usize, grid.h as usize);
    let layer = w * d;
    let mut seen = vec![false; n];
    let mut stack = Vec::new();
    let ground_y = match mount {
        Mount::Ceiling => h.saturating_sub(1),
        Mount::Floor | Mount::Surface => 0,
    };
    let flood = |seen: &mut Vec<bool>, stack: &mut Vec<usize>| -> usize {
        let mut count = 0;
        while let Some(i) = stack.pop() {
            count += 1;
            let x = i % w;
            let z = (i / w) % d;
            let y = i / layer;
            let visit = |j: usize, seen: &mut Vec<bool>, stack: &mut Vec<usize>| {
                if !seen[j] && !grid.cells[j].is_empty() {
                    seen[j] = true;
                    stack.push(j);
                }
            };
            if x > 0 {
                visit(i - 1, seen, stack);
            }
            if x + 1 < w {
                visit(i + 1, seen, stack);
            }
            if z > 0 {
                visit(i - w, seen, stack);
            }
            if z + 1 < d {
                visit(i + w, seen, stack);
            }
            if y > 0 {
                visit(i - layer, seen, stack);
            }
            if y + 1 < h {
                visit(i + layer, seen, stack);
            }
        }
        count
    };
    if h > 0 {
        let base = ground_y * layer;
        for (k, cell) in grid.cells[base..base + layer].iter().enumerate() {
            if !cell.is_empty() {
                seen[base + k] = true;
                stack.push(base + k);
            }
        }
    }
    flood(&mut seen, &mut stack);
    let mut out = Vec::new();
    for i in 0..n {
        if !grid.cells[i].is_empty() && !seen[i] {
            seen[i] = true;
            stack.push(i);
            let cells = flood(&mut seen, &mut stack);
            out.push((grid.cells[i].owner, cells));
        }
    }
    out
}

/// One part of the build, before grouping by colour.
struct Item {
    part: u16,
    x: u32,
    y: u32,
    z: u32,
    fx: u32,
    fz: u32,
    h: u32,
    turn: u8,
    colour: u8,
    object: u16,
    /// Index into the placed parts (none for split bricks).
    placed: Option<usize>,
    /// Studs on top: per cell, one in the centre, or none.
    top: Top,
}

fn static_checks(design: &Design) -> Vec<Issue> {
    let id = design.id.as_str();
    let mut issues = Vec::new();
    if design.format != DESIGN_FORMAT {
        issues.push(Issue::design(
            IssueCode::BadFormat,
            id,
            format!("format must be {DESIGN_FORMAT}"),
        ));
    }
    if !valid_id(id) {
        issues.push(Issue::design(IssueCode::BadFormat, id, "bad design id"));
    }
    if design.name.trim().is_empty() || design.name.chars().count() > 80 {
        issues.push(Issue::design(
            IssueCode::BadFormat,
            id,
            "name must be 1..=80 characters",
        ));
    }
    for t in &design.tags {
        if !valid_id(t) {
            issues.push(Issue::design(
                IssueCode::BadFormat,
                id,
                format!("bad tag {t:?}"),
            ));
        }
    }
    issues
}

/// Compile with explicit limits.
pub fn compile_with(
    design: &Design,
    params: &Params,
    kit: &Kit,
    limits: &Limits,
) -> Result<Compiled, Vec<Issue>> {
    let id = design.id.as_str();
    let mut issues = static_checks(design);
    let hash = match design.hash() {
        Ok(h) => h,
        Err(e) => {
            issues.extend(e);
            return Err(issues);
        }
    };
    if !issues.is_empty() {
        return Err(issues);
    }
    let (env, used) = bind(design, params, kit).map_err(|errs| {
        errs.into_iter()
            .map(|e| Issue::design(IssueCode::BadParam, id, e))
            .collect::<Vec<_>>()
    })?;
    let bad_expr = |what: &str, e: crate::expr::ExprError| {
        vec![Issue::design(
            IssueCode::BadExpression,
            id,
            format!("{what}: {e}"),
        )]
    };
    let w = design.footprint[0]
        .eval(&env)
        .map_err(|e| bad_expr("footprint", e))?;
    let d = design.footprint[1]
        .eval(&env)
        .map_err(|e| bad_expr("footprint", e))?;
    let h = design
        .height
        .eval(&env)
        .map_err(|e| bad_expr("height", e))?;
    if w < 1 || d < 1 || h < 1 {
        return Err(vec![Issue::design(
            IssueCode::BadOp,
            id,
            "footprint and height must be at least 1",
        )]);
    }
    let cells = u64::try_from(w * d * h).unwrap_or(u64::MAX);
    if w > limits.max_side
        || d > limits.max_side
        || h > limits.max_height
        || cells > limits.max_cells
    {
        return Err(vec![Issue::design(
            IssueCode::OverBudget,
            id,
            format!(
                "{w} × {d} studs × {h} plates is over the limits ({} studs a side, {} plates, {} cells)",
                limits.max_side, limits.max_height, limits.max_cells
            ),
        )]);
    }
    let (gw, gd, gh) = (w as u32, d as u32, h as u32);
    let mut ex = Expander {
        kit,
        limits: *limits,
        grid: Grid::new(gw, gd, gh),
        placed: Vec::new(),
        objects: vec![Object {
            id: 0,
            name: design.id.clone(),
            parent: None,
            design: design.id.clone(),
        }],
        op_refs: Vec::new(),
        op_ref_ix: BTreeMap::new(),
        issues: Vec::new(),
        stack: vec![design.id.clone()],
        writes: 0,
        over_budget: false,
        surfaces: BTreeSet::new(),
    };
    let frame = Frame {
        design,
        env,
        bounds: [w, d, h],
        object: 0,
        xf: Xf::ID,
    };
    let mut path = Vec::new();
    ex.run(&frame, &design.ops, &mut path, Xf::ID);
    if !ex.issues.is_empty() {
        return Err(ex.issues);
    }

    // No floating bricks.
    for (owner, cells) in floating(&ex.grid, design.mount) {
        let (d_id, p) = ex.owner_op(owner);
        let ground = match design.mount {
            Mount::Ceiling => "the ceiling",
            _ => "the ground",
        };
        let msg = format!(
            "{cells} cells touch neither {ground} nor anything that does ({})",
            ex.describe_owner(owner)
        );
        ex.issue(IssueCode::Floating, &d_id, &p, msg);
    }

    // Ports.
    let mut ports = Vec::new();
    let mut port_ids = BTreeSet::new();
    for port in &design.ports {
        let at = ex.eval3(&frame, &port.at, &[], "port");
        let turn = ex.turn(&frame, &port.turn, &[]);
        let (Some(at), Some(turn)) = (at, turn) else {
            continue;
        };
        let fail = |ex: &mut Expander, m: String| {
            ex.issue(
                IssueCode::BadPort,
                id,
                &[],
                format!("port {}: {m}", port.id),
            );
        };
        if !valid_id(&port.id) || !port_ids.insert(port.id.clone()) {
            fail(&mut ex, "ids must be unique kebab-case".into());
            continue;
        }
        if port.accepts.is_empty() || !port.accepts.iter().all(|a| valid_id(a)) {
            fail(&mut ex, "accepts must list tags".into());
            continue;
        }
        let [x, z, y] = at;
        if port.accepts.iter().any(|a| a == "seat") {
            let ok = y == 0
                && (-SEAT_REACH..=w + SEAT_REACH).contains(&x)
                && (-SEAT_REACH..=d + SEAT_REACH).contains(&z);
            if !ok {
                fail(&mut ex, format!("a seat port stands on the floor within {SEAT_REACH} studs of the footprint"));
                continue;
            }
        } else {
            let on = (0..=w).contains(&x)
                && (0..=d).contains(&z)
                && (1..=h).contains(&y)
                && [(x - 1, z - 1), (x, z - 1), (x - 1, z), (x, z)]
                    .iter()
                    .any(|&(cx, cz)| ex.grid.occupied(cx, y - 1, cz));
            if !on {
                fail(&mut ex, "does not stand on the build".into());
                continue;
            }
        }
        ports.push(PortOut {
            id: port.id.clone(),
            at,
            accepts: port.accepts.clone(),
            turn,
        });
    }
    if !ex.issues.is_empty() {
        return Err(ex.issues);
    }

    // Split and order.
    let standard: BTreeMap<(PartKind, u32, u32), u16> = standard_sizes()
        .into_iter()
        .flat_map(|(k, sizes)| sizes.into_iter().map(move |(a, b)| (k, a, b)))
        .filter_map(|(k, a, b)| {
            kit.part_index(&crate::catalogue::standard_id(k, a, b))
                .map(|ix| ((k, a, b), ix))
        })
        .collect();
    let mut items: Vec<Item> = Vec::new();
    for p in split(&ex.grid, &Candidates::new()) {
        let kind = p.kind();
        let key = (kind, p.fx.min(p.fz), p.fx.max(p.fz));
        let Some(&part) = standard.get(&key) else {
            // Loading the kit guarantees every splitter size exists.
            continue;
        };
        items.push(Item {
            part,
            x: p.x,
            y: p.y,
            z: p.z,
            fx: p.fx,
            fz: p.fz,
            h: p.h,
            turn: p.turn(),
            colour: p.colour,
            object: p.object,
            placed: None,
            top: if kind == PartKind::Tile {
                Top::Smooth
            } else {
                Top::Studs
            },
        });
    }
    for (i, pl) in ex.placed.iter().enumerate() {
        items.push(Item {
            part: pl.part,
            x: pl.x,
            y: pl.y,
            z: pl.z,
            fx: pl.fx,
            fz: pl.fz,
            h: pl.h,
            turn: pl.turn,
            colour: pl.colour,
            object: pl.object,
            placed: Some(i),
            top: kit.part(pl.part).top,
        });
    }
    // Every item owns its min corner cell, so (y, z, x) is a total order.
    items.sort_by_key(|it| (it.y, it.z, it.x));

    let budget = design
        .budget
        .map_or(limits.max_parts, |b| b.parts.min(limits.max_parts));
    let part_count = u32::try_from(items.len()).unwrap_or(u32::MAX);
    if part_count > budget {
        ex.issue(
            IssueCode::OverBudget,
            id,
            &[],
            format!("{part_count} parts, the budget is {budget}"),
        );
        return Err(ex.issues);
    }

    // Groups, studs, surfaces, summary counts.
    let grid = &ex.grid;
    let mut groups: BTreeMap<u8, ColourGroup> = BTreeMap::new();
    let mut surfaces = Vec::new();
    let mut s = Summary {
        design: design.id.clone(),
        hash: hash.clone(),
        mount: design.mount,
        footprint: [gw, gd],
        height: 0,
        tags: {
            let mut t = design.tags.clone();
            t.sort();
            t.dedup();
            t
        },
        capabilities: Vec::new(),
        seats: 0,
        workstation: false,
        work_surface: 0,
        lights: 0,
        storage: 0,
        screens: 0,
        doors: 0,
        windows: 0,
        surfaces: Vec::new(),
        ports: ports
            .iter()
            .map(|p| PortSummary {
                id: p.id.clone(),
                accepts: p.accepts.clone(),
            })
            .collect(),
        parts: part_count,
        studs: 0,
        cost: 0,
    };
    let mut paper_or_screen = false;
    for (seq, it) in items.iter().enumerate() {
        let seq = u32::try_from(seq).unwrap_or(u32::MAX);
        let def = kit.part(it.part);
        let group = groups.entry(it.colour).or_insert_with(|| ColourGroup {
            colour: kit.colour(it.colour).id.clone(),
            bricks: Vec::new(),
            studs: Vec::new(),
        });
        group.bricks.push(Brick {
            part: def.id.clone(),
            at: [it.x, it.z, it.y],
            turn: it.turn,
            object: it.object,
            seq,
        });
        let top = it.y + it.h;
        match it.top {
            Top::Studs => {
                for a in 0..it.fx {
                    for b in 0..it.fz {
                        if top_visible(grid, it.x + a, top, it.z + b) {
                            group
                                .studs
                                .push([2 * (it.x + a) + 1, 2 * (it.z + b) + 1, top]);
                        }
                    }
                }
            }
            Top::Stud => {
                let clear = (0..it.fx)
                    .all(|a| (0..it.fz).all(|b| top_visible(grid, it.x + a, top, it.z + b)));
                if clear {
                    group.studs.push([2 * it.x + it.fx, 2 * it.z + it.fz, top]);
                }
            }
            Top::Smooth => {}
        }
        s.height = s.height.max(top);
        s.cost += u64::from(def.cost);
        if def.has_tag(PartTag::Seat) && SEAT_TOP.contains(&top) {
            s.seats += 1;
        }
        if def.has_tag(PartTag::LightEmitter) {
            s.lights += 1;
        }
        if def.has_tag(PartTag::Shelf) {
            s.storage += it.fx * it.fz;
        }
        if def.has_tag(PartTag::Screen) {
            s.screens += 1;
        }
        if def.has_tag(PartTag::Door) {
            s.doors += 1;
        }
        if def.has_tag(PartTag::Window) {
            s.windows += 1;
        }
        if def.has_tag(PartTag::Screen) || def.has_tag(PartTag::Paper) {
            paper_or_screen = true;
        }
        if let Some(pi) = it.placed {
            if let (Some(name), Some(face)) = (&ex.placed[pi].surface, def.surface) {
                s.surfaces.push(name.clone());
                surfaces.push(Surface {
                    name: name.clone(),
                    object: it.object,
                    part: def.id.clone(),
                    seq,
                    face,
                    turn: it.turn,
                    at: [it.x, it.z, it.y],
                    size: [it.fx, it.fz, it.h],
                });
            }
        }
    }
    s.studs = groups
        .values()
        .map(|g| u32::try_from(g.studs.len()).unwrap_or(u32::MAX))
        .sum();
    s.work_surface = work_surface(grid);
    let seat_port = ports.iter().any(|p| p.accepts.iter().any(|a| a == "seat"));
    s.workstation = s.work_surface >= MIN_WORK_SURFACE && paper_or_screen && seat_port;
    s.derive_capabilities();
    for t in &s.tags {
        if CAPABILITIES.contains(&t.as_str()) && !s.has_capability(t) {
            ex.issue(
                IssueCode::TagNotMet,
                id,
                &[],
                format!("declares {t} but the build does not qualify"),
            );
        }
    }
    if !ex.issues.is_empty() {
        return Err(ex.issues);
    }
    Ok(Compiled {
        design: design.id.clone(),
        hash,
        catalogue: kit.catalogue_hash().to_string(),
        params: used,
        mount: design.mount,
        bounds: [gw, gd, gh],
        groups: groups.into_values().collect(),
        surfaces,
        objects: ex.objects,
        ports,
        summary: s,
    })
}

/// The largest flat area at desk height whose cells carry nothing but parts.
fn work_surface(grid: &Grid) -> u32 {
    let mut best = 0;
    for top in DESK_TOP {
        if top == 0 || top > grid.h {
            continue;
        }
        let mut n = 0;
        for z in 0..grid.d {
            for x in 0..grid.w {
                if grid.at(x, top - 1, z).is_empty() {
                    continue;
                }
                if top >= grid.h || matches!(grid.at(x, top, z).mat, Mat::Empty | Mat::Part) {
                    n += 1;
                }
            }
        }
        best = best.max(n);
    }
    best
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transforms_compose_like_the_dihedral_group() {
        // A 4 × 2 footprint turned once becomes 2 × 4 with its min corner at 0.
        let t = Xf::turn_within(1, 4, 2);
        assert_eq!(t.map_box([0, 0, 0], [4, 2, 1]), ([0, 0, 0], [2, 4, 1]));
        // Cell (0, 0) of the 4 × 2 goes to (1, 0) (x' = d - 1 - z).
        assert_eq!(t.map_box([0, 0, 0], [1, 1, 1]), ([1, 0, 0], [2, 1, 1]));
        // Four turns are the identity.
        let mut x = Xf::ID;
        for _ in 0..4 {
            x = x.then(&Xf::turn_within(1, 3, 3));
        }
        assert_eq!(x.m, Xf::ID.m);
        assert_eq!(x.rot, 0);
        // Mirroring twice is the identity; mirroring flips a turn.
        let m = Xf::mirror_within(Axis::X, 10, 4);
        assert_eq!(m.then(&m).m, Xf::ID.m);
        assert_eq!(m.turn(1), 3);
        assert_eq!(Xf::mirror_within(Axis::Z, 10, 4).turn(0), 2);
    }

    #[test]
    fn discs_are_inscribed() {
        let cells: Vec<(i64, i64)> = (0..6)
            .flat_map(|i| (0..6).map(move |j| (i, j)))
            .filter(|&(i, j)| in_disc(i, j, 6, 6))
            .collect();
        assert_eq!(cells.len(), 32);
        assert!(!cells.contains(&(0, 0)));
        assert!(in_disc(0, 0, 1, 1));
    }
}
