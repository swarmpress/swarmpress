//! The blueprint of the fixture site (a trimmed cinqueterre.travel), read
//! without a model: golden, sound, and stable under its hash (FEAT-093).
//! `BLESS=1 cargo nextest run -p blueprint` rewrites the golden file.

use std::collections::BTreeMap;
use std::path::PathBuf;

use blueprint::import::import;
use blueprint::{check, hash, site};
use knowledge::DirSource;
use serde_json::{json, Value};

fn mini() -> DirSource {
    DirSource::new(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../knowledge/tests/fixtures/cinqueterre-mini"),
    )
}

fn golden_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/cinqueterre-mini.blueprint.json")
}

#[test]
fn the_fixture_site_imports_to_its_golden_blueprint() {
    let src = mini();
    let imported = import(&src).unwrap();
    let doc = json!({ "blueprint": imported.blueprint, "types": imported.types });
    let text = serde_json::to_string_pretty(&doc).unwrap() + "\n";
    if std::env::var_os("BLESS").is_some() {
        std::fs::write(golden_path(), &text).unwrap();
    }
    let golden = std::fs::read_to_string(golden_path()).expect("golden file (run with BLESS=1)");
    assert_eq!(
        text, golden,
        "the import changed; rerun with BLESS=1 if that is right"
    );
}

#[test]
fn the_imported_blueprint_is_sound_in_its_site() {
    let src = mini();
    let imported = import(&src).unwrap();
    let ctx = site::context(&src, &imported.types, BTreeMap::new()).unwrap();
    assert_eq!(check(&imported.blueprint, &ctx), vec![]);
    // The core article keeps the platform's slots.
    let article = imported.blueprint.page_type("blog-article").unwrap();
    assert_eq!(article.slots.as_ref().unwrap().len(), 3);
    assert_eq!(article.route.as_deref(), Some("/{lang}/blog/{slug}"));
    // Every page type counts its pages.
    assert!(imported
        .blueprint
        .page_types
        .iter()
        .all(|t| t.pages.unwrap_or(0) > 0));
}

#[test]
fn importing_twice_gives_the_same_hash_and_counts_are_not_hashed() {
    let a = import(&mini()).unwrap().blueprint;
    let b = import(&mini()).unwrap().blueprint;
    assert_eq!(hash(&a), hash(&b));
    let mut c = a.clone();
    c.page_types[0].pages = Some(9999);
    assert_eq!(hash(&a), hash(&c));
    c.page_types[0].label.insert("en".into(), "Renamed".into());
    assert_ne!(hash(&a), hash(&c));
}

#[test]
fn the_derived_registry_accepts_every_page_of_its_type() {
    let src = mini();
    let bp = import(&src).unwrap().blueprint;
    let site_types = content_model::PageTypes::parse(&bp.registry()).unwrap();
    let all = content_model::PageTypes::core()
        .with_site(&site_types)
        .unwrap();
    let kb = knowledge::KnowledgeBase::build(&src).unwrap();
    for p in &kb.pages.pages {
        let id = p.page_type.to_ascii_lowercase().replace('_', "-");
        let Some(t) = all.get(&id) else { continue };
        let page: Value = knowledge::SiteSource::read_json(&src, &p.path)
            .unwrap()
            .unwrap();
        let body = page["body"].as_array().cloned().unwrap_or_default();
        if t.id == "blog-article" {
            continue; // the core profile is stricter than old articles; the gateway applies it to new ones
        }
        assert_eq!(t.check_body(&body), vec![], "{}", p.path);
    }
}
