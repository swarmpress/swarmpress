//! The office designer's jobs (ADR-0087 decision 6, FEAT-084): a room plan
//! drafted by the fake model from the brief and the room, solved and checked
//! by `office-designer`, repaired when the checker names issues, kept as the
//! item's artifact and handed to the sim as numbers; a plan that never
//! checks and a model failure fail loudly; the construction job reports the
//! build. The last test runs the sim around the jobs: commission, draft,
//! the CEO's Build, the construction item by item, the same world twice.

use std::sync::Arc;

use agents::fake_writer::fake_writer;
use agents::{FakeLlm, FakeReply, LlmError};
use orchestrator::{
    interior_brief, Digest, FakeGateway, JobFailure, JobKind, JobRequest, MemStore, OnDesk,
    Orchestrator, Outcome, StaffRef, Store,
};
use serde_json::{json, Value};
use sim_core::building::{Door, RoomKind, Window};
use sim_core::clock::SimConfig;
use sim_core::commands::{Command, ServerCommand};
use sim_core::economy::BuildMode;
use sim_core::geom::{PosMm, Side, TileRect};
use sim_core::ids::RoomId;
use sim_core::inbox::{TicketKind, TicketOption};
use sim_core::objects::{Mount, ObjectSummary};
use sim_core::plan::{Effect, JobKind as SimJob, WorkItemStatus};
use sim_core::scenarios::{demo_office_with_mode, hire_office_designer};
use sim_core::World;

mod common;
use common::{site, COMPANY};

const ITEM: &str = "work-item-9";
const BRIEF: u64 = 12;
const NEWSROOM: TileRect = TileRect::new(26, 8, 6, 6);

/// The demo office with an empty newsroom on land bought to the east and
/// the catalogue's office designer.
fn world() -> (World, RoomId) {
    let mut w = demo_office_with_mode(
        7,
        SimConfig {
            day_real_minutes: 1,
            ..SimConfig::default()
        },
        BuildMode::Economic,
    );
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
    hire_office_designer(&mut w);
    w.drain_effects();
    let room = w
        .building
        .rooms
        .values()
        .find(|r| r.rect == NEWSROOM)
        .unwrap()
        .id;
    (w, room)
}

fn brief() -> Value {
    json!({"workstations": 3, "plants": 1, "max_cost_cents": 500_000})
}

fn designer() -> StaffRef {
    StaffRef {
        id: "staff-14".into(),
        persona: "ottavia".into(),
        role: "office-designer".into(),
    }
}

fn context(w: &World, room: RoomId) -> Value {
    json!({
        "room_id": room.to_string(),
        "room": serde_json::to_value(w.designer_room(room).unwrap()).unwrap(),
        "build_mode": "economic",
    })
}

fn job(job_id: u64, kind: JobKind, context: Value) -> JobRequest {
    JobRequest {
        company_id: COMPANY.into(),
        job_id,
        kind,
        project: "project-1".into(),
        work_item: Some(ITEM.into()),
        brief_ref: Some(BRIEF),
        revision: 0,
        staff: vec![designer()],
        meeting: None,
        context,
        approved_by: None,
    }
}

async fn orch(llm: impl Into<Arc<FakeLlm>>) -> Orchestrator<MemStore, FakeGateway> {
    let llm: Arc<FakeLlm> = llm.into();
    let o = Orchestrator::new(MemStore::new(), FakeGateway::new(), llm, site());
    o.store()
        .put_brief(
            COMPANY,
            BRIEF,
            interior_brief("Three desks by the window and a plant, please.", &brief()),
        )
        .await
        .unwrap();
    o
}

fn completed(out: &[Outcome]) -> &Digest {
    match out.last() {
        Some(Outcome::JobCompleted { digest, .. }) => digest,
        other => panic!("not a JobCompleted: {other:?}"),
    }
}

fn failed(out: &[Outcome]) -> JobFailure {
    match out {
        [Outcome::JobFailed { reason, .. }] => *reason,
        other => panic!("not one JobFailed: {other:?}"),
    }
}

async fn posts(o: &Orchestrator<MemStore, FakeGateway>) -> Vec<Value> {
    o.store().plan_json(COMPANY).await.unwrap()["posts"][ITEM]
        .as_array()
        .cloned()
        .unwrap_or_default()
}

