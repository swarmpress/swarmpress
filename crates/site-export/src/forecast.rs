//! The live forecast block (owner's decision 2026-10-12, cutover runbook): a page's weather forecast
//! is fetched when the site is exported and written into the page as static HTML, so the public
//! site stays fully static and a daily rebuild keeps it fresh.
//!
//! - **In the content:** a [`Marker`] (`<div class="sp-forecast" data-sp-forecast="v1" …>`, a
//!   `core/html` block) names the places (name, latitude, longitude), the language and the number
//!   of days. WordPress renders it as it is; nothing in WordPress fetches anything.
//! - **At export:** the caller asks [`needed`] (or [`crate::Export::forecast_places`]) which places
//!   the pages want, fetches each one's forecast from Open-Meteo ([`request_url`]; free, no key),
//!   parses it ([`parse`]) and fills the pages ([`fill`]). The fetch is the caller's: this crate
//!   stays sans-IO, and tests feed recorded answers.
//! - **Filled:** the marker keeps its attributes (so a later export fills it again) and holds a
//!   `wp-block-table` with one row per day (one place) or one row per place (several), the date the
//!   forecast starts, and Open-Meteo's attribution (CC BY 4.0).
//!
//! A marker whose forecast is missing is an error: an export never publishes a page with a
//! forecast it could not fetch (CLAUDE.md rule 11).

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

/// The marker's class and version attribute.
pub const CLASS: &str = "sp-forecast";
const ATTR: &str = "data-sp-forecast";
const VERSION: &str = "v1";
/// Days Open-Meteo is asked for; a marker shows at most this many.
pub const MAX_DAYS: usize = 7;
/// The site's time zone (the forecast's days are local days).
pub const TIME_ZONE: &str = "Europe/Rome";

/// A place a forecast is for. Coordinates are kept as written (`44.1350`), so the request and
/// the key are byte-stable.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct Place {
    pub name: String,
    pub lat: String,
    pub lng: String,
}

impl Place {
    pub fn new(name: &str, lat: &str, lng: &str) -> Place {
        Place {
            name: name.into(),
            lat: lat.into(),
            lng: lng.into(),
        }
    }

    /// `44.1350,9.6847`: what forecasts are keyed by (and a recorded answer's file name).
    pub fn key(&self) -> String {
        format!("{},{}", self.lat, self.lng)
    }

    fn valid(&self) -> bool {
        let num = |s: &str, max: f64| s.parse::<f64>().is_ok_and(|v| v.abs() <= max);
        !self.name.trim().is_empty() && num(&self.lat, 90.0) && num(&self.lng, 180.0)
    }
}

/// What a page asks for.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Marker {
    /// `en`, `de`, `fr` or `it` (anything else reads as English).
    pub lang: String,
    pub days: usize,
    pub places: Vec<Place>,
}

impl Marker {
    /// The marker as HTML, holding `pending` (what a page shows before an export fills it).
    pub fn html(&self, pending: &str) -> String {
        format!(
            "<div {}><p class=\"sp-forecast-pending\">{}</p></div>",
            self.attrs(None),
            esc(pending)
        )
    }

    fn attrs(&self, from: Option<&str>) -> String {
        let places: Vec<String> = self
            .places
            .iter()
            .map(|p| format!("{}|{}|{}", p.name.replace(['|', ';'], " "), p.lat, p.lng))
            .collect();
        let mut out = format!(
            "class=\"{CLASS}\" {ATTR}=\"{VERSION}\" data-lang=\"{}\" data-days=\"{}\" data-places=\"{}\"",
            esc(&self.lang),
            self.days,
            esc(&places.join(";"))
        );
        if let Some(d) = from {
            out.push_str(&format!(" data-forecast-from=\"{}\"", esc(d)));
        }
        out
    }
}

