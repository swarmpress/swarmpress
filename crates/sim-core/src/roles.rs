//! Departments and roles (docs/game-design/organization.md §2, ADR-0028).
//!
//! Every [`Role`] belongs to exactly one [`Department`] ([`Role::department`]).
//! The kebab-case slugs ([`Role::slug`], [`Department::slug`]) are the names
//! used at every boundary (JSON views, persona TOML in `crates/agents`), and
//! are accepted as serde aliases so JSON commands can use either the Rust
//! variant name (`"Photographer"`) or the slug (`"photographer"`).
//!
//! Legacy roles map as: `MediaEditor` → [`Role::PhotoEditor`], `FrontendDev`
//! → [`Role::WebDeveloper`], `QaAnalyst` → [`Role::FactChecker`],
//! `Researcher` → [`Role::Analyst`].

use serde::{Deserialize, Serialize};

use crate::clock::hm;
use crate::staff::Schedule;

/// A person's home and discipline. Each person is in exactly one.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum Department {
    /// CFO and Executive Secretary: special powers, never staffed on projects.
    #[serde(alias = "executive-office")]
    ExecutiveOffice,
    #[serde(alias = "strategy")]
    Strategy,
    #[serde(alias = "editorial")]
    Editorial,
    #[serde(alias = "photo-video")]
    PhotoVideo,
    #[serde(alias = "web-development")]
    WebDevelopment,
    #[serde(alias = "it-operations")]
    ItOperations,
    #[serde(alias = "seo-marketing")]
    SeoMarketing,
}

impl Department {
    pub const ALL: [Department; 7] = [
        Department::ExecutiveOffice,
        Department::Strategy,
        Department::Editorial,
        Department::PhotoVideo,
        Department::WebDevelopment,
        Department::ItOperations,
        Department::SeoMarketing,
    ];

    /// kebab-case id used at the JSON boundary and in persona files.
    pub const fn slug(self) -> &'static str {
        match self {
            Department::ExecutiveOffice => "executive-office",
            Department::Strategy => "strategy",
            Department::Editorial => "editorial",
            Department::PhotoVideo => "photo-video",
            Department::WebDevelopment => "web-development",
            Department::ItOperations => "it-operations",
            Department::SeoMarketing => "seo-marketing",
        }
    }

    /// Display name.
    pub const fn name(self) -> &'static str {
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

    pub fn from_slug(s: &str) -> Option<Department> {
        Department::ALL.into_iter().find(|d| d.slug() == s)
    }
}

/// What a person does. Maps 1:1 to a [`Department`].
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum Role {
    // Executive Office
    #[serde(alias = "cfo")]
    Cfo,
    #[serde(alias = "secretary")]
    Secretary,
    // Strategy
    #[serde(alias = "strategist")]
    Strategist,
    #[serde(alias = "analyst")]
    Analyst,
    #[serde(alias = "data-scientist")]
    DataScientist,
    // Editorial
    #[serde(alias = "editor-in-chief")]
    EditorInChief,
    #[serde(alias = "editor")]
    Editor,
    #[serde(alias = "writer")]
    Writer,
    #[serde(alias = "translator")]
    Translator,
    #[serde(alias = "fact-checker")]
    FactChecker,
    // Photo & Video
    #[serde(alias = "photo-editor")]
    PhotoEditor,
    #[serde(alias = "photographer")]
    Photographer,
    #[serde(alias = "video-producer")]
    VideoProducer,
    // Web Development
    #[serde(alias = "art-director")]
    ArtDirector,
    #[serde(alias = "web-developer")]
    WebDeveloper,
    #[serde(alias = "ux-designer")]
    UxDesigner,
    // IT & Operations
    #[serde(alias = "it-engineer")]
    ItEngineer,
    #[serde(alias = "dev-ops", alias = "devops")]
    DevOps,
    // SEO & Marketing
    #[serde(alias = "seo-specialist")]
    SeoSpecialist,
    #[serde(alias = "marketing-manager")]
    MarketingManager,
    #[serde(alias = "social-media-manager")]
    SocialMediaManager,
}

impl Role {
    pub const ALL: [Role; 21] = [
        Role::Cfo,
        Role::Secretary,
        Role::Strategist,
        Role::Analyst,
        Role::DataScientist,
        Role::EditorInChief,
        Role::Editor,
        Role::Writer,
        Role::Translator,
        Role::FactChecker,
        Role::PhotoEditor,
        Role::Photographer,
        Role::VideoProducer,
        Role::ArtDirector,
        Role::WebDeveloper,
        Role::UxDesigner,
        Role::ItEngineer,
        Role::DevOps,
        Role::SeoSpecialist,
        Role::MarketingManager,
        Role::SocialMediaManager,
    ];

    /// The department this role belongs to.
    pub const fn department(self) -> Department {
        match self {
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
        }
    }

    /// The executive office is not a department projects are staffed from.
    pub const fn is_executive(self) -> bool {
        matches!(self, Role::Cfo | Role::Secretary)
    }

