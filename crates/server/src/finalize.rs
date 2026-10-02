//! Finalise on merge (ADR-0061 decision 6): the pure half.
//!
//! When an article's pull request is merged the gateway first makes the
//! branch publishable, in the same pull request: the page gets
//! `status: "published"` and a fresh `updated_at`, and the hand-curated
//! story list `content/pages/blog-index.json` gets one entry for it. The
//! GitHub calls are in [`crate::gateway`]; this module derives the entry
//! from the page and edits the index text.
//!
//! The index is edited **as text**: only the new entry is inserted, every
//! other byte of the file stays as it is. (Re-serialising the document would
//! reorder every key of a hand-written file.) The entry mirrors the shape the
//! theme's `BlogIndex` component reads, in the key order of the existing
//! entries:
//!
//! ```json
//! {
//!   "id": 14,
//!   "slug": "harvest-week-in-manarola",
//!   "title": "Harvest Week in Manarola",
//!   "excerpt": "Seven days among the terraces above Manarola.",
//!   "author": "Giulia Rossi",
//!   "date": "Oct 2, 2026",
//!   "readTime": "4 min read",
//!   "category": "Culture",
//!   "image": "https://images.unsplash.com/photo-..."
//! }
//! ```

use chrono::{DateTime, SecondsFormat, TimeZone, Utc};
use serde_json::{json, Value};

use crate::article::HERO_BLOCK;

/// The block of the index page that holds the story list.
pub const INDEX_BLOCK: &str = "blog-index";
/// Reading speed behind `readTime`.
const WORDS_PER_MINUTE: usize = 200;
const EXCERPT_CHARS: usize = 200;

/// Unix milliseconds as a UTC instant (the epoch for an out-of-range value).
pub fn instant(now_ms: i64) -> DateTime<Utc> {
    Utc.timestamp_millis_opt(now_ms)
        .single()
        .unwrap_or(DateTime::UNIX_EPOCH)
}

/// `page` as it is published: `status: "published"` and `updated_at` set to
/// `now` (RFC 3339 with milliseconds, as the site's pages have it).
pub fn published_page(page: &Value, now: DateTime<Utc>) -> Value {
    let mut page = page.clone();
    if let Some(obj) = page.as_object_mut() {
        obj.insert("status".into(), json!("published"));
        obj.insert(
            "updated_at".into(),
            json!(now.to_rfc3339_opts(SecondsFormat::Millis, true)),
        );
    }
    page
}

/// The English text of a v2 text field (plain, or a localized object).
fn text_en(v: Option<&Value>) -> Option<&str> {
    let s = match v? {
        Value::String(s) => s.as_str(),
        Value::Object(m) => m.get("en")?.as_str()?,
        _ => return None,
    };
    let s = s.trim();
    (!s.is_empty()).then_some(s)
}

/// Undo the HTML escaping of the fields the theme prints with `set:html`.
fn html_unescape(s: &str) -> String {
    s.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&amp;", "&")
}

fn blocks(page: &Value) -> &[Value] {
    page.get("body")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default()
}

fn kind(block: &Value) -> &str {
    block.get("type").and_then(Value::as_str).unwrap_or("")
}

fn words(s: &str) -> usize {
    s.split_whitespace().count()
}

/// Words of the article's running text (headings, paragraphs, lists,
/// callouts and the closing note; the hero is not counted).
pub fn word_count(page: &Value) -> usize {
    blocks(page)
        .iter()
        .map(|b| {
            let field = |k: &str| text_en(b.get(k)).map_or(0, words);
            match kind(b) {
                "paragraph" => field("markdown"),
                "heading" => field("text"),
                "callout" => field("title") + field("content"),
                "closing-note" => field("title") + field("content"),
                "list" => b
                    .get("items")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .map(|i| text_en(Some(i)).map_or(0, words))
                    .sum(),
                _ => 0,
            }
        })
        .sum()
}

/// `"N min read"` at 200 words a minute, at least one minute.
pub fn read_time(words: usize) -> String {
    format!("{} min read", words.div_ceil(WORDS_PER_MINUTE).max(1))
}

