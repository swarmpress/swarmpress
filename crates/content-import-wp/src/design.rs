//! The site's content for a design's components (ADR-0093 addendum, 2026-10-14).
//!
//! With a design as data the import gives the content the structure its components render, the
//! same way for every site, from the content model's own data (nothing is invented):
//!
//! - **items** say what they are: a collection's class `ct-items-{itemType}`, a way to arrive its
//!   mode (`ct-mode-train`, by its name's words), an itinerary's day its place (`ct-place-…`);
//! - **facts**: a practical line of two or more `Label: value.` parts becomes a row of facts
//!   (`ct-facts`, each `ct-fact` with its label and value; a grade's word its step, `ct-grade-2`),
//!   which the design's ledger renders;
//! - **a story** ([`article`]): its byline and dateline (`ct-byline`: initials, author, the place,
//!   date, category and reading time), its lede, picture, a contents list linking its sections'
//!   headings (`ct-contents`, the headings given anchors), its text, tags and the author's line;
//!   [`continue_reading`] adds what to read next (`ct-continue-reading`: the same place first, then
//!   the same category);
//! - **block styles**: a block whose class a theme's block style names gets `is-style-{name}`
//!   ([`apply_block_styles`]);
//! - **page types** ([`page_type`]) and the template each page takes ([`template_for`]);
//! - **content gaps** ([`gaps`]): what a design's component asks for that the content lacks (an
//!   activity's time, cost and season; a story's category), reported, never filled in.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::markup;
use crate::plan::Doc;
use crate::routes::{Route, Source, VILLAGES};
use crate::theme_data::{BlockStyle, ThemeData};
use crate::{localized, LANGS};

fn li(lang: &str) -> usize {
    LANGS.iter().position(|l| *l == lang).unwrap_or(0)
}

// The design's words the import writes, in English: the import and the export put them in each
// page's language from the site's label table (`site_export::labels`).
const ON_THIS_PAGE: &str = "On this page";
const MORE_FROM: &str = "More from";
const MORE_IN: &str = "More in";

/// Ways to arrive and the words that name them (en, de, fr, it).
const MODES: [(&str, &[&str]); 6] = [
    (
        "train",
        &["train", "rail", "zug", "bahn", "treno", "ferrovia"],
    ),
    (
        "boat",
        &[
            "boat",
            "ferry",
            "ferries",
            "sea",
            "fähre",
            "schiff",
            "boot",
            "bateau",
            "traghetto",
            "battello",
        ],
    ),
    (
        "plane",
        &[
            "airport",
            "airports",
            "flight",
            "flights",
            "fly",
            "plane",
            "flug",
            "avion",
            "vol",
            "volo",
            "aereo",
            "flughafen",
            "aéroport",
            "aeroporto",
        ],
    ),
    ("bus", &["bus", "shuttle", "navetta"]),
    (
        "car",
        &[
            "car", "drive", "driving", "road", "parking", "taxi", "auto", "voiture", "macchina",
        ],
    ),
    (
        "walk",
        &[
            "walk", "walking", "foot", "hike", "trail", "path", "wandern", "pied", "piedi",
            "sentiero",
        ],
    ),
];

/// A grade's word and its step on a four-step scale (en, de, fr, it).
const GRADES: [(&[&str], u8); 4] = [
    (&["easy", "leicht", "facile", "facili"], 1),
    (
        &[
            "moderate", "mittel", "modéré", "modere", "moderata", "moderato", "medium",
        ],
        2,
    ),
    (
        &[
            "challenging",
            "difficult",
            "hard",
            "schwer",
            "anspruchsvoll",
            "difficile",
            "impegnativo",
            "impegnativa",
        ],
        3,
    ),
    (
        &[
            "strenuous",
            "expert",
            "very difficult",
            "sehr schwer",
            "très difficile",
            "molto difficile",
        ],
        4,
    ),
];

fn words_of(s: &str) -> BTreeSet<String> {
    s.to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .map(String::from)
        .collect()
}

/// The place a village name or slug names.
pub fn place_slug(text: &str) -> Option<&'static str> {
    let w = words_of(text);
    VILLAGES
        .iter()
        .find(|(slug, names)| {
            w.contains(*slug) || names.iter().any(|n| w.contains(&n.to_lowercase()))
        })
        .map(|(slug, _)| *slug)
}

/// The JSON blocks prepared for the design's components (module docs): items' own classes.
pub fn prepare(blocks: &mut [Value]) {
    for b in blocks.iter_mut() {
        let item_type = b
            .get("itemType")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let kind = b
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let Some(o) = b.as_object_mut() else { continue };
        if matches!(item_type.as_str(), "transport" | "route" | "option") {
            if let Some(Value::Array(items)) = o.get_mut("items") {
                for it in items {
                    let said = format!(
                        "{} {}",
                        it.get("name")
                            .and_then(|n| localized(n, "en"))
                            .unwrap_or(""),
                        it.get("category")
                            .and_then(|n| localized(n, "en"))
                            .unwrap_or("")
                    );
                    let w = words_of(&said);
                    if let Some((mode, _)) = MODES
                        .iter()
                        .find(|(_, ws)| ws.iter().any(|x| w.contains(*x)))
                    {
                        if let Some(io) = it.as_object_mut() {
                            io.insert("_class".into(), json!(format!("ct-mode-{mode}")));
                        }
                    }
                }
            }
        }
        if kind == "itinerary-days" {
            if let Some(Value::Array(days)) = o.get_mut("days") {
                for d in days {
                    let v = d
                        .get("village")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string();
                    if let (Some(slug), Some(io)) = (place_slug(&v), d.as_object_mut()) {
                        io.insert("_class".into(), json!(format!("ct-place-{slug}")));
                    }
                }
            }
        }
        if kind == "team-grid" {
            if let Some(Value::Array(eds)) = o.get_mut("editors") {
                for e in eds {
                    let bio = e
                        .get("bio")
                        .and_then(|b| localized(b, "en"))
                        .unwrap_or("")
                        .to_string();
                    if let (Some(slug), Some(io)) = (place_slug(&bio), e.as_object_mut()) {
                        io.insert("_class".into(), json!(format!("ct-place-{slug}")));
                    }
                }
            }
        }
    }
}

