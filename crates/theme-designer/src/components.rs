//! The theme's component styles (ADR-0093, FEAT-115): the design's recurring forms as a small
//! vocabulary of classes (`ds-…`), styled from the design's tokens.
//!
//! `theme.json` says colours, sizes, families, spacing and the layout's widths; it cannot say a
//! masthead rule, a mono eyebrow, a 12-column bleed, a pigment tile with its numeral, a rating out
//! of ten beside its name, a dark band's ledger. Those forms recur in editorial designs, so the
//! theme carries them once, as classes whose values all come from the design ([`components`]):
//!
//! | class | what it is | from the tokens |
//! |---|---|---|
//! | `ds-wrap` | the grid's container with its margins | grid container, breakpoint margins |
//! | `ds-section`, `ds-band` | a section's top rhythm; a band with a ground of its own | spacing |
//! | `ds-head` | a section's head: a rule above, the eyebrow and heading left, a link right | text colour |
//! | `ds-eyebrow`, `ds-meta`, `ds-muted` | the mono label, the mono meta line, muted text | type tokens `eyebrow`, `meta`; roles |
//! | `ds-btn-primary`, `ds-btn-secondary`, `ds-btn-light`, `ds-more` | buttons (pills) and the arrow link | radius `pill`, roles |
//! | `ds-hero`, `ds-hero-main`, `ds-hero-aside` | the opening: display headline, lede, buttons | type `display-xl`, `lede` |
//! | `ds-bleed` | an image band that bleeds to the right edge | ratio `panorama` |
//! | `ds-tiles`, `ds-tile`, `ds-numeral` | numbered pigment tiles (a place's colour) | pigments, ratio `village` |
//! | `ds-feature` | one large story and a column of rows | ratio `story` |
//! | `ds-cards`, `ds-card-img`, `ds-chip`, `ds-rating`, `ds-stat` | cards with a place chip and a rating | ratio `stay` |
//! | `ds-rows` | stories as rows: date, title, category | — |
//! | `ds-dark`, `ds-ledger` | the dark scheme's band and its numbered list | the dark scheme |
//! | `ds-masthead`, `ds-wordmark`, `ds-nav-dots`, `ds-lang` | the header | the masthead's rule, pigments |
//! | `ds-footer`, `ds-footer-cols`, `ds-footer-brand`, `ds-footer-col`, `ds-colophon` | the footer | — |
//! | `ds-bar`, `ds-chips` | a listing's bar and its chips | — |
//! | `ds-entries`, `ds-facts`, `ds-restaurants`, `ds-price`, `ds-people` | listing entries | ratios, roles |
//! | `ds-page-head`, `ds-prose` | a page's head and its text | `h1`, `lede`, the content width |
//!
//! A place's pigment: every listed entry carries `sp_place-{slug}` (wp-sandbox 0.9.0), and
//! [`components`] sets `--ds-pigment` on that class from the pigment token named after the place
//! (`Vernazza (Azzurro)`); the villages menu's dots take the same pigments by position.

use std::collections::BTreeMap;
use std::fmt::Write as _;

use site_design::model::{ColourRole, FontRole, SiteDesign};

use crate::model::{Presets, SiteContext};
use crate::styles::{colour_preset, slugify, wp_kebab};

