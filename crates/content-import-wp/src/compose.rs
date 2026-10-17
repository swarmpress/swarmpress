//! Pages the frozen theme drew from its own code, composed as content (the owner's decisions of
//! 2026-10-12 for the cutover gate, `docs/runbooks/cinqueterre-cutover.md`).
//!
//! The live home pages and the `/{lang}/village/` template render sections the frozen theme keeps
//! in its code (hero, carousels, trending, newsletter…), and the weather pages print a sample
//! forecast. None of that is content, so the import composes them from core blocks, the way the
//! Studio composes a page, and the owner reviews the result in the preview before the switch:
//!
//! - **the home** (`/`, `/{lang}/`): a hero (a `core/cover` with the site's name and description),
//!   the editors' picks (the stories the owner curated for the blog index, in the page's
//!   language: [`editors_picks`]), the five villages (each with its own hero image and line,
//!   linking its page), the places to stay (the accommodations collection's featured stays:
//!   [`places_to_stay`]), the latest stories as a `core/query` block (the newest posts in the
//!   page's language: every article carries its language as a tag, [`language_tag`]), and, only
//!   with [`Options::newsletter`], the newsletter form, which posts to WordPress's
//!   `admin-post.php` and which the export sends to the platform's `/f/{company}` (ADR-0083 §3).
//!   The owner hid the newsletter on 2026-10-13 until the central server has a public address, a
//!   privacy line and a double opt-in: without the option there is no form, no section, no
//!   header button and no footer link;
//! - **the village overview** (`/{lang}/village/`): the five villages with their sections;
//! - **the weather pages**: the sample forecast's fields are left out and a live forecast block
//!   ([`site_export::forecast`]) takes their place: the five villages on the general weather
//!   pages, the village itself on a village's weather page. The export fills it from Open-Meteo.
//!
//! A page's own blocks that have content are kept after a composition; the empty ones (the
//! theme's own sections) are what the composition replaces. Nothing is invented: the frozen
//! theme's sections without content behind them (trending, audio guides, its sample hotels) have
//! no composition, and each composed section shows only what the site's content holds.
//!
//! The ported theme's menus are composed here too ([`spine`], [`named_menus`]): the frozen theme
//! drew its header (the five villages along the coast, each with its sections) and its footer
//! from code.

use std::collections::BTreeMap;

use serde_json::{json, Value};
use site_export::forecast::{Marker, Place, MAX_DAYS};

use crate::markup;
use crate::plan::MenuItem;
use crate::routes::{normalize, Route, SECTIONS, VILLAGES};
use crate::{localized, Site, LANGS};

/// The villages' coordinates (latitude, longitude), for their forecasts.
pub const COORDINATES: [(&str, &str, &str); 5] = [
    ("riomaggiore", "44.0995", "9.7377"),
    ("manarola", "44.1069", "9.7286"),
    ("corniglia", "44.1196", "9.7105"),
    ("vernazza", "44.1350", "9.6847"),
    ("monterosso", "44.1462", "9.6545"),
];

/// How many stories the home lists.
pub const LATEST_STORIES: u32 = 6;

/// How many of the curated stories the home's editors' picks show (the lead and four more).
pub const PICKS: usize = 5;

/// How many featured stays the home shows.
pub const STAYS: usize = 6;

/// What the compositions include beyond the content.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Options {
    /// The newsletter: the home's form (`#subscribe`), the header's button and the footer's link.
    /// Off by default (the owner's decision of 2026-10-13); the migration turns it on only with
    /// `--forms-endpoint`, the platform's address that answers the form.
    pub newsletter: bool,
    /// The site's design runs on data (ADR-0093): the homes are the design's front-page template
    /// with its queries, so the import composes no home content of its own.
    pub design: bool,
}

/// The sample forecast fields of the frozen theme's weather blocks: never published as content.
const SAMPLE_WEATHER: [&str; 3] = ["currentWeather", "current", "forecast"];

/// The marker of a term the import creates, resolved to its id when the plan is applied
/// ([`resolve_terms`]): `"swarmpress-term:post_tag:Deutsch"`.
pub const TERM_REF: &str = "swarmpress-term:";