/// `Distance: 3km. Time: 1.5 hours. Difficulty: Moderate. Requires …` → the facts and the rest.
pub fn parse_facts(text: &str) -> Option<(Vec<(String, String)>, String)> {
    let mut facts = Vec::new();
    let mut rest = Vec::new();
    for part in text.split(". ").map(|p| p.trim().trim_end_matches('.')) {
        if part.is_empty() {
            continue;
        }
        match part.split_once(':') {
            Some((label, value))
                if label.split_whitespace().count() <= 2
                    && !label.trim().is_empty()
                    && !value.trim().is_empty()
                    && value.split_whitespace().count() <= 4 =>
            {
                facts.push((label.trim().to_string(), value.trim().to_string()));
            }
            _ => rest.push(format!("{part}.")),
        }
    }
    (facts.len() >= 2).then(|| (facts, rest.join(" ")))
}

fn grade(value: &str) -> Option<u8> {
    let v = value.to_lowercase();
    GRADES
        .iter()
        .rev()
        .find(|(ws, _)| ws.iter().any(|w| v.contains(w)))
        .map(|(_, g)| *g)
}

/// Every practical line with facts as a row of facts (module docs).
pub fn facts(content: &str) -> String {
    const OPEN: &str = "<!-- wp:paragraph {\"className\":\"ct-practical-info\"} -->\n<p class=\"ct-practical-info\">";
    const CLOSE: &str = "</p>\n<!-- /wp:paragraph -->\n";
    let mut out = String::with_capacity(content.len());
    let mut rest = content;
    while let Some(i) = rest.find(OPEN) {
        out.push_str(&rest[..i]);
        let after = &rest[i + OPEN.len()..];
        let Some(j) = after.find(CLOSE) else {
            out.push_str(&rest[i..]);
            return out;
        };
        let html = &after[..j];
        let text = markup::strip_tags(html)
            .replace("&amp;", "&")
            .replace("&#39;", "'")
            .replace("&quot;", "\"");
        match parse_facts(&text) {
            Some((fs, note)) => {
                let mut inner = String::new();
                for (label, value) in &fs {
                    let mut class = format!("ct-fact ct-fact-{}", class_of(label));
                    if let Some(g) = grade(value) {
                        class.push_str(&format!(" ct-grade-{g}"));
                    }
                    let cell = format!(
                        "{}{}",
                        markup::paragraph_html(&markup::escape(label), Some("ct-fact-label")),
                        markup::paragraph_html(&markup::escape(value), Some("ct-fact-value"))
                    );
                    inner.push_str(&markup::group(&class, &cell));
                }
                if !note.trim().is_empty() {
                    inner.push_str(&markup::paragraph_html(
                        &markup::escape(&note),
                        Some("ct-fact-note"),
                    ));
                }
                out.push_str(&markup::group("ct-facts ct-practical-info-facts", &inner));
            }
            None => {
                out.push_str(OPEN);
                out.push_str(html);
                out.push_str(CLOSE);
            }
        }
        rest = &after[j + CLOSE.len()..];
    }
    out.push_str(rest);
    out
}

fn class_of(s: &str) -> String {
    let mut out = String::new();
    for c in s.to_lowercase().chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c);
        } else if !out.ends_with('-') && !out.is_empty() {
            out.push('-');
        }
    }
    out.trim_end_matches('-').to_string()
}

/// A heading's anchor (`The Sweet Spot: May and September` → `the-sweet-spot-may-and-september`).
pub fn anchor(text: &str) -> String {
    let a = class_of(&markup::strip_tags(text));
    if a.is_empty() {
        "section".into()
    } else {
        a.chars()
            .take(60)
            .collect::<String>()
            .trim_end_matches('-')
            .to_string()
    }
}

fn heading_anchor(html: &str, level: u8, id: &str) -> String {
    format!(
        "<!-- wp:heading {} -->\n<h{level} class=\"wp-block-heading\" id=\"{id}\">{html}</h{level}>\n<!-- /wp:heading -->\n",
        json!({"level": level, "anchor": id})
    )
}

/// The initials of a name (`Marco Bianchi` → `MB`).
fn initials(name: &str) -> String {
    name.split_whitespace()
        .filter_map(|w| w.chars().next())
        .filter(|c| c.is_alphabetic())
        .take(2)
        .collect::<String>()
        .to_uppercase()
}

