//! The test world: the demo office plus an archive, a newsroom and a studio
//! furnished with the players' own designs (ADR-0088) on land bought to the
//! east, and the sim's rooms as the designer's `Room`s.

#![allow(dead_code)]

use office_designer::model::DeskSlot;
use office_designer::{
    EquipmentDesign, ExistingItem, ExistingObject, ObjectOnDesk, Opening, Room, RoomKind, Side,
};
use sim_core::building::{Door, Window};
use sim_core::commands::{Command, Placement};
use sim_core::geom::{PosMm, Side as SimSide, TileRect, TILE_MM};
use sim_core::ids::RoomId;
use sim_core::objects::{Mount, ObjectSummary};
use sim_core::scenarios::demo_office;
use sim_core::World;

pub const ARCHIVE: TileRect = TileRect::new(24, 0, 4, 6);
pub const NEWSROOM: TileRect = TileRect::new(26, 8, 6, 6);
/// The demo office's meeting room (a whiteboard stands west of its door).
pub const MEETING_ROOM: TileRect = TileRect::new(0, 8, 6, 8);
/// The demo office's kitchen (a coffee machine stands in it).
pub const KITCHEN: TileRect = TileRect::new(12, 0, 4, 6);
/// A newsroom the CEO furnished with designs of their own: a built-in desk
/// with a desk-top design in its lamp slot, a workstation design and a shelf
/// design.
pub const STUDIO: TileRect = TileRect::new(28, 0, 4, 6);

/// A player's desk (1.5 × 0.75 m) whose seat is 750 mm south of its centre.
pub fn my_desk() -> ObjectSummary {
    ObjectSummary {
        footprint: [24, 12],
        height: 34,
        mount: Mount::Floor,
        seats: 1,
        workstation: true,
        seat_at: Some([0, 750]),
        lights: 1,
        storage: 0,
        screens: 1,
        parts: 204,
        cost: 3_199,
    }
}

/// A player's shelf, 17 × 9 studs (1.0625 × 0.5625 m).
pub fn my_shelf() -> ObjectSummary {
    ObjectSummary {
        footprint: [17, 9],
        workstation: false,
        seat_at: None,
        seats: 0,
        lights: 0,
        screens: 0,
        storage: 120,
        ..my_desk()
    }
}

/// A desk-top design without a screen (a mug): it takes a desk's lamp slot.
pub fn my_mug() -> ObjectSummary {
    ObjectSummary {
        footprint: [4, 4],
        mount: Mount::Surface,
        workstation: false,
        seat_at: None,
        seats: 0,
        lights: 0,
        screens: 0,
        ..my_desk()
    }
}

pub fn design_hash(n: u8) -> String {
    format!("{n:02x}").repeat(32)
}

pub fn world() -> World {
    let mut w = demo_office(7);
    w.apply(Command::BuyFloorSpace {
        side: SimSide::East,
        tiles: 8,
    })
    .expect("buy land to the east");
    w.apply(Command::PlaceRoom {
        kind: sim_core::building::RoomKind::Archive,
        rect: ARCHIVE,
        floor: 0,
        doors: vec![Door {
            side: SimSide::South,
            at: 2,
        }],
        windows: vec![Window {
            side: SimSide::North,
            at_mm: 1_000,
            width_mm: 2_000,
        }],
    })
    .expect("place the archive");
    w.apply(Command::PlaceRoom {
        kind: sim_core::building::RoomKind::Newsroom,
        rect: NEWSROOM,
        floor: 0,
        doors: vec![Door {
            side: SimSide::North,
            at: 1,
        }],
        windows: vec![Window {
            side: SimSide::East,
            at_mm: 1_000,
            width_mm: 4_000,
        }],
    })
    .expect("place the newsroom");
    w.apply(Command::PlaceRoom {
        kind: sim_core::building::RoomKind::Newsroom,
        rect: STUDIO,
        floor: 0,
        doors: vec![Door {
            side: SimSide::South,
            at: 1,
        }],
        windows: vec![Window {
            side: SimSide::North,
            at_mm: 1_000,
            width_mm: 2_000,
        }],
    })
    .expect("place the studio");
    w.apply(Command::PlaceEquipment {
        kind: sim_core::equipment::EquipmentKind::Desk,
        placement: Placement::Floor {
            pos: PosMm::new(31_000, 2_000),
            rot: 1,
        },
    })
    .expect("a desk in the studio");
    let desk = *w.building.equipment.keys().last().expect("the desk");
    w.apply(Command::PlaceObject {
        design: design_hash(0xd5),
        pos: PosMm::new(29_000, 1_500),
        rot: 0,
        summary: my_desk(),
    })
    .expect("a player's desk in the studio");
    w.apply(Command::PlaceObject {
        design: design_hash(0x5e),
        pos: PosMm::new(28_750, 3_500),
        rot: 1,
        summary: my_shelf(),
    })
    .expect("a player's shelf in the studio");
    w.apply(Command::PlaceObjectOnDesk {
        design: design_hash(0x70),
        desk,
        summary: my_mug(),
    })
    .expect("a mug on the studio's desk");
    w
}

pub fn room_id(w: &World, rect: TileRect) -> RoomId {
    w.building
        .rooms
        .values()
        .find(|r| r.rect == rect)
        .expect("room exists")
        .id
}

fn side(s: SimSide) -> Side {
    match s {
        SimSide::North => Side::North,
        SimSide::East => Side::East,
        SimSide::South => Side::South,
        SimSide::West => Side::West,
    }
}

fn kind_of(k: sim_core::building::RoomKind) -> RoomKind {
    RoomKind::ALL
        .into_iter()
        .find(|x| x.slug() == k.slug())
        .expect("room kind slug")
}

