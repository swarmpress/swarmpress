//! The WordPress rendering of a [`SiteDesign`](crate::SiteDesign): its theme
//! **as site data** (ADR-0093), on the sandbox's neutral base theme.
//!
//! WordPress is one renderer of the design (ADR-0078…0084 today); another
//! engine's output would sit beside this module. Nothing here is theme
//! files: every part of [`ThemeData`] is written over WordPress's REST API
//! on a branch of the governed repository (ADR-0080), as the posts
//! WordPress keeps such data in:
//!
//! | `ThemeData` field | WordPress post type | REST route |
//! |---|---|---|
//! | `global_styles` | `wp_global_styles` (the user's `theme.json`) | `/wp/v2/global-styles/{id}` |
//! | `templates` | `wp_template` | `/wp/v2/templates` |
//! | `template_parts` | `wp_template_part` | `/wp/v2/template-parts` |
//! | `patterns` | `wp_block` (synced: false) | `/wp/v2/blocks` |
//! | `navigation` | `wp_navigation`, one per menu and language (`{name}-{lang}`) | `/wp/v2/navigation` |
//! | `fonts` | `wp_font_family` / `wp_font_face`, files as uploads | `/wp/v2/font-families` |
//! | `block_styles` | none: classes the importer gives the content they apply to | — |
//! | `files` | none: files the static export publishes beside the pages | — |
//! | `labels` | none: the design's own words in every site language, put in at import and export | — |
//!
//! **Block styles** name a component of the design and the content classes it renders
//! (`accordion` for `ct-faq-section`): the importer adds `is-style-{name}` to those blocks and the
//! global styles' CSS gives the class the component's form. **Files** are what the static site
//! serves beside its pages: the design's icon sprite (`icons.svg`) and the one audited script
//! ([`ENHANCEMENT_SCRIPT`], `ds.js`, ADR-0093's addendum of 2026-10-14). No other script is
//! allowed: [`ThemeData::validate_shape`] refuses a `.js` file that is not byte for byte that one.
//!
//! Template and part content is block markup with **core blocks only**
//! (`<!-- wp:group {…} -->…`). The web designer (FEAT for the job) writes
//! it; the importer (`crates/content-import-wp`) writes it into a branch.
//! [`ThemeData::validate_shape`] checks the structure every consumer relies
//! on; the design checks (block grammar, allowed blocks, contrast, fonts'
//! licences, the visual comparison) are the web designer's.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::model::TemplateKind;

/// [`ThemeData::format`].
pub const THEME_DATA_FORMAT: &str = "swarmpress.theme-data.v1";
/// The `theme.json` schema version global styles use.
pub const THEME_JSON_VERSION: u32 = 3;
/// Templates every theme's data has: WordPress's fallbacks.
pub const REQUIRED_TEMPLATES: [&str; 4] = ["index", "single", "page", "404"];
/// Parts every theme's data has.
pub const REQUIRED_PARTS: [&str; 2] = ["header", "footer"];

/// A site's theme as data (module docs).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ThemeData {
    /// [`THEME_DATA_FORMAT`].
    pub format: String,
    /// The design bundle it renders ([`crate::DesignBundle::hash`]).
    pub design: String,
    pub global_styles: GlobalStyles,
    pub templates: Vec<ThemeTemplate>,
    pub template_parts: Vec<ThemePart>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub patterns: Vec<ThemePattern>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub navigation: Vec<NavigationMenu>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub fonts: Vec<ThemeFontFamily>,
    /// Components applied to the content by class (module docs).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub block_styles: Vec<BlockStyle>,
    /// Files the static site publishes beside its pages (module docs).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub files: Vec<ThemeFile>,
    /// The design's own words (`Editors' picks`, `On this page`, `Sea`) by key, then language
    /// (`en` the design's word): filled by the web designer for every site language. Keys
    /// starting `css-` are the stylesheet's (`content:var(--ds-l-{key})`); the import and the
    /// export put the others in a page's language where they stand alone (`site_export::labels`).
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub labels: BTreeMap<String, BTreeMap<String, String>>,
}