/// The index's date format: `Oct 2, 2026`.
pub fn story_date(now: DateTime<Utc>) -> String {
    now.format("%b %-d, %Y").to_string()
}

/// One entry of the story list, without its `id` (assigned when added).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Story {
    pub slug: String,
    pub title: String,
    pub excerpt: String,
    /// `None`: the index's own title (the publication) stands in.
    pub author: Option<String>,
    pub date: String,
    pub read_time: String,
    /// `None`: the index's first real category stands in.
    pub category: Option<String>,
    pub image: String,
}

/// The story entry of an article page: the title, the hero's subtitle (the
/// dek) as excerpt, the hero's badge as category and its image, the author
/// from `metadata.author` (else `author_fallback`), today's date and the
/// read time from the word count. `Err` when the page has no hero or the
/// hero has no image: there is nothing to show in the list.
pub fn story_of(
    page: &Value,
    slug: &str,
    author_fallback: Option<&str>,
    now: DateTime<Utc>,
) -> Result<Story, String> {
    let hero = blocks(page)
        .iter()
        .find(|b| kind(b) == HERO_BLOCK)
        .ok_or_else(|| format!("the page has no {HERO_BLOCK} block"))?;
    let image = hero
        .get("image")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| format!("the {HERO_BLOCK} has no image"))?;
    let title = text_en(page.get("title"))
        .map(String::from)
        .or_else(|| text_en(hero.get("title")).map(html_unescape))
        .ok_or_else(|| "the page has no title".to_string())?;
    let excerpt = text_en(hero.get("subtitle"))
        .or_else(|| text_en(page.pointer("/seo/description")))
        .map(String::from)
        .or_else(|| {
            blocks(page)
                .iter()
                .find(|b| kind(b) == "paragraph")
                .and_then(|b| text_en(b.get("markdown")))
                .map(|p| truncate(p, EXCERPT_CHARS))
        })
        .ok_or_else(|| "the page has no subtitle, description or paragraph".to_string())?;
    let meta = page.get("metadata");
    let author = meta
        .and_then(|m| m.get("author"))
        .and_then(|a| text_en(Some(a)).or_else(|| text_en(a.get("name"))))
        .or(author_fallback.map(str::trim).filter(|s| !s.is_empty()))
        .map(String::from);
    let category = text_en(hero.get("badge"))
        .or_else(|| text_en(meta.and_then(|m| m.get("category"))))
        .map(String::from);
    Ok(Story {
        slug: slug.to_string(),
        title,
        excerpt,
        author,
        date: story_date(now),
        read_time: read_time(word_count(page)),
        category,
        image: image.to_string(),
    })
}

/// At most `max` characters, cut at a word and marked with an ellipsis.
fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let cut: String = s.chars().take(max).collect();
    let cut = cut.rsplit_once(' ').map_or(cut.as_str(), |(head, _)| head);
    format!("{}…", cut.trim_end_matches([',', ';', ':', ' ']))
}

/// What [`add_story`] did.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IndexEdit {
    /// The entry was inserted: the new text of the index file, and its id.
    Added { text: String, id: u64 },
    /// A story with this slug is already listed: nothing to write.
    Present,
}

