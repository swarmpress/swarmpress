//! A design system's components made first-class, and its icons and micro-interactions.
//!
//! * [`describe`]: a numbered part of a components sheet (`4.13 Accordion — FAQ, practical
//!   matters`) gets what a renderer and its checks need besides its markup: the **functions** it
//!   serves on a site (a closed list, [`COMPONENT_FUNCTIONS`], read from its name and subtitle by
//!   fixed words), its **variants** (the subtitle's list, the specimen's small labels), its
//!   **states** (a closed list, from the notes and the sheet's selectors) and the sheet's **style
//!   rules** for the classes its specimen uses (hover, focus, the `details[open]` turn).
//! * [`icons`]: an iconography sheet's data (its `renderVals()` constants, read without running
//!   them, [`crate::dc::read_script`]): lists of `[name, [path…]]` are icon sets, the ids from the
//!   sheet's own `prefix: 'ct-{name}'`; lists of objects with paths `d` and a colour are place marks.
//! * [`interactions`]: a motion sheet's numbered micro-interactions with their duration, easing
//!   and reduced-motion fallback.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::Value;

use crate::dc::{self, scalar};
use crate::dom::El;
use crate::interpret::{kebab, Page};
use crate::model::{Component, Icon, Interaction, COMPONENT_CSS_BYTES, COMPONENT_FUNCTIONS};

/// `(words, function)`: a component whose name or subtitle has the words serves the function.
/// Earlier rows win ties; a component serves every function whose words it has.
const FUNCTION_WORDS: &[(&[&str], &str)] = &[
    (&["masthead"], "masthead"),
    (&["village menu"], "mega-menu"),
    (&["mega-menu"], "mega-menu"),
    (&["mega menu"], "mega-menu"),
    (&["mobile menu"], "mobile-menu"),
    (&["button"], "button"),
    (&["tags"], "tags"),
    (&["chips"], "tags"),
    (&["tabs"], "tags"),
    (&["cards"], "cards"),
    (&["card"], "cards"),
    (&["trail ledger"], "trail-stats"),
    (&["trail stats"], "trail-stats"),
    (&["essentials"], "essentials"),
    (&["ticker"], "essentials"),
    (&["callout"], "callout"),
    (&["pull quote"], "callout"),
    (&["dateline"], "byline"),
    (&["byline"], "byline"),
    (&["page header"], "page-header"),
    (&["breadcrumb"], "breadcrumb"),
    (&["contents"], "contents"),
    (&["progress"], "reading-progress"),
    (&["search"], "search"),
    (&["form"], "form"),
    (&["accordion"], "faq"),
    (&["faq"], "faq"),
    (&["getting here"], "getting-here"),
    (&["mode table"], "getting-here"),
    (&["itinerary"], "itinerary"),
    (&["timeline"], "itinerary"),
    (&["gallery"], "gallery"),
    (&["pagination"], "pagination"),
    (&["load more"], "pagination"),
    (&["feedback"], "feedback"),
    (&["badges"], "feedback"),
    (&["toast"], "feedback"),
    (&["loading"], "loading"),
    (&["skeleton"], "loading"),
    (&["empty"], "empty"),
    (&["continue reading"], "related"),
    (&["related"], "related"),
    (&["listing bar"], "listing-bar"),
    (&["activity"], "activity"),
    (&["things to do"], "activity"),
    (&["restaurant"], "restaurant"),
    (&["where to eat"], "restaurant"),
    (&["weather"], "weather"),
    (&["forecast"], "weather"),
    (&["profile"], "people"),
    (&["editors"], "people"),
    (&["footer"], "footer"),
];

/// States a design may specify (the closed list a check can ask about).
pub const STATES: &[&str] = &[
    "hover", "focus", "pressed", "disabled", "open", "selected", "current", "expanded", "error",
    "loading", "empty", "sticky", "checked",
];

