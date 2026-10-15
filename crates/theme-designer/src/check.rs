//! The checks (ADR-0093): what a template or part must be before it is written, and what
//! the whole theme must be. Every message names the place and says what would pass, so a
//! repair turn can act on it.
//!
//! Per template or part ([`check_template`]):
//! - **grammar**: the block comments parse and nest ([`crate::blocks`]); nothing outside
//!   blocks;
//! - **blocks**: only [`crate::ALLOWED_BLOCKS`]; a `core/template-part` names a part the
//!   theme has; a `core/navigation` is found by its class, never by a post id (`ref`);
//! - **coverage**: every section of the task as a block with its class (`sp-{id}`), the
//!   entry as `core/post-content`, every query section as a `core/query` with exactly the
//!   query the task gives, every part the template includes, every menu of a part;
//! - **presets**: every `var:preset|…`, `var(--wp--preset--…)`, colour, size and family
//!   attribute and `has-…` class resolves to a preset of the theme; no raw colour
//!   (`#0F1E2E`, `rgb(…)`) anywhere in the markup;
//! - **contrast**: each text block's colour on its background (inherited through its
//!   ancestors from the roles `text` and `background`) is WCAG AA: 4.5:1, 3:1 for headings
//!   and large sizes;
//! - **safety**: no `<script>`, `<iframe>`, `<object>`, `<embed>`, `on…=` handler or
//!   `javascript:` URL;
//! - **links**: no `#` or empty link; a link goes to one of the site's pages;
//! - **queries**: every `core/query` is one the task gives (the site's collections, or the
//!   template's own list);
//! - **the design's rules**: one rating scale (`/10` with its decimals), one h1 that is the
//!   headline (never the site's name; `core/site-title` with `"level":0`), alt text on every
//!   image, the category on every listed story, prices on the design's scale.
//!
//! The whole theme ([`check_theme`]): its shape (`ThemeData::validate_shape`), the required
//! templates, licensed fonts ([`crate::OFL_FONTS`]), the presets and the contrast of the
//! pairs the global styles use, and every template and part again.

use std::collections::BTreeSet;

use serde_json::{Map, Value};
use site_design::model::RuleCheck;
use site_design::wordpress::ThemeData;

use crate::blocks::{self, short, Block};
use crate::model::{Issue, IssueCode, Presets, SiteContext, TaskKind, TemplateTask};
use crate::plan::ThemePlan;
use crate::styles::first_family;
use crate::{AA_LARGE_X100, AA_TEXT_X100, ALLOWED_BLOCKS, OFL_FONTS};

/// What the checks judge against.
#[derive(Clone, Copy, Debug)]
pub struct CheckContext<'a> {
    pub presets: &'a Presets,
    pub site: &'a SiteContext,
    /// The design's enforceable rules.
    pub rules: &'a [(String, RuleCheck)],
    /// The parts the theme has.
    pub parts: &'a [String],
}

impl ThemePlan {
    /// The checks' context for this plan.
    pub fn context<'a>(&'a self, parts: &'a [String]) -> CheckContext<'a> {
        CheckContext {
            presets: &self.presets,
            site: &self.site,
            rules: &self.rules,
            parts,
        }
    }

    /// The parts the plan makes (`header`, `footer`).
    pub fn part_slugs(&self) -> Vec<String> {
        self.tasks
            .iter()
            .filter(|t| t.kind == TaskKind::Part)
            .map(|t| t.slug.clone())
            .collect()
    }
}

impl CheckContext<'_> {
    fn rule(&self, f: impl Fn(&RuleCheck) -> bool) -> Option<(&str, &RuleCheck)> {
        self.rules
            .iter()
            .find(|(_, c)| f(c))
            .map(|(id, c)| (id.as_str(), c))
    }
}

/// Blocks whose text a visitor reads.
const TEXT_BLOCKS: &[&str] = &[
    "core/heading",
    "core/paragraph",
    "core/list",
    "core/quote",
    "core/post-title",
    "core/post-excerpt",
    "core/post-date",
    "core/post-terms",
    "core/post-author-name",
    "core/site-title",
    "core/site-tagline",
    "core/navigation",
    "core/query-title",
    "core/read-more",
    "core/term-description",
    "core/details",
];

/// Blocks whose text is large by default.
const LARGE_BLOCKS: &[&str] = &[
    "core/heading",
    "core/post-title",
    "core/site-title",
    "core/query-title",
];

const COLOUR_ATTRS: &[&str] = &[
    "backgroundColor",
    "textColor",
    "borderColor",
    "overlayColor",
];

fn is_hex(s: &str) -> bool {
    (s.len() == 4 || s.len() == 7 || s.len() == 9)
        && s.starts_with('#')
        && s[1..].chars().all(|c| c.is_ascii_hexdigit())
}

/// Raw colours in a string: `#0F1E2E`, `rgb(…)`, `hsl(…)`.
fn raw_colours(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let lower = s.to_ascii_lowercase();
    for f in ["rgb(", "rgba(", "hsl(", "hsla("] {
        if lower.contains(f) {
            out.push(f.trim_end_matches('(').to_string() + "(…)");
        }
    }
    let b = s.as_bytes();
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'#' {
            let run: String = s[i + 1..]
                .chars()
                .take_while(char::is_ascii_hexdigit)
                .collect();
            let boundary = s[i + 1 + run.len()..]
                .chars()
                .next()
                .is_none_or(|c| !c.is_ascii_alphanumeric() && c != '-' && c != '_');
            let before_ok =
                i == 0 || !s[..i].ends_with(|c: char| c.is_ascii_alphanumeric() || c == '&');
            if matches!(run.len(), 3 | 6 | 8) && boundary && before_ok && is_hex(&format!("#{run}"))
            {
                out.push(format!("#{run}"));
            }
            i += 1 + run.len();
        } else {
            i += 1;
        }
    }
    out
}

