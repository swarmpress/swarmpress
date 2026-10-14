//! A bundle → its [`SiteDesign`], deterministically.
//!
//! The section rules are design-import.ts's (FEAT-093), ported: each page is
//! cut into its top-level sections, each section is described by facts, and
//! the first rule that holds picks its catalogue block. On top of them:
//!
//! * **Pages.** A Claude Design export lists its pages with board titles
//!   (`design.json`); other bundles take every HTML page in path order. A page
//!   with the site's header or footer, or a title that names a page
//!   (`Homepage`, `Article`, `Template`), is a **template**; a sheet titled
//!   `Listings`/`Listing templates` is a **templates sheet** (each numbered
//!   part a listing template); every other page is a **guide** sheet, read
//!   for tokens, components and rules ([`crate::guide`]).
//! * **Templates.** The kind comes from the page's name (`home`, `article`,
//!   `archive`, `404`, …); a page may say it outright with
//!   `<body data-template="single">` or `<meta name="swarmpress:template">`.
//!   Repeated cards become a **query** (featured when the heading says
//!   picks/featured/curated, latest when it says latest/recent, the
//!   template's own list in an archive), and the longest text of a single or
//!   page template is its **entry**.
//! * **Parts and navigation** come from the first template with a header or
//!   footer (the home page first): the header's `<nav>` is a menu, links that
//!   read `EN`/`DE` are the languages, the footer's labelled link groups are
//!   menus.
//! * **Patterns** are sections (same content, same class) or components used
//!   by more than one template.

use std::collections::{BTreeMap, BTreeSet};

use crate::bundle::{is_css, is_page, DesignBundle, MAX_PAGES, MAX_PARSE_BYTES};
use crate::dc::{self, DataList};
use crate::dom::{self, El};
use crate::export::PagesIndex;
use crate::model::*;

/// A page read: its expanded markup and data.
pub(crate) struct Page {
    pub path: String,
    pub title: String,
    pub html: El,
    pub lists: Vec<DataList>,
    pub role: PageRole,
}

pub fn kebab(s: &str) -> String {
    let mut out = String::new();
    for c in s.chars().flat_map(char::to_lowercase) {
        if c.is_ascii_alphanumeric() {
            out.push(c);
        } else if !out.is_empty() && !out.ends_with('-') {
            out.push('-');
        }
    }
    out.trim_end_matches('-').to_string()
}

fn count<T>(it: impl Iterator<Item = T>) -> u32 {
    u32::try_from(it.count()).unwrap_or(u32::MAX)
}

/// `\b\d[\d.,]*\s?(%|k|m|\+)?\b`, case-insensitive (design-import.ts), counted.
pub fn count_numbers(text: &str) -> u32 {
    let cs: Vec<char> = text.chars().collect();
    let word = |i: usize| {
        cs.get(i)
            .is_some_and(|c| c.is_ascii_alphanumeric() || *c == '_')
    };
    let boundary = |i: usize| (i > 0 && word(i - 1)) != word(i);
    let suffix = |i: usize| {
        cs.get(i)
            .is_some_and(|c| matches!(c.to_ascii_lowercase(), '%' | 'k' | 'm' | '+'))
    };
    let mut n = 0;
    let mut i = 0;
    while i < cs.len() {
        if !cs[i].is_ascii_digit() || !boundary(i) {
            i += 1;
            continue;
        }
        let mut end = i + 1;
        while end < cs.len() && (cs[end].is_ascii_digit() || cs[end] == '.' || cs[end] == ',') {
            end += 1;
        }
        // Backtrack as the regex does: the longest run first, `\s?` and the
        // suffix greedy.
        let mut at = None;
        'run: for e in (i + 1..=end).rev() {
            let spaces: &[usize] = if cs.get(e).is_some_and(|c| c.is_whitespace()) {
                &[1, 0]
            } else {
                &[0]
            };
            for &w in spaces {
                let s = e + w;
                let ends: &[usize] = if suffix(s) { &[1, 0] } else { &[0] };
                for &x in ends {
                    if boundary(s + x) {
                        at = Some(s + x);
                        break 'run;
                    }
                }
            }
        }
        match at {
            Some(a) => {
                n += 1;
                i = a;
            }
            None => i += 1,
        }
    }
    n
}