/// Words without a plural `s` (`buttons` → `button`, `tabs` → `tab`), joined by spaces.
fn singular(text: &str) -> String {
    kebab(text)
        .split('-')
        .map(|w| {
            if w.len() > 3 && w.ends_with('s') && !w.ends_with("ss") {
                &w[..w.len() - 1]
            } else {
                w
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn has_words(text: &str, words: &str) -> bool {
    // Whole words: `tabs` is not in `establish`.
    format!(" {} ", singular(text)).contains(&format!(" {} ", singular(words)))
}

/// The functions a component's name and subtitle say it serves: its name's, and its subtitle's
/// when the subtitle lists what it is for (`FAQ, practical matters`; items of one or two words,
/// so `sticky under masthead` says where it sits, not what it is).
pub fn functions_of(name: &str, subtitle: Option<&str>) -> Vec<String> {
    let mut said = name.to_string();
    if let Some(sub) = subtitle {
        let items: Vec<&str> = sub.split([',', '·']).map(str::trim).collect();
        if items
            .iter()
            .all(|i| !i.is_empty() && i.split_whitespace().count() <= 2)
        {
            said.push(' ');
            said.push_str(sub);
        }
    }
    let mut out: Vec<String> = Vec::new();
    for (words, f) in FUNCTION_WORDS {
        if words.iter().all(|w| has_words(&said, w)) && !out.iter().any(|x| x == f) {
            out.push((*f).to_string());
        }
    }
    debug_assert!(out
        .iter()
        .all(|f| COMPONENT_FUNCTIONS.iter().any(|(k, _)| k == f)));
    out
}

/// Fills a component's functions, variants, states and style rules (module docs).
pub(crate) fn describe(c: &mut Component, block: &El, page: &El) {
    c.functions = functions_of(&c.name, c.subtitle.as_deref());
    // Variants: the subtitle's list (`story · village · stay`), else the specimen's small labels.
    let mut variants: Vec<String> = Vec::new();
    if let Some(sub) = &c.subtitle {
        let items: Vec<&str> = sub.split(['·', ',']).map(str::trim).collect();
        if items.len() >= 2
            && items
                .iter()
                .all(|i| !i.is_empty() && i.split(' ').count() <= 3)
        {
            variants.extend(items.iter().map(|i| kebab(i)));
        }
    }
    let title = format!(
        "{} {}",
        c.number.as_deref().unwrap_or(""),
        c.name.to_lowercase()
    );
    for e in block.descendants() {
        if e.elements().count() > 0 {
            continue;
        }
        let class = e.attr("class").unwrap_or("");
        let style = e.attr("style").unwrap_or("");
        let label = class
            .split_whitespace()
            .any(|x| matches!(x, "mono" | "lbl" | "sec"))
            || style.contains("text-transform:uppercase");
        let t = e.text();
        let words = t.split_whitespace().count();
        if label
            && (1..=3).contains(&words)
            && !t.chars().any(|ch| ch.is_ascii_digit())
            && !title.contains(&t.to_lowercase())
            && t.chars()
                .all(|ch| ch.is_alphabetic() || ch == ' ' || ch == '-')
        {
            let k = kebab(&t);
            if !k.is_empty() && !variants.contains(&k) && variants.len() < 10 {
                variants.push(k);
            }
        }
    }
    c.variants = variants;
    // Style rules for the specimen's classes.
    let mut classes: BTreeSet<String> = BTreeSet::new();
    let mut tags: BTreeSet<String> = BTreeSet::new();
    for e in block.descendants() {
        tags.insert(e.tag.clone());
        for x in e.attr("class").unwrap_or("").split_whitespace() {
            classes.insert(x.to_string());
        }
    }
    let mut sheet = String::new();
    for s in page.descendants().into_iter().filter(|e| e.tag == "style") {
        sheet.push_str(&s.raw_text());
        sheet.push('\n');
    }
    c.css = rules_for(&sheet, &classes, &tags);
    // States: the notes' words and the rules' pseudo-classes.
    let mut said = c.notes.join(" ").to_lowercase();
    said.push(' ');
    said.push_str(&block.text().to_lowercase());
    let mut states: Vec<String> = Vec::new();
    for st in STATES {
        let in_css = match *st {
            "hover" => c.css.contains(":hover"),
            "focus" => c.css.contains(":focus"),
            "pressed" => c.css.contains(":active"),
            "disabled" => c.css.contains(":disabled"),
            "open" => c.css.contains("[open]"),
            "checked" => c.css.contains(":checked"),
            _ => false,
        };
        let word = match *st {
            "pressed" => has_words(&said, "press") || has_words(&said, "pressed"),
            other => has_words(&said, other),
        };
        if in_css || word {
            states.push((*st).to_string());
        }
    }
    c.states = states;
}

/// Splits a stylesheet into its top-level rules (`selector{body}`, `@media …{rules}`).
fn top_rules(css: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let cs: Vec<char> = css.chars().collect();
    let mut i = 0;
    while i < cs.len() {
        // A comment.
        if cs[i] == '/' && cs.get(i + 1) == Some(&'*') {
            i += 2;
            while i + 1 < cs.len() && !(cs[i] == '*' && cs[i + 1] == '/') {
                i += 1;
            }
            i += 2;
            continue;
        }
        let start = i;
        while i < cs.len() && cs[i] != '{' && cs[i] != '}' {
            i += 1;
        }
        if i >= cs.len() || cs[i] == '}' {
            i += 1;
            continue;
        }
        let selector: String = cs[start..i].iter().collect();
        let mut depth = 0;
        let body_start = i + 1;
        while i < cs.len() {
            match cs[i] {
                '{' => depth += 1,
                '}' => {
                    depth -= 1;
                    if depth == 0 {
                        break;
                    }
                }
                _ => {}
            }
            i += 1;
        }
        let body: String = cs[body_start..i.min(cs.len())].iter().collect();
        out.push((selector.trim().to_string(), body));
        i += 1;
    }
    out
}

fn selector_matches(sel: &str, classes: &BTreeSet<String>, tags: &BTreeSet<String>) -> bool {
    sel.split(',').any(|one| {
        let one = one.trim();
        let by_class = one
            .split(|ch: char| !(ch.is_alphanumeric() || ch == '-' || ch == '_' || ch == '.'))
            .flat_map(|part| part.split('.').skip(1))
            .any(|cl| !cl.is_empty() && classes.contains(cl));
        let first = one
            .split(|ch: char| !(ch.is_alphanumeric() || ch == '-'))
            .next()
            .unwrap_or("");
        let by_tag = matches!(
            first,
            "details" | "summary" | "input" | "select" | "textarea" | "button" | "table" | "dialog"
        ) && tags.contains(first);
        by_class || by_tag
    })
}

/// The sheet's rules that style `classes` (or the specimen's form and disclosure elements), with
/// the `@keyframes` they animate and the reduced-motion overrides.
fn rules_for(css: &str, classes: &BTreeSet<String>, tags: &BTreeSet<String>) -> String {
    let rules = top_rules(css);
    let mut out = String::new();
    let mut animations: BTreeSet<String> = BTreeSet::new();
    let push = |out: &mut String, sel: &str, body: &str| {
        let r = format!("{sel}{{{}}}\n", body.trim());
        if out.len() + r.len() <= COMPONENT_CSS_BYTES {
            out.push_str(&r);
        }
    };
    for (sel, body) in &rules {
        if sel.starts_with('@') {
            continue;
        }
        if selector_matches(sel, classes, tags) {
            push(&mut out, sel, body);
            for w in body.split([';', ' ', ':', ',']) {
                animations.insert(w.trim().to_string());
            }
        }
    }
    for (sel, body) in &rules {
        if let Some(name) = sel.strip_prefix("@keyframes") {
            if animations.contains(name.trim()) {
                push(&mut out, sel, body);
            }
        } else if sel.starts_with("@media") {
            let inner: Vec<String> = top_rules(body)
                .into_iter()
                .filter(|(s, _)| selector_matches(s, classes, tags))
                .map(|(s, b)| format!("{s}{{{}}}", b.trim()))
                .collect();
            if !inner.is_empty() {
                push(&mut out, sel, &inner.join(""));
            }
        }
    }
    out
}

/// `[name, [path, …]]`: an icon in a list of icons.
fn icon_pair(v: &Value) -> Option<(String, Vec<String>)> {
    let a = v.as_array()?;
    let (Some(Value::String(n)), Some(Value::Array(d)), 2) = (a.first(), a.get(1), a.len()) else {
        return None;
    };
    let paths: Vec<String> = d
        .iter()
        .filter_map(|x| x.as_str().map(String::from))
        .collect();
    (paths.len() == d.len() && !paths.is_empty() && paths.iter().all(|p| is_path(p)))
        .then(|| (n.clone(), paths))
}

fn is_path(p: &str) -> bool {
    let p = p.trim_start();
    (p.starts_with('M') || p.starts_with('m')) && p.len() > 2
}

/// The `prefix: 'ct-{name}'` and title the sheet gives each icon list: `(list, (prefix, title))`
/// from objects such as `{ title: 'Weather & sea', prefix: 'ct-wx-{name}', items: mk(weather) }`.
fn prefixes(script: &str) -> BTreeMap<String, (String, String)> {
    let mut out = BTreeMap::new();
    let mut rest = script;
    while let Some(i) = rest.find("prefix") {
        let obj_start = rest[..i].rfind('{').unwrap_or(0);
        // The object's end: its closing brace outside quotes (`'ct-{name}'` has braces).
        let mut obj_end = rest.len();
        let mut quote: Option<char> = None;
        let mut depth = 0i32;
        for (k, ch) in rest[obj_start..].char_indices() {
            match (quote, ch) {
                (Some(q), c) if c == q => quote = None,
                (Some(_), _) => {}
                (None, '\'' | '"') => quote = Some(ch),
                (None, '{') => depth += 1,
                (None, '}') => {
                    depth -= 1;
                    if depth == 0 {
                        obj_end = obj_start + k;
                        break;
                    }
                }
                _ => {}
            }
        }
        let obj = &rest[obj_start..obj_end];
        let quoted = |key: &str| -> Option<String> {
            let k = obj.find(key)?;
            let after = obj[k + key.len()..]
                .trim_start()
                .strip_prefix(':')?
                .trim_start();
            let q = after.chars().next().filter(|c| *c == '\'' || *c == '"')?;
            let end = after[1..].find(q)?;
            Some(after[1..1 + end].to_string())
        };
        if let (Some(prefix), Some(list)) = (quoted("prefix"), {
            // `items: mk(weather)`: the list is the call's one argument.
            obj.find("items").and_then(|k| {
                let a = &obj[k..];
                let open = a.find('(')?;
                let close = a[open..].find(')')?;
                let arg = a[open + 1..open + close].trim();
                arg.chars()
                    .all(|c| c.is_alphanumeric() || c == '_')
                    .then(|| arg.to_string())
            })
        }) {
            out.insert(list, (prefix, quoted("title").unwrap_or_default()));
        }
        rest = &rest[obj_end.max(i + 6)..];
    }
    out
}

fn group_of(list: &str, title: &str) -> String {
    let t = format!("{title} {list}").to_lowercase();
    if t.contains("weather") || t.contains("sea") && t.contains("wx") {
        "weather".into()
    } else if t.contains("travel") || t.contains("place") || t.contains("food") {
        "travel".into()
    } else if t.contains("interface") || t.contains("ui") {
        "interface".into()
    } else {
        kebab(list)
    }
}

/// An iconography sheet's icons and marks (module docs).
pub(crate) fn icons(p: &Page) -> Vec<Icon> {
    let Some(script) = &p.script else {
        return Vec::new();
    };
    let (consts, returned) = dc::read_script(script);
    let named = prefixes(script);
    let mut out: Vec<Icon> = Vec::new();
    let mut seen = BTreeSet::new();
    for (list, v) in &consts {
        let Some(items) = v.as_array() else { continue };
        let pairs: Vec<(String, Vec<String>)> = items.iter().filter_map(icon_pair).collect();
        if pairs.len() < 3 || pairs.len() != items.len() {
            continue;
        }
        let (prefix, title) = named
            .get(list)
            .cloned()
            .unwrap_or_else(|| ("{name}".into(), String::new()));
        let group = group_of(list, &title);
        for (name, paths) in pairs {
            let id = if prefix.contains("{name}") {
                prefix.replace("{name}", &name)
            } else {
                format!("{prefix}{name}")
            };
            if seen.insert(id.clone()) {
                out.push(Icon {
                    id,
                    name,
                    group: group.clone(),
                    paths,
                    colour: None,
                    label: None,
                });
            }
        }
    }
    // Marks: objects with a name, paths and a colour (`{ n: 'Vernazza', c: '#7FA9C2', d: [...] }`).
    let common = {
        let ids: Vec<&str> = out.iter().map(|i| i.id.as_str()).collect();
        ids.first()
            .and_then(|f| f.split_once('-'))
            .map(|(p, _)| format!("{p}-"))
            .filter(|p| ids.iter().all(|i| i.starts_with(p.as_str())))
            .unwrap_or_default()
    };
    let mut lists: Vec<&Value> = consts.values().collect();
    if let Some(o) = returned.as_object() {
        lists.extend(o.values());
    }
    for v in lists {
        let Some(items) = v.as_array() else { continue };
        for it in items {
            let Some(o) = it.as_object() else { continue };
            let name = ["n", "name", "label"]
                .iter()
                .find_map(|k| o.get(*k).and_then(Value::as_str));
            let paths: Vec<String> = o
                .get("d")
                .or_else(|| o.get("paths"))
                .and_then(Value::as_array)
                .map(|a| {
                    a.iter()
                        .filter_map(|x| x.as_str().map(String::from))
                        .collect()
                })
                .unwrap_or_default();
            let colour = ["c", "color", "colour", "hex"]
                .iter()
                .find_map(|k| o.get(*k).and_then(Value::as_str))
                .filter(|c| c.starts_with('#'));
            let (Some(name), false, Some(colour)) = (name, paths.is_empty(), colour) else {
                continue;
            };
            if !paths.iter().all(|p| is_path(p)) {
                continue;
            }
            let id = format!("{common}mark-{}", kebab(name));
            if seen.insert(id.clone()) {
                out.push(Icon {
                    id,
                    name: name.to_string(),
                    group: "mark".into(),
                    paths,
                    colour: Some(colour.to_string()),
                    label: ["motif", "label", "use"]
                        .iter()
                        .find_map(|k| o.get(*k).and_then(Value::as_str))
                        .map(String::from),
                });
            }
        }
    }
    out
}

/// A motion sheet's micro-interactions (module docs): a list of objects with a number, a name,
/// a behaviour, and among the rest a duration (`ms`, `a / b`, `linear`), an easing (one of the
/// sheet's curves' names) and the reduced-motion fallback (the remaining short text).
pub(crate) fn interactions(p: &Page) -> Vec<Interaction> {
    if !p.title.to_lowercase().contains("motion") {
        return Vec::new();
    }
    let Some(script) = &p.script else {
        return Vec::new();
    };
    let (consts, returned) = dc::read_script(script);
    let mut lists: Vec<&Value> = consts.values().collect();
    if let Some(o) = returned.as_object() {
        lists.extend(o.values());
    }
    // The easings' names: items with a `--ease…` token and a name.
    let mut easings: BTreeSet<String> = BTreeSet::new();
    for v in &lists {
        for it in v.as_array().into_iter().flatten() {
            let token = it.get("token").and_then(Value::as_str).unwrap_or("");
            if let (true, Some(n)) = (
                token.starts_with("--ease"),
                it.get("name").and_then(Value::as_str),
            ) {
                easings.insert(n.to_lowercase());
            }
        }
    }
    let is_duration = |s: &str| {
        let t = s.trim();
        t == "linear"
            || t.ends_with("ms")
            || (t.chars().any(|c| c.is_ascii_digit())
                && t.chars()
                    .all(|c| c.is_ascii_digit() || c == ' ' || c == '/'))
    };
    let is_easing = |s: &str| {
        let t = s.trim().to_lowercase();
        t == "—"
            || t == "-"
            || (!t.is_empty()
                && t.split('/').all(|w| easings.contains(w.trim()))
                && !easings.is_empty())
    };
    let mut out = Vec::new();
    for v in lists {
        let Some(items) = v.as_array() else { continue };
        let mut found = Vec::new();
        for it in items {
            let Some(o) = it.as_object() else { continue };
            let Some(name) = o.get("name").and_then(Value::as_str) else {
                continue;
            };
            let mut rest: Vec<(String, String)> = o
                .iter()
                .filter(|(k, _)| k.as_str() != "name")
                .map(|(k, v)| (k.clone(), scalar(v)))
                .collect();
            let number = rest
                .iter()
                .position(|(_, v)| {
                    v.len() <= 3 && !v.is_empty() && v.chars().all(|c| c.is_ascii_digit())
                })
                .map(|i| rest.remove(i).1);
            let duration = rest
                .iter()
                .position(|(_, v)| is_duration(v))
                .map(|i| rest.remove(i).1);
            let easing = rest
                .iter()
                .position(|(_, v)| is_easing(v))
                .map(|i| rest.remove(i).1);
            let (Some(number), Some(duration)) = (number, duration) else {
                continue;
            };
            let behaviour_at = rest
                .iter()
                .enumerate()
                .max_by_key(|(_, (_, v))| v.len())
                .map(|(i, _)| i);
            let Some(b) = behaviour_at else { continue };
            let behaviour = rest.remove(b).1;
            let Some(reduced) = rest.into_iter().map(|(_, v)| v).find(|v| !v.is_empty()) else {
                continue;
            };
            found.push(Interaction {
                number,
                name: name.to_string(),
                behaviour,
                duration,
                easing: easing.unwrap_or_default(),
                reduced,
                page: p.path.clone(),
            });
        }
        if found.len() >= 3 {
            out.extend(found);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn functions_come_from_the_name_and_subtitle() {
        assert_eq!(
            functions_of("Accordion", Some("FAQ, practical matters")),
            ["faq"]
        );
        assert_eq!(
            functions_of("Masthead & village menu", None),
            ["masthead", "mega-menu"]
        );
        assert_eq!(
            functions_of("Trail Ledger", Some("replaces inline trail stats")),
            ["trail-stats"]
        );
        assert_eq!(functions_of("Buttons", None), ["button"]);
        assert_eq!(functions_of("Editorial callouts", None), ["callout"]);
        assert_eq!(
            functions_of(
                "Listing bar",
                Some("sticky under masthead, wraps on mobile")
            ),
            ["listing-bar"]
        );
        assert_eq!(functions_of("Tags, chips, tabs", None), ["tags"]);
        assert_eq!(functions_of("Continue reading", None), ["related"]);
        assert_eq!(
            functions_of("Weather", Some("The week ahead + seasons")),
            ["weather"]
        );
        assert!(functions_of("Colophon", None).is_empty());
    }

    #[test]
    fn style_rules_follow_the_specimens_classes() {
        let css =
            ".btn{a:1}.btn:hover .arr{b:2}.other{c:3}details[open] .plus{transform:rotate(45deg)}\
                   @keyframes rise{from{x:0}}.line{animation:rise 900ms}\
                   @media (prefers-reduced-motion:reduce){.line{animation:none}.other{x:1}}";
        let classes: BTreeSet<String> = ["btn", "arr", "line"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        let tags: BTreeSet<String> = ["details", "summary"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        let r = rules_for(css, &classes, &tags);
        assert!(r.contains(".btn{a:1}"));
        assert!(r.contains(".btn:hover .arr{b:2}"));
        assert!(!r.contains(".other"));
        assert!(r.contains("details[open] .plus"));
        assert!(r.contains("@keyframes rise{from{x:0}}"));
        assert!(r.contains("@media (prefers-reduced-motion:reduce){.line{animation:none}}"));
    }

    #[test]
    fn icon_lists_and_marks_are_read_from_the_sheets_data() {
        let script = r#"class C { renderVals() {
const c = (x, y, r) => 'M' + (x - r) + ' ' + y;
const ui = [['search', [c(11, 11, 6.5), 'M20 20l-4.2-4.2']], ['plus', ['M12 5v14']], ['close', ['M6 6l12 12']]];
const weather = [['rain', ['M8 17l-1 3']], ['sun', ['M12 2v2']], ['fog', ['M4 9h16']]];
const groups = [{ title: 'Interface', prefix: 'ct-{name}', items: mk(ui) }, { title: 'Weather & sea', prefix: 'ct-wx-{name}', items: mk(weather) }].map((g) => g);
return { marks: [{ n: 'Vernazza', motif: 'tower', c: '#7FA9C2', d: ['M8 17V8h4v9'] }] };
} }"#;
        let page = Page {
            path: "pages/02b-iconography.html".into(),
            title: "02b — Iconography".into(),
            html: El::default(),
            lists: Vec::new(),
            role: crate::model::PageRole::Guide,
            script: Some(script.into()),
        };
        let icons = icons(&page);
        let ids: Vec<&str> = icons.iter().map(|i| i.id.as_str()).collect();
        assert_eq!(
            ids,
            [
                "ct-search",
                "ct-plus",
                "ct-close",
                "ct-wx-rain",
                "ct-wx-sun",
                "ct-wx-fog",
                "ct-mark-vernazza"
            ]
        );
        assert_eq!(icons[0].paths[0], "M4.5 11");
        assert_eq!(icons[3].group, "weather");
        assert_eq!(icons[6].colour.as_deref(), Some("#7FA9C2"));
    }

    #[test]
    fn interactions_are_read_with_their_fallbacks() {
        let script = r#"class C { renderVals() { return {
curves: [{ name: 'Tide', token: '--ease-tide' }, { name: 'Swell', token: '--ease-swell' }],
cat: [
{ n: '01', name: 'Link underline draw', b: 'Underline grows left to right.', d: '320ms', e: 'tide', r: 'Underline always on' },
{ n: '05', name: 'Masthead tide', b: 'After 80px: Paper and shadow; hides on scroll down.', d: '320ms', e: 'swell', r: 'Always visible, no hide' },
{ n: '06', name: 'Mega-menu tint', b: '120ms hover intent; panel drops 8px and fades.', d: '320 / 220', e: 'swell / tide', r: 'Fade only' },
{ n: '10', name: 'Reading progress', b: 'A bar under the masthead tracks scroll on stories.', d: 'linear', e: '—', r: 'Kept (no motion)' }
] }; } }"#;
        let page = Page {
            path: "pages/05-motion.html".into(),
            title: "05 — Motion & micro-interactions".into(),
            html: El::default(),
            lists: Vec::new(),
            role: crate::model::PageRole::Guide,
            script: Some(script.into()),
        };
        let x = interactions(&page);
        assert_eq!(x.len(), 4);
        assert_eq!(x[1].name, "Masthead tide");
        assert_eq!(x[1].reduced, "Always visible, no hide");
        assert_eq!(x[2].duration, "320 / 220");
        assert_eq!(x[2].easing, "swell / tide");
        assert_eq!(x[3].easing, "—");
    }
}
