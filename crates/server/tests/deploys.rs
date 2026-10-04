//! Deploy observation (ADR-0061 decision 7): the poller, the "at or before"
//! mapping for the poller and the webhook, `GET /api/gateway/deploy-status`,
//! and the rule that the poller only ever runs against a real GitHub.
//!
//! The poller's round (`deploys::poll_once`) is driven by hand here, against
//! the in-memory GitHub and the manual clock; the background task itself is
//! exercised against a wiremock GitHub.

mod common;

use std::time::Duration;

use common::{GatewayPlayer, Opts, TestServer};
use github::{CheckConclusion, CheckStatus, RepoId};
use serde_json::{json, Value};
use swarmpress_server::app::{spawn_background, AppState};
use swarmpress_server::config::GithubMode;
use swarmpress_server::db::gateway::{self as store, NewGatewayPr};
use swarmpress_server::deploys::{self, PollReport};
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

/// The fake GitHub with simulated deploys off: nothing lands by itself.
async fn server() -> TestServer {
    TestServer::start_with(Opts {
        tweak: Box::new(|c| c.simulate_deploy = false),
    })
    .await
}

/// Draft and merge a page; returns (number, merged sha).
async fn merged(s: &TestServer, p: &GatewayPlayer, id: &str) -> (u64, String) {
    let (st, d) = s
        .gateway(
            p,
            "draft",
            json!({ "content_id": id, "work_item": format!("work-{id}"),
                    "path": format!("content/pages/en/{id}.json"),
                    "page": { "title": { "en": id } }, "message": format!("Draft: {id}") }),
        )
        .await;
    assert_eq!(st, 200, "{d}");
    let (st, m) = s
        .gateway(
            p,
            "merge",
            json!({ "number": d["number"], "head_sha": d["head_sha"] }),
        )
        .await;
    assert_eq!(st, 200, "{m}");
    // Merges are ordered by the server's clock.
    s.clock.advance(Duration::from_secs(1));
    (
        d["number"].as_u64().unwrap(),
        m["merged_sha"].as_str().unwrap().to_string(),
    )
}

fn check(
    s: &TestServer,
    repo: &RepoId,
    sha: &str,
    name: &str,
    conclusion: Option<CheckConclusion>,
) {
    let status = if conclusion.is_some() {
        CheckStatus::Completed
    } else {
        CheckStatus::InProgress
    };
    s.fake_github()
        .add_check_run(repo, sha, name, status, conclusion);
}

async fn poll(s: &TestServer) -> PollReport {
    deploys::poll_once(&s.st).await.unwrap()
}

async fn status(s: &TestServer, p: &GatewayPlayer, query: &str) -> (u16, Value) {
    s.get_json(
        &format!("/api/gateway/deploy-status?{query}"),
        Some(&p.cookie),
    )
    .await
}

#[tokio::test]
async fn a_successful_deployment_lands_the_merge() {
    let s = server().await;
    let p = s.gateway_player(1).await;
    let (number, sha) = merged(&s, &p, "a").await;
    let (st, b) = status(&s, &p, &format!("number={number}")).await;
    assert_eq!((st, b["state"].as_str()), (200, Some("pending")), "{b}");
    assert_eq!(b["merged_sha"], sha.as_str());

    // Nothing started yet, then the workflow is running: keep waiting.
    assert_eq!(
        poll(&s).await,
        PollReport {
            checked: 1,
            ..Default::default()
        }
    );
    check(&s, &p.repo, &sha, "build", Some(CheckConclusion::Success));
    check(&s, &p.repo, &sha, "deploy", None);
    assert_eq!(
        poll(&s).await,
        PollReport {
            checked: 1,
            ..Default::default()
        }
    );
    assert!(s.inbox(&p.cookie).await.is_empty());
    let (_, b) = status(&s, &p, &format!("number={number}")).await;
    assert_eq!(b["state"], "pending");
    assert!(b["checked_at"].as_i64().is_some(), "{b}");

    // The deploy job succeeds.
    check(&s, &p.repo, &sha, "deploy", Some(CheckConclusion::Success));
    assert_eq!(
        poll(&s).await,
        PollReport {
            checked: 1,
            landed: 1,
            ..Default::default()
        }
    );
    let evs = s.inbox(&p.cookie).await;
    assert_eq!(evs.len(), 1, "{evs:?}");
    assert_eq!(evs[0]["kind"], "DeployLanded");
    let pl = &evs[0]["payload"];
    assert_eq!(pl["source"], "poll");
    assert_eq!(pl["content_id"], "a");
    assert_eq!(pl["work_item"], "work-a");
    assert_eq!(pl["number"], number);
    assert_eq!(pl["merged_sha"], sha.as_str());
    assert_eq!(pl["deployed_sha"], sha.as_str());
    assert_eq!(pl["state"], "success");

    // Landed is final: it is no longer watched, and the webhook for the same
    // deployment adds nothing.
    s.fake_github().clear_calls();
    assert_eq!(poll(&s).await, PollReport::default());
    assert!(s.fake_github().calls().is_empty());
    assert_eq!(
        deliver(&s, "d-1", &deployment_status(&p.repo, &sha, "success")).await,
        202
    );
    assert_eq!(s.inbox(&p.cookie).await.len(), 1);
    let (_, b) = status(&s, &p, "work_item=work-a").await;
    assert_eq!(b["state"], "landed", "{b}");
    assert_eq!(b["number"], number);
    assert!(b["landed_at"].as_i64().unwrap() >= b["merged_at"].as_i64().unwrap());
}

