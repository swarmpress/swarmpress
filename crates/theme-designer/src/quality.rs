//! The QA stage's design classes in the web designer's repair loop (ADR-0094 decision 4): a class
//! (one rule broken on one page type) is repaired in the template that renders the type, with the
//! class's evidence as the repair message. Pure: the model call is the orchestrator's.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use site_quality::{Cluster, Standard};

use crate::model::TaskKind;
use crate::plan::ThemePlan;

/// QA repair rounds after the first audit.
pub const MAX_QA_ROUNDS: u8 = 2;

/// What one template is told to repair.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct QualityFix {
    /// The task's label (`template archive-activity`).
    pub task: String,
    /// The classes, as `rule on page type`.
    pub classes: Vec<String>,
    /// The repair message: the classes' evidence.
    pub message: String,
}

/// The templates a page type may come from, most specific first (WordPress's hierarchy).
pub fn candidates(page_type: &str) -> Vec<String> {
    let mut out = vec![page_type.to_string()];
    match page_type {
        "front-page" => out.extend(["home".to_string(), "index".to_string()]),
        "page" => out.push("index".into()),
        "single" => out.push("index".into()),
        t if t.starts_with("single-") => out.extend(["single".to_string(), "index".to_string()]),
        t if t.starts_with("archive-") || matches!(t, "category" | "tag" | "author" | "search") => {
            out.extend(["archive".to_string(), "index".to_string()]);
        }
        t if t.starts_with("page-") => out.extend(["page".to_string(), "index".to_string()]),
        _ => out.push("index".into()),
    }
    out
}

/// The template task of the plan that renders `page_type`, if any.
pub fn owner(plan: &ThemePlan, page_type: &str) -> Option<String> {
    candidates(page_type).into_iter().find_map(|slug| {
        plan.tasks
            .iter()
            .find(|t| t.kind == TaskKind::Template && t.slug == slug)
            .map(|t| t.label())
    })
}

/// The design classes as repairs, one per template (classes of page types no template of the plan
/// renders are left out: they are not the theme's).
pub fn repairs(classes: &[Cluster], plan: &ThemePlan, std: &Standard) -> Vec<QualityFix> {
    let mut by: BTreeMap<String, Vec<&Cluster>> = BTreeMap::new();
    for c in classes {
        if let Some(task) = owner(plan, &c.page_type) {
            by.entry(task).or_default().push(c);
        }
    }
    by.into_iter()
        .map(|(task, cs)| {
            let mut message = format!(
                "The site's QA stage ({} v{}) rendered every page made from this template at 1280 and 390 px. These rules fail; each class is one rule on one page type:\n\n",
                std.id, std.version
            );
            for c in &cs {
                message.push_str(&c.evidence(std));
                message.push('\n');
            }
            message.push_str(
                "Change the template so every page of these types passes; keep the sections, parts, menus and everything else the checks ask for. Answer the whole markup again.",
            );
            QualityFix {
                task,
                classes: cs
                    .iter()
                    .map(|c| format!("{} on {}", c.rule, c.page_type))
                    .collect(),
                message,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn page_types_fall_back_through_the_hierarchy() {
        assert_eq!(
            candidates("archive-activity"),
            vec!["archive-activity", "archive", "index"]
        );
        assert_eq!(candidates("tag"), vec!["tag", "archive", "index"]);
        assert_eq!(
            candidates("page-village"),
            vec!["page-village", "page", "index"]
        );
        assert_eq!(
            candidates("front-page"),
            vec!["front-page", "home", "index"]
        );
    }
}
