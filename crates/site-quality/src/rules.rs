//! The deterministic rules of the standard, judged over the facts. One implementation: the
//! collector observes, this module decides.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

use crate::facts::{host_of, PageFacts, SiteFacts};
use crate::standard::{Applies, Dimension, Kind, Route, Rule, Standard};

/// Every deterministic rule this crate evaluates (a standard naming another is refused).
pub const EVALUATED: &[&str] = &[
    "page-render",
    "empty-frame",
    "broken-image",
    "alt-missing",
    "alt-title",
    "link-hash",
    "link-broken",
    "link-anchor",
    "request-failed",
    "request-production",
    "export-hygiene",
    "overflow",
    "narrow-column",
    "h1-count",
    "h1-own",
    "heading-order",
    "hero-first",
    "raw-slug",
    "english-label",
    "seo-title",
    "seo-description",
    "seo-canonical",
    "seo-hreflang",
    "seo-sitemap",
    "seo-duplicate-title",
];

/// One rule broken on one page at one width.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct Finding {
    pub rule: String,
    pub page: String,
    pub page_type: String,
    pub width: u32,
    pub detail: String,
    pub dimension: Dimension,
    pub route: Route,
    /// In the page's authored content.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub authored: bool,
    /// The listed content gap that excepts it (its reason).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exception: Option<String>,
}

const DETAIL_CHARS: usize = 200;

fn cut(s: &str) -> String {
    let s = s.split_whitespace().collect::<Vec<_>>().join(" ");
    if s.chars().count() <= DETAIL_CHARS {
        s
    } else {
        let mut o: String = s.chars().take(DETAIL_CHARS).collect();
        o.push('…');
        o
    }
}

/// Curly quotes straight, whitespace collapsed, trimmed.
pub fn norm(s: &str) -> String {
    s.replace(['\u{2018}', '\u{2019}', '\u{02bc}'], "'")
        .replace(['\u{201c}', '\u{201d}'], "\"")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Lowercase letters and digits, words separated by one space (for comparing titles).
pub fn fold(s: &str) -> String {
    let mut out = String::new();
    let mut gap = false;
    for c in s.chars().flat_map(char::to_lowercase) {
        if c.is_alphanumeric() {
            if gap && !out.is_empty() {
                out.push(' ');
            }
            out.push(c);
            gap = false;
        } else {
            gap = true;
        }
    }
    out
}

/// `church`, `getting-here`, `boat_tours`: a slug, not a label.
pub fn is_slug(s: &str) -> bool {
    let mut chars = s.chars();
    match chars.next() {
        Some(c) if c.is_ascii_lowercase() => {}
        _ => return false,
    }
    let mut prev_sep = false;
    for c in chars {
        if c.is_ascii_lowercase() || c.is_ascii_digit() {
            prev_sep = false;
        } else if c == '-' || c == '_' {
            if prev_sep {
                return false;
            }
            prev_sep = true;
        } else {
            return false;
        }
    }
    !prev_sep
}

/// The page's own title: the document title before its site suffix (`Vernazza | Site` →
/// `Vernazza`).
pub fn page_title(title: &str) -> String {
    let t = norm(title);
    for sep in [" | ", " – ", " — "] {
        if let Some((a, _)) = t.split_once(sep) {
            return a.trim().to_string();
        }
    }
    t
}

fn same_path(a: &str, b: &str) -> bool {
    a.trim_end_matches('/') == b.trim_end_matches('/')
}

/// The page asks not to be indexed: it shows in no search result, so it needs no snippet
/// (description) and no title of its own among the site's.
pub fn noindex(f: &PageFacts) -> bool {
    f.head
        .robots
        .as_deref()
        .is_some_and(|r| r.to_ascii_lowercase().contains("noindex"))
}

/// The page names another page of the release as its canonical (and that page is not the home):
/// it declares itself a second URL of that page, which carries the language versions, the
/// sitemap entry and the title.
pub fn declared_duplicate(site: &SiteFacts, f: &PageFacts) -> bool {
    f.head.canonical.as_deref().is_some_and(|c| {
        site.own_path(&f.path, c)
            .is_some_and(|p| !same_path(&p, &f.path) && p != "/" && site.serves(&p))
    })
}

struct Ctx<'a> {
    std: &'a Standard,
    site: &'a SiteFacts,
    out: Vec<Finding>,
}

