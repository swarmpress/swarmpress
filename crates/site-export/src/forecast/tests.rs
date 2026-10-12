//! The forecast block against recorded Open-Meteo answers: markers read and filled, in four
//! languages, again on the next export, and loudly refused when a forecast is missing. No test
//! reaches the network.

use super::*;
use crate::{Crawler, Options, Release, Response};

/// Open-Meteo's answer for Vernazza, as recorded (three days of seven, to keep it short).
const VERNAZZA: &str = r#"{"latitude":44.14,"longitude":9.68,"generationtime_ms":0.07,"utc_offset_seconds":7200,"timezone":"Europe/Rome","timezone_abbreviation":"GMT+2","elevation":12.0,
"daily_units":{"time":"iso8601","weather_code":"wmo code","temperature_2m_max":"°C","temperature_2m_min":"°C","precipitation_probability_max":"%","wind_speed_10m_max":"km/h"},
"daily":{"time":["2026-10-12","2026-10-13","2026-10-14"],"weather_code":[0,61,3],"temperature_2m_max":[22.4,19.5,20.6],"temperature_2m_min":[15.1,14.0,13.5],"precipitation_probability_max":[3,85,20],"wind_speed_10m_max":[9.8,24.3,12.0]}}"#;

const MANAROLA: &str = r#"{"daily":{"time":["2026-10-12","2026-10-13","2026-10-14"],"weather_code":[1,80,95],"temperature_2m_max":[23.0,18.2,17.9],"temperature_2m_min":[16.0,13.6,12.4],"precipitation_probability_max":[0,60,90],"wind_speed_10m_max":[8,20,30]}}"#;

fn vernazza() -> Place {
    Place::new("Vernazza", "44.1350", "9.6847")
}

fn manarola() -> Place {
    Place::new("Manarola", "44.1069", "9.7286")
}

fn forecasts() -> BTreeMap<String, Forecast> {
    BTreeMap::from([
        (vernazza().key(), parse(VERNAZZA.as_bytes()).unwrap()),
        (manarola().key(), parse(MANAROLA.as_bytes()).unwrap()),
    ])
}

fn page(marker: &Marker) -> String {
    format!(
        "<html><head><title>Weather</title></head><body><main><h2>Atmosphere</h2><!-- wp:html -->{}<!-- /wp:html --><div class=\"after\"><p>Webcams</p></div></main></body></html>",
        marker.html("The forecast is added when the site is published.")
    )
}

#[test]
fn asks_open_meteo_for_local_days_without_a_key() {
    let url = request_url(&vernazza());
    assert_eq!(
        url,
        "https://api.open-meteo.com/v1/forecast?latitude=44.1350&longitude=9.6847&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max&timezone=Europe%2FRome&forecast_days=7"
    );
    assert!(!url.contains("apikey"));
}

