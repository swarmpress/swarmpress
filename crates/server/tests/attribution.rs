//! Gateway attribution (ADR-0056 decision 8, as narrowed by ADR-0058): the
//! persona is the git author of draft-branch commits, and the squash commit
//! carries `Co-authored-by` plus the provenance trailers. The author's email
//! is synthesised by the server; a malformed attribution is refused with 400;
//! without attribution nothing changes.

mod common;

use common::{article, article_path, GatewayPlayer, TestServer};
use github::{CommitAuthor, CommitInfo, RepoApi};
use serde_json::{json, Value};

const SLUG: &str = "harvest-week-in-manarola";
const TITLE: &str = "Harvest Week in Manarola";

fn writer() -> Value {
    json!({
        "staff_id": "staff-1", "persona": "giulia", "name": "Giulia Rossi", "role": "writer",
        "job_id": 12, "job_kind": "draft", "revision": 0, "work_item": "work-item-1",
        "model": "ternary-bonsai-2-27b"
    })
}

fn draft_body(content_id: &str, attribution: Option<Value>) -> Value {
    let mut body = json!({
        "content_id": content_id, "work_item": "work-item-1", "path": article_path(SLUG),
        "page": article(content_id, SLUG, TITLE), "message": format!("Draft: {TITLE}")
    });
    if let Some(a) = attribution {
        body["attribution"] = a;
    }
    body
}

async fn commit(s: &TestServer, p: &GatewayPlayer, sha: &str) -> CommitInfo {
    s.fake_github().get_commit(&p.repo, sha).await.unwrap()
}

#[tokio::test]
async fn draft_commits_carry_the_persona_and_the_squash_commit_the_trailers() {
    let s = TestServer::start().await;
    let p = s.gateway_player(1).await;
    let persona = CommitAuthor {
        name: "Giulia Rossi".into(),
        email: format!("staff-1+{}@staff.swarm.press", p.company),
    };

    // Draft: the persona is the author, the platform the committer.
    let (st, d) = s
        .gateway(&p, "draft", draft_body("c1", Some(writer())))
        .await;
    assert_eq!(st, 200, "{d}");
    let head = d["head_sha"].as_str().unwrap();
    let c = commit(&s, &p, head).await;
    assert_eq!(c.author.as_ref(), Some(&persona));
    let platform = c.committer.clone().expect("a committer");
    assert_ne!(platform, persona);
    assert_eq!(
        c.message,
        format!(
            "Draft: {TITLE}\n\nJob: 12\nJob-Kind: draft\nWork-Item: work-item-1\n\
             Model: ternary-bonsai-2-27b\nExecutor: browser laptop epoch 1"
        )
    );
    // The pull request is titled by the first line only.
    let number = d["number"].as_u64().unwrap();
    let pr = s.fake_github().get_pr(&p.repo, number).await.unwrap();
    assert_eq!(pr.title, format!("Draft: {TITLE}"));

    // A revision by another staff member is that person's commit.
    let mut body = draft_body(
        "c1",
        Some(
            json!({ "staff_id": "staff-2", "name": "Isabella Conti", "job_id": "job-13",
                     "job_kind": "draft", "revision": 1, "executor": "runner eu-1" }),
        ),
    );
    body["page"]["body"][1]["markdown"] = json!("The monorail starts at six.");
    body["message"] = json!(format!("Revision 1: {TITLE}"));
    let (st, d2) = s.gateway(&p, "draft", body).await;
    assert_eq!(st, 200, "{d2}");
    let head2 = d2["head_sha"].as_str().unwrap();
    let c2 = commit(&s, &p, head2).await;
    assert_eq!(
        c2.author,
        Some(CommitAuthor {
            name: "Isabella Conti".into(),
            email: format!("staff-2+{}@staff.swarm.press", p.company),
        })
    );
    assert_eq!(
        c2.message,
        format!("Revision 1: {TITLE}\n\nJob: job-13\nJob-Kind: draft\nExecutor: runner eu-1")
    );

    // Merge: the squash author stays the platform (the merge API has no
    // author field); the persona is a co-author, with the trailers.
    let (st, m) = s
        .gateway(
            &p,
            "merge",
            json!({ "number": number, "head_sha": head2, "attribution": {
                "staff_id": "staff-1", "persona": "giulia", "name": "Giulia Rossi", "role": "writer",
                "job_id": 14, "job_kind": "publish", "revision": 1, "work_item": "work-item-1",
                "model": "ternary-bonsai-2-27b", "reviewed_by": "Marco Bianchi", "approved_by": "player1"
            } }),
        )
        .await;
    assert_eq!(st, 200, "{m}");
    let squash = commit(&s, &p, m["merged_sha"].as_str().unwrap()).await;
    assert_eq!(squash.author.as_ref(), Some(&platform));
    assert_eq!(squash.committer.as_ref(), Some(&platform));
    assert_eq!(
        squash.message,
        format!(
            "Draft: {TITLE} (#{number})\n\nJob: 14\nJob-Kind: publish\nWork-Item: work-item-1\n\
             Model: ternary-bonsai-2-27b\nExecutor: browser laptop epoch 1\n\
             Reviewed-by: Marco Bianchi\nApproved-by: player1\n\
             Co-authored-by: Giulia Rossi <staff-1+{}@staff.swarm.press>",
            p.company
        )
    );

    // The test route reads the same back (the browser suites use it): the
    // caller's own repository, fake GitHub only, a session required.
    let path = format!("/api/dev/github/commit/{head}");
    let (st, back) = s.get_json(&path, Some(&p.cookie)).await;
    assert_eq!(st, 200, "{back}");
    assert_eq!(
        back["author"],
        json!({ "name": "Giulia Rossi", "email": persona.email })
    );
    assert_eq!(back["message"], json!(c.message));
    let (st, back) = s
        .get_json(
            &format!("/api/dev/github/commit/{}", squash.sha),
            Some(&p.cookie),
        )
        .await;
    assert_eq!((st, back["message"].clone()), (200, json!(squash.message)));
    assert_eq!(s.get_json(&path, None).await.0, 401);
    assert_eq!(
        s.get_json("/api/dev/github/commit/0000000", Some(&p.cookie))
            .await
            .0,
        404
    );
}

