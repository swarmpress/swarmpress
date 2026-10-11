//! Every URL the live site serves and the JSON it renders, by the frozen theme's routing rules
//! (`packages/site-builder/src/themes/cinque-terre/src/pages`, read and never changed).
//!
//! In the theme's precedence (a static route before a dynamic one, a named parameter before a
//! rest parameter), for each language:
//!
//! 1. the hub pages (`/{lang}/sights/` → `sights.json`, `/{lang}/` → `index.json`, the blog index);
//! 2. (the theme's blog route renders `content/blog/`, which the live build never finds: its
//!    content path resolves outside the CI checkout. Live serves the articles of `pages/blog/` at
//!    their slugs, rule 5, and so does the import);
//! 3. a village (`/{lang}/{village}/` → `{village}/overview.json`, else `village.json`, else no
//!    content);
//! 4. a village's sections (`/{lang}/{village}/{section}/` → `{village}/{section}.json`, else the
//!    section's hub page; a section with neither is a page with no content);
//! 5. every other page at its own slug in that language (`slug.de = /de/anreise`);
//!
//! and `/` (the theme's own home, which renders no JSON: the English home stands in for it).

use std::collections::BTreeMap;

use serde::Serialize;
use serde_json::Value;

use crate::{Site, LANGS};

/// The five villages, south to north, with their localized names.
pub const VILLAGES: [(&str, [&str; 4]); 5] = [
    ("riomaggiore", ["Riomaggiore"; 4]),
    ("manarola", ["Manarola"; 4]),
    ("corniglia", ["Corniglia"; 4]),
    ("vernazza", ["Vernazza"; 4]),
    (
        "monterosso",
        [
            "Monterosso",
            "Monterosso al Mare",
            "Monterosso",
            "Monterosso al Mare",
        ],
    ),
];

/// A village's sections: slug, the hub page it falls back to, the localized names (en, de, fr, it).
pub const SECTIONS: [(&str, &str, [&str; 4]); 16] = [
    (
        "overview",
        "village",
        ["Overview", "Überblick", "Aperçu", "Panoramica"],
    ),
    (
        "things-to-do",
        "things-to-do",
        ["Things to Do", "Aktivitäten", "À faire", "Cosa fare"],
    ),
    (
        "restaurants",
        "culinary",
        ["Restaurants", "Restaurants", "Restaurants", "Ristoranti"],
    ),
    (
        "hotels",
        "accommodations",
        ["Hotels", "Hotels", "Hôtels", "Hotel"],
    ),
    (
        "sights",
        "sights",
        ["Sights", "Sehenswürdigkeiten", "Sites", "Attrazioni"],
    ),
    (
        "hiking",
        "itinerary",
        ["Hiking", "Wandern", "Randonnée", "Escursioni"],
    ),
    (
        "beaches",
        "sights",
        ["Beaches", "Strände", "Plages", "Spiagge"],
    ),
    (
        "events",
        "events",
        ["Events", "Veranstaltungen", "Événements", "Eventi"],
    ),
    (
        "weather",
        "weather",
        ["Weather", "Wetter", "Météo", "Meteo"],
    ),
    (
        "getting-here",
        "transportation",
        [
            "Getting Here",
            "Anreise",
            "Comment y aller",
            "Come arrivare",
        ],
    ),
    (
        "apartments",
        "apartments",
        [
            "Apartments",
            "Ferienwohnungen",
            "Appartements",
            "Appartamenti",
        ],
    ),
    (
        "boat-tours",
        "boat-tours",
        [
            "Boat Tours",
            "Bootstouren",
            "Excursions en bateau",
            "Tour in barca",
        ],
    ),
    (
        "culinary",
        "culinary",
        ["Culinary", "Kulinarisches", "Gastronomie", "Gastronomia"],
    ),
    ("blog", "blog", ["Blog", "Blog", "Blog", "Blog"]),
    ("faq", "faq", ["FAQ", "FAQ", "FAQ", "FAQ"]),
    ("maps", "maps", ["Maps", "Karten", "Cartes", "Mappe"]),
];

