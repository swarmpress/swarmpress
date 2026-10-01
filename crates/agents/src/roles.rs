//! Roles, seniority, traits, device tiers, job kinds and executor policies
//! (`config/roles.toml`).

use std::collections::BTreeMap;
use std::fmt;
use std::str::FromStr;

use claude::Effort;
use serde::{Deserialize, Serialize};

/// Built-in copy of `config/roles.toml`.
pub const ROLES_TOML: &str = include_str!("../../../config/roles.toml");

/// Organizational role. Also the actor vocabulary of the state machines.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Role {
    EditorInChief,
    Writer,
    Editor,
    Qa,
    ArtDirector,
    FrontendDev,
    Seo,
    Linker,
    Researcher,
    Media,
    Translator,
    Chatter,
    Critic,
    /// The human player.
    Ceo,
    /// The server orchestrator / deploy webhook (not an LLM).
    System,
}

impl Role {
    pub const ALL: [Role; 15] = [
        Role::EditorInChief,
        Role::Writer,
        Role::Editor,
        Role::Qa,
        Role::ArtDirector,
        Role::FrontendDev,
        Role::Seo,
        Role::Linker,
        Role::Researcher,
        Role::Media,
        Role::Translator,
        Role::Chatter,
        Role::Critic,
        Role::Ceo,
        Role::System,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            Role::EditorInChief => "editor_in_chief",
            Role::Writer => "writer",
            Role::Editor => "editor",
            Role::Qa => "qa",
            Role::ArtDirector => "art_director",
            Role::FrontendDev => "frontend_dev",
            Role::Seo => "seo",
            Role::Linker => "linker",
            Role::Researcher => "researcher",
            Role::Media => "media",
            Role::Translator => "translator",
            Role::Chatter => "chatter",
            Role::Critic => "critic",
            Role::Ceo => "ceo",
            Role::System => "system",
        }
    }

    /// Whether this role is staffed by an LLM (CEO and System are not).
    pub fn is_agent(self) -> bool {
        !matches!(self, Role::Ceo | Role::System)
    }
}

impl fmt::Display for Role {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for Role {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Role::ALL
            .into_iter()
            .find(|r| r.as_str() == s)
            .ok_or_else(|| format!("unknown role {s:?}"))
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

/// Every kind of LLM job the orchestrator can request.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum JobKind {
    Standup,
    Brief,
    Draft,
    Revise,
    EditReview,
    QaCoherence,
    Translate,
    Research,
    ArtDirection,
    ThemeCode,
    VisualReview,
    CriticReview,
}

impl JobKind {
    pub const ALL: [JobKind; 12] = [
        JobKind::Standup,
        JobKind::Brief,
        JobKind::Draft,
        JobKind::Revise,
        JobKind::EditReview,
        JobKind::QaCoherence,
        JobKind::Translate,
        JobKind::Research,
        JobKind::ArtDirection,
        JobKind::ThemeCode,
        JobKind::VisualReview,
        JobKind::CriticReview,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            JobKind::Standup => "standup",
            JobKind::Brief => "brief",
            JobKind::Draft => "draft",
            JobKind::Revise => "revise",
            JobKind::EditReview => "edit_review",
            JobKind::QaCoherence => "qa_coherence",
            JobKind::Translate => "translate",
            JobKind::Research => "research",
            JobKind::ArtDirection => "art_direction",
            JobKind::ThemeCode => "theme_code",
            JobKind::VisualReview => "visual_review",
            JobKind::CriticReview => "critic_review",
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
    pub role: Role,
    pub max_tokens: u32,
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
        for kind in JobKind::ALL {
            let p = raw
                .jobs
                .get(&kind)
                .ok_or_else(|| ConfigError::Invalid(format!("missing [jobs.{}]", kind.as_str())))?;
            match p.executor {
                Executor::Claude => {}
                _ if p.min_tier.is_none() => {
                    return Err(ConfigError::Invalid(format!(
                        "[jobs.{}] runs in the browser but has no min_tier",
                        kind.as_str()
                    )))
                }
                _ => {}
            }
            if !raw.roles.contains_key(&p.role) {
                return Err(ConfigError::Invalid(format!(
                    "[jobs.{}] uses role {} which has no [roles.{}] profile",
                    kind.as_str(),
                    p.role,
                    p.role
                )));
            }
        }
        for s in [
            Seniority::Junior,
            Seniority::Mid,
            Seniority::Senior,
            Seniority::Star,
        ] {
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
        Ok(Self {
            roles: raw.roles,
            seniority: raw.seniority,
            jobs: raw.jobs,
        })
    }

    pub fn job(&self, kind: JobKind) -> &JobPolicy {
        &self.jobs[&kind]
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
