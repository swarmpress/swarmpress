//! The kit's data: the colour palette, the part catalogue, the room shell
//! styles and the mapping from the sim's equipment kinds to shipped designs.
//!
//! All of it lives as JSON under `kit/` (validated by the JSON Schemas in
//! `kit/schema/` in tests) and is loaded here with typed parsing plus the
//! rules a schema cannot state: unique ids, the brick splitter's standard
//! sizes present, colours that exist, designs that exist.
//!
//! Units: 1 stud = 6.25 cm (16 studs = 1 m), 1 plate = 2.5 cm, 3 plates = 1
//! brick. A part's `size` is `[w, d, h]`: `w` along x and `d` along z in studs
//! at turn 0, `h` in plates.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::design::{domain_hash, valid_id, write_canonical, Design};
use crate::issue::{Issue, IssueCode};

pub const PALETTE_FORMAT: &str = "swarmpress.palette.v1";
pub const PARTS_FORMAT: &str = "swarmpress.parts.v1";
pub const ROOMS_FORMAT: &str = "swarmpress.rooms.v1";
pub const MAPPING_FORMAT: &str = "swarmpress.kit-mapping.v1";
/// Domain prefix of the catalogue digest (palette + parts).
pub const CATALOGUE_DOMAIN: &str = "swarmpress:kit-catalogue:v1";

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ColourClass {
    Solid,
    Metal,
    Transparent,
    /// Glows (screens, bulbs).
    Emissive,
}

/// One palette colour. Material hints are integers in permille.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Colour {
    /// Internal id (neutral, never a toy maker's colour name).
    pub id: String,
    /// The product's own player-facing name.
    pub name: String,
    /// sRGB `#rrggbb`.
    pub hex: String,
    pub class: ColourClass,
    #[serde(default = "default_rough")]
    pub rough: u16,
    #[serde(default, skip_serializing_if = "is_zero")]
    pub metal: u16,
    /// Opacity, permille (1000 = opaque).
    #[serde(default = "opaque")]
    pub alpha: u16,
    /// Emissive colour `#rrggbb` for the emissive class.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub emissive: Option<String>,
    /// Emissive intensity, permille.
    #[serde(default, skip_serializing_if = "is_zero")]
    pub glow: u16,
}

const fn default_rough() -> u16 {
    360
}

const fn opaque() -> u16 {
    1000
}

fn is_zero(v: &u16) -> bool {
    *v == 0
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct PaletteFile {
    #[serde(rename = "$schema", default, skip_serializing)]
    schema: Option<String>,
    format: String,
    colours: Vec<Colour>,
}

/// Standard parts are what the brick splitter emits; special parts are only
/// placed by `part` ops.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PartKind {
    Brick,
    Plate,
    Tile,
    Special,
}

/// The geometry template the renderer instances for a part.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Geometry {
    /// A box (bricks and plates; studs are separate instances).
    Box,
    /// A smooth box.
    Tile,
    Baseplate,
    Round,
    RoundTile,
    Screen,
    Board,
    Paper,
    Window,
    Door,
    LampHead,
    Seat,
    Shelf,
}

impl Geometry {
    pub const ALL: [Geometry; 13] = [
        Geometry::Box,
        Geometry::Tile,
        Geometry::Baseplate,
        Geometry::Round,
        Geometry::RoundTile,
        Geometry::Screen,
        Geometry::Board,
        Geometry::Paper,
        Geometry::Window,
        Geometry::Door,
        Geometry::LampHead,
        Geometry::Seat,
        Geometry::Shelf,
    ];

    pub fn slug(self) -> &'static str {
        match self {
            Geometry::Box => "box",
            Geometry::Tile => "tile",
            Geometry::Baseplate => "baseplate",
            Geometry::Round => "round",
            Geometry::RoundTile => "round-tile",
            Geometry::Screen => "screen",
            Geometry::Board => "board",
            Geometry::Paper => "paper",
            Geometry::Window => "window",
            Geometry::Door => "door",
            Geometry::LampHead => "lamp-head",
            Geometry::Seat => "seat",
            Geometry::Shelf => "shelf",
        }
    }
}

/// Connection points on top: a stud per cell, one stud in the centre, or none.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Top {
    Studs,
    Stud,
    Smooth,
}

/// Connection points below.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Bottom {
    AntiStuds,
    Flat,
}

/// Behaviour tags of parts; summaries count them (construction-kit.md §3).
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PartTag {
    Screen,
    Transparent,
    LightEmitter,
    Door,
    Window,
    Seat,
    Paper,
    Shelf,
}

