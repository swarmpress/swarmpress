//! JSON Schema registry: core blocks (from `content-schema`'s embedded
//! `page.schema.json`) plus a site's custom blocks (`theme/blocks/<name>/schema.json`,
//! registered as `x:<name>`).
//!
//! Each block keeps two schemas:
//! * `v1` — exactly the exported Zod schema (what `content_schema::validate_page` enforces);
//! * `v2` — the plan's schema v2, derived mechanically from v1: text fields
//!   accept `string | { <lang>: string }` (localized objects need `en`), link
//!   fields accept per-language URLs, media fields accept a [`MediaRef`]
//!   (`media:<id>`, absolute URL or root-relative path).
//!
//! [`MediaRef`]: crate::media::MediaRef

use std::collections::BTreeMap;
use std::path::Path;
use std::sync::OnceLock;

use serde::Deserialize;
use serde_json::{json, Map, Value};

use crate::blocks::{
    block_meta, is_core_block, BlockCategory, BlockMeta, Intent, LinkingRules, MediaRequirements,
    CORE_BLOCK_TYPES, CUSTOM_PREFIX,
};
use crate::media::MEDIA_REF_PATTERN;

/// JSON Schema pattern for language keys of localized objects.
pub const LANG_KEY_PATTERN: &str = "^[a-z]{2}(-[A-Za-z0-9]{2,4})?$";

/// String fields that hold a media reference.
pub const MEDIA_KEYS: &[&str] = &[
    "image",
    "images",
    "src",
    "backgroundImage",
    "heroImage",
    "authorImage",
    "avatar",
    "screenshot",
    "screenshotDark",
    "og_image",
];

/// String fields that hold an internal or external link (may be per-language).
pub const LINK_KEYS: &[&str] = &["href", "url", "eyebrowUrl", "viewAllUrl"];

/// String fields that are identifiers / machine values, never localized.
pub const STRUCTURAL_KEYS: &[&str] = &[
    "type",
    "id",
    "slug",
    "slugs",
    "icon",
    "backgroundIcon",
    "color",
    "code",
    "collectionType",
    "collectionTypes",
    "village",
    "lang",
    "time",
    "height",
    "contactEmail",
    "status",
    "canonical",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum SchemaOrigin {
    Core,
    Custom,
}

#[derive(Debug, thiserror::Error)]
pub enum RegistryError {
    #[error("invalid custom block name {0:?} (expected lowercase kebab-case, e.g. `wine-map`)")]
    InvalidName(String),
    #[error("custom block `{0}` would shadow the core block of the same name")]
    ShadowsCore(String),
    #[error("custom block `x:{0}` is already registered")]
    Duplicate(String),
    #[error("custom block `x:{name}` declares type {declared:?}; it must be \"x:{name}\"")]
    TypeMismatch { name: String, declared: String },
    #[error("custom block `x:{0}` schema must describe an object (type: object with properties)")]
    NotAnObject(String),
    #[error("custom block `x:{name}` schema does not compile: {message}")]
    Compile { name: String, message: String },
    #[error("custom block `x:{name}` has invalid x-block-meta: {message}")]
    Meta { name: String, message: String },
    #[error("reading {path}: {message}")]
    Io { path: String, message: String },
}

/// One registered block type.
pub struct BlockSchema {
    /// The `type` discriminator (`paragraph`, `x:wine-map`).
    pub block_type: String,
    pub origin: SchemaOrigin,
    pub v1: Value,
    pub v2: Value,
    pub meta: BlockMeta,
    validator_v2: jsonschema::Validator,
}

impl BlockSchema {
    pub fn validator(&self) -> &jsonschema::Validator {
        &self.validator_v2
    }
}

impl std::fmt::Debug for BlockSchema {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("BlockSchema")
            .field("block_type", &self.block_type)
            .field("origin", &self.origin)
            .finish_non_exhaustive()
    }
}

/// Core + custom block schemas, plus the v2 page envelope.
pub struct SchemaRegistry {
    blocks: BTreeMap<String, BlockSchema>,
    page_v2: Value,
    page_validator: jsonschema::Validator,
}

impl std::fmt::Debug for SchemaRegistry {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SchemaRegistry")
            .field("blocks", &self.blocks.keys().collect::<Vec<_>>())
            .finish_non_exhaustive()
    }
}

pub(crate) fn compile(schema: &Value) -> Result<jsonschema::Validator, String> {
    jsonschema::draft7::options()
        .should_validate_formats(true)
        .build(schema)
        .map_err(|e| e.to_string())
}