/// `var:preset|color|ink` (theme.json's form, the slug itself) and
/// `var(--wp--preset--color--ink)` (CSS: the slug as WordPress kebab-cases it) references in a
/// string, as `(kind, slug, css)`.
fn preset_refs(s: &str) -> Vec<(String, String, bool)> {
    let mut out = Vec::new();
    let mut rest = s;
    while let Some(i) = rest.find("var:preset|") {
        let after = &rest[i + 11..];
        let end = after
            .find(|c: char| !(c.is_ascii_alphanumeric() || c == '|' || c == '-' || c == '_'))
            .unwrap_or(after.len());
        let mut parts = after[..end].splitn(2, '|');
        if let (Some(k), Some(slug)) = (parts.next(), parts.next()) {
            out.push((k.to_string(), slug.to_string(), false));
        }
        rest = &after[end..];
    }
    let mut rest = s;
    while let Some(i) = rest.find("--wp--preset--") {
        let after = &rest[i + 14..];
        let end = after
            .find(|c: char| !(c.is_ascii_alphanumeric() || c == '-' || c == '_'))
            .unwrap_or(after.len());
        if let Some((k, slug)) = after[..end].split_once("--") {
            out.push((k.to_string(), slug.to_string(), true));
        }
        rest = &after[end..];
    }
    out
}

/// Every string in a JSON value with its key.
fn strings<'a>(v: &'a Value, key: &str, out: &mut Vec<(String, &'a str)>) {
    match v {
        Value::String(s) => out.push((key.to_string(), s)),
        Value::Array(a) => a.iter().for_each(|x| strings(x, key, out)),
        Value::Object(m) => m.iter().for_each(|(k, x)| strings(x, k, out)),
        _ => {}
    }
}

/// `(tag, attributes)` of every start tag in some HTML.
fn tags(html: &str) -> Vec<(String, Vec<(String, String)>)> {
    let mut out = Vec::new();
    let b = html.as_bytes();
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'<' && i + 1 < b.len() && b[i + 1].is_ascii_alphabetic() {
            let end = html[i..].find('>').map_or(html.len(), |e| i + e);
            let inner = &html[i + 1..end];
            let name_end = inner
                .find(|c: char| c.is_whitespace() || c == '/')
                .unwrap_or(inner.len());
            let tag = inner[..name_end].to_ascii_lowercase();
            let mut attrs = Vec::new();
            let mut rest = inner[name_end..].trim_start_matches('/');
            loop {
                rest = rest.trim_start();
                if rest.is_empty() || rest.starts_with('/') {
                    break;
                }
                let n_end = rest
                    .find(|c: char| c.is_whitespace() || c == '=' || c == '/')
                    .unwrap_or(rest.len());
                let name = rest[..n_end].to_ascii_lowercase();
                rest = rest[n_end..].trim_start();
                let mut value = String::new();
                if let Some(r) = rest.strip_prefix('=') {
                    let r = r.trim_start();
                    if let Some(q) = r.chars().next().filter(|c| *c == '"' || *c == '\'') {
                        let close = r[1..].find(q).map_or(r.len(), |e| e + 1);
                        value = r[1..close.min(r.len())].to_string();
                        rest = r.get(close + 1..).unwrap_or("");
                    } else {
                        let e = r.find(char::is_whitespace).unwrap_or(r.len());
                        value = r[..e].to_string();
                        rest = &r[e..];
                    }
                }
                if name.is_empty() {
                    break;
                }
                attrs.push((name, value));
            }
            out.push((tag, attrs));
            i = end;
        } else {
            i += 1;
        }
    }
    out
}

fn preset_issue(at: &str, line: usize, kind: &str, slug: &str, p: &Presets) -> Issue {
    let list = p.list(kind);
    let shown: Vec<&str> = list.iter().take(24).map(String::as_str).collect();
    Issue::new(
        IssueCode::Token,
        at,
        format!(
            "line {line}: the {kind} preset \"{slug}\" does not exist; use one of: {}",
            shown.join(", ")
        ),
    )
}

/// A CSS-form reference (`--wp--preset--font-size--h1`, `has-h1-font-size`) that names no preset.
fn css_preset_issue(at: &str, line: usize, kind: &str, slug: &str, p: &Presets) -> Issue {
    let list: Vec<String> = p
        .list(kind)
        .iter()
        .map(|s| crate::styles::wp_kebab(s))
        .collect();
    let shown: Vec<&str> = list.iter().take(24).map(String::as_str).collect();
    Issue::new(
        IssueCode::Token,
        at,
        format!(
            "line {line}: \"{slug}\" names no {kind} preset in CSS (WordPress writes the slugs kebab-cased: {}); better, use the block's attributes",
            shown.join(", ")
        ),
    )
}

fn colour_of(attrs: &Map<String, Value>, attr: &str, style_key: &str) -> Option<String> {
    if let Some(s) = attrs.get(attr).and_then(Value::as_str) {
        return Some(s.to_string());
    }
    let v = attrs.get("style")?.get("color")?.get(style_key)?.as_str()?;
    v.strip_prefix("var:preset|color|").map(String::from)
}

fn level_of(b: &Block) -> u64 {
    let default = match b.name.as_str() {
        "core/heading" | "core/post-title" => 2,
        "core/site-title" | "core/query-title" => 1,
        _ => 0,
    };
    b.attrs
        .get("level")
        .and_then(Value::as_u64)
        .unwrap_or(default)
}

