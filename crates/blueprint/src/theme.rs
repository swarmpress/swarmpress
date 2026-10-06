//! Theme code from the blueprint (FEAT-094, ADR-0072 design §6, §9): what the
//! server and the orchestrator check of a model-written theme component.
//!
//! * [`missing_renderers`]: the blocks the blueprint's page types use that
//!   the theme has no renderer of its own for (a core block without
//!   `theme/blocks/<type>.astro`, a site block without
//!   `theme/blocks/<name>/Component.astro`). Core blocks still render with the
//!   site kit's neutral fallback; a site block has none, so it is required.
//! * [`check_component`]: what a component must be before it is committed:
//!   an Astro component that reads its block from `Astro.props`, with no
//!   script, no raw HTML injection, no network access and no import outside
//!   the site kit and the theme. The site CI's theme gate (FEAT-045) checks
//!   the rest (`kit check`, screenshots).
//!
//! The prompt and the answer's schema are the agents crate's (`agents::theme`).

use std::collections::BTreeSet;

use crate::format::Blueprint;

/// Largest component, bytes.
pub const MAX_COMPONENT_BYTES: usize = 16 * 1024;
/// Components one job writes at most (the rest wait for the next job).
pub const MAX_COMPONENTS_PER_JOB: usize = 4;

/// Repo path of a block's renderer in the theme.
pub fn renderer_path(block: &str) -> String {
    match block.strip_prefix("x:") {
        Some(name) => format!("theme/blocks/{name}/Component.astro"),
        None => format!("theme/blocks/{block}.astro"),
    }
}

/// The block a renderer path is for, if it is one.
pub fn block_of_path(path: &str) -> Option<String> {
    let rest = path.strip_prefix("theme/blocks/")?;
    if let Some(name) = rest.strip_suffix("/Component.astro") {
        return (!name.contains('/') && crate::issue::valid_id(name)).then(|| format!("x:{name}"));
    }
    let t = rest.strip_suffix(".astro")?;
    (!t.contains('/') && content_model::is_core_block(t)).then(|| t.to_string())
}

/// Blocks the page types and globals use (in first-use order) that the theme has no renderer for.
pub fn missing_renderers(bp: &Blueprint, theme_files: &BTreeSet<String>) -> Vec<String> {
    let mut seen = BTreeSet::new();
    let mut out = Vec::new();
    let globals = bp.globals.values().map(|g| g.block.as_str());
    let slots = bp
        .page_types
        .iter()
        .flat_map(|t| t.slots.iter().flatten())
        .flat_map(|s| s.blocks.iter().map(String::as_str));
    for b in globals.chain(slots) {
        if seen.insert(b.to_string()) && !theme_files.contains(&renderer_path(b)) {
            out.push(b.to_string());
        }
    }
    out
}

/// What a model-written component must be before it is committed. `Err`
/// lists every problem, as text for the repair turn.
pub fn check_component(src: &str) -> Result<(), Vec<String>> {
    let mut why = Vec::new();
    if src.len() > MAX_COMPONENT_BYTES {
        why.push(format!("the component is over {MAX_COMPONENT_BYTES} bytes"));
    }
    let trimmed = src.trim_start();
    let front = trimmed
        .strip_prefix("---")
        .and_then(|rest| rest.find("\n---").map(|end| &rest[..end]));
    match front {
        None => why.push("start with a frontmatter block between --- lines".into()),
        Some(fm) => {
            if !fm.contains("Astro.props") {
                why.push("read the block from Astro.props in the frontmatter".into());
            }
            for line in fm
                .lines()
                .map(str::trim)
                .filter(|l| l.starts_with("import "))
            {
                let from = line.rsplit(['\'', '"']).nth(1).unwrap_or_default();
                let ok = from == "@swarm-press/site-kit"
                    || from.starts_with("@swarm-press/site-kit/")
                    || from.starts_with("./")
                    || from.starts_with("../");
                if !ok {
                    why.push(format!(
                        "import only from the site kit or the theme, not {from:?}"
                    ));
                }
            }
        }
    }
    let lower = src.to_ascii_lowercase();
    for (needle, message) in [
        ("<script", "no <script>: a block renders HTML and CSS only"),
        (
            "set:html",
            "no set:html: text goes through ctx.l and is escaped",
        ),
        ("is:inline", "no is:inline"),
        (
            "fetch(",
            "no fetch: data comes from the page and ctx.toolData",
        ),
        ("http://", "no external URLs"),
        ("https://", "no external URLs"),
        ("javascript:", "no javascript: URLs"),
        ("<iframe", "no <iframe>"),
        ("eval(", "no eval"),
    ] {
        if lower.contains(needle) {
            why.push(message.into());
        }
    }
    if why.is_empty() {
        Ok(())
    } else {
        Err(why)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const GOOD: &str = r#"---
import { Picture } from '@swarm-press/site-kit/components'
const { block, ctx } = Astro.props
---
<section class="hero">
  <h1>{ctx.l(block.title)}</h1>
</section>
<style>
  .hero { color: var(--color-accent); }
</style>
"#;

    #[test]
    fn missing_renderers_are_the_blocks_the_theme_lacks() {
        let bp = Blueprint::from_value(&json!({
            "format": "swarmpress.blueprint.v1",
            "globals": { "header": { "block": "x:site-header" } },
            "page_types": [
                { "id": "home", "label": { "en": "Home" }, "source": { "kind": "page" },
                  "slots": [{ "id": "a", "blocks": ["hero-section"] }, { "id": "b", "blocks": ["latest-stories", "paragraph"] }] },
                { "id": "about", "label": { "en": "About" }, "source": { "kind": "page" }, "slots": [{ "id": "a", "blocks": ["paragraph"] }] }
            ]
        }))
        .unwrap();
        let theme: BTreeSet<String> = ["theme/blocks/paragraph.astro".to_string()].into();
        assert_eq!(
            missing_renderers(&bp, &theme),
            ["x:site-header", "hero-section", "latest-stories"]
        );
        assert_eq!(
            renderer_path("x:site-header"),
            "theme/blocks/site-header/Component.astro"
        );
        assert_eq!(
            block_of_path("theme/blocks/site-header/Component.astro").as_deref(),
            Some("x:site-header")
        );
        assert_eq!(
            block_of_path("theme/blocks/hero-section.astro").as_deref(),
            Some("hero-section")
        );
        assert_eq!(block_of_path("theme/blocks/nope.astro"), None);
        assert_eq!(block_of_path("theme/layouts/Base.astro"), None);
    }

    #[test]
    fn a_component_is_checked_before_it_is_committed() {
        assert_eq!(check_component(GOOD), Ok(()));
        let bad = GOOD.replace("<h1>", "<script>alert(1)</script><h1 set:html={x}>");
        let why = check_component(&bad).unwrap_err();
        assert!(
            why.iter().any(|w| w.contains("<script>"))
                && why.iter().any(|w| w.contains("set:html")),
            "{why:?}"
        );
        assert!(check_component("<div>no frontmatter</div>").is_err());
        let foreign = GOOD.replace("@swarm-press/site-kit/components", "left-pad");
        assert!(check_component(&foreign).unwrap_err()[0].contains("left-pad"));
        assert!(
            check_component(&GOOD.replace("var(--color-accent)", "url(https://evil.example)"))
                .is_err()
        );
        let no_props = GOOD.replace("const { block, ctx } = Astro.props", "const x = 1");
        assert!(check_component(&no_props).is_err());
    }
}
