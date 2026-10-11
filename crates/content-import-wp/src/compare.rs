//! The export against the live site, URL by URL (plan M8 step 3): status, title, content, links.
//!
//! Each page is reduced to its [`Facts`]: the title, the description, the text of its `<main>`
//! (the whole `<body>` when it has none; scripts, styles, `<nav>`, `<header>` and `<footer>` left
//! out), one line per text block, and its site links. A URL then compares as:
//!
//! - **status**: the live site's against the export's (a page, a redirect, or missing);
//! - **title**: equal after whitespace and case are folded;
//! - **content**: the share (permille) of the live page's word trigrams (within a text block, so
//!   the order of fields does not count) the exported page has;
//! - **links**: the live page's links to live pages that the exported page lacks.
//!
//! What many pages repeat is the theme's, not the page's: a trigram or a link on more live pages
//! than any one piece of content is published on (the footer, the menu, the labels a theme prints
//! around fields; [`compare_with`], or more than half the pages by default) is left out of both
//! checks, so the two themes' chrome does not count, wherever the live theme put it. A live link to a URL the live
//! site does not serve (a 404 there) is not required either: it is counted, as the live site's own
//! broken links, and the import may fix it.
//!
//! A URL passes when its status matches, its content reaches [`CONTENT_PERMILLE`] and it lacks
//! no link. The title is reported, not required (the export carries the SEO title the live page
//! had as its `<title>`, but the live theme sets some titles of its own).

use std::collections::{BTreeMap, BTreeSet};

use serde::Serialize;

/// The content share a page must keep to pass.
pub const CONTENT_PERMILLE: u32 = 900;

/// What a page is, for the comparison.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct Facts {
    pub status: u16,
    pub title: String,
    pub description: String,
    pub text: String,
    /// Site links by path (`/en/vernazza/`), query and fragment dropped.
    pub links: BTreeSet<String>,
}

impl Facts {
    /// The facts of an HTML page served at `status`; `origin` is the site's own origin, whose
    /// absolute links count as site links.
    pub fn from_html(status: u16, html: &str, origin: &str) -> Facts {
        let title = between(html, "<title", "</title>")
            .map(|t| decode(&strip(t.split_once('>').map(|x| x.1).unwrap_or(t))))
            .unwrap_or_default();
        let description = meta_description(html).unwrap_or_default();
        let body = between(html, "<main", "</main>")
            .or_else(|| between(html, "<body", "</body>"))
            .unwrap_or(html);
        // Comments are markup, and `[object Object]` is a script's mistake, never content.
        let mut cleaned = drop_comments(body).replace("[object Object]", " ");
        for tag in [
            "script", "style", "nav", "header", "footer", "noscript", "svg", "template",
        ] {
            cleaned = drop_elements(&cleaned, tag);
        }
        let text = decode(&blocks_text(&cleaned));
        let links = links(body, origin);
        Facts {
            status,
            title,
            description,
            text,
            links,
        }
    }
}

