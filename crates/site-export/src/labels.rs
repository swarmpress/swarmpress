//! The design's own words in the page's language (FEAT-115, ADR-0093's third addendum).
//!
//! A site's theme carries a label table (`ThemeData.labels`: key → language → text), filled by
//! the web designer for every site language. The words the theme's templates, the import and the
//! export write in the design's language (English: `Editors' picks`, `On this page`, `Sea`) are
//! put in the page's language here, wherever they stand alone: a text node, or an `aria-label` or
//! `placeholder`, whose text is a label's English (entities decoded, apostrophes and spaces
//! normalised). The page's language is its `<html lang>`. A page in English, a text that is not
//! a label, the head, scripts and styles are left alone.
//!
//! Labels whose key starts with `css-` are the stylesheet's (`content:var(--ds-l-…)`); the theme
//! sets them per language itself. [`DEFAULTS`] are the platform's own words (the export's ticker,
//! the import's contents rail), used where a site's table has none.

use std::collections::BTreeMap;

/// key → language → text.
pub type Labels = BTreeMap<String, BTreeMap<String, String>>;

/// The platform's words in the languages it ships (`en`, `de`, `fr`, `it`); a site's table
/// overrides them and adds its own languages.
pub const DEFAULTS: &[(&str, [&str; 4])] = &[
    ("today", ["Today", "Heute", "Aujourd’hui", "Oggi"]),
    (
        "updated",
        ["updated", "aktualisiert", "mis à jour", "aggiornato"],
    ),
    ("sea", ["Sea", "Meer", "Mer", "Mare"]),
    ("air", ["Air", "Luft", "Air", "Aria"]),
    (
        "sunset",
        ["Sunset", "Sonnenuntergang", "Coucher du soleil", "Tramonto"],
    ),
    (
        "weather-data-by",
        [
            "Weather data by",
            "Wetterdaten von",
            "Données météo :",
            "Dati meteo di",
        ],
    ),
    (
        "on-this-page",
        [
            "On this page",
            "Auf dieser Seite",
            "Sur cette page",
            "In questa pagina",
        ],
    ),
    ("more-in", ["More in", "Mehr zu", "Plus sur", "Altro su"]),
    (
        "more-from",
        ["More from", "Mehr aus", "Plus de", "Altro da"],
    ),
];

const DEFAULT_LANGS: [&str; 4] = ["en", "de", "fr", "it"];

/// The keys the platform writes itself (the import and the export), with their English.
pub fn platform_keys() -> Vec<(&'static str, &'static str)> {
    DEFAULTS.iter().map(|(k, w)| (*k, w[0])).collect()
}

/// `labels` over [`DEFAULTS`].
pub fn with_defaults(labels: &Labels) -> Labels {
    let mut out: Labels = DEFAULTS
        .iter()
        .map(|(k, words)| {
            (
                k.to_string(),
                DEFAULT_LANGS
                    .iter()
                    .zip(words.iter())
                    .map(|(l, w)| (l.to_string(), w.to_string()))
                    .collect(),
            )
        })
        .collect();
    for (k, by_lang) in labels {
        let e = out.entry(k.clone()).or_default();
        for (l, t) in by_lang {
            e.insert(l.clone(), t.clone());
        }
    }
    out
}

/// A label's English, else its first text.
pub fn english(labels: &Labels, key: &str) -> Option<String> {
    let by = labels.get(key)?;
    by.get("en").or_else(|| by.values().next()).cloned()
}

/// A label in `lang`, else its English.
pub fn word(labels: &Labels, key: &str, lang: &str) -> Option<String> {
    let by = labels.get(key)?;
    by.get(lang).or_else(|| by.get("en")).cloned()
}

/// A text as compared with a label: entities decoded, typographic apostrophes and quotes as
/// straight ones, spaces collapsed, trimmed.
pub fn normalise(s: &str) -> String {
    let decoded = decode(s);
    let mut out = String::with_capacity(decoded.len());
    let mut space = false;
    for c in decoded.chars() {
        let c = match c {
            '\u{2019}' | '\u{2018}' | '\u{02BC}' => '\'',
            '\u{201C}' | '\u{201D}' => '"',
            '\u{00A0}' => ' ',
            c => c,
        };
        if c.is_whitespace() {
            space = true;
            continue;
        }
        if space && !out.is_empty() {
            out.push(' ');
        }
        space = false;
        out.push(c);
    }
    out
}

