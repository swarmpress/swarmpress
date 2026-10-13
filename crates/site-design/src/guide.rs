//! What a design system's sheets specify: tokens, components, rules, and the
//! site's chrome (parts, menus, languages).
//!
//! The rules read structure and wording, never one design's names:
//!
//! * **Data lists** (a Claude Design page's literal data, [`crate::dc`]):
//!   items with a hex colour in `hex`/`color`/`value` are colours (a `--…`
//!   field names the token; a list labelled *dark* or *night* is a scheme of
//!   its own); items with a `token` and a `size` are type tokens; items named
//!   `space-N` with a px value are spacing; items with a range `0–599` or
//!   `1280+` are breakpoints; items with `--ease…` or `--dur…` are motion.
//! * **Labelled blocks** (a short label followed by content): *Radius* items
//!   `2 · inputs`; *Principles*; `→ fix` lists; *Rules*.
//! * **Text**: `e1 · nav` boxes with a `box-shadow` are elevations; `16:9 ·
//!   hero` items are image ratios; `12-column grid … margin 64 · gutter 24 ·
//!   container 1312` is the grid.
//! * **Stylesheets**: `:root` custom properties (classified by name and
//!   value), `@font-face` rules (the fonts and their files), `@media` widths
//!   (breakpoints when no sheet names them), `font-family` stacks.
//! * **Numbered parts** (`4.4 Cards — story · village · stay`) of a
//!   components or listings sheet are components.
//!
//! Colour roles come from the usage text: the role whose keyword appears
//! first wins (`Secondary text, captions` is muted text, `Inline links` a
//! link). Contrast is computed (WCAG 2) against the background, or against
//! the main text colour for fills.

#![allow(clippy::float_arithmetic)] // WCAG luminance; nothing here is simulated.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::Value;

use crate::css;
use crate::dc::{is_label, scalar};
use crate::dom::{self, El};
use crate::interpret::{kebab, Page};
use crate::model::*;

fn field<'a>(item: &'a Value, keys: &[&str]) -> Option<&'a str> {
    keys.iter()
        .find_map(|k| item.get(*k).and_then(Value::as_str))
        .map(str::trim)
        .filter(|s| !s.is_empty())
}

fn is_hex(s: &str) -> bool {
    let h = s.trim_start_matches('#');
    s.starts_with('#') && matches!(h.len(), 3 | 6 | 8) && h.chars().all(|c| c.is_ascii_hexdigit())
}

fn token_name(item: &Value) -> Option<String> {
    item.as_object()?
        .values()
        .filter_map(Value::as_str)
        .find(|v| v.starts_with("--") && v.len() > 2 && !v.contains(' '))
        .map(str::to_string)
}

/// `14.7:1` in a text.
fn stated_ratio(s: &str) -> Option<String> {
    let i = s.find(":1")?;
    let head = &s[..i];
    let start = head
        .rfind(|c: char| !(c.is_ascii_digit() || c == '.'))
        .map_or(0, |p| p + 1);
    let n = &head[start..];
    (!n.is_empty() && n.chars().next().is_some_and(|c| c.is_ascii_digit()))
        .then(|| format!("{n}:1"))
}

const ROLE_WORDS: [(ColourRole, &[&str]); 8] = [
    (
        ColourRole::TextMuted,
        &["secondary", "muted", "caption", "disabled", "soft", "meta"],
    ),
    (ColourRole::Text, &["text", "ink", "foreground"]),
    (
        ColourRole::Background,
        &["ground", "background", "page", "paper", "bg", "canvas"],
    ),
    (
        ColourRole::Surface,
        &["surface", "sunken", "callout", "card"],
    ),
    (
        ColourRole::Border,
        &["hairline", "border", "divider", "line", "rule"],
    ),
    (
        ColourRole::Accent,
        &["accent", "eyebrow", "brand", "primary", "hover"],
    ),
    (ColourRole::Link, &["link"]),
    (ColourRole::Highlight, &["highlight", "marker", "focus"]),
];

/// The role whose keyword appears first in the text.
fn role_by_words(text: &str) -> Option<ColourRole> {
    let t = text.to_lowercase();
    let mut best: Option<(usize, usize, ColourRole)> = None;
    for (order, (role, words)) in ROLE_WORDS.iter().enumerate() {
        for w in *words {
            let at_word = t
                .match_indices(w)
                .map(|(i, _)| i)
                .find(|&i| !t[..i].chars().next_back().is_some_and(char::is_alphabetic));
            if let Some(p) = at_word {
                if best.is_none_or(|b| (p, order) < (b.0, b.1)) {
                    best = Some((p, order, *role));
                }
            }
        }
    }
    best.map(|b| b.2)
}