#[tokio::test]
async fn a_failed_deployment_emits_deploy_failed_once_and_a_rerun_lands_it() {
    let s = server().await;
    let p = s.gateway_player(1).await;
    let (number, sha) = merged(&s, &p, "a").await;
    check(&s, &p.repo, &sha, "build", Some(CheckConclusion::Failure));
    check(&s, &p.repo, &sha, "deploy", Some(CheckConclusion::Skipped));

    assert_eq!(
        poll(&s).await,
        PollReport {
            checked: 1,
            failed: 1,
            ..Default::default()
        }
    );
    // Asked again, the same failure is not reported again.
    assert_eq!(
        poll(&s).await,
        PollReport {
            checked: 1,
            ..Default::default()
        }
    );
    let evs = s.inbox(&p.cookie).await;
    assert_eq!(evs.len(), 1, "{evs:?}");
    assert_eq!(evs[0]["kind"], "DeployFailed");
    let pl = &evs[0]["payload"];
    assert_eq!(pl["source"], "poll");
    assert_eq!(pl["work_item"], "work-a");
    assert_eq!(pl["state"], "failure");
    assert_eq!(pl["detail"], "check `build` concluded failure");
    let (_, b) = status(&s, &p, &format!("number={number}")).await;
    assert_eq!(b["state"], "failed", "{b}");
    assert_eq!(b["detail"], "check `build` concluded failure");

    // The owner re-runs the workflow and it goes through.
    check(&s, &p.repo, &sha, "build", Some(CheckConclusion::Success));
    check(&s, &p.repo, &sha, "deploy", Some(CheckConclusion::Success));
    assert_eq!(
        poll(&s).await,
        PollReport {
            checked: 1,
            landed: 1,
            ..Default::default()
        }
    );
    let evs = s.inbox(&p.cookie).await;
    assert_eq!(evs.len(), 2);
    assert_eq!(evs[1]["kind"], "DeployLanded");
    let (_, b) = status(&s, &p, &format!("number={number}")).await;
    assert_eq!(b["state"], "landed");
}

#[tokio::test]
async fn a_burst_of_two_merges_with_one_deployment_lands_both() {
    let s = server().await;
    let p = s.gateway_player(1).await;
    let (n1, sha1) = merged(&s, &p, "a").await;
    let (n2, sha2) = merged(&s, &p, "b").await;
    // A third merge after the deployed one must not land with it.
    let (n3, sha3) = merged(&s, &p, "c").await;

    // The Pages concurrency group dropped the first run; the second deployed.
    check(
        &s,
        &p.repo,
        &sha1,
        "build",
        Some(CheckConclusion::Cancelled),
    );
    check(&s, &p.repo, &sha2, "build", Some(CheckConclusion::Success));
    check(&s, &p.repo, &sha2, "deploy", Some(CheckConclusion::Success));
    check(&s, &p.repo, &sha3, "build", None);

    assert_eq!(
        poll(&s).await,
        PollReport {
            checked: 3,
            landed: 2,
            ..Default::default()
        }
    );
    let evs = s.inbox(&p.cookie).await;
    assert_eq!(evs.len(), 2, "{evs:?}");
    for (ev, (number, sha, item)) in evs
        .iter()
        .zip([(n1, &sha1, "work-a"), (n2, &sha2, "work-b")])
    {
        assert_eq!(ev["kind"], "DeployLanded");
        assert_eq!(ev["payload"]["number"], number);
        assert_eq!(ev["payload"]["work_item"], item);
        assert_eq!(ev["payload"]["merged_sha"], sha.as_str());
        assert_eq!(ev["payload"]["deployed_sha"], sha2.as_str());
    }
    let (_, b) = status(&s, &p, &format!("number={n3}")).await;
    assert_eq!(b["state"], "pending", "{b}");

    // Only the third is still watched.
    assert_eq!(
        poll(&s).await,
        PollReport {
            checked: 1,
            ..Default::default()
        }
    );
}