#[tokio::test]
async fn a_room_plan_is_solved_kept_and_handed_to_the_sim_as_numbers() {
    let (w, room) = world();
    let o = orch(fake_writer([])).await;
    let out = o
        .run(&job(41, JobKind::InteriorDesign, context(&w, room)))
        .await
        .unwrap();
    assert_eq!(out.len(), 2, "{out:?}");
    let d = completed(&out);
    assert!(d.ok);
    assert_eq!(d.qa_defects, 0, "the fake's plan checks at once");
    assert_eq!(d.score, 7);
    // The artifact: the room plan in build order, a screen on each planned desk.
    let art = o
        .store()
        .get_artifact(COMPANY, ITEM)
        .await
        .unwrap()
        .unwrap();
    let plan = &art["room_plan"];
    assert_eq!(plan["kind"], "room-plan");
    assert_eq!(plan["room"], room.to_string());
    let items = plan["items"].as_array().unwrap();
    let designs: Vec<&str> = items
        .iter()
        .map(|i| i["design"].as_str().unwrap())
        .collect();
    assert_eq!(
        designs,
        ["desk", "desk", "desk", "monitor", "monitor", "monitor", "plant"]
    );
    assert_eq!(items[0]["on_desk"], Value::Null);
    assert_eq!(items[3]["on_desk"], json!({"planned": 0}));
    assert_eq!(items[5]["on_desk"], json!({"planned": 2}));
    assert_eq!(items[3]["x_mm"], 0);
    assert_eq!(plan["cost_cents"], 3 * 40_000 + 3 * 30_000 + 5_000);
    assert!(plan["parts"].as_u64().unwrap() > 0);
    assert!(plan["summary"].as_str().unwrap().contains("3 desk"));
    let typed: orchestrator::RoomPlan = serde_json::from_value(plan.clone()).unwrap();
    assert_eq!(typed.items[4].on_desk, Some(OnDesk::Planned(1)));
    // The placements, as the sim takes them.
    let Outcome::InteriorPlan { job_id, items } = &out[0] else {
        panic!("first the plan: {out:?}");
    };
    assert_eq!(*job_id, 41);
    let cmd: ServerCommand =
        serde_json::from_value(serde_json::to_value(&out[0]).unwrap()).unwrap();
    let ServerCommand::InteriorPlan { items: sim, .. } = cmd else {
        panic!("not a plan");
    };
    assert_eq!(sim.len(), items.len());
    // An artifact post with the summary, under the designer's name.
    let ps = posts(&o).await;
    let a = ps.iter().find(|p| p["type"] == "artifact").unwrap();
    assert_eq!(a["author"], "staff-14");
    assert_eq!(a["payload"]["room_plan"]["items"], 7);
    // The same job again (a reload) asks the model nothing new and says the same.
    let again = o
        .run(&job(41, JobKind::InteriorDesign, context(&w, room)))
        .await
        .unwrap();
    assert_eq!(again, out);
}

#[tokio::test]
async fn the_checkers_issues_are_repaired() {
    let (w, room) = world();
    // The first layout runs the desks from the west corner into the door;
    // the fake's fix moves the row to the next wall.
    let llm = fake_writer([FakeReply::Json(json!({"placements": [
        {"design": "desk", "anchor": "wall:north", "from": "wall:west", "count": 3, "spacing": 4},
        {"design": "monitor", "anchor": "placement:0"},
        {"design": "plant", "anchor": "wall:south", "from": "wall:west"}
    ]}))]);
    let llm = Arc::new(llm);
    let o = orch(llm.clone()).await;
    let out = o
        .run(&job(42, JobKind::InteriorDesign, context(&w, room)))
        .await
        .unwrap();
    let d = completed(&out);
    assert!(d.ok, "{out:?}");
    assert_eq!(d.qa_defects, 1, "one repair round");
    // The layout and the fix think with the designer's own reasoning budget, and still fit
    // a local model's window.
    let calls = llm.calls();
    assert_eq!(calls.len(), 2, "a layout and a fix");
    for call in &calls {
        assert_eq!(
            call.request.reasoning_tokens,
            Some(agents::build::LAYOUT_REASONING)
        );
        assert!(agents::article_prompts::LlmProfile::LOCAL.fits(&call.request));
    }
    let art = o
        .store()
        .get_artifact(COMPANY, ITEM)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(art["room_plan"]["repairs"], 1);
    assert_eq!(
        art["room_plan"]["plan"]["placements"][0]["anchor"],
        "wall:east"
    );
}