/// The vocabulary: `(class, what it is for)`, as the prompt lists it.
pub const VOCABULARY: &[(&str, &str)] = &[
    ("ds-wrap", "the page grid's container with its side margins: put it on every section's outer group (with the section's own class)"),
    ("ds-section", "a section's top spacing (on the outer group)"),
    ("ds-band", "a band with a ground of its own (backgroundColor), padded above and below; put ds-wrap on an inner group"),
    ("ds-head", "a section's head row: a rule above, a group (ds-stack) with the eyebrow and the h2 on the left, a ds-more link or a short paragraph on the right"),
    ("ds-stack", "a column of blocks with a small gap"),
    ("ds-eyebrow", "the mono uppercase label above a heading (a paragraph)"),
    ("ds-meta", "a mono meta line: dates, places, credits"),
    ("ds-muted", "muted text"),
    ("ds-btn-primary", "a filled pill button (on core/button)"),
    ("ds-btn-secondary", "an outlined pill button (on core/button)"),
    ("ds-btn-light", "a light pill button on a dark band (on core/button)"),
    ("ds-more", "a bold link with an arrow (a paragraph with a link, or a navigation block)"),
    ("ds-hero", "the opening section's row: ds-hero-main (eyebrow, the h1 at display-xl, the lede, buttons) and ds-hero-aside"),
    ("ds-hero-main", "the opening's main column"),
    ("ds-hero-aside", "the opening's narrow column"),
    ("ds-bleed", "an image band bleeding to the right edge (outer group; a core/image inside, with a ds-meta caption row)"),
    ("ds-tiles", "on core/query: entries as numbered pigment tiles in a row (each: a ds-tile group with the image and a ds-numeral paragraph, then the title)"),
    ("ds-tile", "a pigment tile (the entry's place colour) holding an image and a ds-numeral"),
    ("ds-numeral", "the big display numeral on a tile"),
    ("ds-feature", "on core/query: the first entry large (image and text side by side), the others as a column of rows with a small image"),
    ("ds-cards", "on core/query: entries as cards in a grid (ds-card-img with a ds-chip, then the title, a ds-meta line and a ds-rating)"),
    ("ds-card-img", "a card's picture frame, coloured with the entry's pigment until a picture fills it"),
    ("ds-chip", "a small pill label on a picture (the entry's place, with its pigment dot)"),
    ("ds-card-foot", "a card's bottom row: text left, ds-rating right"),
    ("ds-rating", "a rating: a ds-stat number above its scale (/ 10), with a rule on its left"),
    ("ds-stat", "a big display number"),
    ("ds-rows", "on core/query: entries as rows (date, title, category) with hairlines"),
    ("ds-dark", "the dark scheme: on a band group (with backgroundColor of the dark ground)"),
    ("ds-band-row", "a band's row: ds-band-main (eyebrow, h2, paragraph, button) and a ds-ledger list"),
    ("ds-band-main", "a band's main column"),
    ("ds-ledger", "on core/list: a numbered list (roman numerals) with hairlines; each item <strong>title</strong><br><span class=\"ds-meta\">place</span>"),
    ("ds-masthead", "the header part's outer group: the masthead rule above, a hairline below; a ds-wrap ds-masthead-row inside"),
    ("ds-masthead-row", "the masthead's row: wordmark, the main menu, the languages and a button"),
    ("ds-wordmark", "the site's name as a paragraph linking / (its last word in <em>)"),
    ("ds-nav-dots", "on core/navigation: menu items with their place's pigment dot"),
    ("ds-lang", "on core/navigation: the language switch, mono"),
    ("ds-footer", "the footer part's outer group: the rule above"),
    ("ds-footer-cols", "the footer's row: ds-footer-brand and one ds-footer-col per menu"),
    ("ds-footer-brand", "the footer's brand column: the wordmark (large) and the site's line"),
    ("ds-footer-col", "a footer column: a ds-eyebrow heading and a vertical navigation"),
    ("ds-colophon", "the footer's last row: copyright left, a line right, mono"),
    ("ds-bar", "a listing's bar: a ds-meta label and ds-chips"),
    ("ds-chips", "on core/navigation: links as outlined pill chips"),
    ("ds-entries", "on core/query: entries as three columns of cards (ds-card-img with a ds-chip label, title, the line in italics, ds-facts)"),
    ("ds-facts", "a row of three facts (label and value) under a rule, mono"),
    ("ds-restaurants", "on core/query: entries as wide rows: picture left (5 of 12 columns), text right (7)"),
    ("ds-price", "a price in € glyphs (the unfilled ones muted)"),
    ("ds-know", "a restaurant's \"know before you go\": a tinted box of up to four facts, each a ds-label above its value"),
    ("ds-restaurant-head", "a restaurant entry's top row: the eyebrow, title and line left, the ds-price right"),
    ("ds-people", "on core/query: people as three columns of portraits"),
    ("ds-page-head", "a page's head: the eyebrow, the post title as the h1, the lede"),
    ("ds-prose", "the page's own text at reading width"),
];

/// What [`components`] reads besides the design.
pub struct ComponentInput<'a> {
    pub design: &'a SiteDesign,
    pub presets: &'a Presets,
    pub site: &'a SiteContext,
    /// The villages-like menu's item labels in order (their dots), if the header has one.
    pub dot_menu: Option<(String, Vec<String>)>,
}

fn var_colour(p: &Presets, slug: Option<&str>, fallback: &str) -> String {
    match slug.filter(|s| p.colors.contains_key(*s)) {
        Some(s) => format!("var(--wp--preset--color--{})", wp_kebab(s)),
        None => fallback.to_string(),
    }
}

fn var_size(p: &Presets, slug: &str, fallback: &str) -> String {
    if p.font_sizes.contains(slug) {
        format!("var(--wp--preset--font-size--{})", wp_kebab(slug))
    } else {
        fallback.to_string()
    }
}

/// A ratio token by what it is used for (`village` → `3 / 4`).
fn ratio(design: &SiteDesign, usage: &str, fallback: &str) -> String {
    design
        .tokens
        .ratios
        .iter()
        .find(|r| {
            r.usage
                .as_deref()
                .is_some_and(|u| u.to_lowercase().contains(usage))
        })
        .map_or_else(|| fallback.to_string(), |r| r.value.clone())
}

/// The pigment token named after `label` (`Vernazza (Azzurro)` for `Vernazza`), as its palette slug.
pub fn pigment_of(design: &SiteDesign, label: &str) -> Option<String> {
    let want = slugify(label);
    design
        .tokens
        .colours
        .iter()
        .filter(|c| c.role == ColourRole::Pigment)
        .find(|c| {
            let l = c.label.as_deref().map(slugify).unwrap_or_default();
            let n = slugify(&c.name);
            l.split('-').next() == want.split('-').next() && !want.is_empty()
                || n.ends_with(&format!("-{want}"))
        })
        .and_then(|c| colour_preset(design, &c.name))
}

pub use crate::forms::sprite;