/// A story's place: the first village its title, subtitle or tags name.
pub fn story_place(post: &Value, lang: &str) -> Option<&'static str> {
    let mut said = String::new();
    for k in ["title", "subtitle", "category"] {
        if let Some(t) = post.get(k).and_then(|t| localized(t, lang)) {
            said.push(' ');
            said.push_str(t);
        }
    }
    for t in post
        .get("tags")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        if let Some(t) = localized(t, lang) {
            said.push(' ');
            said.push_str(t);
        }
    }
    place_slug(&said)
}

/// A story (`blog-article`) as the design's article (module docs).
pub fn article(b: &Value, lang: &str) -> String {
    let null = Value::Null;
    let post = b.get("post").unwrap_or(&null);
    let text = |k: &str| {
        post.get(k)
            .and_then(|t| localized(t, lang))
            .map(str::to_string)
    };
    let mut out = String::new();
    // Byline and dateline.
    let place = story_place(post, lang);
    let place_name = place
        .and_then(|p| VILLAGES.iter().find(|(s, _)| *s == p))
        .map(|(_, n)| n[li(lang)]);
    let mut by = String::new();
    if let Some(a) = text("author").or_else(|| {
        post.get("author")
            .and_then(|a| a.get("name"))
            .and_then(|n| localized(n, lang))
            .map(str::to_string)
    }) {
        by.push_str(&markup::paragraph_html(
            &markup::escape(&initials(&a)),
            Some("ct-avatar"),
        ));
        by.push_str(&markup::paragraph_html(
            &markup::escape(&a),
            Some("ct-author"),
        ));
    }
    let mut dateline: Vec<String> = Vec::new();
    if let Some(d) = text("date") {
        dateline.push(match place_name {
            Some(p) => format!("{} — {d}", p.to_uppercase()),
            None => d,
        });
    }
    for k in ["category", "readTime"] {
        if let Some(v) = text(k) {
            dateline.push(v);
        }
    }
    if !dateline.is_empty() {
        by.push_str(&markup::paragraph_html(
            &markup::escape(&dateline.join(" · ")),
            Some("ct-dateline"),
        ));
    }
    if !by.is_empty() {
        let class = match place {
            Some(p) => format!("ct-byline ct-place-{p}"),
            None => "ct-byline".into(),
        };
        out.push_str(&markup::group(&class, &by));
    }
    if let Some(s) = text("subtitle") {
        out.push_str(&markup::paragraph_html(
            &markup::inline(&s),
            Some("ct-subtitle"),
        ));
    }
    if let Some(src) = post.get("image").and_then(Value::as_str) {
        let alt = text("imageAlt")
            .or_else(|| text("title"))
            .unwrap_or_default();
        out.push_str(&markup::image(src, &alt, text("caption").as_deref()));
    }
    // The text: its intro, then its sections with anchored headings, listed in the contents.
    let content = b.get("content").unwrap_or(&null);
    let sections: Vec<(String, String)> = content
        .get("sections")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|s| {
                    let t = s.get("title").and_then(|t| localized(t, lang))?;
                    let body = s.get("text").and_then(|t| localized(t, lang)).unwrap_or("");
                    Some((t.to_string(), body.to_string()))
                })
                .collect()
        })
        .unwrap_or_default();
    if sections.len() >= 2 {
        let items: Vec<String> = sections
            .iter()
            .map(|(t, _)| format!("<a href=\"#{}\">{}</a>", anchor(t), markup::inline(t)))
            .collect();
        let lis: String = items
            .iter()
            .map(|i| format!("<!-- wp:list-item -->\n<li>{i}</li>\n<!-- /wp:list-item -->\n"))
            .collect();
        let mut inner =
            markup::paragraph_html(&markup::escape(ON_THIS_PAGE), Some("ct-contents-label"));
        inner.push_str(&format!(
            "<!-- wp:list {{\"ordered\":true}} -->\n<ol class=\"wp-block-list\">{lis}</ol>\n<!-- /wp:list -->\n"
        ));
        out.push_str(&markup::group("ct-contents", &inner));
    }
    if let Some(intro) = content.get("intro").and_then(|t| localized(t, lang)) {
        for p in intro.split("\n\n").filter(|p| !p.trim().is_empty()) {
            out.push_str(&markup::paragraph_html(
                &markup::inline(p.trim()),
                Some("ct-intro"),
            ));
        }
    }
    let mut seen = BTreeSet::new();
    for (t, body) in &sections {
        let mut id = anchor(t);
        while !seen.insert(id.clone()) {
            id.push_str("-2");
        }
        out.push_str(&heading_anchor(&markup::inline(t), 2, &id));
        for p in body.split("\n\n").filter(|p| !p.trim().is_empty()) {
            out.push_str(&markup::paragraph_html(
                &markup::inline(p.trim()),
                Some("ct-text"),
            ));
        }
    }
    // What else the content holds (its own fields, as the import maps every block).
    if let Value::Object(c) = content {
        let mut other = c.clone();
        other.remove("intro");
        other.remove("sections");
        if !other.is_empty() {
            let mut notes = markup::Notes::default();
            let rest = markup::block(
                &json!({"type": "article-more", "more": Value::Object(other)}),
                lang,
                &mut notes,
            );
            if notes.empty_blocks.is_empty() {
                out.push_str(&rest);
            }
        }
    }
    if let Some(tags) = post.get("tags").and_then(Value::as_array) {
        let ts: Vec<&str> = tags.iter().filter_map(|t| localized(t, lang)).collect();
        if !ts.is_empty() {
            out.push_str(&markup::list_with_class(&ts, Some("ct-tags")));
        }
    }
    if let Some(bio) = text("authorBio").or_else(|| {
        post.get("author")
            .and_then(|a| a.get("bio"))
            .and_then(|b| localized(b, lang))
            .map(str::to_string)
    }) {
        // The author's profile closes the story (the design's editor profile, 7.5): initials,
        // name, role when the content gives one, the bio.
        let mut inner = String::new();
        if let Some(a) = text("author").or_else(|| {
            post.get("author")
                .and_then(|a| a.get("name"))
                .and_then(|n| localized(n, lang))
                .map(str::to_string)
        }) {
            inner.push_str(&markup::paragraph_html(
                &markup::escape(&initials(&a)),
                Some("ct-avatar"),
            ));
            inner.push_str(&markup::paragraph_html(
                &markup::escape(&a),
                Some("ct-author"),
            ));
        }
        if let Some(role) = text("authorRole").or_else(|| {
            post.get("author")
                .and_then(|a| a.get("role"))
                .and_then(|r| localized(r, lang))
                .map(str::to_string)
        }) {
            inner.push_str(&markup::paragraph_html(
                &markup::escape(&role),
                Some("ct-role"),
            ));
        }
        inner.push_str(&markup::paragraph_html(
            &markup::inline(&bio),
            Some("ct-author-bio"),
        ));
        let class = match place {
            Some(p) => format!("ct-author-profile ct-place-{p}"),
            None => "ct-author-profile".into(),
        };
        out.push_str(&markup::group(&class, &inner));
    }
    markup::group("ct-blog-article", &out)
}

