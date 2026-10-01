//! JSON views for the TypeScript client until it has a postcard decoder.
//!
//! Units: sim-core works in millimetres; these views convert to metres (the
//! renderer's unit) here at the boundary. Ids are strings (`room-1`,
//! `equip-7`, `staff-3`) so they can key JS objects.

use serde_json::{json, Map, Value};
use sim_core::building::Building;
use sim_core::equipment::{DeviceState, EquipmentKind};
use sim_core::geom::PosMm;
use sim_core::render_state::{Light, RenderState};
use sim_core::staff::{persona, Spot};
use sim_core::World;

/// Wall height in metres (single storey in M1).
pub const WALL_HEIGHT_M: f64 = 3.0;

/// Millimetres → metres. The only float math in the client facade.
#[allow(clippy::float_arithmetic)]
pub fn m(mm: i32) -> f64 {
    f64::from(mm) / 1000.0
}

/// Quarter turns → radians (clockwise seen from above, 0 = chair south).
#[allow(clippy::float_arithmetic)]
pub fn radians(rot: u8) -> f64 {
    f64::from(rot % 4) * std::f64::consts::FRAC_PI_2
}

fn tiles(t: i32) -> f64 {
    m(t * sim_core::geom::TILE_MM)
}

fn phase_slug(p: sim_core::DayPhase) -> &'static str {
    use sim_core::DayPhase::*;
    match p {
        Night => "night",
        Arrival => "arrival",
        Standup => "standup",
        Work => "work",
        Lunch => "lunch",
        Evening => "evening",
    }
}

fn state_slug(s: DeviceState) -> &'static str {
    match s {
        DeviceState::Off => "off",
        DeviceState::On => "on",
        DeviceState::InUse(_) => "in-use",
    }
}

fn point(p: PosMm) -> Value {
    json!([m(p.x), m(p.z)])
}

/// Building layout in the shape of the TS `BuildingLayout`
/// (`apps/game/src/state/render-state.ts`), plus doors, entrance and props.
pub fn layout(b: &Building) -> Value {
    let rooms: Vec<Value> = b
        .rooms
        .values()
        .map(|r| {
            let items = b.equipment.values().filter(|e| e.room == r.id);
            let mut desks = Vec::new();
            let mut lights = Vec::new();
            let mut props = Vec::new();
            for e in items {
                match e.kind {
                    EquipmentKind::Desk => desks.push(json!({
                        "id": e.id.to_string(),
                        "x": m(e.pos.x),
                        "z": m(e.pos.z),
                        "rot": radians(e.rot),
                        "seat": point(e.seat_pos()),
                    })),
                    EquipmentKind::CeilingLight => lights.push(json!({
                        "id": e.id.to_string(),
                        "x": m(e.pos.x),
                        "z": m(e.pos.z),
                    })),
                    kind => props.push(json!({
                        "id": e.id.to_string(),
                        "kind": kind.slug(),
                        "x": m(e.pos.x),
                        "z": m(e.pos.z),
                        "rot": radians(e.rot),
                        "attachedTo": e.attached_to.map(|d| d.to_string()),
                    })),
                }
            }
            json!({
                "id": r.id.to_string(),
                "kind": r.kind.slug(),
                "label": r.kind.label(),
                "x": tiles(r.rect.x),
                "z": tiles(r.rect.z),
                "w": tiles(r.rect.w),
                "d": tiles(r.rect.d),
                "floor": r.floor,
                "level": r.level,
                "capacity": r.capacity(),
                "windows": r.windows.iter().map(|w| json!({
                    "side": w.side.slug(),
                    "at": m(w.at_mm),
                    "width": m(w.width_mm),
                })).collect::<Vec<_>>(),
                "doors": r.doors.iter().map(|d| json!({
                    "side": d.side.slug(),
                    "at": tiles(d.at),
                    "width": 1.0,
                })).collect::<Vec<_>>(),
                "desks": desks,
                "ceilingLights": lights,
                "props": props,
            })
        })
        .collect();
    let e = b.entrance;
    // Centre of the entrance door on the lot boundary.
    let c = e.tile.center();
    let (dx, dz) = e.side.delta();
    let door = PosMm::new(
        c.x + dx * sim_core::geom::HALF_TILE_MM,
        c.z + dz * sim_core::geom::HALF_TILE_MM,
    );
    json!({
        "originX": tiles(b.lot.x),
        "originZ": tiles(b.lot.z),
        "width": tiles(b.lot.w),
        "depth": tiles(b.lot.d),
        "wallHeight": WALL_HEIGHT_M,
        "floors": b.floors,
        "entrance": {
            "side": e.side.slug(),
            "x": m(door.x),
            "z": m(door.z),
            "spawn": point(b.spawn_pos()),
        },
        "rooms": rooms,
    })
}

