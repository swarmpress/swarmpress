//! v1 ↔ v2 conformance on the shared content-schema fixtures, plus a v2
//! acceptance run over the real cinqueterre.travel pages (ignored by default).

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use content_model::{validate_page_v1, validate_page_v2, SchemaRegistry};
use serde_json::Value;

fn fixtures_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../content-schema/fixtures")
}

fn json_files(dir: &Path) -> Vec<PathBuf> {
    let mut out = vec![];
    let mut stack = vec![dir.to_path_buf()];
    while let Some(d) = stack.pop() {
        for e in fs::read_dir(&d).unwrap() {
            let p = e.unwrap().path();
            if p.is_dir() {
                stack.push(p);
            } else if p.extension().and_then(|e| e.to_str()) == Some("json") {
                out.push(p);
            }
        }
    }
    out.sort();
    out
}

#[test]
fn shared_fixtures_agree_between_v1_and_v2() {
    let registry = SchemaRegistry::core();
    let files = json_files(&fixtures_dir());
    assert!(
        files.len() >= 6,
        "expected the shared fixtures, found {}",
        files.len()
    );
    for path in files {
        let page: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        let v1 = validate_page_v1(&page).is_ok();
        let v2 = validate_page_v2(&page, &registry);
        assert_eq!(
            v1,
            v2.is_ok(),
            "{}: v1 ok={v1}, v2 errors={:?}",
            path.display(),
            v2.errors
        );
        let expected_valid = path.parent().unwrap().ends_with("valid");
        assert_eq!(v1, expected_valid, "{}", path.display());
    }
}

const CINQUETERRE: &str = "/home/user/cinqueterre.travel/content/pages";

/// Run with `cargo test -p content-model -- --ignored --nocapture`.
#[test]
#[ignore = "needs the cinqueterre.travel checkout at /home/user/cinqueterre.travel"]
fn real_pages_v1_vs_v2() {
    let registry = SchemaRegistry::core();
    let v1_blocks: BTreeMap<String, jsonschema::Validator> =
        content_model::registry::core_block_schemas_v1()
            .into_iter()
            .map(|(t, s)| (t, jsonschema::draft7::new(&s).unwrap()))
            .collect();
    let files = json_files(Path::new(CINQUETERRE));
    let (mut v1_ok, mut v2_ok) = (0, 0);
    let (mut blocks, mut b1_ok, mut b2_ok) = (0, 0, 0);
    // block type -> (count, v1 ok, v2 ok)
    let mut per_type: BTreeMap<String, (u32, u32, u32)> = BTreeMap::new();
    let mut v2_patterns: BTreeMap<String, usize> = BTreeMap::new();
    for path in &files {
        let page: Value = serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap();
        if validate_page_v1(&page).is_ok() {
            v1_ok += 1;
        }
        let rep = validate_page_v2(&page, &registry);
        if rep.is_ok() {
            v2_ok += 1;
        }
        for e in &rep.errors {
            // Collapse indices and quoted values so the drift patterns aggregate.
            let at = e
                .path
                .split('/')
                .skip(3)
                .map(|s| if s.parse::<usize>().is_ok() { "#" } else { s })
                .collect::<Vec<_>>()
                .join("/");
            let msg = e.message.split(" is not ").next().unwrap_or_default();
            let msg: String = msg.chars().take(110).collect();
            *v2_patterns.entry(format!("{msg} @ /{at}")).or_default() += 1;
        }
        for block in page["body"].as_array().into_iter().flatten() {
            let t = block["type"].as_str().unwrap_or_default().to_string();
            let a = v1_blocks.get(&t).is_some_and(|v| v.is_valid(block));
            let b = registry
                .get(&t)
                .is_some_and(|s| s.validator().is_valid(block));
            blocks += 1;
            b1_ok += u32::from(a);
            b2_ok += u32::from(b);
            let e = per_type.entry(t).or_default();
            e.0 += 1;
            e.1 += u32::from(a);
            e.2 += u32::from(b);
        }
    }
    println!(
        "real pages: {} | v1 pass: {v1_ok} | v2 pass: {v2_ok}",
        files.len()
    );
    println!("real blocks: {blocks} | v1 block pass: {b1_ok} | v2 block pass: {b2_ok}");
    println!("per block type (count v1-ok v2-ok):");
    for (t, (n, a, b)) in &per_type {
        println!("  {t:28} {n:4} {a:4} {b:4}");
    }
    let mut top: Vec<_> = v2_patterns.into_iter().collect();
    top.sort_by_key(|e| std::cmp::Reverse(e.1));
    println!("top v2 error patterns:");
    for (k, n) in top.iter().take(25) {
        println!("  {n:4}  {k}");
    }
    assert_eq!(files.len(), 157);
    assert!(v2_ok >= v1_ok);
    assert!(b2_ok > b1_ok, "v2 should accept more real blocks than v1");
}
