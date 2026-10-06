//! The data scientist's jobs (ADR-0071, FEAT-097): the follow-up's score from
//! the numbers, its post within the numbers, the skip without data; the
//! weekly KPI report as the meeting's minutes, and its absence without data.

use std::sync::Arc;

use agents::fake_writer;
use agents::{FakeLlm, FakeReply};
use orchestrator::{
    performance_score, FakeGateway, JobFailure, JobKind, JobRequest, MemStore, Orchestrator,
    Outcome, PageNumbers, StaffRef, Store,
};
use serde_json::{json, Value};

mod common;
use common::{site, COMPANY};

fn analyst() -> StaffRef {
    StaffRef {
        id: "staff-13".into(),
        persona: "yasmin".into(),
        role: "data-scientist".into(),
    }
}

fn orch(llm: Arc<FakeLlm>) -> Orchestrator<MemStore, FakeGateway> {
    Orchestrator::new(MemStore::new(), FakeGateway::new(), llm, site())
}

fn job(job_id: u64, kind: JobKind, context: Value) -> JobRequest {
    JobRequest {
        company_id: COMPANY.into(),
        job_id,
        kind,
        project: "project-1".into(),
        work_item: (kind == JobKind::Performance).then(|| "work-item-3".into()),
        brief_ref: (kind == JobKind::Performance).then_some(42),
        revision: 0,
        staff: vec![analyst()],
        meeting: (kind == JobKind::KpiReport).then(|| "meeting-9".into()),
        context,
        approved_by: None,
    }
}

async fn put_brief(store: &MemStore) {
    store
        .put_brief(
            COMPANY,
            42,
            json!({"job_id": 1, "brief": {"content_id": "c", "title": "Harvest week in Manarola", "slug": "harvest-week-in-manarola",
                   "angle": "a", "keywords": [], "target_words": 800, "language": "en", "notes": ""},
                   "writer": "staff-1", "editor": "staff-5", "minutes": [], "work_item": "work-item-3", "staff": []}),
        )
        .await
        .unwrap();
}

#[test]
fn the_score_is_page_views_against_the_median() {
    let n = |v, m| PageNumbers {
        path: "/en/blog/x".into(),
        pageviews: v,
        median_pageviews: m,
        pages: 10,
        ..PageNumbers::default()
    };
    let scores: Vec<u8> = [
        (0, 100),
        (10, 100),
        (30, 100),
        (60, 100),
        (80, 100),
        (100, 100),
        (170, 100),
        (300, 100),
    ]
    .iter()
    .map(|(v, m)| performance_score(&n(*v, *m)))
    .collect();
    assert_eq!(scores, [2, 3, 4, 5, 6, 7, 8, 9]);
    assert_eq!(performance_score(&n(50, 0)), 5, "nothing to compare with");
}

#[tokio::test]
async fn a_follow_up_posts_within_its_numbers_and_reports_the_score() {
    let llm = Arc::new(fake_writer::fake_writer(Vec::<FakeReply>::new()));
    let o = orch(llm.clone());
    put_brief(o.store()).await;
    let ctx = json!({"page": {"path": "/en/blog/harvest-week-in-manarola", "pageviews": 240, "sessions": 200,
                              "avg_engaged_ms": 41000, "scroll_75": 90, "days": 12, "median_pageviews": 100, "pages": 40}});
    let out = o.run(&job(60, JobKind::Performance, ctx)).await.unwrap();
    match out.as_slice() {
        [Outcome::JobCompleted { digest, .. }] => assert_eq!(digest.score, 9),
        other => panic!("{other:?}"),
    }
    let text = o.store().plan_json(COMPANY).await.unwrap();
    let post = &text["posts"]["work-item-3"][0];
    assert_eq!(post["type"], json!("performance"));
    assert_eq!(post["payload"]["score"], json!(9));
    assert!(
        post["text"].as_str().unwrap().contains("240 views"),
        "{post}"
    );
    // the prompt carried the numbers, nothing else
    let prompt = &llm.calls()[0].request.messages[0].text;
    assert!(prompt.starts_with("## Task: content performance"));
    assert!(
        prompt.contains("\"median_page_pageviews\": 100"),
        "{prompt}"
    );
}

#[tokio::test]
async fn without_numbers_the_follow_up_is_skipped_loudly() {
    let llm = Arc::new(fake_writer::fake_writer(Vec::<FakeReply>::new()));
    let o = orch(llm.clone());
    put_brief(o.store()).await;
    let out = o
        .run(&job(61, JobKind::Performance, json!({"page": null})))
        .await
        .unwrap();
    assert!(
        matches!(
            out.as_slice(),
            [Outcome::JobFailed {
                reason: JobFailure::Infrastructure,
                ..
            }]
        ),
        "{out:?}"
    );
    assert!(llm.calls().is_empty());
    let text = o.store().plan_json(COMPANY).await.unwrap();
    assert!(text["posts"]["work-item-3"][0]["text"]
        .as_str()
        .unwrap()
        .contains("No tracker data"));
}

#[tokio::test]
async fn the_kpi_report_is_the_reviews_minutes() {
    let llm = Arc::new(fake_writer::fake_writer(Vec::<FakeReply>::new()));
    let o = orch(llm.clone());
    let ctx = json!({"week": {"totals": {"sessions": 1200, "pageviews": 3400, "visitors": 900, "engagementPm": 610},
                              "topPages": [{"path": "/en/manarola", "pageviews": 410}]},
                     "previous": {"totals": {"pageviews": 3100}}});
    let out = o.run(&job(62, JobKind::KpiReport, ctx)).await.unwrap();
    assert!(
        matches!(out.as_slice(), [Outcome::JobCompleted { digest, .. }] if digest.ok),
        "{out:?}"
    );
    let text = o.store().plan_json(COMPANY).await.unwrap();
    let minutes = &text["posts"]["meeting-9"][0];
    assert_eq!(minutes["type"], json!("minutes"));
    assert_eq!(minutes["payload"]["kpi_report"], json!(true));
    assert_eq!(
        minutes["payload"]["recommendations"]
            .as_array()
            .unwrap()
            .len(),
        3
    );
    // the headline is spoken in the meeting
    let lines = o.store().transcripts(COMPANY);
    assert_eq!(lines[0]["speaker"], json!("staff-13"));

    // no traffic yet: said, not invented
    let llm = Arc::new(fake_writer::fake_writer(Vec::<FakeReply>::new()));
    let o = orch(llm.clone());
    let out = o
        .run(&job(63, JobKind::KpiReport, Value::Null))
        .await
        .unwrap();
    assert!(matches!(out.as_slice(), [Outcome::JobCompleted { digest, .. }] if !digest.ok));
    assert!(llm.calls().is_empty());
}