/// A section's facts (pure over the tree).
pub fn facts_of(el: &El) -> SectionFacts {
    let h = el.find(&|e| matches!(e.tag.as_str(), "h1" | "h2" | "h3"));
    let text = el.text();
    let words = count(text.split(' ').filter(|w| !w.is_empty()));
    let mut repeated = 0u32;
    fn scan(p: &El, depth: u32, best: &mut u32) {
        let mut groups: BTreeMap<String, u32> = BTreeMap::new();
        for c in p.elements() {
            *groups
                .entry(format!("{}.{}", c.tag, c.attr("class").unwrap_or("")))
                .or_default() += 1;
        }
        for n in groups.values() {
            if *n >= 3 {
                *best = (*best).max(*n);
            }
        }
        if depth < 3 {
            for c in p.elements() {
                scan(c, depth + 1, best);
            }
        }
    }
    scan(el, 0, &mut repeated);
    let images = el.count(&|e| matches!(e.tag.as_str(), "img" | "picture" | "image"));
    let frames = el.count(&|e| e.attr("style").is_some_and(|s| s.contains("aspect-ratio")));
    SectionFacts {
        tag: el.tag.clone(),
        heading: h.map(|h| h.text().chars().take(120).collect()),
        heading_level: h.and_then(|h| h.tag[1..].parse().ok()),
        images,
        media: images + frames,
        links: el.count(&|e| e.tag == "a" && e.attr("href").is_some()),
        paragraphs: el.count(&|e| e.tag == "p"),
        words,
        email_form: el
            .find(&|e| {
                e.tag == "input"
                    && (e
                        .attr("type")
                        .is_some_and(|t| t.eq_ignore_ascii_case("email"))
                        || e.attr("name")
                            .is_some_and(|n| n.to_ascii_lowercase().contains("mail")))
            })
            .is_some(),
        questions: el.count(&|e| e.tag == "details" || e.tag == "dt"),
        buttons: el.count(&|e| {
            e.tag == "button"
                || (e.tag == "a" && e.attr("role") == Some("button"))
                || e.has_class("button")
                || e.has_class("btn")
        }),
        numbers: count_numbers(&text),
        repeated: if el.elements().next().is_some() {
            repeated
        } else {
            0
        },
    }
}

const LANDMARKS: [&str; 3] = ["header", "nav", "footer"];

/// Where a page's sections are: the body, or the single wrapper (an
/// `<x-dc>`, a `<div>`) the design put everything in.
fn content_root(body: &El) -> &El {
    let mut at = body;
    loop {
        let kids: Vec<&El> = at
            .elements()
            .filter(|c| !dom::NOT_CONTENT.contains(&c.tag.as_str()))
            .collect();
        if kids.len() == 1
            && !LANDMARKS.contains(&kids[0].tag.as_str())
            && !matches!(kids[0].tag.as_str(), "main" | "section" | "article")
            && kids[0].elements().count() > 0
        {
            at = kids[0];
        } else {
            return at;
        }
    }
}

/// The top-level sections of a page body (design-import.ts's `sectionsOf`).
pub fn sections_of(body: &El) -> Vec<&El> {
    let root = content_root(body);
    let main = root.find_tag("main");
    fn kids(e: &El) -> Vec<&El> {
        e.elements()
            .filter(|c| !dom::NOT_CONTENT.contains(&c.tag.as_str()))
            .collect()
    }
    let landmarks: Vec<&El> = root
        .elements()
        .filter(|c| LANDMARKS.contains(&c.tag.as_str()))
        .collect();
    let inner = kids(main.unwrap_or(root));
    let content: Vec<&El> = if main.is_some() {
        inner
    } else {
        inner
            .into_iter()
            .filter(|c| !LANDMARKS.contains(&c.tag.as_str()))
            .collect()
    };
    let flat = if content.len() == 1 && content[0].tag == "div" && content[0].elements().count() > 1
    {
        kids(content[0])
    } else {
        content
    };
    let mut out: Vec<&El> = landmarks
        .iter()
        .copied()
        .filter(|c| c.tag != "footer")
        .collect();
    out.extend(flat);
    out.extend(landmarks.iter().copied().filter(|c| c.tag == "footer"));
    out
}

