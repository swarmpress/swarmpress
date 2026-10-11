//! Releases of a WordPress site (ADR-0083, plan M5): a release is accepted only with its own id
//! and with every file's bytes in the company's object store; it becomes the current site, served
//! under /sites/{company}/, and the work item's DeployLanded reaches the inbox.

mod common;

use std::collections::BTreeMap;

use common::{TestServer, LEASE};
use reqwest::Method;
use serde_json::json;
use sha2::{Digest, Sha256};
use site_export::{FileEntry, Release};

fn release(files: &[(&str, &str, &[u8])], redirects: &[(&str, &str)]) -> Release {
    let mut r = Release {
        id: String::new(),
        files: files
            .iter()
            .map(|(p, ct, b)| {
                (
                    p.to_string(),
                    FileEntry {
                        sha256: hex::encode(Sha256::digest(b)),
                        content_type: ct.to_string(),
                        size: b.len() as u64,
                    },
                )
            })
            .collect::<BTreeMap<_, _>>(),
        redirects: redirects
            .iter()
            .map(|(a, b)| (a.to_string(), b.to_string()))
            .collect(),
    };
    r.id = r.computed_id();
    r
}

#[tokio::test]
async fn a_release_with_its_bytes_becomes_the_site_and_lands_the_work_item() {
    let s = TestServer::start().await;
    let (cookie, company) = s.player(1).await;
    let lease = s.lease(&cookie, &company, "laptop").await;
    let home: &[u8] =
        b"<!doctype html><title>Cinque Terre</title><a href=\"/harvest-week/\">Harvest</a>";
    let post: &[u8] = b"<!doctype html><title>Harvest week</title>";
    let r = release(
        &[
            ("/", "text/html; charset=UTF-8", home),
            ("/harvest-week/", "text/html; charset=UTF-8", post),
        ],
        &[("/old/", "/harvest-week/")],
    );
    let put = |body: serde_json::Value, id: &str| {
        let path = format!("/api/releases/{id}");
        let cookie = cookie.clone();
        let lease = lease.clone();
        let s = &s;
        async move {
            s.send_json(
                Method::PUT,
                &path,
                Some(&cookie),
                &[(LEASE, &lease)],
                Some(body),
            )
            .await
        }
    };

    let mut tampered = r.clone();
    tampered.files.remove("/harvest-week/");
    assert_eq!(
        put(
            json!({"release": tampered, "work_item": "work-item-1"}),
            &r.id
        )
        .await
        .0,
        400,
        "an id that is not the manifest's"
    );
    let (st, body) = put(json!({"release": r, "work_item": "work-item-1"}), &r.id).await;
    assert_eq!(st, 409, "bytes not uploaded: {body}");

    for b in [home, post] {
        let sha = hex::encode(Sha256::digest(b));
        let res = s
            .http
            .put(s.url(&format!("/api/assets/{sha}")))
            .header("cookie", &cookie)
            .header(LEASE, &lease)
            .header("content-type", "text/html")
            .body(b.to_vec())
            .send()
            .await
            .unwrap();
        assert_eq!(res.status(), 201);
    }
    let (st, body) = put(
        json!({"release": r, "work_item": "work-item-1", "change_request": 3}),
        &r.id,
    )
    .await;
    assert_eq!(st, 200, "{body}");
    assert_eq!(body["files"], 2);

    let landed: Vec<serde_json::Value> = s
        .inbox(&cookie)
        .await
        .into_iter()
        .filter(|e| e["kind"] == "DeployLanded")
        .collect();
    assert_eq!(landed.len(), 1);
    assert_eq!(
        (
            landed[0]["payload"]["work_item"].as_str(),
            landed[0]["payload"]["source"].as_str()
        ),
        (Some("work-item-1"), Some("export"))
    );
    assert_eq!(
        s.get_json("/api/releases/current", Some(&cookie)).await.1["id"],
        json!(r.id)
    );

    // The public site: no sign-in.
    let res = s
        .http
        .get(s.url(&format!("/sites/{company}/")))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 200);
    assert_eq!(res.headers()["content-type"], "text/html; charset=UTF-8");
    assert_eq!(res.bytes().await.unwrap().as_ref(), home);
    let res = s
        .http
        .get(s.url(&format!("/sites/{company}/harvest-week/")))
        .send()
        .await
        .unwrap();
    assert_eq!(res.bytes().await.unwrap().as_ref(), post);
    let res = s
        .http
        .get(s.url(&format!("/sites/{company}/old/")))
        .send()
        .await
        .unwrap();
    assert_eq!(
        (
            res.status().as_u16(),
            res.headers()["location"].to_str().unwrap()
        ),
        (301, "/harvest-week/")
    );
    assert_eq!(
        s.http
            .get(s.url(&format!("/sites/{company}/nope/")))
            .send()
            .await
            .unwrap()
            .status(),
        404
    );
}
