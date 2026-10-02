//! The staged article (ADR-0058, FEAT-032): stage schemas, typed results,
//! plain text, per-section checks, assembly and reading text. Pure functions;
//! no model and no I/O beyond reading the fixtures in `tests/fixtures/article`.

use agents::article::{
    assemble_page, block_sections, check_article_profile, check_closing, check_outline,
    check_section, closing_schema, closing_words, html_escape, html_unescape, intro_words,
    near_duplicate, normalize_outline_words, outline_schema, page_reading_text, reading_text,
    resolve_aliases, review_schema, sanitize_plain, section_digest, section_ids, section_schema,
    ArticleInput, ArticleParts, AssembleError, Closing, HeroOption, LinkOption, Outline,
    PlainFinding, ReviewIssue, SectionBlock, SectionBlockKind, SectionBudget, SectionDraft,
    SectionErrorKind, SectionId, SectionedReview, MIN_SECTION_WORDS, THEME_LANGUAGES,
};
use agents::pipeline::{Brief, ReviewDecision};
use agents::StyleGuide;
use claude::SchemaValidator;
use content_model::{validate_page_v2, SchemaRegistry};
use serde::Deserialize;
use serde_json::{json, Value};

const BRIEF: &str = include_str!("fixtures/article/brief.json");
const PARTS: &str = include_str!("fixtures/article/parts.json");
const SHORTLISTS: &str = include_str!("fixtures/article/shortlists.json");
const GOLDEN: &str = include_str!("fixtures/article/page.golden.json");
const STYLE_GUIDE: &str = include_str!("fixtures/style-guide.json");

const BRIEF_REF: u64 = 6_712_345_678_901_234_567;

#[derive(Deserialize)]
struct Shortlists {
    heroes: Vec<HeroOption>,
    links: Vec<LinkOption>,
}

fn brief() -> Brief {
    serde_json::from_str(BRIEF).unwrap()
}

fn parts() -> ArticleParts {
    serde_json::from_str(PARTS).unwrap()
}

fn shortlists() -> Shortlists {
    serde_json::from_str(SHORTLISTS).unwrap()
}

fn style() -> StyleGuide {
    StyleGuide::from_json_str(STYLE_GUIDE).unwrap()
}

fn assemble(parts: &ArticleParts, lists: &Shortlists) -> Result<Value, AssembleError> {
    assemble_page(&ArticleInput {
        brief: &brief(),
        brief_ref: BRIEF_REF,
        author: "Giulia Rossi",
        brand_suffix: "The Dispatch",
        languages: &THEME_LANGUAGES,
        parts,
        heroes: &lists.heroes,
        links: &lists.links,
        inline_image: true,
    })
}

fn strings(values: &[&str]) -> Vec<String> {
    values.iter().map(|s| (*s).to_string()).collect()
}

fn paragraph(text: &str) -> SectionBlock {
    SectionBlock {
        kind: SectionBlockKind::Paragraph,
        text: text.into(),
        items: vec![],
    }
}

fn draft(blocks: Vec<SectionBlock>) -> SectionDraft {
    SectionDraft { blocks }
}

fn kinds(errors: &[agents::article::SectionError]) -> Vec<SectionErrorKind> {
    errors.iter().map(|e| e.kind).collect()
}

// ---------------------------------------------------------------- schemas

/// Every schema the staged pipeline sends to the model, in each variant.
fn all_schemas() -> Vec<(&'static str, Value)> {
    let heroes = strings(&["M1", "M2", "M3"]);
    let links = strings(&["L1", "L2", "L3"]);
    let categories = strings(&["Guides", "Food & Drink", "Culture"]);
    vec![
        ("outline", outline_schema(&heroes, &links, &categories)),
        (
            "outline (no links)",
            outline_schema(&heroes, &[], &categories),
        ),
        (
            "outline (no categories)",
            outline_schema(&heroes, &links, &[]),
        ),
        (
            "outline (no heroes)",
            outline_schema(&[], &links, &categories),
        ),
        ("section", section_schema()),
        ("closing", closing_schema()),
        ("review", review_schema(&section_ids(4))),
    ]
}

/// The browser validates model output with `validateJsonSchema` in
/// `apps/game/src/llm/structured.ts`, which implements a subset of JSON
/// Schema. Its `walk` reads exactly these keywords and ignores every other:
///
/// - `type` (a name or a list of names; `integer` is accepted for `number`)
/// - `const`, `enum`
/// - `minLength`, `maxLength` (strings)
/// - `minimum`, `maximum` (numbers)
/// - `minItems`, `maxItems`, `items` (one schema for every element)
/// - `required`, `properties`, `additionalProperties: false`
///
/// A keyword outside this list (`anyOf`, `pattern`, `$ref`, `minProperties`,
/// a schema-valued `additionalProperties`, tuple `items`, …) would be enforced
/// by the Rust validator and silently skipped in the browser, so the two
/// would disagree about what the model may return.
const SUPPORTED_KEYWORDS: [&str; 13] = [
    "type",
    "const",
    "enum",
    "minLength",
    "maxLength",
    "minimum",
    "maximum",
    "minItems",
    "maxItems",
    "items",
    "required",
    "properties",
    "additionalProperties",
];

const TYPE_NAMES: [&str; 7] = [
    "object", "array", "string", "number", "integer", "boolean", "null",
];

fn unsupported(schema: &Value, path: &str, out: &mut Vec<String>) {
    let Some(object) = schema.as_object() else {
        out.push(format!("{path}: a schema must be an object"));
        return;
    };
    for (key, value) in object {
        let here = format!("{path}/{key}");
        if !SUPPORTED_KEYWORDS.contains(&key.as_str()) {
            out.push(format!(
                "{here}: keyword not supported by the subset validator"
            ));
            continue;
        }
        match key.as_str() {
            "type" => {
                let names: Vec<&str> = match value {
                    Value::String(s) => vec![s.as_str()],
                    Value::Array(a) => a.iter().filter_map(Value::as_str).collect(),
                    _ => vec![],
                };
                if names.is_empty() || names.iter().any(|n| !TYPE_NAMES.contains(n)) {
                    out.push(format!("{here}: not a type name or a list of type names"));
                }
            }
            "additionalProperties" if value != &json!(false) => {
                out.push(format!("{here}: only `false` is supported"));
            }
            "items" => {
                if value.is_object() {
                    unsupported(value, &here, out);
                } else {
                    out.push(format!("{here}: only a single item schema is supported"));
                }
            }
            "properties" => match value.as_object() {
                Some(properties) => {
                    for (name, sub) in properties {
                        unsupported(sub, &format!("{here}/{name}"), out);
                    }
                }
                None => out.push(format!("{here}: must be an object")),
            },
            "required" | "enum" if !value.is_array() => {
                out.push(format!("{here}: must be an array"));
            }
            "minLength" | "maxLength" | "minItems" | "maxItems" | "minimum" | "maximum"
                if !value.is_number() =>
            {
                out.push(format!("{here}: must be a number"));
            }
            _ => {}
        }
    }
}

#[test]
fn schemas_use_only_keywords_the_browser_subset_validator_supports() {
    for (name, schema) in all_schemas() {
        let mut problems = Vec::new();
        unsupported(&schema, "", &mut problems);
        assert!(problems.is_empty(), "{name}: {problems:#?}");
        // Every object level is closed, so an invented field is an error in
        // both validators.
        fn closed(schema: &Value, path: &str) {
            if schema["type"] == "object" {
                assert_eq!(schema["additionalProperties"], json!(false), "{path}");
                for (k, sub) in schema["properties"].as_object().unwrap() {
                    closed(sub, &format!("{path}/{k}"));
                }
            }
            if schema["type"] == "array" {
                closed(&schema["items"], &format!("{path}/items"));
            }
        }
        closed(&schema, name);
    }
}

