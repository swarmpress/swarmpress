//! The semantic site design: what a design *means*, independent of any site
//! engine (ADR-0093). WordPress is one renderer of it ([`crate::wordpress`]);
//! nothing here names a WordPress concept.
//!
//! Every derived item carries the rule that produced it (`rule`), so a
//! canvas, a reviewer or the web designer can see why.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// [`SiteDesign::format`].
pub const SITE_DESIGN_FORMAT: &str = "swarmpress.site-design.v1";

/// A design, interpreted.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(deny_unknown_fields)]
pub struct SiteDesign {
    pub format: String,
    /// The bundle's hash ([`crate::DesignBundle::hash`]).
    pub bundle: String,
    pub title: String,
    /// Languages the design offers (from a language switch), lower-case.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub languages: Vec<String>,
    pub tokens: Tokens,
    /// One per page of the design that shows a page of the site, plus one
    /// per listing a templates sheet specifies.
    pub templates: Vec<Template>,
    /// The parts every template shares (header, footer).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub parts: Vec<Part>,
    /// Sections or components used in more than one place.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub patterns: Vec<Pattern>,
    /// Components a design system specifies (`4.4 Cards`, `7.1 Listing bar`).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub components: Vec<Component>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub navigation: Vec<Menu>,
    /// Principles, fixes and typesetting rules, some of them checkable.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub rules: Vec<DesignRule>,
    /// The design's icon set and place marks (an iconography sheet's data).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub icons: Vec<Icon>,
    /// The micro-interactions a motion sheet specifies.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub interactions: Vec<Interaction>,
    /// Every page read and what it was taken as.
    pub pages: Vec<DesignPage>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub skipped: Vec<Skipped>,
}

