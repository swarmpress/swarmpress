//! Webhook HMAC verification, typed parsing of fixture payloads, dedupe.

use std::sync::Arc;

use github::webhooks::*;
use github::{CheckConclusion, CheckStatus, RepoId};
use http::HeaderMap;

const SECRET: &[u8] = b"It's a Secret to Everybody";

fn fixture(name: &str) -> Vec<u8> {
    let p = format!("{}/tests/fixtures/{name}", env!("CARGO_MANIFEST_DIR"));
    std::fs::read(&p).unwrap_or_else(|e| panic!("{p}: {e}"))
}

#[test]
fn github_documented_test_vector() {
    // From GitHub's "Validating webhook deliveries" docs.
    let body = b"Hello, World!";
    let expected = "sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17";
    assert_eq!(sign(SECRET, body), expected);
    assert_eq!(verify_signature(SECRET, body, Some(expected)), Ok(()));
}

#[test]
fn signature_rejections() {
    let body = b"{\"zen\":\"x\"}";
    let good = sign(SECRET, body);
    assert_eq!(
        verify_signature(SECRET, body, None),
        Err(WebhookError::MissingHeader(SIGNATURE_HEADER))
    );
    assert_eq!(
        verify_signature(SECRET, body, Some("sha1=abcd")),
        Err(WebhookError::MalformedSignature)
    );
    assert_eq!(
        verify_signature(SECRET, body, Some("sha256=zz")),
        Err(WebhookError::MalformedSignature)
    );
    assert_eq!(
        verify_signature(SECRET, body, Some("sha256=abcd")),
        Err(WebhookError::MalformedSignature),
        "wrong length"
    );
    // Wrong secret.
    assert_eq!(
        verify_signature(b"other", body, Some(&good)),
        Err(WebhookError::InvalidSignature)
    );
    // Tampered body.
    assert_eq!(
        verify_signature(SECRET, b"{\"zen\":\"y\"}", Some(&good)),
        Err(WebhookError::InvalidSignature)
    );
    // Flip one hex digit.
    let mut flipped = good.clone().into_bytes();
    let last = flipped.len() - 1;
    flipped[last] = if flipped[last] == b'0' { b'1' } else { b'0' };
    assert_eq!(
        verify_signature(SECRET, body, Some(std::str::from_utf8(&flipped).unwrap())),
        Err(WebhookError::InvalidSignature)
    );
    // Uppercase hex is accepted.
    assert_eq!(
        verify_signature(
            SECRET,
            body,
            Some(&format!("sha256={}", good[7..].to_uppercase()))
        ),
        Ok(())
    );
}

fn repo() -> RepoId {
    RepoId::new("simpress-sites", "cinqueterre-travel")
}

#[test]
fn parse_pull_request_merged() {
    let ev = parse_event("pull_request", &fixture("pull_request_closed_merged.json")).unwrap();
    assert_eq!(ev.repo(), Some(repo()));
    assert_eq!(ev.installation_id(), Some(55501));
    let WebhookEvent::PullRequest(pr) = ev else {
        panic!("wrong variant")
    };
    assert_eq!(pr.action, PullRequestAction::Closed);
    assert!(pr.is_merged());
    assert_eq!(pr.number, 6);
    assert_eq!(pr.pull_request.head.ref_name, "drafts/content-last-light");
    assert_eq!(
        pr.pull_request.merge_commit_sha.as_deref(),
        Some("9fceb02d0ae598e95dc970b74767f19372d61af8")
    );
    assert_eq!(pr.pull_request.labels[0].name, "content");
}

#[test]
fn parse_check_run_and_suite() {
    let WebhookEvent::CheckRun(cr) =
        parse_event("check_run", &fixture("check_run_completed.json")).unwrap()
    else {
        panic!()
    };
    assert_eq!(cr.action, CheckAction::Completed);
    assert_eq!(cr.check_run.name, "kit check --strict");
    assert_eq!(cr.check_run.status, CheckStatus::Completed);
    assert_eq!(cr.check_run.conclusion, Some(CheckConclusion::Failure));
    assert_eq!(
        cr.check_run.check_suite.as_ref().map(|s| s.id),
        Some(118578147)
    );

    let WebhookEvent::CheckSuite(cs) =
        parse_event("check_suite", &fixture("check_suite_completed.json")).unwrap()
    else {
        panic!()
    };
    assert_eq!(cs.check_suite.conclusion, Some(CheckConclusion::Success));
    assert_eq!(
        cs.check_suite.head_branch.as_deref(),
        Some("drafts/content-last-light")
    );
    assert_eq!(cs.check_suite.pull_requests[0].number, 6);
}

#[test]
fn parse_workflow_run() {
    let WebhookEvent::WorkflowRun(w) =
        parse_event("workflow_run", &fixture("workflow_run_completed.json")).unwrap()
    else {
        panic!()
    };
    assert_eq!(w.action, WorkflowRunAction::Completed);
    assert_eq!(w.workflow_run.id, 9001);
    assert_eq!(
        w.workflow_run.path.as_deref(),
        Some(".github/workflows/site-ci.yml")
    );
    assert_eq!(w.workflow_run.conclusion, Some(CheckConclusion::Success));
    assert_eq!(w.workflow_run.pull_requests[0].number, 9);
}

