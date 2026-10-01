//! The MVP article loop through the orchestrator (docs/mvp.md), with the sim's
//! side played by the test: standup → work item → draft PR → review 6 →
//! revision → review 8 → publish (squash merge) → deploy landed. Real
//! Postgres, FakeLlm, FakeGitHub.

use std::sync::Arc;
use std::time::Duration;

use agents::prompts::SiteContext;
use agents::{FakeLlm, FakeReply, StyleGuide};
use github::{FakeGitHub, RepoApi, RepoId};
use serde_json::{json, Value};
use simpress_server::orchestrator::{
    site_validator, Digest, JobKind, JobRequest, Orchestrator, Outcome, SiteBinding, StaffRef,
};
use simpress_server::plan::{PermissivePlanOpValidator, PlanHub, PlanService};
use sqlx::PgPool;
use uuid::Uuid;

async fn company(pool: &PgPool) -> Uuid {
    let u = simpress_server::db::upsert_github_user(pool, 42, "ceo", None, None)
        .await
        .unwrap();
    simpress_server::db::create_company(pool, u.id, "Cinque Terre Dispatch", 42, 60)
        .await
        .unwrap()
        .unwrap()
        .id
}

fn team() -> Vec<StaffRef> {
    [
        ("staff-4", "sophia", "editor-in-chief"),
        ("staff-5", "marco", "editor"),
        ("staff-1", "giulia", "writer"),
        ("staff-2", "isabella", "writer"),
    ]
    .into_iter()
    .map(|(id, persona, role)| StaffRef {
        id: id.into(),
        persona: persona.into(),
        role: role.into(),
    })
    .collect()
}

fn page(paragraph: &str) -> Value {
    json!({
        "id": "ignored-by-orchestrator", "slug": {"en": "/en/blog/x"}, "title": {"en": "Harvest week in Manarola"},
        "page_type": "blog-article",
        "seo": {"title": "Harvest week in Manarola", "description": "Picking Sciacchetrà grapes on the terraces."},
        "body": [
            {"type": "heading", "level": 2, "text": "On the terraces"},
            {"type": "paragraph", "markdown": paragraph},
            {"type": "callout", "style": "info", "content": "The harvest moves with the weather; check before you go."}
        ]
    })
}

fn review(decision: &str, score: u8, notes: &str) -> Value {
    json!({"decision": decision, "score": score, "notes": notes, "issues": [], "high_risk": []})
}

fn script() -> Vec<FakeReply> {
    vec![
        // standup: moderator picks Giulia, Giulia pitches, moderator closes, outcome
        FakeReply::Json(json!({"next": "staff-1", "prompt": "Giulia, your pitch?", "done": false})),
        FakeReply::Text("The Sciacchetrà harvest starts Monday; I want to be on the Manarola terraces.".into()),
        FakeReply::Json(json!({"next": "staff-1", "prompt": "", "done": true})),
        FakeReply::Json(json!({
            "briefs": [{"title": "Harvest week in Manarola", "angle": "A day on the terraces with the pickers",
                        "assignee": "staff-1", "keywords": ["sciacchetrà", "manarola harvest"], "target_words": 600}],
            "decisions": ["Giulia covers the harvest"], "escalations": []
        })),
        // draft 0, review 6, draft 1 (revision), review 8
        FakeReply::Json(page("We climbed to the terraces at seven, before the sun reached the vines.")),
        FakeReply::Json(review("needs_changes", 6, "Tell us who the pickers are.")),
        FakeReply::Json(page("Maria and her sons have picked these terraces for thirty years; we joined them at seven.")),
        FakeReply::Json(review("approve", 8, "Now it has people in it.")),
    ]
}

fn style() -> StyleGuide {
    StyleGuide::from_json_str(include_str!("../../agents/tests/fixtures/style-guide.json")).unwrap()
}

async fn setup(pool: PgPool, llm: Arc<FakeLlm>) -> (Orchestrator, Arc<FakeGitHub>, Arc<PlanService>, RepoId) {
    let gh = Arc::new(FakeGitHub::new());
    let repo = RepoId {
        owner: "swarmpress".into(),
        name: "cinqueterre.travel".into(),
    };
    gh.create_repo(&repo, &[("content/pages/index.json", "{}")]);
    let plan = Arc::new(PlanService::new(
        pool.clone(),
        PlanHub::default(),
        Arc::new(PermissivePlanOpValidator),
        Duration::from_millis(100),
    ));
    let context = SiteContext::new("cinqueterre.travel", style(), None).unwrap();
    let site = SiteBinding {
        site_id: "cinqueterre.travel".into(),
        brand_name: "Cinque Terre Dispatch".into(),
        repo: repo.clone(),
        base_branch: "main".into(),
        language: "en".into(),
        validator: site_validator(&context),
        context,
        quality_bar: 7,
        simulate_deploy: true,
        standup_max_turns: 4,
    };
    let api: Arc<dyn RepoApi> = gh.clone();
    (
        Orchestrator::new(pool, llm, api, plan.clone(), site),
        gh,
        plan,
        repo,
    )
}

fn job(company_id: Uuid, job_id: u64, kind: JobKind, brief_ref: Option<u64>, revision: u8) -> JobRequest {
    JobRequest {
        company_id,
        job_id,
        kind,
        project: "project-1".into(),
        work_item: (kind != JobKind::Standup).then(|| "work-item-1".to_string()),
        brief_ref,
        revision,
        staff: team(),
    }
}

