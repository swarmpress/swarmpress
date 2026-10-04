//! Timeout, cancel and a lost model in the staged jobs (P6, ADR-0058;
//! `docs/design/mvp-pipeline.md` §7), and the heroes of open articles (§3).
//!
//! The browser bridge aborts a model call that runs past its wall-clock limit
//! and answers `LlmError::Timeout`; here the fake model answers that for a
//! "hung" stage. A stage that times out is made once more, then the job fails
//! with `JobFailed{Timeout}`; applied to the real sim, the item blocks with an
//! escalation ticket whose default is `Retry`, and the retried phase (a new
//! job id) adopts the stages that were completed. A cancel stops a job between
//! stages; a lost model is not a job failure.

use std::collections::BTreeSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use agents::fake_writer;
use agents::pipeline::Brief;
use agents::{FakeLlm, FakeReply, LlmError, LlmRequest};
use orchestrator::{
    BriefRecord, CancelToken, FakeGateway, JobFailure, JobKind, JobRequest, MemStore, Orchestrator,
    OrchestratorError, Outcome, Store,
};
use serde_json::Value;
use sim_core::clock::SimConfig;
use sim_core::commands::{Command, JobDigest, ServerCommand};
use sim_core::ids::StaffId;
use sim_core::inbox::{TicketKind, TicketOption};
use sim_core::plan::{BriefStub, Effect, WorkItemKind, WorkItemStatus};
use sim_core::scenarios::demo_office_with_config;
use sim_core::World;

mod common;
use common::{site, team, COMPANY};

const BRIEF_REF: u64 = 77;
const ITEM: &str = "work-item-1";
const STUCK: &str = "section s2 of 3";

fn brief(n: u64) -> Brief {
    let (title, slug) = if n == BRIEF_REF {
        ("Harvest week in Manarola", "harvest-week-in-manarola")
    } else {
        (
            "Evening light on the Manarola harbour",
            "evening-light-on-the-manarola-harbour",
        )
    };
    Brief {
        content_id: format!("content-{n:x}"),
        title: title.into(),
        slug: slug.into(),
        angle: "A day on the terraces of Manarola, and how to watch without getting in the way."
            .into(),
        keywords: vec!["Manarola".into(), "terraces".into(), "harbour".into()],
        target_words: 600,
        language: "en".into(),
        notes: String::new(),
    }
}

async fn put_brief(store: &dyn Store, brief_ref: u64) {
    let rec = BriefRecord {
        job_id: 1,
        brief: brief(brief_ref),
        writer: "staff-1".into(),
        editor: "staff-5".into(),
        minutes: vec![],
        work_item: None,
        staff: team(),
    };
    store
        .put_brief(COMPANY, brief_ref, serde_json::to_value(rec).unwrap())
        .await
        .unwrap();
}

