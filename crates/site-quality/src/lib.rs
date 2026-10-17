//! Site quality as a governed stage of swarm.press (ADR-0094, FEAT-116).
//!
//! ```text
//! a branch's export (every page) ─► the browser executor, 1280 and 390 px
//!     └─► PageFacts per page and width (boxes, pictures, links, requests, headings, labels,
//!         the head): observed, never judged
//! SiteFacts (the release's paths, its sitemap, the site's languages, the design's words)
//!     └─► rules::evaluate(site-standard v1) ─► Findings
//!     └─► report::build: listed content gaps applied (refused unless the reason is a
//!         content gap and the owner a content role), classes = rule × page type × owner,
//!         scores per dimension (‰ of audits clean), the gate, the digest
//!     └─► route::route: design classes → the web designer's repair loop, content classes →
//!         work orders for content roles (step 4), platform classes → swarm.press
//! ```
//!
//! Pure and deterministic: ordered collections, integers, no I/O, time or threads; the same
//! facts give the same report bytes natively and in wasm. The report is text (stored as a note
//! on the audited commit in the content repository); only [`QaDigest`] enters the sim (rule 2).

#![forbid(unsafe_code)]

pub mod facts;
pub mod report;
pub mod route;
pub mod rules;
pub mod standard;

pub use facts::{PageFacts, SiteFacts};
pub use report::{
    build, check_exceptions, Cluster, Exception, Gate, QaDigest, QaReport, Scores, Subject,
};
pub use route::{route, Routing, WorkOrder};
pub use rules::{evaluate, Finding};
pub use standard::{Dimension, Kind, Route, Rule, Standard, StandardRef};