/// One day of a place's forecast.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Day {
    /// `2026-10-12` (local).
    pub date: String,
    /// WMO weather code.
    pub code: u8,
    pub max_c: f64,
    pub min_c: f64,
    /// The day's highest chance of precipitation, in percent.
    pub rain_pct: Option<f64>,
    /// The day's strongest wind, km/h.
    pub wind_kmh: Option<f64>,
}

/// A place's forecast, day by day from today.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Forecast {
    pub days: Vec<Day>,
}

/// Open-Meteo's forecast API for `place`: daily weather code, highs and lows, the chance of rain
/// and the wind, local days, [`MAX_DAYS`] days.
pub fn request_url(place: &Place) -> String {
    format!(
        "https://api.open-meteo.com/v1/forecast?latitude={}&longitude={}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max&timezone={}&forecast_days={MAX_DAYS}",
        place.lat,
        place.lng,
        TIME_ZONE.replace('/', "%2F")
    )
}

/// Open-Meteo's answer (`{"daily": {"time": [...], "weather_code": [...], ...}}`) as a forecast.
pub fn parse(body: &[u8]) -> Result<Forecast, String> {
    let v: serde_json::Value =
        serde_json::from_slice(body).map_err(|e| format!("not JSON: {e}"))?;
    if v.get("error").and_then(serde_json::Value::as_bool) == Some(true) {
        return Err(format!(
            "Open-Meteo: {}",
            v.get("reason").and_then(|r| r.as_str()).unwrap_or("error")
        ));
    }
    let daily = v.get("daily").ok_or("no daily forecast")?;
    let col = |k: &str| daily.get(k).and_then(serde_json::Value::as_array);
    let time = col("time").ok_or("no daily.time")?;
    let num = |k: &str, i: usize| col(k).and_then(|c| c.get(i)).and_then(|x| x.as_f64());
    let mut days = Vec::new();
    for (i, t) in time.iter().enumerate() {
        let date = t.as_str().ok_or("a day without a date")?.to_string();
        if parse_date(&date).is_none() {
            return Err(format!("a day's date is not YYYY-MM-DD: {date}"));
        }
        let code = num("weather_code", i).ok_or_else(|| format!("{date}: no weather_code"))?;
        let max_c = num("temperature_2m_max", i).ok_or_else(|| format!("{date}: no maximum"))?;
        let min_c = num("temperature_2m_min", i).ok_or_else(|| format!("{date}: no minimum"))?;
        days.push(Day {
            date,
            code: code.clamp(0.0, 99.0) as u8,
            max_c,
            min_c,
            rain_pct: num("precipitation_probability_max", i),
            wind_kmh: num("wind_speed_10m_max", i),
        });
    }
    if days.is_empty() {
        return Err("no days".into());
    }
    Ok(Forecast { days })
}

/// One marker found in a page: where it is, and what it asks for.
struct Found {
    start: usize,
    end: usize,
    marker: Result<Marker, String>,
}

/// The markers in `html`, each with its byte range (the opening tag to its matching `</div>`).
fn find(html: &str) -> Vec<Found> {
    let mut out = Vec::new();
    let mut from = 0;
    while let Some(i) = html[from..].find(ATTR) {
        let attr_at = from + i;
        let Some(start) = html[..attr_at].rfind("<div") else {
            from = attr_at + ATTR.len();
            continue;
        };
        let Some(tag_len) = html[start..].find('>') else {
            break;
        };
        let tag = &html[start..start + tag_len + 1];
        if !tag.contains(ATTR) {
            from = attr_at + ATTR.len();
            continue;
        }
        let end = match_div(html, start + tag_len + 1).unwrap_or(html.len());
        out.push(Found {
            start,
            end,
            marker: read_marker(tag),
        });
        from = end;
    }
    out
}