/// What to read after each story (module docs): three other stories in its language, the same
/// place first, then the same category, then the newest.
pub fn continue_reading(docs: &mut [Doc]) {
    #[derive(Clone)]
    struct S {
        route: String,
        lang: String,
        title: String,
        category: Option<String>,
        place: Option<String>,
        date: String,
    }
    let stories: Vec<S> = docs
        .iter()
        .filter(|d| d.post_type == "post")
        .map(|d| S {
            route: d.route.clone(),
            lang: d.lang.clone(),
            title: d.title.clone(),
            category: d.category.clone(),
            place: d.meta.get("_swarmpress_story_place").cloned(),
            date: d.date.clone().unwrap_or_default(),
        })
        .collect();
    for d in docs.iter_mut().filter(|d| d.post_type == "post") {
        let place = d.meta.get("_swarmpress_story_place").cloned();
        let mut others: Vec<&S> = stories
            .iter()
            .filter(|s| s.lang == d.lang && s.route != d.route)
            .collect();
        others.sort_by(|a, b| {
            let rank = |s: &S| {
                (
                    u8::from(!(place.is_some() && s.place == place)),
                    u8::from(!(d.category.is_some() && s.category == d.category)),
                )
            };
            rank(a)
                .cmp(&rank(b))
                .then_with(|| b.date.cmp(&a.date))
                .then_with(|| a.route.cmp(&b.route))
        });
        let picked: Vec<&S> = others.into_iter().take(3).collect();
        if picked.is_empty() {
            continue;
        }
        let i = li(&d.lang);
        // The design's words alone in their span (labels), the place or category after them.
        let word = |w: &str| {
            format!(
                "<span class=\"ct-related-word\">{}</span>",
                markup::escape(w)
            )
        };
        let label = match (&place, &d.category) {
            (Some(p), _) if picked.first().is_some_and(|s| s.place.as_ref() == Some(p)) => {
                let name = VILLAGES
                    .iter()
                    .find(|(s, _)| s == p)
                    .map_or(p.as_str(), |(_, n)| n[i]);
                format!("{} {}", word(MORE_FROM), markup::escape(name))
            }
            (_, Some(c)) => format!("{} {}", word(MORE_IN), markup::escape(c)),
            _ => word(MORE_IN),
        };
        let lis: String = picked
            .iter()
            .map(|s| {
                let mut meta: Vec<String> = Vec::new();
                if let Some(c) = &s.category {
                    meta.push(c.clone());
                }
                if let Some(p) = &s.place {
                    if let Some((_, n)) = VILLAGES.iter().find(|(x, _)| x == p) {
                        meta.push(n[i].to_string());
                    }
                }
                format!(
                    "<!-- wp:list-item -->\n<li><a href=\"{}\">{}</a> <span class=\"ct-related-meta\">{}</span></li>\n<!-- /wp:list-item -->\n",
                    s.route,
                    markup::escape(&s.title),
                    markup::escape(&meta.join(" · "))
                )
            })
            .collect();
        let mut inner = markup::paragraph_html(&label, Some("ct-related-label"));
        inner.push_str(&format!(
            "<!-- wp:list {{\"ordered\":true}} -->\n<ol class=\"wp-block-list\">{lis}</ol>\n<!-- /wp:list -->\n"
        ));
        d.content
            .push_str(&markup::group("ct-continue-reading", &inner));
    }
}

