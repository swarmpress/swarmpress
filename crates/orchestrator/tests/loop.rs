//! The MVP article loop through the orchestrator (docs/mvp.md), with the sim's
//! side played by the test: standup → work item → draft PR → review 6 →
//! revision → review 8 → publish (squash merge) → deploy landed.
//! MemStore + FakeLlm (a scripted standup, then the brief-driven fake writer
//! for the staged Draft and Review jobs, ADR-0058), with FakeGateway and with
//! GithubGateway(FakeGitHub). The site binding is the `cinqueterre-mini`
//! knowledge pack, so the article is checked against the site's closed world.

use std::sync::Arc;

use agents::fake_writer::{self, REVIEW_NOTE, REVISION_LINE};
use agents::{FakeLlm, FakeReply};
use github::{FakeGitHub, RepoId};
use orchestrator::{
    Digest, FakeGateway, Gateway, GithubGateway, JobKind, JobRequest, LlmProfile, MemStore,
    Orchestrator, Outcome, StaffRef, Store,
};
use serde_json::{json, Value};

mod common;
use common::{site, team, COMPANY};

const PATH: &str = "content/pages/blog/harvest-week-in-manarola.json";

/// The scripted standup, a pitch round (ADR-0062): the opening, Giulia's
/// and Isabella's pitches, the commission of Giulia's; every later call is
/// answered by the brief-driven fake writer.
fn standup() -> Vec<FakeReply> {
    vec![
        FakeReply::Text("Good morning. We can take on one new article today.".into()),
        FakeReply::Json(json!({
            "say": "The Sciacchetrà harvest starts Monday; I want to be on the Manarola terraces.",
            "title": "Harvest week in Manarola", "angle": "A day on the terraces with the pickers",
            "keywords": ["sciacchetrà", "manarola harvest"]})),
        FakeReply::Json(json!({
            "say": "Nobody writes about Vernazza before eight; the harbour is a different place then.",
            "title": "Vernazza harbour at first light",
            "angle": "What the harbour looks like before the first train arrives",
            "keywords": ["vernazza", "harbour"]})),
        FakeReply::Json(json!({
            "commission": [{"pitch": "P1", "target_words": 600}],
            "decisions": ["Giulia covers the harvest"], "escalations": []
        })),
    ]
}

fn fake() -> FakeLlm {
    fake_writer::fake_writer(standup())
}

/// The `## Task:` line of a recorded call.
fn task(call: &agents::llm::RecordedCall) -> String {
    call.request
        .messages
        .first()
        .and_then(|m| m.text.lines().next())
        .and_then(|l| l.strip_prefix("## Task: "))
        .unwrap_or("")
        .to_string()
}

fn job(job_id: u64, kind: JobKind, brief_ref: Option<u64>, revision: u8) -> JobRequest {
    JobRequest {
        company_id: COMPANY.into(),
        job_id,
        kind,
        project: "project-1".into(),
        work_item: (kind != JobKind::Standup).then(|| "work-item-1".to_string()),
        brief_ref,
        revision,
        staff: team(),
        meeting: None,
        context: Value::Null,
    }
}

fn completed(out: &[Outcome]) -> &Digest {
    match &out[0] {
        Outcome::JobCompleted { digest, .. } => digest,
        other => panic!("{other:?}"),
    }
}

/// Repo inspection, so the same loop runs over both gateways.
trait Repo {
    fn branch(&self, branch: &str) -> Option<String>;
    fn main_file(&self, path: &str) -> Option<String>;
}

impl Repo for FakeGateway {
    fn branch(&self, branch: &str) -> Option<String> {
        self.branch_head(branch)
    }
    fn main_file(&self, path: &str) -> Option<String> {
        self.file_text("main", path)
    }
}

struct Gh(Arc<FakeGitHub>, RepoId);

impl Repo for Gh {
    fn branch(&self, branch: &str) -> Option<String> {
        self.0.branch_head(&self.1, branch)
    }
    fn main_file(&self, path: &str) -> Option<String> {
        self.0.file_text(&self.1, "main", path)
    }
}

