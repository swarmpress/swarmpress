//! The design's own words in every site language (FEAT-115, ADR-0093's third addendum).
//!
//! A design is written in one language; a site has several. The words a theme shows that are not
//! content (a section's heading in a template, `Village 01` over a menu panel, `Typical` under a
//! time, the ticker's `Today on the coast`, `On this page`) are **labels**: [`sources`] lists
//! them with their English, the web designer's `web design labels` call puts each in every other
//! site language, [`check_answer`] refuses a table with a gap or a language left in English, and
//! the table travels in the theme data (`ThemeData.labels`). Nothing is written per site:
//!
//! - **The stylesheet's** (`css-…`): the CSS says `content:var(--ds-l-css-village,"Village ")`;
//!   [`css`] sets the variable per language (`:root:lang(de){--ds-l-css-village:"Dorf "}`).
//! - **The templates' words**: every text a template or part writes itself (`t-…`).
//! - **The platform's** ([`PLATFORM`]): what the import and the export write (the ticker, the
//!   contents rail, "More in"), their English the design's where it has one.
//! - **The content's own words** (`SiteContext.words`, `w-…`): the names of a page's facts.
//!
//! The import and the export put the non-CSS labels in a page's language wherever one stands
//! alone (`site_export::labels`).

use std::collections::BTreeMap;

use serde_json::{json, Value};
use site_design::wordpress::ThemeData;

use crate::model::SiteContext;
use crate::plan::ThemePlan;
use crate::styles::slugify;

/// The platform's labels (key, English): the export's essentials ticker and the import's story
/// furniture. `site_export::labels::DEFAULTS` has the same keys.
pub const PLATFORM: &[(&str, &str)] = &[
    ("today", "Today"),
    ("updated", "updated"),
    ("sea", "Sea"),
    ("air", "Air"),
    ("sunset", "Sunset"),
    ("weather-data-by", "Weather data by"),
    ("on-this-page", "On this page"),
    ("more-in", "More in"),
    ("more-from", "More from"),
];

/// The enhancement script's words (`ds.js` reads `--ds-l-css-js-{key}`), when the theme ships it.
pub const SCRIPT: &[(&str, &str)] = &[
    ("css-js-filter", "Filter"),
    ("css-js-all", "All"),
    ("css-js-villages", "Villages"),
    ("css-js-stories", "Stories"),
    ("css-js-stays", "Stays"),
    ("css-js-pages", "Pages"),
    ("css-js-search", "Search"),
    ("css-js-close", "Close"),
    (
        "css-js-nothing-found",
        "Nothing found. Try a village or a place.",
    ),
];

/// WordPress's own words in a theme's pages (its skip link, the search block's label).
pub const WORDPRESS: &[(&str, &str)] = &[
    ("wp-skip-to-content", "Skip to content"),
    ("wp-search", "Search"),
];

/// What precedes the labels' JSON in the `web design labels` prompt (the fake reads it).
pub const LABELS_MARK: &str = "The labels (JSON):";
/// What precedes the languages' JSON.
pub const LANGUAGES_MARK: &str = "The languages (JSON):";

/// A language whose share of labels left in English is above this (permille) is not
/// translated: names and loanwords may stay (`Hotels`), a language may not.
pub const UNTRANSLATED_PERMILLE: usize = 340;

/// The labels a theme shows (module docs): key → English, and key → the whole text a template's
/// label is a piece of (when inline tags split it), in key order.
pub fn sources(
    plan: &ThemePlan,
    data: &ThemeData,
    site: &SiteContext,
) -> (BTreeMap<String, String>, BTreeMap<String, String>) {
    let mut out = BTreeMap::new();
    let mut wholes = BTreeMap::new();
    // The stylesheet's.
    let css = &data.global_styles.css;
    let mut rest = css.as_str();
    while let Some(i) = rest.find("var(--ds-l-") {
        rest = &rest[i + 11..];
        let Some(comma) = rest.find(',') else { break };
        let key = &rest[..comma];
        let after = &rest[comma + 1..];
        if let Some(text) = after.strip_prefix('"').and_then(|a| a.split_once('"')) {
            if key.starts_with("css-") {
                out.insert(key.to_string(), text.0.to_string());
            }
        }
    }
    if data
        .files
        .iter()
        .any(|f| f.path == site_design::wordpress::ENHANCEMENT_PATH)
    {
        for (k, en) in SCRIPT {
            out.insert(k.to_string(), en.to_string());
        }
    }
    // The platform's and WordPress's, the ticker's head as the design words it.
    for (k, en) in PLATFORM.iter().chain(WORDPRESS) {
        out.insert(k.to_string(), en.to_string());
    }
    if let Some(today) = plan
        .tasks
        .iter()
        .flat_map(|t| t.sections.iter())
        .find_map(|s| s.essentials.as_ref().and_then(|e| e.label.clone()))
    {
        out.insert("today".into(), today);
    }
    // The templates' and parts' own words.
    let brand = site.name.to_lowercase();
    for content in data
        .templates
        .iter()
        .map(|t| t.content.as_str())
        .chain(data.template_parts.iter().map(|p| p.content.as_str()))
    {
        for (text, whole) in texts(content) {
            // Names stay names: the site's, its places'; a text that is mostly figures is not
            // a word (a colophon's year, coordinates).
            let lower = text.to_lowercase();
            let letters = text.chars().filter(|c| c.is_alphabetic()).count();
            let figures = text.chars().filter(|c| c.is_ascii_digit()).count();
            let a_place = site.places.iter().any(|p| {
                p.label.to_lowercase() == lower
                    || p.slug == lower
                    || lower.starts_with(&p.slug) && lower.split_whitespace().count() <= 2
            });
            if lower.contains(&brand) || brand.contains(&lower) || a_place || figures * 2 >= letters
            {
                continue;
            }
            let key = format!("t-{}", key_of(&text));
            if let Some(w) = whole {
                wholes.entry(key.clone()).or_insert(w);
            }
            out.entry(key).or_insert(text);
        }
    }
    // The content's own words.
    for w in &site.words {
        out.entry(format!("w-{}", key_of(w)))
            .or_insert_with(|| w.clone());
    }
    (out, wholes)
}

