//! The QA stage in the orchestrator (ADR-0094, FEAT-116): what the gate decided about a release,
//! as the job keeps it (text in the store, rule 2), and the routing of content classes to the
//! roles that own them.
//!
//! ```text
//! Gateway::site_audit(branch, head, round) ─► Option<QaReport> (None: this executor cannot audit)
//!   site_quality::route ─► design classes  → the web designer's repair loop (site_theme)
//!                       ─► content classes → route_content: a typed work order per role
//!                            photo-editor │ researcher │ editor │ seo  (ADR-0094 step 4)
//!                            none of them is on the staff yet: Unstaffed, the gate stays shut
//!                       ─► platform classes → swarm.press's own defects (never a staff repair)
//! gate passed ─► Outcome::SiteQuality{digest} and the job goes on
//! gate shut after MAX_QA_ROUNDS ─► Outcome::SiteQuality{digest}, JobFailed{QualityGate}
//! ```

use serde::{Deserialize, Serialize};
use site_quality::{Gate, QaDigest, QaReport, Route, Routing, Standard, StandardRef, WorkOrder};

use crate::{Outcome, QualityOut};

/// What became of a content class's work order.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case", tag = "status")]
pub enum Routed {
    /// No one on the staff holds the role (ADR-0094 step 4 brings the photo editor, the
    /// researcher and the SEO role; the editor's QA repairs come with them). The release stays
    /// blocked: a class nobody can repair never passes.
    Unstaffed { role: Route },
}

/// A content class handed on, and what became of it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct RoutedWork {
    pub order: WorkOrder,
    pub routed: Routed,
}

/// The hook for content roles, typed by role (ADR-0094 decision 4): pictures, alt sources and
/// empty frames in authored content to the photo editor, videos and media gaps to the
/// researcher, copy and its links to the editor, meta and internal links to the SEO role. Step 4
/// replaces the arms with work items through the draft and review pipeline; until then every
/// order is `Unstaffed` and fails loudly (rule 11).
pub fn route_content(orders: &[WorkOrder]) -> Vec<RoutedWork> {
    orders
        .iter()
        .map(|o| RoutedWork {
            order: o.clone(),
            routed: match o.role {
                Route::PhotoEditor | Route::Researcher | Route::Editor | Route::Seo => {
                    Routed::Unstaffed { role: o.role }
                }
                // Not content: `site_quality::route` never hands these here.
                Route::WebDesigner | Route::Platform => Routed::Unstaffed { role: o.role },
            },
        })
        .collect()
}

/// The QA stage as the job keeps it (the report itself is a note on the audited commit).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct QaRecord {
    pub standard: StandardRef,
    pub branch: String,
    /// The commit the report is about.
    pub commit: String,
    pub digest: QaDigest,
    pub gate: Gate,
    /// One line for the CEO.
    pub line: String,
    /// QA repair rounds the web designer took.
    pub rounds: u8,
    /// The classes its repairs were about (`rule on page type`).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub repaired: Vec<String>,
    /// Open design classes (`rule on page type`), after the rounds.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub design: Vec<String>,
    /// Open platform classes.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub platform: Vec<String>,
    /// Content classes and what became of them.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub content: Vec<RoutedWork>,
}

impl QaRecord {
    pub fn new(report: &QaReport, routing: &Routing, rounds: u8, repaired: Vec<String>) -> Self {
        let name = |c: &site_quality::Cluster| format!("{} on {}", c.rule, c.page_type);
        QaRecord {
            standard: report.standard.clone(),
            branch: report.subject.branch.clone(),
            commit: report.subject.commit.clone(),
            digest: report.digest,
            gate: report.gate.clone(),
            line: report.line(),
            rounds,
            repaired,
            design: routing.design.iter().map(name).collect(),
            platform: routing.platform.iter().map(name).collect(),
            content: route_content(&routing.content),
        }
    }

    pub fn passed(&self) -> bool {
        self.gate.passed
    }

    /// The thread's text when the gate is shut.
    pub fn blocked_text(&self) -> String {
        let mut t = format!("The release is blocked by the QA stage: {}.", self.line);
        for b in &self.gate.blocking {
            t.push_str(&format!("\n- {b}"));
        }
        if !self.design.is_empty() {
            t.push_str(&format!(
                "\nStill open for the web designer after {} repair rounds: {}.",
                self.rounds,
                self.design.join(", ")
            ));
        }
        if !self.platform.is_empty() {
            t.push_str(&format!(
                "\nswarm.press's own (the importer, the export, the engine): {}.",
                self.platform.join(", ")
            ));
        }
        for w in &self.content {
            let Routed::Unstaffed { role } = &w.routed;
            t.push_str(&format!(
                "\n- {} on {} ({} pages) is the {}'s, and no one on the staff holds that role yet.",
                w.order.rule,
                w.order.page_type,
                w.order.pages,
                role.slug()
            ));
        }
        t
    }
}

/// The digest as the sim's command.
pub fn quality_outcome(job_id: u64, digest: &QaDigest) -> Outcome {
    Outcome::SiteQuality {
        job_id,
        quality: QualityOut::from(digest),
    }
}

/// The standard the orchestrator's executors judge against.
pub fn standard() -> Standard {
    Standard::v1()
}