    /// Salary multiplier, permille.
    pub const fn pay_factor(self) -> i64 {
        match self {
            Role::Cfo => 1500,
            Role::EditorInChief => 1400,
            Role::ArtDirector => 1300,
            Role::Strategist | Role::DataScientist | Role::WebDeveloper | Role::DevOps => 1250,
            Role::UxDesigner | Role::ItEngineer => 1200,
            Role::Editor | Role::MarketingManager => 1150,
            Role::Analyst | Role::PhotoEditor | Role::VideoProducer | Role::SeoSpecialist => 1050,
            Role::Writer | Role::FactChecker | Role::Photographer => 1000,
            Role::Translator | Role::SocialMediaManager => 950,
            Role::Secretary => 900,
        }
    }

    /// Who leads a department when several people are in it: higher wins.
    pub const fn head_rank(self) -> u8 {
        match self {
            Role::Cfo
            | Role::EditorInChief
            | Role::Strategist
            | Role::ArtDirector
            | Role::PhotoEditor
            | Role::ItEngineer
            | Role::MarketingManager => 3,
            Role::Editor
            | Role::DataScientist
            | Role::WebDeveloper
            | Role::DevOps
            | Role::SeoSpecialist
            | Role::Photographer => 2,
            _ => 1,
        }
    }

    /// Default working hours (arrive, leave, lunch).
    pub const fn base_schedule(self) -> Schedule {
        match self {
            Role::Editor | Role::EditorInChief => Schedule::new(hm(8, 30), hm(18, 30), hm(12, 45)),
            Role::Cfo | Role::Secretary => Schedule::new(hm(8, 15), hm(17, 45), hm(12, 30)),
            Role::WebDeveloper | Role::ArtDirector | Role::UxDesigner | Role::DevOps => {
                Schedule::new(hm(9, 30), hm(18, 30), hm(13, 0))
            }
            _ => Schedule::new(hm(9, 0), hm(18, 0), hm(12, 30)),
        }
    }

    /// kebab-case name used at the JSON boundary and in persona files.
    pub const fn slug(self) -> &'static str {
        match self {
            Role::Cfo => "cfo",
            Role::Secretary => "secretary",
            Role::Strategist => "strategist",
            Role::Analyst => "analyst",
            Role::DataScientist => "data-scientist",
            Role::EditorInChief => "editor-in-chief",
            Role::Editor => "editor",
            Role::Writer => "writer",
            Role::Translator => "translator",
            Role::FactChecker => "fact-checker",
            Role::PhotoEditor => "photo-editor",
            Role::Photographer => "photographer",
            Role::VideoProducer => "video-producer",
            Role::ArtDirector => "art-director",
            Role::WebDeveloper => "web-developer",
            Role::UxDesigner => "ux-designer",
            Role::ItEngineer => "it-engineer",
            Role::DevOps => "dev-ops",
            Role::SeoSpecialist => "seo-specialist",
            Role::MarketingManager => "marketing-manager",
            Role::SocialMediaManager => "social-media-manager",
        }
    }

    pub fn from_slug(s: &str) -> Option<Role> {
        Role::ALL.into_iter().find(|r| r.slug() == s)
    }

    /// The role a legacy (pre-ADR-0028) role name maps to.
    pub fn from_legacy(s: &str) -> Option<Role> {
        match s {
            "media-editor" | "MediaEditor" => Some(Role::PhotoEditor),
            "frontend-dev" | "FrontendDev" => Some(Role::WebDeveloper),
            "qa-analyst" | "QaAnalyst" => Some(Role::FactChecker),
            "researcher" | "Researcher" => Some(Role::Analyst),
            _ => Role::from_slug(s),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_role_has_one_department_and_unique_slugs() {
        let mut slugs: Vec<_> = Role::ALL.iter().map(|r| r.slug()).collect();
        slugs.sort_unstable();
        slugs.dedup();
        assert_eq!(slugs.len(), Role::ALL.len());
        for r in Role::ALL {
            assert_eq!(Role::from_slug(r.slug()), Some(r));
            assert!(Department::ALL.contains(&r.department()));
            assert!(r.pay_factor() > 0);
        }
        for d in Department::ALL {
            assert!(Role::ALL.iter().any(|r| r.department() == d), "{d:?}");
            assert_eq!(Department::from_slug(d.slug()), Some(d));
        }
        assert_eq!(Role::DataScientist.department(), Department::Strategy);
        assert_eq!(Role::Cfo.department(), Department::ExecutiveOffice);
        assert!(Role::Secretary.is_executive() && !Role::Writer.is_executive());
    }

    #[test]
    fn legacy_roles_map() {
        assert_eq!(Role::from_legacy("media-editor"), Some(Role::PhotoEditor));
        assert_eq!(Role::from_legacy("FrontendDev"), Some(Role::WebDeveloper));
        assert_eq!(Role::from_legacy("qa-analyst"), Some(Role::FactChecker));
        assert_eq!(Role::from_legacy("researcher"), Some(Role::Analyst));
        assert_eq!(Role::from_legacy("writer"), Some(Role::Writer));
    }

    #[test]
    fn json_accepts_variant_names_and_slugs() {
        let a: Role = serde_json::from_str("\"Photographer\"").unwrap();
        let b: Role = serde_json::from_str("\"photographer\"").unwrap();
        let c: Role = serde_json::from_str("\"dev-ops\"").unwrap();
        assert_eq!(
            (a, b, c),
            (Role::Photographer, Role::Photographer, Role::DevOps)
        );
        let d: Department = serde_json::from_str("\"photo-video\"").unwrap();
        assert_eq!(d, Department::PhotoVideo);
    }
}