/// One URL's comparison.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct UrlReport {
    pub path: String,
    pub live_status: u16,
    pub export_status: u16,
    pub title_matches: bool,
    pub live_title: String,
    pub export_title: String,
    pub content_permille: u32,
    pub missing_links: Vec<String>,
    pub pass: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct Summary {
    pub urls: u32,
    pub passed: u32,
    pub status_mismatches: u32,
    pub titles_differ: u32,
    pub content_below: u32,
    pub missing_links: u32,
    /// The median content share (permille).
    pub content_median_permille: u32,
    /// Live links to URLs the live site does not serve (not required of the export).
    pub live_broken_links: u32,
    /// Trigrams on more live pages than any content is published on: the theme's, left out.
    pub chrome_trigrams: u32,
    /// Export pages the live site does not have.
    pub extra_in_export: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct Report {
    pub summary: Summary,
    pub urls: Vec<UrlReport>,
}

/// Compares the live site's pages with the export's, by path; what more than half the live pages
/// have is the theme's.
pub fn compare(live: &BTreeMap<String, Facts>, export: &BTreeMap<String, Facts>) -> Report {
    let pages = live.values().filter(|f| f.status == 200).count();
    compare_with(live, export, pages / 2)
}

/// Compares, with what more than `shared` live pages have counted as the theme's: given the most
/// pages any one source is published on (a hub standing in for many sections), a trigram on more
/// pages than that cannot be content.
pub fn compare_with(
    live: &BTreeMap<String, Facts>,
    export: &BTreeMap<String, Facts>,
    shared: usize,
) -> Report {
    let pages: Vec<&Facts> = live.values().filter(|f| f.status == 200).collect();
    let chrome_trigrams = repeated(pages.iter().map(|f| trigrams(&f.text)), shared);
    let chrome_links = repeated(pages.iter().map(|f| f.links.clone()), shared);
    let mut urls = Vec::new();
    let mut s = Summary::default();
    let mut shares = Vec::new();
    for (path, l) in live {
        let missing = Facts {
            status: 404,
            ..Facts::default()
        };
        let e = export.get(path).unwrap_or(&missing);
        let status_ok = l.status == e.status || (l.status / 100 == 3 && e.status / 100 == 3);
        let own: BTreeSet<String> = trigrams(&l.text)
            .difference(&chrome_trigrams)
            .cloned()
            .collect();
        let content = share(&own, &trigrams(&e.text));
        let mut missing_links = Vec::new();
        for link in l.links.difference(&chrome_links) {
            if live.get(link).is_some_and(|f| f.status == 200) {
                if !e.links.contains(link) {
                    missing_links.push(link.clone());
                }
            } else {
                s.live_broken_links += 1;
            }
        }
        let title_matches = fold(&l.title) == fold(&e.title);
        let pass = status_ok && content >= CONTENT_PERMILLE && missing_links.is_empty();
        s.urls += 1;
        s.passed += u32::from(pass);
        s.status_mismatches += u32::from(!status_ok);
        s.titles_differ += u32::from(!title_matches);
        s.content_below += u32::from(content < CONTENT_PERMILLE);
        s.missing_links += u32::try_from(missing_links.len()).unwrap_or(u32::MAX);
        shares.push(content);
        urls.push(UrlReport {
            path: path.clone(),
            live_status: l.status,
            export_status: e.status,
            title_matches,
            live_title: l.title.clone(),
            export_title: e.title.clone(),
            content_permille: content,
            missing_links,
            pass,
        });
    }
    shares.sort_unstable();
    s.content_median_permille = shares.get(shares.len() / 2).copied().unwrap_or(0);
    s.chrome_trigrams = u32::try_from(chrome_trigrams.len()).unwrap_or(u32::MAX);
    s.extra_in_export = export
        .iter()
        .filter(|(p, f)| f.status == 200 && !live.contains_key(*p))
        .map(|(p, _)| p.clone())
        .collect();
    Report { summary: s, urls }
}

/// What more than `shared` of the sets have (nothing when there are fewer than four sets).
fn repeated(sets: impl Iterator<Item = BTreeSet<String>>, shared: usize) -> BTreeSet<String> {
    let mut count: BTreeMap<String, usize> = BTreeMap::new();
    let mut n = 0usize;
    for set in sets {
        n += 1;
        for x in set {
            *count.entry(x).or_default() += 1;
        }
    }
    if n < 4 {
        return BTreeSet::new();
    }
    count
        .into_iter()
        .filter(|(_, c)| *c > shared)
        .map(|(x, _)| x)
        .collect()
}

fn fold(s: &str) -> String {
    s.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

fn words(s: &str) -> Vec<String> {
    s.split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .map(str::to_lowercase)
        .collect()
}

/// The word trigrams of each line (a text block) on its own: a trigram never spans two blocks, so
/// the order a theme puts fields in does not count.
fn trigrams(s: &str) -> BTreeSet<String> {
    let mut out = BTreeSet::new();
    for line in s.lines() {
        let w = words(line);
        if w.len() < 3 {
            out.extend(w);
        } else {
            out.extend(w.windows(3).map(|x| x.join(" ")));
        }
    }
    out
}

fn share(reference: &BTreeSet<String>, candidate: &BTreeSet<String>) -> u32 {
    if reference.is_empty() {
        return 1000;
    }
    let hit = reference.intersection(candidate).count();
    u32::try_from(hit * 1000 / reference.len()).unwrap_or(1000)
}

/// The share (permille) of `reference`'s word trigrams that `candidate` has (1000 when the
/// reference has none).
pub fn coverage(reference: &str, candidate: &str) -> u32 {
    share(&trigrams(reference), &trigrams(candidate))
}

// ------------------------------------------------------------------ a small HTML reader

fn find_ci(hay: &str, needle: &str, from: usize) -> Option<usize> {
    let h = hay.as_bytes();
    let n = needle.as_bytes();
    if n.is_empty() || from >= h.len() {
        return None;
    }
    (from..=h.len().saturating_sub(n.len())).find(|&i| h[i..i + n.len()].eq_ignore_ascii_case(n))
}

/// The text from `open` (a tag start such as `<main`, whose tag is included) up to `close`.
fn between<'a>(html: &'a str, open: &str, close: &str) -> Option<&'a str> {
    let mut i = find_ci(html, open, 0)?;
    // `<main` must not match `<mainframe`: the next byte ends the tag name.
    while !matches!(
        html.as_bytes().get(i + open.len()),
        Some(b'>' | b' ' | b'\n' | b'\t' | b'/')
    ) {
        i = find_ci(html, open, i + 1)?;
    }
    let j = find_ci(html, close, i)?;
    html.get(i..j)
}