#[test]
fn the_subset_walker_itself_catches_unsupported_keywords() {
    for bad in [
        json!({"anyOf": [{"type": "string"}]}),
        json!({"type": "string", "pattern": "^a"}),
        json!({"type": "object", "additionalProperties": {"type": "string"}}),
        json!({"type": "object", "properties": {"a": {"$ref": "#/x"}}}),
        json!({"type": "array", "items": [{"type": "string"}]}),
        json!({"type": "array", "items": {"type": "object", "minProperties": 1}}),
        json!({"type": "text"}),
    ] {
        let mut problems = Vec::new();
        unsupported(&bad, "", &mut problems);
        assert_eq!(problems.len(), 1, "{bad}: {problems:?}");
    }
}

fn validator(schema: &Value) -> SchemaValidator {
    SchemaValidator::new(schema).expect("schema compiles")
}

fn with(mut value: Value, pointer: &str, replacement: Value) -> Value {
    *value.pointer_mut(pointer).expect("pointer exists") = replacement;
    value
}

fn without(mut value: Value, key: &str) -> Value {
    value.as_object_mut().unwrap().remove(key);
    value
}

#[test]
fn outline_schema_accepts_the_fixture_and_rejects_the_obvious_mistakes() {
    let schema = outline_schema(
        &strings(&["M1", "M2", "M3"]),
        &strings(&["L1", "L2", "L3"]),
        &strings(&["Guides", "Food & Drink", "Culture"]),
    );
    let v = validator(&schema);
    let good = serde_json::to_value(parts().outline).unwrap();
    v.validate(&good).unwrap();
    v.validate(&with(good.clone(), "/links", json!([])))
        .unwrap();

    let section = good["sections"][0].clone();
    let bad = [
        (
            "unknown hero alias",
            with(good.clone(), "/hero", json!("M9")),
        ),
        (
            "a URL as hero",
            with(good.clone(), "/hero", json!("https://x.test/a.jpg")),
        ),
        (
            "unknown link alias",
            with(good.clone(), "/links", json!(["L9"])),
        ),
        (
            "a route as link",
            with(good.clone(), "/links", json!(["/en/manarola"])),
        ),
        (
            "three links",
            with(good.clone(), "/links", json!(["L1", "L2", "L3"])),
        ),
        (
            "unknown category",
            with(good.clone(), "/category", json!("Gossip")),
        ),
        (
            "two sections",
            with(good.clone(), "/sections", json!([section, section])),
        ),
        (
            "seven sections",
            with(
                good.clone(),
                "/sections",
                json!([section, section, section, section, section, section, section]),
            ),
        ),
        (
            "a 50-word section",
            with(good.clone(), "/sections/0/words", json!(50)),
        ),
        (
            "a 900-word section",
            with(good.clone(), "/sections/0/words", json!(900)),
        ),
        (
            "fractional words",
            with(good.clone(), "/sections/0/words", json!(120.5)),
        ),
        (
            "one point",
            with(good.clone(), "/sections/0/points", json!(["only one"])),
        ),
        (
            "a short title",
            with(good.clone(), "/title", json!("Harvest")),
        ),
        (
            "a title over 70 characters",
            with(good.clone(), "/title", json!("x".repeat(71))),
        ),
        (
            "a short dek",
            with(good.clone(), "/dek", json!("Too short.")),
        ),
        ("no closing title", without(good.clone(), "closing_title")),
        (
            "an invented field",
            with(good.clone(), "", {
                let mut g = good.clone();
                g["seo"] = json!({"title": "x"});
                g
            }),
        ),
        (
            "a body in a section",
            with(good.clone(), "/sections/0", {
                let mut s = section.clone();
                s["body"] = json!("text");
                s
            }),
        ),
    ];
    for (what, value) in bad {
        assert!(v.validate(&value).is_err(), "accepted {what}");
    }

    // Without links to offer, `links` must be empty; without heroes nothing validates.
    let no_links = validator(&outline_schema(
        &strings(&["M2"]),
        &[],
        &strings(&["Food & Drink"]),
    ));
    assert!(no_links.validate(&good).is_err());
    no_links
        .validate(&with(good.clone(), "/links", json!([])))
        .unwrap();
    let no_heroes = validator(&outline_schema(&[], &strings(&["L1", "L3"]), &[]));
    assert!(no_heroes.validate(&good).is_err());
    assert!(no_heroes
        .validate(&with(good.clone(), "/hero", json!("")))
        .is_err());
    // Without a category list the field is free text.
    let free = validator(&outline_schema(
        &strings(&["M2"]),
        &strings(&["L1", "L3"]),
        &[],
    ));
    free.validate(&with(good, "/category", json!("Anything")))
        .unwrap();
}

#[test]
fn section_and_closing_schemas_accept_good_values_and_reject_bad_ones() {
    let v = validator(&section_schema());
    for section in std::iter::once(&parts().intro).chain(&parts().sections) {
        v.validate(&serde_json::to_value(section).unwrap()).unwrap();
    }
    let block = json!({"type": "paragraph", "text": "Some text.", "items": []});
    let bad = [
        ("no blocks", json!({"blocks": []})),
        (
            "seven blocks",
            json!({"blocks": [block, block, block, block, block, block, block]}),
        ),
        (
            "a heading block",
            json!({"blocks": [{"type": "heading", "text": "x", "items": []}]}),
        ),
        (
            "a quote block",
            json!({"blocks": [{"type": "quote", "text": "x", "items": []}]}),
        ),
        (
            "missing items",
            json!({"blocks": [{"type": "paragraph", "text": "x"}]}),
        ),
        (
            "missing text",
            json!({"blocks": [{"type": "list", "items": ["a"]}]}),
        ),
        (
            "eight items",
            json!({"blocks": [{"type": "list", "text": "", "items": ["a", "b", "c", "d", "e", "f", "g", "h"]}]}),
        ),
        (
            "an empty item",
            json!({"blocks": [{"type": "list", "text": "", "items": [""]}]}),
        ),
        (
            "page-style markdown",
            json!({"blocks": [{"type": "paragraph", "markdown": "x", "items": []}]}),
        ),
        (
            "an href",
            json!({"blocks": [{"type": "paragraph", "text": "x", "items": [], "href": "/en"}]}),
        ),
        (
            "a heading field",
            json!({"heading": "x", "blocks": [block]}),
        ),
        ("a bare array", json!([block])),
    ];
    for (what, value) in bad {
        assert!(v.validate(&value).is_err(), "section accepted {what}");
    }

    let v = validator(&closing_schema());
    v.validate(&serde_json::to_value(parts().closing).unwrap())
        .unwrap();
    for (what, value) in [
        ("a short closing", json!({"content": "Bye."})),
        (
            "a closing over 1,200 characters",
            json!({"content": "x".repeat(1201)}),
        ),
        ("actions", json!({"content": "x".repeat(60), "actions": []})),
        ("a title", json!({"content": "x".repeat(60), "title": "t"})),
        ("no content", json!({})),
    ] {
        assert!(v.validate(&value).is_err(), "closing accepted {what}");
    }
}

