//! The repair loop driver (pure; the model call is the orchestrator's, the office
//! designer's pattern): after a task's markup is checked it says whether the task is done,
//! what the next `fix` call is told, or that the loop gives up and the job fails (rule 11).

use std::fmt::Write as _;

use serde::{Deserialize, Serialize};

use crate::model::{Issue, IssueCode};

/// Repair rounds after a task's first answer.
pub const MAX_REPAIR_ROUNDS: u8 = 3;

/// What the next `fix` call is about.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct RepairTask {
    /// 1 for the first repair.
    pub round: u8,
    /// The errors, in order.
    pub issues: Vec<Issue>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case", tag = "step")]
pub enum Step {
    /// No errors: the markup is kept.
    Done,
    /// Ask the model to fix the markup.
    Repair(RepairTask),
    /// Stop: the limit is reached, or nothing the model writes can fix it.
    GiveUp { reason: String, issues: Vec<Issue> },
}

/// Decides the next step after `round` repairs (0 after the first answer). Notes never
/// stop a task; a font or shape issue is the design's, not the markup's, so no repair turn
/// is spent on it.
pub fn next_step(issues: &[Issue], round: u8, max_rounds: u8) -> Step {
    let errors: Vec<Issue> = issues.iter().filter(|i| i.is_error()).cloned().collect();
    if errors.is_empty() {
        return Step::Done;
    }
    if errors
        .iter()
        .any(|i| matches!(i.code, IssueCode::Font | IssueCode::Shape))
    {
        return Step::GiveUp {
            reason:
                "the design itself does not pass (fonts or the theme's shape); no markup can fix it"
                    .into(),
            issues: errors,
        };
    }
    if round >= max_rounds {
        return Step::GiveUp {
            reason: format!("still {} issues after {round} repairs", errors.len()),
            issues: errors,
        };
    }
    Step::Repair(RepairTask {
        round: round + 1,
        issues: errors,
    })
}

impl RepairTask {
    /// The issues as the `fix` call reads them.
    pub fn prompt(&self) -> String {
        let mut s = String::from("The checker found these issues in your markup:\n");
        for i in &self.issues {
            let _ = writeln!(s, "{}", i.line());
        }
        s.push_str(
            "\nAnswer the whole markup again with every issue fixed and everything else kept.",
        );
        s
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_loop_repairs_then_gives_up() {
        let e = Issue::new(IssueCode::Token, "template index", "line 2: raw colour");
        let n = Issue::new(IssueCode::Note, "menu nav", "left out");
        assert_eq!(next_step(std::slice::from_ref(&n), 0, 3), Step::Done);
        match next_step(&[e.clone(), n], 0, 3) {
            Step::Repair(t) => {
                assert_eq!(t.round, 1);
                assert_eq!(t.issues, vec![e.clone()]);
                assert!(t
                    .prompt()
                    .contains("- [token] template index: line 2: raw colour"));
            }
            other => panic!("{other:?}"),
        }
        assert!(matches!(
            next_step(std::slice::from_ref(&e), 3, 3),
            Step::GiveUp { .. }
        ));
        let f = Issue::new(IssueCode::Font, "fonts", "unlicensed");
        assert!(matches!(next_step(&[f], 0, 3), Step::GiveUp { .. }));
    }
}
