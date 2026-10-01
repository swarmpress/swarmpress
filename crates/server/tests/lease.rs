//! Company leases (ADR-0038): one device holds a company at a time.

mod common;

use std::time::Duration;

use common::{Opts, TestServer};
use reqwest::Method;
use serde_json::json;

async fn take(
    s: &TestServer,
    cookie: &str,
    company: &str,
    device: &str,
    force: bool,
) -> (u16, serde_json::Value) {
    s.post_json(
        &format!("/api/companies/{company}/lease"),
        Some(cookie),
        json!({ "device_id": device, "force": force }),
    )
    .await
}

#[tokio::test]
async fn acquire_renew_conflict_force_and_expiry() {
    let s = TestServer::start().await;
    let (cookie, company) = s.player(1).await;
    let t0 = s.st.now_ms();

    // Acquire.
    let (st, a) = take(&s, &cookie, &company, "laptop", false).await;
    assert_eq!(st, 200, "{a}");
    assert_eq!(a["holder"], "laptop");
    assert_eq!(a["expires_at"], t0 + 90_000);
    assert_eq!(a["renewed"], false);
    let lease_a = a["lease_id"].as_str().unwrap().to_string();

    // Renew: same lease id, later expiry.
    s.clock.advance(Duration::from_secs(30));
    let (st, r) = take(&s, &cookie, &company, "laptop", false).await;
    assert_eq!(st, 200);
    assert_eq!(r["lease_id"], lease_a.as_str());
    assert_eq!(r["renewed"], true);
    assert_eq!(r["expires_at"], t0 + 30_000 + 90_000);

    // Another device: 409 with the holder.
    let (st, c) = take(&s, &cookie, &company, "phone", false).await;
    assert_eq!(st, 409, "{c}");
    assert_eq!(c["holder"], "laptop");
    assert_eq!(c["expires_at"], t0 + 120_000);

    // Force takes it over with a new id; the old holder is now refused.
    let (st, f) = take(&s, &cookie, &company, "phone", true).await;
    assert_eq!(st, 200, "{f}");
    assert_eq!(f["holder"], "phone");
    let lease_b = f["lease_id"].as_str().unwrap().to_string();
    assert_ne!(lease_b, lease_a);
    let (st, _) = take(&s, &cookie, &company, "laptop", false).await;
    assert_eq!(st, 409);

    // After expiry anyone may take it (a fresh lease).
    s.clock.advance(Duration::from_secs(91));
    let (st, e) = take(&s, &cookie, &company, "laptop", false).await;
    assert_eq!(st, 200, "{e}");
    assert_eq!(e["holder"], "laptop");
    assert_eq!(e["renewed"], false);
    assert_ne!(e["lease_id"], lease_b.as_str());
}

#[tokio::test]
async fn lease_ttl_is_configurable() {
    let s = TestServer::start_with(Opts {
        tweak: Box::new(|c| c.lease_ttl = Duration::from_secs(5)),
    })
    .await;
    let (cookie, company) = s.player(1).await;
    let (_, a) = take(&s, &cookie, &company, "laptop", false).await;
    assert_eq!(a["expires_at"], s.st.now_ms() + 5_000);
    s.clock.advance(Duration::from_secs(6));
    let (st, _) = take(&s, &cookie, &company, "phone", false).await;
    assert_eq!(st, 200, "expired after 5 s");
}

#[tokio::test]
async fn release_and_ownership() {
    let s = TestServer::start().await;
    let (cookie, company) = s.player(1).await;
    let (other, other_company) = s.player(2).await;
    let lease = s.lease(&cookie, &company, "laptop").await;

    // Not your company → 403; no such company → 404; signed out → 401.
    let (st, _) = take(&s, &other, &company, "x", true).await;
    assert_eq!(st, 403);
    let (st, _) = take(
        &s,
        &cookie,
        "00000000-0000-0000-0000-000000000000",
        "x",
        false,
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
    let (st, _) = take(&s, &cookie, &company, "bad device id!", false).await;
    assert_eq!(st, 400);
    // Leases are per company.
    let (st, _) = take(&s, &other, &other_company, "phone", false).await;
    assert_eq!(st, 200);

    // Release needs the current lease id.
    let path = format!("/api/companies/{company}/lease");
    let (st, _) = s
        .send_json(Method::DELETE, &path, Some(&cookie), &[], None)
        .await;
    assert_eq!(st, 428);
    let (st, _) = s
        .send_json(
            Method::DELETE,
            &path,
            Some(&cookie),
            &[("x-simpress-lease", "nope")],
            None,
        )
        .await;
    assert_eq!(st, 409);
    let (st, _) = s
        .send_json(
            Method::DELETE,
            &path,
            Some(&cookie),
            &[("x-simpress-lease", &lease)],
            None,
        )
        .await;
    assert_eq!(st, 204);
    let (st, _) = take(&s, &cookie, &company, "phone", false).await;
    assert_eq!(st, 200, "free after release");
}
