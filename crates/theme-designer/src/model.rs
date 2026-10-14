//! What the web designer works from and what its checks say.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use site_design::model::{QuerySource, TemplateKind};
use site_design::wordpress::PartArea;

/// The site a design is rendered for: what the theme may link and show (the closed world,
/// rule 5). The host builds it from the site's knowledge (its pages and collections).
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SiteContext {
    /// The site's name as it titles its pages (`Cinque Terre Dispatch`): no page's
    /// headline carries it (the design's rule `headline-without-site-name`).
    pub name: String,
    /// Languages the site is published in, the default first; `["en"]` when empty.
    #[serde(default)]
    pub languages: Vec<String>,
    /// Pages a menu, a button or a link may point to, by language.
    #[serde(default)]
    pub links: Vec<SiteLink>,
    /// The entries a query section may show.
    #[serde(default)]
    pub collections: Vec<Collection>,
    /// The site's places (`vernazza`): a listed entry of a place carries the class
    /// `sp_place-{slug}`, which the theme's styles give the place's pigment when the design has one.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub places: Vec<Place>,
    /// Pictures of the site a template may show where the design has a fixed picture (the image
    /// band), by what they show.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub images: Vec<SiteImage>,
}

/// A place of the site (a term of `sp_place`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Place {
    pub slug: String,
    pub label: String,
}

/// A picture of the site.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SiteImage {
    pub url: String,
    pub alt: String,
    /// What it shows, in words a section is matched on (`Vernazza harbour`).
    pub label: String,
}

impl SiteContext {
    /// The site's languages, `en` when it names none.
    pub fn langs(&self) -> Vec<String> {
        if self.languages.is_empty() {
            vec!["en".into()]
        } else {
            self.languages.clone()
        }
    }

    /// Every URL the site offers (any language), for the link checks.
    pub fn urls(&self) -> BTreeSet<String> {
        let mut out: BTreeSet<String> = self.links.iter().map(|l| l.url.clone()).collect();
        out.insert("/".into());
        for l in self.langs() {
            out.insert(format!("/{l}/"));
        }
        out
    }
}

/// A page of the site under a label, in one language.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SiteLink {
    pub lang: String,
    /// What a menu calls it (`Things to Do`).
    pub label: String,
    /// Root-relative (`/en/things-to-do/`).
    pub url: String,
    /// The same page in every language (the English label's key, `things-to-do`): a menu or link
    /// the design names in English finds the page and its label in each language.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
}

/// Entries the site can list: a `core/query` the host knows works on its WordPress.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Collection {
    /// `latest-stories`.
    pub name: String,
    /// `Latest stories`.
    pub label: String,
    /// The design's query source it answers (`latest`, `featured`, `collection`).
    pub source: QuerySource,
    /// Words a design section's role or heading is matched on (`stories`, `dispatch`).
    #[serde(default)]
    pub keywords: Vec<String>,
    /// The `query` attribute of the `core/query` block (`postType`, `orderBy`, …) without
    /// `perPage`, which is the section's.
    pub query: Value,
    /// The entries' fields a template shows with a block binding (`core/post-meta`), beyond
    /// their title, excerpt, terms and date.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub fields: Vec<String>,
    /// The design's listing it fills (`activity`: the template `archive-activity` lists it).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub listing: Option<String>,
}

/// A template or a part.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TaskKind {
    Template,
    Part,
}

/// One section of a template as the model must render it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SectionSpec {
    /// The design's section id (`query-latest`).
    pub id: String,
    /// The class the section's outermost block carries (`sp-query-latest`): how the checks
    /// and the visual comparison find it.
    pub class: String,
    /// `block` (a catalogue block, `what` names it), `query`, `entry` (the page's own title
    /// and content), `component` (a design-system component, `what` names it).
    pub kind: String,
    /// The catalogue block or component (`hero-section`, `listing-bar`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub what: Option<String>,
    /// The component's name and notes, as the design specifies it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    /// The design's heading and eyebrow (copy the template shows as it is).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub heading: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub eyebrow: Option<String>,
    /// The band's background, a palette slug.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub background: Option<String>,
    /// How many entries it shows.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub items: Option<u32>,
    /// A query section's collection (`latest-stories`), or `inherit` for the template's own list.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub collection: Option<String>,
    /// The `core/query` block's `query` attribute exactly (with `perPage`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub query: Option<Value>,
    /// The fields its entries have for block bindings (`rating`, `price`).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub fields: Vec<String>,
    /// How the design lays it out, in the theme's vocabulary ([`crate::components`]): `hero`,
    /// `image-band`, `tiles`, `feature`, `cards`, `rows`, `band`, `bar`, `entries`, `prose`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shape: Option<String>,
    /// The section's markup in the design (expanded, sanitised, shortened): its layout and copy.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub html: Option<String>,
    /// The section's links and buttons to the site's pages, each a one-item menu per language
    /// (`core/navigation` with its class): a template serves every language.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub links: Vec<MenuSpec>,
    /// The site's picture for a section whose design shows a fixed one (the image band).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image: Option<SiteImage>,
}

/// A menu a part shows: a `core/navigation` block with the class `sp-menu-{name}` (the
/// sandbox fills it with the post `{name}-{lang}` of the page's language, ADR-0092).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MenuSpec {
    pub name: String,
    pub label: String,
    pub class: String,
}

