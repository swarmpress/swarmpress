//! Players' own kit designs placed in rooms (ADR-0065 §4, ADR-0087 decision
//! 7, K-4's sim part): `PlaceObject`, `MoveObject`, `RemoveObject`, their
//! validation, prices and `layout_rev`. Staff at workstation objects and
//! desk-top objects (ADR-0088) are in `tests/stations.rs`.

use sim_core::building::{Door, RoomKind, Window};
use sim_core::commands::{Command, DemolishTarget, Placement};
use sim_core::economy::{BuildMode, LedgerKind};
use sim_core::equipment::{EquipmentKind, MAX_ITEMS_PER_ROOM};
use sim_core::geom::{PosMm, Side, TileRect};
use sim_core::ids::{EquipId, ObjectId, RoomId};
use sim_core::objects::{
    room_capabilities, Mount, ObjectCapabilities, ObjectSummary, MAX_OBJECT_COST_CENTS,
};
use sim_core::scenarios::{demo_office, scenario_with_mode};
use sim_core::staff::Station;
use sim_core::{validate, Reject, World};

/// The meeting room: 0..6 m × 8..16 m, its door on the north side at 3 m,
/// a whiteboard at (1.5 m, 8.6 m), west of the door.
const MEETING: RoomId = RoomId(6);
const KITCHEN: RoomId = RoomId(3);

fn hash(n: u8) -> String {
    format!("{n:02x}").repeat(32)
}

/// The shipped meeting table's summary (1.5 × 1.5 m).
fn table() -> ObjectSummary {
    ObjectSummary {
        footprint: [24, 24],
        height: 30,
        mount: Mount::Floor,
        seats: 0,
        workstation: false,
        seat_at: None,
        lights: 0,
        storage: 0,
        screens: 0,
        parts: 157,
        cost: 1_604,
    }
}

