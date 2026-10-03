//! A deterministic, brief-driven stand-in for the model in the staged
//! article (ADR-0058): it answers every stage of the Draft and Review jobs by
//! reading the stage prompt (`crate::article_prompts`), so it can write any
//! article from any brief. Tests and the orchestrator harness use it through
//! [`FakeLlm::with_responder`]; the browser's `?llm=fake` model is its
//! TypeScript twin (`apps/game/src/llm/mvp-script.ts`).
//!
//! What it writes passes the per-section checks (`crate::article`): plain
//! text, no banned phrase of the cinqueterre.travel house style, no repeated
//! paragraph, and about the asked number of words. As the editor it follows
//! the MVP script: revision 0 scores 6 and names section 2 ([`REVIEW_NOTE`]),
//! every later revision scores 8.

use serde_json::{json, Value};

use crate::article::closing_words;
use crate::llm::{FakeLlm, FakeReply, LlmRequest};

/// The editor's note on the first draft (it names section 2).
pub const REVIEW_NOTE: &str = "Tell us who the pickers are.";
/// The fix the editor asks for with [`REVIEW_NOTE`].
pub const REVIEW_FIX: &str = "Name the people who do the work and say what each of them does.";
/// The sentence a revised part starts with.
pub const REVISION_LINE: &str =
    "The people who do the work are named here, each with the task they carry out.";
/// The editor's notes on an approved revision.
pub const APPROVE_NOTE: &str = "Now it has people in it.";

/// A [`FakeLlm`] that answers every staged call with [`answer`], after
/// `script` (e.g. a scripted standup).
pub fn fake_writer(script: impl IntoIterator<Item = FakeReply>) -> FakeLlm {
    FakeLlm::with_responder(script, answer)
}

/// The answer to one call of the staged article, from its prompt and schema.
pub fn answer(req: &LlmRequest, schema: Option<&Value>) -> FakeReply {
    let prompt = req
        .messages
        .iter()
        .find(|m| m.text.starts_with("## Task: "))
        .map_or("", |m| m.text.as_str());
    let task = prompt
        .lines()
        .next()
        .and_then(|l| l.strip_prefix("## Task: "))
        .unwrap_or("")
        .trim();
    let p = Prompt(prompt);
    let words = p.number("Words: about ");
    // The second half of a section written in two halves starts elsewhere in
    // the sentence pool, so the halves do not repeat each other.
    let shift = task
        .split_once(" part ")
        .map_or(0, |(_, rest)| leading_number(rest).saturating_sub(1) * 2);
    let empty = json!({});
    let schema = schema.unwrap_or(&empty);
    let value = if task == "outline" {
        outline(&p, schema)
    } else if task == "intro" || task.starts_with("intro part") {
        section_json(&p, 0, shift, words, false)
    } else if let Some(rest) = task.strip_prefix("section s") {
        section_json(&p, leading_number(rest), shift, words, false)
    } else if task == "closing" {
        json!({"content": closing_text(&p, closing_words(p.number("Target length: about ")))})
    } else if let Some(rest) = task.strip_prefix("fix ") {
        section_json(&p, section_index(rest), 0, words, false)
    } else if task == "revise closing" {
        json!({"content": format!("{REVISION_LINE} {}", closing_text(&p, closing_words(p.number("Target length: about "))))})
    } else if let Some(rest) = task.strip_prefix("revise ") {
        section_json(&p, section_index(rest), 0, words, true)
    } else if task == "retitle" {
        let (title, dek) = title_and_dek(&p);
        json!({"title": title, "dek": dek})
    } else if task == "review" || task == "review summary" {
        review(&p, schema)
    } else if let Some(rest) = task.strip_prefix("review section ") {
        section_review(&p, rest)
    } else {
        return FakeReply::Error(crate::LlmError::Backend(format!(
            "fake writer: no answer for task {task:?}"
        )));
    };
    FakeReply::Json(value)
}

/// The prompt text, read by its labelled lines.
struct Prompt<'a>(&'a str);

impl Prompt<'_> {
    fn field(&self, label: &str) -> &str {
        self.0
            .lines()
            .find_map(|l| l.strip_prefix(label))
            .unwrap_or("")
            .trim()
    }

    fn number(&self, label: &str) -> u32 {
        leading_number(self.field(label))
    }

    fn list(&self, label: &str, sep: &str) -> Vec<String> {
        self.field(label)
            .split(sep)
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(String::from)
            .collect()
    }
}

fn leading_number(s: &str) -> u32 {
    s.chars()
        .take_while(char::is_ascii_digit)
        .collect::<String>()
        .parse()
        .unwrap_or(0)
}

/// `intro` → 0, `s3` → 3, `closing` → 99.
fn section_index(id: &str) -> u32 {
    match id.trim() {
        "intro" => 0,
        "closing" => 99,
        other => leading_number(other.trim_start_matches('s')),
    }
}

