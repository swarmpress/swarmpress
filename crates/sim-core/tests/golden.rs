//! Golden determinism: the scripted 50,000-step run of the demo office must
//! hash to the same value on every platform, natively and in wasm
//! (`crates/client-wasm/tests/golden_wasm.rs` asserts the same constant).
//!
//! If a deliberate sim change moves the hash, regenerate with
//! `cargo test -p sim-core --test golden -- --nocapture` and update
//! `GOLDEN_HASH` here AND in `crates/client-wasm/tests/golden_wasm.rs` and
//! `crates/client-wasm/tests/snapshot_wasm.rs`, bump `WORLD_FORMAT`
//! (`tests/snapshot.rs` says how), and regenerate
//! `packages/runner/test/fixtures/golden.json`.
//!
//! History:
//! - `0x591f_2064_16aa_2764`: world format 1.
//! - world format 2 (FEAT-079, ADR-0059): the publish gate, `JobFailed` and
//!   `DeployFailed`, the failure tickets (a standup nobody answers now
//!   raises one every day, which is why the command-less runner fixture
//!   moved too), the escalation default, `Meeting.speak_from/speak_chars`,
//!   `Ticket.failure`, `WorkItem.escalations`, and a longer script.
//! - `0x39d9_8696_fe53_cdc4`: world format 2.
//! - world format 3 (FEAT-087, ADR-0069): the weekly editorial board, the
//!   work item's planned days, workstream and dependencies, the plan's
//!   workstreams and board days, the `EditorialBoard` policy; the script
//!   turns the board on and answers the first one.
//! - `0xa01f_2bd6_e634_9f86`: world format 3.
//! - world format 4 (FEAT-097, ADR-0071): `WorkItem.performance` and
//!   `followed_up`, `Policies.analytics`; the script is unchanged.
//! - `0xc494_97aa_3ace_5cd8`: world format 4.
//! - world format 5 (FEAT-098, ADR-0073): `Policies.distribution`; the
//!   script is unchanged.
//! - `0x6d4c_cf99_7f96_64c8`: world format 5.
//! - world format 6 (FEAT-099, ADR-0074): `World.remarks` and `next_remark`;
//!   the script is unchanged.
//! - `0xb813_e0b6_11f8_535b`: world format 6.
//! - world format 7 (FEAT-090, FEAT-091, ADR-0072): `Plan.structure` (the
//!   blueprint's digest and the installed tools) and `PendingJob.tool`; the
//!   script is unchanged.
//! - `0xb5dd_1e08_70d7_ce56`: world format 7.
//! - world format 8 (FEAT-026, ADR-0087): `Building.town` (seeded at
//!   founding), `Building.layout_rev`, `Company.build_mode` and the town id
//!   counter; the script gains a desk move and three town commands.
//! - `0x16eb_054f_dab5_dacf`: world format 8.
//! - world format 9 (FEAT-084, ADR-0087 decision 6): `Plan.interiors`, the
//!   office designer's role and persona (a new face in the hiring pool),
//!   `Interior` items, `BuildApproval`; the script commissions a room the
//!   company has no designer for.
//! - `0xf6ce_b7e4_5b6e_77a5`: world format 9.
//! - world format 10 (ADR-0065 §4, ADR-0087 decision 7): `Building.objects`
//!   (players' own kit designs: hash and summary) and the object id
//!   counter; the script places an object in the archive before it is
//!   demolished, places two in the meeting room, moves one and removes the
//!   other.
//! - `0xecf3_fa83_82cc_eebf`: world format 10.
//! - world format 11: the demo office's meeting-room whiteboard moves west,
//!   out of its door's clear zone (the office designer's door check found it).
//! - `0xa754_6031_a1f4_9977`: world format 11.
//! - world format 12: asking for a role's candidate adds none while one is
//!   listed or when every persona for the role is taken (no nameless hires).
//! - `0x5903_aa40_d249_346b`: world format 12.
//! - world format 13 (FEAT-026, ADR-0088): staff use what the bricks
//!   provide: `Staff.home` is a `Station` (a desk or a workstation object),
//!   `Spot::Object`, the summary's `seat_at`, `PlacedObject.on_desk` and
//!   `PlaceObjectOnDesk`; the script removes a spare desk, places a desk of
//!   the player's design, hires three (the third gets the object) and puts
//!   a mug of the player's design on a desk's lamp slot.
//! - `0xb779_a495_3fc3_f821`: world format 13.
//! - world format 14 (FEAT-026, ADR-0089, ADR-0090): meeting and kitchen
//!   spots carry a `Seat` (the table's, or a seat object's place), ceiling
//!   designs are placed; the script places a bench of the player's in the
//!   kitchen and a lamp of theirs on the meeting room's ceiling.
//! - `0xb24f_5706_c533_b9a6`: world format 14.