type Holds = fn(&SectionFacts, bool) -> bool;

/// The rules, in order: the first that holds picks the block.
pub const RULES: [(&str, &str, Holds); 10] = [
    ("newsletter", "a form with an email field", |f, _| {
        f.email_form
    }),
    ("faq-section", "three or more questions", |f, _| {
        f.questions >= 3
    }),
    ("gallery", "four or more images and few words", |f, _| {
        f.media >= 4 && f.repeated < 3 && f.words < 20 * f.media
    }),
    (
        "latest-stories",
        "three or more repeated cards with links",
        |f, _| f.repeated >= 3 && f.links >= 3,
    ),
    (
        "hero-section",
        "the first section with a top heading",
        |f, first| first && f.heading_level == Some(1),
    ),
    ("stats-section", "mostly numbers", |f, _| {
        f.numbers >= 3 && f.words < 12 * f.numbers
    }),
    ("cta-section", "a short section with a button", |f, _| {
        f.buttons >= 1 && f.words <= 40
    }),
    ("image", "an image band with few words", |f, _| {
        f.media >= 1 && f.heading.is_none() && f.words <= 30
    }),
    ("content-section", "a heading and paragraphs", |f, _| {
        f.heading.is_some() && f.paragraphs >= 1
    }),
    ("paragraph", "text", |f, _| f.words > 0),
];

/// A template's kind from a name (a file name or a title).
pub fn kind_of_name(name: &str) -> Option<TemplateKind> {
    let k = kebab(name);
    let has = |w: &str| k.split('-').any(|x| x == w);
    Some(
        if has("404") || k.contains("not-found") || k.contains("notfound") {
            TemplateKind::NotFound
        } else if has("index") || has("home") || has("homepage") || has("front") {
            TemplateKind::Home
        } else if ["article", "story", "post", "single", "entry"]
            .iter()
            .any(|w| has(w))
        {
            TemplateKind::Single
        } else if [
            "archive", "blog", "stories", "articles", "posts", "news", "category", "tag", "journal",
        ]
        .iter()
        .any(|w| has(w))
        {
            TemplateKind::Archive
        } else if has("search") {
            TemplateKind::Search
        } else if [
            "about", "contact", "page", "default", "imprint", "privacy", "legal",
        ]
        .iter()
        .any(|w| has(w))
        {
            TemplateKind::Page
        } else {
            return None;
        },
    )
}

fn declared_kind(html: &El) -> Option<(TemplateKind, String)> {
    let v = dom::body(html)
        .and_then(|b| b.attr("data-template"))
        .or_else(|| html.attr("data-template"))
        .or_else(|| {
            html.find(&|e| e.tag == "meta" && e.attr("name") == Some("swarmpress:template"))
                .and_then(|m| m.attr("content"))
        })?
        .trim()
        .to_ascii_lowercase();
    let kind = match v.as_str() {
        "home" => TemplateKind::Home,
        "single" => TemplateKind::Single,
        "page" => TemplateKind::Page,
        "archive" => TemplateKind::Archive,
        "listing" => TemplateKind::Listing,
        "search" => TemplateKind::Search,
        "404" | "not-found" => TemplateKind::NotFound,
        _ => TemplateKind::Custom,
    };
    Some((kind, v.trim_start_matches("custom:").to_string()))
}

pub fn kind_slug(k: TemplateKind) -> &'static str {
    match k {
        TemplateKind::Home => "home",
        TemplateKind::Single => "single",
        TemplateKind::Page => "page",
        TemplateKind::Archive => "archive",
        TemplateKind::Listing => "listing",
        TemplateKind::Search => "search",
        TemplateKind::NotFound => "404",
        TemplateKind::Custom => "custom",
    }
}

