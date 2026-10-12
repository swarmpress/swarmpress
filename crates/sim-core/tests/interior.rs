//! The office designer's rooms in the sim (ADR-0087 decision 6, FEAT-084):
//! `CommissionInterior` makes an `Interior` item the office designer drafts
//! (or that waits for one, with a MissingRole ticket); the Draft's plan
//! enters as numbers (`InteriorPlan`); an economic company approves its price
//! at a `BuildApproval` ticket (default Defer, never builds), a sandbox one
//! builds at once; the construction places one item every few game minutes,
//! each validated and charged like the CEO's own `PlaceEquipment`; a refused
//! placement stops the build with an escalation; the same inputs give the
//! same world.

use sim_core::building::{Door, RoomKind, Window};
use sim_core::clock::SimConfig;
use sim_core::commands::{
    Command, DemolishTarget, JobDigest, JobFailure, Placement, ServerCommand,
};
use sim_core::economy::BuildMode;
use sim_core::equipment::EquipmentKind;
use sim_core::geom::{PosMm, Side, TileRect};
use sim_core::ids::{EquipId, RoomId, StaffId, TicketId, WorkItemId};
use sim_core::inbox::{Priority, TicketKind, TicketOption};
use sim_core::interior::{PlannedAt, PlannedEquipment, MINUTES_PER_PLACEMENT};
use sim_core::plan::{Effect, JobKind, WorkItemKind, WorkItemStatus};
use sim_core::roles::Role;
use sim_core::scenarios::{demo_office_with_mode, hire_office_designer};
use sim_core::{Reject, World};

/// The newsroom built on land bought to the east (the office designer's
/// own test room, `crates/office-designer/tests/common`).
const NEWSROOM: TileRect = TileRect::new(26, 8, 6, 6);

fn fast() -> SimConfig {
    SimConfig {
        day_real_minutes: 1,
        ..SimConfig::default()
    }
}

/// The demo office with a new, empty newsroom; with an office designer when `designer`.
fn world(mode: BuildMode, designer: bool) -> (World, RoomId) {
    let mut w = demo_office_with_mode(7, fast(), mode);
    w.apply(Command::BuyFloorSpace {
        side: Side::East,
        tiles: 8,
    })
    .unwrap();
    w.apply(Command::PlaceRoom {
        kind: RoomKind::Newsroom,
        rect: NEWSROOM,
        floor: 0,
        doors: vec![Door {
            side: Side::North,
            at: 1,
        }],
        windows: vec![Window {
            side: Side::East,
            at_mm: 1_000,
            width_mm: 4_000,
        }],
    })
    .unwrap();
    let room = w
        .building
        .rooms
        .values()
        .find(|r| r.rect == NEWSROOM)
        .unwrap()
        .id;
    if designer {
        hire_office_designer(&mut w);
    }
    w.drain_effects();
    (w, room)
}

fn floor(kind: EquipmentKind, x: i32, z: i32, rot: u8) -> PlannedEquipment {
    PlannedEquipment {
        kind,
        at: PlannedAt::Floor {
            pos: PosMm::new(x, z),
            rot,
        },
    }
}

fn on(kind: EquipmentKind, desk: u16) -> PlannedEquipment {
    PlannedEquipment {
        kind,
        at: PlannedAt::OnPlanned(desk),
    }
}

/// The newsroom fixture's plan as the office designer solves it: three
/// desks by the window, a screen on each, a plant by the door.
fn plan() -> Vec<PlannedEquipment> {
    vec![
        floor(EquipmentKind::Desk, 31_500, 9_250, 1),
        floor(EquipmentKind::Desk, 31_500, 11_000, 1),
        floor(EquipmentKind::Desk, 31_500, 12_750, 1),
        on(EquipmentKind::Monitor, 0),
        on(EquipmentKind::Monitor, 1),
        on(EquipmentKind::Monitor, 2),
        floor(EquipmentKind::Plant, 26_375, 8_375, 0),
    ]
}

fn plan_cost() -> i64 {
    3 * EquipmentKind::Desk.cost() + 3 * EquipmentKind::Monitor.cost() + EquipmentKind::Plant.cost()
}

type Req = (u64, JobKind, Option<WorkItemId>, Option<u64>, Vec<StaffId>);

fn reqs(w: &mut World) -> Vec<Req> {
    w.drain_effects()
        .into_iter()
        .map(|e| match e {
            Effect::RequestJob {
                job_id,
                kind,
                work_item,
                brief_ref,
                staff,
                ..
            } => (job_id, kind, work_item, brief_ref, staff),
        })
        .collect()
}