#[tokio::test]
async fn the_webhook_lands_every_merge_at_or_before_the_deployed_commit() {
    let s = server().await;
    let p = s.gateway_player(1).await;
    let (n1, sha1) = merged(&s, &p, "a").await;
    let (n2, sha2) = merged(&s, &p, "b").await;
    let (n3, _sha3) = merged(&s, &p, "c").await;

    assert_eq!(
        deliver(&s, "d-1", &deployment_status(&p.repo, &sha2, "success")).await,
        202
    );
    let evs = s.inbox(&p.cookie).await;
    assert_eq!(evs.len(), 2, "{evs:?}");
    assert_eq!(evs[0]["payload"]["number"], n1);
    assert_eq!(evs[0]["payload"]["merged_sha"], sha1.as_str());
    assert_eq!(evs[0]["payload"]["deployed_sha"], sha2.as_str());
    assert_eq!(evs[1]["payload"]["number"], n2);
    for ev in &evs {
        assert_eq!(ev["kind"], "DeployLanded");
        assert_eq!(ev["payload"]["source"], "webhook");
        assert_eq!(ev["payload"]["environment"], "github-pages");
    }
    let (_, b) = status(&s, &p, &format!("number={n3}")).await;
    assert_eq!(b["state"], "pending");

    // A second, distinct delivery for the same deployment lands nothing more.
    assert_eq!(
        deliver(&s, "d-2", &deployment_status(&p.repo, &sha2, "success")).await,
        202
    );
    assert_eq!(s.inbox(&p.cookie).await.len(), 2);

    // A failed deployment of the third fails it once; a landed one stays landed.
    let sha3 = status(&s, &p, &format!("number={n3}")).await.1["merged_sha"]
        .as_str()
        .unwrap()
        .to_string();
    for id in ["d-3", "d-4"] {
        assert_eq!(
            deliver(&s, id, &deployment_status(&p.repo, &sha3, "failure")).await,
            202
        );
    }
    assert_eq!(
        deliver(&s, "d-5", &deployment_status(&p.repo, &sha2, "failure")).await,
        202
    );
    let evs = s.inbox(&p.cookie).await;
    assert_eq!(evs.len(), 3, "{evs:?}");
    assert_eq!(evs[2]["kind"], "DeployFailed");
    assert_eq!(evs[2]["payload"]["number"], n3);
    assert_eq!(evs[2]["payload"]["state"], "failure");
    let (_, b) = status(&s, &p, &format!("number={n2}")).await;
    assert_eq!(b["state"], "landed");
}

#[tokio::test]
async fn a_superseded_merge_fails_with_the_deployment_that_replaced_it() {
    let s = server().await;
    let p = s.gateway_player(1).await;
    let (n1, _sha1) = merged(&s, &p, "a").await;
    let (n2, sha2) = merged(&s, &p, "b").await;
    // The first run never started; the second failed in the deploy job.
    check(&s, &p.repo, &sha2, "build", Some(CheckConclusion::Success));
    check(&s, &p.repo, &sha2, "deploy", Some(CheckConclusion::Failure));

    assert_eq!(
        poll(&s).await,
        PollReport {
            checked: 2,
            failed: 2,
            ..Default::default()
        }
    );
    let evs = s.inbox(&p.cookie).await;
    assert_eq!(evs.len(), 2, "{evs:?}");
    assert_eq!(evs[0]["kind"], "DeployFailed");
    assert_eq!(evs[0]["payload"]["number"], n1);
    assert_eq!(
        evs[0]["payload"]["detail"],
        format!("superseded by the deployment of pull request #{n2}, which failed")
    );
    assert_eq!(evs[1]["payload"]["number"], n2);
    assert_eq!(
        evs[1]["payload"]["detail"],
        "check `deploy` concluded failure"
    );

    // A later merge deploys: everything before it is live after all.
    let (_n3, sha3) = merged(&s, &p, "c").await;
    check(&s, &p.repo, &sha3, "deploy", Some(CheckConclusion::Success));
    assert_eq!(
        poll(&s).await,
        PollReport {
            checked: 3,
            landed: 3,
            ..Default::default()
        }
    );
    let evs = s.inbox(&p.cookie).await;
    assert_eq!(evs.len(), 5);
    assert!(evs[2..].iter().all(|e| e["kind"] == "DeployLanded"));
}

