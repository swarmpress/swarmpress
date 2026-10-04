//! The pure side of the eval harness that qualifies the article pipeline
//! before it goes live (FEAT-036, ADR-0057, ADR-0058;
//! `docs/design/mvp-pipeline.md` §9).
//!
//! The harness (`apps/game/eval.html`) runs briefs through the real staged
//! Draft and Review jobs in the browser; what it needs besides the jobs is
//! here, so that it is the same Rust code natively and in orchestrator-wasm:
//!
//! - [`gateway_checks`]: the checks the central gateway runs on a draft
//!   before it commits it (`check_draft` and the pure parts of
//!   `check_against_site` in `crates/server/src/gateway.rs`): the article
//!   path, the article profile (`content_model::article_profile`, the very
//!   function the server calls), create-only against the site's pages, and
//!   the closed world (`KnowledgeBase::closed_world_issues`, the server's
//!   `ClosedWorld` text). Only the path policy of the GitHub client is not
//!   repeated: the harness writes article paths only.
//! - [`eval_checks`]: the deterministic checks of §9 on one article (words
//!   against target, banned phrases, near-duplicate paragraphs, heading
//!   structure, plain text, title and description length, the staged
//!   validator, the gateway).
//! - [`reference_article`]: an existing article of the site as a reviewable
//!   artifact (its parts, re-assembled in the article profile), for the
//!   editor's positive controls.
//! - [`seeded_bad`]: a good article made bad in one of [`SEED_KINDS`] ways,
//!   deterministically, for the editor's discrimination test.

use agents::article::{
    assemble_page, near_duplicate, page_reading_text, sanitize_plain, ArticleInput, ArticleParts,
    Closing, HeroOption, Outline, OutlineSection, SectionBlock, SectionBlockKind, SectionDraft,
    THEME_LANGUAGES,
};
use agents::pipeline::Brief;
use content_model::article_profile::{
    article_slug, check_article_profile, is_article_path, is_blog_index_path,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::article::ArticleContext;
use crate::run::SiteBinding;
use crate::store::{ArtifactRecord, StoredParts};

/// The ways [`seeded_bad`] spoils a good article.
pub const SEED_KINDS: [&str; 6] = [
    "block-order",
    "banned-phrase",
    "unknown-entity",
    "too-short",
    "raw-html",
    "duplicate-slug",
];

/// The gateway's page size limit by default (`SWARMPRESS_MAX_PAGE_BYTES`).
pub const MAX_PAGE_BYTES: usize = 2 * 1024 * 1024;

/// Words within this share of the target pass (`±25%`, §9 threshold 4).
pub const WORDS_TOLERANCE_PERCENT: u32 = 25;

/// An article the harness can review: its brief and the artifact record a
/// Review job reads (page and parts).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EvalArticle {
    pub brief: Brief,
    pub record: ArtifactRecord,
    /// Where it came from: the reference's repo path, or
    /// `seeded:<kind>:<source>`.
    pub source: String,
    /// What was done to it (seeded) or how it was read (reference).
    #[serde(default)]
    pub notes: Vec<String>,
}

/// The deterministic checks of one article (§9 "Reported").
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EvalChecks {
    pub words: u32,
    pub target_words: u32,
    /// Words as a percentage of the target.
    pub words_percent: u32,
    /// Within ±[`WORDS_TOLERANCE_PERCENT`] of the target.
    pub words_ok: bool,
    /// Banned phrases (the style guide's `vocabulary.avoid`) anywhere in the
    /// text the page shows.
    pub banned_phrases: Vec<String>,
    /// Pairs of paragraphs that say the same thing in nearly the same words.
    pub near_duplicates: u32,
    /// Section headings (`heading` blocks).
    pub headings: u32,
    /// Every heading is level 2 and followed by a block of its section.
    pub headings_ok: bool,
    pub title_chars: u32,
    pub description_chars: u32,
    /// Title 10–70 characters, description 40–160 (the outline schema's bounds).
    pub title_ok: bool,
    pub description_ok: bool,
    /// URLs and raw `<`/`>` in the text the page shows.
    pub plain_text_findings: Vec<String>,
    /// Links that do not resolve and media not in the index.
    pub link_media_issues: Vec<String>,
    /// The staged Draft job's validator (schema v2, article profile, house
    /// style, closed world): empty means the orchestrator would commit it.
    pub site_issues: Vec<String>,
    /// The central gateway's checks ([`gateway_checks`]): empty means the
    /// server would accept the draft.
    pub gateway_issues: Vec<String>,
    /// The measured checks as the editor reads them beside the text.
    pub measured: Vec<String>,
}

