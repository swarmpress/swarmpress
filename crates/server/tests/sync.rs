//! Sync blobs: immutable log segments, the latest snapshot, ownership.

mod common;

use common::TestServer;
use reqwest::header::COOKIE;
use serde_json::Value;

async fn put(
    s: &TestServer,
    cookie: Option<&str>,
    path: &str,
    body: &[u8],
    step: Option<&str>,
) -> (u16, Value) {
    let mut req = s.http.put(s.url(path)).body(body.to_vec());
    if let Some(c) = cookie {
        req = req.header(COOKIE, c);
    }
    if let Some(step) = step {
        req = req.header("x-simpress-step", step);
    }
    let res = req.send().await.unwrap();
    let st = res.status().as_u16();
    (st, res.json().await.unwrap_or(Value::Null))
}

async fn get_bytes(
    s: &TestServer,
    cookie: &str,
    path: &str,
) -> (u16, reqwest::header::HeaderMap, Vec<u8>) {
    let res = s
        .http
        .get(s.url(path))
        .header(COOKIE, cookie)
        .send()
        .await
        .unwrap();
    let st = res.status().as_u16();
    let h = res.headers().clone();
    (st, h, res.bytes().await.unwrap().to_vec())
}

#[tokio::test]
async fn segments_are_immutable() {
    let s = TestServer::start().await;
    let (cookie, c) = s.player(1).await;
    let seg0 = format!("/api/sync/{c}/log/0");

    let (st, b) = put(&s, Some(&cookie), &seg0, b"log-bytes-0", None).await;
    assert_eq!(st, 201, "{b}");
    assert_eq!(b["size"], 11);
    let sha = b["sha256"].as_str().unwrap().to_string();
    // Identical bytes again → 200; different bytes → 409.
    let (st, b2) = put(&s, Some(&cookie), &seg0, b"log-bytes-0", None).await;
    assert_eq!(st, 200);
    assert_eq!(b2["sha256"], sha.as_str());
    let (st, _) = put(&s, Some(&cookie), &seg0, b"tampered", None).await;
    assert_eq!(st, 409);

    let (st, h, bytes) = get_bytes(&s, &cookie, &seg0).await;
    assert_eq!(st, 200);
    assert_eq!(bytes, b"log-bytes-0");
    assert_eq!(h["x-simpress-sha256"], sha.as_str());
    assert_eq!(h["content-type"], "application/octet-stream");

    let big = 18_446_744_073_709_551_615u64; // u64::MAX, beyond SQLite INTEGER
    let (st, _) = put(
        &s,
        Some(&cookie),
        &format!("/api/sync/{c}/log/{big}"),
        b"x",
        None,
    )
    .await;
    assert_eq!(st, 400);
    let (st, _) = put(
        &s,
        Some(&cookie),
        &format!("/api/sync/{c}/log/abc"),
        b"x",
        None,
    )
    .await;
    assert_eq!(st, 400);
    let (st, _) = put(
        &s,
        Some(&cookie),
        &format!("/api/sync/{c}/log/2"),
        b"",
        None,
    )
    .await;
    assert_eq!(st, 201, "empty segments are allowed");
    let (st, _, _) = get_bytes(&s, &cookie, &format!("/api/sync/{c}/log/7")).await;
    assert_eq!(st, 404);

    let (st, list) = s
        .get_json(&format!("/api/sync/{c}/log"), Some(&cookie))
        .await;
    assert_eq!(st, 200);
    let segs: Vec<i64> = list["segments"]
        .as_array()
        .unwrap()
        .iter()
        .map(|x| x["segment"].as_i64().unwrap())
        .collect();
    assert_eq!(segs, [0, 2]);
    assert_eq!(list["segments"][0]["sha256"], sha.as_str());

    // Bytes live on disk under the data dir.
    let file =
        s.st.cfg
            .data_dir
            .join(format!("sync/{c}/log/{:020}.bin", 0));
    assert_eq!(std::fs::read(file).unwrap(), b"log-bytes-0");
}

#[tokio::test]
async fn snapshot_is_latest_with_step() {
    let s = TestServer::start().await;
    let (cookie, c) = s.player(1).await;
    let path = format!("/api/sync/{c}/snapshot");
    let (st, _, _) = get_bytes(&s, &cookie, &path).await;
    assert_eq!(st, 404);
    let (st, _) = put(&s, Some(&cookie), &path, b"snap-1", None).await;
    assert_eq!(st, 400, "step header required");
    let (st, _) = put(&s, Some(&cookie), &path, b"snap-1", Some("x")).await;
    assert_eq!(st, 400);
    let (st, b) = put(&s, Some(&cookie), &path, b"snap-1", Some("600")).await;
    assert_eq!(st, 200, "{b}");
    assert_eq!(b["step"], 600);
    let (st, b) = put(&s, Some(&cookie), &path, b"snap-2", Some("1200")).await;
    assert_eq!(st, 200, "{b}");
    let (st, h, bytes) = get_bytes(&s, &cookie, &path).await;
    assert_eq!(st, 200);
    assert_eq!(bytes, b"snap-2");
    assert_eq!(h["x-simpress-step"], "1200");
}

#[tokio::test]
async fn only_the_owner_may_sync() {
    let s = TestServer::start().await;
    let (a, ca) = s.player(1).await;
    let (b, _) = s.player(2).await;
    let seg = format!("/api/sync/{ca}/log/0");
    assert_eq!(put(&s, Some(&a), &seg, b"mine", None).await.0, 201);

    assert_eq!(put(&s, None, &seg, b"x", None).await.0, 401);
    assert_eq!(put(&s, Some(&b), &seg, b"x", None).await.0, 403);
    assert_eq!(get_bytes(&s, &b, &seg).await.0, 403);
    assert_eq!(
        s.get_json(&format!("/api/sync/{ca}/log"), Some(&b)).await.0,
        403
    );
    assert_eq!(
        put(
            &s,
            Some(&b),
            &format!("/api/sync/{ca}/snapshot"),
            b"x",
            Some("1")
        )
        .await
        .0,
        403
    );
    assert_eq!(
        get_bytes(&s, &b, &format!("/api/sync/{ca}/snapshot"))
            .await
            .0,
        403
    );
    assert_eq!(
        put(&s, Some(&a), "/api/sync/../log/0", b"x", None).await.0,
        404
    );
    assert_eq!(
        put(
            &s,
            Some(&a),
            "/api/sync/00000000-0000-0000-0000-000000000000/log/0",
            b"x",
            None
        )
        .await
        .0,
        404
    );
}
