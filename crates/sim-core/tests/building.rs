//! Building in the game (ADR-0087, FEAT-026): `MoveEquipment`, the town
//! (`PlaceTownItem`, `MoveTownItem`, `RemoveTownItem`) seeded at founding,
//! sandbox and economic companies, and `layout_rev`.

use sim_core::commands::{Command, DemolishTarget, Placement};
use sim_core::economy::BuildMode;
use sim_core::equipment::EquipmentKind;
use sim_core::geom::{PosMm, Side};
use sim_core::ids::{EquipId, StaffId, TownItemId};
use sim_core::scenarios::{demo_office, scenario, scenario_with_mode};
use sim_core::staff::Spot;
use sim_core::town::{seed_arrangement, TownKind, HOUSE_MOVE_CENTS, MAX_TOWN_ITEMS};
use sim_core::{validate, Reject, World};

/// A spare desk in the newsroom (6.5 m, 4 m), with a monitor and a lamp.
const SPARE: EquipId = EquipId(62);
/// Another spare desk next to it (4 m, 4 m).
const SPARE_2: EquipId = EquipId(59);
/// Giulia's desk.
const GIULIA_DESK: EquipId = EquipId(17);

fn floor(x: i32, z: i32, rot: u8) -> Placement {
    Placement::Floor {
        pos: PosMm::new(x, z),
        rot,
    }
}

fn move_to(equipment: EquipId, placement: Placement) -> Command {
    Command::MoveEquipment {
        equipment,
        placement,
    }
}

fn riders(w: &World, desk: EquipId) -> Vec<EquipId> {
    w.building
        .equipment
        .values()
        .filter(|e| e.attached_to == Some(desk))
        .map(|e| e.id)
        .collect()
}

fn sandbox() -> World {
    scenario_with_mode("cinqueterre", 1, BuildMode::Sandbox).unwrap()
}

#[test]
fn the_town_is_founded_with_the_renderers_arrangement() {
    let w = demo_office(1);
    let town: Vec<_> = w
        .building
        .town
        .values()
        .map(|t| (t.kind, t.pos, t.rot))
        .collect();
    assert_eq!(
        town,
        seed_arrangement(&w.building.lot, &w.building.entrance)
    );
    let ids: Vec<u32> = w.building.town.keys().map(|id| id.0).collect();
    assert_eq!(ids, (1..=19).collect::<Vec<_>>());
    let plan = &w.building.town[&TownItemId(1)];
    assert_eq!(
        (plan.kind, plan.pos, plan.rot),
        (TownKind::PlanHouse, PosMm::new(3_000, -4_500), 0)
    );
    // the empty company has a town too, from its own lot
    let empty = scenario("empty", 1).unwrap();
    assert_eq!(empty.building.town.len(), 19);
    assert_eq!(
        empty.building.town[&TownItemId(1)].pos,
        PosMm::new(-1_000, -4_500)
    );
    // economic is the default
    assert_eq!(w.company.build_mode, BuildMode::Economic);
    assert_eq!(
        scenario_with_mode("cinqueterre", 1, BuildMode::Economic)
            .unwrap()
            .hash(),
        w.hash()
    );
}