impl Ctx<'_> {
    fn add(&mut self, rule: &Rule, f: &PageFacts, authored: bool, detail: impl AsRef<str>) {
        self.out.push(Finding {
            rule: rule.id.clone(),
            page: f.path.clone(),
            page_type: f.page_type.clone(),
            width: f.width,
            detail: cut(detail.as_ref()),
            dimension: rule.dimension,
            route: rule.route_for(authored),
            authored,
            exception: None,
        });
    }

    fn rule(&self, id: &str) -> Option<Rule> {
        self.std
            .rule(id)
            .filter(|r| r.kind == Kind::Deterministic)
            .cloned()
    }
}

fn applies(rule: &Rule, f: &PageFacts, widest: bool) -> bool {
    match rule.applies {
        Applies::All => true,
        Applies::Widest => widest,
        Applies::Narrow => {
            let max = rule.params.get("max_viewport_px").copied().unwrap_or(500);
            i64::from(f.width) <= max
        }
        Applies::Wide => {
            let min = rule.params.get("min_viewport_px").copied().unwrap_or(1200);
            i64::from(f.width) >= min
        }
    }
}

/// Every deterministic finding of `std` over the audits (`pages`: one entry per page and
/// width), sorted. Judged rules are not evaluated here.
pub fn evaluate(std: &Standard, site: &SiteFacts, pages: &[PageFacts]) -> Vec<Finding> {
    let mut cx = Ctx {
        std,
        site,
        out: Vec::new(),
    };
    // The widest audit of each page carries the page-level rules.
    let mut widest: BTreeMap<&str, u32> = BTreeMap::new();
    for f in pages {
        let w = widest.entry(f.path.as_str()).or_insert(f.width);
        *w = (*w).max(f.width);
    }
    let rules: Vec<Rule> = EVALUATED.iter().filter_map(|id| cx.rule(id)).collect();
    for f in pages {
        let is_widest = widest.get(f.path.as_str()) == Some(&f.width);
        if let Some(r) = rules.iter().find(|r| r.id == "page-render") {
            if f.error.is_some() || f.status >= 400 {
                let why = f
                    .error
                    .clone()
                    .unwrap_or_else(|| format!("answered {}", f.status));
                cx.add(r, f, false, format!("the page did not render: {why}"));
                continue;
            }
        } else if f.error.is_some() {
            continue;
        }
        for r in &rules {
            if r.id == "page-render" || !applies(r, f, is_widest) {
                continue;
            }
            page_rule(&mut cx, r, f);
        }
    }
    // Site-level rules over the widest audits.
    let mut tops: Vec<&PageFacts> = pages
        .iter()
        .filter(|f| widest.get(f.path.as_str()) == Some(&f.width) && f.error.is_none())
        .collect();
    tops.sort_by(|a, b| a.path.cmp(&b.path));
    tops.dedup_by(|a, b| a.path == b.path);
    if let Some(r) = cx.rule("seo-duplicate-title") {
        let mut by: BTreeMap<String, Vec<&PageFacts>> = BTreeMap::new();
        for f in tops
            .iter()
            .filter(|f| !declared_duplicate(site, f) && !noindex(f))
        {
            let t = norm(&f.head.title);
            if !t.is_empty() {
                by.entry(t).or_default().push(f);
            }
        }
        for (title, group) in by {
            if group.len() < 2 {
                continue;
            }
            for f in &group {
                let other = group
                    .iter()
                    .find(|g| g.path != f.path)
                    .map_or("", |g| g.path.as_str());
                cx.add(
                    &r,
                    f,
                    false,
                    format!(
                        "\"{title}\" is also the title of {} other page(s), e.g. {other}",
                        group.len() - 1
                    ),
                );
            }
        }
    }
    if let Some(r) = cx.rule("seo-hreflang") {
        if site.languages.len() > 1 {
            let by_path: BTreeMap<String, &PageFacts> = tops
                .iter()
                .map(|f| (f.path.trim_end_matches('/').to_string(), *f))
                .collect();
            for f in tops.iter().filter(|f| !declared_duplicate(site, f)) {
                for a in &f.head.alternates {
                    let Some(p) = site.own_path(&f.path, &a.href) else {
                        continue;
                    };
                    if same_path(&p, &f.path) {
                        continue;
                    }
                    let Some(other) = by_path.get(p.trim_end_matches('/')) else {
                        continue;
                    };
                    let back = other.head.alternates.iter().any(|b| {
                        site.own_path(&other.path, &b.href)
                            .is_some_and(|q| same_path(&q, &f.path))
                    });
                    if !back {
                        cx.add(
                            &r,
                            f,
                            false,
                            format!(
                                "its {} version {} does not list it back",
                                a.lang, other.path
                            ),
                        );
                    }
                }
            }
        }
    }
    if let Some(r) = cx.rule("seo-sitemap") {
        if !site.sitemap_found {
            if let Some(f) = tops.iter().find(|f| f.path == "/").or_else(|| tops.first()) {
                cx.add(&r, f, false, "the release has no sitemap");
            }
        } else {
            for f in tops.iter().filter(|f| !declared_duplicate(site, f)) {
                let noindex = f
                    .head
                    .robots
                    .as_deref()
                    .is_some_and(|r| r.to_ascii_lowercase().contains("noindex"));
                let listed = site.sitemap.iter().any(|s| same_path(s, &f.path));
                if !noindex && !listed {
                    cx.add(&r, f, false, "an indexable page the sitemap does not list");
                }
            }
        }
    }
    let mut out = cx.out;
    out.sort();
    out.dedup();
    out
}