fn colour_from(item: &Value, list: &crate::dc::DataList) -> Option<ColourToken> {
    let value = field(item, &["hex", "color", "colour", "value"]).filter(|v| is_hex(v))?;
    let label = field(item, &["village", "name", "label"]).map(str::to_string);
    let display = match (field(item, &["village"]), field(item, &["name"])) {
        (Some(v), Some(n)) => Some(format!("{v} ({n})")),
        _ => label,
    };
    let usage = field(item, &["role", "note", "use", "usage"]).map(str::to_string);
    let group = Some(kebab(&list.key)).filter(|g| !g.is_empty());
    let lbl = list.label.clone().unwrap_or_default().to_lowercase();
    let pigment = lbl.contains("pigment") || item.get("village").is_some();
    let name = token_name(item)
        .unwrap_or_else(|| format!("--{}", kebab(display.as_deref().unwrap_or(value))));
    let role = if pigment {
        ColourRole::Pigment
    } else {
        usage
            .as_deref()
            .and_then(role_by_words)
            .or_else(|| role_by_words(&name))
            .unwrap_or(ColourRole::Other)
    };
    let stated = field(item, &["ratio", "contrast"])
        .and_then(stated_ratio)
        .or_else(|| usage.as_deref().and_then(stated_ratio));
    Some(ColourToken {
        name,
        value: value.to_string(),
        role,
        group,
        label: display,
        usage,
        tint: field(item, &["tint"])
            .filter(|t| is_hex(t))
            .map(str::to_string),
        contrast: stated.map(|s| Contrast {
            against: String::new(),
            ratio_x100: 0,
            stated: Some(s),
        }),
    })
}

/// `160/0.88 · clamp(72px, 9vw + 30px, 160px)` and `Bodoni 400 italic · -0.035em`.
fn type_from(item: &Value, fonts: &[FontFamily]) -> Option<TypeToken> {
    let name = field(item, &["token", "name", "t"])?;
    if name.starts_with("--") {
        return None;
    }
    let size_spec = field(item, &["size"])?;
    let (head, tail) = size_spec
        .split_once('·')
        .map_or((size_spec, ""), |(a, b)| (a.trim(), b.trim()));
    let (px, lh) = head
        .split_once('/')
        .map_or((head, None), |(a, b)| (a.trim(), Some(b.trim())));
    if !px.chars().all(|c| c.is_ascii_digit()) || px.is_empty() {
        return None;
    }
    let (fluid, note) = if tail.starts_with("clamp(") {
        (Some(tail.to_string()), None)
    } else {
        (None, Some(tail.to_string()).filter(|t| !t.is_empty()))
    };
    let spec = field(item, &["spec"]).unwrap_or("");
    let style = field(item, &["style"]).unwrap_or("");
    let mut family = None;
    let mut stacks = BTreeMap::new();
    css::font_stacks(style, &mut stacks);
    if let Some(f) = stacks.keys().next() {
        family = Some(f.clone());
    }
    let first_word = spec.split_whitespace().next().unwrap_or("");
    if family.is_none() && !first_word.is_empty() {
        family = fonts
            .iter()
            .find(|f| f.name.split_whitespace().next() == Some(first_word))
            .map(|f| f.name.clone());
    }
    let words: Vec<&str> = spec.split(['·', ' ']).filter(|w| !w.is_empty()).collect();
    let weight = words
        .iter()
        .find(|w| w.len() == 3 && w.chars().all(|c| c.is_ascii_digit()))
        .map(|w| (*w).to_string());
    let tracking = words
        .iter()
        .find(|w| {
            w.ends_with("em")
                && w.chars()
                    .next()
                    .is_some_and(|c| c == '-' || c == '+' || c.is_ascii_digit())
        })
        .map(|w| w.trim_start_matches('+').to_string());
    let lower = spec.to_lowercase();
    Some(TypeToken {
        name: name.to_string(),
        family,
        weight,
        style: lower.contains("italic").then(|| "italic".to_string()),
        size: format!("{px}px"),
        fluid,
        line_height: lh.map(str::to_string),
        tracking,
        transform: lower.contains("upper").then(|| "uppercase".to_string()),
        note,
    })
}

/// `0–599`, `1280+`.
fn range(s: &str) -> Option<(u32, Option<u32>)> {
    if let Some(a) = s.strip_suffix('+') {
        return Some((a.trim().parse().ok()?, None));
    }
    let (a, b) = s.split_once(['–', '-'])?;
    Some((a.trim().parse().ok()?, Some(b.trim().parse().ok()?)))
}

fn num(item: &Value, keys: &[&str]) -> Option<u32> {
    let s = field(item, keys)?;
    let d: String = s.chars().take_while(char::is_ascii_digit).collect();
    d.parse().ok()
}

fn short(text: &str) -> bool {
    !text.is_empty() && text.chars().count() <= 90
}

/// Innermost elements with text (no element child has text of its own beyond inline runs).
fn leaves(el: &El) -> Vec<&El> {
    el.descendants()
        .into_iter()
        .filter(|e| {
            !e.text().is_empty()
                && !e.elements().any(|c| {
                    !matches!(
                        c.tag.as_str(),
                        "strong" | "em" | "b" | "i" | "br" | "span" | "a" | "code"
                    ) && !c.text().is_empty()
                })
        })
        .collect()
}

/// `(label, label element, the block)` for every element that starts with a label.
fn labelled(root: &El) -> Vec<(String, &El)> {
    let mut out = Vec::new();
    for e in root.descendants() {
        let kids: Vec<&El> = e.elements().collect();
        if kids.len() >= 2 && is_label(kids[0]) && kids[0].elements().count() <= 1 {
            out.push((kids[0].text(), e));
        }
    }
    out
}

