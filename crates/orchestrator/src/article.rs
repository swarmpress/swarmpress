//! The MVP article: its block subset, writer docs, validator and helpers.

use std::sync::Arc;

use agents::pipeline::PageValidator;
use agents::prompts::SiteContext;
use serde_json::{json, Value};

/// The block subset writers use in the MVP. Every block here is a core block
/// of the canonical page schema, so pages validate against content-schema.
pub fn article_schema() -> Value {
    let text = json!({"type": "string", "minLength": 1});
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["id", "slug", "title", "page_type", "seo", "body"],
        "properties": {
            "id": text,
            "slug": {"type": "object", "additionalProperties": false, "required": ["en"], "properties": {"en": text}},
            "title": {"type": "object", "additionalProperties": false, "required": ["en"], "properties": {"en": text}},
            "page_type": {"type": "string", "enum": ["blog-article"]},
            "seo": {"type": "object", "additionalProperties": false, "required": ["title", "description"],
                    "properties": {"title": text, "description": text}},
            "body": {"type": "array", "minItems": 3, "items": {"anyOf": [
                {"type": "object", "additionalProperties": false, "required": ["type", "markdown"],
                 "properties": {"type": {"const": "paragraph"}, "markdown": text}},
                {"type": "object", "additionalProperties": false, "required": ["type", "level", "text"],
                 "properties": {"type": {"const": "heading"}, "level": {"type": "integer", "enum": [2, 3, 4]}, "text": text}},
                {"type": "object", "additionalProperties": false, "required": ["type", "text"],
                 "properties": {"type": {"const": "quote"}, "text": text, "attribution": {"type": "string"}}},
                {"type": "object", "additionalProperties": false, "required": ["type", "ordered", "items"],
                 "properties": {"type": {"const": "list"}, "ordered": {"type": "boolean"},
                                "items": {"type": "array", "minItems": 1, "items": text}}},
                {"type": "object", "additionalProperties": false, "required": ["type", "style", "content"],
                 "properties": {"type": {"const": "callout"}, "style": {"type": "string", "enum": ["info", "warning", "success", "error"]},
                                "title": {"type": "string"}, "content": text}},
                {"type": "object", "additionalProperties": false, "required": ["type", "items"],
                 "properties": {"type": {"const": "faq"}, "items": {"type": "array", "minItems": 1, "items": {
                     "type": "object", "additionalProperties": false, "required": ["question", "answer"],
                     "properties": {"question": text, "answer": text}}}}}
            ]}}
        }
    })
}

/// Writer-facing docs for [`article_schema`] (generated docs for the full
/// catalogue come with the site-kit, ADR-0014).
pub const ARTICLE_BLOCK_DOCS: &str = "\
- `paragraph` { markdown }: one idea per paragraph; plain text with **bold**/_italic_ only.
- `heading` { level: 2|3|4, text }: sentence-case section headings.
- `quote` { text, attribution? }: only real, attributable quotes from the material you were given.
- `list` { ordered, items[] }: practical steps or options.
- `callout` { style: info|warning|success|error, title?, content }: tips, warnings, closures.
- `faq` { items[{ question, answer }] }: reader questions with short, true answers.
The page is { id, slug: { en: \"/en/blog/<slug>\" }, title: { en }, page_type: \"blog-article\", seo: { title, description }, body: [blocks] }.";

/// A validator that checks the canonical schema and then the site's house
/// style (banned phrases); errors go back to the writer verbatim.
pub fn site_validator(context: &SiteContext) -> Arc<dyn PageValidator> {
    let style = context.style_guide.clone();
    Arc::new(move |page: &Value| -> Result<(), Vec<String>> {
        content_schema::validate_page(page)?;
        style.validate(page)
    })
}

/// URL-safe slug: lowercase ASCII, Italian accents folded, dashes between
/// words, at most 80 characters.
pub fn slugify(title: &str) -> String {
    let mut out = String::new();
    let mut dash = false;
    for c in title.chars().flat_map(|c| c.to_lowercase()) {
        let c = match c {
            'à' | 'á' | 'â' | 'ä' => 'a',
            'è' | 'é' | 'ê' | 'ë' => 'e',
            'ì' | 'í' | 'î' | 'ï' => 'i',
            'ò' | 'ó' | 'ô' | 'ö' => 'o',
            'ù' | 'ú' | 'û' | 'ü' => 'u',
            c => c,
        };
        if c.is_ascii_alphanumeric() {
            out.push(c);
            dash = false;
        } else if !dash && !out.is_empty() {
            out.push('-');
            dash = true;
        }
    }
    let out = out.trim_end_matches('-');
    out.chars()
        .take(80)
        .collect::<String>()
        .trim_end_matches('-')
        .to_string()
}

/// Stable id for the `index`th brief of standup `job_id`. Positive as an i64
/// so SQL `INTEGER`/`BIGINT` columns can hold it.
pub fn brief_ref_for(company: &str, job_id: u64, index: usize) -> u64 {
    let mut buf = Vec::with_capacity(company.len() + 17);
    buf.extend_from_slice(company.as_bytes());
    buf.push(0);
    buf.extend_from_slice(&job_id.to_le_bytes());
    buf.extend_from_slice(&(index as u64).to_le_bytes());
    xxhash_rust::xxh3::xxh3_64(&buf) & (i64::MAX as u64)
}

fn page_text(page: &Value) -> String {
    fn walk(v: &Value, out: &mut String) {
        match v {
            Value::String(s) => {
                out.push_str(s);
                out.push(' ');
            }
            Value::Array(a) => a.iter().for_each(|x| walk(x, out)),
            Value::Object(o) => o
                .iter()
                .filter(|(k, _)| k.as_str() != "type")
                .for_each(|(_, x)| walk(x, out)),
            _ => {}
        }
    }
    let mut out = String::new();
    if let Some(body) = page.get("body") {
        walk(body, &mut out);
    }
    out
}

/// Words in the page body (block `type` tags excluded).
pub fn word_count(page: &Value) -> u32 {
    u32::try_from(page_text(page).split_whitespace().count()).unwrap_or(u32::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugs_are_url_safe() {
        assert_eq!(
            slugify("Harvest week in Manarola!"),
            "harvest-week-in-manarola"
        );
        assert_eq!(slugify("Più vino, più città"), "piu-vino-piu-citta");
        assert_eq!(slugify("  --  "), "");
    }

    #[test]
    fn brief_refs_are_stable_positive_and_distinct() {
        let a = brief_ref_for("c", 7, 0);
        assert_eq!(a, brief_ref_for("c", 7, 0));
        assert_ne!(a, brief_ref_for("c", 7, 1));
        assert_ne!(a, brief_ref_for("d", 7, 0));
        assert!(a <= i64::MAX as u64);
    }

    #[test]
    fn article_schema_pages_pass_the_canonical_schema() {
        let page = json!({
            "id": "content-1", "slug": {"en": "/en/blog/x"}, "title": {"en": "X"},
            "page_type": "blog-article", "seo": {"title": "X", "description": "d"},
            "body": [
                {"type": "heading", "level": 2, "text": "Setting out"},
                {"type": "paragraph", "markdown": "We left Monterosso early."},
                {"type": "faq", "items": [{"question": "Is it steep?", "answer": "Yes."}]}
            ]
        });
        let validator = jsonschema::validator_for(&article_schema()).unwrap();
        assert!(validator.is_valid(&page));
        content_schema::validate_page(&page).unwrap();
        assert_eq!(word_count(&page), 10);
    }
}
