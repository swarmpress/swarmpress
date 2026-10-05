//! The standup as a pitch round (ADR-0062, FEAT-033; `docs/design/mvp-pipeline.md`
//! section 2): the cap, the context pack, de-duplication, repair-not-failure,
//! total failure, the stage store and the `turn` events the browser plays as
//! speech bubbles. MemStore + FakeLlm over the `cinqueterre-mini` pack.

use std::sync::{Arc, Mutex};

use agents::article_prompts::LlmProfile;
use agents::fake_writer::{self, PITCH_TOPICS};
use agents::meetings::{standup_cap, trim_to_sentence, DEFAULT_TARGET_WORDS};
use agents::{FakeLlm, FakeReply, LlmError};
use orchestrator::{
    context_pack, FakeGateway, JobFailure, JobKind, JobRequest, MemStore, Orchestrator, Outcome,
    ProgressEvent, StandupContext, Store, CONTEXT_PACK_TOKENS,
};
use serde_json::{json, Value};

mod common;
use common::{site_without_calendar as site, team, COMPANY};

fn standup(job_id: u64, context: Value) -> JobRequest {
    JobRequest {
        company_id: COMPANY.into(),
        job_id,
        kind: JobKind::Standup,
        project: "project-1".into(),
        work_item: None,
        brief_ref: None,
        revision: 0,
        staff: team(),
        meeting: Some("meeting-1".into()),
        context,
        approved_by: None,
    }
}

type Events = Arc<Mutex<Vec<ProgressEvent>>>;

fn orch(llm: Arc<FakeLlm>) -> (Orchestrator<MemStore, FakeGateway>, Events) {
    let events: Events = Arc::default();
    let sink = events.clone();
    let o = Orchestrator::new(MemStore::new(), FakeGateway::new(), llm, site()).with_progress(
        Arc::new(move |e: &ProgressEvent| sink.lock().unwrap().push(e.clone())),
    );
    (o, events)
}

fn task(call: &agents::llm::RecordedCall) -> String {
    call.request
        .messages
        .first()
        .and_then(|m| m.text.lines().next())
        .and_then(|l| l.strip_prefix("## Task: "))
        .unwrap_or("")
        .to_string()
}

fn briefs(out: &[Outcome]) -> Vec<(String, u64)> {
    match out {
        [Outcome::MeetingOutcome { briefs, .. }] => briefs
            .iter()
            .map(|b| (b.writer.clone(), b.brief_ref))
            .collect(),
        other => panic!("{other:?}"),
    }
}

fn turns(events: &Events) -> Vec<(u32, String, u32)> {
    events
        .lock()
        .unwrap()
        .iter()
        .filter(|e| e.stage == "turn")
        .map(|e| {
            assert_eq!(e.detail["meeting"], json!("meeting-1"));
            assert_eq!(e.detail["seq"], json!(e.index));
            (
                e.index,
                e.staff.clone().unwrap(),
                u32::try_from(e.detail["chars"].as_u64().unwrap()).unwrap(),
            )
        })
        .collect()
}

/// Two free writers, room for two, nothing measured: one article a day.
fn day_zero() -> Value {
    json!({"today": "2026-10-03", "wip": {"limit": 3, "open": 0, "room": 3, "awaiting_approval": 0,
           "free_writers": ["staff-1", "staff-2"]}, "in_flight": []})
}