fn until(w: &mut World, kind: JobKind) -> Req {
    for _ in 0..20_000 {
        if let Some(r) = reqs(w).into_iter().find(|r| r.1 == kind) {
            return r;
        }
        w.step();
    }
    panic!("no {kind:?} job");
}

fn done(w: &mut World, job: u64) {
    w.apply_server(ServerCommand::JobCompleted {
        job_id: job,
        digest: JobDigest {
            ok: true,
            score: 7,
            words: 0,
            qa_defects: 1,
            artifact_sha: [3; 16],
        },
    })
    .unwrap();
}

fn steps_until(w: &mut World, f: impl Fn(&World) -> bool) {
    for _ in 0..40_000 {
        if f(w) {
            return;
        }
        w.step();
    }
    panic!("condition never held");
}

fn open_ticket(w: &World, kind: TicketKind, item: WorkItemId) -> Option<TicketId> {
    w.tickets
        .values()
        .find(|t| t.is_open() && t.kind == kind && t.work_item == Some(item))
        .map(|t| t.id)
}

fn in_room(w: &World, room: RoomId) -> Vec<(EquipmentKind, Option<EquipId>)> {
    w.building
        .equipment
        .values()
        .filter(|e| e.room == room && e.kind != EquipmentKind::CeilingLight)
        .map(|e| (e.kind, e.attached_to))
        .collect()
}

/// Commission, draft with `items`; returns the item.
fn drafted(w: &mut World, room: RoomId, items: Vec<PlannedEquipment>) -> WorkItemId {
    w.apply(Command::CommissionInterior {
        room,
        brief_ref: 12,
    })
    .unwrap();
    let (job, kind, item, brief, staff) = until(w, JobKind::InteriorDesign);
    assert_eq!(kind, JobKind::InteriorDesign);
    assert_eq!(brief, Some(12));
    assert_eq!(staff, vec![w.office_designer().unwrap()]);
    let item = item.unwrap();
    w.apply_server(ServerCommand::InteriorPlan { job_id: job, items })
        .unwrap();
    done(w, job);
    item
}

#[test]
fn an_economic_room_is_planned_approved_and_built_item_by_item() {
    let (mut w, room) = world(BuildMode::Economic, true);
    let item = drafted(&mut w, room, plan());
    let i = &w.plan.items[&item];
    assert_eq!(i.kind, WorkItemKind::Interior);
    assert_eq!(w.plan.interiors[&item].room, room);
    assert_eq!(w.plan.interiors[&item].cost_cents, plan_cost());

    // The gate: a BuildApproval ticket with the plan's price; nothing is built before it.
    steps_until(&mut w, |w| {
        open_ticket(w, TicketKind::BuildApproval, item).is_some()
    });
    let t = &w.tickets[&open_ticket(&w, TicketKind::BuildApproval, item).unwrap()];
    assert_eq!(
        t.options,
        vec![
            TicketOption::Build,
            TicketOption::Defer,
            TicketOption::Decline
        ]
    );
    assert_eq!(t.default_option, TicketOption::Defer);
    assert_eq!(t.amount_cents, plan_cost());
    assert_eq!(t.priority, Priority::High);
    assert!(TicketKind::BuildApproval.ceo_only());
    assert_eq!(t.deadline_step - t.created_step, w.config.steps_per_day());
    assert!(w.plan.items[&item].awaiting_approval());
    assert!(in_room(&w, room).is_empty());
    // Interior items do not take an article's place in the WIP limit.
    let project = w.plan.items[&item].project;
    assert_eq!(
        w.open_items(project),
        w.plan
            .items
            .values()
            .filter(|i| i.project == project
                && i.kind != WorkItemKind::Interior
                && !i.status.is_closed()
                && !i.is_unstarted())
            .count()
    );

    // Build: the Construct job, then one placement every few game minutes.
    let cash = w.company.cash;
    let rev = w.building.layout_rev;
    let ticket = open_ticket(&w, TicketKind::BuildApproval, item).unwrap();
    w.apply(Command::AnswerTicket {
        ticket,
        option: TicketOption::Build,
    })
    .unwrap();
    let (construct, kind, on, _, staff) = until(&mut w, JobKind::Construct);
    assert_eq!((kind, on), (JobKind::Construct, Some(item)));
    assert_eq!(staff, vec![w.office_designer().unwrap()]);
    done(&mut w, construct);
    let per = w.minutes_to_steps(MINUTES_PER_PLACEMENT);
    let started = w.step;
    steps_until(&mut w, |w| !in_room(w, room).is_empty());
    assert!(
        w.step - started >= per - 1,
        "the first item waits its interval"
    );
    assert_eq!(in_room(&w, room).len(), 1);
    assert_eq!(w.plan.items[&item].status, WorkItemStatus::Approved);
    steps_until(&mut w, |w| w.plan.items[&item].status.is_closed());
    assert_eq!(w.plan.items[&item].status, WorkItemStatus::Published);
    assert!(w.step - started >= per * 7 - 1);
    // Everything stands, the screens on the desks this plan placed.
    let things = in_room(&w, room);
    assert_eq!(things.len(), 7);
    let desks: Vec<EquipId> = w
        .building
        .equipment
        .values()
        .filter(|e| e.room == room && e.kind == EquipmentKind::Desk)
        .map(|e| e.id)
        .collect();
    for (k, on) in &things {
        if *k == EquipmentKind::Monitor {
            assert!(desks.contains(&on.unwrap()));
        }
    }
    assert_eq!(cash - w.company.cash, plan_cost(), "each item at its price");
    assert!(w.building.layout_rev.wrapping_sub(rev) >= 7);
    // The plan is dropped with the closed item.
    w.step();
    assert!(!w.plan.interiors.contains_key(&item));
}