/// `4.5/5` and the like in some text: `(number, denominator)`.
fn ratings(text: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let chars: Vec<char> = text.chars().collect();
    for (i, c) in chars.iter().enumerate() {
        if *c != '/' {
            continue;
        }
        let mut a = i;
        while a > 0
            && (chars[a - 1].is_ascii_digit()
                || chars[a - 1] == '.'
                || chars[a - 1] == ','
                || chars[a - 1] == ' ')
        {
            a -= 1;
        }
        let mut z = i + 1;
        while z < chars.len() && (chars[z].is_ascii_digit() || chars[z] == ' ') {
            z += 1;
        }
        let num: String = chars[a..i]
            .iter()
            .collect::<String>()
            .trim_start_matches(|c: char| !c.is_ascii_digit())
            .trim()
            .to_string();
        let den: String = chars[i + 1..z]
            .iter()
            .collect::<String>()
            .trim()
            .to_string();
        if !num.is_empty()
            && !den.is_empty()
            && num.chars().next().is_some_and(|c| c.is_ascii_digit())
        {
            out.push((num, den));
        }
    }
    out
}

/// The first `[…]` in some text that is a design's placeholder (`[°]`, `[CREDIT]`, `[Excerpt — two
/// lines]`): square brackets around at most 60 characters, not a link's or a binding's.
pub fn placeholder(text: &str) -> Option<String> {
    let mut rest = text;
    while let Some(a) = rest.find('[') {
        let after = &rest[a + 1..];
        let b = after.find(']')?;
        let inner = &after[..b];
        if b <= 60 && !inner.contains(['{', '[', '<']) && !after[b + 1..].starts_with('(') {
            return Some(format!("[{inner}]"));
        }
        rest = &after[b + 1..];
    }
    None
}