#[tokio::test]
async fn a_pitch_round_costs_two_calls_plus_two_per_free_writer() {
    let llm = Arc::new(fake_writer::fake_writer(Vec::<FakeReply>::new()));
    let (o, events) = orch(llm.clone());
    let out = o.run(&standup(1, day_zero())).await.unwrap();
    let b = briefs(&out);
    assert_eq!(b.len(), 1, "cap 1 until throughput is measured");
    assert_eq!(b[0].0, "staff-1", "the commissioned pitch's writer");
    let tasks: Vec<String> = llm.calls().iter().map(task).collect();
    assert_eq!(
        tasks,
        [
            "standup opening",
            "pitch",
            "pitch",
            "pitch check",
            "pitch check",
            "commission"
        ]
    );
    for call in llm.calls() {
        assert!(LlmProfile::LOCAL.fits(&call.request), "{}", task(&call));
    }
    // The brief is the pitch: Giulia's harvest, at its length.
    let rec = o.store().get_brief(COMPANY, b[0].1).await.unwrap().unwrap();
    assert_eq!(rec["brief"]["title"], json!(PITCH_TOPICS[0].title));
    assert_eq!(rec["brief"]["target_words"], json!(600));
    assert_eq!(rec["writer"], json!("staff-1"));
    assert_eq!(rec["editor"], json!("staff-5"));
    // Isabella pitched the next topic, not the same one.
    let pitch2 = llm.calls()[2].request.messages[0].text.clone();
    assert!(
        pitch2.contains("P1 Giulia Rossi (staff-1): «Harvest week in Manarola»"),
        "{pitch2}"
    );

    // Turns: the opening, two pitches, the closing; each reported after its row.
    let lines = o.store().transcripts(COMPANY);
    let speakers: Vec<&str> = lines
        .iter()
        .map(|l| l["speaker"].as_str().unwrap())
        .collect();
    assert_eq!(speakers, ["staff-4", "staff-1", "staff-2", "staff-4"]);
    assert_eq!(lines[1]["text"], json!(PITCH_TOPICS[0].say));
    assert!(lines[3]["text"]
        .as_str()
        .unwrap()
        .contains("Giulia Rossi takes «Harvest week in Manarola», about 600 words"));
    let t = turns(&events);
    assert_eq!(
        t.iter()
            .map(|(seq, who, _)| (*seq, who.as_str()))
            .collect::<Vec<_>>(),
        [
            (0, "staff-4"),
            (1, "staff-1"),
            (2, "staff-2"),
            (3, "staff-4")
        ]
    );
    assert_eq!(
        t[1].2,
        u32::try_from(PITCH_TOPICS[0].say.chars().count()).unwrap()
    );
    // Three free writers and measured throughput: three pitches, cap 2.
    let mut staff = team();
    staff.push(orchestrator::StaffRef {
        id: "staff-3".into(),
        persona: "elena".into(),
        role: "writer".into(),
    });
    let llm = Arc::new(fake_writer::fake_writer(Vec::<FakeReply>::new()));
    let (o, _) = orch(llm.clone());
    let req = JobRequest {
        staff,
        ..standup(
            2,
            json!({"wip": {"room": 2}, "minutes_per_article": 10.0, "model_minutes_per_day": 45}),
        )
    };
    let out = o.run(&req).await.unwrap();
    assert_eq!(briefs(&out).len(), 2);
    // Opening and commission, then a pitch and its web check per writer (ADR-0068).
    assert_eq!(llm.calls().len(), 2 + 3 + 3);
}

#[tokio::test]
async fn cap_zero_makes_no_model_call() {
    let llm = Arc::new(FakeLlm::new(Vec::<FakeReply>::new()));
    let (o, events) = orch(llm.clone());
    let full = json!({"wip": {"limit": 3, "open": 3, "room": 0, "awaiting_approval": 3,
                      "free_writers": ["staff-1", "staff-2"]}});
    let out = o.run(&standup(1, full)).await.unwrap();
    assert!(briefs(&out).is_empty());
    assert!(llm.calls().is_empty());
    let lines = o.store().transcripts(COMPANY);
    assert_eq!(lines.len(), 1);
    assert_eq!(lines[0]["speaker"], json!("system"));
    assert_eq!(
        lines[0]["text"],
        json!("No pitches today. The desk is full: 3 articles are open, 3 waiting for the CEO.")
    );
    assert!(turns(&events).is_empty(), "a system line is no bubble");
    // No free writer is cap 0 too.
    let llm = Arc::new(FakeLlm::new(Vec::<FakeReply>::new()));
    let (o, _) = orch(llm.clone());
    let busy = json!({"wip": {"room": 2, "free_writers": []}});
    assert!(briefs(&o.run(&standup(2, busy)).await.unwrap()).is_empty());
    assert!(llm.calls().is_empty());
    assert_eq!(standup_cap(2, Some(0), None, 45.0), 0);
    assert_eq!(
        standup_cap(4, None, Some(50.0), 45.0),
        1,
        "at least one a day"
    );
    assert_eq!(standup_cap(9, None, Some(1.0), 45.0), 8);
}