#[test]
fn a_sandbox_room_is_built_at_once_and_for_free() {
    let (mut w, room) = world(BuildMode::Sandbox, true);
    let equipment = |w: &World| {
        w.ledger
            .totals
            .get(&sim_core::economy::LedgerKind::Equipment)
            .copied()
    };
    let spent = equipment(&w);
    let item = drafted(&mut w, room, plan());
    let (construct, ..) = until(&mut w, JobKind::Construct);
    assert!(!w
        .tickets
        .values()
        .any(|t| t.kind == TicketKind::BuildApproval));
    done(&mut w, construct);
    steps_until(&mut w, |w| w.plan.items[&item].status.is_closed());
    assert_eq!(w.plan.items[&item].status, WorkItemStatus::Published);
    assert_eq!(in_room(&w, room).len(), 7);
    assert_eq!(equipment(&w), spent, "nothing was charged for the room");
}

#[test]
fn defer_keeps_it_parked_and_decline_cancels_it() {
    let (mut w, room) = world(BuildMode::Economic, true);
    let item = drafted(&mut w, room, plan());
    steps_until(&mut w, |w| {
        open_ticket(w, TicketKind::BuildApproval, item).is_some()
    });
    let t = open_ticket(&w, TicketKind::BuildApproval, item).unwrap();
    w.apply(Command::AnswerTicket {
        ticket: t,
        option: TicketOption::Defer,
    })
    .unwrap();
    assert!(w.plan.items[&item].awaiting_approval());
    // At the next 08:30 the CEO is asked again.
    steps_until(&mut w, |w| {
        open_ticket(w, TicketKind::BuildApproval, item).is_some()
    });
    // Unanswered, the default (Defer) never builds.
    steps_until(&mut w, |w| {
        w.tickets.values().any(|t| {
            t.kind == TicketKind::BuildApproval
                && !t.is_open()
                && t.answer == Some(TicketOption::Defer)
                && t.resolved_by == Some(sim_core::inbox::ResolvedBy::Default)
        })
    });
    assert!(in_room(&w, room).is_empty());
    assert!(w.plan.items[&item].awaiting_approval());
    steps_until(&mut w, |w| {
        open_ticket(w, TicketKind::BuildApproval, item).is_some()
    });
    let t = open_ticket(&w, TicketKind::BuildApproval, item).unwrap();
    w.apply(Command::AnswerTicket {
        ticket: t,
        option: TicketOption::Decline,
    })
    .unwrap();
    assert_eq!(w.plan.items[&item].status, WorkItemStatus::Cancelled);
    w.step();
    assert!(!w.plan.interiors.contains_key(&item));
    assert!(in_room(&w, room).is_empty());
    // The room is free for a new design.
    assert!(sim_core::validate(
        &w,
        &Command::CommissionInterior {
            room,
            brief_ref: 13
        }
    )
    .is_ok());
}

