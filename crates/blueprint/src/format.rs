//! The blueprint format (`swarmpress.blueprint.v1`, design §3.3).
//!
//! A site's structure: its page types (each a stack of slots naming catalogue
//! blocks), the global blocks they share, its collections, the relationships
//! between page types, its navigation and its design intent. It lives at
//! [`BLUEPRINT_PATH`] in the site repo, next to named types
//! ([`TYPES_DIR`]) and tools ([`TOOLS_DIR`]).

use std::collections::BTreeMap;

use content_model::page_types::{HtmlField, PageType, PageTypes, Require, Slot as RegistrySlot};
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const BLUEPRINT_FORMAT: &str = "swarmpress.blueprint.v1";
/// Domain prefix of the blueprint's semantic hash.
pub const BLUEPRINT_DOMAIN: &str = "swarmpress:blueprint:v1";
pub const BLUEPRINT_PATH: &str = "blueprint/site.json";
pub const TYPES_DIR: &str = "blueprint/types";
pub const TOOLS_DIR: &str = "blueprint/tools";
/// Editor positions: not semantic, never hashed (design §5.1).
pub const LAYOUT_PATH: &str = "blueprint/layout.json";

/// A block's narrative purpose, as the block catalogue names it.
pub use content_model::Intent;

/// A global block: one definition, used by every page type that names it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Global {
    pub block: String,
}

/// Where a page type's pages come from.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum Source {
    /// Page files (`content/pages/**`).
    Page,
    /// One page per item of a collection.
    CollectionItem { collection: String },
}

/// A slot's data from a tool (design §3.5).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Binding {
    pub tool: String,
    /// The tool's output port; may be left out when the tool has one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output: Option<String>,
    /// Tool input → context path (`page.entity`, `item.slug`, `site.name`).
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub inputs: BTreeMap<String, String>,
    /// The type the slot's block accepts.
    pub accepts: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Slot {
    pub id: String,
    pub blocks: Vec<String>,
    #[serde(default, skip_serializing_if = "is_zero")]
    pub min: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<Binding>,
}

fn is_zero(n: &u32) -> bool {
    *n == 0
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Linking {
    #[serde(default, skip_serializing_if = "is_zero")]
    pub min_links: u32,
    /// Page types the pages should link to; empty: any.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub targets: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BlueprintPageType {
    pub id: String,
    pub label: BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub aliases: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub route: Option<String>,
    pub source: Source,
    /// `None`: the body is not constrained (a type the importer could not read).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub slots: Option<Vec<Slot>>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub require: Vec<Require>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub html_fields: Vec<HtmlField>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub linking: Option<Linking>,
    /// Global ids this type shows (header, footer).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub uses: Vec<String>,
    /// How many pages of the type the site has; the importer fills it in, the
    /// town prints it on the door sign. Not semantic: left out of the hash.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pages: Option<u32>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Cardinality {
    OneToOne,
    OneToMany,
    ManyToOne,
    ManyToMany,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Collection {
    pub id: String,
    /// The item type (a type expression without `[]`).
    #[serde(rename = "type")]
    pub item_type: String,
    /// `page_type:<id>` or `collection:<manifest collection id>`.
    pub from: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub order: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit: Option<u32>,
    /// Items the site has; filled in by the importer, not hashed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub items: Option<u32>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Relationship {
    pub from: String,
    pub to: String,
    pub kind: String,
    pub cardinality: Cardinality,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub via: Option<String>,
}

/// A navigation entry: a page type or a manifest section.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NavItem {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub section: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum IntentKeyword {
    Editorial,
    Dense,
    Minimal,
    Cinematic,
    CardBased,
    Newspaper,
    ImageHeavy,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DesignIntent {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub keywords: Vec<IntentKeyword>,
    /// The theme's tokens file, when it has one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tokens: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Blueprint {
    pub format: String,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub globals: BTreeMap<String, Global>,
    pub page_types: Vec<BlueprintPageType>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub collections: Vec<Collection>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub relationships: Vec<Relationship>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub navigation: Vec<NavItem>,
    #[serde(default)]
    pub intent: DesignIntent,
}

impl Blueprint {
    pub fn empty() -> Blueprint {
        Blueprint {
            format: BLUEPRINT_FORMAT.into(),
            globals: BTreeMap::new(),
            page_types: Vec::new(),
            collections: Vec::new(),
            relationships: Vec::new(),
            navigation: Vec::new(),
            intent: DesignIntent::default(),
        }
    }

    pub fn from_value(v: &Value) -> Result<Blueprint, String> {
        serde_json::from_value(v.clone()).map_err(|e| e.to_string())
    }

    pub fn page_type(&self, id: &str) -> Option<&BlueprintPageType> {
        self.page_types.iter().find(|t| t.id == id)
    }

    /// The page-type registry the blueprint implies (FEAT-089): the format a
    /// site's `content/config/page-types.json` takes, so the body checks of
    /// `content_model::page_types` apply to the blueprint's types unchanged.
    /// The core types the platform owns are left out.
    pub fn registry(&self) -> Value {
        let core = PageTypes::core();
        let types: Vec<PageType> = self
            .page_types
            .iter()
            .filter(|t| core.get(&t.id).is_none())
            .map(|t| PageType {
                id: t.id.clone(),
                label: t.label.clone(),
                aliases: t.aliases.clone(),
                route: t.route.clone(),
                slots: t.slots.as_ref().map(|slots| {
                    slots
                        .iter()
                        .map(|s| RegistrySlot {
                            id: s.id.clone(),
                            blocks: s.blocks.clone(),
                            min: s.min,
                            max: s.max,
                        })
                        .collect()
                }),
                require: t.require.clone(),
                html_fields: t.html_fields.clone(),
            })
            .collect();
        serde_json::json!({ "format": content_model::page_types::PAGE_TYPES_FORMAT, "page_types": types })
    }
}