type Words = [&'static str; 4];

const LANGUAGE: Words = ["English", "Deutsch", "Français", "Italiano"];
const FIVE_VILLAGES: Words = [
    "The Five Villages",
    "Die fünf Dörfer",
    "Les cinq villages",
    "I cinque borghi",
];
const FIVE_VILLAGES_INTRO: Words = [
    "Riomaggiore, Manarola, Corniglia, Vernazza and Monterosso: five villages on the Ligurian coast, linked by train, boat and footpath.",
    "Riomaggiore, Manarola, Corniglia, Vernazza und Monterosso: fünf Dörfer an der ligurischen Küste, verbunden durch Bahn, Boot und Wanderweg.",
    "Riomaggiore, Manarola, Corniglia, Vernazza et Monterosso : cinq villages de la côte ligure, reliés par le train, le bateau et les sentiers.",
    "Riomaggiore, Manarola, Corniglia, Vernazza e Monterosso: cinque borghi della costa ligure, uniti dal treno, dal battello e dai sentieri.",
];
const EXPLORE: Words = [
    "Explore the villages",
    "Die Dörfer entdecken",
    "Découvrir les villages",
    "Scopri i borghi",
];
const TRAVEL_GUIDE: Words = [
    "Travel Guide",
    "Reiseführer",
    "Guide de voyage",
    "Guida di viaggio",
];
const PLAN_TRIP: Words = [
    "Plan your trip",
    "Reise planen",
    "Préparer le voyage",
    "Pianifica il viaggio",
];
const EDITORS_PICKS: Words = [
    "Editors' Picks",
    "Empfehlungen der Redaktion",
    "Le choix de la rédaction",
    "Scelti dalla redazione",
];
const DESTINATIONS: Words = ["Destinations", "Reiseziele", "Destinations", "Destinazioni"];
const WHERE_TO_SLEEP: Words = ["Where to Sleep", "Übernachten", "Où dormir", "Dove dormire"];
const PLACES_TO_STAY: Words = [
    "Places to Stay Spotlight",
    "Unterkünfte im Porträt",
    "Hébergements à la une",
    "Alloggi in primo piano",
];
const SEE_ALL_STAYS: Words = [
    "See all stays",
    "Alle Unterkünfte",
    "Tous les hébergements",
    "Tutti gli alloggi",
];
const PER_NIGHT: Words = ["per night", "pro Nacht", "par nuit", "a notte"];
const STORIES: Words = ["Stories", "Geschichten", "Récits", "Storie"];
const EXPLORE_COLUMN: Words = ["Explore", "Entdecken", "Explorer", "Esplora"];
const VILLAGES_COLUMN: Words = ["Villages", "Dörfer", "Villages", "Borghi"];
const GUIDES_COLUMN: Words = ["Guides", "Ratgeber", "Guides", "Guide"];
const ABOUT_COLUMN: Words = ["About", "Über uns", "À propos", "Chi siamo"];
const ITINERARIES: Words = ["Itineraries", "Reiserouten", "Itinéraires", "Itinerari"];
const FOOD_DRINK: Words = [
    "Food & Drink",
    "Essen & Trinken",
    "Gastronomie",
    "Cibo e vino",
];
const STAY: Words = ["Places to Stay", "Unterkünfte", "Hébergements", "Alloggi"];
const GETTING_AROUND: Words = [
    "Getting Around",
    "Unterwegs",
    "Se déplacer",
    "Come muoversi",
];
const TEAM: Words = ["Our Team", "Unser Team", "Notre équipe", "Il nostro team"];
const LATEST: Words = [
    "Latest Stories",
    "Neueste Geschichten",
    "Derniers récits",
    "Ultime storie",
];
const ALL_STORIES: Words = [
    "All stories",
    "Alle Geschichten",
    "Tous les récits",
    "Tutte le storie",
];
const NEWSLETTER: Words = [
    "The Dispatch, in your inbox",
    "Der Dispatch per E-Mail",
    "Le Dispatch par e-mail",
    "Il Dispatch via e-mail",
];
const NEWSLETTER_TEXT: Words = [
    "New stories and seasonal advice from the five villages. You can unsubscribe at any time.",
    "Neue Geschichten und Tipps zur Saison aus den fünf Dörfern. Abmelden können Sie sich jederzeit.",
    "De nouveaux récits et des conseils de saison depuis les cinq villages. Désinscription à tout moment.",
    "Nuove storie e consigli di stagione dai cinque borghi. Puoi annullare l'iscrizione in qualsiasi momento.",
];
const EMAIL: Words = [
    "Email address",
    "E-Mail-Adresse",
    "Adresse e-mail",
    "Indirizzo e-mail",
];
const SUBSCRIBE: Words = ["Subscribe", "Abonnieren", "S'abonner", "Iscriviti"];
const WEEK_AHEAD: Words = [
    "The Week Ahead",
    "Die kommende Woche",
    "La semaine à venir",
    "La settimana che viene",
];
const PENDING: Words = [
    "The forecast is added when the site is published.",
    "Die Vorhersage wird beim Veröffentlichen eingesetzt.",
    "Les prévisions sont ajoutées à la publication du site.",
    "Le previsioni vengono aggiunte alla pubblicazione del sito.",
];

fn li(lang: &str) -> usize {
    LANGS.iter().position(|l| *l == lang).unwrap_or(0)
}

/// The tag every article in `lang` carries, so a page can list the stories in its language.
pub fn language_tag(lang: &str) -> &'static str {
    LANGUAGE[li(lang)]
}

/// The reference to a term by name that [`resolve_terms`] replaces with its id.
pub fn term_ref(taxonomy: &str, name: &str) -> String {
    format!("{TERM_REF}{taxonomy}:{name}")
}

/// The term references in `content` (`(taxonomy, name)`), so the import can create the terms.
pub fn term_refs(content: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    for part in content.split(&format!("\"{TERM_REF}")).skip(1) {
        let Some(end) = part.find('"') else { continue };
        if let Some((tax, name)) = part[..end].split_once(':') {
            out.push((tax.to_string(), unescape_json(name)));
        }
    }
    out
}