#[tokio::test]
async fn a_plan_that_never_checks_fails_loudly() {
    let (w, room) = world();
    let bad = json!({"placements": [{"design": "plant", "anchor": "door:0"}]});
    let mut script = vec![FakeReply::Json(bad)];
    // Every fix changes nothing.
    for _ in 0..3 {
        script.push(FakeReply::Json(json!({"replace": []})));
    }
    let o = orch(fake_writer(script)).await;
    let out = o
        .run(&job(43, JobKind::InteriorDesign, context(&w, room)))
        .await
        .unwrap();
    assert_eq!(failed(&out), JobFailure::InvalidOutput);
    let ps = posts(&o).await;
    let s = ps.iter().find(|p| p["type"] == "status").unwrap();
    assert_eq!(s["payload"]["room_plan"], "failed");
    assert!(s["text"].as_str().unwrap().contains("after 3 repairs"));
    assert!(o
        .store()
        .get_artifact(COMPANY, ITEM)
        .await
        .unwrap()
        .is_none_or(|a| a["room_plan"].is_null()));
    // A model that fails is never a fake success either.
    let o = orch(fake_writer([
        FakeReply::Error(LlmError::Backend("down".into())),
        FakeReply::Error(LlmError::Backend("down".into())),
    ]))
    .await;
    let out = o
        .run(&job(44, JobKind::InteriorDesign, context(&w, room)))
        .await
        .unwrap();
    assert_eq!(failed(&out), JobFailure::Model);
    // Without the room the job is not runnable at all.
    assert!(o
        .run(&job(45, JobKind::InteriorDesign, Value::Null))
        .await
        .is_err());
}

#[tokio::test]
async fn the_construction_job_reports_the_build() {
    let (w, room) = world();
    let o = orch(fake_writer([])).await;
    o.run(&job(46, JobKind::InteriorDesign, context(&w, room)))
        .await
        .unwrap();
    let out = o
        .run(&job(47, JobKind::Construct, Value::Null))
        .await
        .unwrap();
    let d = completed(&out);
    assert!(d.ok);
    assert_eq!(d.words, 7);
    let ps = posts(&o).await;
    assert!(ps
        .iter()
        .any(|p| p["type"] == "status" && p["payload"]["room_plan"] == "construction"));
    // Nothing to build without a plan.
    let empty = orch(fake_writer([])).await;
    assert!(empty
        .run(&job(48, JobKind::Construct, Value::Null))
        .await
        .is_err());
}

/// The job request of a sim effect, as the browser's codec makes it.
/// `None` for the jobs this test leaves unanswered (standups and the like).
fn request(w: &World, e: &Effect) -> Option<JobRequest> {
    let Effect::RequestJob {
        job_id,
        kind,
        work_item,
        brief_ref,
        staff,
        ..
    } = e;
    let kind = match kind {
        SimJob::InteriorDesign => JobKind::InteriorDesign,
        SimJob::Construct => JobKind::Construct,
        _ => return None,
    };
    let item = work_item.unwrap();
    let ctx = w
        .plan
        .interiors
        .get(&item)
        .map(|b| {
            json!({
                "room_id": b.room.to_string(),
                "room": serde_json::to_value(w.designer_room(b.room).unwrap()).unwrap(),
            })
        })
        .unwrap_or(Value::Null);
    Some(JobRequest {
        company_id: COMPANY.into(),
        job_id: *job_id,
        kind,
        project: "project-1".into(),
        work_item: Some(item.to_string()),
        brief_ref: *brief_ref,
        revision: 0,
        staff: staff
            .iter()
            .map(|s| StaffRef {
                id: s.to_string(),
                persona: sim_core::personas::persona_slug(w.staff[s].persona),
                role: w.staff[s].role.slug().into(),
            })
            .collect(),
        meeting: None,
        context: ctx,
        approved_by: None,
    })
}