/// The checks of one template or part (module docs). Empty: it passes.
pub fn check_template(task: &TemplateTask, markup: &str, ctx: &CheckContext<'_>) -> Vec<Issue> {
    let at = task.label();
    let mut out = Vec::new();
    if markup.trim().is_empty() {
        out.push(Issue::new(IssueCode::Missing, &at, "the markup is empty"));
        return out;
    }

    // --- safety (on the raw text: it holds even where the grammar does not)
    let lower = markup.to_ascii_lowercase();
    for (needle, what) in [
        ("<script", "a <script>"),
        ("<iframe", "an <iframe>"),
        ("<object", "an <object>"),
        ("<embed", "an <embed>"),
        ("javascript:", "a javascript: URL"),
    ] {
        if lower.contains(needle) {
            out.push(Issue::new(
                IssueCode::Unsafe,
                &at,
                format!("{what} is not allowed in a template (core blocks only, no scripts)"),
            ));
        }
    }

    // --- grammar
    let nodes = match blocks::parse(markup) {
        Ok(n) => n,
        Err(errors) => {
            out.extend(errors.into_iter().map(|e| {
                Issue::new(
                    IssueCode::Grammar,
                    &at,
                    format!("line {}: {}", e.line, e.message),
                )
            }));
            return out;
        }
    };
    let all = blocks::all(&nodes);
    let p = ctx.presets;
    let placeholder_rule = ctx
        .rule(|c| matches!(c, RuleCheck::NoPlaceholderLinks))
        .map(|(id, _)| id);
    let alt_rule = ctx
        .rule(|c| matches!(c, RuleCheck::RequiredFields { fields } if fields.iter().any(|f| f == "alt")))
        .map(|(id, _)| id);
    let urls = ctx.site.urls();
    let link = |out: &mut Vec<Issue>, line: usize, href: &str| {
        let h = href.trim();
        if h.is_empty() || h.starts_with('#') {
            out.push(
                Issue::new(
                    IssueCode::Link,
                    &at,
                    format!("line {line}: a link to \"{h}\" goes nowhere; link one of the site's pages or leave the link out"),
                )
                .with_rule(placeholder_rule),
            );
        } else if !urls.contains(h) {
            let some: Vec<&str> = urls.iter().take(12).map(String::as_str).collect();
            out.push(Issue::new(
                IssueCode::Link,
                &at,
                format!(
                    "line {line}: {h} is not a page of the site; link only the site's pages ({}, …)",
                    some.join(", ")
                ),
            ));
        }
    };

    // --- blocks the task forbids
    for b in &all {
        if let Some((_, why)) = task.forbid.iter().find(|(n, _)| *n == b.name) {
            out.push(Issue::new(
                IssueCode::Block,
                &at,
                format!("line {}: {} is not used here: {why}", b.line, b.name),
            ));
        }
    }

    // --- a page header in the design's order (4.9): breadcrumb, eyebrow, title, lede
    if task.sections.iter().any(|s| s.kind == "title") {
        let at_of = |f: &dyn Fn(&blocks::Block) -> bool| all.iter().position(|b| f(b));
        let order = [
            ("the breadcrumb", at_of(&|b| b.name == "core/breadcrumbs")),
            (
                "the eyebrow",
                at_of(&|b| b.name == "core/post-terms" && b.classes().contains(&"ds-eyebrow")),
            ),
            ("the title", at_of(&|b| b.name == "core/post-title")),
            ("the lede", at_of(&|b| b.name == "core/post-excerpt")),
        ];
        let mut last: Option<(&str, usize)> = None;
        for (what, pos) in order {
            let Some(pos) = pos else { continue };
            if let Some((before, p)) = last {
                if pos < p {
                    out.push(Issue::new(
                        IssueCode::Rule,
                        &at,
                        format!(
                            "the page header puts {what} before {before}; the design's order is the breadcrumb, the eyebrow, the title (h1), the lede"
                        ),
                    ));
                }
            }
            last = Some((what, pos));
        }
    }

    // --- each block
    for b in &all {
        let line = b.line;
        if !ALLOWED_BLOCKS.contains(&b.name.as_str()) {
            out.push(Issue::new(
                IssueCode::Block,
                &at,
                format!(
                    "line {line}: {} is not an allowed block; use WordPress core blocks only (group, columns, heading, paragraph, image, query, post-template, post-title, navigation, …)",
                    b.name
                ),
            ));
        }
        for a in COLOUR_ATTRS {
            if let Some(slug) = b.attrs.get(*a).and_then(Value::as_str) {
                if !p.has("color", slug) {
                    out.push(preset_issue(&at, line, "color", slug, p));
                }
            }
        }
        if let Some(slug) = b.attrs.get("fontSize").and_then(Value::as_str) {
            if !p.has("font-size", slug) {
                out.push(preset_issue(&at, line, "font-size", slug, p));
            }
        }
        if let Some(slug) = b.attrs.get("fontFamily").and_then(Value::as_str) {
            if !p.has("font-family", slug) {
                out.push(preset_issue(&at, line, "font-family", slug, p));
            }
        }
        let mut strs = Vec::new();
        for (k, v) in &b.attrs {
            strings(v, k, &mut strs);
        }
        for (k, s) in &strs {
            for (kind, slug, css) in preset_refs(s) {
                if css && !p.has_css(&kind, &slug) {
                    out.push(css_preset_issue(&at, line, &kind, &slug, p));
                } else if !css && !p.has(&kind, &slug) {
                    out.push(preset_issue(&at, line, &kind, &slug, p));
                }
            }
            for raw in raw_colours(s) {
                out.push(Issue::new(
                    IssueCode::Token,
                    &at,
                    format!(
                        "line {line}: {} sets the raw colour {raw} in \"{k}\"; use a palette preset (\"var:preset|color|{}\" or the colour attributes)",
                        short(&b.name),
                        p.role("text").unwrap_or("ink")
                    ),
                ));
            }
            // An image's or a cover's `url` is its picture, not a link.
            let picture = matches!(b.name.as_str(), "core/image" | "core/cover") && k == "url";
            if matches!(k.as_str(), "url" | "href" | "link") && !picture {
                link(&mut out, line, s);
            }
        }
        if let Some(bindings) = b
            .attrs
            .get("metadata")
            .and_then(|m| m.get("bindings"))
            .and_then(Value::as_object)
        {
            let fields: BTreeSet<&str> = task
                .sections
                .iter()
                .flat_map(|s| s.fields.iter().map(String::as_str))
                .collect();
            for (attr, binding) in bindings {
                let source = binding.get("source").and_then(Value::as_str).unwrap_or("");
                let key = binding
                    .get("args")
                    .and_then(|a| a.get("key"))
                    .and_then(Value::as_str)
                    .unwrap_or("");
                if source != "core/post-meta" {
                    out.push(Issue::new(
                        IssueCode::Block,
                        &at,
                        format!("line {line}: the binding of \"{attr}\" has the source \"{source}\"; only \"core/post-meta\" (an entry's field) is allowed"),
                    ));
                } else if !fields.contains(key) {
                    let mut known: Vec<&str> = fields.iter().copied().collect();
                    known.sort_unstable();
                    out.push(Issue::new(
                        IssueCode::Query,
                        &at,
                        format!(
                            "line {line}: the field \"{key}\" is none of this template's entries' fields ({})",
                            if known.is_empty() { "none".to_string() } else { known.join(", ") }
                        ),
                    ));
                }
            }
        }
        if b.name == "core/navigation" && b.attrs.contains_key("ref") {
            out.push(Issue::new(
                IssueCode::Block,
                &at,
                format!("line {line}: a navigation block names its menu by class (sp-menu-{{name}}), never by a post id (\"ref\")"),
            ));
        }
        if b.name == "core/template-part" {
            let slug = b.attrs.get("slug").and_then(Value::as_str).unwrap_or("");
            if task.kind == TaskKind::Part {
                out.push(Issue::new(
                    IssueCode::Block,
                    &at,
                    format!("line {line}: a part does not include parts (\"{slug}\")"),
                ));
            } else if !ctx.parts.iter().any(|x| x == slug) {
                out.push(Issue::new(
                    IssueCode::Missing,
                    &at,
                    format!(
                        "line {line}: the part \"{slug}\" does not exist; the theme's parts are {}",
                        ctx.parts.join(", ")
                    ),
                ));
            }
        }
        for c in b.classes() {
            for (prefix, suffix, kind) in [
                ("has-", "-background-color", "color"),
                ("has-", "-font-size", "font-size"),
                ("has-", "-font-family", "font-family"),
            ] {
                if let Some(slug) = c.strip_prefix(prefix).and_then(|r| r.strip_suffix(suffix)) {
                    if !p.has_css(kind, slug) {
                        out.push(css_preset_issue(&at, line, kind, slug, p));
                    }
                }
            }
        }
        // the block's own HTML
        let html = b.own_html();
        for (tag, attrs) in tags(&html) {
            for (name, value) in &attrs {
                if name.starts_with("on") && name.len() > 2 {
                    out.push(Issue::new(
                        IssueCode::Unsafe,
                        &at,
                        format!("line {line}: the event handler {name}= on <{tag}> is not allowed"),
                    ));
                }
                if name == "href" {
                    link(&mut out, line, value);
                }
                if name == "style" {
                    for raw in raw_colours(value) {
                        out.push(Issue::new(
                            IssueCode::Token,
                            &at,
                            format!(
                                "line {line}: <{tag} style> sets the raw colour {raw}; use a palette preset (var(--wp--preset--color--…))"
                            ),
                        ));
                    }
                    for (kind, slug, css) in preset_refs(value) {
                        if css && !p.has_css(&kind, &slug) {
                            out.push(css_preset_issue(&at, line, &kind, &slug, p));
                        } else if !css && !p.has(&kind, &slug) {
                            out.push(preset_issue(&at, line, &kind, &slug, p));
                        }
                    }
                }
            }
            let alt_bound = b
                .attrs
                .get("metadata")
                .and_then(|m| m.get("bindings"))
                .and_then(|x| x.get("alt"))
                .is_some();
            if tag == "img" && !alt_bound {
                let alt = attrs
                    .iter()
                    .find(|(n, _)| n == "alt")
                    .map(|(_, v)| v.trim());
                if alt.is_none_or(str::is_empty) {
                    out.push(
                        Issue::new(
                            IssueCode::Rule,
                            &at,
                            format!("line {line}: an <img> without alt text; describe the image in alt=\"…\""),
                        )
                        .with_rule(alt_rule),
                    );
                }
            }
        }
    }

    // --- the design's placeholders are not the site's content
    for b in &all {
        if !TEXT_BLOCKS.contains(&b.name.as_str()) {
            continue;
        }
        if let Some(ph) = placeholder(&b.text()) {
            out.push(Issue::new(
                IssueCode::Rule,
                &at,
                format!(
                    "line {}: \"{ph}\" is a placeholder of the design, not the site's content; show the site's data (a field, a query, the entry) or leave it out",
                    b.line
                ),
            ));
        }
    }

    // --- coverage
    let classes: BTreeSet<&str> = all.iter().flat_map(|b| b.classes()).collect();
    let has = |name: &str| all.iter().any(|b| b.name == name);
    // Every component instance the plan places carries its marker class.
    let wanted = task
        .components
        .iter()
        .chain(task.search.iter())
        .chain(task.menus.iter().flat_map(|m| m.components.iter()))
        .map(|c| (c.as_str(), None))
        .chain(task.sections.iter().flat_map(|s| {
            s.components
                .iter()
                .map(move |c| (c.as_str(), Some(s.id.as_str())))
        }));
    for (c, section) in wanted {
        let m = crate::catalog::marker(c);
        if !classes.contains(m.as_str()) {
            out.push(Issue::new(
                IssueCode::Missing,
                &at,
                format!(
                    "the design's component {c} is missing{}: render it and give its outermost block the class \"{m}\"",
                    section.map(|s| format!(" from the section {s}")).unwrap_or_default()
                ),
            ));
        }
    }
    for c in &task.classes {
        if !classes.contains(c.as_str()) {
            out.push(Issue::new(
                IssueCode::Missing,
                &at,
                format!("the template's main group needs the class \"{c}\""),
            ));
        }
    }
    for s in &task.sections {
        if !classes.contains(s.class.as_str()) {
            out.push(Issue::new(
                IssueCode::Missing,
                &at,
                format!(
                    "the section {} is missing: render it as a block with \"className\":\"{}\"{}",
                    s.id,
                    s.class,
                    s.heading
                        .as_deref()
                        .map(|h| format!(" (the design's \"{h}\")"))
                        .unwrap_or_default()
                ),
            ));
        }
        if s.kind == "entry" {
            if !has("core/post-content") {
                out.push(Issue::new(
                    IssueCode::Missing,
                    &at,
                    format!(
                        "the section {} shows the entry: it needs core/post-content",
                        s.id
                    ),
                ));
            }
            if !has("core/post-title") && task.slug != "front-page" {
                out.push(Issue::new(
                    IssueCode::Missing,
                    &at,
                    format!(
                        "the section {} shows the entry: it needs core/post-title (level 1)",
                        s.id
                    ),
                ));
            }
        }
        if s.kind == "title" && !has("core/post-title") {
            out.push(Issue::new(
                IssueCode::Missing,
                &at,
                format!(
                    "the section {} is the page's title: it needs core/post-title with \"level\":1",
                    s.id
                ),
            ));
        }
        if s.kind == "content" && !has("core/post-content") {
            out.push(Issue::new(
                IssueCode::Missing,
                &at,
                format!(
                    "the section {} is the page's own text: it needs core/post-content",
                    s.id
                ),
            ));
        }
        if let Some(q) = &s.query {
            let found = all.iter().any(|b| {
                b.name == "core/query"
                    && b.attrs.get("query").is_some_and(|bq| query_matches(bq, q))
            });
            if !found {
                out.push(Issue::new(
                    IssueCode::Query,
                    &at,
                    format!(
                        "the section {} lists {}: it needs a core/query with exactly \"query\":{}",
                        s.id,
                        s.collection.as_deref().unwrap_or("entries"),
                        q
                    ),
                ));
            }
        }
    }
    let offered: Vec<&Value> = task
        .sections
        .iter()
        .filter_map(|s| s.query.as_ref())
        .collect();
    for b in all.iter().filter(|b| b.name == "core/query") {
        let q = b.attrs.get("query").cloned().unwrap_or(Value::Null);
        if !offered.iter().any(|o| query_matches(&q, o)) {
            out.push(Issue::new(
                IssueCode::Query,
                &at,
                format!(
                    "line {}: the query {} is none the site offers here; use only the sections' queries",
                    b.line, q
                ),
            ));
        }
    }
    for part in &task.parts {
        let found = all.iter().any(|b| {
            b.name == "core/template-part"
                && b.attrs.get("slug").and_then(Value::as_str) == Some(part)
        });
        if !found {
            out.push(Issue::new(
                IssueCode::Missing,
                &at,
                format!("the part {part} is missing: add <!-- wp:template-part {{\"slug\":\"{part}\"}} /-->"),
            ));
        }
    }
    for m in &task.menus {
        let found = all
            .iter()
            .any(|b| b.name == "core/navigation" && b.classes().contains(&m.class.as_str()));
        if !found {
            out.push(Issue::new(
                IssueCode::Missing,
                &at,
                format!(
                    "the menu {} ({}) is missing: add <!-- wp:navigation {{\"className\":\"{}\"}} /-->",
                    m.name, m.label, m.class
                ),
            ));
        }
    }

    // --- contrast
    let text0 = p.role("text").map(String::from);
    let bg0 = p.role("background").map(String::from);
    let link0 = p.role("link").map(String::from);
    let best_on = |g: &str| {
        p.colors
            .get(g)
            .and_then(|gh| {
                p.colors
                    .iter()
                    .filter(|(k, _)| k.as_str() != g)
                    .max_by_key(|(_, h)| site_design::contrast_x100(h, gh).unwrap_or(0))
            })
            .map(|(k, _)| k.clone())
            .unwrap_or_default()
    };
    blocks::walk(&nodes, &mut |b, path| {
        let mut text = text0.clone();
        let mut bg = bg0.clone();
        let mut link = link0.clone();
        let mut set = false;
        let mut band = false;
        for x in path.iter().copied().chain(std::iter::once(b)) {
            if let Some(c) = colour_of(&x.attrs, "textColor", "text") {
                text = Some(c);
                set = true;
            }
            if let Some(c) = colour_of(&x.attrs, "backgroundColor", "background").or_else(|| {
                x.attrs
                    .get("overlayColor")
                    .and_then(Value::as_str)
                    .map(String::from)
            }) {
                bg = Some(c);
                set = true;
                band = true;
            }
            if let Some(c) = x
                .attrs
                .get("style")
                .and_then(|s| {
                    s.get("elements")?
                        .get("link")?
                        .get("color")?
                        .get("text")?
                        .as_str()
                })
                .and_then(|v| v.strip_prefix("var:preset|color|"))
            {
                link = Some(c.to_string());
            }
        }
        // Links take the theme's link colour (WordPress's `a` element style) on any band,
        // unless the band names its own.
        let shows_links = matches!(
            b.name.as_str(),
            "core/navigation" | "core/post-terms" | "core/read-more" | "core/query-pagination"
        ) || (b.name == "core/post-title"
            && b.attrs.get("isLink") == Some(&Value::Bool(true)))
            || b.own_html().contains("<a ");
        if band && shows_links {
            if let (Some(l), Some(g)) = (link.as_deref(), bg.as_deref()) {
                if let (Some(lh), Some(gh)) = (p.colors.get(l), p.colors.get(g)) {
                    let ratio = site_design::contrast_x100(lh, gh).unwrap_or(0);
                    if ratio < AA_TEXT_X100 {
                        out.push(Issue::new(
                            IssueCode::Contrast,
                            &at,
                            format!(
                                "line {}: {} links \"{l}\" on \"{g}\" are {}.{:02}:1; WCAG AA needs 4.50:1 (set \"style\":{{\"elements\":{{\"link\":{{\"color\":{{\"text\":\"var:preset|color|{}\"}}}}}}}} on the band)",
                                b.line,
                                short(&b.name),
                                ratio / 100,
                                ratio % 100,
                                best_on(g)
                            ),
                        ));
                    }
                }
            }
        }
        if !set || !TEXT_BLOCKS.contains(&b.name.as_str()) {
            return;
        }
        let (Some(t), Some(g)) = (text, bg) else {
            return;
        };
        let (Some(th), Some(gh)) = (p.colors.get(&t), p.colors.get(&g)) else {
            return;
        };
        let Some(ratio) = site_design::contrast_x100(th, gh) else {
            return;
        };
        let large = LARGE_BLOCKS.contains(&b.name.as_str())
            || b.attrs
                .get("fontSize")
                .and_then(Value::as_str)
                .is_some_and(|s| p.large_sizes.contains(s));
        let need = if large { AA_LARGE_X100 } else { AA_TEXT_X100 };
        if ratio < need {
            let better = best_on(&g);
            out.push(Issue::new(
                IssueCode::Contrast,
                &at,
                format!(
                    "line {}: {} text \"{t}\" on \"{g}\" is {}.{:02}:1; WCAG AA needs {}.{:02}:1 (set \"textColor\":\"{better}\" on it or its group)",
                    b.line,
                    short(&b.name),
                    ratio / 100,
                    ratio % 100,
                    need / 100,
                    need % 100
                ),
            ));
        }
    });

    // --- the design's rules
    for (id, rule) in ctx.rules {
        match rule {
            RuleCheck::RatingScale { max, decimals } => {
                for b in &all {
                    if !TEXT_BLOCKS.contains(&b.name.as_str()) {
                        continue;
                    }
                    let text = b.text();
                    if text.contains('★') || text.contains('☆') {
                        out.push(
                            Issue::new(
                                IssueCode::Rule,
                                &at,
                                format!(
                                    "line {}: ratings in stars; ratings use one scale, n/{max}",
                                    b.line
                                ),
                            )
                            .with_rule(Some(id)),
                        );
                    }
                    for (num, den) in ratings(&text) {
                        let dec = num.split(['.', ',']).nth(1).map_or(0, str::len);
                        if den != max.to_string() || dec != *decimals as usize {
                            out.push(
                                Issue::new(
                                    IssueCode::Rule,
                                    &at,
                                    format!(
                                        "line {}: the rating {num}/{den} is not on the design's scale: n/{max} with {decimals} decimal(s)",
                                        b.line
                                    ),
                                )
                                .with_rule(Some(id)),
                            );
                        }
                    }
                }
            }
            RuleCheck::HeadlineWithoutSiteName => {
                let name = ctx.site.name.trim().to_lowercase();
                let mut h1 = 0;
                let mut found = Vec::new();
                blocks::walk(&nodes, &mut |b, path| {
                    if b.name == "core/site-title" && level_of(b) != 0 {
                        found.push(format!(
                            "line {}: core/site-title renders the site's name as an h{}; give it \"level\":0 so the page's h1 is its headline only",
                            b.line,
                            level_of(b)
                        ));
                    }
                    let in_query = path.iter().any(|x| x.name == "core/query");
                    let is_h1 = matches!(
                        b.name.as_str(),
                        "core/heading" | "core/post-title" | "core/query-title"
                    ) && level_of(b) == 1;
                    if is_h1 && in_query {
                        found.push(format!(
                            "line {}: an h1 inside a query repeats for every entry; listed titles are level 2 or 3",
                            b.line
                        ));
                    } else if is_h1 {
                        h1 += 1;
                        let text = b.text().to_lowercase();
                        if !name.is_empty() && text.contains(&name) {
                            found.push(format!(
                                "line {}: the h1 carries the site's name; the h1 is the page's headline only",
                                b.line
                            ));
                        }
                    }
                });
                if h1 > 1 {
                    found.push(format!(
                        "the template has {h1} h1s; a page has one h1, its headline (make the others level 2)"
                    ));
                }
                out.extend(
                    found
                        .into_iter()
                        .map(|m| Issue::new(IssueCode::Rule, &at, m).with_rule(Some(id))),
                );
            }
            RuleCheck::RequiredFields { fields } if fields.iter().any(|f| f == "category") => {
                for b in all.iter().filter(|b| b.name == "core/query") {
                    let q = b.attrs.get("query");
                    let posts = q.is_some_and(|q| {
                        q.get("postType").and_then(Value::as_str) == Some("post")
                            || (q.get("inherit") == Some(&Value::Bool(true))
                                && matches!(task.slug.as_str(), "index" | "archive"))
                    });
                    if !posts {
                        continue;
                    }
                    let terms = blocks::all(&b.inner).iter().any(|x| {
                        x.name == "core/post-terms"
                            && x.attrs.get("term").and_then(Value::as_str) == Some("category")
                    });
                    if !terms {
                        out.push(
                            Issue::new(
                                IssueCode::Rule,
                                &at,
                                format!(
                                    "line {}: every listed story shows its category: add <!-- wp:post-terms {{\"term\":\"category\"}} /--> to the post-template",
                                    b.line
                                ),
                            )
                            .with_rule(Some(id)),
                        );
                    }
                }
            }
            RuleCheck::PriceScale { symbol, max } => {
                for b in all
                    .iter()
                    .filter(|b| TEXT_BLOCKS.contains(&b.name.as_str()))
                {
                    let text = b.text();
                    let mut run = 0u32;
                    let mut longest = 0u32;
                    for c in text.chars() {
                        if symbol.starts_with(c) {
                            run += 1;
                            longest = longest.max(run);
                        } else {
                            run = 0;
                        }
                    }
                    if longest > *max {
                        out.push(
                            Issue::new(
                                IssueCode::Rule,
                                &at,
                                format!("line {}: a price of {longest} {symbol}; prices go from 1 to {max} {symbol}", b.line),
                            )
                            .with_rule(Some(id)),
                        );
                    }
                }
            }
            _ => {}
        }
    }
    out.dedup();
    out
}

