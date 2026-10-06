//! The site's structure and tools in the sim (ADR-0072, FEAT-090, FEAT-091,
//! FEAT-094, FEAT-095). Text never enters the sim: the blueprint and the tool
//! graphs live in the site repo; the sim holds digests and the work.
//!
//! ```text
//! Command::Commission{project, kind: Structure | Tool | Theme, brief_ref}
//!   └─► WorkItem: Draft(architect) → gate → Publish(architect)
//! Draft   ─► RequestJob(Architect | ToolBuild | ThemeCode) ─► JobCompleted{ok} ─► the gate
//! gate: always a StructureApproval ticket (the CEO's; whatever the autonomy policy)
//!   Approve ─► Publish │ SendBack ─► revision + 1, Draft │ Kill ─► Cancelled
//!   Defer (the default, also on expiry) ─► stays parked; a fresh ticket at 08:30
//! Publish ─► RequestJob(Publish) (the host applies the change) ─► JobCompleted{ok} ─► Published
//! ServerCommand::BlueprintChanged{hash, page_types, slots, issues} ─► the model's facts
//! ServerCommand::ToolsChanged{tools}  ─► the installed tools (schedule, the agent step's role)
//! 06:00, a scheduled tool due ─► RequestJob(ToolRun, the role's member or nobody)
//! Command::RunTool{tool_ref}  ─► RequestJob(ToolRun) now
//!   ─► JobCompleted{ok} │ JobFailed ─► the tool's run counts
//! ```
//!
//! Who does the work: the UX designer plays the Information Architect (else
//! the strategist, else the editor-in-chief); tools are the web developer's
//! (else the IT engineer, else DevOps); the theme is the web developer's
//! (else the art director, else the UX designer).

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::clock::hm;
use crate::ids::{ProjectId, StaffId, WorkItemId};
use crate::plan::{
    JobKind, Phase, PhaseKind, WorkItem, WorkItemKind, WorkItemStatus, WorkPriority,
};
use crate::projects::ProjectStatus;
use crate::roles::Role;
use crate::world::World;

/// Tools a company may have installed.
pub const MAX_TOOLS: usize = 64;
/// Open structure, tool and theme items one project may have at once.
pub const MAX_OPEN_STRUCTURAL: usize = 3;
/// Tool refs are below this (6 bytes of the tool's hash).
pub const TOOL_REF_LIMIT: u64 = 1 << 48;
/// A schedule runs at most this many game days apart.
pub const MAX_SCHEDULE_DAYS: u8 = 28;
/// Scheduled tool runs are requested in this window, each day.
pub const TOOL_RUN_START: u16 = hm(6, 0);
pub const TOOL_RUN_END: u16 = hm(6, 20);

/// The digest of the site's blueprint (`ServerCommand::BlueprintChanged`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SiteModelFacts {
    /// First 16 bytes of the blueprint's semantic hash.
    pub hash: [u8; 16],
    pub page_types: u16,
    pub slots: u16,
    /// Checker issues of the blueprint in its site.
    pub issues: u16,
    pub changed_step: u64,
}

/// One installed tool as the host reports it (`ServerCommand::ToolsChanged`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ToolStub {
    /// The first 6 bytes of the tool's hash, big-endian (below 2^48, so a
    /// JavaScript number holds it exactly): the tool's id here.
    pub tool_ref: u64,
    /// Runs every n game days; 0: only on demand or when a page is built.
    #[serde(default)]
    pub schedule_days: u8,
    /// The staff role whose member does its agent step; none: no staff time.
    #[serde(default)]
    pub role: Option<Role>,
}

/// An installed tool's facts and run counts.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ToolFacts {
    pub schedule_days: u8,
    pub role: Option<Role>,
    pub runs: u32,
    pub failures: u32,
    pub last_run_day: Option<u32>,
    pub last_ok: Option<bool>,
}

/// The site's structure and tools, as the sim knows them.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Structure {
    #[serde(default)]
    pub model: Option<SiteModelFacts>,
    #[serde(default)]
    pub tools: BTreeMap<u64, ToolFacts>,
}

impl WorkItemKind {
    /// A change to the site's structure, tools or theme (ADR-0072): drafted
    /// by its architect, always approved by the CEO, applied by its Publish.
    pub const fn is_structural(self) -> bool {
        matches!(
            self,
            WorkItemKind::Structure | WorkItemKind::Tool | WorkItemKind::Theme
        )
    }

    /// The job of its Draft phase.
    pub const fn draft_job(self) -> JobKind {
        match self {
            WorkItemKind::Structure => JobKind::Architect,
            WorkItemKind::Tool => JobKind::ToolBuild,
            WorkItemKind::Theme => JobKind::ThemeCode,
            _ => JobKind::Draft,
        }
    }

    /// Who drafts and applies it, in order of preference.
    pub const fn architects(self) -> &'static [Role] {
        match self {
            WorkItemKind::Structure => &[Role::UxDesigner, Role::Strategist, Role::EditorInChief],
            WorkItemKind::Tool => &[Role::WebDeveloper, Role::ItEngineer, Role::DevOps],
            WorkItemKind::Theme => &[Role::WebDeveloper, Role::ArtDirector, Role::UxDesigner],
            _ => &[],
        }
    }
}

impl World {
    /// The first active staff member of the first preferred role, one on the
    /// project's team before anyone else.
    pub(crate) fn first_of(&self, roles: &[Role], project: ProjectId) -> Option<StaffId> {
        roles.iter().find_map(|r| {
            self.staff
                .values()
                .find(|s| s.is_active() && s.role == *r && s.allocation(project) > 0)
                .or_else(|| self.staff.values().find(|s| s.is_active() && s.role == *r))
                .map(|s| s.id)
        })
    }

