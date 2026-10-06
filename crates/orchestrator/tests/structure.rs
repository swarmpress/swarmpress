//! The architects (ADR-0072, FEAT-095): a structural item drafted by the
//! fake model against the site's models, the checker's issues given back for
//! one repair turn, the proposal kept as the item's artifact and applied by
//! its Publish only; a stale base, an answer that never checks and the theme
//! fail loudly. The last test runs the sim's gate around the jobs: nothing
//! reaches the site before the CEO approves, and the default never applies.

use std::collections::BTreeMap;
use std::sync::Arc;

use agents::{fake_writer, FakeLlm, FakeReply};
use blueprint::site::SiteContext;
use blueprint::Blueprint;
use orchestrator::{
    structure_brief, ArtifactRecord, Digest, FakeGateway, FakeSite, JobFailure, JobKind,
    JobRequest, MemStore, Orchestrator, Outcome, StaffRef, Store,
};
use serde_json::{json, Value};

mod common;
use common::{site, COMPANY};

const ITEM: &str = "work-item-5";
const BRIEF: u64 = 7001;

fn fixture(path: &str) -> Value {
    serde_json::from_str(
        &std::fs::read_to_string(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../blueprint/tests/fixtures")
                .join(path),
        )
        .unwrap(),
    )
    .unwrap()
}

/// The `cinqueterre-mini` blueprint with its types and the ferry tool's.
fn fake_site() -> FakeSite {
    let mini = fixture("cinqueterre-mini.blueprint.json");
    let mut types: BTreeMap<String, Value> = serde_json::from_value(mini["types"].clone()).unwrap();
    for t in ["FerryDeparture", "FerryRow", "FerryTimetable"] {
        types.insert(t.into(), fixture(&format!("site/blueprint/types/{t}.json")));
    }
    FakeSite::new(
        Blueprint::from_value(&mini["blueprint"]).unwrap(),
        types,
        SiteContext {
            custom_blocks: vec![],
            sections: [
                "blog",
                "hikes",
                "itinerary",
                "restaurants",
                "transportation",
            ]
            .map(String::from)
            .to_vec(),
            collections: ["hikes", "restaurants"].map(String::from).to_vec(),
        },
    )
}

fn ux() -> StaffRef {
    StaffRef {
        id: "staff-3".into(),
        persona: "rafael".into(),
        role: "ux-designer".into(),
    }
}

fn webdev() -> StaffRef {
    StaffRef {
        id: "staff-10".into(),
        persona: "andrei".into(),
        role: "web-developer".into(),
    }
}

fn job(job_id: u64, kind: JobKind, revision: u8, who: StaffRef) -> JobRequest {
    JobRequest {
        company_id: COMPANY.into(),
        job_id,
        kind,
        project: "project-1".into(),
        work_item: Some(ITEM.into()),
        brief_ref: Some(BRIEF),
        revision,
        staff: vec![who],
        meeting: None,
        context: Value::Null,
        approved_by: (kind == JobKind::Publish).then(|| "The CEO".into()),
    }
}

async fn orch(llm: Arc<FakeLlm>, kind: &str, request: &str) -> Orchestrator<MemStore, FakeGateway> {
    let gateway = FakeGateway::new();
    gateway.set_site(fake_site());
    let o = Orchestrator::new(MemStore::new(), gateway, llm, site());
    o.store()
        .put_brief(COMPANY, BRIEF, structure_brief(kind, request))
        .await
        .unwrap();
    o
}

fn completed(out: &[Outcome]) -> &Digest {
    match out {
        [Outcome::JobCompleted { digest, .. }] => digest,
        other => panic!("not one JobCompleted: {other:?}"),
    }
}

fn failed(out: &[Outcome]) -> JobFailure {
    match out {
        [Outcome::JobFailed { reason, .. }] => *reason,
        other => panic!("not one JobFailed: {other:?}"),
    }
}

async fn artifact(o: &Orchestrator<MemStore, FakeGateway>) -> ArtifactRecord {
    serde_json::from_value(
        o.store()
            .get_artifact(COMPANY, ITEM)
            .await
            .unwrap()
            .unwrap(),
    )
    .unwrap()
}

