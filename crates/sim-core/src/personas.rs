//! The numbers the sim needs from the persona catalog (ADR-0030).
//!
//! The catalog proper (bio, CV, hobbies, appearance) lives in
//! `crates/agents/personas/<slug>.toml` and never enters the sim. This table
//! mirrors only stable keys and numbers: `id` (the TOML `id`), `key` (the TOML
//! `slug`), a display name and colour for the dollhouse, role, seniority and
//! asking salary. Ids 1..=13 are the cinqueterre.travel starting company
//! (organization.md §10); ids from 101 are the seed hiring pool.

use crate::ids::PersonaId;
use crate::roles::Role;
use crate::staff::Seniority;

/// A catalog entry, as far as the sim is concerned.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Persona {
    /// Stable catalog id (TOML `id`).
    pub id: u16,
    /// Stable slug (TOML `slug`, also the file name).
    pub key: &'static str,
    pub name: &'static str,
    /// sRGB colour, 0xRRGGBB.
    pub color: u32,
    pub role: Role,
    pub seniority: Seniority,
    /// Asking salary, euros per month (TOML `salary_eur_month`).
    pub salary_eur_month: i64,
    pub specialty: &'static str,
}

impl Persona {
    pub const fn persona_id(&self) -> PersonaId {
        PersonaId(self.id)
    }

    /// Asking salary converted to the sim's unit: cents per game day
    /// (a month is 30 game days).
    pub const fn salary_cents_per_day(&self) -> i64 {
        self.salary_eur_month * 100 / 30
    }
}

#[allow(clippy::too_many_arguments)]
const fn p(
    id: u16,
    key: &'static str,
    name: &'static str,
    color: u32,
    role: Role,
    seniority: Seniority,
    salary_eur_month: i64,
    specialty: &'static str,
) -> Persona {
    Persona {
        id,
        key,
        name,
        color,
        role,
        seniority,
        salary_eur_month,
        specialty,
    }
}

/// The house roster (ids 1..=13) and the seed hiring pool (101..).
#[rustfmt::skip]
pub const PERSONAS: [Persona; 21] = [
    p(1, "giulia", "Giulia", 0x8064a2, Role::Writer, Seniority::Senior, 4200, "Food & culture writer"),
    p(2, "isabella", "Isabella", 0xc0504d, Role::Writer, Seniority::Senior, 4000, "Outdoors & hiking writer"),
    p(3, "lorenzo", "Lorenzo", 0x4f81bd, Role::Writer, Seniority::Senior, 4000, "History & culture writer"),
    p(4, "sophia", "Sophia", 0x9bbb59, Role::EditorInChief, Seniority::Senior, 6000, "Editorial leader"),
    p(5, "marco", "Marco", 0xf79646, Role::Editor, Seniority::Senior, 5000, "Senior editor, practical information"),
    p(6, "francesca", "Francesca", 0x4bacc6, Role::Photographer, Seniority::Senior, 4200, "Visual storyteller and photographer"),
    p(7, "elena", "Elena Marchetti", 0x604a7b, Role::Cfo, Seniority::Senior, 7000, "Chief financial officer"),
    p(8, "paolo", "Paolo Bianchi", 0x7f7f7f, Role::Secretary, Seniority::Mid, 3200, "Executive secretary"),
    p(9, "chiara", "Chiara Galli", 0xd99694, Role::Strategist, Seniority::Senior, 5200, "Content strategist"),
    p(10, "luca", "Luca Moretti", 0x77933c, Role::WebDeveloper, Seniority::Mid, 4500, "Web developer, Astro themes"),
    p(11, "davide", "Davide Conti", 0xb65708, Role::ItEngineer, Seniority::Mid, 4300, "IT engineer, deploys and uptime"),
    p(12, "alessia", "Alessia Ferri", 0x31859c, Role::SeoSpecialist, Seniority::Mid, 4000, "SEO & marketing specialist"),
    p(13, "matteo", "Matteo Greco", 0x2c4d75, Role::DataScientist, Seniority::Senior, 5000, "Data scientist, first-party analytics"),
    // seed hiring pool
    p(101, "alessandro", "Alessandro", 0x1f497d, Role::SeoSpecialist, Seniority::Mid, 3800, "Search and structure"),
    p(102, "valentina", "Valentina", 0x8db3e2, Role::Analyst, Seniority::Mid, 3600, "Local sources and opening hours"),
    p(103, "sara", "Sara", 0xc3d69b, Role::Writer, Seniority::Junior, 2800, "Hiking and trails"),
    p(104, "tommaso", "Tommaso", 0x948a54, Role::Photographer, Seniority::Mid, 3500, "Landscape photographer"),
    p(105, "bianca", "Bianca", 0xe46c0a, Role::Translator, Seniority::Mid, 3300, "German and French translation"),
    p(106, "nicolo", "Nicolò", 0x4a452a, Role::FactChecker, Seniority::Junior, 2700, "Fact checking and link hygiene"),
    p(107, "greta", "Greta", 0xb7dde8, Role::UxDesigner, Seniority::Mid, 4100, "Typography and mood boards"),
    p(108, "riccardo", "Riccardo", 0x632523, Role::PhotoEditor, Seniority::Senior, 4600, "Photo desk, captions and alt text"),
];

/// Persona by catalog id.
pub fn persona(id: PersonaId) -> Option<&'static Persona> {
    PERSONAS.iter().find(|p| p.id == id.0)
}

/// Persona id by slug.
pub fn persona_by_key(key: &str) -> Option<PersonaId> {
    PERSONAS
        .iter()
        .find(|p| p.key == key)
        .map(Persona::persona_id)
}

/// The persona's slug, or `persona-<n>` for ids the table does not know
/// (for example LLM-generated candidates that live only in the server's
/// catalog).
pub fn persona_slug(id: PersonaId) -> String {
    persona(id).map_or_else(|| format!("persona-{}", id.0), |p| p.key.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_and_slugs_are_unique_and_stable() {
        for (i, a) in PERSONAS.iter().enumerate() {
            for b in &PERSONAS[i + 1..] {
                assert_ne!(a.id, b.id);
                assert_ne!(a.key, b.key);
            }
        }
        let house = [
            "giulia",
            "isabella",
            "lorenzo",
            "sophia",
            "marco",
            "francesca",
            "elena",
            "paolo",
            "chiara",
            "luca",
            "davide",
            "alessia",
            "matteo",
        ];
        for (i, key) in house.iter().enumerate() {
            let id = PersonaId(u16::try_from(i + 1).unwrap());
            assert_eq!(persona_by_key(key), Some(id));
            assert_eq!(persona_slug(id), *key);
        }
        assert_eq!(persona_slug(PersonaId(999)), "persona-999");
        assert_eq!(persona(PersonaId(7)).unwrap().role, Role::Cfo);
        assert_eq!(
            persona(PersonaId(1)).unwrap().salary_cents_per_day(),
            14_000
        );
    }
}