/// Render state in the shape of the TS `RenderState` (minute, day,
/// roomLights, monitors, deskLamps, staff[]) plus the richer sim fields.
pub fn render_state(w: &World, rs: &RenderState) -> Value {
    let mut room_lights = Map::new();
    let rooms: Vec<Value> = rs
        .rooms
        .iter()
        .map(|r| {
            room_lights.insert(r.id.to_string(), Value::Bool(r.light != Light::Off));
            json!({
                "id": r.id.to_string(),
                "kind": r.kind.slug(),
                "light": r.light.slug(),
                "occupancy": r.occupancy,
                "capacity": r.capacity,
            })
        })
        .collect();

    let mut monitors = Map::new();
    let mut lamps = Map::new();
    let devices: Vec<Value> = rs
        .devices
        .iter()
        .map(|d| {
            let on = d.state != DeviceState::Off;
            if let Some(desk) = d.attached_to {
                match d.kind {
                    EquipmentKind::Monitor | EquipmentKind::ColorMonitor => {
                        monitors.insert(desk.to_string(), Value::Bool(on));
                    }
                    EquipmentKind::DeskLamp => {
                        lamps.insert(desk.to_string(), Value::Bool(on));
                    }
                    _ => {}
                }
            }
            json!({
                "id": d.id.to_string(),
                "room": d.room.to_string(),
                "kind": d.kind.slug(),
                "state": state_slug(d.state),
                "user": match d.state {
                    DeviceState::InUse(s) => Value::String(s.to_string()),
                    _ => Value::Null,
                },
                "attachedTo": d.attached_to.map(|a| a.to_string()),
            })
        })
        .collect();

    let staff: Vec<Value> = rs
        .staff
        .iter()
        .map(|s| {
            let p = persona(s.persona);
            let meeting = w.staff.get(&s.id).and_then(|st| match st.spot {
                Some(Spot::MeetingSeat { meeting, .. }) => Some(meeting.to_string()),
                _ => None,
            });
            json!({
                "id": s.id.to_string(),
                "persona": p.key,
                "name": p.name,
                "color": format!("#{:06x}", p.color),
                "role": s.role.slug(),
                "x": m(s.pos_mm.x),
                "z": m(s.pos_mm.z),
                "pose": s.pose.slug(),
                "activity": s.activity.slug(),
                "seatedAt": s.seated_at.map(|d| d.to_string()),
                "meeting": meeting,
                "fatigue": s.fatigue,
                "morale": s.morale,
                "path": s.path.as_ref().map(|path| json!({
                    "waypoints": path.waypoints.iter().map(|p| point(*p)).collect::<Vec<_>>(),
                    "startStep": path.start_step,
                    "speed": m(path.speed_mm_per_step),
                })),
            })
        })
        .collect();

    json!({
        "step": rs.step,
        "day": rs.day,
        "minute": rs.minute,
        "phase": phase_slug(rs.phase),
        "daylight": rs.daylight,
        "cashCents": rs.cash_cents,
        "roomLights": room_lights,
        "monitors": monitors,
        "deskLamps": lamps,
        "rooms": rooms,
        "devices": devices,
        "staff": staff,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unit_conversion() {
        assert_eq!(m(2_500), 2.5);
        assert_eq!(radians(0), 0.0);
        assert_eq!(radians(2), std::f64::consts::PI);
    }
}