/// The end (after `</div>`) of the div whose content starts at `at`.
fn match_div(html: &str, at: usize) -> Option<usize> {
    let lower = html.to_ascii_lowercase();
    let mut depth = 1usize;
    let mut i = at;
    loop {
        let open = lower[i..].find("<div").map(|j| i + j);
        let close = lower[i..].find("</div>").map(|j| i + j)?;
        match open {
            Some(o) if o < close => {
                depth += 1;
                i = o + 4;
            }
            _ => {
                depth -= 1;
                i = close + 6;
                if depth == 0 {
                    return Some(i);
                }
            }
        }
    }
}

fn attr_value(tag: &str, name: &str) -> Option<String> {
    let pat = format!(" {name}=\"");
    let i = tag.find(&pat)? + pat.len();
    let len = tag[i..].find('"')?;
    Some(unesc(&tag[i..i + len]))
}

fn read_marker(tag: &str) -> Result<Marker, String> {
    if attr_value(tag, ATTR).as_deref() != Some(VERSION) {
        return Err(format!("a forecast marker of an unknown version: {tag}"));
    }
    let lang = attr_value(tag, "data-lang").unwrap_or_else(|| "en".into());
    let days = attr_value(tag, "data-days")
        .and_then(|d| d.parse::<usize>().ok())
        .unwrap_or(MAX_DAYS)
        .clamp(1, MAX_DAYS);
    let places_attr = attr_value(tag, "data-places").unwrap_or_default();
    let mut places = Vec::new();
    for p in places_attr.split(';').filter(|p| !p.trim().is_empty()) {
        let parts: Vec<&str> = p.split('|').collect();
        let place = match parts.as_slice() {
            [name, lat, lng] => Place::new(name.trim(), lat.trim(), lng.trim()),
            _ => return Err(format!("a forecast place is not name|lat|lng: {p}")),
        };
        if !place.valid() {
            return Err(format!("a forecast place is not a place: {p}"));
        }
        places.push(place);
    }
    if places.is_empty() {
        return Err(format!("a forecast marker without places: {tag}"));
    }
    Ok(Marker { lang, days, places })
}

/// The places the markers in `html` ask for. A marker that cannot be read is an error.
pub fn needed(html: &str) -> Result<BTreeSet<Place>, String> {
    let mut out = BTreeSet::new();
    for f in find(html) {
        out.extend(f.marker?.places);
    }
    Ok(out)
}

/// `html` with every marker filled from `forecasts` (by [`Place::key`]); `None` when it has no
/// marker. A place without a forecast is an error.
pub fn fill(html: &str, forecasts: &BTreeMap<String, Forecast>) -> Result<Option<String>, String> {
    let found = find(html);
    if found.is_empty() {
        return Ok(None);
    }
    let mut out = String::with_capacity(html.len() + 4096);
    let mut at = 0;
    for f in found {
        let m = f.marker?;
        let mut rows = Vec::new();
        for p in &m.places {
            let fc = forecasts
                .get(&p.key())
                .ok_or_else(|| format!("no forecast for {} ({})", p.name, p.key()))?;
            rows.push((p, fc));
        }
        out.push_str(&html[at..f.start]);
        out.push_str(&render(&m, &rows));
        at = f.end;
    }
    out.push_str(&html[at..]);
    Ok(Some(out))
}