fn fake_github() -> (GithubGateway, Gh) {
    let gh = Arc::new(FakeGitHub::new());
    let repo = RepoId {
        owner: "swarmpress".into(),
        name: "cinqueterre.travel".into(),
    };
    gh.create_repo(&repo, &[("content/pages/index.json", "{}")]);
    (
        GithubGateway::new(gh.clone(), repo.clone(), "main"),
        Gh(gh, repo),
    )
}

async fn full_loop<G: Gateway>(gateway: G, repo: &dyn Repo) -> Orchestrator<MemStore, G> {
    let llm = Arc::new(fake());
    let orch = Orchestrator::new(MemStore::new(), gateway, llm.clone(), site());

    // 09:00 standup → one brief for Giulia, edited by Marco
    let out = orch.run(&job(1, JobKind::Standup, None, 0)).await.unwrap();
    let briefs = match &out[..] {
        [Outcome::MeetingOutcome { job_id: 1, briefs }] => briefs.clone(),
        other => panic!("{other:?}"),
    };
    assert_eq!(briefs.len(), 1);
    assert_eq!(
        (briefs[0].writer.as_str(), briefs[0].editor.as_str()),
        ("staff-1", "staff-5")
    );
    let brief_ref = briefs[0].brief_ref;
    assert_eq!(
        orch.store().transcripts(COMPANY).len(),
        4,
        "the opening, two pitches and the closing are in the transcript"
    );

    // The sim creates work-item-1 and requests the first draft.
    let out = orch
        .run(&job(2, JobKind::Draft, Some(brief_ref), 0))
        .await
        .unwrap();
    let d = completed(&out);
    assert!(d.ok && d.words > 10 && d.artifact_sha.is_some());
    // github::ContentRepo names draft branches `drafts/content-<content id>`.
    let art = orch
        .store()
        .get_artifact(COMPANY, "work-item-1")
        .await
        .unwrap()
        .expect("artifact stored");
    let branch = format!("drafts/content-content-{brief_ref:x}");
    assert_eq!(art["branch"], json!(branch));
    assert_eq!(
        repo.branch(&branch),
        art["head_sha"].as_str().map(String::from),
        "draft branch exists at the stored head"
    );
    assert_eq!(d.artifact_sha.as_deref(), art["head_sha"].as_str());
    assert!(repo.main_file(PATH).is_none(), "nothing on main yet");

    // Review 6 → the sim asks for a revision (it owns the rubric).
    let d = completed(
        &orch
            .run(&job(3, JobKind::Review, Some(brief_ref), 0))
            .await
            .unwrap(),
    )
    .clone();
    assert!(d.ok);
    assert_eq!(d.score, 6);

    let out = orch
        .run(&job(4, JobKind::Draft, Some(brief_ref), 1))
        .await
        .unwrap();
    assert!(completed(&out).ok);
    // The staged calls: the draft in stages, one review, a revision of the
    // one part the review names (ADR-0058).
    let tasks: Vec<String> = llm.calls().iter().skip(4).map(task).collect();
    assert_eq!(
        tasks,
        [
            "outline",
            "intro",
            "section s1 of 3",
            "section s2 of 3",
            "section s3 of 3",
            "closing",
            "review",
            "revise s2"
        ],
        "{tasks:?}"
    );
    let revise_prompt = &llm.calls()[11].request.messages[0].text;
    assert!(
        revise_prompt.contains(REVIEW_NOTE),
        "revision sees the review"
    );

    let d = completed(
        &orch
            .run(&job(5, JobKind::Review, Some(brief_ref), 1))
            .await
            .unwrap(),
    )
    .clone();
    assert_eq!(d.score, 8);
    // Every call fits the resident model's context.
    for call in llm.calls() {
        assert!(LlmProfile::LOCAL.fits(&call.request), "{}", task(&call));
    }

    // Publish: squash-merge, then the (simulated) deploy lands.
    let out = orch
        .run(&job(6, JobKind::Publish, Some(brief_ref), 1))
        .await
        .unwrap();
    let merged = completed(&out).clone();
    assert!(merged.ok && merged.artifact_sha.is_some());
    assert_eq!(
        out[1],
        Outcome::DeployLanded {
            work_item: "work-item-1".into()
        }
    );
    let live: Value = serde_json::from_str(&repo.main_file(PATH).expect("merged to main")).unwrap();
    assert_eq!(live["id"], json!(format!("content-{brief_ref:x}")));
    assert_eq!(
        live["slug"]["en"],
        json!("/en/blog/harvest-week-in-manarola")
    );
    assert!(
        live.to_string().contains(REVISION_LINE),
        "the revised draft is what shipped"
    );
    // The article shape for the frozen theme, valid in the site's closed world.
    let validator = orch.site().validator_v2.clone().unwrap();
    assert_eq!(validator.check(&live), vec![]);
    let body = live["body"].as_array().unwrap();
    assert_eq!(body[0]["type"], json!("editorial-hero"));
    assert_eq!(body.last().unwrap()["type"], json!("closing-note"));
    assert_eq!(live["slug"].as_object().unwrap().len(), 4);
    assert!(live["seo"]["title"]["en"]
        .as_str()
        .unwrap()
        .ends_with(" | The Dispatch"));

    // Publishing again is idempotent (no second merge, same sha).
    let again = orch
        .run(&job(6, JobKind::Publish, Some(brief_ref), 1))
        .await
        .unwrap();
    assert_eq!(completed(&again), &merged);

    // The plan thread tells the story, in order.
    let store = orch.store().plan_json(COMPANY).await.unwrap();
    assert_eq!(
        store["items"]["work-item-1"]["title"],
        json!("Harvest week in Manarola")
    );
    let posts = store["posts"]["work-item-1"].as_array().unwrap();
    let kinds: Vec<&str> = posts.iter().map(|p| p["type"].as_str().unwrap()).collect();
    assert_eq!(
        kinds,
        [
            "minutes", "artifact", "handoff", "review", "artifact", "handoff", "review",
            "artifact", "status"
        ],
        "{kinds:?}"
    );
    assert_eq!(posts[2]["author"], json!("staff-1"));
    assert_eq!(posts[2]["to"], json!("staff-5"));
    assert_eq!(posts[3]["author"], json!("staff-5"));
    assert_eq!(posts[3]["payload"]["verdict"], json!("changes"));
    assert_eq!(posts[6]["payload"]["verdict"], json!("approve"));
    assert_eq!(
        posts[3]["payload"]["issues"],
        json!([{"section": "s2", "problem": REVIEW_NOTE, "fix": fake_writer::REVIEW_FIX}]),
        "the review's issues are tagged by part"
    );
    assert_eq!(llm.remaining(), 0, "every scripted call was used");
    assert_eq!(llm.calls().len(), 4 + 6 + 1 + 1 + 1);
    orch
}

