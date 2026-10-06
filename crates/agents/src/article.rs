//! The staged article (ADR-0058; `docs/design/mvp-pipeline.md` §1 "Staged
//! article pipeline" and §4 "Article shape for the frozen theme").
//!
//! One bounded local model cannot write a whole page in one call. It writes
//! text in stages instead: an outline, then one section at a time, then a
//! closing. Everything around those calls is here, deterministic and pure (no
//! I/O, no clock, no model):
//!
//! - **Stage schemas** ([`outline_schema`], [`section_schema`],
//!   [`closing_schema`], [`review_schema`]). Flat, no `anyOf`, and limited to
//!   the keywords the browser's subset validator knows
//!   (`apps/game/src/llm/structured.ts`); `tests/article.rs` asserts it.
//! - **Typed stage results** ([`Outline`], [`SectionDraft`], [`Closing`],
//!   [`SectionedReview`]) and [`normalize_outline_words`].
//! - **Plain text** ([`sanitize_plain`], [`html_escape`]). The frozen theme
//!   prints block text literally, so emphasis markers and Markdown links are
//!   stripped and URLs or angle brackets are errors.
//! - **Per-section checks** ([`check_section`], [`check_outline`],
//!   [`check_closing`]). Every error names its section ([`SectionId`]), so a
//!   repair turn rewrites one section and nothing else.
//! - **Assembly** ([`assemble_page`]). The model never writes headings, the
//!   hero, images, closing actions or `seo`: the orchestrator does, from the
//!   outline and from shortlists whose aliases (`M1`, `L1`, …) resolve to
//!   known media and routes here. An unknown alias cannot reach a page
//!   (CLAUDE.md rule 5).
//! - **The article profile** ([`check_article_profile`]): the block order the
//!   theme renders correctly, with exactly one `<h1>` source.
//! - **Reading text** ([`reading_text`], [`page_reading_text`],
//!   [`section_digest`]): what the editor reads instead of page JSON, and
//!   what a later section is told about the earlier ones.
//!
//! The shortlists themselves come from the site's knowledge base and are built
//! in the orchestrator crate (`orchestrator::article`); this crate only sees
//! them as plain data ([`HeroOption`], [`LinkOption`]).

use std::collections::BTreeSet;
use std::fmt;

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

use crate::house_style::StyleGuide;
use crate::pipeline::{Brief, EditorReview, ReviewDecision};

/// `editorial-hero.height` written by assembly.
pub const HERO_HEIGHT: &str = "70vh";
/// `closing-note.badge` written by assembly.
pub const CLOSING_BADGE: &str = "Practical Notes";
/// `page_type` of an article.
pub const PAGE_TYPE: &str = "blog-article";
/// `status` of an article on its draft branch (finalise-on-merge flips it to
/// `published`).
pub const DRAFT_STATUS: &str = "in_review";
/// The languages the frozen theme routes (`SUPPORTED_LANGS` in its catch-all
/// page). An article carries one slug key per language, English text under
/// all of them.
pub const THEME_LANGUAGES: [&str; 4] = ["en", "de", "fr", "it"];
/// Block types an article body may hold.
pub const ARTICLE_BLOCKS: [&str; 7] = [
    "editorial-hero",
    "paragraph",
    "heading",
    "list",
    "callout",
    "image",
    "closing-note",
];
/// A section passes its length check between these shares of its budget.
pub const SECTION_MIN_PERCENT: u32 = 60;
pub const SECTION_MAX_PERCENT: u32 = 140;
/// No body section is budgeted below this by [`normalize_outline_words`].
pub const MIN_SECTION_WORDS: u32 = 60;
/// Width of the Unsplash rendition written for the hero and the inline image.
pub const HERO_IMAGE_WIDTH: u32 = 2000;
pub const INLINE_IMAGE_WIDTH: u32 = 1200;

// ---------------------------------------------------------------------------
// Section ids
// ---------------------------------------------------------------------------

/// Where a piece of an article sits: the unit of repair, revision and review.
/// Written `title`, `intro`, `s1`…, `closing`, `whole`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub enum SectionId {
    /// Title and dek (the hero).
    Title,
    /// The paragraphs before the first heading.
    Intro,
    /// 1-based body section.
    Section(u8),
    /// The closing note.
    Closing,
    /// The article as a whole (review only).
    Whole,
}

impl fmt::Display for SectionId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            SectionId::Title => f.write_str("title"),
            SectionId::Intro => f.write_str("intro"),
            SectionId::Section(n) => write!(f, "s{n}"),
            SectionId::Closing => f.write_str("closing"),
            SectionId::Whole => f.write_str("whole"),
        }
    }
}

impl std::str::FromStr for SectionId {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "title" => Ok(SectionId::Title),
            "intro" => Ok(SectionId::Intro),
            "closing" => Ok(SectionId::Closing),
            "whole" => Ok(SectionId::Whole),
            _ => s
                .strip_prefix('s')
                .filter(|n| !n.starts_with('0') && n.bytes().all(|b| b.is_ascii_digit()))
                .and_then(|n| n.parse::<u8>().ok())
                .map(SectionId::Section)
                .ok_or_else(|| format!("unknown section id {s:?}")),
        }
    }
}

impl TryFrom<String> for SectionId {
    type Error = String;

    fn try_from(s: String) -> Result<Self, Self::Error> {
        s.parse()
    }
}

impl From<SectionId> for String {
    fn from(id: SectionId) -> Self {
        id.to_string()
    }
}

/// `s1`…`sN`.
pub fn section_ids(sections: usize) -> Vec<String> {
    (1..=sections).map(|i| format!("s{i}")).collect()
}

// ---------------------------------------------------------------------------
// Stage schemas
// ---------------------------------------------------------------------------

fn string_enum(values: &[String]) -> Value {
    json!({"type": "string", "enum": values})
}

/// A built-in schema from its JSON text. The schemas are kept as text, not
/// `json!` expressions: in the browser's orchestrator-wasm module a string
/// costs a fraction of the code that builds the same value.
pub(crate) fn schema_text(text: &str) -> Value {
    serde_json::from_str(text).unwrap_or(Value::Null)
}

const OUTLINE_SCHEMA: &str = r#"{"type":"object","additionalProperties":false,
"required":["title","dek","category","hero","sections","closing_title","links"],
"properties":{
 "title":{"type":"string","minLength":10,"maxLength":70},
 "dek":{"type":"string","minLength":40,"maxLength":160},
 "category":{"type":"string","minLength":1,"maxLength":40},
 "hero":{"type":"string","minLength":1,"maxLength":0},
 "sections":{"type":"array","minItems":3,"maxItems":6,"items":{"type":"object","additionalProperties":false,
  "required":["heading","points","words"],"properties":{
   "heading":{"type":"string","minLength":3,"maxLength":70},
   "points":{"type":"array","minItems":2,"maxItems":4,"items":{"type":"string","minLength":1}},
   "words":{"type":"integer","minimum":100,"maximum":350}}}},
 "closing_title":{"type":"string","minLength":3,"maxLength":60},
 "links":{"type":"array","maxItems":0,"items":{"type":"string"}}}}"#;

const SECTION_SCHEMA: &str = r#"{"type":"object","additionalProperties":false,"required":["blocks"],"properties":{
 "blocks":{"type":"array","minItems":1,"maxItems":6,"items":{"type":"object","additionalProperties":false,
  "required":["type","text","items"],"properties":{
   "type":{"type":"string","enum":["paragraph","list","tip"]},
   "text":{"type":"string"},
   "items":{"type":"array","maxItems":7,"items":{"type":"string","minLength":1}}}}}}}"#;

const CLOSING_SCHEMA: &str = r#"{"type":"object","additionalProperties":false,"required":["content"],"properties":{
 "content":{"type":"string","minLength":40,"maxLength":1200}}}"#;