/// The outcomes, applied as the browser applies them (artifact shas as hex).
fn apply(w: &mut World, out: &[Outcome]) {
    for o in out {
        let mut v = serde_json::to_value(o).unwrap();
        if let Some(d) = v.get_mut("JobCompleted").and_then(|j| j.get_mut("digest")) {
            let hex = d["artifact_sha"].as_str().unwrap_or("").to_string();
            let mut sha = [0u8; 16];
            for (i, b) in sha.iter_mut().enumerate() {
                *b = hex
                    .get(i * 2..i * 2 + 2)
                    .and_then(|h| u8::from_str_radix(h, 16).ok())
                    .unwrap_or(0);
            }
            d["artifact_sha"] = json!(sha);
        }
        let cmd: ServerCommand = serde_json::from_value(v).unwrap();
        w.apply_server(cmd).unwrap();
    }
}

/// Steps the sim, running every job it asks for, until `done`.
async fn play(
    w: &mut World,
    o: &Orchestrator<MemStore, FakeGateway>,
    done: impl Fn(&World) -> bool,
) {
    for _ in 0..40_000 {
        for e in w.drain_effects() {
            if let Some(req) = request(w, &e) {
                let out = o.run(&req).await.unwrap();
                apply(w, &out);
            }
        }
        if done(w) {
            return;
        }
        w.step();
    }
    panic!("never done");
}

async fn commission_and_build() -> (World, Vec<u64>) {
    let (w, room) = world();
    build_room(w, room, 3, 0).await
}

/// Commissions the room, lets the fake design it, answers Build and plays
/// the construction to the end: `desks` desks (each with a monitor) and a
/// plant go up, the room's `objects` stay, and no escalation is ever raised.
async fn build_room(mut w: World, room: RoomId, desks: usize, objects: usize) -> (World, Vec<u64>) {
    let o = orch(fake_writer([])).await;
    w.apply(Command::CommissionInterior {
        room,
        brief_ref: BRIEF,
    })
    .unwrap();
    let item = *w.plan.interiors.keys().next().unwrap();
    // The designer drafts; an economic company asks the CEO before anything is built.
    play(&mut w, &o, |w| {
        w.tickets
            .values()
            .any(|t| t.is_open() && t.kind == TicketKind::BuildApproval)
    })
    .await;
    let t = w
        .tickets
        .values()
        .find(|t| t.is_open() && t.kind == TicketKind::BuildApproval)
        .unwrap();
    assert_eq!(t.work_item, Some(item));
    let price = i64::try_from(desks).unwrap() * (40_000 + 30_000) + 5_000;
    assert_eq!(t.amount_cents, price);
    let ticket = t.id;
    let in_room = |w: &World| {
        w.building
            .equipment
            .values()
            .filter(|e| {
                e.room == room && e.kind != sim_core::equipment::EquipmentKind::CeilingLight
            })
            .count()
    };
    assert_eq!(in_room(&w), 0);
    let cash = w.company.cash;
    w.apply(Command::AnswerTicket {
        ticket,
        option: TicketOption::Build,
    })
    .unwrap();
    let mut seen = Vec::new();
    play(&mut w, &o, |w| {
        w.plan.items[&item].status == WorkItemStatus::Published
    })
    .await;
    seen.push(w.hash());
    assert_eq!(in_room(&w), 2 * desks + 1);
    assert_eq!(cash - w.company.cash, price);
    assert_eq!(
        w.building
            .objects
            .values()
            .filter(|o| o.room == room)
            .count(),
        objects
    );
    assert!(
        !w.tickets.values().any(|t| t.kind == TicketKind::Escalation),
        "the build never stopped"
    );
    assert_eq!(w.plan.interiors.get(&item).and_then(|b| b.refused), None);
    (w, seen)
}

