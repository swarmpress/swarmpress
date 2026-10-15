//! The site's structured entries (ADR-0093, FEAT-112): what a design's listings and home show
//! beside the pages, as content types of their own.
//!
//! The live site keeps its facts in `collections/` (stays, restaurants, sights) and in the villages'
//! own content (`config/villages/`); its pages render them as prose. A design lists them as cards
//! (the five villages, places to stay, activities, restaurants, the team). The import writes them
//! as entries of content types the sandbox registers from data (`POST /swarmpress/v1/content-types`,
//! wp-sandbox 0.9.0), one entry per item and language:
//!
//! - its title, an excerpt (the item's teaser) and its description as the body;
//! - its language (`_swarmpress_lang`): a query on a page lists the entries in the page's language;
//! - its place (`sp_place`, the village's slug): a listed entry carries `sp_place-{village}`, a
//!   village page lists its own (`_swarmpress_place` on the page);
//! - the page it stands for (`_swarmpress_link`): an entry has no URL of its own, its title links
//!   to that page;
//! - its fields as public meta, which templates show with block bindings (`core/post-meta`);
//! - its order (`menu_order`): featured first, then the item's rank.
//!
//! The facts follow the design's rules where it states them: a stay's rating on one scale of ten
//! with one decimal (fix-01: ratings out of five are doubled), a restaurant's price as € glyphs out
//! of four (fix-10: the source's `$$$`), an external rating with its own scale (`/5`).

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::routes::VILLAGES;
use crate::{localized, Site, LANGS};

/// A content type: a WordPress post type the sandbox registers from data.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ContentType {
    /// The post type (`sp_stay`; at most 20 characters).
    pub name: String,
    pub label: String,
    /// Its fields (public meta keys) with their labels.
    pub fields: Vec<(String, String)>,
}

/// One entry of a content type in one language.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Entry {
    pub post_type: String,
    pub lang: String,
    /// `{item}-{lang}`.
    pub slug: String,
    pub title: String,
    pub excerpt: String,
    pub content: String,
    /// The page it stands for (`/en/vernazza/hotels/`).
    pub link: String,
    /// The village's slug, a term of `sp_place`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub place: Option<String>,
    pub order: i64,
    /// Field → value (strings, as the meta are).
    pub fields: BTreeMap<String, String>,
}

/// The content types, in the order they are written.
pub fn content_types() -> Vec<ContentType> {
    let t = |name: &str, label: &str, fields: &[(&str, &str)]| ContentType {
        name: name.into(),
        label: label.into(),
        fields: fields
            .iter()
            .map(|(k, l)| (k.to_string(), l.to_string()))
            .collect(),
    };
    vec![
        // Posts take fields too (the story's picture), registered on the built-in type.
        t(
            "post",
            "Stories",
            &[
                ("image", "Picture URL"),
                ("image_alt", "Picture description"),
            ],
        ),
        t(
            "sp_village",
            "Villages",
            &[
                ("number", "Number (01–05, south to north)"),
                ("line", "One line"),
                ("image", "Image URL"),
                ("image_alt", "Image description"),
            ],
        ),
        t(
            "sp_stay",
            "Places to stay",
            &[
                ("village", "Village"),
                ("kind", "Kind (hotel, B&B…)"),
                ("price", "Price per night (€)"),
                ("price_unit", "Per night, in the entry's language"),
                ("rating", "Rating out of 10"),
                ("rating_scale", "Rating scale"),
                ("image", "Picture URL"),
                ("image_alt", "Picture description"),
            ],
        ),
        t(
            "sp_restaurant",
            "Restaurants",
            &[
                ("village", "Village"),
                ("cuisine", "Cuisine"),
                ("line", "One line"),
                ("price", "Price level (€ glyphs)"),
                ("price_rest", "The unfilled € glyphs"),
                ("price_label", "Price level in words"),
                ("rating", "Guests' rating"),
                ("rating_scale", "Its scale"),
                ("closed", "Closed on"),
                ("book", "Booking"),
                (
                    "closed_label",
                    "The word for closed, in the entry's language",
                ),
                ("book_label", "The word for booking"),
            ],
        ),
        t(
            "sp_activity",
            "Things to do",
            &[
                ("village", "Village"),
                ("label", "Kind"),
                ("line", "One line"),
                ("duration", "Time"),
                ("cost", "Cost"),
                ("best", "Best time"),
                ("time_label", "The word for time, in the entry's language"),
                ("cost_label", "The word for cost"),
                ("best_label", "The words for the best time"),
            ],
        ),
        t(
            "sp_editor",
            "The editors",
            &[
                ("role", "Role"),
                ("line", "One line"),
                ("bio", "Biography"),
                ("first", "First name"),
                ("image", "Portrait URL"),
                ("image_alt", "Portrait description"),
            ],
        ),
    ]
}

