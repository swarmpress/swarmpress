//! Tool output as site data (ADR-0072, FEAT-092): `PUT /api/site/data`
//! validates a run's output against the tool's declared type and commits it
//! to `content/data/<tool>/<key>.json` on the base branch; the same value
//! again changes nothing; `GET` reads it back.

mod common;

use common::{with_site, GatewayPlayer, TestServer, LEASE};
use reqwest::header::COOKIE;
use serde_json::{json, Value};

fn fixture(path: &str) -> String {
    std::fs::read_to_string(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../blueprint/tests/fixtures/site/blueprint")
            .join(path),
    )
    .unwrap()
}

async fn player(s: &TestServer) -> GatewayPlayer {
    let repo = github::RepoId::new("swarmpress-sites", "player1-site");
    let files = [
        (
            "blueprint/tools/ferry-times.tool.json".to_string(),
            fixture("tools/ferry-times.tool.json"),
        ),
        (
            "blueprint/types/FerryDeparture.json".to_string(),
            fixture("types/FerryDeparture.json"),
        ),
        (
            "blueprint/types/FerryRow.json".to_string(),
            fixture("types/FerryRow.json"),
        ),
        (
            "blueprint/types/FerryTimetable.json".to_string(),
            fixture("types/FerryTimetable.json"),
        ),
    ];
    let refs: Vec<(&str, &str)> = files
        .iter()
        .map(|(p, t)| (p.as_str(), t.as_str()))
        .collect();
    s.fake_github().create_repo(&repo, &with_site(&refs));
    s.gateway_player(1).await
}

async fn put(s: &TestServer, p: &GatewayPlayer, body: Value) -> reqwest::Response {
    s.http
        .put(s.url("/api/site/data"))
        .header(COOKIE, &p.cookie)
        .header(LEASE, &p.lease)
        .json(&body)
        .send()
        .await
        .unwrap()
}

#[tokio::test]
async fn a_typed_run_output_lands_as_site_data() {
    let s = TestServer::start().await;
    let p = player(&s).await;
    let repo = github::RepoId::new("swarmpress-sites", "player1-site");
    let departures =
        json!([{ "time": "09:15", "to": "Monterosso" }, { "time": "10:40", "to": "Portovenere" }]);

    // Unknown tool, a value that is not the declared type, a bad key.
    assert_eq!(
        put(&s, &p, json!({ "tool": "tides", "value": [] }))
            .await
            .status()
            .as_u16(),
        404
    );
    let r = put(
        &s,
        &p,
        json!({ "tool": "ferry-times", "key": "vernazza", "value": [{ "time": 915 }] }),
    )
    .await;
    assert_eq!(r.status().as_u16(), 422);
    let e: Value = r.json().await.unwrap();
    assert!(
        e["issues"].to_string().contains("[0].time: not a string"),
        "{e}"
    );
    assert_eq!(
        put(
            &s,
            &p,
            json!({ "tool": "ferry-times", "key": "../x", "value": [] })
        )
        .await
        .status()
        .as_u16(),
        400
    );

    let head0 = s.fake_github().branch_head(&repo, "main").unwrap();
    let r = put(
        &s,
        &p,
        json!({ "tool": "ferry-times", "key": "vernazza", "value": departures }),
    )
    .await;
    assert_eq!(r.status().as_u16(), 200);
    let out: Value = r.json().await.unwrap();
    assert_eq!(out["changed"], true);
    assert_eq!(out["path"], "content/data/ferry-times/vernazza.json");
    let head1 = s.fake_github().branch_head(&repo, "main").unwrap();
    assert_ne!(head1, head0);
    let stored: Value = serde_json::from_str(
        &s.fake_github()
            .file_text(&repo, "main", "content/data/ferry-times/vernazza.json")
            .unwrap(),
    )
    .unwrap();
    assert_eq!(stored, departures);

    // The same value again: no commit.
    let again: Value = put(
        &s,
        &p,
        json!({ "tool": "ferry-times", "key": "vernazza", "value": departures }),
    )
    .await
    .json()
    .await
    .unwrap();
    assert_eq!(again["changed"], false);
    assert_eq!(s.fake_github().branch_head(&repo, "main").unwrap(), head1);

    // Read back.
    let got: Value = s
        .http
        .get(s.url("/api/site/data?tool=ferry-times&key=vernazza"))
        .header(COOKIE, &p.cookie)
        .header(LEASE, &p.lease)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(got["value"], departures);
}
