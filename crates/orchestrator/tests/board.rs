//! The weekly editorial board (ADR-0069, FEAT-087): the frame and its cap,
//! the plan with its closed calendar topics and dedupe, the web checks, the
//! records (briefs without a writer, plan text, workstreams, minutes), the
//! outcome's shape, idempotent re-runs, and a board brief's first draft.
//! MemStore + FakeLlm over the `cinqueterre-mini` pack.

use std::sync::Arc;

use agents::fake_writer::{self, PITCH_TOPICS};
use agents::{FakeLlm, FakeReply, LlmRequest};
use orchestrator::{
    workstream_ref_for, FakeGateway, JobKind, JobRequest, MemStore, Orchestrator, Outcome,
    PlannedOut, StaffRef, Store,
};
use serde_json::{json, Value};

mod common;
use common::{site, team, COMPANY};

fn board_team() -> Vec<StaffRef> {
    let mut t = team();
    t.push(StaffRef {
        id: "staff-9".into(),
        persona: "chiara".into(),
        role: "strategist".into(),
    });
    t.retain(|s| s.role != "writer");
    t
}

fn board(job_id: u64, context: Value) -> JobRequest {
    JobRequest {
        company_id: COMPANY.into(),
        job_id,
        kind: JobKind::Board,
        project: "project-1".into(),
        work_item: None,
        brief_ref: None,
        revision: 0,
        staff: board_team(),
        meeting: Some("meeting-7".into()),
        context,
        approved_by: None,
    }
}

/// An autumn Monday, nothing in flight, room for the whole plan.
fn autumn() -> Value {
    json!({"today": "2026-10-05", "in_flight": [], "planned_room": 10})
}

fn orch(llm: Arc<FakeLlm>) -> Orchestrator<MemStore, FakeGateway> {
    Orchestrator::new(MemStore::new(), FakeGateway::new(), llm, site())
}

fn task_of(req: &LlmRequest) -> String {
    req.messages
        .first()
        .and_then(|m| m.text.lines().next())
        .and_then(|l| l.strip_prefix("## Task: "))
        .unwrap_or("")
        .to_string()
}

fn tasks(llm: &FakeLlm) -> Vec<String> {
    llm.calls().iter().map(|c| task_of(&c.request)).collect()
}

fn outcome(out: &[Outcome]) -> (Vec<u64>, Vec<PlannedOut>) {
    match out {
        [Outcome::BoardOutcome {
            workstreams, items, ..
        }] => (workstreams.clone(), items.clone()),
        other => panic!("{other:?}"),
    }
}

