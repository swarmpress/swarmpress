//! The sim → renderer contract (ADR-0007). The renderer never decides
//! gameplay facts; it draws exactly this. Everything here is derived from the
//! [`World`] on demand, so it can never drift from the simulation.
//!
//! Lighting rules:
//! - a room is **On** when someone is staying in it (not just walking
//!   through) and it is dark outside (before 07:30 / from 16:30) or the room
//!   has no exterior window; **Dim** when people are only passing through
//!   under the same conditions; otherwise **Off**
//! - a monitor is on (`InUse`) while its desk's owner is seated at the desk
//! - a desk lamp is on while its desk is in use and the time is ≥ 17:00
//! - ceiling lights follow their room; the coffee machine is on while anyone
//!   is in; a whiteboard is on during a meeting in its room (`InUse` by the
//!   current speaker)

use serde::{Deserialize, Serialize};

use crate::building::RoomKind;
use crate::clock::{DayPhase, DESK_LAMP_ON};
use crate::equipment::{DeviceState, EquipmentKind};
use crate::geom::{PosMm, TileRect};
use crate::ids::{EquipId, MeetingId, PersonaId, RoomId, StaffId, WorkItemId};
use crate::staff::{Activity, Pose, Role, Spot};
use crate::world::World;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum Light {
    Off,
    Dim,
    On,
}