fn v1_page_schema() -> &'static Value {
    static PAGE: OnceLock<Value> = OnceLock::new();
    PAGE.get_or_init(|| {
        let root: Value = serde_json::from_str(content_schema::PAGE_SCHEMA_JSON)
            .expect("embedded schema is JSON");
        root["definitions"]["Page"].clone()
    })
}

/// The v1 (exported Zod) schema of every core block, keyed by type.
pub fn core_block_schemas_v1() -> BTreeMap<String, Value> {
    let variants = v1_page_schema()["properties"]["body"]["items"]["anyOf"]
        .as_array()
        .expect("body.items.anyOf in page schema");
    variants
        .iter()
        .map(|s| {
            let t = s["properties"]["type"]["const"]
                .as_str()
                .expect("block variant has a const type")
                .to_string();
            (t, s.clone())
        })
        .collect()
}

/// `{ "<lang>": <of>, ... }` with `en` required.
fn lang_object(of: Value) -> Value {
    json!({
        "type": "object",
        "required": ["en"],
        "minProperties": 1,
        "propertyNames": { "pattern": LANG_KEY_PATTERN },
        "additionalProperties": of
    })
}

/// `original | { "<lang>": original }`.
fn localized(original: Value) -> Value {
    json!({ "anyOf": [original.clone(), lang_object(original)] })
}

/// A plain string field that v2 treats as localizable text.
fn is_text_string(schema: &Value, key: &str) -> bool {
    schema.get("type").and_then(Value::as_str) == Some("string")
        && ["const", "enum", "format", "pattern"]
            .iter()
            .all(|k| schema.get(*k).is_none())
        && !MEDIA_KEYS.contains(&key)
        && !LINK_KEYS.contains(&key)
        && !STRUCTURAL_KEYS.contains(&key)
}

fn media_ref() -> Value {
    json!({ "type": "string", "pattern": MEDIA_REF_PATTERN })
}

/// Derives the v2 form of a v1 (sub)schema. `key` is the property name the
/// schema sits under (array items inherit their array's key).
pub fn to_v2(schema: &Value, key: Option<&str>) -> Value {
    let Value::Object(obj) = schema else {
        return schema.clone();
    };
    // A list of text may also be localized as a whole: `{ "en": ["…"], "de": ["…"] }`.
    if obj.get("type").and_then(Value::as_str) == Some("array") {
        if let (Some(k), Some(items)) = (key, obj.get("items")) {
            if is_text_string(items, k) {
                let mut per_item = obj.clone();
                per_item.insert("items".into(), to_v2(items, key));
                return json!({ "anyOf": [Value::Object(per_item), lang_object(schema.clone())] });
            }
        }
    }
    if obj.get("type").and_then(Value::as_str) == Some("string") {
        let Some(k) = key else {
            return schema.clone();
        };
        if obj.contains_key("const") || obj.contains_key("enum") {
            return schema.clone();
        }
        if MEDIA_KEYS.contains(&k) {
            return media_ref();
        }
        if obj.contains_key("format") || obj.contains_key("pattern") {
            return schema.clone();
        }
        if STRUCTURAL_KEYS.contains(&k) {
            return schema.clone();
        }
        return localized(schema.clone());
    }
    let mut out = Map::new();
    for (k, v) in obj {
        let nv = match k.as_str() {
            "properties" => match v {
                Value::Object(props) => Value::Object(
                    props
                        .iter()
                        .map(|(pk, pv)| (pk.clone(), to_v2(pv, Some(pk))))
                        .collect(),
                ),
                _ => v.clone(),
            },
            "items" | "additionalProperties" => to_v2(v, key),
            "anyOf" | "oneOf" | "allOf" => match v {
                Value::Array(a) => Value::Array(a.iter().map(|s| to_v2(s, key)).collect()),
                _ => v.clone(),
            },
            _ => v.clone(),
        };
        out.insert(k.clone(), nv);
    }
    Value::Object(out)
}

