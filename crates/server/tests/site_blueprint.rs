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
    // No site-kit theme in the fixture repo: nothing to generate into.
    assert_eq!(v["kit_theme"], false);
    assert_eq!(v["theme_files"], json!([]));
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
    assert!(v["context"]["sections"].is_array(), "{}", v["context"]);
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

async fn put(s: &TestServer, p: &GatewayPlayer, body: Value) -> reqwest::Response {
    s.http
        .put(s.url("/api/site/blueprint"))
        .header(COOKIE, &p.cookie)
        .header(LEASE, &p.lease)
        .json(&body)
        .send()
        .await
        .unwrap()
}

#[tokio::test]
async fn the_ceo_edits_the_blueprint_and_it_lands_on_the_base_branch() {
    let s = TestServer::start().await;
    let p = player(&s, &[]).await;
    let repo = github::RepoId::new("swarmpress-sites", "player1-site");
    let v: Value = get(&s, &p, None).await.json().await.unwrap();
    let base = v["hash"].as_str().unwrap().to_string();
    let mut bp = v["blueprint"].clone();
    bp["page_types"].as_array_mut().unwrap().push(json!({
        "id": "author", "label": { "en": "Author" }, "route": "/{lang}/authors/{slug}",
        "source": { "kind": "page" },
        "slots": [{ "id": "profile", "blocks": ["team-grid"], "min": 1, "max": 1 }]
    }));

    // A blueprint that does not check: 422 with the issues, nothing written.
    let mut broken = bp.clone();
    broken["page_types"]
        .as_array_mut()
        .unwrap()
        .last_mut()
        .unwrap()["slots"][0]["blocks"] = json!(["team-grids"]);
    let r = put(&s, &p, json!({ "blueprint": broken, "base_hash": base })).await;
    assert_eq!(r.status().as_u16(), 422);
    let e: Value = r.json().await.unwrap();
    assert!(e["issues"].to_string().contains("team-grids"), "{e}");
    let head0 = s.fake_github().branch_head(&repo, "main").unwrap();

    // A stale base: 409.
    let r = put(
        &s,
        &p,
        json!({ "blueprint": bp, "base_hash": "0".repeat(64) }),
    )
    .await;
    assert_eq!(r.status().as_u16(), 409);
    assert_eq!(s.fake_github().branch_head(&repo, "main").unwrap(), head0);

    // The edit lands: blueprint, types and the derived registry on main.
    let r = put(
        &s,
        &p,
        json!({ "blueprint": bp, "base_hash": base, "message": "Add author pages" }),
    )
    .await;
    assert_eq!(r.status().as_u16(), 200);
    let out: Value = r.json().await.unwrap();
    assert_ne!(out["commit"], json!(head0));
    assert_eq!(
        s.fake_github().branch_head(&repo, "main").unwrap(),
        out["commit"].as_str().unwrap()
    );
    assert!(out["changes"]
        .as_array()
        .unwrap()
        .iter()
        .any(|c| c["kind"] == "added" && c["subject"] == "page-type" && c["id"] == "author"));
    let stored: Value = serde_json::from_str(
        &s.fake_github()
            .file_text(&repo, "main", "blueprint/site.json")
            .unwrap(),
    )
    .unwrap();
    assert!(stored["page_types"]
        .as_array()
        .unwrap()
        .iter()
        .any(|t| t["id"] == "author"));
    let registry: Value = serde_json::from_str(
        &s.fake_github()
            .file_text(&repo, "main", "content/config/page-types.json")
            .unwrap(),
    )
    .unwrap();
    assert!(registry["page_types"]
        .as_array()
        .unwrap()
        .iter()
        .any(|t| t["id"] == "author"));
    assert!(
        !registry["page_types"]
            .as_array()
            .unwrap()
            .iter()
            .any(|t| t["id"] == "blog-article"),
        "core types stay the platform's"
    );

    // The next read is the stored blueprint at the new head.
    let v: Value = get(&s, &p, None).await.json().await.unwrap();
    assert_eq!(v["source"], "repo");
    assert_eq!(v["hash"], out["hash"]);
    assert_eq!(v["issues"], json!([]));
    // The same blueprint again changes nothing.
    let r = put(&s, &p, json!({ "blueprint": bp, "base_hash": out["hash"] })).await;
    let again: Value = r.json().await.unwrap();
    assert_eq!(again["changes"], json!([]));
    assert_eq!(again["commit"], out["commit"]);
}

