//! The MVP article: its block subset, writer docs, validator and helpers.
//!
//! Two generations live here side by side until the staged Draft job lands
//! (ADR-0058):
//!
//! - the single-call article ([`article_schema`], [`ARTICLE_BLOCK_DOCS`],
//!   [`site_validator`]) that `run.rs` uses today;
//! - the closed world of the staged article (`docs/design/mvp-pipeline.md`
//!   §3 and §4): the `context#0` shortlists built from the site's knowledge
//!   base ([`hero_shortlist`], [`link_shortlist`], [`entity_facts`],
//!   [`related_titles`], gathered by [`article_context`]) and
//!   [`site_validator_v2`]. The model only ever sees shortlist aliases;
//!   `agents::article::assemble_page` resolves them, and the validator checks
//!   the assembled page against the same indexes.
//!
//! The shortlists live in this crate, not in `agents`: `knowledge` is
//! compiled into the orchestrator (ADR-0061), and `agents` stays free of the
//! site's indexes and handles shortlists as plain data.

use std::collections::{BTreeSet, VecDeque};
use std::sync::Arc;

use agents::article::{
    check_article_profile, section_of_pointer, HeroOption, LinkOption, PageIssue,
};
use agents::house_style::contains_phrase;
use agents::pipeline::{Brief, PageValidator};
use agents::prompts::SiteContext;
use agents::StyleGuide;
use content_model::{block_meta, url_identity, validate_page_v2, SchemaRegistry};
use knowledge::{Entity, EntityKind, KnowledgeBase, LinkCandidate, MediaEntry};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// The block subset writers use in the MVP. Every block here is a core block
/// of the canonical page schema, so pages validate against content-schema.
pub fn article_schema() -> Value {
    let text = json!({"type": "string", "minLength": 1});
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["id", "slug", "title", "page_type", "seo", "body"],
        "properties": {
            "id": text,
            "slug": {"type": "object", "additionalProperties": false, "required": ["en"], "properties": {"en": text}},
            "title": {"type": "object", "additionalProperties": false, "required": ["en"], "properties": {"en": text}},
            "page_type": {"type": "string", "enum": ["blog-article"]},
            "seo": {"type": "object", "additionalProperties": false, "required": ["title", "description"],
                    "properties": {"title": text, "description": text}},
            "body": {"type": "array", "minItems": 3, "items": {"anyOf": [
                {"type": "object", "additionalProperties": false, "required": ["type", "markdown"],
                 "properties": {"type": {"const": "paragraph"}, "markdown": text}},
                {"type": "object", "additionalProperties": false, "required": ["type", "level", "text"],
                 "properties": {"type": {"const": "heading"}, "level": {"type": "integer", "enum": [2, 3, 4]}, "text": text}},
                {"type": "object", "additionalProperties": false, "required": ["type", "text"],
                 "properties": {"type": {"const": "quote"}, "text": text, "attribution": {"type": "string"}}},
                {"type": "object", "additionalProperties": false, "required": ["type", "ordered", "items"],
                 "properties": {"type": {"const": "list"}, "ordered": {"type": "boolean"},
                                "items": {"type": "array", "minItems": 1, "items": text}}},
                {"type": "object", "additionalProperties": false, "required": ["type", "style", "content"],
                 "properties": {"type": {"const": "callout"}, "style": {"type": "string", "enum": ["info", "warning", "success", "error"]},
                                "title": {"type": "string"}, "content": text}},
                {"type": "object", "additionalProperties": false, "required": ["type", "items"],
                 "properties": {"type": {"const": "faq"}, "items": {"type": "array", "minItems": 1, "items": {
                     "type": "object", "additionalProperties": false, "required": ["question", "answer"],
                     "properties": {"question": text, "answer": text}}}}}
            ]}}
        }
    })
}