fn draft_job(job_id: u64, item: &str, brief_ref: u64) -> JobRequest {
    JobRequest {
        company_id: COMPANY.into(),
        job_id,
        kind: JobKind::Draft,
        project: "project-1".into(),
        work_item: Some(item.into()),
        brief_ref: Some(brief_ref),
        revision: 0,
        staff: team().into_iter().filter(|s| s.role == "writer").collect(),
        meeting: None,
        context: serde_json::Value::Null,
        approved_by: None,
    }
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

fn count(llm: &FakeLlm, t: &str) -> usize {
    tasks(llm).iter().filter(|x| *x == t).count()
}

/// The fake writer; while `down` is set, the `STUCK` stage answers `error()`
/// (what the browser bridge answers for a hung call, or a lost model).
fn writer(down: Arc<AtomicBool>, error: fn() -> LlmError) -> Arc<FakeLlm> {
    Arc::new(FakeLlm::with_responder(
        [],
        move |req: &LlmRequest, schema| {
            if down.load(Ordering::SeqCst) && task_of(req) == STUCK {
                return FakeReply::Error(error());
            }
            fake_writer::answer(req, schema)
        },
    ))
}

fn hung() -> LlmError {
    LlmError::Timeout("the model call ran past its limit of 20 min".into())
}

async fn post_types(store: &dyn Store, item: &str) -> Vec<String> {
    let plan = store.plan_json(COMPANY).await.unwrap();
    plan["posts"][item]
        .as_array()
        .map(|a| {
            a.iter()
                .map(|p| p["type"].as_str().unwrap().to_string())
                .collect()
        })
        .unwrap_or_default()
}

fn completed_ok(out: &[Outcome]) -> bool {
    matches!(out, [Outcome::JobCompleted { digest, .. }] if digest.ok)
}

// ---------------------------------------------------------------- the sim's side

/// One game day = 600 steps.
fn world() -> World {
    demo_office_with_config(
        14,
        SimConfig {
            day_real_minutes: 1,
            ..SimConfig::default()
        },
    )
}

/// The drained job requests: (job id, kind, work item).
fn drain(w: &mut World) -> Vec<(u64, sim_core::plan::JobKind, Option<String>)> {
    w.drain_effects()
        .into_iter()
        .map(|e| match e {
            Effect::RequestJob {
                job_id,
                kind,
                work_item,
                ..
            } => (job_id, kind, work_item.map(|w| w.to_string())),
        })
        .collect()
}

/// The orchestrator's outcome as the sim's command (the browser's `outcomesForSim`).
fn to_sim(o: &Outcome) -> ServerCommand {
    serde_json::from_value(serde_json::to_value(o).unwrap()).unwrap()
}

#[tokio::test]
async fn a_hung_model_times_out_the_item_blocks_and_retry_adopts_the_completed_stages() {
    // The sim: the 09:00 standup agrees one brief (Giulia writes, Marco edits).
    let mut w = world();
    let standup = loop {
        w.step();
        if let Some(r) = drain(&mut w).into_iter().next() {
            break r;
        }
        assert!(w.step < 1000, "no standup");
    };
    w.apply_server(ServerCommand::MeetingOutcome {
        job_id: standup.0,
        briefs: vec![BriefStub {
            kind: WorkItemKind::Article,
            writer: StaffId(1),
            editor: StaffId(5),
            brief_ref: BRIEF_REF,
        }],
    })
    .unwrap();
    let [(draft, sim_core::plan::JobKind::Draft, Some(item))] = &drain(&mut w)[..] else {
        panic!("a draft job")
    };
    let item = item.clone();

    // The orchestrator: the model hangs on section 2 (the bridge times the call out).
    let store = Arc::new(MemStore::new());
    put_brief(store.as_ref(), BRIEF_REF).await;
    let down = Arc::new(AtomicBool::new(true));
    let llm = writer(down.clone(), hung);
    let gw = Arc::new(FakeGateway::new());
    let o = Orchestrator::new(store.clone(), gw.clone(), llm.clone(), site());
    let out = o.run(&draft_job(*draft, &item, BRIEF_REF)).await.unwrap();
    assert_eq!(
        out,
        [Outcome::JobFailed {
            job_id: *draft,
            reason: JobFailure::Timeout
        }]
    );
    assert_eq!(
        count(&llm, STUCK),
        2,
        "the stage is made once more, then given up"
    );
    assert_eq!(count(&llm, "section s3 of 3"), 0);
    assert!(
        gw.branch_head("drafts/content-content-4d").is_none(),
        "no PR"
    );
    assert_eq!(
        post_types(store.as_ref(), &item).await,
        ["minutes", "status"]
    );

    // The sim blocks the item with the escalation ticket; its first default is Retry.
    w.apply_server(to_sim(&out[0])).unwrap();
    let blocked = w
        .plan
        .items
        .values()
        .find(|i| i.id.to_string() == item)
        .unwrap();
    assert_eq!(blocked.status, WorkItemStatus::Blocked);
    let tickets: Vec<_> = w
        .tickets
        .values()
        .filter(|t| t.is_open() && t.kind == TicketKind::Escalation)
        .cloned()
        .collect();
    assert_eq!(tickets.len(), 1, "{tickets:?}");
    let ticket = &tickets[0];
    assert_eq!(
        ticket.failure,
        Some(sim_core::commands::JobFailure::Timeout)
    );
    assert_eq!(ticket.default_option, TicketOption::Retry);
    assert_eq!(ticket.work_item.map(|i| i.to_string()), Some(item.clone()));

    // The CEO answers Retry: the sim asks for the draft again, under a new job id.
    w.apply(Command::AnswerTicket {
        ticket: ticket.id,
        option: TicketOption::Retry,
    })
    .unwrap();
    let retry = drain(&mut w);
    let [(again, sim_core::plan::JobKind::Draft, Some(same))] = &retry[..] else {
        panic!("{retry:?}")
    };
    assert_ne!(again, draft);
    assert_eq!(same, &item);

    // The model is back: only the stages that never finished call it.
    down.store(false, Ordering::SeqCst);
    let before = llm.calls().len();
    let out = o.run(&draft_job(*again, &item, BRIEF_REF)).await.unwrap();
    assert!(completed_ok(&out), "{out:?}");
    assert_eq!(
        tasks(&llm)[before..],
        ["section s2 of 3", "section s3 of 3", "closing"]
    );
    assert_eq!(
        post_types(store.as_ref(), &item).await,
        ["minutes", "status", "artifact", "handoff"],
        "one post of each kind"
    );
    assert_eq!(gw.pr(1).map(|p| p.number), Some(1));
    assert!(gw.pr(2).is_none(), "one pull request");
    w.apply_server(ServerCommand::JobCompleted {
        job_id: *again,
        digest: JobDigest {
            ok: true,
            score: 0,
            words: 600,
            qa_defects: 0,
            artifact_sha: [0xab; 16],
        },
    })
    .unwrap();
}

#[tokio::test]
async fn a_stage_that_timed_out_once_is_made_again_and_the_job_completes() {
    let store = Arc::new(MemStore::new());
    put_brief(store.as_ref(), BRIEF_REF).await;
    let once = Mutex::new(true);
    let llm = Arc::new(FakeLlm::with_responder(
        [],
        move |req: &LlmRequest, schema| {
            if task_of(req) == STUCK && std::mem::take(&mut *once.lock().unwrap()) {
                return FakeReply::Error(hung());
            }
            fake_writer::answer(req, schema)
        },
    ));
    let o = Orchestrator::new(
        store.clone(),
        Arc::new(FakeGateway::new()),
        llm.clone(),
        site(),
    );
    let out = o.run(&draft_job(2, ITEM, BRIEF_REF)).await.unwrap();
    assert!(completed_ok(&out), "{out:?}");
    assert_eq!(count(&llm, STUCK), 2);
    assert_eq!(count(&llm, "closing"), 1);
}

#[tokio::test]
async fn a_cancel_between_stages_stops_the_job_before_its_next_call_and_its_commit() {
    for (reason, post) in [
        (JobFailure::Timeout, "ran past its time limit"),
        (JobFailure::Cancelled, "was cancelled"),
    ] {
        let store = Arc::new(MemStore::new());
        put_brief(store.as_ref(), BRIEF_REF).await;
        // The host cancels while section 1 is being written (its call still answers).
        let token: Arc<Mutex<Option<CancelToken>>> = Arc::default();
        let slot = token.clone();
        let llm = Arc::new(FakeLlm::with_responder(
            [],
            move |req: &LlmRequest, schema| {
                if task_of(req) == "section s1 of 3" {
                    slot.lock().unwrap().as_ref().unwrap().cancel(2, reason);
                }
                fake_writer::answer(req, schema)
            },
        ));
        let gw = Arc::new(FakeGateway::new());
        let o = Orchestrator::new(store.clone(), gw.clone(), llm.clone(), site());
        *token.lock().unwrap() = Some(o.cancel_token());
        let out = o.run(&draft_job(2, ITEM, BRIEF_REF)).await.unwrap();
        assert_eq!(out, [Outcome::JobFailed { job_id: 2, reason }]);
        assert_eq!(
            tasks(&llm),
            ["outline", "intro", "section s1 of 3"],
            "no call after the cancel"
        );
        assert!(gw.pr(1).is_none(), "no commit");
        let plan = store.plan_json(COMPANY).await.unwrap();
        let last = plan["posts"][ITEM]
            .as_array()
            .unwrap()
            .last()
            .unwrap()
            .clone();
        assert!(last["text"].as_str().unwrap().contains(post), "{last}");
        // Section 1 finished before the cancel took effect: it is stored.
        assert!(store.stages(COMPANY).contains(&(2, "section".into(), 1)));
        // A cancel is for that run: the job runs again (a reload) without it.
        let out = o.run(&draft_job(2, ITEM, BRIEF_REF)).await.unwrap();
        assert!(completed_ok(&out), "{out:?}");
        assert_eq!(
            count(&llm, "section s1 of 3"),
            1,
            "resumed from the stored stage"
        );
        // A cancel of another job does not reach this one.
        o.cancel(99, JobFailure::Cancelled);
        assert!(completed_ok(
            &o.run(&draft_job(2, ITEM, BRIEF_REF)).await.unwrap()
        ));
    }
}

#[tokio::test]
async fn a_lost_model_is_not_a_job_failure_the_run_errs_and_resumes() {
    let store = Arc::new(MemStore::new());
    put_brief(store.as_ref(), BRIEF_REF).await;
    let down = Arc::new(AtomicBool::new(true));
    let llm = writer(down.clone(), || {
        LlmError::Unavailable("the model was lost 3 times during one call".into())
    });
    let o = Orchestrator::new(
        store.clone(),
        Arc::new(FakeGateway::new()),
        llm.clone(),
        site(),
    );
    let err = o.run(&draft_job(2, ITEM, BRIEF_REF)).await.unwrap_err();
    assert!(matches!(err, OrchestratorError::Unavailable(_)), "{err}");
    assert!(err.to_string().starts_with("model unavailable"));
    assert_eq!(count(&llm, STUCK), 1, "not retried as a timeout");
    assert_eq!(
        post_types(store.as_ref(), ITEM).await,
        ["minutes"],
        "no failure post"
    );

    // The model is back: the same job resumes from its stored stages.
    down.store(false, Ordering::SeqCst);
    let before = llm.calls().len();
    let out = o.run(&draft_job(2, ITEM, BRIEF_REF)).await.unwrap();
    assert!(completed_ok(&out), "{out:?}");
    assert_eq!(
        tasks(&llm)[before..],
        ["section s2 of 3", "section s3 of 3", "closing"]
    );
}

// ---------------------------------------------------------------- heroes in flight

#[tokio::test]
async fn two_open_drafts_get_different_heroes() {
    let store = Arc::new(MemStore::new());
    put_brief(store.as_ref(), BRIEF_REF).await;
    put_brief(store.as_ref(), BRIEF_REF + 1).await;
    let llm = Arc::new(fake_writer::fake_writer([]));
    let o = Orchestrator::new(store.clone(), Arc::new(FakeGateway::new()), llm, site());
    let hero = |art: &Value| {
        art["parts"]["hero"]["media_id"]
            .as_str()
            .unwrap()
            .to_string()
    };
    let shortlist = |art: &Value| -> BTreeSet<String> {
        art["parts"]["context"]["heroes"]
            .as_array()
            .unwrap()
            .iter()
            .map(|h| h["media_id"].as_str().unwrap().to_string())
            .collect()
    };

    assert!(completed_ok(
        &o.run(&draft_job(2, "work-item-1", BRIEF_REF))
            .await
            .unwrap()
    ));
    let first = store
        .get_artifact(COMPANY, "work-item-1")
        .await
        .unwrap()
        .unwrap();
    // The second article is about the same village; the first is open, not merged.
    assert!(completed_ok(
        &o.run(&draft_job(3, "work-item-2", BRIEF_REF + 1))
            .await
            .unwrap()
    ));
    let second = store
        .get_artifact(COMPANY, "work-item-2")
        .await
        .unwrap()
        .unwrap();
    assert_ne!(hero(&first), hero(&second));
    assert!(
        !shortlist(&second).contains(&hero(&first)),
        "the open article's hero is not offered again"
    );
}