#[test]
fn review_schema_tags_issues_by_section() {
    let schema = review_schema(&section_ids(3));
    assert_eq!(
        schema["properties"]["issues"]["items"]["properties"]["section"]["enum"],
        json!(["title", "intro", "s1", "s2", "s3", "closing", "whole"])
    );
    let v = validator(&schema);
    let good = json!({
        "decision": "needs_changes", "score": 6, "notes": "Close, but the middle drags.",
        "issues": [
            {"section": "s2", "problem": "The list repeats the paragraph.", "fix": "Cut the first item."},
            {"section": "title", "problem": "Too long.", "fix": ""}
        ],
        "high_risk": []
    });
    v.validate(&good).unwrap();
    let review: SectionedReview = serde_json::from_value(good.clone()).unwrap();
    assert_eq!(review.decision, ReviewDecision::NeedsChanges);
    assert_eq!(review.issues[0].section, SectionId::Section(2));
    assert_eq!(serde_json::to_value(&review).unwrap(), good);

    let issue = |section: &str| json!({"section": section, "problem": "p", "fix": "f"});
    let nine: Vec<Value> = (0..9).map(|_| issue("s1")).collect();
    let bad = [
        (
            "a section the article lacks",
            with(good.clone(), "/issues", json!([issue("s4")])),
        ),
        (
            "an invented target",
            with(good.clone(), "/issues", json!([issue("hero")])),
        ),
        (
            "an untagged issue",
            with(good.clone(), "/issues", json!(["The middle drags."])),
        ),
        (
            "an issue without a fix",
            with(
                good.clone(),
                "/issues",
                json!([{"section": "s1", "problem": "p"}]),
            ),
        ),
        (
            "an empty problem",
            with(
                good.clone(),
                "/issues",
                json!([{"section": "s1", "problem": "", "fix": "f"}]),
            ),
        ),
        (
            "nine issues",
            with(good.clone(), "/issues", Value::Array(nine)),
        ),
        ("score 11", with(good.clone(), "/score", json!(11))),
        ("score 0", with(good.clone(), "/score", json!(0))),
        (
            "an unknown decision",
            with(good.clone(), "/decision", json!("publish")),
        ),
        ("no high_risk", without(good.clone(), "high_risk")),
    ];
    for (what, value) in bad {
        assert!(v.validate(&value).is_err(), "review accepted {what}");
    }
}

#[test]
fn typed_results_round_trip_and_refuse_unknown_fields() {
    let parts = parts();
    let again: ArticleParts =
        serde_json::from_value(serde_json::to_value(&parts).unwrap()).unwrap();
    assert_eq!(again, parts);
    assert_eq!(parts.outline.section_ids(), vec!["s1", "s2", "s3"]);
    assert_eq!(parts.section(SectionId::Intro), Some(&parts.intro));
    assert_eq!(
        parts.section(SectionId::Section(3)),
        Some(&parts.sections[2])
    );
    assert_eq!(parts.section(SectionId::Section(4)), None);
    assert_eq!(parts.section(SectionId::Closing), None);

    assert!(serde_json::from_value::<SectionDraft>(
        json!({"blocks": [{"type": "paragraph", "text": "x", "items": [], "href": "/"}]})
    )
    .is_err());
    assert!(serde_json::from_value::<Closing>(json!({"content": "x", "actions": []})).is_err());
    assert!(serde_json::from_value::<ReviewIssue>(
        json!({"section": "s0", "problem": "p", "fix": "f"})
    )
    .is_err());
    let mut outline = serde_json::to_value(&parts.outline).unwrap();
    outline["seo"] = json!({});
    assert!(serde_json::from_value::<Outline>(outline).is_err());
}

#[test]
fn reviews_name_what_a_revision_rewrites() {
    let review = |sections: &[&str]| SectionedReview {
        decision: ReviewDecision::NeedsChanges,
        score: 6,
        notes: "n".into(),
        issues: sections
            .iter()
            .map(|s| ReviewIssue {
                section: s.parse().unwrap(),
                problem: "Drags.".into(),
                fix: "Cut it.".into(),
            })
            .collect(),
        high_risk: vec![],
    };
    use SectionId::{Closing as C, Intro, Section, Title};
    assert_eq!(
        review(&["s2", "title", "s2"]).revision_targets(3),
        vec![Title, Section(2)]
    );
    assert_eq!(review(&["s9", "closing"]).revision_targets(3), vec![C]);
    assert_eq!(
        review(&["whole", "s1"]).revision_targets(2),
        vec![Intro, Section(1), Section(2), C]
    );
    assert!(review(&[]).revision_targets(3).is_empty());

    let flat = review(&["s2"]).to_editor_review();
    assert_eq!(flat.issues, vec!["s2: Drags. Fix: Cut it."]);
    assert_eq!(flat.score, 6);
}

// ---------------------------------------------------------------- word budgets

#[test]
fn outline_words_are_rescaled_to_the_target_deterministically() {
    let outline = parts().outline;
    assert_eq!(
        outline.sections.iter().map(|s| s.words).collect::<Vec<_>>(),
        vec![120, 150, 100]
    );
    let words = |target: u32| -> Vec<u32> {
        normalize_outline_words(&outline, target)
            .sections
            .iter()
            .map(|s| s.words)
            .collect()
    };
    // 400 − intro 60 − closing 40 = 300, shared 120 : 150 : 100.
    assert_eq!((intro_words(400), closing_words(400)), (60, 40));
    assert_eq!(words(400), vec![97, 122, 81]);
    // 1,200 − 150 − 100 = 950.
    assert_eq!((intro_words(1200), closing_words(1200)), (150, 100));
    assert_eq!(words(1200), vec![308, 385, 257]);
    for target in [400, 600, 900, 1200, 1500] {
        let w = words(target);
        assert_eq!(
            w.iter().sum::<u32>(),
            target - intro_words(target) - closing_words(target),
            "target {target}"
        );
        assert!(w[1] > w[0] && w[0] > w[2], "proportions kept: {w:?}");
        // Same input, same output; and a normalised outline is a fixed point.
        let once = normalize_outline_words(&outline, target);
        assert_eq!(once, normalize_outline_words(&outline, target));
        assert_eq!(once, normalize_outline_words(&once, target));
    }
    // Only the budgets change.
    let mut normalised = normalize_outline_words(&outline, 900);
    for (n, o) in normalised.sections.iter_mut().zip(&outline.sections) {
        n.words = o.words;
    }
    assert_eq!(normalised, outline);
}

#[test]
fn no_section_is_budgeted_below_the_floor() {
    let mut outline = parts().outline;
    outline.sections[0].words = 350;
    outline.sections[1].words = 100;
    outline.sections[2].words = 100;
    // 500 − 62 − 41 = 397: shares 253 / 72 / 72 are all above the floor.
    let w: Vec<u32> = normalize_outline_words(&outline, 500)
        .sections
        .iter()
        .map(|s| s.words)
        .collect();
    assert_eq!(w.iter().sum::<u32>(), 397);
    assert!(w.iter().all(|w| *w >= MIN_SECTION_WORDS), "{w:?}");

    // 300 − 60 − 40 = 200: the small sections are pinned to 60, the big one
    // takes the rest.
    let tight = normalize_outline_words(&outline, 300);
    let w: Vec<u32> = tight.sections.iter().map(|s| s.words).collect();
    assert_eq!(w, vec![80, 60, 60]);
    assert_eq!(tight, normalize_outline_words(&tight, 300));

    // A target too small for the outline still gives every section the floor.
    let w: Vec<u32> = normalize_outline_words(&outline, 100)
        .sections
        .iter()
        .map(|s| s.words)
        .collect();
    assert_eq!(w, vec![60, 60, 60]);

    // Zero weights are treated as equal.
    outline.sections.iter_mut().for_each(|s| s.words = 0);
    let w: Vec<u32> = normalize_outline_words(&outline, 400)
        .sections
        .iter()
        .map(|s| s.words)
        .collect();
    assert_eq!(w, vec![100, 100, 100]);
}

// ---------------------------------------------------------------- plain text

