//! Issues: why a design, a catalogue or a room was refused.
//!
//! Every issue names its reason as a closed code, the design it is about and,
//! when it concerns an operation, the operation's path: indices from the
//! compiled design's `ops` down through `use`, `mirror` and `repeat` (so
//! `[3, 1]` is the second op of whatever the fourth top-level op expands to).
//! The codes are the vocabulary a repair loop works with (construction-kit.md
//! §7.1), so they never carry free text the caller has to parse.

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum IssueCode {
    /// The JSON does not have the design (or catalogue) shape.
    BadFormat,
    /// A parameter is unknown, missing a usable default, of the wrong type or out of bounds.
    BadParam,
    /// An integer expression does not parse, names an unknown parameter or overflows.
    BadExpression,
    /// An operation is malformed: a size below one, a turn outside 0..=3, a repeat count out of range.
    BadOp,
    /// A part id (or box material) that is not in the catalogue.
    UnknownPart,
    /// A colour id that is not in the palette.
    UnknownColour,
    /// The colour exists but the part does not come in it.
    ColourNotAllowed,
    /// `use` names a design that is not in the library.
    UnknownDesign,
    /// `use` reaches a design that is already being expanded.
    CyclicUse,
    /// `use` nests deeper than the limit.
    DepthExceeded,
    /// `use` pins a hash the library's design does not have.
    HashMismatch,
    /// Bricks outside the design's (or the used design's) declared footprint and height.
    OutsideFootprint,
    /// A part overlaps another part or bricks, or bricks are written into a part.
    Overlap,
    /// Bricks that touch neither the ground (the mount face) nor anything that does.
    Floating,
    /// Over a part, cell, write or height budget.
    OverBudget,
    /// A port that does not lie on the build, or a duplicate port id.
    BadPort,
    /// A surface name on a part without a surface face, or a duplicate surface.
    BadSurface,
    /// A declared capability tag that the geometry does not back.
    TagNotMet,
    /// The part catalogue, palette, room styles or mapping are inconsistent.
    BadCatalogue,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Issue {
    pub code: IssueCode,
    /// The design the issue is about (the used design for ops inside a `use`).
    pub design: String,
    /// Operation path from the compiled design's ops; empty when not about an op.
    pub op: Vec<u32>,
    pub message: String,
}

impl Issue {
    pub fn new(code: IssueCode, design: &str, op: &[u32], message: impl Into<String>) -> Issue {
        Issue {
            code,
            design: design.to_string(),
            op: op.to_vec(),
            message: message.into(),
        }
    }

    /// An issue about the design as a whole.
    pub fn design(code: IssueCode, design: &str, message: impl Into<String>) -> Issue {
        Issue::new(code, design, &[], message)
    }
}

impl std::fmt::Display for Issue {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let code = serde_json::to_string(&self.code).unwrap_or_default();
        write!(f, "{} {}", code.trim_matches('"'), self.design)?;
        if !self.op.is_empty() {
            let path: Vec<String> = self.op.iter().map(u32::to_string).collect();
            write!(f, " ops[{}]", path.join("]["))?;
        }
        write!(f, ": {}", self.message)
    }
}
