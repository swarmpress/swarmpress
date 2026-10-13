//! A site's designs (ADR-0093, FEAT-114): uploads are lease-fenced, checked
//! and stored as write-once versions; the same bundle is the same version;
//! a version reads back as its manifest, its interpretation and its files,
//! served so that nothing in them runs.

mod common;

use std::path::Path;

use base64::Engine as _;
use common::{TestServer, LEASE};
use reqwest::Method;
use serde_json::{json, Value};

fn fixture(rel: &str) -> Vec<u8> {
    std::fs::read(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../site-design/tests/fixtures")
            .join(rel),
    )
    .unwrap()
}

fn b64(b: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(b)
}

fn coast() -> Value {
    let files: Vec<Value> = [
        "index.html",
        "article.html",
        "stories.html",
        "404.html",
        "styles.css",
        "fonts/coast-serif.woff2",
    ]
    .iter()
    .map(|p| json!({ "path": p, "base64": b64(&fixture(&format!("coast-journal/{p}"))) }))
    .collect();
    json!({ "files": files })
}

async fn post(
    s: &TestServer,
    cookie: &str,
    lease: Option<&str>,
    site: &str,
    body: Value,
) -> (u16, Value) {
    let headers: Vec<(&str, &str)> = lease.map(|l| vec![(LEASE, l)]).unwrap_or_default();
    s.send_json(
        Method::POST,
        &format!("/api/sites/{site}/designs"),
        Some(cookie),
        &headers,
        Some(body),
    )
    .await
}

#[tokio::test]
async fn designs_are_fenced_checked_and_write_once() {
    let s = TestServer::start().await;
    let (cookie, site) = s.player(1).await;
    let lease = s.lease(&cookie, &site, "laptop").await;

    let (st, _) = post(&s, &cookie, None, &site, coast()).await;
    assert_eq!(st, 428, "the lease is required");
    let (other, other_site) = s.player(2).await;
    let (st, _) = post(&s, &cookie, Some(&lease), &other_site, coast()).await;
    assert_eq!(st, 403, "another company's site");

    let (st, body) = post(&s, &cookie, Some(&lease), &site, coast()).await;
    assert_eq!(st, 201, "{body}");
    assert_eq!(body["version"], 1);
    assert_eq!(body["files"], 6);
    let hash = body["hash"].as_str().unwrap().to_string();
    assert_eq!(hash.len(), 64);

    // The same bundle again: the same version, nothing new.
    let (st, again) = post(&s, &cookie, Some(&lease), &site, coast()).await;
    assert_eq!(
        (st, &again["version"], &again["hash"]),
        (200, &json!(1), &json!(hash))
    );

    // Claude Design's standalone export, with the connector as its source: version 2, unpacked.
    let export = json!({
        "files": [{ "path": "dispatch.html", "base64": b64(&fixture("claude-export/cinqueterre-dispatch-mini.html")) }],
        "source": { "kind": "connector", "client": "claude-design" },
    });
    let (st, body) = post(&s, &cookie, Some(&lease), &site, export).await;
    assert_eq!(st, 201, "{body}");
    assert_eq!(body["version"], 2);
    assert!(body["files"].as_u64().unwrap() >= 4, "{body}");

    // Refused: a script, a bad path, bad base64, duplicates, too large.
    let bad = json!({ "files": [
        { "path": "index.html", "base64": b64(b"<h1>x</h1>") },
        { "path": "app.js", "base64": b64(b"alert(1)") },
        { "path": "../up.css", "base64": b64(b"") },
    ]});
    let (st, body) = post(&s, &cookie, Some(&lease), &site, bad).await;
    assert_eq!(st, 422, "{body}");
    let issues: Vec<&str> = body["issues"]
        .as_array()
        .unwrap()
        .iter()
        .map(|i| i.as_str().unwrap())
        .collect();
    assert!(
        issues
            .iter()
            .any(|i| i.starts_with("app.js: not an allowed file type")),
        "{issues:?}"
    );
    assert!(
        issues.iter().any(|i| i.starts_with("../up.css:")),
        "{issues:?}"
    );
    let (st, _) = post(
        &s,
        &cookie,
        Some(&lease),
        &site,
        json!({ "files": [{ "path": "a.html", "base64": "%%%" }] }),
    )
    .await;
    assert_eq!(st, 400);
    let dup = json!({ "files": [{ "path": "a.html", "base64": "" }, { "path": "a.html", "base64": "" }] });
    let (st, _) = post(&s, &cookie, Some(&lease), &site, dup).await;
    assert_eq!(st, 400);
    let chunk = b64(&vec![b' '; 7 * 1024 * 1024]);
    let big = json!({ "files": (0..3).map(|i| json!({ "path": format!("p{i}.html"), "base64": chunk })).collect::<Vec<_>>() });
    let (st, _) = post(&s, &cookie, Some(&lease), &site, big).await;
    assert_eq!(st, 413, "more than 20 MB decoded");

    // The list, oldest first; only the owner sees it.
    let (st, list) = s
        .get_json(&format!("/api/sites/{site}/designs"), Some(&cookie))
        .await;
    assert_eq!(st, 200);
    let versions: Vec<(i64, &str)> = list["designs"]
        .as_array()
        .unwrap()
        .iter()
        .map(|d| {
            (
                d["version"].as_i64().unwrap(),
                d["source"]["kind"].as_str().unwrap(),
            )
        })
        .collect();
    assert_eq!(versions, [(1, "upload"), (2, "connector")]);
    let (st, _) = s
        .get_json(&format!("/api/sites/{site}/designs"), Some(&other))
        .await;
    assert_eq!(st, 403);
}

