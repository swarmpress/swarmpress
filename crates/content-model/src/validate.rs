//! Schema-v2 page validation with errors (reject) and warnings (advise).

use serde::Serialize;
use serde_json::Value;

use crate::blocks::CUSTOM_PREFIX;
use crate::media::{MediaRef, MEDIA_SCHEME};
use crate::registry::{SchemaRegistry, LINK_KEYS, MEDIA_KEYS};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Issue {
    /// JSON pointer into the page (`/body/3/title`).
    pub path: String,
    /// Machine-readable code: `schema`, `unknown_block`, `unregistered_custom_block`,
    /// `media_count`, `link_count`, `raw_media_url`.
    pub code: &'static str,
    pub message: String,
}

impl std::fmt::Display for Issue {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{} [{}]: {}", self.path, self.code, self.message)
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct Report {
    pub errors: Vec<Issue>,
    pub warnings: Vec<Issue>,
}

impl Report {
    pub fn is_ok(&self) -> bool {
        self.errors.is_empty()
    }

    /// Errors formatted for an agent tool result.
    pub fn error_lines(&self) -> Vec<String> {
        self.errors.iter().map(ToString::to_string).collect()
    }
}

fn err(path: String, code: &'static str, message: String) -> Issue {
    Issue {
        path,
        code,
        message,
    }
}

/// Counts media and link values in a block (recursively, by field name).
#[derive(Default)]
struct BlockScan {
    media: u32,
    raw_media_urls: u32,
    links: u32,
}

fn scan(value: &Value, key: Option<&str>, out: &mut BlockScan) {
    match value {
        Value::Object(m) => {
            if let Some(k) = key {
                if LINK_KEYS.contains(&k) && !m.is_empty() {
                    out.links += 1;
                    return;
                }
            }
            for (k, v) in m {
                scan(v, Some(k), out);
            }
        }
        Value::Array(a) => {
            for v in a {
                scan(v, key, out);
            }
        }
        Value::String(s) => match key {
            Some(k) if MEDIA_KEYS.contains(&k) => {
                out.media += 1;
                if !s.starts_with(MEDIA_SCHEME) && MediaRef::parse(s).is_ok() {
                    out.raw_media_urls += 1;
                }
            }
            Some(k) if LINK_KEYS.contains(&k) && !s.is_empty() => out.links += 1,
            _ => {}
        },
        _ => {}
    }
}

/// Validates a page against schema v2 (core + registered custom blocks).
///
/// Errors: envelope violations, unknown or unregistered block types, block
/// schema violations. Warnings: block metadata advisories (media counts,
/// link density) and legacy raw media URLs where `media:<id>` is preferred.
pub fn validate_page_v2(page: &Value, registry: &SchemaRegistry) -> Report {
    let mut report = Report::default();
    for e in registry.page_validator().iter_errors(page) {
        report
            .errors
            .push(err(e.instance_path.to_string(), "schema", e.to_string()));
    }
    let Some(body) = page.get("body").and_then(Value::as_array) else {
        return report;
    };
    let mut raw_media = 0;
    for (i, block) in body.iter().enumerate() {
        let base = format!("/body/{i}");
        let Some(t) = block.get("type").and_then(Value::as_str) else {
            continue; // envelope already reported it
        };
        let Some(schema) = registry.get(t) else {
            if t.starts_with(CUSTOM_PREFIX) {
                report.errors.push(err(
                    format!("{base}/type"),
                    "unregistered_custom_block",
                    format!("custom block `{t}` is not defined in theme/blocks/"),
                ));
            } else {
                report.errors.push(err(
                    format!("{base}/type"),
                    "unknown_block",
                    format!("unknown block type `{t}`"),
                ));
            }
            continue;
        };
        for e in schema.validator().iter_errors(block) {
            report.errors.push(err(
                format!("{base}{}", e.instance_path),
                "schema",
                format!("{t}: {e}"),
            ));
        }
        let mut s = BlockScan::default();
        scan(block, None, &mut s);
        raw_media += s.raw_media_urls;
        if let Some(media) = &schema.meta.media {
            if media.required && s.media < media.min {
                report.warnings.push(err(
                    base.clone(),
                    "media_count",
                    format!(
                        "{t} expects at least {} image(s), found {}",
                        media.min, s.media
                    ),
                ));
            } else if s.media > media.max {
                report.warnings.push(err(
                    base.clone(),
                    "media_count",
                    format!(
                        "{t} expects at most {} image(s), found {}",
                        media.max, s.media
                    ),
                ));
            }
        }
        if let Some(l) = &schema.meta.linking {
            if s.links > l.max_links {
                report.warnings.push(err(
                    base.clone(),
                    "link_count",
                    format!(
                        "{t} allows at most {} link(s), found {}",
                        l.max_links, s.links
                    ),
                ));
            }
        }
    }
    if raw_media > 0 {
        report.warnings.push(err(
            "/body".into(),
            "raw_media_url",
            format!("{raw_media} media field(s) use raw URLs/paths; prefer closed-world `media:<id>` references"),
        ));
    }
    report
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn page(body: Value) -> Value {
        json!({"id": "p", "slug": {"en": "/en/p"}, "title": {"en": "P"}, "page_type": "blog-article", "body": body})
    }

    #[test]
    fn accepts_localized_text_in_blocks() {
        let r = SchemaRegistry::core();
        let p = page(json!([
            {"type": "paragraph", "markdown": {"en": "Hello", "de": "Hallo"}},
            {"type": "heading", "level": 2, "text": "Plain"}
        ]));
        let rep = validate_page_v2(&p, &r);
        assert!(rep.is_ok(), "{:?}", rep.errors);
        assert!(
            content_schema::validate_page(&p).is_err(),
            "v1 rejects localized markdown"
        );
    }

    #[test]
    fn localized_objects_need_en_and_lang_keys() {
        let r = SchemaRegistry::core();
        let no_en = page(json!([{"type": "paragraph", "markdown": {"de": "Hallo"}}]));
        assert!(!validate_page_v2(&no_en, &r).is_ok());
        let bad_key = page(json!([{"type": "paragraph", "markdown": {"en": "x", "body": "y"}}]));
        assert!(!validate_page_v2(&bad_key, &r).is_ok());
        let empty = page(json!([{"type": "paragraph", "markdown": {"en": ""}}]));
        assert!(!validate_page_v2(&empty, &r).is_ok());
    }

    #[test]
    fn reports_unknown_and_unregistered_blocks() {
        let r = SchemaRegistry::core();
        let rep = validate_page_v2(
            &page(json!([{"type": "pricing-section"}, {"type": "x:wine-map"}])),
            &r,
        );
        let codes: Vec<_> = rep.errors.iter().map(|e| e.code).collect();
        assert_eq!(codes, vec!["unknown_block", "unregistered_custom_block"]);
        assert_eq!(rep.errors[0].path, "/body/0/type");
    }

    #[test]
    fn custom_blocks_validate_once_registered() {
        let mut r = SchemaRegistry::core();
        r.register_custom(
            "wine-map",
            json!({"type": "object", "properties": {"pins": {"type": "array"}}, "required": ["pins"]}),
        )
        .unwrap();
        assert!(validate_page_v2(&page(json!([{"type": "x:wine-map", "pins": []}])), &r).is_ok());
        let rep = validate_page_v2(&page(json!([{"type": "x:wine-map"}])), &r);
        assert_eq!(rep.errors.len(), 1);
        assert_eq!(rep.errors[0].path, "/body/0");
    }

    #[test]
    fn media_refs_and_warnings() {
        let r = SchemaRegistry::core();
        let p = page(json!([
            {"type": "image", "src": "media:riomaggiore-hero-001", "alt": "x"},
            {"type": "image", "src": "https://images.unsplash.com/photo-1", "alt": {"en": "x"}},
            {"type": "gallery", "layout": "grid", "images": [{"src": "media:a", "alt": "a"}]}
        ]));
        let rep = validate_page_v2(&p, &r);
        assert!(rep.is_ok(), "{:?}", rep.errors);
        let codes: Vec<_> = rep.warnings.iter().map(|w| w.code).collect();
        assert!(codes.contains(&"media_count"), "{codes:?}");
        assert!(codes.contains(&"raw_media_url"), "{codes:?}");
        let bad = page(json!([{"type": "image", "src": "not a ref", "alt": "x"}]));
        assert!(!validate_page_v2(&bad, &r).is_ok());
    }

    #[test]
    fn envelope_accepts_template_and_localized_seo() {
        let r = SchemaRegistry::core();
        let mut p = page(json!([]));
        p["template"] = json!("editorial");
        p["seo"] = json!({"title": {"en": "T", "de": "T"}, "description": "D"});
        p["title"] = json!("Plain title");
        assert!(validate_page_v2(&p, &r).is_ok());
        p["surprise"] = json!(1);
        assert!(!validate_page_v2(&p, &r).is_ok());
    }
}