/// The face of a part that can carry an information surface (ADR-0063).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Face {
    /// The `+z` face at turn 0.
    Front,
    /// The top face.
    Top,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PartDef {
    pub id: String,
    pub kind: PartKind,
    /// `[w, d, h]`: studs along x and z at turn 0, plates up.
    pub size: [u32; 3],
    pub geometry: Geometry,
    pub top: Top,
    pub bottom: Bottom,
    /// Colour classes the part comes in.
    pub colours: Vec<ColourClass>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<PartTag>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub surface: Option<Face>,
    /// Price of one part, cents of in-game money.
    pub cost: u32,
    /// Colour used when a `part` op names none.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub colour: Option<String>,
}

impl PartDef {
    pub fn has_tag(&self, t: PartTag) -> bool {
        self.tags.contains(&t)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct PartsFile {
    #[serde(rename = "$schema", default, skip_serializing)]
    schema: Option<String>,
    format: String,
    parts: Vec<PartDef>,
}

/// Floor of a room shell.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum Floor {
    /// Wooden planks 20 studs long in staggered rows (the prototype's floor), four colours.
    Planks { colours: [String; 4] },
    /// 4 × 4-stud squares in two colours.
    Checker { colours: [String; 2] },
    /// One colour with a 2-stud border.
    Carpet { field: String, border: String },
    /// One colour.
    Plain { colour: String },
}

/// How a room kind's shell looks.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ShellStyle {
    pub floor: Floor,
    /// Baseplates under the floor.
    pub base: String,
    /// Upper wall.
    pub wall: String,
    /// Lower wall, up to the rail.
    pub wainscot: String,
    pub rail: String,
    /// Top course of the wall.
    pub cap: String,
    pub skirting: String,
    /// Door frames and window sills.
    pub frame: String,
    pub window: String,
    pub door: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Rooms {
    #[serde(rename = "$schema", default, skip_serializing)]
    pub schema: Option<String>,
    pub format: String,
    /// Shell style per room kind slug (the sim's `RoomKind::slug`).
    pub styles: BTreeMap<String, ShellStyle>,
}

/// Which shipped design draws what (the MVP renderer's mapping, ADR-0065
/// decision 4: the sim keeps its equipment kinds).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Mapping {
    #[serde(rename = "$schema", default, skip_serializing)]
    pub schema: Option<String>,
    pub format: String,
    /// Equipment kind slug (the sim's `EquipmentKind::slug`) → design id.
    pub equipment: BTreeMap<String, String>,
    /// Desk attachment kind → the desk port it goes on.
    pub desk_ports: BTreeMap<String, String>,
    /// The chair drawn at each desk's seat.
    pub desk_seat: String,
    /// The table drawn in rooms that hold meetings or lunch.
    pub table: String,
    /// The seat drawn at each table seat.
    pub table_seat: String,
}

/// The source texts of a kit.
pub struct Sources<'a> {
    pub palette: &'a str,
    pub parts: &'a [&'a str],
    pub designs: &'a [&'a str],
    pub rooms: &'a str,
    pub mapping: &'a str,
}

/// A loaded, validated kit: palette, parts, the design library, room styles
/// and the mapping.
#[derive(Clone, Debug)]
pub struct Kit {
    palette: Vec<Colour>,
    colour_ix: BTreeMap<String, u8>,
    parts: Vec<PartDef>,
    part_ix: BTreeMap<String, u16>,
    designs: BTreeMap<String, Design>,
    design_hashes: BTreeMap<String, String>,
    rooms: Rooms,
    mapping: Mapping,
    catalogue: String,
}

fn bad(what: &str, message: impl Into<String>) -> Issue {
    Issue::design(IssueCode::BadCatalogue, what, message)
}

fn valid_hex(s: &str) -> bool {
    s.len() == 7 && s.starts_with('#') && s[1..].bytes().all(|b| b.is_ascii_hexdigit())
}

