//! `/web/fetch` (SSRF guard, limits, HTML → text) and the Firecrawl stub.
//! No external network: blocked targets never connect, and the happy path
//! fetches from a local wiremock with the test-only private-address switch.

mod common;

use common::{Opts, TestServer};
use serde_json::json;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn q(url: &str) -> String {
    format!(
        "/web/fetch?url={}",
        url::form_urlencoded::byte_serialize(url.as_bytes()).collect::<String>()
    )
}

#[tokio::test]
async fn ssrf_targets_and_bad_urls_are_refused() {
    let s = TestServer::start_with(Opts {
        tweak: Box::new(|c| c.web.burst = 100),
    })
    .await;
    let cookie = s.dev_login("ada").await;
    assert_eq!(s.get_json(&q("https://example.com/"), None).await.0, 401);
    for (u, code) in [
        ("http://127.0.0.1/", 403),
        ("http://localhost:8080/admin", 403),
        ("http://169.254.169.254/latest/meta-data/", 403),
        ("http://10.0.0.1/", 403),
        ("http://[::1]/", 403),
        ("http://[::ffff:192.168.0.1]/", 403),
        ("http://0x7f000001/", 403),
        ("ftp://example.com/", 400),
        ("file:///etc/passwd", 400),
        ("https://user:pass@example.com/", 400),
        ("nonsense", 400),
    ] {
        let (st, body) = s.get_json(&q(u), Some(&cookie)).await;
        assert_eq!(st, code, "{u}: {body}");
        assert!(body["error"].is_string(), "{body}");
    }
}

#[tokio::test]
async fn fetch_is_rate_limited_per_user() {
    let s = TestServer::start_with(Opts {
        tweak: Box::new(|c| {
            c.web.burst = 2;
            c.web.rate_per_min = 1;
        }),
    })
    .await;
    let a = s.dev_login("ada").await;
    let b = s.dev_login("bob").await;
    let u = q("http://127.0.0.1/");
    assert_eq!(s.get_json(&u, Some(&a)).await.0, 403);
    assert_eq!(s.get_json(&u, Some(&a)).await.0, 403);
    assert_eq!(s.get_json(&u, Some(&a)).await.0, 429);
    assert_eq!(s.get_json(&u, Some(&b)).await.0, 403, "per user");
}

#[tokio::test]
async fn firecrawl_is_stubbed_until_credits() {
    let s = TestServer::start().await;
    let (st, body) = s
        .post_json(
            "/web/firecrawl/scrape",
            None,
            json!({ "url": "https://example.com" }),
        )
        .await;
    assert_eq!(st, 501);
    assert_eq!(
        body,
        json!({ "error": "firecrawl requires credits (wave 3)" })
    );
}

#[tokio::test]
async fn fetch_reduces_html_and_enforces_limits() {
    let mock = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/page"))
        .respond_with(ResponseTemplate::new(200).set_body_raw(
            "<html><head><title>T</title><script>evil()</script></head>\
             <body><h1>Vernazza</h1><p>Ferries &amp; trains</p></body></html>",
            "text/html; charset=utf-8",
        ))
        .mount(&mock)
        .await;
    Mock::given(method("GET"))
        .and(path("/data.json"))
        .respond_with(ResponseTemplate::new(200).set_body_raw("{\"a\":1}", "application/json"))
        .mount(&mock)
        .await;
    Mock::given(method("GET"))
        .and(path("/img.png"))
        .respond_with(ResponseTemplate::new(200).set_body_raw(vec![0u8; 10], "image/png"))
        .mount(&mock)
        .await;
    Mock::given(method("GET"))
        .and(path("/huge"))
        .respond_with(
            ResponseTemplate::new(200).set_body_raw("x".repeat(2 * 1024 * 1024 + 1), "text/plain"),
        )
        .mount(&mock)
        .await;
    Mock::given(method("GET"))
        .and(path("/moved"))
        .respond_with(ResponseTemplate::new(302).insert_header("location", "/page"))
        .mount(&mock)
        .await;
    Mock::given(method("GET"))
        .and(path("/to-ftp"))
        .respond_with(ResponseTemplate::new(302).insert_header("location", "ftp://example.com/"))
        .mount(&mock)
        .await;

    let s = TestServer::start_with(Opts {
        tweak: Box::new(|c| c.web.allow_private_for_tests = true),
    })
    .await;
    let cookie = s.dev_login("ada").await;
    let base = mock.uri();

    let (st, body) = s.get_json(&q(&format!("{base}/page")), Some(&cookie)).await;
    assert_eq!(st, 200, "{body}");
    assert_eq!(body["status"], 200);
    assert_eq!(body["text"], "Vernazza\nFerries & trains");
    assert!(body["content_type"]
        .as_str()
        .unwrap()
        .starts_with("text/html"));

    let (st, body) = s
        .get_json(&q(&format!("{base}/data.json")), Some(&cookie))
        .await;
    assert_eq!(st, 200);
    assert_eq!(body["text"], "{\"a\":1}");

    let (st, body) = s
        .get_json(&q(&format!("{base}/moved")), Some(&cookie))
        .await;
    assert_eq!(st, 200, "{body}");
    assert_eq!(body["url"], format!("{base}/page"));
    assert_eq!(body["text"], "Vernazza\nFerries & trains");

    assert_eq!(
        s.get_json(&q(&format!("{base}/img.png")), Some(&cookie))
            .await
            .0,
        415
    );
    assert_eq!(
        s.get_json(&q(&format!("{base}/huge")), Some(&cookie))
            .await
            .0,
        413
    );
    assert_eq!(
        s.get_json(&q(&format!("{base}/to-ftp")), Some(&cookie))
            .await
            .0,
        400
    );
}