/// `content` with every term reference (a JSON string) replaced by the term's id from `ids`
/// (by taxonomy, then name). A reference to a term `ids` lacks is an error.
pub fn resolve_terms(
    content: &str,
    ids: &BTreeMap<String, BTreeMap<String, u64>>,
) -> Result<String, String> {
    let mut out = String::with_capacity(content.len());
    let mut rest = content;
    let open = format!("\"{TERM_REF}");
    while let Some(i) = rest.find(&open) {
        out.push_str(&rest[..i]);
        let after = &rest[i + open.len()..];
        let end = after
            .find('"')
            .ok_or_else(|| "an unterminated term reference".to_string())?;
        let (tax, name) = after[..end]
            .split_once(':')
            .ok_or_else(|| format!("a term reference without a taxonomy: {}", &after[..end]))?;
        let name = unescape_json(name);
        let id = ids
            .get(tax)
            .and_then(|m| m.get(&name))
            .ok_or_else(|| format!("no {tax} term named {name}"))?;
        out.push_str(&id.to_string());
        rest = &after[end + 1..];
    }
    out.push_str(rest);
    Ok(out)
}

fn unescape_json(s: &str) -> String {
    serde_json::from_str::<String>(&format!("\"{s}\"")).unwrap_or_else(|_| s.to_string())
}

/// Whether the route is a home page (`/`, `/{lang}/`).
pub fn is_home(r: &Route) -> bool {
    r.path == "/" || LANGS.iter().any(|l| r.path == format!("/{l}/"))
}

/// Whether the route is the village overview (`/{lang}/village/`).
pub fn is_village_overview(r: &Route) -> bool {
    LANGS.iter().any(|l| r.path == format!("/{l}/village/"))
}

/// The village's forecast place, its name in `lang`.
pub fn place(village: &str, lang: &str) -> Option<Place> {
    let (_, lat, lng) = COORDINATES.iter().find(|(v, _, _)| *v == village)?;
    let name = VILLAGES
        .iter()
        .find(|(v, _)| *v == village)
        .map(|(_, n)| n[li(lang)])
        .unwrap_or(village);
    Some(Place::new(name, lat, lng))
}

/// A live forecast block for `places` in `lang`: a heading and the export's marker in a
/// `core/html` block.
pub fn forecast(places: Vec<Place>, lang: &str) -> String {
    let m = Marker {
        lang: lang.into(),
        days: MAX_DAYS,
        places,
    };
    let inner = format!(
        "{}<!-- wp:html -->\n{}\n<!-- /wp:html -->\n",
        markup::heading(&markup::escape(WEEK_AHEAD[li(lang)]), 2),
        m.html(PENDING[li(lang)])
    );
    markup::group("ct-forecast", &inner)
}

/// The design's essentials ticker for a weather page (ADR-0093 addendum): a marker the export
/// fills with the place's sea, air and sunset (`site_export::essentials`); the village's own on a
/// village's page, every village's on the general ones.
pub fn essentials(r: &Route) -> String {
    let lang = r.lang.as_str();
    let villages: Vec<&str> = match &r.village {
        Some(v) => vec![v.as_str()],
        None => VILLAGES.iter().map(|(v, _)| *v).collect(),
    };
    let mut inner = String::new();
    for v in villages {
        let Some(p) = place(v, lang) else { continue };
        inner.push_str(&format!(
            "<!-- wp:html -->\n<div class=\"{}\" data-place=\"{}|{}|{}\" data-lang=\"{lang}\"><p class=\"sp-forecast-pending\">{}</p></div>\n<!-- /wp:html -->\n",
            site_export::essentials::CLASS,
            markup::escape(&p.name),
            p.lat,
            p.lng,
            PENDING[li(lang)]
        ));
    }
    markup::group("ct-essentials", &inner)
}

/// The weather page's blocks without the sample forecast, and the forecast block to insert after
/// block `n` (`None`: the route is no weather page).
pub fn weather(blocks: &mut [Value], r: &Route) -> Option<(usize, String)> {
    let lang = r.lang.as_str();
    let live_at = blocks
        .iter()
        .position(|b| b.get("type").and_then(Value::as_str) == Some("weather-live"));
    for b in blocks.iter_mut() {
        if b.get("type").and_then(Value::as_str) == Some("weather-live") {
            if let Some(o) = b.as_object_mut() {
                for k in SAMPLE_WEATHER {
                    o.remove(k);
                }
            }
        }
    }
    let village_weather = r
        .village
        .as_ref()
        .filter(|v| r.path.ends_with(&format!("/{v}/weather/")));
    let places = match village_weather {
        Some(v) => vec![place(v, lang)?],
        None if live_at.is_some() => VILLAGES
            .iter()
            .filter_map(|(v, _)| place(v, lang))
            .collect(),
        None => return None,
    };
    let after = live_at.unwrap_or(0).min(blocks.len().saturating_sub(1));
    Some((after, forecast(places, lang)))
}

