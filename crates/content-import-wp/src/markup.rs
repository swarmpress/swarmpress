//! A JSON block as core block markup in one language (the import's block mapping).
//!
//! Every block becomes a `core/group` with the class `ct-{type}` (the theme styles the kinds),
//! holding its fields in their order as core blocks, so every string the live page shows is in
//! the post and WordPress's editor opens it as ordinary blocks:
//!
//! - a title-like field (`title`, `name`, `heading`, `question`…) → `core/heading`, one level
//!   below its group's; a badge-like field (`badge`, `category`, `eyebrow`…) → a small paragraph;
//! - an image field (`image`, `src`, `heroImage`…, a URL) → `core/image`, with `alt`/`caption`;
//! - a quote (`quote`, with `author`) → `core/quote`;
//! - text → `core/paragraph`s with the class `ct-{field}` (a list of strings: one paragraph each;
//!   `callouts`, `tags`, `recommendations`, `highlights`… → `core/list`, class `ct-{field}`), so a
//!   theme can place each field (the fields keep the source's order);
//! - `{text, url}`, `{label, href}` and `buttons` → `core/buttons`; a site link is given the
//!   page's language;
//! - `faqs` → `core/details` (the question as its summary);
//! - an object → a nested group (`ct-{key}`), a list of objects → one nested group per item; a
//!   story in a listing (`slug` with an `excerpt` or `readTime`) has its title link its article;
//!   a collection's interludes stand after the item their `afterIndex` names, as the live page
//!   shows them;
//! - presentation and bookkeeping (`id`, `variant`, `layout`, `display`, `accent`, `icon`, a
//!   `persona` id…) are left out; short scalars (`priceRange`, `distance`, `googleRating`…) → a
//!   `key: value` line.
//!
//! The source's inline Markdown (`**bold**`, `*em*`, `[text](url)`) and `<br/>` become HTML;
//! everything else is escaped. A block with no fields (the theme renders it from its own code)
//! becomes an empty group, and the import reports it.

use serde_json::{Map, Value};

use crate::{is_localized, localized, LANGS};

const SKIP: &[&str] = &[
    "type",
    "id",
    "variant",
    "layout",
    "display",
    "accent",
    "icon",
    "headingLevel",
    "showViewAll",
    "showOverview",
    "itemType",
    "collectionType",
    "afterIndex",
    "isLead",
    "slug",
    "coordinates",
    "lat",
    "lng",
    "color",
    "style",
    "theme",
    "number",
    // Presentation: a hero's height, an alignment, a listing's length, an image's side.
    "height",
    "align",
    "limit",
    "imagePosition",
];

const TITLES: &[&str] = &[
    "title", "name", "heading", "question", "headline", "label", "day",
];
const BADGES: &[&str] = &[
    "badge",
    "category",
    "eyebrow",
    "kicker",
    "subtitle_small",
    "village",
    "date",
    "readTime",
    "role",
    "duration",
    "pace",
    "effort",
    "bestSeason",
];
const IMAGES: &[&str] = &[
    "image",
    "src",
    "heroImage",
    "photo",
    "thumbnail",
    "cover",
    "avatar",
];
const LISTS: &[&str] = &[
    "callouts",
    "tags",
    "recommendations",
    "highlights",
    "tips",
    "items_text",
    "moments",
    "hobbies",
    "features",
    "amenities",
    "categories",
];

/// What the mapping met: kinds with no fields, for the import's report.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct Notes {
    pub empty_blocks: Vec<String>,
}

/// A link that may be per language (`"/en/x"` or `{"en": "/en/x", "de": "/de/x"}`).
fn url_in<'a>(v: &'a Value, lang: &str) -> Option<&'a str> {
    match v {
        Value::String(s) => Some(s.as_str()),
        Value::Object(_) => localized(v, lang),
        _ => None,
    }
}

