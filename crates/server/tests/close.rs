//! `POST /api/gateway/close` (ADR-0061 decision 8): close a pull request this
//! company opened and delete its draft branch. Idempotent, lease-fenced,
//! never a merged pull request, never somebody else's.

mod common;

use common::{article, article_path, TestServer, LEASE};
use github::{NewPullRequest, PrState, PutFile, RepoApi};
use reqwest::Method;
use serde_json::json;

use swarmpress_server::db::gateway::{get_pr, GatewayPr};

const SLUG: &str = "harvest-week-in-manarola";
const TITLE: &str = "Harvest Week in Manarola";

/// The gateway's record of a pull request.
async fn record(s: &TestServer, company: &str, number: u64) -> GatewayPr {
    get_pr(&s.db, company, i64::try_from(number).unwrap())
        .await
        .unwrap()
        .expect("a gateway pull request")
}

#[tokio::test]
async fn close_closes_the_pull_request_and_deletes_the_branch_once() {
    let s = TestServer::start().await;
    let p = s.gateway_player(1).await;
    let gh = s.fake_github();
    let (st, d) = s
        .draft_article(&p, "c1", SLUG, article("c1", SLUG, TITLE))
        .await;
    assert_eq!(st, 200, "{d}");
    let number = d["number"].as_u64().unwrap();
    assert!(gh.branch_head(&p.repo, "drafts/content-c1").is_some());

    let (st, c) = s.gateway(&p, "close", json!({ "number": number })).await;
    assert_eq!(st, 200, "{c}");
    assert_eq!(
        c,
        json!({ "number": number, "closed": true, "already_closed": false, "branch_deleted": true })
    );
    let pr = gh.get_pr(&p.repo, number).await.unwrap();
    assert_eq!((pr.state, pr.merged), (PrState::Closed, false));
    assert_eq!(gh.branch_head(&p.repo, "drafts/content-c1"), None);
    assert!(gh.file_text(&p.repo, "main", &article_path(SLUG)).is_none());
    let row = record(&s, &p.company, number).await;
    assert_eq!(row.state(), "closed");
    assert!(row.closed_at.is_some() && row.merged_sha.is_none());

    // Closing again answers the same and asks GitHub nothing.
    gh.clear_calls();
    let (st, c) = s.gateway(&p, "close", json!({ "number": number })).await;
    assert_eq!(st, 200, "{c}");
    assert_eq!(
        c,
        json!({ "number": number, "closed": true, "already_closed": true, "branch_deleted": false })
    );
    assert!(gh.calls().is_empty(), "{:?}", gh.calls());

    // A closed pull request cannot be merged.
    let (st, m) = s
        .gateway(
            &p,
            "merge",
            json!({ "number": number, "head_sha": d["head_sha"] }),
        )
        .await;
    assert_eq!(st, 409, "{m}");
    assert!(s.inbox(&p.cookie).await.is_empty());

    // The path is free again: another content id can draft the slug, and the
    // closed content id gets a fresh branch and pull request.
    let (st, d2) = s
        .draft_article(&p, "c2", SLUG, article("c2", SLUG, TITLE))
        .await;
    assert_eq!(st, 200, "{d2}");
    assert_ne!(d2["number"], number);
    let (st, c2) = s
        .gateway(&p, "close", json!({ "number": d2["number"] }))
        .await;
    assert_eq!(st, 200, "{c2}");
    let (st, d3) = s
        .draft_article(&p, "c1", SLUG, article("c1", SLUG, TITLE))
        .await;
    assert_eq!(st, 200, "{d3}");
    assert_eq!(d3["created_pr"], true);
    assert_ne!(d3["number"], number);
}

