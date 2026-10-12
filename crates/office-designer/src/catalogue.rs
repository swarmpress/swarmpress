//! What the model sees: the designs that make sense for a room and a brief
//! (a catalogue slice), one generated line per design, the room described by
//! its anchors, and the relation vocabulary (construction-kit.md §7.1, points
//! 2 and 4). Every line about a design is generated from the kit's compiled
//! summary and the sim's rules, never hand-written per design.

use std::collections::BTreeMap;
use std::fmt::Write as _;
use std::sync::OnceLock;

use kit::{Kit, Params};

use crate::brief::{Brief, Need};
use crate::model::{
    fmt_cents, fmt_m, half_studs_mm, EquipmentDesign, Room, RoomKind, Side,
    CEILING_LIGHT_SPACING_MM, SEAT_OFFSET_MM,
};

/// A design as the designer knows it, from the kit's compiled summary.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DesignInfo {
    pub design: EquipmentDesign,
    /// The kit design that draws it (`kit/mapping.json`).
    pub kit_design: String,
    pub name: String,
    /// `[w, d]` studs at turn 0 (w along x, d along z).
    pub footprint: [u32; 2],
    pub height_plates: u32,
    pub parts: u32,
    pub capabilities: Vec<String>,
    pub surfaces: Vec<String>,
    /// Port ids and whether a port accepts a seat.
    pub ports: Vec<String>,
    pub seat_port: bool,
    pub provides: Option<Need>,
}

/// A kit design the renderer draws as a fixture (a desk's chair, the table).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Fixture {
    pub kit_design: String,
    pub footprint: [u32; 2],
    pub parts: u32,
}

impl Fixture {
    pub fn half(&self) -> (i32, i32) {
        (
            half_studs_mm(self.footprint[0]),
            half_studs_mm(self.footprint[1]),
        )
    }
}

/// Every placeable design's info plus the fixtures, built once from a kit.
#[derive(Clone, Debug)]
pub struct Catalogue {
    designs: BTreeMap<EquipmentDesign, DesignInfo>,
    pub chair: Fixture,
    pub table: Fixture,
    pub stool: Fixture,
    /// The kit catalogue digest the infos were compiled with.
    pub kit_catalogue: String,
}

fn need_of(d: EquipmentDesign, s: &kit::Summary) -> Option<Need> {
    if s.workstation {
        Some(Need::Workstations)
    } else if s.storage > 0 {
        Some(Need::Storage)
    } else if s
        .surfaces
        .iter()
        .any(|x| x == "whiteboard" || x == "mood-board")
    {
        Some(Need::WritingSurfaces)
    } else {
        // Coffee and plants have no capability tag in the kit: by identity.
        match d {
            EquipmentDesign::CoffeeMachine => Some(Need::Coffee),
            EquipmentDesign::Plant => Some(Need::Plants),
            _ => None,
        }
    }
}

fn compile(kit: &Kit, id: &str) -> Result<kit::Summary, String> {
    let design = kit
        .design(id)
        .ok_or_else(|| format!("the kit has no design \"{id}\""))?;
    kit::compile(design, &Params::new(), kit)
        .map(|c| c.summary)
        .map_err(|issues| format!("design \"{id}\" does not compile: {issues:?}"))
}

fn fixture(kit: &Kit, id: &str) -> Result<Fixture, String> {
    let s = compile(kit, id)?;
    Ok(Fixture {
        kit_design: id.to_owned(),
        footprint: s.footprint,
        parts: s.parts,
    })
}