/// The items of a labelled block: the children of its one content element,
/// or its content elements.
fn items(block: &El) -> Vec<&El> {
    let content: Vec<&El> = block.elements().skip(1).collect();
    if content.len() == 1 && content[0].elements().count() >= 2 {
        content[0].elements().collect()
    } else {
        content
    }
}

fn digits_after(text: &str, word: &str) -> Option<u32> {
    let i = text.find(word)?;
    let t = text[i + word.len()..].trim_start();
    let d: String = t.chars().take_while(char::is_ascii_digit).collect();
    d.parse().ok()
}

fn digits_before(text: &str, word: &str) -> Option<u32> {
    let i = text.find(word)?;
    let head = text[..i].trim_end();
    let start = head
        .rfind(|c: char| !c.is_ascii_digit())
        .map_or(0, |p| p + 1);
    head[start..].parse().ok()
}

fn luminance(hex: &str) -> Option<f64> {
    let h = hex.trim_start_matches('#');
    let h: String = if h.len() == 3 {
        h.chars().flat_map(|c| [c, c]).collect()
    } else {
        h.chars().take(6).collect()
    };
    if h.len() != 6 {
        return None;
    }
    let ch = |i: usize| -> Option<f64> {
        let v = f64::from(u8::from_str_radix(&h[i..i + 2], 16).ok()?) / 255.0;
        Some(if v <= 0.039_28 {
            v / 12.92
        } else {
            ((v + 0.055) / 1.055).powf(2.4)
        })
    };
    Some(0.2126 * ch(0)? + 0.7152 * ch(2)? + 0.0722 * ch(4)?)
}

/// WCAG contrast × 100, rounded down.
pub fn contrast_x100(a: &str, b: &str) -> Option<u32> {
    let (la, lb) = (luminance(a)?, luminance(b)?);
    let (hi, lo) = if la > lb { (la, lb) } else { (lb, la) };
    let r = (hi + 0.05) / (lo + 0.05) * 100.0;
    // Truncation is intended: 4.49 must not read as 4.5.
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    Some(r.floor() as u32)
}

fn measure(colours: &mut [ColourToken]) {
    let bg = colours
        .iter()
        .find(|c| c.role == ColourRole::Background)
        .map(|c| (c.name.clone(), c.value.clone()));
    let text = colours
        .iter()
        .find(|c| c.role == ColourRole::Text)
        .map(|c| (c.name.clone(), c.value.clone()));
    for c in colours.iter_mut() {
        let against = match c.role {
            ColourRole::Background
            | ColourRole::Surface
            | ColourRole::Pigment
            | ColourRole::Highlight
            | ColourRole::Border => text.clone(),
            _ => bg.clone(),
        };
        let Some((name, value)) = against else {
            continue;
        };
        if name == c.name {
            continue;
        }
        if let Some(r) = contrast_x100(&c.value, &value) {
            let stated = c.contrast.take().and_then(|x| x.stated);
            c.contrast = Some(Contrast {
                against: name,
                ratio_x100: r,
                stated,
            });
        }
    }
}

/// Classifies a `:root` custom property.
fn custom_property(t: &mut Tokens, name: &str, value: &str) {
    let n = name.to_lowercase();
    let v = value.trim();
    let has = |w: &[&str]| w.iter().any(|x| n.contains(x));
    if is_hex(v)
        || v.starts_with("rgb")
        || v.starts_with("hsl")
        || v.starts_with("oklch")
        || has(&["color", "colour"])
    {
        // In a name the modifier comes last (`--color-ink-muted`): it decides.
        let role = if has(&["muted", "soft", "subtle", "secondary"]) {
            ColourRole::TextMuted
        } else {
            role_by_words(&n.replace('-', " ")).unwrap_or(ColourRole::Other)
        };
        t.colours.push(ColourToken {
            name: name.into(),
            value: v.into(),
            role,
            group: None,
            label: None,
            usage: None,
            tint: None,
            contrast: None,
        });
    } else if has(&["font-size", "text-", "fs-", "step-", "type-"]) && !has(&["font-family"]) {
        t.type_scale.push(TypeToken {
            name: name.trim_start_matches("--").into(),
            family: None,
            weight: None,
            style: None,
            size: v.into(),
            fluid: v.starts_with("clamp(").then(|| v.to_string()),
            line_height: None,
            tracking: None,
            transform: None,
            note: None,
        });
    } else if has(&["font", "family"]) && (v.contains(',') || v.contains('"') || v.contains('\'')) {
        // Font families are read from the stacks and @font-face; keep the name.
        t.other.insert(name.into(), v.into());
    } else if has(&["space", "spacing", "gap", "gutter"]) {
        t.spacing.push(SizeToken {
            name: name.into(),
            value: v.into(),
            usage: None,
        });
    } else if has(&["radius", "rounded"]) {
        t.radii.push(SizeToken {
            name: name.into(),
            value: v.into(),
            usage: None,
        });
    } else if has(&["shadow", "elevation"]) {
        t.elevations.push(SizeToken {
            name: name.into(),
            value: v.into(),
            usage: None,
        });
    } else if has(&["ease", "easing"]) {
        t.motion.push(MotionToken {
            name: name.into(),
            kind: MotionKind::Easing,
            value: v.into(),
            label: None,
            usage: None,
        });
    } else if has(&["dur", "duration"]) {
        t.motion.push(MotionToken {
            name: name.into(),
            kind: MotionKind::Duration,
            value: v.into(),
            label: None,
            usage: None,
        });
    } else {
        t.other.insert(name.into(), v.into());
    }
}