/// A village's card: its hero image, its name linking its page, its line.
fn village_card(site: &Site, village: &str, name: &str, lang: &str, sections: bool) -> String {
    let cfg = site.villages.get(village);
    let hero = cfg.and_then(|c| c.get("hero"));
    let mut inner = String::new();
    if let Some(src) = hero.and_then(|h| h.get("image")).and_then(Value::as_str) {
        let alt = hero
            .and_then(|h| h.get("imageAlt"))
            .and_then(|a| localized(a, lang))
            .unwrap_or(name);
        inner.push_str(&card_image(src, alt));
    }
    inner.push_str(&markup::heading(
        &format!(
            "<a href=\"/{lang}/{village}/\">{}</a>",
            markup::escape(name)
        ),
        // Under the page's own title (the overview) the cards are its sections; on the home
        // they stand under the section's h2.
        if sections { 2 } else { 3 },
    ));
    if let Some(line) = hero
        .and_then(|h| h.get("subtitle"))
        .and_then(|s| localized(s, lang))
    {
        inner.push_str(&markup::paragraph_html(
            &markup::inline(line),
            Some("ct-village-line"),
        ));
    }
    if sections {
        let i = li(lang);
        let links: Vec<String> = [
            "things-to-do",
            "restaurants",
            "hotels",
            "hiking",
            "getting-here",
            "weather",
        ]
        .iter()
        .filter_map(|s| SECTIONS.iter().find(|(slug, _, _)| slug == s))
        .map(|(slug, _, names)| {
            format!(
                "<a href=\"/{lang}/{village}/{slug}/\">{}</a>",
                markup::escape(names[i])
            )
        })
        .collect();
        inner.push_str(&markup::paragraph_html(
            &links.join(" · "),
            Some("ct-village-sections"),
        ));
    }
    markup::group(&format!("ct-village-card ct-village-{village}"), &inner)
}

/// A section's head: a small eyebrow line, its heading, and a link to everything on the right.
fn section_head(eyebrow: Option<&str>, title: &str, more: Option<(&str, String)>) -> String {
    let mut inner = String::new();
    if let Some(e) = eyebrow {
        inner.push_str(&markup::paragraph_html(
            &markup::escape(e),
            Some("ct-eyebrow"),
        ));
    }
    inner.push_str(&markup::heading(&markup::escape(title), 2));
    let mut head = markup::group("ct-section-title", &inner);
    if let Some((label, href)) = more {
        head.push_str(&markup::paragraph_html(
            &format!("<a href=\"{href}\">{} →</a>", markup::escape(label)),
            Some("ct-more"),
        ));
    }
    format!(
        "<!-- wp:group {} -->\n<div class=\"wp-block-group ct-section-head\">{head}</div>\n<!-- /wp:group -->\n",
        json!({"className": "ct-section-head", "layout": {"type": "flex", "flexWrap": "wrap", "justifyContent": "space-between", "verticalAlignment": "bottom"}})
    )
}

fn villages_section(site: &Site, lang: &str, sections: bool) -> String {
    let i = li(lang);
    let cards: String = VILLAGES
        .iter()
        .map(|(v, names)| village_card(site, v, names[i], lang, sections))
        .collect();
    // The cards in a grid by WordPress's own layout support (no theme style needed).
    let grid = format!(
        "<!-- wp:group {} -->\n<div class=\"wp-block-group ct-village-cards\">{cards}</div>\n<!-- /wp:group -->\n",
        json!({"className": "ct-village-cards", "layout": {"type": "grid", "minimumColumnWidth": "16rem"}})
    );
    let head = if sections {
        // The overview's own title is the heading.
        String::new()
    } else {
        // On the home, as the frozen theme had it: an eyebrow, the heading, a line.
        format!(
            "{}{}",
            section_head(Some(DESTINATIONS[i]), FIVE_VILLAGES[i], None),
            markup::paragraph_html(&markup::escape(FIVE_VILLAGES_INTRO[i]), Some("ct-lede"))
        )
    };
    // On the home the cards are image tiles (`ct-villages-home`), elsewhere cards with sections.
    let class = if sections {
        "ct-villages"
    } else {
        "ct-villages ct-villages-home"
    };
    format!(
        "<!-- wp:group {} -->\n<div id=\"villages\" class=\"wp-block-group {class}\">{head}{grid}</div>\n<!-- /wp:group -->\n",
        json!({"anchor": "villages", "className": class, "layout": {"type": "constrained", "contentSize": "1200px"}}),
    )
}

/// A card's image, cropped to 3:2 by the image block's own attributes.
fn card_image(src: &str, alt: &str) -> String {
    format!(
        "<!-- wp:image {} -->\n<figure class=\"wp-block-image\"><img src=\"{}\" alt=\"{}\" style=\"aspect-ratio:3/2;object-fit:cover\"/></figure>\n<!-- /wp:image -->\n",
        json!({"aspectRatio": "3/2", "scale": "cover"}),
        markup::escape(src).replace('"', "&quot;"),
        markup::escape(alt).replace('"', "&quot;")
    )
}

/// A story the owner curated for the blog index, in `lang` (its article's own title, line,
/// author, category and image in that language, else the index's).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Pick {
    pub href: String,
    pub title: String,
    pub line: String,
    pub author: String,
    pub category: String,
    pub image: String,
}