const REVIEW_SCHEMA: &str = r#"{"type":"object","additionalProperties":false,
"required":["decision","score","notes","issues","high_risk"],
"properties":{
 "decision":{"type":"string","enum":["approve","needs_changes","reject"]},
 "score":{"type":"integer","minimum":1,"maximum":10},
 "notes":{"type":"string"},
 "issues":{"type":"array","maxItems":8,"items":{"type":"object","additionalProperties":false,
  "required":["section","problem","fix"],"properties":{
   "section":{"type":"string"},
   "problem":{"type":"string","minLength":1},
   "fix":{"type":"string"}}}},
 "high_risk":{"type":"array","items":{"type":"string"}}}}"#;

/// Schema of the `outline#0` stage.
///
/// `hero_aliases` and `link_aliases` are the shortlist aliases (`M1`…, `L1`…)
/// and `categories` the blog index's categories, so the model can only name
/// things that exist. With no hero alias the schema accepts no outline: an
/// empty hero shortlist is a `NeedsMedia` failure before this stage. With no
/// link alias `links` must be empty; with no category the field is free text.
pub fn outline_schema(
    hero_aliases: &[String],
    link_aliases: &[String],
    categories: &[String],
) -> Value {
    let mut schema = schema_text(OUTLINE_SCHEMA);
    let props = &mut schema["properties"];
    if !hero_aliases.is_empty() {
        props["hero"] = string_enum(hero_aliases);
    }
    if !link_aliases.is_empty() {
        props["links"]["maxItems"] = json!(2);
        props["links"]["items"] = string_enum(link_aliases);
    }
    if !categories.is_empty() {
        props["category"] = string_enum(categories);
    }
    schema
}

/// Schema of a `section#i` stage (and of the intro, `section#0`): one flat
/// block shape instead of `anyOf`. [`check_section`] enforces what the shape
/// cannot say (a list has items and no text, and so on).
pub fn section_schema() -> Value {
    schema_text(SECTION_SCHEMA)
}

/// Schema of the `closing#0` stage: the text of the closing note.
pub fn closing_schema() -> Value {
    schema_text(CLOSING_SCHEMA)
}

/// Schema of the review stage. `section_ids` are the body sections of the
/// article under review ([`section_ids`]); an issue is tagged `title`,
/// `intro`, one of them, `closing` or `whole`.
pub fn review_schema(section_ids: &[String]) -> Value {
    let mut targets = vec!["title".to_string(), "intro".to_string()];
    targets.extend(section_ids.iter().cloned());
    targets.extend(["closing".to_string(), "whole".to_string()]);
    let mut schema = schema_text(REVIEW_SCHEMA);
    schema["properties"]["issues"]["items"]["properties"]["section"] = string_enum(&targets);
    schema
}

// ---------------------------------------------------------------------------
// Typed stage results
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OutlineSection {
    pub heading: String,
    pub points: Vec<String>,
    /// Word budget of the section.
    pub words: u32,
}

/// The `outline#0` result ([`outline_schema`]).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Outline {
    pub title: String,
    pub dek: String,
    pub category: String,
    /// Hero shortlist alias (`M1`…).
    pub hero: String,
    pub sections: Vec<OutlineSection>,
    pub closing_title: String,
    /// Link shortlist aliases (`L1`…), at most two.
    pub links: Vec<String>,
}

impl Outline {
    /// `s1`…`sN` for this outline's sections.
    pub fn section_ids(&self) -> Vec<String> {
        section_ids(self.sections.len())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SectionBlockKind {
    Paragraph,
    List,
    Tip,
}

impl SectionBlockKind {
    fn name(self) -> &'static str {
        match self {
            SectionBlockKind::Paragraph => "paragraph",
            SectionBlockKind::List => "list",
            SectionBlockKind::Tip => "tip",
        }
    }
}

/// One block of a section, in the flat shape of [`section_schema`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SectionBlock {
    #[serde(rename = "type")]
    pub kind: SectionBlockKind,
    pub text: String,
    pub items: Vec<String>,
}

/// A `section#i` result ([`section_schema`]).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SectionDraft {
    pub blocks: Vec<SectionBlock>,
}

impl SectionDraft {
    /// The draft with every text run through [`sanitize_plain`] and blocks
    /// that end up empty dropped. This is what assembly writes and what the
    /// editor reads.
    pub fn sanitized(&self) -> SectionDraft {
        let blocks = self
            .blocks
            .iter()
            .map(|b| SectionBlock {
                kind: b.kind,
                text: sanitize_plain(&b.text).0,
                items: b
                    .items
                    .iter()
                    .map(|i| sanitize_plain(i).0)
                    .filter(|i| !i.is_empty())
                    .collect(),
            })
            .filter(|b| match b.kind {
                SectionBlockKind::List => !b.items.is_empty(),
                SectionBlockKind::Paragraph | SectionBlockKind::Tip => !b.text.is_empty(),
            })
            .collect();
        SectionDraft { blocks }
    }

    /// Words in the sanitized text and list items.
    pub fn words(&self) -> u32 {
        self.sanitized()
            .blocks
            .iter()
            .map(|b| match b.kind {
                SectionBlockKind::List => b.items.iter().map(|i| word_count(i)).sum(),
                SectionBlockKind::Paragraph | SectionBlockKind::Tip => word_count(&b.text),
            })
            .sum()
    }

    /// Sanitized texts of the paragraph and tip blocks, for the
    /// near-duplicate check of later sections.
    pub fn paragraphs(&self) -> Vec<String> {
        self.sanitized()
            .blocks
            .into_iter()
            .filter(|b| b.kind != SectionBlockKind::List)
            .map(|b| b.text)
            .collect()
    }
}

/// The `closing#0` result ([`closing_schema`]).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Closing {
    pub content: String,
}

/// Everything the model wrote for one article.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ArticleParts {
    pub outline: Outline,
    pub intro: SectionDraft,
    /// One per outline section, in order.
    pub sections: Vec<SectionDraft>,
    pub closing: Closing,
}

impl ArticleParts {
    /// The draft behind `intro` or `sN`.
    pub fn section(&self, id: SectionId) -> Option<&SectionDraft> {
        match id {
            SectionId::Intro => Some(&self.intro),
            SectionId::Section(n) => self.sections.get(usize::from(n).checked_sub(1)?),
            _ => None,
        }
    }

    /// Words of body text: intro, sections and closing.
    pub fn words(&self) -> u32 {
        self.intro.words()
            + self.sections.iter().map(SectionDraft::words).sum::<u32>()
            + word_count(&sanitize_plain(&self.closing.content).0)
    }
}

/// One issue of a review, tagged by section ([`review_schema`]).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReviewIssue {
    pub section: SectionId,
    pub problem: String,
    pub fix: String,
}

/// The editor's review with issues tagged by section ([`review_schema`]).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SectionedReview {
    pub decision: ReviewDecision,
    pub score: u8,
    pub notes: String,
    pub issues: Vec<ReviewIssue>,
    pub high_risk: Vec<String>,
}

impl SectionedReview {
    /// What a revision rewrites, in article order. A `whole` issue means the
    /// intro, every section and the closing; the title only when it is named.
    /// Sections the article does not have are dropped.
    pub fn revision_targets(&self, sections: usize) -> Vec<SectionId> {
        let named: BTreeSet<SectionId> = self.issues.iter().map(|i| i.section).collect();
        let mut out = BTreeSet::new();
        for id in &named {
            match id {
                SectionId::Whole => {
                    out.insert(SectionId::Intro);
                    out.extend(body_section_ids(sections));
                    out.insert(SectionId::Closing);
                }
                SectionId::Section(n) if usize::from(*n) > sections || *n == 0 => {}
                id => {
                    out.insert(*id);
                }
            }
        }
        out.into_iter().collect()
    }

