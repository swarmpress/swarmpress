//! A site's models as files: the blueprint, its named types, and the context
//! the checker needs (custom blocks, manifest sections and collections).

use std::collections::BTreeMap;

use content_model::SchemaRegistry;
use knowledge::source::file_stem;
use knowledge::{KnowledgeBase, SiteSource};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::check::{CheckContext, ToolSig};
use crate::format::{Blueprint, BLUEPRINT_PATH, TYPES_DIR};
use crate::issue::{Issue, IssueCode};
use crate::types::TypeRegistry;

/// What a site repo holds under `blueprint/`.
#[derive(Clone, Debug, PartialEq)]
pub struct SiteModels {
    pub blueprint: Option<Blueprint>,
    /// Type name → schema.
    pub types: BTreeMap<String, Value>,
}

fn issue(path: &str, m: impl std::fmt::Display) -> Vec<Issue> {
    vec![Issue::new(IssueCode::BadFormat, path, m.to_string())]
}

/// Reads `blueprint/site.json` and `blueprint/types/*.json`.
pub fn load(src: &dyn SiteSource) -> Result<SiteModels, Vec<Issue>> {
    let blueprint = match src
        .read_json(BLUEPRINT_PATH)
        .map_err(|e| issue(BLUEPRINT_PATH, e))?
    {
        Some(v) => Some(Blueprint::from_value(&v).map_err(|e| issue(BLUEPRINT_PATH, e))?),
        None => None,
    };
    let mut types = BTreeMap::new();
    for path in src.list(TYPES_DIR).map_err(|e| issue(TYPES_DIR, e))? {
        if !path.ends_with(".json") {
            continue;
        }
        let v = src
            .read_json(&path)
            .map_err(|e| issue(&path, e))?
            .unwrap_or(Value::Null);
        types.insert(file_stem(&path).to_string(), v);
    }
    Ok(SiteModels { blueprint, types })
}

/// The parts of a checker's context that come from the site's tree, as data:
/// what the server sends with the models so the browser can check edits
/// (`blueprint-wasm`) exactly as the server does.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct SiteContext {
    #[serde(default)]
    pub custom_blocks: Vec<String>,
    #[serde(default)]
    pub sections: Vec<String>,
    #[serde(default)]
    pub collections: Vec<String>,
}

impl SiteContext {
    /// The checker's context: these facts, the site's types and its tools.
    pub fn check_context(
        &self,
        types: &BTreeMap<String, Value>,
        tools: BTreeMap<String, ToolSig>,
    ) -> Result<CheckContext, Vec<Issue>> {
        Ok(CheckContext {
            types: TypeRegistry::with_site(types)?,
            custom_blocks: self.custom_blocks.iter().cloned().collect(),
            tools,
            sections: self.sections.iter().cloned().collect(),
            manifest_collections: self.collections.iter().cloned().collect(),
        })
    }
}

/// The site facts of the checker's context, read from its tree.
pub fn site_context(src: &dyn SiteSource) -> Result<SiteContext, Vec<Issue>> {
    let kb = KnowledgeBase::build(src).map_err(|e| issue("/", e))?;
    let mut registry = SchemaRegistry::core();
    let custom_blocks =
        knowledge::load_custom_blocks(src, &mut registry).map_err(|e| issue("theme/blocks", e))?;
    Ok(SiteContext {
        custom_blocks,
        sections: kb
            .manifest
            .sections
            .iter()
            .map(|s| s.slug.clone())
            .collect(),
        collections: kb
            .manifest
            .collections
            .iter()
            .map(|c| c.kind.clone())
            .collect(),
    })
}

/// The checker's context for a site: its types, custom blocks, manifest
/// sections and collections, and the given tools.
pub fn context(
    src: &dyn SiteSource,
    types: &BTreeMap<String, Value>,
    tools: BTreeMap<String, ToolSig>,
) -> Result<CheckContext, Vec<Issue>> {
    site_context(src)?.check_context(types, tools)
}