pub fn design_of(k: sim_core::equipment::EquipmentKind) -> EquipmentDesign {
    EquipmentDesign::from_slug(k.slug()).expect("equipment slug")
}

/// The sim's room as the designer's input: every door in its walls (its own
/// and the doors other rooms open into it), its windows that face outside,
/// and its equipment.
pub fn room_input(w: &World, rect: TileRect) -> Room {
    let id = room_id(w, rect);
    let r = &w.building.rooms[&id];
    let mut doors: Vec<Opening> = r
        .doors
        .iter()
        .map(|d| Opening {
            side: side(d.side),
            at_mm: d.at * TILE_MM,
            width_mm: TILE_MM,
        })
        .collect();
    for o in w.building.rooms.values().filter(|o| o.id != id) {
        for d in &o.doors {
            let t = o.rect.side_tile(d.side, d.at).neighbour(d.side);
            if r.rect.contains(t) {
                let s = d.side.opposite();
                let at = if matches!(s, SimSide::North | SimSide::South) {
                    t.x - r.rect.x
                } else {
                    t.z - r.rect.z
                };
                doors.push(Opening {
                    side: side(s),
                    at_mm: at * TILE_MM,
                    width_mm: TILE_MM,
                });
            }
        }
    }
    let windows = r
        .windows
        .iter()
        .filter(|win| r.rect.side_on_boundary_of(&w.building.lot, win.side))
        .map(|win| Opening {
            side: side(win.side),
            at_mm: win.at_mm,
            width_mm: win.width_mm,
        })
        .collect();
    let equipment = w
        .building
        .equipment
        .values()
        .filter(|e| e.room == id)
        .map(|e| ExistingItem {
            id: e.id.to_string(),
            design: design_of(e.kind),
            x_mm: e.pos.x,
            z_mm: e.pos.z,
            rot: e.rot,
            on_desk: e.attached_to.map(|d| d.to_string()),
        })
        .collect();
    let stud_mm = |n: u32| i32::try_from((n * 125).div_ceil(2)).expect("a footprint");
    let objects = w
        .building
        .objects
        .values()
        .filter(|o| o.room == id)
        .map(|o| ExistingObject {
            id: o.id.to_string(),
            x_mm: o.pos.x,
            z_mm: o.pos.z,
            rot: o.rot,
            footprint_mm: [
                stud_mm(o.summary.footprint[0]),
                stud_mm(o.summary.footprint[1]),
            ],
            workstation: o.is_workstation(),
            seat_at_mm: o.is_workstation().then_some(o.summary.seat_at).flatten(),
            on_desk: o.on_desk.map(|(desk, slot)| ObjectOnDesk {
                desk: desk.to_string(),
                slot: match slot {
                    sim_core::equipment::DeskSlot::Screen => DeskSlot::Screen,
                    sim_core::equipment::DeskSlot::Lamp => DeskSlot::Lamp,
                },
            }),
            seats: o.summary.seats,
            lights: o.summary.lights,
            storage: o.summary.storage,
            screens: o.summary.screens,
        })
        .collect();
    Room {
        kind: kind_of(r.kind),
        x_mm: r.rect.x * TILE_MM,
        z_mm: r.rect.z * TILE_MM,
        w_mm: r.rect.w * TILE_MM,
        d_mm: r.rect.d * TILE_MM,
        doors,
        windows,
        equipment,
        objects,
    }
}

/// The sim's own view of the room (`World::designer_room`, the JSON the
/// orchestrator receives), parsed as the designer's `Room`.
pub fn designer_room(w: &World, rect: TileRect) -> Room {
    let v = serde_json::to_value(w.designer_room(room_id(w, rect)).expect("a room"))
        .expect("serialises");
    serde_json::from_value(v).expect("the designer reads the sim's room")
}

/// A fixture: a room (from the test world when `sim_room` is set), a brief,
/// a good plan and bad plans with the error codes they must produce.
#[derive(serde::Deserialize)]
pub struct Fixture {
    pub name: String,
    #[serde(default)]
    pub sim_room: Option<String>,
    pub room: Room,
    pub brief: office_designer::Brief,
    pub good: serde_json::Value,
    pub bad: Vec<Bad>,
}

#[derive(serde::Deserialize)]
pub struct Bad {
    pub why: String,
    pub plan: serde_json::Value,
    #[serde(default)]
    pub brief: Option<office_designer::Brief>,
    pub codes: Vec<String>,
    #[serde(default)]
    pub placement: Option<usize>,
    #[serde(default)]
    pub code: Option<String>,
}

pub const FIXTURES: [(&str, &str); 6] = [
    ("archive", include_str!("../fixtures/archive.json")),
    ("dark-office", include_str!("../fixtures/dark-office.json")),
    ("kitchen", include_str!("../fixtures/kitchen.json")),
    (
        "meeting-room",
        include_str!("../fixtures/meeting-room.json"),
    ),
    ("newsroom", include_str!("../fixtures/newsroom.json")),
    ("studio", include_str!("../fixtures/studio.json")),
];

pub fn fixtures() -> Vec<(&'static str, Fixture)> {
    FIXTURES
        .iter()
        .map(|(n, s)| (*n, serde_json::from_str(s).expect("fixture parses")))
        .collect()
}

pub fn sim_rect(name: &str) -> TileRect {
    match name {
        "meeting-room" => MEETING_ROOM,
        "kitchen" => KITCHEN,
        "archive" => ARCHIVE,
        "newsroom" => NEWSROOM,
        "studio" => STUDIO,
        other => panic!("no sim room {other}"),
    }
}

pub fn plan(v: &serde_json::Value) -> office_designer::Plan {
    office_designer::Plan::from_value(v).expect("fixture plan parses")
}