#[test]
fn sanitize_plain_strips_markup_deterministically() {
    let cases = [
        ("Plain text stays as it is.", "Plain text stays as it is."),
        (
            "The **trenino** is _small_ and ***loud***.",
            "The trenino is small and loud.",
        ),
        (
            "Use `code` and ~~struck~~ words.",
            "Use code and struck words.",
        ),
        (
            "See [the hikes page](/en/hikes) first.",
            "See the hikes page first.",
        ),
        (
            "![A vineyard](https://img.test/a.jpg) above",
            "A vineyard above",
        ),
        ("## A heading\n\nThen text.", "A heading Then text."),
        ("- one\n- two\n* three", "one two three"),
        ("> quoted line", "quoted line"),
        ("  spaced \n\n out\ttext  ", "spaced out text"),
        ("*- nested marker*", "nested marker"),
        ("[[deep](/a)](/b)", "deep"),
    ];
    for (raw, expected) in cases {
        let (clean, findings) = sanitize_plain(raw);
        assert_eq!(clean, expected, "{raw:?}");
        assert!(
            findings.iter().all(|f| !f.is_error()),
            "{raw:?}: {findings:?}"
        );
        // Idempotent: clean text has nothing left to strip.
        assert_eq!(sanitize_plain(&clean), (clean.clone(), vec![]), "{raw:?}");
    }
    assert_eq!(sanitize_plain("Plain."), ("Plain.".to_string(), vec![]));
    assert_eq!(
        sanitize_plain("The **trenino**.").1,
        vec![PlainFinding::StrippedMarkup]
    );
    assert_eq!(
        sanitize_plain("See [the *hikes* page](/en/hikes).").1,
        vec![
            PlainFinding::StrippedMarkup,
            PlainFinding::StrippedLink {
                url: "/en/hikes".into()
            }
        ]
    );
}

#[test]
fn sanitize_plain_keeps_ordinary_characters() {
    for text in [
        "3 * 4 is 12",
        "the snake_case_name",
        "about ~5 km",
        "Sciacchetrà costs 30–40 € a bottle (really).",
        "a [sic] remark",
        "he said \"no\" & left",
        "50% off — today",
    ] {
        assert_eq!(sanitize_plain(text), (text.to_string(), vec![]), "{text:?}");
    }
}

#[test]
fn urls_and_angle_brackets_are_errors() {
    let (clean, findings) = sanitize_plain("Book at https://example.com/book, or www.example.org.");
    assert_eq!(
        clean,
        "Book at https://example.com/book, or www.example.org."
    );
    assert_eq!(
        findings,
        vec![
            PlainFinding::Url {
                url: "https://example.com/book".into()
            },
            PlainFinding::Url {
                url: "www.example.org".into()
            },
        ]
    );
    assert!(findings.iter().all(PlainFinding::is_error));

    for raw in [
        "Use <b>bold</b> here.",
        "a < b",
        "2 > 1",
        "<script>alert(1)</script>",
    ] {
        let (clean, findings) = sanitize_plain(raw);
        assert_eq!(clean, raw, "left for the model to fix");
        assert_eq!(findings, vec![PlainFinding::AngleBracket], "{raw:?}");
    }
    // A link whose text is itself a URL is still an error after stripping.
    let (clean, findings) = sanitize_plain("[http://a.test](http://a.test)");
    assert_eq!(clean, "http://a.test");
    assert!(findings.iter().any(PlainFinding::is_error));
}

#[test]
fn html_escape_covers_the_two_set_html_fields() {
    assert_eq!(
        html_escape("Wine & <b>bread</b>"),
        "Wine &amp; &lt;b&gt;bread&lt;/b&gt;"
    );
    assert_eq!(
        html_escape("Sciacchetrà \"dolce\""),
        "Sciacchetrà \"dolce\""
    );
    assert_eq!(
        html_escape("already &amp; escaped"),
        "already &amp;amp; escaped"
    );
    for text in ["Wine & <b>bread</b>", "a &lt; b", "&amp;amp;", "plain", ""] {
        assert_eq!(html_unescape(&html_escape(text)), text);
        assert!(!html_escape(text).contains(['<', '>']));
    }
}

// ---------------------------------------------------------------- section checks

fn budget(section: SectionId, words: u32, earlier: &[String]) -> SectionBudget<'_> {
    SectionBudget {
        section,
        words,
        earlier,
    }
}

fn words(n: usize) -> String {
    // Distinct words, so no accidental near-duplicate.
    (0..n)
        .map(|i| format!("w{i}"))
        .collect::<Vec<_>>()
        .join(" ")
}

#[test]
fn the_fixture_sections_pass_every_check() {
    let parts = parts();
    let style = style();
    let target = brief().target_words;
    let outline = normalize_outline_words(&parts.outline, target);
    assert!(check_outline(&outline, &style).is_empty());
    assert!(check_closing(&parts.closing, &style).is_empty());

    let mut earlier: Vec<String> = Vec::new();
    let intro = budget(SectionId::Intro, intro_words(target), &[]);
    assert_eq!(check_section(&parts.intro, &intro, &style), vec![]);
    earlier.extend(parts.intro.paragraphs());
    for (i, section) in parts.sections.iter().enumerate() {
        let id = SectionId::Section(i as u8 + 1);
        let errors = check_section(
            section,
            &budget(id, outline.sections[i].words, &earlier),
            &style,
        );
        assert_eq!(errors, vec![], "{id}");
        earlier.extend(section.paragraphs());
    }
    // 49 intro + 71 + 91 + 60 + 43 closing, against a target of 400.
    assert_eq!(parts.words(), 314);
}

#[test]
fn check_section_reports_shape_errors() {
    let style = style();
    let s1 = SectionId::Section(1);
    let block = |kind, text: &str, items: &[&str]| SectionBlock {
        kind,
        text: text.into(),
        items: strings(items),
    };
    use SectionBlockKind::{List, Paragraph, Tip};

    let errors = check_section(&draft(vec![]), &budget(s1, 0, &[]), &style);
    assert_eq!(kinds(&errors), vec![SectionErrorKind::Shape]);
    assert_eq!(
        errors[0].to_string(),
        "s1: has no blocks; write at least one paragraph"
    );

    let cases = [
        (
            block(List, "", &[]),
            "block 1 (list) needs at least one item",
        ),
        (
            block(List, "Three things to bring", &["water"]),
            "block 1 (list) must leave \"text\" empty; put the words in \"items\"",
        ),
        (block(Paragraph, "", &[]), "block 1 (paragraph) needs text"),
        (
            block(Paragraph, "**", &[]),
            "block 1 (paragraph) needs text",
        ),
        (
            block(Paragraph, "Bring these.", &["water"]),
            "block 1 (paragraph) must leave \"items\" empty; use a list block for items",
        ),
        (block(Tip, " ", &[]), "block 1 (tip) needs text"),
    ];
    for (b, message) in cases {
        let errors = check_section(&draft(vec![b]), &budget(s1, 0, &[]), &style);
        assert_eq!(errors.len(), 1, "{errors:?}");
        assert_eq!(errors[0].kind, SectionErrorKind::Shape);
        assert_eq!(errors[0].section, s1);
        assert_eq!(errors[0].message, message);
    }

    // The intro is paragraphs only.
    let intro = draft(vec![
        paragraph("A first paragraph."),
        block(List, "", &["an item"]),
        block(Tip, "A tip.", &[]),
    ]);
    let errors = check_section(&intro, &budget(SectionId::Intro, 0, &[]), &style);
    assert_eq!(
        errors.iter().map(ToString::to_string).collect::<Vec<_>>(),
        vec![
            "intro: block 2 (list) is not allowed in the intro; write paragraphs only",
            "intro: block 3 (tip) is not allowed in the intro; write paragraphs only",
        ]
    );
    // The same blocks are fine in a body section.
    assert_eq!(check_section(&intro, &budget(s1, 0, &[]), &style), vec![]);
}

