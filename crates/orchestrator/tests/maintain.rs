//! Refresh and fix of a published page (ADR-0070, FEAT-088): the board plans
//! site care from the audit's findings; a fix removes broken links without a
//! model; a refresh researches, rewrites only the outdated passages and keeps
//! English for what it changed; both commit an update that names the blob
//! they read; the review sees the changes. MemStore + FakeGateway + the fake
//! writer over the `cinqueterre-mini` pack.

use std::sync::Arc;

use agents::fake_writer;
use agents::{FakeLlm, FakeReply, LlmRequest};
use orchestrator::{
    BriefRecord, FakeGateway, Gateway, JobKind, JobRequest, MemStore, Orchestrator, Outcome,
    StaffRef, Store,
};
use serde_json::{json, Value};

mod common;
use common::{site, team, COMPANY};

const FIXTURE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../knowledge/tests/fixtures/cinqueterre-mini/"
);
const BROKEN: &str = "content/pages/blog/last-light-on-sentiero-azzurro.json";
const STALE: &str = "content/pages/blog/5-hidden-gelaterias-you-need-to-try.json";

fn fixture(path: &str) -> String {
    std::fs::read_to_string(format!("{FIXTURE}{path}")).unwrap()
}

fn gateway() -> Arc<FakeGateway> {
    let g = FakeGateway::new();
    g.put_main(BROKEN, &fixture(BROKEN));
    g.put_main(STALE, &fixture(STALE));
    Arc::new(g)
}

