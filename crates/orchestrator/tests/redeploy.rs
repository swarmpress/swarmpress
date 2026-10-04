//! A publish job for an item whose deploy failed (FEAT-085, ADR-0059,
//! ADR-0061): the CEO's `Retry` on the `DeployFailed` ticket requests the
//! Publish job again. The merge is done, so the job asks the gateway to
//! deploy again instead, and completes; the sim then waits for `DeployLanded`
//! (or a new `DeployFailed`). The signal is the gateway's deploy state, not
//! the sim. With `FakeGateway`.

use std::sync::Arc;

use agents::FakeLlm;
use orchestrator::{
    DeployState, FakeGateway, Gateway, JobFailure, JobKind, JobRequest, MemStore, Orchestrator,
    OrchestratorError, Outcome, SiteBinding, Store,
};
use serde_json::{json, Value};

mod common;
use common::{binding_json, mini_pack_json, team, COMPANY};

const ITEM: &str = "work-item-1";
const PATH: &str = "content/pages/blog/harvest-week-in-manarola.json";

/// The binding with deploys observed (not simulated).
fn site() -> SiteBinding {
    SiteBinding::from_json(&binding_json(
        &mini_pack_json(),
        json!({"simulate_deploy": false}),
    ))
    .unwrap()
}

fn publish(job_id: u64) -> JobRequest {
    JobRequest {
        company_id: COMPANY.into(),
        job_id,
        kind: JobKind::Publish,
        project: "project-1".into(),
        work_item: Some(ITEM.into()),
        brief_ref: Some(1),
        revision: 0,
        staff: team(),
        meeting: None,
        context: Value::Null,
        approved_by: None,
    }
}

/// An orchestrator whose item was drafted and merged (PR #1) by an earlier
/// publish job; returns it and the merge sha.
async fn merged() -> (
    Orchestrator<MemStore, Arc<FakeGateway>>,
    Arc<FakeGateway>,
    String,
) {
    let gw = Arc::new(FakeGateway::new());
    let pr = gw
        .open_draft("content-1", PATH, &json!({"id": "content-1"}), "Draft")
        .await
        .unwrap();
    let sha = gw.merge(pr.number, &pr.head_sha).await.unwrap();
    let orch = Orchestrator::new(
        MemStore::new(),
        gw.clone(),
        Arc::new(FakeLlm::new(vec![])),
        site(),
    );
    orch.store()
        .put_artifact(
            COMPANY,
            ITEM,
            json!({"brief_ref": 1, "path": PATH, "branch": pr.branch, "pr_number": pr.number,
                   "head_sha": pr.head_sha, "merged_sha": sha}),
        )
        .await
        .unwrap();
    (orch, gw, sha)
}

fn completed_with(out: &[Outcome], sha: &str) {
    match out {
        [Outcome::JobCompleted { digest, .. }] => {
            assert!(digest.ok);
            assert_eq!(digest.artifact_sha.as_deref(), Some(sha));
        }
        other => panic!("{other:?}"),
    }
}

async fn status_posts(orch: &Orchestrator<MemStore, Arc<FakeGateway>>) -> Vec<String> {
    let plan = orch.store().plan_json(COMPANY).await.unwrap();
    plan["posts"][ITEM]
        .as_array()
        .map(|p| {
            p.iter()
                .filter(|p| p["type"] == "status")
                .map(|p| p["text"].as_str().unwrap_or_default().to_string())
                .collect()
        })
        .unwrap_or_default()
}

#[tokio::test]
async fn a_retry_after_a_failed_deploy_redeploys_instead_of_merging() {
    let (orch, gw, sha) = merged().await;
    gw.set_deploy_state(1, DeployState::Failed);

    let out = orch.run(&publish(7)).await.unwrap();
    // Completed with the merge it already had; no DeployLanded of its own:
    // the sim waits for the deploy.
    completed_with(&out, &sha);
    assert_eq!(gw.merge_count(), 1, "no second merge");
    assert_eq!(gw.redeploy_count(1), 1);
    assert_eq!(
        gw.deploy_state(1).await.unwrap(),
        Some(DeployState::Pending)
    );
    assert_eq!(
        status_posts(&orch).await,
        ["PR #1: its deploy failed; deploying it again."]
    );

    // The same job runs again (a reload before its outcome was logged): the
    // merge is pending, nothing is requested twice, nothing is posted twice.
    completed_with(&orch.run(&publish(7)).await.unwrap(), &sha);
    assert_eq!(gw.redeploy_count(1), 1);
    assert_eq!(status_posts(&orch).await.len(), 1);

    // It failed again: the next Retry redeploys again.
    gw.set_deploy_state(1, DeployState::Failed);
    completed_with(&orch.run(&publish(9)).await.unwrap(), &sha);
    assert_eq!(gw.redeploy_count(1), 2);
}

#[tokio::test]
async fn a_merge_that_did_not_fail_is_not_redeployed() {
    let (orch, gw, sha) = merged().await;
    // Not observed (a gateway without deploy observation), pending, landed.
    completed_with(&orch.run(&publish(7)).await.unwrap(), &sha);
    for state in [DeployState::Pending, DeployState::Landed] {
        gw.set_deploy_state(1, state);
        completed_with(&orch.run(&publish(8)).await.unwrap(), &sha);
    }
    assert_eq!(gw.redeploy_count(1), 0);
    assert!(status_posts(&orch).await.is_empty());
}

#[tokio::test]
async fn a_refused_redeploy_fails_the_job_loudly_with_the_reason() {
    let (orch, gw, sha) = merged().await;
    gw.set_deploy_state(1, DeployState::Failed);
    gw.refuse_next_redeploy(
        "GitHub refused to re-run the deploy workflow: Resource not accessible by integration",
    );
    // An error: the host retries, then reports JobFailed{Infrastructure}, so
    // the item stays blocked with a ticket (rule 11).
    let err = orch.run(&publish(7)).await.unwrap_err();
    assert!(
        matches!(&err, OrchestratorError::Gateway(e) if e.0.contains("Resource not accessible")),
        "{err:?}"
    );
    assert_eq!(gw.deploy_state(1).await.unwrap(), Some(DeployState::Failed));
    assert_eq!(
        status_posts(&orch).await,
        [
            "PR #1: the deploy could not be run again: GitHub refused to re-run the deploy \
          workflow: Resource not accessible by integration"
        ]
    );
    // Once GitHub allows it, the next attempt goes through.
    completed_with(&orch.run(&publish(7)).await.unwrap(), &sha);
    assert_eq!(gw.redeploy_count(1), 1);
}

#[tokio::test]
async fn a_cancelled_retry_asks_nothing() {
    let (orch, gw, _sha) = merged().await;
    gw.set_deploy_state(1, DeployState::Failed);
    orch.cancel(7, JobFailure::Timeout);
    assert_eq!(
        orch.run(&publish(7)).await.unwrap(),
        [Outcome::JobFailed {
            job_id: 7,
            reason: JobFailure::Timeout
        }]
    );
    assert_eq!(gw.redeploy_count(1), 0);
}