impl EvalChecks {
    /// Every deterministic check passes.
    pub fn passes(&self) -> bool {
        self.words_ok
            && self.banned_phrases.is_empty()
            && self.near_duplicates == 0
            && self.headings_ok
            && self.title_ok
            && self.description_ok
            && self.plain_text_findings.is_empty()
            && self.link_media_issues.is_empty()
            && self.site_issues.is_empty()
            && self.gateway_issues.is_empty()
    }
}

// ---------------------------------------------------------------- the gateway's checks

/// What the central gateway refuses about a draft of `page` at `path` for
/// `content_id`, as its error texts; empty means it would be committed.
///
/// The same rules, in the same order, as `check_draft` and the pure part of
/// `check_against_site` (`crates/server/src/gateway.rs`), with the site's
/// knowledge base standing in for the base branch: a path the site's page
/// registry lists exists on the base branch.
pub fn gateway_checks(
    site: &SiteBinding,
    content_id: &str,
    path: &str,
    page: &Value,
) -> Vec<String> {
    let mut out = Vec::new();
    if !path.starts_with("content/") || path.contains("..") {
        out.push(format!("{path}: the gateway writes under content/ only"));
    }
    if !path.to_ascii_lowercase().ends_with(".json") {
        out.push(format!("{path}: the gateway only writes .json pages"));
    }
    if !page.is_object() {
        out.push("page must be a JSON object".into());
        return out;
    }
    let size = page.to_string().len();
    if size > MAX_PAGE_BYTES {
        out.push(format!(
            "page is {size} bytes; the limit is {MAX_PAGE_BYTES}"
        ));
    }
    if is_blog_index_path(path) {
        out.push(format!(
            "{path} is written by the gateway when an article is merged"
        ));
    }
    if is_article_path(path) {
        if let Err(issues) = check_article_profile(page, path, content_id) {
            out.extend(issues);
        }
    }
    if let Some(k) = site.knowledge.as_ref() {
        if k.kb.pages.pages.iter().any(|p| p.path == path) {
            out.push(format!(
                "{path} already exists on the base branch: article paths are create-only"
            ));
        }
        out.extend(
            k.kb.closed_world_issues(page)
                .iter()
                .map(ToString::to_string),
        );
    }
    out
}

// ---------------------------------------------------------------- the deterministic checks

fn chars(s: &str) -> u32 {
    u32::try_from(s.chars().count()).unwrap_or(u32::MAX)
}