/// Every block whose class a block style names gets `is-style-{name}` (in its attributes and its
/// HTML), so the theme's CSS renders it as the component.
pub fn apply_block_styles(content: &str, styles: &[BlockStyle]) -> String {
    let mut by_class: BTreeMap<&str, &str> = BTreeMap::new();
    for s in styles {
        for c in &s.classes {
            by_class.entry(c.as_str()).or_insert(s.name.as_str());
        }
    }
    if by_class.is_empty() {
        return content.to_string();
    }
    // A block comment `<!-- wp:name {…"className":"a b"…} -->` and the first tag after it.
    let mut out = String::with_capacity(content.len() + 1024);
    let mut rest = content;
    while let Some(i) = rest.find("\"className\":\"") {
        let start = i + "\"className\":\"".len();
        let Some(len) = rest[start..].find('"') else {
            break;
        };
        let classes = &rest[start..start + len];
        // A block takes one style: its most specific class's (a collection of ways to arrive is
        // the mode table, not a generic collection).
        let mut found: Vec<(&str, &str)> = classes
            .split_whitespace()
            .filter_map(|c| by_class.get(c).map(|n| (c, *n)))
            .collect();
        if found.len() > 1 {
            found.retain(|(c, _)| !c.starts_with("ct-collection"));
        }
        let add: Vec<&str> = found
            .into_iter()
            .map(|(_, n)| n)
            .take(1)
            .filter(|n| !classes.contains(&format!("is-style-{n}")))
            .collect();
        if add.is_empty() {
            out.push_str(&rest[..start + len]);
            rest = &rest[start + len..];
            continue;
        }
        let extra: String = add.iter().map(|n| format!(" is-style-{n}")).collect();
        out.push_str(&rest[..start + len]);
        out.push_str(&extra);
        rest = &rest[start + len..];
        // The HTML's class attribute: the first `class="…"` after the comment holding the classes.
        if let Some(end) = rest.find("-->") {
            let after = end + 3;
            if let Some(ci) = rest[after..].find(&format!("{classes}\"")) {
                let at = after + ci + classes.len();
                out.push_str(&rest[..at]);
                out.push_str(&extra);
                rest = &rest[at..];
            }
        }
    }
    out.push_str(rest);
    out
}

/// A page's type (module docs): `home`, `article`, `village`, `village-{section}`, else its
/// content's `page_type`, else `page`.
pub fn page_type(r: &Route, page: &Value, post: bool) -> String {
    let segs: Vec<&str> = r
        .path
        .trim_matches('/')
        .split('/')
        .filter(|s| !s.is_empty())
        .collect();
    if segs.len() <= 1 && (segs.is_empty() || LANGS.contains(&segs[0])) {
        return "home".into();
    }
    if post {
        return "article".into();
    }
    if let Some(v) = &r.village {
        return match segs.as_slice() {
            [_, x] if x == v => "village".into(),
            [_, x, s] if x == v => format!("village-{}", class_of(s)),
            _ => "village".into(),
        };
    }
    if crate::compose::is_village_overview(r) {
        return "villages".into();
    }
    if let Source::Empty { .. } = r.source {
        return "page".into();
    }
    let t = page
        .get("page_type")
        .and_then(Value::as_str)
        .unwrap_or("page");
    let t = class_of(t);
    if t.is_empty() || t == "language-root" {
        "page".into()
    } else {
        t
    }
}

/// The template a page takes (module docs): the homes the front page's, a listing its listing's
/// (`archive-{listing}`) when the design has one, a story `single`, every other page its type's
/// (`page-{type}`). `listings` are the design's listing templates.
pub fn template_for(route: &str, page_type: &str, listings: &BTreeSet<String>) -> String {
    match page_type {
        "home" if route == "/" => "front-page".into(),
        "home" => crate::theme::LANGUAGE_HOME.into(),
        "article" => "single".into(),
        _ => {
            if let Some(l) = crate::plan::listing_of(route) {
                let slug = format!("archive-{l}");
                if listings.contains(&slug) {
                    return slug;
                }
            }
            format!("page-{page_type}")
        }
    }
}

/// The template of each page type (module docs): its listing's when any of its pages is a
/// listing the design has (a type's pages in other languages have other slugs), else `page-{type}`.
pub fn type_templates(docs: &[Doc], listings: &BTreeSet<String>) -> BTreeMap<String, String> {
    let mut out: BTreeMap<String, String> = BTreeMap::new();
    for d in docs {
        let Some(key) = d.meta.get("_swarmpress_page_type") else {
            continue;
        };
        if matches!(key.as_str(), "home" | "article") {
            continue;
        }
        let t = template_for(&d.route, key, listings);
        if t.starts_with("archive-") {
            out.insert(key.clone(), t);
        } else {
            out.entry(key.clone()).or_insert(t);
        }
    }
    out
}

/// The template a page takes, by its type ([`type_templates`]); the homes and stories by route.
pub fn page_template(
    d: &Doc,
    types: &BTreeMap<String, String>,
    listings: &BTreeSet<String>,
) -> String {
    let key = d
        .meta
        .get("_swarmpress_page_type")
        .map_or("page", String::as_str);
    types
        .get(key)
        .cloned()
        .unwrap_or_else(|| template_for(&d.route, key, listings))
}

/// The design's listing templates in `data`.
pub fn listings(data: &ThemeData) -> BTreeSet<String> {
    data.templates
        .iter()
        .filter(|t| t.slug.starts_with("archive-"))
        .map(|t| t.slug.clone())
        .collect()
}

/// A page type as the theme designer needs it: its pages, its template, its content's classes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PageTypeSummary {
    pub key: String,
    pub label: String,
    pub template: String,
    pub count: u32,
    pub sample: String,
    pub kinds: BTreeMap<String, u32>,
    pub post: bool,
    pub placed: bool,
}

