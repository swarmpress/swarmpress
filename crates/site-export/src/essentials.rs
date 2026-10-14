//! The essentials ticker (a design's live facts of a place, ADR-0093 addendum 2026-10-14): the sea's
//! temperature, the air's, and the sunset, filled into the page when the site is exported, the way
//! [`crate::forecast`] fills the week ahead. Never written into a template or the content: a
//! design's sample values (`22°`) are placeholders, the site shows the feed's.
//!
//! - **In the page:** an element with the class `sp-essentials`. It names its place either with
//!   `data-place="Vernazza|44.1350|9.6847"` (a marker in the content, `data-lang` its language) or
//!   with a class `sp-place-{slug}` (a theme's template; its coordinates from the export's table of
//!   places, its language the page's `<html lang>`).
//! - **At export:** [`needed`] says which places the pages want; the caller fetches each place's
//!   values from Open-Meteo ([`now_url`], [`marine_url`]; free, no key), parses them ([`parse`])
//!   and fills the pages ([`fill`]): the element keeps its opening tag (so a later export fills it
//!   again) and holds the ticker (its head, three values counted up by the enhancement script, the
//!   source).
//!
//! A place whose values are missing is an error: an export never publishes a ticker it could not
//! fill (CLAUDE.md rule 11).

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

use crate::forecast::{Place, TIME_ZONE};

pub const CLASS: &str = "sp-essentials";

/// A place's live values.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Essentials {
    /// Sea surface temperature, °C (Open-Meteo's marine API).
    pub sea_c: f64,
    /// Air temperature now, °C.
    pub air_c: f64,
    /// WMO weather code now.
    pub code: u8,
    /// Today's sunset, local `HH:MM`.
    pub sunset: String,
    /// When the values were taken, local `HH:MM`.
    pub at: String,
}

/// Open-Meteo's forecast API for the air now and today's sunset.
pub fn now_url(place: &Place) -> String {
    format!(
        "https://api.open-meteo.com/v1/forecast?latitude={}&longitude={}&current=temperature_2m,weather_code&daily=sunset&timezone={}&forecast_days=1",
        place.lat,
        place.lng,
        TIME_ZONE.replace('/', "%2F")
    )
}

/// Open-Meteo's marine API for the sea surface temperature now.
pub fn marine_url(place: &Place) -> String {
    format!(
        "https://marine-api.open-meteo.com/v1/marine?latitude={}&longitude={}&current=sea_surface_temperature&timezone={}",
        place.lat,
        place.lng,
        TIME_ZONE.replace('/', "%2F")
    )
}

fn json(body: &[u8]) -> Result<serde_json::Value, String> {
    let v: serde_json::Value =
        serde_json::from_slice(body).map_err(|e| format!("not JSON: {e}"))?;
    if v.get("error").and_then(serde_json::Value::as_bool) == Some(true) {
        return Err(format!(
            "Open-Meteo: {}",
            v.get("reason").and_then(|r| r.as_str()).unwrap_or("error")
        ));
    }
    Ok(v)
}

/// `2026-10-14T20:48` → `20:48`.
fn hhmm(t: &str) -> Option<String> {
    let (_, time) = t.split_once('T')?;
    (time.len() >= 5).then(|| time[..5].to_string())
}

/// The two answers ([`now_url`], [`marine_url`]) as a place's values.
pub fn parse(now: &[u8], marine: &[u8]) -> Result<Essentials, String> {
    let n = json(now)?;
    let m = json(marine)?;
    let cur = n.get("current").ok_or("no current weather")?;
    let air_c = cur
        .get("temperature_2m")
        .and_then(|x| x.as_f64())
        .ok_or("no current temperature_2m")?;
    let code = cur
        .get("weather_code")
        .and_then(|x| x.as_f64())
        .ok_or("no current weather_code")?
        .clamp(0.0, 99.0) as u8;
    let at = cur
        .get("time")
        .and_then(|x| x.as_str())
        .and_then(hhmm)
        .ok_or("no current time")?;
    let sunset = n
        .get("daily")
        .and_then(|d| d.get("sunset"))
        .and_then(|s| s.get(0))
        .and_then(|s| s.as_str())
        .and_then(hhmm)
        .ok_or("no daily sunset")?;
    let sea_c = m
        .get("current")
        .and_then(|c| c.get("sea_surface_temperature"))
        .and_then(|x| x.as_f64())
        .ok_or("no current sea_surface_temperature")?;
    Ok(Essentials {
        sea_c,
        air_c,
        code,
        sunset,
        at,
    })
}

