//! The deterministic part of the theme: global styles from the design's tokens, fonts from
//! the bundle's files, menus from the design's menus (ADR-0093).
//!
//! - **Palette**: every colour token (the main scheme and the others) as a preset; its slug
//!   is the token's name without `--` and without the prefix all main colours share
//!   (`--ct-ink` → `ink`, `--notte` → `notte`). The roles (`text`, `background`, `link`,
//!   `accent`, …) are named in `settings.custom.roles` and drive `styles`.
//! - **Type**: font families by slug (`bodoni-moda`) with the design's stacks; one font size
//!   preset per type token (`h1`, `eyebrow`) with its fluid range from the token's
//!   `clamp()`; what `theme.json` cannot say per size (line height, tracking, case, family)
//!   goes on the size's class in the custom CSS (`.has-eyebrow-font-size`).
//! - **Space and shape**: spacing presets per spacing token, shadows per elevation, radii,
//!   motion, breakpoints and ratios as `settings.custom` (CSS custom properties), the layout's
//!   wide size from the grid's container and its content size eight of its columns.
//! - **Fonts**: per family, one face per weight and style (the Latin subset: the face whose
//!   `unicode-range` covers U+0000-00FF, else one without a range), its file an
//!   [`AssetRef`] with the bundle's SHA-256.
//! - **Menus**: per design menu and site language, its items' links resolved against the
//!   site's pages by label (a link the design wrote that is not `#` is kept); an item
//!   without a page is left out with a note; a menu with no item left is not written.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::{json, Map, Value};
use site_design::bundle::BundleManifest;
use site_design::model::{ColourRole, ColourToken, FontRole, SiteDesign};
use site_design::wordpress::{
    valid_slug, AssetRef, GlobalStyles, NavigationItem, NavigationMenu, ThemeFontFace,
    ThemeFontFamily, THEME_JSON_VERSION,
};

use crate::model::{Issue, IssueCode, Presets, SiteContext};

/// `Bodoni Moda` → `bodoni-moda`; `Food & Drink` → `food-drink`; `h1` → `h-1`: letters and
/// digits apart, as WordPress writes a slug in class names and custom properties
/// ([`wp_kebab`]), so a preset is spelled the same in attributes, classes and CSS.
pub fn slugify(s: &str) -> String {
    wp_kebab(&plain_slug(s))
}

fn plain_slug(s: &str) -> String {
    let mut out = String::new();
    let mut dash = false;
    for c in s.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
            dash = false;
        } else if !out.is_empty() && !dash {
            out.push('-');
            dash = true;
        }
    }
    while out.ends_with('-') {
        out.pop();
    }
    out.truncate(64);
    while out.ends_with('-') {
        out.pop();
    }
    out
}

/// A preset slug as WordPress writes it in class names and CSS custom properties (lodash's
/// `kebabCase`, `_wp_to_kebab_case`): letters and digits apart (`h1` → `h-1`, `e1` → `e-1`;
/// `space-1`, `display-xl` stay).
pub fn wp_kebab(slug: &str) -> String {
    let mut out = String::new();
    let mut prev: Option<char> = None;
    for c in slug.chars() {
        if let Some(p) = prev {
            let boundary = (p.is_ascii_alphabetic() && c.is_ascii_digit())
                || (p.is_ascii_digit() && c.is_ascii_alphabetic());
            if boundary {
                out.push('-');
            }
        }
        out.push(c);
        prev = Some(c);
    }
    out
}

/// A label as menus are matched: lower-case words, `&` as `and`.
pub fn label_key(s: &str) -> String {
    slugify(&s.replace('&', " and "))
}