/// The one script a site's theme may publish: swarm.press's own, audited, the same for every site
/// (progressive enhancement of the design's behaviours; a site works without it).
pub const ENHANCEMENT_SCRIPT: &str = include_str!("enhance.js");
/// Where the static site serves [`ENHANCEMENT_SCRIPT`].
pub const ENHANCEMENT_PATH: &str = "ds.js";

/// A component of the design applied to content by class: the importer gives every block with one
/// of `classes` the class `is-style-{name}`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BlockStyle {
    /// `accordion`: the class `is-style-accordion`.
    pub name: String,
    pub label: String,
    /// The design's component (`accordion`).
    pub component: String,
    /// The content's classes it applies to (`ct-faq-section`).
    pub classes: Vec<String>,
}

/// A text file the static site serves at `/{path}`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ThemeFile {
    /// `icons.svg`, `ds.js`.
    pub path: String,
    pub content_type: String,
    pub content: String,
}

/// The user's global styles: a `theme.json` v3 document's `settings` and
/// `styles`, and the custom CSS (`styles.css`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GlobalStyles {
    /// [`THEME_JSON_VERSION`].
    pub version: u32,
    /// `settings` (palette, typography with font sizes and families,
    /// spacing sizes, layout, shadows, custom).
    pub settings: Value,
    /// `styles` (color, typography, spacing, elements, blocks).
    pub styles: Value,
    /// Custom CSS: what `theme.json` cannot say (motion, the design's
    /// component classes). Empty when there is none.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub css: String,
}

