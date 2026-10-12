//! Staff use what the bricks provide (ADR-0088): workstation objects are
//! homes for staff like built-in desks, and desk-top designs take a desk's
//! screen or lamp slot.

use sim_core::commands::{Command, DemolishTarget, Placement};
use sim_core::economy::BuildMode;
use sim_core::equipment::{DeskSlot, EquipmentKind};
use sim_core::geom::PosMm;
use sim_core::ids::{EquipId, ObjectId, RoomId, StaffId};
use sim_core::objects::{Mount, ObjectSummary};
use sim_core::scenarios::{demo_office, scenario_with_mode};
use sim_core::staff::{Activity, Pose, Spot, Station};
use sim_core::{validate, Reject, World};

/// The meeting room: 0..6 m × 8..16 m, its door on the north side at 3 m.
const MEETING: RoomId = RoomId(6);

fn hash(n: u8) -> String {
    format!("{n:02x}").repeat(32)
}

/// A player's desk (1.5 × 0.75 m) whose seat is 750 mm south of its centre.
fn my_desk() -> ObjectSummary {
    ObjectSummary {
        footprint: [24, 12],
        height: 34,
        mount: Mount::Floor,
        seats: 0,
        workstation: true,
        seat_at: Some([0, 750]),
        lights: 1,
        storage: 0,
        screens: 1,
        parts: 204,
        cost: 3_199,
    }
}

/// A desk-top design: a screen when `screens` is 1, a mug otherwise.
fn desk_top(screens: u8) -> ObjectSummary {
    ObjectSummary {
        footprint: [6, 4],
        height: 14,
        mount: Mount::Surface,
        seats: 0,
        workstation: false,
        seat_at: None,
        lights: 0,
        storage: 0,
        screens,
        parts: 12,
        cost: 450,
    }
}

fn place(summary: ObjectSummary, x: i32, z: i32, rot: u8) -> Command {
    Command::PlaceObject {
        design: hash(0xd5),
        pos: PosMm::new(x, z),
        rot,
        summary,
    }
}

fn on_desk(summary: ObjectSummary, desk: EquipId) -> Command {
    Command::PlaceObjectOnDesk {
        design: hash(0x70),
        desk,
        summary,
    }
}

/// Demolishes every built-in desk nobody calls home.
fn no_free_desks(w: &mut World) {
    for desk in w.free_desks() {
        w.apply(Command::Demolish(DemolishTarget::Equipment(desk)))
            .unwrap();
    }
    assert!(w.free_desks().is_empty());
}

/// Hires the first candidate on the shortlist who can be hired (the
/// company has its CFO and Secretary already).
fn hire(w: &mut World) -> StaffId {
    let candidate = *w
        .candidates
        .keys()
        .find(|c| validate(w, &Command::Hire { candidate: **c }).is_ok())
        .expect("a candidate");
    let before: Vec<StaffId> = w.staff.keys().copied().collect();
    w.apply(Command::Hire { candidate }).unwrap();
    *w.staff
        .keys()
        .find(|id| !before.contains(id))
        .expect("hired")
}

/// Steps until `id` sits at their home (at most three days).
fn until_seated(w: &mut World, id: StaffId) {
    for _ in 0..3 * 14_400 {
        let s = &w.staff[&id];
        if s.seated_station().is_some() && s.seated_station() == s.home {
            return;
        }
        w.step();
    }
    panic!("{id} never sat down at home");
}

/// A spare desk (the newsroom's at 1.5 m, 4 m) with its monitor and lamp
/// taken away.
fn bare_spare_desk(w: &mut World) -> EquipId {
    let desk = w
        .building
        .equipment
        .values()
        .find(|e| e.kind == EquipmentKind::Desk && e.pos == PosMm::new(1_500, 4_000))
        .map(|e| e.id)
        .unwrap();
    let riders: Vec<EquipId> = w
        .building
        .equipment
        .values()
        .filter(|e| e.attached_to == Some(desk))
        .map(|e| e.id)
        .collect();
    for r in riders {
        w.apply(Command::Demolish(DemolishTarget::Equipment(r)))
            .unwrap();
    }
    desk
}