#[tokio::test]
async fn a_merge_nobody_deployed_times_out() {
    let s = TestServer::start_with(Opts {
        tweak: Box::new(|c| {
            c.simulate_deploy = false;
            c.deploys.max_age = Duration::from_secs(600);
        }),
    })
    .await;
    let p = s.gateway_player(1).await;
    let (number, _sha) = merged(&s, &p, "a").await;
    s.clock.advance(Duration::from_secs(590));
    assert_eq!(
        poll(&s).await,
        PollReport {
            checked: 1,
            ..Default::default()
        }
    );
    assert!(s.inbox(&p.cookie).await.is_empty());

    s.clock.advance(Duration::from_secs(20));
    s.fake_github().clear_calls();
    assert_eq!(
        poll(&s).await,
        PollReport {
            failed: 1,
            ..Default::default()
        }
    );
    assert!(
        s.fake_github().calls().is_empty(),
        "it is no longer asked about"
    );
    let evs = s.inbox(&p.cookie).await;
    assert_eq!(evs.len(), 1, "{evs:?}");
    assert_eq!(evs[0]["kind"], "DeployFailed");
    assert_eq!(evs[0]["payload"]["state"], "timed_out");
    assert_eq!(evs[0]["payload"]["source"], "poll");
    assert_eq!(evs[0]["payload"]["number"], number);
    assert_eq!(poll(&s).await, PollReport::default());
    let (_, b) = status(&s, &p, &format!("number={number}")).await;
    assert_eq!(b["state"], "failed");
}

// ---- POST /api/gateway/redeploy (FEAT-085) ----------------------------------

const DEPLOY_YML: &str = ".github/workflows/deploy.yml";

/// The deploy workflow's run on `sha` failed in its build job.
fn failed_run(s: &TestServer, repo: &RepoId, sha: &str) -> u64 {
    check(s, repo, sha, "build", Some(CheckConclusion::Failure));
    check(s, repo, sha, "deploy", Some(CheckConclusion::Skipped));
    s.fake_github().add_workflow_run(
        repo,
        sha,
        DEPLOY_YML,
        CheckStatus::Completed,
        Some(CheckConclusion::Failure),
    )
}

/// The current attempt of the run, and the checks of `sha`, succeed.
fn run_succeeds(s: &TestServer, repo: &RepoId, sha: &str, run: u64) {
    check(s, repo, sha, "build", Some(CheckConclusion::Success));
    check(s, repo, sha, "deploy", Some(CheckConclusion::Success));
    s.fake_github().set_workflow_run(
        repo,
        run,
        CheckStatus::Completed,
        Some(CheckConclusion::Success),
    );
}

async fn redeploy(s: &TestServer, p: &GatewayPlayer, body: Value) -> (u16, Value) {
    s.gateway(p, "redeploy", body).await
}

fn reruns(s: &TestServer) -> usize {
    s.fake_github()
        .calls()
        .iter()
        .filter(|c| *c == "rerun_failed_jobs")
        .count()
}

