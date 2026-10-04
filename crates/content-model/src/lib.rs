//! Content model for swarm.press sites.
//!
//! * [`localized`] — `LocalizedString` (v1, `en` required) and `Localized<T>`
//!   (v2: plain value or per-language object).
//! * [`media`] — `MediaRef` (`media:<id>` or URL).
//! * [`page`] — typed `Page` / `Block`.
//! * [`blocks`] — the 46 core block types and their [`BlockMeta`]
//!   (intent, media requirements, linking rules).
//! * [`registry`] — [`SchemaRegistry`]: core JSON Schemas (from
//!   `content-schema`) + site custom blocks (`x:<name>`), in v1 and v2 form.
//! * [`validate`] — [`validate_page_v2`] → [`Report`] of errors and warnings.
//! * [`docs`] — [`blocks_doc`]: writer-facing block docs generated from schemas.

pub mod article_profile;
pub mod blocks;
pub mod docs;
pub mod localized;
pub mod media;
pub mod page;
pub mod registry;
pub mod validate;

pub use blocks::{
    block_meta, core_block_meta, is_core_block, BlockCategory, BlockMeta, EntityMatch, Intent,
    LinkingRules, MediaRequirements, CORE_BLOCK_TYPES, CUSTOM_PREFIX,
};
pub use docs::blocks_doc;
pub use localized::{text_of, Localized, LocalizedString, LocalizedText, FALLBACK_LANG};
pub use media::{url_identity, MediaRef, MediaRefError};
pub use page::{classify_block_type, Block, BlockKind, Page, PageSeo, PageStatus};
pub use registry::{BlockSchema, RegistryError, SchemaOrigin, SchemaRegistry};
pub use validate::{validate_page_v2, Issue, Report};

/// v1 validation (the exported Zod schema), re-exported for comparisons.
pub use content_schema::validate_page as validate_page_v1;
