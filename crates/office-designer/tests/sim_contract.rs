//! The designer against the sim (sim-core as a dev-dependency only): the
//! mirrored rules are the sim's, the fixture rooms are the sim's rooms, and
//! every solved placement passes the sim's own validation when applied
//! command by command to a sim world.

mod common;

use std::collections::{BTreeMap, BTreeSet};

use office_designer::model::{self, seat_pos, Pos};
use office_designer::{
    evaluate, At, Brief, Catalogue, DeskRef, EquipmentDesign, IssueCode, Plan, RoomKind, SolvedItem,
};
use sim_core::commands::{Command, Placement};
use sim_core::equipment::{DeskSlot, EquipmentKind};
use sim_core::geom::{PosMm, TileRect};
use sim_core::ids::EquipId;
use sim_core::objects::{Mount, ObjectSummary};
use sim_core::World;

fn kind(d: EquipmentDesign) -> EquipmentKind {
    EquipmentKind::ALL
        .into_iter()
        .find(|k| k.slug() == d.slug())
        .expect("every design is a sim kind")
}

#[test]
fn the_mirrored_rules_are_the_sims() {
    assert_eq!(EquipmentDesign::ALL.len(), EquipmentKind::ALL.len());
    for d in EquipmentDesign::ALL {
        let k = kind(d);
        assert_eq!(d, common::design_of(k));
        assert_eq!(d.cost(), k.cost(), "{}", d.slug());
        assert_eq!(d.sim_footprint_mm(), k.footprint_mm(), "{}", d.slug());
        let slot = k.desk_slot().map(|s| match s {
            DeskSlot::Screen => model::DeskSlot::Screen,
            DeskSlot::Lamp => model::DeskSlot::Lamp,
        });
        assert_eq!(d.desk_slot(), slot, "{}", d.slug());
        assert_eq!(
            d.required_room().map(RoomKind::slug),
            k.required_room().map(|r| r.slug()),
            "{}",
            d.slug()
        );
    }
    assert_eq!(RoomKind::ALL.len(), sim_core::building::RoomKind::ALL.len());
    for (a, b) in RoomKind::ALL
        .into_iter()
        .zip(sim_core::building::RoomKind::ALL)
    {
        assert_eq!(a.slug(), b.slug());
        assert_eq!(a.label(), b.label());
        assert_eq!(a.tiles_per_person(), b.tiles_per_person());
    }
    assert_eq!(model::SEAT_OFFSET_MM, sim_core::equipment::SEAT_OFFSET_MM);
    assert_eq!(
        model::WALL_CLEARANCE_MM,
        sim_core::equipment::WALL_CLEARANCE_MM
    );
    assert_eq!(
        model::SEAT_CLEARANCE_MM,
        sim_core::equipment::SEAT_CLEARANCE_MM
    );
    assert_eq!(
        model::MAX_ITEMS_PER_ROOM,
        sim_core::equipment::MAX_ITEMS_PER_ROOM
    );
    assert_eq!(
        model::CEILING_LIGHT_SPACING_MM,
        sim_core::validate::CEILING_LIGHT_SPACING_MM
    );
    assert_eq!(model::TABLE_SEATS, sim_core::staff::ROUND_TABLE_SEATS);
    assert_eq!(model::TILE_MM, sim_core::geom::TILE_MM);
    assert_eq!(model::CHAIR_HALF_MM, sim_core::objects::CHAIR_HALF_MM);
    for rot in 0..4 {
        assert_eq!(
            model::turn_offset([100, 40], rot),
            sim_core::objects::turn_offset([100, 40], rot)
        );
    }
    for rot in 0..4 {
        let p = sim_core::equipment::seat_pos(PosMm::new(5_000, 7_000), rot);
        assert_eq!(seat_pos(Pos::new(5_000, 7_000), rot), Pos::new(p.x, p.z));
    }
}

