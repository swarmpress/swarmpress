//! A site's theme as data (ADR-0093): what a design becomes in WordPress, written over REST onto the
//! neutral base theme `canvas` instead of shipping as theme files.
//!
//! MIRROR: a local copy of the types `site_design::wordpress` defines (`crates/site-design`, being
//! written alongside; the same names and the same JSON). Once that crate is on main, this module
//! becomes `pub use site_design::wordpress::{…};` and the copy goes. Everything else in this crate
//! names the types through this module only.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// `ThemeData::format`.
pub const THEME_DATA_FORMAT: &str = "swarmpress.theme-data.v1";

/// A site's theme as data: global styles, templates, template parts, patterns, navigation menus per
/// language and fonts.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ThemeData {
    /// [`THEME_DATA_FORMAT`].
    pub format: String,
    /// The design bundle it renders (its hash).
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
}

/// The user's global styles: a `theme.json` v3 document's `settings` and `styles`, and the custom
/// CSS (`styles.css`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GlobalStyles {
    /// `theme.json`'s version (3).
    pub version: u32,
    pub settings: Value,
    pub styles: Value,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub css: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ThemeTemplate {
    /// WordPress's template name (`index`, `front-page`, `single`, `page-village`).
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

/// One menu in one language: the post `{name}-{lang}` the sandbox's navigation block shows (`nav`
/// without a class, others with the class `sp-menu-{name}`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NavigationMenu {
    /// `nav`, `footer`, `brand`.
    pub name: String,
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
    /// The bundle path (`assets/1a2b….woff2`; for the migration CLI, relative to the theme data's
    /// file).
    pub path: String,
    /// Lower-case hex SHA-256 of the bytes.
    pub sha256: String,
    pub content_type: String,
}
