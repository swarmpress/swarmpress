//! The eval harness's pure side (FEAT-036, ADR-0058; `orchestrator::eval`):
//! the gateway's checks run in the executor, the existing articles read as
//! reviewable positive controls, and the six seeded-bad drafts, each caught
//! by the deterministic checks.

use std::path::PathBuf;
use std::sync::Arc;

use agents::fake_writer;
use agents::pipeline::Brief;
use content_model::article_profile::check_article_profile;
use orchestrator::eval::{
    eval_checks, gateway_checks, reference_article, seeded_bad, EvalArticle, SEED_KINDS,
};
use orchestrator::{
    ArtifactRecord, BriefRecord, FakeGateway, JobKind, JobRequest, MemStore, Orchestrator, Store,
};
use serde_json::{json, Value};

mod common;
use common::{site, team, COMPANY};

fn fixture_article(slug: &str) -> (String, Value) {
    let path = format!("content/pages/blog/{slug}.json");
    let file = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../knowledge/tests/fixtures/cinqueterre-mini")
        .join(&path);
    let page = serde_json::from_str(&std::fs::read_to_string(file).unwrap()).unwrap();
    (path, page)
}

const REFERENCES: [&str; 3] = [
    "5-hidden-gelaterias-you-need-to-try",
    "day-trip-to-portovenere",
    "last-light-on-sentiero-azzurro",
];

fn reference(slug: &str) -> EvalArticle {
    let (path, page) = fixture_article(slug);
    reference_article(&site(), &path, &page).unwrap()
}

#[test]
fn existing_articles_read_as_reviewable_parts_in_the_article_profile() {
    let site = site();
    for slug in REFERENCES {
        let a = reference(slug);
        let page = a.record.page.as_ref().unwrap();
        let parts = a.record.parts.as_ref().unwrap();
        assert_eq!(a.brief.slug, slug);
        assert_eq!(a.record.path.as_deref(), Some(a.brief.page_path().as_str()));
        assert!(!parts.sections.is_empty(), "{slug}: intro and sections");
        assert!(
            parts.sections.len() >= 2,
            "{slug}: at least one body section"
        );
        // The re-assembled page has the shape the gateway enforces.
        assert_eq!(
            check_article_profile(page, &a.brief.page_path(), &a.brief.content_id),
            Ok(()),
            "{slug}"
        );
        let checks = eval_checks(&site, &a.brief, &a.record);
        assert_eq!(
            checks.words_percent, 100,
            "{slug}: judged on its own length"
        );
        assert!(checks.words_ok);
        // A reference is on the site already: the gateway would refuse it as a new draft.
        assert!(
            checks
                .gateway_issues
                .iter()
                .any(|i| i.contains("create-only")),
            "{slug}: {:?}",
            checks.gateway_issues
        );
    }
    // The old single-block shape and the article profile's block list both read.
    let old = reference("day-trip-to-portovenere");
    assert_eq!(old.brief.title, "Day Trip to Portovenere");
    assert!(old.record.parts.as_ref().unwrap().sections.len() >= 4);
}

#[test]
fn every_seeded_fault_is_caught_by_the_deterministic_checks() {
    let site = site();
    let good = reference("day-trip-to-portovenere");
    let base = eval_checks(&site, &good.brief, &good.record);
    for kind in SEED_KINDS {
        let bad = seeded_bad(&site, &good, kind).unwrap();
        assert!(bad.source.starts_with(&format!("seeded:{kind}:")));
        assert_ne!(bad.brief.content_id, good.brief.content_id);
        let c = eval_checks(&site, &bad.brief, &bad.record);
        assert!(!c.passes(), "{kind}: {c:?}");
        let has = |list: &[String], needle: &str| list.iter().any(|i| i.contains(needle));
        match kind {
            "block-order" => assert!(has(&c.gateway_issues, "editorial-hero"), "{c:?}"),
            "banned-phrase" => {
                assert!(base.banned_phrases.is_empty(), "{:?}", base.banned_phrases);
                assert!(!c.banned_phrases.is_empty());
                assert!(has(&c.site_issues, "banned phrase"), "{c:?}");
            }
            "unknown-entity" => {
                assert!(has(&c.link_media_issues, "/en/atlantis"), "{c:?}");
                assert!(has(&c.gateway_issues, "/en/atlantis"));
            }
            "too-short" => {
                assert!(!c.words_ok);
                assert!(c.words_percent < 75, "{}", c.words_percent);
            }
            "raw-html" => {
                assert!(has(&c.gateway_issues, "raw `<` or `>`"), "{c:?}");
                assert!(!c.plain_text_findings.is_empty());
            }
            "duplicate-slug" => {
                assert_ne!(bad.brief.slug, good.brief.slug);
                assert!(has(&c.gateway_issues, "create-only"), "{c:?}");
            }
            _ => unreachable!(),
        }
        // Deterministic: the same fault twice is the same article.
        assert_eq!(seeded_bad(&site, &good, kind).unwrap(), bad);
    }
    assert!(seeded_bad(&site, &good, "typo").is_err());
}