/// Writer-facing docs for [`article_schema`] (generated docs for the full
/// catalogue come with the site-kit, ADR-0014).
pub const ARTICLE_BLOCK_DOCS: &str = "\
- `paragraph` { markdown }: one idea per paragraph; plain text with **bold**/_italic_ only.
- `heading` { level: 2|3|4, text }: sentence-case section headings.
- `quote` { text, attribution? }: only real, attributable quotes from the material you were given.
- `list` { ordered, items[] }: practical steps or options.
- `callout` { style: info|warning|success|error, title?, content }: tips, warnings, closures.
- `faq` { items[{ question, answer }] }: reader questions with short, true answers.
The page is { id, slug: { en: \"/en/blog/<slug>\" }, title: { en }, page_type: \"blog-article\", seo: { title, description }, body: [blocks] }.";

/// A validator that checks the canonical schema and then the site's house
/// style (banned phrases); errors go back to the writer verbatim.
pub fn site_validator(context: &SiteContext) -> Arc<dyn PageValidator> {
    let style = context.style_guide.clone();
    Arc::new(move |page: &Value| -> Result<(), Vec<String>> {
        content_schema::validate_page(page)?;
        style.validate(page)
    })
}

// ---------------------------------------------------------------------------
// The staged article: closed-world context and the v2 validator
// ---------------------------------------------------------------------------

/// Images offered to the outline (`M1`…`M6`).
pub const HERO_SHORTLIST: usize = 6;
/// Pages offered to the outline as closing links (`L1`…`L8`).
pub const LINK_SHORTLIST: usize = 8;
/// Entity fact lines given to the writer.
pub const ENTITY_FACTS: usize = 5;
/// Titles of existing articles given to the writer.
pub const RELATED_TITLES: usize = 8;
/// The block whose media rules a hero image must satisfy.
const HERO_BLOCK: &str = "editorial-hero";
/// Media index tag of region-wide imagery.
const REGION: &str = "region";

fn brief_language<'a>(kb: &'a KnowledgeBase, brief: &'a Brief) -> &'a str {
    if brief.language.is_empty() {
        &kb.manifest.default_language
    } else {
        &brief.language
    }
}

/// Entities the brief mentions, strongest first: a name in the title counts
/// most, then in the keywords, then in the angle; an alias counts least. Ties
/// keep the entity index's own order (kind, position, slug).
pub fn brief_entities<'k>(kb: &'k KnowledgeBase, brief: &Brief) -> Vec<&'k Entity> {
    let title = brief.title.to_lowercase();
    let keywords = brief.keywords.join(" | ").to_lowercase();
    let angle = brief.angle.to_lowercase();
    let mut hits: Vec<(u32, &Entity)> = kb
        .entities
        .entities
        .iter()
        .filter_map(|e| {
            let mut names: Vec<String> = e.name.iter().map(|(_, n)| n.to_lowercase()).collect();
            names.push(e.slug.replace('-', " "));
            let aliases: Vec<String> = e.aliases.iter().map(|a| a.to_lowercase()).collect();
            let any =
                |hay: &str, needles: &[String]| needles.iter().any(|n| contains_phrase(hay, n));
            let mut score = 0;
            if any(&title, &names) {
                score += 30;
            }
            if any(&keywords, &names) {
                score += 20;
            }
            if any(&angle, &names) {
                score += 10;
            }
            if [&title, &keywords, &angle]
                .iter()
                .any(|hay| any(hay, &aliases))
            {
                score += 5;
            }
            (score > 0).then_some((score, e))
        })
        .collect();
    hits.sort_by_key(|hit| std::cmp::Reverse(hit.0));
    hits.into_iter().map(|(_, e)| e).collect()
}

/// `beaches` → `beach`, `sights` → `sight`.
fn singular(word: &str) -> &str {
    ["ches", "shes", "sses", "xes"]
        .iter()
        .find(|suffix| word.ends_with(*suffix))
        .map(|_| &word[..word.len() - 2])
        .or_else(|| word.strip_suffix('s'))
        .unwrap_or(word)
}

/// The media index category the brief is about, if it names one.
fn brief_media_category<'k>(kb: &'k KnowledgeBase, brief: &Brief) -> Option<&'k str> {
    let text = format!(
        "{} | {} | {}",
        brief.title,
        brief.keywords.join(" | "),
        brief.angle
    )
    .to_lowercase();
    kb.media
        .vocabulary
        .categories
        .iter()
        .map(String::as_str)
        .find(|c| contains_phrase(&text, c) || contains_phrase(&text, singular(c)))
}

fn humanize(tag: &str) -> String {
    let text = tag.replace('-', " ");
    let mut chars = text.chars();
    chars
        .next()
        .map(|first| first.to_uppercase().chain(chars).collect())
        .unwrap_or_default()
}