/// The page's body (a list of JSON blocks) as block markup in `lang`. A body that opens with a
/// hero has that hero as the page's header: its title is the page's h1, and it carries the class
/// `ct-own-hero` (the theme then leaves its own title out, ADR-0094's h1 rule).
pub fn body(blocks: &[Value], lang: &str, notes: &mut Notes) -> String {
    let mut out = String::new();
    for (i, b) in blocks.iter().enumerate() {
        if i == 0 && is_hero(b) {
            out.push_str(&block_at(b, lang, notes, 1));
        } else {
            out.push_str(&block(b, lang, notes));
        }
    }
    out
}

/// A block whose type names a hero (`hero`, `editorial-hero`, `villageHero`).
pub fn is_hero(b: &Value) -> bool {
    b.get("type")
        .and_then(Value::as_str)
        .is_some_and(|t| class_name(t).split('-').any(|w| w == "hero") || t.ends_with("Hero"))
}

/// One JSON block as a `core/group` with the class `ct-{type}`.
pub fn block(b: &Value, lang: &str, notes: &mut Notes) -> String {
    block_at(b, lang, notes, 2)
}

/// [`block`] with its title-like fields at heading `level` (1: the page's own hero).
fn block_at(b: &Value, lang: &str, notes: &mut Notes, level: u8) -> String {
    let kind = b.get("type").and_then(Value::as_str).unwrap_or("block");
    let inner = match b {
        Value::Object(o) => fields(o, lang, level),
        _ => String::new(),
    };
    if inner.is_empty() {
        notes.empty_blocks.push(kind.to_string());
    }
    // A collection says what its items are (`ct-items-trail`): a theme may render kinds apart.
    let mut class = format!("ct-{}", class_name(kind));
    if level == 1 {
        class.push_str(" ct-own-hero");
    }
    if let Some(t) = b.get("itemType").and_then(Value::as_str) {
        class.push_str(&format!(" ct-items-{}", class_name(t)));
    }
    localize_links(&group(&class, &inner), lang)
}

/// Every site link (`href="/…"`) in the page's language, wherever the source wrote it.
fn localize_links(html: &str, lang: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut rest = html;
    while let Some(i) = rest.find("href=\"/") {
        out.push_str(&rest[..i + 6]);
        rest = &rest[i + 6..];
        let end = rest.find('"').unwrap_or(rest.len());
        out.push_str(&attr(&link(&decode_amp(&rest[..end]), lang)));
        rest = &rest[end..];
    }
    out.push_str(rest);
    out
}

fn decode_amp(s: &str) -> String {
    s.replace("&quot;", "\"")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
}

fn class_name(s: &str) -> String {
    s.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect()
}

fn kebab(key: &str) -> String {
    let mut out = String::new();
    for c in key.chars() {
        if c.is_ascii_uppercase() {
            out.push('-');
            out.push(c.to_ascii_lowercase());
        } else {
            out.push(c);
        }
    }
    class_name(&out)
}