#[test]
fn check_section_reports_banned_phrases_from_the_house_style() {
    let style = style();
    assert!(style.banned_phrases().contains(&"hidden gem".to_string()));
    let section = draft(vec![
        paragraph("Volastra is a hidden gem above the vines."),
        SectionBlock {
            kind: SectionBlockKind::List,
            text: String::new(),
            items: strings(&["A must-see terrace", "A quiet bench"]),
        },
    ]);
    let s2 = SectionId::Section(2);
    let errors = check_section(&section, &budget(s2, 0, &[]), &style);
    assert_eq!(
        kinds(&errors),
        vec![
            SectionErrorKind::BannedPhrase,
            SectionErrorKind::BannedPhrase
        ]
    );
    assert!(errors.iter().all(|e| e.section == s2));
    assert_eq!(
        errors[0].message,
        "block 1 (paragraph) uses the banned phrase \"hidden gem\" (house style); say \"lesser-known favorite\" or rephrase"
    );
    assert!(errors[1]
        .message
        .starts_with("block 2 (list) uses the banned phrase \"must-see\""));
    // Emphasis markers do not hide a banned phrase.
    let hidden = draft(vec![paragraph("A **hidden** *gem* indeed.")]);
    assert_eq!(
        kinds(&check_section(&hidden, &budget(s2, 0, &[]), &style)),
        vec![SectionErrorKind::BannedPhrase]
    );
    // Whole words only.
    let fine = draft(vec![paragraph(
        "The gems are hidden gemstones, iconically.",
    )]);
    assert_eq!(check_section(&fine, &budget(s2, 0, &[]), &style), vec![]);
}

#[test]
fn check_section_requires_plain_text() {
    let style = style();
    let s3 = SectionId::Section(3);
    let section = draft(vec![
        paragraph("Book at https://example.com/tickets before you go."),
        paragraph("Tickets are <strong>cheap</strong>."),
        paragraph("See [the timetable](https://example.com/t) and the **ferry** desk."),
    ]);
    let errors = check_section(&section, &budget(s3, 0, &[]), &style);
    assert_eq!(
        kinds(&errors),
        vec![
            SectionErrorKind::NotPlainText,
            SectionErrorKind::NotPlainText
        ],
        "the Markdown link and the emphasis in block 3 are stripped, not errors"
    );
    assert_eq!(
        errors[0].to_string(),
        "s3: block 1 (paragraph) contains the URL https://example.com/tickets; write plain text without links or addresses"
    );
    assert!(errors[1]
        .message
        .starts_with("block 2 (paragraph) contains < or >"));
    assert_eq!(
        section.sanitized().blocks[2].text,
        "See the timetable and the ferry desk."
    );
}

#[test]
fn check_section_holds_a_section_to_60_to_140_percent_of_its_budget() {
    let style = style();
    let s1 = SectionId::Section(1);
    let check = |n: usize| {
        check_section(
            &draft(vec![paragraph(&words(n))]),
            &budget(s1, 100, &[]),
            &style,
        )
    };
    assert_eq!(kinds(&check(59)), vec![SectionErrorKind::TooShort]);
    assert_eq!(check(60), vec![]);
    assert_eq!(check(100), vec![]);
    assert_eq!(check(140), vec![]);
    assert_eq!(kinds(&check(141)), vec![SectionErrorKind::TooLong]);
    assert_eq!(
        check(59)[0].to_string(),
        "s1: has 59 words; about 100 were asked for (60 to 140 is accepted)"
    );
    // List items count; a budget of 0 skips the check.
    let listed = draft(vec![
        paragraph(&words(40)),
        SectionBlock {
            kind: SectionBlockKind::List,
            text: String::new(),
            items: vec![words(10), words(10)],
        },
    ]);
    assert_eq!(listed.words(), 60);
    assert_eq!(
        check_section(&listed, &budget(s1, 100, &[]), &style),
        vec![]
    );
    assert_eq!(
        check_section(
            &draft(vec![paragraph("Short.")]),
            &budget(s1, 0, &[]),
            &style
        ),
        vec![]
    );
}

#[test]
fn check_section_catches_a_paragraph_repeated_from_an_earlier_section() {
    let style = style();
    let first = "The vineyards sit on dry stone terraces that climb from the village to the ridge above the sea.";
    let again = "The vineyards sit on dry stone terraces which climb from the village to the ridge above the sea!";
    let other =
        "Several cellars in Manarola pour the wine by the glass with a plate of dry biscuits.";
    assert!(near_duplicate(first, again));
    assert!(!near_duplicate(first, other));
    assert!(
        !near_duplicate("Too short.", "Too short."),
        "short lines are not paragraphs"
    );

    let earlier = vec![first.to_string()];
    let s2 = SectionId::Section(2);
    let errors = check_section(
        &draft(vec![paragraph(other), paragraph(again)]),
        &budget(s2, 0, &earlier),
        &style,
    );
    assert_eq!(kinds(&errors), vec![SectionErrorKind::NearDuplicate]);
    assert_eq!(errors[0].section, s2);
    assert!(errors[0].message.starts_with(
        "block 2 (paragraph) repeats an earlier paragraph (\"The vineyards sit on dry stone"
    ));
    // Also within one section.
    let errors = check_section(
        &draft(vec![paragraph(first), paragraph(again)]),
        &budget(s2, 0, &[]),
        &style,
    );
    assert_eq!(kinds(&errors), vec![SectionErrorKind::NearDuplicate]);
    // And not when nothing repeats.
    assert_eq!(
        check_section(
            &draft(vec![paragraph(other)]),
            &budget(s2, 0, &earlier),
            &style
        ),
        vec![]
    );
}

#[test]
fn outline_and_closing_text_is_checked_too() {
    let style = style();
    let mut outline = parts().outline;
    outline.title = "A Stunning Week in Manarola".into();
    outline.sections[1].heading = "Visit https://example.com".into();
    outline.closing_title = "The <best> bit".into();
    let errors = check_outline(&outline, &style);
    assert_eq!(
        errors
            .iter()
            .map(|e| (e.section, e.kind))
            .collect::<Vec<_>>(),
        vec![
            (SectionId::Title, SectionErrorKind::BannedPhrase),
            (SectionId::Section(2), SectionErrorKind::NotPlainText),
            (SectionId::Closing, SectionErrorKind::NotPlainText),
        ]
    );
    let errors = check_closing(
        &Closing {
            content: "A breathtaking end, see www.example.org".into(),
        },
        &style,
    );
    assert_eq!(
        kinds(&errors),
        vec![
            SectionErrorKind::NotPlainText,
            SectionErrorKind::BannedPhrase
        ]
    );
    assert_eq!(
        kinds(&check_closing(
            &Closing {
                content: " ** ".into()
            },
            &style
        )),
        vec![SectionErrorKind::Shape]
    );
}

// ---------------------------------------------------------------- assembly

#[test]
fn the_assembled_fixture_matches_the_golden_page() {
    let page = assemble(&parts(), &shortlists()).unwrap();
    if std::env::var_os("UPDATE_GOLDEN").is_some() {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tests/fixtures/article/page.golden.json"
        );
        std::fs::write(path, serde_json::to_string_pretty(&page).unwrap() + "\n").unwrap();
    }
    let golden: Value = serde_json::from_str(GOLDEN).unwrap();
    assert_eq!(
        page, golden,
        "run with UPDATE_GOLDEN=1 to rewrite the fixture"
    );
    // Byte-stable too: the same input serialises to the same text.
    assert_eq!(serde_json::to_string_pretty(&page).unwrap() + "\n", GOLDEN);
    assert_eq!(page, assemble(&parts(), &shortlists()).unwrap());
}