/// The component styles' CSS (module docs).
pub fn components(input: &ComponentInput<'_>) -> String {
    let d = input.design;
    let p = input.presets;
    let t = &d.tokens;
    let role = |r: &str| p.role(r).map(String::from);
    let c = |r: &str, fb: &str| var_colour(p, role(r).as_deref(), fb);
    // The dark scheme's roles.
    let mut dark: BTreeMap<&str, String> = BTreeMap::new();
    for s in &t.schemes {
        for col in &s.colours {
            let k = match col.role {
                ColourRole::Background => "bg",
                ColourRole::Surface => "surface",
                ColourRole::Text => "text",
                ColourRole::Accent => "accent",
                ColourRole::Link => "link",
                _ => continue,
            };
            if let Some(slug) = colour_preset(d, &col.name) {
                dark.entry(k).or_insert(slug);
            }
        }
    }
    let dk = |k: &str, fb: &str| var_colour(p, dark.get(k).map(String::as_str), fb);
    let fam = |r: FontRole, fb: &str| {
        t.fonts
            .iter()
            .find(|f| f.role == r)
            .map(|f| slugify(&f.name))
            .filter(|s| p.font_families.contains(s))
            .map_or_else(
                || fb.to_string(),
                |s| format!("var(--wp--preset--font-family--{})", wp_kebab(&s)),
            )
    };
    let margin_lg = t
        .grid
        .as_ref()
        .and_then(|g| g.margin_px)
        .or_else(|| t.breakpoints.iter().filter_map(|b| b.margin_px).max())
        .unwrap_or(64);
    let margin_xs = t
        .breakpoints
        .iter()
        .filter_map(|b| b.margin_px)
        .min()
        .unwrap_or(20);
    let container = t.grid.as_ref().and_then(|g| g.container_px).unwrap_or(1312);
    let gutter = t.grid.as_ref().and_then(|g| g.gutter_px).unwrap_or(24);
    // The margin as a share of a 1440 px page, in tenths of a vw.
    let vw_tenths = margin_lg * 1000 / 1440;
    let pill = t
        .radii
        .iter()
        .find(|r| r.name.contains("pill"))
        .map_or("999px".to_string(), |r| r.value.clone());
    let small_bp = t
        .breakpoints
        .iter()
        .find(|b| b.min_px > 0)
        .map_or(600, |b| b.min_px);
    let vars: Vec<(&str, String)> = vec![
        ("ink", c("text", "currentColor")),
        ("paper", c("background", "Canvas")),
        ("muted", c("muted", "inherit")),
        ("surface", c("surface", "transparent")),
        ("line", c("border", "currentColor")),
        ("accent", c("accent", "inherit")),
        ("link", c("link", "inherit")),
        ("highlight", c("highlight", "inherit")),
        ("dark-bg", dk("bg", "#000")),
        ("dark-text", dk("text", "#fff")),
        ("dark-accent", dk("accent", "inherit")),
        ("display", fam(FontRole::Display, "serif")),
        ("mono", fam(FontRole::Meta, "monospace")),
        ("body", fam(FontRole::Body, "sans-serif")),
        ("eyebrow-size", var_size(p, "eyebrow", "12px")),
        ("meta-size", var_size(p, "meta", "13px")),
        (
            "h1-size",
            var_size(p, "h1", "clamp(44px, 3.2vw + 26px, 72px)"),
        ),
        (
            "h2-size",
            var_size(p, "h2", "clamp(34px, 1.6vw + 25px, 48px)"),
        ),
        (
            "h3-size",
            var_size(p, "h3", "clamp(24px, 0.6vw + 21px, 30px)"),
        ),
        (
            "display-size",
            var_size(p, "display-xl", "clamp(64px, 9vw + 30px, 160px)"),
        ),
        (
            "lede-size",
            var_size(p, "lede", "clamp(21px, 0.4vw + 20px, 26px)"),
        ),
        ("stat-size", var_size(p, "stat", "56px")),
        ("pill", pill),
        (
            "margin",
            format!(
                "clamp({margin_xs}px, {}.{}vw, {margin_lg}px)",
                vw_tenths / 10,
                vw_tenths % 10
            ),
        ),
        ("container", format!("{container}px")),
        ("gutter", format!("{gutter}px")),
        ("r-village", ratio(d, "village", "3 / 4")),
        ("r-stay", ratio(d, "stay", "3 / 2")),
        ("r-story", ratio(d, "story", "4 / 5")),
        ("r-panorama", ratio(d, "panorama", "21 / 9")),
        ("small", format!("{}px", small_bp.saturating_sub(1))),
        (
            "md",
            format!(
                "{}px",
                t.breakpoints
                    .iter()
                    .map(|b| b.min_px)
                    .filter(|m| *m >= 768)
                    .min()
                    .unwrap_or(960)
            ),
        ),
        (
            "e1",
            t.elevations
                .first()
                .map_or("0 1px 0 rgba(0,0,0,.12)".to_string(), |e| e.value.clone()),
        ),
        (
            "e2",
            t.elevations
                .get(1)
                .or(t.elevations.first())
                .map_or("0 24px 64px -24px rgba(0,0,0,.35)".to_string(), |e| {
                    e.value.clone()
                }),
        ),
    ];
    let block_styles = crate::catalog::block_styles(d, input.site);
    let mut css = String::from(CSS);
    css.push_str(&crate::forms::motion_vars(d));
    css.push_str(crate::forms::CSS);
    css.push_str(crate::forms::MOTION);
    css.push_str(&crate::forms::block_style_css(d, &block_styles));
    for (k, v) in &vars {
        css = css.replace(&format!("@{k}@"), v);
    }
    css.push_str(&crate::forms::icon_css(d));
    // The pin of a "local wisdom" callout, drawn in the text colour.
    if let Some(pin) = d
        .icons
        .iter()
        .find(|i| i.name == "pin" && i.colour.is_none())
    {
        let paths: String = pin
            .paths
            .iter()
            .map(|p| format!("<path d=%27{p}%27/>"))
            .collect();
        let _ = writeln!(
            css,
            ":root{{--ds-pin-img:url(\"data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27%230F1E2E%27 stroke-width=%271.5%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27%3E{}%3C/svg%3E\")}}",
            paths.replace('<', "%3C").replace('>', "%3E")
        );
    }
    // Skies and modes: the design's icons on the forecast's and the content's classes.
    for (class, icon) in [
        ("ct-wx-sun", "sun"),
        ("ct-wx-partly-cloudy", "partly-cloudy"),
        ("ct-wx-overcast", "overcast"),
        ("ct-wx-rain", "rain"),
        ("ct-wx-storm", "storm"),
        ("ct-wx-fog", "fog"),
        ("ct-wx-wind", "wind"),
        ("ct-wx-night", "night"),
        ("ct-mode-train", "train"),
        ("ct-mode-boat", "boat"),
        ("ct-mode-walk", "walk"),
        ("ct-mode-car", "car"),
        ("ct-mode-bus", "car"),
        ("ct-mode-plane", "external"),
    ] {
        if let Some(id) = crate::forms::icon_id(d, icon) {
            let _ = writeln!(
                css,
                ".{class}{{--ds-i:var(--ds-i-{id})}}.{class}::before{{content:\"\";display:inline-block;width:24px;height:24px;background:currentColor;-webkit-mask:var(--ds-i) center/contain no-repeat;mask:var(--ds-i) center/contain no-repeat}}"
            );
        }
    }
    // Pigments by place, and the dots of the villages menu by position.
    for pl in &input.site.places {
        if let Some(slug) = pigment_of(d, &pl.label).or_else(|| pigment_of(d, &pl.slug)) {
            let _ = writeln!(
                css,
                ".sp_place-{}{{--ds-pigment:var(--wp--preset--color--{})}}",
                pl.slug,
                wp_kebab(&slug)
            );
        }
    }
    if let Some((menu, labels)) = &input.dot_menu {
        let places: Vec<(String, String)> = input
            .site
            .places
            .iter()
            .filter_map(|pl| {
                pigment_of(d, &pl.label)
                    .or_else(|| pigment_of(d, &pl.slug))
                    .map(|slug| {
                        (
                            pl.slug.clone(),
                            format!("var(--wp--preset--color--{})", wp_kebab(&slug)),
                        )
                    })
            })
            .collect();
        css.push_str(&crate::forms::panel_css(d, menu, labels, &places));
    }
    css
}

