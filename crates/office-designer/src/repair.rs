//! The repair loop driver (pure; the model call is the orchestrator's,
//! ADR-0058's pattern): after an evaluation it says whether the plan is done,
//! which placements the next `fix#i` call may change and with which issue
//! texts, or that the loop gives up. The model's answer is a [`PlanFix`],
//! applied only if it touches nothing but the named placements.

use std::collections::BTreeSet;
use std::fmt::Write as _;

use serde::{Deserialize, Serialize};

use crate::check::Evaluation;
use crate::issue::{number, Issue, IssueCode};
use crate::model::MAX_PLACEMENTS;
use crate::plan::{parse_placement, Anchor, Placement, Plan};

/// Repair rounds after the first layout (the article pipeline's limit).
pub const MAX_REPAIR_ROUNDS: u8 = 3;

/// What the next `fix#i` call is about.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct RepairTask {
    /// 1 for the first repair.
    pub round: u8,
    /// Placement indices the model may replace or remove, ascending.
    pub fix: Vec<usize>,
    /// The errors, in order (each with its id and placement).
    pub issues: Vec<Issue>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case", tag = "step")]
pub enum Step {
    /// No errors: the plan goes to the preview.
    Done,
    /// Ask the model to fix the named placements.
    Repair(RepairTask),
    /// Stop: the repair limit is reached or no plan can fix the issues.
    /// The orchestrator blocks the job with a ticket.
    GiveUp { reason: String, issues: Vec<Issue> },
}

/// Decides the next step after `round` repairs (0 after the first layout).
pub fn next_step(eval: &Evaluation, round: u8, max_rounds: u8) -> Step {
    let errors: Vec<Issue> = eval.errors().cloned().collect();
    if errors.is_empty() {
        return Step::Done;
    }
    if errors.iter().any(|i| i.code == IssueCode::RoomTooSmall) {
        return Step::GiveUp {
            reason: "the brief asks for more than this room can hold".into(),
            issues: errors,
        };
    }
    if round >= max_rounds {
        return Step::GiveUp {
            reason: format!("still {} issues after {round} repairs", errors.len()),
            issues: errors,
        };
    }
    let fix: BTreeSet<usize> = errors.iter().filter_map(|i| i.placement).collect();
    Step::Repair(RepairTask {
        round: round + 1,
        fix: fix.into_iter().collect(),
        issues: errors,
    })
}

impl RepairTask {
    /// The text of the `fix#i` call: the named placements as they are, the
    /// issues, and what the answer may change.
    pub fn prompt(&self, plan: &Plan) -> String {
        let mut s = String::from("The plan has these issues:\n");
        for i in &self.issues {
            let _ = writeln!(s, "{}", i.line());
        }
        if self.fix.is_empty() {
            s.push_str("\nNo placement is at fault; add placements to meet the brief.\n");
        } else {
            s.push_str("\nPlacements to fix (change only these):\n");
            for ix in &self.fix {
                if let Some(p) = plan.placements.get(*ix) {
                    let _ = writeln!(s, "{ix}: {}", serde_json::to_string(p).unwrap_or_default());
                }
            }
        }
        s.push_str(
            "\nAnswer {\"replace\": [{\"index\": N, \"placement\": {...}}], \"remove\": [N], \"add\": [{...}]}. \
Replace or remove only the placements listed; add new ones at the end if the brief needs them. \
Indices in added placements count after removals.",
        );
        s
    }
}

/// One replaced placement.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Replace {
    pub index: usize,
    pub placement: Placement,
}

/// The model's answer to a repair task.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PlanFix {
    #[serde(default)]
    pub replace: Vec<Replace>,
    #[serde(default)]
    pub remove: Vec<usize>,
    #[serde(default)]
    pub add: Vec<Placement>,
}

