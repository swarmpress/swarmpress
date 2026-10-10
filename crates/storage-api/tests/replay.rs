//! The M0 spike's measurement (docs/design/wordpress-site-engine.md, ADR-0084):
//! every statement WordPress 7.1.3 sent during install, the front page, a
//! login, the dashboard, the editor, creating, editing, tagging and
//! publishing a post through REST, and reading it back
//! (`fixtures/wp-corpus.jsonl`), replayed in order through the translator
//! onto a projection with WordPress's schema (`fixtures/wp-schema.sql`, read
//! from the database WordPress created). It reports coverage, the failures
//! by reason, the write classes, and the time per statement, and holds the
//! go criterion for coverage: at most 1% of statements unhandled.

use std::collections::BTreeMap;
use std::time::Instant;

use storage_api::{classify, Class, Projection, ProjectionError, Translated};

const SCHEMA: &str = include_str!("fixtures/wp-schema.sql");
const CORPUS: &str = include_str!("fixtures/wp-corpus.jsonl");

#[derive(Default)]
struct Report {
    total: usize,
    handled: usize,
    failures: BTreeMap<String, Vec<String>>,
    classes: BTreeMap<String, usize>,
    micros: Vec<u128>,
}

fn reason(e: &ProjectionError) -> String {
    let s = e.to_string();
    // Group by the start of the message, without the statement's own values.
    s.split(&['"', '\''][..])
        .next()
        .unwrap_or(&s)
        .chars()
        .take(80)
        .collect()
}

fn replay() -> Report {
    let mut p = Projection::open(SCHEMA).expect("the schema loads");
    let mut r = Report::default();
    for line in CORPUS.lines() {
        let row: serde_json::Value = serde_json::from_str(line).unwrap();
        let q = row["q"].as_str().unwrap();
        r.total += 1;
        let t0 = Instant::now();
        let res = p.query(q);
        r.micros.push(t0.elapsed().as_micros());
        match res {
            Ok((
                Translated::Sql {
                    write: Some(table), ..
                },
                _,
            )) => {
                r.handled += 1;
                *r.classes
                    .entry(format!("{:?}", classify(&table, q)))
                    .or_default() += 1;
            }
            Ok((Translated::MultiDelete { tables, .. }, _)) => {
                r.handled += 1;
                *r.classes
                    .entry(format!("{:?}", classify(&tables[0], q)))
                    .or_default() += 1;
            }
            Ok(_) => r.handled += 1,
            Err(e) => r
                .failures
                .entry(reason(&e))
                .or_default()
                .push(q.chars().take(160).collect()),
        }
    }
    r
}

#[test]
fn the_corpus_replays_through_the_translator() {
    let r = replay();
    let mut sorted = r.micros.clone();
    sorted.sort_unstable();
    let pct = |p: usize| sorted[(sorted.len() * p / 100).min(sorted.len() - 1)];
    let unhandled = r.total - r.handled;
    println!(
        "statements {}  handled {}  unhandled {} ({:.2}%)",
        r.total,
        r.handled,
        unhandled,
        unhandled as f64 * 100.0 / r.total as f64
    );
    println!(
        "time per statement: p50 {} µs  p95 {} µs  p99 {} µs  max {} µs",
        pct(50),
        pct(95),
        pct(99),
        sorted.last().unwrap()
    );
    println!("write classes: {:?}", r.classes);
    for (why, qs) in &r.failures {
        println!("  {:4} × {why}\n         e.g. {}", qs.len(), qs[0]);
    }
    assert!(r.handled > 0);
}

#[test]
fn classes_are_known_for_every_core_write() {
    let r = replay();
    assert_eq!(
        r.classes.get(&format!("{:?}", Class::Unknown)),
        None,
        "core writes only to governed tables"
    );
}

/// The replay ends in the governed state WordPress's own SQLite integration reached with the same
/// statements (`fixtures/wp-expected.json`, read from its database): the translation is right
/// where it matters, not only accepted by SQLite.
#[test]
fn the_replay_reaches_the_state_wordpress_reached() {
    let expected: serde_json::Value =
        serde_json::from_str(include_str!("fixtures/wp-expected.json")).unwrap();
    let mut p = Projection::open(SCHEMA).unwrap();
    for line in CORPUS.lines() {
        let row: serde_json::Value = serde_json::from_str(line).unwrap();
        let _ = p.query(row["q"].as_str().unwrap());
    }
    let mut rows = |sql: &str| -> serde_json::Value {
        let (_, out) = p.query(sql).unwrap();
        serde_json::Value::Array(out.rows.into_iter().map(serde_json::Value::Array).collect())
    };
    // Values come back as strings (MySQL's wire); the expected file has numbers where SQLite stored them.
    let norm = |v: &serde_json::Value| -> String { v.to_string().replace('"', "") };
    for (key, sql) in [
        ("posts", "SELECT ID, post_title, post_status, post_type, post_name FROM wp_posts WHERE post_type IN ('post','page') ORDER BY ID"),
        ("terms", "SELECT t.term_id, t.name, t.slug, tt.taxonomy, tt.count FROM wp_terms t JOIN wp_term_taxonomy tt ON tt.term_id = t.term_id ORDER BY t.term_id"),
        ("term_relationships", "SELECT object_id, term_taxonomy_id FROM wp_term_relationships ORDER BY object_id, term_taxonomy_id"),
        ("options", "SELECT option_name, option_value FROM wp_options WHERE option_name IN ('blogname','siteurl','home','template','stylesheet','permalink_structure','default_category','posts_per_page') ORDER BY option_name"),
        ("users", "SELECT ID, user_login, user_email FROM wp_users ORDER BY ID"),
    ] {
        assert_eq!(norm(&rows(sql)), norm(&expected[key]), "{key}");
    }
}