/// The `ct-…` classes a page's content holds (blocks and fields).
pub fn content_classes(content: &str) -> BTreeSet<String> {
    let mut out = BTreeSet::new();
    let mut rest = content;
    while let Some(i) = rest.find("class=\"") {
        let start = i + 7;
        let Some(len) = rest[start..].find('"') else {
            break;
        };
        for c in rest[start..start + len].split_whitespace() {
            if c.starts_with("ct-") && c.len() > 3 {
                out.insert(c.to_string());
            }
        }
        rest = &rest[start + len..];
    }
    out
}

/// The site's page types (module docs), from the plan's documents: each with the template the
/// import gives its pages under `listings` (the design's listing templates).
pub fn page_types(docs: &[Doc], listings: &BTreeSet<String>) -> Vec<PageTypeSummary> {
    let mut by: BTreeMap<String, PageTypeSummary> = BTreeMap::new();
    for d in docs {
        let Some(key) = d.meta.get("_swarmpress_page_type") else {
            continue;
        };
        let template = template_for(&d.route, key, listings);
        let e = by.entry(key.clone()).or_insert_with(|| PageTypeSummary {
            key: key.clone(),
            label: label_of(key),
            template,
            count: 0,
            sample: String::new(),
            kinds: BTreeMap::new(),
            post: d.post_type == "post",
            placed: true,
        });
        e.count += 1;
        if e.sample.is_empty() || (d.lang == "en" && !e.sample.starts_with("/en/")) {
            e.sample = d.route.clone();
        }
        e.placed &= d.meta.contains_key("_swarmpress_place");
        for c in content_classes(&d.content) {
            *e.kinds.entry(c).or_default() += 1;
        }
    }
    by.into_values().collect()
}

fn label_of(key: &str) -> String {
    let words = key.replace('-', " ");
    match key.strip_prefix("village-") {
        Some(s) => format!("{} (a village's)", capital(&s.replace('-', " "))),
        None => capital(&words),
    }
}

fn capital(s: &str) -> String {
    let mut c = s.chars();
    c.next()
        .map(|f| f.to_uppercase().chain(c).collect())
        .unwrap_or_default()
}

/// The template coverage check (ADR-0093 addendum): every page takes a template composed for
/// its type, one the theme has, never a generic one (`page`, `index`), unless its route is listed
/// in `exceptions` with a reason. One line per page that does not.
pub fn template_coverage(
    docs: &[Doc],
    data: &ThemeData,
    exceptions: &BTreeMap<String, String>,
) -> Vec<String> {
    let have: BTreeSet<&str> = data.templates.iter().map(|t| t.slug.as_str()).collect();
    let mut out = Vec::new();
    for d in docs {
        if exceptions.contains_key(&d.route) {
            continue;
        }
        let t = if d.post_type == "post" {
            "single".to_string()
        } else if d.route == "/" {
            "front-page".to_string()
        } else {
            d.template.clone().unwrap_or_else(|| "page".into())
        };
        if matches!(t.as_str(), "page" | "index") || !have.contains(t.as_str()) {
            out.push(format!(
                "{} ({}) renders with {}: the theme has no template composed for it",
                d.route,
                d.meta
                    .get("_swarmpress_page_type")
                    .map_or("?", String::as_str),
                if have.contains(t.as_str()) {
                    t.clone()
                } else {
                    format!("{t}, which the theme lacks")
                }
            ));
        }
    }
    out
}

/// A content gap: what a design's component asks of the content that the content lacks.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Gap {
    pub what: String,
    pub count: u32,
    pub example: String,
}

/// The content gaps of a plan (module docs): stories without a category, entries without the
/// fields the design's listings show, ratings without their source's scale.
pub fn gaps(docs: &[Doc], entries: &[crate::entries::Entry]) -> Vec<Gap> {
    let mut by: BTreeMap<String, (u32, String)> = BTreeMap::new();
    let mut add = |what: String, example: &str| {
        let e = by.entry(what).or_insert((0, example.to_string()));
        e.0 += 1;
    };
    // A way to arrive without its time (the mode table shows it in the display face).
    for d in docs {
        let c = d.content.as_str();
        let mut missing = 0;
        let mut at = 0;
        while let Some(i) = c[at..].find("<summary>") {
            let start = at + i;
            at = start + 9;
            let open = &c[c[..start].rfind("<details").unwrap_or(start)..start];
            let end = c[at..].find("</summary>").map_or(c.len(), |j| at + j);
            if open.contains("ct-mode-row") && !c[at..end].contains("ct-mode-time") {
                missing += 1;
            }
        }
        for _ in 0..missing {
            add(
                "a way to arrive without its time (its mode table row shows no time)".into(),
                &d.route,
            );
        }
    }
    for d in docs.iter().filter(|d| d.post_type == "post") {
        if !d.meta.contains_key("image") {
            add(
                "a story without a picture (its card shows the text only)".into(),
                &d.route,
            );
        }
        if d.meta.contains_key("_swarmpress_category_from_badge") {
            add(
                "a story without a category (its hero's badge stands in, fix-06)".into(),
                &d.route,
            );
        }
    }
    for e in entries {
        let need: &[&str] = match e.post_type.as_str() {
            "sp_activity" => &["duration", "cost", "best"],
            "sp_restaurant" => &["book", "closed", "menu", "ask"],
            _ => &[],
        };
        for f in need {
            if !e.fields.get(*f).is_some_and(|v| !v.trim().is_empty()) {
                add(
                    format!(
                        "{} without \"{f}\" (the design's {} entry shows it)",
                        e.post_type,
                        e.post_type.trim_start_matches("sp_")
                    ),
                    &e.slug,
                );
            }
        }
        if matches!(e.post_type.as_str(), "sp_stay" | "sp_village")
            && !e.fields.contains_key("image")
        {
            add(
                format!(
                    "{} without a picture (its card shows the text only)",
                    e.post_type
                ),
                &e.slug,
            );
        }
        if e.post_type == "sp_restaurant" && e.fields.contains_key("rating") {
            add(
                "a restaurant's rating without its source (the content has an average of its reviews; the design shows each source's rating on its own scale, never averaged)".into(),
                &e.slug,
            );
        }
    }
    by.into_iter()
        .map(|(what, (count, example))| Gap {
            what,
            count,
            example,
        })
        .collect()
}