fn render(m: &Marker, rows: &[(&Place, &Forecast)]) -> String {
    let l = Lang::of(&m.lang);
    let from = rows
        .iter()
        .filter_map(|(_, f)| f.days.first().map(|d| d.date.clone()))
        .min()
        .unwrap_or_default();
    let mut table = String::new();
    if let [(_, fc)] = rows {
        // One place: a row per day.
        table.push_str(&format!(
            "<thead><tr><th>{}</th><th>{}</th><th>{}</th><th>{}</th><th>{}</th></tr></thead><tbody>",
            l.t(DAY),
            l.t(SKY),
            l.t(TEMP),
            l.t(RAIN),
            l.t(WIND)
        ));
        for d in fc.days.iter().take(m.days) {
            table.push_str(&format!(
                "<tr><th scope=\"row\">{}</th><td>{} {}</td><td>{} / {}</td><td>{}</td><td>{}</td></tr>",
                esc(&day_label(&d.date, l)),
                symbol(d.code),
                esc(l.t(condition(d.code))),
                deg(d.max_c),
                deg(d.min_c),
                d.rain_pct.map(|p| format!("{}%", p.round() as i64)).unwrap_or_else(|| "–".into()),
                d.wind_kmh.map(|w| format!("{} km/h", w.round() as i64)).unwrap_or_else(|| "–".into()),
            ));
        }
    } else {
        // Several places: a row per place, a column per day.
        let first = rows.first().map(|(_, f)| f).expect("a marker has places");
        table.push_str(&format!("<thead><tr><th>{}</th>", l.t(PLACE)));
        for d in first.days.iter().take(m.days) {
            table.push_str(&format!("<th>{}</th>", esc(&day_label(&d.date, l))));
        }
        table.push_str("</tr></thead><tbody>");
        for (p, fc) in rows {
            table.push_str(&format!("<tr><th scope=\"row\">{}</th>", esc(&p.name)));
            for d in fc.days.iter().take(m.days) {
                table.push_str(&format!(
                    "<td title=\"{}\">{} {} / {}</td>",
                    esc(l.t(condition(d.code))),
                    symbol(d.code),
                    deg(d.max_c),
                    deg(d.min_c)
                ));
            }
            table.push_str("</tr>");
        }
    }
    table.push_str("</tbody>");
    let caption = format!(
        "{} {} · {} <a href=\"https://open-meteo.com/\">Open-Meteo.com</a> (CC BY 4.0)",
        esc(l.t(FROM)),
        esc(&long_date(&from, l)),
        esc(l.t(BY))
    );
    format!(
        "<div {}><figure class=\"wp-block-table sp-forecast-table\"><table>{table}</table><figcaption class=\"wp-element-caption\">{caption}</figcaption></figure></div>",
        m.attrs(Some(&from))
    )
}

fn deg(c: f64) -> String {
    format!("{}°", c.round() as i64)
}

// ------------------------------------------------------------------ words, in four languages

#[derive(Clone, Copy)]
struct Lang(usize);

impl Lang {
    fn of(code: &str) -> Lang {
        Lang(match code {
            "de" => 1,
            "fr" => 2,
            "it" => 3,
            _ => 0,
        })
    }
    fn t(self, w: &'static [&'static str; 4]) -> &'static str {
        w[self.0]
    }
}