impl Light {
    pub const fn slug(self) -> &'static str {
        match self {
            Light::Off => "off",
            Light::Dim => "dim",
            Light::On => "on",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct RoomRender {
    pub id: RoomId,
    pub kind: RoomKind,
    pub rect: TileRect,
    pub floor: u8,
    pub light: Light,
    /// People inside right now (walking or staying).
    pub occupancy: u16,
    pub capacity: u16,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct DeviceRender {
    pub id: EquipId,
    pub room: RoomId,
    pub kind: EquipmentKind,
    pub pos: PosMm,
    pub rot: u8,
    pub attached_to: Option<EquipId>,
    pub state: DeviceState,
}

/// A walk the renderer interpolates: position at step `s` is the point
/// `(s - start_step) * speed_mm_per_step` millimetres along the waypoints.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PathRender {
    pub waypoints: Vec<PosMm>,
    pub start_step: u64,
    pub speed_mm_per_step: i32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct StaffRender {
    pub id: StaffId,
    pub persona: PersonaId,
    pub role: Role,
    pub pos_mm: PosMm,
    pub path: Option<PathRender>,
    pub pose: Pose,
    pub activity: Activity,
    pub seated_at: Option<EquipId>,
    pub fatigue: u16,
    pub morale: u16,
    /// The work item whose active phase this person works on
    /// ([`World::busy_with`]). At a desk it shows as [`Pose::Type`].
    pub work_item: Option<WorkItemId>,
}

/// A speech bubble: who is talking in a meeting, and for how long. The text
/// never enters the sim; the client fetches it by `(meeting, seq)`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct BubbleRender {
    pub meeting: MeetingId,
    /// The turn's `ServerCommand::Utterance` seq.
    pub seq: u32,
    pub speaker: StaffId,
    pub started_step: u64,
    /// The bubble is up until this step (exclusive).
    pub until_step: u64,
    pub chars: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct RenderState {
    pub step: u64,
    pub day: u32,
    pub minute: u16,
    pub phase: DayPhase,
    pub daylight: bool,
    pub cash_cents: i64,
    pub rooms: Vec<RoomRender>,
    pub devices: Vec<DeviceRender>,
    /// People on site only.
    pub staff: Vec<StaffRender>,
    /// One per meeting with a turn in progress, in meeting-id order.
    pub bubbles: Vec<BubbleRender>,
    /// Remarks in progress outside meetings (ADR-0074), in speaker-id order.
    #[serde(default)]
    pub remarks: Vec<RemarkRender>,
}

/// A remark's bubble: the client fetches the text by `seq` (ADR-0074).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct RemarkRender {
    pub seq: u32,
    pub speaker: StaffId,
    pub listener: Option<StaffId>,
    pub started_step: u64,
    pub until_step: u64,
    pub chars: u32,
}

impl World {
    pub fn render_state(&self) -> RenderState {
        render_state(self)
    }
}

/// Derives the render state of `w`.
pub fn render_state(w: &World) -> RenderState {
    let now = w.clock();
    let daylight = now.is_daylight();
    let on_site: Vec<_> = w.staff.values().filter(|s| s.is_on_site()).collect();

    let rooms: Vec<RoomRender> = w
        .building
        .rooms
        .values()
        .map(|r| {
            let inside = on_site.iter().filter(|s| r.rect.contains(s.pos.tile()));
            let (mut staying, mut passing) = (0u16, 0u16);
            for s in inside {
                if s.path.is_some() {
                    passing += 1;
                } else {
                    staying += 1;
                }
            }
            let needs_light = !daylight || !r.has_daylight(&w.building.lot);
            let light = match (needs_light, staying, passing) {
                (false, _, _) | (true, 0, 0) => Light::Off,
                (true, 0, _) => Light::Dim,
                _ => Light::On,
            };
            RoomRender {
                id: r.id,
                kind: r.kind,
                rect: r.rect,
                floor: r.floor,
                light,
                occupancy: staying + passing,
                capacity: r.capacity(),
            }
        })
        .collect();

    let room_light = |id: RoomId| {
        rooms
            .iter()
            .find(|r| r.id == id)
            .map_or(Light::Off, |r| r.light)
    };
    let seated_at = |desk: EquipId| {
        on_site
            .iter()
            .find(|s| s.seated_at() == Some(desk))
            .map(|s| s.id)
    };
    let anyone_in = !on_site.is_empty();

    let devices = w
        .building
        .equipment
        .values()
        .map(|e| {
            let state = match e.kind {
                EquipmentKind::Desk => seated_at(e.id).map_or(DeviceState::Off, DeviceState::InUse),
                EquipmentKind::Monitor | EquipmentKind::ColorMonitor => e
                    .attached_to
                    .and_then(|d| {
                        let owner = w.staff.values().find(|s| s.home_desk == Some(d))?;
                        (owner.seated_at() == Some(d)).then_some(owner.id)
                    })
                    .map_or(DeviceState::Off, DeviceState::InUse),
                EquipmentKind::DeskLamp => match e.attached_to.and_then(seated_at) {
                    Some(_) if now.minute >= DESK_LAMP_ON => DeviceState::On,
                    _ => DeviceState::Off,
                },
                EquipmentKind::CeilingLight => {
                    if room_light(e.room) == Light::Off {
                        DeviceState::Off
                    } else {
                        DeviceState::On
                    }
                }
                EquipmentKind::CoffeeMachine if anyone_in => DeviceState::On,
                EquipmentKind::Whiteboard => w
                    .meetings
                    .values()
                    .find(|m| m.room == e.room && m.is_active(now))
                    .map_or(DeviceState::Off, |m| {
                        m.speaker.map_or(DeviceState::On, DeviceState::InUse)
                    }),
                _ => DeviceState::Off,
            };
            DeviceRender {
                id: e.id,
                room: e.room,
                kind: e.kind,
                pos: e.pos,
                rot: e.rot,
                attached_to: e.attached_to,
                state,
            }
        })
        .collect();

    let staff = on_site
        .iter()
        .map(|s| {
            let work_item = w.busy_with(s.id);
            let pose = if s.path.is_some() {
                Pose::Walk
            } else {
                match (s.activity, s.spot) {
                    (Activity::InMeeting, Some(Spot::MeetingSeat { meeting, .. })) => {
                        match w.meetings.get(&meeting).and_then(|m| m.speaker) {
                            Some(sp) if sp == s.id => Pose::Talk,
                            _ => Pose::Listen,
                        }
                    }
                    // A remark in progress (ADR-0074): the speaker talks, the listener listens.
                    _ if w.remarks_now().any(|(sp, _)| sp == s.id) => Pose::Talk,
                    _ if w.remarks_now().any(|(_, r)| r.listener == Some(s.id)) => Pose::Listen,
                    // Typing means a job: someone at their desk types while
                    // a phase of theirs is being worked on, and sits otherwise.
                    (Activity::Working, _) if work_item.is_some() => Pose::Type,
                    (Activity::Working, _) => Pose::Sit,
                    (Activity::Lunch, Some(Spot::KitchenSeat { .. })) => Pose::Sit,
                    _ => Pose::Idle,
                }
            };
            StaffRender {
                id: s.id,
                persona: s.persona,
                role: s.role,
                pos_mm: s.pos,
                path: s.path.as_ref().map(|p| PathRender {
                    waypoints: p.waypoints.clone(),
                    start_step: p.start_step,
                    speed_mm_per_step: p.speed_mm_per_step,
                }),
                pose,
                activity: s.activity,
                seated_at: s.seated_at(),
                fatigue: s.fatigue,
                morale: s.morale,
                work_item,
            }
        })
        .collect();

    let bubbles = w
        .meetings
        .values()
        .filter_map(|m| {
            let speaker = m.speaker?;
            Some(BubbleRender {
                meeting: m.id,
                seq: m.next_seq.saturating_sub(1),
                speaker,
                started_step: m.speak_from,
                until_step: m.speak_until,
                chars: m.speak_chars,
            })
        })
        .collect();

    let remarks = w
        .remarks_now()
        .map(|(speaker, r)| RemarkRender {
            seq: r.seq,
            speaker,
            listener: r.listener,
            started_step: r.from_step,
            until_step: r.until_step,
            chars: r.chars,
        })
        .collect();

    RenderState {
        remarks,
        step: w.step,
        day: now.day,
        minute: now.minute,
        phase: now.phase(),
        daylight,
        cash_cents: w.company.cash,
        rooms,
        devices,
        staff,
        bubbles,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clock::hm;
    use crate::scenarios::demo_office;

    fn run_until(w: &mut World, minute: u16) {
        while w.clock().minute < minute {
            w.step();
        }
    }

    #[test]
    fn empty_office_at_dawn() {
        let w = demo_office(3);
        let rs = w.render_state();
        assert_eq!(rs.minute, hm(7, 0));
        assert_eq!(rs.phase, DayPhase::Arrival);
        assert!(!rs.daylight);
        assert!(rs.staff.is_empty());
        assert!(rs.rooms.iter().all(|r| r.light == Light::Off));
        assert!(rs.devices.iter().all(|d| d.state == DeviceState::Off));
    }

    #[test]
    fn walkers_carry_paths_and_dim_lights() {
        let mut w = demo_office(3);
        // Marco arrives ~08:00 while it is daylight; find any walker
        let mut seen_walker = false;
        while w.clock().minute < hm(9, 30) {
            w.step();
            let rs = w.render_state();
            for s in &rs.staff {
                if s.pose == Pose::Walk {
                    seen_walker = true;
                    let p = s.path.as_ref().expect("walkers have a path");
                    assert!(p.waypoints.len() >= 2);
                    assert!(p.start_step <= rs.step);
                }
            }
        }
        assert!(seen_walker);
    }

    #[test]
    fn lamps_after_five() {
        let mut w = demo_office(3);
        run_until(&mut w, hm(16, 0));
        let lamps_on = |w: &World| {
            w.render_state()
                .devices
                .iter()
                .filter(|d| d.kind == EquipmentKind::DeskLamp && d.state == DeviceState::On)
                .count()
        };
        assert_eq!(lamps_on(&w), 0);
        run_until(&mut w, hm(17, 10));
        assert!(lamps_on(&w) >= 3);
        // dark outside after 16:30: occupied newsroom is lit
        let rs = w.render_state();
        let newsroom = rs
            .rooms
            .iter()
            .find(|r| r.kind == RoomKind::Newsroom)
            .unwrap();
        assert_eq!(newsroom.light, Light::On);
        assert!(rs
            .devices
            .iter()
            .filter(|d| d.kind == EquipmentKind::CeilingLight && d.room == newsroom.id)
            .all(|d| d.state == DeviceState::On));
    }

    #[test]
    fn render_state_round_trips_postcard() {
        let mut w = demo_office(3);
        run_until(&mut w, hm(10, 0));
        let rs = w.render_state();
        let bytes = postcard::to_allocvec(&rs).unwrap();
        assert_eq!(postcard::from_bytes::<RenderState>(&bytes).unwrap(), rs);
    }
}