#[test]
fn the_fixture_rooms_are_the_sims_rooms() {
    let w = common::world();
    for (name, f) in common::fixtures() {
        let Some(sim) = f.sim_room.as_deref() else {
            continue;
        };
        let rect = common::sim_rect(sim);
        assert_eq!(common::room_input(&w, rect), f.room, "{name}");
        // the JSON the sim hands the orchestrator (`World::designer_room`) is the same room
        assert_eq!(common::designer_room(&w, rect), f.room, "{name}");
        let r = &w.building.rooms[&common::room_id(&w, rect)];
        assert_eq!(f.room.capacity(), i64::from(r.capacity()), "{name}");
    }
}

/// Applies solved items to the sim in order; planned desks get the ids the
/// sim gave them. Returns the first rejection.
fn apply(w: &mut World, rect: TileRect, items: &[SolvedItem]) -> Result<(), String> {
    let room = common::room_id(w, rect);
    let mut desks: BTreeMap<(usize, u8), EquipId> = BTreeMap::new();
    for it in items {
        let placement = match &it.at {
            At::Floor { x_mm, z_mm, rot } => Placement::Floor {
                pos: PosMm::new(*x_mm, *z_mm),
                rot: *rot,
            },
            At::OnDesk {
                desk: DeskRef::Planned { placement, copy },
            } => Placement::OnDesk(desks[&(*placement, *copy)]),
            At::OnDesk {
                desk: DeskRef::Existing { id },
            } => Placement::OnDesk(EquipId::parse(id).expect("an equip id")),
        };
        let before: BTreeSet<EquipId> = w.building.equipment.keys().copied().collect();
        w.apply(Command::PlaceEquipment {
            kind: kind(it.design),
            placement,
        })
        .map_err(|e| format!("{it:?}: the sim refuses: {e}"))?;
        let new: Vec<EquipId> = w
            .building
            .equipment
            .keys()
            .copied()
            .filter(|k| !before.contains(k))
            .collect();
        assert_eq!(new.len(), 1);
        assert_eq!(w.building.equipment[&new[0]].room, room, "{it:?}");
        if it.design == EquipmentDesign::Desk {
            desks.insert((it.placement, it.copy), new[0]);
        }
    }
    Ok(())
}

#[test]
fn every_solved_fixture_placement_passes_the_sims_validation() {
    let base = common::world();
    let cat = Catalogue::shipped();
    let mut applied = 0;
    for (name, f) in common::fixtures() {
        let Some(sim) = f.sim_room.as_deref() else {
            continue;
        };
        let eval = evaluate(&f.room, &common::plan(&f.good), &f.brief, cat);
        assert!(eval.ok, "{name}");
        let mut w = base.clone();
        let cash = w.company.cash;
        apply(&mut w, common::sim_rect(sim), &eval.items).unwrap_or_else(|e| panic!("{name}: {e}"));
        // economic builds cost the plan's price; sandbox builds (ADR-0087) nothing
        let charged = cash - w.company.cash;
        assert!(
            charged == eval.cost_cents || charged == 0,
            "{name}: the sim charged {charged}, the plan costs {}",
            eval.cost_cents
        );
        applied += eval.items.len();
    }
    assert!(applied >= 20);
}

/// A tiny deterministic generator for the property test.
struct Lcg(u64);

impl Lcg {
    fn next(&mut self, n: u64) -> u64 {
        self.0 = self
            .0
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        (self.0 >> 33) % n
    }
}