#[test]
fn moving_a_desk_keeps_its_id_and_takes_what_sits_on_it() {
    let mut w = demo_office(1);
    let cash = w.company.cash;
    let rev = w.building.layout_rev;
    let on_it = riders(&w, SPARE);
    assert_eq!(on_it.len(), 2, "monitor and lamp");
    w.apply(move_to(SPARE, floor(6_500, 4_200, 2))).unwrap();
    let desk = &w.building.equipment[&SPARE];
    assert_eq!((desk.pos, desk.rot), (PosMm::new(6_500, 4_200), 2));
    assert_eq!(desk.seat_pos(), PosMm::new(6_500, 3_450));
    for id in &on_it {
        let e = &w.building.equipment[id];
        assert_eq!(
            (e.pos, e.rot, e.room, e.attached_to),
            (desk.pos, 2, desk.room, Some(SPARE))
        );
    }
    // labour: 10% of the desk's price
    assert_eq!(cash - w.company.cash, EquipmentKind::Desk.move_cost());
    assert_eq!(EquipmentKind::Desk.move_cost(), 4_000);
    assert_eq!(w.building.layout_rev, rev + 1);
    assert_eq!(w.render_state().layout_rev, rev + 1);
    // an assigned desk moves with its assignment while nobody is at it
    w.staff.get_mut(&StaffId(1)).unwrap().spot = None;
    w.apply(move_to(GIULIA_DESK, floor(1_500, 1_600, 0)))
        .unwrap();
    assert_eq!(w.staff[&StaffId(1)].home_desk(), Some(GIULIA_DESK));
    assert_eq!(
        w.building.equipment[&GIULIA_DESK].pos,
        PosMm::new(1_500, 1_600)
    );
}

#[test]
fn moving_equipment_is_validated_like_placing_it() {
    let mut w = demo_office(1);
    // unknown
    assert_eq!(
        validate(&w, &move_to(EquipId(999), floor(6_500, 4_000, 0))),
        Err(Reject::UnknownEquipment(EquipId(999)))
    );
    // onto the desk next to it
    assert_eq!(
        validate(&w, &move_to(SPARE, floor(4_500, 4_000, 0))),
        Err(Reject::Overlap)
    );
    // its own spot is free: it is checked against everything but itself
    assert_eq!(
        validate(&w, &move_to(SPARE, floor(6_500, 4_000, 1))),
        Ok(())
    );
    // walls, the chair, the hallway, turns
    assert!(matches!(
        validate(&w, &move_to(SPARE, floor(7_850, 4_000, 0))),
        Err(Reject::Invalid("too close to a wall"))
    ));
    assert!(matches!(
        validate(&w, &move_to(SPARE, floor(6_500, 5_500, 0))),
        Err(Reject::Invalid("the chair would be in the wall"))
    ));
    assert!(matches!(
        validate(&w, &move_to(SPARE, floor(6_500, 7_000, 0))),
        Err(Reject::Invalid("equipment goes inside a room"))
    ));
    assert!(matches!(
        validate(&w, &move_to(SPARE, floor(6_500, 4_000, 4))),
        Err(Reject::Invalid(_))
    ));
    // a camera rig stays in the photo studio
    assert!(matches!(
        validate(&w, &move_to(EquipId(70), floor(3_000, 12_000, 0))),
        Err(Reject::Invalid("this item needs a different room"))
    ));
    // desks stand on the floor, monitors on desks
    let monitor = riders(&w, SPARE)
        .into_iter()
        .find(|e| w.building.equipment[e].kind == EquipmentKind::Monitor)
        .unwrap();
    assert!(matches!(
        validate(&w, &move_to(SPARE, Placement::OnDesk(SPARE_2))),
        Err(Reject::Invalid(_))
    ));
    assert!(matches!(
        validate(&w, &move_to(monitor, floor(6_500, 4_000, 0))),
        Err(Reject::Invalid(_))
    ));
    assert_eq!(
        validate(&w, &move_to(monitor, Placement::OnDesk(SPARE_2))),
        Err(Reject::Occupied("that desk already has one"))
    );
    assert!(matches!(
        validate(&w, &move_to(monitor, Placement::OnDesk(EquipId(65)))),
        Err(Reject::Invalid("that is not a desk"))
    ));
    // with the other desk's monitor gone, it moves over
    let other = riders(&w, SPARE_2)
        .into_iter()
        .find(|e| w.building.equipment[e].kind == EquipmentKind::Monitor)
        .unwrap();
    w.apply(Command::Demolish(DemolishTarget::Equipment(other)))
        .unwrap();
    w.apply(move_to(monitor, Placement::OnDesk(SPARE_2)))
        .unwrap();
    let m = &w.building.equipment[&monitor];
    assert_eq!(
        (m.attached_to, m.pos),
        (Some(SPARE_2), PosMm::new(4_000, 4_000))
    );
    // someone at the desk, or on the way to it
    w.staff.get_mut(&StaffId(1)).unwrap().spot = Some(Spot::Desk(GIULIA_DESK));
    assert_eq!(
        validate(&w, &move_to(GIULIA_DESK, floor(1_500, 1_600, 0))),
        Err(Reject::Occupied("someone is working at this desk"))
    );
    let lamp = riders(&w, GIULIA_DESK)
        .into_iter()
        .find(|e| w.building.equipment[e].kind == EquipmentKind::DeskLamp)
        .unwrap();
    assert!(matches!(
        validate(&w, &move_to(lamp, Placement::OnDesk(SPARE_2))),
        Err(Reject::Occupied(_))
    ));
    // the money
    w.company.cash = 0;
    assert_eq!(
        validate(&w, &move_to(SPARE, floor(6_500, 4_000, 1))),
        Err(Reject::InsufficientFunds {
            need: 4_000,
            have: 0
        })
    );
}