/// `query` equals `want` on every key `want` has (`perPage` included); other keys of
/// `query` may be WordPress's defaults (`pages`, `offset`, `exclude`).
fn query_matches(query: &Value, want: &Value) -> bool {
    let Some(w) = want.as_object() else {
        return false;
    };
    w.iter().all(|(k, v)| match query.get(k) {
        Some(x) => x == v,
        None => matches!((k.as_str(), v), ("inherit", Value::Bool(false))),
    })
}

/// The rules no template check can enforce, as notes for the report.
pub fn guidance(plan: &ThemePlan) -> Vec<Issue> {
    let mut out = Vec::new();
    for (id, rule) in &plan.rules {
        let note = match rule {
            RuleCheck::OneImagePerStory => {
                Some("one image per story is the content's rule: the editors check it".to_string())
            }
            RuleCheck::RequiresComponent { component } => {
                let used = plan.tasks.iter().any(|t| {
                    t.sections
                        .iter()
                        .any(|s| s.what.as_deref() == Some(component.as_str()))
                });
                (!used).then(|| format!("the component {component} is the content's to use; no template section shows it"))
            }
            RuleCheck::RequiredFields { fields } => {
                let rest: Vec<&str> = fields
                    .iter()
                    .map(String::as_str)
                    .filter(|f| *f != "alt" && *f != "category")
                    .collect();
                (!rest.is_empty()).then(|| {
                    format!(
                        "the fields {} are the entries' to carry: no core block shows custom fields",
                        rest.join(", ")
                    )
                })
            }
            _ => None,
        };
        if let Some(n) = note {
            out.push(Issue::new(IssueCode::Note, "design rules", n).with_rule(Some(id)));
        }
    }
    out
}