fn resolve(base: &str, url: &str) -> String {
    let dir = base.rsplit_once('/').map_or("", |x| x.0);
    let mut parts: Vec<&str> = if dir.is_empty() {
        Vec::new()
    } else {
        dir.split('/').collect()
    };
    for seg in url.split('/') {
        match seg {
            "." | "" => {}
            ".." => {
                parts.pop();
            }
            s => parts.push(s),
        }
    }
    parts.join("/")
}

/// Every token the pages and stylesheets give (module docs).
pub(crate) fn tokens(pages: &[Page], css_files: &str) -> Tokens {
    let mut t = Tokens::default();
    // Stylesheets: files, then each page's <style> elements and inline styles.
    let mut root = BTreeMap::new();
    let mut stacks = BTreeMap::new();
    css::root_properties(css_files, &mut root);
    css::font_stacks(css_files, &mut stacks);
    let mut faces: BTreeMap<String, Vec<FontFace>> = BTreeMap::new();
    let mut widths = css::media_widths(css_files);
    let add_faces = |base: &str, text: &str, faces: &mut BTreeMap<String, Vec<FontFace>>| {
        for f in css::font_faces(text) {
            for u in &f.urls {
                if u.contains("://") || u.starts_with("data:") {
                    continue;
                }
                let file = resolve(base, u);
                let face = FontFace {
                    weight: f.weight.clone(),
                    style: f.style.clone(),
                    file,
                    unicode_range: f.unicode_range.clone(),
                };
                let list = faces.entry(f.family.clone()).or_default();
                if !list.contains(&face) {
                    list.push(face);
                }
            }
        }
    };
    add_faces("", css_files, &mut faces);
    for p in pages {
        for s in p.html.descendants() {
            if s.tag == "style" {
                let text = s.raw_text();
                css::root_properties(&text, &mut root);
                css::font_stacks(&text, &mut stacks);
                widths.extend(css::media_widths(&text));
                add_faces(&p.path, &text, &mut faces);
            } else if let Some(st) = s.attr("style") {
                css::font_stacks(st, &mut stacks);
            }
        }
    }
    for (k, v) in &root {
        custom_property(&mut t, k, v);
    }

    // Fonts: families with files, their stacks, their roles from the sheets.
    let mut family_names: BTreeSet<String> = faces.keys().cloned().collect();
    for p in pages.iter().filter(|p| p.role != PageRole::Template) {
        for e in p.html.descendants() {
            let txt = e.text();
            if stacks.contains_key(&txt) {
                family_names.insert(txt);
            }
        }
    }
    for name in family_names {
        let mut role = None;
        for p in pages.iter().filter(|p| p.role == PageRole::Guide) {
            for e in p.html.descendants() {
                let kids: Vec<&El> = e.elements().collect();
                if kids.len() >= 2
                    && kids.iter().skip(1).any(|k| k.text() == name)
                    && is_label(kids[0])
                {
                    let l = kids[0].text().to_lowercase();
                    role = role.or(
                        if ["display", "heading", "headline", "story"]
                            .iter()
                            .any(|w| l.contains(w))
                        {
                            Some(FontRole::Display)
                        } else if ["meta", "mono", "code", "dispatch"]
                            .iter()
                            .any(|w| l.contains(w))
                        {
                            Some(FontRole::Meta)
                        } else if ["text", "body", "ui"].iter().any(|w| l.contains(w)) {
                            Some(FontRole::Body)
                        } else {
                            None
                        },
                    );
                }
            }
        }
        let role = role.unwrap_or(if name.to_lowercase().contains("mono") {
            FontRole::Meta
        } else {
            FontRole::Other
        });
        let stack = stacks
            .get(&name)
            .cloned()
            .unwrap_or_else(|| format!("'{name}'"));
        t.fonts.push(FontFamily {
            faces: faces.remove(&name).unwrap_or_default(),
            name,
            role,
            stack,
        });
    }

    // Data lists of the guide sheets.
    let mut schemes: BTreeMap<String, ColourScheme> = BTreeMap::new();
    for p in pages.iter().filter(|p| p.role == PageRole::Guide) {
        for list in &p.lists {
            let label = list.label.clone().unwrap_or_default();
            let dark = ["dark", "night"]
                .iter()
                .any(|w| label.to_lowercase().contains(w));
            for item in &list.items {
                if let Some(c) = colour_from(item, list) {
                    if dark {
                        let name = kebab(label.split(['—', '-', '(']).next().unwrap_or("dark"));
                        let s = schemes.entry(name.clone()).or_insert_with(|| ColourScheme {
                            name,
                            label: label.clone(),
                            dark: true,
                            colours: Vec::new(),
                        });
                        s.colours.push(c);
                    } else if !t.colours.iter().any(|x| x.name == c.name) {
                        t.colours.push(c);
                    }
                    continue;
                }
                if let Some(ty) = type_from(item, &t.fonts) {
                    if !t.type_scale.iter().any(|x| x.name == ty.name) {
                        t.type_scale.push(ty);
                    }
                    continue;
                }
                let vals: Vec<String> = item
                    .as_object()
                    .map(|o| o.values().map(scalar).collect())
                    .unwrap_or_default();
                if let Some(space) = vals
                    .iter()
                    .find(|v| v.starts_with("space-") && v[6..].chars().all(|c| c.is_ascii_digit()))
                {
                    if let Some(px) = vals.iter().find(|v| v.ends_with("px")) {
                        t.spacing.push(SizeToken {
                            name: space.clone(),
                            value: px.clone(),
                            usage: field(item, &["use", "usage"]).map(str::to_string),
                        });
                        continue;
                    }
                }
                if let Some((min, max)) = vals.iter().find_map(|v| range(v)) {
                    if let Some(n) = field(item, &["n", "name"]) {
                        t.breakpoints.push(Breakpoint {
                            name: n.to_string(),
                            min_px: min,
                            max_px: max,
                            columns: num(item, &["c", "cols", "columns"]),
                            gutter_px: num(item, &["g", "gutter"]),
                            margin_px: num(item, &["m", "margin"]),
                        });
                        continue;
                    }
                }
                if let Some(tok) = vals.iter().find(|v| {
                    v.starts_with("--ease") || v.starts_with("--dur") || v.starts_with("--stagger")
                }) {
                    let value = field(item, &["css", "v", "value"])
                        .unwrap_or("")
                        .to_string();
                    t.motion.push(MotionToken {
                        name: tok.clone(),
                        kind: if tok.starts_with("--ease") {
                            MotionKind::Easing
                        } else {
                            MotionKind::Duration
                        },
                        value,
                        label: field(item, &["name", "label"]).map(str::to_string),
                        usage: field(item, &["use", "usage"]).map(str::to_string),
                    });
                }
            }
        }
        // Labelled blocks and text.
        for (label, block) in labelled(&p.html) {
            let l = label.to_lowercase();
            if l.starts_with("radius") || l.starts_with("radii") {
                for it in leaves(block) {
                    let txt = it.text();
                    let Some((v, use_)) = txt.split_once('·') else {
                        continue;
                    };
                    let v = v.trim();
                    let numeric = v.trim_end_matches(['%']).trim_end_matches("px");
                    if numeric.is_empty()
                        || !numeric.chars().all(|c| c.is_ascii_digit())
                        || t.radii
                            .iter()
                            .any(|r| r.usage.as_deref() == Some(use_.trim()))
                    {
                        continue;
                    }
                    let value = if v.chars().all(|c| c.is_ascii_digit()) {
                        format!("{v}px")
                    } else {
                        v.to_string()
                    };
                    t.radii.push(SizeToken {
                        name: kebab(use_),
                        value,
                        usage: Some(use_.trim().to_string()),
                    });
                }
            }
        }
        for e in p.html.descendants() {
            let txt = e.text();
            if !short(&txt) {
                continue;
            }
            // Elevation boxes: `e1 · nav` with a box-shadow.
            if let Some(shadow) = e.attr("style").and_then(|s| {
                s.split(';').find_map(|d| {
                    d.split_once(':')
                        .filter(|(k, _)| k.trim() == "box-shadow")
                        .map(|(_, v)| v.trim().to_string())
                })
            }) {
                let (n, use_) = txt.split_once('·').map_or((txt.as_str(), None), |(a, b)| {
                    (a.trim(), Some(b.trim().to_string()))
                });
                if n.len() <= 4
                    && n.starts_with('e')
                    && n[1..].chars().all(|c| c.is_ascii_digit())
                    && !n[1..].is_empty()
                {
                    t.elevations.push(SizeToken {
                        name: n.into(),
                        value: shadow,
                        usage: use_,
                    });
                }
            }
            if e.elements().next().is_some() {
                continue;
            }
            // Ratios: `16:9 · hero desktop`.
            if let Some((r, use_)) = txt.split_once('·') {
                let r = r.trim();
                if let Some((a, b)) = r.split_once(':') {
                    if !a.is_empty()
                        && !b.is_empty()
                        && a.chars().chain(b.chars()).all(|c| c.is_ascii_digit())
                        && !t.ratios.iter().any(|x| x.name == r)
                    {
                        t.ratios.push(SizeToken {
                            name: r.into(),
                            value: format!("{a} / {b}"),
                            usage: Some(use_.trim().into()),
                        });
                    }
                }
            }
            // The grid: `12-column grid @1440 — margin 64 · gutter 24 · column 86 · container 1312`.
            if t.grid.is_none() && txt.contains("-column grid") {
                if let Some(cols) = digits_before(&txt, "-column") {
                    t.grid = Some(Grid {
                        columns: cols,
                        gutter_px: digits_after(&txt, "gutter"),
                        margin_px: digits_after(&txt, "margin"),
                        column_px: digits_after(&txt, "column "),
                        container_px: digits_after(&txt, "container"),
                    });
                }
            }
        }
    }
    if t.breakpoints.is_empty() {
        widths.sort_unstable();
        widths.dedup();
        let mut prev = 0;
        for (i, w) in widths.iter().enumerate() {
            t.breakpoints.push(Breakpoint {
                name: format!("bp-{w}"),
                min_px: if i == 0 { prev } else { prev + 1 },
                max_px: Some(*w),
                columns: None,
                gutter_px: None,
                margin_px: None,
            });
            prev = *w;
        }
    }
    measure(&mut t.colours);
    t.schemes = schemes.into_values().collect();
    for s in &mut t.schemes {
        measure(&mut s.colours);
    }
    t
}