/// The vocabulary's CSS with `@name@` placeholders ([`components`] fills them).
const CSS: &str = r#"/* component styles: the design's forms as classes (theme-designer components.rs) */
:root{--ds-margin:@margin@;--ds-section:clamp(72px,8vw,128px);--ds-band:clamp(56px,6vw,96px);--ds-line:@line@}
.wp-site-blocks{padding:0!important}
.wp-site-blocks>*,.wp-site-blocks>main>*,main.wp-block-group>*{margin-block-start:0}
.ds-wrap>*,.ds-section>*,.ds-band>*,.ds-head>*,.ds-stack>*,.ds-hero>*,.ds-tiles>*,.ds-cards>*,.ds-rows>*,.ds-feature>*,.ds-footer-cols>*,.ds-masthead-row>*,.ds-masthead-end>*,.ds-bar>*,.ds-entries>*,.ds-restaurants>*,.ds-restaurant-text>*,.ds-people>*,.ds-band-row>*,.ds-band-main>*,.ds-hero-main>*,.ds-hero-aside>*,.ds-card-foot>*,.ds-rating>*,.ds-rating-row>*,.ds-footer-brand>*,.ds-footer-col>*,.ds-colophon>*,.ds-page-head>*,.ds-buttons>*,.ds-price-line>*,.ds-tile>*,.ds-card-img>*,.ds-footer-inner>*{margin-block:0}
.wp-block-post-template>li>*{margin-block:0}
.ds-wrap .has-global-padding,.ds-wrap.has-global-padding>.has-global-padding{padding-left:0!important;padding-right:0!important}
.ds-wrap{max-width:@container@;margin-inline:auto!important;padding-inline:var(--ds-margin)!important;box-sizing:content-box}
.ds-section{padding-top:var(--ds-section)}
.ds-band{padding-block:var(--ds-band);margin-top:var(--ds-section)}
.ds-dark{background-color:@dark-bg@;color:@dark-text@}
.ds-dark a{color:@dark-text@}
.ds-stack{display:flex;flex-direction:column;gap:12px}
.ds-head{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-end;gap:16px;border-top:1px solid @ink@;padding-top:16px;margin-bottom:32px}
.ds-head h2,.ds-head .wp-block-heading{margin:0;font-family:@display@;font-size:@h2-size@;font-weight:400;line-height:1.05;letter-spacing:-0.02em}
.ds-head>p:not(.ds-more){max-width:44ch;margin:0;color:@muted@;font-size:16px;line-height:1.6}
.ds-eyebrow{font-family:@mono@;font-size:@eyebrow-size@;font-weight:500;line-height:1.2;letter-spacing:.14em;text-transform:uppercase;color:@accent@;margin:0}
.ds-dark .ds-eyebrow{color:@dark-accent@}
.ds-meta{font-family:@mono@;font-size:@meta-size@;line-height:1.4;color:@muted@;margin:0}
.ds-dark .ds-meta{color:color-mix(in srgb,@dark-text@ 62%,transparent)}
.ds-muted{color:@muted@}
.ds-more{font-weight:600;margin:0}
.ds-more a,a.ds-more,.ds-more .wp-block-navigation-item__content{color:inherit;text-decoration:none;display:inline-flex;gap:8px;min-height:44px;align-items:center;font-weight:600}
.ds-more a::after,.ds-more .wp-block-navigation-item__content::after{content:"→"}
.wp-block-button[class*="ds-btn-"] .wp-block-button__link,.wp-block-navigation[class*="ds-btn-"] .wp-block-navigation-item__content{font-family:@body@;font-weight:600;font-size:15px;line-height:1;height:52px;padding:0 26px;border-radius:@pill@;display:inline-flex;align-items:center;gap:10px;border:1px solid @ink@;box-sizing:border-box;text-decoration:none}
.wp-block-button[class*="ds-btn-"] .wp-block-button__link::after,.wp-block-navigation[class*="ds-btn-"] .wp-block-navigation-item__content::after{content:"→"}
.ds-btn-primary .wp-block-button__link,.wp-block-navigation.ds-btn-primary .wp-block-navigation-item__content{background:@ink@;color:@paper@}
.ds-btn-secondary .wp-block-button__link,.wp-block-navigation.ds-btn-secondary .wp-block-navigation-item__content{background:transparent;color:@ink@}
.ds-btn-light .wp-block-button__link,.wp-block-navigation.ds-btn-light .wp-block-navigation-item__content{background:@paper@;color:@ink@;border-color:@paper@}
.ds-btn-primary .wp-block-button__link:hover,.wp-block-navigation.ds-btn-primary .wp-block-navigation-item__content:hover{background:@accent@;border-color:@accent@}
.ds-buttons,.ds-masthead-end{display:flex;flex-wrap:wrap;gap:12px;align-items:center}
.ds-masthead-end{gap:16px}
.ds-masthead .wp-block-navigation[class*="ds-btn-"] .wp-block-navigation-item__content{height:44px;padding:0 20px;font-size:14px}
.ds-price-line{display:flex;gap:6px;align-items:baseline}
.ds-price-line .ds-meta{font-size:13px}
.ds-rating-row{display:flex;align-items:baseline;gap:10px;border-top:1px solid @line@;border-bottom:1px solid @line@;padding:12px 0}
.ds-rating-row .ds-stat{font-size:34px}
.wp-block-buttons{gap:12px}
.ds-hero{display:flex;flex-wrap:wrap;gap:40px 48px;align-items:flex-start;padding-top:clamp(40px,6vw,88px);padding-bottom:clamp(48px,7vw,112px)}
.ds-hero-main{flex:999 1 560px;min-width:0;display:flex;flex-direction:column;gap:28px}
.ds-hero-aside{flex:1 1 340px;max-width:440px;display:flex;flex-direction:column;gap:12px;align-self:flex-start;margin-top:clamp(0px,3vw,40px)}
.ds-hero h1{margin:0;font-family:@display@;font-size:@display-size@;font-weight:400;line-height:.88;letter-spacing:-0.035em}
.ds-hero h1 em{color:@link@}
.ds-lede,.ds-hero .ds-lede{margin:0;max-width:30ch;font-family:@display@;font-size:@lede-size@;line-height:1.4;font-style:italic}
.ds-bleed{padding-left:var(--ds-margin)}
.ds-bleed .wp-block-image,.ds-bleed figure{margin:0}
.ds-bleed img{display:block;width:100%;aspect-ratio:@r-panorama@;min-height:320px;object-fit:cover;background:@surface@}
.ds-bleed .ds-meta{display:flex;justify-content:space-between;padding:10px var(--ds-margin) 0 0;font-size:12px}
.wp-block-query.ds-tiles .wp-block-post-template,.ds-tiles .wp-block-post-template{display:flex!important;flex-wrap:wrap;gap:16px;list-style:none;margin:0;padding:0}
.ds-tiles .wp-block-post-template>li{flex:1 1 200px;display:flex;flex-direction:column;gap:12px;margin:0}
.ds-tile,.ds-card-img{position:relative;overflow:hidden;background-color:var(--ds-pigment,@surface@);margin:0}
.ds-tile{aspect-ratio:@r-village@}
.ds-tile .wp-block-image,.ds-card-img .wp-block-image,.ds-tile figure,.ds-card-img figure{position:absolute;inset:0;margin:0}
.ds-tile img,.ds-card-img img{width:100%;height:100%;object-fit:cover;display:block}
.ds-numeral{position:absolute;left:14px;top:6px;margin:0;font-family:@display@;font-size:64px;line-height:1;color:@ink@;z-index:1}
.ds-tiles .wp-block-post-title{margin:0;font-family:@display@;font-size:30px;font-style:italic;font-weight:400;line-height:1}
.wp-block-post-template .wp-block-post-title a{color:inherit;text-decoration:none}
.ds-feature .wp-block-post-template{display:grid!important;grid-template-columns:minmax(0,2fr) minmax(300px,1fr);column-gap:48px;list-style:none;margin:0;padding:0}
.ds-feature .wp-block-post-template>li{margin:0}
.ds-feature .wp-block-post-template>li:first-child{grid-row:1 / span 6;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(280px,100%),1fr));gap:24px;align-items:end}
.ds-feature .wp-block-post-template>li:not(:first-child){display:grid;grid-template-columns:96px 1fr;gap:16px;padding:16px 0;border-bottom:1px solid @line@;align-items:center}
.ds-feature .ds-card-img{aspect-ratio:@r-story@}
.ds-feature li:first-child .wp-block-post-title{font-family:@display@;font-size:clamp(34px,2vw + 20px,52px);font-weight:400;line-height:1.02;letter-spacing:-0.02em;margin:0}
.ds-feature li:not(:first-child) .wp-block-post-title{font-family:@display@;font-size:22px;font-weight:400;line-height:1.15;margin:0}
.ds-feature li:not(:first-child) .wp-block-post-excerpt{display:none}
.ds-feature .ds-stack{gap:10px;padding-bottom:8px}
.ds-feature .wp-block-post-excerpt{margin:0;color:@muted@;font-size:16px;line-height:1.6}
.ds-feature .wp-block-post-excerpt__more-text{display:none}
.wp-block-post-terms.ds-eyebrow a,.ds-eyebrow a{color:inherit;text-decoration:none}
.ds-cards .wp-block-post-template{display:grid!important;grid-template-columns:repeat(auto-fit,minmax(min(320px,100%),1fr));gap:32px 24px;list-style:none;margin:0;padding:0}
.ds-cards .wp-block-post-template>li{display:flex;flex-direction:column;gap:14px;margin:0}
.ds-cards .ds-card-img{aspect-ratio:@r-stay@}
.ds-chip{position:absolute;left:12px;top:12px;z-index:1;height:30px;padding:0 12px 0 10px;border-radius:@pill@;background:@paper@;color:@ink@;display:inline-flex;align-items:center;gap:8px;font-size:13px;font-weight:500;margin:0;font-family:@body@;letter-spacing:0;text-transform:none}
.ds-chip::before{content:"";width:8px;height:8px;border-radius:50%;background:var(--ds-pigment,@accent@)}
.ds-entries .ds-chip,.ds-chip.ds-eyebrow{font-family:@mono@;font-size:11px;letter-spacing:.12em;text-transform:uppercase;border-radius:0;height:auto;padding:5px 9px}
.ds-entries .ds-chip::before,.ds-chip.ds-eyebrow::before{display:none}
.ds-card-foot{display:flex;justify-content:space-between;gap:16px;align-items:flex-start}
.ds-card-foot .wp-block-post-title,.ds-cards .wp-block-post-title{font-family:@display@;font-size:26px;font-weight:400;line-height:1.1;margin:0}
.ds-card-foot>.ds-stack{gap:6px}
.ds-rating{flex:0 0 auto;display:flex;flex-direction:column;align-items:flex-end;border-left:1px solid @line@;padding-left:16px;gap:0}
.ds-stat{font-family:@display@;font-size:38px;line-height:1;font-variant-numeric:tabular-nums;margin:0}
.ds-rating .ds-meta{font-size:11px}
.ds-rows .wp-block-post-template{list-style:none;margin:0;padding:0}
.ds-rows .wp-block-post-template>li{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 32px;padding:20px 0;border-bottom:1px solid @line@;margin:0}
.ds-rows .wp-block-post-date{flex:0 0 120px;font-family:@mono@;font-size:13px;color:@muted@;margin:0}
.ds-rows .wp-block-post-title{flex:999 1 420px;font-family:@display@;font-size:clamp(22px,0.8vw + 16px,30px);font-weight:400;line-height:1.15;margin:0}
.ds-rows .wp-block-post-terms{flex:0 0 160px;font-family:@mono@;font-size:11px;letter-spacing:.14em;text-transform:uppercase;margin:0}
.ds-rows .wp-block-post-terms a{color:inherit;text-decoration:none}
.ds-rows .wp-block-post-terms::after{content:" →"}
.ds-band-row{display:flex;flex-wrap:wrap;gap:40px 48px;align-items:center}
.ds-band-main{flex:999 1 520px;min-width:0;display:flex;flex-direction:column;gap:20px}
.ds-band-main h2{margin:0;font-family:@display@;font-size:clamp(44px,3.2vw + 26px,88px);font-weight:400;line-height:.95;letter-spacing:-0.03em}
.ds-band-main>p:not(.ds-eyebrow){max-width:52ch;font-size:17px;line-height:1.6;margin:0;opacity:.85}
.ds-ledger{flex:1 1 320px;list-style:none;margin:0;padding:0;counter-reset:ds-ledger}
.ds-ledger>li{counter-increment:ds-ledger;display:grid;grid-template-columns:56px 1fr;grid-template-rows:auto auto;gap:2px 12px;padding:14px 0;border-top:1px solid color-mix(in srgb,currentColor 18%,transparent);margin:0;align-items:start}
.ds-ledger>li br{display:none}
.ds-ledger>li>strong,.ds-ledger>li>.ds-meta{grid-column:2}
.ds-ledger>li:last-child{border-bottom:1px solid color-mix(in srgb,currentColor 18%,transparent)}
.ds-ledger>li::before{content:counter(ds-ledger,upper-roman);grid-row:1 / span 2;font-family:@display@;font-size:32px;line-height:1;color:@dark-accent@}
.ds-ledger>li strong{font-weight:600}
.ds-ledger>li .ds-meta{font-size:12px}
.ds-masthead{border-top:3px solid @ink@;border-bottom:1px solid @line@;background:@paper@}
.ds-masthead-row{min-height:76px;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px 32px;padding-block:10px}
.ds-masthead-row>.wp-block-group{display:flex;align-items:center;gap:16px}
.ds-wordmark{font-family:@display@;font-size:26px;line-height:1.2;margin:0}
.ds-wordmark a{color:inherit;text-decoration:none;display:inline-flex;gap:8px;align-items:baseline;white-space:nowrap}
.ds-wordmark em{color:@accent@}
.ds-nav-dots .wp-block-navigation__container,.ds-nav-dots{gap:4px 24px!important}
.ds-nav-dots .wp-block-navigation-item__content{display:inline-flex!important;align-items:center;gap:8px;min-height:44px;font-family:@body@;font-weight:500;font-size:15px;line-height:1;color:@ink@;text-decoration:none}
.ds-nav-dots .wp-block-navigation-item__content::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--ds-dot,@accent@)}
.ds-lang .wp-block-navigation__container,.ds-lang{gap:10px!important}
.ds-lang .wp-block-navigation-item__content{font-family:@mono@;font-size:12px;letter-spacing:.1em;color:@muted@;text-decoration:none;text-transform:uppercase}
.ds-lang .current-menu-item .wp-block-navigation-item__content{color:@ink@;font-weight:500;border-bottom:1px solid @ink@}
.ds-masthead .wp-block-buttons .wp-block-button__link{height:44px;padding:0 20px;font-size:14px}
.ds-footer{border-top:3px solid @ink@;background:@paper@;margin-top:0}
.ds-footer>.ds-wrap,.ds-footer .ds-footer-inner{padding-top:64px;padding-bottom:40px;display:flex;flex-direction:column;gap:48px}
.ds-footer-cols{display:flex;flex-wrap:wrap;gap:40px 48px}
.ds-footer-brand{flex:2 1 300px;display:flex;flex-direction:column;gap:14px}
.ds-footer-brand .ds-wordmark{font-size:36px}
.ds-footer-brand>p:not(.ds-wordmark){max-width:38ch;font-size:15px;line-height:1.6;color:@muted@;margin:0}
.ds-footer-col{flex:1 1 150px;display:flex;flex-direction:column;gap:4px}
.ds-footer-col .ds-eyebrow{color:@ink@;font-size:11px;margin-bottom:8px}
.ds-footer-col .wp-block-navigation__container{flex-direction:column;align-items:flex-start!important;gap:0!important}
.ds-footer-col .wp-block-navigation-item__content{font-size:15px;min-height:32px;display:flex;align-items:center;color:@ink@;text-decoration:none}
.ds-colophon{display:flex;flex-wrap:wrap;justify-content:space-between;gap:12px;font-family:@mono@;font-size:12px;color:@muted@;border-top:1px solid @line@;padding-top:16px}
.ds-colophon p{margin:0}
.ds-bar+.ds-section,.ds-bar+section{padding-top:0}
.ds-bar{display:flex;flex-wrap:wrap;align-items:center;gap:12px 24px;border-top:1px solid @ink@;border-bottom:1px solid @line@;padding:14px 0;margin-bottom:32px}
.ds-bar .ds-meta{font-size:12px;letter-spacing:.12em;text-transform:uppercase}
.ds-chips .wp-block-navigation__container,.ds-chips{gap:8px!important}
.ds-chips .wp-block-navigation-item__content{height:40px;padding:0 16px;border-radius:@pill@;border:1px solid @ink@;font-family:@body@;font-weight:500;font-size:14px;line-height:40px;color:@ink@;text-decoration:none;display:inline-block}
.ds-chips .current-menu-item .wp-block-navigation-item__content{background:@ink@;color:@paper@}
.ds-entries .wp-block-post-template{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr));gap:40px 24px;list-style:none;margin:0;padding:0}
.ds-entries .wp-block-post-template>li{display:flex;flex-direction:column;gap:14px;margin:0}
.ds-entries .ds-card-img{aspect-ratio:@r-story@}
.ds-entries .wp-block-post-title{font-family:@display@;font-size:32px;font-weight:400;line-height:1.05;letter-spacing:-0.01em;margin:0}
.ds-entries .ds-line,.ds-restaurants .ds-line,.ds-people .ds-line{font-family:@display@;font-size:19px;font-style:italic;line-height:1.35;color:@muted@;margin:0}
.ds-facts{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr));border-top:1px solid @ink@;font-family:@mono@;font-size:12px;gap:0!important}
.ds-facts>*{display:flex;flex-direction:column;gap:3px;padding:10px 10px 0 0;margin:0!important}
.ds-facts>*+*{padding-left:10px;border-left:1px solid @line@}
.ds-facts .ds-label{font-size:10px;letter-spacing:.14em;color:@muted@;text-transform:uppercase;margin:0}
.ds-facts p{margin:0}
.ds-restaurants .wp-block-post-template{list-style:none;margin:0;padding:0;display:flex!important;flex-direction:column;gap:48px}
.ds-restaurants .wp-block-post-template>li{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));column-gap:@gutter@;border-top:1px solid @ink@;padding-top:24px;margin:0}
.ds-restaurants .ds-card-img{grid-column:1 / span 5;aspect-ratio:@r-stay@}
.ds-restaurants .ds-restaurant-text{grid-column:6 / span 7;display:flex;flex-direction:column;gap:18px}
.ds-restaurants .wp-block-post-title{font-family:@display@;font-size:48px;font-weight:400;line-height:1;letter-spacing:-0.02em;margin:0}
.ds-price{font-family:@display@;font-size:30px;line-height:1;letter-spacing:.04em;margin:0;display:flex;gap:0}
.ds-price>*{margin:0!important}
.ds-price .ds-price-rest{color:@line@}
.ds-restaurants .ds-restaurant-text>.wp-block-post-excerpt{max-width:60ch;font-size:17px;line-height:1.6;margin:0}
.ds-know{background:@surface@;padding:16px 20px 20px;display:grid!important;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px}
.ds-know>*{display:flex;flex-direction:column;gap:4px;margin:0!important}
.ds-know .ds-label{font-family:@mono@;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:@muted@;margin:0}
.ds-know p:not(.ds-label){font-size:15px;font-weight:600;margin:0}
.ds-restaurant-head{display:flex;justify-content:space-between;align-items:flex-start;gap:24px}
.ds-people .wp-block-post-template{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px;list-style:none;margin:0;padding:0}
.ds-people .wp-block-post-template>li{display:flex;flex-direction:column;gap:14px;margin:0}
.ds-people .ds-card-img{aspect-ratio:@r-story@}
.ds-people .ds-card-img img{filter:grayscale(1)}
.ds-people .wp-block-post-title{font-family:@display@;font-size:36px;font-weight:400;line-height:1;margin:0}
.ds-page-head{display:flex;flex-direction:column;gap:20px;padding-top:clamp(40px,6vw,88px);padding-bottom:clamp(24px,4vw,56px)}
.ds-page-head h1,.ds-page-head .wp-block-post-title,.ds-page-head .wp-block-query-title{margin:0;font-family:@display@;font-size:@h1-size@;font-weight:400;line-height:1;letter-spacing:-0.025em;max-width:20ch}
.ds-prose{max-width:760px}
.ds-prose>*{max-width:760px}
.ds-prose .wp-block-image img,.ds-prose figure img{max-width:100%;height:auto}
.ds-prose h2{font-family:@display@;font-size:@h2-size@;font-weight:400;line-height:1.05;letter-spacing:-0.02em}
.ds-prose h3{font-family:@display@;font-size:@h3-size@;font-weight:500;line-height:1.15}
.ds-prose table{width:100%;border-collapse:collapse;font-family:@mono@;font-size:13px}
.ds-prose th{font-size:11px;letter-spacing:.12em;text-transform:uppercase;text-align:left;font-weight:500;padding:0 8px 10px 0;border-bottom:1px solid @ink@}
.ds-prose td{padding:14px 8px 14px 0;border-bottom:1px solid @line@}
@media (max-width:@small@){
.ds-feature .wp-block-post-template{grid-template-columns:1fr}
.ds-feature .wp-block-post-template>li:first-child{grid-row:auto}
.ds-entries .wp-block-post-template,.ds-people .wp-block-post-template{grid-template-columns:1fr}
.ds-restaurants .wp-block-post-template>li{display:flex;flex-direction:column;gap:16px}
.ds-restaurants .wp-block-post-title{font-size:36px}
.ds-masthead-row{gap:8px 20px}
}
"#;
