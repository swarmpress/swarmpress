//! The web designer's jobs (ADR-0093, FEAT-115): the site's design (the trimmed Claude Design
//! export of cinqueterre.travel's style guide) rendered by the fake designer template by
//! template, checked by `theme-designer`, repaired once (the fake's slip on the front page),
//! kept as the item's artifact and written on `design-v1`; a theme that never passes, a model
//! failure and an unlicensed font fail loudly; the sim runs around the jobs: the design
//! arrives, the theme is drafted, the CEO approves, the branch merges into live, the same
//! world twice. The WordPress engine's gateway writes the data on a branch and merges it.

use std::collections::BTreeMap;
use std::sync::Arc;

use agents::fake_writer::fake_writer;
use agents::{FakeLlm, FakeReply, LlmError};
use orchestrator::wordpress::fake::FakeSiteEngine;
use orchestrator::wordpress::EngineGateway;
use orchestrator::{
    FakeGateway, Gateway, JobFailure, JobKind, JobRequest, MemStore, Orchestrator, Outcome,
    StaffRef, Store,
};
use serde_json::{json, Value};
use sim_core::clock::SimConfig;
use sim_core::commands::{Command, ServerCommand};
use sim_core::inbox::{TicketKind, TicketOption};
use sim_core::plan::{Effect, JobKind as SimJob, WorkItemStatus};
use sim_core::scenarios::{demo_office_with_config, hire_web_designer};
use sim_core::World;
use site_design::{interpret, DesignBundle, DesignSource};

mod common;
use common::{site, COMPANY};

const ITEM: &str = "work-item-9";

fn fixtures() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../site-design/tests/fixtures")
}

/// The design store's answer for a bundle: `{version, manifest, design}`.
fn answer_of(bundle: &DesignBundle, version: u32) -> Value {
    json!({
        "version": version,
        "manifest": bundle.manifest(),
        "design": interpret(bundle),
    })
}

fn dispatch() -> DesignBundle {
    let html =
        std::fs::read(fixtures().join("claude-export/cinqueterre-dispatch-mini.html")).unwrap();
    DesignBundle::from_upload(
        BTreeMap::from([("cinqueterre-dispatch-mini.html".to_string(), html)]),
        DesignSource::Upload,
        0,
    )
    .unwrap()
}

fn coast() -> DesignBundle {
    let root = fixtures().join("coast-journal");
    let mut files = BTreeMap::new();
    for p in [
        "index.html",
        "article.html",
        "stories.html",
        "404.html",
        "styles.css",
        "fonts/coast-serif.woff2",
    ] {
        files.insert(p.to_string(), std::fs::read(root.join(p)).unwrap());
    }
    DesignBundle::new(files, DesignSource::Upload, 0).unwrap()
}

/// cinqueterre.travel as the theme sees it (the host's `context.site`).
fn site_context() -> Value {
    let mut links = Vec::new();
    for lang in ["en", "it"] {
        for (label, path) in [
            ("Riomaggiore", "riomaggiore/"),
            ("Manarola", "manarola/"),
            ("Corniglia", "corniglia/"),
            ("Vernazza", "vernazza/"),
            ("Monterosso", "monterosso/"),
            ("Cinque Terre", "cinque-terre/"),
            ("Things to Do", "things-to-do/"),
            ("Stories", "blog/"),
            ("Our Team", "team/"),
        ] {
            links.push(json!({"lang": lang, "label": label, "url": format!("/{lang}/{path}")}));
        }
    }
    json!({
        "name": "Cinque Terre Dispatch",
        "languages": ["en", "it"],
        "links": links,
        "collections": [
            {"name": "latest-stories", "label": "Latest stories", "source": "latest", "keywords": ["stories", "dispatch"],
             "query": {"postType": "post", "order": "desc", "orderBy": "date"}},
            {"name": "villages", "label": "The five villages", "source": "collection", "keywords": ["villages", "destinations"],
             "query": {"postType": "page", "orderBy": "menu_order", "order": "asc"}}
        ]
    })
}