/// The fonts' licences: every family the theme ships or names must be one of
/// [`OFL_FONTS`]. Checked before any model call ([`ThemePlan::font_licences`]) and again
/// on the whole theme.
pub fn licences(fonts: &[site_design::wordpress::ThemeFontFamily], settings: &Value) -> Vec<Issue> {
    let mut out = Vec::new();
    let mut names: Vec<String> = fonts.iter().map(|f| f.name.clone()).collect();
    if let Some(list) = settings["typography"]["fontFamilies"].as_array() {
        names.extend(
            list.iter()
                .filter_map(|f| f["fontFamily"].as_str())
                .map(first_family),
        );
    }
    let mut seen = BTreeSet::new();
    for n in names {
        if seen.insert(n.clone()) && !OFL_FONTS.contains(&n.as_str()) {
            out.push(Issue::new(
                IssueCode::Font,
                "fonts",
                format!("{n} is not among the licensed families (SIL OFL): ship it only with its licence checked, or use a licensed family"),
            ));
        }
    }
    out
}

impl ThemePlan {
    /// The design's fonts' licences, before any model call: a design that fails here
    /// cannot become a theme whatever the model writes.
    pub fn font_licences(&self) -> Vec<Issue> {
        licences(&self.fonts, &self.global_styles.settings)
    }
}