fn base_name(path: &str) -> &str {
    let b = path.rsplit('/').next().unwrap_or(path);
    b.rsplit_once('.').map_or(b, |x| x.0)
}

/// The page's name without a board number (`06 — Applied: Homepage` → `Applied: Homepage`).
fn bare_title(t: &str) -> String {
    let t = t.trim();
    let digits = t.chars().take_while(char::is_ascii_digit).count();
    if digits == 0 {
        return t.to_string();
    }
    let mut rest = &t[digits..];
    if rest.starts_with(|c: char| c.is_ascii_lowercase())
        && !rest[1..].starts_with(|c: char| c.is_ascii_lowercase())
    {
        rest = &rest[1..];
    }
    let rest = rest.trim_start();
    match rest.strip_prefix(['—', '–', '-', '·', '.']) {
        Some(r) if !r.trim().is_empty() => r.trim().to_string(),
        _ => t.to_string(),
    }
}

fn has_chrome(html: &El) -> bool {
    dom::body(html).is_some_and(|b| {
        content_root(b)
            .elements()
            .any(|c| c.tag == "header" || c.tag == "footer")
    })
}

fn role_of(title: &str, path: &str, html: &El) -> PageRole {
    let k = kebab(&format!("{title} {}", base_name(path)));
    let has = |w: &str| k.split('-').any(|x| x == w);
    if has_chrome(html) || declared_kind(html).is_some() {
        PageRole::Template
    } else if has("listing") || has("listings") || has("templates") {
        PageRole::Templates
    } else if has("applied")
        || has("template")
        || kind_of_name(&k).is_some_and(|x| x != TemplateKind::Page)
    {
        PageRole::Template
    } else {
        PageRole::Guide
    }
}

/// The text of the first short label before a section's heading (its eyebrow).
fn eyebrow(el: &El) -> Option<String> {
    let mut found = None;
    for e in el.descendants() {
        if matches!(e.tag.as_str(), "h1" | "h2" | "h3") {
            break;
        }
        if e.elements().next().is_none() {
            let t = e.text();
            let placeholder = t.contains('[') || t.starts_with("PHOTO");
            if !t.is_empty() && !placeholder && t.chars().count() <= 60 && t.split(' ').count() <= 6
            {
                found = Some(t);
                break;
            }
        }
    }
    found
}

fn background(el: &El) -> Option<String> {
    let style = el.attr("style")?;
    for d in style.split(';') {
        let (k, v) = d.split_once(':')?;
        let k = k.trim();
        if k == "background" || k == "background-color" {
            let v = v.trim();
            if v.starts_with('#') {
                return Some(v.to_string());
            }
        }
    }
    None
}

fn map_section(el: &El, first: bool, kind: TemplateKind) -> (SectionContent, String, SectionFacts) {
    let f = facts_of(el);
    let (block, rule) = RULES
        .iter()
        .find(|(_, _, holds)| holds(&f, first))
        .map_or(("paragraph", "text"), |(b, r, _)| (*b, *r));
    if block == "latest-stories" {
        let h = format!(
            "{} {}",
            f.heading.clone().unwrap_or_default(),
            eyebrow(el).unwrap_or_default()
        )
        .to_lowercase();
        let (source, why) = if matches!(
            kind,
            TemplateKind::Archive | TemplateKind::Search | TemplateKind::Listing
        ) {
            (
                QuerySource::Inherit,
                "repeated cards in a list template: its own entries",
            )
        } else if ["pick", "featured", "curated", "editor"]
            .iter()
            .any(|w| h.contains(w))
        {
            (
                QuerySource::Featured,
                "repeated cards under a heading that says picks or featured",
            )
        } else if ["latest", "recent", "new", "dispatch"]
            .iter()
            .any(|w| h.contains(w))
        {
            (
                QuerySource::Latest,
                "repeated cards under a heading that says latest",
            )
        } else {
            (
                QuerySource::Collection,
                "repeated cards with links: a collection's entries",
            )
        };
        return (
            SectionContent::Query {
                query: ContentQuery {
                    source,
                    items: f.repeated,
                },
            },
            why.into(),
            f,
        );
    }
    (
        SectionContent::Block {
            block: block.into(),
        },
        rule.into(),
        f,
    )
}