#[tokio::test]
async fn the_board_plans_the_calendar_then_the_guides_with_checks_and_records() {
    let llm = Arc::new(fake_writer::fake_writer(Vec::<FakeReply>::new()));
    let o = orch(llm.clone());
    let out = o.run(&board(19, autumn())).await.unwrap();
    let (workstreams, items) = outcome(&out);
    // cap 5 until throughput is measured: the autumn topic (Portovenere is
    // published), the evergreen one, then the guides that do not repeat them
    assert_eq!(items.len(), 5, "{items:?}");
    let mut expected = vec!["weekly board".to_string()];
    expected.extend(std::iter::repeat_n("pitch check".to_string(), 5));
    expected.push("board schedule".to_string());
    assert_eq!(tasks(&llm), expected);

    // the plan prompt: the board's cap, the date, the season's topics by alias
    let prompt = llm.calls()[0].request.messages[0].text.clone();
    assert!(
        prompt.contains("Proposals this week: at most 5"),
        "{prompt}"
    );
    assert!(prompt.contains("Date: 2026-10-05"), "{prompt}");
    assert!(
        prompt.contains("- T1 «The Grape Harvest in Manarola» (Fall)"),
        "{prompt}"
    );
    assert!(
        !prompt.contains("Day Trip to Portovenere"),
        "published: {prompt}"
    );
    assert!(
        prompt.contains("- T2 «Complete Train Schedule Guide» (Evergreen) [critical]"),
        "{prompt}"
    );
    assert!(!prompt.contains("Commissions today"), "{prompt}");

    // scheduling: two days of lead, editors in turn (one editor here),
    // the second item builds on the first
    let days: Vec<(u8, u8)> = items
        .iter()
        .map(|i| (i.start_offset, i.publish_offset))
        .collect();
    assert_eq!(days, vec![(0, 2), (2, 4), (4, 6), (6, 8), (8, 10)]);
    assert!(items.iter().all(|i| i.editor == "staff-5"));
    assert_eq!(items[1].depends_on, vec![0]);
    assert!(items[2].depends_on.is_empty());
    assert_eq!(items[0].priority, "High", "the calendar's high");
    assert_eq!(items[1].priority, "High", "the calendar's critical");

    // workstreams: the season and the guides, refs stable per name
    assert_eq!(
        workstreams,
        vec![
            workstream_ref_for(COMPANY, "Fall"),
            workstream_ref_for(COMPANY, "Evergreen"),
            workstream_ref_for(COMPANY, "Evergreen guides")
        ]
    );
    assert_eq!(workstream_ref_for(COMPANY, "fall "), workstreams[0]);
    assert_eq!(items[0].workstream, Some(0));
    assert_eq!(items[4].workstream, Some(2));

    // records: a brief without a writer per item, plan text for briefs and workstreams
    let text = o.store().plan_json(COMPANY).await.unwrap();
    for (i, item) in items.iter().enumerate() {
        let rec = o
            .store()
            .get_brief(COMPANY, item.brief_ref)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(rec["writer"], json!(""), "item {i}");
        assert_eq!(rec["editor"], json!("staff-5"));
        let title = rec["brief"]["title"].as_str().unwrap();
        assert_eq!(
            text["items"][format!("brief:{}", item.brief_ref)]["title"],
            json!(title)
        );
    }
    let first = o
        .store()
        .get_brief(COMPANY, items[0].brief_ref)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        first["brief"]["title"],
        json!("The Grape Harvest in Manarola")
    );
    let second = o
        .store()
        .get_brief(COMPANY, items[1].brief_ref)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        second["brief"]["title"],
        json!("Complete Train Schedule Guide")
    );
    // the harvest guide repeats the calendar's harvest: the next guide instead
    let third = o
        .store()
        .get_brief(COMPANY, items[2].brief_ref)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(third["brief"]["title"], json!(PITCH_TOPICS[1].title));
    assert_eq!(
        text["items"][format!("workstream:{}", workstreams[0])]["title"],
        json!("Fall")
    );
    // the strategist speaks, the minutes keep the theme
    let lines = o.store().transcripts(COMPANY);
    let speakers: Vec<&str> = lines
        .iter()
        .map(|l| l["speaker"].as_str().unwrap())
        .collect();
    // the strategist opens, the editor-in-chief schedules, the strategist closes
    assert_eq!(speakers, ["staff-9", "staff-4", "staff-9"]);
    let minutes = &text["posts"]["meeting-7"][0];
    assert_eq!(minutes["type"], json!("minutes"));
    assert!(minutes["text"]
        .as_str()
        .unwrap()
        .starts_with("Theme of the week:"));
}

#[tokio::test]
async fn published_in_flight_and_planned_titles_are_taken() {
    let llm = Arc::new(fake_writer::fake_writer(Vec::<FakeReply>::new()));
    let o = orch(llm.clone());
    let ctx = json!({"today": "2026-10-05", "planned_room": 10, "in_flight": [
        {"id": "work-item-4", "status": "planned", "title": "The Grape Harvest in Manarola"},
        {"id": "work-item-5", "status": "in-progress", "title": PITCH_TOPICS[0].title}
    ]});
    let out = o.run(&board(20, ctx)).await.unwrap();
    let (_, items) = outcome(&out);
    let prompt = llm.calls()[0].request.messages[0].text.clone();
    assert!(
        prompt.contains(
            "## Calendar topics (not yet published)\n- T1 «Complete Train Schedule Guide»"
        ),
        "the planned harvest is not offered: {prompt}"
    );
    let mut titles = Vec::new();
    for i in &items {
        let rec = o
            .store()
            .get_brief(COMPANY, i.brief_ref)
            .await
            .unwrap()
            .unwrap();
        titles.push(rec["brief"]["title"].as_str().unwrap().to_string());
    }
    assert!(!titles.contains(&"The Grape Harvest in Manarola".to_string()));
    assert!(!titles.contains(&PITCH_TOPICS[0].title.to_string()));
    assert_eq!(titles[0], "Complete Train Schedule Guide");
    assert_eq!(titles[1], PITCH_TOPICS[1].title);
}

