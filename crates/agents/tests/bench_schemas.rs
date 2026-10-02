//! Exports the stage schemas and check vectors that the browser qualification
//! harness uses (ADR-0057, FEAT-037; `apps/game/src/llm/bench/`).
//!
//! The harness measures a real local model on the same schemas the staged
//! article pipeline and the standup use. Those schemas live here in Rust and
//! are not exported to JavaScript by `orchestrator-wasm`, so this test writes
//! them to `apps/game/src/llm/bench/article-schemas.json` and fails when the
//! checked-in file differs from what the Rust functions return today:
//!
//! ```sh
//! UPDATE_GOLDEN=1 cargo test -p agents --test bench_schemas
//! ```
//!
//! The file also carries vectors for the two deterministic checks the harness
//! mirrors in TypeScript (`word_count` and the shape, length and plain-text
//! part of `check_section`), so the mirror cannot drift either: a vitest test
//! replays them (`apps/game/src/llm/bench/article.test.ts`).

use agents::article::{
    check_section, closing_schema, outline_schema, review_schema, section_ids, section_schema,
    word_count, SectionBlock, SectionBlockKind, SectionBudget, SectionDraft, SectionId,
    MIN_SECTION_WORDS, SECTION_MAX_PERCENT, SECTION_MIN_PERCENT,
};
use agents::meetings::{moderator_schema, MeetingSpec, Participant};
use agents::{Role, Seniority, StyleGuide};
use serde_json::{json, Value};

const FIXTURE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../apps/game/src/llm/bench/article-schemas.json"
);

/// The benchmark article has five body sections.
const SECTIONS: usize = 5;
/// Word budget of the single-section fixture.
const SECTION_WORDS: u32 = 300;

fn strings(values: &[&str]) -> Vec<String> {
    values.iter().map(|s| (*s).to_string()).collect()
}

fn aliases(prefix: &str, n: usize) -> Vec<String> {
    (1..=n).map(|i| format!("{prefix}{i}")).collect()
}

fn participant(id: &str, name: &str, role: Role) -> Participant {
    Participant {
        id: id.into(),
        name: name.into(),
        role,
        seniority: Some(Seniority::Senior),
        system_prompt: String::new(),
    }
}

/// The standup of the MVP team (`MVP_TEAM` in `apps/game/src/llm/mvp-script.ts`).
fn standup() -> MeetingSpec {
    MeetingSpec {
        id: "bench-standup".into(),
        topic: "Daily standup".into(),
        moderator: participant("staff-4", "Sophia", Role::EditorInChief),
        participants: vec![
            participant("staff-5", "Marco", Role::Editor),
            participant("staff-1", "Giulia", Role::Writer),
            participant("staff-2", "Isabella", Role::Writer),
        ],
        max_turns: 4,
        max_tokens_per_turn: 600,
        max_tokens_outcome: 2000,
    }
}

fn block(kind: SectionBlockKind, text: &str, items: &[&str]) -> SectionBlock {
    SectionBlock {
        kind,
        text: text.into(),
        items: strings(items),
    }
}

/// `n` distinct plain words, so no paragraph is a near-duplicate of another.
fn words(n: usize, seed: usize) -> String {
    (0..n)
        .map(|i| format!("word{}x{}", seed, i))
        .collect::<Vec<_>>()
        .join(" ")
}