/// The shipped desk's summary, with a lamp and a screen (1.5 × 0.75 m).
fn desk() -> ObjectSummary {
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

/// A small box of `n` × `n` studs.
fn boxed(n: u32) -> ObjectSummary {
    ObjectSummary {
        footprint: [n, n],
        height: 8,
        mount: Mount::Floor,
        seats: 0,
        workstation: false,
        seat_at: None,
        lights: 0,
        storage: 16,
        screens: 0,
        parts: 4,
        cost: 100,
    }
}

fn place(summary: ObjectSummary, x: i32, z: i32, rot: u8) -> Command {
    Command::PlaceObject {
        design: hash(0xab),
        pos: PosMm::new(x, z),
        rot,
        summary,
    }
}

fn move_obj(id: u32, x: i32, z: i32, rot: u8) -> Command {
    Command::MoveObject {
        object: ObjectId(id),
        pos: PosMm::new(x, z),
        rot,
    }
}

fn equipment_total(w: &World) -> i64 {
    w.ledger
        .totals
        .get(&LedgerKind::Equipment)
        .copied()
        .unwrap_or(0)
}

#[test]
fn place_move_and_remove() {
    let mut w = demo_office(1);
    let (cash, rev, spent) = (w.company.cash, w.building.layout_rev, equipment_total(&w));
    w.apply(place(table(), 1_500, 13_500, 0)).unwrap();
    let o = &w.building.objects[&ObjectId(1)];
    assert_eq!(o.design, hash(0xab));
    assert_eq!(
        (o.room, o.pos, o.rot),
        (MEETING, PosMm::new(1_500, 13_500), 0)
    );
    assert_eq!(o.summary, table());
    assert_eq!(w.company.cash, cash - 1_604, "the parts' price");
    assert_eq!(equipment_total(&w), spent - 1_604);
    assert_eq!(w.building.layout_rev, rev + 1);

    // moved to the kitchen and turned: 10% of its price, keeps its id
    w.apply(move_obj(1, 13_500, 2_500, 1)).unwrap();
    let o = &w.building.objects[&ObjectId(1)];
    assert_eq!(
        (o.room, o.pos, o.rot),
        (KITCHEN, PosMm::new(13_500, 2_500), 1)
    );
    assert_eq!(w.company.cash, cash - 1_604 - 160);
    assert_eq!(w.building.layout_rev, rev + 2);
    // a small move that overlaps its own old footprint is fine
    w.apply(move_obj(1, 13_600, 2_500, 1)).unwrap();

    // removed: free, no refund
    let before = w.company.cash;
    w.apply(Command::RemoveObject {
        object: ObjectId(1),
    })
    .unwrap();
    assert!(w.building.objects.is_empty());
    assert_eq!(w.company.cash, before);
    assert_eq!(w.building.layout_rev, rev + 4);
    // ids are never reused
    w.apply(place(table(), 1_500, 13_500, 0)).unwrap();
    assert!(w.building.objects.contains_key(&ObjectId(2)));
}

#[test]
fn rejects_bad_designs_and_summaries() {
    let w = demo_office(1);
    let at = |summary| place(summary, 1_500, 13_500, 0);
    let mut bad = at(table());
    if let Command::PlaceObject { design, .. } = &mut bad {
        *design = "AB".repeat(32);
    }
    assert!(matches!(validate(&w, &bad), Err(Reject::Invalid(_))));
    if let Command::PlaceObject { design, .. } = &mut bad {
        *design = "ab".repeat(31);
    }
    assert!(matches!(validate(&w, &bad), Err(Reject::Invalid(_))));

    let s = ObjectSummary {
        mount: Mount::Ceiling,
        ..table()
    };
    assert!(matches!(validate(&w, &at(s)), Err(Reject::NotSupported(_))));
    // desk-top designs go on a desk (`PlaceObjectOnDesk`, tests/stations.rs)
    let s = ObjectSummary {
        mount: Mount::Surface,
        ..table()
    };
    assert_eq!(
        validate(&w, &at(s)),
        Err(Reject::Invalid("a desk-top design goes on a desk"))
    );
    let invalid = [
        ObjectSummary {
            footprint: [0, 24],
            ..table()
        },
        ObjectSummary {
            footprint: [24, 193],
            ..table()
        },
        ObjectSummary {
            height: 481,
            ..table()
        },
        ObjectSummary {
            parts: 0,
            ..table()
        },
        ObjectSummary {
            cost: MAX_OBJECT_COST_CENTS + 1,
            ..table()
        },
    ];
    for s in invalid {
        assert!(
            matches!(validate(&w, &at(s)), Err(Reject::Invalid(_))),
            "{s:?}"
        );
    }
    assert_eq!(validate(&w, &at(table())), Ok(()));
}

#[test]
fn rejects_bad_spots() {
    let w = demo_office(1);
    let check = |c: Command| validate(&w, &c);
    // a fifth quarter turn
    assert!(matches!(
        check(place(table(), 1_500, 13_500, 4)),
        Err(Reject::Invalid(_))
    ));
    // the hallway
    assert_eq!(
        check(place(boxed(4), 10_000, 7_000, 0)),
        Err(Reject::Invalid("an object goes inside a room"))
    );
    assert_eq!(
        check(place(boxed(4), i32::MAX, 0, 0)),
        Err(Reject::OutOfLot)
    );
    // through the west wall; standing against it is fine (50 mm, the
    // wall's half thickness)
    assert_eq!(
        check(place(table(), 500, 13_500, 0)),
        Err(Reject::Invalid("the object does not fit inside the room"))
    );
    assert_eq!(check(place(boxed(8), 300, 13_500, 0)), Ok(()));
    assert!(check(place(boxed(8), 299, 13_500, 0)).is_err());
    // turned, the desk is 0.75 m wide and 1.5 m deep: it fits along the
    // wall with its seat to the east; with the seat to the west, the seat
    // would be in the wall (ADR-0088)
    assert_eq!(check(place(desk(), 425, 13_000, 3)), Ok(()));
    assert_eq!(
        check(place(desk(), 425, 13_000, 1)),
        Err(Reject::Invalid("the seat would be in the wall"))
    );
    assert!(check(place(desk(), 425, 13_000, 0)).is_err());
    // the tile inside the door (3..4 m, 8..9 m) stays clear
    assert_eq!(
        check(place(boxed(8), 3_750, 8_600, 0)),
        Err(Reject::Invalid("the object would block a door"))
    );
    // the whiteboard's square (1..2 m, 8.1..9.1 m): overlapping is
    // refused, touching is not
    assert_eq!(
        check(place(boxed(8), 1_500, 9_300, 0)),
        Err(Reject::Overlap)
    );
    assert_eq!(check(place(boxed(8), 1_500, 9_350, 0)), Ok(()));
    // a desk's chair (Giulia's desk at 1.5 m, 1.5 m; her chair 0.75 m south)
    assert_eq!(
        check(place(boxed(4), 1_500, 2_300, 0)),
        Err(Reject::Overlap)
    );
    // ceiling lights take no floor space: the meeting room's are at (3 m, 10 m)
    // and (3 m, 14 m)
    assert_eq!(check(place(boxed(8), 3_000, 10_000, 0)), Ok(()));
}

#[test]
fn objects_and_equipment_keep_apart() {
    let mut w = demo_office(1);
    w.apply(place(table(), 1_500, 13_500, 0)).unwrap();
    // another object on it, or touching it
    assert_eq!(
        validate(&w, &place(table(), 2_000, 13_500, 0)),
        Err(Reject::Overlap)
    );
    assert_eq!(validate(&w, &place(table(), 3_000, 13_500, 0)), Ok(()));
    // equipment on it: a plant's square (±0.3 m), a desk's chair
    let plant = |x, z| Command::PlaceEquipment {
        kind: EquipmentKind::Plant,
        placement: Placement::Floor {
            pos: PosMm::new(x, z),
            rot: 0,
        },
    };
    assert_eq!(validate(&w, &plant(2_500, 13_500)), Err(Reject::Overlap));
    assert_eq!(validate(&w, &plant(2_550, 13_500)), Ok(()));
    let desk_at = |x, z| Command::PlaceEquipment {
        kind: EquipmentKind::Desk,
        placement: Placement::Floor {
            pos: PosMm::new(x, z),
            rot: 2,
        },
    };
    // turned 2, the chair is 0.75 m north of the desk: on the table's south edge
    assert_eq!(validate(&w, &desk_at(1_500, 15_100)), Err(Reject::Overlap));
    // the whiteboard moved onto the table
    let wb = Command::MoveEquipment {
        equipment: EquipId(69),
        placement: Placement::Floor {
            pos: PosMm::new(1_500, 12_500),
            rot: 0,
        },
    };
    assert_eq!(validate(&w, &wb), Err(Reject::Overlap));
    // an object moved onto the whiteboard
    assert_eq!(
        validate(&w, &move_obj(1, 1_500, 9_800, 0)),
        Err(Reject::Overlap)
    );
    assert_eq!(
        validate(&w, &move_obj(9, 3_000, 12_000, 0)),
        Err(Reject::UnknownObject(ObjectId(9)))
    );
    assert_eq!(
        validate(
            &w,
            &Command::RemoveObject {
                object: ObjectId(9)
            }
        ),
        Err(Reject::UnknownObject(ObjectId(9)))
    );
}

#[test]
fn objects_count_towards_the_room_limit() {
    let mut w = demo_office(1);
    let items = w
        .building
        .equipment
        .values()
        .filter(|e| e.room == MEETING)
        .count();
    let mut placed = 0;
    'grid: for i in 0..8 {
        for j in 0..8 {
            let c = place(boxed(2), 500 + 700 * i, 10_100 + 700 * j, 0);
            match w.apply(c) {
                Ok(_) => placed += 1,
                Err(e) => {
                    assert_eq!(e, Reject::Limit("items per room"));
                    break 'grid;
                }
            }
        }
    }
    assert_eq!(items + placed, MAX_ITEMS_PER_ROOM);
    let plant = Command::PlaceEquipment {
        kind: EquipmentKind::Plant,
        placement: Placement::Floor {
            pos: PosMm::new(5_500, 9_500),
            rot: 0,
        },
    };
    assert_eq!(validate(&w, &plant), Err(Reject::Limit("items per room")));
    // moving within the full room is fine; into it from elsewhere is not
    assert_eq!(validate(&w, &move_obj(1, 520, 10_100, 0)), Ok(()));
    let mut kitchen = w.clone();
    kitchen.apply(place(boxed(2), 13_500, 2_500, 0)).unwrap();
    let last = ObjectId(u32::try_from(placed).unwrap() + 1);
    assert_eq!(
        validate(
            &kitchen,
            &Command::MoveObject {
                object: last,
                pos: PosMm::new(5_500, 9_500),
                rot: 0
            }
        ),
        Err(Reject::Limit("items per room"))
    );
}