/// A player's desk (1.5 × 0.75 m) whose seat is 750 mm south of its centre
/// at turn 0 (ADR-0088): a workstation.
fn my_desk() -> ObjectSummary {
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

/// The newsroom with the CEO's own desk placed at `pos` turned `rot`.
fn world_with_my_desk_at(pos: PosMm, rot: u8) -> (World, RoomId) {
    let (mut w, room) = world();
    w.apply(Command::PlaceObject {
        design: "d5".repeat(32),
        pos,
        rot,
        summary: my_desk(),
    })
    .unwrap();
    assert_eq!(w.designer_room(room).unwrap().objects.len(), 1);
    (w, room)
}

/// The CEO's own desk against the newsroom's west wall, facing east.
fn world_with_my_desk() -> (World, RoomId) {
    world_with_my_desk_at(PosMm::new(26_500, 11_000), 3)
}

/// The designer sees the CEO's own desk (ADR-0088): the room doc names it,
/// it counts as one of the three workstations, and a row of desks the fake
/// puts on it (by the window, where the CEO's desk stands) is named to the
/// model as a collision with it and never reaches the sim: the fake's fixes
/// (the next wall each round) find no place, so the plan fails loudly.
#[tokio::test]
async fn the_ceos_own_desk_is_counted_and_kept_clear() {
    let (w, room) = world_with_my_desk_at(PosMm::new(31_000, 11_000), 1);
    let llm = Arc::new(fake_writer([]));
    let o = orch(llm.clone()).await;
    let out = o
        .run(&job(52, JobKind::InteriorDesign, context(&w, room)))
        .await
        .unwrap();
    assert_eq!(failed(&out), JobFailure::InvalidOutput, "{out:?}");
    assert!(!out
        .iter()
        .any(|o| matches!(o, Outcome::InteriorPlan { .. })));
    let calls = llm.calls();
    let layout = &calls[0].request.messages.last().unwrap().text;
    assert!(
        layout.contains("- equipment:object-1: the CEO's own design, 0.75 m (west to east) × 1.5 m (north to south), at 5 m from the west wall, 3 m from the north wall; a workstation, its seat at 4.25 m from the west wall, 3 m from the north wall"),
        "{layout}"
    );
    let fix = &calls[1].request.messages.last().unwrap().text;
    // two desks for three workstations: the CEO's desk is one
    assert!(
        fix.contains(r#"{"design":"desk","anchor":"window:0","count":2,"spacing":4}"#),
        "{fix}"
    );
    assert!(
        fix.contains("[collision] placement 0, desk 1 of 2: it overlaps equipment:object-1 (the CEO's own design)"),
        "{fix}"
    );
}

/// A lamp planned for a desk whose lamp slot holds the CEO's own desk-top
/// design is refused by the checker, never handed to the sim to stop the
/// build: the plan fails loudly when the model does not move it.
#[tokio::test]
async fn a_lamp_on_a_slot_the_ceos_design_holds_is_refused() {
    let (mut w, room) = world();
    w.apply(Command::PlaceEquipment {
        kind: sim_core::equipment::EquipmentKind::Desk,
        placement: sim_core::commands::Placement::Floor {
            pos: PosMm::new(30_000, 11_000),
            rot: 0,
        },
    })
    .unwrap();
    let desk = *w.building.equipment.keys().last().unwrap();
    w.apply(Command::PlaceObjectOnDesk {
        design: "70".repeat(32),
        desk,
        summary: ObjectSummary {
            footprint: [4, 4],
            mount: Mount::Surface,
            workstation: false,
            seat_at: None,
            seats: 0,
            lights: 0,
            screens: 0,
            ..my_desk()
        },
    })
    .unwrap();
    let plan = json!({"placements": [
        {"design": "desk-lamp", "anchor": format!("equipment:{desk}")},
        {"design": "plant", "anchor": "wall:south", "from": "wall:west"}
    ]});
    let mut script = vec![FakeReply::Json(plan)];
    for _ in 0..3 {
        script.push(FakeReply::Json(json!({"replace": []})));
    }
    let o = orch(fake_writer(script)).await;
    let out = o
        .run(&job(53, JobKind::InteriorDesign, context(&w, room)))
        .await
        .unwrap();
    assert_eq!(failed(&out), JobFailure::InvalidOutput, "{out:?}");
    let ps = posts(&o).await;
    let s = ps.iter().find(|p| p["type"] == "status").unwrap();
    assert!(
        s["text"].as_str().unwrap().contains("[slot-taken]")
            && s["text"].as_str().unwrap().contains("the CEO's own design"),
        "{s}"
    );
}

/// Commission, draft, approve and build a room the CEO already put a desk
/// of their own in: two desks for three workstations, nothing built over
/// the CEO's desk or its seat, no escalation; the same world twice.
#[tokio::test]
async fn a_room_with_the_ceos_own_desk_is_built_end_to_end() {
    let (w, room) = world_with_my_desk();
    let (a, ha) = build_room(w, room, 2, 1).await;
    let (w, room) = world_with_my_desk();
    let (b, hb) = build_room(w, room, 2, 1).await;
    assert_eq!(ha, hb);
    assert_eq!(a.hash(), b.hash());
}

#[tokio::test]
async fn commission_draft_approve_and_build_end_to_end() {
    let (a, ha) = commission_and_build().await;
    let (b, hb) = commission_and_build().await;
    assert_eq!(ha, hb);
    assert_eq!(a.hash(), b.hash());
    assert_eq!(a.step, b.step);
}

/// The fake plans the demo office's meeting room for the brief the Build
/// panel sends: eight seats (the table's), a writing surface (the room has
/// one) and a plant.
#[tokio::test]
async fn the_fake_plans_the_meeting_room() {
    let (w, _) = world();
    let room = w
        .building
        .rooms
        .values()
        .find(|r| r.kind == RoomKind::MeetingRoom)
        .unwrap()
        .id;
    let o = Orchestrator::new(
        MemStore::new(),
        FakeGateway::new(),
        Arc::new(fake_writer([])),
        site(),
    );
    let brief = json!({"workstations": 0, "meeting_seats": 8, "storage": 0, "writing_surfaces": 1,
                       "coffee": 0, "plants": 1, "max_cost_cents": 500_000});
    o.store()
        .put_brief(
            COMPANY,
            BRIEF,
            interior_brief("A plant for the meeting room.", &brief),
        )
        .await
        .unwrap();
    let out = o
        .run(&job(50, JobKind::InteriorDesign, context(&w, room)))
        .await
        .unwrap();
    assert!(completed(&out).ok, "{out:?}");
    let art = o
        .store()
        .get_artifact(COMPANY, ITEM)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(art["room_plan"]["items"].as_array().unwrap().len(), 1);
    assert_eq!(art["room_plan"]["items"][0]["design"], "plant");
}

/// A room that already has what the brief asks for: a plan that places
/// nothing is not a room plan (the sim refuses an empty `InteriorPlan`). The
/// job fails with the reason in the thread instead of completing with
/// nothing to build (found by the Luna eval driver's dry run on the scripted
/// model, 2026-10-12: a room asked for again after it was built).
#[tokio::test]
async fn a_plan_that_places_nothing_fails_with_the_reason() {
    let (w, _) = world();
    let room = w
        .building
        .rooms
        .values()
        .find(|r| r.kind == RoomKind::MeetingRoom)
        .unwrap()
        .id;
    let o = Orchestrator::new(
        MemStore::new(),
        FakeGateway::new(),
        Arc::new(fake_writer([FakeReply::Json(json!({"placements": []}))])),
        site(),
    );
    // The meeting room's table seats eight and a whiteboard stands in it.
    let brief = json!({"meeting_seats": 8, "writing_surfaces": 1});
    o.store()
        .put_brief(
            COMPANY,
            BRIEF,
            interior_brief("A whiteboard for the meeting room.", &brief),
        )
        .await
        .unwrap();
    let out = o
        .run(&job(51, JobKind::InteriorDesign, context(&w, room)))
        .await
        .unwrap();
    assert_eq!(failed(&out), JobFailure::InvalidOutput, "{out:?}");
    let ps = posts(&o).await;
    let s = ps.iter().find(|p| p["type"] == "status").unwrap();
    assert_eq!(s["payload"]["room_plan"], "failed");
    assert!(
        s["text"].as_str().unwrap().contains("nothing to build"),
        "{s}"
    );
    assert!(o
        .store()
        .get_artifact(COMPANY, ITEM)
        .await
        .unwrap()
        .is_none_or(|a| a["room_plan"].is_null()));
}
