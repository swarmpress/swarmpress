//! Typed page model (`content/pages/**.json` in a site repo).
//!
//! Blocks are kept as JSON objects with a typed `type` discriminator: the
//! block catalog is open (site custom blocks) and the JSON Schema registry
//! owns field-level validation, so the Rust type only models what platform
//! code reads generically.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::blocks::{is_core_block, CUSTOM_PREFIX};
use crate::localized::{LocalizedString, LocalizedText};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PageStatus {
    #[default]
    Draft,
    InReview,
    Published,
    Archived,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct PageSeo {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<LocalizedText>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<LocalizedText>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub keywords: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub canonical: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub og_image: Option<String>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

/// One content block: `type` plus the block's own fields.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Block {
    #[serde(rename = "type")]
    pub block_type: String,
    #[serde(flatten)]
    pub fields: Map<String, Value>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BlockKind<'a> {
    Core(&'a str),
    /// `x:<name>` — the name without the prefix.
    Custom(&'a str),
    Unknown(&'a str),
}

impl Block {
    pub fn kind(&self) -> BlockKind<'_> {
        classify_block_type(&self.block_type)
    }
}

pub fn classify_block_type(t: &str) -> BlockKind<'_> {
    if is_core_block(t) {
        BlockKind::Core(t)
    } else if let Some(name) = t.strip_prefix(CUSTOM_PREFIX) {
        BlockKind::Custom(name)
    } else {
        BlockKind::Unknown(t)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Page {
    pub id: String,
    /// Route per language, e.g. `{ "en": "/en/blog/x" }`.
    pub slug: LocalizedString,
    pub title: LocalizedText,
    pub page_type: String,
    #[serde(default)]
    pub seo: PageSeo,
    /// Legacy template hint used by the cinqueterre theme.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub template: Option<String>,
    pub body: Vec<Block>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<Map<String, Value>>,
    #[serde(default)]
    pub status: PageStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
}

impl Page {
    pub fn from_value(v: &Value) -> Result<Self, serde_json::Error> {
        Page::deserialize(v)
    }

    /// Languages the page is routed in.
    pub fn langs(&self) -> Vec<&str> {
        self.slug.langs().collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_page_with_mixed_shapes() {
        let v = json!({
            "id": "p1",
            "slug": {"en": "/en/x", "de": "/de/x"},
            "title": "Plain title",
            "page_type": "blog-article",
            "seo": {"title": {"en": "T", "de": "T"}, "robots": "index"},
            "template": "editorial",
            "body": [
                {"type": "paragraph", "markdown": "Hi"},
                {"type": "x:wine-map", "pins": []},
                {"type": "pricing-section"}
            ],
            "status": "published"
        });
        let p = Page::from_value(&v).unwrap();
        assert_eq!(p.langs(), vec!["en", "de"]);
        assert_eq!(p.title.get("de").unwrap(), "Plain title");
        assert_eq!(p.seo.extra["robots"], "index");
        assert_eq!(p.body[0].kind(), BlockKind::Core("paragraph"));
        assert_eq!(p.body[1].kind(), BlockKind::Custom("wine-map"));
        assert_eq!(p.body[2].kind(), BlockKind::Unknown("pricing-section"));
        assert_eq!(p.status, PageStatus::Published);
        let back = serde_json::to_value(&p).unwrap();
        assert_eq!(back["body"][1]["type"], "x:wine-map");
    }

    #[test]
    fn rejects_slug_without_en() {
        let v =
            json!({"id": "p", "slug": {"de": "/de/x"}, "title": "x", "page_type": "t", "body": []});
        assert!(Page::from_value(&v).is_err());
    }
}
