//! Seats and ceiling designs of the player's own (ADR-0089, ADR-0090): a seat
//! object in a meeting room or the kitchen adds places at meetings and
//! breaks, after the table's, and people sit on it; a ceiling design hangs
//! over the floor, clear of the ceiling lights and other ceiling designs
//! only, and its lights count towards the room's.

use sim_core::building::{Door, RoomKind};
use sim_core::commands::{Command, DemolishTarget, Placement};
use sim_core::equipment::EquipmentKind;
use sim_core::geom::{PosMm, Side, TileRect};
use sim_core::ids::{ObjectId, RoomId, StaffId};
use sim_core::objects::{room_capabilities, Mount, ObjectSummary};
use sim_core::render_state::render_state;
use sim_core::scenarios::demo_office;
use sim_core::staff::{Activity, Pose, Seat, Spot};
use sim_core::{validate, Reject, World};

/// The meeting room: 0..6 m × 8..16 m; ceiling lights at (3, 10) and (3, 14) m.
const MEETING: RoomId = RoomId(6);
/// The kitchen: 12..16 m × 0..6 m; its table seats eight.
const KITCHEN: RoomId = RoomId(3);

fn hash(n: u8) -> String {
    format!("{n:02x}").repeat(32)
}

/// A floor design that seats `seats` on a `w` × `d` stud footprint.
fn seat_design(w: u32, d: u32, seats: u8) -> ObjectSummary {
    ObjectSummary {
        footprint: [w, d],
        height: 18,
        mount: Mount::Floor,
        seats,
        workstation: false,
        seat_at: None,
        lights: 0,
        storage: 0,
        screens: 0,
        parts: 40,
        cost: 900,
    }
}

/// A bench 1.5 × 0.5 m seating three.
fn bench() -> ObjectSummary {
    seat_design(24, 8, 3)
}

/// A lamp of the player's design hanging from the ceiling (the kit's
/// `ceiling-light`: 4 × 4 studs, 24 plates, one light).
fn ceiling_lamp() -> ObjectSummary {
    ObjectSummary {
        footprint: [4, 4],
        height: 24,
        mount: Mount::Ceiling,
        lights: 1,
        ..seat_design(4, 4, 0)
    }
}

fn place(summary: ObjectSummary, x: i32, z: i32, rot: u8) -> Command {
    Command::PlaceObject {
        design: hash(0xb3),
        pos: PosMm::new(x, z),
        rot,
        summary,
    }
}

fn last_object(w: &World) -> ObjectId {
    *w.building.objects.keys().last().expect("an object")
}

/// Runs until `f` holds (at most `days` game days).
fn until(w: &mut World, days: u64, what: &str, f: impl Fn(&World) -> bool) {
    for _ in 0..days * 14_400 {
        if f(w) {
            return;
        }
        w.step();
    }
    panic!("never: {what}");
}

#[test]
fn seat_objects_add_places_after_the_table_by_id() {
    let mut w = demo_office(1);
    let table = w.room_seats(MEETING);
    assert_eq!(table, (0..12).map(Seat::Table).collect::<Vec<_>>());
    w.apply(place(bench(), 3_000, 15_000, 0)).unwrap();
    let b = last_object(&w);
    w.apply(place(seat_design(8, 8, 1), 5_000, 15_000, 0))
        .unwrap();
    let chair = last_object(&w);
    let seats = w.room_seats(MEETING);
    assert_eq!(seats.len(), 16);
    assert_eq!(&seats[..12], &table[..]);
    assert_eq!(
        &seats[12..],
        &[
            Seat::Object(b, 0),
            Seat::Object(b, 1),
            Seat::Object(b, 2),
            Seat::Object(chair, 0)
        ]
    );
    // the bench's places lie along it, 0.5 m apart, turned with it
    let o = &w.building.objects[&b];
    assert_eq!(o.places(), 3);
    assert_eq!(
        (0..3).filter_map(|n| o.place_pos(n)).collect::<Vec<_>>(),
        vec![
            PosMm::new(2_500, 15_000),
            PosMm::new(3_000, 15_000),
            PosMm::new(3_500, 15_000)
        ]
    );
    assert_eq!(o.place_pos(3), None);
    w.apply(Command::MoveObject {
        object: b,
        pos: PosMm::new(1_000, 12_000),
        rot: 1,
    })
    .unwrap();
    let o = &w.building.objects[&b];
    assert_eq!(o.place_pos(0), Some(PosMm::new(1_000, 11_500)));
    let caps = room_capabilities(&w.building, MEETING);
    assert_eq!((caps.seats, caps.places), (4, 4));
    // the kitchen and other rooms do not see them
    assert_eq!(w.room_seats(KITCHEN).len(), 8);
}