/// An object's fields in order, at heading `level`.
fn fields(o: &Map<String, Value>, lang: &str, level: u8) -> String {
    let mut out = String::new();
    // A quote's author travels with the quote.
    let author = o.get("author").and_then(|a| localized(a, lang));
    let has_quote = o.get("quote").is_some_and(|q| localized(q, lang).is_some());
    // A button: {text, url}.
    if let (Some(text), Some(url)) = (
        o.get("text")
            .or(o.get("label"))
            .and_then(|t| localized(t, lang)),
        o.get("url").or(o.get("href")).and_then(|u| url_in(u, lang)),
    ) {
        if o.len() <= 4 {
            return buttons(&[(text.to_string(), link(url, lang))]);
        }
    }
    // A story in a listing links to its article (`slug` under a `stories` list).
    let story_link = (o.get("excerpt").is_some() || o.get("readTime").is_some())
        .then(|| o.get("slug").and_then(Value::as_str))
        .flatten()
        .map(|slug| link(&format!("/blog/{slug}"), lang));
    // Interludes between a collection's items, after the item each names.
    let interleave = matches!(
        (o.get("items"), o.get("interludes")),
        (Some(Value::Array(_)), Some(Value::Array(_)))
    );
    // A quote's title is its heading: it stands before the quote, in the document's order.
    let mut lead: Option<&str> = None;
    if has_quote {
        if let Some(k) = ["title", "heading"].into_iter().find(|k| {
            o.get(*k)
                .and_then(|t| localized(t, lang))
                .is_some_and(|t| !t.trim().is_empty())
        }) {
            out.push_str(&value(k, &o[k], lang, level));
            lead = Some(k);
        }
    }
    for (key, v) in o {
        let k = key.as_str();
        if interleave && k == "interludes" {
            continue;
        }
        if lead == Some(k) {
            continue;
        }
        if let (true, "items", Some(items), Some(interludes)) = (
            interleave,
            k,
            v.as_array(),
            o.get("interludes").and_then(Value::as_array),
        ) {
            out.push_str(&interleaved(items, interludes, lang, level));
            continue;
        }
        if let (Some(href), "title") = (&story_link, k) {
            if let Some(t) = localized(v, lang) {
                out.push_str(&heading(
                    &format!("<a href=\"{}\">{}</a>", attr(href), inline(t)),
                    level,
                ));
                continue;
            }
        }
        if SKIP.contains(&k)
            || k.starts_with('_')
            || (k == "author" && has_quote)
            // An editor's id (`"persona": "giulia"`); the team grid's persona is prose.
            || (k == "persona" && v.as_str().is_some_and(|s| !s.contains(' ')))
            || matches!(k, "alt" | "caption" | "imageAlt")
        {
            continue;
        }
        if v.is_null() || v == &Value::Bool(false) || v == &Value::Bool(true) {
            continue;
        }
        if IMAGES.contains(&k) {
            if let Some(src) = v.as_str().filter(|s| is_url(s)) {
                let alt = o
                    .get("alt")
                    .or(o.get("imageAlt"))
                    .and_then(|a| localized(a, lang))
                    .unwrap_or("");
                let caption = o.get("caption").and_then(|c| localized(c, lang));
                out.push_str(&image(src, alt, caption));
                continue;
            }
        }
        if k == "quote" {
            if let Some(q) = localized(v, lang) {
                out.push_str(&quote(q, author));
                continue;
            }
        }
        if k == "faqs" {
            if let Some(items) = v.as_array() {
                for f in items {
                    let q = f.get("question").and_then(|q| localized(q, lang));
                    let a = f.get("answer").and_then(|a| localized(a, lang));
                    if let (Some(q), Some(a)) = (q, a) {
                        out.push_str(&details(q, a));
                    }
                }
                continue;
            }
        }
        if k == "buttons" {
            if let Some(items) = v.as_array() {
                let bs: Vec<(String, String)> = items
                    .iter()
                    .filter_map(|b| {
                        // A button without a link is left out (never `#`); a link may be
                        // per language.
                        let t = b.get("text").and_then(|t| localized(t, lang))?;
                        let u = b
                            .get("url")
                            .or(b.get("href"))
                            .and_then(|u| url_in(u, lang))?;
                        (!u.trim().is_empty() && u.trim() != "#")
                            .then(|| (t.to_string(), link(u, lang)))
                    })
                    .collect();
                if !bs.is_empty() {
                    out.push_str(&buttons(&bs));
                }
                continue;
            }
        }
        out.push_str(&value(k, v, lang, level));
    }
    out
}

/// A collection's items with each interlude after the item its `afterIndex` names (before the
/// first item without one, after the last when the index is past the end).
fn interleaved(items: &[Value], interludes: &[Value], lang: &str, level: u8) -> String {
    let at = |x: &Value| {
        x.get("afterIndex").and_then(|a| {
            a.as_u64()
                .or_else(|| a.as_str().and_then(|s| s.parse().ok()))
        })
    };
    let one = |key: &str, x: &Value| list_field(key, std::slice::from_ref(x), lang, level);
    let mut out: String = interludes
        .iter()
        .filter(|x| at(x).is_none())
        .map(|x| one("interludes", x))
        .collect();
    for (i, item) in items.iter().enumerate() {
        out.push_str(&one("items", item));
        for x in interludes {
            let last = i + 1 == items.len();
            if at(x).is_some_and(|n| n as usize == i || (last && n as usize > i)) {
                out.push_str(&one("interludes", x));
            }
        }
    }
    out
}