#[tokio::test]
async fn a_truncated_speaker_still_yields_a_brief() {
    let llm = Arc::new(fake_writer::fake_writer([
        // The opening runs out of tokens mid-sentence: cut at its last sentence.
        FakeReply::Error(LlmError::Truncated {
            partial: "Good morning, everyone. We have room for one article, so let us ma".into(),
        }),
        // Giulia's pitch runs out of tokens: retried once, shorter.
        FakeReply::Error(LlmError::Truncated {
            partial: "{\"say\": \"The harvest".into(),
        }),
    ]));
    let (o, _) = orch(llm.clone());
    let out = o.run(&standup(1, day_zero())).await.unwrap();
    assert_eq!(briefs(&out)[0].0, "staff-1");
    let tasks: Vec<String> = llm.calls().iter().map(task).collect();
    assert_eq!(
        tasks,
        [
            "standup opening",
            "pitch",
            "pitch",
            "pitch",
            "pitch check",
            "pitch check",
            "commission"
        ]
    );
    assert!(llm.calls()[2].request.messages[0]
        .text
        .contains("two sentences at most"));
    let lines = o.store().transcripts(COMPANY);
    assert_eq!(lines[0]["text"], json!("Good morning, everyone."));
    assert_eq!(
        trim_to_sentence("No end here"),
        "",
        "nothing complete: nothing kept"
    );
    assert_eq!(trim_to_sentence("«Yes.» Then"), "«Yes.»");
}

#[tokio::test]
async fn a_duplicate_pitch_is_repaired_once_then_dropped() {
    let dup = json!({"say": "Portovenere is a short boat ride away and worth the day.",
                     "title": "Day Trip to Portovenere", "angle": "The day trip by boat, for first-timers",
                     "keywords": ["portovenere", "day trip"]});
    let llm = Arc::new(fake_writer::fake_writer([
        FakeReply::Text("Good morning. One article today.".into()),
        FakeReply::Json(dup.clone()),
        FakeReply::Json(
            json!({"say": "Then the boat, from the other side of the gulf.", "title": "A day trip to Portovenere by boat",
                                "angle": "Portovenere by boat for a day", "keywords": ["portovenere", "trip", "boat"]}),
        ),
    ]));
    let (o, _) = orch(llm.clone());
    let out = o.run(&standup(1, day_zero())).await.unwrap();
    // Giulia's repair repeats the published topic in other words: she is
    // skipped, and Isabella's pitch is commissioned.
    assert_eq!(briefs(&out)[0].0, "staff-2");
    let calls = llm.calls();
    let tasks: Vec<String> = calls.iter().map(task).collect();
    assert_eq!(
        tasks,
        [
            "standup opening",
            "pitch",
            "pitch",
            "pitch",
            "pitch check",
            "commission"
        ]
    );
    // The repair turn names the conflict.
    let repair = &calls[2].request.messages.last().unwrap().text;
    assert!(
        repair.contains("content/pages/blog/day-trip-to-portovenere.json"),
        "{repair}"
    );
    let speakers: Vec<String> = o
        .store()
        .transcripts(COMPANY)
        .iter()
        .map(|l| l["speaker"].as_str().unwrap().to_string())
        .collect();
    assert_eq!(speakers, ["staff-4", "staff-2", "staff-4"]);
    // Isabella did not repeat a topic either: the fake took the next one.
    let rec = o
        .store()
        .get_brief(COMPANY, briefs(&out)[0].1)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(rec["brief"]["title"], json!(PITCH_TOPICS[0].title));
}

#[tokio::test]
async fn a_pitch_that_repeats_an_earlier_pitch_by_its_words_is_a_duplicate() {
    let llm = Arc::new(fake_writer::fake_writer([
        FakeReply::Text("Good morning.".into()),
        FakeReply::Json(
            json!({"say": "Harvest time on the terraces, I want to go.", "title": "Harvest week in Manarola",
                                "angle": "A day with the pickers", "keywords": ["sciacchetrà", "manarola harvest"]}),
        ),
        FakeReply::Json(
            json!({"say": "I want the grape harvest in Manarola too.", "title": "The Manarola grape harvest",
                                "angle": "Picking grapes with the families", "keywords": ["manarola", "harvest"]}),
        ),
    ]));
    let (o, _) = orch(llm.clone());
    o.run(&standup(1, day_zero())).await.unwrap();
    let repair = llm.calls()[3].request.messages.last().unwrap().text.clone();
    assert!(
        repair.contains(
            "covers the same ground as «Harvest week in Manarola» (pitched by Giulia Rossi)"
        ),
        "{repair}"
    );
}