#[test]
fn prices_per_mode() {
    let mut eco = demo_office(1);
    assert_eq!(eco.company.build_mode, BuildMode::Economic);
    let c = place(desk(), 1_500, 13_500, 0);
    assert_eq!(sim_core::validate::price(&eco, &c), 3_199);
    eco.apply(c.clone()).unwrap();
    assert_eq!(
        sim_core::validate::price(&eco, &move_obj(1, 1_500, 12_500, 0)),
        319
    );
    let remove = Command::RemoveObject {
        object: ObjectId(1),
    };
    assert_eq!(sim_core::validate::price(&eco, &remove), 0);
    // not enough cash
    let mut broke = eco.clone();
    broke.company.cash = 3_000;
    assert_eq!(
        validate(&broke, &place(desk(), 4_500, 12_000, 0)),
        Err(Reject::InsufficientFunds {
            need: 3_199,
            have: 3_000
        })
    );
    assert_eq!(validate(&broke, &move_obj(1, 1_500, 12_500, 0)), Ok(()));

    let mut sandbox = scenario_with_mode("cinqueterre", 1, BuildMode::Sandbox).unwrap();
    let cash = sandbox.company.cash;
    assert_eq!(sim_core::validate::price(&sandbox, &c), 0);
    sandbox.apply(c).unwrap();
    assert_eq!(
        sim_core::validate::price(&sandbox, &move_obj(1, 1_500, 12_500, 0)),
        0
    );
    sandbox.apply(move_obj(1, 1_500, 12_500, 0)).unwrap();
    sandbox.apply(remove).unwrap();
    assert_eq!(sandbox.company.cash, cash);
    // a sandbox company builds even when broke
    sandbox.company.cash = 0;
    assert_eq!(validate(&sandbox, &place(desk(), 1_500, 13_500, 0)), Ok(()));
}

