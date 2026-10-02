//! The executor lease (ADR-0038, ADR-0045): one executor holds a company at
//! a time, and a monotonic epoch fences its writes.

mod common;

use std::time::Duration;

use common::{Opts, TestServer};
use reqwest::Method;
use serde_json::{json, Value};

const LEASE: &str = "x-swarmpress-lease";

async fn take(
    s: &TestServer,
    cookie: &str,
    company: &str,
    device: &str,
    mode: &str,
) -> (u16, Value) {
    s.post_json(
        &format!("/api/companies/{company}/lease"),
        Some(cookie),
        json!({ "device_id": device, "mode": mode }),
    )
    .await
}

async fn renew(
    s: &TestServer,
    cookie: &str,
    company: &str,
    device: &str,
    token: &str,
) -> (u16, Value) {
    s.send_json(
        Method::POST,
        &format!("/api/companies/{company}/lease"),
        Some(cookie),
        &[(LEASE, token)],
        Some(json!({ "device_id": device, "mode": "renew" })),
    )
    .await
}

fn token(v: &Value) -> String {
    v["token"].as_str().unwrap().to_string()
}

async fn events(s: &TestServer, cookie: &str) -> Vec<Value> {
    let (st, body) = s.get_json("/api/events?after=0", Some(cookie)).await;
    assert_eq!(st, 200, "{body}");
    body["events"].as_array().unwrap().clone()
}

#[tokio::test]
async fn acquire_renew_conflict_force_and_expiry() {
    let s = TestServer::start().await;
    let (cookie, company) = s.player(1).await;

    // Acquire: the first lease of a company is epoch 1.
    let (st, a) = take(&s, &cookie, &company, "laptop", "acquire").await;
    assert_eq!(st, 200, "{a}");
    assert_eq!(a["holder"], "laptop");
    assert_eq!(a["holder_kind"], "browser");
    assert_eq!(a["epoch"], 1);
    assert_eq!(a["ttl_ms"], 90_000, "a relative TTL, not a timestamp");
    assert_eq!(a["renewed"], false);
    assert_eq!(a["handover_requested"], false);
    assert_eq!(a["head"], json!({ "number": 0, "digest": null }));
    let lease_a = a["lease_id"].as_str().unwrap().to_string();
    assert_eq!(token(&a), format!("1.{lease_a}"));
    assert!(a.get("expires_at").is_none());

    // Renew: same lease id, same epoch, a full TTL again.
    s.clock.advance(Duration::from_secs(30));
    let (st, r) = renew(&s, &cookie, &company, "laptop", &token(&a)).await;
    assert_eq!(st, 200, "{r}");
    assert_eq!(r["lease_id"], lease_a.as_str());
    assert_eq!(r["epoch"], 1);
    assert_eq!(r["renewed"], true);
    assert_eq!(r["ttl_ms"], 90_000);
    // A renew needs the token: 428 without it, 409 with a wrong one.
    let (st, _) = take(&s, &cookie, &company, "laptop", "renew").await;
    assert_eq!(st, 428);
    let (st, _) = renew(&s, &cookie, &company, "laptop", &format!("2.{lease_a}")).await;
    assert_eq!(st, 409, "right lease id, wrong epoch");
    let (st, _) = renew(&s, &cookie, &company, "laptop", "1.someone-else").await;
    assert_eq!(st, 409);
    let (st, _) = renew(&s, &cookie, &company, "laptop", &lease_a).await;
    assert_eq!(st, 409, "a bare lease id is not a token");

    // Another executor: 409 with the holder, its epoch and the time left.
    let (st, c) = take(&s, &cookie, &company, "phone", "acquire").await;
    assert_eq!(st, 409, "{c}");
    assert_eq!(c["holder"], "laptop");
    assert_eq!(c["holder_kind"], "browser");
    assert_eq!(c["epoch"], 1);
    assert_eq!(c["ttl_ms"], 90_000);
    assert_eq!(c["handover_requested"], false);

    // Force takes it over at epoch 2; the old holder cannot renew any more.
    let (st, f) = take(&s, &cookie, &company, "phone", "force").await;
    assert_eq!(st, 200, "{f}");
    assert_eq!(f["holder"], "phone");
    assert_eq!(f["epoch"], 2);
    let lease_b = f["lease_id"].as_str().unwrap().to_string();
    assert_ne!(lease_b, lease_a);
    let (st, _) = renew(&s, &cookie, &company, "laptop", &token(&a)).await;
    assert_eq!(st, 409);
    let (st, _) = take(&s, &cookie, &company, "laptop", "acquire").await;
    assert_eq!(st, 409);
    // The displaced holder is told: LeaseRevoked names its epoch.
    let evs = events(&s, &cookie).await;
    assert_eq!(evs.len(), 1, "{evs:?}");
    assert_eq!(evs[0]["kind"], "LeaseRevoked");
    assert_eq!(
        evs[0]["payload"],
        json!({ "epoch": 1, "holder": "laptop", "new_epoch": 2, "by": "phone" })
    );

    // After expiry anyone may take it: a fresh lease at epoch 3.
    s.clock.advance(Duration::from_secs(91));
    let (st, e) = take(&s, &cookie, &company, "laptop", "acquire").await;
    assert_eq!(st, 200, "{e}");
    assert_eq!(e["holder"], "laptop");
    assert_eq!(e["renewed"], false);
    assert_eq!(e["epoch"], 3);
    assert_ne!(e["lease_id"], lease_b.as_str());
}