fn split_number(label: &str) -> Option<(String, String)> {
    let mut parts = label.splitn(2, ' ');
    let num = parts.next()?;
    let rest = parts.next()?.trim();
    let ok = num.contains('.')
        && num
            .split('.')
            .all(|x| !x.is_empty() && x.chars().all(|c| c.is_ascii_digit()));
    (ok && !rest.is_empty()).then(|| (num.to_string(), rest.to_string()))
}

/// Notes: the sentences in a block (eight words or more), innermost first.
fn notes(block: &El, skip: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for e in leaves(block) {
        let t = e.text();
        if t == skip || t.split(' ').count() < 8 || out.iter().any(|o| o.contains(&t)) {
            continue;
        }
        out.retain(|o| !t.contains(o.as_str()));
        out.push(t);
        if out.len() >= 12 {
            break;
        }
    }
    out
}

/// The numbered parts of a sheet (`4.4 Cards — story · village · stay`).
pub(crate) fn components(p: &Page) -> Vec<Component> {
    let mut out: Vec<Component> = Vec::new();
    let Some(body) = dom::body(&p.html) else {
        return out;
    };
    for (label, block) in labelled(body) {
        let Some((number, rest)) = split_number(&label) else {
            continue;
        };
        if out
            .iter()
            .any(|c| c.number.as_deref() == Some(number.as_str()))
        {
            continue;
        }
        let (name, subtitle) = rest
            .split_once(" — ")
            .map_or((rest.clone(), None), |(a, b)| {
                (a.trim().to_string(), Some(b.trim().to_string()))
            });
        let html = block.outer_html();
        out.push(Component {
            slug: kebab(&name),
            name,
            number: Some(number),
            subtitle,
            page: p.path.clone(),
            notes: notes(block, &label),
            html: if html.len() <= 96 * 1024 {
                html
            } else {
                String::new()
            },
        });
    }
    out
}