fn brief() -> Brief {
    Brief {
        content_id: "eval-harvest".into(),
        title: "Harvest week in Manarola".into(),
        slug: "harvest-week-in-manarola".into(),
        angle:
            "A day on the terraces with the pickers, and how to watch without getting in the way."
                .into(),
        keywords: vec!["Manarola".into(), "Sciacchetrà".into(), "terraces".into()],
        target_words: 600,
        language: "en".into(),
        notes: String::new(),
    }
}

/// A staged draft of the fake writer passes everything the gateway checks:
/// the two validators (the orchestrator's and the server's) agree.
#[tokio::test]
async fn a_staged_draft_passes_the_gateway_checks() {
    let store = Arc::new(MemStore::new());
    let rec = BriefRecord {
        job_id: 1,
        brief: brief(),
        writer: "staff-1".into(),
        editor: "staff-5".into(),
        minutes: vec![],
        work_item: None,
        staff: team(),
    };
    store
        .put_brief(COMPANY, 7, serde_json::to_value(rec).unwrap())
        .await
        .unwrap();
    let o = Orchestrator::new(
        store.clone(),
        Arc::new(FakeGateway::new()),
        Arc::new(fake_writer::fake_writer([])),
        site(),
    );
    o.run(&JobRequest {
        company_id: COMPANY.into(),
        job_id: 2,
        kind: JobKind::Draft,
        project: "project-1".into(),
        work_item: Some("work-item-1".into()),
        brief_ref: Some(7),
        revision: 0,
        staff: team(),
    })
    .await
    .unwrap();
    let record: ArtifactRecord = serde_json::from_value(
        store
            .get_artifact(COMPANY, "work-item-1")
            .await
            .unwrap()
            .unwrap(),
    )
    .unwrap();
    let site = site();
    let page = record.page.as_ref().unwrap();
    assert_eq!(
        gateway_checks(&site, "eval-harvest", &brief().page_path(), page),
        Vec::<String>::new()
    );
    let c = eval_checks(&site, &brief(), &record);
    assert!(
        c.site_issues.is_empty() && c.gateway_issues.is_empty(),
        "{c:?}"
    );
    assert!(c.headings > 0 && c.headings_ok);
    assert!(c.measured.iter().any(|m| m.starts_with("Words: ")));
}

#[test]
fn the_gateway_checks_are_the_servers_rules() {
    let site = site();
    let page = reference("day-trip-to-portovenere").record.page.unwrap();
    let id = page["id"].as_str().unwrap().to_string();
    let issues = |path: &str, page: &Value| gateway_checks(&site, &id, path, page);
    // Not an article path: the profile does not apply, the path rules do.
    assert!(issues("content/pages/blog-index.json", &page)
        .iter()
        .any(|i| i.contains("written by the gateway")));
    assert!(issues("theme/x.json", &page)
        .iter()
        .any(|i| i.contains("under content/")));
    assert!(issues("content/pages/blog/x.txt", &page)
        .iter()
        .any(|i| i.contains(".json")));
    assert_eq!(
        issues("content/pages/blog/new.json", &json!([1])),
        ["page must be a JSON object"]
    );
    // A new path: the slug mismatch of the profile is left (and the hero, which the
    // fixture's small media index does not have).
    let fresh = issues("content/pages/blog/a-new-trip.json", &page);
    assert!(fresh.iter().any(|i| i.contains("/slug/en")), "{fresh:?}");
    assert!(
        fresh
            .iter()
            .all(|i| i.contains("/slug/") || i.contains("media index")),
        "{fresh:?}"
    );
}