/// What the model writes in one call: a template or a part, from its spec.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TemplateTask {
    pub kind: TaskKind,
    /// WordPress's name (`front-page`, `archive-activity`, `header`).
    pub slug: String,
    pub title: String,
    /// A part's area.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub area: Option<PartArea>,
    /// The design template it renders (`home`); none when the design has no page for it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub design: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub template_kind: Option<TemplateKind>,
    /// What the page is for, when the design has no page for it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub purpose: Option<String>,
    /// In order.
    #[serde(default)]
    pub sections: Vec<SectionSpec>,
    /// The parts it includes (`header`, `footer`), as `core/template-part` blocks.
    #[serde(default)]
    pub parts: Vec<String>,
    /// A part's menus.
    #[serde(default)]
    pub menus: Vec<MenuSpec>,
    /// A part's markup in the design (sanitised, shortened).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub html: Option<String>,
}

impl TemplateTask {
    /// `template front-page` / `part header`.
    pub fn label(&self) -> String {
        let k = match self.kind {
            TaskKind::Template => "template",
            TaskKind::Part => "part",
        };
        format!("{k} {}", self.slug)
    }
}

/// The presets a theme defines: what block markup may reference.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Presets {
    /// Palette slug → hex.
    pub colors: BTreeMap<String, String>,
    pub font_sizes: BTreeSet<String>,
    pub font_families: BTreeSet<String>,
    pub spacing: BTreeSet<String>,
    pub shadows: BTreeSet<String>,
    /// The palette slugs of the roles (`text` → `ink`, `background` → `paper`, `link`,
    /// `accent`, `surface`, `muted`, `border`).
    pub roles: BTreeMap<String, String>,
    /// Font size slugs that set large text (display and heading sizes, ≥ 24px).
    pub large_sizes: BTreeSet<String>,
}

impl Presets {
    pub fn role(&self, role: &str) -> Option<&str> {
        self.roles.get(role).map(String::as_str)
    }

    /// Whether `kind` (`color`, `font-size`, `font-family`, `spacing`, `shadow`) has `slug`.
    pub fn has(&self, kind: &str, slug: &str) -> bool {
        match kind {
            "color" => self.colors.contains_key(slug),
            "font-size" => self.font_sizes.contains(slug),
            "font-family" => self.font_families.contains(slug),
            "spacing" => self.spacing.contains(slug),
            "shadow" => self.shadows.contains(slug),
            _ => false,
        }
    }

    /// Whether `kind` has a preset written `css_slug` in WordPress's class names and custom
    /// properties (`h-1` for the slug `h1`: [`crate::styles::wp_kebab`]).
    pub fn has_css(&self, kind: &str, css_slug: &str) -> bool {
        self.list(kind)
            .iter()
            .any(|s| crate::styles::wp_kebab(s) == css_slug)
    }

    /// The slugs of `kind`, for messages.
    pub fn list(&self, kind: &str) -> Vec<String> {
        match kind {
            "color" => self.colors.keys().cloned().collect(),
            "font-size" => self.font_sizes.iter().cloned().collect(),
            "font-family" => self.font_families.iter().cloned().collect(),
            "spacing" => self.spacing.iter().cloned().collect(),
            "shadow" => self.shadows.iter().cloned().collect(),
            _ => Vec::new(),
        }
    }
}

/// What a check found.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum IssueCode {
    /// The block comments do not parse or nest.
    Grammar,
    /// A block outside the allowed core blocks.
    Block,
    /// A section, part, menu or required template is missing.
    Missing,
    /// A preset reference that does not resolve, or a raw colour.
    Token,
    /// A text/background pair below WCAG AA.
    Contrast,
    /// A font outside the licensed families, or a font file the bundle lacks.
    Font,
    /// A script, an iframe, an event handler, a `javascript:` URL.
    Unsafe,
    /// A link to `#`, or to a page the site does not have.
    Link,
    /// A query that is none of the site's collections.
    Query,
    /// One of the design's own rules (fix-02 …).
    Rule,
    /// The theme data's structure (`ThemeData::validate_shape`).
    Shape,
    /// The design and the site disagree; not an error (a menu item without a page, a
    /// rule no core block can show).
    Note,
}

impl IssueCode {
    pub const fn slug(self) -> &'static str {
        match self {
            IssueCode::Grammar => "grammar",
            IssueCode::Block => "block",
            IssueCode::Missing => "missing",
            IssueCode::Token => "token",
            IssueCode::Contrast => "contrast",
            IssueCode::Font => "font",
            IssueCode::Unsafe => "unsafe",
            IssueCode::Link => "link",
            IssueCode::Query => "query",
            IssueCode::Rule => "rule",
            IssueCode::Shape => "shape",
            IssueCode::Note => "note",
        }
    }
}

/// One finding, precise enough for a repair turn.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Issue {
    pub code: IssueCode,
    /// `template front-page`, `part header`, `global styles`, `fonts`.
    pub at: String,
    pub message: String,
    /// The design rule it enforces (`fix-02`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rule: Option<String>,
}

impl Issue {
    pub fn new(code: IssueCode, at: impl Into<String>, message: impl Into<String>) -> Issue {
        Issue {
            code,
            at: at.into(),
            message: message.into(),
            rule: None,
        }
    }

    pub fn with_rule(mut self, rule: Option<&str>) -> Issue {
        self.rule = rule.map(String::from);
        self
    }

    /// An error stops the theme; a note is reported only.
    pub fn is_error(&self) -> bool {
        self.code != IssueCode::Note
    }

    /// `- [token] template front-page: …` (with the rule id when there is one).
    pub fn line(&self) -> String {
        match &self.rule {
            Some(r) => format!(
                "- [{}, {r}] {}: {}",
                self.code.slug(),
                self.at,
                self.message
            ),
            None => format!("- [{}] {}: {}", self.code.slug(), self.at, self.message),
        }
    }
}