/// The editors' picks in `lang`: the stories of the blog index (`pages/blog-index.json`), its
/// lead first, each linking its article; only stories whose article the site has.
pub fn editors_picks(site: &Site, lang: &str) -> Vec<Pick> {
    let stories = site
        .pages
        .get("blog-index.json")
        .and_then(|p| p.get("body"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|b| b.get("type").and_then(Value::as_str) == Some("blog-index"))
        .filter_map(|b| b.get("stories").and_then(Value::as_array))
        .flatten()
        .cloned()
        .collect::<Vec<_>>();
    let lead = |s: &Value| {
        matches!(s.get("isLead"), Some(Value::Bool(true)))
            || s.get("isLead").and_then(Value::as_str) == Some("true")
    };
    let mut ordered: Vec<&Value> = stories.iter().filter(|s| lead(s)).collect();
    ordered.extend(stories.iter().filter(|s| !lead(s)));
    let text = |v: Option<&Value>| {
        v.and_then(|t| localized(t, lang))
            .map(|t| {
                markup::strip_tags(t)
                    .split(" | ")
                    .next()
                    .unwrap_or("")
                    .to_string()
            })
            .filter(|t| !t.is_empty())
    };
    let mut out = Vec::new();
    for s in ordered {
        let Some(slug) = s.get("slug").and_then(Value::as_str) else {
            continue;
        };
        let Some(page) = site.pages.get(&format!("blog/{slug}.json")) else {
            continue;
        };
        let post = page
            .get("body")
            .and_then(Value::as_array)
            .and_then(|b| {
                b.iter()
                    .find(|x| x.get("type").and_then(Value::as_str) == Some("blog-article"))
            })
            .and_then(|b| b.get("post"));
        let href = page
            .get("slug")
            .and_then(|v| localized(v, lang))
            .filter(|p| p.starts_with(&format!("/{lang}/")))
            .map(normalize)
            .unwrap_or_else(|| format!("/{lang}/blog/{slug}/"));
        let image = post
            .and_then(|p| p.get("image"))
            .or(s.get("image"))
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let Some(title) = text(post.and_then(|p| p.get("title")))
            .or_else(|| text(page.get("title")))
            .or_else(|| text(s.get("title")))
        else {
            continue;
        };
        out.push(Pick {
            href,
            title,
            // The index's own excerpt is English: no line rather than one in another language.
            line: text(post.and_then(|p| p.get("subtitle")))
                .or_else(|| (lang == "en").then(|| text(s.get("excerpt"))).flatten())
                .unwrap_or_default(),
            author: text(post.and_then(|p| p.get("author")))
                .or_else(|| text(s.get("author")))
                .unwrap_or_default(),
            category: text(post.and_then(|p| p.get("category")))
                .or_else(|| text(s.get("category")))
                .unwrap_or_default(),
            image,
        });
        if out.len() == PICKS {
            break;
        }
    }
    out
}

fn pick_card(p: &Pick, class: &str) -> String {
    let mut inner = String::new();
    if !p.image.is_empty() {
        inner.push_str(&card_image(&p.image, &p.title));
    }
    if !p.category.is_empty() {
        inner.push_str(&markup::paragraph_html(
            &markup::escape(&p.category),
            Some("ct-category"),
        ));
    }
    inner.push_str(&markup::heading(
        &format!(
            "<a href=\"{}\">{}</a>",
            markup::escape(&p.href).replace('"', "&quot;"),
            markup::escape(&p.title)
        ),
        3,
    ));
    if !p.line.is_empty() && class == "ct-pick-lead" {
        inner.push_str(&markup::paragraph_html(
            &markup::escape(&p.line),
            Some("ct-line"),
        ));
    }
    if !p.author.is_empty() {
        inner.push_str(&markup::paragraph_html(
            &markup::escape(&p.author),
            Some("ct-author"),
        ));
    }
    markup::group(&format!("ct-pick {class}"), &inner)
}

/// The editors' picks: the lead story large, the next ones beside it.
fn picks_section(site: &Site, lang: &str) -> String {
    let picks = editors_picks(site, lang);
    let Some((lead, rest)) = picks.split_first() else {
        return String::new();
    };
    let i = li(lang);
    let side: String = rest.iter().map(|p| pick_card(p, "ct-pick-small")).collect();
    let inner = format!(
        "{}{}{}",
        section_head(
            None,
            EDITORS_PICKS[i],
            Some((ALL_STORIES[i], format!("/{lang}/blog/")))
        ),
        pick_card(lead, "ct-pick-lead"),
        markup::group("ct-picks-side", &side)
    );
    markup::group("ct-picks", &inner)
}

/// A featured stay of the accommodations collection, in `lang`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Stay {
    pub name: String,
    pub village: String,
    pub teaser: String,
    pub price: Option<(u64, u64)>,
    pub stars: u64,
    pub rating: Option<String>,
}