/// Drafts inside what the TypeScript mirror checks: plain text only, no
/// banned phrase, no repeated paragraph.
fn check_vectors() -> Vec<Value> {
    use SectionBlockKind::{List, Paragraph, Tip};
    let cases: Vec<(&str, SectionId, u32, SectionDraft)> = vec![
        (
            "one paragraph inside the band",
            SectionId::Section(1),
            SECTION_WORDS,
            SectionDraft {
                blocks: vec![block(Paragraph, &words(300, 1), &[])],
            },
        ),
        (
            "at the lower edge",
            SectionId::Section(1),
            SECTION_WORDS,
            SectionDraft {
                blocks: vec![block(Paragraph, &words(180, 2), &[])],
            },
        ),
        (
            "one word under the lower edge",
            SectionId::Section(1),
            SECTION_WORDS,
            SectionDraft {
                blocks: vec![block(Paragraph, &words(179, 3), &[])],
            },
        ),
        (
            "at the upper edge",
            SectionId::Section(2),
            SECTION_WORDS,
            SectionDraft {
                blocks: vec![
                    block(Paragraph, &words(400, 4), &[]),
                    block(List, "", &["twenty words here", &words(17, 5)]),
                ],
            },
        ),
        (
            "one word over the upper edge",
            SectionId::Section(2),
            SECTION_WORDS,
            SectionDraft {
                blocks: vec![block(Paragraph, &words(421, 6), &[])],
            },
        ),
        (
            "a list with text and a paragraph with items",
            SectionId::Section(3),
            SECTION_WORDS,
            SectionDraft {
                blocks: vec![
                    block(List, "stray text", &["first item"]),
                    block(Paragraph, &words(250, 7), &["stray item"]),
                ],
            },
        ),
        (
            "an empty list and an empty tip",
            SectionId::Section(3),
            SECTION_WORDS,
            SectionDraft {
                blocks: vec![
                    block(Paragraph, &words(250, 8), &[]),
                    block(List, "", &[]),
                    block(Tip, "", &[]),
                ],
            },
        ),
        (
            "a tip and a list in the intro",
            SectionId::Intro,
            100,
            SectionDraft {
                blocks: vec![
                    block(Paragraph, &words(80, 9), &[]),
                    block(Tip, "Bring water for the climb.", &[]),
                    block(List, "", &["one", "two"]),
                ],
            },
        ),
        (
            "a URL and an angle bracket",
            SectionId::Section(4),
            SECTION_WORDS,
            SectionDraft {
                blocks: vec![
                    block(
                        Paragraph,
                        &format!("{} see https://example.org/trails today", words(250, 10)),
                        &[],
                    ),
                    block(Tip, "Allow <two> hours.", &[]),
                ],
            },
        ),
        (
            "no blocks",
            SectionId::Section(5),
            SECTION_WORDS,
            SectionDraft { blocks: vec![] },
        ),
        (
            "no budget skips the length check",
            SectionId::Section(5),
            0,
            SectionDraft {
                blocks: vec![block(Paragraph, "Short.", &[])],
            },
        ),
    ];
    let style = StyleGuide::default();
    cases
        .into_iter()
        .map(|(name, section, budget, draft)| {
            let errors = check_section(
                &draft,
                &SectionBudget {
                    section,
                    words: budget,
                    earlier: &[],
                },
                &style,
            );
            let kinds: Vec<Value> = errors
                .iter()
                .map(|e| serde_json::to_value(e.kind).unwrap())
                .collect();
            json!({
                "name": name,
                "section": section.to_string(),
                "budget_words": budget,
                "draft": draft,
                "kinds": kinds,
            })
        })
        .collect()
}

fn word_count_vectors() -> Vec<Value> {
    [
        "",
        "   ",
        "one",
        "two  words",
        "tabs\tand\nnewlines count as\u{a0}spaces",
        "Sciacchetrà è un vino dolce, raro.",
        "a-b c—d e/f",
    ]
    .iter()
    .map(|t| json!({"text": t, "words": word_count(t)}))
    .collect()
}

fn fixture() -> Value {
    let heroes = aliases("M", 6);
    let links = aliases("L", 8);
    let categories = strings(&[
        "Food & Drink",
        "Hiking",
        "Culture",
        "Beaches",
        "Getting Around",
        "Seasonal",
    ]);
    let ids = section_ids(SECTIONS);
    let standup = standup();
    json!({
        "generated_by": "crates/agents/tests/bench_schemas.rs (UPDATE_GOLDEN=1 cargo test -p agents --test bench_schemas)",
        "hero_aliases": heroes,
        "link_aliases": links,
        "categories": categories,
        "section_ids": ids,
        "section_words": SECTION_WORDS,
        "moderator": {
            "id": standup.moderator.id,
            "name": standup.moderator.name,
        },
        "participants": standup
            .participants
            .iter()
            .map(|p| json!({"id": p.id, "name": p.name, "role": p.role.to_string()}))
            .collect::<Vec<_>>(),
        "schemas": {
            "outline": outline_schema(&heroes, &links, &categories),
            "section": section_schema(),
            "closing": closing_schema(),
            "review": review_schema(&ids),
            "moderator": moderator_schema(&standup),
        },
        "constants": {
            "section_min_percent": SECTION_MIN_PERCENT,
            "section_max_percent": SECTION_MAX_PERCENT,
            "min_section_words": MIN_SECTION_WORDS,
        },
        "mirrored_checks": "shape, length and plain text (URL, angle bracket) of check_section; not banned phrases, near-duplicates or markup stripping",
        "vectors": {
            "word_count": word_count_vectors(),
            "check_section": check_vectors(),
        },
    })
}

#[test]
fn the_bench_fixture_matches_the_rust_schemas() {
    let text = serde_json::to_string_pretty(&fixture()).unwrap() + "\n";
    if std::env::var_os("UPDATE_GOLDEN").is_some() {
        std::fs::write(FIXTURE, &text).unwrap();
    }
    let on_disk = std::fs::read_to_string(FIXTURE).unwrap_or_default();
    assert_eq!(
        on_disk, text,
        "apps/game/src/llm/bench/article-schemas.json is stale; run with UPDATE_GOLDEN=1 to rewrite it"
    );
}

#[test]
fn the_exported_vectors_cover_every_mirrored_kind() {
    let kinds: std::collections::BTreeSet<String> = check_vectors()
        .iter()
        .flat_map(|v| v["kinds"].as_array().unwrap().clone())
        .map(|k| k.as_str().unwrap().to_string())
        .collect();
    assert_eq!(
        kinds.into_iter().collect::<Vec<_>>(),
        vec!["not_plain_text", "shape", "too_long", "too_short"]
    );
}