#[test]
fn parses_the_daily_forecast_and_refuses_what_is_not_one() {
    let f = parse(VERNAZZA.as_bytes()).unwrap();
    assert_eq!(f.days.len(), 3);
    assert_eq!(f.days[1].date, "2026-10-13");
    assert_eq!(f.days[1].code, 61);
    assert_eq!(f.days[1].rain_pct, Some(85.0));
    assert!(parse(b"not json").is_err());
    assert!(
        parse(br#"{"error":true,"reason":"Latitude must be in range"}"#)
            .unwrap_err()
            .contains("Latitude")
    );
    assert!(parse(br#"{"daily":{"time":[]}}"#).is_err());
    assert!(parse(br#"{"daily":{"time":["2026-10-12"],"weather_code":[0]}}"#).is_err());
}

#[test]
fn a_page_names_the_places_its_markers_ask_for() {
    let m = Marker {
        lang: "en".into(),
        days: 7,
        places: vec![vernazza(), manarola()],
    };
    let html = page(&m)
        + &page(&Marker {
            places: vec![vernazza()],
            ..m.clone()
        });
    assert_eq!(
        needed(&html).unwrap(),
        BTreeSet::from([vernazza(), manarola()])
    );
    assert!(needed("<p>no forecast here</p>").unwrap().is_empty());
    // A marker that cannot be read is an error, not a page without a forecast.
    assert!(needed(
        "<div class=\"sp-forecast\" data-sp-forecast=\"v1\" data-places=\"Nowhere|north|9\"></div>"
    )
    .is_err());
    assert!(needed(
        "<div class=\"sp-forecast\" data-sp-forecast=\"v9\" data-places=\"A|1|2\"></div>"
    )
    .is_err());
}

#[test]
fn one_place_is_a_row_per_day_in_the_pages_language() {
    let m = Marker {
        lang: "de".into(),
        days: 2,
        places: vec![vernazza()],
    };
    let html = page(&m);
    let filled = fill(&html, &forecasts()).unwrap().unwrap();
    // The marker stays (a later export fills it again) and says where the forecast starts.
    assert!(filled.contains("data-sp-forecast=\"v1\""));
    assert!(filled.contains("data-forecast-from=\"2026-10-12\""));
    assert!(!filled.contains("sp-forecast-pending"));
    // 12 October 2026 is a Monday; two days asked for, two rows.
    assert!(filled.contains("<th scope=\"row\">Mo 12.</th><td>☀️ Klar</td><td>22° / 15°</td><td>3%</td><td>10 km/h</td>"));
    assert!(filled.contains("<th scope=\"row\">Di 13.</th><td>🌧️ Regen</td><td>20° / 14°</td><td>85%</td><td>24 km/h</td>"));
    assert!(!filled.contains("Mi 14."));
    assert!(filled.contains("Vorhersage vom 12. Oktober 2026"));
    // Open-Meteo's attribution (CC BY 4.0).
    assert!(filled.contains("<a href=\"https://open-meteo.com/\">Open-Meteo.com</a> (CC BY 4.0)"));
    // What follows the marker is untouched.
    assert!(filled.ends_with(
        "<!-- /wp:html --><div class=\"after\"><p>Webcams</p></div></main></body></html>"
    ));
}

#[test]
fn several_places_are_a_row_per_place_and_a_column_per_day() {
    let m = Marker {
        lang: "it".into(),
        days: 3,
        places: vec![manarola(), vernazza()],
    };
    let filled = fill(&page(&m), &forecasts()).unwrap().unwrap();
    assert!(filled.contains("<th>Borgo</th><th>lun 12</th><th>mar 13</th><th>mer 14</th>"));
    assert!(filled.contains(
        "<tr><th scope=\"row\">Manarola</th><td title=\"Poco nuvoloso\">⛅ 23° / 16°</td>"
    ));
    assert!(filled.contains("<td title=\"Temporali\">⛈️ 18° / 12°</td>"));
    let manarola_row = filled.find(">Manarola<").unwrap();
    let vernazza_row = filled.find(">Vernazza<").unwrap();
    assert!(
        manarola_row < vernazza_row,
        "the places keep the marker's order"
    );
    assert!(filled.contains("Previsioni dal 12 ottobre 2026"));
}

#[test]
fn filling_again_replaces_the_previous_forecast() {
    let m = Marker {
        lang: "fr".into(),
        days: 3,
        places: vec![vernazza()],
    };
    let once = fill(&page(&m), &forecasts()).unwrap().unwrap();
    let mut next = forecasts();
    let mut later = parse(VERNAZZA.as_bytes()).unwrap();
    later.days.remove(0);
    next.insert(vernazza().key(), later);
    let twice = fill(&once, &next).unwrap().unwrap();
    assert_eq!(twice.matches("data-sp-forecast").count(), 1);
    assert!(twice.contains("data-forecast-from=\"2026-10-13\""));
    assert!(twice.contains("Prévisions du 13 octobre 2026"));
    assert!(!twice.contains("lun. 12"));
    // The same forecasts give the same page.
    assert_eq!(fill(&once, &forecasts()).unwrap().unwrap(), once);
}

#[test]
fn a_missing_forecast_is_an_error_and_a_page_without_markers_is_left_alone() {
    let m = Marker {
        lang: "en".into(),
        days: 7,
        places: vec![vernazza(), Place::new("Corniglia", "44.1196", "9.7105")],
    };
    let err = fill(&page(&m), &forecasts()).unwrap_err();
    assert!(err.contains("Corniglia"), "{err}");
    assert_eq!(fill("<p>plain</p>", &forecasts()).unwrap(), None);
}

fn html_response(body: &str) -> Response {
    Response {
        status: 200,
        content_type: "text/html; charset=UTF-8".into(),
        location: None,
        body: body.as_bytes().to_vec(),
    }
}

#[test]
fn an_export_fills_its_pages_and_its_release_follows() {
    let m = Marker {
        lang: "en".into(),
        days: 3,
        places: vec![vernazza()],
    };
    let mut opts = Options::new("http://sandbox.invalid", "https://cinqueterre.travel");
    opts.seeds = vec!["/".into()];
    let mut c = Crawler::full(opts);
    while let Some(p) = c.next_path() {
        let body = match p.as_str() {
            "/" => "<html><head><title>Home</title></head><body><a href=\"/en/weather/\">Weather</a></body></html>".to_string(),
            _ => page(&m),
        };
        c.feed(html_response(&body));
    }
    let mut e = c.finish();
    let before = e.release.clone();
    assert_eq!(e.forecast_places().unwrap(), BTreeSet::from([vernazza()]));
    assert_eq!(e.fill_forecasts(&forecasts()).unwrap(), 1);
    // The weather page changed; the home did not; the id is the new manifest's.
    assert_ne!(
        e.release.files["/en/weather/"],
        before.files["/en/weather/"]
    );
    assert_eq!(e.release.files["/"], before.files["/"]);
    assert_ne!(e.release.id, before.id);
    assert_eq!(e.release.id, e.release.computed_id());
    let f = &e.release.files["/en/weather/"];
    let body = String::from_utf8(e.blobs[&f.sha256].clone()).unwrap();
    assert_eq!(body.len() as u64, f.size);
    assert!(body.contains("Mon 12"));
    // A missing forecast fails the export.
    assert!(e.fill_forecasts(&BTreeMap::new()).is_err());
}

#[test]
fn a_release_on_disk_is_filled_through_its_reader() {
    let m = Marker {
        lang: "en".into(),
        days: 1,
        places: vec![manarola()],
    };
    let html = page(&m).into_bytes();
    let mut release = Release::default();
    let sha = crate::hex(&sha2::Sha256::digest(&html));
    release.files.insert(
        "/en/weather/".into(),
        crate::FileEntry {
            sha256: sha.clone(),
            content_type: "text/html".into(),
            size: html.len() as u64,
        },
    );
    release.id = release.computed_id();
    let read = |s: &str| (s == sha).then(|| html.clone());
    assert_eq!(
        crate::release_places(&release, &read).unwrap(),
        BTreeSet::from([manarola()])
    );
    let changed = crate::fill_release(&mut release, &read, &forecasts()).unwrap();
    assert_eq!(changed.len(), 1);
    assert!(String::from_utf8_lossy(&changed["/en/weather/"]).contains("Mon 12"));
    assert_eq!(release.id, release.computed_id());
}

#[test]
fn weekdays_and_dates() {
    assert_eq!(weekday(2026, 10, 12), 0);
    assert_eq!(weekday(2024, 2, 29), 3);
    assert_eq!(weekday(2000, 1, 1), 5);
    assert_eq!(day_label("2026-10-18", Lang::of("en")), "Sun 18");
    assert_eq!(long_date("2026-03-01", Lang::of("de")), "1. März 2026");
    assert_eq!(day_label("tomorrow", Lang::of("en")), "tomorrow");
}

use sha2::Digest as _;