#[test]
fn a_hire_takes_a_workstation_object_when_no_desk_is_free() {
    let mut w = demo_office(1);
    no_free_desks(&mut w);
    let first = *w.candidates.keys().next().unwrap();
    assert_eq!(
        validate(&w, &Command::Hire { candidate: first }),
        Err(Reject::NoFreeDesk)
    );
    // turned once: 0.75 m wide, 1.5 m deep, its seat 750 mm to the west
    w.apply(place(my_desk(), 1_500, 12_000, 1)).unwrap();
    assert_eq!(w.free_stations(), vec![Station::Object(ObjectId(1))]);
    assert_eq!(
        w.building.objects[&ObjectId(1)].seat_pos(),
        Some(PosMm::new(750, 12_000))
    );
    let rev = w.building.layout_rev;
    let id = hire(&mut w);
    assert_eq!(w.staff[&id].home, Some(Station::Object(ObjectId(1))));
    assert_eq!(w.staff[&id].home_desk(), None);
    assert_eq!(w.staff[&id].home_object(), Some(ObjectId(1)));
    assert_eq!(w.station_owner(Station::Object(ObjectId(1))), Some(id));
    assert_eq!(w.building.layout_rev, rev + 1, "the layout names the owner");
    assert!(w.free_stations().is_empty());

    // they come in and sit at the object's seat
    until_seated(&mut w, id);
    let s = &w.staff[&id];
    assert_eq!(s.spot, Some(Spot::Object(ObjectId(1))));
    assert_eq!(s.pos, PosMm::new(750, 12_000));
    assert_eq!(s.activity, Activity::Working);
    let rs = w.render_state();
    let r = rs.staff.iter().find(|r| r.id == id).unwrap();
    assert_eq!(r.seated_at, Some(Station::Object(ObjectId(1))));
    assert_eq!(r.pos_mm, PosMm::new(750, 12_000));
    assert!(matches!(r.pose, Pose::Sit | Pose::Type), "{:?}", r.pose);
    assert_eq!(w.nav_failures, 0);
}

#[test]
fn desks_first_then_objects_each_by_id() {
    let mut w = demo_office(1);
    let desks = w.free_desks();
    assert_eq!(desks.len(), 3);
    w.apply(place(my_desk(), 1_500, 13_500, 0)).unwrap();
    w.apply(place(my_desk(), 4_500, 11_000, 0)).unwrap();
    let mut expected: Vec<Station> = desks.iter().copied().map(Station::Desk).collect();
    expected.extend([Station::Object(ObjectId(1)), Station::Object(ObjectId(2))]);
    assert_eq!(w.free_stations(), expected);
    // hires take the desks first, then the objects by id
    let mut homes = Vec::new();
    for _ in 0..5 {
        for role in sim_core::roles::Role::ALL {
            w.add_candidate_for_role(role);
        }
        let id = hire(&mut w);
        homes.push(w.staff[&id].home.unwrap());
    }
    assert_eq!(homes, expected);
    assert!(w.free_stations().is_empty());
    // a non-workstation object is no home; neither is a desk-top object
    let shelf = ObjectSummary {
        workstation: false,
        seat_at: None,
        ..my_desk()
    };
    w.apply(place(shelf, 1_500, 9_800, 0)).unwrap();
    assert!(w.free_stations().is_empty());
}

#[test]
fn a_workstation_in_use_stays_where_it_is() {
    let mut w = demo_office(1);
    no_free_desks(&mut w);
    w.apply(place(my_desk(), 1_500, 12_000, 0)).unwrap();
    let id = hire(&mut w);
    let remove = Command::RemoveObject {
        object: ObjectId(1),
    };
    // someone's home: it is not removed, its room is not demolished
    assert_eq!(
        validate(&w, &remove),
        Err(Reject::Occupied("this workstation is assigned"))
    );
    assert_eq!(
        validate(&w, &Command::Demolish(DemolishTarget::Room(MEETING))),
        Err(Reject::Occupied("someone's desk is in this room"))
    );
    // its owner is not in yet: it moves, like a desk, and the seat with it
    let moved = Command::MoveObject {
        object: ObjectId(1),
        pos: PosMm::new(1_500, 13_000),
        rot: 0,
    };
    assert_eq!(validate(&w, &moved), Ok(()));
    w.apply(moved).unwrap();
    // seated at it: not moved either
    until_seated(&mut w, id);
    assert_eq!(w.staff[&id].pos, PosMm::new(1_500, 13_750));
    let again = Command::MoveObject {
        object: ObjectId(1),
        pos: PosMm::new(1_500, 12_000),
        rot: 0,
    };
    assert_eq!(
        validate(&w, &again),
        Err(Reject::Occupied("someone is working at this object"))
    );
    // fired, they walk out and the workstation is free again
    let rev = w.building.layout_rev;
    w.apply(Command::Fire { staff: id }).unwrap();
    assert_eq!(w.building.layout_rev, rev + 1);
    assert_eq!(w.staff[&id].home, None);
    for _ in 0..2_000 {
        w.step();
    }
    assert!(!w.staff.contains_key(&id));
    assert_eq!(w.free_stations(), vec![Station::Object(ObjectId(1))]);
    assert_eq!(validate(&w, &remove), Ok(()));
    w.apply(remove).unwrap();
    assert!(w.free_stations().is_empty());
}