/// The words the import writes itself in the content, in English (module docs of
/// `theme_designer::labels`): the names of a page's facts (`<span class="ct-meta-key">Google
/// rating</span>`), each once, sorted.
pub fn content_words(docs: &[Doc]) -> Vec<String> {
    const OPEN: &str = "<span class=\"ct-meta-key\">";
    let mut out = BTreeSet::new();
    for d in docs {
        let mut rest = d.content.as_str();
        while let Some(i) = rest.find(OPEN) {
            rest = &rest[i + OPEN.len()..];
            if let Some(end) = rest.find('<') {
                let w = rest[..end].trim();
                if !w.is_empty() {
                    out.insert(w.to_string());
                }
            }
        }
    }
    out.into_iter().collect()
}

/// A collection of ways to arrive (items with a mode, `ct-mode-{mode}`, [`prepare`]) as the
/// design's mode table (4.14): one compact row per mode (its icon, its name, a note, its time in
/// the display face) that opens to the rest of the item; the collection's interludes follow the
/// table. `None` for any other block.
pub fn mode_table(b: &Value, lang: &str) -> Option<String> {
    let items = b.get("items").and_then(Value::as_array)?;
    let mode_of = |it: &Value| {
        it.get("_class")
            .and_then(Value::as_str)
            .and_then(|c| c.split_whitespace().find(|c| c.starts_with("ct-mode-")))
            .map(str::to_string)
    };
    // Ways to arrive: most of the items name their mode (a way the words do not name is a row
    // of its own, `ct-mode-other`, without an icon).
    let named = items.iter().filter(|it| mode_of(it).is_some()).count();
    if items.is_empty() || named * 2 <= items.len() {
        return None;
    }
    let text = |it: &Value, k: &str| {
        it.get(k)
            .and_then(|v| localized(v, lang))
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
    };
    let mut rows = String::new();
    for it in items {
        let mode = mode_of(it).unwrap_or_else(|| "ct-mode-other".into());
        let name = text(it, "name")
            .or_else(|| text(it, "title"))
            .unwrap_or_default();
        let (time, rest) = match text(it, "duration") {
            Some(d) => split_time(&d),
            None => (None, None),
        };
        let note = rest
            .or_else(|| text(it, "frequency"))
            .or_else(|| text(it, "category"));
        let mut summary = format!(
            "<span class=\"ct-mode-name\">{}</span>",
            markup::escape(&name)
        );
        if let Some(n) = &note {
            summary.push_str(&format!(
                "<span class=\"ct-mode-note\">{}</span>",
                markup::escape(n)
            ));
        }
        if let Some(t) = &time {
            summary.push_str(&format!(
                "<span class=\"ct-mode-time\">{}</span>",
                markup::escape(t)
            ));
        }
        // The rest of the item opens under its row.
        let mut more = it.clone();
        if let Some(o) = more.as_object_mut() {
            for k in ["name", "title", "duration", "_class"] {
                o.remove(k);
            }
            o.insert("type".into(), json!("mode-detail"));
        }
        let mut notes = markup::Notes::default();
        let inner = markup::block(&more, lang, &mut notes);
        let class = format!("ct-items-item ct-mode-row {mode}");
        rows.push_str(&format!(
            "<!-- wp:details {{\"className\":\"{class}\"}} -->\n<details class=\"wp-block-details {class}\"><summary>{summary}</summary>{inner}</details>\n<!-- /wp:details -->\n"
        ));
    }
    let mut class = format!(
        "ct-{} ct-mode-table",
        b.get("type")
            .and_then(Value::as_str)
            .unwrap_or("collection")
    );
    if let Some(t) = b.get("itemType").and_then(Value::as_str) {
        class.push_str(&format!(" ct-items-{t}"));
    }
    let mut out = String::new();
    if let Some(h) = b
        .get("heading")
        .or(b.get("title"))
        .and_then(|h| localized(h, lang))
    {
        out.push_str(&format!(
            "<!-- wp:heading -->\n<h2 class=\"wp-block-heading\">{}</h2>\n<!-- /wp:heading -->\n",
            markup::inline(h)
        ));
    }
    out.push_str(&rows);
    let mut html = markup::group(&class, &out);
    // The collection's interludes after the table, as the design's pull quotes.
    if let Some(xs) = b.get("interludes").and_then(Value::as_array) {
        for x in xs {
            let mut q = x.clone();
            if let Some(o) = q.as_object_mut() {
                o.remove("afterIndex");
                o.insert("type".into(), json!("editorial-interlude"));
            }
            let mut notes = markup::Notes::default();
            html.push_str(&markup::block(&q, lang, &mut notes));
        }
    }
    Some(html)
}

