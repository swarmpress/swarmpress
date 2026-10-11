//! Asset bytes in object storage and WordPress's fetch grants (ADR-0050, ADR-0084, plan M3):
//! uploads are lease-checked and content-addressed, reads are per company, and WordPress reaches
//! only the hosts its company granted, with media coming back as base64.

mod common;

use common::{Opts, TestServer, LEASE};
use reqwest::Method;
use serde_json::json;
use sha2::{Digest, Sha256};
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

async fn put(s: &TestServer, cookie: &str, lease: Option<&str>, sha: &str, body: &[u8]) -> u16 {
    let mut rb = s
        .http
        .request(Method::PUT, s.url(&format!("/api/assets/{sha}")))
        .header("cookie", cookie)
        .header("content-type", "image/png")
        .body(body.to_vec());
    if let Some(l) = lease {
        rb = rb.header(LEASE, l);
    }
    rb.send().await.unwrap().status().as_u16()
}

#[tokio::test]
async fn uploads_are_lease_checked_content_addressed_and_per_company() {
    let s = TestServer::start().await;
    let (cookie, company) = s.player(1).await;
    let lease = s.lease(&cookie, &company, "laptop").await;
    let bytes = b"\x89PNG not really";
    let sha = hex::encode(Sha256::digest(bytes));
    assert_eq!(put(&s, &cookie, None, &sha, bytes).await, 428, "no lease");
    assert_eq!(
        put(&s, &cookie, Some(&lease), &"0".repeat(64), bytes).await,
        400,
        "wrong digest"
    );
    assert_eq!(
        put(&s, &cookie, Some(&lease), "ABC", bytes).await,
        400,
        "not a digest"
    );
    assert_eq!(put(&s, &cookie, Some(&lease), &sha, bytes).await, 201);
    assert_eq!(
        put(&s, &cookie, Some(&lease), &sha, bytes).await,
        200,
        "first write wins"
    );
    assert!(s
        .dir
        .join(format!("data/objects/c/{company}/sha256/{sha}"))
        .exists());

    let res = s
        .http
        .get(s.url(&format!("/api/assets/{sha}")))
        .header("cookie", &cookie)
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 200);
    assert_eq!(res.headers()["content-type"], "image/png");
    assert_eq!(res.bytes().await.unwrap().as_ref(), bytes);

    let (other, _) = s.player(2).await;
    let res = s
        .http
        .get(s.url(&format!("/api/assets/{sha}")))
        .header("cookie", &other)
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 404, "another company's asset");
}

#[tokio::test]
async fn wordpress_reaches_only_granted_hosts_and_media_comes_back_as_base64() {
    let s = TestServer::start_with(Opts {
        tweak: Box::new(|c| {
            c.web.allow_private_for_tests = true;
            c.web.burst = 100;
        }),
    })
    .await;
    let (cookie, company) = s.player(1).await;
    let lease = s.lease(&cookie, &company, "laptop").await;
    let origin = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/img.png"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("content-type", "image/png")
                .set_body_bytes(vec![0x89, 0x50, 0x4e, 0x47]),
        )
        .mount(&origin)
        .await;
    Mock::given(method("GET"))
        .and(path("/api"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("content-type", "application/json")
                .set_body_string("{\"ok\":true}"),
        )
        .mount(&origin)
        .await;
    let req = |p: &str| json!({ "url": format!("{}{p}", origin.uri()), "method": "GET" });

    let (st, _) = s
        .send_json(
            Method::POST,
            "/web/wp-request",
            Some(&cookie),
            &[],
            Some(req("/api")),
        )
        .await;
    assert_eq!(st, 428, "the lease is required");
    let (st, body) = s
        .send_json(
            Method::POST,
            "/web/wp-request",
            Some(&cookie),
            &[(LEASE, &lease)],
            Some(req("/api")),
        )
        .await;
    assert_eq!(st, 403, "no grant yet: {body}");

    let (st, _) = s
        .send_json(
            Method::PUT,
            "/api/web/grants",
            Some(&cookie),
            &[(LEASE, &lease)],
            Some(json!({ "hosts": ["not a host"] })),
        )
        .await;
    assert_eq!(st, 400);
    let (st, body) = s
        .send_json(
            Method::PUT,
            "/api/web/grants",
            Some(&cookie),
            &[(LEASE, &lease)],
            Some(json!({ "hosts": ["127.0.0.1", "*.example.org", "127.0.0.1"] })),
        )
        .await;
    assert_eq!(st, 200, "{body}");
    assert_eq!(
        s.get_json("/api/web/grants", Some(&cookie)).await.1,
        json!({ "hosts": ["*.example.org", "127.0.0.1"] })
    );

    let (st, body) = s
        .send_json(
            Method::POST,
            "/web/wp-request",
            Some(&cookie),
            &[(LEASE, &lease)],
            Some(req("/api")),
        )
        .await;
    assert_eq!(st, 200, "{body}");
    assert_eq!(body["body"], "{\"ok\":true}");
    let (st, body) = s
        .send_json(
            Method::POST,
            "/web/wp-request",
            Some(&cookie),
            &[(LEASE, &lease)],
            Some(req("/img.png")),
        )
        .await;
    assert_eq!(st, 200, "{body}");
    assert_eq!(body["body_b64"], "iVBORw==");
    assert!(body.get("body").is_none());
}

#[test]
fn granted_hosts_match_exactly_or_by_subdomain_wildcard() {
    let g = vec!["api.example.org".to_string(), "*.cdn.net".to_string()];
    assert!(swarmpress_server::web::host_granted("api.example.org", &g));
    assert!(swarmpress_server::web::host_granted("API.example.org", &g));
    assert!(!swarmpress_server::web::host_granted(
        "evil.api.example.org",
        &g
    ));
    assert!(swarmpress_server::web::host_granted("img.cdn.net", &g));
    assert!(!swarmpress_server::web::host_granted("cdn.net", &g));
    assert!(!swarmpress_server::web::host_granted("evilcdn.net", &g));
}
