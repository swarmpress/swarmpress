//! The calibration table of the eval's positive controls (FEAT-036, ADR-0058;
//! `docs/design/mvp-pipeline.md` §9, `docs/qualification/check-calibration.md`).
//!
//! Local only: set `EVAL_PACK` to a site pack built with `--articles` (the
//! owner's real site, never committed). Prints, per existing article and per
//! check, every issue the eval reports, and the same for the article's page as
//! the site has it (before the reference reading re-assembles it). Without
//! `EVAL_PACK` the test does nothing.

use orchestrator::eval::{eval_checks, reference_article};
use orchestrator::SiteBinding;
use serde_json::{json, Value};

#[test]
fn calibration_table_of_a_real_pack() {
    let Ok(path) = std::env::var("EVAL_PACK") else {
        return;
    };
    let doc: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
    let mut pack = doc.clone();
    let articles = pack
        .as_object_mut()
        .unwrap()
        .remove("articles")
        .unwrap_or_default();
    let site = SiteBinding::from_json(&json!({
        "site_id": "cinqueterre.travel",
        "brand_name": "Cinque Terre Dispatch",
        "language": "en",
        "quality_bar": 7,
        "simulate_deploy": false,
        "standup_max_turns": 4,
        "seo_suffix": "The Dispatch",
        "knowledge_pack": pack.to_string(),
    }))
    .unwrap();
    let mut entries: Vec<(&String, &Value)> = articles.as_object().unwrap().iter().collect();
    entries.sort_by(|a, b| a.0.cmp(b.0));
    let mut totals: std::collections::BTreeMap<&str, u32> = Default::default();
    for (p, text) in entries {
        let Some(slug) = p
            .strip_prefix("content/pages/blog/")
            .and_then(|s| s.strip_suffix(".json"))
            .filter(|s| !s.contains('/'))
        else {
            continue;
        };
        let page: Value = serde_json::from_str(text.as_str().unwrap()).unwrap();
        println!("=== {slug}");
        let a = match reference_article(&site, p, &page) {
            Ok(a) => a,
            Err(e) => {
                println!("  reference error: {e}");
                continue;
            }
        };
        for n in &a.notes {
            println!("  note: {n}");
        }
        let c = eval_checks(&site, &a.brief, &a.record);
        println!("  rules: {:?}", c.rules);
        let mut fail = |name: &'static str, issues: Vec<String>| {
            if !issues.is_empty() {
                *totals.entry(name).or_default() += 1;
                for i in issues {
                    println!("  [{name}] {i}");
                }
            }
        };
        fail("banned-phrases", c.banned_phrases.clone());
        fail(
            "near-duplicates",
            if c.near_duplicates > 0 {
                vec![format!("{} pairs", c.near_duplicates)]
            } else {
                vec![]
            },
        );
        fail(
            "headings",
            if c.headings_ok {
                vec![]
            } else {
                vec![format!("{} headings", c.headings)]
            },
        );
        fail(
            "title-length",
            if c.title_ok {
                vec![]
            } else {
                vec![format!("{} chars", c.title_chars)]
            },
        );
        fail(
            "description-length",
            if c.description_ok {
                vec![]
            } else {
                vec![format!("{} chars", c.description_chars)]
            },
        );
        fail("plain-text", c.plain_text_findings.clone());
        fail("links-and-media", c.link_media_issues.clone());
        fail("site-validator", c.site_issues.clone());
        fail(
            "gateway",
            c.gateway_issues
                .iter()
                .filter(|i| !i.contains("create-only"))
                .cloned()
                .collect(),
        );
        if let Some(k) = site.knowledge.as_ref() {
            for i in k.kb.closed_world_issues(&page) {
                println!("  [raw-page closed world] {i}");
            }
        }
    }
    println!("=== totals {totals:?}");
}
