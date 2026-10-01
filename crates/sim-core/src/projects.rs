//! Projects (publications) and their teams (ADR-0029, organization.md §4).
//!
//! A company owns 1..n projects; each is one real site (repo + domain).
//! People are staffed on projects with percentage allocations stored on the
//! person ([`crate::staff::Staff::projects`], the single source of truth); a
//! project's team is derived from them ([`World::project_team`]).
//!
//! Work routing: project work only goes to team members with the right role
//! ([`World::project_members_with_role`]). A project whose team lacks a
//! required role ([`ProjectKind::required_roles`]) is blocked and raises a
//! `missing-role` ticket ([`World::check_staffing`]).
//!
//! Analytics (organization.md §6a, ADR-0032): the server injects compact
//! integer [`crate::commands::ServerCommand::AnalyticsSignals`] from the
//! first-party tracker; they feed the audience KPI (blended at most 30% with
//! the sim's own estimate), goal progress and a revenue *estimate* in the
//! project ledger. Revenue itself is still the loud stub of
//! [`crate::economy::revenue_stub`].

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::finance::ProjectLedger;
use crate::ids::{ProjectId, StaffId};
use crate::inbox::{TicketKind, TicketSpec};
use crate::roles::Role;
use crate::world::World;

/// Game days in a month (month close, salaries per month, budgets).
pub const MONTH_DAYS: u32 = 30;
/// Analytics days kept per project.
pub const ANALYTICS_DAYS: usize = 30;
/// Real traffic counts for at most this share of the audience KPI, permille
/// (ADR-0021: real analytics are a bonus, not the decider).
pub const REAL_AUDIENCE_WEIGHT_PM: i64 = 300;
/// In-game CPM used for the revenue estimate: €4.00 per 1 000 page views.
pub const CPM_CENTS: i64 = 400;
/// Default goal for a new project: monthly readers.
pub const DEFAULT_GOAL_MONTHLY_READERS: u32 = 40_000;
/// Longest slug / name / domain accepted by `CreateProject`.
pub const MAX_SLUG_LEN: usize = 48;
pub const MAX_NAME_LEN: usize = 64;
pub const MAX_DOMAIN_LEN: usize = 128;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum ProjectStatus {
    /// Proposed by Strategy (or the CEO); not yet running.
    #[serde(alias = "proposed")]
    Proposed,
    #[serde(alias = "active")]
    Active,
    /// Team kept, no standups, no new work.
    #[serde(alias = "paused")]
    Paused,
    /// Terminal: the team is released.
    #[serde(alias = "archived")]
    Archived,
}

impl ProjectStatus {
    pub const fn slug(self) -> &'static str {
        match self {
            ProjectStatus::Proposed => "proposed",
            ProjectStatus::Active => "active",
            ProjectStatus::Paused => "paused",
            ProjectStatus::Archived => "archived",
        }
    }

    /// Allowed status transitions.
    pub const fn can_become(self, next: ProjectStatus) -> bool {
        use ProjectStatus::*;
        matches!(
            (self, next),
            (Proposed, Active)
                | (Active, Paused)
                | (Paused, Active)
                | (Proposed, Archived)
                | (Active, Archived)
                | (Paused, Archived)
        )
    }
}

/// What a project produces; decides the roles its pipeline needs.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum ProjectKind {
    /// A website run by the article pipeline.
    Publication,
}

impl ProjectKind {
    /// Groups of interchangeable roles; the team needs at least one person
    /// from every group. The first role of a group names it when missing.
    pub const fn required_roles(self) -> &'static [&'static [Role]] {
        match self {
            ProjectKind::Publication => &[
                &[Role::Editor, Role::EditorInChief],
                &[Role::Writer],
                &[Role::Photographer, Role::PhotoEditor],
                &[Role::WebDeveloper],
                &[Role::SeoSpecialist],
            ],
        }
    }
}

/// Project KPIs. `audience` is the blended weekly audience.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProjectKpis {
    pub live_pages: u32,
    /// Average editor score, permille of 10.
    pub quality_avg_pm: u16,
    /// Weekly audience: sim estimate blended with real visitors.
    pub audience: u32,
    /// The sim's own weekly audience estimate (0 until the audience model
    /// lands with the pipeline, M2).
    pub sim_audience: u32,
    pub reputation_pm: u16,
    /// Goal: monthly readers.
    pub goal_monthly_readers: u32,
    /// Progress towards the goal from measured visitors, permille (capped).
    pub goal_progress_pm: u16,
}