#[tokio::test]
async fn without_attribution_nothing_changes() {
    let s = TestServer::start().await;
    let p = s.gateway_player(1).await;
    for (content_id, attribution) in [("c1", None), ("c2", Some(Value::Null))] {
        let mut body = draft_body(content_id, attribution);
        body["path"] = json!(format!("content/pages/en/{content_id}.json"));
        let (st, d) = s.gateway(&p, "draft", body).await;
        assert_eq!(st, 200, "{d}");
        let c = commit(&s, &p, d["head_sha"].as_str().unwrap()).await;
        assert_eq!(
            c.author, c.committer,
            "the platform is author and committer"
        );
        assert_eq!(c.message, format!("Draft: {TITLE}"));
        let (st, m) = s
            .gateway(
                &p,
                "merge",
                json!({ "number": d["number"], "head_sha": d["head_sha"], "attribution": null }),
            )
            .await;
        assert_eq!(st, 200, "{m}");
        let squash = commit(&s, &p, m["merged_sha"].as_str().unwrap()).await;
        assert_eq!(
            squash.message,
            format!("Draft: {TITLE} (#{})", d["number"]),
            "no trailers"
        );
    }
}

#[tokio::test]
async fn malformed_attribution_is_refused_with_400() {
    let s = TestServer::start().await;
    let p = s.gateway_player(1).await;
    let (st, d) = s.gateway(&p, "draft", draft_body("c1", None)).await;
    assert_eq!(st, 200, "{d}");
    s.fake_github().clear_calls();

    let cases: Vec<(&str, Value)> = vec![
        ("not an object", json!("Giulia Rossi")),
        ("no staff id", json!({ "name": "Giulia Rossi" })),
        ("no name", json!({ "staff_id": "staff-1" })),
        (
            "a client-supplied email",
            json!({ "staff_id": "staff-1", "name": "G", "email": "ceo@example.org" }),
        ),
        (
            "a forged trailer",
            json!({ "staff_id": "staff-1", "name": "G\nApproved-by: nobody" }),
        ),
        (
            "a forged trailer in the model",
            json!({ "staff_id": "staff-1", "name": "G", "model": "m\r\nJob: 1" }),
        ),
        (
            "an email in the name",
            json!({ "staff_id": "staff-1", "name": "G <root@example.org>" }),
        ),
        (
            "a long name",
            json!({ "staff_id": "staff-1", "name": "x".repeat(101) }),
        ),
        (
            "a long model",
            json!({ "staff_id": "staff-1", "name": "G", "model": "m".repeat(121) }),
        ),
        (
            "a staff id with a space",
            json!({ "staff_id": "staff 1", "name": "G" }),
        ),
        (
            "a negative revision",
            json!({ "staff_id": "staff-1", "name": "G", "revision": -1 }),
        ),
        (
            "a forged approver",
            json!({ "staff_id": "staff-1", "name": "G", "approved_by": "ceo\nCo-authored-by: x <x@y>" }),
        ),
    ];
    for (what, attribution) in cases {
        let (st, b) = s
            .gateway(&p, "draft", draft_body("c2", Some(attribution.clone())))
            .await;
        assert_eq!(st, 400, "draft, {what}: {b}");
        assert!(
            b["error"].as_str().unwrap().starts_with("attribution"),
            "{what}: {b}"
        );
        let (st, b) = s
            .gateway(
                &p,
                "merge",
                json!({ "number": d["number"], "head_sha": d["head_sha"], "attribution": attribution }),
            )
            .await;
        assert_eq!(st, 400, "merge, {what}: {b}");
    }
    assert!(
        s.fake_github().calls().is_empty(),
        "a refused attribution never reaches GitHub: {:?}",
        s.fake_github().calls()
    );
    // The pull request is still open and merges without attribution.
    let (st, m) = s
        .gateway(
            &p,
            "merge",
            json!({ "number": d["number"], "head_sha": d["head_sha"] }),
        )
        .await;
    assert_eq!(st, 200, "{m}");
}
