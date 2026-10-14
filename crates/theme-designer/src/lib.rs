//! The web designer's deterministic core (ADR-0093, FEAT-115): a site's design
//! ([`site_design::SiteDesign`]) rendered as WordPress theme data
//! ([`site_design::ThemeData`]), as much of it as possible without a model.
//!
//! ```text
//! SiteDesign + its bundle's manifest + the site (SiteContext: its name, languages,
//! the pages menus may link, the collections queries may show)
//!   └─► plan(): the deterministic part ([`plan`])
//!         global styles from the tokens (theme.json v3: palette, roles, font families,
//!         fluid sizes, spacing, shadows, layout; custom CSS only for what theme.json
//!         cannot say), fonts from the bundle's files (one Latin face per weight and
//!         style, each an AssetRef with its SHA-256), the menus per language (links
//!         resolved against the site's pages, never `#`), and one task per template
//!         and part for the model, its sections bound to the site's collections
//!   └─► per task: the model writes block markup (core blocks only) from the task's spec
//!         └─► check_template() ([`check`]): grammar, allowed blocks, the sections and
//!             parts and menus covered, presets only (no raw colours), WCAG AA contrast,
//!             no scripts, iframes, handlers or `#` links, links and queries from the
//!             site only, the design's enforceable rules
//!         └─► next_step() ([`repair`]): Done │ Repair{issues} (at most MAX_REPAIR_ROUNDS)
//!             │ GiveUp (the job fails loudly, rule 11)
//!   └─► assemble() + check_theme(): the whole theme (its shape, the required templates,
//!       licensed fonts, the pairs global styles use) before anything is written
//! ```
//!
//! Nothing here calls a model or WordPress: the orchestrator does (crates/orchestrator
//! `site_theme`), and the importer writes the data (crates/content-import-wp `theme`).
//! [`sketch`] is the reference rendering of a task: what the fake web designer answers
//! (tests, `?llm=fake`); a model's answer is judged by the same checks.
//!
//! Pure and deterministic: ordered maps only, integers only (contrast × 100).

#![forbid(unsafe_code)]

pub mod blocks;
pub mod check;
pub mod components;
pub mod fake;
pub mod model;
pub mod plan;
pub mod repair;
pub mod sketch;
pub mod styles;
pub mod visual;

pub use check::{check_template, check_theme, CheckContext};
pub use model::{
    Collection, Issue, IssueCode, Presets, SectionSpec, SiteContext, SiteLink, TaskKind,
    TemplateTask,
};
pub use plan::{assemble, plan, ThemePlan};
pub use repair::{next_step, RepairTask, Step, MAX_REPAIR_ROUNDS};

/// Core blocks a template or part may use (WordPress core only, ADR-0093).
pub const ALLOWED_BLOCKS: &[&str] = &[
    "core/group",
    "core/columns",
    "core/column",
    "core/cover",
    "core/heading",
    "core/paragraph",
    "core/list",
    "core/list-item",
    "core/quote",
    "core/image",
    "core/buttons",
    "core/button",
    "core/separator",
    "core/spacer",
    "core/details",
    "core/media-text",
    "core/navigation",
    "core/navigation-link",
    "core/navigation-submenu",
    "core/home-link",
    "core/site-title",
    "core/site-tagline",
    "core/site-logo",
    "core/template-part",
    "core/pattern",
    "core/post-content",
    "core/post-title",
    "core/post-excerpt",
    "core/post-date",
    "core/post-terms",
    "core/post-author-name",
    "core/post-featured-image",
    "core/post-navigation-link",
    "core/read-more",
    "core/query",
    "core/post-template",
    "core/query-title",
    "core/query-no-results",
    "core/query-pagination",
    "core/query-pagination-previous",
    "core/query-pagination-numbers",
    "core/query-pagination-next",
    "core/term-description",
    "core/search",
];

/// Font families whose licence is the SIL Open Font License (a theme may ship them).
/// A design's family outside this list fails the theme's check: add a family here only
/// with its licence checked.
pub const OFL_FONTS: &[&str] = &[
    "Alegreya",
    "Archivo",
    "Bitter",
    "Bodoni Moda",
    "Cormorant Garamond",
    "DM Sans",
    "DM Serif Display",
    "EB Garamond",
    "Fraunces",
    "IBM Plex Mono",
    "IBM Plex Sans",
    "IBM Plex Serif",
    "Inter",
    "Libre Baskerville",
    "Libre Franklin",
    "Lora",
    "Manrope",
    "Merriweather",
    "Montserrat",
    "Newsreader",
    "Noto Sans",
    "Noto Serif",
    "Nunito Sans",
    "Playfair Display",
    "Schibsted Grotesk",
    "Source Sans 3",
    "Source Serif 4",
    "Space Grotesk",
    "Space Mono",
    "Work Sans",
];

/// Body text needs this contrast with its background (WCAG 2 AA, × 100).
pub const AA_TEXT_X100: u32 = 450;
/// Large text (headings, the site's title) needs this (WCAG 2 AA large, × 100).
pub const AA_LARGE_X100: u32 = 300;