#[tokio::test]
async fn a_failed_deploy_is_redeployed_once_and_lands() {
    let s = server().await;
    let mut p = s.gateway_player(1).await;
    let (number, sha) = merged(&s, &p, "a").await;
    let run = failed_run(&s, &p.repo, &sha);
    assert_eq!(poll(&s).await.failed, 1);
    let evs = s.inbox(&p.cookie).await;
    assert_eq!(evs[0]["kind"], "DeployFailed");
    assert_eq!(evs[0]["payload"]["attempt"], 0);

    // Long after the merge (past the poller's age limit): the redeploy
    // restarts the wait. (The lease expired meanwhile: taken again.)
    s.clock.advance(Duration::from_secs(2 * 3600));
    p.lease = s.lease(&p.cookie, &p.company, "laptop").await;
    let (st, b) = redeploy(&s, &p, json!({ "work_item": "work-a" })).await;
    assert_eq!(st, 200, "{b}");
    assert_eq!(b["number"], number);
    assert_eq!(b["work_item"], "work-a");
    assert_eq!(b["state"], "pending");
    assert_eq!(b["requested"], true);
    assert_eq!(b["run_id"], run);
    assert_eq!(b["run_attempt"], 1);
    assert_eq!(b["attempt"], 1);
    assert_eq!(
        b["detail"],
        format!("re-run of the failed jobs of workflow run {run} (attempt 1) requested")
    );
    assert_eq!(reruns(&s), 1);
    let attempt = s.fake_github().workflow_run(&p.repo, run).unwrap();
    assert_eq!(
        (attempt.run_attempt, attempt.status),
        (2, CheckStatus::Queued)
    );
    let (_, b) = status(&s, &p, &format!("number={number}")).await;
    assert_eq!(b["state"], "pending", "{b}");

    // The same failed run again: a no-op, GitHub is not asked.
    s.fake_github().clear_calls();
    let (st, b) = redeploy(&s, &p, json!({ "number": number })).await;
    assert_eq!((st, b["requested"].as_bool()), (200, Some(false)), "{b}");
    assert_eq!(b["attempt"], 1);
    assert!(s.fake_github().calls().is_empty());

    // The new attempt is running, then succeeds: the merge lands.
    assert_eq!(
        poll(&s).await,
        PollReport {
            checked: 1,
            ..Default::default()
        }
    );
    run_succeeds(&s, &p.repo, &sha, run);
    assert_eq!(poll(&s).await.landed, 1);
    let evs: Vec<Value> = s
        .inbox(&p.cookie)
        .await
        .into_iter()
        .filter(|e| e["kind"] != "LeaseRevoked")
        .collect();
    assert_eq!(evs.len(), 2, "{evs:?}");
    assert_eq!(evs[1]["kind"], "DeployLanded");
    assert_eq!(evs[1]["payload"]["work_item"], "work-a");
    assert_eq!(evs[1]["payload"]["attempt"], 1);

    // A merge that landed is not redeployed.
    s.fake_github().clear_calls();
    let (st, b) = redeploy(&s, &p, json!({ "number": number })).await;
    assert_eq!(st, 409, "{b}");
    assert!(b["error"].as_str().unwrap().contains("has landed"), "{b}");
    assert!(s.fake_github().calls().is_empty());
}

#[tokio::test]
async fn a_redeploy_that_fails_again_is_a_new_failure_and_is_redeployed_again() {
    let s = server().await;
    let p = s.gateway_player(1).await;
    let (number, sha) = merged(&s, &p, "a").await;
    let run = failed_run(&s, &p.repo, &sha);
    assert_eq!(poll(&s).await.failed, 1);
    let (st, b) = redeploy(&s, &p, json!({ "number": number })).await;
    assert_eq!((st, b["run_attempt"].as_u64()), (200, Some(1)), "{b}");

    // Within one poll interval of the request a failed verdict may still be
    // the old attempt's: it does not fail the merge.
    failed_run_again(&s, &p.repo, &sha, run);
    assert_eq!(poll(&s).await.failed, 0);
    s.clock.advance(Duration::from_secs(31));
    assert_eq!(poll(&s).await.failed, 1);
    let evs = s.inbox(&p.cookie).await;
    assert_eq!(evs.len(), 2, "{evs:?}");
    assert_eq!(evs[1]["kind"], "DeployFailed");
    assert_eq!(evs[1]["payload"]["attempt"], 1);
    let (_, b) = status(&s, &p, &format!("number={number}")).await;
    assert_eq!(b["state"], "failed");

    // Attempt 2 failed: a new failed run attempt, re-run again.
    let (st, b) = redeploy(&s, &p, json!({ "number": number })).await;
    assert_eq!(st, 200, "{b}");
    assert_eq!(
        (
            b["requested"].as_bool(),
            b["run_attempt"].as_u64(),
            b["attempt"].as_i64()
        ),
        (Some(true), Some(2), Some(2))
    );
    assert_eq!(reruns(&s), 2);
    run_succeeds(&s, &p.repo, &sha, run);
    assert_eq!(poll(&s).await.landed, 1);
}

/// The current attempt of the run failed again.
fn failed_run_again(s: &TestServer, repo: &RepoId, sha: &str, run: u64) {
    check(s, repo, sha, "build", Some(CheckConclusion::Failure));
    check(s, repo, sha, "deploy", Some(CheckConclusion::Skipped));
    s.fake_github().set_workflow_run(
        repo,
        run,
        CheckStatus::Completed,
        Some(CheckConclusion::Failure),
    );
}