impl Kit {
    /// Load and validate a kit from its source texts.
    pub fn load(src: &Sources<'_>) -> Result<Kit, Vec<Issue>> {
        let mut issues = Vec::new();
        let palette: PaletteFile =
            serde_json::from_str(src.palette).map_err(|e| vec![bad("palette", e.to_string())])?;
        if palette.format != PALETTE_FORMAT {
            issues.push(bad("palette", format!("format must be {PALETTE_FORMAT}")));
        }
        let mut colour_ix = BTreeMap::new();
        for (i, c) in palette.colours.iter().enumerate() {
            if !valid_id(&c.id) {
                issues.push(bad("palette", format!("bad colour id {:?}", c.id)));
            }
            if c.name.trim().is_empty() || !valid_hex(&c.hex) {
                issues.push(bad(
                    "palette",
                    format!("{}: needs a name and a #rrggbb hex", c.id),
                ));
            }
            if c.class == ColourClass::Emissive && !c.emissive.as_deref().is_some_and(valid_hex) {
                issues.push(bad(
                    "palette",
                    format!("{}: emissive colours need `emissive`", c.id),
                ));
            }
            match u8::try_from(i) {
                Ok(ix) if colour_ix.insert(c.id.clone(), ix).is_none() => {}
                Ok(_) => issues.push(bad("palette", format!("duplicate colour {}", c.id))),
                Err(_) => issues.push(bad("palette", "at most 256 colours")),
            }
        }

        let mut parts = Vec::new();
        for (n, text) in src.parts.iter().enumerate() {
            match serde_json::from_str::<PartsFile>(text) {
                Ok(f) => {
                    if f.format != PARTS_FORMAT {
                        issues.push(bad(
                            "parts",
                            format!("file {n}: format must be {PARTS_FORMAT}"),
                        ));
                    }
                    parts.extend(f.parts);
                }
                Err(e) => issues.push(bad("parts", format!("file {n}: {e}"))),
            }
        }
        let mut part_ix = BTreeMap::new();
        for (i, p) in parts.iter().enumerate() {
            check_part(p, &colour_ix, &palette.colours, &mut issues);
            match u16::try_from(i) {
                Ok(ix) if part_ix.insert(p.id.clone(), ix).is_none() => {}
                Ok(_) => issues.push(bad("parts", format!("duplicate part {}", p.id))),
                Err(_) => issues.push(bad("parts", "too many parts")),
            }
        }
        for (kind, sizes) in crate::split::standard_sizes() {
            for (a, b) in sizes {
                let id = standard_id(kind, a, b);
                if !part_ix.contains_key(&id) {
                    issues.push(bad("parts", format!("the brick splitter needs {id}")));
                }
            }
        }

        let mut designs = BTreeMap::new();
        for text in src.designs {
            match Design::from_json(text) {
                Ok(d) => {
                    if designs.contains_key(&d.id) {
                        issues.push(bad(&d.id, "duplicate design id"));
                    }
                    designs.insert(d.id.clone(), d);
                }
                Err(e) => issues.extend(e),
            }
        }
        let mut design_hashes = BTreeMap::new();
        for (id, d) in &designs {
            match d.hash() {
                Ok(h) => {
                    design_hashes.insert(id.clone(), h);
                }
                Err(e) => issues.extend(e),
            }
        }

        let rooms: Rooms = serde_json::from_str(src.rooms).map_err(|e| {
            let mut all = issues.clone();
            all.push(bad("rooms", e.to_string()));
            all
        })?;
        if rooms.format != ROOMS_FORMAT {
            issues.push(bad("rooms", format!("format must be {ROOMS_FORMAT}")));
        }
        for (kind, s) in &rooms.styles {
            let mut colours: Vec<&String> = vec![
                &s.base,
                &s.wall,
                &s.wainscot,
                &s.rail,
                &s.cap,
                &s.skirting,
                &s.frame,
                &s.window,
                &s.door,
            ];
            match &s.floor {
                Floor::Planks { colours: c } => colours.extend(c.iter()),
                Floor::Checker { colours: c } => colours.extend(c.iter()),
                Floor::Carpet { field, border } => colours.extend([field, border]),
                Floor::Plain { colour } => colours.push(colour),
            }
            for c in colours {
                if !colour_ix.contains_key(c) {
                    issues.push(bad("rooms", format!("{kind}: unknown colour {c}")));
                }
            }
        }

        let mapping: Mapping = serde_json::from_str(src.mapping).map_err(|e| {
            let mut all = issues.clone();
            all.push(bad("mapping", e.to_string()));
            all
        })?;
        if mapping.format != MAPPING_FORMAT {
            issues.push(bad("mapping", format!("format must be {MAPPING_FORMAT}")));
        }
        let named = mapping.equipment.values().chain([
            &mapping.desk_seat,
            &mapping.table,
            &mapping.table_seat,
        ]);
        for id in named {
            if !designs.contains_key(id) {
                issues.push(bad("mapping", format!("no design {id}")));
            }
        }

        let catalogue = {
            let v = serde_json::json!({ "palette": palette.colours, "parts": parts });
            let mut s = String::new();
            write_canonical(&v, &mut s);
            domain_hash(CATALOGUE_DOMAIN, s.as_bytes())
        };
        if !issues.is_empty() {
            return Err(issues);
        }
        Ok(Kit {
            palette: palette.colours,
            colour_ix,
            parts,
            part_ix,
            designs,
            design_hashes,
            rooms,
            mapping,
            catalogue,
        })
    }

    /// Digest of the palette and part catalogue (the "catalogue version").
    pub fn catalogue_hash(&self) -> &str {
        &self.catalogue
    }