    /// The untagged review the artifact record stores today: each issue as
    /// `"<section>: <problem> Fix: <fix>"`.
    pub fn to_editor_review(&self) -> EditorReview {
        EditorReview {
            decision: self.decision,
            score: self.score,
            notes: self.notes.clone(),
            issues: self
                .issues
                .iter()
                .map(|i| {
                    if i.fix.trim().is_empty() {
                        format!("{}: {}", i.section, i.problem.trim())
                    } else {
                        format!("{}: {} Fix: {}", i.section, i.problem.trim(), i.fix.trim())
                    }
                })
                .collect(),
            high_risk: self.high_risk.clone(),
        }
    }
}

fn body_section_ids(sections: usize) -> impl Iterator<Item = SectionId> {
    (1..=sections).filter_map(|i| u8::try_from(i).ok().map(SectionId::Section))
}

// ---------------------------------------------------------------------------
// Word budgets
// ---------------------------------------------------------------------------

/// Word budget of the intro for an article of `target_words`.
pub fn intro_words(target_words: u32) -> u32 {
    (target_words / 8).clamp(60, 150)
}

/// Word budget of the closing note for an article of `target_words`.
pub fn closing_words(target_words: u32) -> u32 {
    (target_words / 12).clamp(40, 100)
}

/// The outline with its section word budgets rescaled to the brief's target.
///
/// The model's budgets are only weights: the sections share
/// `target − intro − closing` words in proportion to them (largest remainder,
/// earlier section first on a tie), and none goes below
/// [`MIN_SECTION_WORDS`]. Deterministic and idempotent; never a repair turn.
/// The result is orchestrator-owned and may leave the outline schema's
/// 100–350 range.
pub fn normalize_outline_words(outline: &Outline, target_words: u32) -> Outline {
    let mut out = outline.clone();
    let n = out.sections.len();
    if n == 0 {
        return out;
    }
    let floor = u64::from(MIN_SECTION_WORDS);
    let reserved = intro_words(target_words) + closing_words(target_words);
    let body = u64::from(target_words.saturating_sub(reserved)).max(floor * n as u64);
    let weights: Vec<u64> = out
        .sections
        .iter()
        .map(|s| u64::from(s.words.max(1)))
        .collect();

    // Sections whose proportional share falls under the floor are pinned to
    // it; the others share what is left. At most `n` rounds.
    let mut pinned = vec![false; n];
    let mut shares = vec![0u64; n];
    loop {
        let free: Vec<usize> = (0..n).filter(|i| !pinned[*i]).collect();
        let pinned_total = floor * (n - free.len()) as u64;
        let pool = body.saturating_sub(pinned_total);
        let sum: u64 = free.iter().map(|i| weights[*i]).sum();
        if free.is_empty() || sum == 0 {
            break;
        }
        for &i in &free {
            shares[i] = weights[i] * pool / sum;
        }
        let mut left = pool - free.iter().map(|i| shares[*i]).sum::<u64>();
        let mut order = free.clone();
        order.sort_by(|&a, &b| {
            (weights[b] * pool % sum)
                .cmp(&(weights[a] * pool % sum))
                .then(a.cmp(&b))
        });
        for i in order {
            if left == 0 {
                break;
            }
            shares[i] += 1;
            left -= 1;
        }
        let under: Vec<usize> = free.into_iter().filter(|i| shares[*i] < floor).collect();
        if under.is_empty() {
            break;
        }
        for i in under {
            pinned[i] = true;
            shares[i] = floor;
        }
    }
    for (i, section) in out.sections.iter_mut().enumerate() {
        let words = if pinned[i] { floor } else { shares[i] };
        section.words = u32::try_from(words).unwrap_or(u32::MAX);
    }
    out
}

// ---------------------------------------------------------------------------
// Plain text
// ---------------------------------------------------------------------------

/// What [`sanitize_plain`] found. Stripped markup is information; a URL or an
/// angle bracket is an error the model must fix.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PlainFinding {
    /// Emphasis, code, heading, bullet or quote markers were removed.
    StrippedMarkup,
    /// A `[text](url)` link was replaced by its text.
    StrippedLink { url: String },
    /// A URL is left in the text.
    Url { url: String },
    /// A `<` or `>` is left in the text.
    AngleBracket,
}

impl PlainFinding {
    pub fn is_error(&self) -> bool {
        matches!(self, PlainFinding::Url { .. } | PlainFinding::AngleBracket)
    }
}

impl fmt::Display for PlainFinding {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            PlainFinding::StrippedMarkup => f.write_str("formatting markers were removed"),
            PlainFinding::StrippedLink { url } => write!(f, "a link to {url} was removed"),
            PlainFinding::Url { url } => write!(
                f,
                "contains the URL {url}; write plain text without links or addresses"
            ),
            PlainFinding::AngleBracket => {
                f.write_str("contains < or >; write plain text without HTML or comparison signs")
            }
        }
    }
}

/// Strips one leading Markdown line marker (`# `, `- `, `* `, `+ `, `• `, `> `).
fn strip_line_marker(line: &str) -> &str {
    let hashes = line.bytes().take_while(|b| *b == b'#').count();
    if (1..=6).contains(&hashes) && line[hashes..].starts_with(' ') {
        return line[hashes..].trim_start();
    }
    for marker in ["- ", "* ", "+ ", "• ", "> "] {
        if let Some(rest) = line.strip_prefix(marker) {
            return rest.trim_start();
        }
    }
    line
}

fn find_char(chars: &[char], from: usize, target: char) -> Option<usize> {
    chars
        .get(from..)?
        .iter()
        .position(|c| *c == target)
        .map(|i| from + i)
}

/// Replaces `[text](url)` (and `![alt](url)`) by its text.
fn strip_links(s: &str, findings: &mut Vec<PlainFinding>) -> String {
    let chars: Vec<char> = s.chars().collect();
    let mut out = String::with_capacity(s.len());
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '[' {
            let link = find_char(&chars, i + 1, ']')
                .filter(|close| chars.get(close + 1) == Some(&'('))
                .and_then(|close| find_char(&chars, close + 2, ')').map(|end| (close, end)));
            if let Some((close, end)) = link {
                let text: String = chars[i + 1..close].iter().collect();
                let url: String = chars[close + 2..end].iter().collect();
                if out.ends_with('!') {
                    out.pop();
                }
                out.push_str(text.trim());
                findings.push(PlainFinding::StrippedLink {
                    url: url.trim().to_string(),
                });
                i = end + 1;
                continue;
            }
        }
        out.push(chars[i]);
        i += 1;
    }
    out
}

/// Removes emphasis and code markers. A single `*` between spaces, a `_`
/// inside a word and a single `~` are ordinary characters and stay.
fn strip_emphasis(s: &str) -> (String, bool) {
    let chars: Vec<char> = s.chars().collect();
    let mut out = String::with_capacity(s.len());
    let mut changed = false;
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        match c {
            '`' => {
                changed = true;
                i += 1;
            }
            '*' | '_' | '~' => {
                let mut j = i;
                while j < chars.len() && chars[j] == c {
                    j += 1;
                }
                let prev = i.checked_sub(1).map(|k| chars[k]);
                let next = chars.get(j).copied();
                let space = |o: Option<char>| o.is_some_and(char::is_whitespace);
                let word = |o: Option<char>| o.is_some_and(char::is_alphanumeric);
                let keep = match c {
                    '*' => j - i == 1 && space(prev) && space(next),
                    '_' => word(prev) && word(next),
                    _ => j - i < 2,
                };
                if keep {
                    out.extend(std::iter::repeat_n(c, j - i));
                } else {
                    changed = true;
                }
                i = j;
            }
            _ => {
                out.push(c);
                i += 1;
            }
        }
    }
    (out, changed)
}