/// The collection's featured, published stays: the best ranked of each village first (in the
/// villages' order along the coast), then the next best, [`STAYS`] at most.
pub fn places_to_stay(site: &Site, lang: &str) -> Vec<Stay> {
    let mut all: Vec<(u64, usize, &Value)> = Vec::new();
    for file in site.collections.get("accommodations").into_iter().flatten() {
        for item in file
            .get("items")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            let village = item
                .get("village")
                .or(file.get("village"))
                .and_then(Value::as_str)
                .unwrap_or("");
            let Some(at) = VILLAGES.iter().position(|(v, _)| *v == village) else {
                continue;
            };
            if item.get("featured") != Some(&Value::Bool(true))
                || item.get("published") == Some(&Value::Bool(false))
            {
                continue;
            }
            let rank = item.get("rank").and_then(Value::as_u64).unwrap_or(u64::MAX);
            all.push((rank, at, item));
        }
    }
    all.sort_by_key(|(rank, at, _)| (*rank, *at));
    let mut chosen: Vec<&(u64, usize, &Value)> = Vec::new();
    for (_, at) in VILLAGES.iter().enumerate().map(|(i, v)| (v, i)) {
        if let Some(best) = all.iter().find(|(_, a, _)| *a == at) {
            chosen.push(best);
        }
    }
    for s in &all {
        if chosen.len() >= STAYS {
            break;
        }
        if !chosen.iter().any(|c| std::ptr::eq(*c, s)) {
            chosen.push(s);
        }
    }
    chosen.truncate(STAYS);
    chosen
        .into_iter()
        .filter_map(|(_, at, item)| {
            let name = item
                .get("name")
                .and_then(|n| localized(n, lang))?
                .to_string();
            let price = item
                .get("price_range")
                .and_then(|p| Some((p.get("min")?.as_u64()?, p.get("max")?.as_u64()?)));
            let rating = item
                .get("ratings")
                .and_then(|r| r.get("average"))
                .and_then(Value::as_f64)
                // Booking-style scores are out of ten, review sites' out of five.
                .map(|a| format!("{a:.1}/{}", if a > 5.0 { 10 } else { 5 }));
            Some(Stay {
                name,
                village: VILLAGES[*at].0.to_string(),
                teaser: item
                    .get("details")
                    .and_then(|d| d.get("teaser"))
                    .and_then(|t| localized(t, lang))
                    .unwrap_or("")
                    .to_string(),
                price,
                stars: item.get("stars").and_then(Value::as_u64).unwrap_or(0),
                rating,
            })
        })
        .collect()
}

fn stays_section(site: &Site, lang: &str) -> String {
    let stays = places_to_stay(site, lang);
    if stays.is_empty() {
        return String::new();
    }
    let i = li(lang);
    let cards: String = stays
        .iter()
        .map(|s| {
            let vname = VILLAGES
                .iter()
                .find(|(v, _)| *v == s.village)
                .map(|(_, n)| n[i])
                .unwrap_or(&s.village);
            let mut inner = markup::paragraph_html(&markup::escape(vname), Some("ct-village"));
            if let Some((min, max)) = s.price {
                inner.push_str(&markup::paragraph_html(
                    &format!("€{min}–{max} {}", markup::escape(PER_NIGHT[i])),
                    Some("ct-price"),
                ));
            }
            inner.push_str(&markup::heading(
                &format!(
                    "<a href=\"/{lang}/{}/hotels/\">{}</a>",
                    s.village,
                    markup::escape(&s.name)
                ),
                3,
            ));
            if !s.teaser.is_empty() {
                inner.push_str(&markup::paragraph_html(
                    &markup::escape(&s.teaser),
                    Some("ct-line"),
                ));
            }
            let mut facts = Vec::new();
            if s.stars > 0 {
                facts.push("★".repeat(s.stars.min(5) as usize));
            }
            if let Some(r) = &s.rating {
                facts.push(r.clone());
            }
            if !facts.is_empty() {
                inner.push_str(&markup::paragraph_html(
                    &facts.join(" · "),
                    Some("ct-rating"),
                ));
            }
            markup::group(&format!("ct-stay ct-village-{}", s.village), &inner)
        })
        .collect();
    let grid = format!(
        "<!-- wp:group {} -->\n<div class=\"wp-block-group ct-stay-cards\">{cards}</div>\n<!-- /wp:group -->\n",
        json!({"className": "ct-stay-cards", "layout": {"type": "grid", "minimumColumnWidth": "18rem"}})
    );
    markup::group(
        "ct-stays",
        &format!(
            "{}{grid}",
            section_head(
                Some(WHERE_TO_SLEEP[i]),
                PLACES_TO_STAY[i],
                Some((SEE_ALL_STAYS[i], format!("/{lang}/accommodations/")))
            )
        ),
    )
}

/// The newest posts in `lang`, as a query block.
fn latest_stories(lang: &str) -> String {
    let i = li(lang);
    let query = json!({
        "queryId": 1,
        "query": {
            "perPage": LATEST_STORIES,
            "pages": 0,
            "offset": 0,
            "postType": "post",
            "order": "desc",
            "orderBy": "date",
            "inherit": false,
            "taxQuery": {"include": {"post_tag": [term_ref("post_tag", language_tag(lang))]}}
        },
        "className": "ct-latest-stories"
    });
    let template = json!({"layout": {"type": "grid", "columnCount": 3}});
    let inner = format!(
        "{}<!-- wp:query {query} -->\n<div class=\"wp-block-query ct-latest-stories\"><!-- wp:post-template {template} -->\n<!-- wp:post-terms {} /-->\n<!-- wp:post-title {} /-->\n<!-- wp:post-excerpt {} /-->\n<!-- wp:post-date {} /-->\n<!-- /wp:post-template --></div>\n<!-- /wp:query -->\n",
        section_head(None, LATEST[i], Some((ALL_STORIES[i], format!("/{lang}/blog/")))),
        json!({"term": "category", "className": "ct-category"}),
        json!({"isLink": true, "level": 3}),
        json!({"excerptLength": 24}),
        json!({"className": "ct-date"}),
    );
    markup::group("ct-home-stories", &inner)
}