/// One ticker element found in a page.
struct Found {
    start: usize,
    end: usize,
    open_tag: String,
}

fn has_class(tag: &str, class: &str) -> bool {
    attr(tag, "class").is_some_and(|c| c.split_whitespace().any(|x| x == class))
}

fn attr(tag: &str, name: &str) -> Option<String> {
    let pat = format!(" {name}=\"");
    let i = tag.find(&pat)? + pat.len();
    let len = tag[i..].find('"')?;
    Some(
        tag[i..i + len]
            .replace("&quot;", "\"")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&amp;", "&"),
    )
}

fn find(html: &str) -> Vec<Found> {
    let mut out = Vec::new();
    let mut from = 0;
    while let Some(i) = html[from..].find(CLASS) {
        let at = from + i;
        let Some(start) = html[..at].rfind('<') else {
            break;
        };
        let Some(len) = html[start..].find('>') else {
            break;
        };
        let tag = &html[start..start + len + 1];
        if !tag.starts_with("<div") || !has_class(tag, CLASS) {
            from = at + CLASS.len();
            continue;
        }
        let end = crate::forecast::match_div(html, start + len + 1).unwrap_or(html.len());
        out.push(Found {
            start,
            end,
            open_tag: tag.to_string(),
        });
        from = end;
    }
    out
}

/// The page's language (`<html lang="de-DE">` → `de`).
fn page_lang(html: &str) -> String {
    html.find("<html")
        .and_then(|i| {
            let tag = &html[i..i + html[i..].find('>')?];
            attr(tag, "lang")
        })
        .map(|l| l.chars().take(2).collect::<String>().to_ascii_lowercase())
        .unwrap_or_else(|| "en".into())
}

/// The place a ticker element asks for: its own `data-place`, else its `sp-place-{slug}` class in
/// `places` (by slug).
fn place_of(tag: &str, places: &BTreeMap<String, Place>) -> Result<Place, String> {
    if let Some(p) = attr(tag, "data-place") {
        let parts: Vec<&str> = p.split('|').collect();
        return match parts.as_slice() {
            [name, lat, lng] => Ok(Place::new(name.trim(), lat.trim(), lng.trim())),
            _ => Err(format!("an essentials place is not name|lat|lng: {p}")),
        };
    }
    let class = attr(tag, "class").unwrap_or_default();
    let slug = class
        .split_whitespace()
        .find_map(|c| c.strip_prefix("sp-place-"))
        .ok_or_else(|| format!("an essentials ticker names no place: {tag}"))?;
    places
        .get(slug)
        .cloned()
        .ok_or_else(|| format!("an essentials ticker's place {slug} has no coordinates"))
}

/// The places the tickers in `html` ask for.
pub fn needed(html: &str, places: &BTreeMap<String, Place>) -> Result<BTreeSet<Place>, String> {
    find(html)
        .iter()
        .map(|f| place_of(&f.open_tag, places))
        .collect()
}

/// `html` with every ticker filled from `values` (by [`Place::key`]); `None` when it has none.
pub fn fill(
    html: &str,
    places: &BTreeMap<String, Place>,
    values: &BTreeMap<String, Essentials>,
) -> Result<Option<String>, String> {
    let found = find(html);
    if found.is_empty() {
        return Ok(None);
    }
    let lang = page_lang(html);
    let mut out = String::with_capacity(html.len() + 2048);
    let mut at = 0;
    for f in found {
        let place = place_of(&f.open_tag, places)?;
        let e = values
            .get(&place.key())
            .ok_or_else(|| format!("no essentials for {} ({})", place.name, place.key()))?;
        let lang = attr(&f.open_tag, "data-lang").unwrap_or_else(|| lang.clone());
        out.push_str(&html[at..f.start]);
        out.push_str(&f.open_tag);
        out.push_str(&render(&place, e, &lang));
        out.push_str("</div>");
        at = f.end;
    }
    out.push_str(&html[at..]);
    Ok(Some(out))
}