/// One template page's sections; `(sections, has header, has footer)`.
fn template_sections(body: &El, kind: TemplateKind, tokens: &Tokens) -> (Vec<Section>, bool, bool) {
    let mut header = false;
    let mut footer = false;
    let mut out: Vec<Section> = Vec::new();
    let mut first = true;
    for el in sections_of(body) {
        match el.tag.as_str() {
            "header" | "nav" => {
                header = true;
                continue;
            }
            "footer" => {
                footer = true;
                continue;
            }
            _ => {}
        }
        let (content, rule, facts) = map_section(el, first, kind);
        first = false;
        let mut props = BTreeMap::new();
        if let Some(h) = &facts.heading {
            props.insert("heading".into(), h.clone());
        }
        if let Some(e) = eyebrow(el).filter(|e| Some(e) != facts.heading.as_ref()) {
            props.insert("eyebrow".into(), e);
        }
        if facts.repeated >= 3 {
            props.insert("items".into(), facts.repeated.to_string());
        }
        if let Some(c) = el
            .attr("class")
            .map(dom::collapse)
            .filter(|c| !c.is_empty())
        {
            props.insert("class".into(), c);
        }
        let bg = background(el).or_else(|| el.elements().next().and_then(background));
        if let Some(bg) = bg {
            let token = all_colours(tokens)
                .find(|c| c.value.eq_ignore_ascii_case(&bg))
                .map(|c| c.name.clone());
            props.insert("background".into(), token.unwrap_or(bg));
        }
        let role = props
            .get("eyebrow")
            .or(props.get("heading"))
            .map(|r| kebab(r))
            .filter(|r| !r.is_empty());
        let html = el.outer_html();
        out.push(Section {
            id: String::new(),
            content,
            role,
            props,
            pattern: None,
            rule,
            facts,
            html: if html.len() <= crate::model::SECTION_HTML_BYTES {
                html
            } else {
                String::new()
            },
        });
    }
    // The entry of a single or page template: an <article>, else the longest text.
    if matches!(kind, TemplateKind::Single | TemplateKind::Page) {
        let pick = out
            .iter()
            .position(|s| s.facts.tag == "article")
            .or_else(|| {
                out.iter()
                    .enumerate()
                    .filter(|(_, s)| {
                        matches!(&s.content, SectionContent::Block { block } if block == "content-section" || block == "paragraph")
                    })
                    .max_by(|a, b| a.1.facts.words.cmp(&b.1.facts.words).then(b.0.cmp(&a.0)))
                    .map(|(i, _)| i)
            });
        if let Some(i) = pick {
            out[i].content = SectionContent::Entry;
            out[i].rule = "the entry's own content (an article, else the longest text)".into();
        }
    }
    assign_ids(&mut out);
    (out, header, footer)
}

pub(crate) fn assign_ids(sections: &mut [Section]) {
    let mut used = BTreeSet::new();
    for s in sections.iter_mut() {
        let base = s
            .key()
            .trim_start_matches("x:")
            .trim_end_matches("-section")
            .to_string();
        let mut id = base.clone();
        let mut n = 2;
        while used.contains(&id) {
            id = format!("{base}-{n}");
            n += 1;
        }
        used.insert(id.clone());
        s.id = id;
    }
}

pub(crate) fn all_colours(t: &Tokens) -> impl Iterator<Item = &ColourToken> {
    t.colours
        .iter()
        .chain(t.schemes.iter().flat_map(|s| s.colours.iter()))
}

/// The pages of the bundle in order, with titles.
fn page_list(texts: &BTreeMap<String, String>) -> Vec<(String, String)> {
    if let Some(idx) = texts
        .get("design.json")
        .and_then(|j| serde_json::from_str::<PagesIndex>(j).ok())
    {
        return idx
            .pages
            .into_iter()
            .filter(|p| texts.contains_key(&p.path))
            .map(|p| (p.path, p.title))
            .collect();
    }
    texts
        .keys()
        .filter(|p| is_page(p))
        .map(|p| (p.clone(), String::new()))
        .collect()
}

