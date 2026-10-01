//! Canned worlds and scripts.
//!
//! [`demo_office`] reproduces the M0 stand-in layout from
//! `apps/game/src/state/render-state.ts`: a 16×10 lot with a 10×10 newsroom
//! (four desks, north and west windows), a 6×5 editor's office (north window)
//! and a 6×5 window-less meeting room, staffed by Isabella, Lorenzo, Sophia,
//! Giulia and Marco. The newsroom is busy mid-morning; at night only Marco
//! (editor, on deadline) is in, until about 23:15.
//!
//! The demo is built through [`World::apply`], so it is also a valid world by
//! construction (construction costs are booked in the ledger).

use crate::building::{Building, Door, Entrance, RoomKind, Window};
use crate::clock::{hm, SimConfig};
use crate::commands::{
    Command, DemolishTarget, Input, OvertimePolicy, Placement, Policy, ServerCommand, SiteSignals,
};
use crate::economy::Company;
use crate::equipment::EquipmentKind;
use crate::geom::{PosMm, Side, Tile, TileRect};
use crate::ids::{CandidateId, EquipId, MeetingId, RoomId, StaffId};
use crate::staff::{persona_by_key, salary_for, Schedule, Seniority, Traits};
use crate::world::World;

/// Starting cash of the demo company before construction, cents ($150,000).
pub const DEMO_START_CASH: i64 = 15_000_000;
/// Company level of the demo (2: meeting rooms unlocked).
pub const DEMO_LEVEL: u8 = 2;

/// Steps the golden determinism test runs.
pub const GOLDEN_STEPS: u64 = 50_000;
/// Seed of the golden determinism test.
pub const GOLDEN_SEED: u64 = 42;