/// One field's value.
fn value(key: &str, v: &Value, lang: &str, level: u8) -> String {
    match v {
        Value::String(_) => text_field(key, localized(v, lang).unwrap_or(""), lang, level),
        Value::Object(o) if is_localized(o) => match o.get(lang).or_else(|| o.get("en")) {
            Some(Value::Array(a)) => list_field(key, a, lang, level),
            Some(s @ Value::String(_)) => text_field(key, s.as_str().unwrap_or(""), lang, level),
            _ => o
                .values()
                .find_map(Value::as_str)
                .map(|s| text_field(key, s, lang, level))
                .unwrap_or_default(),
        },
        Value::Object(o) => {
            let inner = fields(o, lang, (level + 1).min(6));
            if inner.is_empty() {
                String::new()
            } else {
                group(&format!("ct-{}", kebab(key)), &inner)
            }
        }
        Value::Array(a) => list_field(key, a, lang, level),
        Value::Number(n) => meta_line(key, &n.to_string()),
        Value::Bool(_) | Value::Null => String::new(),
    }
}

/// `food_wine` → `Food wine`: a label field's value that is a slug, as words (ADR-0094's raw-slug
/// rule: labels are words, never identifiers).
pub fn humanize_slug(s: &str) -> String {
    let words = s.replace(['_', '-'], " ");
    let mut c = words.chars();
    match c.next() {
        Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
        None => String::new(),
    }
}

fn is_slug(s: &str) -> bool {
    !s.is_empty()
        && s.starts_with(|c: char| c.is_ascii_lowercase())
        && s.chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_')
}

/// Fields whose values are labels a reader sees (badges, categories, tags).
fn is_label_key(key: &str) -> bool {
    BADGES.contains(&key) || matches!(key, "tags" | "tag" | "labels" | "type" | "kind")
}

fn text_field(key: &str, s: &str, lang: &str, level: u8) -> String {
    let s = s.trim();
    if s.is_empty() {
        return String::new();
    }
    let humanized;
    let s = if is_label_key(key) && is_slug(s) {
        humanized = humanize_slug(s);
        humanized.as_str()
    } else {
        s
    };
    if is_url(s) {
        // A bare link field (`viewAllUrl`, `website`): a link paragraph.
        if key.to_ascii_lowercase().contains("url") || key == "website" || key == "link" {
            let href = link(s, lang);
            return paragraph_html(
                &format!("<a href=\"{}\">{}</a>", attr(&href), escape(&href)),
                Some(&format!("ct-{}", kebab(key))),
            );
        }
        return String::new();
    }
    if TITLES.contains(&key) {
        return heading(&inline(s), level);
    }
    if BADGES.contains(&key) {
        return paragraph_html(&inline(s), Some(&format!("ct-{}", kebab(key))));
    }
    if s.len() <= 24
        && !s.contains(' ')
        && !s.contains("\n\n")
        && s.chars()
            .any(|c| c.is_ascii_digit() || c == '$' || c == '€')
    {
        return meta_line(key, s);
    }
    let class = format!("ct-{}", kebab(key));
    paragraphs(s)
        .iter()
        .map(|p| paragraph_html(&inline(p), Some(&class)))
        .collect()
}

fn list_field(key: &str, a: &[Value], lang: &str, level: u8) -> String {
    if a.is_empty() {
        return String::new();
    }
    if a.iter().all(|x| localized(x, lang).is_some()) {
        let items: Vec<&str> = a.iter().filter_map(|x| localized(x, lang)).collect();
        if LISTS.contains(&key) {
            return list_with_class(&items, Some(&format!("ct-{}", kebab(key))));
        }
        return items
            .iter()
            .map(|s| text_field(key, s, lang, level))
            .collect();
    }
    let mut out = String::new();
    for item in a {
        match item {
            Value::Object(o) => {
                let inner = fields(o, lang, (level + 1).min(6));
                if !inner.is_empty() {
                    // An item's own classes (`_class`: its mode of transport, its place).
                    let mut class = format!("ct-{}-item", kebab(key));
                    if let Some(extra) = o.get("_class").and_then(Value::as_str) {
                        class.push(' ');
                        class.push_str(extra);
                    }
                    out.push_str(&group(&class, &inner));
                }
            }
            other => out.push_str(&value(key, other, lang, level)),
        }
    }
    out
}