/// The newsletter form: WordPress's `admin-post.php` in the content, the platform's `/f/` in the
/// export.
fn newsletter(lang: &str) -> String {
    let i = li(lang);
    let form = format!(
        "<form class=\"sp-newsletter\" action=\"/wp-admin/admin-post.php\" method=\"post\"><input type=\"hidden\" name=\"action\" value=\"swarmpress_newsletter\"><input type=\"hidden\" name=\"lang\" value=\"{lang}\"><label for=\"sp-newsletter-email\">{}</label> <input id=\"sp-newsletter-email\" type=\"email\" name=\"email\" required autocomplete=\"email\"> <button type=\"submit\">{}</button></form>",
        markup::escape(EMAIL[i]),
        markup::escape(SUBSCRIBE[i])
    );
    let inner = format!(
        "{}{}<!-- wp:html -->\n{form}\n<!-- /wp:html -->\n",
        markup::heading(&markup::escape(NEWSLETTER[i]), 2),
        markup::paragraph_html(&markup::escape(NEWSLETTER_TEXT[i]), None)
    );
    format!(
        "<!-- wp:group {} -->\n<div id=\"subscribe\" class=\"wp-block-group ct-newsletter\">{inner}</div>\n<!-- /wp:group -->\n",
        json!({"anchor": "subscribe", "className": "ct-newsletter", "layout": {"type": "constrained"}})
    )
}

/// The home's hero: a full-width `core/cover` with the lead village's image, an eyebrow, the
/// site's name, its line and two buttons (the villages, the itinerary).
fn hero(site: &Site, lang: &str, name: &str, description: &str) -> String {
    let i = li(lang);
    let lead = site
        .villages
        .get("vernazza")
        .or_else(|| site.villages.values().next());
    let src = lead
        .and_then(|v| v.get("hero"))
        .and_then(|h| h.get("image"))
        .and_then(Value::as_str);
    let alt = lead
        .and_then(|v| v.get("hero"))
        .and_then(|h| h.get("imageAlt"))
        .and_then(|a| localized(a, lang))
        .unwrap_or(name);
    let mut inner = markup::paragraph_html(&markup::escape(TRAVEL_GUIDE[i]), Some("ct-badge"));
    inner.push_str(&markup::heading(&markup::escape(name), 1));
    if !description.is_empty() {
        inner.push_str(&markup::paragraph_html(
            &markup::inline(description),
            Some("ct-lede"),
        ));
    }
    inner.push_str(&markup::buttons(&[
        (EXPLORE[i].to_string(), format!("/{lang}/village/")),
        (PLAN_TRIP[i].to_string(), format!("/{lang}/itinerary/")),
    ]));
    let attr = |s: &str| markup::escape(s).replace('"', "&quot;");
    let Some(src) = src else {
        return markup::group("ct-home-hero", &inner);
    };
    format!(
        "<!-- wp:cover {} -->\n<div class=\"wp-block-cover alignfull ct-home-hero\" style=\"min-height:85vh\"><img class=\"wp-block-cover__image-background\" alt=\"{}\" src=\"{}\" data-object-fit=\"cover\"/><span aria-hidden=\"true\" class=\"wp-block-cover__background has-background-dim-40 has-background-dim\" style=\"background-color:#000000\"></span><div class=\"wp-block-cover__inner-container\">{inner}</div></div>\n<!-- /wp:cover -->\n",
        json!({"url": src, "alt": alt, "dimRatio": 40, "customOverlayColor": "#000000", "isUserOverlayColor": true, "minHeight": 85, "minHeightUnit": "vh", "align": "full", "className": "ct-home-hero", "layout": {"type": "constrained"}}),
        attr(alt),
        attr(src),
    )
}

/// The home in `lang`: `name` is the site's name, `description` its line.
pub fn home(site: &Site, lang: &str, name: &str, description: &str, opts: Options) -> String {
    let mut out = hero(site, lang, name, description);
    out.push_str(&picks_section(site, lang));
    out.push_str(&villages_section(site, lang, false));
    out.push_str(&stays_section(site, lang));
    out.push_str(&latest_stories(lang));
    if opts.newsletter {
        out.push_str(&newsletter(lang));
    }
    out
}

/// The village overview in `lang`: the five villages with their sections.
pub fn village_overview(site: &Site, lang: &str) -> String {
    let i = li(lang);
    let mut out = markup::group(
        "ct-villages-intro",
        &markup::paragraph_html(&markup::escape(FIVE_VILLAGES_INTRO[i]), None),
    );
    out.push_str(&villages_section(site, lang, true));
    out
}

