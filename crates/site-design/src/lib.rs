//! A site's design from Claude Design (ADR-0093, FEAT-114).
//!
//! The design a player (or Claude Design's "Send to") delivers is the
//! durable source of a site's look and structure. This crate holds the three
//! things every engine and every agent agrees on:
//!
//! * [`DesignBundle`]: the design's files as sent, checked (allowed types,
//!   plain paths, 20 MB), with a content hash that depends only on the files.
//!   A Claude Design standalone export is unpacked natively ([`export`]):
//!   its nested page bundles, gzip and base64 resources and `data:` URIs
//!   become plain pages and assets.
//! * [`SiteDesign`]: the bundle **interpreted**, engine-neutral ([`model`],
//!   [`interpret`]): tokens (colours with roles and contrast, schemes, fonts
//!   with their files, a fluid type scale, spacing, radii, elevations,
//!   motion, breakpoints, the grid, image ratios), templates of ordered
//!   sections (catalogue blocks, content queries, the entry, components),
//!   shared parts, patterns, components, menus, and the design's rules
//!   (principles, fixes, typesetting rules; some map to checks). Claude
//!   Design's page runtime is read without running it ([`dc`]).
//!   [`diff`] reconciles two interpretations; [`merge`] applies a later
//!   design of some templates and keeps the others (the unit is the template).
//! * [`wordpress::ThemeData`]: the shape of the design's rendering on
//!   WordPress, the site engine today: global styles, templates, template
//!   parts, patterns, navigation and fonts as site data on a neutral base
//!   theme. Another engine's rendering would be a module beside it.
//!
//! Pure and deterministic: no I/O, no clock (times are passed in), ordered
//! maps only; compiles to wasm.

#![forbid(unsafe_code)]

pub mod bundle;
pub mod css;
pub mod dc;
pub mod diff;
pub mod dom;
pub mod export;
mod guide;
pub mod interpret;
pub mod model;
pub mod wordpress;

pub use bundle::{
    bundle_hash, check_path, content_type, BundleIssue, BundleManifest, DesignBundle, DesignSource,
    FileEntry, BUNDLE_FORMAT, MAX_BUNDLE_BYTES, MAX_FILES,
};
pub use diff::{diff, merge, Change, DesignDiff};
pub use guide::contrast_x100;
pub use interpret::{interpret, interpret_texts};
pub use model::*;
pub use wordpress::ThemeData;