fn meta_line(key: &str, v: &str) -> String {
    paragraph_html(
        &format!(
            "<span class=\"ct-meta-key\">{}</span> {}",
            escape(&humanize(key)),
            escape(v)
        ),
        Some(&format!("ct-meta ct-{}", kebab(key))),
    )
}

fn humanize(key: &str) -> String {
    let k = kebab(key).replace('-', " ");
    let mut c = k.chars();
    c.next()
        .map(|f| f.to_uppercase().collect::<String>() + c.as_str())
        .unwrap_or_default()
}

fn is_url(s: &str) -> bool {
    s.starts_with("https://")
        || s.starts_with("http://")
        || (s.starts_with('/') && !s.contains(' ') && s.len() > 1)
}

/// A site link in `lang`: `/itinerary` → `/de/itinerary/`; other links as they are.
pub fn link(url: &str, lang: &str) -> String {
    if !url.starts_with('/') || url.starts_with("//") {
        return url.to_string();
    }
    let (path, rest) = match url.find(['?', '#']) {
        Some(i) => (&url[..i], &url[i..]),
        None => (url, ""),
    };
    if path.contains('.') {
        return url.to_string();
    }
    let first = path.trim_start_matches('/').split('/').next().unwrap_or("");
    let path = if LANGS.contains(&first) {
        crate::routes::normalize(path)
    } else {
        crate::routes::normalize(&format!("/{lang}{path}"))
    };
    format!("{path}{rest}")
}

// ------------------------------------------------------------------ inline text

pub fn escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn attr(s: &str) -> String {
    escape(s).replace('"', "&quot;")
}

/// The source's inline Markdown and `<br/>` as HTML, everything else escaped.
pub fn inline(s: &str) -> String {
    let s = s
        .replace("<br/>", "\n")
        .replace("<br />", "\n")
        .replace("<br>", "\n");
    let mut out = String::new();
    let chars: Vec<char> = s.chars().collect();
    let mut i = 0;
    let mut bold = false;
    let mut em = false;
    while i < chars.len() {
        let c = chars[i];
        if c == '*' && chars.get(i + 1) == Some(&'*') {
            out.push_str(if bold { "</strong>" } else { "<strong>" });
            bold = !bold;
            i += 2;
            continue;
        }
        if c == '*' && (em || chars.get(i + 1).is_some_and(|n| !n.is_whitespace())) {
            out.push_str(if em { "</em>" } else { "<em>" });
            em = !em;
            i += 1;
            continue;
        }
        if c == '[' {
            if let Some((text, url, used)) = md_link(&chars[i..]) {
                out.push_str(&format!("<a href=\"{}\">{}</a>", attr(&url), escape(&text)));
                i += used;
                continue;
            }
        }
        match c {
            '\n' => out.push_str("<br>"),
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            _ => out.push(c),
        }
        i += 1;
    }
    if em {
        out.push_str("</em>");
    }
    if bold {
        out.push_str("</strong>");
    }
    restore_inline_tags(&out)
}

/// The inline HTML a source string may carry (`<strong>`, `<em>`, `<b>`, `<i>`, `<a href>`), which
/// the live site renders: kept as tags after escaping; any other tag stays escaped text.
fn restore_inline_tags(escaped: &str) -> String {
    let mut out = escaped.to_string();
    for t in ["strong", "em", "b", "i"] {
        out = out
            .replace(&format!("&lt;{t}&gt;"), &format!("<{t}>"))
            .replace(&format!("&lt;/{t}&gt;"), &format!("</{t}>"));
    }
    out = out.replace("&lt;/a&gt;", "</a>");
    let open = "&lt;a href=\"";
    let mut res = String::with_capacity(out.len());
    let mut rest = out.as_str();
    while let Some(i) = rest.find(open) {
        res.push_str(&rest[..i]);
        let after = &rest[i + open.len()..];
        match after.find("\"&gt;") {
            Some(end) if !after[..end].contains(['"', '<', '>']) => {
                res.push_str(&format!("<a href=\"{}\">", &after[..end]));
                rest = &after[end + "\"&gt;".len()..];
            }
            _ => {
                res.push_str(open);
                rest = after;
            }
        }
    }
    res.push_str(rest);
    res
}

