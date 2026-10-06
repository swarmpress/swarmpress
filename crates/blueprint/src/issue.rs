//! Issues: why a blueprint or a tool graph was refused.
//!
//! Like the kit's issues (`kit::IssueCode`), every issue carries a closed
//! code and a path, so a repair loop can act on it without parsing text; the
//! message is for people and models.

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum IssueCode {
    /// The JSON does not have the format's shape.
    BadFormat,
    /// An id is not lower-case kebab, or is declared twice.
    BadId,
    /// A block type that is neither a core block nor one of the site's custom blocks.
    UnknownBlock,
    /// A page type, slot, global or collection id that is not declared.
    UnknownRef,
    /// A type name that is neither built in nor declared.
    UnknownType,
    /// A type definition outside the restricted schema subset.
    BadType,
    /// A producer's type does not fit its consumer's.
    TypeMismatch,
    /// A slot or page type that breaks the page-type rules (overlapping slots, min above max).
    BadSlot,
    /// A route pattern without `{slug}` or not starting with `/`.
    BadRoute,
    /// A tool id that is not declared.
    UnknownTool,
    /// A port that the node (or tool) does not have.
    UnknownPort,
    /// A context path outside the closed context (`page.*`, `item.*`, `site.*`).
    BadContextPath,
    /// A node's configuration is malformed (a missing URL, an unknown op).
    BadNode,
    /// The graph has a cycle, an unconnected input or an unreachable output.
    BadGraph,
    /// A connector reaches an origin that is not a literal `https://` origin.
    BadOrigin,
    /// A step that cannot run (an imported node with no equivalent): it blocks the tool.
    Sealed,
    /// Over a size limit (nodes, slots, page types).
    OverBudget,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Issue {
    pub code: IssueCode,
    /// JSON-pointer-like path into the document (`/page_types/2/slots/0`).
    pub path: String,
    pub message: String,
}

impl Issue {
    pub fn new(code: IssueCode, path: impl Into<String>, message: impl Into<String>) -> Issue {
        Issue {
            code,
            path: path.into(),
            message: message.into(),
        }
    }
}

impl std::fmt::Display for Issue {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.path, self.message)
    }
}

/// Lower-case kebab ids, 1 to 64 bytes.
pub fn valid_id(s: &str) -> bool {
    kit::design::valid_id(s)
}