#[test]
fn a_refused_placement_stops_the_build_and_retry_resumes_it() {
    let (mut w, room) = world(BuildMode::Economic, true);
    let item = drafted(&mut w, room, plan());
    steps_until(&mut w, |w| {
        open_ticket(w, TicketKind::BuildApproval, item).is_some()
    });
    let t = open_ticket(&w, TicketKind::BuildApproval, item).unwrap();
    w.apply(Command::AnswerTicket {
        ticket: t,
        option: TicketOption::Build,
    })
    .unwrap();
    let (construct, ..) = until(&mut w, JobKind::Construct);
    done(&mut w, construct);
    // The CEO puts a plant where the plan's last item goes: the room changed meanwhile.
    let blocker = w.ids.peek_equip();
    w.apply(Command::PlaceEquipment {
        kind: EquipmentKind::Plant,
        placement: Placement::Floor {
            pos: PosMm::new(26_500, 8_500),
            rot: 0,
        },
    })
    .unwrap();
    steps_until(&mut w, |w| {
        w.plan.items[&item].status == WorkItemStatus::Blocked
    });
    assert_eq!(w.plan.interiors[&item].refused, Some(6));
    assert_eq!(w.plan.interiors[&item].placed.len(), 6);
    let esc = open_ticket(&w, TicketKind::Escalation, item).expect("an escalation names the item");
    assert_eq!(w.tickets[&esc].default_option, TicketOption::Retry);
    // Cleared and retried: the build resumes with the refused item.
    w.apply(Command::Demolish(DemolishTarget::Equipment(blocker)))
        .unwrap();
    w.apply(Command::AnswerTicket {
        ticket: esc,
        option: TicketOption::Retry,
    })
    .unwrap();
    let (again, ..) = until(&mut w, JobKind::Construct);
    assert_ne!(again, construct);
    assert_eq!(w.plan.interiors[&item].refused, None);
    done(&mut w, again);
    steps_until(&mut w, |w| w.plan.items[&item].status.is_closed());
    assert_eq!(w.plan.items[&item].status, WorkItemStatus::Published);
    assert_eq!(in_room(&w, room).len(), 7);
}

#[test]
fn without_a_designer_the_room_waits_and_the_ceo_is_asked_to_hire() {
    let (mut w, room) = world(BuildMode::Economic, false);
    assert!(w.office_designer().is_none());
    w.apply(Command::CommissionInterior {
        room,
        brief_ref: 12,
    })
    .unwrap();
    let item = *w.plan.interiors.keys().next().unwrap();
    assert!(w.plan.items[&item].is_unstarted());
    assert!(reqs(&mut w).is_empty(), "no job without a designer");
    // A due day set by the CEO gives it a start day, but the board's standup never starts an
    // interior with a writer: it waits for a designer.
    let today = w.clock().day;
    w.apply(Command::UpdateWorkItem {
        item,
        update: sim_core::commands::WorkItemUpdate::DueDay(today + 1),
    })
    .unwrap();
    let day = w.clock().day;
    steps_until(&mut w, |w| w.clock().day >= day + 2);
    assert!(w.plan.items[&item].is_unstarted(), "still waiting");
    assert!(
        w.plan.items[&item]
            .phases
            .iter()
            .all(|p| p.assignee.is_none()),
        "nobody but a designer takes it"
    );
    let t = w
        .tickets
        .values()
        .find(|t| t.is_open() && t.kind == TicketKind::MissingRole)
        .unwrap();
    assert_eq!(t.role, Some(Role::OfficeDesigner));
    assert_eq!(t.default_option, TicketOption::ArrangeHiring);
    // ArrangeHiring finds the catalogue's office designer.
    w.add_candidate_for_role(Role::OfficeDesigner);
    let c = w
        .candidates
        .values()
        .find(|c| c.role == Role::OfficeDesigner)
        .unwrap();
    assert_eq!(sim_core::personas::persona_slug(c.persona), "ottavia");
    let designer = hire_office_designer(&mut w);
    let (_, _, on, _, staff) = until(&mut w, JobKind::InteriorDesign);
    assert_eq!(on, Some(item));
    assert_eq!(staff, vec![designer]);
    assert_eq!(w.plan.items[&item].owner, Some(designer));
}