impl Catalogue {
    /// Compiles every mapped design of `kit` once.
    pub fn from_kit(kit: &Kit) -> Result<Catalogue, String> {
        let mapping = kit.mapping();
        let mut designs = BTreeMap::new();
        for d in EquipmentDesign::ALL {
            let id = mapping
                .equipment
                .get(d.slug())
                .ok_or_else(|| format!("the kit maps no design to \"{}\"", d.slug()))?;
            let s = compile(kit, id)?;
            let name = kit.design(id).map(|x| x.name.clone()).unwrap_or_default();
            designs.insert(
                d,
                DesignInfo {
                    design: d,
                    kit_design: id.clone(),
                    name,
                    footprint: s.footprint,
                    height_plates: s.height,
                    parts: s.parts,
                    capabilities: s.capabilities.clone(),
                    surfaces: s.surfaces.clone(),
                    ports: s.ports.iter().map(|p| p.id.clone()).collect(),
                    seat_port: s
                        .ports
                        .iter()
                        .any(|p| p.accepts.iter().any(|a| a == "seat")),
                    provides: need_of(d, &s),
                },
            );
        }
        Ok(Catalogue {
            designs,
            chair: fixture(kit, &mapping.desk_seat)?,
            table: fixture(kit, &mapping.table)?,
            stool: fixture(kit, &mapping.table_seat)?,
            kit_catalogue: kit.catalogue_hash().to_owned(),
        })
    }

    /// The shipped kit's catalogue, built once.
    pub fn shipped() -> &'static Catalogue {
        static CAT: OnceLock<Catalogue> = OnceLock::new();
        CAT.get_or_init(|| match Catalogue::from_kit(Kit::shipped()) {
            Ok(c) => c,
            Err(e) => panic!("the shipped kit does not give a catalogue: {e}"),
        })
    }

    pub fn info(&self, d: EquipmentDesign) -> &DesignInfo {
        // from_kit inserts every design
        &self.designs[&d]
    }

    /// Half extents `(x, z)` of a design's kit footprint at a turn, mm.
    pub fn half(&self, d: EquipmentDesign, rot: u8) -> (i32, i32) {
        let [w, dd] = self.info(d).footprint;
        let (hx, hz) = (half_studs_mm(w), half_studs_mm(dd));
        if rot % 2 == 1 {
            (hz, hx)
        } else {
            (hx, hz)
        }
    }

    /// Parts a placed design adds (a desk brings its chair).
    pub fn parts(&self, d: EquipmentDesign) -> u32 {
        let info = self.info(d);
        info.parts + if info.seat_port { self.chair.parts } else { 0 }
    }
}

// ------------------------------------------------------------------ slices

/// The designs that make sense for a room kind and a brief, in the sim's
/// order: allowed in the room (`required_room`) and either asked for by the
/// brief (by what they provide, attachments with workstations), the room's
/// own special design (a `required_room` of this kind), or always useful
/// (ceiling lights for the light check, plants).
pub fn slice(room: RoomKind, brief: &Brief, cat: &Catalogue) -> Vec<EquipmentDesign> {
    EquipmentDesign::ALL
        .into_iter()
        .filter(|d| d.allowed_in(room))
        .filter(|d| {
            let info = cat.info(*d);
            matches!(d, EquipmentDesign::CeilingLight | EquipmentDesign::Plant)
                || d.required_room() == Some(room)
                || info.provides.is_some_and(|n| brief.wants(n) > 0)
                || (d.desk_slot().is_some() && brief.workstations > 0)
        })
        .collect()
}