#[test]
fn demolishing_a_room_takes_its_objects_and_buying_land_moves_none() {
    let mut w = demo_office(1);
    w.apply(place(table(), 1_500, 13_500, 0)).unwrap();
    w.apply(Command::BuyFloorSpace {
        side: Side::East,
        tiles: 4,
    })
    .unwrap();
    assert_eq!(
        w.building.objects[&ObjectId(1)].pos,
        PosMm::new(1_500, 13_500)
    );
    w.apply(Command::PlaceRoom {
        kind: RoomKind::Archive,
        rect: TileRect::new(24, 4, 4, 4),
        floor: 0,
        doors: vec![Door {
            side: Side::West,
            at: 2,
        }],
        windows: vec![Window {
            side: Side::East,
            at_mm: 1_000,
            width_mm: 2_000,
        }],
    })
    .unwrap();
    let archive = w
        .building
        .room_at(PosMm::new(26_000, 6_000).tile())
        .unwrap();
    // the archive's door tile (24 m, 6 m) is kept clear
    assert_eq!(
        validate(&w, &place(boxed(8), 24_500, 6_500, 0)),
        Err(Reject::Invalid("the object would block a door"))
    );
    w.apply(place(boxed(8), 27_000, 5_000, 0)).unwrap();
    assert_eq!(w.building.objects[&ObjectId(2)].room, archive);
    let rev = w.building.layout_rev;
    w.apply(Command::Demolish(DemolishTarget::Room(archive)))
        .unwrap();
    assert_eq!(w.building.layout_rev, rev + 1);
    let left: Vec<ObjectId> = w.building.objects.keys().copied().collect();
    assert_eq!(left, vec![ObjectId(1)]);
}

#[test]
fn capabilities_are_totalled_per_room_and_workstations_are_free_for_hires() {
    let mut w = demo_office(1);
    w.apply(place(desk(), 1_500, 13_500, 0)).unwrap();
    w.apply(place(desk(), 1_500, 11_000, 0)).unwrap();
    w.apply(place(boxed(4), 5_000, 12_000, 0)).unwrap();
    assert_eq!(
        room_capabilities(&w.building, MEETING),
        ObjectCapabilities {
            seats: 2,
            workstations: 2,
            lights: 2,
            storage: 16,
            screens: 2,
        }
    );
    assert_eq!(
        room_capabilities(&w.building, KITCHEN),
        ObjectCapabilities::default()
    );
    // the desks are free workstations for hires, after the built-in desks
    // (ADR-0088); free desks are only the built-in ones
    assert_eq!(w.free_desks(), demo_office(1).free_desks());
    let mut free = demo_office(1).free_stations();
    free.extend([Station::Object(ObjectId(1)), Station::Object(ObjectId(2))]);
    assert_eq!(w.free_stations(), free);
}

#[test]
fn objects_are_deterministic_and_rejections_change_nothing() {
    let run = |mode| {
        let mut w = scenario_with_mode("cinqueterre", 7, mode).unwrap();
        for _ in 0..300 {
            w.step();
        }
        for c in [
            place(table(), 1_500, 13_500, 0),
            place(desk(), 4_500, 12_000, 1),
            move_obj(2, 4_800, 13_000, 3),
            Command::RemoveObject {
                object: ObjectId(1),
            },
        ] {
            w.apply(c).unwrap();
        }
        // refused: the world is untouched
        let before = w.hash();
        assert!(w.apply(place(table(), 4_800, 13_000, 0)).is_err());
        assert_eq!(w.hash(), before);
        for _ in 0..300 {
            w.step();
        }
        w.hash()
    };
    assert_eq!(run(BuildMode::Economic), run(BuildMode::Economic));
    assert_eq!(run(BuildMode::Sandbox), run(BuildMode::Sandbox));
    assert_ne!(run(BuildMode::Economic), run(BuildMode::Sandbox));
    // snapshots carry objects
    let mut w = demo_office(3);
    w.apply(place(table(), 1_500, 13_500, 2)).unwrap();
    let back = World::from_snapshot(&w.snapshot(), None).unwrap();
    assert_eq!(back.building.objects, w.building.objects);
    assert_eq!(back.hash(), w.hash());
}