async fn posts(o: &Orchestrator<MemStore, FakeGateway>) -> Vec<Value> {
    o.store().plan_json(COMPANY).await.unwrap()["posts"][ITEM]
        .as_array()
        .cloned()
        .unwrap_or_default()
}

fn page_types(o: &Orchestrator<MemStore, FakeGateway>) -> Vec<String> {
    o.gateway()
        .site()
        .unwrap()
        .blueprint
        .page_types
        .iter()
        .map(|t| t.id.clone())
        .collect()
}

#[tokio::test]
async fn the_architect_proposes_an_author_page_type_and_its_publish_applies_it() {
    let llm = Arc::new(fake_writer::fake_writer([]));
    let o = orch(
        llm.clone(),
        "structure",
        "Add an author page type and link articles to it",
    )
    .await;
    let out = o.run(&job(10, JobKind::Architect, 0, ux())).await.unwrap();
    let d = completed(&out);
    assert!(d.ok);
    assert_eq!((d.score, d.words, d.qa_defects), (2, 0, 0));

    // The model saw the request, the blueprint and the closed block list, with the architect's prompt.
    let calls = llm.calls();
    assert_eq!(calls.len(), 1);
    let user = &calls[0].request.messages[0].text;
    assert!(user.starts_with("## Task: site architect"));
    assert!(user.contains("Add an author page type"));
    assert!(user.contains("- blog-article «"));
    assert!(user.contains("team-grid"));
    assert!(calls[0].request.system[0].contains("Information Architect"));
    assert_eq!(calls[0].request.profile.job, agents::JobKind::SiteArchitect);

    // The proposal is the item's artifact; nothing has reached the site.
    let art = artifact(&o).await;
    let p = art.structure.clone().unwrap();
    assert_eq!(p.kind, "structure");
    assert_eq!(p.changes.len(), 2, "{:?}", p.changes);
    assert_eq!(d.artifact_sha.as_deref(), Some(p.hash.as_str()));
    assert_eq!(p.base_hash, blueprint::hash(&fake_site().blueprint));
    assert_eq!(o.gateway().site().unwrap().writes, 0);
    assert!(!page_types(&o).contains(&"author".to_string()));

    // The thread has the summary and the change list; the plan text the item's title.
    let ps = posts(&o).await;
    assert_eq!(ps.len(), 1);
    assert_eq!(ps[0]["type"], "artifact");
    assert_eq!(ps[0]["author"], "staff-3");
    let text = ps[0]["text"].as_str().unwrap();
    assert!(text.contains("added page-type author"), "{text}");
    assert!(
        text.contains("added relationship blog-article>author:written-by"),
        "{text}"
    );
    assert_eq!(
        ps[0]["payload"]["structure"]["changes"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    let plan = o.store().plan_json(COMPANY).await.unwrap();
    assert!(plan["items"][ITEM]["title"]
        .as_str()
        .unwrap()
        .starts_with("Structure: Add an author page type"));

    // Run again (a reload): the stored stage is reused, no second call or post.
    let again = o.run(&job(10, JobKind::Architect, 0, ux())).await.unwrap();
    assert_eq!(again, out);
    assert_eq!(llm.calls().len(), 1);
    assert_eq!(posts(&o).await.len(), 1);

    // Publish (after the CEO's Approve) applies it: one write, no deploy to wait for.
    let out = o.run(&job(11, JobKind::Publish, 0, ux())).await.unwrap();
    let d = completed(&out);
    assert!(d.ok);
    let commit = d.artifact_sha.clone().unwrap();
    assert_eq!(o.gateway().site().unwrap().writes, 1);
    assert!(page_types(&o).contains(&"author".to_string()));
    assert!(o
        .gateway()
        .site()
        .unwrap()
        .blueprint
        .relationships
        .iter()
        .any(|r| r.from == "blog-article" && r.to == "author"));
    assert_eq!(
        artifact(&o).await.merged_sha.as_deref(),
        Some(commit.as_str())
    );
    assert!(posts(&o).await.iter().any(|p| p["text"]
        .as_str()
        .unwrap()
        .starts_with("Applied to the site: 2 changes")));
    // Again: nothing is written twice.
    let again = o.run(&job(11, JobKind::Publish, 0, ux())).await.unwrap();
    assert_eq!(
        completed(&again).artifact_sha.as_deref(),
        Some(commit.as_str())
    );
    assert_eq!(o.gateway().site().unwrap().writes, 1);
    // An article's publish path is untouched: no structural record, no structural apply.
    assert!(o.gateway().merge_count() == 0);
}

#[tokio::test]
async fn unknown_block_ids_come_back_for_one_repair_turn() {
    let mut bad: Value = json!({
        "summary": "Adds author pages with a profile.",
        "edits": [{"op": "add-page-type", "id": "author", "label": "Author", "route": "/{lang}/authors/{slug}",
                   "slots": [{"id": "profile", "blocks": ["team-grids"], "min": 1, "max": 1}]}]
    });
    // An unknown block id (outside the schema's closed enum): its issue goes back, once.
    let llm = Arc::new(fake_writer::fake_writer([FakeReply::Json(bad.clone())]));
    let o = orch(llm.clone(), "structure", "Add an author page type").await;
    let out = o.run(&job(20, JobKind::Architect, 0, ux())).await.unwrap();
    let d = completed(&out);
    assert!(d.ok);
    assert_eq!(d.qa_defects, 1, "the first answer's issue, repaired");
    let calls = llm.calls();
    assert_eq!(calls.len(), 2);
    let repair = |c: &agents::llm::RecordedCall| {
        c.request
            .messages
            .iter()
            .map(|m| m.text.clone())
            .collect::<Vec<_>>()
            .join("\n")
    };
    assert!(
        repair(&calls[1]).contains("team-grids"),
        "{}",
        repair(&calls[1])
    );

    // A schema-valid answer the checker refuses (a route without its leading /):
    // the checker's issue, by its path, goes back.
    let mut routed = bad.clone();
    routed["edits"][0]["slots"][0]["blocks"] = json!(["team-grid"]);
    routed["edits"][0]["route"] = json!("authors/{slug}");
    let llm = Arc::new(fake_writer::fake_writer([FakeReply::Json(routed)]));
    let o = orch(llm.clone(), "structure", "Add an author page type").await;
    let out = o.run(&job(22, JobKind::Architect, 0, ux())).await.unwrap();
    assert_eq!(completed(&out).qa_defects, 1);
    let calls = llm.calls();
    assert_eq!(calls.len(), 2);
    let text = repair(&calls[1]);
    assert!(text.contains("/page_types/6/route"), "{text}");
    assert!(text.contains("must start with /"), "{text}");
    let p = artifact(&o).await.structure.unwrap();
    assert_eq!(p.repaired.len(), 1);
    assert!(p.repaired[0].contains("route"));

    // Two answers that never check: the job fails loudly, with the issues in the thread.
    bad["edits"][0]["slots"][0]["blocks"] = json!(["team-grids"]);
    let mut worse = bad.clone();
    worse["edits"][0]["slots"][0]["blocks"] = json!(["team-gridz"]);
    let llm = Arc::new(FakeLlm::new([FakeReply::Json(bad), FakeReply::Json(worse)]));
    let o = orch(llm.clone(), "structure", "Add an author page type").await;
    let out = o.run(&job(21, JobKind::Architect, 0, ux())).await.unwrap();
    assert_eq!(failed(&out), JobFailure::InvalidOutput);
    assert_eq!(llm.calls().len(), 2, "one repair turn, no more");
    let ps = posts(&o).await;
    assert_eq!(ps.len(), 1);
    assert_eq!(ps[0]["type"], "status");
    assert!(ps[0]["text"].as_str().unwrap().contains("team-gridz"));
    assert!(o
        .store()
        .get_artifact(COMPANY, ITEM)
        .await
        .unwrap()
        .is_none());
    assert_eq!(o.gateway().site().unwrap().writes, 0);
}

#[tokio::test]
async fn a_refusal_or_a_lost_model_is_never_a_proposal() {
    let refused = FakeReply::Error(agents::LlmError::Refusal {
        category: None,
        explanation: Some("no".into()),
    });
    let llm = Arc::new(FakeLlm::new([refused]));
    let o = orch(llm, "structure", "Add an author page type").await;
    let out = o.run(&job(30, JobKind::Architect, 0, ux())).await.unwrap();
    assert_eq!(failed(&out), JobFailure::Model);

    let gone = FakeReply::Error(agents::LlmError::Unavailable("device lost".into()));
    let llm = Arc::new(FakeLlm::new([gone]));
    let o = orch(llm, "structure", "Add an author page type").await;
    let err = o
        .run(&job(31, JobKind::Architect, 0, ux()))
        .await
        .unwrap_err();
    assert!(matches!(
        err,
        orchestrator::OrchestratorError::Unavailable(_)
    ));

    // A site whose models cannot be read: an error the host retries, then reports.
    let llm = Arc::new(fake_writer::fake_writer([]));
    let o = Orchestrator::new(MemStore::new(), FakeGateway::new(), llm, site());
    o.store()
        .put_brief(COMPANY, BRIEF, structure_brief("structure", "Add authors"))
        .await
        .unwrap();
    assert!(o.run(&job(32, JobKind::Architect, 0, ux())).await.is_err());
}

#[tokio::test]
async fn a_blueprint_changed_meanwhile_is_not_overwritten() {
    let llm = Arc::new(fake_writer::fake_writer([]));
    let o = orch(llm.clone(), "structure", "Add an author page type").await;
    assert!(completed(&o.run(&job(40, JobKind::Architect, 0, ux())).await.unwrap()).ok);
    // The CEO edits the blueprint on the canvas before approving.
    o.gateway().edit_site(|s| {
        s.blueprint.navigation.pop();
    });
    let out = o.run(&job(41, JobKind::Publish, 0, ux())).await.unwrap();
    assert_eq!(failed(&out), JobFailure::InvalidOutput);
    assert!(!page_types(&o).contains(&"author".to_string()));
    assert_eq!(o.gateway().site().unwrap().writes, 1, "only the CEO's edit");
    let ps = posts(&o).await;
    assert!(ps.iter().any(|p| p["text"]
        .as_str()
        .unwrap()
        .contains("The blueprint changed meanwhile")));
    assert!(artifact(&o).await.merged_sha.is_none());

    // Sent back with a note, the revision works on the new base and names the old proposal and the note.
    o.store()
        .append_post(
            COMPANY,
            ITEM,
            json!({"type": "status", "author": "ceo", "text": "Call the slot bio, please.",
                   "payload": {"ui_type": "send-back-note"}}),
        )
        .await
        .unwrap();
    let out = o.run(&job(42, JobKind::Architect, 1, ux())).await.unwrap();
    assert!(completed(&out).ok);
    let prompt = llm.calls().last().unwrap().request.messages[0].text.clone();
    assert!(prompt.contains("Your previous proposal"), "{prompt}");
    assert!(
        prompt.contains("The CEO's note: Call the slot bio, please."),
        "{prompt}"
    );
    let p = artifact(&o).await.structure.unwrap();
    assert_eq!(
        p.base_hash,
        blueprint::hash(&o.gateway().site().unwrap().blueprint)
    );
    assert!(completed(&o.run(&job(43, JobKind::Publish, 1, ux())).await.unwrap()).ok);
    assert!(page_types(&o).contains(&"author".to_string()));
}

#[tokio::test]
async fn the_web_developer_builds_a_tool_and_its_publish_installs_it() {
    let llm = Arc::new(fake_writer::fake_writer([]));
    let o = orch(
        llm.clone(),
        "tool",
        "Show the next ferries from each village",
    )
    .await;
    let out = o
        .run(&job(50, JobKind::ToolBuild, 0, webdev()))
        .await
        .unwrap();
    let d = completed(&out);
    assert!(d.ok);
    assert_eq!(d.score, 1);
    let calls = llm.calls();
    assert!(calls[0].request.messages[0]
        .text
        .starts_with("## Task: tool build"));
    assert!(calls[0].request.messages[0]
        .text
        .contains("- FerryDeparture: "));
    assert_eq!(calls[0].request.profile.job, agents::JobKind::ToolBuild);
    let p = artifact(&o).await.structure.unwrap();
    assert_eq!(p.kind, "tool");
    assert_eq!(p.graph["id"], "ferry-times");
    assert_eq!(
        p.changes,
        vec![json!({"kind": "added", "subject": "tool", "id": "ferry-times"})]
    );
    assert!(
        o.gateway().site().unwrap().tools.is_empty(),
        "nothing installed before approval"
    );
    let text = posts(&o).await[0]["text"].as_str().unwrap().to_string();
    assert!(text.contains("added tool ferry-times"), "{text}");

    let out = o
        .run(&job(51, JobKind::Publish, 0, webdev()))
        .await
        .unwrap();
    assert!(completed(&out).ok);
    let installed = o.gateway().site().unwrap().tools;
    assert_eq!(installed.keys().collect::<Vec<_>>(), vec!["ferry-times"]);
    assert_eq!(installed["ferry-times"].hash(), p.hash);

    // The same tool again changes nothing: the builder is told, and fails loudly after the repair.
    let o2 = Orchestrator::new(
        MemStore::new(),
        FakeGateway::new(),
        Arc::new(fake_writer::fake_writer([])),
        site(),
    );
    o2.gateway().set_site(o.gateway().site().unwrap());
    o2.store()
        .put_brief(COMPANY, BRIEF, structure_brief("tool", "Ferries again"))
        .await
        .unwrap();
    let out = o2
        .run(&job(52, JobKind::ToolBuild, 0, webdev()))
        .await
        .unwrap();
    assert_eq!(failed(&out), JobFailure::InvalidOutput);
}

#[tokio::test]
async fn a_site_without_the_ferry_types_gets_a_tool_of_built_in_types() {
    let llm = Arc::new(fake_writer::fake_writer([]));
    let gateway = FakeGateway::new();
    let mut s = fake_site();
    s.types.retain(|k, _| !k.starts_with("Ferry"));
    gateway.set_site(s);
    let o = Orchestrator::new(MemStore::new(), gateway, llm, site());
    o.store()
        .put_brief(
            COMPANY,
            BRIEF,
            structure_brief("tool", "List our newest pages"),
        )
        .await
        .unwrap();
    let out = o
        .run(&job(55, JobKind::ToolBuild, 0, webdev()))
        .await
        .unwrap();
    assert!(completed(&out).ok);
    assert_eq!(
        artifact(&o).await.structure.unwrap().graph["id"],
        "latest-pages"
    );
}

#[tokio::test]
async fn the_theme_and_tool_runs_fail_loudly() {
    let llm = Arc::new(fake_writer::fake_writer([]));
    let o = orch(llm.clone(), "theme", "Regenerate the theme").await;
    let out = o
        .run(&job(60, JobKind::ThemeCode, 0, webdev()))
        .await
        .unwrap();
    assert_eq!(failed(&out), JobFailure::Infrastructure);
    assert!(llm.calls().is_empty());
    let ps = posts(&o).await;
    assert!(ps[0]["text"].as_str().unwrap().contains("FEAT-094"));

    let mut run = job(61, JobKind::ToolRun, 0, webdev());
    run.work_item = None;
    let out = o.run(&run).await.unwrap();
    assert_eq!(failed(&out), JobFailure::Infrastructure);
}

// ---------------------------------------------------------------- with the sim's gate

mod gate {
    use super::*;
    use sim_core::clock::SimConfig;
    use sim_core::commands::{Command, JobDigest, ServerCommand};
    use sim_core::ids::{StaffId, WorkItemId};
    use sim_core::inbox::{TicketKind, TicketOption};
    use sim_core::plan::{Effect, JobKind as SimJob, WorkItemKind, WorkItemStatus};
    use sim_core::projects::ProjectStatus;
    use sim_core::roles::Role;
    use sim_core::scenarios::demo_office_with_config;
    use sim_core::World;

    const UX: StaffId = StaffId(3);

    fn world() -> World {
        let mut w = demo_office_with_config(
            7,
            SimConfig {
                day_real_minutes: 1,
                ..SimConfig::default()
            },
        );
        w.staff.get_mut(&UX).unwrap().role = Role::UxDesigner;
        w
    }

    /// The next request of `kind`, as the orchestrator's job request.
    fn until(w: &mut World, kind: SimJob) -> (u64, WorkItemId, JobRequest) {
        for _ in 0..40_000 {
            for e in w.drain_effects() {
                let Effect::RequestJob {
                    job_id,
                    kind: k,
                    work_item,
                    brief_ref,
                    revision,
                    ..
                } = e;
                if k == kind {
                    let item = work_item.unwrap();
                    let orch_kind = match k {
                        SimJob::Architect => JobKind::Architect,
                        _ => JobKind::Publish,
                    };
                    let mut req = job(job_id, orch_kind, revision, ux());
                    req.work_item = Some(ITEM.into());
                    req.brief_ref = brief_ref;
                    return (job_id, item, req);
                }
            }
            w.step();
        }
        panic!("no {kind:?} job");
    }

    fn report(w: &mut World, out: &[Outcome]) {
        let Outcome::JobCompleted { job_id, digest } = &out[0] else {
            panic!("{out:?}")
        };
        w.apply_server(ServerCommand::JobCompleted {
            job_id: *job_id,
            digest: JobDigest {
                ok: digest.ok,
                score: digest.score,
                words: digest.words,
                qa_defects: digest.qa_defects,
                artifact_sha: [0; 16],
            },
        })
        .unwrap();
    }

    fn approval(w: &World, item: WorkItemId) -> Option<sim_core::ids::TicketId> {
        w.tickets
            .values()
            .find(|t| {
                t.is_open() && t.kind == TicketKind::StructureApproval && t.work_item == Some(item)
            })
            .map(|t| t.id)
    }

    fn steps_until(w: &mut World, f: impl Fn(&World) -> bool) {
        for _ in 0..40_000 {
            if f(w) {
                return;
            }
            w.step();
        }
        panic!("condition never held");
    }

    #[tokio::test]
    async fn nothing_changes_before_the_ceo_approves_and_the_default_never_applies() {
        let mut w = world();
        let project = w
            .projects
            .values()
            .find(|p| p.status == ProjectStatus::Active)
            .unwrap()
            .id;
        let o = orch(
            Arc::new(fake_writer::fake_writer([])),
            "structure",
            "Add an author page type",
        )
        .await;
        w.apply(Command::Commission {
            project,
            kind: WorkItemKind::Structure,
            brief_ref: BRIEF,
        })
        .unwrap();
        let (_, item, req) = until(&mut w, SimJob::Architect);
        let out = o.run(&req).await.unwrap();
        report(&mut w, &out);
        steps_until(&mut w, |w| approval(w, item).is_some());

        // Unanswered: the ticket's default (Defer) applies at its deadline; nothing is written.
        let first = approval(&w, item).unwrap();
        steps_until(&mut w, |w| approval(w, item).is_some_and(|t| t != first));
        assert!(w.plan.items[&item].awaiting_approval());
        assert!(!w.plan.jobs.values().any(|j| j.work_item == Some(item)));
        assert_eq!(o.gateway().site().unwrap().writes, 0);
        assert!(!page_types(&o).contains(&"author".to_string()));

        // The CEO approves: the Publish job applies it, and the item is Published.
        let t = approval(&w, item).unwrap();
        w.apply(Command::AnswerTicket {
            ticket: t,
            option: TicketOption::Approve,
        })
        .unwrap();
        let (_, on, req) = until(&mut w, SimJob::Publish);
        assert_eq!(on, item);
        let out = o.run(&req).await.unwrap();
        assert_eq!(out.len(), 1, "no deploy for a structural item: {out:?}");
        report(&mut w, &out);
        steps_until(&mut w, |w| {
            w.plan.items[&item].status == WorkItemStatus::Published
        });
        assert_eq!(o.gateway().site().unwrap().writes, 1);
        assert!(page_types(&o).contains(&"author".to_string()));
    }
}