fn designer() -> StaffRef {
    StaffRef {
        id: "staff-14".into(),
        persona: "serena".into(),
        role: "web-designer".into(),
    }
}

fn job(job_id: u64, kind: JobKind, version: u64) -> JobRequest {
    JobRequest {
        company_id: COMPANY.into(),
        job_id,
        kind,
        project: "project-1".into(),
        work_item: Some(ITEM.into()),
        brief_ref: Some(version),
        revision: 0,
        staff: vec![designer()],
        meeting: None,
        context: json!({"site": site_context()}),
        approved_by: None,
    }
}

fn orch(
    llm: impl Into<Arc<FakeLlm>>,
    design: &DesignBundle,
) -> Orchestrator<MemStore, FakeGateway> {
    let g = FakeGateway::new();
    g.put_design(1, answer_of(design, 1));
    Orchestrator::new(MemStore::new(), g, llm.into(), site())
}

fn digest(out: &[Outcome]) -> &orchestrator::Digest {
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
async fn the_fake_designs_every_template_with_one_repair_round() {
    let llm = Arc::new(fake_writer([]));
    let o = orch(llm.clone(), &dispatch());
    let out = o.run(&job(41, JobKind::SiteTheme, 1)).await.unwrap();
    let d = digest(&out);
    assert!(d.ok);
    // header, footer, front-page, index, single, page, 404, archive
    assert_eq!(d.words, 8);
    assert_eq!(d.qa_defects, 1, "the front page's raw colour, repaired");
    assert_eq!(d.score, 8, "seven of eight right first time");
    // One call per task and one fix, each with the web designer's reasoning budget.
    let calls = llm.calls();
    assert_eq!(calls.len(), 9);
    assert!(calls
        .iter()
        .all(|c| c.request.profile.job == agents::JobKind::WebDesign
            && c.request.reasoning_tokens == Some(agents::design::TEMPLATE_REASONING)));
    let fix = calls
        .iter()
        .find(|c| {
            c.request.messages[0]
                .text
                .starts_with("## Task: web design template fix")
        })
        .unwrap();
    assert!(fix.request.messages[0]
        .text
        .contains("sets the raw colour #0F1E2E"));
    assert!(calls[0].request.system[0].contains("web designer"));

    // The artifact: the theme data, per task; on the branch, not on main.
    let art = o
        .store()
        .get_artifact(COMPANY, ITEM)
        .await
        .unwrap()
        .unwrap();
    let rec: orchestrator::SiteThemeRecord =
        serde_json::from_value(art["site_theme"].clone()).unwrap();
    assert_eq!(rec.kind, "site-theme");
    assert_eq!(rec.design_version, 1);
    assert_eq!(rec.branch, "design-v1");
    assert_eq!(rec.theme.validate_shape(), vec![]);
    let slugs: Vec<&str> = rec
        .theme
        .templates
        .iter()
        .map(|t| t.slug.as_str())
        .collect();
    assert_eq!(
        slugs,
        ["front-page", "index", "single", "page", "404", "archive"]
    );
    let front = rec
        .tasks
        .iter()
        .find(|t| t.task == "template front-page")
        .unwrap();
    assert_eq!(front.rounds, 1);
    assert!(front.repaired[0].starts_with("- [token] template front-page: line "));
    assert!(rec.tasks.iter().filter(|t| t.rounds == 0).count() == 7);
    assert!(rec
        .notes
        .iter()
        .any(|n| n.message.contains("has no page on the site")));
    let on_branch = o
        .gateway()
        .file_text("design-v1", FakeGateway::THEME_DATA_PATH)
        .unwrap();
    let data: site_design::ThemeData = serde_json::from_str(&on_branch).unwrap();
    assert_eq!(data, rec.theme);
    assert!(o
        .gateway()
        .file_text("main", FakeGateway::THEME_DATA_PATH)
        .is_none());
    let pr = o.gateway().pr(rec.pr_number).unwrap();
    assert_eq!((pr.branch.as_str(), pr.merged_sha), ("design-v1", None));
    let att = o.gateway().attribution(&pr.head_sha).unwrap();
    assert_eq!(att.persona.as_deref(), Some("serena"));
    assert_eq!(att.job_kind.as_deref(), Some("site-theme"));
    // The thread: the summary for the CEO.
    let p = posts(&o).await;
    let artifact = p.iter().find(|p| p["type"] == "artifact").unwrap();
    assert!(artifact["text"].as_str().unwrap().contains(
        "6 templates and 2 parts on design-v1; 7 of 8 right first time, 1 issues repaired"
    ));

    // A run again (a reload) asks the model nothing new and writes the same.
    let before = llm.calls().len();
    let again = o.run(&job(41, JobKind::SiteTheme, 1)).await.unwrap();
    assert_eq!(digest(&again), d);
    assert_eq!(llm.calls().len(), before);
}

#[tokio::test]
async fn a_theme_that_never_passes_fails_loudly() {
    // Every answer holds a script.
    let llm = FakeLlm::with_responder([], |_, _| {
        FakeReply::Json(
            json!({"content": "<!-- wp:group -->\n<div><script>x()</script></div>\n<!-- /wp:group -->"}),
        )
    });
    let o = orch(llm, &dispatch());
    let out = o.run(&job(42, JobKind::SiteTheme, 1)).await.unwrap();
    assert_eq!(failed(&out), JobFailure::InvalidOutput);
    let p = posts(&o).await;
    let status = p.iter().find(|p| p["type"] == "status").unwrap();
    let text = status["text"].as_str().unwrap();
    assert!(
        text.starts_with("The theme could not be made: the part header does not pass (still "),
        "{text}"
    );
    assert!(text.contains("a <script> is not allowed"), "{text}");
    assert!(
        o.gateway().branch_head("design-v1").is_none(),
        "nothing written"
    );
}

#[tokio::test]
async fn a_model_failure_fails_the_job() {
    let llm = FakeLlm::new([FakeReply::Error(LlmError::Refusal {
        category: None,
        explanation: Some("no".into()),
    })]);
    let o = orch(llm, &dispatch());
    let out = o.run(&job(43, JobKind::SiteTheme, 1)).await.unwrap();
    assert_eq!(failed(&out), JobFailure::Model);
}

#[tokio::test]
async fn an_unlicensed_font_fails_before_any_model_call() {
    let llm = Arc::new(fake_writer([]));
    let o = orch(llm.clone(), &coast());
    let out = o.run(&job(44, JobKind::SiteTheme, 1)).await.unwrap();
    assert_eq!(failed(&out), JobFailure::InvalidOutput);
    assert!(llm.calls().is_empty());
    let p = posts(&o).await;
    assert!(p[0]["text"]
        .as_str()
        .unwrap()
        .contains("Coast Serif is not among the licensed families"));
}

#[tokio::test]
async fn a_version_the_store_does_not_have_is_an_error() {
    let o = orch(fake_writer([]), &dispatch());
    let err = o.run(&job(45, JobKind::SiteTheme, 7)).await.unwrap_err();
    assert!(err.to_string().contains("no design version 7"), "{err}");
}

// ------------------------------------------------------------------ the sim around the jobs

fn world() -> World {
    let mut w = demo_office_with_config(
        5,
        SimConfig {
            day_real_minutes: 1,
            ..SimConfig::default()
        },
    );
    hire_web_designer(&mut w);
    w.drain_effects();
    w
}

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
        SimJob::SiteTheme => JobKind::SiteTheme,
        SimJob::Publish => JobKind::Publish,
        _ => return None,
    };
    let item = (*work_item)?;
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
        context: json!({"site": site_context()}),
        approved_by: Some("The CEO".into()),
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