impl PlanFix {
    /// Parses the model's answer; every bad placement comes back at once.
    pub fn from_json(text: &str) -> Result<PlanFix, Vec<Issue>> {
        let bad = |m: String| vec![Issue::new(IssueCode::BadPlan, None, m)];
        let v: serde_json::Value = serde_json::from_str(text)
            .map_err(|e| bad(format!("the fix is not valid JSON: {e}")))?;
        let obj = v
            .as_object()
            .ok_or_else(|| bad("the fix is an object {\"replace\", \"remove\", \"add\"}".into()))?;
        if let Some(k) = obj
            .keys()
            .find(|k| !matches!(k.as_str(), "replace" | "remove" | "add"))
        {
            return Err(bad(format!(
                "unknown field \"{k}\"; a fix has replace, remove and add"
            )));
        }
        let mut issues = Vec::new();
        let mut fix = PlanFix::default();
        let list = |k: &str| {
            obj.get(k)
                .and_then(|x| x.as_array())
                .cloned()
                .unwrap_or_default()
        };
        for r in list("replace") {
            let index = r.get("index").and_then(serde_json::Value::as_u64);
            match (index, r.get("placement")) {
                (Some(index), Some(p)) => {
                    let index = usize::try_from(index).unwrap_or(usize::MAX);
                    match parse_placement(p, index) {
                        Ok(p) => {
                            issues.extend(p.limits(index));
                            fix.replace.push(Replace {
                                index,
                                placement: p,
                            });
                        }
                        Err(i) => issues.push(i),
                    }
                }
                _ => issues.extend(bad(
                    "each replace entry is {\"index\": N, \"placement\": {...}}".into(),
                )),
            }
        }
        for r in list("remove") {
            match r.as_u64().and_then(|n| usize::try_from(n).ok()) {
                Some(n) => fix.remove.push(n),
                None => issues.extend(bad("remove lists placement indices".into())),
            }
        }
        for (k, p) in list("add").iter().enumerate() {
            match parse_placement(p, k) {
                Ok(p) => fix.add.push(p),
                Err(mut i) => {
                    i.placement = None;
                    i.message = format!("added {}", i.message);
                    issues.push(i);
                }
            }
        }
        if issues.is_empty() {
            Ok(fix)
        } else {
            number(&mut issues);
            Err(issues)
        }
    }
}

fn renumber(a: &Anchor, map: &[Option<usize>]) -> Result<Anchor, usize> {
    match a {
        Anchor::Placement(j) => match map.get(*j) {
            Some(Some(n)) => Ok(Anchor::Placement(*n)),
            Some(None) => Err(*j),
            // a forward or unknown reference stays; the solver reports it
            None => Ok(a.clone()),
        },
        other => Ok(other.clone()),
    }
}

/// Applies a fix: only the task's placements may be replaced or removed;
/// removals renumber later references; additions go at the end.
pub fn apply_fix(plan: &Plan, task: &RepairTask, fix: &PlanFix) -> Result<Plan, Vec<Issue>> {
    let allowed: BTreeSet<usize> = task.fix.iter().copied().collect();
    let names = || {
        if task.fix.is_empty() {
            "none".to_string()
        } else {
            task.fix
                .iter()
                .map(ToString::to_string)
                .collect::<Vec<_>>()
                .join(", ")
        }
    };
    let mut issues = Vec::new();
    let mut touched = BTreeSet::new();
    for ix in fix
        .replace
        .iter()
        .map(|r| r.index)
        .chain(fix.remove.iter().copied())
    {
        if !allowed.contains(&ix) {
            issues.push(Issue::new(
                IssueCode::BadPlan,
                Some(ix),
                format!(
                    "placement {ix} was not named for repair; change only placements {}",
                    names()
                ),
            ));
        } else if !touched.insert(ix) {
            issues.push(Issue::new(
                IssueCode::BadPlan,
                Some(ix),
                format!("placement {ix} is changed twice; replace or remove it once"),
            ));
        }
    }
    let mut placements = plan.placements.clone();
    for r in &fix.replace {
        if let Some(slot) = placements.get_mut(r.index) {
            *slot = r.placement.clone();
        }
    }
    let removed: BTreeSet<usize> = fix.remove.iter().copied().collect();
    let mut map = Vec::with_capacity(placements.len());
    let mut next = 0;
    for i in 0..placements.len() {
        if removed.contains(&i) {
            map.push(None);
        } else {
            map.push(Some(next));
            next += 1;
        }
    }
    let mut kept = Vec::new();
    for (i, p) in placements.into_iter().enumerate() {
        if removed.contains(&i) {
            continue;
        }
        let mut p = p;
        for a in [Some(&mut p.anchor), p.from.as_mut()].into_iter().flatten() {
            match renumber(a, &map) {
                Ok(n) => *a = n,
                Err(j) => issues.push(Issue::new(
                    IssueCode::BadPlan,
                    Some(i),
                    format!("placement {i} refers to placement {j}, which this fix removes"),
                )),
            }
        }
        kept.push(p);
    }
    kept.extend(fix.add.iter().cloned());
    if kept.len() > MAX_PLACEMENTS {
        issues.push(Issue::new(
            IssueCode::BadPlan,
            None,
            format!("at most {MAX_PLACEMENTS} placements in a plan"),
        ));
    }
    if issues.is_empty() {
        Ok(Plan { placements: kept })
    } else {
        number(&mut issues);
        Err(issues)
    }
}