/// One day of first-party analytics for a project.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AnalyticsDay {
    pub day: u32,
    pub sessions: u32,
    pub visitors: u32,
    pub pageviews: u32,
    /// Engaged sessions, permille.
    pub engagement_pm: u16,
    pub top_pages_digest: u64,
}

/// Rolling window of [`AnalyticsDay`]s, oldest first, unique days.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProjectAnalytics {
    pub days: Vec<AnalyticsDay>,
}

/// Sums over a window of analytics days.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct AnalyticsWindow {
    pub sessions: u64,
    pub visitors: u64,
    pub pageviews: u64,
    /// Session-weighted engagement, permille.
    pub engagement_pm: u16,
}

impl ProjectAnalytics {
    /// "connected" in the UI: at least one signal has arrived.
    pub fn connected(&self) -> bool {
        !self.days.is_empty()
    }

    /// Inserts or replaces a day, keeping the newest [`ANALYTICS_DAYS`].
    pub fn record(&mut self, d: AnalyticsDay) {
        match self.days.binary_search_by_key(&d.day, |x| x.day) {
            Ok(i) => self.days[i] = d,
            Err(i) => self.days.insert(i, d),
        }
        if self.days.len() > ANALYTICS_DAYS {
            let drop = self.days.len() - ANALYTICS_DAYS;
            self.days.drain(..drop);
        }
    }

    /// Sums over the `n` days ending with the newest recorded day.
    pub fn window(&self, n: u32) -> AnalyticsWindow {
        let Some(last) = self.days.last() else {
            return AnalyticsWindow::default();
        };
        let from = last.day.saturating_sub(n.saturating_sub(1));
        let mut w = AnalyticsWindow::default();
        let mut engaged = 0u64;
        for d in self.days.iter().filter(|d| d.day >= from) {
            w.sessions += u64::from(d.sessions);
            w.visitors += u64::from(d.visitors);
            w.pageviews += u64::from(d.pageviews);
            engaged += u64::from(d.sessions) * u64::from(d.engagement_pm.min(1000));
        }
        if let Some(pm) = engaged.checked_div(w.sessions) {
            w.engagement_pm = u16::try_from(pm).unwrap_or(1000);
        }
        w
    }

    /// Page views on or after `from_day`.
    pub fn pageviews_since(&self, from_day: u32) -> u64 {
        self.days
            .iter()
            .filter(|d| d.day >= from_day)
            .map(|d| u64::from(d.pageviews))
            .sum()
    }
}

/// A publication.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Project {
    pub id: ProjectId,
    /// Stable key, e.g. `cinqueterre-travel`.
    pub slug: String,
    /// Display name, e.g. `cinqueterre.travel`.
    pub name: String,
    pub domain: String,
    /// `owner/repo` of the site repository.
    pub repo: String,
    pub kind: ProjectKind,
    pub status: ProjectStatus,
    /// Usually the Editor-in-Chief or a senior editor. Always a team member.
    pub lead: Option<StaffId>,
    /// Monthly budget set by the CEO, cents. 0 = no budget set.
    pub budget_monthly_cents: i64,
    pub ledger: ProjectLedger,
    pub kpis: ProjectKpis,
    pub analytics: ProjectAnalytics,
    pub created_day: u32,
}

impl Project {
    pub fn new(
        id: ProjectId,
        slug: &str,
        name: &str,
        domain: &str,
        status: ProjectStatus,
        day: u32,
    ) -> Project {
        Project {
            id,
            slug: slug.to_string(),
            name: name.to_string(),
            domain: domain.to_string(),
            repo: repo_for(domain),
            kind: ProjectKind::Publication,
            status,
            lead: None,
            budget_monthly_cents: 0,
            ledger: ProjectLedger::default(),
            kpis: ProjectKpis {
                goal_monthly_readers: DEFAULT_GOAL_MONTHLY_READERS,
                ..ProjectKpis::default()
            },
            analytics: ProjectAnalytics::default(),
            created_day: day,
        }
    }