/// One pass of [`sanitize_plain`]: the cleaned text, whether markup was
/// removed, and the links that were replaced by their text.
fn sanitize_pass(text: &str, findings: &mut Vec<PlainFinding>) -> (String, bool) {
    let mut markup = false;
    let mut joined = String::with_capacity(text.len());
    for line in text.lines() {
        let mut line = line.trim();
        loop {
            let rest = strip_line_marker(line);
            if rest.len() == line.len() {
                break;
            }
            markup = true;
            line = rest;
        }
        if line.is_empty() {
            continue;
        }
        if !joined.is_empty() {
            joined.push(' ');
        }
        joined.push_str(line);
    }
    let unlinked = strip_links(&joined, findings);
    let (plain, changed) = strip_emphasis(&unlinked);
    (
        plain.split_whitespace().collect::<Vec<_>>().join(" "),
        markup || changed,
    )
}

/// Makes model text plain, deterministically, and reports what it found.
///
/// Stripped without asking the model again: Markdown links (`[text](url)`
/// becomes `text`), emphasis and code markers, leading heading, bullet and
/// quote markers; whitespace is collapsed to single spaces. Left in place and
/// reported as errors ([`PlainFinding::is_error`]): URLs and `<` / `>`. The
/// function is idempotent: cleaning runs until nothing changes.
pub fn sanitize_plain(text: &str) -> (String, Vec<PlainFinding>) {
    let mut findings = Vec::new();
    let mut markup = false;
    let mut clean = text.to_string();
    // Removing one marker can expose another ("*- item*"); a few passes settle it.
    for _ in 0..8 {
        let (next, changed) = sanitize_pass(&clean, &mut findings);
        markup |= changed;
        let settled = next == clean;
        clean = next;
        if settled {
            break;
        }
    }
    if markup {
        findings.insert(0, PlainFinding::StrippedMarkup);
    }

    for token in clean.split_whitespace() {
        let lower = token.to_lowercase();
        let bare = lower.trim_start_matches(|c: char| !c.is_alphanumeric());
        if lower.contains("http://") || lower.contains("https://") || bare.starts_with("www.") {
            let url = token
                .trim_start_matches(|c: char| !c.is_alphanumeric())
                .trim_end_matches(|c: char| !c.is_alphanumeric() && c != '/');
            findings.push(PlainFinding::Url {
                url: url.to_string(),
            });
        }
    }
    if clean.contains(['<', '>']) {
        findings.push(PlainFinding::AngleBracket);
    }
    (clean, findings)
}

/// Escapes text for the two fields the frozen theme renders through
/// `set:html`: `editorial-hero.title` and `closing-note.content`.
pub fn html_escape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            c => out.push(c),
        }
    }
    out
}

/// Inverse of [`html_escape`].
pub fn html_unescape(text: &str) -> String {
    text.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
}

/// Whitespace-separated words.
pub fn word_count(text: &str) -> u32 {
    u32::try_from(text.split_whitespace().count()).unwrap_or(u32::MAX)
}

// ---------------------------------------------------------------------------
// Per-section checks
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SectionErrorKind {
    /// The flat block shape is used wrongly (a list without items, …).
    Shape,
    /// A phrase the house style bans.
    BannedPhrase,
    /// A URL or an angle bracket is left after [`sanitize_plain`].
    NotPlainText,
    /// Under [`SECTION_MIN_PERCENT`] of the word budget.
    TooShort,
    /// Over [`SECTION_MAX_PERCENT`] of the word budget.
    TooLong,
    /// A paragraph repeats one from an earlier section.
    NearDuplicate,
}

/// One check failure of one section. `Display` is the line sent back to the
/// model in that section's repair turn.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SectionError {
    pub section: SectionId,
    pub kind: SectionErrorKind,
    pub message: String,
}

impl fmt::Display for SectionError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.section, self.message)
    }
}

/// What a section is checked against.
#[derive(Debug, Clone, Copy)]
pub struct SectionBudget<'a> {
    /// The section being checked; every error carries it.
    pub section: SectionId,
    /// Word budget (0 skips the length check).
    pub words: u32,
    /// Paragraphs of the sections already accepted
    /// ([`SectionDraft::paragraphs`]), for the near-duplicate check.
    pub earlier: &'a [String],
}

fn similarity_tokens(text: &str) -> BTreeSet<String> {
    text.split(|c: char| !c.is_alphanumeric())
        .filter(|t| !t.is_empty())
        .map(str::to_lowercase)
        .collect()
}

/// Whether two paragraphs say the same thing in nearly the same words: at
/// least eight distinct words each and 80% of their combined vocabulary
/// shared.
pub fn near_duplicate(a: &str, b: &str) -> bool {
    let (ta, tb) = (similarity_tokens(a), similarity_tokens(b));
    if ta.len() < 8 || tb.len() < 8 {
        return false;
    }
    let shared = ta.intersection(&tb).count();
    let union = ta.len() + tb.len() - shared;
    shared * 100 >= union * 80
}

fn excerpt(text: &str, max_chars: usize) -> String {
    if text.chars().count() <= max_chars {
        return text.to_string();
    }
    let cut: String = text.chars().take(max_chars).collect();
    format!("{}…", cut.trim_end())
}

fn text_errors(
    section: SectionId,
    what: &str,
    raw: &str,
    style: &StyleGuide,
    out: &mut Vec<SectionError>,
) -> String {
    let (clean, findings) = sanitize_plain(raw);
    for finding in findings.iter().filter(|f| f.is_error()) {
        out.push(SectionError {
            section,
            kind: SectionErrorKind::NotPlainText,
            message: format!("{what} {finding}"),
        });
    }
    for hit in style.banned_phrase_hits(&clean) {
        let instead = style
            .vocabulary
            .replacements
            .get(&hit)
            .map(|r| format!("; say \"{r}\" or rephrase"))
            .unwrap_or_default();
        out.push(SectionError {
            section,
            kind: SectionErrorKind::BannedPhrase,
            message: format!("{what} uses the banned phrase \"{hit}\" (house style){instead}"),
        });
    }
    clean
}