    /// Open structural items of a project.
    pub fn open_structural(&self, project: ProjectId) -> usize {
        self.plan
            .items
            .values()
            .filter(|i| i.project == project && i.kind.is_structural() && !i.status.is_closed())
            .count()
    }

    /// Whether `Command::Commission` can be applied (pure).
    pub(crate) fn check_commission(
        &self,
        project: ProjectId,
        kind: WorkItemKind,
    ) -> Result<StaffId, &'static str> {
        if !kind.is_structural() {
            return Err("only structure, tool and theme work is commissioned this way");
        }
        let p = self.projects.get(&project).ok_or("unknown project")?;
        if p.status != ProjectStatus::Active {
            return Err("the project is not active");
        }
        if self.open_structural(project) >= MAX_OPEN_STRUCTURAL {
            return Err("the project has as many open structure, tool and theme items as it may");
        }
        self.first_of(kind.architects(), project)
            .ok_or("nobody on the staff can do this work: hire for it")
    }

    /// `Command::Commission` (validated): a structural item, its Draft started.
    pub(crate) fn commission(&mut self, project: ProjectId, kind: WorkItemKind, brief_ref: u64) {
        let Ok(architect) = self.check_commission(project, kind) else {
            return;
        };
        self.plan.next_item += 1;
        let id = WorkItemId(self.plan.next_item);
        let item = WorkItem {
            id,
            project,
            kind,
            status: WorkItemStatus::Planned,
            priority: WorkPriority::Normal,
            owner: Some(architect),
            brief_ref: Some(brief_ref),
            revision: 0,
            phases: vec![
                Phase::new(PhaseKind::Draft, Some(architect)),
                Phase::new(PhaseKind::Publish, Some(architect)),
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
        self.start_phase(id, 0);
    }

    /// `ServerCommand::BlueprintChanged`.
    pub(crate) fn apply_blueprint_changed(
        &mut self,
        hash: [u8; 16],
        page_types: u16,
        slots: u16,
        issues: u16,
    ) {
        self.plan.structure.model = Some(SiteModelFacts {
            hash,
            page_types,
            slots,
            issues,
            changed_step: self.step,
        });
    }

    /// `ServerCommand::ToolsChanged` (validated): the installed tools are
    /// exactly `tools`; a tool that stays keeps its counts.
    pub(crate) fn apply_tools_changed(&mut self, tools: &[ToolStub]) {
        let old = std::mem::take(&mut self.plan.structure.tools);
        for t in tools {
            let mut facts = old.get(&t.tool_ref).copied().unwrap_or(ToolFacts {
                schedule_days: 0,
                role: None,
                runs: 0,
                failures: 0,
                last_run_day: None,
                last_ok: None,
            });
            facts.schedule_days = t.schedule_days;
            facts.role = t.role;
            self.plan.structure.tools.insert(t.tool_ref, facts);
        }
        // Runs of removed tools are dropped.
        let tools = &self.plan.structure.tools;
        self.plan
            .jobs
            .retain(|_, j| j.tool.is_none_or(|r| tools.contains_key(&r)));
    }

    /// A run of tool `tool_ref` is pending.
    pub fn tool_run_pending(&self, tool_ref: u64) -> bool {
        self.plan.jobs.values().any(|j| j.tool == Some(tool_ref))
    }

    /// Requests a run of an installed tool (none while one is pending): the
    /// member of its agent step's role works on it, or nobody.
    pub(crate) fn request_tool_run(&mut self, tool_ref: u64) {
        let Some(facts) = self.plan.structure.tools.get(&tool_ref).copied() else {
            return;
        };
        if self.tool_run_pending(tool_ref) {
            return;
        }
        let Some(project) = self
            .projects
            .values()
            .find(|p| p.status == ProjectStatus::Active)
            .map(|p| p.id)
        else {
            return;
        };
        let staff: Vec<StaffId> = facts
            .role
            .and_then(|r| self.first_of(&[r], project))
            .into_iter()
            .collect();
        let job = self.request_job(
            JobKind::ToolRun,
            project,
            None,
            Some(tool_ref),
            0,
            None,
            staff,
        );
        if let Some(j) = self.plan.jobs.get_mut(&job) {
            j.tool = Some(tool_ref);
        }
    }

    /// 06:00: every scheduled tool whose interval has passed runs.
    pub(crate) fn run_scheduled_tools(&mut self, day: u32) {
        let due: Vec<u64> = self
            .plan
            .structure
            .tools
            .iter()
            .filter(|(_, f)| {
                f.schedule_days > 0
                    && f.last_run_day
                        .is_none_or(|d| day >= d + u32::from(f.schedule_days))
            })
            .map(|(r, _)| *r)
            .collect();
        for r in due {
            self.request_tool_run(r);
        }
    }

    /// A tool run ended: its counts (the job is already removed).
    pub(crate) fn tool_run_done(&mut self, tool_ref: u64, ok: bool) {
        let day = self.clock().day;
        if let Some(f) = self.plan.structure.tools.get_mut(&tool_ref) {
            f.runs += 1;
            if !ok {
                f.failures += 1;
            }
            f.last_run_day = Some(day);
            f.last_ok = Some(ok);
        }
    }

    /// The window check for the day's scheduled runs.
    pub(crate) fn tools_window(minute: u16) -> bool {
        (TOOL_RUN_START..TOOL_RUN_END).contains(&minute)
    }
}
