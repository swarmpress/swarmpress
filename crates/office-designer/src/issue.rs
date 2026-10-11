//! Issues: what the parser, the solver and the checks return. Each has a
//! closed code, the placement (and row copy) it belongs to, and a plain
//! message written for the model that will repair the plan.

use serde::{Deserialize, Serialize};

/// The closed set of issue codes.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum IssueCode {
    // parse
    /// The plan is not valid JSON in the plan's shape, or a value is outside
    /// the vocabulary (unknown design, anchor, facing, side) or its limits.
    BadPlan,
    // solve
    /// An anchor names a window, door, placement or equipment id that does not exist.
    UnknownAnchor,
    /// `placement:N` names this placement or a later one.
    ForwardReference,
    /// The relation does not make sense (a `from` that does not meet the anchor…).
    BadRelation,
    /// The placement depends on one that could not be placed.
    DependsOnFailed,
    /// A monitor or lamp anchored to something that is not a desk.
    NotADesk,
    /// The desk's screen or lamp slot is already taken.
    SlotTaken,
    /// The design may not go into this kind of room.
    WrongRoom,
    /// The row does not fit along its anchor.
    DoesNotFit,
    // checks
    /// Two items overlap or stand closer than the sim allows.
    Collision,
    /// The item (or its chair) reaches into a wall.
    IntoWall,
    /// The sim's wall clearance (centre 0.3 m, a desk's chair 0.2 m from the walls).
    WallClearance,
    /// The item stands on the table or its seats.
    BlocksTable,
    /// The item stands in a door's clear zone.
    BlocksDoor,
    /// A seat or door can no longer be reached on foot.
    Unreachable,
    /// A desk has no ceiling light or window within reach.
    NoLight,
    /// The brief asks for more than the room will have.
    RequirementMissing,
    /// The brief asks for more than the room can ever give (table seats come
    /// from the room's size): no plan can fix it.
    RoomTooSmall,
    /// The plan costs more than the brief's budget.
    OverBudget,
    /// The room would hold more items than the sim allows.
    TooManyItems,
}

impl IssueCode {
    pub fn slug(self) -> String {
        serde_json::to_value(self)
            .ok()
            .and_then(|v| v.as_str().map(str::to_owned))
            .unwrap_or_default()
    }
}

/// Errors make a plan fail; warnings describe the room as it already is
/// (the plan cannot fix them) and are never sent back for repair.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Severity {
    Error,
    Warning,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Issue {
    /// `I1`, `I2`… in the order found; stable for the same input.
    pub id: String,
    pub code: IssueCode,
    pub severity: Severity,
    /// The placement index (`placement:N`), if the issue belongs to one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub placement: Option<usize>,
    /// The copy in the placement's row (0-based), if the issue belongs to one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub copy: Option<u8>,
    pub message: String,
}

impl Issue {
    pub fn new(code: IssueCode, placement: Option<usize>, message: impl Into<String>) -> Issue {
        Issue {
            id: String::new(),
            code,
            severity: Severity::Error,
            placement,
            copy: None,
            message: message.into(),
        }
    }

    pub fn at(code: IssueCode, placement: usize, copy: u8, message: impl Into<String>) -> Issue {
        Issue {
            copy: Some(copy),
            ..Issue::new(code, Some(placement), message)
        }
    }

    pub fn warning(code: IssueCode, message: impl Into<String>) -> Issue {
        Issue {
            severity: Severity::Warning,
            ..Issue::new(code, None, message)
        }
    }

    pub fn is_error(&self) -> bool {
        self.severity == Severity::Error
    }

    /// `I3 [collision] placement 2: …` — the line the model reads.
    pub fn line(&self) -> String {
        format!("{} [{}] {}", self.id, self.code.slug(), self.message)
    }
}

/// Numbers issues `I1`, `I2`… in order.
pub(crate) fn number(issues: &mut [Issue]) {
    for (i, issue) in issues.iter_mut().enumerate() {
        issue.id = format!("I{}", i + 1);
    }
}

/// `placement 2 (desk)` or `placement 2, desk 2 of 3`.
pub(crate) fn label(placement: usize, copy: u8, count: u8, design: &str) -> String {
    if count > 1 {
        format!("placement {placement}, {design} {} of {count}", copy + 1)
    } else {
        format!("placement {placement} ({design})")
    }
}