fn page_rule(cx: &mut Ctx<'_>, r: &Rule, f: &PageFacts) {
    let site = cx.site;
    match r.id.as_str() {
        "empty-frame" => {
            let min_area = r.param("min_area_px");
            let max_text = r.param("max_text_chars");
            for fr in &f.frames {
                let area = i64::from(fr.w) * i64::from(fr.h);
                if area >= min_area
                    && fr.images == 0
                    && fr.media == 0
                    && !fr.background
                    && i64::from(fr.text) <= max_text
                {
                    cx.add(
                        r,
                        f,
                        fr.authored,
                        format!("{} {}×{} with no picture in it", fr.label, fr.w, fr.h),
                    );
                }
            }
        }
        "broken-image" => {
            for i in &f.images {
                if !i.loaded {
                    cx.add(
                        r,
                        f,
                        i.authored,
                        format!("a picture that does not load: {}", i.src),
                    );
                }
            }
            for q in &f.requests {
                if q.kind == "image-head" && (q.status >= 400 || q.failure.is_some()) {
                    let why = q
                        .failure
                        .clone()
                        .unwrap_or_else(|| format!("answered {}", q.status));
                    cx.add(
                        r,
                        f,
                        false,
                        format!("a picture that does not load ({why}): {}", q.url),
                    );
                }
            }
        }
        "alt-missing" => {
            for i in &f.images {
                if i.decorative {
                    continue;
                }
                if i.alt.as_deref().is_none_or(|a| a.trim().is_empty()) {
                    cx.add(r, f, i.authored, format!("no alt text: {}", i.src));
                }
            }
        }
        "alt-title" => {
            let full = norm(&f.head.title);
            let own = page_title(&f.head.title);
            let site_title = norm(&site.site_title);
            for i in &f.images {
                let Some(alt) = i.alt.as_deref().map(norm).filter(|a| !a.is_empty()) else {
                    continue;
                };
                let what = if alt == full {
                    Some("the page's SEO title")
                } else if alt == own {
                    Some("the page's title")
                } else if !site_title.is_empty() && alt == site_title {
                    Some("the site's title")
                } else {
                    None
                };
                if let Some(what) = what {
                    cx.add(
                        r,
                        f,
                        i.authored,
                        format!("{what} as alt text (\"{alt}\"): {}", i.src),
                    );
                }
            }
        }
        "link-hash" => {
            for l in &f.links {
                let h = l.href.trim();
                if h.is_empty() || h == "#" || h.to_ascii_lowercase().starts_with("javascript:") {
                    cx.add(r, f, l.authored, format!("a link to \"{h}\": {}", l.label));
                }
            }
        }
        "link-anchor" => {
            for l in &f.links {
                if l.href.trim().len() > 1
                    && l.href.trim().starts_with('#')
                    && l.target_found == Some(false)
                {
                    cx.add(
                        r,
                        f,
                        l.authored,
                        format!(
                            "the anchor {} is not on the page: {}",
                            l.href.trim(),
                            l.label
                        ),
                    );
                }
            }
        }
        "link-broken" => {
            let mut seen = BTreeSet::new();
            for l in &f.links {
                let h = l.href.trim();
                if h.is_empty() || h.starts_with('#') {
                    continue;
                }
                let Some(p) = site.own_path(&f.path, h) else {
                    continue;
                };
                if !site.serves(&p) && seen.insert(p.clone()) {
                    cx.add(
                        r,
                        f,
                        l.authored,
                        format!("not in the release: {p} ({})", l.label),
                    );
                }
            }
        }
        "request-production" => {
            let mut seen = BTreeSet::new();
            for q in &f.requests {
                if site.production_hosts.contains(&host_of(&q.url)) && seen.insert(&q.url) {
                    cx.add(
                        r,
                        f,
                        false,
                        format!("a request to the production host: {}", q.url),
                    );
                }
            }
        }
        "request-failed" => {
            let mut seen = BTreeSet::new();
            for q in &f.requests {
                if q.kind == "image-head" || site.production_hosts.contains(&host_of(&q.url)) {
                    continue;
                }
                let aborted = q.failure.as_deref() == Some("net::ERR_ABORTED") && q.status == 0;
                if (q.status >= 400 || q.failure.is_some()) && !aborted && seen.insert(&q.url) {
                    let why = q
                        .failure
                        .clone()
                        .unwrap_or_else(|| format!("answered {}", q.status));
                    cx.add(r, f, false, format!("{why}: {}", q.url));
                }
            }
        }
        "export-hygiene" => {
            let mut what = BTreeSet::new();
            for a in &f.assets {
                let src = a.src.as_deref().unwrap_or("").to_ascii_lowercase();
                let id = a.id.as_deref().unwrap_or("").to_ascii_lowercase();
                let snip = a.snippet.as_deref().unwrap_or("").to_ascii_lowercase();
                if src.contains("wp-emoji") {
                    what.insert(format!("the emoji {} {src}", a.kind));
                } else if id.contains("wp-emoji") {
                    what.insert(format!("the emoji {} #{id}", a.kind));
                } else if snip.contains("wpemoji") || snip.contains("wp-emoji") {
                    what.insert(format!("the emoji settings ({} inline)", a.kind));
                }
            }
            if !what.is_empty() {
                let w: Vec<String> = what.into_iter().collect();
                cx.add(
                    r,
                    f,
                    false,
                    format!("WordPress's runtime in the export: {}", w.join("; ")),
                );
            }
        }
        "overflow" => {
            let tol = r.param("tolerance_px");
            if i64::from(f.scroll_width) > i64::from(f.width) + tol {
                cx.add(
                    r,
                    f,
                    false,
                    format!(
                        "{} px wide at {}: {}",
                        f.scroll_width,
                        f.width,
                        f.wide.join(", ")
                    ),
                );
            }
        }
        "narrow-column" => {
            let min_container = r.param("min_container_px");
            let min_height = r.param("min_height_px");
            let share = r.param("min_share_permille");
            for b in &f.blocks {
                if b.measure
                    || b.beside
                    || i64::from(b.container) < min_container
                    || i64::from(b.h) < min_height
                {
                    continue;
                }
                if i64::from(b.w) * 1000 < share * i64::from(b.container) {
                    cx.add(
                        r,
                        f,
                        false,
                        format!(
                            "{} {} of {} px, nothing beside it",
                            b.label, b.w, b.container
                        ),
                    );
                }
            }
        }
        "h1-count" => {
            let n = f.headings.iter().filter(|h| h.level == 1).count();
            if n != 1 {
                let which: Vec<String> = f
                    .headings
                    .iter()
                    .filter(|h| h.level == 1)
                    .take(3)
                    .map(|h| format!("\"{}\"", norm(&h.text)))
                    .collect();
                cx.add(r, f, false, format!("{n} h1 {}", which.join(", ")));
            }
        }
        "h1-own" => {
            let Some(h1) = f.headings.iter().find(|h| h.level == 1) else {
                return;
            };
            if let Some(hero) = f.hero.as_ref().filter(|h| !h.title.trim().is_empty()) {
                if !hero.contains_h1 {
                    cx.add(
                        r,
                        f,
                        h1.authored,
                        format!(
                            "the h1 \"{}\" is not the hero's \"{}\"",
                            norm(&h1.text),
                            norm(&hero.title)
                        ),
                    );
                }
                return;
            }
            let own = page_title(&f.head.title);
            if own.is_empty()
                || (!site.site_title.is_empty() && fold(&own) == fold(&site.site_title))
            {
                return;
            }
            let n = usize::try_from(r.param("prefix_chars")).unwrap_or(12);
            let (a, b) = (fold(&h1.text), fold(&own));
            let pa: String = a.chars().take(n).collect();
            let pb: String = b.chars().take(n).collect();
            if !a.contains(&pb) && !b.contains(&pa) {
                cx.add(
                    r,
                    f,
                    h1.authored,
                    format!("the h1 \"{}\" is not the page's \"{own}\"", norm(&h1.text)),
                );
            }
        }
        "heading-order" => {
            let mut last = 0u8;
            for h in f.headings.iter().filter(|h| !h.chrome) {
                if last > 0 && h.level > last + 1 {
                    cx.add(
                        r,
                        f,
                        h.authored,
                        format!("h{last} then h{}: \"{}\"", h.level, norm(&h.text)),
                    );
                }
                last = h.level;
            }
        }
        "hero-first" => {
            if let Some(hero) = &f.hero {
                if let Some(first) = hero.after.first() {
                    cx.add(
                        r,
                        f,
                        false,
                        format!(
                            "the authored hero \"{}\" comes after {first}",
                            norm(&hero.title)
                        ),
                    );
                }
            }
        }
        "raw-slug" => {
            let mut seen = BTreeSet::new();
            for c in &f.chips {
                let t = c.text.trim();
                if is_slug(t) && seen.insert(t) {
                    cx.add(r, f, false, format!("\"{t}\" on {}", c.label));
                }
            }
        }
        "english-label" => {
            if f.lang.is_empty() || f.lang == "en" {
                return;
            }
            let english: BTreeSet<String> = site
                .labels
                .iter()
                .filter(|(k, _)| !k.starts_with("css-"))
                .filter_map(|(_, by)| {
                    let en = norm(by.get("en")?);
                    let there = norm(by.get(&f.lang)?);
                    (!en.is_empty() && there != en).then_some(en)
                })
                .collect();
            let mut seen = BTreeSet::new();
            for t in &f.texts {
                let t = norm(t);
                if english.contains(&t) && seen.insert(t.clone()) {
                    cx.add(r, f, false, format!("\"{t}\""));
                }
            }
        }
        "seo-title" => {
            let n = i64::try_from(norm(&f.head.title).chars().count()).unwrap_or(i64::MAX);
            if n == 0 {
                cx.add(r, f, false, "no title");
            } else if n < r.param("min_chars") || n > r.param("max_chars") {
                cx.add(
                    r,
                    f,
                    false,
                    format!(
                        "a title of {n} characters (sane: {} to {}): \"{}\"",
                        r.param("min_chars"),
                        r.param("max_chars"),
                        norm(&f.head.title)
                    ),
                );
            }
        }
        "seo-description" if noindex(f) => {}
        "seo-description" => match f.head.description.as_deref().map(norm) {
            None => cx.add(r, f, false, "no meta description"),
            Some(d) if d.is_empty() => cx.add(r, f, false, "an empty meta description"),
            Some(d) => {
                let n = i64::try_from(d.chars().count()).unwrap_or(i64::MAX);
                if n < r.param("min_chars") || n > r.param("max_chars") {
                    cx.add(
                        r,
                        f,
                        false,
                        format!(
                            "a meta description of {n} characters (sane: {} to {})",
                            r.param("min_chars"),
                            r.param("max_chars")
                        ),
                    );
                }
            }
        },
        "seo-canonical" => match f.head.canonical.as_deref() {
            None => cx.add(r, f, false, "no canonical link"),
            Some(c) => match site.own_path(&f.path, c) {
                None => cx.add(r, f, false, format!("the canonical is another site's: {c}")),
                Some(p) if !same_path(&p, &f.path) && (p == "/" || !site.serves(&p)) => {
                    let what = if p == "/" {
                        "the home page (a page is never a second URL of the home)"
                    } else {
                        "a page the release does not have"
                    };
                    cx.add(r, f, false, format!("the canonical names {what}: {c}"));
                }
                Some(_) => {
                    let origin = host_of(&site.public_origin);
                    let absolute = c.starts_with("http://") || c.starts_with("https://");
                    if absolute && !origin.is_empty() && host_of(c) != origin {
                        cx.add(
                            r,
                            f,
                            false,
                            format!("the canonical is not on the public origin: {c}"),
                        );
                    }
                }
            },
        },
        "seo-hreflang" => {
            if site.languages.len() < 2 || declared_duplicate(site, f) {
                return;
            }
            if f.head.alternates.is_empty() {
                cx.add(r, f, false, "no hreflang alternates");
                return;
            }
            let has_self = f.head.alternates.iter().any(|a| {
                site.own_path(&f.path, &a.href)
                    .is_some_and(|p| same_path(&p, &f.path))
            });
            if !has_self {
                cx.add(
                    r,
                    f,
                    false,
                    "its hreflang alternates leave out the page itself",
                );
            }
            for a in &f.head.alternates {
                match site.own_path(&f.path, &a.href) {
                    Some(p) if !site.serves(&p) => cx.add(
                        r,
                        f,
                        false,
                        format!("its {} version {p} is not in the release", a.lang),
                    ),
                    None => cx.add(
                        r,
                        f,
                        false,
                        format!("its {} version is on another site: {}", a.lang, a.href),
                    ),
                    _ => {}
                }
            }
        }
        // Site-level rules are evaluated over all pages (`evaluate`).
        _ => {}
    }
}