type Word = [&'static str; 4];
const LIVE: &Word = &["essentials · live", "aktuell", "en direct", "in diretta"];
const UPDATED: &Word = &["updated", "aktualisiert", "mis à jour", "aggiornato"];
const SEA: &Word = &["Sea", "Meer", "Mer", "Mare"];
const AIR: &Word = &["Air", "Luft", "Air", "Aria"];
const SUNSET: &Word = &["Sunset", "Sonnenuntergang", "Coucher du soleil", "Tramonto"];
const BY: &Word = &[
    "Weather data by",
    "Wetterdaten von",
    "Données météo :",
    "Dati meteo di",
];

fn li(lang: &str) -> usize {
    match lang {
        "de" => 1,
        "fr" => 2,
        "it" => 3,
        _ => 0,
    }
}

fn esc(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn render(place: &Place, e: &Essentials, lang: &str) -> String {
    let i = li(lang);
    let sky = crate::forecast::condition_word(e.code, lang);
    let icon = crate::forecast::sky_icon(e.code);
    format!(
        "<p class=\"ds-ticker-head\"><span>{} {}</span><span>{} {}</span></p><div class=\"ds-ticker-values\"><p><span class=\"ds-count\">{}°</span><span class=\"ds-meta\">{}</span></p><p><span class=\"ds-count\">{}°</span><span class=\"ds-meta\"><span class=\"ct-wx ct-wx-{icon}\" aria-hidden=\"true\"></span>{} · {}</span></p><p><span class=\"ds-count\">{}</span><span class=\"ds-meta\">{}</span></p></div><p class=\"ds-ticker-source\">{} <a href=\"https://open-meteo.com/\">Open-Meteo.com</a> (CC BY 4.0)</p>",
        esc(&place.name),
        LIVE[i],
        UPDATED[i],
        esc(&e.at),
        e.sea_c.round() as i64,
        SEA[i],
        e.air_c.round() as i64,
        AIR[i],
        esc(sky),
        esc(&e.sunset),
        SUNSET[i],
        BY[i],
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vernazza() -> Place {
        Place::new("Vernazza", "44.1350", "9.6847")
    }

    #[test]
    fn values_are_parsed_and_filled_in_the_pages_language() {
        let now = br#"{"current":{"time":"2026-10-14T09:40","temperature_2m":23.6,"weather_code":1},"daily":{"sunset":["2026-10-14T18:41"]}}"#;
        let marine = br#"{"current":{"time":"2026-10-14T09:30","sea_surface_temperature":21.7}}"#;
        let e = parse(now, marine).unwrap();
        assert_eq!(e.sunset, "18:41");
        assert_eq!(e.at, "09:40");
        let places = BTreeMap::from([("vernazza".to_string(), vernazza())]);
        let html = "<html lang=\"de-DE\"><body><div class=\"wp-block-group ds-ticker sp-essentials sp-place-vernazza\"><p>–</p></div><p>after</p></body></html>";
        assert_eq!(needed(html, &places).unwrap().len(), 1);
        let values = BTreeMap::from([(vernazza().key(), e)]);
        let out = fill(html, &places, &values).unwrap().unwrap();
        assert!(
            out.contains("<span class=\"ds-count\">22°</span><span class=\"ds-meta\">Meer</span>"),
            "{out}"
        );
        assert!(out.contains("Sonnenuntergang"));
        assert!(out.contains("18:41"));
        assert!(out.contains("Open-Meteo.com"));
        assert!(out.contains("<p>after</p>"));
        assert!(!out.contains("<p>–</p>"));
        // Filled again later: the same element is found and refilled.
        let again = fill(&out, &places, &values).unwrap().unwrap();
        assert_eq!(again, out);
    }

    #[test]
    fn a_ticker_without_values_or_place_fails() {
        let places = BTreeMap::new();
        let html = "<div class=\"sp-essentials sp-place-atlantis\"></div>";
        assert!(needed(html, &places).unwrap_err().contains("atlantis"));
        let html = "<div class=\"sp-essentials\" data-place=\"Vernazza|44.1350|9.6847\" data-lang=\"en\"></div>";
        assert!(fill(html, &places, &BTreeMap::new())
            .unwrap_err()
            .contains("no essentials"));
        assert!(parse(b"{\"current\":{}}", b"{}").is_err());
    }
}