fn random_plan(g: &mut Lcg, room: &office_designer::Room) -> Plan {
    let walls = ["wall:north", "wall:east", "wall:south", "wall:west"];
    let facings = [
        "away",
        "toward",
        "room-centre",
        "north",
        "east",
        "south",
        "west",
    ];
    let designs: Vec<EquipmentDesign> = EquipmentDesign::ALL
        .into_iter()
        .filter(|d| {
            (d.desk_slot().is_none() || !room.objects.is_empty()) && d.allowed_in(room.kind)
        })
        .collect();
    // what an item anchor may name: equipment and the players' floor designs
    let items: Vec<String> = room
        .equipment
        .iter()
        .map(|e| e.id.clone())
        .chain(
            room.objects
                .iter()
                .filter(|o| o.is_floor())
                .map(|o| o.id.clone()),
        )
        .collect();
    let n = 1 + g.next(3);
    let mut list = Vec::new();
    for i in 0..n {
        let d = designs[usize::try_from(g.next(designs.len() as u64)).unwrap_or(0)];
        let anchor = match g.next(5) {
            0 => "room-centre".to_string(),
            1 if i > 0 => format!("placement:{}", g.next(i)),
            2 if !items.is_empty() => {
                let e = &items[usize::try_from(g.next(items.len() as u64)).unwrap_or(0)];
                format!("equipment:{e}")
            }
            _ => walls[usize::try_from(g.next(4)).unwrap_or(0)].to_string(),
        };
        let mut p = serde_json::json!({
            "design": d.slug(),
            "anchor": anchor,
            "gap": g.next(24),
            "facing": facings[usize::try_from(g.next(7)).unwrap_or(0)],
            "count": 1 + g.next(3),
            "spacing": g.next(12),
        });
        if g.next(2) == 0 && anchor.starts_with("wall:") {
            let from = walls[usize::try_from(g.next(4)).unwrap_or(0)];
            p["from"] = serde_json::json!(from);
            p["offset"] = serde_json::json!(g.next(40));
        }
        if anchor.starts_with("placement:") || anchor.starts_with("equipment:") {
            p["side"] = serde_json::json!(
                ["north", "east", "south", "west"][usize::try_from(g.next(4)).unwrap_or(0)]
            );
        }
        list.push(p);
    }
    Plan::from_value(&serde_json::json!({ "placements": list })).expect("generated plan parses")
}

/// Furnishes a room of `w` at random with what the sim accepts: a desk or
/// two, the players' floor designs (some of them workstations, their seat
/// somewhere within reach) and desk-top designs on the room's desks.
/// Returns how many objects stand in the room.
fn random_objects(g: &mut Lcg, w: &mut World, rect: TileRect) -> usize {
    let room = common::room_id(w, rect);
    let spot = |g: &mut Lcg| {
        let (x0, z0) = (rect.x * 1_000, rect.z * 1_000);
        let x =
            x0 + i32::try_from(g.next(u64::try_from(rect.w).unwrap_or(1) * 8)).unwrap_or(0) * 125;
        let z =
            z0 + i32::try_from(g.next(u64::try_from(rect.d).unwrap_or(1) * 8)).unwrap_or(0) * 125;
        PosMm::new(x, z)
    };
    for _ in 0..g.next(3) {
        let pos = spot(g);
        let rot = u8::try_from(g.next(4)).unwrap_or(0);
        let _ = w.apply(Command::PlaceEquipment {
            kind: EquipmentKind::Desk,
            placement: Placement::Floor { pos, rot },
        });
    }
    for n in 0..(2 + g.next(8)) {
        let mut s = ObjectSummary {
            footprint: [
                u32::try_from(2 + g.next(30)).unwrap_or(2),
                u32::try_from(2 + g.next(30)).unwrap_or(2),
            ],
            height: 30,
            mount: Mount::Floor,
            seats: 0,
            workstation: false,
            seat_at: None,
            lights: u8::try_from(g.next(2)).unwrap_or(0),
            storage: u32::try_from(g.next(2) * 100).unwrap_or(0),
            screens: u8::try_from(g.next(2)).unwrap_or(0),
            parts: 50,
            cost: 1_000,
        };
        let design = common::design_hash(u8::try_from(n).unwrap_or(0));
        if g.next(4) == 0 {
            // a desk-top design on one of the room's desks
            let desks: Vec<EquipId> = w
                .building
                .equipment
                .values()
                .filter(|e| e.room == room && e.kind == EquipmentKind::Desk)
                .map(|e| e.id)
                .collect();
            if desks.is_empty() {
                continue;
            }
            s.mount = Mount::Surface;
            s.footprint = [4, 4];
            let desk = desks[usize::try_from(g.next(desks.len() as u64)).unwrap_or(0)];
            let _ = w.apply(Command::PlaceObjectOnDesk {
                design,
                desk,
                summary: s,
            });
            continue;
        }
        if g.next(2) == 0 {
            // a workstation: its seat in front, behind or beside it, within reach
            let (hw, hd) = (
                i32::try_from(s.footprint[0] * 125 / 4).unwrap_or(0),
                i32::try_from(s.footprint[1] * 125 / 4).unwrap_or(0),
            );
            let out = i32::try_from(g.next(900)).unwrap_or(0);
            let along = i32::try_from(g.next(200)).unwrap_or(0) - 100;
            s.workstation = true;
            s.seats = 1;
            s.seat_at = Some(match g.next(4) {
                0 => [along, hd + out],
                1 => [along, -hd - out],
                2 => [hw + out, along],
                _ => [-hw - out, along],
            });
        }
        let pos = spot(g);
        let rot = u8::try_from(g.next(4)).unwrap_or(0);
        let _ = w.apply(Command::PlaceObject {
            design,
            pos,
            rot,
            summary: s,
        });
    }
    w.building
        .objects
        .values()
        .filter(|o| o.room == room)
        .count()
}