    /// Not archived: counts against the level's project limit.
    pub fn is_open(&self) -> bool {
        self.status != ProjectStatus::Archived
    }

    /// Recomputes the audience blend and goal progress from analytics.
    pub fn refresh_kpis(&mut self) {
        let week = self.analytics.window(7);
        let real = i64::try_from(week.visitors).unwrap_or(i64::MAX);
        let sim = i64::from(self.kpis.sim_audience);
        let blended = if self.analytics.connected() {
            (sim * (1000 - REAL_AUDIENCE_WEIGHT_PM) + real * REAL_AUDIENCE_WEIGHT_PM) / 1000
        } else {
            sim
        };
        self.kpis.audience = u32::try_from(blended.max(0)).unwrap_or(u32::MAX);
        let month = self.analytics.window(MONTH_DAYS).visitors;
        let goal = u64::from(self.kpis.goal_monthly_readers.max(1));
        self.kpis.goal_progress_pm = u16::try_from((month * 1000 / goal).min(1000)).unwrap_or(1000);
    }
}

/// The site repository for a domain in the platform org.
pub fn repo_for(domain: &str) -> String {
    format!("swarmpress/{domain}")
}

/// How many open (non-archived) projects a company level allows.
pub const fn project_limit(level: u8) -> usize {
    match level {
        0..=2 => 1,
        3 => 2,
        4 => 3,
        _ => 5,
    }
}