fn key_of(text: &str) -> String {
    let s = slugify(text);
    let s: String = s.chars().take(56).collect();
    s.trim_end_matches('-').to_string()
}

/// The texts block markup writes itself: text between tags (block comments and their
/// attributes, scripts and styles left out), trimmed, with a letter, at most 80 bytes; each with
/// the whole it is a piece of when inline tags split it (`Five villages,<br>walked <em>slowly.</em>`
/// gives three pieces of one heading).
pub fn texts(markup: &str) -> Vec<(String, Option<String>)> {
    const INLINE: [&str; 12] = [
        "em", "strong", "b", "i", "br", "span", "a", "mark", "small", "sup", "sub", "u",
    ];
    let mut out: Vec<(String, Option<String>)> = Vec::new();
    let mut run: Vec<String> = Vec::new();
    let mut text = String::new();
    let piece = |t: &mut String, run: &mut Vec<String>| {
        let s = decode(t.trim());
        let s = s.split_whitespace().collect::<Vec<_>>().join(" ");
        if !s.is_empty() {
            run.push(s);
        }
        t.clear();
    };
    let end_run = |run: &mut Vec<String>, out: &mut Vec<(String, Option<String>)>| {
        let whole = (run.len() > 1).then(|| run.join(" "));
        for s in run.drain(..) {
            let fits = s.len() <= 80
                && s.chars().any(char::is_alphabetic)
                && !s.contains(['{', '}', '<', '>', '\\', '"']);
            if fits && !out.iter().any(|(x, _)| *x == s) {
                out.push((s, whole.clone()));
            }
        }
    };
    let mut rest = markup;
    while !rest.is_empty() {
        if rest.starts_with("<!--") {
            piece(&mut text, &mut run);
            end_run(&mut run, &mut out);
            let end = rest.find("-->").map_or(rest.len(), |i| i + 3);
            rest = &rest[end..];
        } else if rest.starts_with('<') {
            piece(&mut text, &mut run);
            let lower = rest.to_ascii_lowercase();
            let name: String = lower[1..]
                .trim_start_matches('/')
                .chars()
                .take_while(|c| c.is_ascii_alphanumeric())
                .collect();
            if !INLINE.contains(&name.as_str()) {
                end_run(&mut run, &mut out);
            }
            let end = if name == "script" || name == "style" {
                let close = format!("</{name}>");
                lower.find(&close).map_or(rest.len(), |i| i + close.len())
            } else {
                rest.find('>').map_or(rest.len(), |i| i + 1)
            };
            rest = &rest[end..];
        } else {
            let end = rest.find('<').unwrap_or(rest.len());
            text.push_str(&rest[..end]);
            rest = &rest[end..];
        }
    }
    piece(&mut text, &mut run);
    end_run(&mut run, &mut out);
    out
}

fn decode(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&nbsp;", " ")
        .replace("&#8217;", "\u{2019}")
        .replace("&rsquo;", "\u{2019}")
        .replace("&#8211;", "\u{2013}")
        .replace("&ndash;", "\u{2013}")
        .replace("&rarr;", "\u{2192}")
}

/// The answer's schema: `{"labels": {key: {lang: text}}}`.
pub fn answer_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "labels": {
                "type": "object",
                "additionalProperties": {
                    "type": "object",
                    "additionalProperties": {"type": "string"}
                }
            }
        },
        "required": ["labels"],
        "additionalProperties": false
    })
}