fn page_v2_schema() -> Value {
    let mut page = v1_page_schema().clone();
    let props = page["properties"].as_object_mut().expect("page properties");
    props.insert(
        "body".into(),
        json!({
            "type": "array",
            "items": {
                "type": "object",
                "required": ["type"],
                "properties": { "type": { "type": "string", "minLength": 1 } }
            }
        }),
    );
    let title = props["title"].clone();
    props.insert(
        "title".into(),
        json!({ "anyOf": [ { "type": "string", "minLength": 1 }, title ] }),
    );
    props.insert("template".into(), json!({ "type": "string" }));
    let seo = props.get_mut("seo").expect("seo");
    let seo_props = seo["properties"].as_object_mut().expect("seo properties");
    for k in ["title", "description"] {
        let v = to_v2(&seo_props[k], Some(k));
        seo_props.insert(k.into(), v);
    }
    seo_props.insert("og_image".into(), media_ref());
    page
}

fn valid_custom_name(name: &str) -> bool {
    let mut chars = name.chars();
    matches!(chars.next(), Some(c) if c.is_ascii_lowercase())
        && name
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        && !name.ends_with('-')
        && !name.contains("--")
}

/// Optional `"x-block-meta"` object in a custom schema.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CustomMetaSpec {
    #[serde(default)]
    intent: Option<Intent>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    media: Option<MediaRequirements>,
    #[serde(default)]
    linking: Option<LinkingRules>,
    #[serde(default)]
    context: Vec<String>,
}

impl SchemaRegistry {
    /// The 46 core blocks only.
    pub fn core() -> Self {
        let page_v2 = page_v2_schema();
        let page_validator = compile(&page_v2).expect("v2 page envelope compiles");
        let mut blocks = BTreeMap::new();
        for (t, v1) in core_block_schemas_v1() {
            let v2 = to_v2(&v1, None);
            let validator_v2 =
                compile(&v2).unwrap_or_else(|e| panic!("v2 schema of `{t}` compiles: {e}"));
            let meta = block_meta(&t)
                .unwrap_or_else(|| panic!("core block `{t}` has metadata"))
                .clone();
            blocks.insert(
                t.clone(),
                BlockSchema {
                    block_type: t,
                    origin: SchemaOrigin::Core,
                    v1,
                    v2,
                    meta,
                    validator_v2,
                },
            );
        }
        debug_assert_eq!(blocks.len(), CORE_BLOCK_TYPES.len());
        SchemaRegistry {
            blocks,
            page_v2,
            page_validator,
        }
    }

    /// Registers a site custom block. `name` may be given with or without the
    /// `x:` prefix. Returns the registered type (`x:<name>`).
    pub fn register_custom(&mut self, name: &str, schema: Value) -> Result<String, RegistryError> {
        let name = name.strip_prefix(CUSTOM_PREFIX).unwrap_or(name);
        if !valid_custom_name(name) {
            return Err(RegistryError::InvalidName(name.to_string()));
        }
        if is_core_block(name) {
            return Err(RegistryError::ShadowsCore(name.to_string()));
        }
        let block_type = format!("{CUSTOM_PREFIX}{name}");
        if self.blocks.contains_key(&block_type) {
            return Err(RegistryError::Duplicate(name.to_string()));
        }
        let Value::Object(mut obj) = schema else {
            return Err(RegistryError::NotAnObject(name.to_string()));
        };
        let is_object = obj.get("type").and_then(Value::as_str) == Some("object")
            && obj.get("properties").is_some_and(Value::is_object);
        if !is_object {
            return Err(RegistryError::NotAnObject(name.to_string()));
        }
        if let Some(declared) = obj
            .get("properties")
            .and_then(|p| p.get("type"))
            .and_then(|t| t.get("const"))
            .and_then(Value::as_str)
        {
            if declared != block_type {
                return Err(RegistryError::TypeMismatch {
                    name: name.to_string(),
                    declared: declared.to_string(),
                });
            }
        }
        let meta_spec = match obj.remove("x-block-meta") {
            Some(v) => Some(serde_json::from_value::<CustomMetaSpec>(v).map_err(|e| {
                RegistryError::Meta {
                    name: name.to_string(),
                    message: e.to_string(),
                }
            })?),
            None => None,
        };
        // Pin the discriminator so the schema cannot match another type.
        obj.remove("$schema");
        obj["properties"]
            .as_object_mut()
            .expect("checked above")
            .insert(
                "type".into(),
                json!({ "type": "string", "const": block_type }),
            );
        let required = obj.entry("required").or_insert_with(|| json!([]));
        if let Value::Array(req) = required {
            if !req.iter().any(|r| r == "type") {
                req.insert(0, json!("type"));
            }
        }
        let schema = Value::Object(obj);
        let validator_v2 = compile(&schema).map_err(|message| RegistryError::Compile {
            name: name.to_string(),
            message,
        })?;
        let description = schema
            .get("description")
            .and_then(Value::as_str)
            .unwrap_or("Site custom block")
            .to_string();
        let meta = match meta_spec {
            Some(m) => BlockMeta {
                block_type: block_type.clone(),
                category: BlockCategory::Custom,
                intent: m.intent.unwrap_or(Intent::Inform),
                description: m.description.unwrap_or(description),
                media: m.media,
                linking: m.linking,
                context: m.context,
            },
            None => BlockMeta {
                block_type: block_type.clone(),
                category: BlockCategory::Custom,
                intent: Intent::Inform,
                description,
                media: None,
                linking: None,
                context: vec![],
            },
        };
        self.blocks.insert(
            block_type.clone(),
            BlockSchema {
                block_type: block_type.clone(),
                origin: SchemaOrigin::Custom,
                v1: schema.clone(),
                v2: schema,
                meta,
                validator_v2,
            },
        );
        Ok(block_type)
    }