#[tokio::test]
async fn a_version_reads_back_interpreted_and_its_files_never_run() {
    let s = TestServer::start().await;
    let (cookie, site) = s.player(1).await;
    let lease = s.lease(&cookie, &site, "laptop").await;
    let (st, _) = post(&s, &cookie, Some(&lease), &site, coast()).await;
    assert_eq!(st, 201);

    let (st, v) = s
        .get_json(&format!("/api/sites/{site}/designs/1"), Some(&cookie))
        .await;
    assert_eq!(st, 200, "{v}");
    assert_eq!(v["manifest"]["format"], "swarmpress.design-bundle.v1");
    assert_eq!(v["manifest"]["hash"], v["design"]["bundle"]);
    let slugs: Vec<&str> = v["design"]["templates"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["slug"].as_str().unwrap())
        .collect();
    assert_eq!(slugs, ["home", "404", "single", "archive"]);
    assert_eq!(v["design"]["parts"][0]["slug"], "header");
    let (st, _) = s
        .get_json(&format!("/api/sites/{site}/designs/9"), Some(&cookie))
        .await;
    assert_eq!(st, 404);

    let res = s
        .http
        .get(s.url(&format!("/api/sites/{site}/designs/1/files/index.html")))
        .header("cookie", &cookie)
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 200);
    assert_eq!(res.headers()["content-type"], "text/html; charset=utf-8");
    let csp = res.headers()["content-security-policy"]
        .to_str()
        .unwrap()
        .to_string();
    assert!(csp.starts_with("sandbox;"), "{csp}");
    assert_eq!(res.headers()["x-content-type-options"], "nosniff");
    assert_eq!(
        res.bytes().await.unwrap().as_ref(),
        fixture("coast-journal/index.html").as_slice()
    );

    let res = s
        .http
        .get(s.url(&format!(
            "/api/sites/{site}/designs/1/files/fonts/coast-serif.woff2"
        )))
        .header("cookie", &cookie)
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 200);
    assert_eq!(res.headers()["content-type"], "font/woff2");
    let (st, _) = s
        .get_json(
            &format!("/api/sites/{site}/designs/1/files/nope.css"),
            Some(&cookie),
        )
        .await;
    assert_eq!(st, 404);
}