/// A text's paragraphs: its HTML paragraphs (`<p>…</p>`) when it has them, else its blank-line
/// separated blocks.
fn paragraphs(s: &str) -> Vec<String> {
    if s.contains("<p>") || s.contains("</p>") {
        s.split("</p>")
            .map(|p| p.replace("<p>", " ").trim().to_string())
            .filter(|p| !p.is_empty())
            .collect()
    } else {
        s.split("\n\n")
            .map(|p| p.trim().to_string())
            .filter(|p| !p.is_empty())
            .collect()
    }
}

fn md_link(chars: &[char]) -> Option<(String, String, usize)> {
    let close = chars.iter().position(|c| *c == ']')?;
    if chars.get(close + 1) != Some(&'(') {
        return None;
    }
    let end = chars[close + 2..].iter().position(|c| *c == ')')? + close + 2;
    let text: String = chars[1..close].iter().collect();
    let url: String = chars[close + 2..end].iter().collect();
    Some((text, url, end + 1))
}

// ------------------------------------------------------------------ core blocks

fn json_attrs(attrs: &Value) -> String {
    match attrs {
        Value::Object(o) if !o.is_empty() => format!(" {}", attrs),
        _ => String::new(),
    }
}

pub fn group(class: &str, inner: &str) -> String {
    let attrs = serde_json::json!({"className": class, "layout": {"type": "constrained"}});
    format!(
        "<!-- wp:group{} -->\n<div class=\"wp-block-group {}\">{}</div>\n<!-- /wp:group -->\n",
        json_attrs(&attrs),
        attr(class),
        inner
    )
}

pub fn heading(html: &str, level: u8) -> String {
    let level = level.clamp(1, 6);
    let attrs = if level == 2 {
        Value::Null
    } else {
        serde_json::json!({ "level": level })
    };
    format!(
        "<!-- wp:heading{} -->\n<h{level} class=\"wp-block-heading\">{html}</h{level}>\n<!-- /wp:heading -->\n",
        json_attrs(&attrs)
    )
}

pub fn paragraph_html(html: &str, class: Option<&str>) -> String {
    match class {
        Some(c) => format!(
            "<!-- wp:paragraph {} -->\n<p class=\"{}\">{html}</p>\n<!-- /wp:paragraph -->\n",
            serde_json::json!({ "className": c }),
            attr(c)
        ),
        None => format!("<!-- wp:paragraph -->\n<p>{html}</p>\n<!-- /wp:paragraph -->\n"),
    }
}

pub fn image(src: &str, alt: &str, caption: Option<&str>) -> String {
    let cap = caption
        .filter(|c| !c.trim().is_empty())
        .map(|c| {
            format!(
                "<figcaption class=\"wp-element-caption\">{}</figcaption>",
                inline(c)
            )
        })
        .unwrap_or_default();
    format!(
        "<!-- wp:image -->\n<figure class=\"wp-block-image\"><img src=\"{}\" alt=\"{}\"/>{cap}</figure>\n<!-- /wp:image -->\n",
        attr(src),
        attr(alt)
    )
}

pub fn quote(text: &str, author: Option<&str>) -> String {
    let cite = author
        .filter(|a| !a.trim().is_empty())
        .map(|a| format!("<cite>{}</cite>", escape(a)))
        .unwrap_or_default();
    format!(
        "<!-- wp:quote -->\n<blockquote class=\"wp-block-quote\">{}{cite}</blockquote>\n<!-- /wp:quote -->\n",
        paragraph_html(&inline(text), None)
    )
}

pub fn list(items: &[&str]) -> String {
    list_with_class(items, None)
}

