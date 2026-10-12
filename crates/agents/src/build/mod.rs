//! The office designer's prompts (ADR-0087 decision 6, FEAT-084): the
//! `office layout` call and its `office layout fix` repair turns.
//!
//! Both are one structured call against a schema the `office-designer`
//! crate generates (`plan_schema`, `fix_schema`); the orchestrator solves and
//! checks the answer (`office_designer::evaluate`) and drives the repair loop
//! (`office_designer::next_step`). This module only renders what the model
//! reads: the CEO's words (data), the brief as lines, and the generated room
//! and catalogue docs (`office_designer::layout_context`), passed in as text
//! so this crate needs no dependency on the designer's model.

use serde_json::Value;

pub mod fake;

/// Answer budget of a layout, tokens.
pub const LAYOUT_ANSWER: u32 = 1600;
/// Answer budget of a fix, tokens.
pub const FIX_ANSWER: u32 = 1200;
/// Reasoning budget of a layout or a fix, tokens. A room is a spatial puzzle: on GPT-6-Luna
/// (2026-10-12) 3 of 20 calls spent the shared 512 on reasoning and returned no answer.
pub const LAYOUT_REASONING: u32 = 2048;
/// The CEO's words are cut to this many characters.
pub const WORDS_CHARS: usize = 800;

/// The brief's fields (`office_designer::Brief`) as the prompt names them.
pub const BRIEF_FIELDS: [(&str, &str); 6] = [
    ("workstations", "workstations"),
    ("meeting_seats", "meeting seats"),
    ("storage", "storage"),
    ("writing_surfaces", "writing surfaces"),
    ("coffee", "coffee"),
    ("plants", "plants"),
];

fn cut(s: &str, n: usize) -> String {
    let t = s.trim();
    if t.chars().count() <= n {
        t.to_string()
    } else {
        let mut out: String = t.chars().take(n).collect();
        out.push('…');
        out
    }
}

/// `€1,234.00` from cents.
fn euros(cents: i64) -> String {
    let e = cents / 100;
    let c = (cents % 100).abs();
    let digits = e.abs().to_string();
    let mut grouped = String::new();
    for (i, ch) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i).is_multiple_of(3) {
            grouped.push(',');
        }
        grouped.push(ch);
    }
    format!("{}€{grouped}.{c:02}", if cents < 0 { "-" } else { "" })
}

/// The brief as lines: `- workstations: 3`, …, `- budget: €5,000.00`.
pub fn brief_lines(brief: &Value) -> String {
    let mut out = String::from("The brief (counts include what the room already has):\n");
    for (key, words) in BRIEF_FIELDS {
        let n = brief[key].as_u64().unwrap_or(0);
        out.push_str(&format!("- {words}: {n}\n"));
    }
    match brief["max_cost_cents"].as_i64() {
        Some(c) => out.push_str(&format!("- budget: {}\n", euros(c))),
        None => out.push_str("- budget: none given\n"),
    }
    out
}

/// What the layout call works from.
#[derive(Debug, Clone, PartialEq)]
pub struct LayoutInput<'a> {
    /// The CEO's request (store text).
    pub words: &'a str,
    /// The brief (`office_designer::Brief` JSON).
    pub brief: &'a Value,
    /// `office_designer::layout_context`: the vocabulary, the room and the
    /// catalogue slice, generated.
    pub context: &'a str,
}

/// The `office layout` call's user message.
pub fn layout_prompt(input: &LayoutInput<'_>) -> String {
    let words = cut(input.words, WORDS_CHARS);
    format!(
        "## Task: office layout\n\nThe CEO asked: «{}»\n\n{}\n{}\n\nAnswer the plan as JSON {{\"placements\": [...]}}.",
        if words.is_empty() { "furnish this room" } else { words.as_str() },
        brief_lines(input.brief),
        input.context.trim()
    )
}

/// The `office layout fix` call's user message: the room and catalogue
/// again (the call stands alone), the plan as it is, and the repair task's
/// text (`office_designer::RepairTask::prompt`).
pub fn fix_prompt(brief: &Value, context: &str, plan_json: &str, task: &str) -> String {
    format!(
        "## Task: office layout fix\n\n{}\n{}\n\nThe plan:\n{}\n\n{}",
        brief_lines(brief),
        context.trim(),
        plan_json,
        task.trim()
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn prompts_carry_the_brief_and_the_task() {
        let brief = json!({"workstations": 3, "plants": 1, "max_cost_cents": 500000});
        let p = layout_prompt(&LayoutInput {
            words: "Three desks by the window, please.",
            brief: &brief,
            context: "The room:\nNewsroom, 6 m × 6 m.",
        });
        assert!(p.starts_with("## Task: office layout\n"));
        assert!(p.contains("- workstations: 3\n"));
        assert!(p.contains("- meeting seats: 0\n"));
        assert!(p.contains("- budget: €5,000.00"));
        assert!(p.contains("«Three desks by the window, please.»"));
        let f = fix_prompt(
            &brief,
            "The room:",
            "{\"placements\":[]}",
            "The plan has these issues:",
        );
        assert!(f.starts_with("## Task: office layout fix\n"));
        assert_eq!(euros(12_345_678), "€123,456.78");
    }
}