#[test]
fn a_seats_places_keep_clear_of_the_walls() {
    let mut w = demo_office(1);
    // a slim bench against the south wall: its places would be 112 mm off it
    let slim = seat_design(24, 2, 3);
    assert_eq!(
        validate(&w, &place(slim, 3_000, 15_880, 0)),
        Err(Reject::Invalid("a seat would be too close to the wall"))
    );
    assert!(validate(&w, &place(slim, 3_000, 15_500, 0)).is_ok());
    // a deep one against it is fine: its places are on its middle line
    assert!(validate(&w, &place(bench(), 3_000, 15_700, 0)).is_ok());
    w.apply(place(bench(), 3_000, 15_700, 0)).unwrap();
    // a forged count seats no more than its length allows
    let mut forged = seat_design(8, 8, 200);
    forged.parts = 1;
    w.apply(place(forged, 5_000, 12_000, 0)).unwrap();
    assert_eq!(w.building.objects[&last_object(&w)].places(), 1);
}

/// Replaces the meeting room with a small one (3 × 3 m: three table seats)
/// and puts a bench in it; returns the room and the bench.
fn small_meeting_room_with_a_bench(w: &mut World) -> (RoomId, ObjectId) {
    w.apply(Command::Demolish(DemolishTarget::Room(MEETING)))
        .unwrap();
    w.apply(Command::PlaceRoom {
        kind: RoomKind::MeetingRoom,
        rect: TileRect::new(0, 8, 3, 3),
        floor: 0,
        doors: vec![Door {
            side: Side::North,
            at: 1,
        }],
        windows: vec![],
    })
    .unwrap();
    let room = *w.building.rooms.keys().last().unwrap();
    assert_eq!(w.room_seats(room).len(), 3);
    w.apply(place(bench(), 1_500, 10_600, 0)).unwrap();
    (room, last_object(w))
}

#[test]
fn attendees_past_the_table_sit_on_the_players_bench() {
    let mut w = demo_office(1);
    let (room, b) = small_meeting_room_with_a_bench(&mut w);
    assert_eq!(w.room_seats(room).len(), 6);
    // the first standup is held there; ten attendees, six seats
    until(&mut w, 1, "three sit on the bench", |w| {
        w.staff
            .values()
            .filter(|s| s.seated_on() == Some(b))
            .count()
            == 3
    });
    let m = w.meetings.values().find(|m| m.room == room).unwrap().id;
    let mut on_bench: Vec<(Seat, StaffId)> = w
        .staff
        .values()
        .filter_map(|s| match s.spot {
            Some(Spot::MeetingSeat { meeting, seat }) if meeting == m => Some((seat, s.id)),
            _ => None,
        })
        .filter(|(seat, _)| seat.object() == Some(b))
        .collect();
    on_bench.sort();
    assert_eq!(
        on_bench.iter().map(|(s, _)| *s).collect::<Vec<_>>(),
        vec![Seat::Object(b, 0), Seat::Object(b, 1), Seat::Object(b, 2)]
    );
    // the table's three seats are taken first
    let at_table = w
        .staff
        .values()
        .filter(|s| {
            matches!(s.spot, Some(Spot::MeetingSeat { meeting, seat: Seat::Table(_) }) if meeting == m)
        })
        .count();
    assert_eq!(at_table, 3);
    // seated on its places, drawn on it
    let rs = render_state(&w);
    for (seat, id) in &on_bench {
        let Seat::Object(_, n) = seat else {
            unreachable!()
        };
        let s = &w.staff[id];
        assert_eq!(s.activity, Activity::InMeeting);
        assert_eq!(Some(s.pos), w.building.objects[&b].place_pos(*n));
        let r = rs.staff.iter().find(|r| r.id == *id).unwrap();
        assert_eq!(r.seated_on, Some(b));
        assert_eq!(r.seated_at, None);
        assert!(matches!(r.pose, Pose::Listen | Pose::Talk));
    }
    // a bench in use is neither moved nor removed
    assert_eq!(
        validate(
            &w,
            &Command::MoveObject {
                object: b,
                pos: PosMm::new(1_500, 10_500),
                rot: 0
            }
        ),
        Err(Reject::Occupied("someone is sitting on this object"))
    );
    assert_eq!(
        validate(&w, &Command::RemoveObject { object: b }),
        Err(Reject::Occupied("someone is sitting on this object"))
    );
    // after the meeting nobody sits there, and it can go
    until(&mut w, 1, "the bench is free", |w| {
        w.staff
            .values()
            .all(|s| s.spot.and_then(Spot::seat_object).is_none())
    });
    assert!(validate(&w, &Command::RemoveObject { object: b }).is_ok());
}

#[test]
fn seat_assignment_replays_identically() {
    let run = || {
        let mut w = demo_office(9);
        let (_, b) = small_meeting_room_with_a_bench(&mut w);
        let mut log = Vec::new();
        for _ in 0..14_400 {
            w.step();
            let mut on: Vec<StaffId> = w
                .staff
                .values()
                .filter(|s| s.spot.and_then(Spot::seat_object) == Some(b))
                .map(|s| s.id)
                .collect();
            on.sort();
            if log.last() != Some(&on) {
                log.push(on);
            }
        }
        (w.hash(), log)
    };
    let (h1, l1) = run();
    let (h2, l2) = run();
    assert_eq!(h1, h2);
    assert_eq!(l1, l2);
    assert!(l1.iter().any(|on| !on.is_empty()), "someone used the bench");
}