/// One generated line per design: what it is, its size, what it provides,
/// where it goes, price and parts.
pub fn design_doc(d: EquipmentDesign, cat: &Catalogue) -> String {
    let info = cat.info(d);
    let [w, dd] = info.footprint;
    let mut s = format!(
        "- {}: {}. {w} × {dd} studs ({} × {}) when facing south.",
        d.slug(),
        info.name,
        fmt_m(i64::from(w) * 625 / 10),
        fmt_m(i64::from(dd) * 625 / 10),
    );
    if let Some(n) = info.provides {
        let _ = write!(s, " Counts as {}", n.words());
        if n == Need::Workstations {
            s.push_str(" once a screen is on it");
        }
        s.push('.');
    }
    let caps: Vec<&str> = info
        .capabilities
        .iter()
        .map(String::as_str)
        .filter(|c| *c != "workstation")
        .collect();
    if !caps.is_empty() {
        let _ = write!(s, " Has: {}.", caps.join(", "));
    }
    if let Some(slot) = d.desk_slot() {
        let slot = if matches!(slot, crate::model::DeskSlot::Screen) {
            "screen"
        } else {
            "lamp"
        };
        let _ = write!(
            s,
            " Goes on a desk's {slot} slot: anchor placement:N (a desk of this plan; one per desk in its row) or equipment:ID (a desk in the room)."
        );
    } else if d.is_ceiling() {
        let _ = write!(
            s,
            " Hangs from the ceiling; anchor placement:N or equipment:ID hangs it over that item. Lights {} apart at least.",
            fmt_m(i64::from(CEILING_LIGHT_SPACING_MM))
        );
    } else {
        s.push_str(" Stands on the floor.");
    }
    if info.seat_port {
        let _ = write!(
            s,
            " Its chair stands {} ({} studs) in front: keep that free.",
            fmt_m(i64::from(SEAT_OFFSET_MM)),
            SEAT_OFFSET_MM * 16 / 1000
        );
    }
    if let Some(r) = d.required_room() {
        let _ = write!(s, " Only in a {}.", r.label().to_lowercase());
    }
    let _ = write!(s, " {}, {} parts.", fmt_cents(d.cost()), cat.parts(d));
    s
}

/// The slice's docs, one line each.
pub fn slice_doc(designs: &[EquipmentDesign], cat: &Catalogue) -> String {
    designs
        .iter()
        .map(|d| design_doc(*d, cat))
        .collect::<Vec<_>>()
        .join("\n")
}

fn side_name(s: Side) -> &'static str {
    s.slug()
}

/// The room in words: size, walls with their openings by anchor id, the
/// table, and what already stands there.
pub fn room_doc(room: &Room) -> String {
    let mut s = format!(
        "{}, {} × {} ({} × {} studs; x runs east, z south).",
        room.kind.label(),
        fmt_m(i64::from(room.w_mm)),
        fmt_m(i64::from(room.d_mm)),
        room.w_mm * 16 / 1000,
        room.d_mm * 16 / 1000,
    );
    for side in Side::ALL {
        let (a, b) = room.along(side);
        let from = if side.runs_along_x() { "west" } else { "north" };
        let _ = write!(
            s,
            "\n- wall:{} is {} long",
            side_name(side),
            fmt_m(i64::from(b - a))
        );
        let mut parts = Vec::new();
        for (i, w) in room.windows.iter().enumerate() {
            if w.side == side {
                parts.push(format!(
                    "window:{i} from {} to {} from the {from} end",
                    fmt_m(i64::from(w.at_mm)),
                    fmt_m(i64::from(w.at_mm + w.width_mm))
                ));
            }
        }
        for (i, d) in room.doors.iter().enumerate() {
            if d.side == side {
                parts.push(format!(
                    "door:{i} from {} to {} from the {from} end (keep 1 m in front clear)",
                    fmt_m(i64::from(d.at_mm)),
                    fmt_m(i64::from(d.at_mm + d.width_mm))
                ));
            }
        }
        if !parts.is_empty() {
            let _ = write!(s, ": {}", parts.join("; "));
        }
        s.push('.');
    }
    if room.table_seats() > 0 {
        let _ = write!(
            s,
            "\n- The table stands in the middle with {} seats; keep it and its seats clear.",
            room.table_seats()
        );
    }
    let r = room.rect();
    for e in &room.equipment {
        if let Some(desk) = &e.on_desk {
            let _ = write!(s, "\n- equipment:{}: {} on {desk}.", e.id, e.design.slug());
            continue;
        }
        let p = e.pos();
        let _ = write!(
            s,
            "\n- equipment:{}: {} at {} from the west wall, {} from the north wall, facing {}.",
            e.id,
            e.design.slug(),
            fmt_m(i64::from(p.x - r.x0)),
            fmt_m(i64::from(p.z - r.z0)),
            Side::of_rot(e.rot).slug()
        );
    }
    for o in &room.objects {
        if let Some(d) = &o.on_desk {
            let slot = match d.slot {
                crate::model::DeskSlot::Screen => "screen",
                crate::model::DeskSlot::Lamp => "lamp",
            };
            let _ = write!(
                s,
                "\n- equipment:{}: the CEO's own design on {}'s {slot} slot (that slot is taken).",
                o.id, d.desk
            );
            continue;
        }
        let fp = o.rect();
        let p = o.pos();
        if o.ceiling {
            let _ = write!(
                s,
                "\n- equipment:{}: the CEO's own design hanging from the ceiling, {} (west to east) × {} (north to south), at {} from the west wall, {} from the north wall{}. Floor items may stand under it; keep ceiling lights off it.",
                o.id,
                fmt_m(i64::from(fp.x1 - fp.x0)),
                fmt_m(i64::from(fp.z1 - fp.z0)),
                fmt_m(i64::from(p.x - r.x0)),
                fmt_m(i64::from(p.z - r.z0)),
                if o.lights > 0 { "; it has a light" } else { "" },
            );
            continue;
        }
        let _ = write!(
            s,
            "\n- equipment:{}: the CEO's own design, {} (west to east) × {} (north to south), at {} from the west wall, {} from the north wall",
            o.id,
            fmt_m(i64::from(fp.x1 - fp.x0)),
            fmt_m(i64::from(fp.z1 - fp.z0)),
            fmt_m(i64::from(p.x - r.x0)),
            fmt_m(i64::from(p.z - r.z0)),
        );
        if let Some(seat) = o.seat() {
            let _ = write!(
                s,
                "; a workstation, its seat at {} from the west wall, {} from the north wall (keep {} around the seat free)",
                fmt_m(i64::from(seat.x - r.x0)),
                fmt_m(i64::from(seat.z - r.z0)),
                fmt_m(i64::from(2 * crate::model::CHAIR_HALF_MM)),
            );
        }
        let mut has = Vec::new();
        if o.storage > 0 {
            has.push("storage");
        }
        if o.lights > 0 {
            has.push("a light");
        }
        if o.places > 0 {
            has.push("seats for meetings and breaks");
        }
        if !has.is_empty() {
            let _ = write!(s, "; it has {}", has.join(" and "));
        }
        s.push_str(". Keep off it.");
    }
    s
}