#[tokio::test]
async fn standup_to_published_article() {
    let gw = Arc::new(FakeGateway::new());
    let orch = full_loop(gw.clone(), gw.as_ref()).await;
    assert_eq!(
        orch.gateway().merge_count(),
        1,
        "publish merged exactly once"
    );
}

#[tokio::test]
async fn standup_to_published_article_over_github_gateway() {
    let (gw, repo) = fake_github();
    full_loop(gw, &repo).await;
}

async fn refused<G: Gateway>(gateway: G, repo: &dyn Repo) {
    let mut s = standup();
    s.push(FakeReply::Error(agents::LlmError::Refusal {
        category: Some("other".into()),
        explanation: None,
    }));
    let llm = Arc::new(fake_writer::fake_writer(s));
    let orch = Orchestrator::new(MemStore::new(), gateway, llm, site());
    let out = orch.run(&job(1, JobKind::Standup, None, 0)).await.unwrap();
    let brief_ref = match &out[0] {
        Outcome::MeetingOutcome { briefs, .. } => briefs[0].brief_ref,
        o => panic!("{o:?}"),
    };
    let out = orch
        .run(&job(2, JobKind::Draft, Some(brief_ref), 0))
        .await
        .unwrap();
    assert!(!completed(&out).ok);
    assert!(
        repo.branch(&format!("drafts/content-content-{brief_ref:x}"))
            .is_none(),
        "no PR for a refused draft"
    );
    let store = orch.store().plan_json(COMPANY).await.unwrap();
    let last = store["posts"]["work-item-1"]
        .as_array()
        .unwrap()
        .last()
        .unwrap()
        .clone();
    assert_eq!(last["type"], json!("status"));
}