/// Alt text of an image: the index's own when it has one, otherwise built
/// from the image's tags (`Vernazza: village overview`).
fn media_alt(kb: &KnowledgeBase, entry: &MediaEntry, lang: &str) -> String {
    if let Some(alt) = entry.alt.as_ref().map(|a| a.get(lang).trim()) {
        if !alt.is_empty() {
            return alt.to_string();
        }
    }
    let what = entry
        .tags
        .subcategory
        .as_deref()
        .filter(|s| !s.is_empty())
        .unwrap_or(&entry.tags.category);
    match kb.entities.get(&entry.tags.village) {
        Some(place) if !what.is_empty() => {
            format!(
                "{}: {}",
                place.name.get(lang),
                humanize(what).to_lowercase()
            )
        }
        Some(place) => place.name.get(lang).to_string(),
        None => humanize(what),
    }
}

fn media_about(entry: &MediaEntry) -> String {
    let tags = &entry.tags;
    [
        Some(tags.village.as_str()),
        Some(tags.category.as_str()),
        tags.subcategory.as_deref(),
        tags.time_of_day.as_deref(),
        tags.season.as_deref().filter(|s| *s != "all"),
        tags.mood.as_deref(),
    ]
    .into_iter()
    .flatten()
    .filter(|t| !t.is_empty())
    .collect::<Vec<_>>()
    .join(", ")
}

fn media_credit(entry: &MediaEntry) -> Option<String> {
    let name = entry.photographer.as_deref()?.trim();
    if name.is_empty() || name.eq_ignore_ascii_case("unknown") {
        return None;
    }
    Some(if entry.license.eq_ignore_ascii_case("unsplash") {
        format!("Photo by {name} on Unsplash")
    } else {
        format!("Photo by {name}")
    })
}

/// The hero shortlist of a brief: at most `n` images, aliased `M1`…
///
/// Ranking is the knowledge base's deterministic [`KnowledgeBase::suggest_media`]
/// (score, then id) for the village the brief is about, or region-wide
/// imagery when it names none. Dropped: images the hero block's media rules
/// exclude (an accommodation photo is not an article hero), site asset paths,
/// a second index entry of an image already listed, and every image in
/// `used_heroes` (URLs without their query, or media ids), so an article never
/// repeats the hero of an existing one. A used image is dropped under every
/// id the index has for it.
///
/// An empty result is the closed-world miss `NeedsMedia`: the caller fails
/// the job instead of letting the model invent an image.
pub fn hero_shortlist(
    kb: &KnowledgeBase,
    brief: &Brief,
    used_heroes: &BTreeSet<String>,
    n: usize,
) -> Vec<HeroOption> {
    if n == 0 {
        return Vec::new();
    }
    // The index may list one photo under several ids (other crops): compare
    // by the photo, whichever way the caller named it.
    let used: BTreeSet<&str> = used_heroes
        .iter()
        .map(|u| match kb.media.get(u) {
            Some(entry) => url_identity(&entry.url),
            None => url_identity(u),
        })
        .collect();
    let lang = brief_language(kb, brief);
    let village = brief_entities(kb, brief)
        .into_iter()
        .find(|e| e.kind == EntityKind::Village)
        .map(|e| e.slug.as_str());
    let category = brief_media_category(kb, brief);
    let allowed = block_meta(HERO_BLOCK)
        .and_then(|m| m.media.as_ref())
        .map(|r| r.allowed_categories.as_slice())
        .unwrap_or_default();
    // A village's own images and region imagery; with no village, region
    // imagery, then anything in the index.
    let queries = match village {
        Some(v) => vec![Some(v)],
        None => vec![Some(REGION), None],
    };
    for entity in queries {
        let Ok(candidates) = kb.suggest_media(entity, category, None, 0) else {
            continue;
        };
        let mut seen = BTreeSet::new();
        let mut out: Vec<HeroOption> = Vec::new();
        for candidate in candidates {
            let entry = candidate.entry;
            let identity = url_identity(&entry.url);
            let remote = entry.url.starts_with("https://") || entry.url.starts_with("http://");
            let fits = allowed.is_empty() || allowed.contains(&entry.tags.category);
            if !remote || !fits || used.contains(identity) || !seen.insert(identity) {
                continue;
            }
            out.push(HeroOption {
                alias: format!("M{}", out.len() + 1),
                media_id: entry.id.clone(),
                url: entry.url.clone(),
                alt: media_alt(kb, entry, lang),
                about: media_about(entry),
                credit: media_credit(entry),
            });
            if out.len() >= n {
                break;
            }
        }
        if !out.is_empty() {
            return out;
        }
    }
    Vec::new()
}

