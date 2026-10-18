//! The QA stage in the orchestrator (ADR-0094, FEAT-116): a defect on the rendered theme becomes a
//! finding, its class goes to the web designer's repair loop, the repaired theme is written and
//! audited again, the CEO approves and the release merges, the same world twice; a content class
//! nobody on the staff can repair, and an executor that cannot audit, never pass; a blocked release
//! is never merged.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use agents::fake_writer::fake_writer;
use orchestrator::quality::Routed;
use orchestrator::{
    FakeGateway, GatewayError, JobFailure, JobKind, JobRequest, MemStore, Orchestrator, Outcome,
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
use site_quality::facts::{Block, Head, Heading, Image, PageFacts, SiteFacts};
use site_quality::{Route, Standard, Subject};

mod common;
use common::{site, COMPANY};

const ITEM: &str = "work-item-9";
/// The defect the scripted QA stage sees in a template's markup.
const DEFECT: &str =
    "<!-- wp:paragraph --><p>QA defect: a half-empty row</p><!-- /wp:paragraph -->";

fn dispatch() -> DesignBundle {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../site-design/tests/fixtures/claude-export/cinqueterre-dispatch-mini.html");
    DesignBundle::from_upload(
        BTreeMap::from([(
            "cinqueterre-dispatch-mini.html".to_string(),
            std::fs::read(root).unwrap(),
        )]),
        DesignSource::Upload,
        0,
    )
    .unwrap()
}

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

fn page(path: &str, page_type: &str, width: u32) -> PageFacts {
    PageFacts {
        path: path.into(),
        width,
        lang: "en".into(),
        page_type: page_type.into(),
        status: 200,
        head: Head {
            title: format!("{path} | Cinque Terre Dispatch"),
            description: Some(
                "Five villages, walked slowly: stories and guides from the Cinque Terre.".into(),
            ),
            canonical: Some(format!("https://example.travel{path}")),
            ..Head::default()
        },
        headings: vec![Heading {
            level: 1,
            text: path.into(),
            ..Heading::default()
        }],
        scroll_width: width,
        ..PageFacts::default()
    }
}

/// What the scripted QA stage judges: the front page and a story at both widths; the front page
/// has a half-empty row while its template carries [`DEFECT`]; with `missing_alt`, the story's
/// authored picture has no description (a content class, the photo editor's).
fn report(
    branch: &str,
    head: &str,
    theme: Option<&str>,
    missing_alt: bool,
) -> site_quality::QaReport {
    let front = theme
        .and_then(|t| serde_json::from_str::<site_design::ThemeData>(t).ok())
        .and_then(|d| d.templates.into_iter().find(|t| t.slug == "front-page"))
        .map(|t| t.content)
        .unwrap_or_default();
    let defect = front.contains("QA defect");
    let mut pages = Vec::new();
    for w in [1280, 390] {
        let mut front = page("/", "front-page", w);
        if defect && w == 1280 {
            front.blocks.push(Block {
                label: "div.wp-block-group \"Stories\"".into(),
                w: 760,
                container: 1200,
                h: 600,
                beside: false,
                measure: false,
            });
        }
        pages.push(front);
        let mut story = page("/en/a-story/", "single", w);
        story.images.push(Image {
            src: "/a.jpg".into(),
            alt: (!missing_alt).then(|| "Boats at the breakwater".to_string()),
            loaded: true,
            decorative: false,
            authored: true,
        });
        pages.push(story);
    }
    let site = SiteFacts {
        public_origin: "https://example.travel".into(),
        site_title: "Cinque Terre Dispatch".into(),
        languages: ["en".to_string()].into(),
        paths: ["/".to_string(), "/en/a-story/".to_string()].into(),
        sitemap_found: true,
        sitemap: ["/".to_string(), "/en/a-story/".to_string()].into(),
        ..SiteFacts::default()
    };
    site_quality::build(
        &Standard::current(),
        Subject {
            site: "example".into(),
            branch: branch.into(),
            commit: head.into(),
            release: None,
        },
        &site,
        &pages,
        &[],
    )
    .unwrap()
}

/// The audits a scripted QA stage was asked for: (branch, head, round).
type Audits = Arc<Mutex<Vec<(String, String, u32)>>>;

fn audit_hook(missing_alt: bool) -> (Arc<orchestrator::AuditFn>, Audits) {
    let seen: Audits = Arc::new(Mutex::new(Vec::new()));
    let s2 = seen.clone();
    let f: Arc<orchestrator::AuditFn> = Arc::new(move |branch, head, round, theme| {
        s2.lock()
            .unwrap()
            .push((branch.to_string(), head.to_string(), round));
        Ok(Some(report(branch, head, theme, missing_alt)))
    });
    (f, seen)
}

fn orch_with(llm: Arc<agents::FakeLlm>) -> Orchestrator<MemStore, FakeGateway> {
    let g = FakeGateway::new();
    let b = dispatch();
    g.put_design(
        1,
        json!({"version": 1, "manifest": b.manifest(), "design": interpret(&b)}),
    );
    Orchestrator::new(MemStore::new(), g, llm, site())
}

fn orch() -> Orchestrator<MemStore, FakeGateway> {
    orch_with(Arc::new(fake_writer([])))
}

fn designer() -> StaffRef {
    StaffRef {
        id: "staff-14".into(),
        persona: "serena".into(),
        role: "web-designer".into(),
    }
}

fn job(job_id: u64, kind: JobKind, context: Value) -> JobRequest {
    JobRequest {
        company_id: COMPANY.into(),
        job_id,
        kind,
        project: "project-1".into(),
        work_item: Some(ITEM.into()),
        brief_ref: Some(1),
        revision: 0,
        staff: vec![designer()],
        meeting: None,
        context,
        approved_by: Some("The CEO".into()),
    }
}

/// The fake designer's theme, with [`DEFECT`] added to its front page: the earlier markup a
/// revision starts from.
async fn defective_start() -> Value {
    let o = orch();
    let out = o
        .run(&job(1, JobKind::SiteTheme, json!({"site": site_context()})))
        .await
        .unwrap();
    assert!(matches!(out.last(), Some(Outcome::JobCompleted { .. })));
    let art = o
        .store()
        .get_artifact(COMPANY, ITEM)
        .await
        .unwrap()
        .unwrap();
    let theme: site_design::ThemeData =
        serde_json::from_value(art["site_theme"]["theme"].clone()).unwrap();
    let mut start = serde_json::Map::new();
    for t in &theme.templates {
        let mut m = t.content.clone();
        if t.slug == "front-page" {
            m.push_str(DEFECT);
        }
        start.insert(format!("template {}", t.slug), json!(m));
    }
    for t in &theme.template_parts {
        start.insert(format!("part {}", t.slug), json!(t.content));
    }
    json!({"site": site_context(), "start_from": start, "labels": theme.labels})
}

fn quality(out: &[Outcome]) -> &orchestrator::QualityOut {
    match out.first() {
        Some(Outcome::SiteQuality { quality, .. }) => quality,
        other => panic!("no SiteQuality first: {other:?}"),
    }
}

#[tokio::test]
async fn a_design_class_is_repaired_in_the_loop_and_audited_again() {
    let context = defective_start().await;
    let llm = Arc::new(fake_writer([]));
    let o = orch_with(llm.clone());
    let (hook, seen) = audit_hook(false);
    o.gateway().set_audit(hook);
    let out = o
        .run(&job(2, JobKind::SiteTheme, context.clone()))
        .await
        .unwrap();
    let q = quality(&out);
    assert!(q.passed, "{out:?}");
    assert_eq!((q.findings, q.classes, q.pages, q.audits), (0, 0, 2, 4));
    assert!(matches!(out.last(), Some(Outcome::JobCompleted { digest, .. }) if digest.ok));
    // Two audits: the defect found (a narrow-column class on the front page), then the repaired
    // theme on a new head.
    let audits = seen.lock().unwrap().clone();
    assert_eq!(audits.len(), 2, "{audits:?}");
    assert_eq!(audits[0].2, 0);
    assert_eq!(audits[1].2, 1);
    assert_ne!(audits[0].1, audits[1].1, "the repair was written");
    let art = o
        .store()
        .get_artifact(COMPANY, ITEM)
        .await
        .unwrap()
        .unwrap();
    let rec = &art["site_theme"]["quality"];
    assert_eq!(rec["rounds"], 1);
    assert_eq!(rec["repaired"], json!(["narrow-column on front-page"]));
    assert_eq!(rec["gate"]["passed"], true);
    let live = o
        .gateway()
        .file_text("design-v1", FakeGateway::THEME_DATA_PATH)
        .unwrap();
    let data: site_design::ThemeData = serde_json::from_str(&live).unwrap();
    let front = data
        .templates
        .iter()
        .find(|t| t.slug == "front-page")
        .unwrap();
    assert!(!front.content.contains("QA defect"));
    // The model was asked once, about the front page, with the class's evidence.
    // A revision: no call for a template that passes its checks; the labels again (the defect
    // brought a word of its own); one fix, the front page's, with the class's evidence.
    let calls = llm.calls();
    let fixes: Vec<&str> = calls
        .iter()
        .map(|c| c.request.messages[0].text.as_str())
        .filter(|t| t.starts_with("## Task: web design template fix"))
        .collect();
    assert_eq!(fixes.len(), 1);
    assert_eq!(calls.len(), 2);
    let text = fixes[0];
    assert!(text.contains("site-standard v3"));
    assert!(text.contains("[narrow-column] on front-page"));
    assert!(text.contains("760 of 1200 px"));
}

#[tokio::test]
async fn a_content_class_nobody_can_repair_blocks_the_release_and_is_routed_by_role() {
    let o = orch();
    let (hook, seen) = audit_hook(true);
    o.gateway().set_audit(hook);
    let out = o
        .run(&job(3, JobKind::SiteTheme, json!({"site": site_context()})))
        .await
        .unwrap();
    let q = quality(&out);
    assert!(!q.passed);
    assert_eq!((q.findings, q.classes), (1, 1));
    assert!(q.accessibility < 1000 && q.layout == 1000);
    assert!(matches!(
        out.last(),
        Some(Outcome::JobFailed {
            reason: JobFailure::QualityGate,
            ..
        })
    ));
    // No design class: no repair round, one audit.
    assert_eq!(seen.lock().unwrap().len(), 1);
    let art = o
        .store()
        .get_artifact(COMPANY, ITEM)
        .await
        .unwrap()
        .unwrap();
    let rec: orchestrator::quality::QaRecord =
        serde_json::from_value(art["site_theme"]["quality"].clone()).unwrap();
    assert_eq!(rec.content.len(), 1);
    assert_eq!(rec.content[0].order.role, Route::PhotoEditor);
    assert_eq!(
        rec.content[0].routed,
        Routed::Unstaffed {
            role: Route::PhotoEditor
        }
    );
    let posts = o.store().plan_json(COMPANY).await.unwrap()["posts"][ITEM].clone();
    let text = posts
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|p| p["text"].as_str())
        .collect::<Vec<_>>()
        .join("\n");
    assert!(text.contains("blocked by the QA stage"), "{text}");
    assert!(text.contains("photo-editor"), "{text}");
    assert_eq!(o.gateway().merge_count(), 0);
}