#[test]
fn lunch_past_the_kitchen_table_is_on_the_players_bench() {
    let mut w = demo_office(1);
    w.apply(place(bench(), 13_000, 1_000, 0)).unwrap();
    let b = last_object(&w);
    until(&mut w, 1, "someone lunches on the bench", |w| {
        w.staff.values().any(|s| s.seated_on() == Some(b))
    });
    let s = w.staff.values().find(|s| s.seated_on() == Some(b)).unwrap();
    assert_eq!(s.activity, Activity::Lunch);
    assert!(matches!(
        s.spot,
        Some(Spot::KitchenSeat {
            room: KITCHEN,
            seat: Seat::Object(o, _)
        }) if o == b
    ));
    // the table was full: every table seat is somebody's
    let table_taken = w
        .staff
        .values()
        .filter(|s| {
            matches!(
                s.spot,
                Some(Spot::KitchenSeat {
                    seat: Seat::Table(_),
                    ..
                })
            )
        })
        .count();
    assert_eq!(table_taken, 8);
    let r = render_state(&w);
    let r = r.staff.iter().find(|r| r.id == s.id).unwrap();
    assert_eq!((r.seated_on, r.pose), (Some(b), Pose::Sit));
}

#[test]
fn ceiling_designs_hang_over_the_floor() {
    let mut w = demo_office(1);
    let lamp = ceiling_lamp();
    // over the whiteboard and its door's clear zone: the floor is below
    w.apply(place(lamp, 1_500, 8_600, 0)).unwrap();
    let a = last_object(&w);
    assert!(w.building.objects[&a].is_ceiling());
    assert!(w.building.objects[&a].floor_rects().is_empty());
    w.apply(place(lamp, 3_000, 8_300, 0)).unwrap();
    // a floor design may stand under it
    w.apply(place(bench(), 1_500, 9_500, 0)).unwrap();
    w.apply(place(lamp, 1_500, 9_500, 0)).unwrap();
    // clear of the room's ceiling lights (their 0.5 m squares) and of
    // other ceiling designs
    assert_eq!(
        validate(&w, &place(lamp, 3_000, 10_300, 0)),
        Err(Reject::Overlap)
    );
    assert!(validate(&w, &place(lamp, 3_000, 10_375, 0)).is_ok());
    assert_eq!(
        validate(&w, &place(lamp, 1_600, 8_600, 0)),
        Err(Reject::Overlap)
    );
    assert!(validate(&w, &place(lamp, 1_750, 8_600, 0)).is_ok());
    // inside the room
    assert_eq!(
        validate(&w, &place(lamp, 60, 12_000, 0)),
        Err(Reject::Invalid("the object does not fit inside the room"))
    );
    // a new ceiling light keeps off it; floor equipment does not care
    let light_at = |x, z| Command::PlaceEquipment {
        kind: EquipmentKind::CeilingLight,
        placement: Placement::Floor {
            pos: PosMm::new(x, z),
            rot: 0,
        },
    };
    assert_eq!(validate(&w, &light_at(1_600, 9_200)), Err(Reject::Overlap));
    assert!(validate(&w, &light_at(1_600, 10_900)).is_ok());
    // it moves on the ceiling, past floor items, and is removed
    w.apply(Command::MoveObject {
        object: a,
        pos: PosMm::new(5_000, 12_000),
        rot: 1,
    })
    .unwrap();
    // its light counts towards the room's
    assert_eq!(room_capabilities(&w.building, MEETING).lights, 3);
    w.apply(Command::RemoveObject { object: a }).unwrap();
    assert_eq!(room_capabilities(&w.building, MEETING).lights, 2);
}

#[test]
fn ceiling_designs_are_bounded() {
    let w = demo_office(1);
    let mut deep = ceiling_lamp();
    deep.height = 33;
    assert!(matches!(
        validate(&w, &place(deep, 3_000, 12_000, 0)),
        Err(Reject::Invalid(_))
    ));
    let mut swing = ceiling_lamp();
    swing.seats = 1;
    assert_eq!(
        validate(&w, &place(swing, 3_000, 12_000, 0)),
        Err(Reject::Invalid("a ceiling design seats nobody"))
    );
    // not on a desk; a desk-top design not on the ceiling
    let desk = w
        .building
        .equipment
        .values()
        .find(|e| e.kind == EquipmentKind::Desk)
        .map(|e| e.id)
        .unwrap();
    assert_eq!(
        validate(
            &w,
            &Command::PlaceObjectOnDesk {
                design: hash(0xb3),
                desk,
                summary: ceiling_lamp()
            }
        ),
        Err(Reject::Invalid("only desk-top designs go on a desk"))
    );
    let mut mug = ceiling_lamp();
    mug.mount = Mount::Surface;
    assert_eq!(
        validate(&w, &place(mug, 3_000, 12_000, 0)),
        Err(Reject::Invalid("a desk-top design goes on a desk"))
    );
}