#[tokio::test]
async fn a_superseded_merge_is_redeployed_with_the_run_that_failed_it() {
    let s = server().await;
    let p = s.gateway_player(1).await;
    let (n1, sha1) = merged(&s, &p, "a").await;
    let (_n2, sha2) = merged(&s, &p, "b").await;
    // The first merge's run was cancelled by the second, which failed.
    let cancelled = s.fake_github().add_workflow_run(
        &p.repo,
        &sha1,
        DEPLOY_YML,
        CheckStatus::Completed,
        Some(CheckConclusion::Cancelled),
    );
    let run2 = failed_run(&s, &p.repo, &sha2);
    assert_eq!(poll(&s).await.failed, 2);

    let (st, b) = redeploy(&s, &p, json!({ "number": n1 })).await;
    assert_eq!(st, 200, "{b}");
    assert_eq!(
        b["run_id"], run2,
        "the failed deployment, not the cancelled run"
    );
    assert_eq!(
        s.fake_github()
            .workflow_run(&p.repo, cancelled)
            .unwrap()
            .run_attempt,
        1
    );
    // Its success lands both merges (at or before).
    run_succeeds(&s, &p.repo, &sha2, run2);
    assert_eq!(poll(&s).await.landed, 2);
}

#[tokio::test]
async fn redeploy_refusals() {
    let s = server().await;
    let p = s.gateway_player(1).await;
    // Lease-fenced.
    let (st, _) = s
        .post_json(
            "/api/gateway/redeploy",
            Some(&p.cookie),
            json!({ "number": 1 }),
        )
        .await;
    assert_eq!(st, 428);
    // Exactly one key; unknown pull requests.
    assert_eq!(redeploy(&s, &p, json!({})).await.0, 400);
    assert_eq!(redeploy(&s, &p, json!({ "number": 99 })).await.0, 404);

    // An open pull request is not merged.
    let (st, d) = s
        .gateway(
            &p,
            "draft",
            json!({ "content_id": "o", "work_item": "work-o", "path": "content/pages/en/o.json",
                    "page": { "title": { "en": "o" } }, "message": "Draft: o" }),
        )
        .await;
    assert_eq!(st, 200, "{d}");
    let (st, b) = redeploy(&s, &p, json!({ "work_item": "work-o" })).await;
    assert_eq!(st, 409, "{b}");
    assert!(b["error"].as_str().unwrap().contains("is open"), "{b}");

    // A pending merge needs nothing: 200, nothing requested.
    let (number, sha) = merged(&s, &p, "a").await;
    let (st, b) = redeploy(&s, &p, json!({ "number": number })).await;
    assert_eq!((st, b["requested"].as_bool()), (200, Some(false)), "{b}");
    assert_eq!(b["attempt"], 0);

    // Failed, but GitHub has no run of the deploy workflow to re-run (only
    // another workflow's): refused, the merge stays failed.
    check(&s, &p.repo, &sha, "build", Some(CheckConclusion::Failure));
    s.fake_github().add_workflow_run(
        &p.repo,
        &sha,
        ".github/workflows/lint.yml",
        CheckStatus::Completed,
        Some(CheckConclusion::Failure),
    );
    assert_eq!(poll(&s).await.failed, 1);
    let (st, b) = redeploy(&s, &p, json!({ "number": number })).await;
    assert_eq!(st, 409, "{b}");
    assert!(
        b["error"].as_str().unwrap().contains("nothing to re-run"),
        "{b}"
    );

    // GitHub refuses the re-run (no Actions write permission): 403 that says
    // so, and the merge stays failed.
    s.fake_github().add_workflow_run(
        &p.repo,
        &sha,
        DEPLOY_YML,
        CheckStatus::Completed,
        Some(CheckConclusion::Failure),
    );
    s.fake_github().fail_next(
        "rerun_failed_jobs",
        github::GitHubError::Forbidden("Resource not accessible by integration".into()),
    );
    let (st, b) = redeploy(&s, &p, json!({ "number": number })).await;
    assert_eq!(st, 403, "{b}");
    let msg = b["error"].as_str().unwrap();
    assert!(
        msg.contains("Resource not accessible") && msg.contains("Actions write"),
        "{b}"
    );
    let (_, b) = status(&s, &p, &format!("number={number}")).await;
    assert_eq!(b["state"], "failed");
    // Once GitHub allows it, the same request goes through.
    let (st, b) = redeploy(&s, &p, json!({ "number": number })).await;
    assert_eq!((st, b["requested"].as_bool()), (200, Some(true)), "{b}");
}

