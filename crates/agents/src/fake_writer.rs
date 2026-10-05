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
//!
//! It also answers the standup's pitch round (ADR-0062,
//! `crate::meetings`): the opening, one pitch per writer and the
//! commissioning call. A writer pitches the first topic nobody has taken:
//! [`PITCH_TOPICS`], then the season's calendar topics in the context pack; a
//! title the prompt lists as published, in flight or pitched (or a repair
//! turn names) is taken. The commissioning call takes the pitches in order,
//! as many as the cap allows.

use serde_json::{json, Value};

use crate::article::closing_words;
use crate::llm::{FakeLlm, FakeReply, LlmRequest, LlmRole};

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

/// A topic the fake writers pitch before the calendar's (the twin
/// of `MVP_TOPICS` in `apps/game/src/llm/mvp-script.ts`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PitchTopic {
    pub title: &'static str,
    pub angle: &'static str,
    pub keywords: &'static [&'static str],
    pub target_words: u32,
    /// What the writer says (the bubble).
    pub say: &'static str,
}

/// What the fake writers pitch, in order; the first is the MVP article.
pub const PITCH_TOPICS: [PitchTopic; 5] = [
    PitchTopic {
        title: "Harvest week in Manarola",
        angle: "A day on the terraces with the pickers",
        keywords: &["sciacchetrà", "manarola harvest"],
        target_words: 600,
        say: "The Sciacchetrà harvest starts Monday; I want to be on the Manarola terraces.",
    },
    PitchTopic {
        title: "Vernazza harbour at first light",
        angle: "What the harbour looks like before the first train arrives, and where to stand",
        keywords: &["vernazza", "harbour", "morning"],
        target_words: 700,
        say: "Nobody writes about Vernazza before eight; the harbour is a different place then.",
    },
    PitchTopic {
        title: "The ferry from Monterosso",
        angle: "Seeing the five villages from the water, and when the boats do not run",
        keywords: &["monterosso", "ferry", "boats"],
        target_words: 600,
        say: "Readers keep asking about the boats; I can ride the whole line on Thursday.",
    },
    PitchTopic {
        title: "Corniglia and its long stair",
        angle: "The one village above the sea, and how to arrive without losing your breath",
        keywords: &["corniglia", "steps", "trains"],
        target_words: 600,
        say: "Corniglia gets skipped because of the stairs; I want to make the case for it.",
    },
    PitchTopic {
        title: "Riomaggiore after dark",
        angle: "The village once the day visitors have left, from dinner to the last train",
        keywords: &["riomaggiore", "evening", "dinner"],
        target_words: 800,
        say: "The evening in Riomaggiore belongs to the people who stay; that is our story.",
    },
];