fn fields_in(text: &str) -> Vec<String> {
    let t = text.to_lowercase();
    let list = |s: &str| -> Vec<String> {
        s.split([',', '/'])
            .flat_map(|x| x.split(" and "))
            .flat_map(|x| x.split(" or "))
            .map(|x| kebab(x.trim()))
            .filter(|x| !x.is_empty() && x.split('-').count() <= 2)
            .collect()
    };
    if let Some(i) = t.find("required ") {
        if let Some(j) = t[i + 9..].find(" field") {
            let f = list(&t[i + 9..i + 9 + j]);
            if !f.is_empty() {
                return f;
            }
        }
    }
    if let Some(i) = t.find(" no ") {
        let tail = &t[i + 4..];
        let end = tail.find([';', '.', '→']).unwrap_or(tail.len());
        let f = list(&tail[..end]);
        if !f.is_empty() && f.len() <= 6 {
            return f;
        }
    }
    if t.contains(" alt") {
        return vec!["alt".into()];
    }
    Vec::new()
}

/// The check a rule's wording maps to (a closed list, [`RuleCheck`]).
fn check_of(observed: &str, fix: &str, strong: Option<&str>) -> Option<RuleCheck> {
    let f = fix.to_lowercase();
    let all = format!("{} {f}", observed.to_lowercase());
    if f.contains("/10") && f.contains("decimal") {
        return Some(RuleCheck::RatingScale {
            max: 10,
            decimals: 1,
        });
    }
    if all.contains("h1") && (all.contains("seo") || f.contains("headline only")) {
        return Some(RuleCheck::HeadlineWithoutSiteName);
    }
    if all.contains('#') && (all.contains("cta") || all.contains("button")) {
        return Some(RuleCheck::NoPlaceholderLinks);
    }
    if f.contains("one image per") {
        return Some(RuleCheck::OneImagePerStory);
    }
    if f.contains('€') && f.contains("scale") {
        let max = f
            .split(['–', '-'])
            .nth(1)
            .and_then(|x| {
                x.trim()
                    .chars()
                    .take_while(char::is_ascii_digit)
                    .collect::<String>()
                    .parse()
                    .ok()
            })
            .unwrap_or(4);
        return Some(RuleCheck::PriceScale {
            symbol: "€".into(),
            max,
        });
    }
    // `the Trail Ledger component`, `the Listing bar (7.1)`: a component by name or number.
    let numbered = f.split('(').skip(1).any(|x| {
        let n: String = x
            .chars()
            .take_while(|c| c.is_ascii_digit() || *c == '.')
            .collect();
        n.contains('.') && x[n.len()..].starts_with(')')
    });
    if f.contains("component") || numbered {
        let named = fix.find("the ").map(|i| {
            let tail = &fix[i + 4..];
            let end = [
                tail.find(" ("),
                tail.find(" component"),
                tail.find(['.', ',']),
            ]
            .into_iter()
            .flatten()
            .min()
            .unwrap_or(tail.len());
            tail[..end].trim().to_string()
        });
        if let Some(name) = strong
            .map(str::to_string)
            .or(named)
            .filter(|n| !n.is_empty())
        {
            return Some(RuleCheck::RequiresComponent {
                component: kebab(&name),
            });
        }
    }
    if all.contains("required")
        || f.contains("lint")
        || all.contains("alt text")
        || all.contains("empty alt")
    {
        let fields = fields_in(&format!("{fix}. {observed}"));
        if !fields.is_empty() {
            return Some(RuleCheck::RequiredFields { fields });
        }
    }
    None
}