    /// Loads every `<theme_blocks_dir>/<name>/schema.json`. Returns the
    /// registered types, sorted.
    pub fn load_custom_dir(
        &mut self,
        theme_blocks_dir: &Path,
    ) -> Result<Vec<String>, RegistryError> {
        let io = |p: &Path, e: std::io::Error| RegistryError::Io {
            path: p.display().to_string(),
            message: e.to_string(),
        };
        let mut dirs: Vec<_> = std::fs::read_dir(theme_blocks_dir)
            .map_err(|e| io(theme_blocks_dir, e))?
            .filter_map(Result::ok)
            .map(|e| e.path())
            .filter(|p| p.join("schema.json").is_file())
            .collect();
        dirs.sort();
        let mut out = vec![];
        for dir in dirs {
            let file = dir.join("schema.json");
            let text = std::fs::read_to_string(&file).map_err(|e| io(&file, e))?;
            let schema: Value = serde_json::from_str(&text).map_err(|e| RegistryError::Io {
                path: file.display().to_string(),
                message: e.to_string(),
            })?;
            let name = dir
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or_default()
                .to_string();
            out.push(self.register_custom(&name, schema)?);
        }
        Ok(out)
    }

    pub fn get(&self, block_type: &str) -> Option<&BlockSchema> {
        self.blocks.get(block_type)
    }

    pub fn meta(&self, block_type: &str) -> Option<&BlockMeta> {
        self.blocks.get(block_type).map(|b| &b.meta)
    }

    /// All blocks: core first (catalog order), then custom (alphabetical).
    pub fn blocks(&self) -> impl Iterator<Item = &BlockSchema> {
        CORE_BLOCK_TYPES
            .iter()
            .filter_map(|t| self.blocks.get(*t))
            .chain(
                self.blocks
                    .values()
                    .filter(|b| b.origin == SchemaOrigin::Custom),
            )
    }

    pub fn custom_types(&self) -> Vec<&str> {
        self.blocks
            .values()
            .filter(|b| b.origin == SchemaOrigin::Custom)
            .map(|b| b.block_type.as_str())
            .collect()
    }

    pub fn len(&self) -> usize {
        self.blocks.len()
    }

    pub fn is_empty(&self) -> bool {
        self.blocks.is_empty()
    }

    /// The v2 page envelope (body items are dispatched per block type).
    pub fn page_schema_v2(&self) -> &Value {
        &self.page_v2
    }

    pub(crate) fn page_validator(&self) -> &jsonschema::Validator {
        &self.page_validator
    }
}