#[test]
fn parse_deployment_status() {
    let WebhookEvent::DeploymentStatus(d) = parse_event(
        "deployment_status",
        &fixture("deployment_status_success.json"),
    )
    .unwrap() else {
        panic!()
    };
    assert_eq!(d.deployment_status.state, DeploymentState::Success);
    assert_eq!(d.deployment.sha, "9fceb02d0ae598e95dc970b74767f19372d61af8");
    assert_eq!(d.deployment.environment, "github-pages");
    assert_eq!(
        d.deployment_status.environment_url.as_deref(),
        Some("https://cinqueterre.travel/")
    );
}

#[test]
fn parse_push() {
    let WebhookEvent::Push(p) = parse_event("push", &fixture("push_main.json")).unwrap() else {
        panic!()
    };
    assert_eq!(p.branch(), Some("main"));
    assert_eq!(
        p.touched_paths(),
        vec![
            "content/pages/blog/index.json",
            "content/pages/blog/last-light-on-sentiero-azzurro.json"
        ]
    );
    assert_eq!(p.repository.repo_id(), repo());
}

#[test]
fn parse_ping_and_unknown_and_garbage() {
    let ev = parse_event("ping", &fixture("ping.json")).unwrap();
    assert!(matches!(
        ev,
        WebhookEvent::Ping(PingEvent {
            hook_id: Some(467071),
            ..
        })
    ));
    assert_eq!(ev.repo(), None);

    let ev = parse_event("issues", br#"{"action":"opened","issue":{}}"#).unwrap();
    assert_eq!(
        ev,
        WebhookEvent::Other {
            event: "issues".into(),
            action: Some("opened".into())
        }
    );
    assert!(matches!(
        parse_event("pull_request", br#"{"action":"opened"}"#),
        Err(WebhookError::Parse { .. })
    ));
}

#[test]
fn unknown_actions_and_states_do_not_fail_parsing() {
    let mut v: serde_json::Value =
        serde_json::from_slice(&fixture("pull_request_closed_merged.json")).unwrap();
    v["action"] = "auto_merge_enabled".into();
    let WebhookEvent::PullRequest(pr) =
        parse_event("pull_request", &serde_json::to_vec(&v).unwrap()).unwrap()
    else {
        panic!()
    };
    assert_eq!(pr.action, PullRequestAction::Other);
}

fn headers(event: &str, delivery: &str, sig: &str) -> HeaderMap {
    let mut h = HeaderMap::new();
    h.insert(EVENT_HEADER, event.parse().unwrap());
    h.insert(DELIVERY_HEADER, delivery.parse().unwrap());
    h.insert(SIGNATURE_HEADER, sig.parse().unwrap());
    h
}

#[tokio::test]
async fn handler_verifies_parses_and_dedupes() {
    let handler = WebhookHandler::new(SECRET.to_vec(), Arc::new(InMemoryDedupe::default()));
    let body = fixture("deployment_status_success.json");
    let sig = sign(SECRET, &body);

    let first = handler
        .process(&headers("deployment_status", "d-1", &sig), &body)
        .await
        .unwrap();
    let Delivery::Fresh(env) = first else {
        panic!("expected fresh")
    };
    assert_eq!(env.delivery_id, "d-1");
    assert_eq!(env.event_name, "deployment_status");
    assert!(matches!(env.event, WebhookEvent::DeploymentStatus(_)));

    let again = handler
        .process(&headers("deployment_status", "d-1", &sig), &body)
        .await
        .unwrap();
    assert_eq!(
        again,
        Delivery::Duplicate {
            delivery_id: "d-1".into()
        }
    );

    // Bad signature never reaches dedupe: a later valid delivery with the
    // same id is still fresh.
    let e = handler
        .process(&headers("deployment_status", "d-2", "sha256=00"), &body)
        .await
        .unwrap_err();
    assert_eq!(e, WebhookError::MalformedSignature);
    let ok = handler
        .process(&headers("deployment_status", "d-2", &sig), &body)
        .await
        .unwrap();
    assert!(matches!(ok, Delivery::Fresh(_)));

    // Missing delivery header.
    let mut h = headers("push", "x", &sig);
    h.remove(DELIVERY_HEADER);
    assert_eq!(
        handler.process(&h, &body).await.unwrap_err(),
        WebhookError::MissingHeader(DELIVERY_HEADER)
    );
}

#[tokio::test]
async fn in_memory_dedupe_is_bounded() {
    let d = InMemoryDedupe::new(2);
    assert!(d.check_and_mark("a").await.unwrap());
    assert!(!d.check_and_mark("a").await.unwrap());
    assert!(d.check_and_mark("b").await.unwrap());
    assert!(d.check_and_mark("c").await.unwrap());
    // "a" was evicted (capacity 2), so it is fresh again.
    assert!(d.check_and_mark("a").await.unwrap());
    assert!(!d.check_and_mark("c").await.unwrap());
}