/// The hub pages: URL segment → the page under `pages/` it renders.
pub const HUBS: [(&str, &str); 12] = [
    ("", "index.json"),
    ("accommodations", "accommodations.json"),
    ("culinary", "culinary.json"),
    ("events", "events.json"),
    ("itinerary", "itinerary.json"),
    ("sights", "sights.json"),
    ("team", "team.json"),
    ("things-to-do", "things-to-do.json"),
    ("transportation", "transportation.json"),
    ("village", "village.json"),
    ("weather", "weather.json"),
    ("blog", "blog-index.json"),
];

/// What a URL renders.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Source {
    /// A page under `pages/` (`vernazza/restaurants.json`).
    Page { path: String },
    /// A village or village section with no page of its own and no fallback: the theme renders
    /// its frame only.
    Empty { title: String },
}

/// One URL of the site.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Route {
    /// `/en/vernazza/restaurants/` (always a leading and a trailing slash; `/` for the home).
    pub path: String,
    pub lang: String,
    pub source: Source,
    /// The village a village route belongs to.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub village: Option<String>,
}

/// `/de/anreise` → `/de/anreise/`.
pub fn normalize(path: &str) -> String {
    let p = path.trim_matches('/');
    if p.is_empty() {
        "/".into()
    } else {
        format!("/{p}/")
    }
}

fn lang_index(lang: &str) -> usize {
    LANGS.iter().position(|l| *l == lang).unwrap_or(0)
}

/// Every URL of the site, sorted by path.
pub fn routes(site: &Site) -> Vec<Route> {
    let mut out: BTreeMap<String, Route> = BTreeMap::new();
    let mut add = |path: String, lang: &str, source: Source, village: Option<&str>| {
        out.entry(path.clone()).or_insert_with(|| Route {
            path,
            lang: lang.into(),
            source,
            village: village.map(String::from),
        });
    };
    let page = |p: &str| Source::Page { path: p.into() };
    for lang in LANGS {
        // 1. hubs
        for (seg, file) in HUBS {
            if site.pages.contains_key(file) {
                add(normalize(&format!("/{lang}/{seg}")), lang, page(file), None);
            }
        }
        // 3. villages
        for (v, names) in VILLAGES {
            let own = format!("{v}/overview.json");
            let src = if site.pages.contains_key(&own) {
                page(&own)
            } else if site.pages.contains_key("village.json") {
                page("village.json")
            } else {
                Source::Empty {
                    title: names[lang_index(lang)].into(),
                }
            };
            add(normalize(&format!("/{lang}/{v}")), lang, src, Some(v));
        }
        // 4. village sections
        for (v, names) in VILLAGES {
            for (section, hub, sn) in SECTIONS {
                let own = format!("{v}/{section}.json");
                let hub = format!("{hub}.json");
                let src = if site.pages.contains_key(&own) {
                    page(&own)
                } else if site.pages.contains_key(&hub) {
                    page(&hub)
                } else {
                    let i = lang_index(lang);
                    Source::Empty {
                        title: format!("{} · {}", sn[i], names[i]),
                    }
                };
                add(
                    normalize(&format!("/{lang}/{v}/{section}")),
                    lang,
                    src,
                    Some(v),
                );
            }
        }
        // 5. every page at its own slug; of two pages with the same slug, the later one in the
        //    theme's walk (sorted paths) is served.
        let mut by_slug: BTreeMap<String, String> = BTreeMap::new();
        for (path, v) in &site.pages {
            let Some(slug) = v
                .get("slug")
                .and_then(|s| s.get(lang))
                .and_then(Value::as_str)
            else {
                continue;
            };
            if slug.trim_matches('/').split('/').next() != Some(lang) {
                continue;
            }
            by_slug.insert(normalize(slug), path.clone());
        }
        for (url, path) in by_slug {
            add(url, lang, page(&path), None);
        }
    }
    if site.pages.contains_key("index.json") {
        add("/".into(), "en", page("index.json"), None);
    }
    out.into_values().collect()
}
