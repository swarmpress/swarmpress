//! Routing open classes to their owners (ADR-0094 decision 3): design and layout classes into
//! the web designer's repair loop, content classes as work orders for content roles (the photo
//! editor, the editor, the SEO role, the media desk's researcher: ADR-0094 step 4), platform
//! classes to swarm.press itself. A class nobody on the staff can repair blocks the release and
//! says so; it never passes.

use serde::{Deserialize, Serialize};

use crate::report::{Cluster, QaReport};
use crate::standard::{Route, Standard};

/// A content class handed to a content role: what the role is asked to repair.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorkOrder {
    pub role: Route,
    pub rule: String,
    pub page_type: String,
    pub findings: u32,
    pub pages: u32,
    /// The class's evidence as the role reads it.
    pub evidence: String,
}

/// The open classes of a report by owner.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Routing {
    /// The web designer's: repaired in its loop, template by template.
    pub design: Vec<Cluster>,
    /// Content roles': work orders.
    pub content: Vec<WorkOrder>,
    /// swarm.press's own defects (the importer, the export, the engine).
    pub platform: Vec<Cluster>,
}

pub fn route(std: &Standard, report: &QaReport) -> Routing {
    let mut r = Routing::default();
    for c in &report.clusters {
        match c.route {
            Route::WebDesigner => r.design.push(c.clone()),
            Route::Platform => r.platform.push(c.clone()),
            role => r.content.push(WorkOrder {
                role,
                rule: c.rule.clone(),
                page_type: c.page_type.clone(),
                findings: c.findings,
                pages: c.pages,
                evidence: c.evidence(std),
            }),
        }
    }
    r
}