/// Images already used as article heroes, as URLs without their query: the
/// story cards of the blog index page (when given) and every index entry the
/// media index records as the `image` of a page under `blog/`.
pub fn used_hero_images(kb: &KnowledgeBase, blog_index: Option<&Value>) -> BTreeSet<String> {
    let mut used = BTreeSet::new();
    let stories = blog_index
        .and_then(|page| page["body"].as_array())
        .into_iter()
        .flatten()
        .filter(|block| block["type"] == "blog-index")
        .filter_map(|block| block["stories"].as_array())
        .flatten();
    for story in stories {
        if let Some(image) = story["image"].as_str().filter(|s| !s.is_empty()) {
            used.insert(url_identity(image).to_string());
        }
    }
    for entry in &kb.media.entries {
        let hero_of_article = entry
            .used_in
            .iter()
            .any(|u| u.contains("/blog/") && u.ends_with(":image"));
        if hero_of_article {
            used.insert(url_identity(&entry.url).to_string());
        }
    }
    used
}

/// The categories an article may carry: the blog index's filter tabs without
/// the first one, which the theme treats as "all stories".
pub fn blog_categories(blog_index: &Value) -> Vec<String> {
    blog_index["body"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|block| block["type"] == "blog-index")
        .filter_map(|block| block["categories"].as_array())
        .flat_map(|categories| categories.iter().skip(1))
        .filter_map(Value::as_str)
        .map(str::to_string)
        .collect()
}

/// A page title without its brand suffix (`"Hikes | The Dispatch"` → `"Hikes"`).
fn bare_title(title: &str) -> &str {
    title
        .rsplit_once(" | ")
        .map_or(title, |(head, _)| head)
        .trim()
}

/// The link shortlist of a brief: at most `n` existing pages, aliased `L1`…
///
/// One query is asked of [`KnowledgeBase::find_link_targets`] for every entity
/// the brief mentions, for every keyword and for the title. The queries then
/// take turns, each giving its best page not yet listed, so a village with
/// many sub-pages cannot crowd out the pages the keywords find. Within one
/// query the order is the knowledge base's score, then how many of the
/// brief's words the page title shares, then the route.
///
/// Every route is one the site serves in the brief's language; the article's
/// own route is left out.
pub fn link_shortlist(kb: &KnowledgeBase, brief: &Brief, n: usize) -> Vec<LinkOption> {
    let lang = brief_language(kb, brief);
    let prefix = format!("/{lang}");
    let own = format!("/{lang}/blog/{}", brief.slug);
    let mut queries: Vec<String> = brief_entities(kb, brief)
        .iter()
        .map(|e| e.name.get(lang).to_lowercase())
        .collect();
    queries.extend(brief.keywords.iter().map(|k| k.to_lowercase()));
    queries.push(brief.title.to_lowercase());
    let wanted = title_tokens(&format!(
        "{} {} {}",
        brief.title,
        brief.keywords.join(" "),
        brief.angle
    ));

    let mut asked = BTreeSet::new();
    let mut answers: Vec<VecDeque<LinkCandidate>> = Vec::new();
    for query in queries.iter().filter(|q| asked.insert(q.as_str())) {
        // (shared words, candidate)
        let mut found: Vec<(usize, LinkCandidate)> = kb
            .find_link_targets(query, lang, 0)
            .into_iter()
            .filter(|c| {
                let served = c.url == prefix
                    || c.url
                        .strip_prefix(&prefix)
                        .is_some_and(|rest| rest.starts_with('/'));
                served && c.url != own
            })
            .map(|c| {
                let shared = title_tokens(bare_title(&c.title))
                    .intersection(&wanted)
                    .count();
                (shared, c)
            })
            .collect();
        found.sort_by(|a, b| {
            b.1.score
                .cmp(&a.1.score)
                .then_with(|| b.0.cmp(&a.0))
                .then_with(|| a.1.url.cmp(&b.1.url))
        });
        answers.push(found.into_iter().map(|(_, c)| c).collect());
    }

    let mut out: Vec<LinkOption> = Vec::new();
    let mut listed = BTreeSet::new();
    let mut progressed = true;
    while out.len() < n && progressed {
        progressed = false;
        for answer in &mut answers {
            if out.len() >= n {
                break;
            }
            while let Some(candidate) = answer.pop_front() {
                if listed.insert(candidate.url.clone()) {
                    out.push(LinkOption {
                        alias: format!("L{}", out.len() + 1),
                        page_id: candidate.page_id,
                        title: bare_title(&candidate.title).to_string(),
                        route: candidate.url,
                    });
                    progressed = true;
                    break;
                }
            }
        }
    }
    out
}