/// Principles, fixes and rules of a sheet.
pub(crate) fn rules(p: &Page) -> Vec<DesignRule> {
    let mut out: Vec<DesignRule> = Vec::new();
    let Some(body) = dom::body(&p.html) else {
        return out;
    };
    let mut seen = BTreeSet::new();
    for (label, block) in labelled(body) {
        let l = label.to_lowercase();
        let kind = if l.contains("principle") {
            RuleKind::Principle
        } else if l.contains("→ fix") || l.contains("-> fix") {
            RuleKind::Fix
        } else if l == "rules" || l.ends_with(" rules") {
            RuleKind::Rule
        } else {
            continue;
        };
        for (i, it) in items(block).into_iter().enumerate() {
            let text = it.text();
            if text.is_empty() || !seen.insert(text.clone()) {
                continue;
            }
            let kids: Vec<&El> = it.elements().collect();
            let rule = match kind {
                RuleKind::Principle => {
                    let title = it
                        .find(&|e| matches!(e.tag.as_str(), "strong" | "b" | "h3" | "h4"))
                        .map(El::text);
                    let body = kids
                        .last()
                        .map(|k| k.text())
                        .unwrap_or_else(|| text.clone());
                    DesignRule {
                        id: format!(
                            "principle-{}",
                            out.iter().filter(|r| r.kind == kind).count() + 1
                        ),
                        kind,
                        title,
                        text: body,
                        observed: None,
                        fix: None,
                        check: None,
                        page: p.path.clone(),
                    }
                }
                RuleKind::Fix => {
                    let (num, rest) = match kids.first().map(|k| k.text()) {
                        Some(n) if n.chars().all(|c| c.is_ascii_digit()) && !n.is_empty() => {
                            (n.clone(), text[n.len()..].trim().to_string())
                        }
                        _ => (format!("{:02}", i + 1), text.clone()),
                    };
                    let (observed, fix) = rest
                        .split_once('→')
                        .map_or((rest.clone(), String::new()), |(a, b)| {
                            (a.trim().to_string(), b.trim().to_string())
                        });
                    let strong = it
                        .find(&|e| matches!(e.tag.as_str(), "strong" | "b"))
                        .map(El::text);
                    DesignRule {
                        id: format!("fix-{num}"),
                        kind,
                        title: None,
                        check: check_of(&observed, &fix, strong.as_deref()),
                        text: rest,
                        observed: Some(observed),
                        fix: Some(fix).filter(|f| !f.is_empty()),
                        page: p.path.clone(),
                    }
                }
                RuleKind::Rule => DesignRule {
                    id: format!("rule-{}", out.iter().filter(|r| r.kind == kind).count() + 1),
                    kind,
                    title: None,
                    text,
                    observed: None,
                    fix: None,
                    check: None,
                    page: p.path.clone(),
                },
            };
            out.push(rule);
        }
    }
    out
}

fn template_of(href: &str, slugs: &BTreeMap<String, String>) -> Option<String> {
    let h = href.split(['#', '?']).next().unwrap_or("");
    if h.is_empty() {
        return None;
    }
    let h = h.trim_start_matches("./").trim_start_matches('/');
    slugs
        .iter()
        .find(|(path, _)| {
            *path == h
                || path.rsplit('/').next() == Some(h)
                || (h.is_empty() && path.ends_with("index.html"))
        })
        .map(|(_, s)| s.clone())
}

fn menu_items(links: &[&El], slugs: &BTreeMap<String, String>) -> Vec<MenuItem> {
    links
        .iter()
        .filter_map(|a| {
            let label = a.text();
            (!label.is_empty()).then(|| {
                let href = a.attr("href").unwrap_or("").to_string();
                MenuItem {
                    template: template_of(&href, slugs),
                    label,
                    href,
                }
            })
        })
        .collect()
}

fn is_language(t: &str) -> bool {
    t.len() == 2 && t.chars().all(|c| c.is_ascii_uppercase())
}