fn enum_of<'a>(schema: &'a Value, pointer: &str) -> Vec<&'a str> {
    schema
        .pointer(pointer)
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default()
}

fn cap(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let mut out = String::new();
    for word in s.split_whitespace() {
        if out.chars().count() + word.chars().count() + 1 > max {
            break;
        }
        if !out.is_empty() {
            out.push(' ');
        }
        out.push_str(word);
    }
    out
}

fn title_and_dek(p: &Prompt<'_>) -> (String, String) {
    let mut title = p.field("Title: ").to_string();
    if title.chars().count() < 10 {
        title = format!("{title}: a field guide");
    }
    let mut dek = p.field("Angle: ").to_string();
    if !dek.ends_with('.') {
        dek.push('.');
    }
    if dek.chars().count() < 40 {
        dek = format!("{dek} A practical guide for a slow visit.");
    }
    (cap(&title, 70), cap(&dek, 160))
}

fn keywords(p: &Prompt<'_>) -> Vec<String> {
    let mut k = p.list("Keywords: ", ",");
    if k.is_empty() {
        k.push(p.field("Title: ").to_lowercase());
    }
    k
}

const HEADINGS: [&str; 6] = [
    "Where {k} begins",
    "How to see {k}",
    "What {k} asks of a visitor",
    "When to go for {k}",
    "The people behind {k}",
    "Making the most of {k}",
];

fn outline(p: &Prompt<'_>, schema: &Value) -> Value {
    let (title, dek) = title_and_dek(p);
    let target = p.number("Target length: about ").max(300);
    let n = if target <= 700 {
        3
    } else if target <= 1100 {
        4
    } else {
        5
    };
    let kws = keywords(p);
    let sections: Vec<Value> = (0..n)
        .map(|i| {
            let k = &kws[i % kws.len()];
            let k2 = &kws[(i + 1) % kws.len()];
            json!({
                "heading": cap(&HEADINGS[i % HEADINGS.len()].replace("{k}", k), 70),
                "points": [format!("{k} at first light"), format!("what {k2} means here"), "practical timing".to_string()],
                "words": 150
            })
        })
        .collect();
    let categories = enum_of(schema, "/properties/category/enum");
    let joined = kws.join(" ").to_lowercase();
    let category = categories
        .iter()
        .find(|c| {
            c.to_lowercase()
                .split(|ch: char| !ch.is_alphanumeric())
                .any(|w| w.len() > 3 && joined.contains(w))
        })
        .or(categories.first())
        .map_or_else(|| "Guides".to_string(), |c| (*c).to_string());
    let heroes = enum_of(schema, "/properties/hero/enum");
    let links: Vec<&str> = enum_of(schema, "/properties/links/items/enum")
        .into_iter()
        .take(2)
        .collect();
    json!({
        "title": title,
        "dek": dek,
        "category": category,
        "hero": heroes.first().copied().unwrap_or("M1"),
        "sections": sections,
        "closing_title": "Before you go",
        "links": links,
    })
}

/// A sentence is an opener, a subject (what the part is about, or one of its
/// points or the brief's keywords), a middle and a closer, each picked with
/// its own stride from pools of coprime sizes (11, 13, 12), so no two
/// paragraphs of an article say the same thing in
/// the same words (the near-duplicate check, `agents::article`).
const OPENERS: [&str; 11] = [
    "Early in the day,",
    "On a quiet weekday,",
    "After the first train,",
    "In the late afternoon,",
    "When the light turns warm,",
    "Before the paths fill,",
    "On a wet morning,",
    "Between two trains,",
    "Once the boats are in,",
    "On the walk down,",
    "After a slow lunch,",
];
const MIDDLES: [&str; 13] = [
    "is easiest to understand",
    "rewards a little patience",
    "shows how the village works",
    "makes more sense with a local at your side",
    "feels close and unhurried",
    "asks for good shoes and water",
    "changes with the season",
    "is part of ordinary life here",
    "is worth a second look",
    "says more than any sign",
    "keeps its own slow rhythm",
    "is best seen on foot",
    "tells you where you are",
];
const CLOSERS: [&str; 12] = [
    "and nobody minds a question.",
    "so give it time.",
    "even for people who have seen it before.",
    "if you keep to the path.",
    "and the rest of the day can wait.",
    "before the crowds arrive.",
    "which is why people come back.",
    "so check the timetable first.",
    "and it costs nothing to look.",
    "while the village goes about its work.",
    "long after the photographs are taken.",
    "as long as you respect the people working there.",
];