fn drop_elements(html: &str, tag: &str) -> String {
    let open = format!("<{tag}");
    let close = format!("</{tag}>");
    let mut out = String::with_capacity(html.len());
    let mut at = 0;
    while let Some(i) = find_ci(html, &open, at) {
        let next = html.as_bytes().get(i + open.len()).copied();
        if !matches!(next, Some(b'>' | b' ' | b'\n' | b'\t' | b'/')) {
            out.push_str(&html[at..i + open.len()]);
            at = i + open.len();
            continue;
        }
        out.push_str(&html[at..i]);
        // Nested elements of the same name: count depth.
        let mut depth = 0usize;
        let mut k = i;
        let end = loop {
            let o = find_ci(html, &open, k + 1);
            let c = find_ci(html, &close, k + 1);
            match (o, c) {
                (Some(o), Some(c)) if o < c => {
                    depth += 1;
                    k = o;
                }
                (_, Some(c)) => {
                    if depth == 0 {
                        break c + close.len();
                    }
                    depth -= 1;
                    k = c;
                }
                (_, None) => break html.len(),
            }
        };
        out.push(' ');
        at = end;
    }
    out.push_str(&html[at..]);
    out
}

fn drop_comments(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut rest = html;
    while let Some(i) = rest.find("<!--") {
        out.push_str(&rest[..i]);
        rest = match rest[i..].find("-->") {
            Some(e) => &rest[i + e + 3..],
            None => "",
        };
    }
    out.push_str(rest);
    out
}

/// Inline elements: text inside them runs on with the text around them.
const INLINE: &[&str] = &[
    "a", "strong", "em", "b", "i", "span", "small", "sup", "sub", "mark", "code", "abbr", "cite",
    "q", "u", "s", "time",
];