#[tokio::test]
async fn a_failed_commissioning_call_commissions_the_first_pitches() {
    let script = Arc::new(FakeLlm::with_responder([], |req, schema| {
        if req.messages[0].text.starts_with("## Task: commission") {
            FakeReply::Error(LlmError::Backend("the model went away".into()))
        } else {
            fake_writer::answer(req, schema)
        }
    }));
    let (o, _) = orch(script.clone());
    let out = o
        .run(&standup(
            1,
            json!({"wip": {"room": 3}, "minutes_per_article": 5.0}),
        ))
        .await
        .unwrap();
    let b = briefs(&out);
    assert_eq!(
        b.iter().map(|x| x.0.as_str()).collect::<Vec<_>>(),
        ["staff-1", "staff-2"]
    );
    for (_, r) in &b {
        let rec = o.store().get_brief(COMPANY, *r).await.unwrap().unwrap();
        assert_eq!(rec["brief"]["target_words"], json!(DEFAULT_TARGET_WORDS));
    }
    let last = o.store().transcripts(COMPANY).last().unwrap().clone();
    assert!(last["text"]
        .as_str()
        .unwrap()
        .starts_with("Let us go with the first pitches"));
}

#[tokio::test]
async fn no_valid_pitch_fails_the_job() {
    let down = || FakeReply::Error(LlmError::Backend("worker crashed".into()));
    let llm = Arc::new(FakeLlm::new([
        FakeReply::Text("Good morning.".into()),
        down(),
        down(),
    ]));
    let (o, events) = orch(llm.clone());
    let out = o.run(&standup(1, day_zero())).await.unwrap();
    assert_eq!(
        out,
        [Outcome::JobFailed {
            job_id: 1,
            reason: JobFailure::Infrastructure
        }]
    );
    assert_eq!(llm.calls().len(), 3, "no commissioning call");
    let lines = o.store().transcripts(COMPANY);
    assert_eq!(lines.last().unwrap()["speaker"], json!("system"));
    assert_eq!(turns(&events).len(), 1, "the opening still played");

    // Pitches that never pass their checks: InvalidOutput.
    let bad = || FakeReply::Json(json!({"say": "short"}));
    let llm = Arc::new(FakeLlm::new([
        FakeReply::Text("Good morning.".into()),
        bad(),
        bad(),
        bad(),
        bad(),
    ]));
    let (o, _) = orch(llm);
    let out = o.run(&standup(1, day_zero())).await.unwrap();
    assert_eq!(
        out,
        [Outcome::JobFailed {
            job_id: 1,
            reason: JobFailure::InvalidOutput
        }]
    );
}

#[tokio::test]
async fn a_rerun_repeats_no_call_and_replays_no_turn() {
    let llm = Arc::new(fake_writer::fake_writer(Vec::<FakeReply>::new()));
    let (o, events) = orch(llm.clone());
    let first = o.run(&standup(1, day_zero())).await.unwrap();
    let calls = llm.calls().len();
    let lines = o.store().transcripts(COMPANY);
    let played = turns(&events).len();
    // A reload: the same job again, with a host that now says something else.
    let later = json!({"today": "2026-12-24", "wip": {"room": 3, "free_writers": ["staff-2"]}, "minutes_per_article": 1.0});
    let again = o.run(&standup(1, later)).await.unwrap();
    assert_eq!(again, first, "the same briefs");
    assert_eq!(llm.calls().len(), calls, "no model call");
    assert_eq!(o.store().transcripts(COMPANY), lines);
    assert_eq!(turns(&events).len(), played, "no turn played twice");
    let reused: Vec<String> = events
        .lock()
        .unwrap()
        .iter()
        .filter(|e| e.state == orchestrator::ProgressState::Reused)
        .map(|e| format!("{}#{}", e.stage, e.index))
        .collect();
    assert_eq!(
        reused,
        [
            "opening#0",
            "pitch#1",
            "pitch#2",
            "check#1",
            "check#2",
            "commission#0"
        ]
    );
    // The stage rows of the round.
    let stages: Vec<String> = o
        .store()
        .stages(COMPANY)
        .into_iter()
        .map(|(_, s, i)| format!("{s}#{i}"))
        .collect();
    assert_eq!(
        stages,
        [
            "check#1",
            "check#2",
            "commission#0",
            "frame#0",
            "opening#0",
            "pitch#1",
            "pitch#2"
        ]
    );
}