fn title_case(slug: &str) -> String {
    slug.split('-')
        .filter(|w| !w.is_empty())
        .map(|w| {
            let mut c = w.chars();
            c.next()
                .map(|f| f.to_uppercase().chain(c).collect::<String>())
                .unwrap_or_default()
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// The prefix every main colour shares (`ct-` of `--ct-ink`, `--ct-paper`), if any.
fn shared_prefix(colours: &[ColourToken]) -> Option<String> {
    let first = colours.first()?.name.strip_prefix("--")?;
    let (p, _) = first.split_once('-')?;
    let prefix = format!("{p}-");
    colours
        .iter()
        .all(|c| {
            c.name
                .strip_prefix("--")
                .is_some_and(|n| n.starts_with(&prefix))
        })
        .then_some(prefix)
}

/// The palette slug of a colour token (module docs).
pub fn palette_slug(name: &str, prefix: Option<&str>) -> String {
    let n = name.strip_prefix("--").unwrap_or(name);
    let n = prefix.and_then(|p| n.strip_prefix(p)).unwrap_or(n);
    slugify(n)
}

/// The palette: `(slug, name, hex, role)` in the design's order, the main scheme first.
pub fn palette(design: &SiteDesign) -> Vec<(String, String, String, ColourRole)> {
    let prefix = shared_prefix(&design.tokens.colours);
    let mut out: Vec<(String, String, String, ColourRole)> = Vec::new();
    let mut seen = BTreeSet::new();
    let mut add = |c: &ColourToken, prefix: Option<&str>| {
        let slug = palette_slug(&c.name, prefix);
        if !valid_slug(&slug) || !seen.insert(slug.clone()) {
            return;
        }
        let name = c.label.clone().unwrap_or_else(|| title_case(&slug));
        out.push((slug, name, c.value.to_ascii_uppercase(), c.role));
    };
    for c in &design.tokens.colours {
        add(c, prefix.as_deref());
    }
    for s in &design.tokens.schemes {
        for c in &s.colours {
            // A scheme's colours keep their own names (`--notte`).
            add(c, None);
        }
    }
    out
}

/// A colour token name (`--ct-calce`, `--notte`) as its palette slug, when the palette has it.
pub fn colour_preset(design: &SiteDesign, token: &str) -> Option<String> {
    let all: Vec<&ColourToken> = design
        .tokens
        .colours
        .iter()
        .chain(design.tokens.schemes.iter().flat_map(|s| s.colours.iter()))
        .collect();
    let prefix = shared_prefix(&design.tokens.colours);
    let main = design.tokens.colours.iter().any(|c| c.name == token);
    all.iter().find(|c| c.name == token).map(|c| {
        if main {
            palette_slug(&c.name, prefix.as_deref())
        } else {
            palette_slug(&c.name, None)
        }
    })
}

/// The first family of a CSS stack, unquoted (`'Bodoni Moda', Georgia` → `Bodoni Moda`).
pub fn first_family(stack: &str) -> String {
    stack
        .split(',')
        .next()
        .unwrap_or("")
        .trim()
        .trim_matches(|c| c == '\'' || c == '"')
        .to_string()
}

/// `clamp(72px, 9vw + 30px, 160px)` → `("72px", "160px")`.
pub fn clamp_range(fluid: &str) -> Option<(String, String)> {
    let inner = fluid.trim().strip_prefix("clamp(")?.strip_suffix(')')?;
    let mut depth = 0i32;
    let mut parts = Vec::new();
    let mut cur = String::new();
    for c in inner.chars() {
        match c {
            '(' => {
                depth += 1;
                cur.push(c);
            }
            ')' => {
                depth -= 1;
                cur.push(c);
            }
            ',' if depth == 0 => {
                parts.push(cur.trim().to_string());
                cur.clear();
            }
            _ => cur.push(c),
        }
    }
    parts.push(cur.trim().to_string());
    if parts.len() != 3 {
        return None;
    }
    let unit = |v: &str| v.ends_with("px") || v.ends_with("rem") || v.ends_with("em");
    (unit(&parts[0]) && unit(&parts[2])).then(|| (parts[0].clone(), parts[2].clone()))
}

/// Pixels of `16px` (whole pixels; `rem` as 16 px).
pub fn px(v: &str) -> Option<u32> {
    let v = v.trim();
    if let Some(n) = v.strip_suffix("px") {
        return n.trim().split('.').next()?.parse().ok();
    }
    if let Some(n) = v.strip_suffix("rem") {
        let whole: u32 = n.trim().split('.').next()?.parse().ok()?;
        return Some(whole * 16);
    }
    None
}

/// The text colour that reads best on `bg` among the palette's text and background roles.
fn best_on(presets: &Presets, bg: &str) -> Option<String> {
    let bg_hex = presets.colors.get(bg)?;
    let candidates: Vec<&String> = presets
        .colors
        .keys()
        .filter(|k| {
            ["text", "background", "inverse"]
                .iter()
                .any(|r| presets.role(r) == Some(k.as_str()))
        })
        .collect();
    candidates
        .into_iter()
        .filter(|c| c.as_str() != bg)
        .max_by_key(|c| {
            presets
                .colors
                .get(c.as_str())
                .and_then(|h| site_design::contrast_x100(h, bg_hex))
                .unwrap_or(0)
        })
        .cloned()
}

/// What the deterministic part makes.
#[derive(Clone, Debug, PartialEq)]
pub struct Styles {
    pub global_styles: GlobalStyles,
    pub presets: Presets,
    pub fonts: Vec<ThemeFontFamily>,
    pub notes: Vec<Issue>,
}

/// Global styles, presets and fonts from the design's tokens (module docs).
pub fn styles(design: &SiteDesign, manifest: &BundleManifest) -> Styles {
    let t = &design.tokens;
    let mut notes = Vec::new();
    let mut presets = Presets::default();

    // --- palette and roles
    let pal = palette(design);
    let mut palette_json = Vec::new();
    for (slug, name, hex, role) in &pal {
        presets.colors.insert(slug.clone(), hex.clone());
        palette_json.push(json!({"slug": slug, "name": name, "color": hex}));
        let key = match role {
            ColourRole::Background => "background",
            ColourRole::Surface => "surface",
            ColourRole::Text => "text",
            ColourRole::TextMuted => "muted",
            ColourRole::Accent => "accent",
            ColourRole::Link => "link",
            ColourRole::Highlight => "highlight",
            ColourRole::Border => "border",
            ColourRole::Pigment | ColourRole::Other => continue,
        };
        presets
            .roles
            .entry(key.to_string())
            .or_insert_with(|| slug.clone());
    }
    // The main scheme's roles first; a dark scheme's text is the inverse text.
    for s in &t.schemes {
        for c in &s.colours {
            if c.role == ColourRole::Text {
                if let Some(slug) = colour_preset(design, &c.name) {
                    presets.roles.entry("inverse".into()).or_insert(slug);
                }
            }
        }
    }
    let role = |r: &str| presets.roles.get(r).cloned();

    // --- type
    let mut families = Vec::new();
    let mut family_of_role: BTreeMap<&str, String> = BTreeMap::new();
    let mut family_slug: BTreeMap<String, String> = BTreeMap::new();
    for f in &t.fonts {
        let slug = slugify(&f.name);
        if !valid_slug(&slug) {
            continue;
        }
        presets.font_families.insert(slug.clone());
        family_slug.insert(f.name.clone(), slug.clone());
        families.push(json!({"slug": slug, "name": f.name, "fontFamily": f.stack}));
        let r = match f.role {
            FontRole::Display => "display",
            FontRole::Body => "body",
            FontRole::Meta => "meta",
            FontRole::Other => "other",
        };
        family_of_role.entry(r).or_insert(slug);
    }
    let body_family = family_of_role
        .get("body")
        .or_else(|| family_of_role.values().next())
        .cloned();
    let display_family = family_of_role
        .get("display")
        .cloned()
        .or(body_family.clone());
    let mut sizes = Vec::new();
    let mut size_css = String::new();
    for ty in &t.type_scale {
        let slug = slugify(&ty.name);
        if !valid_slug(&slug) {
            continue;
        }
        presets.font_sizes.insert(slug.clone());
        if px(&ty.size).is_some_and(|p| p >= 24) {
            presets.large_sizes.insert(slug.clone());
        }
        // A fluid size is the design's own `clamp()`, verbatim: WordPress's fluid formula (its
        // own viewport range) gives other sizes between the ends, and a headline set for the
        // design's measure breaks into more lines (the home's h1 at 1280 px).
        let mut size = json!({"slug": slug, "name": title_case(&slug), "size": ty.size});
        if let Some(f) = ty.fluid.as_deref().filter(|f| clamp_range(f).is_some()) {
            size["size"] = json!(f.trim());
        }
        size["fluid"] = json!(false);
        sizes.push(size);
        // What the size's class adds (theme.json's sizes carry the size only).
        let mut decl = Vec::new();
        if let Some(lh) = &ty.line_height {
            decl.push(format!("line-height:{lh}"));
        }
        if let Some(tr) = &ty.tracking {
            decl.push(format!("letter-spacing:{tr}"));
        }
        if let Some(tf) = &ty.transform {
            decl.push(format!("text-transform:{tf}"));
        }
        if let Some(w) = &ty.weight {
            decl.push(format!("font-weight:{w}"));
        }
        if let Some(s) = &ty.style {
            decl.push(format!("font-style:{s}"));
        }
        if let Some(fam) = ty.family.as_ref().and_then(|f| family_slug.get(f)) {
            decl.push(format!(
                "font-family:var(--wp--preset--font-family--{})",
                wp_kebab(fam)
            ));
        }
        if !decl.is_empty() {
            size_css.push_str(&format!(
                ".has-{}-font-size{{{}}}\n",
                wp_kebab(&slug),
                decl.join(";")
            ));
        }
    }

    // --- space, shape, motion
    let mut spacing = Vec::new();
    for s in &t.spacing {
        let slug = slugify(&s.name);
        if valid_slug(&slug) {
            presets.spacing.insert(slug.clone());
            spacing.push(json!({"slug": slug, "name": title_case(&slug), "size": s.value}));
        }
    }
    let mut shadows = Vec::new();
    for e in &t.elevations {
        let slug = slugify(&e.name);
        if valid_slug(&slug) {
            presets.shadows.insert(slug.clone());
            shadows.push(json!({"slug": slug, "name": title_case(&slug), "shadow": e.value}));
        }
    }
    let mut custom = Map::new();
    let named = |list: &[site_design::model::SizeToken]| -> Value {
        Value::Object(
            list.iter()
                .filter_map(|s| {
                    let k = slugify(&s.name);
                    valid_slug(&k).then(|| (k, Value::String(s.value.clone())))
                })
                .collect(),
        )
    };
    if !t.radii.is_empty() {
        custom.insert("radius".into(), named(&t.radii));
    }
    if !t.ratios.is_empty() {
        custom.insert("ratio".into(), named(&t.ratios));
    }
    if !t.motion.is_empty() {
        custom.insert(
            "motion".into(),
            Value::Object(
                t.motion
                    .iter()
                    .filter_map(|m| {
                        let k = slugify(&m.name);
                        valid_slug(&k).then(|| (k, Value::String(m.value.clone())))
                    })
                    .collect(),
            ),
        );
    }
    if !t.breakpoints.is_empty() {
        custom.insert(
            "breakpoint".into(),
            Value::Object(
                t.breakpoints
                    .iter()
                    .filter_map(|b| {
                        let k = slugify(&b.name);
                        valid_slug(&k).then(|| (k, Value::String(format!("{}px", b.min_px))))
                    })
                    .collect(),
            ),
        );
    }
    custom.insert(
        "roles".into(),
        Value::Object(
            presets
                .roles
                .iter()
                .map(|(k, v)| (k.clone(), Value::String(v.clone())))
                .collect(),
        ),
    );
    let mut layout = Map::new();
    if let Some(g) = &t.grid {
        if let Some(container) = g.container_px {
            layout.insert("wideSize".into(), json!(format!("{container}px")));
            let gutter = g.gutter_px.unwrap_or(24);
            if g.columns >= 8 {
                // eight columns of the container: the measure of reading text
                let col = (container.saturating_sub(gutter * (g.columns - 1))) / g.columns;
                layout.insert(
                    "contentSize".into(),
                    json!(format!("{}px", col * 8 + gutter * 7)),
                );
            }
        }
    }
    if !layout.contains_key("contentSize") {
        layout.insert("contentSize".into(), json!("760px"));
    }
    if !layout.contains_key("wideSize") {
        layout.insert("wideSize".into(), json!("1280px"));
    }

    let settings = json!({
        "appearanceTools": true,
        "useRootPaddingAwareAlignments": true,
        "color": {
            "defaultPalette": false,
            "defaultGradients": false,
            "defaultDuotone": false,
            "custom": false,
            "customGradient": false,
            "palette": palette_json,
        },
        "typography": {
            "fluid": true,
            "defaultFontSizes": false,
            "customFontSize": false,
            "fontSizes": sizes,
            "fontFamilies": families,
        },
        "spacing": {
            "defaultSpacingSizes": false,
            "spacingSizes": spacing,
            "units": ["px", "rem", "%", "vw", "vh"],
        },
        "shadow": {"defaultPresets": false, "presets": shadows},
        "layout": Value::Object(layout),
        "custom": Value::Object(custom),
    });

    // --- styles
    let c = |slug: &Option<String>| slug.as_ref().map(|s| format!("var:preset|color|{s}"));
    let text = role("text");
    let bg = role("background");
    let link = role("link").or(role("accent")).or(text.clone());
    let accent = role("accent").or(link.clone());
    let fs = |s: &str| {
        presets
            .font_sizes
            .contains(s)
            .then(|| format!("var:preset|font-size|{s}"))
    };
    let ff = |s: &Option<String>| s.as_ref().map(|s| format!("var:preset|font-family|{s}"));
    let mut styles = json!({
        "color": {"background": c(&bg), "text": c(&text)},
        "typography": {"fontFamily": ff(&body_family), "fontSize": fs("body"), "lineHeight": "1.6"},
        "spacing": {"blockGap": presets.spacing.contains("space-5").then_some("var:preset|spacing|space-5")},
        "elements": {
            "link": {"color": {"text": c(&link)}, ":hover": {"color": {"text": c(&text)}}},
            // No colour of its own: a heading takes its band's text colour (a heading colour
            // here would win over a dark band's `textColor`).
            "heading": {"typography": {"fontFamily": ff(&display_family), "fontWeight": "400"}},
            "caption": {"typography": {"fontSize": fs("small")}},
        },
        "blocks": {
            "core/site-title": {"typography": {"fontFamily": ff(&display_family)}},
            "core/post-date": {"typography": {"fontFamily": ff(&family_of_role.get("meta").cloned())}},
            "core/post-terms": {"typography": {"fontFamily": ff(&family_of_role.get("meta").cloned())}},
        },
    });
    if let Some(g) = &t.grid {
        let small = t.breakpoints.iter().find_map(|b| b.margin_px).unwrap_or(16);
        let large = g.margin_px.unwrap_or(48);
        styles["spacing"]["padding"] = json!({
            "left": format!("clamp({small}px, 5vw, {large}px)"),
            "right": format!("clamp({small}px, 5vw, {large}px)"),
        });
    }
    for h in ["h1", "h2", "h3", "h4", "h5", "h6"] {
        if let Some(ty) = t.type_scale.iter().find(|ty| ty.name == h) {
            let mut e = json!({"typography": {"fontSize": fs(&slugify(h))}});
            if let Some(lh) = &ty.line_height {
                e["typography"]["lineHeight"] = json!(lh);
            }
            if let Some(tr) = &ty.tracking {
                e["typography"]["letterSpacing"] = json!(tr);
            }
            if let Some(w) = &ty.weight {
                e["typography"]["fontWeight"] = json!(w);
            }
            if let Some(fam) = ty.family.as_ref().and_then(|f| family_slug.get(f)) {
                e["typography"]["fontFamily"] = json!(format!("var:preset|font-family|{fam}"));
            }
            styles["elements"][h] = e;
        }
    }
    // Buttons: a design with a pill radius has pill buttons in its text colour (its primary
    // button), the accent on hover; else the accent with the default radius.
    let pill = t
        .radii
        .iter()
        .find(|r| r.name.contains("pill"))
        .map(|r| r.value.clone());
    let fill = if pill.is_some() {
        text.clone()
    } else {
        accent.clone()
    };
    if let Some(fill) = &fill {
        let on = best_on(&presets, fill);
        let radius = pill.clone().unwrap_or_else(|| {
            t.radii
                .iter()
                .find(|r| r.name == "default")
                .map_or("0px".to_string(), |r| r.value.clone())
        });
        let hover = if pill.is_some() {
            accent.clone()
        } else {
            text.clone()
        };
        styles["elements"]["button"] = json!({
            "color": {"background": format!("var:preset|color|{fill}"), "text": on.as_ref().map(|o| format!("var:preset|color|{o}"))},
            "border": {"radius": radius},
            "typography": {"fontFamily": ff(&body_family), "fontWeight": "600"},
            ":hover": {"color": {"background": c(&hover), "text": c(&bg)}},
        });
    }
    let styles = prune_nulls(styles);

    // --- custom CSS: only what theme.json cannot say
    let mut css = String::new();
    if !t.motion.is_empty() {
        css.push_str(":root{");
        for m in &t.motion {
            if m.name.starts_with("--") && !m.value.contains([';', '{', '}', '<']) {
                css.push_str(&format!("{}:{};", m.name, m.value));
            }
        }
        css.push_str("}\n");
        let ease = t
            .motion
            .iter()
            .find(|m| m.name == "--ease-tide")
            .map_or("ease", |_| "var(--ease-tide)");
        let dur = t
            .motion
            .iter()
            .find(|m| m.name == "--dur-quick")
            .map_or("200ms", |_| "var(--dur-quick)");
        css.push_str(&format!(
            "a,.wp-element-button{{transition:color {dur} {ease},background-color {dur} {ease},border-color {dur} {ease}}}\n"
        ));
        css.push_str("@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}\n");
    }
    css.push_str(&size_css);
    if let Some(l) = &link {
        css.push_str(&format!(
            ":where(a,button,input,.wp-element-button):focus-visible{{outline:2px solid var(--wp--preset--color--{});outline-offset:2px}}\n",
            wp_kebab(l)
        ));
    }

    // --- fonts
    let files: BTreeMap<&str, &site_design::bundle::FileEntry> = manifest
        .files
        .iter()
        .map(|f| (f.path.as_str(), f))
        .collect();
    let mut fonts = Vec::new();
    for f in &t.fonts {
        let slug = slugify(&f.name);
        if !valid_slug(&slug) {
            continue;
        }
        let mut chosen: BTreeMap<(String, String), &site_design::model::FontFace> = BTreeMap::new();
        for face in &f.faces {
            let key = (face.weight.clone(), face.style.clone());
            let latin = |x: &site_design::model::FontFace| {
                x.unicode_range
                    .as_deref()
                    .is_none_or(|r| r.contains("U+0000-00FF"))
            };
            let replace = match chosen.get(&key) {
                None => true,
                Some(prev) => !latin(prev) && latin(face),
            };
            if replace {
                chosen.insert(key, face);
            }
        }
        let mut faces = Vec::new();
        for face in chosen.values() {
            match files.get(face.file.as_str()) {
                Some(entry) => faces.push(ThemeFontFace {
                    weight: face.weight.clone(),
                    style: face.style.clone(),
                    unicode_range: face.unicode_range.clone(),
                    file: AssetRef {
                        path: face.file.clone(),
                        sha256: entry.sha256.clone(),
                        content_type: if entry.content_type.is_empty() {
                            "font/woff2".into()
                        } else {
                            entry.content_type.clone()
                        },
                    },
                }),
                None => notes.push(Issue::new(
                    IssueCode::Font,
                    "fonts",
                    format!(
                        "{} {} {}: the file {} is not in the design's bundle",
                        f.name, face.weight, face.style, face.file
                    ),
                )),
            }
        }
        let dropped = f.faces.len() - faces.len();
        if dropped > 0 && !faces.is_empty() {
            notes.push(Issue::new(
                IssueCode::Note,
                "fonts",
                format!(
                    "{}: {} of {} faces kept (one Latin face per weight and style; WordPress keeps one file per weight and style)",
                    f.name,
                    faces.len(),
                    f.faces.len()
                ),
            ));
        }
        if !faces.is_empty() {
            fonts.push(ThemeFontFamily {
                name: f.name.clone(),
                slug,
                family: f.stack.clone(),
                faces,
            });
        }
    }

    Styles {
        global_styles: GlobalStyles {
            version: THEME_JSON_VERSION,
            settings,
            styles,
            css,
        },
        presets,
        fonts,
        notes,
    }
}

/// `null` values and empty objects removed (theme.json has no nulls).
pub fn prune_nulls(v: Value) -> Value {
    match v {
        Value::Object(m) => {
            let m: Map<String, Value> = m
                .into_iter()
                .map(|(k, v)| (k, prune_nulls(v)))
                .filter(|(_, v)| {
                    !v.is_null() && !(v.is_object() && v.as_object().is_some_and(Map::is_empty))
                })
                .collect();
            Value::Object(m)
        }
        Value::Array(a) => Value::Array(a.into_iter().map(prune_nulls).collect()),
        other => other,
    }
}

/// The site's page for a label the design wrote (in the site's first language) in `lang`: its URL
/// and its label in that language (by the link's key, else by the same label in `lang`).
pub fn resolve(site: &SiteContext, lang: &str, label: &str) -> Option<(String, String)> {
    let key = label_key(label.trim().trim_end_matches('→').trim());
    if key.is_empty() {
        return None;
    }
    let first = site.langs()[0].clone();
    // Of several pages under one label (a hub and a village's section), the shortest path.
    let pick = |f: &dyn Fn(&crate::model::SiteLink) -> bool| {
        site.links
            .iter()
            .filter(|l| f(l))
            .min_by_key(|l| (l.url.len(), l.url.clone()))
    };
    let same = |l: &crate::model::SiteLink| {
        label_key(&l.label) == key || l.key.as_deref() == Some(key.as_str())
    };
    if let Some(k) = pick(&|l| l.lang == first && same(l)).and_then(|l| l.key.clone()) {
        if let Some(l) = pick(&|l| l.lang == lang && l.key.as_deref() == Some(k.as_str())) {
            return Some((l.url.clone(), l.label.clone()));
        }
    }
    pick(&|l| l.lang == lang && label_key(&l.label) == key)
        .map(|l| (l.url.clone(), l.label.clone()))
}

/// The design's menus per site language (module docs), and notes on what was left out.
pub fn menus(design: &SiteDesign, site: &SiteContext) -> (Vec<NavigationMenu>, Vec<Issue>) {
    let mut out = Vec::new();
    let mut notes = Vec::new();
    for m in &design.navigation {
        let name = slugify(&m.slug);
        if !valid_slug(&name) {
            continue;
        }
        for lang in site.langs() {
            let mut items = Vec::new();
            for it in &m.items {
                let own = it.href.trim();
                let kept = !own.is_empty()
                    && own != "#"
                    && !own.starts_with('#')
                    && !own.to_ascii_lowercase().starts_with("javascript:")
                    && site.urls().contains(own);
                let found = if kept {
                    Some((own.to_string(), it.label.clone()))
                } else {
                    resolve(site, &lang, &it.label)
                };
                match found {
                    Some((url, label)) => items.push(NavigationItem {
                        label,
                        url,
                        children: Vec::new(),
                class: None,
                    }),
                    None if lang == site.langs()[0] => notes.push(Issue::new(
                        IssueCode::Note,
                        format!("menu {name}"),
                        format!(
                            "\"{}\" has no page on the site; it is left out (add a page with that label to link it)",
                            it.label
                        ),
                    )),
                    None => {}
                }
            }
            if items.is_empty() {
                if lang == site.langs()[0] {
                    notes.push(Issue::new(
                        IssueCode::Note,
                        format!("menu {name}"),
                        "no item has a page on the site: the menu is not written",
                    ));
                }
                continue;
            }
            out.push(NavigationMenu {
                name: name.clone(),
                lang: lang.clone(),
                items,
            });
        }
    }
    // A language switch when the site has more than one language.
    let langs = site.langs();
    if langs.len() > 1 && !out.iter().any(|m| m.name == "languages") {
        for lang in &langs {
            out.push(NavigationMenu {
                name: "languages".into(),
                lang: lang.clone(),
                items: langs
                    .iter()
                    .map(|l| NavigationItem {
                        label: l.to_ascii_uppercase(),
                        url: format!("/{l}/"),
                        children: Vec::new(),
                        class: None,
                    })
                    .collect(),
            });
        }
    }
    (out, notes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugs_and_ranges() {
        assert_eq!(slugify("Bodoni Moda"), "bodoni-moda");
        assert_eq!(slugify("h1"), "h-1");
        assert_eq!(slugify("space-11"), "space-11");
        assert_eq!(label_key("Food & Drink"), "food-and-drink");
        assert_eq!(palette_slug("--ct-v-vernazza", Some("ct-")), "v-vernazza");
        assert_eq!(palette_slug("--notte", None), "notte");
        assert_eq!(
            clamp_range("clamp(72px, 9vw + 30px, 160px)"),
            Some(("72px".into(), "160px".into()))
        );
        assert_eq!(
            clamp_range("clamp(1rem, calc(1vw + 2px), 2rem)").unwrap().1,
            "2rem"
        );
        assert_eq!(clamp_range("16px"), None);
        assert_eq!(px("26px"), Some(26));
        assert_eq!(px("1.5rem"), Some(16));
        assert_eq!(first_family("'Bodoni Moda','Didot',serif"), "Bodoni Moda");
        assert_eq!(wp_kebab("h1"), "h-1");
        assert_eq!(wp_kebab("e1"), "e-1");
        assert_eq!(wp_kebab("space-11"), "space-11");
        assert_eq!(wp_kebab("display-xl"), "display-xl");
        let v = prune_nulls(json!({"a": null, "b": {"c": null}, "d": [1]}));
        assert_eq!(v, json!({"d": [1]}));
    }
}
