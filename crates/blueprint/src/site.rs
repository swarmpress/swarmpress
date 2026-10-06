//! A site's models as files: the blueprint, its named types, and the context
//! the checker needs (custom blocks, manifest sections and collections).

use std::collections::BTreeMap;

use content_model::SchemaRegistry;
use knowledge::source::file_stem;
use knowledge::{KnowledgeBase, SiteSource};
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

/// The checker's context for a site: its types, custom blocks, manifest
/// sections and collections, and the given tools.
pub fn context(
    src: &dyn SiteSource,
    types: &BTreeMap<String, Value>,
    tools: BTreeMap<String, ToolSig>,
) -> Result<CheckContext, Vec<Issue>> {
    let kb = KnowledgeBase::build(src).map_err(|e| issue("/", e))?;
    let mut registry = SchemaRegistry::core();
    let custom_blocks = knowledge::load_custom_blocks(src, &mut registry)
        .map_err(|e| issue("theme/blocks", e))?
        .into_iter()
        .collect();
    Ok(CheckContext {
        types: TypeRegistry::with_site(types)?,
        custom_blocks,
        tools,
        sections: kb
            .manifest
            .sections
            .iter()
            .map(|s| s.slug.clone())
            .collect(),
        manifest_collections: kb
            .manifest
            .collections
            .iter()
            .map(|c| c.kind.clone())
            .collect(),
    })
}