fn fixture(path: &str) -> Value {
    serde_json::from_str(
        &std::fs::read_to_string(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../blueprint/tests/fixtures/site/blueprint")
                .join(path),
        )
        .unwrap(),
    )
    .unwrap()
}

/// FEAT-095: the Web Developer's tool lands through the same PUT, after the
/// tool checker passed in the site's context; a tool that does not check is
/// a 422 and nothing is written.
#[tokio::test]
async fn a_tool_is_installed_through_the_put_after_its_check() {
    let s = TestServer::start().await;
    let p = player(&s, &[]).await;
    let repo = github::RepoId::new("swarmpress-sites", "player1-site");
    let v: Value = get(&s, &p, None).await.json().await.unwrap();
    // The site's types first: the imported ones and the weather's.
    let mut types = v["types"].clone();
    types["Weather"] = fixture("types/Weather.json");
    types["WeatherReport"] = fixture("types/WeatherReport.json");
    let r = put(
        &s,
        &p,
        json!({ "blueprint": v["blueprint"], "types": types, "base_hash": v["hash"] }),
    )
    .await;
    assert_eq!(r.status().as_u16(), 200);
    let stored: Value = r.json().await.unwrap();
    assert_eq!(stored["tools"], json!([]));
    let hash = stored["hash"].clone();

    let weather = fixture("tools/weather.tool.json");
    // A graph whose id is not its key: 400.
    let r = put(
        &s,
        &p,
        json!({ "base_hash": hash, "tools": { "forecast": weather } }),
    )
    .await;
    assert_eq!(r.status().as_u16(), 400);
    // A graph that does not check (an unknown type): 422 with the issues, nothing written.
    let mut broken = weather.clone();
    broken["nodes"][2]["returns"] = json!("Wheather");
    let head0 = s.fake_github().branch_head(&repo, "main").unwrap();
    let r = put(
        &s,
        &p,
        json!({ "base_hash": hash, "tools": { "weather": broken } }),
    )
    .await;
    assert_eq!(r.status().as_u16(), 422);
    let e: Value = r.json().await.unwrap();
    assert!(e["issues"].to_string().contains("Wheather"), "{e}");
    assert_eq!(s.fake_github().branch_head(&repo, "main").unwrap(), head0);
    // A stale base: 409.
    let r = put(
        &s,
        &p,
        json!({ "base_hash": "0".repeat(64), "tools": { "weather": weather } }),
    )
    .await;
    assert_eq!(r.status().as_u16(), 409);

    // The tool lands as the structure actor's file on main; the blueprint is kept.
    let r = put(
        &s,
        &p,
        json!({ "base_hash": hash, "tools": { "weather": weather }, "message": "Install the weather tool" }),
    )
    .await;
    assert_eq!(r.status().as_u16(), 200);
    let out: Value = r.json().await.unwrap();
    assert_eq!(out["tools"], json!(["weather"]));
    assert_eq!(out["changes"], json!([]));
    assert_eq!(out["hash"], hash);
    assert_ne!(out["commit"], json!(head0));
    let file: Value = serde_json::from_str(
        &s.fake_github()
            .file_text(&repo, "main", "blueprint/tools/weather.tool.json")
            .unwrap(),
    )
    .unwrap();
    assert_eq!(
        blueprint::tools::ToolGraph::from_value(&file).unwrap(),
        blueprint::tools::ToolGraph::from_value(&weather).unwrap()
    );
    let v: Value = get(&s, &p, None).await.json().await.unwrap();
    let tools = v["tools"].as_array().unwrap();
    assert_eq!(tools.len(), 1);
    assert_eq!(tools[0]["id"], "weather");
    assert_eq!(tools[0]["issues"], json!([]));
    // The same tool again writes nothing.
    let again: Value = put(
        &s,
        &p,
        json!({ "base_hash": hash, "tools": { "weather": weather } }),
    )
    .await
    .json()
    .await
    .unwrap();
    assert_eq!(again["tools"], json!([]));
    assert_eq!(again["commit"], out["commit"]);
}