/// Interprets a bundle (module docs).
pub fn interpret(bundle: &DesignBundle) -> SiteDesign {
    let mut texts = BTreeMap::new();
    let mut skipped = Vec::new();
    for (path, bytes) in bundle.files() {
        if !(is_page(path) || is_css(path) || path == "design.json") {
            continue;
        }
        if bytes.len() > MAX_PARSE_BYTES {
            skipped.push(Skipped {
                path: path.clone(),
                why: "too large to read".into(),
            });
            continue;
        }
        match std::str::from_utf8(bytes) {
            Ok(t) => {
                texts.insert(path.clone(), t.to_string());
            }
            Err(_) => skipped.push(Skipped {
                path: path.clone(),
                why: "not UTF-8 text".into(),
            }),
        }
    }
    let mut d = interpret_texts(bundle.hash(), &texts);
    skipped.extend(d.skipped);
    d.skipped = skipped;
    d
}

/// Interprets the text files of a bundle (pages, stylesheets, `design.json`)
/// by path: what a server needs to load to interpret a stored version.
pub fn interpret_texts(bundle_hash: &str, texts: &BTreeMap<String, String>) -> SiteDesign {
    let mut skipped = Vec::new();
    let mut pages: Vec<Page> = Vec::new();
    for (path, title) in page_list(texts) {
        if pages.len() >= MAX_PAGES {
            skipped.push(Skipped {
                path,
                why: format!("more than {MAX_PAGES} pages"),
            });
            continue;
        }
        let raw = dom::parse(&texts[&path]);
        let (html, lists) = dc::expand(&raw);
        let title = if title.is_empty() {
            dom::title(&html).unwrap_or_else(|| base_name(&path).to_string())
        } else {
            title
        };
        let role = role_of(&title, &path, &html);
        pages.push(Page {
            path,
            title,
            html,
            lists,
            role,
        });
    }

    // Tokens: stylesheets and the guide sheets.
    let mut css = String::new();
    for (p, t) in texts {
        if is_css(p) {
            css.push_str(t);
            css.push('\n');
        }
    }
    let tokens = crate::guide::tokens(&pages, &css);

    let mut templates: Vec<Template> = Vec::new();
    let mut used_slugs = BTreeSet::new();
    let mut chrome: Option<(&Page, String)> = None;
    let mut slugs_by_path: BTreeMap<String, String> = BTreeMap::new();
    let mut order: Vec<&Page> = pages
        .iter()
        .filter(|p| p.role == PageRole::Template)
        .collect();
    // The home page first: its header and footer are the parts.
    order.sort_by_key(|p| {
        u8::from(
            declared_kind(&p.html)
                .map(|k| k.0)
                .or_else(|| kind_of_name(base_name(&p.path)))
                .or_else(|| kind_of_name(&bare_title(&p.title)))
                != Some(TemplateKind::Home),
        )
    });
    for p in order {
        let Some(body) = dom::body(&p.html) else {
            continue;
        };
        let (kind, slug_base, rule) = if let Some((k, name)) = declared_kind(&p.html) {
            let base = if k == TemplateKind::Custom {
                kebab(&name)
            } else {
                kind_slug(k).to_string()
            };
            (k, base, "the page says which template it is".to_string())
        } else if let Some(k) =
            kind_of_name(base_name(&p.path)).or_else(|| kind_of_name(&bare_title(&p.title)))
        {
            (
                k,
                kind_slug(k).to_string(),
                format!("the page's name says {}", kind_slug(k)),
            )
        } else {
            let base = kebab(&bare_title(&p.title));
            (
                TemplateKind::Custom,
                if base.is_empty() {
                    kebab(base_name(&p.path))
                } else {
                    base
                },
                "a page of its own".to_string(),
            )
        };
        let mut slug = if used_slugs.contains(&slug_base) {
            kebab(base_name(&p.path))
        } else {
            slug_base
        };
        while used_slugs.contains(&slug) {
            slug.push_str("-2");
        }
        used_slugs.insert(slug.clone());
        slugs_by_path.insert(p.path.clone(), slug.clone());
        let (sections, header, footer) = template_sections(body, kind, &tokens);
        let mut parts = Vec::new();
        if header {
            parts.push("header".to_string());
        }
        if footer {
            parts.push("footer".to_string());
        }
        if (header || footer) && chrome.is_none() {
            chrome = Some((p, slug.clone()));
        }
        templates.push(Template {
            slug,
            title: bare_title(&p.title),
            kind,
            source: p.path.clone(),
            sections,
            parts,
            rule,
        });
    }

    // Components and listing templates from the sheets.
    let mut components = Vec::new();
    for p in &pages {
        if p.role == PageRole::Guide && kebab(&p.title).contains("component") {
            components.extend(crate::guide::components(p));
        }
    }
    for p in pages.iter().filter(|p| p.role == PageRole::Templates) {
        let found = crate::guide::components(p);
        let shared: Vec<&Component> = found
            .iter()
            .filter(|c| {
                let n = c.name.to_lowercase();
                ["bar", "filter", "nav", "navigation", "header", "footer"]
                    .iter()
                    .any(|w| n.split(' ').any(|x| x == *w))
            })
            .collect();
        for c in found
            .iter()
            .filter(|c| !shared.iter().any(|s| s.slug == c.slug))
        {
            let name = c.name.to_lowercase();
            let base = name
                .trim_end_matches(" entry")
                .trim_end_matches(" profile")
                .trim_end_matches(" card");
            let mut slug = kebab(base);
            while used_slugs.contains(&slug) {
                slug.push_str("-2");
            }
            used_slugs.insert(slug.clone());
            let mut sections: Vec<Section> = shared
                .iter()
                .map(|s| Section {
                    id: String::new(),
                    content: SectionContent::Component {
                        component: s.slug.clone(),
                    },
                    role: None,
                    props: BTreeMap::new(),
                    pattern: None,
                    rule: "a shared part of every listing on the sheet".into(),
                    facts: SectionFacts::default(),
                    html: String::new(),
                })
                .collect();
            let facts = c_facts(c);
            let items = facts.repeated.max(1);
            let mut props = BTreeMap::new();
            props.insert("component".into(), c.slug.clone());
            sections.push(Section {
                id: String::new(),
                content: SectionContent::Query {
                    query: ContentQuery {
                        source: QuerySource::Inherit,
                        items,
                    },
                },
                role: Some(slug.clone()),
                props,
                pattern: None,
                rule: format!(
                    "the sheet's part {}: the listing's entries",
                    c.number.clone().unwrap_or_default()
                ),
                facts,
                html: String::new(),
            });
            assign_ids(&mut sections);
            templates.push(Template {
                slug,
                title: c.subtitle.clone().unwrap_or_else(|| c.name.clone()),
                kind: TemplateKind::Listing,
                source: p.path.clone(),
                sections,
                parts: chrome
                    .as_ref()
                    .map(|_| vec!["header".into(), "footer".into()])
                    .unwrap_or_default(),
                rule: "a numbered part of a listings sheet".into(),
            });
        }
        components.extend(found);
    }

    // Parts, menus and languages from the first page with chrome.
    let (parts, navigation, languages) = match &chrome {
        Some((p, _)) => crate::guide::chrome(p, &templates, &slugs_by_path),
        None => (Vec::new(), Vec::new(), Vec::new()),
    };

    let mut design = SiteDesign {
        format: SITE_DESIGN_FORMAT.into(),
        bundle: bundle_hash.into(),
        title: texts
            .get("design.json")
            .and_then(|j| serde_json::from_str::<PagesIndex>(j).ok())
            .map(|i| i.title)
            .or_else(|| pages.first().map(|p| p.title.clone()))
            .unwrap_or_default(),
        languages,
        tokens,
        templates,
        parts,
        patterns: Vec::new(),
        components,
        navigation,
        rules: number_rules(pages.iter().flat_map(crate::guide::rules).collect()),
        pages: pages
            .iter()
            .map(|p| DesignPage {
                path: p.path.clone(),
                title: p.title.clone(),
                role: p.role,
            })
            .collect(),
        skipped,
    };
    patterns(&mut design, &pages);
    design
}