#[test]
fn a_workstations_seat_is_bounded_and_kept_clear() {
    let w = demo_office(1);
    let check = |s: ObjectSummary, x, z, rot| validate(&w, &place(s, x, z, rot));
    // a workstation without a seat, a seat without a workstation
    let seatless = ObjectSummary {
        seat_at: None,
        ..my_desk()
    };
    assert_eq!(
        check(seatless, 1_500, 12_000, 0),
        Err(Reject::Invalid("a workstation needs its seat position"))
    );
    let shelf = ObjectSummary {
        workstation: false,
        ..my_desk()
    };
    assert_eq!(
        check(shelf, 1_500, 12_000, 0),
        Err(Reject::Invalid("only a workstation has a seat position"))
    );
    // at most 1 m outside the footprint: 375 mm + 1 000 mm south
    let reach = |z| ObjectSummary {
        seat_at: Some([0, z]),
        ..my_desk()
    };
    assert_eq!(check(reach(1_375), 1_500, 12_000, 0), Ok(()));
    assert_eq!(
        check(reach(1_376), 1_500, 12_000, 0),
        Err(Reject::Invalid(
            "a workstation's seat is at most 1 m outside its footprint"
        ))
    );
    // in the room, clear of its walls (the south wall at 16 m)
    assert_eq!(
        check(my_desk(), 1_500, 15_250, 0),
        Err(Reject::Invalid("the seat would be in the wall"))
    );
    // its seat's square is floor it takes: not on the whiteboard (1..2 m,
    // 8.1..9.1 m), and nothing is put on it later
    assert_eq!(check(my_desk(), 1_500, 9_600, 2), Err(Reject::Overlap));
    assert_eq!(check(my_desk(), 1_500, 9_600, 0), Ok(()));
    let mut w = w.clone();
    w.apply(place(my_desk(), 4_500, 12_000, 0)).unwrap();
    let plant = Command::PlaceEquipment {
        kind: EquipmentKind::Plant,
        placement: Placement::Floor {
            pos: PosMm::new(4_500, 13_000),
            rot: 0,
        },
    };
    assert_eq!(validate(&w, &plant), Err(Reject::Overlap));
    assert_eq!(
        validate(&w, &place(desk_shelf(), 4_500, 13_000, 0)),
        Err(Reject::Overlap)
    );
    // a forged summary with many seats is still one home
    let mut w = demo_office(1);
    no_free_desks(&mut w);
    let crowded = ObjectSummary {
        seats: 8,
        ..my_desk()
    };
    w.apply(place(crowded, 1_500, 12_000, 0)).unwrap();
    assert_eq!(w.free_stations(), vec![Station::Object(ObjectId(1))]);
    hire(&mut w);
    assert!(w.free_stations().is_empty());
    assert!(w
        .candidates
        .keys()
        .all(|c| validate(&w, &Command::Hire { candidate: *c }).is_err()));
}

/// A small floor box (0.25 m square).
fn desk_shelf() -> ObjectSummary {
    ObjectSummary {
        footprint: [4, 4],
        workstation: false,
        seat_at: None,
        ..my_desk()
    }
}