fn place(kind: TownKind, x: i32, z: i32, rot: u8) -> Command {
    Command::PlaceTownItem {
        kind,
        pos: PosMm::new(x, z),
        rot,
    }
}

fn move_item(item: u32, x: i32, z: i32, rot: u8) -> Command {
    Command::MoveTownItem {
        item: TownItemId(item),
        pos: PosMm::new(x, z),
        rot,
    }
}

#[test]
fn town_items_are_placed_moved_and_removed() {
    let mut w = demo_office(1);
    let cash = w.company.cash;
    let rev = w.building.layout_rev;
    // a tree north of the row
    w.apply(place(TownKind::Tree, 9_000, -10_000, 1)).unwrap();
    let tree = TownItemId(20);
    assert_eq!(w.building.town[&tree].kind, TownKind::Tree);
    assert_eq!(cash - w.company.cash, 15_000);
    // the Plan house moves back and turns; labour only
    let before = w.company.cash;
    w.apply(move_item(1, 3_000, -12_000, 2)).unwrap();
    let house = &w.building.town[&TownItemId(1)];
    assert_eq!((house.pos, house.rot), (PosMm::new(3_000, -12_000), 2));
    assert_eq!(before - w.company.cash, HOUSE_MOVE_CENTS);
    // a tree moves for 10% of its price
    let before = w.company.cash;
    w.apply(move_item(20, 9_000, -11_000, 0)).unwrap();
    assert_eq!(before - w.company.cash, 1_500);
    // removing is free
    let before = w.company.cash;
    w.apply(Command::RemoveTownItem { item: tree }).unwrap();
    assert!(!w.building.town.contains_key(&tree));
    assert_eq!(before, w.company.cash);
    assert_eq!(w.building.layout_rev, rev + 4);
    // ids are never reused
    w.apply(place(TownKind::Bench, 9_000, -10_000, 0)).unwrap();
    assert!(w.building.town.contains_key(&TownItemId(21)));
}

