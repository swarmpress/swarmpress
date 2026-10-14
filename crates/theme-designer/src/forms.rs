//! The design's components as the theme's CSS (ADR-0093 addendum, 2026-10-14): every component of
//! a design system's sheets that the site has use for, in the vocabulary [`crate::components`]
//! started, filled from the design's tokens.
//!
//! Three kinds of rules:
//!
//! * **Template forms** (`ds-…` classes the templates and parts carry): the masthead's tide, the
//!   main menu's panels (4.1) and its phone sheet (4.20), the breadcrumb, the page header and its
//!   dateline, the contents rail and the reading progress, pagination, badges, the search
//!   overlay, the essentials ticker, the filter chips.
//! * **Block styles** ([`block_style_css`]): a component applied to the content by class
//!   (`.is-style-{component}[-{variant}]`, [`crate::catalog`]); each function has one form here,
//!   so a design's accordion, ledger or callout renders whatever content the catalogue maps to it.
//! * **The design's own interaction rules** (the sheet's `:hover`, `:focus-visible`,
//!   `details[open]`, `@keyframes`): carried by the component's [`site_design::Component::css`]
//!   where its class names are the theme's; the twelve micro-interactions of a motion sheet are
//!   written here with their reduced-motion fallbacks ([`motion_css`]).
//!
//! Icons: [`icon_css`] gives every icon of the design's set a class `ds-i-{id}` (a CSS mask of its
//! paths: stroke, round caps, `currentColor`), and [`sprite`] the same set as one SVG sprite for
//! the static site (`/icons.svg#ct-{name}`).

use std::collections::BTreeMap;
use std::fmt::Write as _;

use site_design::model::{ColourRole, SiteDesign};
use site_design::wordpress::BlockStyle;

use crate::catalog::function_of;

/// The icon set as one SVG sprite (`<symbol id="ct-train">`), stroked like the design's sheet.
pub fn sprite(design: &SiteDesign) -> Option<String> {
    if design.icons.is_empty() {
        return None;
    }
    let mut s = String::from("<svg xmlns=\"http://www.w3.org/2000/svg\" style=\"display:none\">");
    for i in &design.icons {
        let _ = write!(s, "<symbol id=\"{}\" viewBox=\"0 0 24 24\">", attr(&i.id));
        if let Some(c) = &i.colour {
            let _ = write!(
                s,
                "<circle cx=\"12\" cy=\"12\" r=\"12\" fill=\"{}\"/>",
                attr(c)
            );
        }
        let _ = write!(
            s,
            "<g fill=\"none\" stroke=\"{}\" stroke-width=\"1.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\">",
            if i.colour.is_some() { "#0F1E2E" } else { "currentColor" }
        );
        for p in &i.paths {
            let _ = write!(s, "<path d=\"{}\"/>", attr(p));
        }
        s.push_str("</g></symbol>");
    }
    s.push_str("</svg>");
    Some(s)
}

fn attr(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('"', "&quot;")
        .replace('<', "&lt;")
}

/// `%`-encoding for an SVG in a `data:` URL.
fn data_url(svg: &str) -> String {
    let mut out = String::from("data:image/svg+xml,");
    for c in svg.chars() {
        match c {
            '<' => out.push_str("%3C"),
            '>' => out.push_str("%3E"),
            '#' => out.push_str("%23"),
            '"' => out.push_str("%22"),
            '\'' => out.push_str("%27"),
            '%' => out.push_str("%25"),
            c => out.push(c),
        }
    }
    out
}

/// Every icon as a class: `.ds-i-ct-train` sets `--ds-i`, and `.ds-icon` draws it in the current
/// colour (a mask, so it follows the text's colour, never a pigment stroke).
pub fn icon_css(design: &SiteDesign) -> String {
    let mut s = String::from(
        ".ds-icon,[class*=\"ds-i-\"]::before{display:inline-block;width:24px;height:24px;flex:0 0 auto;background:currentColor;-webkit-mask:var(--ds-i) center/contain no-repeat;mask:var(--ds-i) center/contain no-repeat;vertical-align:middle}\n",
    );
    for i in design.icons.iter().filter(|i| i.colour.is_none()) {
        let mut svg = String::from(
            "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"black\" stroke-width=\"1.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\">",
        );
        for p in &i.paths {
            let _ = write!(svg, "<path d=\"{}\"/>", attr(p));
        }
        svg.push_str("</svg>");
        let _ = writeln!(
            s,
            ":root{{--ds-i-{0}:url(\"{1}\")}}.ds-i-{0}{{--ds-i:var(--ds-i-{0})}}",
            i.id,
            data_url(&svg)
        );
    }
    // A place's mark: its pigment disc with the line drawn on it (an image, not a mask).
    for i in design.icons.iter().filter(|i| i.colour.is_some()) {
        let mut svg = format!(
            "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><circle cx=\"12\" cy=\"12\" r=\"12\" fill=\"{}\"/><g fill=\"none\" stroke=\"%230F1E2E\" stroke-width=\"1.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\">",
            i.colour.as_deref().unwrap_or("#000")
        );
        for p in &i.paths {
            let _ = write!(svg, "<path d=\"{}\"/>", attr(p));
        }
        svg.push_str("</g></svg>");
        let _ = writeln!(
            s,
            ".ds-mark-{}{{display:inline-block;width:32px;height:32px;background:url(\"{}\") center/contain no-repeat}}",
            i.id,
            data_url(&svg).replace("%2523", "%23")
        );
    }
    s
}

/// The icon a mode of transport or a sky gets (by the design's icon names).
pub fn icon_id(design: &SiteDesign, name: &str) -> Option<String> {
    design
        .icons
        .iter()
        .find(|i| i.name == name && i.colour.is_none())
        .map(|i| i.id.clone())
}

/// Motion tokens as `--ds-…` custom properties, with the design's own values (fallbacks for a
/// design without them).
pub fn motion_vars(design: &SiteDesign) -> String {
    let mut vars: BTreeMap<String, String> = [
        ("ease-tide", "cubic-bezier(.22,1,.36,1)"),
        ("ease-swell", "cubic-bezier(.65,0,.35,1)"),
        ("ease-buoy", "cubic-bezier(.34,1.56,.64,1)"),
        ("ease-ebb", "cubic-bezier(.4,0,1,1)"),
        ("dur-press", "120ms"),
        ("dur-quick", "200ms"),
        ("dur-base", "320ms"),
        ("dur-slow", "560ms"),
        ("dur-tide", "900ms"),
    ]
    .iter()
    .map(|(k, v)| (k.to_string(), v.to_string()))
    .collect();
    for m in &design.tokens.motion {
        let k = m.name.trim_start_matches("--").to_string();
        if m.value
            .chars()
            .next()
            .is_some_and(|c| c.is_ascii_alphabetic() || c.is_ascii_digit())
            && !m.value.contains('/')
        {
            vars.insert(k, m.value.clone());
        }
    }
    let mut s = String::from(":root{");
    for (k, v) in &vars {
        let _ = write!(s, "--ds-{k}:{v};");
    }
    s.push_str("}\n");
    s
}