#[tokio::test]
async fn the_epoch_rises_on_every_change_of_holder_and_is_never_reset() {
    let s = TestServer::start().await;
    let (cookie, company) = s.player(1).await;
    let path = format!("/api/companies/{company}/lease");

    let (_, a) = take(&s, &cookie, &company, "laptop", "acquire").await;
    assert_eq!(a["epoch"], 1);
    // Many renews: the epoch stays.
    for _ in 0..3 {
        s.clock.advance(Duration::from_secs(20));
        let (st, r) = renew(&s, &cookie, &company, "laptop", &token(&a)).await;
        assert_eq!((st, r["epoch"].as_i64()), (200, Some(1)));
    }
    // The same executor acquiring again (a reload) is a new holder instance:
    // a new lease id at epoch 2, and the old token is fenced out.
    let (st, b) = take(&s, &cookie, &company, "laptop", "acquire").await;
    assert_eq!(st, 200, "{b}");
    assert_eq!(b["epoch"], 2);
    assert_ne!(b["lease_id"], a["lease_id"]);
    let (st, _) = renew(&s, &cookie, &company, "laptop", &token(&a)).await;
    assert_eq!(st, 409);

    // Release keeps the epoch: the next holder gets 3, not 1.
    let (st, _) = s
        .send_json(
            Method::DELETE,
            &path,
            Some(&cookie),
            &[(LEASE, &token(&b))],
            None,
        )
        .await;
    assert_eq!(st, 204);
    let (st, _) = renew(&s, &cookie, &company, "laptop", &token(&b)).await;
    assert_eq!(st, 409, "a released lease cannot be renewed");
    let (st, c) = take(&s, &cookie, &company, "phone", "acquire").await;
    assert_eq!(st, 200, "{c}");
    assert_eq!(c["epoch"], 3);
    // Force by another device, then expiry and a fresh acquire: 4, 5.
    let (_, d) = take(&s, &cookie, &company, "laptop", "force").await;
    assert_eq!(d["epoch"], 4);
    s.clock.advance(Duration::from_secs(91));
    let (_, e) = take(&s, &cookie, &company, "tablet", "acquire").await;
    assert_eq!(e["epoch"], 5);
}

#[tokio::test]
async fn a_renew_past_expiry_succeeds_only_if_nobody_else_took_the_lease() {
    let s = TestServer::start().await;
    let (cookie, company) = s.player(1).await;

    // Expired, nobody took it (a laptop that slept): the renew still works.
    let (_, a) = take(&s, &cookie, &company, "laptop", "acquire").await;
    s.clock.advance(Duration::from_secs(600));
    let (st, r) = renew(&s, &cookie, &company, "laptop", &token(&a)).await;
    assert_eq!(st, 200, "{r}");
    assert_eq!(r["epoch"], 1);
    assert_eq!(r["lease_id"], a["lease_id"]);
    assert_eq!(r["ttl_ms"], 90_000);

    // Expired and taken by another executor: the renew is refused.
    s.clock.advance(Duration::from_secs(600));
    let (st, b) = take(&s, &cookie, &company, "phone", "acquire").await;
    assert_eq!(st, 200, "{b}");
    assert_eq!(b["epoch"], 2);
    let (st, _) = renew(&s, &cookie, &company, "laptop", &token(&a)).await;
    assert_eq!(st, 409);
    // An expired lease that was displaced was never released: its holder is told.
    let evs = events(&s, &cookie).await;
    assert_eq!(evs.last().unwrap()["kind"], "LeaseRevoked");
    assert_eq!(evs.last().unwrap()["payload"]["epoch"], 1);
}