/// Checks one section before the next one is written.
///
/// - **Shape:** a `list` has items and no text; a `paragraph` or `tip` has
///   text and no items; the intro holds paragraphs only.
/// - **House style:** no banned phrase ([`StyleGuide::banned_phrase_hits`]).
/// - **Plain text:** nothing left that [`sanitize_plain`] reports as an error.
/// - **Length:** 60–140% of the word budget.
/// - **Repetition:** no paragraph is a [`near_duplicate`] of an earlier one.
///
/// The draft is checked as [`SectionDraft::sanitized`] would write it. An
/// empty result means the section is accepted.
pub fn check_section(
    draft: &SectionDraft,
    budget: &SectionBudget<'_>,
    style: &StyleGuide,
) -> Vec<SectionError> {
    let section = budget.section;
    let mut out = Vec::new();
    let shape = |message: String| SectionError {
        section,
        kind: SectionErrorKind::Shape,
        message,
    };
    if draft.blocks.is_empty() {
        out.push(shape("has no blocks; write at least one paragraph".into()));
        return out;
    }

    let mut words = 0;
    let mut seen: Vec<String> = Vec::new();
    for (i, block) in draft.blocks.iter().enumerate() {
        let what = format!("block {} ({})", i + 1, block.kind.name());
        let text = text_errors(section, &what, &block.text, style, &mut out);
        let items: Vec<String> = block
            .items
            .iter()
            .map(|item| text_errors(section, &what, item, style, &mut out))
            .filter(|item| !item.is_empty())
            .collect();
        words += word_count(&text) + items.iter().map(|i| word_count(i)).sum::<u32>();

        match block.kind {
            SectionBlockKind::List => {
                if items.is_empty() {
                    out.push(shape(format!("{what} needs at least one item")));
                }
                if !text.is_empty() {
                    out.push(shape(format!(
                        "{what} must leave \"text\" empty; put the words in \"items\""
                    )));
                }
            }
            SectionBlockKind::Paragraph | SectionBlockKind::Tip => {
                if text.is_empty() {
                    out.push(shape(format!("{what} needs text")));
                }
                if !items.is_empty() {
                    out.push(shape(format!(
                        "{what} must leave \"items\" empty; use a list block for items"
                    )));
                }
            }
        }
        if section == SectionId::Intro && block.kind != SectionBlockKind::Paragraph {
            out.push(shape(format!(
                "{what} is not allowed in the intro; write paragraphs only"
            )));
        }

        if block.kind != SectionBlockKind::List && !text.is_empty() {
            if budget
                .earlier
                .iter()
                .chain(seen.iter())
                .any(|earlier| near_duplicate(earlier, &text))
            {
                out.push(SectionError {
                    section,
                    kind: SectionErrorKind::NearDuplicate,
                    message: format!(
                        "{what} repeats an earlier paragraph (\"{}\"); say something new",
                        excerpt(&text, 60)
                    ),
                });
            }
            seen.push(text);
        }
    }

    if budget.words > 0 {
        let (lo, hi) = (
            budget.words * SECTION_MIN_PERCENT / 100,
            budget.words * SECTION_MAX_PERCENT / 100,
        );
        if words < lo {
            out.push(SectionError {
                section,
                kind: SectionErrorKind::TooShort,
                message: format!(
                    "has {words} words; about {} were asked for ({lo} to {hi} is accepted)",
                    budget.words
                ),
            });
        } else if words > hi {
            out.push(SectionError {
                section,
                kind: SectionErrorKind::TooLong,
                message: format!(
                    "has {words} words; about {} were asked for ({lo} to {hi} is accepted)",
                    budget.words
                ),
            });
        }
    }
    out
}

/// House style and plain text for the outline's own text: title and dek
/// (`title`), each heading and its points (`sN`) and the closing title
/// (`closing`).
pub fn check_outline(outline: &Outline, style: &StyleGuide) -> Vec<SectionError> {
    let mut out = Vec::new();
    text_errors(
        SectionId::Title,
        "the title",
        &outline.title,
        style,
        &mut out,
    );
    text_errors(SectionId::Title, "the dek", &outline.dek, style, &mut out);
    for (id, section) in body_section_ids(outline.sections.len()).zip(&outline.sections) {
        text_errors(id, "the heading", &section.heading, style, &mut out);
        for point in &section.points {
            text_errors(id, "a point", point, style, &mut out);
        }
    }
    text_errors(
        SectionId::Closing,
        "the closing title",
        &outline.closing_title,
        style,
        &mut out,
    );
    out
}

/// House style and plain text for the closing note.
pub fn check_closing(closing: &Closing, style: &StyleGuide) -> Vec<SectionError> {
    let mut out = Vec::new();
    let clean = text_errors(
        SectionId::Closing,
        "the closing",
        &closing.content,
        style,
        &mut out,
    );
    if clean.is_empty() {
        out.push(SectionError {
            section: SectionId::Closing,
            kind: SectionErrorKind::Shape,
            message: "the closing needs text".into(),
        });
    }
    out
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

/// One image of the hero shortlist. The model sees `alias` and `about`; the
/// page gets `url` and `alt`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HeroOption {
    /// `M1`…
    pub alias: String,
    /// Id in the site's media index.
    pub media_id: String,
    /// URL as the media index has it.
    pub url: String,
    pub alt: String,
    /// What the image shows, from its index tags (for the outline prompt).
    #[serde(default)]
    pub about: String,
    /// Photographer credit, when the index names one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub credit: Option<String>,
}

/// One page of the link shortlist. The model sees `alias` and `title`; the
/// page gets `route`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LinkOption {
    /// `L1`…
    pub alias: String,
    /// Page id in the site's page registry.
    pub page_id: String,
    /// Route that exists on the site, in the article's language (`/en/hikes`).
    pub route: String,
    pub title: String,
}

/// Everything [`assemble_page`] needs. The brief supplies id, slug and
/// keywords; the shortlists resolve the outline's aliases.
#[derive(Debug, Clone, Copy)]
pub struct ArticleInput<'a> {
    pub brief: &'a Brief,
    pub brief_ref: u64,
    /// Byline (the writer persona's name).
    pub author: &'a str,
    /// The part after `" | "` in `seo.title` (`The Dispatch`).
    pub brand_suffix: &'a str,
    /// One slug key per language ([`THEME_LANGUAGES`] for the frozen theme).
    pub languages: &'a [&'a str],
    pub parts: &'a ArticleParts,
    /// The hero shortlist the outline chose from.
    pub heroes: &'a [HeroOption],
    /// The link shortlist the outline chose from.
    pub links: &'a [LinkOption],
    /// Place the next-ranked shortlist image after the middle section.
    pub inline_image: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum AssembleError {
    #[error("outline names hero {0:?}, which is not in the hero shortlist")]
    UnknownHero(String),
    #[error("outline names link {0:?}, which is not in the link shortlist")]
    UnknownLink(String),
    #[error("outline has {outline} sections but {drafts} section drafts were given")]
    SectionCount { outline: usize, drafts: usize },
    #[error("{0} has no text")]
    Empty(SectionId),
    #[error("the brief has no slug")]
    NoSlug,
}

/// The hero and the links an outline's aliases stand for. Fails on an alias
/// that is not in the shortlist: an unknown id never reaches a page.
pub fn resolve_aliases<'a>(
    outline: &Outline,
    heroes: &'a [HeroOption],
    links: &'a [LinkOption],
) -> Result<(&'a HeroOption, Vec<&'a LinkOption>), AssembleError> {
    let hero = heroes
        .iter()
        .find(|h| h.alias == outline.hero)
        .ok_or_else(|| AssembleError::UnknownHero(outline.hero.clone()))?;
    let mut chosen: Vec<&LinkOption> = Vec::new();
    for alias in &outline.links {
        let link = links
            .iter()
            .find(|l| &l.alias == alias)
            .ok_or_else(|| AssembleError::UnknownLink(alias.clone()))?;
        if !chosen.iter().any(|c| c.route == link.route) {
            chosen.push(link);
        }
    }
    Ok((hero, chosen))
}

/// A URL without its query and fragment.
fn url_base(url: &str) -> &str {
    &url[..url.find(['?', '#']).unwrap_or(url.len())]
}

/// The media index URL with a fixed sizing query for Unsplash images (the
/// knowledge base compares image URLs without their query, so the result
/// still resolves to the same index entry). Other hosts are left as they are.
pub fn sized_media_url(url: &str, width: u32) -> String {
    let base = url_base(url);
    if base.starts_with("https://images.unsplash.com/") {
        format!("{base}?q=80&w={width}&auto=format&fit=crop")
    } else {
        url.to_string()
    }
}

/// Model text, cleaned the way the page and the editor both see it.
struct CleanArticle {
    title: String,
    dek: String,
    category: String,
    intro: SectionDraft,
    /// (heading, blocks)
    sections: Vec<(String, SectionDraft)>,
    closing_title: String,
    closing: String,
}

fn clean_article(parts: &ArticleParts) -> CleanArticle {
    let plain = |s: &str| sanitize_plain(s).0;
    CleanArticle {
        title: plain(&parts.outline.title),
        dek: plain(&parts.outline.dek),
        category: plain(&parts.outline.category),
        intro: parts.intro.sanitized(),
        sections: parts
            .outline
            .sections
            .iter()
            .zip(&parts.sections)
            .map(|(outline, draft)| (plain(&outline.heading), draft.sanitized()))
            .collect(),
        closing_title: plain(&parts.outline.closing_title),
        closing: plain(&parts.closing.content),
    }
}