impl Default for SchemaRegistry {
    fn default() -> Self {
        Self::core()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_all_46_core_schemas() {
        let s = core_block_schemas_v1();
        assert_eq!(s.len(), 46);
        for t in CORE_BLOCK_TYPES {
            assert!(s.contains_key(t), "{t} missing from page.schema.json");
        }
    }

    #[test]
    fn core_registry_compiles() {
        let r = SchemaRegistry::core();
        assert_eq!(r.len(), 46);
        assert!(r.custom_types().is_empty());
        assert_eq!(r.blocks().count(), 46);
    }

    #[test]
    fn v2_localizes_text_but_not_structure() {
        let v1 = json!({
            "type": "object",
            "properties": {
                "type": {"type": "string", "const": "x"},
                "title": {"type": "string", "minLength": 1},
                "village": {"type": "string"},
                "image": {"type": "string"},
                "href": {"type": "string"},
                "variant": {"type": "string", "enum": ["a", "b"]},
                "embed": {"type": "string", "format": "uri"},
                "tags": {"type": "array", "items": {"type": "string"}}
            }
        });
        let v2 = to_v2(&v1, None);
        let p = &v2["properties"];
        assert!(p["title"]["anyOf"].is_array());
        assert_eq!(
            p["title"]["anyOf"][1]["additionalProperties"]["minLength"],
            1
        );
        assert_eq!(p["village"], v1["properties"]["village"]);
        assert_eq!(p["image"]["pattern"], MEDIA_REF_PATTERN);
        assert!(p["href"]["anyOf"].is_array());
        assert_eq!(p["variant"], v1["properties"]["variant"]);
        assert_eq!(p["embed"], v1["properties"]["embed"]);
        assert!(p["tags"]["anyOf"][0]["items"]["anyOf"].is_array());
        assert_eq!(
            p["tags"]["anyOf"][1]["additionalProperties"]["type"],
            "array"
        );
        assert_eq!(p["type"], v1["properties"]["type"]);
    }

    fn custom_schema() -> Value {
        json!({
            "type": "object",
            "description": "Map of wineries along the terraces",
            "properties": {
                "title": {"type": "string"},
                "pins": {"type": "array", "items": {"type": "object"}}
            },
            "required": ["pins"],
            "additionalProperties": false,
            "x-block-meta": {"intent": "orient", "linking": {"minLinks": 0, "maxLinks": 4, "allowedTargets": ["villages"]}}
        })
    }

    #[test]
    fn registers_custom_blocks() {
        let mut r = SchemaRegistry::core();
        let t = r.register_custom("wine-map", custom_schema()).unwrap();
        assert_eq!(t, "x:wine-map");
        let b = r.get("x:wine-map").unwrap();
        assert_eq!(b.origin, SchemaOrigin::Custom);
        assert_eq!(b.meta.intent, Intent::Orient);
        assert_eq!(b.meta.category, BlockCategory::Custom);
        assert_eq!(b.meta.description, "Map of wineries along the terraces");
        assert!(b
            .validator()
            .is_valid(&json!({"type": "x:wine-map", "pins": []})));
        assert!(!b
            .validator()
            .is_valid(&json!({"type": "x:other", "pins": []})));
        assert!(!b.validator().is_valid(&json!({"pins": []})));
        assert_eq!(r.custom_types(), vec!["x:wine-map"]);
        assert_eq!(r.blocks().last().unwrap().block_type, "x:wine-map");
    }

    #[test]
    fn custom_blocks_cannot_shadow_or_collide() {
        let mut r = SchemaRegistry::core();
        assert!(matches!(
            r.register_custom("hero", custom_schema()),
            Err(RegistryError::ShadowsCore(_))
        ));
        assert!(matches!(
            r.register_custom("x:paragraph", custom_schema()),
            Err(RegistryError::ShadowsCore(_))
        ));
        assert!(matches!(
            r.register_custom("Wine Map", custom_schema()),
            Err(RegistryError::InvalidName(_))
        ));
        r.register_custom("x:wine-map", custom_schema()).unwrap();
        assert!(matches!(
            r.register_custom("wine-map", custom_schema()),
            Err(RegistryError::Duplicate(_))
        ));
        let mut wrong = custom_schema();
        wrong["properties"]["type"] = json!({"const": "hero"});
        assert!(matches!(
            r.register_custom("other", wrong),
            Err(RegistryError::TypeMismatch { .. })
        ));
        assert!(matches!(
            r.register_custom("arr", json!({"type": "array"})),
            Err(RegistryError::NotAnObject(_))
        ));
        let mut bad_meta = custom_schema();
        bad_meta["x-block-meta"] = json!({"intent": "dance"});
        assert!(matches!(
            r.register_custom("bad-meta", bad_meta),
            Err(RegistryError::Meta { .. })
        ));
    }

    #[test]
    fn loads_custom_dir() {
        let dir = std::env::temp_dir().join(format!("content-model-custom-{}", std::process::id()));
        let block = dir.join("wine-map");
        std::fs::create_dir_all(&block).unwrap();
        std::fs::write(block.join("schema.json"), custom_schema().to_string()).unwrap();
        std::fs::create_dir_all(dir.join("not-a-block")).unwrap();
        let mut r = SchemaRegistry::core();
        let loaded = r.load_custom_dir(&dir).unwrap();
        std::fs::remove_dir_all(&dir).unwrap();
        assert_eq!(loaded, vec!["x:wine-map"]);
    }
}