fn names_of(kb: &KnowledgeBase, slugs: &[String], lang: &str) -> String {
    slugs
        .iter()
        .map(|slug| {
            kb.entities
                .get(slug)
                .map_or(slug.as_str(), |e| e.name.get(lang))
        })
        .collect::<Vec<_>>()
        .join(", ")
}

/// What the entity index says about the places the brief mentions: at most
/// `n` lines, one per village, trail or transport line, strongest first.
/// These are the only place facts the writer is given.
pub fn entity_facts(kb: &KnowledgeBase, brief: &Brief, n: usize) -> Vec<String> {
    let lang = brief_language(kb, brief);
    brief_entities(kb, brief)
        .into_iter()
        .filter(|e| e.kind != EntityKind::Category)
        .take(n)
        .map(|e| {
            let (kind, relation) = match e.kind {
                EntityKind::Village => ("village", "next to"),
                EntityKind::Trail => ("trail", "connects"),
                EntityKind::Transport => ("transport", "stops at"),
                EntityKind::Category => ("category", "related to"),
            };
            let mut facts = Vec::new();
            if !e.aliases.is_empty() {
                facts.push(format!("also called {}", e.aliases.join(", ")));
            }
            if !e.keywords.is_empty() {
                facts.push(format!("known for {}", e.keywords.join(", ")));
            }
            if !e.related.is_empty() {
                facts.push(format!("{relation} {}", names_of(kb, &e.related, lang)));
            }
            let name = e.name.get(lang);
            if facts.is_empty() {
                format!("{name} ({kind})")
            } else {
                format!("{name} ({kind}): {}", facts.join("; "))
            }
        })
        .collect()
}

/// Words too common to relate two titles.
const STOPWORDS: [&str; 16] = [
    "about", "from", "guide", "have", "into", "terre", "cinque", "that", "their", "this", "week",
    "what", "when", "where", "with", "your",
];

/// The words of a title that say what it is about: longer than three
/// letters, not a stopword, with a plural `s` dropped (`wines` → `wine`).
fn title_tokens(text: &str) -> BTreeSet<String> {
    text.split(|c: char| !c.is_alphanumeric())
        .map(str::to_lowercase)
        .filter(|t| t.chars().count() > 3 && !STOPWORDS.contains(&t.as_str()))
        .map(|t| match t.strip_suffix('s') {
            Some(stem) if stem.chars().count() > 3 => stem.to_string(),
            _ => t,
        })
        .collect()
}

/// Titles of existing articles that share words with the brief (title and
/// keywords), most shared first, at most [`RELATED_TITLES`]: what the site
/// has already said, so the writer covers new ground.
pub fn related_titles(kb: &KnowledgeBase, brief: &Brief) -> Vec<String> {
    let lang = brief_language(kb, brief);
    let own = format!("/{lang}/blog/{}", brief.slug);
    let wanted = title_tokens(&format!("{} {}", brief.title, brief.keywords.join(" ")));
    let mut hits: Vec<(usize, &str)> = kb
        .pages
        .pages
        .iter()
        .filter(|p| p.page_type == "blog-article" || p.path.starts_with("content/pages/blog/"))
        .filter(|p| p.route(lang).is_some_and(|r| r != own))
        .filter_map(|p| {
            let title = bare_title(p.title(lang));
            let shared = title_tokens(title).intersection(&wanted).count();
            (shared > 0).then_some((shared, title))
        })
        .collect();
    hits.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.cmp(b.1)));
    hits.dedup_by(|a, b| a.1 == b.1);
    hits.into_iter()
        .take(RELATED_TITLES)
        .map(|(_, title)| title.to_string())
        .collect()
}