#[tokio::test]
async fn an_unverifiable_proposal_is_set_aside_and_its_dependent_waits_for_nothing() {
    let llm = Arc::new(FakeLlm::with_responder(
        Vec::<FakeReply>::new(),
        |req: &LlmRequest, schema: Option<&Value>| {
            let text = &req.messages[0].text;
            if task_of(req) == "pitch check" && text.contains("Grape Harvest") {
                return FakeReply::Json(json!({"verifiable": false,
                    "note": "No source gives this year's harvest dates.", "claims": []}));
            }
            fake_writer::answer(req, schema)
        },
    ));
    let o = orch(llm.clone());
    let out = o.run(&board(21, autumn())).await.unwrap();
    let (_, items) = outcome(&out);
    assert_eq!(items.len(), 4);
    // the train guide built on the harvest: it no longer waits
    assert!(items[0].depends_on.is_empty());
    let lines = o.store().transcripts(COMPANY);
    assert!(lines.iter().any(|l| l["speaker"] == json!("system")
        && l["text"]
            .as_str()
            .unwrap()
            .contains("«The Grape Harvest in Manarola» is set aside")));
}

#[tokio::test]
async fn a_re_run_repeats_no_call_and_gives_the_same_outcome() {
    let llm = Arc::new(fake_writer::fake_writer(Vec::<FakeReply>::new()));
    let o = orch(llm.clone());
    let first = o.run(&board(22, autumn())).await.unwrap();
    let calls = llm.calls().len();
    // the host says something else the second time: the frame is kept
    let again = o
        .run(&board(
            22,
            json!({"today": "2027-01-10", "planned_room": 1}),
        ))
        .await
        .unwrap();
    assert_eq!(first, again);
    assert_eq!(llm.calls().len(), calls, "no model call on a re-run");
    assert_eq!(o.store().transcripts(COMPANY).len(), 3, "no turn twice");
}

#[tokio::test]
async fn a_full_plan_holds_no_board_and_calls_no_model() {
    let llm = Arc::new(fake_writer::fake_writer(Vec::<FakeReply>::new()));
    let o = orch(llm.clone());
    let out = o
        .run(&board(
            23,
            json!({"today": "2026-10-05", "planned_room": 0}),
        ))
        .await
        .unwrap();
    let (workstreams, items) = outcome(&out);
    assert!(items.is_empty() && workstreams.is_empty());
    assert!(llm.calls().is_empty());
    let lines = o.store().transcripts(COMPANY);
    assert!(lines[0]["text"]
        .as_str()
        .unwrap()
        .starts_with("Nothing is planned this week."));
}

#[tokio::test]
async fn a_board_briefs_first_draft_is_written_by_the_writer_the_sim_staffed() {
    let llm = Arc::new(fake_writer::fake_writer(Vec::<FakeReply>::new()));
    let o = orch(llm.clone());
    let out = o.run(&board(24, autumn())).await.unwrap();
    let (_, items) = outcome(&out);
    let isabella = team().into_iter().find(|s| s.id == "staff-2").unwrap();
    let draft = JobRequest {
        company_id: COMPANY.into(),
        job_id: 25,
        kind: JobKind::Draft,
        project: "project-1".into(),
        work_item: Some("work-item-8".into()),
        brief_ref: Some(items[0].brief_ref),
        revision: 0,
        staff: vec![isabella],
        meeting: None,
        context: Value::Null,
        approved_by: None,
    };
    let out = o.run(&draft).await.unwrap();
    match out.as_slice() {
        [Outcome::JobCompleted { digest, .. }] => assert!(digest.ok, "{out:?}"),
        other => panic!("{other:?}"),
    }
    let art = o
        .store()
        .get_artifact(COMPANY, "work-item-8")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(art["writer"]["id"], json!("staff-2"));
    // the item now has its title as plan text
    let text = o.store().plan_json(COMPANY).await.unwrap();
    assert_eq!(
        text["items"]["work-item-8"]["title"],
        json!("The Grape Harvest in Manarola")
    );
    // the review, staffed with the editor only, still knows the writer
    let marco = team().into_iter().find(|s| s.id == "staff-5").unwrap();
    let review = JobRequest {
        job_id: 26,
        kind: JobKind::Review,
        staff: vec![marco],
        ..draft
    };
    let out = o.run(&review).await.unwrap();
    assert!(
        matches!(out.as_slice(), [Outcome::JobCompleted { .. }]),
        "{out:?}"
    );
}