/// The answer to one call of the staged article or of the standup's pitch
/// round, from its prompt and schema.
pub fn answer(req: &LlmRequest, schema: Option<&Value>) -> FakeReply {
    let at = req
        .messages
        .iter()
        .position(|m| m.text.starts_with("## Task: "));
    let prompt = at.map_or("", |i| req.messages[i].text.as_str());
    // Repair turns come after the task: a pitch they name is taken.
    let later: Vec<&str> = at
        .map(|i| {
            req.messages[i + 1..]
                .iter()
                .filter(|m| m.role == LlmRole::User)
                .map(|m| m.text.as_str())
                .collect()
        })
        .unwrap_or_default();
    let task = prompt
        .lines()
        .next()
        .and_then(|l| l.strip_prefix("## Task: "))
        .unwrap_or("")
        .trim();
    let p = Prompt(prompt);
    match task {
        "standup opening" => return FakeReply::Text(opening_line(&p)),
        "pitch" => return FakeReply::Json(pitch(&p, &later)),
        "commission" => return FakeReply::Json(commission(&p)),
        // Two claims on a made-up official source (ADR-0068); the fake's searches return exactly them.
        "research" => {
            return FakeReply::Json(json!({"claims": [
                {"claim": "The park's information office lists the route as open all year.",
                 "url": "https://www.parco.example/route", "title": "Route information"},
                {"claim": "Trains between the five villages run about every twenty minutes in summer.",
                 "url": "https://www.rail.example/timetable", "title": "Timetable"}
            ]}))
        }
        _ => {}
    }
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

// ---------------------------------------------------------------- the standup

use crate::meetings::CAP_LABEL;

/// Every `«title»` in a line.
fn quoted(line: &str) -> Vec<&str> {
    let mut out = Vec::new();
    let mut rest = line;
    while let Some(open) = rest.find('«') {
        let after = &rest[open + '«'.len_utf8()..];
        let Some(close) = after.find('»') else { break };
        out.push(&after[..close]);
        rest = &after[close + '»'.len_utf8()..];
    }
    out
}

/// The calendar topics a pitch prompt offers (`- «title» — keywords: a, b`)
/// and the titles it says are taken (published, in flight, pitched), lower
/// case; titles a repair turn names are taken too.
fn standup_topics(prompt: &str, later: &[&str]) -> (Vec<(String, Vec<String>)>, Vec<String>) {
    let mut calendar = Vec::new();
    let mut taken = Vec::new();
    let mut in_calendar = false;
    for line in prompt.lines() {
        if let Some(head) = line.strip_prefix("## ") {
            in_calendar = head.starts_with("Calendar topics");
            continue;
        }
        let titles = quoted(line);
        if in_calendar && line.starts_with("- ") {
            if let Some(title) = titles.first() {
                let keywords = line
                    .split_once("— keywords: ")
                    .map(|(_, k)| {
                        k.split(',')
                            .map(str::trim)
                            .filter(|s| !s.is_empty())
                            .map(String::from)
                            .collect()
                    })
                    .unwrap_or_default();
                calendar.push(((*title).to_string(), keywords));
            }
            continue;
        }
        taken.extend(titles.iter().map(|t| t.to_lowercase()));
    }
    for text in later {
        taken.extend(quoted(text).iter().map(|t| t.to_lowercase()));
    }
    (calendar, taken)
}

fn opening_line(p: &Prompt<'_>) -> String {
    let cap = p.number(CAP_LABEL);
    let s = if cap == 1 { "" } else { "s" };
    format!(
        "Good morning. We can take on {cap} new article{s} today, so tell me what you want to write and why now."
    )
}

/// A writer's pitch: the first built-in topic nobody has taken, then the
/// season's calendar topics, else the first built-in topic (a duplicate the
/// round drops). Built-in topics first keep the scripted MVP article the same
/// whatever the site's calendar holds.
fn pitch(p: &Prompt<'_>, later: &[&str]) -> Value {
    let (calendar, taken) = standup_topics(p.0, later);
    let free = |title: &str| !taken.contains(&title.to_lowercase());
    if let Some(t) = PITCH_TOPICS.iter().find(|t| free(t.title)) {
        return json!({"say": t.say, "title": t.title, "angle": t.angle, "keywords": t.keywords});
    }
    if let Some((title, keywords)) = calendar.iter().find(|(t, _)| free(t)) {
        let mut keywords: Vec<String> = keywords.iter().take(6).cloned().collect();
        for extra in [title.to_lowercase(), "cinque terre".to_string()] {
            if keywords.len() < 2 {
                keywords.push(extra);
            }
        }
        return json!({
            "say": format!("The calendar says it is time for {title}; I would like to write it now."),
            "title": cap(title, 70),
            "angle": format!("A seasonal guide to {}, and what a visitor should plan for.", title.to_lowercase()),
            "keywords": keywords,
        });
    }
    let t = &PITCH_TOPICS[0];
    json!({"say": t.say, "title": t.title, "angle": t.angle, "keywords": t.keywords})
}

/// The commissioning call: the pitches in order, as many as the cap allows,
/// at their topic's length.
fn commission(p: &Prompt<'_>) -> Value {
    let cap = usize::try_from(p.number(CAP_LABEL).max(1)).unwrap_or(1);
    let mut in_pitches = false;
    let mut chosen = Vec::new();
    for line in p.0.lines() {
        if line == "Pitches:" {
            in_pitches = true;
            continue;
        }
        if !in_pitches || chosen.len() >= cap {
            continue;
        }
        let Some(rest) = line.strip_prefix("- ") else {
            in_pitches = false;
            continue;
        };
        let alias = rest.split_whitespace().next().unwrap_or("P1");
        let title = quoted(line).first().copied().unwrap_or("");
        let words = PITCH_TOPICS
            .iter()
            .find(|t| t.title.eq_ignore_ascii_case(title))
            .map_or(crate::meetings::DEFAULT_TARGET_WORDS, |t| t.target_words);
        chosen.push(json!({"pitch": alias, "target_words": words}));
    }
    json!({"commission": chosen, "decisions": [], "escalations": []})
}