impl GlobalStyles {
    /// The `wp_global_styles` post's content (`isGlobalStylesUserThemeJSON`).
    pub fn post_content(&self) -> Value {
        let mut styles = self.styles.clone();
        if !self.css.is_empty() {
            if let Value::Object(m) = &mut styles {
                m.insert("css".into(), Value::String(self.css.clone()));
            }
        }
        serde_json::json!({
            "version": self.version,
            "isGlobalStylesUserThemeJSON": true,
            "settings": self.settings,
            "styles": styles,
        })
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ThemeTemplate {
    /// WordPress's template name (`index`, `front-page`, `single`,
    /// `page-village`); see [`template_slug`].
    pub slug: String,
    pub title: String,
    /// Block markup.
    pub content: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PartArea {
    Header,
    Footer,
    Uncategorized,
}

impl PartArea {
    /// WordPress's name for the area.
    pub fn as_str(self) -> &'static str {
        match self {
            PartArea::Header => "header",
            PartArea::Footer => "footer",
            PartArea::Uncategorized => "uncategorized",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ThemePart {
    pub slug: String,
    pub area: PartArea,
    /// Block markup.
    pub content: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ThemePattern {
    /// `swarmpress/editorial-hero`: a namespace and a name.
    pub slug: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub categories: Vec<String>,
    /// Block markup.
    pub content: String,
}

/// One menu in one language: the post `{name}-{lang}` the sandbox's
/// navigation block shows with the class `sp-menu-{name}` (ADR-0092).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NavigationMenu {
    /// `nav`, `footer`, `brand`.
    pub name: String,
    /// `en`.
    pub lang: String,
    pub items: Vec<NavigationItem>,
}

impl NavigationMenu {
    /// The `wp_navigation` post's slug.
    pub fn post_name(&self) -> String {
        format!("{}-{}", self.name, self.lang)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NavigationItem {
    pub label: String,
    /// Root-relative (`/en/vernazza/`) or absolute.
    pub url: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub children: Vec<NavigationItem>,
    /// A class of the theme's vocabulary for this item (`ds-featured`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub class: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ThemeFontFamily {
    /// `Bodoni Moda`.
    pub name: String,
    /// `bodoni-moda`: what `settings.typography.fontFamilies` refers to.
    pub slug: String,
    /// The CSS stack (`'Bodoni Moda', Didot, Georgia, serif`).
    pub family: String,
    pub faces: Vec<ThemeFontFace>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ThemeFontFace {
    /// `400`, or `400 900` for a variable font.
    pub weight: String,
    /// `normal` or `italic`.
    pub style: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unicode_range: Option<String>,
    pub file: AssetRef,
}

/// A file of the design bundle, uploaded as a WordPress upload.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AssetRef {
    /// The bundle path (`assets/1a2b….woff2`).
    pub path: String,
    /// Lower-case hex SHA-256: the asset's bytes in object storage (ADR-0050).
    pub sha256: String,
    pub content_type: String,
}

/// A structural problem with theme data.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ShapeIssue {
    /// `templates[2].slug`, `template_parts`, `fonts[0].faces[1].file`.
    pub at: String,
    pub message: String,
}

/// WordPress's template for a design template: the home page is
/// `front-page`, an archive or listing is `archive` (`archive-{slug}` for a
/// listing of its own), a custom page type is `page-{slug}`.
pub fn template_slug(kind: TemplateKind, design_slug: &str) -> String {
    match kind {
        TemplateKind::Home => "front-page".into(),
        TemplateKind::Single => "single".into(),
        TemplateKind::Page => "page".into(),
        TemplateKind::Archive => "archive".into(),
        TemplateKind::Listing => format!("archive-{design_slug}"),
        TemplateKind::Search => "search".into(),
        TemplateKind::NotFound => "404".into(),
        TemplateKind::Custom => format!("page-{design_slug}"),
    }
}

/// `[a-z0-9]` runs joined by single hyphens, at most 64 bytes.
pub fn valid_slug(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 64
        && !s.starts_with('-')
        && !s.ends_with('-')
        && !s.contains("--")
        && s.chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

fn issue(at: impl Into<String>, message: impl Into<String>) -> ShapeIssue {
    ShapeIssue {
        at: at.into(),
        message: message.into(),
    }
}

impl ThemeData {
    /// The structural rules every consumer relies on: the format; global
    /// styles of `theme.json` v3 with object `settings` and `styles`; valid,
    /// unique slugs; the templates `index`, `single`, `page`, `404` and the
    /// parts `header`, `footer` (in their areas); non-empty block markup
    /// without scripts; patterns named `namespace/name`; one menu per name
    /// and language, items with a label and a URL; fonts with unique slugs,
    /// `normal`/`italic` faces and `.woff2` files with a SHA-256.
    pub fn validate_shape(&self) -> Vec<ShapeIssue> {
        let mut out = Vec::new();
        if self.format != THEME_DATA_FORMAT {
            out.push(issue("format", format!("is {THEME_DATA_FORMAT}")));
        }
        let gs = &self.global_styles;
        if gs.version != THEME_JSON_VERSION {
            out.push(issue(
                "global_styles.version",
                format!("is {THEME_JSON_VERSION}"),
            ));
        }
        if !gs.settings.is_object() {
            out.push(issue("global_styles.settings", "is an object"));
        }
        if !gs.styles.is_object() {
            out.push(issue("global_styles.styles", "is an object"));
        }
        if gs.css.to_ascii_lowercase().contains("<script") {
            out.push(issue("global_styles.css", "has no markup"));
        }
        let markup = |at: String, content: &str, out: &mut Vec<ShapeIssue>| {
            if content.trim().is_empty() {
                out.push(issue(at.clone(), "has block markup"));
            }
            let lower = content.to_ascii_lowercase();
            if lower.contains("<script") || lower.contains("javascript:") {
                out.push(issue(at, "has no scripts"));
            }
        };
        let mut seen = BTreeSet::new();
        for (i, t) in self.templates.iter().enumerate() {
            let at = format!("templates[{i}]");
            if !valid_slug(&t.slug) {
                out.push(issue(format!("{at}.slug"), "is a slug ([a-z0-9-])"));
            }
            if !seen.insert(t.slug.as_str()) {
                out.push(issue(format!("{at}.slug"), format!("{} is unique", t.slug)));
            }
            if t.title.trim().is_empty() {
                out.push(issue(format!("{at}.title"), "is not empty"));
            }
            markup(format!("{at}.content"), &t.content, &mut out);
        }
        for r in REQUIRED_TEMPLATES {
            if !seen.contains(r) {
                out.push(issue("templates", format!("has the template {r}")));
            }
        }
        let mut seen = BTreeSet::new();
        for (i, p) in self.template_parts.iter().enumerate() {
            let at = format!("template_parts[{i}]");
            if !valid_slug(&p.slug) {
                out.push(issue(format!("{at}.slug"), "is a slug ([a-z0-9-])"));
            }
            if !seen.insert(p.slug.as_str()) {
                out.push(issue(format!("{at}.slug"), format!("{} is unique", p.slug)));
            }
            let want = match p.slug.as_str() {
                "header" => Some(PartArea::Header),
                "footer" => Some(PartArea::Footer),
                _ => None,
            };
            if want.is_some_and(|w| w != p.area) {
                out.push(issue(
                    format!("{at}.area"),
                    format!("is {} for the {} part", p.slug, p.slug),
                ));
            }
            markup(format!("{at}.content"), &p.content, &mut out);
        }
        for r in REQUIRED_PARTS {
            if !seen.contains(r) {
                out.push(issue("template_parts", format!("has the part {r}")));
            }
        }
        let mut seen = BTreeSet::new();
        for (i, p) in self.patterns.iter().enumerate() {
            let at = format!("patterns[{i}]");
            let ok = p
                .slug
                .split_once('/')
                .is_some_and(|(ns, name)| valid_slug(ns) && valid_slug(name));
            if !ok {
                out.push(issue(format!("{at}.slug"), "is namespace/name"));
            }
            if !seen.insert(p.slug.as_str()) {
                out.push(issue(format!("{at}.slug"), format!("{} is unique", p.slug)));
            }
            if p.title.trim().is_empty() {
                out.push(issue(format!("{at}.title"), "is not empty"));
            }
            markup(format!("{at}.content"), &p.content, &mut out);
        }
        let mut seen = BTreeSet::new();
        for (i, m) in self.navigation.iter().enumerate() {
            let at = format!("navigation[{i}]");
            if !valid_slug(&m.name) {
                out.push(issue(format!("{at}.name"), "is a slug ([a-z0-9-])"));
            }
            let lang_ok =
                (2..=3).contains(&m.lang.len()) && m.lang.chars().all(|c| c.is_ascii_lowercase());
            if !lang_ok {
                out.push(issue(format!("{at}.lang"), "is a language code (en)"));
            }
            if !seen.insert(m.post_name()) {
                out.push(issue(at.clone(), format!("{} is unique", m.post_name())));
            }
            fn items(list: &[NavigationItem], at: &str, out: &mut Vec<ShapeIssue>) {
                for (j, it) in list.iter().enumerate() {
                    let at = format!("{at}.items[{j}]");
                    if it.label.trim().is_empty() {
                        out.push(issue(format!("{at}.label"), "is not empty"));
                    }
                    let u = it.url.trim();
                    if u.is_empty() || u == "#" || u.to_ascii_lowercase().starts_with("javascript:")
                    {
                        out.push(issue(format!("{at}.url"), "is a real target"));
                    }
                    items(&it.children, &at, out);
                }
            }
            items(&m.items, &at, &mut out);
        }
        let mut seen = BTreeSet::new();
        for (i, b) in self.block_styles.iter().enumerate() {
            let at = format!("block_styles[{i}]");
            if !valid_slug(&b.name) {
                out.push(issue(format!("{at}.name"), "is a slug ([a-z0-9-])"));
            }
            if !seen.insert(b.name.as_str()) {
                out.push(issue(format!("{at}.name"), format!("{} is unique", b.name)));
            }
            if b.classes.is_empty() || b.classes.iter().any(|c| !valid_slug(c)) {
                out.push(issue(
                    format!("{at}.classes"),
                    "names content classes ([a-z0-9-])",
                ));
            }
        }
        for (key, by_lang) in &self.labels {
            let at = format!("labels.{key}");
            if !valid_slug(key) || key.len() > 64 {
                out.push(issue(at.clone(), "is a slug ([a-z0-9-]) of at most 64"));
            }
            if !by_lang.contains_key("en") {
                out.push(issue(at.clone(), "has its English (en)"));
            }
            for (lang, text) in by_lang {
                let plain = !text.trim().is_empty()
                    && text.len() <= 160
                    && !text.contains(['<', '>', '\\', '"', '\'', '{', '}', ';']);
                let code =
                    (2..=3).contains(&lang.len()) && lang.chars().all(|c| c.is_ascii_lowercase());
                if !plain || !code {
                    out.push(issue(
                        format!("{at}.{lang}"),
                        "is plain text (no markup, quotes, backslashes or braces) in a language code",
                    ));
                }
            }
        }
        let mut seen = BTreeSet::new();
        for (i, f) in self.files.iter().enumerate() {
            let at = format!("files[{i}]");
            let plain = !f.path.is_empty()
                && f.path.len() <= 64
                && f.path
                    .chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '.')
                && !f.path.starts_with('.')
                && !f.path.contains("..");
            if !plain {
                out.push(issue(
                    format!("{at}.path"),
                    "is a plain file name ([a-z0-9.-])",
                ));
            }
            if !seen.insert(f.path.as_str()) {
                out.push(issue(format!("{at}.path"), format!("{} is unique", f.path)));
            }
            let lower = f.content.to_ascii_lowercase();
            match (
                f.path.rsplit('.').next().unwrap_or(""),
                f.content_type.as_str(),
            ) {
                ("svg", "image/svg+xml") => {
                    if lower.contains("<script")
                        || svg_has_handler(&lower)
                        || lower.contains("javascript:")
                        || lower.contains("<foreignobject")
                    {
                        out.push(issue(
                            at.clone(),
                            "is a drawing without scripts or handlers",
                        ));
                    }
                }
                ("js", "text/javascript") => {
                    if f.content != ENHANCEMENT_SCRIPT || f.path != ENHANCEMENT_PATH {
                        out.push(issue(
                            at.clone(),
                            format!("is the audited enhancement script, unchanged, at {ENHANCEMENT_PATH}"),
                        ));
                    }
                }
                _ => out.push(issue(
                    format!("{at}.content_type"),
                    "is an SVG drawing (image/svg+xml) or the enhancement script (text/javascript)",
                )),
            }
            if f.content.len() > 512 * 1024 {
                out.push(issue(at, "is at most 512 KB"));
            }
        }
        let mut seen = BTreeSet::new();
        for (i, f) in self.fonts.iter().enumerate() {
            let at = format!("fonts[{i}]");
            if !valid_slug(&f.slug) {
                out.push(issue(format!("{at}.slug"), "is a slug ([a-z0-9-])"));
            }
            if !seen.insert(f.slug.as_str()) {
                out.push(issue(format!("{at}.slug"), format!("{} is unique", f.slug)));
            }
            if f.name.trim().is_empty() || f.family.trim().is_empty() {
                out.push(issue(at.clone(), "has a name and a family"));
            }
            for (j, face) in f.faces.iter().enumerate() {
                let at = format!("{at}.faces[{j}]");
                if !matches!(face.style.as_str(), "normal" | "italic") {
                    out.push(issue(format!("{at}.style"), "is normal or italic"));
                }
                let weight_ok = face
                    .weight
                    .split(' ')
                    .all(|w| w.parse::<u32>().is_ok_and(|n| (1..=1000).contains(&n)))
                    && face.weight.split(' ').count() <= 2;
                if !weight_ok {
                    out.push(issue(
                        format!("{at}.weight"),
                        "is 1–1000, or a range \"400 900\"",
                    ));
                }
                if !face.file.path.to_ascii_lowercase().ends_with(".woff2") {
                    out.push(issue(format!("{at}.file.path"), "is a .woff2 file"));
                }
                let sha_ok = face.file.sha256.len() == 64
                    && face
                        .file
                        .sha256
                        .chars()
                        .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase());
                if !sha_ok {
                    out.push(issue(
                        format!("{at}.file.sha256"),
                        "is a lower-case hex SHA-256",
                    ));
                }
            }
        }
        out
    }
}

/// An `on…=` attribute in an SVG's markup.
fn svg_has_handler(lower: &str) -> bool {
    lower.match_indices(" on").any(|(i, _)| {
        let rest = &lower[i + 3..];
        let name: String = rest.chars().take_while(char::is_ascii_alphabetic).collect();
        !name.is_empty() && rest[name.len()..].trim_start().starts_with('=')
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn minimal() -> ThemeData {
        let t = |slug: &str| ThemeTemplate {
            slug: slug.into(),
            title: slug.into(),
            content: "<!-- wp:template-part {\"slug\":\"header\"} /-->".into(),
        };
        ThemeData {
            format: THEME_DATA_FORMAT.into(),
            design: "0".repeat(64),
            global_styles: GlobalStyles {
                version: 3,
                settings: json!({"color": {"palette": []}}),
                styles: json!({}),
                css: String::new(),
            },
            templates: ["index", "single", "page", "404", "front-page"]
                .iter()
                .map(|s| t(s))
                .collect(),
            template_parts: vec![
                ThemePart {
                    slug: "header".into(),
                    area: PartArea::Header,
                    content: "<!-- wp:group /-->".into(),
                },
                ThemePart {
                    slug: "footer".into(),
                    area: PartArea::Footer,
                    content: "<!-- wp:group /-->".into(),
                },
            ],
            patterns: vec![ThemePattern {
                slug: "swarmpress/hero".into(),
                title: "Hero".into(),
                categories: vec!["featured".into()],
                content: "<!-- wp:cover /-->".into(),
            }],
            navigation: vec![NavigationMenu {
                name: "nav".into(),
                lang: "en".into(),
                items: vec![NavigationItem {
                    label: "Vernazza".into(),
                    url: "/en/vernazza/".into(),
                    children: vec![],
                    class: None,
                }],
            }],
            fonts: vec![ThemeFontFamily {
                name: "Bodoni Moda".into(),
                slug: "bodoni-moda".into(),
                family: "'Bodoni Moda', Georgia, serif".into(),
                faces: vec![ThemeFontFace {
                    weight: "400 900".into(),
                    style: "italic".into(),
                    unicode_range: None,
                    file: AssetRef {
                        path: "assets/a.woff2".into(),
                        sha256: "a".repeat(64),
                        content_type: "font/woff2".into(),
                    },
                }],
            }],
            block_styles: vec![BlockStyle {
                name: "accordion".into(),
                label: "Accordion".into(),
                component: "accordion".into(),
                classes: vec!["ct-faq-section".into()],
            }],
            files: vec![
                ThemeFile {
                    path: "icons.svg".into(),
                    content_type: "image/svg+xml".into(),
                    content: "<svg xmlns=\"http://www.w3.org/2000/svg\"><symbol id=\"ct-pin\"><path d=\"M1 1\"/></symbol></svg>".into(),
                },
                ThemeFile {
                    path: ENHANCEMENT_PATH.into(),
                    content_type: "text/javascript".into(),
                    content: ENHANCEMENT_SCRIPT.into(),
                },
            ],
            labels: BTreeMap::from([(
                "css-village".to_string(),
                BTreeMap::from([
                    ("en".to_string(), "Village".to_string()),
                    ("de".to_string(), "Dorf".to_string()),
                ]),
            )]),
        }
    }

    #[test]
    fn labels_are_plain_words_with_their_english() {
        let mut d = minimal();
        d.labels.insert(
            "Bad Key".into(),
            BTreeMap::from([("de".to_string(), "<b>x</b>".to_string())]),
        );
        let got: Vec<String> = d.validate_shape().iter().map(|i| i.at.clone()).collect();
        assert!(got.contains(&"labels.Bad Key".to_string()), "{got:?}");
        assert!(got.contains(&"labels.Bad Key.de".to_string()), "{got:?}");
        d.labels.remove("Bad Key");
        d.labels
            .get_mut("css-village")
            .unwrap()
            .insert("fr".into(), "Village d'en haut".into());
        assert_eq!(d.validate_shape().len(), 1);
    }

    #[test]
    fn a_minimal_theme_is_well_formed_and_round_trips() {
        let d = minimal();
        assert_eq!(d.validate_shape(), vec![]);
        let back: ThemeData = serde_json::from_value(serde_json::to_value(&d).unwrap()).unwrap();
        assert_eq!(back, d);
        assert_eq!(d.navigation[0].post_name(), "nav-en");
        assert_eq!(
            d.global_styles.post_content()["isGlobalStylesUserThemeJSON"],
            true
        );
    }

    #[test]
    fn shape_issues_name_the_place() {
        let mut d = minimal();
        d.templates.retain(|t| t.slug != "404");
        d.templates[0].slug = "Index".into();
        d.template_parts[1].area = PartArea::Header;
        d.template_parts.push(d.template_parts[0].clone());
        d.patterns[0].slug = "hero".into();
        d.navigation.push(d.navigation[0].clone());
        d.navigation[0].items[0].url = "#".into();
        d.fonts[0].faces[0].file.path = "a.ttf".into();
        d.global_styles.version = 2;
        d.templates[1].content = "<script>x</script>".into();
        d.block_styles.push(d.block_styles[0].clone());
        d.files[1].content.push_str("fetch('https://evil')");
        d.files[0].content = "<svg onload=\"x()\"></svg>".into();
        d.files.push(ThemeFile {
            path: "../x.html".into(),
            content_type: "text/html".into(),
            content: String::new(),
        });
        let at: Vec<String> = d
            .validate_shape()
            .into_iter()
            .map(|i| format!("{} {}", i.at, i.message))
            .collect();
        for want in [
            "global_styles.version is 3",
            "templates[0].slug is a slug ([a-z0-9-])",
            "templates has the template 404",
            "templates has the template index",
            "template_parts[1].area is footer for the footer part",
            "template_parts[2].slug header is unique",
            "patterns[0].slug is namespace/name",
            "navigation[1] nav-en is unique",
            "navigation[0].items[0].url is a real target",
            "fonts[0].faces[0].file.path is a .woff2 file",
            "templates[1].content has no scripts",
            "block_styles[1].name accordion is unique",
            "files[1] is the audited enhancement script, unchanged, at ds.js",
            "files[0] is a drawing without scripts or handlers",
            "files[2].path is a plain file name ([a-z0-9.-])",
            "files[2].content_type is an SVG drawing (image/svg+xml) or the enhancement script (text/javascript)",
        ] {
            assert!(at.iter().any(|a| a == want), "missing {want:?} in {at:#?}");
        }
    }

    #[test]
    fn template_names() {
        assert_eq!(template_slug(TemplateKind::Home, "home"), "front-page");
        assert_eq!(
            template_slug(TemplateKind::Listing, "restaurant"),
            "archive-restaurant"
        );
        assert_eq!(
            template_slug(TemplateKind::Custom, "village"),
            "page-village"
        );
    }
}