/// A label's text as the theme keeps it: a straight apostrophe becomes a typographic one, a
/// double quote a typographic one, nothing that could end a CSS string or open markup.
pub fn clean(text: &str) -> String {
    let mut out = String::new();
    let mut open = true;
    for c in text.trim().chars() {
        match c {
            '\'' => out.push('\u{2019}'),
            '"' => {
                out.push(if open { '\u{201C}' } else { '\u{201D}' });
                open = !open;
            }
            '<' | '>' | '\\' | '{' | '}' | ';' => {}
            c => out.push(c),
        }
    }
    out
}

/// The table from the model's answer: every source in every language (`en` the design's), or
/// the errors (a key or language missing, an empty text, a language left in English).
pub fn check_answer(
    sources: &BTreeMap<String, String>,
    languages: &[String],
    answer: &Value,
) -> Result<BTreeMap<String, BTreeMap<String, String>>, Vec<String>> {
    let mut errors = Vec::new();
    let mut table: BTreeMap<String, BTreeMap<String, String>> = BTreeMap::new();
    let given = answer.get("labels").and_then(Value::as_object);
    let others: Vec<&String> = languages.iter().filter(|l| *l != "en").collect();
    let mut same: BTreeMap<&str, usize> = BTreeMap::new();
    for (key, en) in sources {
        let mut by_lang = BTreeMap::from([("en".to_string(), clean(en))]);
        for lang in &others {
            let t = given
                .and_then(|g| g.get(key))
                .and_then(|v| v.get(lang.as_str()))
                .and_then(Value::as_str)
                .map(clean)
                .unwrap_or_default();
            if t.is_empty() {
                errors.push(format!(
                    "/labels/{key}/{lang}: missing (the English is \"{en}\")"
                ));
                continue;
            }
            if crate::labels::same_words(&t, en) {
                *same.entry(lang.as_str()).or_default() += 1;
            }
            by_lang.insert(lang.to_string(), t);
        }
        table.insert(key.clone(), by_lang);
    }
    for (lang, n) in same {
        if !sources.is_empty() && n * 1000 / sources.len() > UNTRANSLATED_PERMILLE {
            errors.push(format!(
                "/labels/*/{lang}: {n} of {} labels are the English words; write them in {lang}",
                sources.len()
            ));
        }
    }
    if errors.is_empty() {
        Ok(table)
    } else {
        Err(errors)
    }
}

/// Whether two texts are the same words (case, apostrophes and spaces aside).
pub fn same_words(a: &str, b: &str) -> bool {
    let n = |s: &str| {
        s.to_lowercase()
            .replace(['\u{2019}', '\u{2018}'], "'")
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
    };
    n(a) == n(b)
}

/// The stylesheet's labels per language: `:root:lang(de){--ds-l-css-village:"Dorf "}`.
pub fn css(table: &BTreeMap<String, BTreeMap<String, String>>) -> String {
    let mut by_lang: BTreeMap<&str, Vec<(&str, &str)>> = BTreeMap::new();
    for (key, langs) in table.iter().filter(|(k, _)| k.starts_with("css-")) {
        for (lang, text) in langs.iter().filter(|(l, _)| *l != "en") {
            by_lang.entry(lang).or_default().push((key, text));
        }
    }
    let mut out = String::new();
    for (lang, vars) in by_lang {
        out.push_str(&format!(":root:lang({lang}){{"));
        for (k, t) in vars {
            out.push_str(&format!("--ds-l-{k}:\"{}\";", t.replace('"', "")));
        }
        out.push_str("}\n");
    }
    out
}

/// The `web design labels` call's user message: the labels with their English, the languages.
pub fn prompt(
    sources: &BTreeMap<String, String>,
    wholes: &BTreeMap<String, String>,
    languages: &[String],
    site: &str,
) -> String {
    let others: Vec<&String> = languages.iter().filter(|l| *l != "en").collect();
    let pieces = if wholes.is_empty() {
        String::new()
    } else {
        format!(
            "\n\nSome labels are pieces of one text that a line break or emphasis splits (key → the whole, pieces in order); write the pieces so that, in order, they read as the whole in that language:\n```json\n{}\n```",
            serde_json::to_string_pretty(wholes).unwrap_or_default()
        )
    };
    format!(
        "## Task: web design labels\n\nThe theme of \"{site}\" shows these words of its own (not content): headings and links its templates write, labels its stylesheet adds, the words of its live ticker and of its story pages. Write each in every language below, as a native editor of a travel magazine would: short, in the same register and case as the English (an uppercase eyebrow stays a short phrase; a trailing space stays). Names (places, the site's name, brands) stay as they are. Never answer the English for a language unless the word is the same there.\n\n{LABELS_MARK}\n```json\n{}\n```{pieces}\n\n{LANGUAGES_MARK}\n```json\n{}\n```\n\nAnswer {{\"labels\": {{\"<key>\": {{\"<language>\": \"<text>\"}}}}}} with every key and every language.",
        serde_json::to_string_pretty(sources).unwrap_or_default(),
        serde_json::to_string(&others).unwrap_or_default(),
    )
}