#[test]
fn commissions_and_plans_are_validated() {
    let (mut w, room) = world(BuildMode::Economic, true);
    assert_eq!(
        w.apply(Command::CommissionInterior {
            room: RoomId(999),
            brief_ref: 1
        }),
        Err(Reject::UnknownRoom(RoomId(999)))
    );
    w.apply(Command::CommissionInterior {
        room,
        brief_ref: 12,
    })
    .unwrap();
    assert!(matches!(
        w.apply(Command::CommissionInterior {
            room,
            brief_ref: 13
        }),
        Err(Reject::Occupied(_))
    ));
    let (job, ..) = until(&mut w, JobKind::InteriorDesign);
    let bad = |w: &World, items: Vec<PlannedEquipment>| {
        sim_core::validate_server(w, &ServerCommand::InteriorPlan { job_id: job, items })
    };
    assert!(bad(&w, vec![]).is_err(), "empty");
    assert!(
        bad(&w, vec![on(EquipmentKind::Monitor, 0)]).is_err(),
        "a desk placed before it"
    );
    assert!(
        bad(&w, vec![floor(EquipmentKind::Monitor, 27_000, 9_000, 0)]).is_err(),
        "a screen on the floor"
    );
    assert!(
        bad(
            &w,
            vec![
                floor(EquipmentKind::Plant, 27_000, 9_000, 0),
                on(EquipmentKind::Monitor, 0)
            ]
        )
        .is_err(),
        "a screen on a plant"
    );
    assert!(
        bad(&w, vec![floor(EquipmentKind::Desk, 27_000, 9_000, 4)]).is_err(),
        "turns"
    );
    assert!(bad(&w, vec![floor(EquipmentKind::Plant, 27_000, 9_000, 0)]).is_ok());
    // Only the office designer's job takes a plan.
    let other = w.plan.jobs.keys().copied().find(|j| *j != job);
    if let Some(other) = other {
        assert!(sim_core::validate_server(
            &w,
            &ServerCommand::InteriorPlan {
                job_id: other,
                items: plan()
            }
        )
        .is_err());
    }
    // A completion without a plan fails loudly (rule 11).
    done(&mut w, job);
    let item = *w.plan.interiors.keys().next().unwrap();
    steps_until(&mut w, |w| {
        w.plan.items[&item].status == WorkItemStatus::Blocked
    });
    assert!(open_ticket(&w, TicketKind::Escalation, item).is_some());
}

#[test]
fn a_failed_draft_blocks_the_item() {
    let (mut w, room) = world(BuildMode::Economic, true);
    w.apply(Command::CommissionInterior {
        room,
        brief_ref: 12,
    })
    .unwrap();
    let (job, _, item, ..) = until(&mut w, JobKind::InteriorDesign);
    w.apply_server(ServerCommand::JobFailed {
        job_id: job,
        reason: JobFailure::InvalidOutput,
    })
    .unwrap();
    let item = item.unwrap();
    assert_eq!(w.plan.items[&item].status, WorkItemStatus::Blocked);
    let t = &w.tickets[&open_ticket(&w, TicketKind::Escalation, item).unwrap()];
    assert_eq!(t.failure, Some(JobFailure::InvalidOutput));
}

/// The same inputs give the same world, built step by step.
#[test]
fn construction_is_deterministic() {
    let run = || {
        let (mut w, room) = world(BuildMode::Economic, true);
        let item = drafted(&mut w, room, plan());
        steps_until(&mut w, |w| {
            open_ticket(w, TicketKind::BuildApproval, item).is_some()
        });
        let t = open_ticket(&w, TicketKind::BuildApproval, item).unwrap();
        w.apply(Command::AnswerTicket {
            ticket: t,
            option: TicketOption::Build,
        })
        .unwrap();
        let (construct, ..) = until(&mut w, JobKind::Construct);
        done(&mut w, construct);
        let mut hashes = Vec::new();
        for _ in 0..200 {
            w.step();
            hashes.push(w.hash());
        }
        steps_until(&mut w, |w| w.plan.items[&item].status.is_closed());
        (hashes, w.hash(), w.step)
    };
    assert_eq!(run(), run());
}

