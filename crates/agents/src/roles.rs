//! Roles and departments (docs/game-design/organization.md §2), seniority,
//! traits, device tiers, job kinds and executor policies
//! (`config/roles.toml`, ADR-0024).

use std::collections::BTreeMap;
use std::fmt;
use std::str::FromStr;

use claude::Effort;
use serde::{Deserialize, Serialize};

/// Built-in copy of `config/roles.toml`.
pub const ROLES_TOML: &str = include_str!("../../../config/roles.toml");

macro_rules! wire_enum {
    (
        $(#[$meta:meta])*
        pub enum $name:ident { $($(#[$vmeta:meta])* $variant:ident = $s:literal),+ $(,)? }
    ) => {
        $(#[$meta])*
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
        #[serde(rename_all = "kebab-case")]
        pub enum $name { $($(#[$vmeta])* $variant),+ }

        impl $name {
            /// Every variant, in declaration order.
            pub const ALL: &'static [$name] = &[$($name::$variant),+];

            /// Wire name (kebab-case, identical to serde).
            pub fn as_str(self) -> &'static str {
                match self { $($name::$variant => $s),+ }
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str(self.as_str())
            }
        }

        impl FromStr for $name {
            type Err = String;
            fn from_str(s: &str) -> Result<Self, Self::Err> {
                $name::ALL
                    .iter()
                    .copied()
                    .find(|v| v.as_str() == s)
                    .ok_or_else(|| format!(concat!("unknown ", stringify!($name), " {:?}"), s))
            }
        }
    };
}

wire_enum! {
    /// Organizational role (organization.md §2). Serialized in kebab-case,
    /// matching the sim's `Role` (`editor-in-chief`, `photo-editor`,
    /// `seo-specialist`, `dev-ops`, …). It is also the actor vocabulary of the
    /// state machines, which is why the non-staff actors [`Role::Ceo`] (the
    /// player) and [`Role::System`] (the orchestrator) are here too.
    pub enum Role {
        // Executive Office
        Cfo = "cfo",
        Secretary = "secretary",
        // Strategy
        Strategist = "strategist",
        Analyst = "analyst",
        DataScientist = "data-scientist",
        // Editorial
        EditorInChief = "editor-in-chief",
        Editor = "editor",
        Writer = "writer",
        Translator = "translator",
        FactChecker = "fact-checker",
        // Photo & Video
        PhotoEditor = "photo-editor",
        Photographer = "photographer",
        VideoProducer = "video-producer",
        // Web Development
        ArtDirector = "art-director",
        WebDeveloper = "web-developer",
        UxDesigner = "ux-designer",
        // IT & Operations
        ItEngineer = "it-engineer",
        DevOps = "dev-ops",
        // SEO & Marketing
        SeoSpecialist = "seo-specialist",
        MarketingManager = "marketing-manager",
        SocialMediaManager = "social-media-manager",
        /// The human player.
        Ceo = "ceo",
        /// The server orchestrator / deploy webhook (not an LLM).
        System = "system",
    }
}

impl Role {
    /// Every staff role (all roles except [`Role::Ceo`] and [`Role::System`]),
    /// in org-chart order.
    pub fn staff() -> impl Iterator<Item = Role> {
        Role::ALL.iter().copied().filter(|r| r.is_agent())
    }

    /// Human-readable job title for org charts and prompts.
    pub fn title(self) -> &'static str {
        match self {
            Role::Cfo => "Chief Financial Officer",
            Role::Secretary => "Executive Secretary",
            Role::Strategist => "Content Strategist",
            Role::Analyst => "Analyst",
            Role::DataScientist => "Data Scientist",
            Role::EditorInChief => "Editor-in-Chief",
            Role::Editor => "Editor",
            Role::Writer => "Writer",
            Role::Translator => "Translator",
            Role::FactChecker => "Fact-Checker",
            Role::PhotoEditor => "Photo Editor",
            Role::Photographer => "Photographer",
            Role::VideoProducer => "Video Producer",
            Role::ArtDirector => "Art Director",
            Role::WebDeveloper => "Web Developer",
            Role::UxDesigner => "UX Designer",
            Role::ItEngineer => "IT Engineer",
            Role::DevOps => "DevOps Engineer",
            Role::SeoSpecialist => "SEO Specialist",
            Role::MarketingManager => "Marketing Manager",
            Role::SocialMediaManager => "Social Media Manager",
            Role::Ceo => "CEO",
            Role::System => "System",
        }
    }

    /// The department a staff role belongs to (exactly one). `None` for the
    /// CEO (above the departments) and System.
    pub fn department(self) -> Option<Department> {
        Some(match self {
            Role::Cfo | Role::Secretary => Department::ExecutiveOffice,
            Role::Strategist | Role::Analyst | Role::DataScientist => Department::Strategy,
            Role::EditorInChief
            | Role::Editor
            | Role::Writer
            | Role::Translator
            | Role::FactChecker => Department::Editorial,
            Role::PhotoEditor | Role::Photographer | Role::VideoProducer => Department::PhotoVideo,
            Role::ArtDirector | Role::WebDeveloper | Role::UxDesigner => Department::WebDevelopment,
            Role::ItEngineer | Role::DevOps => Department::ItOperations,
            Role::SeoSpecialist | Role::MarketingManager | Role::SocialMediaManager => {
                Department::SeoMarketing
            }
            Role::Ceo | Role::System => return None,
        })
    }

    /// Whether this role is staffed by an LLM (CEO and System are not).
    pub fn is_agent(self) -> bool {
        !matches!(self, Role::Ceo | Role::System)
    }

    /// Asking-salary band in EUR/month (gross), from a junior's floor to a
    /// star's ceiling. Persona salaries must fall inside it. `None` for
    /// non-staff actors.
    pub fn salary_band_eur_month(self) -> Option<(u32, u32)> {
        Some(match self {
            Role::Cfo => (5_000, 13_000),
            Role::Secretary => (2_000, 4_800),
            Role::Strategist => (2_600, 8_500),
            Role::Analyst => (2_000, 5_500),
            Role::DataScientist => (2_800, 9_000),
            Role::EditorInChief => (4_500, 11_000),
            Role::Editor => (2_600, 7_000),
            Role::Writer => (1_800, 7_500),
            Role::Translator => (1_700, 4_500),
            Role::FactChecker => (1_800, 4_500),
            Role::PhotoEditor => (2_200, 6_000),
            Role::Photographer => (1_800, 6_500),
            Role::VideoProducer => (2_000, 6_500),
            Role::ArtDirector => (3_500, 9_500),
            Role::WebDeveloper => (2_400, 7_500),
            Role::UxDesigner => (2_300, 6_500),
            Role::ItEngineer => (2_400, 7_000),
            Role::DevOps => (2_800, 8_000),
            Role::SeoSpecialist => (2_000, 6_000),
            Role::MarketingManager => (2_800, 8_000),
            Role::SocialMediaManager => (1_700, 5_000),
            Role::Ceo | Role::System => return None,
        })
    }

    /// Roles whose people write publishable pages (the legacy writer routing
    /// covered the writers, the editors and the photographer).
    pub fn writes_pages(self) -> bool {
        matches!(
            self,
            Role::Writer
                | Role::Editor
                | Role::EditorInChief
                | Role::Photographer
                | Role::PhotoEditor
                | Role::VideoProducer
        )
    }
}

wire_enum! {
    /// A department (organization.md §2). Everyone on staff is in exactly one.
    pub enum Department {
        ExecutiveOffice = "executive-office",
        Strategy = "strategy",
        Editorial = "editorial",
        PhotoVideo = "photo-video",
        WebDevelopment = "web-development",
        ItOperations = "it-operations",
        SeoMarketing = "seo-marketing",
    }
}

impl Department {
    /// Display name ("Photo & Video").
    pub fn name(self) -> &'static str {
        match self {
            Department::ExecutiveOffice => "Executive Office",
            Department::Strategy => "Strategy",
            Department::Editorial => "Editorial",
            Department::PhotoVideo => "Photo & Video",
            Department::WebDevelopment => "Web Development",
            Department::ItOperations => "IT & Operations",
            Department::SeoMarketing => "SEO & Marketing",
        }
    }

    /// The roles in this department, in org-chart order.
    pub fn roles(self) -> Vec<Role> {
        Role::staff()
            .filter(|r| r.department() == Some(self))
            .collect()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Seniority {
    Junior,
    Mid,
    Senior,
    Star,
}

impl Seniority {
    pub const ALL: [Seniority; 4] = [
        Seniority::Junior,
        Seniority::Mid,
        Seniority::Senior,
        Seniority::Star,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            Seniority::Junior => "junior",
            Seniority::Mid => "mid",
            Seniority::Senior => "senior",
            Seniority::Star => "star",
        }
    }
}

/// Staff traits, each 0–100 (plan A).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Traits {
    pub rigor: u8,
    pub speed: u8,
    pub creativity: u8,
    pub sociability: u8,
    pub resilience: u8,
    pub ambition: u8,
}

impl Traits {
    pub fn validate(&self) -> Result<(), String> {
        for (name, v) in self.named() {
            if v > 100 {
                return Err(format!("trait {name} = {v} is out of range 0..=100"));
            }
        }
        Ok(())
    }

    pub fn named(&self) -> [(&'static str, u8); 6] {
        [
            ("rigor", self.rigor),
            ("speed", self.speed),
            ("creativity", self.creativity),
            ("sociability", self.sociability),
            ("resilience", self.resilience),
            ("ambition", self.ambition),
        ]
    }
}

/// Device capability tier for browser LLMs (plan D). Ordered.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Tier {
    Low,
    Mid,
    High,
}

wire_enum! {
    /// Every kind of LLM job the orchestrator can request. The executor,
    /// performing role(s) and token budget of each live in `config/roles.toml`;
    /// the company prompt template is [`JobKind::template_id`].
    pub enum JobKind {
        // Editorial pipeline and meetings
        Standup = "standup",
        Brief = "brief",
        Draft = "draft",
        Revise = "revise",
        EditReview = "edit-review",
        QaCoherence = "qa-coherence",
        Translate = "translate",
        Research = "research",
        // Design (Agency work)
        ArtDirection = "art-direction",
        ThemeCode = "theme-code",
        VisualReview = "visual-review",
        CriticReview = "critic-review",
        // Strategy
        StrategyPitch = "strategy-pitch",
        ProjectBusinessCase = "project-business-case",
        WeeklyPlan = "weekly-plan",
        // Data science (organization.md §6a)
        KpiReport = "kpi-report",
        ContentPerformance = "content-performance",
        ExperimentReadout = "experiment-readout",
        // Editorial board
        PlanSchedule = "plan-schedule",
        // Photo & Video
        PhotoSelection = "photo-selection",
        PhotoBrief = "photo-brief",
        // Web Development, IT & Operations
        SiteChange = "site-change",
        OpsCheck = "ops-check",
        // SEO & Marketing
        SeoPlan = "seo-plan",
        MarketingPlan = "marketing-plan",
        Newsletter = "newsletter",
        // Executive Office
        FinanceReport = "finance-report",
        HiringAffordability = "hiring-affordability",
        SecretaryTriage = "secretary-triage",
        CeoBriefing = "ceo-briefing",
        DraftReply = "draft-reply",
        ThreadSummary = "thread-summary",
        // Hiring
        CandidateGeneration = "candidate-generation",
    }
}

impl JobKind {
    /// Id of the company prompt template that runs this job
    /// (`crates/agents/prompts/<id>.md`, see [`crate::prompts::templates`]).
    pub fn template_id(self) -> &'static str {
        match self {
            JobKind::Standup | JobKind::Brief => "editor_in_chief",
            JobKind::Draft | JobKind::Revise => "writer",
            JobKind::EditReview => "editor",
            JobKind::QaCoherence => "qa_coherence",
            JobKind::Translate => "translator",
            JobKind::Research => "analyst",
            JobKind::ArtDirection | JobKind::VisualReview | JobKind::CriticReview => "art_director",
            JobKind::ThemeCode | JobKind::SiteChange => "web_developer",
            JobKind::StrategyPitch | JobKind::ProjectBusinessCase | JobKind::WeeklyPlan => {
                "strategist"
            }
            JobKind::KpiReport | JobKind::ContentPerformance | JobKind::ExperimentReadout => {
                "data_scientist"
            }
            JobKind::PlanSchedule => "editorial_board",
            JobKind::PhotoSelection | JobKind::PhotoBrief => "photo_desk",
            JobKind::OpsCheck => "it_engineer",
            JobKind::SeoPlan | JobKind::MarketingPlan | JobKind::Newsletter => "seo_marketing",
            JobKind::FinanceReport | JobKind::HiringAffordability => "cfo",
            JobKind::SecretaryTriage
            | JobKind::CeoBriefing
            | JobKind::DraftReply
            | JobKind::ThreadSummary => "secretary",
            JobKind::CandidateGeneration => "candidate_generation",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Executor {
    Browser,
    Claude,
    BrowserThenClaude,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct JobPolicy {
    pub executor: Executor,
    /// Minimum device tier for browser execution (required unless `claude`).
    #[serde(default)]
    pub min_tier: Option<Tier>,
    /// The role that normally performs the job; its prompt runs it and its
    /// `[roles.*]` profile is used when it goes to Claude.
    pub role: Role,
    /// Other roles that may perform it when the project team has nobody in
    /// `role` (e.g. the photographer selects photos without a photo editor).
    #[serde(default)]
    pub also: Vec<Role>,
    pub max_tokens: u32,
}

impl JobPolicy {
    /// Whether someone in `role` may perform this job.
    pub fn performed_by(&self, role: Role) -> bool {
        self.role == role || self.also.contains(&role)
    }
}

/// Model + effort + extras for a Claude-executed call.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ClaudeProfile {
    pub model: String,
    pub effort: Effort,
    #[serde(default)]
    pub web_search: bool,
    #[serde(default)]
    pub vision: bool,
}

/// Where a job runs right now.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Route {
    /// Offer to the connected browser worker.
    Browser { min_tier: Tier },
    /// Run on Claude (the in-game Agency).
    Claude {
        profile: ClaudeProfile,
        reason: ClaudeReason,
    },
    /// Wait until a capable browser connects ("morning rush").
    QueueForBrowser { min_tier: Tier },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClaudeReason {
    /// The job kind always runs on Claude.
    Policy,
    /// The connected device is below the job's minimum tier.
    DeviceTooWeak,
    /// The browser attempt failed (e.g. schema repair exhausted).
    BrowserFailed,
}

#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error("config parse error: {0}")]
    Parse(String),
    #[error("config invalid: {0}")]
    Invalid(String),
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawRoles {
    roles: BTreeMap<Role, ClaudeProfile>,
    seniority: BTreeMap<Seniority, String>,
    jobs: BTreeMap<JobKind, JobPolicy>,
}

/// Parsed and validated `config/roles.toml`.
#[derive(Debug, Clone)]
pub struct RolesConfig {
    roles: BTreeMap<Role, ClaudeProfile>,
    seniority: BTreeMap<Seniority, String>,
    jobs: BTreeMap<JobKind, JobPolicy>,
}

impl RolesConfig {
    pub fn builtin() -> Self {
        Self::from_toml_str(ROLES_TOML).expect("config/roles.toml is valid")
    }

    pub fn from_toml_str(s: &str) -> Result<Self, ConfigError> {
        let raw: RawRoles = toml::from_str(s).map_err(|e| ConfigError::Parse(e.to_string()))?;
        for role in Role::staff() {
            if !raw.roles.contains_key(&role) {
                return Err(ConfigError::Invalid(format!(
                    "staff role {role} has no [roles.{role}] profile"
                )));
            }
        }
        for &kind in JobKind::ALL {
            let p = raw
                .jobs
                .get(&kind)
                .ok_or_else(|| ConfigError::Invalid(format!("missing [jobs.{kind}]")))?;
            match p.executor {
                Executor::Claude => {}
                _ if p.min_tier.is_none() => {
                    return Err(ConfigError::Invalid(format!(
                        "[jobs.{kind}] runs in the browser but has no min_tier"
                    )))
                }
                _ => {}
            }
            for r in std::iter::once(&p.role).chain(&p.also) {
                if !r.is_agent() {
                    return Err(ConfigError::Invalid(format!(
                        "[jobs.{kind}] names {r}, which is not a staff role"
                    )));
                }
            }
            if p.also.contains(&p.role) {
                return Err(ConfigError::Invalid(format!(
                    "[jobs.{kind}] lists its own role {} in `also`",
                    p.role
                )));
            }
            if p.max_tokens == 0 {
                return Err(ConfigError::Invalid(format!(
                    "[jobs.{kind}] max_tokens must be positive"
                )));
            }
        }
        for s in Seniority::ALL {
            if !raw.seniority.contains_key(&s) {
                return Err(ConfigError::Invalid(format!(
                    "missing [seniority] {}",
                    s.as_str()
                )));
            }
        }
        for (role, p) in &raw.roles {
            if !role.is_agent() {
                return Err(ConfigError::Invalid(format!(
                    "role {role} is not an agent role"
                )));
            }
            if !claude::models::ALL.contains(&p.model.as_str()) {
                return Err(ConfigError::Invalid(format!(
                    "role {role}: unknown model {:?}",
                    p.model
                )));
            }
        }
        for m in raw.seniority.values() {
            if !claude::models::ALL.contains(&m.as_str()) {
                return Err(ConfigError::Invalid(format!(
                    "[seniority]: unknown model {m:?}"
                )));
            }
        }
        Ok(Self {
            roles: raw.roles,
            seniority: raw.seniority,
            jobs: raw.jobs,
        })
    }

    pub fn job(&self, kind: JobKind) -> &JobPolicy {
        &self.jobs[&kind]
    }

    /// Job kinds someone in `role` may perform (primary or `also`).
    pub fn jobs_for(&self, role: Role) -> Vec<JobKind> {
        self.jobs
            .iter()
            .filter(|(_, p)| p.performed_by(role))
            .map(|(k, _)| *k)
            .collect()
    }

    /// Claude profile for a role. When the call is made on behalf of a staff
    /// member, their seniority overrides the model (plan A); Agency
    /// contractors pass `None`.
    pub fn claude_profile(
        &self,
        role: Role,
        seniority: Option<Seniority>,
    ) -> Option<ClaudeProfile> {
        let mut p = self.roles.get(&role)?.clone();
        if let Some(s) = seniority {
            p.model = self.seniority[&s].clone();
        }
        Some(p)
    }

    /// Decides where a job runs.
    ///
    /// - `claude` jobs always go to Claude.
    /// - `browser` jobs never do: with no capable browser they queue.
    /// - `browser_then_claude` jobs run in a capable browser, escalate to
    ///   Claude when the connected device is too weak or the browser attempt
    ///   failed, and queue while no browser is connected.
    pub fn route(&self, kind: JobKind, device: Option<Tier>, browser_failed: bool) -> Route {
        let policy = self.job(kind);
        let profile = || {
            self.claude_profile(policy.role, None)
                .expect("validated in from_toml_str")
        };
        let min_tier = policy.min_tier.unwrap_or(Tier::Low);
        match policy.executor {
            Executor::Claude => Route::Claude {
                profile: profile(),
                reason: ClaudeReason::Policy,
            },
            Executor::Browser => match device {
                Some(t) if t >= min_tier && !browser_failed => Route::Browser { min_tier },
                _ => Route::QueueForBrowser { min_tier },
            },
            Executor::BrowserThenClaude => {
                if browser_failed {
                    return Route::Claude {
                        profile: profile(),
                        reason: ClaudeReason::BrowserFailed,
                    };
                }
                match device {
                    None => Route::QueueForBrowser { min_tier },
                    Some(t) if t >= min_tier => Route::Browser { min_tier },
                    Some(_) => Route::Claude {
                        profile: profile(),
                        reason: ClaudeReason::DeviceTooWeak,
                    },
                }
            }
        }
    }
}