#[tokio::test]
async fn the_routing_hook_is_typed_by_role_and_never_passes() {
    use site_quality::WorkOrder;
    let order = |role| WorkOrder {
        role,
        rule: "broken-image".into(),
        page_type: "single".into(),
        findings: 1,
        pages: 1,
        evidence: String::new(),
    };
    let routed = orchestrator::quality::route_content(&[
        order(Route::PhotoEditor),
        order(Route::Researcher),
        order(Route::Editor),
        order(Route::Seo),
    ]);
    let roles: Vec<Route> = routed
        .iter()
        .map(|r| match r.routed {
            Routed::Unstaffed { role } => role,
        })
        .collect();
    assert_eq!(
        roles,
        vec![
            Route::PhotoEditor,
            Route::Researcher,
            Route::Editor,
            Route::Seo
        ]
    );
}

#[tokio::test]
async fn publishing_needs_a_passing_audit_of_the_head_it_merges() {
    // Drafted without a QA stage (an executor without one): the Publish cannot audit, fails.
    let o = orch();
    let out = o
        .run(&job(4, JobKind::SiteTheme, json!({"site": site_context()})))
        .await
        .unwrap();
    assert!(matches!(out.last(), Some(Outcome::JobCompleted { .. })));
    let out = o
        .run(&job(5, JobKind::Publish, json!({"site": site_context()})))
        .await
        .unwrap();
    assert_eq!(
        out,
        vec![Outcome::JobFailed {
            job_id: 5,
            reason: JobFailure::Infrastructure
        }]
    );
    assert_eq!(o.gateway().merge_count(), 0);
    // An executor whose audit finds a content class: blocked, never merged.
    let (hook, _) = audit_hook(true);
    o.gateway().set_audit(hook);
    let out = o
        .run(&job(6, JobKind::Publish, json!({"site": site_context()})))
        .await
        .unwrap();
    assert!(!quality(&out).passed);
    assert!(matches!(
        out.last(),
        Some(Outcome::JobFailed {
            reason: JobFailure::QualityGate,
            ..
        })
    ));
    assert_eq!(o.gateway().merge_count(), 0);
    // A clean audit of that head: merged.
    let (hook, seen) = audit_hook(false);
    o.gateway().set_audit(hook);
    let out = o
        .run(&job(7, JobKind::Publish, json!({"site": site_context()})))
        .await
        .unwrap();
    assert!(quality(&out).passed);
    assert!(matches!(out.last(), Some(Outcome::JobCompleted { .. })));
    assert_eq!(o.gateway().merge_count(), 1);
    let head = o.gateway().branch_head("design-v1").unwrap();
    assert_eq!(seen.lock().unwrap()[0].1, head, "the head it merged");
    let _ = GatewayError(String::new());
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

fn request(w: &World, e: &Effect, context: &Value) -> Option<JobRequest> {
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
        context: context.clone(),
        approved_by: Some("The CEO".into()),
    })
}

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