fn global_refs(v: &Value, p: &Presets, out: &mut Vec<Issue>) {
    let mut strs = Vec::new();
    strings(v, "", &mut strs);
    for (_, s) in strs {
        for (kind, slug, css) in preset_refs(s) {
            let found = if css {
                p.has_css(&kind, &slug)
            } else {
                p.has(&kind, &slug)
            };
            if !found {
                out.push(Issue::new(
                    IssueCode::Token,
                    "global styles",
                    format!("the {kind} preset \"{slug}\" does not exist"),
                ));
            }
        }
    }
}

/// The whole theme (module docs). Empty: it may be written.
pub fn check_theme(data: &ThemeData, plan: &ThemePlan) -> Vec<Issue> {
    let mut out: Vec<Issue> = data
        .validate_shape()
        .into_iter()
        .map(|i| Issue::new(IssueCode::Shape, i.at, i.message))
        .collect();
    out.extend(plan.notes.iter().filter(|n| n.is_error()).cloned());
    let have: BTreeSet<&str> = data.templates.iter().map(|t| t.slug.as_str()).collect();
    for r in &plan.required {
        if !have.contains(r.as_str()) {
            out.push(Issue::new(
                IssueCode::Missing,
                "templates",
                format!("the template {r} is missing"),
            ));
        }
    }
    out.extend(licences(&data.fonts, &data.global_styles.settings));
    // the source site's navigation, every entry (ADR-0093 addendum)
    if !plan.site.menus.is_empty() {
        out.extend(crate::navigation::check_navigation(
            &data.navigation,
            &plan.site,
        ));
    }
    // presets and pairs of the global styles
    let p = &plan.presets;
    global_refs(&data.global_styles.styles, p, &mut out);
    let slug = |v: &Value| {
        v.as_str()
            .and_then(|s| s.strip_prefix("var:preset|color|"))
            .map(String::from)
    };
    let st = &data.global_styles.styles;
    let bg = slug(&st["color"]["background"]);
    let pairs = [
        (
            "body text",
            slug(&st["color"]["text"]),
            bg.clone(),
            AA_TEXT_X100,
        ),
        (
            "links",
            slug(&st["elements"]["link"]["color"]["text"]),
            bg.clone(),
            AA_TEXT_X100,
        ),
        (
            "headings",
            slug(&st["elements"]["heading"]["color"]["text"]),
            bg.clone(),
            AA_LARGE_X100,
        ),
        (
            "buttons",
            slug(&st["elements"]["button"]["color"]["text"]),
            slug(&st["elements"]["button"]["color"]["background"]),
            AA_TEXT_X100,
        ),
    ];
    for (what, t, g, need) in pairs {
        let (Some(t), Some(g)) = (t, g) else { continue };
        let (Some(th), Some(gh)) = (p.colors.get(&t), p.colors.get(&g)) else {
            continue;
        };
        if let Some(r) = site_design::contrast_x100(th, gh) {
            if r < need {
                out.push(Issue::new(
                    IssueCode::Contrast,
                    "global styles",
                    format!(
                        "{what}: \"{t}\" on \"{g}\" is {}.{:02}:1; WCAG AA needs {}.{:02}:1",
                        r / 100,
                        r % 100,
                        need / 100,
                        need % 100
                    ),
                ));
            }
        }
    }
    // every template and part again
    let parts: Vec<String> = data.template_parts.iter().map(|p| p.slug.clone()).collect();
    let ctx = plan.context(&parts);
    for t in &plan.tasks {
        let content = match t.kind {
            TaskKind::Template => data
                .templates
                .iter()
                .find(|x| x.slug == t.slug)
                .map(|x| &x.content),
            TaskKind::Part => data
                .template_parts
                .iter()
                .find(|x| x.slug == t.slug)
                .map(|x| &x.content),
        };
        if let Some(c) = content {
            out.extend(check_template(t, c, &ctx));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scanners() {
        assert_eq!(raw_colours("color:#0F1E2E; x"), vec!["#0F1E2E"]);
        assert_eq!(raw_colours("rgb(1,2,3)"), vec!["rgb(…)"]);
        assert!(raw_colours("a#hash-link &#39; #main").is_empty());
        assert_eq!(
            preset_refs("var:preset|color|ink and var(--wp--preset--spacing--space-5)"),
            vec![
                ("color".into(), "ink".into(), false),
                ("spacing".into(), "space-5".into(), true)
            ]
        );
        let t = tags("<a href=\"/en/\" onclick='x()'>x</a><img src=a.png alt>");
        assert_eq!(t[0].0, "a");
        assert_eq!(t[0].1[1].0, "onclick");
        assert_eq!(t[1].1[1], ("alt".to_string(), String::new()));
        assert_eq!(
            ratings("Rated 4.5/5 by readers, 8.0 / 10"),
            vec![("4.5".into(), "5".into()), ("8.0".into(), "10".into())]
        );
        assert!(query_matches(
            &serde_json::json!({"postType": "post", "perPage": 6, "pages": 0}),
            &serde_json::json!({"postType": "post", "perPage": 6, "inherit": false})
        ));
    }
}
