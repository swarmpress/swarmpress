//! The site's models (ADR-0072, FEAT-090, FEAT-091): `GET /api/site/blueprint`
//! answers an imported blueprint when the site has none, the stored one with
//! its types and tools when it has, the checker's issues, and the town; it is
//! cached per commit (ETag and 304).

mod common;

use common::{article, with_site, GatewayPlayer, TestServer, LEASE};
use reqwest::header::{COOKIE, ETAG, IF_NONE_MATCH};
use serde_json::{json, Value};

fn articles() -> Vec<(String, String)> {
    ["harvest", "ferries", "trails"]
        .iter()
        .map(|slug| {
            (
                format!("content/pages/blog/{slug}.json"),
                serde_json::to_string_pretty(&article(&format!("content-{slug}"), slug, slug))
                    .unwrap(),
            )
        })
        .collect()
}

async fn player(s: &TestServer, extra: &[(String, String)]) -> GatewayPlayer {
    let repo = github::RepoId::new("swarmpress-sites", "player1-site");
    let mut files = articles();
    files.extend_from_slice(extra);
    let refs: Vec<(&str, &str)> = files
        .iter()
        .map(|(p, t)| (p.as_str(), t.as_str()))
        .collect();
    s.fake_github().create_repo(&repo, &with_site(&refs));
    s.gateway_player(1).await
}

async fn get(s: &TestServer, p: &GatewayPlayer, etag: Option<&str>) -> reqwest::Response {
    let mut req = s
        .http
        .get(s.url("/api/site/blueprint"))
        .header(COOKIE, &p.cookie)
        .header(LEASE, &p.lease);
    if let Some(t) = etag {
        req = req.header(IF_NONE_MATCH, t);
    }
    req.send().await.unwrap()
}

#[tokio::test]
async fn a_site_without_a_blueprint_gets_one_imported_with_its_town() {
    let s = TestServer::start().await;
    let p = player(&s, &[]).await;
    let no_lease = s
        .http
        .get(s.url("/api/site/blueprint"))
        .header(COOKIE, &p.cookie)
        .send()
        .await
        .unwrap();
    assert_eq!(no_lease.status().as_u16(), 428);

    let r = get(&s, &p, None).await;
    assert_eq!(r.status().as_u16(), 200);
    let etag = r.headers()[ETAG].to_str().unwrap().to_string();
    let v: Value = r.json().await.unwrap();
    assert_eq!(v["source"], "imported");
    assert_eq!(v["issues"], json!([]));
    let types: Vec<&str> = v["blueprint"]["page_types"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["id"].as_str().unwrap())
        .collect();
    assert!(types.contains(&"blog-article"), "{types:?}");
    assert_eq!(v["town"]["format"], "swarmpress.design.v1");
    assert_eq!(v["town"]["provenance"]["kind"], "view");
    assert_eq!(v["town"]["provenance"]["hash"], v["hash"]);
    // The town compiles in the kit.
    let design = kit::Design::from_json(&v["town"].to_string()).unwrap();
    kit::compile(&design, &kit::Params::new(), kit::Kit::shipped()).unwrap();

    // Cached per commit: 304, and no second snapshot.
    let snaps = || {
        s.fake_github()
            .calls()
            .iter()
            .filter(|c| c.contains("snapshot"))
            .count()
    };
    let before = snaps();
    assert_eq!(get(&s, &p, Some(&etag)).await.status().as_u16(), 304);
    assert_eq!(get(&s, &p, None).await.status().as_u16(), 200);
    assert_eq!(snaps(), before);
}

#[tokio::test]
async fn a_stored_blueprint_is_checked_with_its_types_and_tools() {
    let s = TestServer::start().await;
    let bp = json!({
        "format": "swarmpress.blueprint.v1",
        "page_types": [
            { "id": "blog-article", "label": { "en": "Article" }, "aliases": ["blog-post", "article"],
              "route": "/{lang}/blog/{slug}", "source": { "kind": "page" },
              "slots": [
                { "id": "hero", "blocks": ["editorial-hero"], "min": 1, "max": 1 },
                { "id": "body", "blocks": ["heading", "paragraph", "list", "callout", "image"] },
                { "id": "closing", "blocks": ["closing-note"], "min": 1, "max": 1 }
              ] },
            { "id": "village", "label": { "en": "Village" }, "source": { "kind": "page" },
              "slots": [
                { "id": "now", "blocks": ["weather-live"], "max": 1,
                  "source": { "tool": "weather", "inputs": { "city": "page.title" }, "accepts": "Teaser" } }
              ] }
        ]
    });
    let tool = std::fs::read_to_string(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../blueprint/tests/fixtures/site/blueprint/tools/weather.tool.json"),
    )
    .unwrap();
    let types = |name: &str| {
        std::fs::read_to_string(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(format!(
                "../blueprint/tests/fixtures/site/blueprint/types/{name}.json"
            )),
        )
        .unwrap()
    };
    let extra = vec![
        ("blueprint/site.json".to_string(), bp.to_string()),
        ("blueprint/tools/weather.tool.json".to_string(), tool),
        ("blueprint/types/Weather.json".to_string(), types("Weather")),
        (
            "blueprint/types/WeatherReport.json".to_string(),
            types("WeatherReport"),
        ),
        ("blueprint/types/Teaser.json".to_string(), types("Teaser")),
    ];
    let p = player(&s, &extra).await;
    let v: Value = get(&s, &p, None).await.json().await.unwrap();
    assert_eq!(v["source"], "repo");
    // The binding's type does not fit: one issue, on that slot, and the town marks it.
    let issues = v["issues"].as_array().unwrap();
    assert_eq!(issues.len(), 1, "{issues:?}");
    assert_eq!(issues[0]["code"], "type-mismatch");
    assert_eq!(issues[0]["path"], "/page_types/1/slots/0/source");
    let tools = v["tools"].as_array().unwrap();
    assert_eq!(tools.len(), 1);
    assert_eq!(tools[0]["id"], "weather");
    assert_eq!(tools[0]["issues"], json!([]));
    assert_eq!(
        tools[0]["manifest"]["origins"],
        json!(["https://api.open-meteo.com"])
    );
}