/// The result of the Draft job's `context#0` stage: everything the model may
/// refer to, by alias, and what it is told about the site.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ArticleContext {
    pub heroes: Vec<HeroOption>,
    pub links: Vec<LinkOption>,
    pub facts: Vec<String>,
    pub related: Vec<String>,
    pub categories: Vec<String>,
}

impl ArticleContext {
    pub fn hero_aliases(&self) -> Vec<String> {
        self.heroes.iter().map(|h| h.alias.clone()).collect()
    }

    pub fn link_aliases(&self) -> Vec<String> {
        self.links.iter().map(|l| l.alias.clone()).collect()
    }
}

/// Builds the `context#0` stage for a brief. `blog_index` is the site's blog
/// index page (the knowledge pack carries it); `heroes_in_flight` are the
/// heroes of articles not merged yet (URLs without query, or media ids).
pub fn article_context(
    kb: &KnowledgeBase,
    brief: &Brief,
    blog_index: Option<&Value>,
    heroes_in_flight: &BTreeSet<String>,
) -> ArticleContext {
    let mut used = used_hero_images(kb, blog_index);
    used.extend(heroes_in_flight.iter().cloned());
    ArticleContext {
        heroes: hero_shortlist(kb, brief, &used, HERO_SHORTLIST),
        links: link_shortlist(kb, brief, LINK_SHORTLIST),
        facts: entity_facts(kb, brief, ENTITY_FACTS),
        related: related_titles(kb, brief),
        categories: blog_index.map(blog_categories).unwrap_or_default(),
    }
}

/// The fields of each article block that hold text the model wrote. House
/// style is checked there only: labels, routes and image URLs are the
/// orchestrator's and come from the site.
fn model_text_fields(block_type: &str) -> &'static [&'static str] {
    match block_type {
        "editorial-hero" => &["title", "subtitle"],
        "paragraph" => &["markdown"],
        "heading" => &["text"],
        "list" => &["items"],
        "callout" => &["title", "content"],
        "closing-note" => &["title", "content"],
        _ => &[],
    }
}

/// The validator of an assembled article (`docs/design/mvp-pipeline.md` §3,
/// "Closed world"): page schema v2 (which accepts the localized `seo` the
/// frozen theme reads), the article profile, the house style, and the
/// knowledge base's link and media checks. Every issue is scoped to the
/// section it falls in where the page layout says which one.
pub struct SiteValidatorV2 {
    kb: Arc<KnowledgeBase>,
    registry: SchemaRegistry,
    style: StyleGuide,
}

impl SiteValidatorV2 {
    pub fn new(kb: Arc<KnowledgeBase>, style: StyleGuide) -> Self {
        Self {
            kb,
            registry: SchemaRegistry::core(),
            style,
        }
    }

    /// Every problem of the page; empty means the page may be committed.
    pub fn check(&self, page: &Value) -> Vec<PageIssue> {
        let issue = |code: &str, pointer: String, message: String| PageIssue {
            section: section_of_pointer(page, &pointer),
            pointer,
            code: code.into(),
            message,
        };
        let mut out: Vec<PageIssue> = validate_page_v2(page, &self.registry)
            .errors
            .into_iter()
            .map(|e| issue("schema", e.path, e.message))
            .collect();
        out.extend(check_article_profile(page));

        for (i, block) in page["body"].as_array().into_iter().flatten().enumerate() {
            let fields = model_text_fields(block["type"].as_str().unwrap_or_default());
            for field in fields {
                for error in self.style.banned_phrase_errors(&block[*field]) {
                    // `banned_phrase_errors` reports "<pointer>: <message>",
                    // with "/" for a bare string.
                    let (inner, message) = error.split_once(": ").unwrap_or(("/", &error));
                    let inner = inner.trim_end_matches('/');
                    out.push(issue(
                        "house_style",
                        format!("/body/{i}/{field}{inner}"),
                        message.to_string(),
                    ));
                }
            }
        }
        // The same check and text the gateway's draft check reports.
        for i in self.kb.closed_world_issues(page) {
            out.push(issue(i.kind.code(), i.pointer, i.message));
        }
        out
    }
}

impl PageValidator for SiteValidatorV2 {
    fn validate(&self, page: &Value) -> Result<(), Vec<String>> {
        let issues = self.check(page);
        if issues.is_empty() {
            Ok(())
        } else {
            Err(issues.iter().map(ToString::to_string).collect())
        }
    }
}