/// Add `story` to the story list of the index page `text`.
///
/// `Err` when the text is not JSON or has no `blog-index` block with a
/// `stories` array. The edit is checked before it is returned: the new text
/// must parse to the old document plus exactly the new entry.
pub fn add_story(text: &str, story: &Story) -> Result<IndexEdit, String> {
    let doc: Value =
        serde_json::from_str(text).map_err(|e| format!("the blog index is not JSON: {e}"))?;
    let (block_at, block) = doc
        .get("body")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .enumerate()
        .find(|(_, b)| kind(b) == INDEX_BLOCK && b.get("stories").is_some_and(Value::is_array))
        .ok_or_else(|| format!("the blog index has no {INDEX_BLOCK} block with stories"))?;
    let stories = block["stories"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default();
    if stories
        .iter()
        .any(|s| s.get("slug").and_then(Value::as_str) == Some(story.slug.as_str()))
    {
        return Ok(IndexEdit::Present);
    }
    let id = stories
        .iter()
        .filter_map(|s| s.get("id").and_then(Value::as_u64))
        .max()
        .map_or(stories.len() as u64 + 1, |m| m + 1);
    let author = story
        .author
        .clone()
        .or_else(|| text_en(block.get("title")).map(String::from))
        .unwrap_or_else(|| "Staff".to_string());
    let category = story.category.clone().unwrap_or_else(|| {
        block
            .get("categories")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .find(|c| !c.eq_ignore_ascii_case("All Stories"))
            .unwrap_or("Stories")
            .to_string()
    });
    // Key order as in the existing entries.
    let fields: [(&str, Value); 9] = [
        ("id", json!(id)),
        ("slug", json!(story.slug)),
        ("title", json!(story.title)),
        ("excerpt", json!(story.excerpt)),
        ("author", json!(author)),
        ("date", json!(story.date)),
        ("readTime", json!(story.read_time)),
        ("category", json!(category)),
        ("image", json!(story.image)),
    ];

    let new_text = insert_entry(text, block_at, &fields)
        .ok_or_else(|| "could not locate the stories array in the blog index".to_string())?;

    // Self-check: the old document plus exactly this entry.
    let mut expected = doc.clone();
    let entry: serde_json::Map<String, Value> = fields
        .iter()
        .map(|(k, v)| ((*k).to_string(), v.clone()))
        .collect();
    if let Some(list) = expected
        .pointer_mut(&format!("/body/{block_at}/stories"))
        .and_then(Value::as_array_mut)
    {
        list.push(Value::Object(entry));
    }
    match serde_json::from_str::<Value>(&new_text) {
        Ok(got) if got == expected => Ok(IndexEdit::Added { text: new_text, id }),
        _ => Err("the edited blog index does not match the intended change".to_string()),
    }
}

// ---------------------------------------------------------------- text edit

fn skip_ws(b: &[u8], mut i: usize) -> usize {
    while i < b.len() && matches!(b[i], b' ' | b'\t' | b'\n' | b'\r') {
        i += 1;
    }
    i
}

/// End (exclusive) of the JSON string that starts at `i`.
fn string_end(b: &[u8], i: usize) -> Option<usize> {
    let mut j = i + 1;
    while j < b.len() {
        match b[j] {
            b'\\' => j += 2,
            b'"' => return Some(j + 1),
            _ => j += 1,
        }
    }
    None
}

/// End (exclusive) of the JSON value that starts at `i`.
fn value_end(b: &[u8], i: usize) -> Option<usize> {
    match *b.get(i)? {
        b'"' => string_end(b, i),
        b'{' | b'[' => {
            let mut depth = 0usize;
            let mut j = i;
            while j < b.len() {
                match b[j] {
                    b'"' => {
                        j = string_end(b, j)?;
                        continue;
                    }
                    b'{' | b'[' => depth += 1,
                    b'}' | b']' => {
                        depth = depth.checked_sub(1)?;
                        if depth == 0 {
                            return Some(j + 1);
                        }
                    }
                    _ => {}
                }
                j += 1;
            }
            None
        }
        _ => {
            let mut j = i;
            while j < b.len() && !matches!(b[j], b',' | b'}' | b']' | b' ' | b'\t' | b'\n' | b'\r')
            {
                j += 1;
            }
            (j > i).then_some(j)
        }
    }
}

/// Span of the value of member `key` in the object that starts at `i`.
fn member(b: &[u8], i: usize, key: &str) -> Option<(usize, usize)> {
    if *b.get(i)? != b'{' {
        return None;
    }
    let mut j = skip_ws(b, i + 1);
    loop {
        if *b.get(j)? == b'}' {
            return None;
        }
        let key_end = string_end(b, j)?;
        let name: String = serde_json::from_slice(&b[j..key_end]).ok()?;
        j = skip_ws(b, key_end);
        if *b.get(j)? != b':' {
            return None;
        }
        let start = skip_ws(b, j + 1);
        let end = value_end(b, start)?;
        if name == key {
            return Some((start, end));
        }
        j = skip_ws(b, end);
        if *b.get(j)? == b',' {
            j = skip_ws(b, j + 1);
        }
    }
}

/// Spans of the items of the array that starts at `i`.
fn items(b: &[u8], i: usize) -> Option<Vec<(usize, usize)>> {
    if *b.get(i)? != b'[' {
        return None;
    }
    let mut out = Vec::new();
    let mut j = skip_ws(b, i + 1);
    loop {
        if *b.get(j)? == b']' {
            return Some(out);
        }
        let end = value_end(b, j)?;
        out.push((j, end));
        j = skip_ws(b, end);
        if *b.get(j)? == b',' {
            j = skip_ws(b, j + 1);
        }
    }
}

/// The whitespace that starts the line of byte `at`.
fn line_indent(text: &str, at: usize) -> &str {
    let line = text[..at].rfind('\n').map_or(0, |n| n + 1);
    let rest = &text[line..];
    let len = rest.len() - rest.trim_start_matches([' ', '\t']).len();
    &rest[..len]
}

fn render_entry(fields: &[(&str, Value)], indent: &str, unit: &str) -> String {
    let lines: Vec<String> = fields
        .iter()
        .map(|(k, v)| format!("{indent}{unit}{}: {v}", Value::String((*k).to_string())))
        .collect();
    format!("{{\n{}\n{indent}}}", lines.join(",\n"))
}

/// `text` with one more object at the end of `body[block_at].stories`,
/// indented like its neighbours. Nothing else changes.
fn insert_entry(text: &str, block_at: usize, fields: &[(&str, Value)]) -> Option<String> {
    let b = text.as_bytes();
    let root = skip_ws(b, 0);
    let (body, _) = member(b, root, "body")?;
    let (block, _) = *items(b, body)?.get(block_at)?;
    let (list, list_end) = member(b, block, "stories")?;
    let existing = items(b, list)?;
    let list_indent = line_indent(text, list);
    match existing.last() {
        Some(&(last, last_end)) => {
            // On its own line, the last entry shows the indent to copy.
            let own_line = text[..last]
                .rfind('\n')
                .is_some_and(|n| text[n + 1..last].trim_matches([' ', '\t']).is_empty());
            let indent = if own_line {
                line_indent(text, last).to_string()
            } else {
                format!("{list_indent}  ")
            };
            let unit = indent
                .strip_prefix(list_indent)
                .filter(|u| !u.is_empty())
                .unwrap_or("  ");
            let entry = render_entry(fields, &indent, unit);
            Some(format!(
                "{},\n{indent}{entry}{}",
                &text[..last_end],
                &text[last_end..]
            ))
        }
        None => {
            let unit = "  ";
            let indent = format!("{list_indent}{unit}");
            let entry = render_entry(fields, &indent, unit);
            Some(format!(
                "{}[\n{indent}{entry}\n{list_indent}]{}",
                &text[..list],
                &text[list_end..]
            ))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The head of the real `content/pages/blog-index.json` of
    /// cinqueterre.travel with its first two stories, copied by hand (same
    /// bytes, same indentation, no trailing newline).
    const INDEX: &str = r#"{
  "id": "blog-index",
  "slug": {
    "en": "/en/blog",
    "de": "/de/blog",
    "fr": "/fr/blog",
    "it": "/it/blog"
  },
  "title": {
    "en": "The Dispatch | Stories & Guides from Cinque Terre"
  },
  "page_type": "blog-index",
  "seo": {
    "title": {
      "en": "The Dispatch | Stories & Guides from Cinque Terre"
    },
    "description": {
      "en": "Slow journalism for a fast-moving coastline. Curated stories, local secrets, and seasonal guides from the five villages."
    }
  },
  "template": "cinque-terre-blog-index",
  "body": [
    {
      "type": "blog-index",
      "title": "The Dispatch",
      "subtitle": "Slow Journalism for a Fast-Moving Coastline.",
      "description": "We don't just list places; we tell their stories. From the salt-crusted traditions of the local fishermen to the quietest corners of the high trails, welcome to our curated chronicle of life in the five villages.",
      "categories": [
        "All Stories",
        "Guides",
        "Food & Drink",
        "Culture",
        "Photography",
        "Hotels"
      ],
      "stories": [
        {
          "id": 1,
          "slug": "the-ultimate-guide-to-cinque-terres-best-beaches",
          "title": "The Ultimate Guide to Cinque Terre's Best Beaches",
          "excerpt": "From the sandy shores of Monterosso to the hidden rocky coves of Riomaggiore, we explore the most pristine swimming spots in the Italian Riviera.",
          "author": "Giulia Rossi",
          "date": "Oct 15, 2023",
          "readTime": "8 min read",
          "category": "Guides",
          "image": "https://images.unsplash.com/photo-1534445867742-43195f401b6c?q=80&w=2670&auto=format&fit=crop",
          "isLead": true
        },
        {
          "id": 13,
          "slug": "local-festivals-in-november",
          "title": "Local Festivals in November",
          "excerpt": "Discover the cultural celebrations that make visiting in the off-season special.",
          "author": "Marco Bianchi",
          "date": "Jan 5, 2026",
          "readTime": "4 min read",
          "category": "Culture",
          "image": "https://images.unsplash.com/photo-1551183053-bf91a1d81141?q=80&w=2632&auto=format&fit=crop"
        }
      ],
      "newsletter": {
        "title": "Get the Dispatch in Your Inbox.",
        "description": "Join 15,000+ lovers of the Italian Riviera. No spam, just curated stories, local secrets, and seasonal guides delivered once a month.",
        "disclaimer": "By subscribing, you agree to our Privacy Policy and Terms of Service."
      }
    }
  ],
  "metadata": {
    "page_type": "blog-index"
  },
  "status": "published",
  "created_at": "2026-01-05T12:00:00.000Z",
  "updated_at": "2026-01-05T12:00:00.000Z"
}"#;

    fn now() -> DateTime<Utc> {
        // 2026-10-02T09:30:00.250Z
        instant(1_790_933_400_250)
    }

    fn page() -> Value {
        json!({
            "id": "c1",
            "slug": { "en": "/en/blog/harvest-week-in-manarola" },
            "title": { "en": "Harvest Week in Manarola & Beyond" },
            "page_type": "blog-article",
            "seo": { "description": { "en": "From the seo description." } },
            "body": [
                { "type": "editorial-hero", "title": "Harvest Week in Manarola &amp; Beyond",
                  "subtitle": "Seven days among the terraces above Manarola.", "badge": "Culture",
                  "image": "https://images.unsplash.com/photo-1516483638261-f4dbaf036963?q=80&w=2574&auto=format&fit=crop" },
                { "type": "paragraph", "markdown": "one two three four five" },
                { "type": "heading", "level": 2, "text": "six seven" },
                { "type": "list", "ordered": false, "items": ["eight nine", "ten"] },
                { "type": "callout", "style": "info", "title": "eleven", "content": "twelve thirteen" },
                { "type": "image", "src": "https://x.test/a.jpg", "alt": "not counted at all" },
                { "type": "closing-note", "title": "fourteen", "content": "fifteen sixteen" }
            ],
            "metadata": { "author": "Giulia Rossi" },
            "status": "in_review",
            "created_at": "2026-10-01T08:00:00.000Z"
        })
    }

    fn story() -> Story {
        story_of(&page(), "harvest-week-in-manarola", None, now()).unwrap()
    }

    #[test]
    fn the_page_is_published() {
        let p = published_page(&page(), now());
        assert_eq!(p["status"], "published");
        assert_eq!(p["updated_at"], "2026-10-02T09:30:00.250Z");
        assert_eq!(p["created_at"], "2026-10-01T08:00:00.000Z");
        assert_eq!(p["body"], page()["body"]);
    }

    #[test]
    fn counts_dates_and_read_times() {
        assert_eq!(word_count(&page()), 16);
        assert_eq!(read_time(0), "1 min read");
        assert_eq!(read_time(200), "1 min read");
        assert_eq!(read_time(201), "2 min read");
        assert_eq!(read_time(1500), "8 min read");
        assert_eq!(story_date(now()), "Oct 2, 2026");
        assert_eq!(story_date(instant(1_767_571_200_000)), "Jan 5, 2026");
    }

    #[test]
    fn the_story_is_derived_from_the_page() {
        assert_eq!(
            story(),
            Story {
                slug: "harvest-week-in-manarola".into(),
                title: "Harvest Week in Manarola & Beyond".into(),
                excerpt: "Seven days among the terraces above Manarola.".into(),
                author: Some("Giulia Rossi".into()),
                date: "Oct 2, 2026".into(),
                read_time: "1 min read".into(),
                category: Some("Culture".into()),
                image: "https://images.unsplash.com/photo-1516483638261-f4dbaf036963?q=80&w=2574&auto=format&fit=crop".into(),
            }
        );
        // Fallbacks: the escaped hero title, the seo description, the
        // attribution's name, the metadata category.
        let mut p = page();
        p.as_object_mut().unwrap().remove("title");
        p["body"][0].as_object_mut().unwrap().remove("subtitle");
        p["body"][0].as_object_mut().unwrap().remove("badge");
        p["metadata"] = json!({ "category": "Guides" });
        let s = story_of(&p, "x", Some("Isabella Conti"), now()).unwrap();
        assert_eq!(s.title, "Harvest Week in Manarola & Beyond");
        assert_eq!(s.excerpt, "From the seo description.");
        assert_eq!(s.author.as_deref(), Some("Isabella Conti"));
        assert_eq!(s.category.as_deref(), Some("Guides"));
        // No hero, or a hero without an image: no story.
        let mut p = page();
        p["body"].as_array_mut().unwrap().remove(0);
        assert!(story_of(&p, "x", None, now()).is_err());
        let mut p = page();
        p["body"][0]["image"] = json!("  ");
        assert!(story_of(&p, "x", None, now()).is_err());
    }

    #[test]
    fn the_entry_has_the_shape_of_the_real_index() {
        let IndexEdit::Added { text, id } = add_story(INDEX, &story()).unwrap() else {
            panic!("the story is new");
        };
        assert_eq!(id, 14, "one more than the highest id");
        // Only the entry was inserted: the file keeps every other byte.
        let at = INDEX.find("\n      ],\n      \"newsletter\"").unwrap();
        assert!(text.starts_with(&INDEX[..at]));
        assert!(text.ends_with(&INDEX[at..]));
        let inserted = &text[at..text.len() - (INDEX.len() - at)];
        assert_eq!(
            inserted,
            r#",
        {
          "id": 14,
          "slug": "harvest-week-in-manarola",
          "title": "Harvest Week in Manarola & Beyond",
          "excerpt": "Seven days among the terraces above Manarola.",
          "author": "Giulia Rossi",
          "date": "Oct 2, 2026",
          "readTime": "1 min read",
          "category": "Culture",
          "image": "https://images.unsplash.com/photo-1516483638261-f4dbaf036963?q=80&w=2574&auto=format&fit=crop"
        }"#
        );

        // Same keys, in the same order, with the same types as the real
        // entry before it (`isLead` is only on the lead story).
        let keys = |entry: &str| -> Vec<String> {
            entry
                .lines()
                .filter_map(|l| {
                    l.trim()
                        .strip_prefix('"')?
                        .split_once('"')
                        .map(|(k, _)| k.to_string())
                })
                .collect()
        };
        let real_from = INDEX.find("{\n          \"id\": 13").unwrap();
        let real_to = INDEX[real_from..].find("\n        }").unwrap() + real_from;
        assert_eq!(keys(inserted), keys(&INDEX[real_from..real_to]));
        let doc: Value = serde_json::from_str(&text).unwrap();
        let list = doc["body"][0]["stories"].as_array().unwrap();
        assert_eq!(list.len(), 3);
        let (real, new) = (&list[1], &list[2]);
        for (k, v) in real.as_object().unwrap() {
            let ours = &new[k];
            assert_eq!(
                std::mem::discriminant(v),
                std::mem::discriminant(ours),
                "{k}: {v} vs {ours}"
            );
        }
        assert_eq!(
            new.as_object().unwrap().len(),
            real.as_object().unwrap().len()
        );

        // Adding it again changes nothing.
        assert_eq!(add_story(&text, &story()), Ok(IndexEdit::Present));
    }

    #[test]
    fn missing_author_and_category_fall_back_to_the_index() {
        let s = Story {
            author: None,
            category: None,
            ..story()
        };
        let IndexEdit::Added { text, .. } = add_story(INDEX, &s).unwrap() else {
            panic!("added");
        };
        let doc: Value = serde_json::from_str(&text).unwrap();
        let new = &doc["body"][0]["stories"][2];
        assert_eq!(new["author"], "The Dispatch");
        assert_eq!(new["category"], "Guides");
    }

    #[test]
    fn other_layouts_of_the_list() {
        // Empty, compact and tab-indented lists; text that needs escaping.
        let s = Story {
            title: "A \"quoted\" title \\ with a tab\t".into(),
            ..story()
        };
        for index in [
            "{\"body\":[{\"type\":\"blog-index\",\"stories\":[]}]}".to_string(),
            "{\n  \"body\": [\n    {\n      \"type\": \"blog-index\",\n      \"stories\": [\n      ]\n    }\n  ]\n}\n".to_string(),
            "{\"body\":[{\"type\":\"hero\"},{\"stories\":[{\"id\":7,\"slug\":\"a\"},{\"slug\":\"b ] } \\\" [\"}],\"type\":\"blog-index\"}]}".to_string(),
            "{\n\t\"body\": [\n\t\t{\n\t\t\t\"type\": \"blog-index\",\n\t\t\t\"stories\": [\n\t\t\t\t{\n\t\t\t\t\t\"id\": 2,\n\t\t\t\t\t\"slug\": \"a\"\n\t\t\t\t}\n\t\t\t]\n\t\t}\n\t]\n}\n".to_string(),
        ] {
            let IndexEdit::Added { text, id } = add_story(&index, &s).unwrap() else {
                panic!("added to {index}");
            };
            let doc: Value = serde_json::from_str(&text).unwrap();
            let block = doc["body"]
                .as_array()
                .unwrap()
                .iter()
                .find(|b| b["type"] == "blog-index")
                .unwrap();
            let last = block["stories"].as_array().unwrap().last().unwrap();
            assert_eq!(last["id"], id);
            assert_eq!(last["title"], s.title);
        }
        let tabs = "{\n\t\"body\": [\n\t\t{\n\t\t\t\"type\": \"blog-index\",\n\t\t\t\"stories\": [\n\t\t\t\t{\n\t\t\t\t\t\"id\": 2\n\t\t\t\t}\n\t\t\t]\n\t\t}\n\t]\n}\n";
        let IndexEdit::Added { text, id } = add_story(tabs, &story()).unwrap() else {
            panic!("added");
        };
        assert_eq!(id, 3);
        assert!(
            text.contains("\n\t\t\t\t},\n\t\t\t\t{\n\t\t\t\t\t\"id\": 3,\n"),
            "{text}"
        );
    }

    #[test]
    fn an_index_without_a_story_list_is_an_error() {
        assert!(add_story("not json", &story()).is_err());
        assert!(add_story("{\"body\":[]}", &story()).is_err());
        assert!(add_story("{\"body\":[{\"type\":\"blog-index\"}]}", &story()).is_err());
        assert!(add_story(
            "{\"body\":[{\"type\":\"blog-index\",\"stories\":{}}]}",
            &story()
        )
        .is_err());
    }
}