#[tokio::test]
async fn deploy_status_is_scoped_to_the_company() {
    let s = TestServer::start().await;
    let a = s.gateway_player(1).await;
    let b = s.gateway_player(2).await;
    // Open, then merged with a simulated deploy.
    let (st, d) = s
        .gateway(
            &a,
            "draft",
            json!({ "content_id": "x", "work_item": "work-x", "path": "content/pages/en/x.json",
                    "page": { "title": { "en": "x" } }, "message": "Draft: x" }),
        )
        .await;
    assert_eq!(st, 200, "{d}");
    let number = d["number"].as_u64().unwrap();
    let (st, body) = status(&s, &a, &format!("number={number}")).await;
    assert_eq!(st, 200, "{body}");
    assert_eq!(body["state"], "open");
    assert_eq!(body["merged_sha"], Value::Null);
    assert_eq!(body["work_item"], "work-x");
    assert_eq!(body["path"], "content/pages/en/x.json");
    assert!(body["now"].as_i64().is_some());

    let (st, m) = s
        .gateway(
            &a,
            "merge",
            json!({ "number": number, "head_sha": d["head_sha"] }),
        )
        .await;
    assert_eq!(st, 200, "{m}");
    let (_, body) = status(&s, &a, "work_item=work-x").await;
    assert_eq!(body["state"], "landed", "{body}");
    assert_eq!(body["number"], number);
    assert_eq!(body["merged_sha"], m["merged_sha"]);

    // A pull request that was closed instead.
    let (st, d) = s
        .gateway(
            &a,
            "draft",
            json!({ "content_id": "y", "work_item": "work-y", "path": "content/pages/en/y.json",
                    "page": { "title": { "en": "y" } }, "message": "Draft: y" }),
        )
        .await;
    assert_eq!(st, 200, "{d}");
    let (st, _) = s
        .gateway(&a, "close", json!({ "number": d["number"] }))
        .await;
    assert_eq!(st, 200);
    let (_, body) = status(&s, &a, "work_item=work-y").await;
    assert_eq!(body["state"], "closed", "{body}");
    assert!(body["closed_at"].as_i64().is_some());

    // Another company cannot read it; unknown ids are 404; the query must
    // name exactly one of the two keys; a session is required.
    assert_eq!(status(&s, &b, &format!("number={number}")).await.0, 404);
    assert_eq!(status(&s, &b, "work_item=work-x").await.0, 404);
    assert_eq!(status(&s, &a, "number=9999").await.0, 404);
    assert_eq!(status(&s, &a, "work_item=nope").await.0, 404);
    assert_eq!(status(&s, &a, "").await.0, 400);
    assert_eq!(
        status(&s, &a, &format!("number={number}&work_item=work-x"))
            .await
            .0,
        400
    );
    let (st, _) = s
        .get_json(&format!("/api/gateway/deploy-status?number={number}"), None)
        .await;
    assert_eq!(st, 401);
}

// ---------------------------------------------------------------- real mode

fn real_mode(api_base: String) -> Opts {
    Opts {
        tweak: Box::new(move |c| {
            c.simulate_deploy = false;
            c.github_mode = GithubMode::Real {
                api_base,
                token: Some("test-token".into()),
                app_id: None,
                app_private_key_path: None,
            };
            c.deploys.poll_interval = Duration::from_millis(25);
        }),
    }
}

#[tokio::test]
async fn the_poller_never_runs_with_the_fake_or_with_simulated_deploys() {
    // Fake GitHub with simulated deploys (the test and dev default).
    let s = TestServer::start().await;
    assert!(!deploys::enabled(&s.st));
    assert!(deploys::spawn(&s.st).is_none());
    let bg = spawn_background(&s.st);
    let without = bg.tasks.len();
    bg.abort();

    // Fake GitHub without simulated deploys.
    let s = server().await;
    assert!(!deploys::enabled(&s.st));
    assert!(deploys::spawn(&s.st).is_none());

    // A real GitHub: the poller is one more background task.
    let mock = MockServer::start().await;
    let s = TestServer::start_with(real_mode(mock.uri())).await;
    assert!(deploys::enabled(&s.st));
    let bg = spawn_background(&s.st);
    assert_eq!(bg.tasks.len(), without + 1);
    bg.abort();

    // A real GitHub without credentials has nothing to ask with.
    let s = TestServer::start_with(Opts {
        tweak: Box::new(|c| {
            c.simulate_deploy = false;
            c.github_mode = GithubMode::Real {
                api_base: "http://127.0.0.1:9".into(),
                token: None,
                app_id: None,
                app_private_key_path: None,
            };
        }),
    })
    .await;
    assert!(!deploys::enabled(&s.st));
}