/// The deterministic checks of `record`'s page (and parts, when it has them)
/// against its brief.
pub fn eval_checks(site: &SiteBinding, brief: &Brief, record: &ArtifactRecord) -> EvalChecks {
    let empty = json!({});
    let page = record.page.as_ref().unwrap_or(&empty);
    let parts = record.parts.as_ref().map(StoredParts::to_parts);
    let words = parts
        .as_ref()
        .map_or_else(|| crate::article::word_count(page), ArticleParts::words);
    let target = brief.target_words.max(1);
    let words_percent =
        u32::try_from(u64::from(words) * 100 / u64::from(target)).unwrap_or(u32::MAX);
    let words_ok = words_percent.abs_diff(100) <= WORDS_TOLERANCE_PERCENT;

    let reading = page_reading_text(page);
    let style = &site.context.style_guide;
    let mut banned: Vec<String> = style.banned_phrase_hits(&reading);
    banned.sort();
    banned.dedup();

    let body: Vec<Value> = page["body"].as_array().cloned().unwrap_or_default();
    let paragraphs: Vec<String> = body
        .iter()
        .filter_map(|b| match b["type"].as_str() {
            Some("paragraph") => b["markdown"].as_str(),
            Some("callout") => b["content"].as_str(),
            _ => None,
        })
        .map(String::from)
        .collect();
    let mut near = 0u32;
    for (i, a) in paragraphs.iter().enumerate() {
        for b in &paragraphs[i + 1..] {
            if near_duplicate(a, b) {
                near += 1;
            }
        }
    }

    let mut headings = 0u32;
    let mut headings_ok = true;
    for (i, b) in body.iter().enumerate() {
        if b["type"] == "heading" {
            headings += 1;
            let next = body.get(i + 1).and_then(|n| n["type"].as_str());
            if b["level"].as_u64() != Some(2)
                || matches!(
                    next,
                    None | Some("heading" | "closing-note" | "editorial-hero")
                )
            {
                headings_ok = false;
            }
        }
    }
    headings_ok &= headings > 0;

    let title = page["seo"]["title"]["en"]
        .as_str()
        .map(|t| t.rsplit_once(" | ").map_or(t, |(head, _)| head))
        .unwrap_or_default();
    let description = page["seo"]["description"]["en"]
        .as_str()
        .unwrap_or_default();
    let (title_chars, description_chars) = (chars(title), chars(description));

    let mut plain: Vec<String> = Vec::new();
    for line in reading.lines() {
        for finding in sanitize_plain(line).1.into_iter().filter(|f| f.is_error()) {
            let text = finding.to_string();
            if !plain.contains(&text) {
                plain.push(text);
            }
        }
    }

    let link_media_issues = site
        .knowledge
        .as_ref()
        .map(|k| {
            k.kb.closed_world_issues(page)
                .iter()
                .map(ToString::to_string)
                .collect()
        })
        .unwrap_or_default();
    let site_issues = site
        .validator_v2
        .as_ref()
        .map(|v| v.check(page).iter().map(ToString::to_string).collect())
        .unwrap_or_default();
    let path = record.path.clone().unwrap_or_else(|| brief.page_path());
    EvalChecks {
        words,
        target_words: brief.target_words,
        words_percent,
        words_ok,
        banned_phrases: banned,
        near_duplicates: near,
        headings,
        headings_ok,
        title_chars,
        description_chars,
        title_ok: (10..=70).contains(&title_chars),
        description_ok: (40..=160).contains(&description_chars),
        plain_text_findings: plain,
        link_media_issues,
        site_issues,
        gateway_issues: gateway_checks(site, &brief.content_id, &path, page),
        measured: crate::staged::measured_checks(site, brief, page, parts.as_ref()),
    }
}

// ---------------------------------------------------------------- references

/// Text without HTML tags and with the common entities decoded (the
/// existing articles keep a few HTML fields).
fn strip_html(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut in_tag = false;
    for c in text.chars() {
        match c {
            '<' => in_tag = true,
            '>' if in_tag => {
                in_tag = false;
                out.push(' ');
            }
            c if !in_tag => out.push(c),
            _ => {}
        }
    }
    let out = out
        .replace("&nbsp;", " ")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&amp;", "&");
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn text_of(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Object(m) => m
            .get("en")
            .or_else(|| m.values().next())
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        _ => String::new(),
    }
}

/// Paragraph blocks of a text: one per blank-line-separated paragraph.
fn paragraphs_of(text: &str) -> Vec<SectionBlock> {
    text.split("\n\n")
        .map(strip_html)
        .filter(|p| !p.is_empty())
        .map(|p| SectionBlock {
            kind: SectionBlockKind::Paragraph,
            text: p,
            items: Vec::new(),
        })
        .collect()
}

/// An existing article read as parts.
struct Read {
    title: String,
    dek: String,
    category: String,
    image: String,
    author: String,
    keywords: Vec<String>,
    intro: Vec<SectionBlock>,
    sections: Vec<(String, Vec<SectionBlock>)>,
    closing_title: String,
    closing: String,
}

fn push_blocks(r: &mut Read, blocks: Vec<SectionBlock>) {
    match r.sections.last_mut() {
        Some((_, s)) => s.extend(blocks),
        None => r.intro.extend(blocks),
    }
}