#[test]
fn town_rules() {
    let w = demo_office(1);
    let invalid = |c: &Command| matches!(validate(&w, c), Err(Reject::Invalid(_)));
    // the houses are never placed or removed
    assert!(invalid(&place(TownKind::FactoryHouse, 9_000, -12_000, 0)));
    assert_eq!(
        validate(
            &w,
            &Command::RemoveTownItem {
                item: TownItemId(2)
            }
        ),
        Err(Reject::Invalid("the sections' houses cannot be removed"))
    );
    assert_eq!(
        validate(
            &w,
            &Command::RemoveTownItem {
                item: TownItemId(14)
            }
        ),
        Ok(())
    );
    // not in the lot, not past the town's edge, not on the street
    assert!(invalid(&place(TownKind::Tree, 5_000, 5_000, 0)));
    assert!(
        invalid(&place(TownKind::Tree, 5_000, -500, 0)),
        "straddles the lot's edge"
    );
    assert!(
        invalid(&place(TownKind::Tree, 5_000, -15_500, 0)),
        "past the town's edge"
    );
    assert!(
        invalid(&place(TownKind::StreetLamp, 10_000, 18_000, 0)),
        "the street"
    );
    assert!(
        invalid(&place(TownKind::StreetLamp, -1_500, 18_000, 0)),
        "the street's end"
    );
    assert_eq!(
        validate(&w, &place(TownKind::StreetLamp, -3_000, 18_000, 0)),
        Ok(()),
        "past the street's end"
    );
    assert_eq!(
        validate(&w, &place(TownKind::Bench, 10_000, 20_500, 0)),
        Ok(()),
        "across the street"
    );
    assert!(invalid(&place(TownKind::Tree, 9_000, -10_000, 4)));
    // not on another item: the Building house is 5 × 4 m round (9 m, -4.5 m)
    assert_eq!(
        validate(&w, &place(TownKind::Tree, 9_000, -7_200, 0)),
        Err(Reject::Overlap)
    );
    assert_eq!(
        validate(&w, &place(TownKind::Tree, 9_000, -7_250, 0)),
        Ok(())
    );
    // a bench turned a quarter is 375 mm wide along x
    assert_eq!(
        validate(&w, &place(TownKind::Bench, 6_000, -1_200, 1)),
        Err(Reject::Overlap),
        "the lamp at 6 m"
    );
    assert_eq!(
        validate(&w, &place(TownKind::Bench, 6_000, -2_500, 1)),
        Ok(())
    );
    // moving checks against everything but itself; a turned house is 4 × 5 m
    assert_eq!(validate(&w, &move_item(2, 9_000, -4_500, 0)), Ok(()));
    assert_eq!(validate(&w, &move_item(2, 9_500, -4_500, 0)), Ok(()));
    assert_eq!(
        validate(&w, &move_item(2, 12_000, -4_500, 0)),
        Err(Reject::Overlap),
        "the Factory house"
    );
    assert_eq!(validate(&w, &move_item(2, 9_000, -5_000, 1)), Ok(()));
    assert!(
        matches!(
            validate(&w, &move_item(2, 9_000, -2_000, 1)),
            Err(Reject::Invalid(_))
        ),
        "turned, it would reach into the lot"
    );
    assert_eq!(
        validate(&w, &move_item(99, 9_000, -10_000, 0)),
        Err(Reject::UnknownTownItem(TownItemId(99)))
    );
    assert_eq!(
        validate(
            &w,
            &Command::RemoveTownItem {
                item: TownItemId(99)
            }
        ),
        Err(Reject::UnknownTownItem(TownItemId(99)))
    );
}

#[test]
fn the_town_holds_at_most_64_items() {
    let mut w = sandbox();
    let mut n = w.building.town.len();
    'fill: for z in 0..6 {
        for x in 0..20 {
            if n == MAX_TOWN_ITEMS {
                break 'fill;
            }
            w.apply(place(
                TownKind::StreetLamp,
                -10_000 + x * 2_000,
                -9_000 - z * 1_000,
                0,
            ))
            .unwrap();
            n += 1;
        }
    }
    assert_eq!(w.building.town.len(), MAX_TOWN_ITEMS);
    assert_eq!(
        validate(&w, &place(TownKind::StreetLamp, 30_000, -12_000, 0)),
        Err(Reject::Limit("town items (64)"))
    );
}