#[tokio::test]
async fn simulated_deploys_with_a_real_github_refuse_to_start() {
    let dir = common::temp_dir("startup");
    let db = common::file_db(&dir).await;
    let mut cfg = swarmpress_server::config::Config::for_tests(
        "",
        dir.join("data"),
        swarmpress_server::config::GithubOAuthConfig::github("id", "secret"),
    );
    cfg.github_mode = GithubMode::Real {
        api_base: "https://api.github.com".into(),
        token: Some("test-token".into()),
        app_id: None,
        app_private_key_path: None,
    };
    // A real GitHub needs an allow-list (G2; tests/binding.rs).
    cfg.allowed_site_repos = vec!["swarmpress-sites/player1-site".into()];
    // `for_tests` has simulated deploys on: with a real GitHub that would
    // report every merge as live.
    assert!(cfg.simulate_deploy);
    let err = cfg.validate().unwrap_err().to_string();
    assert!(err.contains("SWARMPRESS_SIMULATE_DEPLOY"), "{err}");
    let err = AppState::new(cfg.clone(), db.clone())
        .err()
        .expect("refused");
    assert!(err.to_string().contains("SWARMPRESS_SIMULATE_DEPLOY"));
    cfg.simulate_deploy = false;
    cfg.validate().unwrap();
    assert!(AppState::new(cfg, db.clone()).is_ok());
    db.close().await;
    let _ = std::fs::remove_dir_all(dir);
}

#[tokio::test]
async fn with_a_real_github_the_background_poller_lands_the_merge() {
    let mock = MockServer::start().await;
    let s = TestServer::start_with(real_mode(mock.uri())).await;
    let (cookie, company) = s.player(1).await;
    // A merge the gateway recorded (drafting through wiremock is the
    // github crate's contract test, not this one).
    let sha = "5".repeat(40);
    store::upsert_pr(
        &s.db,
        &NewGatewayPr {
            company_id: &company,
            number: 7,
            content_id: "c1",
            work_item: Some("work-item-1"),
            path: "content/pages/blog/a.json",
            branch: "drafts/content-c1",
            head_sha: "h",
        },
        s.st.now_ms(),
    )
    .await
    .unwrap();
    store::set_merged(&s.db, &company, 7, &sha, s.st.now_ms())
        .await
        .unwrap();

    Mock::given(method("GET"))
        .and(path(format!(
            "/repos/swarmpress-sites/player1-site/commits/{sha}/check-runs"
        )))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "total_count": 2,
            "check_runs": [
                { "id": 1, "name": "build", "head_sha": sha, "status": "completed", "conclusion": "success" },
                { "id": 2, "name": "deploy", "head_sha": sha, "status": "completed", "conclusion": "success" }
            ]
        })))
        .mount(&mock)
        .await;

    let task = deploys::spawn(&s.st).expect("the poller runs in real mode");
    let landed = async {
        loop {
            let evs = s.inbox(&cookie).await;
            if !evs.is_empty() {
                return evs;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    };
    let evs = tokio::time::timeout(Duration::from_secs(10), landed)
        .await
        .expect("the poller lands the merge");
    task.abort();
    assert_eq!(evs.len(), 1, "{evs:?}");
    assert_eq!(evs[0]["kind"], "DeployLanded");
    assert_eq!(evs[0]["payload"]["source"], "poll");
    assert_eq!(evs[0]["payload"]["work_item"], "work-item-1");
    assert_eq!(evs[0]["payload"]["merged_sha"], sha.as_str());
    let requests = mock.received_requests().await.unwrap();
    assert!(!requests.is_empty());
    assert!(requests
        .iter()
        .all(|r| r.url.path().ends_with("/check-runs")));
}

// ---------------------------------------------------------------- webhook helpers

fn deployment_status(repo: &RepoId, sha: &str, state: &str) -> Value {
    json!({
        "action": "created",
        "deployment_status": { "id": 9, "state": state, "environment": "github-pages" },
        "deployment": { "id": 7, "sha": sha, "ref": "main", "environment": "github-pages" },
        "repository": { "id": 1, "name": repo.name, "full_name": repo.to_string(),
                         "owner": { "login": repo.owner } },
        "installation": { "id": 42 }
    })
}

async fn deliver(s: &TestServer, id: &str, body: &Value) -> u16 {
    let bytes = serde_json::to_vec(body).unwrap();
    s.http
        .post(s.url("/webhooks/github"))
        .header("x-github-event", "deployment_status")
        .header("x-github-delivery", id)
        .header(
            "x-hub-signature-256",
            github::webhooks::sign(b"test-webhook-secret", &bytes),
        )
        .header("content-type", "application/json")
        .body(bytes)
        .send()
        .await
        .unwrap()
        .status()
        .as_u16()
}
