//! Shared test helpers: issue printing and the demo office's layout from
//! sim-core (read only), as room shell inputs and design placements.
#![allow(dead_code)]

use kit::shell::{LayoutRoom, Opening, Side};
use kit::{Issue, ParamValue, Params, RoomSpec};
use sim_core::building::{Building, RoomKind};
use sim_core::equipment::EquipmentKind;
use sim_core::geom::Side as SimSide;
use sim_core::ids::RoomId;

pub fn show(issues: &[Issue]) -> String {
    issues
        .iter()
        .map(ToString::to_string)
        .collect::<Vec<_>>()
        .join("\n")
}

pub fn side(s: SimSide) -> Side {
    match s {
        SimSide::North => Side::North,
        SimSide::East => Side::East,
        SimSide::South => Side::South,
        SimSide::West => Side::West,
    }
}

pub fn layout_rooms(b: &Building) -> Vec<LayoutRoom> {
    b.rooms
        .values()
        .map(|r| LayoutRoom {
            id: r.id.to_string(),
            kind: r.kind.slug().to_string(),
            x_mm: r.rect.x * 1000,
            z_mm: r.rect.z * 1000,
            w_mm: r.rect.w * 1000,
            d_mm: r.rect.d * 1000,
            doors: r
                .doors
                .iter()
                .map(|d| Opening {
                    side: side(d.side),
                    at_mm: d.at * 1000,
                    width_mm: 1000,
                })
                .collect(),
            windows: r
                .windows
                .iter()
                .map(|w| Opening {
                    side: side(w.side),
                    at_mm: w.at_mm,
                    width_mm: w.width_mm,
                })
                .collect(),
        })
        .collect()
}

pub fn demo() -> sim_core::World {
    sim_core::scenarios::demo_office(42)
}

pub fn demo_room_specs() -> Vec<RoomSpec> {
    kit::room_specs(&layout_rooms(&demo().building))
}

/// A shipped design placed in a room: what the renderer will do in K-3.
#[derive(Clone, Debug)]
pub struct Placement {
    pub design: String,
    pub params: Params,
    /// Centre on the floor, millimetres in the room's frame.
    pub x_mm: i32,
    pub z_mm: i32,
    pub rot: u8,
}

/// Every design the renderer would place in a room of the demo office:
/// its equipment through the kit's mapping, a chair per desk, and a table
/// with stools in the rooms that seat meetings and lunch.
pub fn demo_placements(w: &sim_core::World, room: RoomId) -> Vec<Placement> {
    let kit = kit::Kit::shipped();
    let map = kit.mapping();
    let r = &w.building.rooms[&room];
    let (ox, oz) = (r.rect.x * 1000, r.rect.z * 1000);
    let mut out = Vec::new();
    let mut place = |design: &str, x: i32, z: i32, rot: u8, params: Params| {
        out.push(Placement {
            design: design.to_string(),
            params,
            x_mm: x - ox,
            z_mm: z - oz,
            rot,
        });
    };
    for e in w.building.equipment.values().filter(|e| e.room == room) {
        let design = &map.equipment[e.kind.slug()];
        place(design, e.pos.x, e.pos.z, e.rot, Params::new());
        if e.kind == EquipmentKind::Desk {
            let seat = e.seat_pos();
            let mut p = Params::new();
            p.insert("colour".into(), ParamValue::Str("navy".into()));
            place(&map.desk_seat, seat.x, seat.z, e.rot, p);
        }
    }
    if matches!(
        r.kind,
        RoomKind::MeetingRoom | RoomKind::StrategyRoom | RoomKind::Kitchen
    ) {
        let c = r.rect.center_mm();
        place(&map.table, c.x, c.z, 0, Params::new());
        let seats = usize::from(r.capacity()).min(sim_core::staff::ROUND_TABLE_SEATS.len());
        for (dx, dz) in sim_core::staff::ROUND_TABLE_SEATS.iter().take(seats) {
            place(&map.table_seat, c.x + dx, c.z + dz, 0, Params::new());
        }
    }
    out
}