const CLOSING: [&str; 6] = [
    "Plan the day around the light and the trains, and leave room for a slow lunch.",
    "Check timetables and the weather on the morning you go, since both change quickly.",
    "Walk early, rest in the heat of the afternoon and come back out for the evening.",
    "Carry water, wear shoes with grip and keep a little cash for smaller places.",
    "Be patient on the paths and kind to the people who live and work here.",
    "Come back in another season and the same places will show you something new.",
];

fn count(s: &str) -> u32 {
    u32::try_from(s.split_whitespace().count()).unwrap_or(u32::MAX)
}

/// About `words` words in paragraphs of four sentences, deterministic for
/// `(start, subjects)`; `start` numbers the paragraphs within the article.
fn paragraphs(start: u32, words: u32, subjects: &[String], lead: Option<&str>) -> Vec<String> {
    let goal = words.max(20);
    let mut out: Vec<String> = Vec::new();
    let mut total = 0;
    let mut current: Vec<String> = Vec::new();
    if let Some(lead) = lead {
        total += count(lead);
        current.push(lead.to_string());
    }
    let n = subjects.len().max(1);
    let mut p = 0u32;
    let mut k = 0u32;
    while total < goal.saturating_sub(4) {
        let g = (start + p) as usize;
        let k_ = k as usize;
        let subject = subjects
            .get((g + k_) % n)
            .map_or("the village", String::as_str);
        let sentence = format!(
            "{} {subject} {} {}",
            OPENERS[(g * 5 + k_) % OPENERS.len()],
            MIDDLES[(g * 7 + k_ * 5) % MIDDLES.len()],
            CLOSERS[(g * 11 + k_ * 7) % CLOSERS.len()],
        );
        total += count(&sentence);
        current.push(sentence);
        k += 1;
        if k == 4 {
            out.push(current.join(" "));
            current.clear();
            k = 0;
            p += 1;
        }
    }
    if !current.is_empty() {
        out.push(current.join(" "));
    }
    out
}

fn section_json(p: &Prompt<'_>, index: u32, variant: u32, words: u32, revised: bool) -> Value {
    let words = if words == 0 { 120 } else { words };
    let kws = keywords(p);
    let points = p.list("Points: ", ";");
    let mut subjects: Vec<String> = if index == 0 {
        vec![p.field("Title: ").to_lowercase()]
    } else {
        let mut v = points.clone();
        if v.is_empty() {
            v.push(p.field("Heading: ").to_string());
        }
        v
    };
    subjects.extend(kws.iter().cloned());
    let subjects: Vec<String> = subjects.into_iter().map(|x| x.to_lowercase()).collect();
    let b = subjects.get(1).cloned().unwrap_or_default();
    let lead = revised.then_some(REVISION_LINE);
    let tip = index == 2;
    let body_words = if tip { words.saturating_sub(20) } else { words };
    let mut blocks: Vec<Value> = paragraphs(index * 9 + variant * 100, body_words, &subjects, lead)
        .into_iter()
        .map(|t| json!({"type": "paragraph", "text": t, "items": []}))
        .collect();
    if tip {
        blocks.push(json!({
            "type": "tip",
            "text": format!("Check the timetable on the day and travel early, because {b} is easiest to enjoy before noon."),
            "items": []
        }));
    }
    json!({ "blocks": blocks })
}

fn closing_text(p: &Prompt<'_>, words: u32) -> String {
    let title = p.field("Title: ").to_lowercase();
    let mut out = vec![format!(
        "That is {title} as we found it, and it is best seen slowly."
    )];
    let mut total = count(&out[0]);
    for s in CLOSING {
        if total >= words {
            break;
        }
        total += count(s);
        out.push(s.to_string());
    }
    out.join(" ")
}

fn review(p: &Prompt<'_>, schema: &Value) -> Value {
    let revision = p.number("Revision: ");
    let ids = enum_of(schema, "/properties/issues/items/properties/section/enum");
    let target = ["s2", "s1", "intro"]
        .into_iter()
        .find(|id| ids.contains(id))
        .unwrap_or("whole");
    if revision == 0 {
        json!({
            "decision": "needs_changes", "score": 6, "notes": REVIEW_NOTE,
            "issues": [{"section": target, "problem": REVIEW_NOTE, "fix": REVIEW_FIX}],
            "high_risk": []
        })
    } else {
        json!({"decision": "approve", "score": 8, "notes": APPROVE_NOTE, "issues": [], "high_risk": []})
    }
}

fn section_review(p: &Prompt<'_>, rest: &str) -> Value {
    let revision = p.number("Revision: ");
    let id = rest.split_whitespace().next().unwrap_or("");
    if revision == 0 && id == "s2" {
        json!({"score": 6, "notes": REVIEW_NOTE, "issues": [{"problem": REVIEW_NOTE, "fix": REVIEW_FIX}]})
    } else {
        json!({"score": 8, "notes": "Clear and useful.", "issues": []})
    }
}