#[test]
fn the_assembled_page_has_the_shape_the_frozen_theme_renders() {
    let page = assemble(&parts(), &shortlists()).unwrap();
    let body = page["body"].as_array().unwrap();
    let types: Vec<&str> = body.iter().map(|b| b["type"].as_str().unwrap()).collect();
    assert_eq!(
        types,
        vec![
            "editorial-hero",
            "paragraph",
            "paragraph",
            "heading",
            "paragraph",
            "paragraph",
            "heading",
            "paragraph",
            "list",
            "callout",
            "image",
            "heading",
            "paragraph",
            "paragraph",
            "closing-note",
        ]
    );

    // Hero: the only <h1> source; its title goes through set:html, so it is escaped.
    assert_eq!(
        body[0],
        json!({
            "type": "editorial-hero",
            "title": "Crates, Ladders &amp; Sweet Wine: Harvest Week in Manarola",
            "subtitle": "What the Sciacchetrà harvest looks like from the path above the village, and how to watch it without getting in the way.",
            "badge": "Food & Drink",
            "image": "https://images.unsplash.com/photo-1499678329028-101435549a4e?q=80&w=2000&auto=format&fit=crop",
            "height": "70vh"
        })
    );
    // Sections: a level-2 heading, then the flat blocks mapped to core blocks.
    assert_eq!(
        body[3],
        json!({"type": "heading", "level": 2, "text": "Where the vines grow"})
    );
    assert_eq!(
        body[5]["markdown"],
        "A small monorail, the trenino, now does some of the lifting. It runs on a single rail up the slope and saves the growers hours of carrying on the steepest plots.",
        "emphasis markers never reach the page: the theme prints `markdown` literally"
    );
    assert_eq!(body[8]["ordered"], json!(false));
    assert_eq!(body[8]["items"].as_array().unwrap().len(), 3);
    assert_eq!(body[9]["style"], "info");
    assert!(body[9]["content"]
        .as_str()
        .unwrap()
        .starts_with("The path has little shade"));
    // One image, after the middle section: the next-ranked shortlist image.
    assert_eq!(
        body[10],
        json!({
            "type": "image",
            "src": "https://images.unsplash.com/photo-1516483638261-f4dbaf036963?q=80&w=1200&auto=format&fit=crop",
            "alt": "Manarola seen from the sea at dusk",
            "caption": "Photo by Luca Bravo on Unsplash"
        })
    );
    // Closing: content goes through set:html; actions are the chosen links.
    let closing = &body[14];
    assert_eq!(closing["badge"], "Practical Notes");
    assert_eq!(closing["title"], "Before you go");
    assert!(closing["content"]
        .as_str()
        .unwrap()
        .contains("all day &amp; evening"));
    assert_eq!(
        closing["actions"],
        json!([
            {"label": "Manarola", "href": "/en/manarola", "variant": "primary"},
            {"label": "Hiking from Manarola", "href": "/en/manarola/hiking", "variant": "secondary"}
        ])
    );

    // Envelope.
    assert_eq!(page["id"], "content-5d2c8e1f0a7b3c49");
    assert_eq!(
        page["slug"],
        json!({
            "en": "/en/blog/harvest-week-in-manarola",
            "de": "/de/blog/harvest-week-in-manarola",
            "fr": "/fr/blog/harvest-week-in-manarola",
            "it": "/it/blog/harvest-week-in-manarola"
        })
    );
    assert_eq!(
        page["title"],
        json!({"en": "Crates, Ladders & Sweet Wine: Harvest Week in Manarola"})
    );
    assert_eq!(page["page_type"], "blog-article");
    assert_eq!(
        page["seo"],
        json!({
            "title": {"en": "Crates, Ladders & Sweet Wine: Harvest Week in Manarola | The Dispatch"},
            "description": {"en": "What the Sciacchetrà harvest looks like from the path above the village, and how to watch it without getting in the way."},
            "keywords": ["Manarola", "Sciacchetrà", "wine harvest", "vineyards"]
        })
    );
    assert_eq!(
        page["metadata"],
        json!({
            "author": "Giulia Rossi",
            "category": "Food & Drink",
            "hero_media_id": "manarola-sights-014",
            "inline_media_id": "manarola-sights-001",
            "brief_ref": "6712345678901234567"
        })
    );
    assert_eq!(page["status"], "in_review");
    let keys: Vec<&str> = page
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    assert_eq!(
        keys,
        vec![
            "body",
            "id",
            "metadata",
            "page_type",
            "seo",
            "slug",
            "status",
            "title"
        ]
    );
}

/// Block types of the frozen theme that render an `<h1>`.
const H1_BLOCKS: [&str; 6] = [
    "editorial-hero",
    "hero",
    "hero-section",
    "itinerary-hero",
    "blog-article",
    "blog-index",
];

#[test]
fn the_assembled_page_passes_schema_v2_and_the_article_profile() {
    let page = assemble(&parts(), &shortlists()).unwrap();
    let registry = SchemaRegistry::core();
    let report = validate_page_v2(&page, &registry);
    assert!(report.is_ok(), "{:#?}", report.errors);
    // v1 insists on plain-string `seo` fields; the theme reads the localized object.
    assert!(content_model::validate_page_v1(&page).is_err());

    assert_eq!(check_article_profile(&page), vec![]);
    let body = page["body"].as_array().unwrap();
    let h1_sources = body
        .iter()
        .filter(|b| H1_BLOCKS.contains(&b["type"].as_str().unwrap()))
        .count();
    assert_eq!(h1_sources, 1, "exactly one <h1> source");
    assert_eq!(body.first().unwrap()["type"], "editorial-hero");
    assert_eq!(body.last().unwrap()["type"], "closing-note");

    // The model's flat block names never reach the page.
    let text = page.to_string();
    for leaked in ["\"tip\"", "\"blocks\"", "\"M2\"", "\"L1\"", "**"] {
        assert!(!text.contains(leaked), "{leaked} leaked into the page");
    }
}

#[test]
fn the_page_round_trips_through_reading_text() {
    let parts = parts();
    let page = assemble(&parts, &shortlists()).unwrap();
    let text = reading_text(&parts);
    assert_eq!(
        page_reading_text(&page),
        text,
        "the editor reads what the page says"
    );
    assert_eq!(
        text,
        "\
[title] Crates, Ladders & Sweet Wine: Harvest Week in Manarola
[dek] What the Sciacchetrà harvest looks like from the path above the village, and how to watch it without getting in the way.
[category] Food & Drink

[intro]
In the second week of September the terraces above Manarola fill with crates, ladders and people who have done this every year of their lives.

The grapes are for Sciacchetrà, the sweet wine of the Cinque Terre, and the harvest is short, steep and done almost entirely by hand.

[s1] Where the vines grow
The vineyards sit on dry stone terraces that climb from the village to the ridge. Each strip is only a few rows wide, so no tractor fits, and the pickers carry every crate down narrow stairs cut into the walls.

A small monorail, the trenino, now does some of the lifting. It runs on a single rail up the slope and saves the growers hours of carrying on the steepest plots.

[s2] How to watch the harvest
You can see the work from the public path that leaves the top of the village and follows the terraces toward Volastra. Go early: picking starts at first light and stops before the midday heat.

- Stay on the marked path and leave the vineyard gates as you find them.
- Step aside for anyone carrying a crate; they have the right of way.
- Ask before you photograph people at work.

Tip: The path has little shade and no fountain after the last houses, so carry water and wear shoes with a firm grip.

[s3] What ends up in the glass
After picking, the best bunches are laid out on racks to dry for weeks, away from the sun. Only then are they pressed, which is why a small bottle takes so many grapes.

Several cellars in Manarola pour it by the glass with a plate of dry biscuits. Order one, drink it slowly, and ask where the grapes came from.

[closing] Before you go
The harvest moves with the weather and can start a week early or late, so ask in the village before you plan around it. Trains stop in Manarola all day & evening, and the path to the terraces starts behind the church square.
"
    );
    // Shorter than the page JSON the editor used to read.
    assert!(
        text.len() * 10 < page.to_string().len() * 7,
        "{} vs {}",
        text.len(),
        page.to_string().len()
    );
    // Every marker is an id a review issue can name.
    for line in text
        .lines()
        .filter(|l| l.starts_with("[s") || l.starts_with("[intro") || l.starts_with("[closing"))
    {
        let id = &line[1..line.find(']').unwrap()];
        id.parse::<SectionId>().unwrap();
    }
}

