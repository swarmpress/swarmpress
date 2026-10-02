//! `SchemaValidator` is the one validator for structured answers: the Rust
//! side applies it to every answer, and `orchestrator-wasm` exports it to the
//! browser as `validateJson` so the local repair loop sees the same errors
//! (ADR-0057). These cases are the ones the browser's own subset validator
//! could not check.

use claude::SchemaValidator;
use serde_json::json;

fn article_like_schema() -> serde_json::Value {
    json!({
        "type": "object",
        "required": ["body"],
        "additionalProperties": false,
        "properties": {
            "body": {
                "type": "array",
                "minItems": 1,
                "items": {
                    "anyOf": [
                        {
                            "type": "object",
                            "required": ["type", "markdown"],
                            "additionalProperties": false,
                            "properties": {
                                "type": { "const": "paragraph" },
                                "markdown": { "type": "string", "minLength": 1 }
                            }
                        },
                        {
                            "type": "object",
                            "required": ["type", "level", "text"],
                            "additionalProperties": false,
                            "properties": {
                                "type": { "const": "heading" },
                                "level": { "type": "integer", "minimum": 2, "maximum": 4 },
                                "text": { "type": "string", "minLength": 1 }
                            }
                        }
                    ]
                }
            }
        }
    })
}

#[test]
fn a_block_matching_one_any_of_branch_is_valid() {
    let v = SchemaValidator::new(&article_like_schema()).unwrap();
    let page = json!({"body": [
        {"type": "heading", "level": 2, "text": "Harvest"},
        {"type": "paragraph", "markdown": "The terraces above Manarola."}
    ]});
    assert_eq!(v.validate(&page), Ok(()));
}

#[test]
fn a_block_matching_no_any_of_branch_is_reported_with_its_path() {
    let v = SchemaValidator::new(&article_like_schema()).unwrap();
    // Block 1 is a heading without `text`: no branch accepts it.
    let page = json!({"body": [
        {"type": "paragraph", "markdown": "ok"},
        {"type": "heading", "level": 2}
    ]});
    let errors = v.validate(&page).unwrap_err();
    assert_eq!(errors.len(), 1, "{errors:?}");
    assert!(errors[0].starts_with("/body/1: "), "{errors:?}");
}

#[test]
fn an_unknown_block_type_is_reported() {
    let v = SchemaValidator::new(&article_like_schema()).unwrap();
    let page = json!({"body": [{"type": "gallery", "images": []}]});
    let errors = v.validate(&page).unwrap_err();
    assert!(
        errors.iter().any(|e| e.starts_with("/body/0: ")),
        "{errors:?}"
    );
}

#[test]
fn an_invalid_schema_is_an_error_not_a_pass() {
    assert!(SchemaValidator::new(&json!({"type": "no-such-type"})).is_err());
}