/// The ported theme's main menu in `lang`, the frozen theme's "coastal spine": the five villages
/// along the coast, each with the sections its header listed (the first is the village itself).
pub fn spine(lang: &str) -> Vec<MenuItem> {
    let i = li(lang);
    VILLAGES
        .iter()
        .map(|(v, names)| MenuItem {
            label: names[i].into(),
            url: format!("/{lang}/{v}/"),
            children: SECTIONS
                .iter()
                .take(10)
                .map(|(s, _, sn)| MenuItem {
                    label: sn[i].into(),
                    url: if *s == "overview" {
                        format!("/{lang}/{v}/")
                    } else {
                        format!("/{lang}/{v}/{s}/")
                    },
                    children: vec![],
                })
                .collect(),
        })
        .collect()
}

fn item(label: &str, url: String) -> MenuItem {
    MenuItem {
        label: label.into(),
        url,
        children: vec![],
    }
}

fn section_name(slug: &str, i: usize) -> &'static str {
    SECTIONS
        .iter()
        .find(|(s, _, _)| *s == slug)
        .map(|(_, _, n)| n[i])
        .unwrap_or("")
}

/// The ported theme's named menus by name, then language: `brand` (the wordmark, to the home in
/// the page's language), `cta` (the header's subscribe button, only with the newsletter: without
/// a `cta` menu the theme's header shows no button) and `footer` (its four columns: the frozen
/// theme's footer, with the pages the site has instead of its placeholder links; its newsletter
/// link only with the newsletter).
pub fn named_menus(opts: Options) -> BTreeMap<String, BTreeMap<String, Vec<MenuItem>>> {
    let mut brand = BTreeMap::new();
    let mut cta = BTreeMap::new();
    let mut footer = BTreeMap::new();
    for lang in LANGS {
        let i = li(lang);
        let l = |p: &str| format!("/{lang}/{p}");
        brand.insert(lang.to_string(), vec![item("Cinque Terre", l(""))]);
        if opts.newsletter {
            cta.insert(lang.to_string(), vec![item(SUBSCRIBE[i], l("#subscribe"))]);
        }
        let column = |label: &str, children: Vec<MenuItem>| MenuItem {
            label: label.into(),
            url: String::new(),
            children,
        };
        // The villages from Monterosso down the coast, as the frozen theme's footer listed them.
        let villages = VILLAGES
            .iter()
            .rev()
            .map(|(v, n)| item(n[i], l(&format!("{v}/"))))
            .collect();
        footer.insert(
            lang.to_string(),
            vec![
                column(
                    EXPLORE_COLUMN[i],
                    vec![
                        item("Cinque Terre", l("cinque-terre/")),
                        item(ITINERARIES[i], l("itinerary/")),
                        item(section_name("things-to-do", i), l("things-to-do/")),
                        item(section_name("sights", i), l("sights/")),
                        item(STORIES[i], l("blog/")),
                    ],
                ),
                column(VILLAGES_COLUMN[i], villages),
                column(
                    GUIDES_COLUMN[i],
                    vec![
                        item(FOOD_DRINK[i], l("culinary/")),
                        item(STAY[i], l("accommodations/")),
                        item(GETTING_AROUND[i], l("transportation/")),
                        item(section_name("weather", i), l("weather/")),
                        item(section_name("events", i), l("events/")),
                    ],
                ),
                column(ABOUT_COLUMN[i], {
                    let mut about = vec![
                        item(TEAM[i], l("team/")),
                        item("FAQ", l("cinque-terre/faq/")),
                    ];
                    if opts.newsletter {
                        about.push(item(SUBSCRIBE[i], l("#subscribe")));
                    }
                    about
                }),
            ],
        );
    }
    let mut menus = BTreeMap::from([("brand".to_string(), brand), ("footer".to_string(), footer)]);
    if !cta.is_empty() {
        menus.insert("cta".to_string(), cta);
    }
    menus
}

/// The village overview's title and description in `lang`.
pub fn village_overview_title(lang: &str) -> (&'static str, &'static str) {
    (FIVE_VILLAGES[li(lang)], FIVE_VILLAGES_INTRO[li(lang)])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn term_references_resolve_to_ids_or_fail() {
        let c = format!(
            "<!-- wp:query {} -->",
            json!({"query": {"taxQuery": {"include": {"post_tag": [term_ref("post_tag", "Français")]}}}})
        );
        assert_eq!(
            term_refs(&c),
            vec![("post_tag".to_string(), "Français".to_string())]
        );
        let ids = BTreeMap::from([(
            "post_tag".to_string(),
            BTreeMap::from([("Français".to_string(), 42u64)]),
        )]);
        let r = resolve_terms(&c, &ids).unwrap();
        assert!(r.contains("\"post_tag\":[42]"), "{r}");
        assert!(resolve_terms(&c, &BTreeMap::new())
            .unwrap_err()
            .contains("Français"));
        assert_eq!(resolve_terms("plain", &BTreeMap::new()).unwrap(), "plain");
    }

    #[test]
    fn every_village_has_a_place() {
        for (v, _) in VILLAGES {
            assert!(place(v, "de").is_some(), "{v}");
        }
        assert_eq!(
            place("monterosso", "de").unwrap().name,
            "Monterosso al Mare"
        );
        assert_eq!(place("atlantis", "en"), None);
    }
}