/// The text of `html`, one line per text block: a tag ends a line unless it is inline.
fn blocks_text(html: &str) -> String {
    let mut lines = vec![String::new()];
    let mut rest = html;
    while let Some(i) = rest.find('<') {
        lines.last_mut().expect("a line").push_str(&rest[..i]);
        let Some(end) = rest[i..].find('>') else {
            rest = "";
            break;
        };
        let tag = &rest[i + 1..i + end];
        let name: String = tag
            .trim_start_matches('/')
            .chars()
            .take_while(|c| c.is_ascii_alphanumeric())
            .collect::<String>()
            .to_ascii_lowercase();
        if INLINE.contains(&name.as_str()) {
            lines.last_mut().expect("a line").push(' ');
        } else {
            lines.push(String::new());
        }
        rest = &rest[i + end + 1..];
    }
    lines.last_mut().expect("a line").push_str(rest);
    lines
        .iter()
        .map(|l| l.split_whitespace().collect::<Vec<_>>().join(" "))
        .filter(|l| !l.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

fn strip(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut in_tag = false;
    for c in html.chars() {
        match c {
            '<' => {
                in_tag = true;
                out.push(' ');
            }
            '>' => in_tag = false,
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// The common entities, numeric ones included.
pub fn decode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(i) = rest.find('&') {
        out.push_str(&rest[..i]);
        let tail = &rest[i..];
        let Some(end) = tail.find(';').filter(|e| *e <= 10) else {
            out.push('&');
            rest = &tail[1..];
            continue;
        };
        let ent = &tail[1..end];
        let ch = match ent {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            "nbsp" => Some(' '),
            "rsquo" | "lsquo" => Some('\''),
            "rdquo" | "ldquo" => Some('"'),
            "ndash" => Some('–'),
            "mdash" => Some('—'),
            "hellip" => Some('…'),
            _ if ent.starts_with("#x") || ent.starts_with("#X") => {
                u32::from_str_radix(&ent[2..], 16)
                    .ok()
                    .and_then(char::from_u32)
            }
            _ if ent.starts_with('#') => ent[1..].parse().ok().and_then(char::from_u32),
            _ => None,
        };
        match ch {
            Some(c) => {
                out.push(c);
                rest = &tail[end + 1..];
            }
            None => {
                out.push('&');
                rest = &tail[1..];
            }
        }
    }
    out.push_str(rest);
    // Typographic quotes count as plain ones on both sides.
    out.replace(['\u{2019}', '\u{2018}'], "'")
        .replace(['\u{201c}', '\u{201d}'], "\"")
}

fn attr_value(tag: &str, name: &str) -> Option<String> {
    let mut from = 0;
    while let Some(i) = find_ci(tag, name, from) {
        let before = tag.as_bytes().get(i.wrapping_sub(1)).copied();
        let after = &tag[i + name.len()..];
        let after_t = after.trim_start();
        if matches!(before, Some(b' ' | b'\n' | b'\t')) && after_t.starts_with('=') {
            let v = after_t[1..].trim_start();
            let (q, body) = match v.chars().next() {
                Some(q @ ('"' | '\'')) => (q, &v[1..]),
                _ => {
                    let end = v.find([' ', '>']).unwrap_or(v.len());
                    return Some(decode(&v[..end]));
                }
            };
            return body.find(q).map(|e| decode(&body[..e]));
        }
        from = i + name.len();
    }
    None
}

fn meta_description(html: &str) -> Option<String> {
    let mut from = 0;
    while let Some(i) = find_ci(html, "<meta", from) {
        let end = html[i..].find('>')? + i;
        let tag = &html[i..end];
        if attr_value(tag, "name").is_some_and(|n| n.eq_ignore_ascii_case("description")) {
            return attr_value(tag, "content");
        }
        from = end;
    }
    None
}

/// A site link's path: `/en/x/` (a trailing slash added to a path without an extension).
pub fn site_path(href: &str, origin: &str) -> Option<String> {
    let href = href.trim();
    let rel = if let Some(r) = href.strip_prefix(origin.trim_end_matches('/')) {
        if r.is_empty() {
            "/"
        } else {
            r
        }
    } else if href.starts_with('/') && !href.starts_with("//") {
        href
    } else {
        return None;
    };
    let path = rel.split(['?', '#']).next().unwrap_or("");
    if path.is_empty() {
        return None;
    }
    let last = path.rsplit('/').next().unwrap_or("");
    if last.contains('.') || path.ends_with('/') {
        Some(path.to_string())
    } else {
        Some(format!("{path}/"))
    }
}

fn links(html: &str, origin: &str) -> BTreeSet<String> {
    let mut out = BTreeSet::new();
    let mut from = 0;
    while let Some(i) = find_ci(html, "<a", from) {
        let Some(end) = html[i..].find('>').map(|e| e + i) else {
            break;
        };
        let tag = &html[i..end];
        if matches!(tag.as_bytes().get(2), Some(b' ' | b'\n' | b'\t')) {
            if let Some(p) = attr_value(tag, "href").and_then(|h| site_path(&h, origin)) {
                out.insert(p);
            }
        }
        from = end;
    }
    out
}