#[tokio::test]
async fn request_records_a_handover_for_the_holder() {
    let s = TestServer::start().await;
    let (cookie, company) = s.player(1).await;
    let path = format!("/api/companies/{company}/lease");

    // A request on a free lease simply takes it.
    let (st, a) = take(&s, &cookie, &company, "runner-1", "request").await;
    assert_eq!(st, 200, "{a}");
    assert_eq!(a["epoch"], 1);

    // A request on a held lease: 409 with the holder, and the request is recorded.
    let (st, q) = take(&s, &cookie, &company, "laptop", "request").await;
    assert_eq!(st, 409, "{q}");
    assert_eq!(q["holder"], "runner-1");
    assert_eq!(q["epoch"], 1);
    assert_eq!(q["handover_requested"], true);
    let evs = events(&s, &cookie).await;
    assert_eq!(evs.len(), 1, "{evs:?}");
    assert_eq!(evs[0]["kind"], "HandoverRequested");
    assert_eq!(
        evs[0]["payload"],
        json!({ "epoch": 1, "holder": "runner-1", "by": "laptop" })
    );

    // The holder sees it on its next renew; the epoch is unchanged.
    let (st, r) = renew(&s, &cookie, &company, "runner-1", &token(&a)).await;
    assert_eq!(st, 200, "{r}");
    assert_eq!(r["epoch"], 1);
    assert_eq!(r["handover_requested"], true);
    assert_eq!(r["handover_by"], "laptop");

    // It releases; the requester acquires at epoch 2 with a clean slate.
    let (st, _) = s
        .send_json(
            Method::DELETE,
            &path,
            Some(&cookie),
            &[(LEASE, &token(&a))],
            None,
        )
        .await;
    assert_eq!(st, 204);
    let (st, b) = take(&s, &cookie, &company, "laptop", "acquire").await;
    assert_eq!(st, 200, "{b}");
    assert_eq!(b["epoch"], 2);
    assert_eq!(b["handover_requested"], false);
    // A release is not a revocation.
    assert_eq!(events(&s, &cookie).await.len(), 1);
}

#[tokio::test]
async fn executor_kinds() {
    let s = TestServer::start().await;
    let (cookie, company) = s.player(1).await;
    let path = format!("/api/companies/{company}/lease");

    // The default mode is acquire, the default kind is browser.
    let (st, a) = s
        .post_json(&path, Some(&cookie), json!({ "device_id": "laptop" }))
        .await;
    assert_eq!(st, 200, "{a}");
    assert_eq!(
        (a["holder_kind"].as_str(), a["epoch"].as_i64()),
        (Some("browser"), Some(1))
    );

    // A runner the player hosts.
    let (st, b) = s
        .post_json(
            &path,
            Some(&cookie),
            json!({ "device_id": "runner-1", "mode": "force", "kind": "self" }),
        )
        .await;
    assert_eq!(st, 200, "{b}");
    assert_eq!(b["holder_kind"], "self");
    let (st, c) = take(&s, &cookie, &company, "laptop", "acquire").await;
    assert_eq!(st, 409);
    assert_eq!(c["holder_kind"], "self");

    // A player session cannot claim to be a managed runner; unknown values are rejected.
    for kind in ["cloud", "robot"] {
        let (st, _) = s
            .post_json(
                &path,
                Some(&cookie),
                json!({ "device_id": "x", "mode": "force", "kind": kind }),
            )
            .await;
        assert!(st == 400 || st == 422, "{kind}: {st}");
    }
    let (st, _) = s
        .post_json(
            &path,
            Some(&cookie),
            json!({ "device_id": "x", "mode": "steal" }),
        )
        .await;
    assert!(st == 400 || st == 422, "{st}");
}

