//! The site's theme from its design (ADR-0093, FEAT-115): a design version that arrives
//! in the design store is rendered as the site's WordPress theme by the web designer and
//! applied only at the CEO's word. The design, the theme data, the checks' report and the
//! branch are text in the store (rule 2); the sim holds the version number and the work.
//!
//! ```text
//! ServerCommand::DesignReceived{version}  a design version newer than any before it
//!   └─► WorkItem(SiteTheme): Draft(web designer) → gate → Publish
//!       its brief_ref is the design version (the server's design store numbers them)
//!       an open SiteTheme item of an older version is cancelled (superseded)
//!       no web designer on the staff: the item waits (unstarted) and a MissingRole
//!       ticket asks for one; it starts when one is hired
//! Draft   ─► RequestJob(SiteTheme) ─► JobCompleted{ok, score, qa_defects, artifact_sha}
//!   (the theme on a `design-…` branch, checked; ok: false │ JobFailed ─► Blocked + Escalation)
//! gate: always a ThemeApproval ticket, the CEO's alone (never the Secretary's)
//!   Approve ─► Publish ─► RequestJob(Publish): the branch merged into live (then the export
//!              and deploy that follow every merge) ─► JobCompleted{ok} ─► Published
//!   Reject, and the default at the deadline ─► Cancelled: the current theme stays, the
//!              branch is never merged
//! ```

use serde::{Deserialize, Serialize};

use crate::ids::{ProjectId, StaffId, WorkItemId};
use crate::inbox::{TicketKind, TicketSpec};
use crate::plan::{Phase, PhaseKind, WorkItem, WorkItemKind, WorkItemStatus, WorkPriority};
use crate::projects::ProjectStatus;
use crate::roles::Role;
use crate::validate::Reject;
use crate::world::World;

/// Design versions are below this.
pub const MAX_DESIGN_VERSION: u32 = 1 << 30;

/// The site's designs as the sim knows them.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct SiteDesigns {
    /// The newest design version received (0: none yet).
    pub latest: u32,
    /// The design version whose theme is live (0: the site's theme from before).
    pub live: u32,
}

impl World {
    /// The first active web designer.
    pub fn web_designer(&self) -> Option<StaffId> {
        self.staff
            .values()
            .find(|s| s.is_active() && s.role == Role::WebDesigner)
            .map(|s| s.id)
    }

    fn site_project(&self) -> Option<ProjectId> {
        self.projects
            .values()
            .find(|p| p.status == ProjectStatus::Active)
            .map(|p| p.id)
    }

    /// The open `SiteTheme` item, if any.
    pub fn open_site_theme(&self) -> Option<WorkItemId> {
        self.plan
            .items
            .values()
            .find(|i| i.kind == WorkItemKind::SiteTheme && !i.status.is_closed())
            .map(|i| i.id)
    }

    /// Whether `ServerCommand::DesignReceived` can be applied (pure).
    pub(crate) fn check_design_received(&self, version: u32) -> Result<(), Reject> {
        if version == 0 || version >= MAX_DESIGN_VERSION {
            return Err(Reject::Invalid("a design version is 1 or more"));
        }
        if version <= self.plan.designs.latest {
            return Err(Reject::Invalid(
                "the site already has this design version or a newer one",
            ));
        }
        if self.site_project().is_none() {
            return Err(Reject::Invalid("there is no active project"));
        }
        Ok(())
    }

    /// `ServerCommand::DesignReceived` (validated): the theme's item for the new version.
    pub(crate) fn apply_design_received(&mut self, version: u32) {
        if self.check_design_received(version).is_err() {
            return;
        }
        let Some(project) = self.site_project() else {
            return;
        };
        self.plan.designs.latest = version;
        // A newer design supersedes the theme of an older one still in the works.
        if let Some(old) = self.open_site_theme() {
            self.cancel_item(old);
            self.close_theme_tickets(old);
        }
        let designer = self.web_designer();
        self.plan.next_item += 1;
        let id = WorkItemId(self.plan.next_item);
        let item = WorkItem {
            id,
            project,
            kind: WorkItemKind::SiteTheme,
            status: WorkItemStatus::Planned,
            priority: WorkPriority::Normal,
            owner: designer,
            brief_ref: Some(u64::from(version)),
            revision: 0,
            phases: vec![
                Phase::new(PhaseKind::Draft, designer),
                Phase::new(PhaseKind::Publish, designer),
            ],
            current: 0,
            meeting: None,
            tickets: Vec::new(),
            last_score: None,
            escalations: 0,
            created_step: self.step,
            published_step: None,
            workstream: None,
            start_day: None,
            due_day: None,
            publish_day: None,
            depends_on: Vec::new(),
            performance: None,
            followed_up: false,
        };
        self.plan.items.insert(id, item);
        if designer.is_some() {
            self.start_phase(id, 0);
        } else {
            self.ask_for_web_designer(project);
        }
    }

    /// The design version a `SiteTheme` item renders.
    pub fn design_version_of(&self, id: WorkItemId) -> Option<u32> {
        self.plan
            .items
            .get(&id)
            .filter(|i| i.kind == WorkItemKind::SiteTheme)
            .and_then(|i| i.brief_ref)
            .and_then(|v| u32::try_from(v).ok())
    }

    /// A superseded item's open approval closes with it (it can no longer be answered).
    fn close_theme_tickets(&mut self, id: WorkItemId) {
        let step = self.step;
        for t in self.tickets.values_mut() {
            if t.is_open() && t.kind == TicketKind::ThemeApproval && t.work_item == Some(id) {
                t.status = crate::inbox::TicketStatus::Expired;
                t.resolved_step = Some(step);
            }
        }
    }

    fn ask_for_web_designer(&mut self, project: ProjectId) {
        let open = self.tickets.values().any(|t| {
            t.is_open() && t.kind == TicketKind::MissingRole && t.role == Some(Role::WebDesigner)
        });
        if open {
            return;
        }
        let from = self.projects.get(&project).and_then(|p| p.lead);
        self.raise_ticket(TicketSpec {
            kind: TicketKind::MissingRole,
            project: Some(project),
            from,
            role: Some(Role::WebDesigner),
            amount_cents: 0,
            work_item: None,
        });
    }

    /// Each tick: a theme waiting for a web designer starts once one is on the staff.
    pub(crate) fn start_waiting_site_themes(&mut self) {
        let waiting: Vec<WorkItemId> = self
            .plan
            .items
            .values()
            .filter(|i| i.kind == WorkItemKind::SiteTheme && i.is_unstarted())
            .filter(|i| i.phases.first().is_some_and(|p| p.assignee.is_none()))
            .map(|i| i.id)
            .collect();
        if waiting.is_empty() {
            return;
        }
        let Some(designer) = self.web_designer() else {
            return;
        };
        for id in waiting {
            if let Some(i) = self.plan.items.get_mut(&id) {
                i.owner = Some(designer);
                for p in &mut i.phases {
                    p.assignee = Some(designer);
                }
            }
            self.start_phase(id, 0);
        }
    }

    /// A `SiteTheme` item went live: its version is the live theme's.
    pub(crate) fn site_theme_live(&mut self, id: WorkItemId) {
        if let Some(v) = self.design_version_of(id) {
            self.plan.designs.live = self.plan.designs.live.max(v);
        }
    }
}