#[test]
fn desk_top_designs_take_a_desk_slot() {
    let mut w = demo_office(1);
    let desk = bare_spare_desk(&mut w);
    let rev = w.building.layout_rev;
    // a screen takes the screen slot, anything else the lamp slot
    w.apply(on_desk(desk_top(1), desk)).unwrap();
    w.apply(on_desk(desk_top(0), desk)).unwrap();
    assert_eq!(w.building.layout_rev, rev + 2);
    let d = w.building.equipment[&desk].clone();
    let screen = &w.building.objects[&ObjectId(1)];
    assert_eq!(screen.on_desk, Some((desk, DeskSlot::Screen)));
    assert_eq!(
        (screen.room, screen.pos, screen.rot),
        (d.room, d.pos, d.rot)
    );
    assert_eq!(
        w.building.objects[&ObjectId(2)].on_desk,
        Some((desk, DeskSlot::Lamp))
    );
    // both slots are taken: by objects and by equipment alike
    for s in [desk_top(1), desk_top(0)] {
        assert_eq!(
            validate(&w, &on_desk(s, desk)),
            Err(Reject::Occupied("that desk already has one"))
        );
    }
    for kind in [EquipmentKind::Monitor, EquipmentKind::DeskLamp] {
        let c = Command::PlaceEquipment {
            kind,
            placement: Placement::OnDesk(desk),
        };
        assert_eq!(
            validate(&w, &c),
            Err(Reject::Occupied("that desk already has one"))
        );
    }
    // a monitor moved onto it from another desk: refused too
    let monitor = w
        .building
        .equipment
        .values()
        .find(|e| e.kind == EquipmentKind::Monitor)
        .map(|e| e.id)
        .unwrap();
    let onto = Command::MoveEquipment {
        equipment: monitor,
        placement: Placement::OnDesk(desk),
    };
    assert_eq!(
        validate(&w, &onto),
        Err(Reject::Occupied("that desk already has one"))
    );
    // the desk elsewhere has a lamp: a lamp-slot object is refused there
    let other = w.building.equipment[&monitor].attached_to.unwrap();
    assert_eq!(
        validate(&w, &on_desk(desk_top(0), other)),
        Err(Reject::Occupied("that desk already has one"))
    );
    // never moved on their own
    assert_eq!(
        validate(
            &w,
            &Command::MoveObject {
                object: ObjectId(1),
                pos: PosMm::new(4_000, 13_000),
                rot: 0
            }
        ),
        Err(Reject::Invalid("a desk-top object moves with its desk"))
    );
    // they move with the desk...
    let moved = Command::MoveEquipment {
        equipment: desk,
        placement: Placement::Floor {
            pos: PosMm::new(2_500, 12_000),
            rot: 1,
        },
    };
    w.apply(moved).unwrap();
    for o in w.building.objects.values() {
        assert_eq!(
            (o.room, o.pos, o.rot),
            (MEETING, PosMm::new(2_500, 12_000), 1)
        );
    }
    // ...and go with it
    w.apply(Command::RemoveObject {
        object: ObjectId(2),
    })
    .unwrap();
    assert_eq!(
        w.building.objects.keys().copied().collect::<Vec<_>>(),
        vec![ObjectId(1)]
    );
    w.apply(Command::Demolish(DemolishTarget::Equipment(desk)))
        .unwrap();
    assert!(w.building.objects.is_empty());
}

#[test]
fn desk_top_designs_are_checked() {
    let mut w = demo_office(1);
    let desk = bare_spare_desk(&mut w);
    // only surface designs, only on desks that exist and are desks
    let floor = ObjectSummary {
        mount: Mount::Floor,
        ..desk_top(1)
    };
    assert_eq!(
        validate(&w, &on_desk(floor, desk)),
        Err(Reject::Invalid("only desk-top designs go on a desk"))
    );
    let ceiling = ObjectSummary {
        mount: Mount::Ceiling,
        ..desk_top(1)
    };
    assert_eq!(
        validate(&w, &on_desk(ceiling, desk)),
        Err(Reject::Invalid("only desk-top designs go on a desk"))
    );
    assert_eq!(
        validate(&w, &on_desk(desk_top(1), EquipId(999))),
        Err(Reject::UnknownEquipment(EquipId(999)))
    );
    let plant = w
        .building
        .equipment
        .values()
        .find(|e| e.kind == EquipmentKind::Plant)
        .map(|e| e.id)
        .unwrap();
    assert_eq!(
        validate(&w, &on_desk(desk_top(1), plant)),
        Err(Reject::Invalid("that is not a desk"))
    );
    let mut bad = on_desk(desk_top(1), desk);
    if let Command::PlaceObjectOnDesk { design, .. } = &mut bad {
        *design = "XY".repeat(32);
    }
    assert!(matches!(validate(&w, &bad), Err(Reject::Invalid(_))));
    // a desk-top design is never a workstation
    let forged = ObjectSummary {
        workstation: true,
        seat_at: Some([0, 300]),
        ..desk_top(1)
    };
    assert_eq!(
        validate(&w, &on_desk(forged, desk)),
        Err(Reject::Invalid("a desk-top design is not a workstation"))
    );
    assert_eq!(validate(&w, &on_desk(desk_top(1), desk)), Ok(()));
}