// --- tokens ------------------------------------------------------------------

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(deny_unknown_fields)]
pub struct Tokens {
    /// The main colour scheme.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub colours: Vec<ColourToken>,
    /// Other schemes (a dark theme).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub schemes: Vec<ColourScheme>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub fonts: Vec<FontFamily>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub type_scale: Vec<TypeToken>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub spacing: Vec<SizeToken>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub radii: Vec<SizeToken>,
    /// Shadows; `value` is a `box-shadow`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub elevations: Vec<SizeToken>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub motion: Vec<MotionToken>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub breakpoints: Vec<Breakpoint>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub grid: Option<Grid>,
    /// Image ratios; `value` is a CSS `aspect-ratio` (`16 / 9`).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub ratios: Vec<SizeToken>,
    /// Custom properties no rule classified.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub other: BTreeMap<String, String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ColourRole {
    Background,
    Surface,
    Text,
    TextMuted,
    Accent,
    Link,
    Highlight,
    Border,
    /// A fill that marks a place or a category (the villages' pigments).
    Pigment,
    Other,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ColourToken {
    /// `--ct-ink`, or a kebab name when the design gave none.
    pub name: String,
    /// As the design wrote it (`#0F1E2E`).
    pub value: String,
    pub role: ColourRole,
    /// The list it came from (`core`, `accents`, `villages`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group: Option<String>,
    /// Its display name (`Ink · Mare Notte`, `Riomaggiore`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub usage: Option<String>,
    /// A lighter companion for backgrounds.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tint: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub contrast: Option<Contrast>,
}

/// WCAG 2 contrast of a colour with its counterpart.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Contrast {
    /// The token it is measured against: the background for text and
    /// accents, the main text colour for fills.
    pub against: String,
    /// The ratio × 100 (`1470` is 14.7:1), computed.
    pub ratio_x100: u32,
    /// What the design states (`4.7:1`), when it does.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stated: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ColourScheme {
    /// `notte`.
    pub name: String,
    /// `Notte — dark theme (evening reading, …)`.
    pub label: String,
    pub dark: bool,
    pub colours: Vec<ColourToken>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum FontRole {
    /// Headlines, the story.
    Display,
    /// Text and interface.
    Body,
    /// Metadata, datelines, numbers (often monospace).
    Meta,
    Other,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FontFamily {
    pub name: String,
    pub role: FontRole,
    /// The CSS stack with fallbacks.
    pub stack: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub faces: Vec<FontFace>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FontFace {
    /// `400`, or a range `400 900` for a variable font.
    pub weight: String,
    pub style: String,
    /// The bundle path of the font file.
    pub file: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unicode_range: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TypeToken {
    /// `display-xl`, `h1`, `body`, `eyebrow`.
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub family: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub weight: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style: Option<String>,
    /// The largest size (`160px`).
    pub size: String,
    /// The fluid size (`clamp(72px, 9vw + 30px, 160px)`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fluid: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line_height: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tracking: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transform: Option<String>,
    /// What else the design says (`mobile 18`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

/// A named value: spacing, radius, shadow, ratio.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SizeToken {
    pub name: String,
    pub value: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub usage: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum MotionKind {
    Easing,
    Duration,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MotionToken {
    /// `--ease-tide`, `--dur-base`.
    pub name: String,
    pub kind: MotionKind,
    /// `cubic-bezier(0.22, 1, 0.36, 1)`, `320ms`.
    pub value: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub usage: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Breakpoint {
    pub name: String,
    pub min_px: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_px: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub columns: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gutter_px: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub margin_px: Option<u32>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Grid {
    pub columns: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gutter_px: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub margin_px: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub column_px: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub container_px: Option<u32>,
}

// --- templates ---------------------------------------------------------------

/// What a template shows. Engine-neutral: a renderer maps each kind to its
/// own template names ([`crate::wordpress::template_slug`]).
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TemplateKind {
    /// The front page.
    Home,
    /// One entry (an article, a story).
    Single,
    /// A standalone page.
    Page,
    /// A list of entries (the blog, a category).
    Archive,
    /// A collection's entries as a filterable list (things to do, restaurants).
    Listing,
    Search,
    NotFound,
    /// A page type of its own (a village page); the slug names it.
    Custom,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Template {
    pub slug: String,
    pub title: String,
    pub kind: TemplateKind,
    /// The bundle page it came from.
    pub source: String,
    pub sections: Vec<Section>,
    /// The parts it shows (`header`, `footer`).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub parts: Vec<String>,
    pub rule: String,
}

/// What fills a section.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum SectionContent {
    /// A catalogue block (`hero-section`, `newsletter`).
    Block { block: String },
    /// Entries chosen by a query (latest stories, the editors' picks).
    Query { query: ContentQuery },
    /// The page's own entry (its title and body) in a single or page template.
    Entry,
    /// A component of the design system.
    Component { component: String },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum QuerySource {
    /// Newest first.
    Latest,
    /// Chosen by editors.
    Featured,
    /// A collection's entries in the collection's own order.
    Collection,
    /// The template's own list (an archive's or a listing's entries).
    Inherit,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ContentQuery {
    pub source: QuerySource,
    /// How many entries the design shows.
    pub items: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Section {
    /// Unique in its template; stable across re-imports while the section
    /// keeps its content (`hero`, `query-featured`, `content-2`).
    pub id: String,
    #[serde(flatten)]
    pub content: SectionContent,
    /// What it is for (`editors-picks`, `destinations`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    /// Presentation facts a renderer needs: `heading`, `eyebrow`, `items`,
    /// `background` (a colour token name), `class`.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub props: BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pattern: Option<String>,
    pub rule: String,
    pub facts: SectionFacts,
    /// The section's markup in the design, expanded and sanitised (no scripts, no handlers),
    /// at most [`SECTION_HTML_BYTES`]: what a renderer reads for the section's layout and copy.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub html: String,
}

/// A section's markup is kept up to this size (larger ones are left out).
pub const SECTION_HTML_BYTES: usize = 24 * 1024;

impl Section {
    /// The section's identity for reconciliation: what fills it.
    pub fn key(&self) -> String {
        match &self.content {
            SectionContent::Block { block } => block.clone(),
            SectionContent::Query { query } => format!("query-{}", source_name(query.source)),
            SectionContent::Entry => "entry".into(),
            SectionContent::Component { component } => component.clone(),
        }
    }
}

pub fn source_name(s: QuerySource) -> &'static str {
    match s {
        QuerySource::Latest => "latest",
        QuerySource::Featured => "featured",
        QuerySource::Collection => "collection",
        QuerySource::Inherit => "inherit",
    }
}

/// Facts about a section's markup (design-import.ts's `SectionFacts`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(deny_unknown_fields)]
pub struct SectionFacts {
    pub tag: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub heading: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub heading_level: Option<u8>,
    pub images: u32,
    /// Images plus image frames (elements with an `aspect-ratio`).
    pub media: u32,
    pub links: u32,
    pub paragraphs: u32,
    pub words: u32,
    pub email_form: bool,
    pub questions: u32,
    pub buttons: u32,
    pub numbers: u32,
    pub repeated: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PartArea {
    Header,
    Footer,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Part {
    pub slug: String,
    pub area: PartArea,
    /// The design's markup (sanitised: no scripts, no handlers).
    pub html: String,
    pub templates: Vec<String>,
    /// How many different versions of it the templates show (1: one part).
    pub variants: u32,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub menus: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Pattern {
    pub slug: String,
    pub title: String,
    /// The section key or component it repeats.
    pub of: String,
    pub templates: Vec<String>,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub html: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Component {
    pub slug: String,
    pub name: String,
    /// `4.4`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub number: Option<String>,
    /// What follows the name (`sticky under masthead, wraps on mobile`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subtitle: Option<String>,
    /// The bundle page that specifies it.
    pub page: String,
    /// The design's notes on it (timings, sizes, behaviour).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub notes: Vec<String>,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub html: String,
    /// What the component serves on a site, from [`COMPONENT_FUNCTIONS`] (`faq`, `trail-stats`),
    /// read from its name and subtitle ([`crate::components`]).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub functions: Vec<String>,
    /// The forms it comes in (`story`, `village`, `stay`; `primary`, `secondary`).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub variants: Vec<String>,
    /// The states the design specifies (`hover`, `focus`, `open`, `disabled`).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub states: Vec<String>,
    /// The sheet's style rules for the classes its markup uses (interactions, states), at most
    /// [`COMPONENT_CSS_BYTES`].
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub css: String,
}

/// A component's style rules are kept up to this size.
pub const COMPONENT_CSS_BYTES: usize = 6 * 1024;

/// What a component can serve on a site: a closed list, so a renderer and its checks can say
/// which content each component is for. `(function, what it is)`.
pub const COMPONENT_FUNCTIONS: &[(&str, &str)] = &[
    (
        "masthead",
        "the site's header: wordmark, main menu, languages, its button",
    ),
    ("mega-menu", "a main-menu item's panel of sub-pages"),
    ("mobile-menu", "the main menu on a phone"),
    ("button", "buttons and arrow links"),
    ("tags", "chips, tags and tabs"),
    ("cards", "entries as cards (stories, places, stays)"),
    (
        "trail-stats",
        "a route's facts: distance, time, grade, access",
    ),
    ("essentials", "live facts of a place (sea, air, sunset)"),
    (
        "callout",
        "pull quotes, tips and notices set apart from the text",
    ),
    ("byline", "who wrote it, where and when"),
    (
        "page-header",
        "a page's breadcrumb, eyebrow, headline and lede",
    ),
    ("breadcrumb", "the path to the page"),
    ("contents", "the page's sections as a list of links"),
    ("reading-progress", "how far the reader is"),
    ("search", "searching the site"),
    ("form", "form fields"),
    ("faq", "questions and answers"),
    ("getting-here", "ways to arrive, one row per mode"),
    ("itinerary", "a trip's days in order"),
    ("gallery", "a set of pictures"),
    ("pagination", "the pages of a list"),
    ("feedback", "badges, tooltips and toasts"),
    ("loading", "content on its way"),
    ("empty", "a list with nothing in it"),
    ("related", "what to read next"),
    ("listing-bar", "a listing's title, count, filters and sort"),
    ("activity", "an activity or sight in a listing"),
    ("restaurant", "a restaurant in a listing"),
    ("weather", "the forecast and the seasons"),
    ("people", "the people who make the site"),
    ("footer", "the site's footer"),
];

/// An icon of the design's set (or a mark of a place).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Icon {
    /// The id the design gives it (`ct-train`, `ct-wx-rain`, `ct-village-vernazza`).
    pub id: String,
    pub name: String,
    /// `interface`, `travel`, `weather`, `mark` (the list it came from).
    pub group: String,
    /// The SVG path data, drawn on a 24 × 24 grid with a stroke.
    pub paths: Vec<String>,
    /// A mark's fill (its place's pigment).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub colour: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
}

/// A micro-interaction the design specifies, with its fallback for reduced motion.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Interaction {
    /// `01`.
    pub number: String,
    /// `Link underline draw`.
    pub name: String,
    /// What moves.
    pub behaviour: String,
    /// `320ms`, `560 / 320`.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub duration: String,
    /// The easing's name (`tide`).
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub easing: String,
    /// What happens under `prefers-reduced-motion: reduce`.
    pub reduced: String,
    pub page: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Menu {
    pub slug: String,
    pub label: String,
    pub items: Vec<MenuItem>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MenuItem {
    pub label: String,
    pub href: String,
    /// The template the link opens, when it links a page of the design.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub template: Option<String>,
}

// --- rules -------------------------------------------------------------------

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RuleKind {
    /// A principle (`Pigment is wayfinding`).
    Principle,
    /// Something observed on the live site and its fix.
    Fix,
    /// A rule of use (`Body never set in Bodoni below 24px`).
    Rule,
}

/// What a check can enforce. A closed list: a rule maps to one by fixed
/// wording, or it stays guidance for people and the web designer.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "check", rename_all = "kebab-case")]
pub enum RuleCheck {
    /// Ratings use one scale (`/10`) with this many decimals.
    RatingScale { max: u32, decimals: u32 },
    /// A page's `h1` is its headline only, without the site's name.
    HeadlineWithoutSiteName,
    /// No link or button points to `#`.
    NoPlaceholderLinks,
    /// No image is used by more than one story.
    OneImagePerStory,
    /// The content uses this component where it applies.
    RequiresComponent { component: String },
    /// Entries carry these fields (`category`, `alt`).
    RequiredFields { fields: Vec<String> },
    /// Prices on a scale of `max` symbols.
    PriceScale { symbol: String, max: u32 },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DesignRule {
    /// `principle-1`, `fix-01`, `rule-3`.
    pub id: String,
    pub kind: RuleKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub observed: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fix: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub check: Option<RuleCheck>,
    pub page: String,
}

// --- pages -------------------------------------------------------------------

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PageRole {
    /// A page of the site (it has the site's header or footer, or its title says so).
    Template,
    /// A sheet that specifies listings: each numbered part becomes a template.
    Templates,
    /// A sheet of the design system: tokens, components, rules.
    Guide,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DesignPage {
    pub path: String,
    pub title: String,
    pub role: PageRole,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Skipped {
    pub path: String,
    pub why: String,
}