#[test]
fn blocks_map_back_to_their_sections() {
    let page = assemble(&parts(), &shortlists()).unwrap();
    use SectionId::{Closing as C, Intro, Section, Title};
    assert_eq!(
        block_sections(page["body"].as_array().unwrap()),
        [
            Title,
            Intro,
            Intro,
            Section(1),
            Section(1),
            Section(1),
            Section(2),
            Section(2),
            Section(2),
            Section(2),
            Section(2),
            Section(3),
            Section(3),
            Section(3),
            C,
        ]
        .map(Some)
    );
    assert_eq!(
        agents::article::section_of_pointer(&page, "/body/8/items/1"),
        Some(Section(2))
    );
    assert_eq!(
        agents::article::section_of_pointer(&page, "/body/0/title"),
        Some(Title)
    );
    assert_eq!(
        agents::article::section_of_pointer(&page, "/seo/title"),
        None
    );
    assert_eq!(agents::article::section_of_pointer(&page, "/body/99"), None);
}

#[test]
fn assembly_resolves_aliases_and_rejects_unknown_ones() {
    let lists = shortlists();
    let parts = parts();
    let (hero, links) = resolve_aliases(&parts.outline, &lists.heroes, &lists.links).unwrap();
    assert_eq!(hero.media_id, "manarola-sights-014");
    assert_eq!(
        links.iter().map(|l| l.route.as_str()).collect::<Vec<_>>(),
        vec!["/en/manarola", "/en/manarola/hiking"]
    );

    let mut invented = parts.clone();
    invented.outline.hero = "M7".into();
    assert_eq!(
        assemble(&invented, &lists),
        Err(AssembleError::UnknownHero("M7".into()))
    );
    // A raw URL or media id is not an alias either: only the shortlist counts.
    for raw in [
        "https://images.unsplash.com/photo-1499678329028-101435549a4e",
        "manarola-sights-014",
        "media:manarola-sights-014",
        "m2",
        "",
    ] {
        invented.outline.hero = raw.into();
        assert_eq!(
            assemble(&invented, &lists),
            Err(AssembleError::UnknownHero(raw.into())),
        );
    }
    let mut invented = parts.clone();
    invented.outline.links = vec!["L1".into(), "/en/hiking/sentiero-azzurro".into()];
    assert_eq!(
        assemble(&invented, &lists),
        Err(AssembleError::UnknownLink(
            "/en/hiking/sentiero-azzurro".into()
        ))
    );
    // An empty shortlist resolves nothing.
    let none = Shortlists {
        heroes: vec![],
        links: vec![],
    };
    assert_eq!(
        assemble(&parts, &none),
        Err(AssembleError::UnknownHero("M2".into()))
    );
}

#[test]
fn assembly_variants() {
    let lists = shortlists();
    // No links chosen: no actions.
    let mut no_links = parts();
    no_links.outline.links.clear();
    let page = assemble(&no_links, &lists).unwrap();
    assert!(page["body"]
        .as_array()
        .unwrap()
        .last()
        .unwrap()
        .get("actions")
        .is_none());
    assert_eq!(check_article_profile(&page), vec![]);

    // The same link twice is one action.
    let mut twice = parts();
    twice.outline.links = vec!["L2".into(), "L2".into()];
    let page = assemble(&twice, &lists).unwrap();
    assert_eq!(
        page["body"].as_array().unwrap().last().unwrap()["actions"],
        json!([{"label": "Food and Wine", "href": "/en/culinary", "variant": "primary"}])
    );

    // One hero in the shortlist: no inline image, and none when it is switched off.
    let one = Shortlists {
        heroes: vec![lists.heroes[1].clone()],
        links: lists.links.clone(),
    };
    let page = assemble(&parts(), &one).unwrap();
    assert!(page["body"]
        .as_array()
        .unwrap()
        .iter()
        .all(|b| b["type"] != "image"));
    assert!(page["metadata"].get("inline_media_id").is_none());
    let page = assemble_page(&ArticleInput {
        brief: &brief(),
        brief_ref: 1,
        author: "Giulia Rossi",
        brand_suffix: "",
        languages: &["en"],
        parts: &parts(),
        heroes: &lists.heroes,
        links: &lists.links,
        inline_image: false,
    })
    .unwrap();
    assert!(page["body"]
        .as_array()
        .unwrap()
        .iter()
        .all(|b| b["type"] != "image"));
    assert_eq!(
        page["slug"],
        json!({"en": "/en/blog/harvest-week-in-manarola"})
    );
    assert_eq!(
        page["seo"]["title"]["en"],
        "Crates, Ladders & Sweet Wine: Harvest Week in Manarola"
    );

    // The image sits after the middle section: s2 of 4, s3 of 5 and 6.
    for (sections, after) in [(3, 2), (4, 2), (5, 3), (6, 3)] {
        let mut p = parts();
        p.outline.sections = (0..sections)
            .map(|_| p.outline.sections[0].clone())
            .collect();
        p.sections = (0..sections).map(|_| p.sections[0].clone()).collect();
        let page = assemble(&p, &lists).unwrap();
        let body = page["body"].as_array().unwrap();
        let at = body.iter().position(|b| b["type"] == "image").unwrap();
        assert_eq!(
            block_sections(body)[at],
            Some(SectionId::Section(after)),
            "{sections} sections"
        );
        assert_ne!(
            body[at + 1]["type"],
            "paragraph",
            "the image closes its section"
        );
    }
}

#[test]
fn assembly_refuses_incomplete_parts() {
    let lists = shortlists();
    let mut p = parts();
    p.sections.pop();
    assert_eq!(
        assemble(&p, &lists),
        Err(AssembleError::SectionCount {
            outline: 3,
            drafts: 2
        })
    );
    let mut p = parts();
    p.sections[1] = draft(vec![paragraph("**")]);
    assert_eq!(
        assemble(&p, &lists),
        Err(AssembleError::Empty(SectionId::Section(2)))
    );
    let mut p = parts();
    p.intro = draft(vec![]);
    assert_eq!(
        assemble(&p, &lists),
        Err(AssembleError::Empty(SectionId::Intro))
    );
    let mut p = parts();
    p.closing.content = " ".into();
    assert_eq!(
        assemble(&p, &lists),
        Err(AssembleError::Empty(SectionId::Closing))
    );
    let mut p = parts();
    p.outline.title = "__".into();
    assert_eq!(
        assemble(&p, &lists),
        Err(AssembleError::Empty(SectionId::Title))
    );

    let mut no_slug = brief();
    no_slug.slug.clear();
    let result = assemble_page(&ArticleInput {
        brief: &no_slug,
        brief_ref: 1,
        author: "a",
        brand_suffix: "b",
        languages: &THEME_LANGUAGES,
        parts: &parts(),
        heroes: &lists.heroes,
        links: &lists.links,
        inline_image: true,
    });
    assert_eq!(result, Err(AssembleError::NoSlug));
}