async fn play(
    w: &mut World,
    o: &Orchestrator<MemStore, FakeGateway>,
    context: &Value,
    done: impl Fn(&World) -> bool,
) {
    for _ in 0..40_000 {
        for e in w.drain_effects() {
            if let Some(req) = request(w, &e, context) {
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

/// A defect found, its class repaired, the CEO's approval, the release audited and merged; the
/// sim holds the digests.
async fn defect_to_live() -> (World, Orchestrator<MemStore, FakeGateway>) {
    let context = defective_start().await;
    let mut w = world();
    let o = orch();
    let (hook, _) = audit_hook(false);
    o.gateway().set_audit(hook);
    w.apply_server(ServerCommand::DesignReceived { version: 1 })
        .unwrap();
    let item = w.open_site_theme().unwrap();
    let open = |w: &World| {
        w.tickets
            .values()
            .find(|t| t.is_open() && t.kind == TicketKind::ThemeApproval)
            .map(|t| t.id)
    };
    play(&mut w, &o, &context, |w| open(w).is_some()).await;
    let q = w.plan.designs.quality.unwrap();
    assert!(q.passed);
    assert_eq!(w.plan.designs.live_quality, None);
    let ticket = open(&w).unwrap();
    w.apply(Command::AnswerTicket {
        ticket,
        option: TicketOption::Approve,
    })
    .unwrap();
    play(&mut w, &o, &context, |w| {
        w.plan.items[&item].status.is_closed()
    })
    .await;
    assert_eq!(w.plan.items[&item].status, WorkItemStatus::Published);
    (w, o)
}

#[tokio::test]
async fn defect_finding_repair_audit_merge_the_same_world_twice() {
    let (a, o) = defect_to_live().await;
    assert_eq!(o.gateway().merge_count(), 1);
    let live = a.plan.designs.live_quality.unwrap();
    assert!(live.passed);
    assert_eq!((live.standard, live.pages, live.findings), (3, 2, 0));
    let (b, _) = defect_to_live().await;
    assert_eq!(a.hash(), b.hash());
}

#[test]
fn the_sim_refuses_a_digest_that_contradicts_itself() {
    let mut w = world();
    w.apply_server(ServerCommand::DesignReceived { version: 1 })
        .unwrap();
    let job = loop {
        let effects = w.drain_effects();
        if let Some(Effect::RequestJob { job_id, .. }) = effects.iter().find(|e| {
            matches!(
                e,
                Effect::RequestJob {
                    kind: SimJob::SiteTheme,
                    ..
                }
            )
        }) {
            break *job_id;
        }
        w.step();
    };
    let ok = sim_core::site_theme::SiteQualityDigest {
        standard: 1,
        pages: 2,
        audits: 4,
        passed: true,
        layout: 1000,
        ..Default::default()
    };
    let bad = [
        sim_core::site_theme::SiteQualityDigest {
            findings: 3,
            classes: 1,
            ..ok
        },
        sim_core::site_theme::SiteQualityDigest { seo: 1001, ..ok },
        sim_core::site_theme::SiteQualityDigest { pages: 0, ..ok },
    ];
    for q in bad {
        assert!(w
            .apply_server(ServerCommand::SiteQuality {
                job_id: job,
                quality: q
            })
            .is_err());
    }
    assert!(w
        .apply_server(ServerCommand::SiteQuality {
            job_id: 999_999,
            quality: ok
        })
        .is_err());
    w.apply_server(ServerCommand::SiteQuality {
        job_id: job,
        quality: ok,
    })
    .unwrap();
    assert_eq!(w.plan.designs.quality, Some(ok));
}

#[tokio::test]
async fn a_qa_round_that_leaves_more_findings_is_undone() {
    let context = defective_start().await;
    let o = orch();
    // Round 0 sees the defect (one finding); the repaired theme, scripted to come out worse,
    // leaves two (the defect gone, two half-empty rows elsewhere).
    let first: Arc<Mutex<Option<site_quality::Finding>>> = Arc::new(Mutex::new(None));
    let f: Arc<orchestrator::AuditFn> = Arc::new(move |branch, head, round, theme| {
        let mut r = report(branch, head, theme, false);
        if round == 0 {
            *first.lock().unwrap() = r.findings.first().cloned();
        } else if let Some(one) = first.lock().unwrap().clone() {
            let mut a = one.clone();
            a.page = "/en/a-story/".into();
            let mut b = one;
            b.page = "/en/elsewhere/".into();
            r.findings = vec![a, b];
            r.digest.findings = 2;
            r.digest.classes = 1;
            r.digest.passed = false;
            r.gate.passed = false;
        }
        Ok(Some(r))
    });
    o.gateway().set_audit(f);
    let out = o.run(&job(8, JobKind::SiteTheme, context)).await.unwrap();
    assert!(matches!(
        out.last(),
        Some(Outcome::JobFailed {
            reason: JobFailure::QualityGate,
            ..
        })
    ));
    assert_eq!(quality(&out).findings, 1, "the round before's report");
    let live = o
        .gateway()
        .file_text("design-v1", FakeGateway::THEME_DATA_PATH)
        .unwrap();
    let data: site_design::ThemeData = serde_json::from_str(&live).unwrap();
    let front = data
        .templates
        .iter()
        .find(|t| t.slug == "front-page")
        .unwrap();
    assert!(front.content.contains("QA defect"), "the repair was undone");
    let art = o
        .store()
        .get_artifact(COMPANY, ITEM)
        .await
        .unwrap()
        .unwrap();
    let notes = art["site_theme"]["notes"].to_string();
    assert!(notes.contains("undone"), "{notes}");
}