#[tokio::test]
async fn close_is_limited_to_the_companys_own_open_pull_requests() {
    let s = TestServer::start().await;
    let a = s.gateway_player(1).await;
    let b = s.gateway_player(2).await;
    let (st, d) = s
        .draft_article(&a, "c1", SLUG, article("c1", SLUG, TITLE))
        .await;
    assert_eq!(st, 200, "{d}");
    let number = d["number"].as_u64().unwrap();
    s.fake_github().clear_calls();

    // Another company, and a number the gateway never opened.
    let (st, _) = s.gateway(&b, "close", json!({ "number": number })).await;
    assert_eq!(st, 404);
    let (st, _) = s
        .gateway(&a, "close", json!({ "number": number + 100 }))
        .await;
    assert_eq!(st, 404);
    // A pull request somebody opened by hand in the company's repository.
    let gh = s.fake_github();
    gh.create_branch(&a.repo, "feature/by-hand", "main")
        .await
        .unwrap();
    gh.put_file(
        &a.repo,
        &PutFile {
            branch: "feature/by-hand".into(),
            path: "README.md".into(),
            content: b"by hand\n".to_vec(),
            message: "by hand".into(),
            expected_sha: gh
                .get_file(&a.repo, "main", "README.md")
                .await
                .unwrap()
                .map(|f| f.sha),
            author: None,
        },
    )
    .await
    .unwrap();
    let foreign = gh
        .create_pr(
            &a.repo,
            &NewPullRequest {
                title: "By hand".into(),
                head: "feature/by-hand".into(),
                base: "main".into(),
                body: String::new(),
                draft: false,
            },
        )
        .await
        .unwrap();
    gh.clear_calls();
    let (st, _) = s
        .gateway(&a, "close", json!({ "number": foreign.number }))
        .await;
    assert_eq!(st, 404);
    assert!(gh.calls().is_empty(), "{:?}", gh.calls());
    assert_eq!(
        gh.get_pr(&a.repo, foreign.number).await.unwrap().state,
        PrState::Open
    );
    assert!(gh.branch_head(&a.repo, "feature/by-hand").is_some());

    // The lease fences it like every gateway write.
    let (st, _) = s
        .send_json(
            Method::POST,
            "/api/gateway/close",
            Some(&a.cookie),
            &[],
            Some(json!({ "number": number })),
        )
        .await;
    assert_eq!(st, 428);
    let (st, _) = s
        .send_json(
            Method::POST,
            "/api/gateway/close",
            Some(&a.cookie),
            &[(LEASE, "1.not-the-lease")],
            Some(json!({ "number": number })),
        )
        .await;
    assert_eq!(st, 409);
    assert_eq!(
        s.fake_github().get_pr(&a.repo, number).await.unwrap().state,
        PrState::Open
    );

    // A merged pull request is not closed, and its record stays merged.
    let (st, m) = s
        .gateway(
            &a,
            "merge",
            json!({ "number": number, "head_sha": d["head_sha"] }),
        )
        .await;
    assert_eq!(st, 200, "{m}");
    let (st, c) = s.gateway(&a, "close", json!({ "number": number })).await;
    assert_eq!(st, 409, "{c}");
    let row = record(&s, &a.company, number).await;
    assert!(row.merged_sha.is_some() && row.closed_at.is_none());
}

#[tokio::test]
async fn close_finishes_what_an_interrupted_close_left_behind() {
    let s = TestServer::start().await;
    let p = s.gateway_player(1).await;
    let gh = s.fake_github();
    let (_, d) = s
        .draft_article(&p, "c1", SLUG, article("c1", SLUG, TITLE))
        .await;
    let number = d["number"].as_u64().unwrap();

    // Closed on GitHub by hand: the gateway still removes the branch and
    // records the close.
    gh.close_pr(&p.repo, number).await.unwrap();
    gh.clear_calls();
    let (st, c) = s.gateway(&p, "close", json!({ "number": number })).await;
    assert_eq!(st, 200, "{c}");
    assert_eq!(c["already_closed"], false);
    assert_eq!(c["branch_deleted"], true);
    assert!(
        !gh.calls().iter().any(|c| c == "close_pr"),
        "{:?}",
        gh.calls()
    );
    assert_eq!(gh.branch_head(&p.repo, "drafts/content-c1"), None);

    // GitHub fails while deleting the branch: the close is not recorded, and
    // the retry completes it.
    let (_, d) = s
        .draft_article(&p, "c1", SLUG, article("c1", SLUG, TITLE))
        .await;
    let number = d["number"].as_u64().unwrap();
    gh.fail_next(
        "delete_branch",
        github::GitHubError::Transport("connection reset".into()),
    );
    let (st, _) = s.gateway(&p, "close", json!({ "number": number })).await;
    assert_eq!(st, 502);
    assert!(gh.branch_head(&p.repo, "drafts/content-c1").is_some());
    let (st, c) = s.gateway(&p, "close", json!({ "number": number })).await;
    assert_eq!(st, 200, "{c}");
    assert_eq!(c["already_closed"], false);
    assert_eq!(c["branch_deleted"], true);
    assert_eq!(gh.branch_head(&p.repo, "drafts/content-c1"), None);
}
