//! Pages the frozen theme drew from its own code, composed as content (the owner's decisions of
//! 2026-10-12 for the cutover gate, `docs/runbooks/cinqueterre-cutover.md`).
//!
//! The live home pages and the `/{lang}/village/` template render sections the frozen theme keeps
//! in its code (hero, carousels, trending, newsletter…), and the weather pages print a sample
//! forecast. None of that is content, so the import composes them from core blocks, the way the
//! Studio composes a page, and the owner reviews the result in the preview before the switch:
//!
//! - **the home** (`/`, `/{lang}/`): a hero (the site's name and description), the five villages
//!   (each with its own hero image and line, linking its page), the latest stories as a
//!   `core/query` block (the newest posts in the page's language: every article carries its
//!   language as a tag, [`language_tag`]), and the newsletter form, which posts to WordPress's
//!   `admin-post.php` and which the export sends to the platform's `/f/{company}` (ADR-0083 §3);
//! - **the village overview** (`/{lang}/village/`): the five villages with their sections;
//! - **the weather pages**: the sample forecast's fields are left out and a live forecast block
//!   ([`site_export::forecast`]) takes their place: the five villages on the general weather
//!   pages, the village itself on a village's weather page. The export fills it from Open-Meteo.
//!
//! A page's own blocks that have content are kept after a composition; the empty ones (the
//! theme's own sections) are what the composition replaces.

use std::collections::BTreeMap;

use serde_json::{json, Value};
use site_export::forecast::{Marker, Place, MAX_DAYS};

use crate::markup;
use crate::routes::{Route, SECTIONS, VILLAGES};
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
        3,
    ));
    if let Some(line) = hero
        .and_then(|h| h.get("subtitle"))
        .and_then(|s| localized(s, lang))
    {
        inner.push_str(&markup::paragraph_html(&markup::inline(line), None));
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
    markup::group("ct-village-card", &inner)
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
    format!(
        "<!-- wp:group {} -->\n<div id=\"villages\" class=\"wp-block-group ct-villages\">{}{grid}</div>\n<!-- /wp:group -->\n",
        json!({"anchor": "villages", "className": "ct-villages", "layout": {"type": "constrained", "contentSize": "1200px"}}),
        markup::heading(&markup::escape(FIVE_VILLAGES[i]), 2),
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
        "{}<!-- wp:query {query} -->\n<div class=\"wp-block-query ct-latest-stories\"><!-- wp:post-template {template} -->\n<!-- wp:post-title {} /-->\n<!-- wp:post-date /-->\n<!-- wp:post-excerpt /-->\n<!-- /wp:post-template --></div>\n<!-- /wp:query -->\n{}",
        markup::heading(&markup::escape(LATEST[i]), 2),
        json!({"isLink": true, "level": 3}),
        markup::paragraph_html(
            &format!("<a href=\"/{lang}/blog/\">{}</a>", markup::escape(ALL_STORIES[i])),
            None
        )
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

/// The home in `lang`: `name` is the site's name, `description` its line.
pub fn home(site: &Site, lang: &str, name: &str, description: &str) -> String {
    let i = li(lang);
    let mut hero = String::new();
    let lead = site
        .villages
        .get("vernazza")
        .or_else(|| site.villages.values().next());
    if let Some(src) = lead
        .and_then(|v| v.get("hero"))
        .and_then(|h| h.get("image"))
        .and_then(Value::as_str)
    {
        let alt = lead
            .and_then(|v| v["hero"].get("imageAlt"))
            .and_then(|a| localized(a, lang))
            .unwrap_or(name);
        hero.push_str(&markup::image(src, alt, None));
    }
    hero.push_str(&markup::heading(&markup::escape(name), 1));
    if !description.is_empty() {
        hero.push_str(&markup::paragraph_html(&markup::inline(description), None));
    }
    hero.push_str(&markup::buttons(&[(
        EXPLORE[i].to_string(),
        format!("/{lang}/village/"),
    )]));
    let mut out = markup::group("ct-home-hero", &hero);
    out.push_str(&villages_section(site, lang, false));
    out.push_str(&latest_stories(lang));
    out.push_str(&newsletter(lang));
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