#[tokio::test]
async fn lease_ttl_is_configurable() {
    let s = TestServer::start_with(Opts {
        tweak: Box::new(|c| c.lease_ttl = Duration::from_secs(5)),
    })
    .await;
    let (cookie, company) = s.player(1).await;
    let (_, a) = take(&s, &cookie, &company, "laptop", "acquire").await;
    assert_eq!(a["ttl_ms"], 5_000);
    s.clock.advance(Duration::from_secs(2));
    let (st, c) = take(&s, &cookie, &company, "phone", "acquire").await;
    assert_eq!((st, c["ttl_ms"].as_i64()), (409, Some(3_000)));
    s.clock.advance(Duration::from_secs(4));
    let (st, _) = take(&s, &cookie, &company, "phone", "acquire").await;
    assert_eq!(st, 200, "expired after 5 s");
}

#[tokio::test]
async fn release_and_ownership() {
    let s = TestServer::start().await;
    let (cookie, company) = s.player(1).await;
    let (other, other_company) = s.player(2).await;
    let lease = s.lease(&cookie, &company, "laptop").await;

    // Not your company → 403; no such company → 404; signed out → 401.
    let (st, _) = take(&s, &other, &company, "x", "force").await;
    assert_eq!(st, 403);
    let (st, _) = take(
        &s,
        &cookie,
        "00000000-0000-0000-0000-000000000000",
        "x",
        "acquire",
    )
    .await;
    assert_eq!(st, 404);
    let (st, _) = s
        .post_json(
            &format!("/api/companies/{company}/lease"),
            None,
            json!({ "device_id": "x" }),
        )
        .await;
    assert_eq!(st, 401);
    let (st, _) = take(&s, &cookie, &company, "bad device id!", "acquire").await;
    assert_eq!(st, 400);
    // Leases are per company.
    let (st, _) = take(&s, &other, &other_company, "phone", "acquire").await;
    assert_eq!(st, 200);

    // Release needs the current token.
    let path = format!("/api/companies/{company}/lease");
    let (st, _) = s
        .send_json(Method::DELETE, &path, Some(&cookie), &[], None)
        .await;
    assert_eq!(st, 428);
    for stale in ["nope", "1.nope", "7.nope"] {
        let (st, _) = s
            .send_json(
                Method::DELETE,
                &path,
                Some(&cookie),
                &[(LEASE, stale)],
                None,
            )
            .await;
        assert_eq!(st, 409, "{stale}");
    }
    let (st, _) = s
        .send_json(
            Method::DELETE,
            &path,
            Some(&cookie),
            &[(LEASE, &lease)],
            None,
        )
        .await;
    assert_eq!(st, 204);
    let (st, _) = take(&s, &cookie, &company, "phone", "acquire").await;
    assert_eq!(st, 200, "free after release");
}

#[tokio::test]
async fn a_grant_waits_for_the_company_mutex() {
    // A fenced write holds the company's mutex across its side effect. While
    // it is held, a takeover (acquire, request or force) does not complete;
    // a renew does, because it changes nothing a fenced write depends on.
    let s = TestServer::start().await;
    let (cookie, company) = s.player(1).await;
    let (_, a) = take(&s, &cookie, &company, "laptop", "acquire").await;

    let in_flight = s.st.company_lock(&company).await;
    let (st, _) = renew(&s, &cookie, &company, "laptop", &token(&a)).await;
    assert_eq!(st, 200, "a renew does not take the mutex");
    let takeover = take(&s, &cookie, &company, "phone", "force");
    tokio::pin!(takeover);
    assert!(
        tokio::time::timeout(Duration::from_millis(300), &mut takeover)
            .await
            .is_err(),
        "the takeover must wait for the in-flight write"
    );
    // Still the old epoch while the write is in flight.
    let (st, r) = renew(&s, &cookie, &company, "laptop", &token(&a)).await;
    assert_eq!((st, r["epoch"].as_i64()), (200, Some(1)));

    drop(in_flight);
    let (st, f) = tokio::time::timeout(Duration::from_secs(10), &mut takeover)
        .await
        .expect("the takeover completes once the write is recorded");
    assert_eq!(st, 200, "{f}");
    assert_eq!(f["epoch"], 2);
    // Another company's lock is independent.
    let (other, other_company) = s.player(2).await;
    let _held = s.st.company_lock(&company).await;
    let (st, _) = take(&s, &other, &other_company, "x", "acquire").await;
    assert_eq!(st, 200);
}
