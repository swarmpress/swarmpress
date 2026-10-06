//! Theme components from the blueprint (ADR-0072, FEAT-094): written by the
//! design actor on design/<item> after the component check, refused on a
//! site that still builds the frozen theme, merged after the CEO's approval.

mod common;

use common::{with_site, GatewayPlayer, TestServer, LEASE};
use reqwest::header::COOKIE;
use serde_json::{json, Value};

const GOOD: &str = "---\nconst { block, ctx } = Astro.props\n---\n<section class=\"hero\"><h1>{ctx.l(block.title)}</h1></section>\n<style>.hero { color: var(--color-accent); }</style>\n";

async fn player(s: &TestServer, kit_theme: bool) -> GatewayPlayer {
    let repo = github::RepoId::new("swarmpress-sites", "player1-site");
    let mut files: Vec<(&str, &str)> = vec![];
    if kit_theme {
        files.push(("theme/theme.config.ts", "export default {}\n"));
    }
    s.fake_github().create_repo(&repo, &with_site(&files));
    s.gateway_player(1).await
}

async fn send(
    s: &TestServer,
    p: &GatewayPlayer,
    method: reqwest::Method,
    path: &str,
    body: Value,
) -> reqwest::Response {
    s.http
        .request(method, s.url(path))
        .header(COOKIE, &p.cookie)
        .header(LEASE, &p.lease)
        .json(&body)
        .send()
        .await
        .unwrap()
}

#[tokio::test]
async fn components_land_on_a_design_branch_and_merge_after_approval() {
    let s = TestServer::start().await;
    let p = player(&s, true).await;
    let repo = github::RepoId::new("swarmpress-sites", "player1-site");
    let put = |files: Value| {
        send(
            &s,
            &p,
            reqwest::Method::PUT,
            "/api/site/theme",
            json!({ "item": "work-item-7", "files": files }),
        )
    };

    // Checked first: a script, and a path that is not a renderer.
    let r = put(json!({ "theme/blocks/hero-section.astro": GOOD.replace("<h1>", "<script>x()</script><h1>") })).await;
    assert_eq!(r.status().as_u16(), 422);
    let r = put(json!({ "theme/layouts/Base.astro": GOOD })).await;
    assert_eq!(r.status().as_u16(), 422);

    let r = put(json!({ "theme/blocks/hero-section.astro": GOOD, "theme/blocks/site-header/Component.astro": GOOD })).await;
    assert_eq!(r.status().as_u16(), 200);
    let out: Value = r.json().await.unwrap();
    assert_eq!(out["branch"], "design/work-item-7");
    let main = s.fake_github().branch_head(&repo, "main").unwrap();
    assert!(s
        .fake_github()
        .file_text(&repo, "main", "theme/blocks/hero-section.astro")
        .is_none());
    assert_eq!(
        s.fake_github()
            .file_text(
                &repo,
                "design/work-item-7",
                "theme/blocks/hero-section.astro"
            )
            .as_deref(),
        Some(GOOD)
    );
    // Again: the same pull request.
    let again: Value = put(json!({ "theme/blocks/hero-section.astro": GOOD }))
        .await
        .json()
        .await
        .unwrap();
    assert_eq!(again["number"], out["number"]);

    let r = send(
        &s,
        &p,
        reqwest::Method::POST,
        "/api/site/theme/merge",
        json!({ "number": out["number"], "head_sha": again["head_sha"] }),
    )
    .await;
    assert_eq!(r.status().as_u16(), 200);
    assert_ne!(s.fake_github().branch_head(&repo, "main").unwrap(), main);
    assert_eq!(
        s.fake_github()
            .file_text(&repo, "main", "theme/blocks/site-header/Component.astro")
            .as_deref(),
        Some(GOOD)
    );
}

#[tokio::test]
async fn the_frozen_theme_is_left_alone() {
    let s = TestServer::start().await;
    let p = player(&s, false).await;
    let r = send(
        &s,
        &p,
        reqwest::Method::PUT,
        "/api/site/theme",
        json!({ "item": "work-item-7", "files": { "theme/blocks/hero-section.astro": GOOD } }),
    )
    .await;
    assert_eq!(r.status().as_u16(), 409);
}