/// The validator of the staged article for a site: v2 schema, article
/// profile, house style and the closed world of `kb`. It replaces
/// [`site_validator`] when the staged Draft job is wired in.
pub fn site_validator_v2(context: &SiteContext, kb: Arc<KnowledgeBase>) -> Arc<SiteValidatorV2> {
    Arc::new(SiteValidatorV2::new(kb, context.style_guide.clone()))
}

/// URL-safe slug: lowercase ASCII, Italian accents folded, dashes between
/// words, at most 80 characters.
pub fn slugify(title: &str) -> String {
    let mut out = String::new();
    let mut dash = false;
    for c in title.chars().flat_map(|c| c.to_lowercase()) {
        let c = match c {
            'à' | 'á' | 'â' | 'ä' => 'a',
            'è' | 'é' | 'ê' | 'ë' => 'e',
            'ì' | 'í' | 'î' | 'ï' => 'i',
            'ò' | 'ó' | 'ô' | 'ö' => 'o',
            'ù' | 'ú' | 'û' | 'ü' => 'u',
            c => c,
        };
        if c.is_ascii_alphanumeric() {
            out.push(c);
            dash = false;
        } else if !dash && !out.is_empty() {
            out.push('-');
            dash = true;
        }
    }
    let out = out.trim_end_matches('-');
    out.chars()
        .take(80)
        .collect::<String>()
        .trim_end_matches('-')
        .to_string()
}

/// Stable id for the `index`th brief of standup `job_id`. Positive as an i64
/// so SQL `INTEGER`/`BIGINT` columns can hold it.
pub fn brief_ref_for(company: &str, job_id: u64, index: usize) -> u64 {
    let mut buf = Vec::with_capacity(company.len() + 17);
    buf.extend_from_slice(company.as_bytes());
    buf.push(0);
    buf.extend_from_slice(&job_id.to_le_bytes());
    buf.extend_from_slice(&(index as u64).to_le_bytes());
    xxhash_rust::xxh3::xxh3_64(&buf) & (i64::MAX as u64)
}

fn page_text(page: &Value) -> String {
    fn walk(v: &Value, out: &mut String) {
        match v {
            Value::String(s) => {
                out.push_str(s);
                out.push(' ');
            }
            Value::Array(a) => a.iter().for_each(|x| walk(x, out)),
            Value::Object(o) => o
                .iter()
                .filter(|(k, _)| k.as_str() != "type")
                .for_each(|(_, x)| walk(x, out)),
            _ => {}
        }
    }
    let mut out = String::new();
    if let Some(body) = page.get("body") {
        walk(body, &mut out);
    }
    out
}

/// Words in the page body (block `type` tags excluded).
pub fn word_count(page: &Value) -> u32 {
    u32::try_from(page_text(page).split_whitespace().count()).unwrap_or(u32::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugs_are_url_safe() {
        assert_eq!(
            slugify("Harvest week in Manarola!"),
            "harvest-week-in-manarola"
        );
        assert_eq!(slugify("Più vino, più città"), "piu-vino-piu-citta");
        assert_eq!(slugify("  --  "), "");
    }

    #[test]
    fn brief_refs_are_stable_positive_and_distinct() {
        let a = brief_ref_for("c", 7, 0);
        assert_eq!(a, brief_ref_for("c", 7, 0));
        assert_ne!(a, brief_ref_for("c", 7, 1));
        assert_ne!(a, brief_ref_for("d", 7, 0));
        assert!(a <= i64::MAX as u64);
    }

    #[test]
    fn article_schema_pages_pass_the_canonical_schema() {
        let page = json!({
            "id": "content-1", "slug": {"en": "/en/blog/x"}, "title": {"en": "X"},
            "page_type": "blog-article", "seo": {"title": "X", "description": "d"},
            "body": [
                {"type": "heading", "level": 2, "text": "Setting out"},
                {"type": "paragraph", "markdown": "We left Monterosso early."},
                {"type": "faq", "items": [{"question": "Is it steep?", "answer": "Yes."}]}
            ]
        });
        let validator = jsonschema::validator_for(&article_schema()).unwrap();
        assert!(validator.is_valid(&page));
        content_schema::validate_page(&page).unwrap();
        assert_eq!(word_count(&page), 10);
    }
}
