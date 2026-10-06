//! Page JSON validation for agent writes, and the page-type registry's format.
//!
//! `schema/page.schema.json` is generated from the Zod schema in
//! `packages/content-schema` (`pnpm schema:export`) and committed; CI fails
//! if it drifts. The fixtures in `fixtures/` are validated by both this crate
//! and the Zod test so the two validators stay in agreement.
//!
//! The same export writes the page-type registry (FEAT-089, ADR-0072):
//! `schema/page-types.schema.json` (the format, [`validate_page_types`]) and
//! `schema/page-types.json` (the core types, [`CORE_PAGE_TYPES_JSON`]), which
//! `content_model::page_types` reads.

use std::sync::OnceLock;

use serde_json::Value;

pub const PAGE_SCHEMA_JSON: &str = include_str!("../schema/page.schema.json");

fn validator() -> &'static jsonschema::Validator {
    static VALIDATOR: OnceLock<jsonschema::Validator> = OnceLock::new();
    VALIDATOR.get_or_init(|| {
        let schema: Value =
            serde_json::from_str(PAGE_SCHEMA_JSON).expect("embedded schema is JSON");
        // zod-to-json-schema wraps the schema as { $ref: "#/definitions/Page", definitions: {...} }
        jsonschema::validator_for(&schema).expect("embedded schema compiles")
    })
}

/// The page-type registry format (`swarmpress.page-types.v1`).
pub const PAGE_TYPES_SCHEMA_JSON: &str = include_str!("../schema/page-types.schema.json");
/// The core block metadata (`packages/content-schema/data/block-meta.json`,
/// copied verbatim by the export).
pub const BLOCK_META_JSON: &str = include_str!("../schema/block-meta.json");
/// The core page types, defaults filled in.
pub const CORE_PAGE_TYPES_JSON: &str = include_str!("../schema/page-types.json");

fn page_types_validator() -> &'static jsonschema::Validator {
    static VALIDATOR: OnceLock<jsonschema::Validator> = OnceLock::new();
    VALIDATOR.get_or_init(|| {
        let schema: Value =
            serde_json::from_str(PAGE_TYPES_SCHEMA_JSON).expect("embedded schema is JSON");
        jsonschema::validator_for(&schema).expect("embedded schema compiles")
    })
}

/// Validates a page-type registry file against the exported format. The
/// cross-field rules (a block in one slot, unique ids) are checked by
/// `content_model::page_types`, as Zod's refinements do not export.
pub fn validate_page_types(file: &Value) -> Result<(), Vec<String>> {
    let errors: Vec<String> = page_types_validator()
        .iter_errors(file)
        .map(|e| format!("{}: {}", e.instance_path, e))
        .collect();
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors)
    }
}

/// Validates a page document, returning human-readable errors suitable for
/// feeding back to an agent as a tool error.
pub fn validate_page(page: &Value) -> Result<(), Vec<String>> {
    let errors: Vec<String> = validator()
        .iter_errors(page)
        .map(|e| format!("{}: {}", e.instance_path, e))
        .collect();
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, path::Path};

    fn run_fixtures(kind: &str, expect_valid: bool) {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("fixtures")
            .join(kind);
        let mut count = 0;
        for entry in fs::read_dir(&dir).unwrap() {
            let path = entry.unwrap().path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            let value: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
            let result = validate_page(&value);
            assert_eq!(
                result.is_ok(),
                expect_valid,
                "{} disagreed with the schema: {:?}",
                path.display(),
                result
            );
            count += 1;
        }
        assert!(count > 0, "no fixtures in {}", dir.display());
    }

    #[test]
    fn valid_fixtures_pass() {
        run_fixtures("valid", true);
    }

    #[test]
    fn invalid_fixtures_fail() {
        run_fixtures("invalid", false);
    }

    #[test]
    fn the_core_page_types_match_their_format() {
        let core: Value = serde_json::from_str(CORE_PAGE_TYPES_JSON).unwrap();
        assert_eq!(validate_page_types(&core), Ok(()));
        let mut bad = core.clone();
        bad["page_types"][0]["colour"] = Value::from("red");
        assert!(validate_page_types(&bad).is_err());
        let mut bad = core;
        bad["format"] = Value::from("swarmpress.page-types.v0");
        assert!(validate_page_types(&bad).is_err());
    }
}
