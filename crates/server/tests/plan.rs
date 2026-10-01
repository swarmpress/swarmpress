//! Publishing-plan text store: schema, append-only posts, REST scoping and
//! validation, agent plan ops (accepted/rejected, one transaction with the
//! job result) and the `PlanPost` WebSocket stream.

mod common;

use std::sync::Arc;
use std::time::Duration;

use common::TestServer;
use serde_json::{json, Value};
use simpress_server::jobs::{Executor, NewJob};
use simpress_server::plan::{
    JobCompletion, PlanHub, PlanOp, PlanOpContext, PlanOpValidator, PlanService,
};
use simpress_server::wire::{ClientFrame, ServerFrame};
use sqlx::PgPool;
use testkit::ws::WsClient;
use uuid::Uuid;

const T: Duration = Duration::from_secs(5);

async fn company(pool: &PgPool, github_id: i64) -> Uuid {
    let u = simpress_server::db::upsert_github_user(
        pool,
        github_id,
        &format!("u{github_id}"),
        None,
        None,
    )
    .await
    .unwrap();
    simpress_server::db::create_company(pool, u.id, "Gazette", 7, 60)
        .await
        .unwrap()
        .unwrap()
        .id
}

#[sqlx::test(migrations = "./migrations")]
async fn plan_tables_exist_and_posts_are_append_only(pool: PgPool) {
    let tables: Vec<(String,)> = sqlx::query_as(
        "SELECT table_name::text FROM information_schema.tables WHERE table_schema = 'public'",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    let names: Vec<_> = tables.into_iter().map(|t| t.0).collect();
    for t in [
        "projects",
        "plan_items",
        "plan_workstreams",
        "plan_goals",
        "plan_todos",
        "plan_posts",
        "tracker_salts",
        "tracker_events",
        "analytics_daily",
        "analytics_daily_totals",
        "analytics_signals",
    ] {
        assert!(names.contains(&t.to_string()), "missing table {t}");
    }

    let c = company(&pool, 1).await;
    let (id,): (i64,) = sqlx::query_as(
        "INSERT INTO plan_posts (company_id, item_id, type, author, text, game_day, game_minute)
         VALUES ($1, 'work-item-1', 'comment', 'staff-1', 'hi', 0, 420) RETURNING id",
    )
    .bind(c)
    .fetch_one(&pool)
    .await
    .unwrap();

    let upd = sqlx::query("UPDATE plan_posts SET text = 'edited' WHERE id = $1")
        .bind(id)
        .execute(&pool)
        .await;
    assert!(
        upd.unwrap_err().to_string().contains("append-only"),
        "UPDATE must raise"
    );
    let del = sqlx::query("DELETE FROM plan_posts WHERE id = $1")
        .bind(id)
        .execute(&pool)
        .await;
    assert!(del.unwrap_err().to_string().contains("append-only"));
    let trunc = sqlx::query("TRUNCATE plan_posts").execute(&pool).await;
    assert!(trunc.unwrap_err().to_string().contains("append-only"));

    // Bad type / author are refused by CHECK constraints.
    for (ty, author) in [("gossip", "staff-1"), ("comment", "giulia")] {
        let bad = sqlx::query(
            "INSERT INTO plan_posts (company_id, item_id, type, author, game_day, game_minute)
             VALUES ($1, 'work-item-1', $2, $3, 0, 0)",
        )
        .bind(c)
        .bind(ty)
        .bind(author)
        .execute(&pool)
        .await;
        assert!(bad.is_err(), "{ty}/{author} must be rejected");
    }

    // Deleting the company still cascades through the trigger.
    sqlx::query("DELETE FROM companies WHERE id = $1")
        .bind(c)
        .execute(&pool)
        .await
        .unwrap();
    let (n,): (i64,) = sqlx::query_as("SELECT count(*) FROM plan_posts")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(n, 0);
}

#[sqlx::test(migrations = "./migrations")]
async fn rest_requires_auth_and_is_company_scoped(pool: PgPool) {
    let s = TestServer::start(pool).await;
    assert_eq!(s.get_json("/api/plan", None).await.0, 401);
    assert_eq!(
        s.post_json(
            "/api/plan/items/work-item-1/posts",
            None,
            json!({ "type": "comment", "text": "x" })
        )
        .await
        .0,
        401
    );

    // Signed in without a company: 404.
    let lonely = s.login(99, "lonely").await;
    assert_eq!(s.get_json("/api/plan", Some(&lonely)).await.0, 404);

    let (a, _) = s.player(1).await;
    let (b, _) = s.player(2).await;

    let (st, _) = s
        .put_json(
            "/api/plan/items/work-item-4",
            Some(&a),
            json!({ "title": "Harvest week in Manarola", "brief": "Angle: the families." }),
        )
        .await;
    assert_eq!(st, 200);
    let (st, _) = s
        .put_json(
            "/api/plan/items/work-item-4",
            Some(&a),
            json!({ "brief": "Angle: the families who still pick by hand." }),
        )
        .await;
    assert_eq!(st, 200);
    let (st, todo) = s
        .post_json(
            "/api/plan/todos",
            Some(&a),
            json!({ "itemId": "work-item-4", "todoId": "todo-9", "text": "Three photos of the Volastra terraces" }),
        )
        .await;
    assert_eq!(st, 201, "{todo}");
    assert_eq!(todo["post"]["type"], "todo-add");
    let (st, _) = s
        .post_json(
            "/api/plan/todos",
            Some(&a),
            json!({ "itemId": "work-item-4", "todoId": "todo-9", "text": "dup" }),
        )
        .await;
    assert_eq!(st, 409);
    assert_eq!(
        s.put_json(
            "/api/plan/workstreams/ws-1",
            Some(&a),
            json!({ "title": "Autumn harvest season" })
        )
        .await
        .0,
        200
    );
    assert_eq!(
        s.put_json(
            "/api/plan/goals/goal-1",
            Some(&a),
            json!({ "title": "40k monthly readers" })
        )
        .await
        .0,
        200
    );
    let (st, _) = s
        .post_json(
            "/api/plan/items/work-item-4/posts",
            Some(&a),
            json!({ "type": "comment", "text": "Lead with the Sciacchetrà." }),
        )
        .await;
    assert_eq!(st, 201);

    let (st, plan) = s.get_json("/api/plan", Some(&a)).await;
    assert_eq!(st, 200);
    assert_eq!(
        plan["items"]["work-item-4"]["title"],
        "Harvest week in Manarola"
    );
    assert_eq!(
        plan["items"]["work-item-4"]["brief"],
        "Angle: the families who still pick by hand."
    );
    assert_eq!(
        plan["todos"]["todo-9"],
        "Three photos of the Volastra terraces"
    );
    assert_eq!(
        plan["workstreams"]["ws-1"]["title"],
        "Autumn harvest season"
    );
    assert_eq!(plan["goals"]["goal-1"]["title"], "40k monthly readers");
    let posts = plan["posts"]["work-item-4"].as_array().unwrap();
    assert_eq!(posts.len(), 2);
    assert_eq!(posts[1]["type"], "comment");
    assert_eq!(posts[1]["author"], "ceo");
    assert!(posts[1]["id"].as_str().unwrap().starts_with("post-"));
    assert!(posts[1]["day"].is_number() && posts[1]["minute"].is_number());

    // Player B sees none of it.
    let (st, other) = s.get_json("/api/plan", Some(&b)).await;
    assert_eq!(st, 200);
    assert_eq!(
        other,
        json!({ "items": {}, "todos": {}, "workstreams": {}, "goals": {}, "posts": {} })
    );
    let (st, other_posts) = s
        .get_json("/api/plan/items/work-item-4/posts", Some(&b))
        .await;
    assert_eq!(st, 200);
    assert_eq!(other_posts["posts"], json!([]));

    // `after` paging.
    let first = posts[0]["id"].as_str().unwrap();
    let (_, page) = s
        .get_json(
            &format!("/api/plan/items/work-item-4/posts?after={first}"),
            Some(&a),
        )
        .await;
    assert_eq!(page["posts"].as_array().unwrap().len(), 1);
    assert_eq!(page["posts"][0]["id"], posts[1]["id"]);
    assert_eq!(
        s.get_json("/api/plan/items/work-item-4/posts?after=nope", Some(&a))
            .await
            .0,
        400
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn ceo_posts_are_validated(pool: PgPool) {
    let s = TestServer::start(pool).await;
    let (a, _) = s.player(1).await;
    let url = "/api/plan/items/work-item-4/posts";
    for (body, why) in [
        (
            json!({ "type": "review", "text": "8/10" }),
            "CEO cannot review",
        ),
        (
            json!({ "type": "status", "text": "done" }),
            "status is system-only",
        ),
        (json!({ "type": "comment", "text": "   " }), "empty"),
        (
            json!({ "type": "comment", "text": "x".repeat(4001) }),
            "too long",
        ),
        (
            json!({ "type": "comment", "text": "hi", "to": "giulia" }),
            "bad addressee",
        ),
        (
            json!({ "type": "decision", "text": "x", "payload": [1] }),
            "payload must be an object",
        ),
    ] {
        let (st, res) = s.post_json(url, Some(&a), body).await;
        assert_eq!(st, 400, "{why}: {res}");
    }
    let (st, _) = s
        .post_json(
            "/api/plan/items/Not_An_Id/posts",
            Some(&a),
            json!({ "type": "comment", "text": "x" }),
        )
        .await;
    assert_eq!(st, 400);

    let (st, d) = s
        .post_json(
            url,
            Some(&a),
            json!({ "type": "decision", "text": "We cut the restaurant list to 8.", "to": "staff-5",
                    "payload": { "ticket": "ticket-3" } }),
        )
        .await;
    assert_eq!(st, 201, "{d}");
    assert_eq!(d["type"], "decision");
    assert_eq!(d["author"], "ceo");
    assert_eq!(d["to"], "staff-5");
    assert_eq!(d["payload"]["ticket"], "ticket-3");
    // Default sim start is 07:00 on day 0; a fresh company is at most a few
    // seconds in.
    assert_eq!(d["day"], 0);
    assert!(d["minute"].as_i64().unwrap() >= 420);
}

/// Rejects decisions from anyone but staff-5 and any op mentioning "forbidden".
struct FakeRbac;

impl PlanOpValidator for FakeRbac {
    fn validate(&self, ctx: &PlanOpContext, op: &PlanOp) -> Result<(), String> {
        if op.op == "decision" && ctx.actor != "staff-5" {
            return Err(format!("{} may not post decisions", ctx.actor));
        }
        if op.text.contains("forbidden") {
            return Err("forbidden".into());
        }
        Ok(())
    }
}

fn service(pool: &PgPool, hub: PlanHub) -> PlanService {
    PlanService::new(
        pool.clone(),
        hub,
        Arc::new(FakeRbac),
        Duration::from_millis(100),
    )
}

fn agent_ops() -> Vec<Value> {
    vec![
        json!({ "op": "handoff", "text": "Draft is in; need 2 harvest photos.", "to": "staff-6" }),
        json!({ "op": "decision", "text": "We cut the list to 8." }), // RBAC: rejected
        json!({ "op": "todo-add", "text": "Two harvest photos", "todo_id": "todo-12" }),
        json!({ "op": "review", "verdict": "approve", "score": 12 }), // schema: rejected
        json!({ "type": "review", "notes": "Solid.", "verdict": "approve", "score": 8 }),
        json!({ "op": "comment", "text": "this is forbidden" }), // RBAC: rejected
        json!("not an object"),                                  // schema: rejected
    ]
}

async fn post_count(pool: &PgPool, company: Uuid) -> i64 {
    sqlx::query_scalar("SELECT count(*) FROM plan_posts WHERE company_id = $1")
        .bind(company)
        .fetch_one(pool)
        .await
        .unwrap()
}

#[sqlx::test(migrations = "./migrations")]
async fn agent_ops_split_accepted_and_rejected(pool: PgPool) {
    let c = company(&pool, 1).await;
    let hub = PlanHub::default();
    let mut rx = hub.subscribe(c);
    let svc = service(&pool, hub);

    let out = svc
        .apply_agent_ops(c, "work-item-4", "staff-1", &agent_ops())
        .await
        .unwrap();
    let accepted: Vec<_> = out.accepted.iter().map(|p| p.kind.as_str()).collect();
    assert_eq!(accepted, ["handoff", "todo-add", "review"]);
    let rejected: Vec<_> = out.rejected.iter().map(|r| r.index).collect();
    assert_eq!(rejected, [1, 3, 5, 6]);
    assert!(out.rejected[0].reason.contains("decisions"));
    assert!(out.rejected[1].reason.contains("score"));
    assert_eq!(out.accepted[0].to.as_deref(), Some("staff-6"));
    assert_eq!(out.accepted[2].text, "Solid.");
    assert_eq!(
        out.accepted[2].payload,
        json!({ "verdict": "approve", "score": 8 })
    );
    assert!(out.accepted.iter().all(|p| p.author == "staff-1"));
    assert_eq!(post_count(&pool, c).await, 3);
    let (todo,): (String,) =
        sqlx::query_as("SELECT text FROM plan_todos WHERE company_id = $1 AND todo_id = 'todo-12'")
            .bind(c)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(todo, "Two harvest photos");

    // Every accepted post was broadcast, in order.
    for p in &out.accepted {
        match &*rx.recv().await.unwrap() {
            ServerFrame::PlanPost { item_id, post_json } => {
                assert_eq!(item_id, "work-item-4");
                let v: Value = serde_json::from_str(post_json).unwrap();
                assert_eq!(v["id"], p.id);
            }
            f => panic!("unexpected frame {f:?}"),
        }
    }

    // staff-5 may decide. An invalid actor gets everything rejected.
    let ok = svc
        .apply_agent_ops(
            c,
            "work-item-4",
            "staff-5",
            &[json!({ "op": "decision", "text": "Go." })],
        )
        .await
        .unwrap();
    assert_eq!(ok.accepted.len(), 1);
    let bad = svc
        .apply_agent_ops(
            c,
            "work-item-4",
            "ceo",
            &[json!({ "op": "comment", "text": "hi" })],
        )
        .await
        .unwrap();
    assert!(bad.accepted.is_empty());
    assert!(bad.rejected[0].reason.contains("actor"));
    // Digest is a pure function of the accepted post ids.
    assert_ne!(out.ops_digest, ok.ops_digest);
}

#[sqlx::test(migrations = "./migrations")]
async fn agent_ops_commit_with_the_job_result_in_one_transaction(pool: PgPool) {
    let c = company(&pool, 1).await;
    let svc = service(&pool, PlanHub::default());
    let jobs = simpress_server::jobs::JobQueue::new(pool.clone(), Default::default());
    let new_job = || {
        NewJob::new(
            "draft_article",
            Executor::Claude,
            json!({ "item_id": "work-item-4", "actor": "staff-1" }),
        )
        .company(c)
    };
    let id = jobs.enqueue(&new_job()).await.unwrap().id;
    let job = jobs
        .claim_next(
            Executor::Claude,
            Some(c),
            0,
            "worker-a",
            Duration::from_secs(30),
        )
        .await
        .unwrap()
        .unwrap();
    assert_eq!(job.id, id);
    let artifact = json!({ "title": "Harvest week", "planOps": agent_ops() });

    // Wrong lease owner: nothing is written (posts roll back with the job update).
    let lost = svc
        .complete_job_with_ops(
            c,
            "work-item-4",
            "staff-1",
            &agent_ops(),
            JobCompletion {
                job_id: id,
                owner: "worker-b",
                result: &artifact,
            },
        )
        .await
        .unwrap();
    assert!(lost.is_none());
    assert_eq!(post_count(&pool, c).await, 0);
    let (todos,): (i64,) = sqlx::query_as("SELECT count(*) FROM plan_todos")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(todos, 0, "todo text rolled back too");
    assert_eq!(jobs.get(id).await.unwrap().unwrap().status, "running");

    // The lease holder: job succeeded and posts appended together.
    let out = svc
        .complete_job_with_ops(
            c,
            "work-item-4",
            "staff-1",
            &agent_ops(),
            JobCompletion {
                job_id: id,
                owner: "worker-a",
                result: &artifact,
            },
        )
        .await
        .unwrap()
        .unwrap();
    assert_eq!(out.accepted.len(), 3);
    assert_eq!(post_count(&pool, c).await, 3);
    let job = jobs.get(id).await.unwrap().unwrap();
    assert_eq!(job.status, "succeeded");
    let result = job.result.unwrap();
    assert_eq!(result["title"], "Harvest week");
    let summary = &result["planOpsOutcome"];
    assert_eq!(summary["accepted"].as_array().unwrap().len(), 3);
    assert_eq!(summary["rejected"].as_array().unwrap().len(), 4);
    assert_eq!(summary["rejected"][0]["index"], 1);

    // A second completion of the same job is refused (fencing) and writes nothing.
    let again = svc
        .complete_job_with_ops(
            c,
            "work-item-4",
            "staff-1",
            &agent_ops(),
            JobCompletion {
                job_id: id,
                owner: "worker-a",
                result: &artifact,
            },
        )
        .await
        .unwrap();
    assert!(again.is_none());
    assert_eq!(post_count(&pool, c).await, 3);
}

async fn next_plan_post(ws: &mut WsClient, t: Duration) -> anyhow::Result<(String, Value)> {
    ws.recv_until(t, |f: &ServerFrame| match f {
        ServerFrame::PlanPost { item_id, post_json } => {
            Some((item_id.clone(), serde_json::from_str(post_json).unwrap()))
        }
        _ => None,
    })
    .await
}

#[sqlx::test(migrations = "./migrations")]
async fn plan_posts_stream_to_the_company_sockets_only(pool: PgPool) {
    let s = TestServer::start(pool).await;
    let (a, _) = s.player(1).await;
    let (b, _) = s.player(2).await;
    let mut a1 = s.ws(&a).await;
    let mut a2 = s.ws(&a).await;
    let mut b1 = s.ws(&b).await;
    for ws in [&mut a1, &mut a2, &mut b1] {
        let hello: ServerFrame = ws.recv().await.unwrap();
        assert!(matches!(hello, ServerFrame::Hello { .. }));
    }

    let (st, post) = s
        .post_json(
            "/api/plan/items/work-item-4/posts",
            Some(&a),
            json!({ "type": "comment", "text": "Ship it Friday." }),
        )
        .await;
    assert_eq!(st, 201);
    for ws in [&mut a1, &mut a2] {
        let (item, got) = next_plan_post(ws, T).await.unwrap();
        assert_eq!(item, "work-item-4");
        assert_eq!(got, post);
    }
    assert!(
        next_plan_post(&mut b1, Duration::from_millis(700))
            .await
            .is_err(),
        "another company's socket must not see the post"
    );

    // And B's own posts reach B only.
    s.post_json(
        "/api/plan/items/work-item-1/posts",
        Some(&b),
        json!({ "type": "comment", "text": "Mine." }),
    )
    .await;
    let (item, _) = next_plan_post(&mut b1, T).await.unwrap();
    assert_eq!(item, "work-item-1");
    assert!(next_plan_post(&mut a1, Duration::from_millis(500))
        .await
        .is_err());
}

#[sqlx::test(migrations = "./migrations")]
async fn browser_job_result_with_plan_ops_streams_posts(pool: PgPool) {
    let s = TestServer::start(pool.clone()).await;
    let (a, company_id) = s.player(1).await;
    let mut viewer = s.ws(&a).await;
    let _: ServerFrame = viewer.recv().await.unwrap();
    let mut worker = s.ws(&a).await;
    let _: ServerFrame = worker.recv().await.unwrap();

    let id =
        s.st.jobs
            .enqueue(
                &NewJob::new(
                    "review_article",
                    Executor::Browser,
                    json!({ "item_id": "work-item-4", "actor": "staff-2" }),
                )
                .company(company_id),
            )
            .await
            .unwrap()
            .id;
    worker
        .send(&ClientFrame::WorkerHello { tier: 1 })
        .await
        .unwrap();
    worker
        .recv_until(T, |f: &ServerFrame| {
            matches!(f, ServerFrame::JobOffer { .. }).then_some(())
        })
        .await
        .unwrap();
    worker
        .send(&ClientFrame::JobClaim {
            job_id: id.to_string(),
        })
        .await
        .unwrap();
    worker
        .recv_until(T, |f: &ServerFrame| {
            matches!(f, ServerFrame::JobLease { .. }).then_some(())
        })
        .await
        .unwrap();
    let artifact = json!({
        "verdict": "approve",
        "planOps": [
            { "op": "review", "text": "Clean draft.", "verdict": "approve", "score": 8 },
            { "op": "status", "text": "published" }
        ]
    });
    worker
        .send(&ClientFrame::JobResult {
            job_id: id.to_string(),
            artifact_json: artifact.to_string(),
        })
        .await
        .unwrap();
    let accepted = worker
        .recv_until(T, |f: &ServerFrame| match f {
            ServerFrame::JobAccepted { job_id } => Some(job_id.clone()),
            ServerFrame::JobRejected { reason, .. } => panic!("rejected: {reason}"),
            _ => None,
        })
        .await
        .unwrap();
    assert_eq!(accepted, id.to_string());

    let (item, post) = next_plan_post(&mut viewer, T).await.unwrap();
    assert_eq!(item, "work-item-4");
    assert_eq!(post["type"], "review");
    assert_eq!(post["author"], "staff-2");
    let job = s.st.jobs.get(id).await.unwrap().unwrap();
    assert_eq!(job.status, "succeeded");
    let outcome = &job.result.unwrap()["planOpsOutcome"];
    assert_eq!(outcome["accepted"].as_array().unwrap().len(), 1);
    assert_eq!(outcome["rejected"][0]["op"], "status");
}