/// A page needs every part: one draft per outline section and no empty text.
fn check_complete(parts: &ArticleParts, article: &CleanArticle) -> Result<(), AssembleError> {
    if parts.outline.sections.len() != parts.sections.len() {
        return Err(AssembleError::SectionCount {
            outline: parts.outline.sections.len(),
            drafts: parts.sections.len(),
        });
    }
    let empty = |is_empty: bool, id: SectionId| {
        if is_empty {
            Err(AssembleError::Empty(id))
        } else {
            Ok(())
        }
    };
    empty(article.title.is_empty(), SectionId::Title)?;
    empty(article.intro.blocks.is_empty(), SectionId::Intro)?;
    for (id, (heading, draft)) in body_section_ids(article.sections.len()).zip(&article.sections) {
        empty(heading.is_empty() || draft.blocks.is_empty(), id)?;
    }
    empty(
        article.closing_title.is_empty() || article.closing.is_empty(),
        SectionId::Closing,
    )
}

fn section_blocks(draft: &SectionDraft, body: &mut Vec<Value>) {
    for block in &draft.blocks {
        body.push(match block.kind {
            SectionBlockKind::Paragraph => json!({"type": "paragraph", "markdown": block.text}),
            SectionBlockKind::List => {
                json!({"type": "list", "ordered": false, "items": block.items})
            }
            SectionBlockKind::Tip => {
                json!({"type": "callout", "style": "info", "content": block.text})
            }
        });
    }
}

/// Builds the page the frozen theme renders correctly.
///
/// Body, in this order: `editorial-hero` (the only `<h1>`), the intro's
/// paragraphs, per section a level-2 `heading` and its blocks (`paragraph`,
/// `list`, `callout` from a tip), one optional `image` after the middle
/// section, and a `closing-note` whose actions are the outline's links.
/// Envelope: id and slug from the brief (one slug key per language, the same
/// English page under each), `title.en`, localized `seo`, `metadata` and
/// `status: "in_review"`.
///
/// All model text is run through [`sanitize_plain`]; the two fields the theme
/// renders through `set:html` are escaped with [`html_escape`]. Aliases are
/// resolved against the shortlists and an unknown one is an error.
pub fn assemble_page(input: &ArticleInput<'_>) -> Result<Value, AssembleError> {
    let brief = input.brief;
    if brief.slug.is_empty() {
        return Err(AssembleError::NoSlug);
    }
    let outline = &input.parts.outline;
    let (hero, links) = resolve_aliases(outline, input.heroes, input.links)?;
    let article = clean_article(input.parts);
    check_complete(input.parts, &article)?;

    let mut body = Vec::new();
    let mut hero_block = Map::new();
    hero_block.insert("type".into(), json!("editorial-hero"));
    hero_block.insert("title".into(), json!(html_escape(&article.title)));
    if !article.dek.is_empty() {
        hero_block.insert("subtitle".into(), json!(article.dek));
    }
    if !article.category.is_empty() {
        hero_block.insert("badge".into(), json!(article.category));
    }
    hero_block.insert(
        "image".into(),
        json!(sized_media_url(&hero.url, HERO_IMAGE_WIDTH)),
    );
    hero_block.insert("height".into(), json!(HERO_HEIGHT));
    body.push(Value::Object(hero_block));

    section_blocks(&article.intro, &mut body);

    // The next-ranked shortlist image that is not the hero.
    let inline = if input.inline_image {
        input.heroes.iter().find(|h| {
            h.alias != hero.alias
                && url_base(&h.url) != url_base(&hero.url)
                && !h.alt.trim().is_empty()
        })
    } else {
        None
    };
    let middle = article.sections.len().saturating_sub(1) / 2;
    for (i, (heading, draft)) in article.sections.iter().enumerate() {
        body.push(json!({"type": "heading", "level": 2, "text": heading}));
        section_blocks(draft, &mut body);
        if let (true, Some(image)) = (i == middle, inline) {
            let mut block = Map::new();
            block.insert("type".into(), json!("image"));
            block.insert(
                "src".into(),
                json!(sized_media_url(&image.url, INLINE_IMAGE_WIDTH)),
            );
            block.insert("alt".into(), json!(image.alt.trim()));
            if let Some(credit) = image.credit.as_deref().filter(|c| !c.trim().is_empty()) {
                block.insert("caption".into(), json!(credit.trim()));
            }
            body.push(Value::Object(block));
        }
    }

    let mut closing = Map::new();
    closing.insert("type".into(), json!("closing-note"));
    closing.insert("badge".into(), json!(CLOSING_BADGE));
    closing.insert("title".into(), json!(article.closing_title));
    closing.insert("content".into(), json!(html_escape(&article.closing)));
    if !links.is_empty() {
        let actions: Vec<Value> = links
            .iter()
            .enumerate()
            .map(|(i, link)| {
                json!({
                    "label": link.title,
                    "href": link.route,
                    "variant": if i == 0 { "primary" } else { "secondary" },
                })
            })
            .collect();
        closing.insert("actions".into(), Value::Array(actions));
    }
    body.push(Value::Object(closing));

    let slug: Map<String, Value> = input
        .languages
        .iter()
        .map(|lang| {
            (
                (*lang).to_string(),
                json!(format!("/{lang}/blog/{}", brief.slug)),
            )
        })
        .collect();
    let seo_title = if input.brand_suffix.trim().is_empty() {
        article.title.clone()
    } else {
        format!("{} | {}", article.title, input.brand_suffix.trim())
    };
    let mut metadata = Map::new();
    metadata.insert("author".into(), json!(input.author));
    metadata.insert("category".into(), json!(article.category));
    metadata.insert("hero_media_id".into(), json!(hero.media_id));
    if let Some(image) = inline {
        metadata.insert("inline_media_id".into(), json!(image.media_id));
    }
    // A string: the id does not fit a JavaScript number.
    metadata.insert("brief_ref".into(), json!(input.brief_ref.to_string()));

    Ok(json!({
        "id": brief.content_id,
        "slug": slug,
        "title": {"en": article.title},
        "page_type": PAGE_TYPE,
        "seo": {
            "title": {"en": seo_title},
            "description": {"en": article.dek},
            "keywords": brief.keywords,
        },
        "body": body,
        "metadata": metadata,
        "status": DRAFT_STATUS,
    }))
}

// ---------------------------------------------------------------------------
// The article profile
// ---------------------------------------------------------------------------

/// A problem with an assembled page, scoped to a section where the page's
/// layout says which one. `Display` is `"[s2] /body/5/markdown: message"`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PageIssue {
    /// The section a repair should target; `None` for the envelope and for
    /// anything the orchestrator wrote itself.
    pub section: Option<SectionId>,
    /// JSON pointer into the page.
    pub pointer: String,
    /// `schema`, `profile`, `house_style`, `link`, `media`.
    pub code: String,
    pub message: String,
}

impl fmt::Display for PageIssue {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.section {
            Some(section) => write!(f, "[{section}] {}: {}", self.pointer, self.message),
            None => write!(f, "{}: {}", self.pointer, self.message),
        }
    }
}

/// The section each body block belongs to, by the layout [`assemble_page`]
/// writes: the hero is `title`, blocks before the first heading are `intro`,
/// each level-2 heading starts the next `sN`, the closing note is `closing`.
pub fn block_sections(body: &[Value]) -> Vec<Option<SectionId>> {
    let mut current = Some(SectionId::Intro);
    let mut count: u8 = 0;
    body.iter()
        .map(|block| match block["type"].as_str() {
            Some("editorial-hero") => Some(SectionId::Title),
            Some("closing-note") => Some(SectionId::Closing),
            Some("heading") => {
                count = count.saturating_add(1);
                current = Some(SectionId::Section(count));
                current
            }
            _ => current,
        })
        .collect()
}