fn orch(llm: Arc<FakeLlm>, gw: Arc<FakeGateway>) -> Orchestrator<Arc<MemStore>, Arc<FakeGateway>> {
    Orchestrator::new(Arc::new(MemStore::new()), gw, llm, site())
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

fn staff(id: &str) -> StaffRef {
    team().into_iter().find(|s| s.id == id).unwrap()
}

async fn put_care_brief(store: &dyn Store, brief_ref: u64, kind: &str, target: &str) {
    let rec = json!({
        "job_id": 19,
        "brief": {"content_id": format!("content-{brief_ref:x}"), "title": "Care", "slug": "care",
                  "angle": "Bring it up to date for this season.", "keywords": ["cinque terre"],
                  "target_words": 800, "language": "en", "notes": ""},
        "writer": "", "editor": "staff-5", "minutes": [], "work_item": null,
        "staff": [staff("staff-5")], "kind": kind, "target": target
    });
    let _: BriefRecord = serde_json::from_value(rec.clone()).unwrap();
    store.put_brief(COMPANY, brief_ref, rec).await.unwrap();
}

fn job(job_id: u64, kind: JobKind, brief_ref: u64, revision: u8, who: &str) -> JobRequest {
    JobRequest {
        company_id: COMPANY.into(),
        job_id,
        kind,
        project: "project-1".into(),
        work_item: Some(format!("work-item-{brief_ref}")),
        brief_ref: Some(brief_ref),
        revision,
        staff: vec![staff(who)],
        meeting: None,
        context: Value::Null,
        approved_by: None,
    }
}

fn digest(out: &[Outcome]) -> &orchestrator::Digest {
    match out {
        [Outcome::JobCompleted { digest, .. }] => digest,
        other => panic!("{other:?}"),
    }
}

/// Every text block of the page has no internal link the site lacks.
fn broken_links(page: &Value) -> usize {
    let kb = site().knowledge.unwrap().kb.clone();
    kb.check_links(page)
        .broken
        .iter()
        .filter(|b| {
            matches!(
                b.kind,
                knowledge::kb::RefKind::Href | knowledge::kb::RefKind::PageSlug
            )
        })
        .count()
}

#[tokio::test]
async fn a_fix_removes_the_broken_links_without_a_model_and_commits_an_update() {
    let llm = Arc::new(fake_writer::fake_writer(Vec::<FakeReply>::new()));
    let gw = gateway();
    let o = orch(llm.clone(), gw.clone());
    let before: Value = serde_json::from_str(&fixture(BROKEN)).unwrap();
    assert!(broken_links(&before) > 0, "the fixture has a broken link");
    put_care_brief(o.store().as_ref(), 7, "fix", BROKEN).await;

    let out = o
        .run(&job(20, JobKind::Draft, 7, 0, "staff-1"))
        .await
        .unwrap();
    let d = digest(&out);
    assert!(d.ok, "{out:?}");
    assert!(llm.calls().is_empty(), "no model call for a fix");
    let branch = format!("drafts/content-{}", before["id"].as_str().unwrap());
    let after: Value = serde_json::from_str(&gw.file_text(&branch, BROKEN).unwrap()).unwrap();
    assert_eq!(broken_links(&after), 0);
    assert_eq!(after["id"], before["id"], "the article keeps its id");
    let art = o
        .store()
        .get_artifact(COMPANY, "work-item-7")
        .await
        .unwrap()
        .unwrap();
    let changes = art["changes"].as_array().unwrap();
    assert!(!changes.is_empty());
    assert!(changes[0]
        .as_str()
        .unwrap()
        .starts_with("removed the link to"));

    // the review sees the changes
    let out = o
        .run(&job(21, JobKind::Review, 7, 0, "staff-5"))
        .await
        .unwrap();
    assert_eq!(digest(&out).score, 8);
    assert_eq!(tasks(&llm), ["update review"]);
    let prompt = &llm.calls()[0].request.messages[0].text;
    assert!(prompt.contains("fix of broken links"), "{prompt}");
    assert!(prompt.contains("removed the link to"), "{prompt}");

    // nothing left to fix: not a success
    let llm2 = Arc::new(fake_writer::fake_writer(Vec::<FakeReply>::new()));
    let gw2 = Arc::new(FakeGateway::new());
    gw2.put_main(BROKEN, &serde_json::to_string_pretty(&after).unwrap());
    let o2 = orch(llm2, gw2);
    put_care_brief(o2.store().as_ref(), 8, "fix", BROKEN).await;
    let out = o2
        .run(&job(22, JobKind::Draft, 8, 0, "staff-1"))
        .await
        .unwrap();
    assert!(!digest(&out).ok);
}

#[tokio::test]
async fn a_refresh_researches_and_rewrites_only_the_outdated_passages() {
    let llm = Arc::new(fake_writer::fake_writer(Vec::<FakeReply>::new()));
    let gw = gateway();
    let o = orch(llm.clone(), gw.clone());
    put_care_brief(o.store().as_ref(), 9, "refresh", BROKEN).await;
    let before: Value = serde_json::from_str(&fixture(BROKEN)).unwrap();
    let passages = agents::article_prompts::page_passages(&before);
    assert!(passages.len() > 3);

    let out = o
        .run(&job(30, JobKind::Draft, 9, 0, "staff-2"))
        .await
        .unwrap();
    assert!(digest(&out).ok, "{out:?}");
    assert_eq!(tasks(&llm), ["research", "refresh"]);
    let branch = format!("drafts/content-{}", before["id"].as_str().unwrap());
    let after: Value = serde_json::from_str(&gw.file_text(&branch, BROKEN).unwrap()).unwrap();
    let p1 = &passages[0];
    let new = after.pointer(&p1.pointer).and_then(Value::as_str).unwrap();
    assert!(new.starts_with("Updated this season"), "{new}");
    // a changed localized field keeps only English
    if let Some(parent) = p1.pointer.strip_suffix("/en") {
        let field = after.pointer(parent).unwrap().as_object().unwrap();
        assert_eq!(field.keys().collect::<Vec<_>>(), ["en"]);
    }
    // the other passages are as they were
    for p in &passages[1..] {
        assert_eq!(
            after.pointer(&p.pointer),
            before.pointer(&p.pointer),
            "{}",
            p.alias
        );
    }
    let art = o
        .store()
        .get_artifact(COMPANY, "work-item-9")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(art["changes"].as_array().unwrap().len(), 1);
    assert!(!art["evidence"].as_array().unwrap().is_empty());
    // the writer the sim staffed is kept for the review and the publish
    assert_eq!(art["writer"]["id"], json!("staff-2"));
}

#[tokio::test]
async fn an_update_is_refused_when_the_page_changed_since_it_was_read() {
    let gw = gateway();
    let file = gw.read_page(STALE).await.unwrap().unwrap();
    gw.put_main(STALE, "{\"id\": \"changed\"}");
    let err = gw
        .open_update_as(
            "blog-article-gelaterias-01",
            STALE,
            &file.page,
            "Refresh",
            None,
            &file.sha,
        )
        .await
        .unwrap_err();
    assert!(err.0.contains("changed on main"), "{err:?}");
    assert!(gw
        .read_page("content/pages/blog/none.json")
        .await
        .unwrap()
        .is_none());
}

#[tokio::test]
async fn a_page_gone_from_the_site_is_needs_page() {
    let llm = Arc::new(fake_writer::fake_writer(Vec::<FakeReply>::new()));
    let o = orch(llm, Arc::new(FakeGateway::new()));
    put_care_brief(o.store().as_ref(), 10, "refresh", STALE).await;
    let out = o
        .run(&job(40, JobKind::Draft, 10, 0, "staff-1"))
        .await
        .unwrap();
    assert!(
        matches!(
            out.as_slice(),
            [Outcome::JobFailed {
                reason: orchestrator::JobFailure::NeedsPage,
                ..
            }]
        ),
        "{out:?}"
    );
}

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

#[tokio::test]
async fn the_board_plans_site_care_from_the_audit() {
    let llm = Arc::new(fake_writer::fake_writer(Vec::<FakeReply>::new()));
    let o = orch(llm.clone(), gateway());
    let ctx = json!({"today": "2026-10-05", "in_flight": [], "planned_room": 10, "site": {
        "stale": [{"path": STALE, "title": "5 Hidden Gelaterias You Need to Try", "date": "2025-01-05", "age_days": 638}],
        "broken": [{"path": BROKEN, "title": "The Last Light on the Sentiero Azzurro", "broken": 2}]
    }});
    let req = JobRequest {
        company_id: COMPANY.into(),
        job_id: 50,
        kind: JobKind::Board,
        project: "project-1".into(),
        work_item: None,
        brief_ref: None,
        revision: 0,
        staff: board_team(),
        meeting: Some("meeting-7".into()),
        context: ctx,
        approved_by: None,
    };
    let out = o.run(&req).await.unwrap();
    let items = match out.as_slice() {
        [Outcome::BoardOutcome { items, .. }] => items.clone(),
        other => panic!("{other:?}"),
    };
    let prompt = &llm.calls()[0].request.messages[0].text;
    assert!(prompt.contains("## Site health"), "{prompt}");
    assert!(
        prompt.contains("- S1 «5 Hidden Gelaterias You Need to Try» (refresh: last updated 2025-01-05, 638 days ago)"),
        "{prompt}"
    );
    assert!(
        prompt.contains(
            "- S2 «The Last Light on the Sentiero Azzurro» (fix: 2 broken internal links)"
        ),
        "{prompt}"
    );
    assert_eq!(items[0].kind, "Refresh");
    assert_eq!(items[1].kind, "Fix");
    assert_eq!(items[2].kind, "Article");
    // no web check of site care
    let checks = tasks(&llm).iter().filter(|t| *t == "pitch check").count();
    assert_eq!(checks, items.len() - 2);
    let rec: BriefRecord = serde_json::from_value(
        o.store()
            .get_brief(COMPANY, items[0].brief_ref)
            .await
            .unwrap()
            .unwrap(),
    )
    .unwrap();
    assert_eq!(rec.kind.as_deref(), Some("refresh"));
    assert_eq!(rec.target.as_deref(), Some(STALE));
    assert_eq!(rec.brief.title, "5 Hidden Gelaterias You Need to Try");
    assert_eq!(rec.brief.slug, "5-hidden-gelaterias-you-need-to-try");
}