fn texts_of(v: &Value) -> Vec<String> {
    match v {
        Value::Array(a) => a.iter().map(text_of).filter(|t| !t.is_empty()).collect(),
        Value::Object(m) => m
            .get("en")
            .or_else(|| m.values().next())
            .map(texts_of)
            .unwrap_or_default(),
        _ => Vec::new(),
    }
}

/// The fields of the site's `blog-article` block: under `post` (the older
/// form) or on the block itself (title, subtitle, author, category, image,
/// tags).
fn read_post(r: &mut Read, post: &Value) {
    let set = |slot: &mut String, v: &Value| {
        let t = strip_html(&text_of(v));
        if !t.is_empty() {
            *slot = t;
        }
    };
    set(&mut r.title, &post["title"]);
    set(&mut r.dek, &post["subtitle"]);
    set(&mut r.category, &post["category"]);
    let image = text_of(&post["image"]);
    if !image.is_empty() {
        r.image = image;
    }
    match &post["author"] {
        Value::String(a) => r.author = a.clone(),
        a @ Value::Object(_) => set(&mut r.author, &a["name"]),
        _ => {}
    }
    let tags = texts_of(&post["tags"]);
    if !tags.is_empty() {
        r.keywords = tags;
    }
}

/// A list item as text: a plain string, or `title: text` of a tip.
fn item_text(i: &Value) -> String {
    if i.is_object() {
        ["title", "text", "description", "content"]
            .iter()
            .map(|k| strip_html(&text_of(&i[*k])))
            .filter(|t| !t.is_empty())
            .collect::<Vec<_>>()
            .join(": ")
    } else {
        strip_html(&text_of(i))
    }
}

/// One block of an existing article, into the parts being read.
fn read_block(r: &mut Read, block: &Value) {
    match block["type"].as_str().unwrap_or_default() {
        "blog-article" => {
            read_post(r, block);
            if block["post"].is_object() {
                read_post(r, &block["post"]);
            }
            let content = &block["content"];
            match content {
                // The block-list form: lead, heading, paragraph, quote, tip-list, image …
                Value::Array(items) => items.iter().for_each(|b| read_block(r, b)),
                // The older form: intro, sections [{title, text}], quote.
                _ => {
                    r.intro.extend(paragraphs_of(&text_of(&content["intro"])));
                    for s in content["sections"].as_array().into_iter().flatten() {
                        r.sections.push((
                            strip_html(&text_of(&s["title"])),
                            paragraphs_of(&text_of(&s["text"])),
                        ));
                    }
                    if let Some(q) = content["quote"]["text"].as_str() {
                        r.closing = strip_html(q);
                    }
                }
            }
        }
        "editorial-hero" => {
            r.title = strip_html(&text_of(&block["title"]));
            r.dek = strip_html(&text_of(&block["subtitle"]));
            r.category = text_of(&block["badge"]);
            r.image = text_of(&block["image"]);
        }
        "closing-note" => {
            r.closing_title = strip_html(&text_of(&block["title"]));
            r.closing = strip_html(&text_of(&block["content"]));
        }
        "heading" => r
            .sections
            .push((strip_html(&text_of(&block["text"])), Vec::new())),
        "list" | "tip-list" => {
            let items: Vec<String> = block["items"]
                .as_array()
                .into_iter()
                .flatten()
                .map(item_text)
                .filter(|i| !i.is_empty())
                .collect();
            if !items.is_empty() {
                push_blocks(
                    r,
                    vec![SectionBlock {
                        kind: SectionBlockKind::List,
                        text: String::new(),
                        items,
                    }],
                );
            }
        }
        "callout" => {
            let text = strip_html(&text_of(&block["content"]));
            if !text.is_empty() {
                push_blocks(
                    r,
                    vec![SectionBlock {
                        kind: SectionBlockKind::Tip,
                        text,
                        items: Vec::new(),
                    }],
                );
            }
        }
        "image" | "image-pair" | "gallery" => {}
        // Every other text block (paragraph, lead, editorial-intro,
        // editor-note, quote) is read as paragraphs.
        _ => {
            for field in ["markdown", "content", "text"] {
                let text = text_of(&block[field]);
                if !text.is_empty() {
                    push_blocks(r, paragraphs_of(&text));
                    break;
                }
            }
        }
    }
}

