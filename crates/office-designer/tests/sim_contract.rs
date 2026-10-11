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
        .filter(|d| d.desk_slot().is_none() && d.allowed_in(room.kind))
        .collect();
    let n = 1 + g.next(3);
    let mut list = Vec::new();
    for i in 0..n {
        let d = designs[usize::try_from(g.next(designs.len() as u64)).unwrap_or(0)];
        let anchor = match g.next(5) {
            0 => "room-centre".to_string(),
            1 if i > 0 => format!("placement:{}", g.next(i)),
            2 if !room.equipment.is_empty() => {
                let e = &room.equipment
                    [usize::try_from(g.next(room.equipment.len() as u64)).unwrap_or(0)];
                format!("equipment:{}", e.id)
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

/// The checks are at least as strict as the sim: whenever the designer
/// reports none of the issues the sim also judges (walls, collisions, room
/// kind, items per room), the sim accepts every command.
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
    let mut g = Lcg(0x5eed);
    let mut accepted = 0;
    let mut flagged = 0;
    for (_, f) in common::fixtures() {
        let Some(sim) = f.sim_room.as_deref() else {
            continue;
        };
        for _ in 0..250 {
            let plan = random_plan(&mut g, &f.room);
            let eval = evaluate(&f.room, &plan, &Brief::default(), cat);
            if eval.errors().any(|i| sim_judges.contains(&i.code)) {
                flagged += 1;
                continue;
            }
            let mut w = base.clone();
            apply(&mut w, common::sim_rect(sim), &eval.items)
                .unwrap_or_else(|e| panic!("{}\n{e}", plan.to_json()));
            accepted += eval.items.len();
        }
    }
    assert!(accepted > 300, "accepted {accepted}");
    assert!(flagged > 100, "flagged {flagged}");
}