#[tokio::test]
async fn the_context_pack_fits_its_budget() {
    let site = site();
    let ctx: StandupContext = serde_json::from_value(json!({
        "today": "2026-10-03",
        "wip": {"limit": 3, "open": 1, "room": 2, "awaiting_approval": 0},
        "in_flight": [{"id": "work-item-1", "status": "in-review", "title": "Harvest week in Manarola"}]
    }))
    .unwrap();
    let pack = context_pack(&site, &ctx, 1);
    println!(
        "{}\n({} tokens, sections {:?})",
        pack.text, pack.tokens, pack.sections
    );
    assert!(pack.tokens <= CONTEXT_PACK_TOKENS);
    assert_eq!(pack.sections, ["today", "in_flight", "published", "places"]);
    assert!(pack
        .text
        .starts_with("## Today\nCommissions today: at most 1"));
    assert!(pack
        .text
        .contains("- «Harvest week in Manarola» (in-review)"));
    // The newest article first (Jan 20, 2026), at most 12.
    assert!(pack
        .text
        .contains("## Published (newest first)\n- «The Perfect First-Timer Itinerary» (Guides)"));
    let listed = pack.text.lines().filter(|l| l.starts_with("- «")).count();
    assert!(listed <= 1 + 12);
    assert!(pack.text.contains("Least covered: "));
    // Many items in flight: the lowest priority goes first.
    let crowded: StandupContext = serde_json::from_value(json!({
        "in_flight": (0..120).map(|i| json!({"id": format!("work-item-{i}"), "status": "in-progress",
             "title": format!("A long working title for in-flight article number {i}")})).collect::<Vec<_>>()
    }))
    .unwrap();
    let pack = context_pack(&site, &crowded, 1);
    assert_eq!(pack.sections, ["today"]);
    assert_eq!(pack.dropped, ["places", "published", "in_flight"]);
}

/// A fake whose first `unverifiable` pitch checks find nothing (ADR-0068).
fn checking(unverifiable: usize) -> Arc<FakeLlm> {
    let checked = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    Arc::new(FakeLlm::with_responder(
        Vec::<FakeReply>::new(),
        move |req, schema| {
            let first = req.messages.first().map(|m| m.text.as_str()).unwrap_or("");
            if first.starts_with("## Task: pitch check")
                && checked.fetch_add(1, std::sync::atomic::Ordering::SeqCst) < unverifiable
            {
                return FakeReply::Json(json!({"verifiable": false,
                "note": "No source states the route or its walking time.", "claims": []}));
            }
            fake_writer::answer(req, schema)
        },
    ))
}

#[tokio::test]
async fn an_unverifiable_pitch_is_set_aside_before_the_commission() {
    let llm = checking(1);
    let (o, events) = orch(llm.clone());
    let out = o.run(&standup(1, day_zero())).await.unwrap();
    // Giulia's pitch could not be verified: the commission only saw Isabella's.
    assert_eq!(briefs(&out).len(), 1);
    assert_eq!(briefs(&out)[0].0, "staff-2");
    let commission = llm
        .calls()
        .into_iter()
        .find(|c| task(c) == "commission")
        .unwrap();
    let prompt = &commission.request.messages[0].text;
    assert!(prompt.contains("P1"), "{prompt}");
    assert!(
        !prompt.contains("P2"),
        "only the verified pitch is offered: {prompt}"
    );
    let check = events
        .lock()
        .unwrap()
        .iter()
        .find(|e| {
            e.stage == "check" && e.index == 1 && e.state == orchestrator::ProgressState::Done
        })
        .cloned()
        .unwrap();
    assert_eq!(check.detail["verifiable"], json!(false));
}

#[tokio::test]
async fn when_no_pitch_can_be_verified_nothing_is_commissioned() {
    let llm = checking(usize::MAX);
    let (o, _) = orch(llm.clone());
    let out = o.run(&standup(1, day_zero())).await.unwrap();
    assert!(
        matches!(&out[..], [Outcome::MeetingOutcome { briefs, .. }] if briefs.is_empty()),
        "{out:?}"
    );
    assert!(
        llm.calls().iter().all(|c| task(c) != "commission"),
        "no commission call"
    );
}

#[tokio::test]
async fn a_pitch_whose_check_fails_is_kept_unchecked() {
    let llm = Arc::new(FakeLlm::with_responder(
        Vec::<FakeReply>::new(),
        |req, schema| {
            let first = req.messages.first().map(|m| m.text.as_str()).unwrap_or("");
            if first.starts_with("## Task: pitch check") {
                return FakeReply::Error(LlmError::Timeout("the search took too long".into()));
            }
            fake_writer::answer(req, schema)
        },
    ));
    let (o, _) = orch(llm.clone());
    let out = o.run(&standup(1, day_zero())).await.unwrap();
    assert_eq!(
        briefs(&out).len(),
        1,
        "a technical failure does not empty the standup"
    );
}