/// The site's article shapes: the `blog-article` block (its fields under
/// `post` with `content.intro/sections/quote`, or on the block with
/// `content` as a block list), and the block list of the article profile
/// (`editorial-hero` … `closing-note`).
fn read_article(page: &Value) -> Read {
    let mut r = Read {
        title: String::new(),
        dek: String::new(),
        category: String::new(),
        image: String::new(),
        author: page["metadata"]["author"]
            .as_str()
            .unwrap_or_default()
            .to_string(),
        keywords: page["seo"]["keywords"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(String::from)
            .collect(),
        intro: Vec::new(),
        sections: Vec::new(),
        closing_title: String::new(),
        closing: String::new(),
    };
    for block in page["body"].as_array().into_iter().flatten() {
        read_block(&mut r, block);
    }
    if r.title.is_empty() {
        r.title = text_of(&page["title"])
            .rsplit_once(" | ")
            .map_or_else(|| text_of(&page["title"]), |(h, _)| h.to_string());
    }
    if r.dek.is_empty() {
        r.dek = text_of(&page["seo"]["description"]);
    }
    r
}

/// The brief ref of an eval article: stable, and exact as a JS number (the
/// harness parses the records it gets back with `JSON.parse`).
pub fn eval_brief_ref(content_id: &str) -> u64 {
    xxhash_rust::xxh3::xxh3_64(content_id.as_bytes()) & ((1u64 << 53) - 1)
}

/// The page of `parts` as the staged Draft job assembles it.
fn assemble(
    site: &SiteBinding,
    brief: &Brief,
    brief_ref: u64,
    author: &str,
    parts: &ArticleParts,
    ctx: &ArticleContext,
) -> Result<Value, String> {
    assemble_page(&ArticleInput {
        brief,
        brief_ref,
        author,
        brand_suffix: &site.seo_suffix,
        languages: &THEME_LANGUAGES,
        parts,
        heroes: &ctx.heroes,
        links: &ctx.links,
        inline_image: false,
    })
    .map_err(|e| e.to_string())
}

fn record_of(
    brief: &Brief,
    brief_ref: u64,
    page: Value,
    parts: &ArticleParts,
    hero: HeroOption,
    ctx: ArticleContext,
) -> ArtifactRecord {
    ArtifactRecord {
        brief_ref,
        page: Some(page),
        path: Some(brief.page_path()),
        parts: Some(StoredParts::new(parts, hero, ctx)),
        ..ArtifactRecord::default()
    }
}

/// An existing article (`path`, its page JSON) as a reviewable artifact: its
/// text read into parts (intro, one section per heading, the closing note or
/// the closing quote) and re-assembled in the article profile, so the editor
/// reads it exactly as it reads a staged draft. The brief's target is the
/// article's own length: a reference is judged on what it says.
pub fn reference_article(
    site: &SiteBinding,
    path: &str,
    page: &Value,
) -> Result<EvalArticle, String> {
    let r = read_article(page);
    let mut notes = Vec::new();
    let mut intro = r.intro;
    let mut sections = r.sections;
    sections.retain(|(_, blocks)| !blocks.is_empty());
    if intro.is_empty() {
        if let Some((_, first)) = sections.first_mut() {
            if !first.is_empty() {
                intro.push(first.remove(0));
                notes.push(
                    "no intro: the first paragraph of the first section is read as the intro"
                        .into(),
                );
            }
        }
        sections.retain(|(_, blocks)| !blocks.is_empty());
    }
    if sections.is_empty() && intro.len() > 1 {
        let rest = intro.split_off(1);
        sections.push(("The story".into(), rest));
        notes.push(
            "no section headings: everything after the first paragraph is one section".into(),
        );
    }
    let mut closing = r.closing;
    if closing.is_empty() {
        closing = r.dek.clone();
        notes.push("no closing note or quote: the description stands in".into());
    }
    if intro.is_empty() || sections.is_empty() {
        return Err(format!("{path}: no article text to review"));
    }

    let slug = article_slug(path)
        .map(String::from)
        .or_else(|| {
            path.rsplit('/')
                .next()
                .and_then(|f| f.strip_suffix(".json"))
                .map(String::from)
        })
        .unwrap_or_default();
    let content_id = page["id"].as_str().unwrap_or(&slug).to_string();
    let draft = |blocks: Vec<SectionBlock>| SectionDraft { blocks };
    let mut parts = ArticleParts {
        outline: Outline {
            title: r.title.clone(),
            dek: r.dek.clone(),
            category: if r.category.is_empty() {
                "Guides".into()
            } else {
                r.category.clone()
            },
            hero: "M1".into(),
            sections: Vec::new(),
            closing_title: if r.closing_title.is_empty() {
                "Before you go".into()
            } else {
                r.closing_title.clone()
            },
            links: Vec::new(),
        },
        intro: draft(intro),
        sections: Vec::new(),
        closing: Closing { content: closing },
    };
    for (heading, blocks) in sections {
        let d = draft(blocks);
        parts.outline.sections.push(OutlineSection {
            heading,
            points: Vec::new(),
            words: d.words(),
        });
        parts.sections.push(d);
    }
    let brief = Brief {
        content_id,
        title: r.title.clone(),
        slug,
        angle: r.dek.clone(),
        keywords: r.keywords,
        target_words: parts.words().max(1),
        language: site.language.clone(),
        notes: String::new(),
    };
    let image = if r.image.is_empty() {
        notes.push("no hero image: the media index's first remote image stands in".into());
        site.knowledge
            .as_ref()
            .and_then(|k| {
                k.kb.media
                    .entries
                    .iter()
                    .find(|e| e.url.starts_with("http"))
                    .map(|e| e.url.clone())
            })
            .unwrap_or_default()
    } else {
        r.image.clone()
    };
    let media_id = site
        .knowledge
        .as_ref()
        .and_then(|k| k.kb.media.get(&image).map(|e| e.id.clone()))
        .unwrap_or_default();
    let hero = HeroOption {
        alias: "M1".into(),
        media_id,
        url: image,
        alt: r.title,
        about: String::new(),
        credit: None,
    };
    let ctx = ArticleContext {
        heroes: vec![hero.clone()],
        links: Vec::new(),
        facts: Vec::new(),
        related: Vec::new(),
        categories: Vec::new(),
    };
    let brief_ref = eval_brief_ref(&brief.content_id);
    let author = if r.author.is_empty() {
        site.brand_name.clone()
    } else {
        r.author
    };
    let page = assemble(site, &brief, brief_ref, &author, &parts, &ctx)
        .map_err(|e| format!("{path}: {e}"))?;
    Ok(EvalArticle {
        record: record_of(&brief, brief_ref, page, &parts, hero, ctx),
        brief,
        source: path.to_string(),
        notes,
    })
}

// ---------------------------------------------------------------- seeded-bad drafts

/// The first sentence of a text (or the text, when it has none).
fn first_sentence(text: &str) -> String {
    agents::article::sentences(text)
        .first()
        .map_or_else(|| text.to_string(), |s| (*s).to_string())
}

/// A slug the site already has, other than `own`: the first article of the
/// site's page registry by path, else any page's file stem.
fn existing_slug(site: &SiteBinding, own: &str) -> Option<String> {
    let k = site.knowledge.as_ref()?;
    let stems: Vec<&str> =
        k.kb.pages
            .pages
            .iter()
            .filter_map(|p| article_slug(&p.path))
            .filter(|s| *s != own)
            .collect();
    stems.first().map(|s| (*s).to_string())
}

/// `good` spoiled in the way `kind` names (one of [`SEED_KINDS`]),
/// deterministically. The text and the page stay consistent where the
/// spoiling is in the text (the editor reads the parts, the checks the
/// page); a page-only fault (block order, a raw HTML field, an unknown link)
/// is visible to the editor through the measured checks.
pub fn seeded_bad(
    site: &SiteBinding,
    good: &EvalArticle,
    kind: &str,
) -> Result<EvalArticle, String> {
    let stored = good
        .record
        .parts
        .as_ref()
        .ok_or("a seeded draft needs the parts of a good one")?;
    let mut parts = stored.to_parts();
    let ctx = stored.context.clone();
    let hero = stored.hero.clone();
    let mut brief = good.brief.clone();
    brief.content_id = format!("{}-bad-{kind}", good.brief.content_id);
    let author = good
        .record
        .page
        .as_ref()
        .and_then(|p| p["metadata"]["author"].as_str())
        .unwrap_or(&site.brand_name)
        .to_string();
    let mut notes = Vec::new();
    let first_paragraph = |parts: &mut ArticleParts| -> Option<usize> {
        parts
            .intro
            .blocks
            .iter()
            .position(|b| b.kind == SectionBlockKind::Paragraph)
    };

    // Text faults first (the page is assembled from the parts) ...
    match kind {
        "banned-phrase" => {
            let phrase = site
                .context
                .style_guide
                .banned_phrases()
                .first()
                .cloned()
                .unwrap_or_else(|| "hidden gem".into());
            let at = first_paragraph(&mut parts).ok_or("no intro paragraph")?;
            let block = &mut parts.intro.blocks[at];
            block.text = format!("Truly a {phrase}, this corner of the coast. {}", block.text);
            notes.push(format!("the banned phrase {phrase:?} opens the intro"));
        }
        "unknown-entity" => {
            let at = first_paragraph(&mut parts).ok_or("no intro paragraph")?;
            let block = &mut parts.intro.blocks[at];
            block.text = format!(
                "{} From here a short walk leads to Atlantis, the sixth village of the coast.",
                block.text
            );
            notes.push("a village the site does not have (Atlantis), linked from the closing note, and a hero image outside the media index".into());
        }
        "too-short" => {
            let shorten = |d: &mut SectionDraft| {
                d.blocks.truncate(1);
                if let Some(b) = d.blocks.first_mut() {
                    if b.kind == SectionBlockKind::List {
                        b.items.truncate(1);
                    } else {
                        b.text = first_sentence(&b.text);
                    }
                }
            };
            shorten(&mut parts.intro);
            parts.sections.iter_mut().for_each(shorten);
            parts.closing.content = first_sentence(&parts.closing.content);
            notes.push("every part cut to its first sentence".into());
        }
        "raw-html" => {
            let at = first_paragraph(&mut parts).ok_or("no intro paragraph")?;
            let block = &mut parts.intro.blocks[at];
            block.text = format!("{} <b>Book now</b> <script>track()</script>", block.text);
            notes.push(
                "raw HTML in the intro and in the hero title, which the theme prints as HTML"
                    .into(),
            );
        }
        "duplicate-slug" => {
            let slug = existing_slug(site, &good.brief.slug)
                .ok_or("the site has no other article to collide with")?;
            notes.push(format!("the slug of the existing article {slug:?}"));
            brief.slug = slug;
        }
        "block-order" => notes.push("the closing note first and the hero last".into()),
        other => {
            return Err(format!(
                "unknown seeded fault {other:?} (one of {SEED_KINDS:?})"
            ))
        }
    }
    let brief_ref = eval_brief_ref(&brief.content_id);
    let mut page = assemble(site, &brief, brief_ref, &author, &parts, &ctx)?;

    // ... then the faults that are in the page only.
    let body = page["body"]
        .as_array_mut()
        .ok_or("the assembled page has no body")?;
    match kind {
        "block-order" => {
            let last = body.len() - 1;
            body.swap(0, last);
        }
        "unknown-entity" => {
            if let Some(closing) = body.last_mut() {
                let action = json!({"label": "Visit Atlantis", "href": "/en/atlantis", "variant": "primary"});
                match closing["actions"].as_array_mut() {
                    Some(actions) => actions.insert(0, action),
                    None => closing["actions"] = json!([action]),
                }
            }
            if let Some(h) = body.first_mut() {
                h["image"] = json!("https://images.unsplash.com/photo-0000000000000-atlantis?q=80&w=2000&auto=format&fit=crop");
            }
        }
        "raw-html" => {
            if let Some(h) = body.first_mut() {
                let title = h["title"].as_str().unwrap_or_default().to_string();
                h["title"] = json!(format!("<em>{title}</em>"));
            }
        }
        _ => {}
    }
    Ok(EvalArticle {
        record: record_of(&brief, brief_ref, page, &parts, hero, ctx),
        brief,
        source: format!("seeded:{kind}:{}", good.source),
        notes,
    })
}