/// The fake web designer's answer: each English text marked with its language
/// (`Village` → `Village (de)`), which the checks accept.
pub fn fake_answer(prompt: &str) -> Value {
    let sources: BTreeMap<String, String> = crate::fake::json_after(prompt, LABELS_MARK)
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default();
    let langs: Vec<String> = prompt
        .find(LANGUAGES_MARK)
        .and_then(|i| {
            let rest = &prompt[i + LANGUAGES_MARK.len()..];
            let start = rest.find('[')?;
            let mut it = serde_json::Deserializer::from_str(&rest[start..]).into_iter::<Value>();
            it.next()?.ok()
        })
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default();
    let labels: serde_json::Map<String, Value> = sources
        .iter()
        .map(|(k, en)| {
            let by: serde_json::Map<String, Value> = langs
                .iter()
                .map(|l| (l.clone(), json!(format!("{} ({l})", en.trim_end()))))
                .collect();
            (k.clone(), Value::Object(by))
        })
        .collect();
    json!({ "labels": labels })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_templates_own_words_are_its_texts() {
        let m = "<!-- wp:heading {\"className\":\"x\"} --><h2 class=\"wp-block-heading\">Editors&#8217; picks</h2><!-- /wp:heading --><!-- wp:paragraph --><p><a href=\"/\">Read <em>more</em></a> →</p><!-- /wp:paragraph --><!-- wp:query-title {\"type\":\"archive\"} /-->";
        let got: Vec<(String, Option<String>)> = texts(m);
        assert_eq!(got[0], ("Editors\u{2019} picks".to_string(), None));
        assert_eq!(
            got[1],
            ("Read".to_string(), Some("Read more →".to_string()))
        );
        assert_eq!(
            got[2],
            ("more".to_string(), Some("Read more →".to_string()))
        );
        assert_eq!(got.len(), 3);
    }

    #[test]
    fn the_answer_needs_every_label_in_every_language_and_not_in_english() {
        let sources = BTreeMap::from([
            ("css-village".to_string(), "Village ".to_string()),
            ("t-hotels".to_string(), "Hotels".to_string()),
            ("sea".to_string(), "Sea".to_string()),
        ]);
        let langs = vec!["en".to_string(), "de".to_string(), "fr".to_string()];
        let ok = json!({"labels": {
            "css-village": {"de": "Dorf ", "fr": "Village "},
            "t-hotels": {"de": "Hotels", "fr": "Hôtels"},
            "sea": {"de": "Meer", "fr": "Mer"}
        }});
        let t = check_answer(&sources, &langs, &ok).unwrap();
        assert_eq!(t["css-village"]["de"], "Dorf");
        assert_eq!(t["css-village"]["en"], "Village");
        let english = json!({"labels": {
            "css-village": {"de": "Village", "fr": "Village"},
            "t-hotels": {"de": "Hotels", "fr": "Hôtels"},
            "sea": {"de": "Sea"}
        }});
        let errs = check_answer(&sources, &langs, &english).unwrap_err();
        assert!(
            errs.iter().any(|e| e.contains("/labels/sea/fr: missing")),
            "{errs:?}"
        );
        assert!(errs.iter().any(|e| e.contains("/labels/*/de")), "{errs:?}");
        assert!(!errs.iter().any(|e| e.contains("/labels/*/fr")), "{errs:?}");
    }

    #[test]
    fn the_stylesheets_labels_are_set_per_language_and_quotes_never_end_a_string() {
        let t = BTreeMap::from([(
            "css-featured".to_string(),
            BTreeMap::from([
                ("en".to_string(), "Featured".to_string()),
                ("fr".to_string(), clean("L'essentiel \"ici\"")),
            ]),
        )]);
        assert_eq!(
            css(&t),
            ":root:lang(fr){--ds-l-css-featured:\"L\u{2019}essentiel \u{201C}ici\u{201D}\";}\n"
        );
    }

    #[test]
    fn the_fake_answers_every_label_in_every_language() {
        let sources = BTreeMap::from([("sea".to_string(), "Sea".to_string())]);
        let langs = vec!["en".to_string(), "de".to_string()];
        let p = prompt(&sources, &BTreeMap::new(), &langs, "Site");
        let a = fake_answer(&p);
        assert_eq!(a["labels"]["sea"]["de"], "Sea (de)");
        assert!(check_answer(&sources, &langs, &a).is_ok());
    }
}
