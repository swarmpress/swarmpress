//! Roles, departments and job kinds of the organization
//! (docs/game-design/organization.md §2, §9; ADR-0024).

use agents::prompts::templates;
use agents::roles::Executor;
use agents::{Department, JobKind, Role, RolesConfig};

#[test]
fn every_job_kind_has_role_executor_and_template() {
    let c = RolesConfig::builtin();
    assert_eq!(JobKind::ALL.len(), 35);
    for &k in JobKind::ALL {
        let p = c.job(k);
        assert!(p.role.is_agent(), "{k}");
        assert!(p.max_tokens > 0, "{k}");
        assert!(
            c.claude_profile(p.role, None).is_some(),
            "{k}: {} has no profile",
            p.role
        );
        let t = templates::by_id(k.template_id())
            .unwrap_or_else(|| panic!("{k}: no template {}", k.template_id()));
        assert_eq!(t.id, k.template_id());
        assert_eq!(k.as_str().parse::<JobKind>().unwrap(), k);
        assert_eq!(serde_json::to_value(k).unwrap(), k.as_str());
    }
    // ADR-0024: browser for chatter, triage, briefings and drafts; Claude for
    // business cases, site changes, research and candidate generation.
    for k in [
        JobKind::Standup,
        JobKind::SecretaryTriage,
        JobKind::CeoBriefing,
        JobKind::DraftReply,
        JobKind::ThreadSummary,
    ] {
        assert_eq!(c.job(k).executor, Executor::Browser, "{k}");
    }
    for k in [
        JobKind::ProjectBusinessCase,
        JobKind::SiteChange,
        JobKind::Research,
        JobKind::CandidateGeneration,
    ] {
        assert_eq!(c.job(k).executor, Executor::Claude, "{k}");
    }
    let who = |k| c.job(k).role;
    assert_eq!(who(JobKind::FinanceReport), Role::Cfo);
    assert_eq!(who(JobKind::HiringAffordability), Role::Cfo);
    assert_eq!(who(JobKind::SecretaryTriage), Role::Secretary);
    assert_eq!(who(JobKind::CeoBriefing), Role::Secretary);
    assert_eq!(who(JobKind::ThreadSummary), Role::Secretary);
    assert_eq!(who(JobKind::StrategyPitch), Role::Strategist);
    assert_eq!(who(JobKind::ProjectBusinessCase), Role::Strategist);
    assert_eq!(who(JobKind::WeeklyPlan), Role::Strategist);
    assert_eq!(who(JobKind::PlanSchedule), Role::EditorInChief);
    assert_eq!(who(JobKind::PhotoSelection), Role::PhotoEditor);
    assert_eq!(who(JobKind::SiteChange), Role::WebDeveloper);
    // FEAT-095: the UX designer plays the Information Architect.
    assert_eq!(who(JobKind::SiteArchitect), Role::UxDesigner);
    assert_eq!(who(JobKind::ToolBuild), Role::WebDeveloper);
    assert_eq!(who(JobKind::OpsCheck), Role::ItEngineer);
    assert_eq!(who(JobKind::SeoPlan), Role::SeoSpecialist);
    assert_eq!(who(JobKind::MarketingPlan), Role::MarketingManager);
    for k in [
        JobKind::KpiReport,
        JobKind::ContentPerformance,
        JobKind::ExperimentReadout,
    ] {
        assert_eq!(who(k), Role::DataScientist, "{k}");
        assert_eq!(c.job(k).executor, Executor::BrowserThenClaude, "{k}");
    }
    // the starting company (photographer, SEO specialist) covers photo and
    // marketing work through `also`
    assert!(c
        .job(JobKind::PhotoSelection)
        .performed_by(Role::Photographer));
    assert!(c.job(JobKind::Newsletter).performed_by(Role::SeoSpecialist));
    assert!(!c.job(JobKind::FinanceReport).performed_by(Role::Writer));
    assert!(c.jobs_for(Role::Secretary).contains(&JobKind::DraftReply));
}

#[test]
fn every_template_parses() {
    for (id, _) in templates::ALL {
        let t = templates::by_id(id).unwrap();
        assert_eq!(t.id, *id);
        assert!(!t.template.starts_with("+++"));
    }
    assert!(templates::by_id("nope").is_none());
}

#[test]
fn roles_map_to_exactly_one_department() {
    assert_eq!(Role::staff().count(), 21);
    for role in Role::staff() {
        let d = role.department().expect("staff role has a department");
        assert!(d.roles().contains(&role));
        let (lo, hi) = role.salary_band_eur_month().unwrap();
        assert!(lo < hi);
        assert_eq!(role.as_str().parse::<Role>().unwrap(), role);
        assert_eq!(serde_json::to_value(role).unwrap(), role.as_str());
    }
    assert_eq!(Role::Ceo.department(), None);
    assert_eq!(Role::System.salary_band_eur_month(), None);
    let names: Vec<(&str, Vec<&str>)> = Department::ALL
        .iter()
        .map(|d| (d.as_str(), d.roles().iter().map(|r| r.as_str()).collect()))
        .collect();
    assert_eq!(
        names,
        vec![
            ("executive-office", vec!["cfo", "secretary"]),
            ("strategy", vec!["strategist", "analyst", "data-scientist"]),
            (
                "editorial",
                vec![
                    "editor-in-chief",
                    "editor",
                    "writer",
                    "translator",
                    "fact-checker"
                ]
            ),
            (
                "photo-video",
                vec!["photo-editor", "photographer", "video-producer"]
            ),
            (
                "web-development",
                vec!["art-director", "web-developer", "ux-designer"]
            ),
            ("it-operations", vec!["it-engineer", "dev-ops"]),
            (
                "seo-marketing",
                vec![
                    "seo-specialist",
                    "marketing-manager",
                    "social-media-manager"
                ]
            ),
        ]
    );
    assert_eq!(Department::PhotoVideo.name(), "Photo & Video");
}

#[test]
fn roles_config_rejects_gaps() {
    let missing = agents::roles::ROLES_TOML.replace("[roles.dev-ops]", "[roles.dev-opsx]");
    assert!(RolesConfig::from_toml_str(&missing).is_err());
    let bad_also = agents::roles::ROLES_TOML.replacen(
        "role = \"secretary\"\nmax_tokens = 1024",
        "role = \"secretary\"\nalso = [\"ceo\"]\nmax_tokens = 1024",
        1,
    );
    assert_ne!(bad_also, agents::roles::ROLES_TOML);
    assert!(RolesConfig::from_toml_str(&bad_also).is_err());
}