#[test]
fn desk_top_prices_per_mode() {
    let mut eco = demo_office(1);
    let desk = bare_spare_desk(&mut eco);
    let c = on_desk(desk_top(1), desk);
    assert_eq!(sim_core::validate::price(&eco, &c), 450);
    let cash = eco.company.cash;
    eco.apply(c.clone()).unwrap();
    assert_eq!(eco.company.cash, cash - 450);
    let mut broke = demo_office(1);
    let desk = bare_spare_desk(&mut broke);
    broke.company.cash = 449;
    assert_eq!(
        validate(&broke, &on_desk(desk_top(1), desk)),
        Err(Reject::InsufficientFunds {
            need: 450,
            have: 449
        })
    );

    let mut sandbox = scenario_with_mode("cinqueterre", 1, BuildMode::Sandbox).unwrap();
    let desk = bare_spare_desk(&mut sandbox);
    let c = on_desk(desk_top(1), desk);
    assert_eq!(sim_core::validate::price(&sandbox, &c), 0);
    let cash = sandbox.company.cash;
    sandbox.apply(c).unwrap();
    assert_eq!(sandbox.company.cash, cash);
}

#[test]
fn stations_are_deterministic_and_snapshot() {
    let run = || {
        let mut w = demo_office(5);
        no_free_desks(&mut w);
        w.apply(place(my_desk(), 1_500, 12_000, 3)).unwrap();
        let id = hire(&mut w);
        let desk = w.staff[&StaffId(1)].home_desk().unwrap();
        let screen = w
            .building
            .equipment
            .values()
            .find(|e| e.attached_to == Some(desk) && e.kind.desk_slot() == Some(DeskSlot::Screen))
            .map(|e| e.id)
            .unwrap();
        w.apply(Command::Demolish(DemolishTarget::Equipment(screen)))
            .unwrap();
        w.apply(on_desk(desk_top(1), desk)).unwrap();
        until_seated(&mut w, id);
        // refused: the world is untouched
        let before = w.hash();
        assert!(w.apply(on_desk(desk_top(1), desk)).is_err());
        assert_eq!(w.hash(), before);
        let back = World::from_snapshot(&w.snapshot(), None).unwrap();
        assert_eq!(back.hash(), w.hash());
        assert_eq!(back.building.objects, w.building.objects);
        assert_eq!(back.staff[&id].home, Some(Station::Object(ObjectId(1))));
        for _ in 0..600 {
            w.step();
        }
        w.hash()
    };
    assert_eq!(run(), run());
}

#[test]
fn station_json() {
    let st = Station::Object(ObjectId(2));
    assert_eq!(
        serde_json::to_string(&st).unwrap(),
        r#"{"Object":"object-2"}"#
    );
    let d = Station::Desk(EquipId(3));
    assert_eq!(serde_json::to_string(&d).unwrap(), r#"{"Desk":"equip-3"}"#);
    assert_eq!(
        serde_json::from_str::<Station>(r#"{"Desk":"equip-3"}"#).unwrap(),
        d
    );
    assert_eq!(st.to_string(), "object-2");
    assert_eq!(d.to_string(), "equip-3");
    assert!(d < st, "desks first");
    assert_eq!(st.spot(), Spot::Object(ObjectId(2)));
    assert_eq!(Spot::Object(ObjectId(2)).station(), Some(st));
}