/// The block styles' CSS (module docs): each style's selector in its function's form.
pub fn block_style_css(design: &SiteDesign, styles: &[BlockStyle]) -> String {
    let mut out = String::new();
    for b in styles {
        let Some((f, variant)) = b.classes.first().and_then(|c| function_of(c)) else {
            continue;
        };
        let sel = format!(".is-style-{}", b.name);
        let form = match (f, variant) {
            ("faq", _) => FAQ,
            ("trail-stats", _) => LEDGER,
            ("getting-here", _) => MODES,
            ("itinerary", _) => TIMELINE,
            ("page-header", _) => PAGE_HERO,
            ("callout", "pull-quote") => PULL_QUOTE,
            ("callout", "local-wisdom") => WISDOM,
            ("callout", "trail-notice") => NOTICE,
            ("callout", _) => CLOSING,
            ("people", _) => PEOPLE,
            ("essentials", _) => TICKER_CONTENT,
            ("weather", "seasons") => SEASONS,
            ("weather", _) => "",
            ("gallery", _) => GALLERY,
            ("cards", _) => ENTRIES,
            ("contents", _) => CONTENTS,
            ("byline", _) => BYLINE,
            ("related", _) => RELATED,
            ("tags", _) => TAG,
            _ => "",
        };
        out.push_str(&form.replace('&', &sel));
        // A callout's label is the design's own word for the variant (`Local wisdom`).
        if f == "callout" && matches!(variant, "local-wisdom" | "trail-notice" | "pull-quote") {
            if let Some(word) = specimen_word(design, &b.component, variant) {
                let target = if variant == "pull-quote" {
                    "::after"
                } else {
                    "::before"
                };
                let _ = writeln!(
                    out,
                    "{sel}{target}{{content:\"{}\"}}",
                    word.replace('"', "")
                );
            }
        }
    }
    // Season cards take the design's season grounds, in order.
    if let Some(c) = crate::catalog::component_for(design, "weather") {
        let grounds = specimen_grounds(&c.html, design);
        for b in styles.iter().filter(|b| b.name.ends_with("-seasons")) {
            for (i, g) in grounds.iter().enumerate().take(6) {
                let _ = writeln!(
                    out,
                    ".is-style-{} > .wp-block-group:nth-of-type({}){{background:{g}}}",
                    b.name,
                    i + 1
                );
            }
        }
    }
    out
}

/// The specimen's label for a variant (`local-wisdom` → `Local wisdom`), as the design wrote it.
fn specimen_word(design: &SiteDesign, component: &str, variant: &str) -> Option<String> {
    let c = design.components.iter().find(|c| c.slug == component)?;
    let doc = site_design::dom::parse(&format!("<body>{}</body>", c.html));
    let want = variant.replace('-', " ");
    doc.descendants()
        .into_iter()
        .map(|e| e.text())
        .find(|t| t.trim().to_lowercase() == want)
        .map(|t| t.trim().to_string())
}

/// The grounds a specimen gives its cards (`background:#EFE9DD`), other than the main colours.
fn specimen_grounds(html: &str, design: &SiteDesign) -> Vec<String> {
    let main: Vec<String> = design
        .tokens
        .colours
        .iter()
        .filter(|c| c.role != ColourRole::Pigment)
        .map(|c| c.value.to_ascii_lowercase())
        .chain(
            design
                .tokens
                .schemes
                .iter()
                .flat_map(|s| s.colours.iter().map(|c| c.value.to_ascii_lowercase())),
        )
        .collect();
    let mut out: Vec<String> = Vec::new();
    for part in html.split("background:").skip(1) {
        let v: String = part
            .chars()
            .take_while(|c| *c != ';' && *c != '"')
            .collect();
        let v = v.trim().to_ascii_lowercase();
        if v.starts_with('#') && v.len() == 7 && !main.contains(&v) && !out.contains(&v) {
            out.push(v);
        }
    }
    out
}

/// The main menu's panels per position (4.1): each place's tint as the panel's ground, its
/// pigment as its dot; and the place pages' dots in the breadcrumb.
pub fn panel_css(
    design: &SiteDesign,
    menu: &str,
    labels: &[String],
    places: &[(String, String)],
) -> String {
    let mut s = String::new();
    for (i, l) in labels.iter().enumerate() {
        let key = crate::styles::slugify(l);
        let Some(c) = design.tokens.colours.iter().find(|c| {
            c.role == ColourRole::Pigment
                && (c.name.ends_with(&format!("-{key}"))
                    || c.label.as_deref().is_some_and(|x| {
                        crate::styles::slugify(x).split('-').next() == key.split('-').next()
                    }))
        }) else {
            continue;
        };
        let n = i + 1;
        let tint = c.tint.as_deref().unwrap_or("transparent");
        let _ = writeln!(
            s,
            ".sp-menu-{menu} .wp-block-navigation__container>.wp-block-navigation-item:nth-child({n}){{--ds-dot:{};--ds-tint:{tint}}}",
            c.value
        );
    }
    for (slug, pigment) in places {
        let _ = writeln!(
            s,
            ".wp-block-breadcrumbs a[href$=\"/{slug}/\"]{{--ds-dot:{pigment}}}.ct-place-{slug},.ds-place-{slug}{{--ds-pigment:{pigment}}}"
        );
    }
    s
}

const FAQ: &str = r#"&{border-top:1px solid @ink@;max-width:820px;margin-block:48px}
&>.wp-block-heading{font-family:@display@;font-size:@h2-size@;font-weight:400;line-height:1.05;margin:24px 0 8px}
& .wp-block-details,& details{border-bottom:1px solid @line@;margin:0;padding:0}
& summary{display:flex;justify-content:space-between;align-items:center;gap:24px;min-height:64px;cursor:pointer;list-style:none;font-family:@display@;font-size:24px;line-height:1.2;transition:color var(--ds-dur-quick) var(--ds-ease-tide)}
& summary::-webkit-details-marker{display:none}
& summary::after{content:"+";font-family:@body@;font-size:28px;line-height:1;transition:transform var(--ds-dur-base) var(--ds-ease-tide)}
& details[open]>summary{color:@accent@}
& details[open]>summary::after{transform:rotate(45deg)}
& details>:not(summary){margin:0 0 20px;max-width:56ch;font-size:16px;line-height:1.6;color:@muted@}
& summary:focus-visible{outline:2px solid @ink@;outline-offset:3px;box-shadow:0 0 0 7px @highlight@}
"#;