/// The section a JSON pointer into a page falls in (`/body/<i>/…`).
pub fn section_of_pointer(page: &Value, pointer: &str) -> Option<SectionId> {
    let index: usize = pointer
        .strip_prefix("/body/")?
        .split('/')
        .next()?
        .parse()
        .ok()?;
    let body = page["body"].as_array()?;
    block_sections(body).get(index).copied().flatten()
}

/// The article profile: what an article page must look like for the frozen
/// theme to render it correctly, beyond the page schema.
///
/// - `page_type` is `blog-article`;
/// - only [`ARTICLE_BLOCKS`];
/// - exactly one `editorial-hero`, first (the page's only `<h1>`), then at
///   least one intro `paragraph`, then sections (a level-2 `heading` followed
///   by at least one block), then exactly one `closing-note`, last;
/// - no raw `<` or `>` in the two fields the theme renders through
///   `set:html` (`editorial-hero.title`, `closing-note.content`);
/// - every slug is `/<lang>/blog/<slug>` with the same `<slug>`;
/// - `seo.title` and `seo.description` are localized objects with a non-empty
///   `en` (the theme's route ignores plain strings there).
pub fn check_article_profile(page: &Value) -> Vec<PageIssue> {
    let mut out = Vec::new();
    let mut issue = |section: Option<SectionId>, pointer: String, message: String| {
        out.push(PageIssue {
            section,
            pointer,
            code: "profile".into(),
            message,
        });
    };

    if page["page_type"].as_str() != Some(PAGE_TYPE) {
        issue(
            None,
            "/page_type".into(),
            format!("an article's page_type is \"{PAGE_TYPE}\""),
        );
    }
    match page["slug"].as_object() {
        Some(slug) if !slug.is_empty() => {
            let mut stems = BTreeSet::new();
            for (lang, route) in slug {
                let stem = route
                    .as_str()
                    .and_then(|r| r.strip_prefix(&format!("/{lang}/blog/")))
                    .filter(|s| !s.is_empty() && !s.contains('/'));
                match stem {
                    Some(stem) => {
                        stems.insert(stem.to_string());
                    }
                    None => issue(
                        None,
                        format!("/slug/{lang}"),
                        format!("an article's {lang} slug is \"/{lang}/blog/<slug>\""),
                    ),
                }
            }
            if stems.len() > 1 {
                issue(
                    None,
                    "/slug".into(),
                    "every language must use the same slug".into(),
                );
            }
        }
        _ => issue(None, "/slug".into(), "an article needs a slug".into()),
    }
    // The theme's page route reads `seo.<field>.<lang>` and falls back to
    // `.en`; a plain string is ignored and the page gets an empty meta
    // description.
    for field in ["title", "description"] {
        let localized = page["seo"][field]["en"]
            .as_str()
            .is_some_and(|s| !s.trim().is_empty());
        if !localized {
            issue(
                Some(SectionId::Title),
                format!("/seo/{field}"),
                format!("an article's seo.{field} is {{\"en\": \"…\"}} and not empty"),
            );
        }
    }

    let empty = Vec::new();
    let body = page["body"].as_array().unwrap_or(&empty);
    let sections = block_sections(body);
    let types: Vec<&str> = body
        .iter()
        .map(|b| b["type"].as_str().unwrap_or_default())
        .collect();
    for (i, t) in types.iter().enumerate() {
        if !ARTICLE_BLOCKS.contains(t) {
            issue(
                sections[i],
                format!("/body/{i}/type"),
                format!("block type \"{t}\" is not part of an article"),
            );
        }
    }
    let count = |t: &str| types.iter().filter(|x| **x == t).count();
    if types.first() != Some(&"editorial-hero") || count("editorial-hero") != 1 {
        issue(
            Some(SectionId::Title),
            "/body".into(),
            "an article has exactly one editorial-hero, as its first block".into(),
        );
    }
    if types.last() != Some(&"closing-note") || count("closing-note") != 1 {
        issue(
            Some(SectionId::Closing),
            "/body".into(),
            "an article has exactly one closing-note, as its last block".into(),
        );
    }
    if types.get(1) != Some(&"paragraph") {
        issue(
            Some(SectionId::Intro),
            "/body/1".into(),
            "the hero is followed by at least one intro paragraph".into(),
        );
    }
    if count("heading") == 0 {
        issue(
            Some(SectionId::Whole),
            "/body".into(),
            "an article has at least one section heading".into(),
        );
    }
    for (i, block) in body.iter().enumerate() {
        match types[i] {
            "heading" => {
                if block["level"].as_u64() != Some(2) {
                    issue(
                        sections[i],
                        format!("/body/{i}/level"),
                        "section headings are level 2".into(),
                    );
                }
                let next = types.get(i + 1).copied().unwrap_or_default();
                if matches!(next, "" | "heading" | "closing-note" | "editorial-hero") {
                    issue(
                        sections[i],
                        format!("/body/{i}"),
                        "a heading is followed by at least one block of its section".into(),
                    );
                }
            }
            "editorial-hero" | "closing-note" => {
                let field = if types[i] == "editorial-hero" {
                    "title"
                } else {
                    "content"
                };
                if block[field]
                    .as_str()
                    .is_some_and(|s| s.contains(['<', '>']))
                {
                    issue(
                        sections[i],
                        format!("/body/{i}/{field}"),
                        format!(
                            "{}.{field} is rendered as HTML and must not contain < or >",
                            types[i]
                        ),
                    );
                }
            }
            _ => {}
        }
    }
    out
}

// ---------------------------------------------------------------------------
// Reading text and digests
// ---------------------------------------------------------------------------

fn write_section_text(draft: &SectionDraft, out: &mut String) {
    let blocks: Vec<String> = draft
        .blocks
        .iter()
        .map(|block| match block.kind {
            SectionBlockKind::Paragraph => block.text.clone(),
            SectionBlockKind::Tip => format!("Tip: {}", block.text),
            SectionBlockKind::List => block
                .items
                .iter()
                .map(|i| format!("- {i}"))
                .collect::<Vec<_>>()
                .join("\n"),
        })
        .collect();
    out.push_str(&blocks.join("\n\n"));
    out.push('\n');
}

fn render_reading(article: &CleanArticle) -> String {
    let mut out = format!("[title] {}\n", article.title);
    if !article.dek.is_empty() {
        out.push_str(&format!("[dek] {}\n", article.dek));
    }
    if !article.category.is_empty() {
        out.push_str(&format!("[category] {}\n", article.category));
    }
    out.push_str("\n[intro]\n");
    write_section_text(&article.intro, &mut out);
    for (i, (heading, draft)) in article.sections.iter().enumerate() {
        out.push_str(&format!("\n[s{}] {heading}\n", i + 1));
        write_section_text(draft, &mut out);
    }
    out.push_str(&format!(
        "\n[closing] {}\n{}\n",
        article.closing_title, article.closing
    ));
    out
}

/// The article as the editor reads it: plain text with a marker line per
/// section (`[title]`, `[dek]`, `[category]`, `[intro]`, `[s1] <heading>`, …,
/// `[closing] <title>`), not page JSON. The markers are the ids a
/// [`ReviewIssue`] names.
pub fn reading_text(parts: &ArticleParts) -> String {
    render_reading(&clean_article(parts))
}