#[tokio::test]
async fn refused_draft_reports_not_ok_and_posts_status() {
    let gw = Arc::new(FakeGateway::new());
    refused(gw.clone(), gw.as_ref()).await;
}

#[tokio::test]
async fn refused_draft_over_github_gateway() {
    let (gw, repo) = fake_github();
    refused(gw, &repo).await;
}

#[tokio::test]
async fn review_before_draft_is_an_invalid_job() {
    let llm = Arc::new(fake());
    let orch = Orchestrator::new(MemStore::new(), FakeGateway::new(), llm, site());
    let out = orch.run(&job(1, JobKind::Standup, None, 0)).await.unwrap();
    let Outcome::MeetingOutcome { briefs, .. } = &out[0] else {
        panic!("{out:?}")
    };
    let err = orch
        .run(&job(2, JobKind::Review, Some(briefs[0].brief_ref), 0))
        .await
        .unwrap_err();
    assert!(
        matches!(err, orchestrator::OrchestratorError::Invalid(_)),
        "{err}"
    );
}

/// The sim staffs each job with the people doing it (docs/mvp.md): the whole
/// team for the standup, only the writer for a draft, only the editor for a
/// review, an IT engineer for the publish. The orchestrator takes the other
/// side's persona from the brief record.
#[tokio::test]
async fn sim_shaped_staffing_runs_the_whole_loop() {
    let llm = Arc::new(fake());
    let gw = Arc::new(FakeGateway::new());
    let orch = Orchestrator::new(MemStore::new(), gw.clone(), llm, site());
    let out = orch.run(&job(1, JobKind::Standup, None, 0)).await.unwrap();
    let Outcome::MeetingOutcome { briefs, .. } = &out[0] else {
        panic!("{out:?}")
    };
    let brief_ref = briefs[0].brief_ref;
    let only = |id: &str, persona: &str, role: &str| {
        vec![StaffRef {
            id: id.into(),
            persona: persona.into(),
            role: role.into(),
        }]
    };
    let staffed = |job_id, kind, revision, staff: Vec<StaffRef>| JobRequest {
        staff,
        ..job(job_id, kind, Some(brief_ref), revision)
    };
    let writer = only("staff-1", "giulia", "writer");
    let editor = only("staff-5", "marco", "editor");
    for (job_id, kind, revision, staff) in [
        (2, JobKind::Draft, 0, writer.clone()),
        (3, JobKind::Review, 0, editor.clone()),
        (4, JobKind::Draft, 1, writer),
        (5, JobKind::Review, 1, editor),
        (
            6,
            JobKind::Publish,
            1,
            only("staff-11", "davide", "it-engineer"),
        ),
    ] {
        let out = orch
            .run(&staffed(job_id, kind, revision, staff))
            .await
            .unwrap_or_else(|e| panic!("job {job_id}: {e}"));
        assert!(completed(&out).ok, "job {job_id}: {out:?}");
    }
    assert_eq!(gw.merge_count(), 1);
    let plan = orch.store().plan_json(COMPANY).await.unwrap();
    let posts = plan["posts"]["work-item-1"].as_array().unwrap();
    assert_eq!(
        posts[2]["to"],
        json!("staff-5"),
        "the handoff still names the editor"
    );
}
