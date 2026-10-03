//! wasm-bindgen facade over the construction kit (`crates/kit`, ADR-0065) for
//! the brick office renderer (FEAT-081, increment K-3). Built by
//! `cargo xtask wasm` into `crates/kit-wasm/pkg`; a separate module from the
//! sim (`client-wasm`) so each keeps its own size budget.
//!
//! JSON goes in and out as strings; instance buffers come out as typed arrays
//! (`Float32Array`, `Uint32Array`) from [`KitBuild`]. Shipped designs resolve
//! `use` against the embedded library.
//!
//! ```ts
//! export function kitInfo(): string                    // {"version", "catalogue"}
//! export function catalogueJson(): string              // {catalogue, palette[], parts[], geometries[]}
//! export function designsJson(): string                // shipped designs, full JSON, sorted by id
//! export function mappingJson(): string                // equipment kind → design id, desk ports, seats, table
//! export function hashDesign(designJson: string): string          // throws issues JSON
//! export function compile(designJson: string, paramsJson: string): KitBuild
//! export function compileShipped(id: string, paramsJson: string): KitBuild
//! export function roomShell(roomJson: string): string  // [{at:[x,z] studs, offset:[x,z] m, hash, design}]; throws issues JSON
//! export function roomShells(layoutJson: string): string // {"room-1": [chunks…], …} for Sim.layout_json(); throws
//! export class KitBuild {
//!   ok(): boolean
//!   hash(): string
//!   summaryJson(): string                // Summary, or "null" when refused
//!   issuesJson(): string                 // Issue[] ([] when ok)
//!   infoJson(): string                   // {design, hash, catalogue, params, mount, bounds, objects, ports, surfaces}
//!   instanceCount(): number
//!   studCount(): number
//!   groupCount(): number                 // one group per (colour, geometry template)
//!   groupColour(i: number): string
//!   groupTemplate(i: number): string
//!   groupTransforms(i: number): Float32Array  // 7 per instance: cx, cy, cz (m), sx, sy, sz (m, unturned), turn
//!   groupMeta(i: number): Uint32Array         // 3 per instance: build order, object id, part index
//!   studGroupCount(): number
//!   studColour(i: number): string
//!   studPositions(i: number): Float32Array    // 3 per stud: x, y (top it stands on), z (m)
//! }
//! ```
//!
//! Frame: metres, x east, y up, z south, origin at the design's min corner on
//! its base; a turn `t` points an instance's front (+z) south, west, north or
//! east for t = 0, 1, 2, 3. `roomJson` is one room of `Sim.layout_json()`
//! (metres), optionally with `doorways` in the same shape as `doors`.
#![allow(clippy::float_arithmetic)]

use std::collections::BTreeMap;

use kit::compile::Compiled;
use kit::export::Buffers;
use kit::shell::{Opening, Side};
use kit::{Design, Issue, Kit, LayoutRoom, Params, RoomSpec};
use serde::Deserialize;
use serde_json::{json, Value};
use wasm_bindgen::prelude::*;

/// Crate version and catalogue digest.
#[wasm_bindgen(js_name = kitInfo)]
pub fn kit_info() -> String {
    json!({
        "version": env!("CARGO_PKG_VERSION"),
        "catalogue": Kit::shipped().catalogue_hash(),
    })
    .to_string()
}

/// The palette and part catalogue.
#[wasm_bindgen(js_name = catalogueJson)]
pub fn catalogue_json() -> String {
    Kit::shipped().catalogue_json().to_string()
}

/// The shipped designs, sorted by id.
#[wasm_bindgen(js_name = designsJson)]
pub fn designs_json() -> String {
    let designs: Vec<&Design> = Kit::shipped().designs().values().collect();
    serde_json::to_string(&designs).unwrap_or_else(|_| "[]".into())
}

/// Which shipped design draws each equipment kind, seat and table.
#[wasm_bindgen(js_name = mappingJson)]
pub fn mapping_json() -> String {
    serde_json::to_string(Kit::shipped().mapping()).unwrap_or_else(|_| "{}".into())
}

fn issues_json(issues: &[Issue]) -> String {
    serde_json::to_string(issues).unwrap_or_else(|_| "[]".into())
}

/// The design's content hash; throws the issues as JSON.
#[wasm_bindgen(js_name = hashDesign)]
pub fn hash_design(design_json: &str) -> Result<String, String> {
    Design::from_json(design_json)
        .and_then(|d| d.hash())
        .map_err(|e| issues_json(&e))
}