async fn play<G: Gateway>(
    w: &mut World,
    o: &Orchestrator<MemStore, G>,
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

fn open_approval(w: &World) -> Option<sim_core::ids::TicketId> {
    w.tickets
        .values()
        .find(|t| t.is_open() && t.kind == TicketKind::ThemeApproval)
        .map(|t| t.id)
}

/// The design arrives, the theme is drafted (one repair round), the CEO answers `answer`, and
/// the item closes; returns the world, the item and the orchestrator.
async fn design_to_decision(
    answer: TicketOption,
) -> (
    World,
    sim_core::ids::WorkItemId,
    Orchestrator<MemStore, FakeGateway>,
) {
    let mut w = world();
    let o = orch(fake_writer([]), &dispatch());
    w.apply_server(ServerCommand::DesignReceived { version: 1 })
        .unwrap();
    let item = w.open_site_theme().unwrap();
    play(&mut w, &o, |w| open_approval(w).is_some()).await;
    let digest = w.plan.items[&item].phases[0].result.unwrap();
    assert!(digest.ok);
    assert_eq!((digest.score, digest.words, digest.qa_defects), (8, 8, 1));
    assert!(o.gateway().branch_head("design-v1").is_some());
    assert_eq!(
        o.gateway().merge_count(),
        0,
        "nothing merged before the CEO's word"
    );
    let ticket = open_approval(&w).unwrap();
    w.apply(Command::AnswerTicket {
        ticket,
        option: answer,
    })
    .unwrap();
    play(&mut w, &o, |w| w.plan.items[&item].status.is_closed()).await;
    (w, item, o)
}

#[tokio::test]
async fn design_draft_approve_merge_end_to_end() {
    let (a, item, o) = design_to_decision(TicketOption::Approve).await;
    assert_eq!(a.plan.items[&item].status, WorkItemStatus::Published);
    assert_eq!(a.plan.designs.live, 1);
    assert_eq!(o.gateway().merge_count(), 1);
    let live = o
        .gateway()
        .file_text("main", FakeGateway::THEME_DATA_PATH)
        .unwrap();
    let data: site_design::ThemeData = serde_json::from_str(&live).unwrap();
    assert_eq!(data.templates.len(), 6);
    let merge = o.gateway().branch_head("main").unwrap();
    assert_eq!(
        o.gateway()
            .attribution(&merge)
            .unwrap()
            .approved_by
            .as_deref(),
        Some("The CEO")
    );
    // The same inputs, the same world.
    let (b, ..) = design_to_decision(TicketOption::Approve).await;
    assert_eq!(a.hash(), b.hash());
}

#[tokio::test]
async fn rejected_the_branch_is_never_merged() {
    let (w, item, o) = design_to_decision(TicketOption::Reject).await;
    assert_eq!(w.plan.items[&item].status, WorkItemStatus::Cancelled);
    assert_eq!(w.plan.designs.live, 0);
    assert_eq!(o.gateway().merge_count(), 0);
    assert!(o
        .gateway()
        .file_text("main", FakeGateway::THEME_DATA_PATH)
        .is_none());
}

#[tokio::test]
async fn on_wordpress_the_theme_goes_on_its_branch_and_merges_into_live() {
    let engine = Arc::new(FakeSiteEngine::new());
    engine.put_design(1, answer_of(&dispatch(), 1));
    let o = Orchestrator::new(
        MemStore::new(),
        EngineGateway::new(engine.clone(), Vec::new()),
        Arc::new(fake_writer([])),
        site(),
    );
    let out = o.run(&job(51, JobKind::SiteTheme, 1)).await.unwrap();
    assert!(digest(&out).ok);
    assert!(engine.theme("design-v1").is_some());
    assert!(engine.theme("live").is_none());
    let crs = engine.change_requests();
    assert_eq!(crs.len(), 1);
    assert_eq!(crs[0].branch, "design-v1");
    assert!(crs[0].title.starts_with("Theme from design v1"));
    let mut publish = job(52, JobKind::Publish, 1);
    publish.approved_by = Some("The CEO".into());
    let out = o.run(&publish).await.unwrap();
    assert!(digest(&out).ok);
    assert_eq!(engine.merge_count(), 1);
    assert_eq!(engine.theme("live"), engine.theme("design-v1"));
}
