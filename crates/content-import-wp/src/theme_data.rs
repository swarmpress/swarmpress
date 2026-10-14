//! A site's theme as data (ADR-0093): what a design becomes in WordPress, written over REST onto the
//! neutral base theme `canvas` instead of shipping as theme files.
//!
//! The types are `site_design::wordpress`'s (`crates/site-design`, FEAT-114): one definition for the
//! web designer that writes the data and the importer that writes it into a branch. Everything else
//! in this crate names them through this module only. [`ThemeData::validate_shape`] is checked
//! before anything is written ([`crate::theme::checked`]).

pub use site_design::wordpress::{
    template_slug, valid_slug, AssetRef, BlockStyle, GlobalStyles, NavigationItem, NavigationMenu,
    PartArea, ShapeIssue, ThemeData, ThemeFile, ThemeFontFace, ThemeFontFamily, ThemePart,
    ThemePattern, ThemeTemplate, ENHANCEMENT_PATH, ENHANCEMENT_SCRIPT, REQUIRED_PARTS,
    REQUIRED_TEMPLATES, THEME_DATA_FORMAT, THEME_JSON_VERSION,
};