/// [`reading_text`] recovered from an assembled page. For a page built by
/// [`assemble_page`] the two are equal: the editor reads what the page says.
/// Images are left out.
pub fn page_reading_text(page: &Value) -> String {
    let text = |v: &Value| v.as_str().unwrap_or_default().to_string();
    let mut article = CleanArticle {
        title: String::new(),
        dek: String::new(),
        category: String::new(),
        intro: SectionDraft { blocks: Vec::new() },
        sections: Vec::new(),
        closing_title: String::new(),
        closing: String::new(),
    };
    for block in page["body"].as_array().into_iter().flatten() {
        let kind = match block["type"].as_str() {
            Some("editorial-hero") => {
                article.title = html_unescape(&text(&block["title"]));
                article.dek = text(&block["subtitle"]);
                article.category = text(&block["badge"]);
                continue;
            }
            Some("closing-note") => {
                article.closing_title = text(&block["title"]);
                article.closing = html_unescape(&text(&block["content"]));
                continue;
            }
            Some("heading") => {
                article
                    .sections
                    .push((text(&block["text"]), SectionDraft { blocks: Vec::new() }));
                continue;
            }
            Some("paragraph") => SectionBlockKind::Paragraph,
            Some("callout") => SectionBlockKind::Tip,
            Some("list") => SectionBlockKind::List,
            _ => continue,
        };
        let block = SectionBlock {
            kind,
            text: match kind {
                SectionBlockKind::Paragraph => text(&block["markdown"]),
                SectionBlockKind::Tip => text(&block["content"]),
                SectionBlockKind::List => String::new(),
            },
            items: block["items"]
                .as_array()
                .into_iter()
                .flatten()
                .map(text)
                .collect(),
        };
        match article.sections.last_mut() {
            Some((_, draft)) => draft.blocks.push(block),
            None => article.intro.blocks.push(block),
        }
    }
    render_reading(&article)
}

/// Abbreviations whose full stop does not end a sentence.
const ABBREVIATIONS: [&str; 8] = ["e.g", "i.e", "vs", "approx", "mr", "mrs", "dr", "st"];

/// Splits plain text into sentences: after `.`, `!` or `?` (and any closing
/// quote or bracket) when the text ends or continues with whitespace and then
/// an uppercase letter, a digit or an opening quote.
pub fn sentences(text: &str) -> Vec<&str> {
    let chars: Vec<(usize, char)> = text.char_indices().collect();
    let mut out = Vec::new();
    let mut start = 0;
    let mut i = 0;
    while i < chars.len() {
        let (_, c) = chars[i];
        if matches!(c, '.' | '!' | '?') {
            let mut j = i + 1;
            while j < chars.len()
                && matches!(chars[j].1, '.' | '!' | '?' | '"' | '\'' | '”' | '’' | ')')
            {
                j += 1;
            }
            let end = chars.get(j).map_or(text.len(), |(at, _)| *at);
            let mut k = j;
            while k < chars.len() && chars[k].1.is_whitespace() {
                k += 1;
            }
            let boundary = match chars.get(k) {
                None => true,
                Some((_, next)) => {
                    k > j
                        && (next.is_uppercase()
                            || next.is_numeric()
                            || matches!(next, '"' | '“' | '‘' | '('))
                }
            };
            let word = text[start..chars[i].0]
                .rsplit(|c: char| c.is_whitespace())
                .next()
                .unwrap_or_default()
                .trim_start_matches(|c: char| !c.is_alphanumeric())
                .to_lowercase();
            let initial = word.chars().count() == 1 && word.chars().all(char::is_alphabetic);
            let abbreviation = c == '.' && (ABBREVIATIONS.contains(&word.as_str()) || initial);
            if boundary && !(abbreviation && chars.get(k).is_some()) {
                let sentence = text[start..end].trim();
                if !sentence.is_empty() {
                    out.push(sentence);
                }
                start = chars.get(k).map_or(text.len(), |(at, _)| *at);
                i = k;
                continue;
            }
            i = j;
            continue;
        }
        i += 1;
    }
    let rest = text[start..].trim();
    if !rest.is_empty() {
        out.push(rest);
    }
    out
}

/// What a later section is told about an earlier one: its heading, its first
/// sentence and its last sentence (about 60 tokens).
pub fn section_digest(heading: &str, draft: &SectionDraft) -> String {
    let draft = draft.sanitized();
    let texts: Vec<&str> = draft
        .blocks
        .iter()
        .flat_map(|b| {
            std::iter::once(b.text.as_str())
                .chain(b.items.iter().map(String::as_str))
                .filter(|t| !t.is_empty())
        })
        .collect();
    let heading = sanitize_plain(heading).0;
    let first = texts.first().and_then(|t| sentences(t).into_iter().next());
    let last = texts.last().and_then(|t| sentences(t).into_iter().last());
    match (first, last) {
        (Some(first), Some(last)) if first != last => format!(
            "{heading}: {} […] {}",
            excerpt(first, 160),
            excerpt(last, 160)
        ),
        (Some(only), _) => format!("{heading}: {}", excerpt(only, 160)),
        _ => heading,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The pipeline's stricter profile stands on the registry's article type
    /// (FEAT-089): the same id and the same blocks.
    #[test]
    fn the_article_blocks_are_the_registry_s() {
        let t = content_model::PageTypes::core().get(PAGE_TYPE).unwrap();
        assert_eq!(t.id, PAGE_TYPE);
        let mut registry = t.allowed_blocks().unwrap();
        let mut ours = ARTICLE_BLOCKS.to_vec();
        registry.sort_unstable();
        ours.sort_unstable();
        assert_eq!(registry, ours);
    }

    #[test]
    fn section_ids_round_trip_and_reject_lookalikes() {
        for (text, id) in [
            ("title", SectionId::Title),
            ("intro", SectionId::Intro),
            ("s1", SectionId::Section(1)),
            ("s12", SectionId::Section(12)),
            ("closing", SectionId::Closing),
            ("whole", SectionId::Whole),
        ] {
            assert_eq!(text.parse::<SectionId>().unwrap(), id);
            assert_eq!(id.to_string(), text);
            assert_eq!(serde_json::to_value(id).unwrap(), json!(text));
            assert_eq!(
                serde_json::from_value::<SectionId>(json!(text)).unwrap(),
                id
            );
        }
        for bad in [
            "", "s", "s01", "s+1", "s-1", "S1", "s999", "section1", "body",
        ] {
            assert!(bad.parse::<SectionId>().is_err(), "{bad}");
        }
        assert!(SectionId::Title < SectionId::Intro);
        assert!(SectionId::Intro < SectionId::Section(1));
        assert!(SectionId::Section(1) < SectionId::Section(2));
        assert!(SectionId::Section(9) < SectionId::Closing);
    }

    #[test]
    fn sentences_split_on_terminators_but_not_abbreviations() {
        assert_eq!(
            sentences("The 7.5 km walk is steep. Take water, e.g. two litres! \"Really?\" Yes."),
            vec![
                "The 7.5 km walk is steep.",
                "Take water, e.g. two litres!",
                "\"Really?\"",
                "Yes."
            ]
        );
        assert_eq!(sentences("No terminator here"), vec!["No terminator here"]);
        assert_eq!(
            sentences("Ask at St. Peter's church. It opens at 9."),
            vec!["Ask at St. Peter's church.", "It opens at 9."]
        );
        assert!(sentences("  ").is_empty());
    }

    #[test]
    fn sized_urls_keep_the_image_identity() {
        assert_eq!(
            sized_media_url(
                "https://images.unsplash.com/photo-1?q=80&w=2670&auto=format&fit=crop",
                2000
            ),
            "https://images.unsplash.com/photo-1?q=80&w=2000&auto=format&fit=crop"
        );
        assert_eq!(
            sized_media_url("https://cdn.example/a.webp?v=3", 2000),
            "https://cdn.example/a.webp?v=3"
        );
    }
}