#[test]
fn html_in_model_text_cannot_reach_the_set_html_fields_unescaped() {
    let mut p = parts();
    p.outline.title = "Wine <script>alert(1)</script> & terraces".into();
    p.closing.content = "Ask at the <b>cantina</b> & say hello, they will tell you when the picking starts this year.".into();
    let page = assemble(&p, &shortlists()).unwrap();
    let body = page["body"].as_array().unwrap();
    assert_eq!(
        body[0]["title"],
        "Wine &lt;script&gt;alert(1)&lt;/script&gt; &amp; terraces"
    );
    assert_eq!(
        body.last().unwrap()["content"],
        "Ask at the &lt;b&gt;cantina&lt;/b&gt; &amp; say hello, they will tell you when the picking starts this year."
    );
    assert_eq!(check_article_profile(&page), vec![]);
    // The plain title is kept where the theme escapes it itself.
    assert_eq!(
        page["title"]["en"],
        "Wine <script>alert(1)</script> & terraces"
    );
    assert_eq!(page_reading_text(&page), reading_text(&p));
}

// ---------------------------------------------------------------- article profile

#[test]
fn the_article_profile_rejects_pages_the_theme_would_render_wrongly() {
    let good = assemble(&parts(), &shortlists()).unwrap();
    let issues = |page: &Value| -> Vec<String> {
        check_article_profile(page)
            .iter()
            .map(ToString::to_string)
            .collect()
    };
    assert!(issues(&good).is_empty());

    let edit = |f: &dyn Fn(&mut Vec<Value>)| {
        let mut page = good.clone();
        f(page["body"].as_array_mut().unwrap());
        page
    };
    let hero = good["body"][0].clone();
    let closing = good["body"][14].clone();

    let cases: Vec<(Value, &str)> = vec![
        (edit(&|b| { b.remove(0); }), "[title] /body: an article has exactly one editorial-hero, as its first block"),
        (edit(&|b| b.insert(3, hero.clone())), "[title] /body: an article has exactly one editorial-hero, as its first block"),
        (edit(&|b| { b.pop(); }), "[closing] /body: an article has exactly one closing-note, as its last block"),
        (edit(&|b| b.insert(5, closing.clone())), "[closing] /body: an article has exactly one closing-note, as its last block"),
        (edit(&|b| b.push(json!({"type": "paragraph", "markdown": "After the end."}))), "[closing] /body: an article has exactly one closing-note, as its last block"),
        (edit(&|b| { b.remove(1); b.remove(1); }), "[intro] /body/1: the hero is followed by at least one intro paragraph"),
        (edit(&|b| b[3]["level"] = json!(3)), "[s1] /body/3/level: section headings are level 2"),
        (edit(&|b| { b.remove(12); b.remove(12); }), "[s3] /body/11: a heading is followed by at least one block of its section"),
        (edit(&|b| b[4] = json!({"type": "quote", "text": "Invented."})), "[s1] /body/4/type: block type \"quote\" is not part of an article"),
        (edit(&|b| b[4] = json!({"type": "hero", "title": "Second h1"})), "[s1] /body/4/type: block type \"hero\" is not part of an article"),
        (edit(&|b| b[0]["title"] = json!("Wine <br> terraces")), "[title] /body/0/title: editorial-hero.title is rendered as HTML and must not contain < or >"),
        (edit(&|b| b[14]["content"] = json!("<p>Paragraphs</p>")), "[closing] /body/14/content: closing-note.content is rendered as HTML and must not contain < or >"),
    ];
    for (page, expected) in cases {
        let found = issues(&page);
        assert!(
            found.contains(&expected.to_string()),
            "expected {expected:?} in {found:#?}"
        );
    }

    let mut page = good.clone();
    page["page_type"] = json!("blog");
    assert_eq!(
        issues(&page),
        vec!["/page_type: an article's page_type is \"blog-article\""]
    );
    let mut page = good.clone();
    page["slug"]["de"] = json!("/de/blog/erntewoche");
    assert_eq!(
        issues(&page),
        vec!["/slug: every language must use the same slug"]
    );
    let mut page = good.clone();
    page["slug"] = json!({"en": "/blog/harvest-week-in-manarola"});
    assert_eq!(
        issues(&page),
        vec!["/slug/en: an article's en slug is \"/en/blog/<slug>\""]
    );
    let mut page = good.clone();
    page["body"] = json!([]);
    assert_eq!(issues(&page).len(), 4);

    // The theme's route reads `seo.<field>.<lang>`: plain strings (which
    // schema v1 required) would give the page an empty meta description.
    let mut page = good.clone();
    page["seo"] = json!({"title": "A plain title", "description": "A plain description."});
    assert_eq!(
        issues(&page),
        vec![
            "[title] /seo/title: an article's seo.title is {\"en\": \"…\"} and not empty",
            "[title] /seo/description: an article's seo.description is {\"en\": \"…\"} and not empty",
        ]
    );
    let mut page = good.clone();
    page["seo"]["description"]["en"] = json!(" ");
    assert_eq!(issues(&page).len(), 1);

    // The one agent-written article that is live does not fit the profile:
    // two blocks outside the article set, no intro paragraph after the hero,
    // no section heading, HTML in the closing and an empty `seo`.
    let live = json!({
        "id": "x", "slug": {"en": "/en/blog/last-light-on-sentiero-azzurro"}, "title": {"en": "t"},
        "page_type": "blog-article",
        "seo": {},
        "body": [
            {"type": "editorial-hero", "title": "t", "image": "https://img.test/a"},
            {"type": "editorial-intro", "quote": "q", "leftContent": "<p>l</p>", "rightContent": "<p>r</p>"},
            {"type": "paragraph", "markdown": "p"},
            {"type": "editor-note", "quote": "q", "author": "a", "role": "r"},
            {"type": "closing-note", "title": "t", "content": "<p>c</p>"}
        ]
    });
    assert_eq!(issues(&live).len(), 7, "{:#?}", issues(&live));
}

// ---------------------------------------------------------------- digests

#[test]
fn a_section_digest_is_heading_first_and_last_sentence() {
    let parts = parts();
    assert_eq!(
        section_digest("Where the vines grow", &parts.sections[0]),
        "Where the vines grow: The vineyards sit on dry stone terraces that climb from the village to the ridge. […] It runs on a single rail up the slope and saves the growers hours of carrying on the steepest plots."
    );
    // The last text of a section may be a list item or a tip.
    assert_eq!(
        section_digest("How to watch the harvest", &parts.sections[1]),
        "How to watch the harvest: You can see the work from the public path that leaves the top of the village and follows the terraces toward Volastra. […] The path has little shade and no fountain after the last houses, so carry water and wear shoes with a firm grip."
    );
    assert_eq!(
        section_digest("One", &draft(vec![paragraph("Only one sentence here.")])),
        "One: Only one sentence here."
    );
    assert_eq!(section_digest("**Empty**", &draft(vec![])), "Empty");
    // Long sentences are cut, so a digest stays near 60 tokens.
    let long = format!("{}. Short end.", words(80));
    let digest = section_digest("Long", &draft(vec![paragraph(&long)]));
    assert!(digest.chars().count() < 200, "{digest}");
    assert!(digest.ends_with("… […] Short end."), "{digest}");
    // Deterministic.
    assert_eq!(
        section_digest("Where the vines grow", &parts.sections[0]),
        section_digest("Where the vines grow", &parts.sections[0])
    );
}