use sim_core::commands::JobFailure;
use sim_core::equipment::DeskSlot;
use sim_core::geom::PosMm;
use sim_core::ids::{EquipId, ObjectId, StaffId, TicketId, TownItemId, WorkItemId};
use sim_core::inbox::{ResolvedBy, TicketKind, TicketOption, TicketStatus};
use sim_core::plan::{JobKind, WorkItemStatus};
use sim_core::scenarios::{golden_script, run_golden, DEMO_PROJECT, GOLDEN_STEPS};
use sim_core::staff::Station;
use sim_core::town::TownKind;

const GOLDEN_HASH: u64 = 0xb24f_5706_c533_b9a6;

#[test]
fn golden_hash() {
    let (w, results) = run_golden(GOLDEN_STEPS);
    assert_eq!(results.len(), golden_script().len());
    assert!(results.iter().all(|(_, r)| r.is_ok()), "{results:?}");
    // The scripted job contract. Item 1: approved by the CEO at the gate,
    // a failed deploy retried, published.
    let item = |i| &w.plan.items[&WorkItemId(i)];
    assert_eq!(item(1).status, WorkItemStatus::Published);
    assert_eq!(item(1).last_score, Some(8));
    let ticket = |i| &w.tickets[&TicketId(i)];
    assert_eq!(
        item(1).tickets,
        vec![TicketId(4), TicketId(10)],
        "the approval and the failed deploy"
    );
    assert_eq!(ticket(4).kind, TicketKind::PublishApproval);
    assert_eq!(ticket(4).answer, Some(TicketOption::Publish));
    assert_eq!(ticket(4).resolved_by, Some(ResolvedBy::Ceo));
    assert_eq!(ticket(10).kind, TicketKind::DeployFailed);
    assert_eq!(ticket(10).answer, Some(TicketOption::Retry));
    // Item 2: revised once, deferred at the gate, asked again at 08:30, sent
    // back (revision 2), its draft timed out, retried by the default of its
    // first escalation: drafting again.
    assert_eq!(item(2).revision, 2);
    assert_eq!(item(2).last_score, Some(9));
    assert_eq!(item(2).status, WorkItemStatus::InProgress);
    assert_eq!(item(2).escalations, 1);
    assert_eq!(
        item(2).tickets,
        vec![TicketId(11), TicketId(12), TicketId(15)]
    );
    assert_eq!(ticket(11).answer, Some(TicketOption::Defer));
    assert_eq!(ticket(12).kind, TicketKind::PublishApproval);
    assert_eq!(ticket(12).answer, Some(TicketOption::SendBack));
    assert_eq!(ticket(15).kind, TicketKind::Escalation);
    assert_eq!(ticket(15).failure, Some(JobFailure::Timeout));
    assert_eq!(ticket(15).status, TicketStatus::Expired);
    assert_eq!(ticket(15).answer, Some(TicketOption::Retry));
    // Item 3: no media, killed by the default two days later.
    assert_eq!(item(3).status, WorkItemStatus::Cancelled);
    assert_eq!(item(3).tickets, vec![TicketId(14)]);
    assert_eq!(ticket(14).kind, TicketKind::NeedsMedia);
    assert_eq!(ticket(14).answer, Some(TicketOption::Kill));
    // The failed standup was retried; every standup nobody answered raised
    // a ticket of its own.
    assert_eq!(ticket(13).kind, TicketKind::StandupFailed);
    assert_eq!(ticket(13).failure, Some(JobFailure::Infrastructure));
    assert_eq!(ticket(13).answer, Some(TicketOption::Retry));
    let timed_out = w
        .tickets
        .values()
        .filter(|t| t.kind == TicketKind::StandupFailed && t.failure == Some(JobFailure::Timeout))
        .count();
    assert!(timed_out >= 3, "{timed_out} standups timed out");
    // Day 4, 10:00: the first editorial board (job 19) planned items 4 and
    // 5 under one workstream; item 4 started with the lowest-id free writer,
    // item 5 waits for it to be published.
    assert_eq!(w.plan.board_days.get(&DEMO_PROJECT), Some(&4));
    assert_eq!(item(4).status, WorkItemStatus::InProgress);
    assert_eq!(item(4).phases[0].assignee, Some(StaffId(1)));
    assert_eq!(
        (item(4).start_day, item(4).due_day, item(4).publish_day),
        (Some(4), Some(6), Some(7))
    );
    assert_eq!(item(5).status, WorkItemStatus::Planned);
    assert!(item(5).is_unstarted());
    assert_eq!(item(5).depends_on, vec![WorkItemId(4)]);
    assert_eq!(item(4).workstream, item(5).workstream);
    assert_eq!(w.plan.workstreams.len(), 1);
    // Pending: item 2's retried draft and item 4's draft.
    let pending: Vec<(JobKind, Option<WorkItemId>)> = w
        .plan
        .jobs
        .values()
        .map(|j| (j.kind, j.work_item))
        .collect();
    assert_eq!(
        pending,
        vec![
            (JobKind::Draft, Some(WorkItemId(2))),
            (JobKind::Draft, Some(WorkItemId(4)))
        ]
    );
    // The rearrangement (ADR-0087): the desk turned with what sits on it,
    // the town one tree up and one down, the Plan house moved back.
    let desk = &w.building.equipment[&EquipId(62)];
    assert_eq!((desk.pos, desk.rot), (PosMm::new(6_500, 4_200), 2));
    for e in w.building.equipment.values() {
        if e.attached_to == Some(EquipId(62)) {
            assert_eq!((e.pos, e.rot), (desk.pos, desk.rot));
        }
    }
    assert_eq!(w.building.town.len(), 19);
    assert!(!w.building.town.contains_key(&TownItemId(14)));
    assert_eq!(w.building.town[&TownItemId(20)].kind, TownKind::Tree);
    assert_eq!(
        w.building.town[&TownItemId(1)].pos,
        PosMm::new(3_000, -11_000)
    );
    // the trees and the lamp past the lot's east end moved out with the land
    assert_eq!(
        w.building.town[&TownItemId(15)].pos,
        PosMm::new(30_500, -4_500)
    );
    // The office designer (ADR-0087 decision 6): nobody can furnish the
    // meeting room yet, so item 6 waits, unstarted, and the CEO is asked to hire.
    assert_eq!(item(6).kind, sim_core::plan::WorkItemKind::Interior);
    assert!(item(6).is_unstarted());
    assert_eq!(
        w.plan.interiors[&WorkItemId(6)].room,
        sim_core::ids::RoomId(6)
    );
    assert!(w.tickets.values().any(|t| t.kind == TicketKind::MissingRole
        && t.role == Some(sim_core::roles::Role::OfficeDesigner)));
    // Players' own designs (ADR-0065 §4): the archive's went with the
    // room, the meeting room keeps the moved shelf, the table is gone.
    let objects: Vec<_> = w.building.objects.values().collect();
    assert_eq!(objects.len(), 5);
    let shelf = objects[0];
    assert_eq!(shelf.id, sim_core::ids::ObjectId(3));
    assert_eq!(shelf.design, "3c".repeat(32));
    assert_eq!(shelf.room, sim_core::ids::RoomId(6));
    assert_eq!((shelf.pos, shelf.rot), (PosMm::new(5_500, 14_000), 1));
    assert_eq!(shelf.summary.storage, 480);
    // ADR-0088: the third hire works at the player's desk, seated 750 mm
    // west of it (turned once); a mug of the player's design holds a desk's
    // lamp slot.
    let my_desk = Station::Object(ObjectId(4));
    let hire = w.station_owner(my_desk).expect("someone calls it home");
    assert_eq!(hire, StaffId(17));
    assert_eq!(w.staff[&hire].pos, PosMm::new(750, 12_000));
    assert_eq!(w.staff[&hire].seated_station(), Some(my_desk));
    assert!(w.free_stations().is_empty());
    assert_eq!(
        w.building.objects[&ObjectId(5)].on_desk,
        Some((EquipId(59), DeskSlot::Lamp))
    );
    // ADR-0089, ADR-0090: a bench of the player's seats three in the
    // kitchen, after its table's eight; a lamp of theirs hangs in the
    // meeting room, its light among the room's.
    let bench = &w.building.objects[&ObjectId(6)];
    assert_eq!(bench.room, sim_core::ids::RoomId(3));
    assert_eq!(bench.places(), 3);
    assert_eq!(w.room_seats(bench.room).len(), 11);
    let lamp = &w.building.objects[&ObjectId(7)];
    assert!(lamp.is_ceiling());
    assert_eq!(
        sim_core::objects::room_capabilities(&w.building, lamp.room).lights,
        2
    );
    println!("golden hash: {:#018x}", w.hash());
    assert_eq!(w.hash(), GOLDEN_HASH, "got {:#018x}", w.hash());
}