fn completed(out: &[Outcome]) -> &Digest {
    match &out[0] {
        Outcome::JobCompleted { digest, .. } => digest,
        other => panic!("{other:?}"),
    }
}

#[sqlx::test(migrations = "./migrations")]
async fn standup_to_published_article(pool: PgPool) {
    let c = company(&pool).await;
    let llm = Arc::new(FakeLlm::new(script()));
    let (orch, gh, plan, repo) = setup(pool.clone(), llm.clone()).await;

    // 09:00 standup → one brief for Giulia, edited by Marco
    let out = orch.run(&job(c, 1, JobKind::Standup, None, 0)).await.unwrap();
    let briefs = match &out[..] {
        [Outcome::MeetingOutcome { job_id: 1, briefs }] => briefs.clone(),
        other => panic!("{other:?}"),
    };
    assert_eq!(briefs.len(), 1);
    assert_eq!((briefs[0].writer.as_str(), briefs[0].editor.as_str()), ("staff-1", "staff-5"));
    let brief_ref = briefs[0].brief_ref;
    let (n,): (i64,) = sqlx::query_as("SELECT count(*) FROM transcripts WHERE company_id = $1")
        .bind(c)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(n, 1, "Giulia's pitch is in the transcript");

    // The sim creates work-item-1 and requests the first draft.
    let out = orch.run(&job(c, 2, JobKind::Draft, Some(brief_ref), 0)).await.unwrap();
    let d = completed(&out);
    assert!(d.ok && d.words > 10 && d.artifact_sha.is_some());
    let path = "content/pages/blog/harvest-week-in-manarola.json";
    let branch = gh.branch_head(&repo, &format!("drafts/content-{brief_ref:x}"));
    assert!(branch.is_some(), "draft branch exists");
    assert!(gh.file_text(&repo, "main", path).is_none(), "nothing on main yet");

    // Review 6 → the sim asks for a revision (it owns the rubric).
    let d = completed(&orch.run(&job(c, 3, JobKind::Review, Some(brief_ref), 0)).await.unwrap()).clone();
    assert!(d.ok);
    assert_eq!(d.score, 6);

    let out = orch.run(&job(c, 4, JobKind::Draft, Some(brief_ref), 1)).await.unwrap();
    assert!(completed(&out).ok);
    let revise_prompt = &llm.calls()[6].request.messages[0].text;
    assert!(revise_prompt.contains("Tell us who the pickers are."), "revision sees the review");

    let d = completed(&orch.run(&job(c, 5, JobKind::Review, Some(brief_ref), 1)).await.unwrap()).clone();
    assert_eq!(d.score, 8);

    // Publish: squash-merge, then the (simulated) deploy lands.
    let out = orch.run(&job(c, 6, JobKind::Publish, Some(brief_ref), 1)).await.unwrap();
    assert!(completed(&out).ok);
    assert_eq!(out[1], Outcome::DeployLanded { work_item: "work-item-1".into() });
    let live: Value = serde_json::from_str(&gh.file_text(&repo, "main", path).expect("merged to main")).unwrap();
    assert_eq!(live["id"], json!(format!("content-{brief_ref:x}")));
    assert_eq!(live["slug"]["en"], json!("/en/blog/harvest-week-in-manarola"));
    assert!(live.to_string().contains("Maria and her sons"), "the revised draft is what shipped");
    content_schema::validate_page(&live).unwrap();

    // Publishing again is idempotent (no second merge).
    let again = orch.run(&job(c, 6, JobKind::Publish, Some(brief_ref), 1)).await.unwrap();
    assert!(completed(&again).ok);

    // The plan thread tells the story, in order.
    let store = plan.plan_store(c).await.unwrap();
    assert_eq!(store["items"]["work-item-1"]["title"], json!("Harvest week in Manarola"));
    let kinds: Vec<String> = store["posts"]["work-item-1"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["type"].as_str().unwrap().to_string())
        .collect();
    assert_eq!(
        kinds,
        [
            "minutes", "artifact", "handoff", "review", "artifact", "handoff", "review", "artifact", "status"
        ],
        "{kinds:?}"
    );
    assert_eq!(llm.remaining(), 0, "every scripted call was used");
}

#[sqlx::test(migrations = "./migrations")]
async fn refused_draft_reports_not_ok_and_posts_status(pool: PgPool) {
    let c = company(&pool).await;
    let mut s = script();
    s.truncate(4);
    s.push(FakeReply::Error(agents::LlmError::Refusal {
        category: Some("other".into()),
        explanation: None,
    }));
    let llm = Arc::new(FakeLlm::new(s));
    let (orch, gh, plan, repo) = setup(pool.clone(), llm).await;
    let out = orch.run(&job(c, 1, JobKind::Standup, None, 0)).await.unwrap();
    let brief_ref = match &out[0] {
        Outcome::MeetingOutcome { briefs, .. } => briefs[0].brief_ref,
        o => panic!("{o:?}"),
    };
    let out = orch.run(&job(c, 2, JobKind::Draft, Some(brief_ref), 0)).await.unwrap();
    assert!(!completed(&out).ok);
    assert!(gh.branch_head(&repo, &format!("drafts/content-{brief_ref:x}")).is_none(), "no PR for a refused draft");
    let store = plan.plan_store(c).await.unwrap();
    let last = store["posts"]["work-item-1"].as_array().unwrap().last().unwrap().clone();
    assert_eq!(last["type"], json!("status"));
}
