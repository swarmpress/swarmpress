//! Geometry export for instancing: flat `f32` / `u32` buffers per colour and
//! geometry template, in metres, for the renderer (one thin-instanced mesh per
//! colour and template, ADR-0063 decision 1).
//!
//! This is the only module with float arithmetic: it reads a finished
//! [`Compiled`] and never feeds a summary, hash or validation.
//!
//! Frame: x east, y up, z south, metres; the origin is the design's min
//! corner on its base. A turn `t` rotates an instance about its centre so its
//! local `+z` (its front) points south (`t = 0`), west (1), north (2) or east (3).
#![allow(clippy::float_arithmetic)]

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::catalogue::{Face, Geometry, Kit};
use crate::compile::Compiled;

/// One stud, metres (6.25 cm).
pub const STUD_M: f32 = 0.0625;
/// One plate, metres (2.5 cm).
pub const PLATE_M: f32 = 0.025;
/// Floats per instance in [`InstanceGroup::transforms`]: centre x, y, z;
/// size x, y, z in the instance's own (unturned) frame; turn (0..=3).
pub const TRANSFORM_STRIDE: usize = 7;
/// `u32`s per instance in [`InstanceGroup::meta`]: construction order, object
/// id, part index in the catalogue.
pub const META_STRIDE: usize = 3;
/// Floats per stud in [`StudGroup::positions`]: x, y (the top it stands on), z.
pub const STUD_STRIDE: usize = 3;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct InstanceGroup {
    pub colour: String,
    /// The catalogue's geometry template (`box`, `tile`, `screen`, …).
    pub template: String,
    pub transforms: Vec<f32>,
    pub meta: Vec<u32>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct StudGroup {
    pub colour: String,
    pub positions: Vec<f32>,
}

/// An information surface as a rectangle in space.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SurfaceRect {
    pub name: String,
    pub object: u16,
    pub seq: u32,
    pub centre: [f32; 3],
    /// Width and height of the rectangle, metres.
    pub size: [f32; 2],
    /// Outward unit normal.
    pub normal: [f32; 3],
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Buffers {
    pub groups: Vec<InstanceGroup>,
    pub studs: Vec<StudGroup>,
    pub surfaces: Vec<SurfaceRect>,
}

impl Buffers {
    pub fn instance_count(&self) -> usize {
        self.groups.iter().map(|g| g.meta.len() / META_STRIDE).sum()
    }

    pub fn stud_count(&self) -> usize {
        self.studs
            .iter()
            .map(|g| g.positions.len() / STUD_STRIDE)
            .sum()
    }
}

fn normal(turn: u8) -> [f32; 3] {
    match turn % 4 {
        0 => [0.0, 0.0, 1.0],
        1 => [-1.0, 0.0, 0.0],
        2 => [0.0, 0.0, -1.0],
        _ => [1.0, 0.0, 0.0],
    }
}

/// The instance buffers of a compiled design.
pub fn buffers(c: &Compiled, kit: &Kit) -> Buffers {
    let mut out = Buffers::default();
    for g in &c.groups {
        let mut by_template: BTreeMap<Geometry, (Vec<f32>, Vec<u32>)> = BTreeMap::new();
        for b in &g.bricks {
            let Some(ix) = kit.part_index(&b.part) else {
                continue;
            };
            let def = kit.part(ix);
            let [w, d, h] = def.size;
            let (fx, fz) = if b.turn.is_multiple_of(2) {
                (w, d)
            } else {
                (d, w)
            };
            let (t, m) = by_template.entry(def.geometry).or_default();
            t.extend_from_slice(&[
                (b.at[0] as f32 + fx as f32 / 2.0) * STUD_M,
                (b.at[2] as f32 + h as f32 / 2.0) * PLATE_M,
                (b.at[1] as f32 + fz as f32 / 2.0) * STUD_M,
                w as f32 * STUD_M,
                h as f32 * PLATE_M,
                d as f32 * STUD_M,
                f32::from(b.turn),
            ]);
            m.extend_from_slice(&[b.seq, u32::from(b.object), u32::from(ix)]);
        }
        for (geometry, (transforms, meta)) in by_template {
            out.groups.push(InstanceGroup {
                colour: g.colour.clone(),
                template: geometry.slug().to_string(),
                transforms,
                meta,
            });
        }
        if !g.studs.is_empty() {
            let mut positions = Vec::with_capacity(g.studs.len() * STUD_STRIDE);
            for s in &g.studs {
                positions.extend_from_slice(&[
                    s[0] as f32 * STUD_M / 2.0,
                    s[2] as f32 * PLATE_M,
                    s[1] as f32 * STUD_M / 2.0,
                ]);
            }
            out.studs.push(StudGroup {
                colour: g.colour.clone(),
                positions,
            });
        }
    }
    for s in &c.surfaces {
        let Some(ix) = kit.part_index(&s.part) else {
            continue;
        };
        let [w, d, _] = kit.part(ix).size;
        let centre = [
            (s.at[0] as f32 + s.size[0] as f32 / 2.0) * STUD_M,
            (s.at[2] as f32 + s.size[2] as f32 / 2.0) * PLATE_M,
            (s.at[1] as f32 + s.size[1] as f32 / 2.0) * STUD_M,
        ];
        let rect = match s.face {
            Face::Front => {
                let n = normal(s.turn);
                let half_x = s.size[0] as f32 * STUD_M / 2.0;
                let half_z = s.size[1] as f32 * STUD_M / 2.0;
                SurfaceRect {
                    name: s.name.clone(),
                    object: s.object,
                    seq: s.seq,
                    centre: [
                        centre[0] + n[0] * half_x,
                        centre[1],
                        centre[2] + n[2] * half_z,
                    ],
                    size: [w as f32 * STUD_M, s.size[2] as f32 * PLATE_M],
                    normal: n,
                }
            }
            Face::Top => SurfaceRect {
                name: s.name.clone(),
                object: s.object,
                seq: s.seq,
                centre: [centre[0], (s.at[2] + s.size[2]) as f32 * PLATE_M, centre[2]],
                size: [w as f32 * STUD_M, d as f32 * STUD_M],
                normal: [0.0, 1.0, 0.0],
            },
        };
        out.surfaces.push(rect);
    }
    out
}