#[tokio::test]
async fn the_next_season_is_offered_within_its_lead_time() {
    let llm = Arc::new(fake_writer::fake_writer(Vec::<FakeReply>::new()));
    let o = orch(llm.clone());
    // 10 November: autumn still, winter's window opens in 21 days (lead: 4 weeks)
    let ctx = json!({"today": "2026-11-10", "in_flight": [], "planned_room": 10});
    o.run(&board(30, ctx)).await.unwrap();
    let prompt = llm.calls()[0].request.messages[0].text.clone();
    assert!(
        prompt.contains("«The Grape Harvest in Manarola» (Fall)"),
        "{prompt}"
    );
    assert!(
        prompt.contains("«Where Locals Eat in Winter» (Winter, from 12-01)"),
        "{prompt}"
    );
    // 5 October: winter is eight weeks away, not yet
    let llm = Arc::new(fake_writer::fake_writer(Vec::<FakeReply>::new()));
    let o = orch(llm.clone());
    o.run(&board(31, autumn())).await.unwrap();
    let prompt = llm.calls()[0].request.messages[0].text.clone();
    assert!(!prompt.contains("Winter"), "{prompt}");
}

/// A model that answers the board's calls with the fake writer, except the schedule.
fn with_schedule(answer: Value) -> Arc<FakeLlm> {
    Arc::new(FakeLlm::with_responder(
        Vec::<FakeReply>::new(),
        move |req: &LlmRequest, schema: Option<&Value>| {
            if task_of(req) == "board schedule" {
                return FakeReply::Json(answer.clone());
            }
            fake_writer::answer(req, schema)
        },
    ))
}

#[tokio::test]
async fn the_editor_in_chief_schedules_the_plan() {
    let mut team = board_team();
    team.push(StaffRef {
        id: "staff-12".into(),
        persona: "isabella".into(),
        role: "editor".into(),
    });
    let items: Vec<Value> = (1..=5)
        .map(|i| {
            let editor = if i % 2 == 0 { "staff-12" } else { "staff-5" };
            json!({"item": i, "editor": editor, "start_day": i, "publish_day": i + 3})
        })
        .collect();
    let llm = with_schedule(
        json!({"items": items, "say": "Marco takes the odd ones, Isabella the even ones."}),
    );
    let o = orch(llm.clone());
    let out = o
        .run(&JobRequest {
            staff: team,
            ..board(40, autumn())
        })
        .await
        .unwrap();
    let (_, planned) = outcome(&out);
    let got: Vec<(&str, u8, u8)> = planned
        .iter()
        .map(|i| (i.editor.as_str(), i.start_offset, i.publish_offset))
        .collect();
    assert_eq!(
        got,
        vec![
            ("staff-5", 1, 4),
            ("staff-12", 2, 5),
            ("staff-5", 3, 6),
            ("staff-12", 4, 7),
            ("staff-5", 5, 8)
        ]
    );
    // the prompt lists both editors and the strategist's days
    let call = llm
        .calls()
        .into_iter()
        .find(|c| task_of(&c.request) == "board schedule")
        .unwrap();
    let prompt = &call.request.messages[0].text;
    assert!(
        prompt.contains("- staff-5 (") && prompt.contains("- staff-12 ("),
        "{prompt}"
    );
    assert!(prompt.contains("2. «Complete Train Schedule Guide» (high priority, proposed for day 4, builds on item 1)"), "{prompt}");
}

#[tokio::test]
async fn a_schedule_that_breaks_the_rules_falls_back_to_the_editors_in_turn() {
    // an unknown editor, twice (the answer and its repair)
    let items: Vec<Value> = (1..=5)
        .map(|i| json!({"item": i, "editor": "staff-1", "start_day": 0, "publish_day": 2}))
        .collect();
    let llm = with_schedule(json!({"items": items, "say": "Giulia reviews everything."}));
    let o = orch(llm.clone());
    let out = o.run(&board(41, autumn())).await.unwrap();
    let (_, planned) = outcome(&out);
    assert!(planned.iter().all(|i| i.editor == "staff-5"));
    assert_eq!(planned[0].start_offset, 0);
    assert_eq!(planned[0].publish_offset, 2);
    let schedules = llm
        .calls()
        .iter()
        .filter(|c| task_of(&c.request) == "board schedule")
        .count();
    assert_eq!(schedules, 2, "one repair turn");
    let lines = o.store().transcripts(COMPANY);
    assert!(lines.iter().any(|l| l["text"]
        .as_str()
        .unwrap()
        .contains("schedule could not be used")));
}