type Word = [&'static str; 4];
const DAY: &Word = &["Day", "Tag", "Jour", "Giorno"];
const PLACE: &Word = &["Village", "Dorf", "Village", "Borgo"];
const SKY: &Word = &["Sky", "Himmel", "Ciel", "Cielo"];
const TEMP: &Word = &["High / low", "Max. / min.", "Max. / min.", "Max / min"];
const RAIN: &Word = &["Rain", "Regen", "Pluie", "Pioggia"];
const WIND: &Word = &["Wind", "Wind", "Vent", "Vento"];
const FROM: &Word = &[
    "Forecast from",
    "Vorhersage vom",
    "Prévisions du",
    "Previsioni dal",
];
const BY: &Word = &[
    "Weather data by",
    "Wetterdaten von",
    "Données météo :",
    "Dati meteo di",
];
const WEEKDAYS: [Word; 7] = [
    ["Mon", "Mo", "lun.", "lun"],
    ["Tue", "Di", "mar.", "mar"],
    ["Wed", "Mi", "mer.", "mer"],
    ["Thu", "Do", "jeu.", "gio"],
    ["Fri", "Fr", "ven.", "ven"],
    ["Sat", "Sa", "sam.", "sab"],
    ["Sun", "So", "dim.", "dom"],
];
const MONTHS: [Word; 12] = [
    ["January", "Januar", "janvier", "gennaio"],
    ["February", "Februar", "février", "febbraio"],
    ["March", "März", "mars", "marzo"],
    ["April", "April", "avril", "aprile"],
    ["May", "Mai", "mai", "maggio"],
    ["June", "Juni", "juin", "giugno"],
    ["July", "Juli", "juillet", "luglio"],
    ["August", "August", "août", "agosto"],
    ["September", "September", "septembre", "settembre"],
    ["October", "Oktober", "octobre", "ottobre"],
    ["November", "November", "novembre", "novembre"],
    ["December", "Dezember", "décembre", "dicembre"],
];

/// The WMO weather code's words.
fn condition(code: u8) -> &'static Word {
    match code {
        0 => &["Clear", "Klar", "Dégagé", "Sereno"],
        1 => &[
            "Mostly clear",
            "Überwiegend klar",
            "Plutôt dégagé",
            "Poco nuvoloso",
        ],
        2 => &[
            "Partly cloudy",
            "Teilweise bewölkt",
            "Partiellement nuageux",
            "Parzialmente nuvoloso",
        ],
        3 => &["Overcast", "Bedeckt", "Couvert", "Coperto"],
        45 | 48 => &["Fog", "Nebel", "Brouillard", "Nebbia"],
        51..=57 => &["Drizzle", "Nieselregen", "Bruine", "Pioviggine"],
        61..=67 => &["Rain", "Regen", "Pluie", "Pioggia"],
        71..=77 | 85 | 86 => &["Snow", "Schnee", "Neige", "Neve"],
        80..=82 => &["Showers", "Schauer", "Averses", "Rovesci"],
        95..=99 => &["Thunderstorms", "Gewitter", "Orages", "Temporali"],
        _ => &["Mixed", "Wechselhaft", "Variable", "Variabile"],
    }
}

fn symbol(code: u8) -> &'static str {
    match code {
        0 => "☀️",
        1 | 2 => "⛅",
        3 => "☁️",
        45 | 48 => "🌫️",
        51..=57 | 61..=67 | 80..=82 => "🌧️",
        71..=77 | 85 | 86 => "🌨️",
        95..=99 => "⛈️",
        _ => "🌤️",
    }
}

fn parse_date(d: &str) -> Option<(i32, u32, u32)> {
    let mut it = d.splitn(3, '-');
    let y = it.next()?.parse().ok()?;
    let m = it.next()?.parse().ok()?;
    let day = it.next()?.parse().ok()?;
    ((1..=12).contains(&m) && (1..=31).contains(&day) && d.len() == 10).then_some((y, m, day))
}

/// 0 = Monday (Sakamoto's method).
fn weekday(y: i32, m: u32, d: u32) -> usize {
    const T: [i32; 12] = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
    let y = if m < 3 { y - 1 } else { y };
    let sunday0 = (y + y / 4 - y / 100 + y / 400 + T[(m - 1) as usize] + d as i32).rem_euclid(7);
    ((sunday0 + 6) % 7) as usize
}

/// `Mon 12` / `Mo 12.` / `lun. 12` / `lun 12`.
fn day_label(date: &str, l: Lang) -> String {
    let Some((y, m, d)) = parse_date(date) else {
        return date.to_string();
    };
    let wd = l.t(&WEEKDAYS[weekday(y, m, d)]);
    if l.0 == 1 {
        format!("{wd} {d}.")
    } else {
        format!("{wd} {d}")
    }
}

/// `12 October 2026` / `12. Oktober 2026` / `12 octobre 2026` / `12 ottobre 2026`.
fn long_date(date: &str, l: Lang) -> String {
    let Some((y, m, d)) = parse_date(date) else {
        return date.to_string();
    };
    let month = l.t(&MONTHS[(m - 1) as usize]);
    match l.0 {
        0 => format!("{d} {month} {y}"),
        1 => format!("{d}. {month} {y}"),
        _ => format!("{d} {month} {y}"),
    }
}

fn esc(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn unesc(s: &str) -> String {
    s.replace("&quot;", "\"")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&#038;", "&")
        .replace("&amp;", "&")
}

#[cfg(test)]
mod tests;