/// A `core/list` with a class of its own.
pub fn list_with_class(items: &[&str], class: Option<&str>) -> String {
    let lis: String = items
        .iter()
        .map(|i| {
            format!(
                "<!-- wp:list-item -->\n<li>{}</li>\n<!-- /wp:list-item -->\n",
                inline(i)
            )
        })
        .collect();
    match class {
        Some(c) => format!(
            "<!-- wp:list {} -->\n<ul class=\"wp-block-list {}\">{lis}</ul>\n<!-- /wp:list -->\n",
            serde_json::json!({ "className": c }),
            attr(c)
        ),
        None => {
            format!("<!-- wp:list -->\n<ul class=\"wp-block-list\">{lis}</ul>\n<!-- /wp:list -->\n")
        }
    }
}

/// Every `alt=""` in `html` described by its section (an image must say what it shows, and never
/// by the page's or the site's title): the heading of the group the image stands in, else the
/// heading before it, else `fallback` (the page's headline). Returns the markup and how many
/// images had no description of their own (a content gap).
pub fn fill_alt(html: &str, fallback: &str) -> (String, usize) {
    const EMPTY: &str = "alt=\"\"";
    if !html.contains(EMPTY) {
        return (html.to_string(), 0);
    }
    let heading_text = |seg: &str| -> Option<String> {
        let mut at = 0;
        while let Some(i) = seg[at..].find("<h") {
            let start = at + i;
            at = start + 2;
            let level = seg[start + 2..].chars().next()?;
            if !('1'..='6').contains(&level) {
                continue;
            }
            let open_end = start + seg[start..].find('>')? + 1;
            let close = open_end + seg[open_end..].find(&format!("</h{level}>"))?;
            let text = strip_tags(&seg[open_end..close])
                .replace("&amp;", "&")
                .replace("&#8217;", "\u{2019}");
            if !text.is_empty() {
                return Some(text);
            }
        }
        None
    };
    let last_heading = |seg: &str| -> Option<String> {
        let mut found = None;
        let mut at = 0;
        while let Some(i) = seg[at..].find("<h") {
            let start = at + i;
            at = start + 2;
            if let Some(t) = heading_text(&seg[start..]) {
                found = Some(t);
            }
        }
        found
    };
    let mut out = String::with_capacity(html.len() + 256);
    let mut n = 0;
    let mut at = 0;
    while let Some(i) = html[at..].find(EMPTY) {
        let p = at + i;
        let group_start = html[..p].rfind("<div class=\"wp-block-group").unwrap_or(0);
        let group_end = html[p..]
            .find("<!-- /wp:group -->")
            .map_or(html.len(), |j| p + j);
        let text = heading_text(&html[group_start..group_end])
            .or_else(|| last_heading(&html[..p]))
            .unwrap_or_else(|| fallback.trim().to_string());
        out.push_str(&html[at..p]);
        out.push_str(&format!("alt=\"{}\"", attr(&text)));
        n += 1;
        at = p + EMPTY.len();
    }
    out.push_str(&html[at..]);
    (out, n)
}

/// Text without its tags (`<br/>` as a space), whitespace collapsed.
pub fn strip_tags(s: &str) -> String {
    let s = s
        .replace("<br/>", " ")
        .replace("<br />", " ")
        .replace("<br>", " ");
    let mut out = String::new();
    let mut in_tag = false;
    for c in s.chars() {
        match c {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub fn details(summary: &str, body: &str) -> String {
    let paras: String = body
        .split("\n\n")
        .filter(|p| !p.trim().is_empty())
        .map(|p| paragraph_html(&inline(p.trim()), None))
        .collect();
    format!(
        "<!-- wp:details -->\n<details class=\"wp-block-details\"><summary>{}</summary>{paras}</details>\n<!-- /wp:details -->\n",
        inline(summary)
    )
}

pub fn buttons(items: &[(String, String)]) -> String {
    let bs: String = items
        .iter()
        .map(|(text, url)| {
            format!(
                "<!-- wp:button -->\n<div class=\"wp-block-button\"><a class=\"wp-block-button__link wp-element-button\" href=\"{}\">{}</a></div>\n<!-- /wp:button -->\n",
                attr(url),
                inline(text)
            )
        })
        .collect();
    format!(
        "<!-- wp:buttons -->\n<div class=\"wp-block-buttons\">{bs}</div>\n<!-- /wp:buttons -->\n"
    )
}