/// Principles and rules numbered across the design (`rule-1` … in page order); fixes keep the design's numbers.
fn number_rules(mut rules: Vec<DesignRule>) -> Vec<DesignRule> {
    let mut n: BTreeMap<&'static str, usize> = BTreeMap::new();
    for r in &mut rules {
        let prefix = match r.kind {
            RuleKind::Principle => "principle",
            RuleKind::Rule => "rule",
            RuleKind::Fix => continue,
        };
        let c = n.entry(prefix).or_default();
        *c += 1;
        r.id = format!("{prefix}-{c}");
    }
    rules
}

fn c_facts(c: &Component) -> SectionFacts {
    let h = dom::parse(&c.html);
    dom::body(&h)
        .and_then(|b| b.elements().next())
        .map(facts_of)
        .unwrap_or_default()
}

/// Sections (same key and class) and components used by two or more templates.
fn patterns(d: &mut SiteDesign, pages: &[Page]) {
    let mut uses: BTreeMap<(String, String), Vec<String>> = BTreeMap::new();
    for t in &d.templates {
        for s in &t.sections {
            let class = s.props.get("class").cloned().unwrap_or_default();
            let of = match &s.content {
                SectionContent::Component { component } => component.clone(),
                _ if class.is_empty() => continue,
                _ => s.key(),
            };
            let e = uses.entry((of, class)).or_default();
            if !e.contains(&t.slug) {
                e.push(t.slug.clone());
            }
        }
    }
    let _ = pages;
    let mut slugs = BTreeSet::new();
    for ((of, class), templates) in uses {
        if templates.len() < 2 {
            continue;
        }
        let base = kebab(if class.is_empty() {
            &of
        } else {
            class.split(' ').next().unwrap_or(&of)
        });
        let mut slug = base.clone();
        while slugs.contains(&slug) {
            slug.push_str("-2");
        }
        slugs.insert(slug.clone());
        let comp = d.components.iter().find(|c| c.slug == of);
        for t in &mut d.templates {
            for s in &mut t.sections {
                let same = match &s.content {
                    SectionContent::Component { component } => *component == of,
                    _ => {
                        s.key() == of
                            && s.props.get("class").map(String::as_str) == Some(class.as_str())
                    }
                };
                if same {
                    s.pattern = Some(slug.clone());
                }
            }
        }
        d.patterns.push(Pattern {
            slug,
            title: comp.map_or_else(|| of.clone(), |c| c.name.clone()),
            of,
            templates,
            html: comp.map(|c| c.html.clone()).unwrap_or_default(),
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numbers_follow_the_regex() {
        assert_eq!(
            count_numbers("12,000 visitors, 98% happy, 3rd place, 5k runs"),
            3
        );
        assert_eq!(count_numbers("h1 and 2024."), 1);
        assert_eq!(count_numbers("50% off"), 1);
    }

    #[test]
    fn titles_lose_their_board_numbers() {
        assert_eq!(bare_title("06 — Applied: Homepage"), "Applied: Homepage");
        assert_eq!(bare_title("02b — Iconography"), "Iconography");
        assert_eq!(bare_title("Home"), "Home");
    }

    #[test]
    fn kinds_from_names() {
        assert_eq!(kind_of_name("index"), Some(TemplateKind::Home));
        assert_eq!(kind_of_name("Applied: Homepage"), Some(TemplateKind::Home));
        assert_eq!(kind_of_name("article"), Some(TemplateKind::Single));
        assert_eq!(kind_of_name("404"), Some(TemplateKind::NotFound));
        assert_eq!(kind_of_name("stories"), Some(TemplateKind::Archive));
        assert_eq!(kind_of_name("village"), None);
    }
}
