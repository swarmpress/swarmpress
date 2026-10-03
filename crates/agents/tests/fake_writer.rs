//! The brief-driven fake writer (ADR-0058, FEAT-032): from any brief, it
//! answers every stage of the staged article with text that passes the
//! per-part checks, so tests and a soak run need no hard-coded article.

use agents::article::{
    check_closing, check_outline, check_section, closing_schema, closing_words, intro_words,
    normalize_outline_words, outline_schema, section_schema, Closing, HeroOption, LinkOption,
    Outline, SectionBudget, SectionDraft, SectionId,
};
use agents::article_prompts::{
    closing_prompt, digest_of, last_paragraph, outline_prompt, section_prompt, LlmProfile,
    OutlineContext, SectionNeighbours, SectionSpec,
};
use agents::fake_writer::answer;
use agents::pipeline::Brief;
use agents::{CallProfile, FakeReply, JobKind, Role, StyleGuide};
use serde_json::Value;

const STYLE: &str = include_str!("fixtures/style-guide.json");

fn brief(title: &str, keywords: &[&str], target_words: u32) -> Brief {
    Brief {
        content_id: "content-1".into(),
        title: title.into(),
        slug: "x".into(),
        angle: format!("What {title} is like for a visitor who takes it slowly."),
        keywords: keywords.iter().map(|k| (*k).to_string()).collect(),
        target_words,
        language: "en".into(),
        notes: String::new(),
    }
}

fn json(reply: FakeReply) -> Value {
    match reply {
        FakeReply::Json(v) => v,
        other => panic!("{other:?}"),
    }
}

fn ask(prompt: &agents::article_prompts::StagePrompt, schema: &Value) -> Value {
    let req = prompt.request(CallProfile::new(JobKind::Draft, Role::Writer), "system");
    let v = json(answer(&req, Some(schema)));
    claude::SchemaValidator::new(schema)
        .unwrap()
        .validate(&v)
        .unwrap_or_else(|e| panic!("{}: {e:?}\n{v}", prompt.task));
    v
}

/// Writes a whole article through the stage prompts and checks every part.
fn write(b: &Brief) -> (Outline, Vec<SectionDraft>, Closing) {
    let style = StyleGuide::from_json_str(STYLE).unwrap();
    let profile = LlmProfile::LOCAL;
    let heroes = vec![HeroOption {
        alias: "M1".into(),
        media_id: "m".into(),
        url: "https://images.unsplash.com/photo-1".into(),
        alt: "A village".into(),
        about: "village".into(),
        credit: None,
    }];
    let links = vec![LinkOption {
        alias: "L1".into(),
        page_id: "p".into(),
        route: "/en/p".into(),
        title: "A page".into(),
    }];
    let categories = vec!["Guides".to_string(), "Food & Drink".to_string()];
    let ctx = OutlineContext {
        heroes: &heroes,
        links: &links,
        facts: &[],
        related: &[],
        categories: &categories,
        guidance: None,
    };
    let schema = outline_schema(&["M1".into()], &["L1".into()], &categories);
    let outline: Outline =
        serde_json::from_value(ask(&outline_prompt(&profile, "system", b, &ctx), &schema)).unwrap();
    assert_eq!(check_outline(&outline, &style), vec![]);
    let outline = normalize_outline_words(&outline, b.target_words);
    let n = outline.sections.len();

    let mut drafts = Vec::new();
    let mut earlier: Vec<String> = Vec::new();
    let mut digests = Vec::new();
    let mut end: Option<String> = None;
    for i in 0..=n {
        let spec = if i == 0 {
            SectionSpec {
                id: SectionId::Intro,
                total: n,
                heading: String::new(),
                points: vec![],
                words: intro_words(b.target_words),
                part: None,
            }
        } else {
            let o = &outline.sections[i - 1];
            SectionSpec {
                id: SectionId::Section(u8::try_from(i).unwrap()),
                total: n,
                heading: o.heading.clone(),
                points: o.points.clone(),
                words: o.words,
                part: None,
            }
        };
        let prompt = section_prompt(
            &profile,
            "system",
            b,
            &outline,
            &spec,
            &SectionNeighbours {
                earlier: digests.clone(),
                previous_end: end.clone(),
                facts: &[],
            },
        );
        let draft: SectionDraft = serde_json::from_value(ask(&prompt, &section_schema())).unwrap();
        let errors = check_section(
            &draft,
            &SectionBudget {
                section: spec.id,
                words: spec.words,
                earlier: &earlier,
            },
            &style,
        );
        assert_eq!(errors, vec![], "{} of {:?}", prompt.task, b.title);
        earlier.extend(draft.paragraphs());
        digests.push((spec.id, digest_of(&outline, spec.id, &draft)));
        end = Some(last_paragraph(&draft));
        drafts.push(draft);
    }
    let prompt = closing_prompt(
        &profile,
        "system",
        b,
        &outline,
        closing_words(b.target_words),
        &digests,
    );
    let closing: Closing = serde_json::from_value(ask(&prompt, &closing_schema())).unwrap();
    assert_eq!(check_closing(&closing, &style), vec![]);
    (outline, drafts, closing)
}

#[test]
fn the_fake_writer_writes_any_brief_and_every_part_passes_its_checks() {
    for (title, keywords, target) in [
        (
            "Harvest week in Manarola",
            &["Manarola", "Sciacchetrà"][..],
            600,
        ),
        ("Ferries", &["ferry"][..], 300),
        (
            "Walking the Via dell'Amore from Riomaggiore to Manarola at dawn",
            &[
                "Via dell'Amore",
                "Riomaggiore",
                "sunrise",
                "trains",
                "anchovies",
            ][..],
            1500,
        ),
        (
            "Vernazza in winter",
            &["Vernazza", "winter", "harbour"][..],
            900,
        ),
        ("Pesto", &[][..], 2000),
        (
            "Harvest week in Manarola",
            &["Manarola", "Sciacchetrà", "wine harvest", "terraces"][..],
            1500,
        ),
    ] {
        let b = brief(title, keywords, target);
        let (outline, drafts, _) = write(&b);
        let words: u32 = drafts.iter().map(SectionDraft::words).sum();
        // Within 25% of the target (the closing adds a little more).
        let lo = target * 3 / 4;
        let hi = target * 5 / 4;
        assert!((lo..=hi).contains(&words), "{title}: {words} of {target}");
        assert!((3..=6).contains(&outline.sections.len()));
    }
}

#[test]
fn the_same_brief_gives_the_same_article() {
    let b = brief("Harvest week in Manarola", &["Manarola"], 600);
    assert_eq!(write(&b), write(&b));
}