/// Parts, menus and languages from the page with the site's header and footer.
pub(crate) fn chrome(
    p: &Page,
    templates: &[Template],
    slugs: &BTreeMap<String, String>,
) -> (Vec<Part>, Vec<Menu>, Vec<String>) {
    let mut parts = Vec::new();
    let mut menus = Vec::new();
    let mut languages = Vec::new();
    let Some(body) = dom::body(&p.html) else {
        return (parts, menus, languages);
    };
    let landmarks: Vec<&El> = crate::interpret::sections_of(body)
        .into_iter()
        .filter(|e| matches!(e.tag.as_str(), "header" | "nav" | "footer"))
        .collect();
    let using = |area: &str| -> Vec<String> {
        templates
            .iter()
            .filter(|t| t.parts.iter().any(|x| x == area))
            .map(|t| t.slug.clone())
            .collect()
    };
    let head: Vec<&El> = landmarks
        .iter()
        .copied()
        .filter(|e| e.tag != "footer")
        .collect();
    if !head.is_empty() {
        let mut part_menus = Vec::new();
        for h in &head {
            let navs: Vec<&El> = if h.tag == "nav" {
                vec![*h]
            } else {
                h.descendants()
                    .into_iter()
                    .filter(|e| e.tag == "nav")
                    .collect()
            };
            for n in navs {
                let label = n
                    .attr("aria-label")
                    .map_or_else(|| "Primary".to_string(), str::to_string);
                let links: Vec<&El> = n
                    .descendants()
                    .into_iter()
                    .filter(|e| e.tag == "a")
                    .collect();
                let slug = kebab(&label);
                part_menus.push(slug.clone());
                menus.push(Menu {
                    slug,
                    label,
                    items: menu_items(&links, slugs),
                });
            }
            for a in h.descendants().into_iter().filter(|e| e.tag == "a") {
                let t = a.text();
                if is_language(&t) && !languages.contains(&t.to_lowercase()) {
                    languages.push(t.to_lowercase());
                }
            }
        }
        parts.push(Part {
            slug: "header".into(),
            area: PartArea::Header,
            html: head
                .iter()
                .map(|e| e.outer_html())
                .collect::<Vec<_>>()
                .join("\n"),
            templates: using("header"),
            variants: 1,
            menus: part_menus,
        });
    }
    if let Some(f) = landmarks.iter().find(|e| e.tag == "footer") {
        let mut part_menus = Vec::new();
        for e in f.descendants() {
            let kids: Vec<&El> = e.elements().collect();
            let links: Vec<&El> = kids.iter().copied().filter(|k| k.tag == "a").collect();
            if kids.len() >= 3 && is_label(kids[0]) && kids[0].tag != "a" && links.len() >= 2 {
                let label = kids[0].text();
                let mut slug = format!("footer-{}", kebab(&label));
                while menus.iter().any(|m: &Menu| m.slug == slug) {
                    slug.push_str("-2");
                }
                part_menus.push(slug.clone());
                menus.push(Menu {
                    slug,
                    label,
                    items: menu_items(&links, slugs),
                });
            }
        }
        parts.push(Part {
            slug: "footer".into(),
            area: PartArea::Footer,
            html: f.outer_html(),
            templates: using("footer"),
            variants: 1,
            menus: part_menus,
        });
    }
    (parts, menus, languages)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn contrast_matches_wcag() {
        assert_eq!(contrast_x100("#000000", "#FFFFFF"), Some(2100));
        // Ink on Paper, as the design states: 14.7:1.
        let r = contrast_x100("#0F1E2E", "#F3EFE7").unwrap();
        assert!((1460..=1480).contains(&r), "{r}");
    }

    #[test]
    fn roles_by_the_first_keyword() {
        assert_eq!(
            role_by_words("Text, rules, primary buttons."),
            Some(ColourRole::Text)
        );
        assert_eq!(
            role_by_words("Secondary text, captions, meta."),
            Some(ColourRole::TextMuted)
        );
        assert_eq!(
            role_by_words("Inline links, info notes"),
            Some(ColourRole::Link)
        );
        assert_eq!(
            role_by_words("Eyebrows, link hover"),
            Some(ColourRole::Accent)
        );
        assert_eq!(
            role_by_words("Page ground. Lime-plaster white."),
            Some(ColourRole::Background)
        );
    }

    #[test]
    fn checks_from_wording() {
        assert_eq!(
            check_of(
                "Ratings mix ★, /5 and /10",
                "one scale: /10, one decimal.",
                None
            ),
            Some(RuleCheck::RatingScale {
                max: 10,
                decimals: 1
            })
        );
        assert_eq!(
            check_of(
                "\"Uncategorized\" posts and missing alt text",
                "required category and alt fields in the CMS.",
                None
            ),
            Some(RuleCheck::RequiredFields {
                fields: vec!["category".into(), "alt".into()]
            })
        );
        assert_eq!(
            check_of(
                "Trail stats are inline prose",
                "the Trail Ledger component (distance, time, grade, card).",
                Some("Trail Ledger")
            ),
            Some(RuleCheck::RequiresComponent {
                component: "trail-ledger".into()
            })
        );
        assert_eq!(
            check_of("Price shown in $ on a euro site", "€ scale, 1–4.", None),
            Some(RuleCheck::PriceScale {
                symbol: "€".into(),
                max: 4
            })
        );
    }
}
