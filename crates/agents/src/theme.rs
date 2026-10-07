//! Theme code from the blueprint (FEAT-094, ADR-0072 design §6, §9): the
//! model side of the Web Developer's `ThemeCode` job, one call per missing
//! component. What the blocks lack and what a component must pass are
//! `blueprint::theme` (the server checks the same).

use serde_json::{json, Value};

/// Largest component, bytes (`blueprint::theme::MAX_COMPONENT_BYTES`).
pub const MAX_COMPONENT_BYTES: usize = 16 * 1024;
/// The answer budget of one component, tokens.
pub const COMPONENT_ANSWER: u32 = 4000;

/// The answer's shape: the component's source and a one-line note.
pub fn component_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["component", "note"],
        "properties": {
            "component": { "type": "string", "minLength": 40, "maxLength": MAX_COMPONENT_BYTES },
            "note": { "type": "string", "maxLength": 300 }
        }
    })
}

/// The user prompt for one block's component.
pub fn component_prompt(
    block: &str,
    block_doc: &str,
    intent: &str,
    tokens: &[(String, String)],
    keywords: &[String],
) -> String {
    let toks = if tokens.is_empty() {
        "(none: use neutral CSS)".to_string()
    } else {
        tokens
            .iter()
            .map(|(k, v)| format!("{k}: {v}"))
            .collect::<Vec<_>>()
            .join("\n")
    };
    format!(
        "## Task: theme component\n\nWrite the Astro component that renders the `{block}` block for this site's theme.\n\n\
         Block schema and meaning:\n{block_doc}\n\n\
         Its narrative intent: {intent}. Design keywords: {kw}.\n\
         Theme tokens (use them as CSS variables, var(--name)):\n{toks}\n\n\
         Rules:\n\
         - Start with a frontmatter block (---) that reads the block from `Astro.props` (`const {{ block, ctx }} = Astro.props`).\n\
         - Localized fields go through `ctx.l(...)`, media through `ctx.media(...)`, links through `ctx.href(...)`.\n\
         - Scoped <style> only; no <script>, no set:html, no is:inline, no fetch, no external URLs.\n\
         - Imports only from '@swarm-press/site-kit' or relative to the theme.\n\
         - Semantic, accessible HTML. Answer with {{\"component\", \"note\"}}.",
        kw = if keywords.is_empty() { "none".into() } else { keywords.join(", ") },
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_prompt_names_the_block_its_intent_and_the_tokens() {
        let p = component_prompt(
            "hero-section",
            "title: LocalizedString",
            "orient",
            &[("--color-accent".into(), "#c4281c".into())],
            &["editorial".into()],
        );
        assert!(
            p.contains("`hero-section`")
                && p.contains("orient")
                && p.contains("--color-accent: #c4281c")
                && p.contains("editorial")
        );
        assert_eq!(component_schema()["required"], json!(["component", "note"]));
    }
}