    pub fn palette(&self) -> &[Colour] {
        &self.palette
    }

    pub fn colour_index(&self, id: &str) -> Option<u8> {
        self.colour_ix.get(id).copied()
    }

    pub fn colour(&self, ix: u8) -> &Colour {
        &self.palette[usize::from(ix)]
    }

    pub fn parts(&self) -> &[PartDef] {
        &self.parts
    }

    pub fn part_index(&self, id: &str) -> Option<u16> {
        self.part_ix.get(id).copied()
    }

    pub fn part(&self, ix: u16) -> &PartDef {
        &self.parts[usize::from(ix)]
    }

    /// The design library `use` resolves against (the shipped designs).
    pub fn designs(&self) -> &BTreeMap<String, Design> {
        &self.designs
    }

    pub fn design(&self, id: &str) -> Option<&Design> {
        self.designs.get(id)
    }

    pub fn design_hash(&self, id: &str) -> Option<&str> {
        self.design_hashes.get(id).map(String::as_str)
    }

    pub fn rooms(&self) -> &Rooms {
        &self.rooms
    }

    pub fn mapping(&self) -> &Mapping {
        &self.mapping
    }

    /// Whether a colour class may be used for a standard material
    /// (`brick`, `plate`, `tile`): the classes of its 1 × 1 part.
    pub fn material_allows(&self, kind: PartKind, class: ColourClass) -> bool {
        let id = standard_id(kind, 1, 1);
        self.part_index(&id)
            .is_some_and(|ix| self.part(ix).colours.contains(&class))
    }

    /// A copy of this kit with extra designs in the library (for tests and
    /// for compiling a player's design set); later designs replace earlier ones.
    pub fn with_designs(&self, extra: &[Design]) -> Result<Kit, Vec<Issue>> {
        let mut k = self.clone();
        for d in extra {
            k.design_hashes.insert(d.id.clone(), d.hash()?);
            k.designs.insert(d.id.clone(), d.clone());
        }
        Ok(k)
    }

    /// The palette and parts as JSON (for the renderer).
    pub fn catalogue_json(&self) -> Value {
        serde_json::json!({
            "catalogue": self.catalogue,
            "palette": self.palette,
            "parts": self.parts,
            "geometries": Geometry::ALL.iter().map(|g| g.slug()).collect::<Vec<_>>(),
        })
    }
}

/// The id of a standard part: `brick-1x2`, `plate-4x6`, `tile-2x2` (smaller side first).
pub fn standard_id(kind: PartKind, a: u32, b: u32) -> String {
    let name = match kind {
        PartKind::Brick => "brick",
        PartKind::Plate => "plate",
        PartKind::Tile => "tile",
        PartKind::Special => "special",
    };
    format!("{name}-{}x{}", a.min(b), a.max(b))
}

fn check_part(
    p: &PartDef,
    colour_ix: &BTreeMap<String, u8>,
    palette: &[Colour],
    issues: &mut Vec<Issue>,
) {
    let mut fail = |m: String| issues.push(bad("parts", format!("{}: {m}", p.id)));
    if !valid_id(&p.id) {
        fail("bad id".into());
    }
    if p.size.iter().any(|&s| s == 0 || s > 512) {
        fail("every size must be 1..=512".into());
    }
    if p.colours.is_empty() {
        fail("needs at least one colour class".into());
    }
    let [w, d, h] = p.size;
    match p.kind {
        PartKind::Brick | PartKind::Plate | PartKind::Tile => {
            if p.id != standard_id(p.kind, w, d) || w > d {
                fail("a standard part's id is kind-WxD with W <= D".into());
            }
            let want_h = if p.kind == PartKind::Brick { 3 } else { 1 };
            if h != want_h {
                fail(format!("height must be {want_h}"));
            }
            let want_top = if p.kind == PartKind::Tile {
                Top::Smooth
            } else {
                Top::Studs
            };
            if p.top != want_top || p.bottom != Bottom::AntiStuds {
                fail("standard parts have the standard connections".into());
            }
        }
        PartKind::Special => {}
    }
    if p.surface.is_some()
        && !matches!(
            p.geometry,
            Geometry::Screen | Geometry::Board | Geometry::Paper | Geometry::Tile
        )
    {
        fail("only screens, boards, paper and tiles carry surfaces".into());
    }
    if let Some(c) = &p.colour {
        match colour_ix.get(c) {
            None => fail(format!("unknown default colour {c}")),
            Some(&ix) => {
                if !p.colours.contains(&palette[usize::from(ix)].class) {
                    fail(format!("default colour {c} is not in its classes"));
                }
            }
        }
    }
}