fn decode(s: &str) -> String {
    if !s.contains('&') {
        return s.to_string();
    }
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(i) = rest.find('&') {
        out.push_str(&rest[..i]);
        rest = &rest[i..];
        let Some(end) = rest
            .char_indices()
            .take(12)
            .find(|(_, c)| *c == ';')
            .map(|(i, _)| i)
        else {
            out.push('&');
            rest = &rest[1..];
            continue;
        };
        let ent = &rest[1..end];
        let c = match ent {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            "nbsp" => Some('\u{00A0}'),
            "rsquo" => Some('\u{2019}'),
            "lsquo" => Some('\u{2018}'),
            "ndash" => Some('\u{2013}'),
            "mdash" => Some('\u{2014}'),
            "hellip" => Some('\u{2026}'),
            "rarr" => Some('\u{2192}'),
            _ => ent
                .strip_prefix("#x")
                .or_else(|| ent.strip_prefix("#X"))
                .and_then(|h| u32::from_str_radix(h, 16).ok())
                .or_else(|| ent.strip_prefix('#').and_then(|d| d.parse().ok()))
                .and_then(char::from_u32),
        };
        match c {
            Some(c) => {
                out.push(c);
                rest = &rest[end + 1..];
            }
            None => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

fn escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// The page's language (`<html lang="de-DE">` → `de`), if it says.
pub fn page_lang(html: &str) -> Option<String> {
    let i = html.find("<html")?;
    let end = i + html[i..].find('>')?;
    let tag = &html[i..end];
    let at = tag.find(" lang=\"")? + 7;
    let v = &tag[at..at + tag[at..].find('"')?];
    let l: String = v.chars().take_while(|c| c.is_ascii_alphabetic()).collect();
    (!l.is_empty()).then(|| l.to_ascii_lowercase())
}

/// English text (normalised) → the text in `lang`, for the labels that are not the stylesheet's
/// and differ from their English.
pub fn table_for(labels: &Labels, lang: &str) -> BTreeMap<String, String> {
    labels
        .iter()
        .filter(|(k, _)| !k.starts_with("css-"))
        .filter_map(|(_, by)| {
            let en = by.get("en")?;
            let t = by.get(lang)?;
            let key = normalise(en);
            (!key.is_empty() && normalise(t) != key).then(|| (key, t.clone()))
        })
        .collect()
}

/// `html` (a whole page or a fragment) with every label in `lang` (module docs); `None` when
/// nothing changed.
pub fn localize(html: &str, lang: &str, labels: &Labels) -> Option<String> {
    if lang == "en" {
        return None;
    }
    let table = table_for(labels, lang);
    if table.is_empty() {
        return None;
    }
    walk(html, &table, &mut Vec::new())
}

/// The labels `html` (a page in `lang`) still shows in English where they stand alone: what
/// [`localize`] would change. Empty for a page in English.
pub fn left_in_english(html: &str, lang: &str, labels: &Labels) -> Vec<String> {
    let mut found = Vec::new();
    if lang != "en" {
        let table = table_for(labels, lang);
        if !table.is_empty() {
            walk(html, &table, &mut found);
        }
    }
    found
}

fn walk(html: &str, table: &BTreeMap<String, String>, found: &mut Vec<String>) -> Option<String> {
    let mut out = String::with_capacity(html.len() + 256);
    let mut changed = false;
    let lower = html.to_ascii_lowercase();
    let mut at = 0;
    // A whole page: start after its head.
    if let Some(h) = lower.find("</head>") {
        out.push_str(&html[..h + 7]);
        at = h + 7;
    }
    while at < html.len() {
        let Some(lt) = html[at..].find('<').map(|i| at + i) else {
            changed |= push_text(&mut out, &html[at..], table, found);
            break;
        };
        changed |= push_text(&mut out, &html[at..lt], table, found);
        // Scripts and styles pass whole.
        let skip_to = ["<script", "<style"]
            .iter()
            .find(|t| lower[lt..].starts_with(*t))
            .and_then(|t| {
                let close = format!("</{}", &t[1..]);
                lower[lt..].find(&close).map(|i| lt + i)
            });
        if let Some(close) = skip_to {
            out.push_str(&html[lt..close]);
            at = close;
            continue;
        }
        if html[lt..].starts_with("<!--") {
            let end = html[lt..].find("-->").map_or(html.len(), |i| lt + i + 3);
            out.push_str(&html[lt..end]);
            at = end;
            continue;
        }
        let gt = html[lt..].find('>').map_or(html.len(), |i| lt + i + 1);
        let tag = &html[lt..gt];
        match localize_attrs(tag, table, found) {
            Some(t) => {
                out.push_str(&t);
                changed = true;
            }
            None => out.push_str(tag),
        }
        at = gt;
    }
    changed.then_some(out)
}

fn push_text(
    out: &mut String,
    text: &str,
    table: &BTreeMap<String, String>,
    found: &mut Vec<String>,
) -> bool {
    let key = normalise(text);
    if key.is_empty() {
        out.push_str(text);
        return false;
    }
    match table.get(&key) {
        Some(t) => {
            found.push(key.clone());
            let lead = &text[..text.len() - text.trim_start().len()];
            let trail = &text[text.trim_end().len()..];
            out.push_str(lead);
            out.push_str(&escape(t));
            out.push_str(trail);
            true
        }
        None => {
            out.push_str(text);
            false
        }
    }
}

fn localize_attrs(
    tag: &str,
    table: &BTreeMap<String, String>,
    found: &mut Vec<String>,
) -> Option<String> {
    let mut out = tag.to_string();
    let mut changed = false;
    for name in ["aria-label=\"", "placeholder=\""] {
        let Some(i) = out.find(name) else { continue };
        let start = i + name.len();
        let Some(len) = out[start..].find('"') else {
            continue;
        };
        let v = &out[start..start + len];
        if let Some(t) = table.get(&normalise(v)) {
            found.push(normalise(v));
            out.replace_range(start..start + len, &escape(t));
            changed = true;
        }
    }
    changed.then_some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn labels() -> Labels {
        let mut l = Labels::new();
        for (k, en, de) in [
            (
                "t-editors-picks",
                "Editors’ picks",
                "Empfehlungen der Redaktion",
            ),
            ("search", "Search", "Suche"),
            ("css-village", "Village", "Dorf"),
        ] {
            l.insert(
                k.into(),
                [("en".to_string(), en.to_string()), ("de".into(), de.into())].into(),
            );
        }
        l
    }

    #[test]
    fn a_label_standing_alone_is_put_in_the_pages_language() {
        let html = "<html lang=\"de-DE\"><head><title>Search</title></head><body><h2 class=\"x\"> Editors&#8217; picks </h2><p>Editors’ picks are good</p><button aria-label=\"Search\">Search</button><script>var a=\"Search\";</script><p>Village</p></body></html>";
        let out = localize(html, &page_lang(html).unwrap(), &labels()).unwrap();
        assert!(
            out.contains("<h2 class=\"x\"> Empfehlungen der Redaktion </h2>"),
            "{out}"
        );
        // Not alone: content that only contains a label is left alone.
        assert!(out.contains("<p>Editors’ picks are good</p>"));
        assert!(out.contains("<button aria-label=\"Suche\">Suche</button>"));
        // The head, scripts and the stylesheet's labels are left alone.
        assert!(out.contains("<title>Search</title>"));
        assert!(out.contains("var a=\"Search\";"));
        assert!(out.contains("<p>Village</p>"));
        assert_eq!(localize(html, "en", &labels()), None);
        assert_eq!(left_in_english(html, "de", &labels()).len(), 3);
        assert!(left_in_english(&out, "de", &labels()).is_empty());
    }

    #[test]
    fn entities_next_to_letters_beyond_ascii_decode_safely() {
        assert_eq!(
            normalise("Gr&uuml;&szlig;e &amp; Dörfer&#8217;s"),
            "Gr&uuml;&szlig;e & Dörfer's"
        );
        assert_eq!(normalise("&Über"), "&Über");
    }

    #[test]
    fn the_platforms_words_are_defaults_a_sites_table_overrides() {
        let mut l = Labels::new();
        l.insert(
            "sea".into(),
            [
                ("en".to_string(), "Sea".to_string()),
                ("de".into(), "See".into()),
            ]
            .into(),
        );
        let all = with_defaults(&l);
        assert_eq!(word(&all, "sea", "de").as_deref(), Some("See"));
        assert_eq!(word(&all, "sunset", "it").as_deref(), Some("Tramonto"));
        assert_eq!(word(&all, "sunset", "pt").as_deref(), Some("Sunset"));
    }
}