fn parse_params(params_json: &str) -> Result<Params, Vec<Issue>> {
    if params_json.trim().is_empty() {
        return Ok(Params::new());
    }
    serde_json::from_str(params_json).map_err(|e| {
        vec![Issue::design(
            kit::IssueCode::BadParam,
            "",
            format!("params: {e}"),
        )]
    })
}

/// A compiled design: summary, issues and instance buffers.
#[wasm_bindgen]
pub struct KitBuild {
    compiled: Option<Compiled>,
    issues: Vec<Issue>,
    buffers: Buffers,
}

impl KitBuild {
    fn new(result: Result<Compiled, Vec<Issue>>) -> KitBuild {
        match result {
            Ok(c) => KitBuild {
                buffers: kit::buffers(&c, Kit::shipped()),
                compiled: Some(c),
                issues: Vec::new(),
            },
            Err(issues) => KitBuild {
                compiled: None,
                issues,
                buffers: Buffers::default(),
            },
        }
    }

    /// The compiled output (for Rust callers and tests).
    pub fn compiled(&self) -> Option<&Compiled> {
        self.compiled.as_ref()
    }

    /// The instance buffers (for Rust callers and tests).
    pub fn buffers(&self) -> &Buffers {
        &self.buffers
    }
}

#[wasm_bindgen]
impl KitBuild {
    pub fn ok(&self) -> bool {
        self.compiled.is_some()
    }

    pub fn hash(&self) -> String {
        self.compiled
            .as_ref()
            .map(|c| c.hash.clone())
            .unwrap_or_default()
    }

    #[wasm_bindgen(js_name = summaryJson)]
    pub fn summary_json(&self) -> String {
        match &self.compiled {
            Some(c) => serde_json::to_string(&c.summary).unwrap_or_else(|_| "null".into()),
            None => "null".into(),
        }
    }

    #[wasm_bindgen(js_name = issuesJson)]
    pub fn issues_json(&self) -> String {
        issues_json(&self.issues)
    }

    #[wasm_bindgen(js_name = infoJson)]
    pub fn info_json(&self) -> String {
        match &self.compiled {
            Some(c) => json!({
                "design": c.design,
                "hash": c.hash,
                "catalogue": c.catalogue,
                "params": c.params,
                "mount": c.mount,
                "bounds": c.bounds,
                "objects": c.objects,
                "ports": c.ports,
                "surfaces": self.buffers.surfaces,
            })
            .to_string(),
            None => "null".into(),
        }
    }

    #[wasm_bindgen(js_name = instanceCount)]
    pub fn instance_count(&self) -> usize {
        self.buffers.instance_count()
    }

    #[wasm_bindgen(js_name = studCount)]
    pub fn stud_count(&self) -> usize {
        self.buffers.stud_count()
    }

    #[wasm_bindgen(js_name = groupCount)]
    pub fn group_count(&self) -> usize {
        self.buffers.groups.len()
    }

    #[wasm_bindgen(js_name = groupColour)]
    pub fn group_colour(&self, i: usize) -> String {
        self.buffers
            .groups
            .get(i)
            .map(|g| g.colour.clone())
            .unwrap_or_default()
    }

    #[wasm_bindgen(js_name = groupTemplate)]
    pub fn group_template(&self, i: usize) -> String {
        self.buffers
            .groups
            .get(i)
            .map(|g| g.template.clone())
            .unwrap_or_default()
    }

    #[wasm_bindgen(js_name = groupTransforms)]
    pub fn group_transforms(&self, i: usize) -> Vec<f32> {
        self.buffers
            .groups
            .get(i)
            .map(|g| g.transforms.clone())
            .unwrap_or_default()
    }

    #[wasm_bindgen(js_name = groupMeta)]
    pub fn group_meta(&self, i: usize) -> Vec<u32> {
        self.buffers
            .groups
            .get(i)
            .map(|g| g.meta.clone())
            .unwrap_or_default()
    }

    #[wasm_bindgen(js_name = studGroupCount)]
    pub fn stud_group_count(&self) -> usize {
        self.buffers.studs.len()
    }

    #[wasm_bindgen(js_name = studColour)]
    pub fn stud_colour(&self, i: usize) -> String {
        self.buffers
            .studs
            .get(i)
            .map(|g| g.colour.clone())
            .unwrap_or_default()
    }

    #[wasm_bindgen(js_name = studPositions)]
    pub fn stud_positions(&self, i: usize) -> Vec<f32> {
        self.buffers
            .studs
            .get(i)
            .map(|g| g.positions.clone())
            .unwrap_or_default()
    }
}