const LEDGER: &str = r#"&{display:grid!important;grid-template-columns:repeat(4,minmax(0,1fr));border-top:1px solid @ink@;border-bottom:1px solid @ink@;margin:20px 0;gap:0!important}
&>.ct-fact{display:flex;flex-direction:column;gap:6px;padding:18px 20px;margin:0!important;border-right:1px solid @line@}
&>.ct-fact:first-child{padding-left:0}
&>.ct-fact:nth-child(4n),&>.ct-fact:last-of-type{border-right:0}
& .ct-fact-label{font-family:@mono@;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:@muted@;margin:0}
& .ct-fact-value{font-family:@display@;font-size:clamp(30px,2.6vw + 8px,52px);line-height:1;font-variant-numeric:tabular-nums;margin:0}
&>.ct-fact[class*="ct-grade-"] .ct-fact-value{font-family:@body@;font-size:18px;font-weight:600}
&>.ct-fact[class*="ct-grade-"] .ct-fact-label::after{content:"";display:block;width:100px;height:8px;margin-top:10px;background:linear-gradient(90deg,@ink@ calc(var(--ds-grade,0) * 26px),@line@ 0);-webkit-mask:repeating-linear-gradient(90deg,#000 0 22px,transparent 22px 26px);mask:repeating-linear-gradient(90deg,#000 0 22px,transparent 22px 26px)}
&>.ct-grade-1{--ds-grade:1}&>.ct-grade-2{--ds-grade:2}&>.ct-grade-3{--ds-grade:3}&>.ct-grade-4{--ds-grade:4}
& .ct-fact-note{grid-column:1/-1;margin:0;padding:12px 0;border-top:1px solid @line@;font-size:14px;color:@muted@}
@media (max-width:@small@){&{grid-template-columns:repeat(2,minmax(0,1fr))}&>.ct-fact:nth-child(2n){border-right:0}&>.ct-fact:nth-child(odd){padding-left:0}}
"#;

const MODES: &str = r#"&{border-top:1px solid @ink@;margin-block:40px}
&>.wp-block-heading{font-family:@display@;font-size:@h2-size@;font-weight:400;margin:24px 0 12px}
& .ct-items-item,& [class*="ct-mode-"]{display:grid!important;grid-template-columns:44px minmax(0,1fr) auto;gap:6px 16px;align-items:start;padding:16px 0;border-bottom:1px solid @line@;margin:0}
& [class*="ct-mode-"]::before{grid-row:1 / span 4;width:28px;height:28px;margin-top:4px}
& [class*="ct-mode-"]>*{grid-column:2;margin:0}
& [class*="ct-mode-"] .wp-block-heading{font-family:@body@;font-size:18px;font-weight:600}
& .ct-duration,& .ct-frequency{grid-column:3!important;grid-row:1;text-align:right;font-family:@display@;font-size:30px;line-height:1}
& .ct-duration::after{content:"Typical";display:block;font-family:@mono@;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:@muted@}
& .wp-block-image{display:none}
"#;

const TIMELINE: &str = r#"&{counter-reset:ds-day;margin-block:40px}
& .ct-days-item{counter-increment:ds-day;display:grid!important;grid-template-columns:64px minmax(0,1fr);column-gap:16px;position:relative;margin:0;padding-bottom:28px}
& .ct-days-item::before{content:counter(ds-day,upper-roman);grid-row:1 / span 20;width:44px;height:44px;border-radius:50%;background:var(--ds-pigment,@surface@);display:inline-flex;align-items:center;justify-content:center;font-family:@display@;font-size:18px;color:@ink@;justify-self:center}
& .ct-days-item::after{content:"";position:absolute;left:31px;top:48px;bottom:0;width:1px;background:@ink@;transform-origin:top}
& .ct-days-item:last-child::after{display:none}
& .ct-days-item>*{grid-column:2;margin:0 0 6px}
& .ct-rhythm{font-family:@mono@;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:@accent@;order:-2}
& .ct-days-item>.wp-block-heading{font-family:@display@;font-size:26px;font-weight:400;line-height:1.15;order:-1}
& .ct-village{font-family:@mono@;font-size:12px;color:@muted@}
@supports (animation-timeline:view()){@media (prefers-reduced-motion:no-preference){& .ct-days-item::after{animation:ds-draw linear both;animation-timeline:view();animation-range:entry 20% cover 60%}}}
"#;

const PAGE_HERO: &str = r#"&{display:flex;flex-direction:column;gap:18px;margin-block:8px 48px;text-align:start}
&>*{margin-left:0!important;max-width:none}
&>.ct-badge,& .ct-badge{font-family:@mono@;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:@accent@;margin:0;order:-3}
&>.wp-block-heading{font-family:@display@;font-size:clamp(40px,4vw + 16px,88px);font-weight:400;line-height:.95;letter-spacing:-0.03em;margin:0;order:-2;max-width:18ch}
&>.ct-subtitle,& .ct-subtitle{font-family:@display@;font-size:@lede-size@;font-style:italic;line-height:1.4;max-width:34ch;margin:0;order:-1}
&>.wp-block-image{margin:12px 0 0}
&>.wp-block-image img{width:100%;aspect-ratio:@r-panorama@;object-fit:cover;display:block}
& .ct-duration,& .ct-pace,& .ct-effort,& .ct-best-season{display:inline-block;font-family:@mono@;font-size:13px;color:@muted@;margin:0 20px 0 0}
"#;

const PULL_QUOTE: &str = r#"&{display:grid!important;grid-template-columns:56px minmax(0,1fr);gap:8px 8px;margin-block:48px;max-width:820px}
&::before{content:"“";grid-row:1 / span 6;font-family:@display@;font-size:120px;line-height:.8;color:@accent@;margin-left:-8px}
&>*{grid-column:2;margin:0}
& blockquote,& .wp-block-quote,&>.wp-block-heading{font-family:@display@;font-size:clamp(26px,1.4vw + 16px,36px);font-style:italic;font-weight:400;line-height:1.2;letter-spacing:-0.01em;border:0!important;padding:0!important;margin:0}
& blockquote p{margin:0}
& .ct-badge,&::after{font-family:@mono@;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:@muted@}
&::after{grid-column:2;margin-top:12px}
& .ct-content{font-size:17px;line-height:1.65;font-family:@body@;font-style:normal}
"#;

const WISDOM: &str = r#"&{background:@surface@;padding:22px!important;margin-block:16px;display:flex;flex-direction:column;gap:10px;border:0;max-width:820px}
&::before{display:flex;align-items:center;gap:8px;font-family:@mono@;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:@ink@;padding-left:24px;background:no-repeat left center/16px var(--ds-pin-img,none)}
p&,&>p{font-size:16px;line-height:1.55;margin:0}
"#;

const NOTICE: &str = r#"&{background:@ink@;color:@paper@;padding:22px!important;margin-block:16px;max-width:820px;font-size:16px;line-height:1.55}
&::before{display:block;font-family:@mono@;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:@highlight@;margin-bottom:8px}
& a{color:@paper@;font-weight:600}
"#;

const CLOSING: &str = r#"&{background:@dark-bg@;color:@dark-text@;padding:clamp(32px,4vw,64px)!important;margin-block:64px 0;display:flex;flex-direction:column;gap:16px}
&>.wp-block-heading{font-family:@display@;font-size:clamp(36px,2.4vw + 20px,64px);font-weight:400;line-height:1;letter-spacing:-0.02em;margin:0;order:-1;color:@dark-text@}
&>p{max-width:60ch;font-size:17px;line-height:1.6;margin:0;opacity:.9}
& .wp-block-button__link{background:@paper@;color:@ink@;border-radius:@pill@;height:52px;padding:0 26px;display:inline-flex;align-items:center;gap:10px;font-weight:600;font-size:15px}
& .wp-block-button__link::after{content:"→";transition:transform var(--ds-dur-base) var(--ds-ease-tide)}
& .wp-block-button__link:hover{background:@highlight@}
& .wp-block-button__link:hover::after{transform:translateX(4px)}
"#;

const PEOPLE: &str = r#"&{margin-block:40px}
&>.wp-block-group:not(.ct-editors-item),&{display:grid!important;grid-template-columns:repeat(auto-fill,minmax(min(300px,100%),1fr));gap:40px 24px}
& .ct-editors-item{display:flex!important;flex-direction:column;gap:12px;margin:0}
& .ct-editors-item .wp-block-image{order:-5;margin:0;overflow:hidden;aspect-ratio:@r-story@}
& .ct-editors-item .wp-block-image img{width:100%;height:100%;object-fit:cover;filter:grayscale(1);transition:filter var(--ds-dur-slow) var(--ds-ease-tide),transform var(--ds-dur-slow) var(--ds-ease-tide)}
& .ct-editors-item:hover .wp-block-image img{filter:grayscale(0);transform:scale(1.03)}
& .ct-persona{order:-4;font-family:@display@;font-size:17px;font-style:italic;color:@muted@;margin:0}
& .ct-editors-item>.wp-block-heading{order:-3;font-family:@display@;font-size:36px;font-weight:400;line-height:1;margin:0}
& .ct-role{order:-2;font-family:@mono@;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:@accent@;margin:0}
& .ct-bio,& .ct-love{font-size:15px;line-height:1.6;margin:0}
& .ct-hobbies{display:flex;flex-wrap:wrap;gap:6px;list-style:none;padding:0;margin:0}
& .ct-hobbies li{font-family:@mono@;font-size:11px;letter-spacing:.1em;text-transform:uppercase;border:1px solid @ink@;padding:5px 9px;margin:0}
@media (prefers-reduced-motion:reduce){& .ct-editors-item:hover .wp-block-image img{transform:none}}
"#;

const TICKER_CONTENT: &str = r#"&{margin-block:24px 40px}
&>.wp-block-heading{font-family:@display@;font-size:@h2-size@;font-weight:400;line-height:1.05;margin:0 0 8px}
&>.ct-badge{font-family:@mono@;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:@accent@;margin:0}
&>.ct-subtitle{font-family:@display@;font-size:@lede-size@;font-style:italic;max-width:40ch}
"#;

const SEASONS: &str = r#"&{display:grid!important;grid-template-columns:repeat(auto-fit,minmax(min(260px,100%),1fr));gap:16px;margin-block:40px}
&>.wp-block-heading{grid-column:1/-1}
&>.wp-block-group{padding:22px;display:flex;flex-direction:column;gap:10px;background:@surface@;margin:0}
&>.wp-block-group .wp-block-image{display:none}
&>.wp-block-group>.wp-block-heading{font-family:@display@;font-size:30px;font-weight:400;font-style:italic;margin:0;order:-1}
&>.wp-block-group .ct-category{font-family:@mono@;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:@muted@;order:-2;margin:0}
&>.wp-block-group .ct-intro{font-family:@display@;font-style:italic;font-size:18px;margin:0}
"#;

const GALLERY: &str = r#"&{background:@ink@;color:@paper@;padding:24px;counter-reset:ds-pic;display:flex;gap:12px;overflow-x:auto;scroll-snap-type:x mandatory}
& figure{counter-increment:ds-pic;flex:0 0 100%;scroll-snap-align:start;margin:0}
& figcaption::before{content:counter(ds-pic,decimal-leading-zero) " · ";font-family:@display@}
"#;

const ENTRIES: &str = r#"&{display:flex!important;flex-direction:column;gap:56px;margin-block:48px}
&>.ct-items-item{display:flex!important;flex-direction:column;gap:14px;border-top:1px solid @ink@;padding-top:24px;margin:0;max-width:820px}
&>.ct-items-item>*{margin:0!important;max-width:68ch}
&>.ct-items-item:has(>.wp-block-image){display:grid!important;grid-template-columns:repeat(12,minmax(0,1fr));column-gap:@gutter@;row-gap:14px;align-items:start;max-width:none}
&>.ct-items-item:has(>.wp-block-image)>*{grid-column:6 / span 7}
&>.ct-items-item>.wp-block-image{grid-column:1 / span 5;grid-row:1 / span 12;margin:0;overflow:hidden;position:relative}
&>.ct-items-item>.wp-block-image img{width:100%;aspect-ratio:@r-stay@;object-fit:cover;display:block;transition:transform var(--ds-dur-slow) var(--ds-ease-tide)}
&>.ct-items-item:hover>.wp-block-image img{transform:scale(1.04)}
&>.ct-items-item>.ct-category{order:-3;font-family:@mono@;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:@accent@}
&>.ct-items-item>.wp-block-heading{order:-2;font-family:@display@;font-size:clamp(28px,1.2vw + 18px,40px);font-weight:400;line-height:1.05;letter-spacing:-0.01em}
&>.ct-items-item>.ct-intro{order:-1;font-family:@display@;font-size:19px;font-style:italic;line-height:1.35;color:@muted@}
&>.ct-items-item>.ct-description{font-size:17px;line-height:1.65;max-width:62ch}
&>.ct-items-item>.ct-signature{font-family:@display@;font-style:italic;color:@muted@;font-size:16px}
&>.ct-items-item>.ct-village{order:-4;justify-self:start;align-self:flex-start;font-family:@body@;font-size:13px;font-weight:500;height:30px;padding:0 12px 0 10px;border-radius:@pill@;border:1px solid @ink@;display:inline-flex;align-items:center;gap:8px}
&>.ct-items-item>.ct-village::before{content:"";width:8px;height:8px;border-radius:50%;background:var(--ds-pigment,@accent@)}
&>.ct-items-item>.ct-google-rating,&>.ct-items-item>.ct-tripadvisor-rating,&>.ct-items-item>.ct-price-range{font-family:@mono@;font-size:13px;display:inline-block}
&>.ct-interludes-item{margin:0}
@media (max-width:@small@){&>.ct-items-item>*,&>.ct-items-item>.wp-block-image{grid-column:1 / -1;grid-row:auto}}
@media (prefers-reduced-motion:reduce){&>.ct-items-item:hover>.wp-block-image img{transform:none}}
"#;

const CONTENTS: &str = r#"&{display:flex;flex-direction:column;border-top:1px solid @ink@;counter-reset:ds-toc;font-size:15px}
& .ct-contents-label{font-family:@mono@;font-size:11px;letter-spacing:.14em;text-transform:uppercase;padding:14px 0 6px;margin:0}
& ol,& ul{list-style:none;margin:0;padding:0}
& li{counter-increment:ds-toc;margin:0}
& li a{display:grid;grid-template-columns:28px 1fr;gap:8px;padding:9px 0;color:@muted@;text-decoration:none;transition:color var(--ds-dur-quick),padding var(--ds-dur-base) var(--ds-ease-tide),box-shadow var(--ds-dur-base)}
& li a::before{content:counter(ds-toc,decimal-leading-zero);font-family:@mono@;font-size:12px}
& li a:hover{color:@ink@}
& li a.is-active{color:@ink@;font-weight:600;padding-left:12px;box-shadow:inset 2px 0 0 @accent@}
& li a.is-active::before{color:@accent@}
"#;

const BYLINE: &str = r#"&{display:flex!important;flex-wrap:wrap;align-items:center;gap:12px 20px;border-top:1px solid @ink@;border-bottom:1px solid @line@;padding:14px 0;margin-block:8px 32px}
& .ct-avatar{width:44px;height:44px;border-radius:50%;background:var(--ds-pigment,@surface@);display:inline-flex;align-items:center;justify-content:center;font-family:@display@;font-size:16px;margin:0}
& .ct-author{font-size:15px;font-weight:600;margin:0}
& .ct-dateline{font-family:@mono@;font-size:13px;color:@muted@;margin:0}
"#;

const RELATED: &str = r#"&{border-top:3px solid @ink@;display:flex;flex-direction:column;margin-block:64px 0;max-width:760px}
& .ct-related-label{font-family:@mono@;font-size:11px;letter-spacing:.14em;text-transform:uppercase;padding:14px 0;margin:0}
& ol{list-style:none;margin:0;padding:0;counter-reset:ds-rel}
& li{counter-increment:ds-rel;display:grid;grid-template-columns:40px 1fr;gap:4px 12px;padding:14px 0;border-top:1px solid @line@;margin:0}
& li::before{content:counter(ds-rel);grid-row:1 / span 2;font-family:@display@;font-size:28px;line-height:1;color:@accent@}
& li a{font-family:@display@;font-size:20px;line-height:1.2;color:@ink@;text-decoration:none;transition:color var(--ds-dur-quick)}
& li a:hover{color:@accent@}
& li .ct-related-meta{font-family:@mono@;font-size:11px;color:@muted@}
"#;

const TAG: &str = r#"&{display:inline-block;width:fit-content;align-self:flex-start;justify-self:start;font-family:@mono@;font-size:11px;letter-spacing:.12em;text-transform:uppercase;border:1px solid @ink@;padding:5px 9px;margin:0;line-height:1.2}
"#;

/// The template forms (module docs), with `@name@` placeholders.
pub const CSS: &str = r#"/* the design's components (theme-designer forms.rs) */
@keyframes ds-draw{from{transform:scaleY(0)}to{transform:scaleY(1)}}
@keyframes ds-rise{from{transform:translateY(105%)}to{transform:none}}
@keyframes ds-fadeup{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
@keyframes ds-progress{from{transform:scaleX(0)}to{transform:scaleX(1)}}
/* 05 masthead tide */
.wp-site-blocks>header.wp-block-template-part{position:sticky;top:0;z-index:50;transition:transform var(--ds-dur-base) var(--ds-ease-swell)}
.ds-masthead{transition:box-shadow var(--ds-dur-base) var(--ds-ease-swell),background-color var(--ds-dur-base)}
header.wp-block-template-part:has(.ds-masthead.ds-scrolled) .ds-masthead{box-shadow:@e1@}
header.wp-block-template-part:has(.ds-masthead.ds-hidden){transform:translateY(-100%)}
@media (prefers-reduced-motion:reduce){header.wp-block-template-part:has(.ds-masthead.ds-hidden){transform:none}}
/* 4.1 the main menu and its panels */
.ds-masthead,.ds-masthead .ds-masthead-row,.ds-masthead .wp-block-navigation.ds-nav-dots,.ds-masthead .ds-nav-dots .wp-block-navigation__container{position:static}
.ds-masthead{position:relative}
@media (min-width:600px){.ds-masthead .ds-nav-dots .wp-block-navigation__responsive-container,.ds-masthead .ds-nav-dots .wp-block-navigation__responsive-close,.ds-masthead .ds-nav-dots .wp-block-navigation__responsive-dialog,.ds-masthead .ds-nav-dots .wp-block-navigation__responsive-container-content{position:static!important}}
.ds-nav-dots .wp-block-navigation__container>.wp-block-navigation-item{position:static!important}
.ds-nav-dots .wp-block-navigation-submenu__toggle,.ds-nav-dots .wp-block-navigation__submenu-icon{display:none}
.ds-nav-dots .wp-block-navigation__container>.has-child>.wp-block-navigation__submenu-container{position:absolute!important;left:0!important;right:0!important;top:100%!important;width:auto!important;min-width:0!important;display:grid!important;grid-template-columns:3fr 2.5fr 2.5fr 3fr;grid-template-rows:repeat(5,auto);grid-auto-flow:column;column-gap:@gutter@;padding:32px max(var(--ds-margin),calc((100% - @container@) / 2))!important;background:var(--ds-tint,@surface@)!important;color:@ink@;border:0!important;box-shadow:@e2@;counter-reset:ds-sec;opacity:0;visibility:hidden;transform:translateY(-8px);transition:opacity 220ms var(--ds-ease-ebb),transform 220ms var(--ds-ease-ebb),visibility 0s linear 220ms;z-index:40}
.ds-nav-dots .wp-block-navigation__container>.has-child:hover>.wp-block-navigation__submenu-container,.ds-nav-dots .wp-block-navigation__container>.has-child:focus-within>.wp-block-navigation__submenu-container{opacity:1;visibility:visible;transform:none;height:auto!important;overflow:visible!important;transition:opacity var(--ds-dur-base) var(--ds-ease-swell) 120ms,transform var(--ds-dur-base) var(--ds-ease-swell) 120ms,visibility 0s linear 120ms}
.ds-nav-dots .wp-block-navigation__submenu-container>.wp-block-navigation-item{margin:0;width:auto;border-bottom:1px solid color-mix(in srgb,@ink@ 18%,transparent)}
.ds-nav-dots .wp-block-navigation__submenu-container>.wp-block-navigation-item:not(.ds-panel-head):not(.ds-featured){counter-increment:ds-sec}
.ds-nav-dots .wp-block-navigation__submenu-container .wp-block-navigation-item__content{display:flex!important;justify-content:space-between;align-items:center;min-height:44px;padding:0!important;font-family:@body@;font-size:16px;color:@ink@;text-decoration:none;gap:12px}
.ds-nav-dots .wp-block-navigation__submenu-container>.wp-block-navigation-item:not(.ds-panel-head):not(.ds-featured)>.wp-block-navigation-item__content::after{content:counter(ds-sec,decimal-leading-zero);font-family:@mono@;font-size:11px;color:@muted@}
.ds-nav-dots .wp-block-navigation__submenu-container>.wp-block-navigation-item>.wp-block-navigation-item__content::before{display:none}
.ds-panel-head{grid-column:1!important;grid-row:1 / span 5!important;border:0!important;align-self:start}
.ds-panel-head .wp-block-navigation-item__label{display:flex;flex-direction:column;gap:10px}
.ds-panel-no{font-family:@mono@;font-size:11px;letter-spacing:.14em;text-transform:uppercase}
.ds-panel-no::before{content:"Village "}
.ds-panel-name{font-family:@display@;font-size:56px;line-height:.95;font-style:italic;letter-spacing:-0.02em}
.ds-panel-line{font-family:@body@;font-size:14px;line-height:1.5;color:@muted@;white-space:normal}
.ds-featured{grid-column:4!important;grid-row:1 / span 5!important;border:0!important;align-self:start}
.ds-featured .wp-block-navigation-item__label{display:flex;flex-direction:column;gap:10px;white-space:normal}
.ds-featured-img{width:100%;aspect-ratio:@r-stay@;object-fit:cover;display:block}
.ds-featured .wp-block-navigation-item__label::before{content:"Featured";order:-2;font-family:@mono@;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:@accent@}
.ds-featured-img{order:-3}
.ds-featured-title{font-family:@display@;font-size:22px;line-height:1.15}
.ds-featured-title::after{content:" →";font-family:@body@;font-weight:600;font-size:14px}
.ds-lang-item{display:none!important}
.ds-nav-dots .wp-block-navigation__container>.wp-block-navigation-item>.wp-block-navigation-item__content .wp-block-navigation-item__label{background-image:linear-gradient(@accent@,@accent@);background-size:0 1px;background-position:0 100%;background-repeat:no-repeat;transition:background-size var(--ds-dur-base) var(--ds-ease-tide)}
.ds-nav-dots .wp-block-navigation__container>.current-menu-item>.wp-block-navigation-item__content,.ds-nav-dots .wp-block-navigation__container>.current-menu-ancestor>.wp-block-navigation-item__content{color:@accent@}
.ds-nav-dots .wp-block-navigation__container>.current-menu-item>.wp-block-navigation-item__content .wp-block-navigation-item__label,.ds-nav-dots .wp-block-navigation__container>.current-menu-ancestor>.wp-block-navigation-item__content .wp-block-navigation-item__label,.ds-nav-dots .wp-block-navigation__container>.wp-block-navigation-item:hover>.wp-block-navigation-item__content .wp-block-navigation-item__label{background-size:100% 1px}
@media (prefers-reduced-motion:reduce){.ds-nav-dots .wp-block-navigation__container>.has-child>.wp-block-navigation__submenu-container{transform:none!important;transition:opacity var(--ds-dur-quick) linear,visibility 0s!important}}
/* 4.20 the phone's menu sheet */
@media (max-width:@small@){.ds-nav-dots .wp-block-navigation__responsive-container-open{width:44px;height:44px;display:inline-flex;align-items:center;justify-content:center}}
@media (min-width:@md@){.ds-masthead-row{flex-wrap:nowrap;gap:12px 24px}.ds-masthead-row>.ds-nav-dots{flex:1 1 auto;justify-content:center}.ds-masthead .ds-nav-dots .wp-block-navigation__container{flex-wrap:nowrap;gap:4px 20px!important}.ds-masthead-end{flex-wrap:nowrap;gap:12px}.ds-masthead .ds-wordmark{white-space:nowrap}}
@media (max-width:@small@){.ds-masthead-row{flex-wrap:nowrap;gap:8px}.ds-masthead-row>.ds-wordmark,.ds-masthead-row>.wp-block-navigation:first-child{flex:1 1 auto;order:1}.ds-masthead-end{order:2;flex-wrap:nowrap}.ds-masthead-row>.ds-nav-dots{order:3;flex:0 0 auto}}
/* the page's own content on the grid's left, at its measure (the design is set flush left) */
.wp-block-post-content.ds-prose-wide>*,.wp-block-post-content.ds-prose-article>*,.wp-block-post-content .is-layout-constrained>*{margin-left:0!important;margin-right:auto!important}
.wp-block-post-content.ds-prose-wide>*{max-width:min(100%,1100px)}
.wp-block-post-content p{max-width:68ch}
.ds-nav-dots .wp-block-navigation__responsive-container.is-menu-open{background:@paper@!important;color:@ink@!important;padding:0!important;animation:ds-sheet var(--ds-dur-base) var(--ds-ease-swell)}
@keyframes ds-sheet{from{transform:translateY(-16px);opacity:0}to{transform:none;opacity:1}}
.ds-nav-dots .is-menu-open .wp-block-navigation__responsive-container-close{top:10px;right:16px;width:44px;height:44px}
.ds-nav-dots .is-menu-open .wp-block-navigation__responsive-container-content{padding:64px 0 0!important;gap:0!important;align-items:stretch!important;counter-reset:ds-place}
.ds-nav-dots .is-menu-open .wp-block-navigation__container{gap:0!important;align-items:stretch!important;width:100%;flex-direction:row!important;flex-wrap:wrap!important}
.ds-nav-dots .is-menu-open .wp-block-navigation__container>.wp-block-navigation-item:not(.ds-lang-item){counter-increment:ds-place;border-bottom:1px solid @line@;width:100%;display:flex!important;flex-direction:row!important;flex-wrap:wrap;align-items:center!important}
.ds-nav-dots .is-menu-open .wp-block-navigation__container>.wp-block-navigation-item:not(.ds-lang-item)>.wp-block-navigation-item__content{flex:1 1 auto;display:flex!important;align-items:center;gap:12px;height:64px;padding:0 0 0 20px!important;font-family:@display@;font-size:28px;font-style:italic;justify-content:flex-start}
.ds-nav-dots .is-menu-open .wp-block-navigation__container>.wp-block-navigation-item:not(.ds-lang-item)>.wp-block-navigation-item__content::after{content:counter(ds-place,decimal-leading-zero);margin-left:auto;font-family:@mono@;font-style:normal;font-size:12px}
.ds-nav-dots .is-menu-open .wp-block-navigation__container>.wp-block-navigation-item>.wp-block-navigation-item__content::before{width:10px;height:10px;margin:0}
.ds-nav-dots .is-menu-open .wp-block-navigation-submenu__toggle{display:inline-flex!important;align-items:center;justify-content:center;width:44px;height:64px;padding:0 16px 0 8px!important;margin:0!important;position:static!important;background:none;border:0;color:@ink@}
.ds-nav-dots .is-menu-open .wp-block-navigation-submenu__toggle svg{width:12px;height:12px;transform:none!important;transition:transform var(--ds-dur-base) var(--ds-ease-tide)}
.ds-nav-dots .is-menu-open .ds-open>.wp-block-navigation-submenu__toggle svg{transform:rotate(180deg)!important}
.ds-nav-dots .is-menu-open .wp-block-navigation__container>.has-child>.wp-block-navigation__submenu-container{flex:0 0 100%;position:static!important;display:grid!important;grid-template-columns:1fr 1fr;grid-template-rows:none;grid-auto-flow:row;padding:0 20px 16px!important;opacity:1!important;visibility:visible!important;transform:none!important;box-shadow:none!important;background:var(--ds-tint,@surface@)!important;width:100%!important;height:auto!important}
.ds-js .ds-nav-dots .is-menu-open .wp-block-navigation__container>.has-child:not(.ds-open)>.wp-block-navigation__submenu-container{display:none!important}
.ds-nav-dots .is-menu-open .ds-panel-head,.ds-nav-dots .is-menu-open .ds-featured{display:none!important}
.ds-nav-dots .is-menu-open .wp-block-navigation__submenu-container>.wp-block-navigation-item{grid-column:auto!important;grid-row:auto!important}
.ds-nav-dots .is-menu-open .ds-lang-item{display:inline-flex!important;width:auto!important;border:0!important;padding:16px 0 0 20px}
.ds-nav-dots .is-menu-open .ds-lang-item>.wp-block-navigation-item__content{font-family:@mono@;font-size:12px;letter-spacing:.1em;padding:4px 0!important;height:auto!important}
.ds-nav-dots .is-menu-open .ds-lang-item>.wp-block-navigation-item__content::before{display:none!important}
.ds-nav-dots .is-menu-open .ds-lang-item.current-menu-item .wp-block-navigation-item__content{border-bottom:1px solid @ink@}
@media (max-width:@small@){.ds-masthead .ds-lang,.ds-masthead .ds-masthead-end .wp-block-navigation[class*="ds-btn-"]{display:none}}
/* 4.9 the page header and its breadcrumb */
.wp-block-breadcrumbs,.ds-crumbs{font-family:@mono@;font-size:12px;letter-spacing:.06em;color:@muted@;margin:0}
.wp-block-breadcrumbs ol{display:flex;flex-wrap:wrap;gap:10px;list-style:none;margin:0;padding:0}
.wp-block-breadcrumbs a{color:@muted@;text-decoration:none;display:inline-flex;align-items:center;gap:6px}
.wp-block-breadcrumbs a[href*="/"]:not([href="/"])::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--ds-dot,transparent);display:var(--ds-dot-display,inline-block)}
.wp-block-breadcrumbs [aria-current]{color:@ink@}
.ds-page-head{border-top:1px solid @ink@;padding-top:20px}
.ds-page-head .ds-dateline,.ds-page-head .ds-meta-row{display:flex;flex-wrap:wrap;gap:8px 20px;font-family:@mono@;font-size:13px;color:@muted@;border-top:1px solid @line@;padding-top:14px;margin:0}
.ds-page-head .ds-meta-row>*{margin:0}
.ds-page-head .wp-block-post-title em{color:@link@}
/* 4.18 badges */
.ds-badge{display:inline-flex;align-self:flex-start;font-family:@mono@;font-size:11px;letter-spacing:.12em;text-transform:uppercase;padding:6px 10px;border:1px solid @ink@;margin:0;line-height:1.2}
.ds-badge-new{background:@highlight@;border-color:@highlight@}
.ds-badge-closed{background:@ink@;color:@paper@}
.ds-badge-card{background:@link@;border-color:@link@;color:@paper@}
.ds-badge-alert{background:@accent@;border-color:@accent@;color:@paper@}
/* 4.10 the contents rail and the reading progress */
.ds-article{display:grid;grid-template-columns:minmax(0,1fr) minmax(220px,300px);column-gap:48px;align-items:start}
.ds-article>.wp-block-post-content{grid-column:1;min-width:0}
.ds-article{padding-top:clamp(16px,2vw,32px)}
.ds-article .wp-block-post-content>.ct-blog-article{display:contents}
.ds-article .wp-block-post-content .ct-contents{position:sticky;top:96px}
@media (min-width:@md@){.ds-article .wp-block-post-content{display:grid;grid-template-columns:minmax(0,1fr) minmax(220px,280px);column-gap:48px;align-items:start}.ds-article .wp-block-post-content>*,.ds-article .wp-block-post-content>.ct-blog-article>*{grid-column:1;margin-left:0!important}.ds-article .wp-block-post-content>.ct-blog-article>.ct-contents{grid-column:2;grid-row:1 / span 60}}
.ds-article>.wp-block-post-content{grid-column:1 / -1}
.ds-progress{position:fixed;left:0;right:0;top:0;height:3px;z-index:60;background:@surface@;margin:0!important;pointer-events:none}
.ds-progress::after{content:"";position:absolute;inset:0;background:@accent@;transform-origin:left;transform:scaleX(var(--ds-progress,0))}
@supports (animation-timeline:scroll()){.ds-progress::after{animation:ds-progress linear both;animation-timeline:scroll(root)}}
/* 4.17 pagination */
.wp-block-query-pagination{display:flex;align-items:center;gap:4px;margin-top:40px;font-family:@mono@;font-size:14px}
.wp-block-query-pagination a,.wp-block-query-pagination .page-numbers{width:44px;height:44px;display:inline-flex;align-items:center;justify-content:center;border-radius:50%;color:@ink@;text-decoration:none;transition:background-color var(--ds-dur-quick)}
.wp-block-query-pagination a:hover{background:@surface@}
.wp-block-query-pagination .page-numbers.current{background:@ink@;color:@paper@}
/* 4.19 empty, 404 */
.ds-empty{display:flex;flex-direction:column;gap:20px;max-width:60ch}
.ds-empty .wp-block-search{max-width:520px}
/* 4.11 search: the masthead's opener and the overlay (with the enhancement script) */
.ds-search{margin:0}
.ds-search .wp-block-search__inside-wrapper{border:0;padding:0}
.ds-search .wp-block-search__button{width:44px;height:44px;border-radius:50%;border:1px solid @line@;background:transparent;padding:0;display:inline-flex;align-items:center;justify-content:center;color:@ink@}
.ds-search .wp-block-search__input{display:none}
html:not(.ds-js) .ds-search{display:none}
.ds-search-overlay{position:fixed;inset:0;z-index:100;background:color-mix(in srgb,@ink@ 35%,transparent);display:flex;align-items:flex-start;justify-content:center;padding-top:10vh}
.ds-search-overlay[hidden]{display:none}
.ds-search-panel{width:min(1100px,calc(100% - 32px));background:@surface@;box-shadow:@e2@;padding:32px;display:flex;flex-direction:column;gap:16px;position:relative}
.ds-search-label{font-family:@mono@;font-size:11px;letter-spacing:.14em;text-transform:uppercase}
.ds-search-panel input{all:unset;border-bottom:2px solid @ink@;padding-bottom:12px;font-family:@display@;font-size:clamp(28px,3vw,48px);color:@ink@}
.ds-search-close{position:absolute;right:16px;top:12px;width:44px;height:44px;border:0;background:transparent;font-size:28px;cursor:pointer;color:@ink@}
.ds-search-results{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:8px 24px;max-height:60vh;overflow:auto}
.ds-search-results ul{list-style:none;margin:0;padding:0}
.ds-search-results a{display:flex;align-items:center;min-height:44px;border-bottom:1px solid color-mix(in srgb,@ink@ 18%,transparent);color:@ink@;text-decoration:none;padding:0 10px}
.ds-search-results a.is-active{box-shadow:inset 2px 0 0 @accent@;background:color-mix(in srgb,@paper@ 70%,transparent)}
.ds-search-results mark{background:@highlight@;color:@ink@}
.ds-search-group{font-family:@mono@;font-size:11px;letter-spacing:.14em;text-transform:uppercase;margin:8px 0 4px}
/* 4.6 the essentials ticker (filled at export) */
.ds-ticker,.sp-essentials{background:@dark-bg@;color:@dark-text@;padding:20px 24px;display:flex;flex-direction:column;gap:16px}
.ds-ticker-head{display:flex;justify-content:space-between;gap:12px;font-family:@mono@;font-size:11px;letter-spacing:.14em;text-transform:uppercase;margin:0}
.ds-ticker-head>:first-child{color:@dark-accent@}
.ds-ticker-head>:last-child{opacity:.7;text-transform:none;letter-spacing:0}
.ds-ticker-values{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin:0}
.ds-ticker-values>*{display:flex;flex-direction:column;gap:4px;margin:0}
.ds-ticker .ds-count{font-family:@display@;font-size:clamp(32px,2vw + 16px,48px);line-height:1;font-variant-numeric:tabular-nums}
.ds-ticker .ds-meta{color:color-mix(in srgb,@dark-text@ 62%,transparent);font-size:11px;text-transform:uppercase}
.ds-ticker-source{font-family:@mono@;font-size:11px;opacity:.7;margin:0}
.ds-ticker-source a{color:inherit}
/* 7.4 the week ahead (filled at export) */
.sp-forecast-table table{width:100%;border-collapse:collapse;font-family:@body@}
.sp-forecast-table th{font-family:@mono@;font-size:11px;letter-spacing:.12em;text-transform:uppercase;text-align:left;font-weight:500;padding:0 16px 10px 0;border-bottom:1px solid @ink@}
.sp-forecast-table td,.sp-forecast-table tbody th{padding:14px 16px 14px 0;border-bottom:1px solid @line@;font-size:15px;vertical-align:middle}
.sp-forecast-table tbody th{font-family:@mono@;font-size:13px;font-weight:500;text-transform:none;letter-spacing:0}
.sp-forecast-table tr:hover{background:@surface@}
.ct-wx{display:inline-flex;align-items:center;gap:10px}
.ct-wx::before{content:"";width:24px;height:24px;background:currentColor;-webkit-mask:var(--ds-i) center/contain no-repeat;mask:var(--ds-i) center/contain no-repeat}
.ct-range{display:flex;align-items:center;gap:10px;font-family:@mono@;font-size:13px;font-variant-numeric:tabular-nums;min-width:180px}
.ct-range-bar{position:relative;flex:1;height:4px;background:@surface@;border-radius:999px}
.ct-range-bar::after{content:"";position:absolute;top:0;bottom:0;left:var(--lo);right:calc(100% - var(--hi));background:@accent@;border-radius:999px}
.ct-rain-high{color:@link@;font-weight:600}
.sp-forecast-table figcaption{font-family:@mono@;font-size:11px;color:@muted@}
/* 7.1 the listing bar's filter chips (with the enhancement script) */
.ds-filter{display:flex;flex-wrap:wrap;gap:8px}
.ds-filter-chip{height:40px;padding:0 16px;border-radius:@pill@;border:1px solid @ink@;background:transparent;font-family:@body@;font-weight:500;font-size:14px;color:@ink@;cursor:pointer;transition:background-color var(--ds-dur-quick) var(--ds-ease-tide),color var(--ds-dur-quick)}
.ds-filter-chip:hover{background:@surface@}
.ds-filter-chip[aria-pressed="true"]{background:@ink@;color:@paper@}
.ds-filter-chip:focus-visible{outline:2px solid @ink@;outline-offset:3px;box-shadow:0 0 0 7px @highlight@}
.wp-block-post-template.ds-fading{opacity:0;transition:opacity var(--ds-dur-quick) linear}
.wp-block-post-template{transition:opacity var(--ds-dur-quick) linear}
@media (min-width:@md@){.ds-bar{position:sticky;top:76px;z-index:20;background:@paper@}}
/* Notte at night (the enhancement script sets ds-night from 20:00 to 06:00 on the pages the scheme names) */
.ds-night .ds-notte-at-night,.ds-night body:has(.ds-notte-at-night){background:@dark-bg@;color:@dark-text@}
.ds-night .ds-notte-at-night a,.ds-night .ds-notte-at-night .wp-block-heading{color:@dark-text@}
"#;

/// The motion sheet's micro-interactions (05), each with its reduced-motion fallback.
pub const MOTION: &str = r#"/* 05 micro-interactions (theme-designer forms.rs) */
/* 01 link underline draw / reduced: underline always on */
.wp-block-post-content a:not(.wp-block-button__link),.ds-more a,.ds-footer-col .wp-block-navigation-item__content{text-decoration:none;background-image:linear-gradient(currentColor,currentColor);background-size:0 1px;background-position:0 100%;background-repeat:no-repeat;transition:background-size var(--ds-dur-base) var(--ds-ease-tide),color var(--ds-dur-quick)}
.wp-block-post-content a:not(.wp-block-button__link){background-size:100% 1px}
.wp-block-post-content a:not(.wp-block-button__link):hover,.ds-more a:hover,.ds-footer-col .wp-block-navigation-item__content:hover{background-size:100% 1px;color:@accent@}
/* 02 card lift / reduced: underline only */
.ds-card-img img,.ds-tile img,.ds-feature img{transition:transform var(--ds-dur-slow) var(--ds-ease-tide)}
.wp-block-post-template>li:hover .ds-card-img img,.wp-block-post-template>li:hover .ds-tile img{transform:scale(1.04)}
.wp-block-post-template>li .wp-block-post-title a{background-image:linear-gradient(currentColor,currentColor);background-size:0 1px;background-position:0 100%;background-repeat:no-repeat;transition:background-size var(--ds-dur-base) var(--ds-ease-tide)}
.wp-block-post-template>li:hover .wp-block-post-title a{background-size:100% 1px}
/* 03 button reply / reduced: colour only */
.wp-block-button[class*="ds-btn-"] .wp-block-button__link,.wp-block-navigation[class*="ds-btn-"] .wp-block-navigation-item__content{transition:background-color var(--ds-dur-quick) var(--ds-ease-tide),color var(--ds-dur-quick),border-color var(--ds-dur-quick),transform var(--ds-dur-press) var(--ds-ease-tide)}
.wp-block-button[class*="ds-btn-"] .wp-block-button__link::after,.wp-block-navigation[class*="ds-btn-"] .wp-block-navigation-item__content::after{transition:transform var(--ds-dur-base) var(--ds-ease-tide)}
.wp-block-button[class*="ds-btn-"] .wp-block-button__link:hover::after,.wp-block-navigation[class*="ds-btn-"] .wp-block-navigation-item__content:hover::after{transform:translateX(4px)}
.wp-block-button[class*="ds-btn-"] .wp-block-button__link:active,.wp-block-navigation[class*="ds-btn-"] .wp-block-navigation-item__content:active{transform:scale(.98)}
.wp-block-navigation.ds-btn-secondary .wp-block-navigation-item__content:hover{background:@ink@;color:@paper@}
.wp-block-navigation.ds-btn-light .wp-block-navigation-item__content:hover{background:@highlight@;border-color:@highlight@;color:@ink@}
a:focus-visible,button:focus-visible,summary:focus-visible,.wp-block-navigation-item__content:focus-visible,.wp-block-button__link:focus-visible{outline:2px solid @ink@;outline-offset:3px;box-shadow:0 0 0 7px @highlight@}
/* 04 village chip flood / reduced: instant fill */
.ds-chip{isolation:isolate;overflow:hidden}
.ds-chip::before{transition:transform var(--ds-dur-base) var(--ds-ease-tide)}
.wp-block-post-template>li:hover .ds-chip:not(.ds-eyebrow)::before{transform:scale(40);opacity:.55}
/* 07 hero headline / reduced: static */
@media (prefers-reduced-motion:no-preference){.ds-hero h1{animation:ds-fadeup var(--ds-dur-tide) var(--ds-ease-tide) both}.ds-hero .ds-lede{animation:ds-fadeup var(--ds-dur-slow) var(--ds-ease-tide) 420ms both}}
/* 08 image wipe-in (with the enhancement script; once per session) / reduced: static */
.ds-wipe-ready{clip-path:inset(0 0 100% 0)}
.ds-wipe-ready.ds-in{clip-path:inset(0);transition:clip-path var(--ds-dur-slow) var(--ds-ease-swell)}
/* 09 essentials count-up: the enhancement script; reduced: final values */
/* 10 reading progress: .ds-progress (kept under reduced motion: no motion) */
/* 11 filter indicator: .ds-filter-chip and .ds-fading; reduced: jump and fade */
/* 12 save to trip: the site has no trip planner (reported unused) */
@media (prefers-reduced-motion:reduce){
.wp-block-post-content a:not(.wp-block-button__link),.ds-more a,.ds-footer-col .wp-block-navigation-item__content{background-size:100% 1px!important;transition:none}
.wp-block-post-template>li:hover .ds-card-img img,.wp-block-post-template>li:hover .ds-tile img{transform:none}
.wp-block-button[class*="ds-btn-"] .wp-block-button__link:hover::after,.wp-block-navigation[class*="ds-btn-"] .wp-block-navigation-item__content:hover::after{transform:none}
.wp-block-button[class*="ds-btn-"] .wp-block-button__link:active,.wp-block-navigation[class*="ds-btn-"] .wp-block-navigation-item__content:active{transform:none}
.ds-chip::before{transition:none}
.ds-wipe-ready{clip-path:none}
*,*::before,*::after{scroll-behavior:auto!important}
}
"#;