/// The checks are at least as strict as the sim: whenever the designer
/// reports none of the issues the sim also judges (walls, collisions, room
/// kind, items per room), the sim accepts every command. Every other case
/// first furnishes the room at random with the players' own designs (and a
/// desk or two) and plans for the room as the sim hands it over
/// (`World::designer_room`). `PROPTEST_CASES` sets the cases per room (250).
#[test]
fn whatever_the_designer_accepts_the_sim_accepts() {
    let base = common::world();
    let cat = Catalogue::shipped();
    let sim_judges = [
        IssueCode::Collision,
        IssueCode::IntoWall,
        IssueCode::WallClearance,
        IssueCode::WrongRoom,
        IssueCode::TooManyItems,
    ];
    let cases: usize = std::env::var("PROPTEST_CASES")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(250);
    let mut g = Lcg(0x5eed);
    let mut accepted = 0;
    let mut flagged = 0;
    let (mut with_objects, mut objects, mut by_objects) = (0, 0, 0);
    for (_, f) in common::fixtures() {
        let Some(sim) = f.sim_room.as_deref() else {
            continue;
        };
        let rect = common::sim_rect(sim);
        for n in 0..cases {
            let mut w = base.clone();
            let room = if n % 2 == 1 {
                objects += random_objects(&mut g, &mut w, rect);
                common::designer_room(&w, rect)
            } else {
                f.room.clone()
            };
            let plan = random_plan(&mut g, &room);
            let eval = evaluate(&room, &plan, &Brief::default(), cat);
            if eval.errors().any(|i| sim_judges.contains(&i.code)) {
                flagged += 1;
                if eval
                    .errors()
                    .any(|i| i.message.contains("the CEO's own design"))
                {
                    by_objects += 1;
                }
                continue;
            }
            apply(&mut w, rect, &eval.items).unwrap_or_else(|e| {
                panic!(
                    "{}\n{}\n{e}",
                    serde_json::to_string(&room).unwrap_or_default(),
                    plan.to_json()
                )
            });
            accepted += eval.items.len();
            if !room.objects.is_empty() {
                with_objects += eval.items.len();
            }
        }
    }
    let scale = cases / 250;
    assert!(accepted > 300 * scale, "accepted {accepted}");
    assert!(flagged > 100 * scale, "flagged {flagged}");
    assert!(objects > 500 * scale, "objects placed {objects}");
    assert!(
        with_objects > 100 * scale,
        "accepted with objects {with_objects}"
    );
    assert!(by_objects > 50 * scale, "flagged for objects {by_objects}");
}