/// The relation vocabulary the model writes plans in. Written once for the
/// grammar (not per design); the numbers come from the rules' constants.
pub fn vocabulary_doc() -> String {
    format!(
        "Plan = {{\"placements\": [placement, ...]}}, at most {max} placements, in build order; \
placement:N means the N-th (from 0) and must come earlier.
Units are studs: 16 studs = 1 m.
A placement:
- design: an id from the catalogue below.
- anchor: what it stands against or relative to:
  wall:north|east|south|west (against the inside of that wall),
  window:N (against the window's wall, centred on the window),
  door:N (against the door's wall, beside the door; the door's 1 m stays clear),
  placement:N or equipment:ID (next to that item; for a monitor or lamp: on that desk; for a ceiling light: over it),
  room-centre (in the middle; rows run along the longer side).
- from (wall anchors only): where along the wall the row starts: a wall that meets it (start offset studs from that wall),
  window:N (centred on it), door:N, placement:N or equipment:ID (start offset studs beside it, on the side with more room).
  Without from, the row is centred on the wall.
- side (item anchors only): north|east|south|west of the anchor item; default: behind it.
- gap: studs between the anchor and the item (default 0).
- offset: studs between from and the first item (default 0).
- facing: away (default: away from the anchor, into the room for a wall), toward, room-centre, north, east, south, west.
  The front is the side people use: a desk's chair side, a shelf's open side, a board's face.
- count: items in a row along the anchor, 1 to {count} (default 1); spacing: studs between neighbours (default 0).
Positions are computed for you; checks report collisions, walls, doors, walking paths, light at desks, the brief and the cost.",
        max = crate::model::MAX_PLACEMENTS,
        count = crate::model::MAX_COUNT,
    )
}
