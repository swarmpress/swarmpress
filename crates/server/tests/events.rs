//! The offline event inbox: polling with `after=` and the WebSocket push.

mod common;

use std::time::Duration;

use common::TestServer;
use futures::StreamExt;
use reqwest::header::COOKIE;
use serde_json::{json, Value};
use swarmpress_server::events;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::Message;

#[tokio::test]
async fn polling_after_seq_is_per_company() {
    let s = TestServer::start().await;
    let (a, ca) = s.player(1).await;
    let (b, cb) = s.player(2).await;
    for i in 0..3 {
        events::publish(&s.st, &ca, "DeployLanded", json!({ "i": i }))
            .await
            .unwrap();
    }
    events::publish(&s.st, &cb, "DeployLanded", json!({ "i": 99 }))
        .await
        .unwrap();

    let (st, body) = s.get_json("/api/events", Some(&a)).await;
    assert_eq!(st, 200);
    let evs = body["events"].as_array().unwrap();
    assert_eq!(evs.len(), 3);
    assert_eq!(evs[0]["payload"]["i"], 0);
    assert_eq!(evs[0]["company_id"], ca.as_str());
    let first = evs[0]["seq"].as_i64().unwrap();
    assert_eq!(body["last_seq"], evs[2]["seq"]);

    let (_, after) = s
        .get_json(&format!("/api/events?after={first}"), Some(&a))
        .await;
    let after = after["events"].as_array().unwrap();
    assert_eq!(after.len(), 2);
    assert_eq!(after[0]["payload"]["i"], 1);

    let (_, limited) = s.get_json("/api/events?after=0&limit=1", Some(&a)).await;
    assert_eq!(limited["events"].as_array().unwrap().len(), 1);
    assert_eq!(limited["last_seq"], first);

    // Nothing new: last_seq stays at `after`.
    let last = body["last_seq"].as_i64().unwrap();
    let (_, none) = s
        .get_json(&format!("/api/events?after={last}"), Some(&a))
        .await;
    assert_eq!(none["events"], json!([]));
    assert_eq!(none["last_seq"], last);

    let (_, bevs) = s.get_json("/api/events", Some(&b)).await;
    assert_eq!(bevs["events"].as_array().unwrap().len(), 1);
    assert_eq!(bevs["events"][0]["payload"]["i"], 99);

    assert_eq!(s.get_json("/api/events", None).await.0, 401);
    let nobody = s.dev_login("nobody").await;
    assert_eq!(s.get_json("/api/events", Some(&nobody)).await.0, 404);
}

async fn connect(
    s: &TestServer,
    cookie: &str,
    after: i64,
) -> tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>> {
    let mut req = s
        .ws_url(&format!("/ws/events?after={after}"))
        .into_client_request()
        .unwrap();
    req.headers_mut().insert(COOKIE, cookie.parse().unwrap());
    tokio_tungstenite::connect_async(req).await.unwrap().0
}

async fn next_event(
    ws: &mut tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
) -> Value {
    loop {
        let msg = tokio::time::timeout(Duration::from_secs(5), ws.next())
            .await
            .expect("event within 5 s")
            .expect("stream open")
            .unwrap();
        if let Message::Text(t) = msg {
            return serde_json::from_str(t.as_str()).unwrap();
        }
    }
}

#[tokio::test]
async fn websocket_sends_backlog_then_pushes() {
    let s = TestServer::start().await;
    let (a, ca) = s.player(1).await;
    let (_, cb) = s.player(2).await;
    let e1 = events::publish(&s.st, &ca, "DeployLanded", json!({ "n": 1 }))
        .await
        .unwrap();
    events::publish(&s.st, &ca, "DeployLanded", json!({ "n": 2 }))
        .await
        .unwrap();

    // Backlog after e1 → only n=2.
    let mut ws = connect(&s, &a, e1.seq).await;
    assert_eq!(next_event(&mut ws).await["payload"]["n"], 2);

    // Live: another company's event is not delivered; ours is.
    events::publish(&s.st, &cb, "DeployLanded", json!({ "n": 100 }))
        .await
        .unwrap();
    events::publish(&s.st, &ca, "DeployFailed", json!({ "n": 3 }))
        .await
        .unwrap();
    let ev = next_event(&mut ws).await;
    assert_eq!(ev["kind"], "DeployFailed");
    assert_eq!(ev["payload"]["n"], 3);

    // Upgrade without a session is refused.
    let req = s.ws_url("/ws/events").into_client_request().unwrap();
    assert!(tokio_tungstenite::connect_async(req).await.is_err());
}