#[test]
fn buying_land_moves_the_town_out_with_the_lot() {
    let mut w = demo_office(1);
    let rev = w.building.layout_rev;
    let east_lamp = w.building.town[&TownItemId(9)].pos;
    assert_eq!(east_lamp, PosMm::new(24_000, -1_700));
    let house = w.building.town[&TownItemId(4)].pos;
    w.apply(Command::BuyFloorSpace {
        side: Side::East,
        tiles: 4,
    })
    .unwrap();
    assert_eq!(w.building.layout_rev, rev + 1);
    assert_eq!(
        w.building.town[&TownItemId(9)].pos,
        PosMm::new(28_000, -1_700)
    );
    assert_eq!(
        w.building.town[&TownItemId(19)].pos,
        PosMm::new(30_200, 8_800)
    );
    assert_eq!(
        w.building.town[&TownItemId(4)].pos,
        house,
        "west of the edge"
    );
    w.apply(Command::BuyFloorSpace {
        side: Side::North,
        tiles: 2,
    })
    .unwrap();
    assert_eq!(
        w.building.town[&TownItemId(1)].pos,
        PosMm::new(3_000, -6_500)
    );
    // every item still stands where it may
    for t in w.building.town.values() {
        assert_eq!(
            validate(&w, &move_item(t.id.0, t.pos.x, t.pos.z, t.rot)),
            Ok(()),
            "{t:?}"
        );
    }
}

#[test]
fn a_sandbox_company_builds_for_free() {
    let economic = demo_office(1);
    let mut w = sandbox();
    assert_eq!(w.company.build_mode, BuildMode::Sandbox);
    // the starting office was free
    assert!(w.company.cash > economic.company.cash);
    let cash = w.company.cash;
    let builds = [
        Command::BuyFloorSpace {
            side: Side::East,
            tiles: 4,
        },
        Command::PlaceEquipment {
            kind: EquipmentKind::Plant,
            placement: floor(2_000, 14_000, 0),
        },
        move_to(SPARE, floor(6_500, 4_200, 2)),
        place(TownKind::Tree, 9_000, -10_000, 0),
        move_item(1, 3_000, -12_000, 0),
        Command::RemoveTownItem {
            item: TownItemId(14),
        },
    ];
    let rev = w.building.layout_rev;
    for c in builds {
        w.apply(c.clone()).unwrap_or_else(|r| panic!("{c:?}: {r}"));
        assert_eq!(w.company.cash, cash, "{c:?} is free");
    }
    assert_eq!(w.building.layout_rev, rev + 6);
    // with no money at all
    w.company.cash = 0;
    assert_eq!(
        validate(&w, &place(TownKind::Bench, 9_000, -12_000, 0)),
        Ok(())
    );
    // people still cost money
    let candidate = *w.candidates.keys().next().unwrap();
    assert!(matches!(
        validate(&w, &Command::Hire { candidate }),
        Err(Reject::InsufficientFunds { .. }) | Err(Reject::NoFreeDesk)
    ));
}

#[test]
fn other_commands_leave_the_layout_revision_alone() {
    let mut w = demo_office(1);
    let rev = w.building.layout_rev;
    w.apply(Command::Praise { staff: StaffId(2) }).unwrap();
    assert!(validate(&w, &place(TownKind::Tree, 5_000, 5_000, 0)).is_err());
    assert!(w.apply(place(TownKind::Tree, 5_000, 5_000, 0)).is_err());
    for _ in 0..600 {
        w.step();
    }
    assert_eq!(w.building.layout_rev, rev);
    assert_eq!(w.render_state().layout_rev, rev);
}

#[test]
fn building_is_deterministic() {
    let run = |mode| {
        let mut w = scenario_with_mode("cinqueterre", 7, mode).unwrap();
        for _ in 0..300 {
            w.step();
        }
        let cmds = [
            place(TownKind::Tree, 9_000, -10_000, 1),
            move_item(1, 3_000, -12_000, 2),
            Command::RemoveTownItem {
                item: TownItemId(15),
            },
            move_to(SPARE, floor(6_500, 4_200, 2)),
        ];
        for c in cmds {
            w.apply(c).unwrap();
        }
        for _ in 0..300 {
            w.step();
        }
        w.hash()
    };
    assert_eq!(run(BuildMode::Economic), run(BuildMode::Economic));
    assert_eq!(run(BuildMode::Sandbox), run(BuildMode::Sandbox));
    assert_ne!(run(BuildMode::Economic), run(BuildMode::Sandbox));
}