/// A few words of the cards, per language (en, de, fr, it).
const PER_NIGHT: [&str; 4] = ["/ night", "/ Nacht", "/ nuit", "/ notte"];
const TIME: [&str; 4] = ["Time", "Dauer", "Durée", "Durata"];
const COST: [&str; 4] = ["Cost", "Preis", "Prix", "Costo"];
const BEST: [&str; 4] = ["Best", "Am besten", "Idéal", "Ideale"];
const CLOSED: [&str; 4] = ["Closed", "Ruhetag", "Fermé", "Chiuso"];
const BOOK: [&str; 4] = ["Book", "Reservieren", "Réserver", "Prenotare"];

fn words(lang: &str, w: [&'static str; 4]) -> &'static str {
    w[LANGS.iter().position(|l| *l == lang).unwrap_or(0)]
}

fn loc(v: Option<&Value>, lang: &str) -> String {
    v.and_then(|v| localized(v, lang))
        .map(crate::markup::strip_tags)
        .unwrap_or_default()
        .trim()
        .to_string()
}

fn village_name(slug: &str, lang: &str) -> String {
    let i = LANGS.iter().position(|l| *l == lang).unwrap_or(0);
    VILLAGES
        .iter()
        .find(|(s, _)| *s == slug)
        .map_or(slug.to_string(), |(_, n)| n[i].to_string())
}

/// A rating on the design's one scale of ten, one decimal (fix-01): out of five doubled. Read
/// from the number's digits (no floating point arithmetic: the crate's numbers are exact).
pub fn rating_of_ten(v: &Value) -> Option<String> {
    let n = v.as_number()?.to_string();
    let (int, frac) = n.split_once('.').unwrap_or((n.as_str(), ""));
    let int: u32 = int.parse().ok()?;
    let mut digits = frac.chars().chain(std::iter::repeat('0'));
    let mut hundredths = int.checked_mul(100)?;
    for scale in [10, 1] {
        hundredths += digits.next()?.to_digit(10)? * scale;
    }
    if hundredths == 0 || hundredths > 1000 {
        return None;
    }
    if hundredths <= 500 {
        hundredths *= 2;
    }
    let tenths = (hundredths + 5) / 10;
    Some(format!("{}.{}", tenths / 10, tenths % 10))
}

/// `$$$` (or `€€€`, or `3`) as € glyphs out of four (fix-10): (filled, unfilled, level).
pub fn price_level(v: &Value) -> Option<(String, String, usize)> {
    let n = match v {
        Value::String(s) if !s.trim().is_empty() => {
            let glyphs = s.chars().filter(|c| matches!(c, '$' | '€')).count();
            if glyphs > 0 {
                glyphs
            } else {
                s.trim().parse().ok()?
            }
        }
        Value::Number(n) => usize::try_from(n.as_u64()?).ok()?,
        _ => return None,
    };
    let n = n.clamp(1, 4);
    Some(("€".repeat(n), "€".repeat(4 - n), n))
}

fn slug_of(s: &str) -> String {
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

fn paragraph(text: &str) -> String {
    if text.is_empty() {
        String::new()
    } else {
        crate::markup::paragraph_html(&crate::markup::inline(text), None)
    }
}

/// A collection's items with their village (the item's own, else its file's; lower case: the
/// files write `Manarola` and `manarola`).
fn items<'a>(site: &'a Site, kind: &str) -> Vec<(String, &'a Value)> {
    let mut out = Vec::new();
    for file in site.collections.get(kind).into_iter().flatten() {
        let village = file.get("village").and_then(Value::as_str).unwrap_or("");
        for item in file
            .get("items")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            if item.get("published") == Some(&Value::Bool(false)) {
                continue;
            }
            let v = item
                .get("village")
                .and_then(Value::as_str)
                .unwrap_or(village);
            out.push((v.to_ascii_lowercase(), item));
        }
    }
    out
}

fn order(item: &Value) -> i64 {
    let rank = item.get("rank").and_then(Value::as_i64).unwrap_or(99);
    let featured = item.get("featured") == Some(&Value::Bool(true));
    if featured {
        rank
    } else {
        1000 + rank
    }
}

/// Every entry, by type then language then order.
pub fn entries(site: &Site) -> Vec<Entry> {
    let mut out = Vec::new();
    for lang in LANGS {
        // The five villages, south to north.
        for (i, (v, names)) in VILLAGES.iter().enumerate() {
            let li = LANGS.iter().position(|l| *l == lang).unwrap_or(0);
            let cfg = site.villages.get(*v);
            let hero = cfg.and_then(|c| c.get("hero"));
            let line = loc(hero.and_then(|h| h.get("subtitle")), lang);
            let mut fields = BTreeMap::new();
            fields.insert("number".into(), format!("{:02}", i + 1));
            fields.insert("line".into(), line.clone());
            if let Some(img) = hero.and_then(|h| h.get("image")).and_then(Value::as_str) {
                fields.insert("image".into(), img.to_string());
                let alt = loc(hero.and_then(|h| h.get("imageAlt")), lang);
                fields.insert(
                    "image_alt".into(),
                    if alt.is_empty() {
                        names[li].to_string()
                    } else {
                        alt
                    },
                );
            }
            out.push(Entry {
                post_type: "sp_village".into(),
                lang: lang.into(),
                slug: format!("{v}-{lang}"),
                title: names[li].into(),
                excerpt: line.clone(),
                content: paragraph(&line),
                link: format!("/{lang}/{v}/"),
                place: Some(v.to_string()),
                order: i64::try_from(i).unwrap_or(0) + 1,
                fields,
            });
        }
        // Places to stay.
        for (v, item) in items(site, "accommodations") {
            let title = loc(item.get("name"), lang);
            if title.is_empty() {
                continue;
            }
            let slug = item
                .get("slug")
                .and_then(Value::as_str)
                .map_or_else(|| slug_of(&loc(item.get("name"), "en")), String::from);
            let teaser = loc(item.get("details").and_then(|d| d.get("teaser")), lang);
            let description = loc(item.get("details").and_then(|d| d.get("description")), lang);
            let mut fields = BTreeMap::new();
            fields.insert("village".into(), village_name(&v, lang));
            if let Some(k) = item.get("type").and_then(Value::as_str) {
                fields.insert("kind".into(), k.to_string());
            }
            // Its first picture, when it has one (the design's stay card shows it).
            if let Some(img) = item
                .get("images")
                .and_then(Value::as_array)
                .and_then(|a| a.first())
            {
                let url = img
                    .get("url")
                    .and_then(Value::as_str)
                    .or_else(|| img.as_str())
                    .unwrap_or("");
                if url.starts_with("http") || url.starts_with('/') {
                    fields.insert("image".into(), url.to_string());
                    let alt = img
                        .get("alt_text")
                        .and_then(Value::as_str)
                        .map_or_else(|| title.clone(), String::from);
                    fields.insert("image_alt".into(), alt);
                }
            }
            let pr = item.get("price_range");
            let (min, max) = (
                pr.and_then(|p| p.get("min")).and_then(Value::as_u64),
                pr.and_then(|p| p.get("max")).and_then(Value::as_u64),
            );
            match (min, max) {
                (Some(a), Some(b)) if a != b => {
                    fields.insert("price".into(), format!("€{a}–{b}"));
                }
                (Some(a), _) | (None, Some(a)) => {
                    fields.insert("price".into(), format!("€{a}"));
                }
                _ => {}
            }
            if fields.contains_key("price") {
                fields.insert("price_unit".into(), words(lang, PER_NIGHT).into());
            }
            if let Some(r) = item
                .get("ratings")
                .and_then(|r| r.get("average"))
                .and_then(rating_of_ten)
            {
                fields.insert("rating".into(), r);
                fields.insert("rating_scale".into(), "/ 10".into());
            }
            out.push(Entry {
                post_type: "sp_stay".into(),
                lang: lang.into(),
                slug: format!("{slug}-{lang}"),
                title,
                excerpt: teaser,
                content: paragraph(&description),
                link: format!("/{lang}/{v}/hotels/"),
                place: Some(v.to_string()),
                order: order(item),
                fields,
            });
        }
        // Restaurants.
        for (v, item) in items(site, "restaurants") {
            let title = loc(item.get("name"), lang);
            if title.is_empty() {
                continue;
            }
            let slug = item
                .get("slug")
                .and_then(Value::as_str)
                .map_or_else(|| slug_of(&loc(item.get("name"), "en")), String::from);
            let details = item.get("details");
            let teaser = loc(details.and_then(|d| d.get("teaser")), lang);
            let description = loc(details.and_then(|d| d.get("description")), lang);
            let mut fields = BTreeMap::new();
            fields.insert("village".into(), village_name(&v, lang));
            fields.insert("line".into(), teaser.clone());
            if let Some(c) = item.get("cuisine_type").and_then(Value::as_array) {
                let c: Vec<&str> = c.iter().filter_map(Value::as_str).take(2).collect();
                if !c.is_empty() {
                    fields.insert("cuisine".into(), c.join(" · "));
                }
            }
            if let Some((filled, rest, n)) = item.get("price_level").and_then(price_level) {
                fields.insert("price".into(), filled);
                fields.insert("price_rest".into(), rest);
                fields.insert("price_label".into(), format!("{n} / 4"));
            }
            if let Some(r) = item
                .get("ratings")
                .and_then(|r| r.get("average"))
                .and_then(Value::as_f64)
                .filter(|r| *r > 0.0 && *r <= 5.0)
            {
                // An external rating keeps its own scale (the design's note on 7.3).
                fields.insert("rating".into(), format!("{r:.1}"));
                fields.insert("rating_scale".into(), "/5".into());
            }
            if let Some(days) = item
                .get("hours")
                .and_then(|h| h.get("closed_days"))
                .and_then(Value::as_array)
            {
                let d: Vec<&str> = days.iter().filter_map(Value::as_str).collect();
                if !d.is_empty() {
                    fields.insert("closed".into(), d.join(", "));
                    fields.insert("closed_label".into(), words(lang, CLOSED).into());
                }
            }
            let book = loc(
                item.get("reservations").and_then(|r| r.get("how_to_book")),
                lang,
            );
            if !book.is_empty() {
                fields.insert("book".into(), book);
                fields.insert("book_label".into(), words(lang, BOOK).into());
            }
            out.push(Entry {
                post_type: "sp_restaurant".into(),
                lang: lang.into(),
                slug: format!("{slug}-{lang}"),
                title,
                excerpt: teaser,
                content: paragraph(&description),
                link: format!("/{lang}/{v}/restaurants/"),
                place: Some(v.to_string()),
                order: order(item),
                fields,
            });
        }
        // Things to do: the sights, with time, cost and the best time (fix-08).
        for (v, item) in items(site, "pois") {
            let title = loc(item.get("name"), lang);
            if title.is_empty() {
                continue;
            }
            let slug = item
                .get("slug")
                .and_then(Value::as_str)
                .map_or_else(|| slug_of(&loc(item.get("name"), "en")), String::from);
            let details = item.get("details");
            let teaser = loc(details.and_then(|d| d.get("teaser")), lang);
            let description = loc(details.and_then(|d| d.get("description")), lang);
            let visiting = item.get("visiting");
            let mut fields = BTreeMap::new();
            fields.insert("village".into(), village_name(&v, lang));
            fields.insert("line".into(), teaser.clone());
            if let Some(c) = item.get("category").and_then(Value::as_str) {
                fields.insert("label".into(), c.replace(['_', '-'], " "));
            }
            for (k, from, label) in [
                ("duration", "duration", ("time_label", TIME)),
                ("cost", "admission", ("cost_label", COST)),
                ("best", "best_time", ("best_label", BEST)),
            ] {
                let val = loc(visiting.and_then(|x| x.get(from)), lang);
                if !val.is_empty() {
                    fields.insert(k.into(), val);
                    fields.insert(label.0.into(), words(lang, label.1).into());
                }
            }
            out.push(Entry {
                post_type: "sp_activity".into(),
                lang: lang.into(),
                slug: format!("{slug}-{lang}"),
                title,
                excerpt: teaser,
                content: paragraph(&description),
                link: format!("/{lang}/{v}/things-to-do/"),
                place: Some(v.to_string()),
                order: order(item),
                fields,
            });
        }
        // The editors (the team page's grid).
        let editors = site
            .pages
            .get("team.json")
            .and_then(|p| p.get("body"))
            .and_then(Value::as_array)
            .and_then(|b| {
                b.iter()
                    .find(|x| x.get("type").and_then(Value::as_str) == Some("team-grid"))
            })
            .and_then(|b| b.get("editors"))
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        for (i, e) in editors.iter().enumerate() {
            let name = loc(e.get("name"), lang);
            if name.is_empty() {
                continue;
            }
            let bio = loc(e.get("bio"), lang);
            let mut fields = BTreeMap::new();
            fields.insert("role".into(), loc(e.get("role"), lang));
            fields.insert("line".into(), loc(e.get("persona"), lang));
            fields.insert("bio".into(), bio.clone());
            fields.insert(
                "first".into(),
                name.split_whitespace().next().unwrap_or("").to_string(),
            );
            if let Some(img) = e.get("image").and_then(Value::as_str) {
                fields.insert("image".into(), img.to_string());
                fields.insert("image_alt".into(), name.clone());
            }
            out.push(Entry {
                post_type: "sp_editor".into(),
                lang: lang.into(),
                slug: format!("{}-{lang}", slug_of(&name)),
                title: name,
                excerpt: bio.clone(),
                content: paragraph(&bio),
                link: format!("/{lang}/team/"),
                place: None,
                order: i64::try_from(i).unwrap_or(0) + 1,
                fields,
            });
        }
    }
    out.sort_by(|a, b| {
        (&a.post_type, &a.lang, &a.place, a.order, &a.slug).cmp(&(
            &b.post_type,
            &b.lang,
            &b.place,
            b.order,
            &b.slug,
        ))
    });
    out.dedup_by(|a, b| a.post_type == b.post_type && a.slug == b.slug);
    // At most PER_PLACE of a type per village and language (featured first): what a listing shows.
    let mut seen: BTreeMap<(String, String, Option<String>), usize> = BTreeMap::new();
    out.retain(|e| {
        let n = seen
            .entry((e.post_type.clone(), e.lang.clone(), e.place.clone()))
            .or_default();
        *n += 1;
        *n <= PER_PLACE
    });
    out
}

/// The most entries of one type a village has in one language.
pub const PER_PLACE: usize = 12;