/// Compile a design (JSON) with parameters (JSON object, or `""`); `use`
/// resolves against the shipped designs.
#[wasm_bindgen]
pub fn compile(design_json: &str, params_json: &str) -> KitBuild {
    let result = Design::from_json(design_json).and_then(|d| {
        let params = parse_params(params_json)?;
        kit::compile(&d, &params, Kit::shipped())
    });
    KitBuild::new(result)
}

/// Compile a shipped design by id.
#[wasm_bindgen(js_name = compileShipped)]
pub fn compile_shipped(id: &str, params_json: &str) -> KitBuild {
    let kit = Kit::shipped();
    let result = match kit.design(id) {
        Some(d) => parse_params(params_json).and_then(|p| kit::compile(d, &p, kit)),
        None => Err(vec![Issue::design(
            kit::IssueCode::UnknownDesign,
            id,
            "not a shipped design",
        )]),
    };
    KitBuild::new(result)
}

/// A door or window of `Sim.layout_json()` (metres).
#[derive(Deserialize)]
struct JsOpening {
    side: Side,
    at: f64,
    #[serde(default = "one_metre")]
    width: f64,
}

fn one_metre() -> f64 {
    1.0
}

/// A room of `Sim.layout_json()` (metres); other fields are ignored.
#[derive(Deserialize)]
struct JsRoom {
    id: String,
    kind: String,
    #[serde(default)]
    x: f64,
    #[serde(default)]
    z: f64,
    w: f64,
    d: f64,
    #[serde(default)]
    doors: Vec<JsOpening>,
    #[serde(default)]
    doorways: Vec<JsOpening>,
    #[serde(default)]
    windows: Vec<JsOpening>,
}

#[derive(Deserialize)]
struct JsLayout {
    rooms: Vec<JsRoom>,
}

/// Metres → millimetres, rounded (the sim's values are whole millimetres).
fn mm(v: f64) -> i32 {
    (v * 1000.0).round() as i32
}

fn openings(list: &[JsOpening]) -> Vec<Opening> {
    list.iter()
        .map(|o| Opening {
            side: o.side,
            at_mm: mm(o.at),
            width_mm: mm(o.width),
        })
        .collect()
}

fn chunks_json(spec: &RoomSpec) -> Result<Value, Vec<Issue>> {
    let kit = Kit::shipped();
    let chunks = kit::room_shell(spec, kit)?;
    let mut out = Vec::new();
    for c in chunks {
        out.push(json!({
            "at": c.at,
            "offset": [c.at[0] as f64 * 0.0625, c.at[1] as f64 * 0.0625],
            "hash": c.design.hash()?,
            "design": c.design,
        }));
    }
    Ok(Value::Array(out))
}

/// The shell of one room (a `Sim.layout_json()` room, metres) as design chunks.
#[wasm_bindgen(js_name = roomShell)]
pub fn room_shell(room_json: &str) -> Result<String, String> {
    let r: JsRoom = serde_json::from_str(room_json).map_err(|e| {
        issues_json(&[Issue::design(
            kit::IssueCode::BadFormat,
            "",
            format!("room: {e}"),
        )])
    })?;
    let spec = RoomSpec {
        id: r.id,
        kind: r.kind,
        w_mm: mm(r.w),
        d_mm: mm(r.d),
        doors: openings(&r.doors),
        doorways: openings(&r.doorways),
        windows: openings(&r.windows),
    };
    chunks_json(&spec)
        .map(|v| v.to_string())
        .map_err(|e| issues_json(&e))
}

/// The shells of every room of `Sim.layout_json()`, with doorways where
/// another room's door opens in, keyed by room id.
#[wasm_bindgen(js_name = roomShells)]
pub fn room_shells(layout_json: &str) -> Result<String, String> {
    let layout: JsLayout = serde_json::from_str(layout_json).map_err(|e| {
        issues_json(&[Issue::design(
            kit::IssueCode::BadFormat,
            "",
            format!("layout: {e}"),
        )])
    })?;
    let rooms: Vec<LayoutRoom> = layout
        .rooms
        .iter()
        .map(|r| LayoutRoom {
            id: r.id.clone(),
            kind: r.kind.clone(),
            x_mm: mm(r.x),
            z_mm: mm(r.z),
            w_mm: mm(r.w),
            d_mm: mm(r.d),
            doors: openings(&r.doors),
            windows: openings(&r.windows),
        })
        .collect();
    let mut out = BTreeMap::new();
    for spec in kit::room_specs(&rooms) {
        let chunks = chunks_json(&spec).map_err(|e| issues_json(&e))?;
        out.insert(spec.id.clone(), chunks);
    }
    serde_json::to_string(&out).map_err(|e| e.to_string())
}