/// `(key, desk position, desk rotation, arrive, leave, lunch, traits)`
type DemoPerson = (&'static str, PosMm, u8, u16, u16, u16, Traits);

fn demo_people() -> [DemoPerson; 5] {
    let t = |rigor, speed, creativity, sociability, resilience, ambition| Traits {
        rigor,
        speed,
        creativity,
        sociability,
        resilience,
        ambition,
    };
    [
        (
            "isabella",
            PosMm::new(2_500, 3_000),
            0,
            hm(8, 10),
            hm(18, 0),
            hm(12, 30),
            t(600, 750, 800, 700, 650, 700),
        ),
        (
            "lorenzo",
            PosMm::new(5_000, 3_000),
            0,
            hm(8, 40),
            hm(17, 30),
            hm(12, 45),
            t(850, 450, 700, 500, 600, 500),
        ),
        (
            "sophia",
            PosMm::new(2_500, 6_500),
            0,
            hm(9, 0),
            hm(20, 30),
            hm(13, 0),
            t(700, 600, 600, 800, 700, 650),
        ),
        (
            "giulia",
            PosMm::new(5_000, 6_500),
            0,
            hm(9, 15),
            hm(18, 30),
            hm(12, 30),
            t(650, 550, 850, 750, 600, 600),
        ),
        (
            "marco",
            PosMm::new(13_000, 2_500),
            2,
            hm(8, 0),
            hm(23, 15),
            hm(13, 0),
            t(900, 600, 500, 550, 800, 750),
        ),
    ]
}

/// The demo office with the default clock (20 real minutes per day, 07:00 start).
pub fn demo_office(seed: u64) -> World {
    demo_office_with_config(seed, SimConfig::default())
}

/// The demo office with a custom clock.
pub fn demo_office_with_config(seed: u64, config: SimConfig) -> World {
    let building = Building::new(
        TileRect::new(0, 0, 16, 10),
        Entrance {
            tile: Tile::new(4, 9),
            side: Side::South,
        },
    );
    let mut w = World::with_parts(
        seed,
        config,
        building,
        Company::new(DEMO_START_CASH, DEMO_LEVEL),
    );
    let must = |w: &mut World, c: Command| {
        w.apply(c).expect("demo command is valid");
    };
    let window = |side, at_mm, width_mm| Window {
        side,
        at_mm,
        width_mm,
    };
    must(
        &mut w,
        Command::PlaceRoom {
            kind: RoomKind::Newsroom,
            rect: TileRect::new(0, 0, 10, 10),
            floor: 0,
            doors: vec![
                Door {
                    side: Side::East,
                    at: 2,
                },
                Door {
                    side: Side::East,
                    at: 7,
                },
            ],
            windows: vec![
                window(Side::North, 1_500, 2_500),
                window(Side::North, 6_000, 2_500),
                window(Side::West, 2_000, 2_500),
                window(Side::West, 6_000, 2_500),
            ],
        },
    );
    must(
        &mut w,
        Command::PlaceRoom {
            kind: RoomKind::EditorOffice,
            rect: TileRect::new(10, 0, 6, 5),
            floor: 0,
            doors: vec![],
            windows: vec![window(Side::North, 1_500, 3_000)],
        },
    );
    must(
        &mut w,
        Command::PlaceRoom {
            kind: RoomKind::MeetingRoom,
            rect: TileRect::new(10, 5, 6, 5),
            floor: 0,
            doors: vec![],
            windows: vec![],
        },
    );
    for (key, pos, rot, arrive, leave, lunch, traits) in demo_people() {
        let desk = w.ids.peek_equip();
        must(
            &mut w,
            Command::PlaceEquipment {
                kind: EquipmentKind::Desk,
                placement: Placement::Floor { pos, rot },
            },
        );
        for kind in [EquipmentKind::Monitor, EquipmentKind::DeskLamp] {
            must(
                &mut w,
                Command::PlaceEquipment {
                    kind,
                    placement: Placement::OnDesk(desk),
                },
            );
        }
        let persona = persona_by_key(key).expect("demo persona exists");
        let role = crate::staff::persona(persona).role;
        w.add_staff(
            persona,
            role,
            Seniority::Senior,
            traits,
            salary_for(role, Seniority::Senior),
            Schedule::new(arrive, leave, lunch),
            Some(desk),
        );
    }
    // Shortlist without the people already on staff (candidates 4..=6).
    w.refresh_candidates();
    w
}

/// The fixed command log of the golden determinism test, as
/// `(step, input)`. Each entry is enqueued at `(step, 0)`.
///
/// Covers: buying land, building a kitchen (lunch moves there), buying a desk
/// with a monitor and lamp, hiring, two standup utterances, site signals,
/// overtime policy changes, firing someone mid-shift, placing and removing a
/// plant, and demolishing the kitchen at night.
pub fn golden_script() -> Vec<(u64, Input)> {
    let p = |c: Command| Input::Player(c);
    let s = |c: ServerCommand| Input::Server(c);
    vec![
        (
            100,
            p(Command::BuyFloorSpace {
                side: Side::East,
                tiles: 4,
            }),
        ),
        (
            200,
            p(Command::PlaceRoom {
                kind: RoomKind::Kitchen,
                rect: TileRect::new(16, 5, 4, 5),
                floor: 0,
                doors: vec![Door {
                    side: Side::West,
                    at: 1,
                }],
                windows: vec![Window {
                    side: Side::East,
                    at_mm: 1_000,
                    width_mm: 2_000,
                }],
            }),
        ),
        (
            300,
            p(Command::PlaceEquipment {
                kind: EquipmentKind::CoffeeMachine,
                placement: Placement::Floor {
                    pos: PosMm::new(19_000, 9_000),
                    rot: 0,
                },
            }),
        ),
        (
            400,
            p(Command::PlaceEquipment {
                kind: EquipmentKind::Desk,
                placement: Placement::Floor {
                    pos: PosMm::new(7_500, 3_000),
                    rot: 0,
                },
            }),
        ),
        (
            401,
            p(Command::PlaceEquipment {
                kind: EquipmentKind::Monitor,
                placement: Placement::OnDesk(EquipId(24)),
            }),
        ),
        (
            402,
            p(Command::PlaceEquipment {
                kind: EquipmentKind::DeskLamp,
                placement: Placement::OnDesk(EquipId(24)),
            }),
        ),
        (
            500,
            p(Command::Hire {
                candidate: CandidateId(4),
            }),
        ),
        // day 1, 09:12: standup turns
        (
            13_100,
            s(ServerCommand::Utterance {
                meeting: MeetingId(2),
                seq: 0,
                speaker: StaffId(5),
                chars: 140,
            }),
        ),
        (
            13_140,
            s(ServerCommand::Utterance {
                meeting: MeetingId(2),
                seq: 1,
                speaker: StaffId(1),
                chars: 80,
            }),
        ),
        // day 1, 23:00
        (
            20_000,
            p(Command::SetPolicy(Policy::Overtime(OvertimePolicy::Crunch))),
        ),
        // day 2, 07:00
        (
            24_000,
            s(ServerCommand::SiteSignals(SiteSignals {
                live_pages: 61,
                languages: 4,
                broken_links: 3,
                media_count: 338,
                lighthouse_performance: 91,
                lighthouse_accessibility: 96,
                lighthouse_seo: 100,
            })),
        ),
        // day 2, 19:00
        (
            30_000,
            p(Command::SetPolicy(Policy::Overtime(OvertimePolicy::Allow))),
        ),
        // day 3, 10:00: Lorenzo walks out mid-shift
        (37_500, p(Command::Fire { staff: StaffId(2) })),
        (
            39_000,
            p(Command::PlaceEquipment {
                kind: EquipmentKind::Plant,
                placement: Placement::Floor {
                    pos: PosMm::new(8_500, 8_500),
                    rot: 0,
                },
            }),
        ),
        (
            40_000,
            p(Command::Demolish(DemolishTarget::Equipment(EquipId(27)))),
        ),
        // day 4, 03:00: nobody in; the kitchen goes
        (
            46_000,
            p(Command::Demolish(DemolishTarget::Room(RoomId(4)))),
        ),
    ]
}

/// Result of each scripted input, with the step it was applied at.
pub type ScriptResults = Vec<(u64, Result<(), crate::Reject>)>;

/// Builds the demo office, enqueues [`golden_script`] and runs `steps` steps.
/// Returns the world and every queued input's result in order.
pub fn run_golden(steps: u64) -> (World, ScriptResults) {
    let mut w = demo_office(GOLDEN_SEED);
    for (step, input) in golden_script() {
        w.enqueue(step, 0, input).expect("script is ordered");
    }
    let mut results = Vec::new();
    for _ in 0..steps {
        let at = w.step;
        for (_, r) in w.step().applied {
            results.push((at, r));
        }
    }
    (w, results)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::render_state::Light;
    use crate::staff::Activity;

    fn run_until(w: &mut World, day: u32, minute: u16) {
        while (w.clock().day, w.clock().minute) < (day, minute) {
            w.step();
        }
    }

    fn room_id(w: &World, kind: RoomKind) -> RoomId {
        w.building.first_room_of(kind).unwrap().id
    }

    #[test]
    fn demo_matches_the_ts_layout() {
        let w = demo_office(1);
        assert_eq!(w.building.lot, TileRect::new(0, 0, 16, 10));
        assert_eq!(w.building.rooms.len(), 3);
        let desks: Vec<_> = w
            .building
            .equipment
            .values()
            .filter(|e| e.kind == EquipmentKind::Desk)
            .map(|e| e.pos)
            .collect();
        assert_eq!(
            desks,
            vec![
                PosMm::new(2_500, 3_000),
                PosMm::new(5_000, 3_000),
                PosMm::new(2_500, 6_500),
                PosMm::new(5_000, 6_500),
                PosMm::new(13_000, 2_500),
            ]
        );
        assert_eq!(w.staff.len(), 5);
        assert_eq!(w.ids.peek_equip(), EquipId(22), "golden script ids");
        assert_eq!(w.candidates.len(), 3);
        assert!(w
            .candidates
            .values()
            .all(|c| !w.staff.values().any(|s| s.persona == c.persona)));
        assert!(w.company.cash < DEMO_START_CASH);
        assert_eq!(w.ledger.opening_cash + w.ledger.total(), w.company.cash);
    }

    #[test]
    fn newsroom_busy_mid_morning() {
        let mut w = demo_office(11);
        run_until(&mut w, 0, hm(10, 30));
        let rs = w.render_state();
        let newsroom = room_id(&w, RoomKind::Newsroom);
        let r = rs.rooms.iter().find(|r| r.id == newsroom).unwrap();
        assert_eq!(r.occupancy, 4);
        // daylight + windows: lights off
        assert_eq!(r.light, Light::Off);
        // window-less meeting room is empty after the standup
        let meeting = room_id(&w, RoomKind::MeetingRoom);
        let m = rs.rooms.iter().find(|r| r.id == meeting).unwrap();
        assert_eq!(m.occupancy, 0);
        assert_eq!(m.light, Light::Off);
        assert_eq!(rs.staff.len(), 5);
        assert!(rs.staff.iter().all(|s| s.seated_at.is_some()));
        assert_eq!(w.nav_failures, 0);
    }

    #[test]
    fn standup_fills_the_meeting_room() {
        let mut w = demo_office(11);
        run_until(&mut w, 0, hm(9, 12));
        let meeting = room_id(&w, RoomKind::MeetingRoom);
        let rs = w.render_state();
        let m = rs.rooms.iter().find(|r| r.id == meeting).unwrap();
        assert!(m.occupancy >= 3, "occupancy {}", m.occupancy);
        // no windows: lit whenever occupied
        assert_eq!(m.light, Light::On);
    }

    #[test]
    fn only_marco_at_night() {
        let mut w = demo_office(11);
        run_until(&mut w, 0, hm(23, 0));
        let rs = w.render_state();
        assert_eq!(rs.staff.len(), 1);
        let marco = &w.staff[&rs.staff[0].id];
        assert_eq!(crate::staff::persona(marco.persona).name, "Marco");
        assert_eq!(marco.activity, Activity::Working);
        let editor = room_id(&w, RoomKind::EditorOffice);
        let newsroom = room_id(&w, RoomKind::Newsroom);
        let light = |id| rs.rooms.iter().find(|r| r.id == id).unwrap().light;
        assert_eq!(light(editor), Light::On);
        assert_eq!(light(newsroom), Light::Off);
        // his lamp and monitor are on, everyone else's are off
        let desk = marco.home_desk.unwrap();
        for d in &rs.devices {
            let on = d.state != crate::equipment::DeviceState::Off;
            match d.kind {
                EquipmentKind::Monitor | EquipmentKind::DeskLamp => {
                    assert_eq!(on, d.attached_to == Some(desk), "{d:?}");
                }
                _ => {}
            }
        }
        run_until(&mut w, 0, hm(23, 45));
        assert!(w.render_state().staff.is_empty(), "Marco went home");
    }

    #[test]
    fn golden_script_is_fully_accepted() {
        let (w, results) = run_golden(GOLDEN_STEPS);
        assert_eq!(results.len(), golden_script().len());
        for (step, r) in &results {
            assert_eq!(r, &Ok(()), "input at step {step}");
        }
        assert_eq!(w.nav_failures, 0);
        assert_eq!(w.pending_len(), 0);
        assert_eq!(w.ledger.opening_cash + w.ledger.total(), w.company.cash);
    }
}