/// A way's time and the rest of its words: `8 min from La Spezia` → (`8 min`, `from La
/// Spezia`); a short value is all time (`2 h`); a value without a number is a note.
pub fn split_time(d: &str) -> (Option<String>, Option<String>) {
    let d = d.trim();
    let starts_with_number = d.chars().next().is_some_and(|c| c.is_ascii_digit());
    if !starts_with_number {
        return (None, Some(d.to_string()));
    }
    let words: Vec<&str> = d.split_whitespace().collect();
    // The number (with a range: `20-30`, `1.5`), then a unit word when one follows.
    let unit = |w: &str| {
        let w = w.trim_end_matches(['.', ',']).to_lowercase();
        w.chars().all(char::is_alphabetic)
            && w.len() <= 8
            && !w.is_empty()
            && (w.starts_with('m') || w.starts_with('h') || w.starts_with('s') || w == "ore")
    };
    let mut n = 1;
    if words.len() > 1 && unit(words[1]) {
        n = 2;
    }
    let time = words[..n].join(" ").trim_end_matches(',').to_string();
    let rest = words[n..].join(" ");
    let rest = rest
        .trim_start_matches(['(', '–', '-', ',', ' '])
        .trim_end_matches(')');
    (Some(time), (!rest.is_empty()).then(|| rest.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn facts_are_read_from_a_practical_line() {
        let (f, rest) = parse_facts(
            "Distance: 3km. Time: 1.5 hours. Difficulty: Moderate. Requires Cinque Terre Card.",
        )
        .unwrap();
        assert_eq!(
            f,
            [
                ("Distance".to_string(), "3km".to_string()),
                ("Time".to_string(), "1.5 hours".to_string()),
                ("Difficulty".to_string(), "Moderate".to_string())
            ]
        );
        assert_eq!(rest, "Requires Cinque Terre Card.");
        assert!(parse_facts("Book months ahead for summer. Stairs unavoidable.").is_none());
        let html = format!(
            "x{}y",
            markup::paragraph_html(
                "Entfernung: 3km. Zeit: 1,5 Stunden. Schwierigkeit: Mittel.",
                Some("ct-practical-info")
            )
        );
        let out = facts(&html);
        assert!(out.contains("ct-facts"), "{out}");
        assert!(
            out.contains("ct-fact ct-fact-schwierigkeit ct-grade-2"),
            "{out}"
        );
        assert!(out.starts_with('x') && out.ends_with('y'));
        let prose = markup::paragraph_html("Book months ahead.", Some("ct-practical-info"));
        assert_eq!(facts(&prose), prose);
    }

    #[test]
    fn block_styles_reach_the_blocks_and_their_html() {
        let c = format!(
            "{}{}",
            markup::group("ct-faq-section", "<p>q</p>"),
            markup::paragraph_html("x", Some("ct-giulia-comment"))
        );
        let styles = vec![
            BlockStyle {
                name: "accordion".into(),
                label: "Accordion".into(),
                component: "accordion".into(),
                classes: vec!["ct-faq-section".into()],
            },
            BlockStyle {
                name: "editorial-callouts-local-wisdom".into(),
                label: "Callout".into(),
                component: "editorial-callouts".into(),
                classes: vec!["ct-giulia-comment".into()],
            },
        ];
        let out = apply_block_styles(&c, &styles);
        assert!(
            out.contains("\"className\":\"ct-faq-section is-style-accordion\""),
            "{out}"
        );
        assert!(
            out.contains("class=\"wp-block-group ct-faq-section is-style-accordion\""),
            "{out}"
        );
        assert!(
            out.contains(
                "<p class=\"ct-giulia-comment is-style-editorial-callouts-local-wisdom\">"
            ),
            "{out}"
        );
        // Applying twice changes nothing.
        assert_eq!(apply_block_styles(&out, &styles), out);
    }

    #[test]
    fn page_types_and_their_templates() {
        let r = |path: &str, village: Option<&str>| Route {
            path: path.into(),
            lang: "en".into(),
            source: Source::Page {
                path: "x.json".into(),
            },
            village: village.map(String::from),
        };
        let page = json!({"page_type": "faq"});
        assert_eq!(page_type(&r("/en/", None), &page, false), "home");
        assert_eq!(page_type(&r("/en/blog/x/", None), &page, true), "article");
        assert_eq!(
            page_type(&r("/en/manarola/", Some("manarola")), &page, false),
            "village"
        );
        assert_eq!(
            page_type(&r("/en/manarola/hiking/", Some("manarola")), &page, false),
            "village-hiking"
        );
        assert_eq!(
            page_type(&r("/en/cinque-terre/faq/", None), &page, false),
            "faq"
        );
        let listings = BTreeSet::from(["archive-activity".to_string()]);
        assert_eq!(
            template_for("/en/manarola/sights/", "village-sights", &listings),
            "archive-activity"
        );
        assert_eq!(
            template_for("/en/manarola/hiking/", "village-hiking", &listings),
            "page-village-hiking"
        );
        assert_eq!(template_for("/", "home", &listings), "front-page");
        assert_eq!(template_for("/de/", "home", &listings), "page-front");
    }
}