#[test]
fn hiring_twice_never_makes_a_nameless_designer() {
    let (mut w, _) = world(BuildMode::Economic, false);
    let designers = |w: &World| {
        w.candidates
            .values()
            .filter(|c| c.role == Role::OfficeDesigner)
            .map(|c| sim_core::personas::persona_slug(c.persona))
            .collect::<Vec<_>>()
    };
    // The ticket's ArrangeHiring and the Secretary's both ask: one candidate, Ottavia.
    w.add_candidate_for_role(Role::OfficeDesigner);
    w.add_candidate_for_role(Role::OfficeDesigner);
    assert_eq!(designers(&w), vec!["ottavia"]);
    // Once she is on the staff there is nobody left to shortlist.
    let ottavia = w
        .candidates
        .values()
        .find(|c| c.role == Role::OfficeDesigner)
        .unwrap()
        .id;
    w.apply(Command::Hire { candidate: ottavia }).unwrap();
    assert!(w.office_designer().is_some());
    w.add_candidate_for_role(Role::OfficeDesigner);
    assert!(designers(&w).is_empty());
}

/// The office designer sees the players' own designs in the room (ADR-0088):
/// numbers only, in id order; a desk-top design names its desk and slot; a
/// footprint is studs × 62.5 mm rounded up; older JSON without objects parses.
#[test]
fn the_designer_room_lists_the_players_objects() {
    use sim_core::interior::DesignerRoom;
    use sim_core::objects::{Mount, ObjectSummary};
    let (mut w, room) = world(BuildMode::Sandbox, false);
    let summary = |footprint: [u32; 2], mount: Mount| ObjectSummary {
        footprint,
        height: 30,
        mount,
        seats: 0,
        workstation: false,
        seat_at: None,
        lights: 0,
        storage: 0,
        screens: 0,
        parts: 40,
        cost: 900,
    };
    w.apply(Command::PlaceEquipment {
        kind: EquipmentKind::Desk,
        placement: Placement::Floor {
            pos: PosMm::new(30_000, 12_000),
            rot: 0,
        },
    })
    .unwrap();
    let desk = *w.building.equipment.keys().last().unwrap();
    // a player's desk turned a quarter: its seat 750 mm south at turn 0
    w.apply(Command::PlaceObject {
        design: "d5".repeat(32),
        pos: PosMm::new(28_000, 11_000),
        rot: 1,
        summary: ObjectSummary {
            workstation: true,
            seat_at: Some([0, 750]),
            seats: 1,
            screens: 1,
            lights: 1,
            ..summary([24, 12], Mount::Floor)
        },
    })
    .unwrap();
    w.apply(Command::PlaceObject {
        design: "5e".repeat(32),
        pos: PosMm::new(31_000, 9_000),
        rot: 0,
        summary: ObjectSummary {
            storage: 96,
            ..summary([17, 9], Mount::Floor)
        },
    })
    .unwrap();
    // a mug on the desk: the lamp slot
    w.apply(Command::PlaceObjectOnDesk {
        design: "70".repeat(32),
        desk,
        summary: summary([4, 4], Mount::Surface),
    })
    .unwrap();
    let r = w.designer_room(room).unwrap();
    let ids: Vec<String> = w
        .building
        .objects
        .values()
        .filter(|o| o.room == room)
        .map(|o| o.id.to_string())
        .collect();
    assert_eq!(r.objects.len(), 3);
    let v = serde_json::to_value(&r.objects).unwrap();
    assert_eq!(
        v,
        serde_json::json!([
            {"id": ids[0], "x_mm": 28_000, "z_mm": 11_000, "rot": 1, "footprint_mm": [1_500, 750],
             "workstation": true, "seat_at_mm": [0, 750], "seats": 1, "lights": 1, "storage": 0, "screens": 1},
            {"id": ids[1], "x_mm": 31_000, "z_mm": 9_000, "rot": 0, "footprint_mm": [1_063, 563],
             "workstation": false, "seats": 0, "lights": 0, "storage": 96, "screens": 0},
            {"id": ids[2], "x_mm": 30_000, "z_mm": 12_000, "rot": 0, "footprint_mm": [250, 250],
             "workstation": false, "on_desk": {"desk": desk.to_string(), "slot": "lamp"},
             "seats": 0, "lights": 0, "storage": 0, "screens": 0}
        ])
    );
    println!("{}", serde_json::to_string_pretty(&r.objects).unwrap());
    // older JSON (before objects) still parses
    let mut old = serde_json::to_value(&r).unwrap();
    old.as_object_mut().unwrap().remove("objects");
    let back: DesignerRoom = serde_json::from_value(old).unwrap();
    assert!(back.objects.is_empty());
    assert_eq!(back.equipment, r.equipment);
    // other rooms do not see them
    let other = w
        .building
        .rooms
        .keys()
        .find(|k| **k != room)
        .copied()
        .unwrap();
    assert!(w.designer_room(other).unwrap().objects.is_empty());
}