/// `CreateProject` slug: lowercase ASCII letters, digits and inner dashes.
pub fn valid_slug(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= MAX_SLUG_LEN
        && !s.starts_with('-')
        && !s.ends_with('-')
        && s.bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

/// `CreateProject` domain: lowercase host name with at least one dot.
pub fn valid_domain(s: &str) -> bool {
    s.len() <= MAX_DOMAIN_LEN
        && s.contains('.')
        && s.split('.').all(|label| {
            !label.is_empty()
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        })
}

/// `CreateProject` name: 1..=64 printable characters.
pub fn valid_name(s: &str) -> bool {
    let n = s.chars().count();
    (1..=MAX_NAME_LEN).contains(&n) && !s.chars().any(char::is_control) && !s.trim().is_empty()
}

impl World {
    /// Adds a project directly (scenario builders and imports; players use
    /// `CreateProject`, which starts as a proposal with a ticket).
    pub fn add_project(
        &mut self,
        slug: &str,
        name: &str,
        domain: &str,
        status: ProjectStatus,
    ) -> ProjectId {
        let id = self.ids.project();
        let day = self.clock().day;
        self.projects
            .insert(id, Project::new(id, slug, name, domain, status, day));
        id
    }

    /// The team of a project: everyone with an allocation on it (people on
    /// their way out included until they leave the books).
    pub fn project_team(&self, project: ProjectId) -> BTreeMap<StaffId, u8> {
        self.staff
            .values()
            .filter_map(|s| s.projects.get(&project).map(|pct| (s.id, *pct)))
            .collect()
    }

    /// Team members of `project` with `role`, lowest id first. Project work
    /// for that role is routed only to these people.
    pub fn project_members_with_role(&self, project: ProjectId, role: Role) -> Vec<StaffId> {
        self.staff
            .values()
            .filter(|s| s.is_active() && s.role == role && s.allocation(project) > 0)
            .map(|s| s.id)
            .collect()
    }

    /// Required roles the team of `project` lacks (one per missing group,
    /// named by the group's first role).
    pub fn missing_roles(&self, project: ProjectId) -> Vec<Role> {
        let Some(p) = self.projects.get(&project) else {
            return Vec::new();
        };
        p.kind
            .required_roles()
            .iter()
            .filter(|group| {
                !group
                    .iter()
                    .any(|r| !self.project_members_with_role(project, *r).is_empty())
            })
            .filter_map(|group| group.first().copied())
            .collect()
    }

    /// Open (non-archived) projects.
    pub fn open_projects(&self) -> usize {
        self.projects.values().filter(|p| p.is_open()).count()
    }

    /// Projects the company level allows.
    pub fn project_limit(&self) -> usize {
        project_limit(self.company.level)
    }

    /// Raises a `missing-role` ticket for every role an active project lacks,
    /// unless one is already open for that project and role.
    pub fn check_staffing(&mut self) {
        let active: Vec<ProjectId> = self
            .projects
            .values()
            .filter(|p| p.status == ProjectStatus::Active)
            .map(|p| p.id)
            .collect();
        for pid in active {
            for role in self.missing_roles(pid) {
                let open = self.tickets.values().any(|t| {
                    t.is_open()
                        && t.kind == TicketKind::MissingRole
                        && t.project == Some(pid)
                        && t.role == Some(role)
                });
                if !open {
                    let from = self.projects.get(&pid).and_then(|p| p.lead);
                    self.raise_ticket(TicketSpec {
                        kind: TicketKind::MissingRole,
                        project: Some(pid),
                        from,
                        role: Some(role),
                        amount_cents: 0,
                    });
                }
            }
        }
    }

    /// Releases everyone from `project` (archiving).
    pub(crate) fn release_team(&mut self, project: ProjectId) {
        for s in self.staff.values_mut() {
            s.projects.remove(&project);
        }
        if let Some(p) = self.projects.get_mut(&project) {
            p.lead = None;
        }
    }

    /// Removes `staff` from every project (firing), clearing leads.
    pub(crate) fn unstaff(&mut self, staff: StaffId) -> Vec<ProjectId> {
        let left: Vec<ProjectId> = self
            .staff
            .get_mut(&staff)
            .map(|s| std::mem::take(&mut s.projects).into_keys().collect())
            .unwrap_or_default();
        for p in self.projects.values_mut() {
            if p.lead == Some(staff) {
                p.lead = None;
            }
        }
        left
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn limits_by_level() {
        assert_eq!(project_limit(1), 1);
        assert_eq!(project_limit(2), 1);
        assert_eq!(project_limit(3), 2);
        assert_eq!(project_limit(4), 3);
        assert_eq!(project_limit(5), 5);
    }

    #[test]
    fn status_transitions() {
        use ProjectStatus::*;
        assert!(Proposed.can_become(Active));
        assert!(Active.can_become(Paused) && Paused.can_become(Active));
        assert!(!Archived.can_become(Active));
        assert!(!Proposed.can_become(Paused));
        assert!(!Active.can_become(Active));
    }

    #[test]
    fn create_project_text_rules() {
        assert!(valid_slug("cinqueterre-travel"));
        assert!(!valid_slug("Cinque"));
        assert!(!valid_slug("-x"));
        assert!(!valid_slug(""));
        assert!(valid_domain("cinqueterre.travel"));
        assert!(!valid_domain("localhost"));
        assert!(!valid_domain("a..b"));
        assert!(!valid_domain("A.com"));
        assert!(valid_name("Amalfi Dispatch"));
        assert!(!valid_name("  "));
        assert_eq!(
            repo_for("cinqueterre.travel"),
            "swarmpress/cinqueterre.travel"
        );
    }

    #[test]
    fn analytics_window_and_blend() {
        let mut p = Project::new(ProjectId(1), "x", "x", "x.travel", ProjectStatus::Active, 0);
        p.refresh_kpis();
        assert_eq!(p.kpis.audience, 0);
        assert!(!p.analytics.connected());
        for day in 0..10u32 {
            p.analytics.record(AnalyticsDay {
                day,
                sessions: 1_000,
                visitors: 800,
                pageviews: 2_500,
                engagement_pm: 600,
                top_pages_digest: 1,
            });
        }
        // re-sent day replaces
        p.analytics.record(AnalyticsDay {
            day: 9,
            sessions: 1_000,
            visitors: 800,
            pageviews: 2_500,
            engagement_pm: 600,
            top_pages_digest: 2,
        });
        let w = p.analytics.window(7);
        assert_eq!(
            (w.sessions, w.visitors, w.pageviews),
            (7_000, 5_600, 17_500)
        );
        assert_eq!(w.engagement_pm, 600);
        p.kpis.sim_audience = 10_000;
        p.refresh_kpis();
        // 70% sim + 30% real
        assert_eq!(p.kpis.audience, 7_000 + 1_680);
        // 10 days × 800 of a 40k goal
        assert_eq!(p.kpis.goal_progress_pm, 200);
        assert_eq!(p.analytics.pageviews_since(5), 12_500);
    }
}
