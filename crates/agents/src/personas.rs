//! The persona catalog (ADR-0030, docs/game-design/organization.md §3): one
//! TOML file per person in `crates/agents/personas/<slug>.toml`, for staff
//! (ids 1–99) and the hiring pool (ids 100+), plus the prompt formatters
//! (ported from `formatPersonaForPrompt` / `formatWritingStyleForPrompt` in
//! legacy `agent-personas.ts` and extended with CV, life and relationships).
//!
//! The deterministic sim stores only `PersonaId` and the numbers it needs
//! (traits, seniority, salary); everything human lives here.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::roles::{ConfigError, Department, Role, Seniority, Traits};

/// Persona ids at or above this are the hiring pool; below are the starting
/// staff of the reference company (cinqueterre.travel).
pub const POOL_ID_START: u16 = 100;

/// Catalog schema version (organization.md §3 is v2; the six legacy writer
/// personas were v1).
pub const SCHEMA_VERSION: u32 = 2;

macro_rules! builtin_personas {
    ($($slug:literal),+ $(,)?) => {
        /// Every built-in persona file, `(slug, TOML source)`.
        pub const BUILTIN: &[(&str, &str)] = &[
            $(($slug, include_str!(concat!("../personas/", $slug, ".toml")))),+
        ];
    };
}

builtin_personas![
    // cinqueterre.travel starting company (organization.md §10)
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
    // hiring pool
    "valentina",
    "amara",
    "jonas",
    "chloe",
    "kenji",
    "ines",
    "rafael",
    "noor",
    "tomasz",
    "saoirse",
    "olusegun",
    "freya",
    "aarav",
    "beatrice",
    "liam",
    "yasmin",
    "andrei",
    "hanna",
];

/// Writing style (legacy `WritingStyle`) plus the legacy voice data. Style
/// values are the legacy enum strings; unknown values are kept but produce no
/// guideline line (as in legacy).
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WritingStyle {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tone: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vocabulary_level: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sentence_length: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub formality: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub humor: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub emoji_usage: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub perspective: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub descriptive_style: Option<String>,
    /// Legacy `voice_characteristics`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub voice: Vec<String>,
    /// Legacy `content_preferences`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preferences: Option<ContentPreferences>,
    /// Language code → phrases. When present, `en` is required (fallback).
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub sample_phrases: BTreeMap<String, Vec<String>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ContentPreferences {
    pub opening_style: String,
    pub structure_preference: String,
    pub closing_style: String,
    pub favorite_topics: Vec<String>,
    pub avoid_topics: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Education {
    pub years: String,
    pub what: String,
    #[serde(rename = "where")]
    pub institution: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Experience {
    pub years: String,
    pub role: String,
    pub org: String,
    pub highlights: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Cv {
    pub education: Vec<Education>,
    pub experience: Vec<Experience>,
    pub skills: Vec<String>,
    #[serde(default)]
    pub awards: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Life {
    pub hobbies: Vec<String>,
    pub interests: Vec<String>,
    pub quirks: Vec<String>,
    pub likes: Vec<String>,
    pub dislikes: Vec<String>,
    pub work_style: String,
    /// 2–4 personal/work values ("craft over speed", "local first"); used by
    /// meetings and the living-people layer (living-people doc §1). Kept in
    /// `[life]` because they are part of who the person is outside the job.
    pub values: Vec<String>,
}

/// How much a person follows the news.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum NewsInterest {
    Low,
    Medium,
    High,
}

impl NewsInterest {
    pub fn as_str(self) -> &'static str {
        match self {
            NewsInterest::Low => "low",
            NewsInterest::Medium => "medium",
            NewsInterest::High => "high",
        }
    }
}

/// How the person relates to the world outside the office (ADR-0035): what
/// they follow and chat about, and the (always civil, non-partisan) tone
/// they take on current events. No political affiliations, ever.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct World {
    pub news_interest: NewsInterest,
    pub topics: Vec<String>,
    pub tone_on_current_events: String,
}

/// Words that signal a political affiliation or partisan stance; persona
/// `[world]` and `life.values` must not contain them (ADR-0035 guardrails).
pub const PARTISAN_MARKERS: &[&str] = &[
    "party",
    "partito",
    "left-wing",
    "right-wing",
    "conservative",
    "progressive",
    "socialist",
    "communist",
    "fascist",
    "liberal",
    "populist",
    "voter",
    "votes for",
];

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Relationships {
    #[serde(default)]
    pub friends: Vec<String>,
    #[serde(default)]
    pub friction: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Appearance {
    /// `#rrggbb`, drives the 3D character variant (M9).
    pub palette: String,
    pub description: String,
}

/// A person (organization.md §3).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Persona {
    /// Stable key; also the file name.
    pub slug: String,
    /// `PersonaId`, unique across the catalog.
    pub id: u16,
    pub name: String,
    /// Stated, never inferred from the name.
    pub pronouns: String,
    pub age: u8,
    pub hometown: String,
    pub department: Department,
    pub role: Role,
    pub title: String,
    pub seniority: Seniority,
    /// Asking salary; the sim converts to cents/day.
    pub salary_eur_month: u32,
    pub languages: Vec<String>,
    /// Topics and page types this person is the go-to for (work routing;
    /// the legacy `agent-page-mapping.ts`).
    pub affinities: Vec<String>,
    /// One line for hiring cards and the org chart.
    pub pitch: String,
    /// `"MM-DD"`.
    pub birthday: String,
    /// `"MM-DD"`, where the person's culture celebrates name days (Italian
    /// onomastico, Polish imieniny, Romanian onomastică …).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name_day: Option<String>,
    /// First-person paragraph.
    pub bio: String,
    pub cv: Cv,
    pub life: Life,
    pub traits: Traits,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub writing_style: Option<WritingStyle>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub relationships: Option<Relationships>,
    pub family: Family,
    /// Occasion (snake_case: `christmas`, `new_year`, `epiphany`, `easter`,
    /// `ferragosto`, `birthday`, `name_day`, or a personal/cultural one such
    /// as `diwali` or `midsummer`) → how this person celebrates it. Holidays
    /// the person doesn't celebrate are simply absent.
    pub traditions: BTreeMap<String, String>,
    pub world: World,
    pub appearance: Appearance,
}

/// Household and key people, briefly and kindly.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Family {
    pub household: String,
    #[serde(default)]
    pub key_people: Vec<String>,
}

/// Tradition keys that fall on a fixed calendar date.
pub fn fixed_date_occasions(month: u8, day: u8) -> &'static [&'static str] {
    match (month, day) {
        (1, 1) => &["new_year"],
        (1, 6) => &["epiphany"],
        (3, 17) => &["st_patricks_day"],
        (6, 13) => &["santo_antonio"],
        (7, 14) => &["bastille_day"],
        (8, 15) => &["ferragosto"],
        (9, 19) => &["san_gennaro"],
        (10, 31) => &["samhain"],
        (11, 5) => &["bonfire_night"],
        (12, 13) => &["lucia"],
        (12, 24) | (12, 25) => &["christmas"],
        (12, 31) => &["new_year"],
        _ => &[],
    }
}

/// Parses `"MM-DD"` into `(month, day)` (Feb 29 allowed).
pub fn parse_month_day(s: &str) -> Option<(u8, u8)> {
    let (m, d) = s.split_once('-')?;
    if m.len() != 2 || d.len() != 2 {
        return None;
    }
    let (m, d): (u8, u8) = (m.parse().ok()?, d.parse().ok()?);
    let max = match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => 29,
        _ => return None,
    };
    (1..=max).contains(&d).then_some((m, d))
}

fn blank(s: &str) -> bool {
    s.trim().is_empty()
}

/// Parses `"2005–2008"`, `"2019–present"` or `"2012"` (hyphen or en dash)
/// into `(start, end)`; `present` is 2026.
fn parse_years(s: &str) -> Option<(u16, u16)> {
    const NOW: u16 = 2026;
    let year = |t: &str| -> Option<u16> {
        let t = t.trim();
        if t.eq_ignore_ascii_case("present") {
            return Some(NOW);
        }
        if t.len() != 4 || !t.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        t.parse().ok().filter(|y| (1950..=NOW).contains(y))
    };
    let mut parts = s.split(['–', '-']);
    let a = year(parts.next()?)?;
    let b = match parts.next() {
        Some(p) => year(p)?,
        None => a,
    };
    if parts.next().is_some() || a > b {
        return None;
    }
    Some((a, b))
}

fn check_list(e: &mut Vec<String>, field: &str, v: &[String], min: usize) {
    if v.len() < min {
        e.push(format!(
            "{field} needs at least {min} entr{}",
            if min == 1 { "y" } else { "ies" }
        ));
    }
    if v.iter().any(|s| blank(s)) {
        e.push(format!("{field} has an empty entry"));
    }
}

fn is_slug(s: &str) -> bool {
    let b = s.as_bytes();
    (2..=32).contains(&b.len())
        && b[0].is_ascii_lowercase()
        && b.iter()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == b'-')
        && !s.ends_with('-')
}

fn is_hex_colour(s: &str) -> bool {
    s.len() == 7 && s.starts_with('#') && s[1..].bytes().all(|c| c.is_ascii_hexdigit())
}

impl Persona {
    /// Parses and validates one persona (schema errors and field rules; the
    /// catalog checks cross-references).
    pub fn from_toml_str(s: &str) -> Result<Self, ConfigError> {
        let p: Persona = toml::from_str(s).map_err(|e| ConfigError::Parse(e.to_string()))?;
        p.validate().map_err(|errs| {
            ConfigError::Invalid(format!("persona {}: {}", p.slug, errs.join("; ")))
        })?;
        Ok(p)
    }

    /// Parses a persona from the JSON form (snake_case keys, the TOML
    /// structure; what [`crate::jobs::hiring`] asks the model for).
    pub fn from_json_value(v: &Value) -> Result<Self, Vec<String>> {
        let p: Persona = serde_json::from_value(v.clone()).map_err(|e| vec![e.to_string()])?;
        p.validate()?;
        Ok(p)
    }

    /// Serializes back to the catalog's TOML format.
    pub fn to_toml_string(&self) -> Result<String, ConfigError> {
        toml::to_string(self).map_err(|e| ConfigError::Parse(e.to_string()))
    }

    /// Field-level rules (organization.md §3). Returns every problem found.
    pub fn validate(&self) -> Result<(), Vec<String>> {
        let mut e = Vec::new();
        let mut req = |field: &str, v: &str| {
            if blank(v) {
                e.push(format!("{field} must not be empty"));
            }
        };
        req("name", &self.name);
        req("pronouns", &self.pronouns);
        req("hometown", &self.hometown);
        req("title", &self.title);
        req("pitch", &self.pitch);
        req("bio", &self.bio);
        req("life.work_style", &self.life.work_style);
        req("appearance.description", &self.appearance.description);

        if !is_slug(&self.slug) {
            e.push(format!(
                "slug {:?} must be 2–32 chars of a-z, 0-9 and '-', starting with a letter",
                self.slug
            ));
        }
        if self.id == 0 {
            e.push("id must be at least 1".into());
        }
        if !(18..=80).contains(&self.age) {
            e.push(format!("age {} is outside 18..=80", self.age));
        }
        if self.pitch.chars().count() > 160 {
            e.push("pitch must be one line of at most 160 characters".into());
        }
        if self.pronouns.contains('\n') || !self.pronouns.contains('/') {
            e.push(format!(
                "pronouns {:?} must be stated like \"she/her\"",
                self.pronouns
            ));
        }
        match (self.role.department(), self.role.salary_band_eur_month()) {
            (Some(d), Some((lo, hi))) => {
                if d != self.department {
                    e.push(format!(
                        "department {} does not match role {} (which is in {d})",
                        self.department, self.role
                    ));
                }
                if !(lo..=hi).contains(&self.salary_eur_month) {
                    e.push(format!(
                        "salary_eur_month {} is outside the {} band {lo}..={hi}",
                        self.salary_eur_month, self.role
                    ));
                }
            }
            _ => e.push(format!("role {} is not a staff role", self.role)),
        }
        check_list(&mut e, "languages", &self.languages, 1);
        check_list(&mut e, "affinities", &self.affinities, 1);
        check_list(&mut e, "cv.skills", &self.cv.skills, 1);
        check_list(&mut e, "cv.awards", &self.cv.awards, 0);
        check_list(&mut e, "life.hobbies", &self.life.hobbies, 1);
        check_list(&mut e, "life.interests", &self.life.interests, 1);
        check_list(&mut e, "life.quirks", &self.life.quirks, 1);
        check_list(&mut e, "life.likes", &self.life.likes, 1);
        check_list(&mut e, "life.dislikes", &self.life.dislikes, 1);
        check_list(&mut e, "life.values", &self.life.values, 2);
        check_list(&mut e, "family.key_people", &self.family.key_people, 0);
        if blank(&self.family.household) {
            e.push("family.household must not be empty".into());
        }
        if parse_month_day(&self.birthday).is_none() {
            e.push(format!("birthday {:?} must be MM-DD", self.birthday));
        }
        if let Some(nd) = &self.name_day {
            if parse_month_day(nd).is_none() {
                e.push(format!("name_day {nd:?} must be MM-DD"));
            }
        }
        if self.traditions.len() < 2 {
            e.push("traditions needs at least 2 occasions".into());
        }
        for (k, v) in &self.traditions {
            let ok_key = k.starts_with(|c: char| c.is_ascii_lowercase())
                && k.chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_');
            if !ok_key {
                e.push(format!("traditions key {k:?} must be snake_case"));
            }
            if blank(v) {
                e.push(format!("traditions.{k} must not be empty"));
            }
        }
        if self.traditions.contains_key("name_day") && self.name_day.is_none() {
            e.push("traditions.name_day needs a name_day date".into());
        }
        check_list(&mut e, "world.topics", &self.world.topics, 1);
        if self.life.values.len() > 4 {
            e.push("life.values takes 2–4 entries".into());
        }
        if blank(&self.world.tone_on_current_events)
            || self.world.tone_on_current_events.contains('\n')
        {
            e.push("world.tone_on_current_events must be one non-empty line".into());
        }
        let partisan = |s: &str| {
            let l = s.to_lowercase();
            PARTISAN_MARKERS.iter().find(|m| {
                l.split(|c: char| !c.is_alphanumeric() && c != '-')
                    .collect::<Vec<_>>()
                    .windows(m.split(' ').count())
                    .any(|w| w.join(" ") == **m)
            })
        };
        for s in self
            .world
            .topics
            .iter()
            .chain(&self.life.values)
            .chain(std::iter::once(&self.world.tone_on_current_events))
        {
            if let Some(m) = partisan(s) {
                e.push(format!(
                    "{s:?} reads as a political affiliation ({m:?}); personas stay non-partisan"
                ));
            }
        }
        if self
            .affinities
            .iter()
            .any(|a| a.trim() != a || a.to_lowercase() != *a)
        {
            e.push("affinities must be lowercase and trimmed".into());
        }
        if self.cv.education.is_empty() {
            e.push("cv.education needs at least 1 entry".into());
        }
        if self.cv.experience.len() < 2 {
            e.push("cv.experience needs at least 2 entries".into());
        }
        for (i, ed) in self.cv.education.iter().enumerate() {
            if parse_years(&ed.years).is_none() {
                e.push(format!(
                    "cv.education[{i}].years {:?} is not a year range",
                    ed.years
                ));
            }
            if blank(&ed.what) || blank(&ed.institution) {
                e.push(format!("cv.education[{i}] needs what and where"));
            }
        }
        for (i, x) in self.cv.experience.iter().enumerate() {
            if parse_years(&x.years).is_none() {
                e.push(format!(
                    "cv.experience[{i}].years {:?} is not a year range",
                    x.years
                ));
            }
            if blank(&x.role) || blank(&x.org) {
                e.push(format!("cv.experience[{i}] needs role and org"));
            }
            if x.highlights.is_empty() || x.highlights.iter().any(|h| blank(h)) {
                e.push(format!("cv.experience[{i}] needs non-empty highlights"));
            }
        }
        if let Err(t) = self.traits.validate() {
            e.push(t);
        }
        if matches!(self.role, Role::Writer | Role::Editor | Role::EditorInChief)
            && self.writing_style.is_none()
        {
            e.push(format!("a {} needs [writing_style]", self.role));
        }
        if let Some(ws) = &self.writing_style {
            if !ws.sample_phrases.is_empty() && !ws.sample_phrases.contains_key("en") {
                e.push("writing_style.sample_phrases needs `en` (fallback language)".into());
            }
        }
        if let Some(r) = &self.relationships {
            for s in r.friends.iter().chain(&r.friction) {
                if *s == self.slug {
                    e.push("relationships must not reference the persona itself".into());
                }
            }
            if let Some(both) = r.friends.iter().find(|f| r.friction.contains(f)) {
                e.push(format!("{both} is listed as both friend and friction"));
            }
        }
        if !is_hex_colour(&self.appearance.palette) {
            e.push(format!(
                "appearance.palette {:?} must be #rrggbb",
                self.appearance.palette
            ));
        }
        if e.is_empty() {
            Ok(())
        } else {
            Err(e)
        }
    }

    /// A built-in persona by slug (staff or pool).
    pub fn builtin(slug: &str) -> Option<Persona> {
        Catalog::builtin().get(slug).cloned()
    }

    /// Whether this persona is a hiring candidate rather than starting staff.
    pub fn in_pool(&self) -> bool {
        self.id >= POOL_ID_START
    }

    /// First name, for transcripts.
    pub fn first_name(&self) -> &str {
        self.name.split_whitespace().next().unwrap_or(&self.name)
    }

    pub fn phrases(&self, language: &str) -> &[String] {
        self.writing_style
            .as_ref()
            .and_then(|ws| {
                ws.sample_phrases
                    .get(language)
                    .or_else(|| ws.sample_phrases.get("en"))
            })
            .map(Vec::as_slice)
            .unwrap_or(&[])
    }

    /// How this person celebrates `occasion` (a [`Persona::traditions`] key),
    /// for small-talk prompts that inject only the relevant tradition.
    /// `None` when they don't celebrate it.
    pub fn traditions_for(&self, occasion: &str) -> Option<&str> {
        self.traditions.get(occasion).map(String::as_str)
    }

    /// The occasions this person has on a given date (`month`, `day`): their
    /// birthday and name day, plus fixed-date holidays they celebrate (see
    /// [`fixed_date_occasions`]). Movable feasts (Easter, Diwali, Eid …) are
    /// resolved by the caller's calendar and looked up with
    /// [`Persona::traditions_for`].
    pub fn occasions_on(&self, month: u8, day: u8) -> Vec<&str> {
        let mut out = Vec::new();
        if parse_month_day(&self.birthday) == Some((month, day)) {
            out.push("birthday");
        }
        if self.name_day.as_deref().and_then(parse_month_day) == Some((month, day)) {
            out.push("name_day");
        }
        for occ in fixed_date_occasions(month, day) {
            if self.traditions.contains_key(*occ) && !out.contains(occ) {
                out.push(occ);
            }
        }
        out
    }

    pub fn friends(&self) -> &[String] {
        self.relationships
            .as_ref()
            .map_or(&[], |r| r.friends.as_slice())
    }

    pub fn friction(&self) -> &[String] {
        self.relationships
            .as_ref()
            .map_or(&[], |r| r.friction.as_slice())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("persona catalog invalid: {}", .0.join("; "))]
pub struct CatalogError(pub Vec<String>);

/// The validated persona catalog (staff + hiring pool), ordered by id.
#[derive(Debug, Clone, PartialEq)]
pub struct Catalog {
    personas: Vec<Persona>,
}

impl Catalog {
    /// The built-in catalog (`crates/agents/personas/*.toml`).
    pub fn builtin() -> &'static Catalog {
        static CATALOG: OnceLock<Catalog> = OnceLock::new();
        CATALOG.get_or_init(|| {
            Catalog::from_sources(BUILTIN.iter().copied())
                .expect("built-in persona catalog is valid")
        })
    }

    /// Builds a catalog from `(file stem, TOML)` pairs. Checks every file and
    /// returns all problems: schema, field rules, slug = file name, unique
    /// ids/slugs/names, relationship targets exist.
    pub fn from_sources<'a>(
        sources: impl IntoIterator<Item = (&'a str, &'a str)>,
    ) -> Result<Catalog, CatalogError> {
        let mut errors = Vec::new();
        let mut personas = Vec::new();
        for (stem, src) in sources {
            match Persona::from_toml_str(src) {
                Ok(p) => {
                    if p.slug != stem {
                        errors.push(format!(
                            "{stem}.toml: slug {:?} must match the file name",
                            p.slug
                        ));
                    }
                    personas.push(p);
                }
                Err(e) => errors.push(format!("{stem}.toml: {e}")),
            }
        }
        match Catalog::from_personas(personas) {
            Ok(c) if errors.is_empty() => Ok(c),
            Ok(_) => Err(CatalogError(errors)),
            Err(CatalogError(more)) => {
                errors.extend(more);
                Err(CatalogError(errors))
            }
        }
    }

    /// Builds a catalog from already-parsed personas (cross-checks only plus
    /// each persona's own rules).
    pub fn from_personas(mut personas: Vec<Persona>) -> Result<Catalog, CatalogError> {
        let mut errors = Vec::new();
        for p in &personas {
            if let Err(e) = p.validate() {
                errors.push(format!("{}: {}", p.slug, e.join("; ")));
            }
        }
        let mut ids = BTreeSet::new();
        let mut slugs = BTreeSet::new();
        let mut names = BTreeSet::new();
        for p in &personas {
            if !ids.insert(p.id) {
                errors.push(format!("duplicate id {} ({})", p.id, p.slug));
            }
            if !slugs.insert(p.slug.as_str()) {
                errors.push(format!("duplicate slug {}", p.slug));
            }
            if !names.insert(p.name.to_lowercase()) {
                errors.push(format!("duplicate name {:?} ({})", p.name, p.slug));
            }
        }
        for p in &personas {
            for r in p.friends().iter().chain(p.friction()) {
                if !slugs.contains(r.as_str()) {
                    errors.push(format!("{}: relationship to unknown persona {r:?}", p.slug));
                }
            }
        }
        if !errors.is_empty() {
            return Err(CatalogError(errors));
        }
        personas.sort_by_key(|p| p.id);
        Ok(Catalog { personas })
    }

    pub fn all(&self) -> &[Persona] {
        &self.personas
    }

    pub fn get(&self, slug: &str) -> Option<&Persona> {
        self.personas.iter().find(|p| p.slug == slug)
    }

    pub fn by_id(&self, id: u16) -> Option<&Persona> {
        self.personas.iter().find(|p| p.id == id)
    }

    /// Starting staff (ids below [`POOL_ID_START`]).
    pub fn staff(&self) -> impl Iterator<Item = &Persona> {
        self.personas.iter().filter(|p| !p.in_pool())
    }

    /// Hiring candidates (ids from [`POOL_ID_START`]).
    pub fn pool(&self) -> impl Iterator<Item = &Persona> {
        self.personas.iter().filter(|p| p.in_pool())
    }

    pub fn with_role(&self, role: Role) -> impl Iterator<Item = &Persona> {
        self.personas.iter().filter(move |p| p.role == role)
    }

    /// The next free pool id (for generated candidates).
    pub fn next_pool_id(&self) -> u16 {
        self.pool().map(|p| p.id + 1).max().unwrap_or(POOL_ID_START)
    }

    /// Checks that a new candidate fits into this catalog: own rules, plus no
    /// clash with an existing id, slug or name, and relationships that point
    /// at existing people (ADR-0030: duplicates and incomplete profiles are
    /// rejected before they enter the pool).
    pub fn admit(&self, candidate: &Persona) -> Result<(), Vec<String>> {
        let mut e = candidate.validate().err().unwrap_or_default();
        if candidate.id < POOL_ID_START {
            e.push(format!(
                "candidate id {} must be ≥ {POOL_ID_START}",
                candidate.id
            ));
        }
        if self.by_id(candidate.id).is_some() {
            e.push(format!("id {} is already taken", candidate.id));
        }
        if self.get(&candidate.slug).is_some() {
            e.push(format!("slug {:?} is already taken", candidate.slug));
        }
        if self
            .personas
            .iter()
            .any(|p| p.name.eq_ignore_ascii_case(&candidate.name))
        {
            e.push(format!(
                "name {:?} duplicates an existing persona",
                candidate.name
            ));
        }
        for r in candidate.friends().iter().chain(candidate.friction()) {
            if self.get(r).is_none() {
                e.push(format!("relationship to unknown persona {r:?}"));
            }
        }
        if e.is_empty() {
            Ok(())
        } else {
            Err(e)
        }
    }

    /// The whole catalog as JSON for tools and the UI (camelCase keys):
    /// `{ schemaVersion, poolIdStart, departments[], roles[], personas[] }`.
    pub fn to_json(&self) -> Value {
        let departments: Vec<Value> = Department::ALL
            .iter()
            .map(|d| {
                json!({
                    "id": d.as_str(),
                    "name": d.name(),
                    "roles": d.roles().iter().map(|r| r.as_str()).collect::<Vec<_>>(),
                })
            })
            .collect();
        let roles: Vec<Value> = Role::staff()
            .map(|r| {
                let (lo, hi) = r.salary_band_eur_month().expect("staff role");
                json!({
                    "id": r.as_str(),
                    "title": r.title(),
                    "department": r.department().map(|d| d.as_str()),
                    "salaryBandEurMonth": { "min": lo, "max": hi },
                })
            })
            .collect();
        let personas: Vec<Value> = self
            .personas
            .iter()
            .map(|p| {
                let mut v = camel_case_keys(serde_json::to_value(p).expect("persona serializes"));
                if let Value::Object(m) = &mut v {
                    m.insert("inPool".into(), Value::Bool(p.in_pool()));
                }
                v
            })
            .collect();
        json!({
            "schemaVersion": SCHEMA_VERSION,
            "poolIdStart": POOL_ID_START,
            "departments": departments,
            "roles": roles,
            "personas": personas,
        })
    }
}

/// The built-in catalog as JSON (see [`Catalog::to_json`]).
pub fn catalog_json() -> Value {
    Catalog::builtin().to_json()
}

fn camel(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut up = false;
    for c in s.chars() {
        if c == '_' {
            up = true;
        } else if up {
            out.extend(c.to_uppercase());
            up = false;
        } else {
            out.push(c);
        }
    }
    out
}

/// Maps whose keys are data (occasion ids, language codes), not field names;
/// their keys are kept as they are.
const DATA_KEYED_MAPS: [&str; 2] = ["traditions", "sample_phrases"];

/// Recursively renames snake_case object keys to camelCase, except the keys
/// of data-keyed maps (`traditions`, `sample_phrases`).
pub fn camel_case_keys(v: Value) -> Value {
    match v {
        Value::Object(m) => Value::Object(
            m.into_iter()
                .map(|(k, v)| {
                    let v = if DATA_KEYED_MAPS.contains(&k.as_str()) {
                        v
                    } else {
                        camel_case_keys(v)
                    };
                    (camel(&k), v)
                })
                .collect(),
        ),
        Value::Array(a) => Value::Array(a.into_iter().map(camel_case_keys).collect()),
        other => other,
    }
}

fn join_max(items: &[String], max: usize) -> String {
    items
        .iter()
        .take(max)
        .map(String::as_str)
        .collect::<Vec<_>>()
        .join(", ")
}

fn colleague(slug: &str) -> String {
    match Catalog::builtin().get(slug) {
        Some(p) => format!("{} ({})", p.name, p.title),
        None => slug.to_owned(),
    }
}

/// The persona block of a staff prompt: identity, bio, career highlights,
/// life outside work (gives meetings their character), colleagues (meeting
/// dynamics), how they work, and, for writers, the legacy voice sections.
/// Bounded for token budget: at most 3 jobs × 2 highlights, 6 skills, 4 items
/// per life list. Family is one line; traditions are left out (see
/// [`format_persona_for_prompt_on`]).
pub fn format_persona_for_prompt(p: &Persona, language: &str) -> String {
    format_persona_for_prompt_on(p, language, None)
}

/// [`format_persona_for_prompt`] on a day with an `occasion` (a
/// [`Persona::traditions`] key such as `"christmas"` or `"birthday"`): adds
/// one line on how this person celebrates it, if they do.
pub fn format_persona_for_prompt_on(p: &Persona, language: &str, occasion: Option<&str>) -> String {
    let mut s = String::new();
    s.push_str(&format!(
        "\n## Your Identity: {} ({})\n**Role:** {} · {} · {} {}\n**From:** {}, age {} · **Languages:** {}\n**Expertise:** {}\n",
        p.name,
        p.pronouns,
        p.title,
        p.department.name(),
        p.seniority.as_str(),
        p.role.as_str(),
        p.hometown,
        p.age,
        p.languages.join(", "),
        join_max(&p.cv.skills, 6),
    ));
    s.push_str(&format!("\n### About You\n{}\n", p.bio.trim()));

    s.push_str("\n### Your Career\n");
    let recent: Vec<&Experience> = p.cv.experience.iter().rev().take(3).collect();
    for x in recent.iter().rev() {
        s.push_str(&format!(
            "- {}: {}, {} ({})\n",
            x.years,
            x.role,
            x.org,
            x.highlights
                .iter()
                .take(2)
                .cloned()
                .collect::<Vec<_>>()
                .join("; ")
        ));
    }
    let edu: Vec<String> =
        p.cv.education
            .iter()
            .map(|e| format!("{}, {} ({})", e.what, e.institution, e.years))
            .collect();
    s.push_str(&format!("- Education: {}\n", edu.join("; ")));
    if !p.cv.awards.is_empty() {
        s.push_str(&format!("- Awards: {}\n", join_max(&p.cv.awards, 3)));
    }

    let l = &p.life;
    s.push_str(&format!(
        "\n### Outside Work\n- **Hobbies:** {}\n- **Interests:** {}\n- **Quirks:** {}\n- **Likes:** {} · **Dislikes:** {}\n",
        join_max(&l.hobbies, 4),
        join_max(&l.interests, 4),
        l.quirks.iter().take(3).cloned().collect::<Vec<_>>().join("; "),
        join_max(&l.likes, 4),
        join_max(&l.dislikes, 4),
    ));
    s.push_str(&format!(
        "- **Values:** {}\n- **Family:** {}\n- **The world outside:** you follow {} ({} interest in the news); on current events you are {}\n",
        l.values.join("; "),
        p.family.household.trim(),
        join_max(&p.world.topics, 4),
        p.world.news_interest.as_str(),
        p.world.tone_on_current_events.trim().trim_end_matches('.'),
    ));
    if let Some(occ) = occasion {
        if let Some(t) = p.traditions_for(occ) {
            s.push_str(&format!(
                "- **Today ({}):** {}\n",
                occ.replace('_', " "),
                t.trim()
            ));
        }
    }

    if !p.friends().is_empty() || !p.friction().is_empty() {
        s.push_str("\n### Colleagues\n");
        if !p.friends().is_empty() {
            let f: Vec<String> = p.friends().iter().map(|x| colleague(x)).collect();
            s.push_str(&format!("- You get on well with {}.\n", f.join(", ")));
        }
        if !p.friction().is_empty() {
            let f: Vec<String> = p.friction().iter().map(|x| colleague(x)).collect();
            s.push_str(&format!(
                "- You often disagree with {}; stay professional.\n",
                f.join(", ")
            ));
        }
    }
    s.push_str(&format!("\n### How You Work\n{}\n", l.work_style.trim()));

    if let Some(ws) = &p.writing_style {
        if !ws.voice.is_empty() {
            s.push_str("\n### Your Voice Characteristics\n");
            for v in &ws.voice {
                s.push_str(&format!("- {v}\n"));
            }
        }
        if let Some(cp) = &ws.preferences {
            s.push_str(&format!(
                "\n### Your Writing Preferences\n- **Opening Style:** {}\n- **Structure:** {}\n- **Closing Style:** {}\n- **Favorite Topics:** {}\n- **Topics to Avoid:** {}\n",
                cp.opening_style,
                cp.structure_preference,
                cp.closing_style,
                cp.favorite_topics.join(", "),
                cp.avoid_topics.join(", "),
            ));
        }
        let phrases = p.phrases(language);
        if !phrases.is_empty() {
            s.push_str("\n### Sample Phrases You Use\n");
            for ph in phrases {
                s.push_str(&format!("- \"{ph}\"\n"));
            }
        }
    }
    s
}

fn style_description(field: &str, value: &str) -> Option<&'static str> {
    Some(match (field, value) {
        ("tone", "professional") => "Maintain a polished, business-appropriate voice",
        ("tone", "casual") => "Write in a relaxed, everyday conversational manner",
        ("tone", "friendly") => "Be warm, approachable, and engaging",
        ("tone", "authoritative") => "Convey expertise and credibility with confidence",
        ("tone", "enthusiastic") => "Express genuine excitement and energy",
        ("tone", "formal") => "Use proper, conventional language",
        ("vocabulary_level", "simple") => "Use everyday words accessible to all readers",
        ("vocabulary_level", "moderate") => "Balance common and slightly sophisticated vocabulary",
        ("vocabulary_level", "advanced") => "Employ rich, varied vocabulary for educated readers",
        ("vocabulary_level", "technical") => "Include specialized terminology where appropriate",
        ("sentence_length", "short") => "Keep sentences brief and punchy",
        ("sentence_length", "medium") => "Use moderate-length sentences for clarity",
        ("sentence_length", "long") => "Craft complex, flowing sentences with multiple clauses",
        ("sentence_length", "varied") => "Mix sentence lengths for dynamic rhythm",
        ("formality", "very_informal") => "Write like chatting with a close friend",
        ("formality", "informal") => "Maintain a relaxed, conversational register",
        ("formality", "neutral") => "Balance formality - neither stiff nor overly casual",
        ("formality", "formal") => "Use proper, respectful language",
        ("formality", "very_formal") => "Employ highly proper, ceremonial language",
        ("perspective", "first_person") => "Write using \"I\" and share personal experiences",
        ("perspective", "second_person") => "Address the reader directly using \"you\"",
        ("perspective", "third_person") => {
            "Maintain objective distance, referring to \"visitors\" or \"travelers\""
        }
        ("descriptive_style", "factual") => "Focus on concrete facts and practical information",
        ("descriptive_style", "evocative") => {
            "Paint vivid pictures that stir emotions and imagination"
        }
        ("descriptive_style", "poetic") => "Use lyrical, metaphorical language",
        ("descriptive_style", "practical") => "Emphasize actionable, useful information",
        _ => return None,
    })
}

/// Port of `formatWritingStyleForPrompt`. Returns `""` when no field maps to
/// a guideline (as in legacy; humor and emoji usage are not rendered).
pub fn format_writing_style_for_prompt(style: &WritingStyle) -> String {
    let fields: [(&str, &str, &Option<String>); 6] = [
        ("tone", "Tone", &style.tone),
        ("vocabulary_level", "Vocabulary", &style.vocabulary_level),
        ("sentence_length", "Sentences", &style.sentence_length),
        ("formality", "Formality", &style.formality),
        ("perspective", "Perspective", &style.perspective),
        ("descriptive_style", "Description", &style.descriptive_style),
    ];
    let guidelines: Vec<String> = fields
        .iter()
        .filter_map(|(field, label, value)| {
            let v = value.as_deref()?;
            style_description(field, v).map(|d| format!("**{label}:** {d}"))
        })
        .collect();
    if guidelines.is_empty() {
        return String::new();
    }
    format!("\n## Writing Style Guidelines\n{}\n", guidelines.join("\n"))
}

fn band(v: u8) -> usize {
    match v {
        0..=34 => 0,
        35..=69 => 1,
        _ => 2,
    }
}

/// Renders traits and seniority into the work-style paragraph that goes into
/// the prompt (plan A: traits affect both the sim and the prompts).
pub fn format_work_style(traits: &Traits, seniority: Seniority) -> String {
    const LINES: [(&str, [&str; 3]); 6] = [
        (
            "rigor",
            [
                "You work from instinct; keep facts you are unsure of out of the copy rather than guessing.",
                "You check names, numbers and claims that matter before committing them.",
                "You verify every name, number and claim, and cut anything you cannot support.",
            ],
        ),
        (
            "speed",
            [
                "You take your time and prefer one careful pass over several quick ones.",
                "You work at a steady pace.",
                "You work fast and decisively, and keep drafts tight.",
            ],
        ),
        (
            "creativity",
            [
                "You favour clear, conventional structure over experiments.",
                "You look for one fresh angle per piece.",
                "You look for unexpected angles, structures and images.",
            ],
        ),
        (
            "sociability",
            [
                "In meetings you speak briefly and only when you have something concrete.",
                "In meetings you contribute when it is useful and build on colleagues' points.",
                "In meetings you are warm and talkative, and you draw quieter colleagues in.",
            ],
        ),
        (
            "resilience",
            [
                "Criticism stings; you still address every editor note, one by one.",
                "You take editor feedback in stride and address it point by point.",
                "Tough feedback does not rattle you; you treat every note as a chance to improve.",
            ],
        ),
        (
            "ambition",
            [
                "You are content to do solid work on the assignment as given.",
                "You want your work to be noticed and pitch ideas now and then.",
                "You push for bigger stories and pitch ambitious ideas.",
            ],
        ),
    ];
    let seniority_line = match seniority {
        Seniority::Junior => {
            "You are a junior member of staff: follow the brief closely and ask when unsure."
        }
        Seniority::Mid => {
            "You are an experienced member of staff who can interpret a brief independently."
        }
        Seniority::Senior => {
            "You are a senior member of staff: own the piece end to end and set the standard."
        }
        Seniority::Star => {
            "You are the publication's star: your byline carries the brand, so hold yourself to it."
        }
    };
    let mut out = String::from("\n## Your Work Style\n");
    out.push_str(seniority_line);
    for ((name, lines), (trait_name, v)) in LINES.iter().zip(traits.named()) {
        debug_assert_eq!(*name, trait_name);
        out.push(' ');
        out.push_str(lines[band(v)]);
    }
    out.push('\n');
    out
}

/// JSON Schema of a persona in its JSON form (snake_case keys, the TOML
/// structure). Used for `CandidateGeneration` structured output. Kept in
/// sync with [`Persona`] by a test that validates every catalog persona
/// against it.
pub fn persona_json_schema() -> Value {
    let s = || json!({"type": "string", "minLength": 1});
    let strs = |min: u64| json!({"type": "array", "minItems": min, "items": {"type": "string", "minLength": 1}});
    let roles: Vec<&str> = Role::staff().map(Role::as_str).collect();
    let depts: Vec<&str> = Department::ALL.iter().map(|d| d.as_str()).collect();
    let pct = || json!({"type": "integer", "minimum": 0, "maximum": 100});
    let opt_s = || json!({"type": "string"});
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["slug", "id", "name", "pronouns", "age", "hometown", "department", "role",
                     "title", "seniority", "salary_eur_month", "languages", "affinities", "pitch",
                     "birthday", "bio", "cv", "life", "traits", "family", "traditions", "world",
                     "appearance"],
        "properties": {
            "slug": {"type": "string", "pattern": "^[a-z][a-z0-9-]{1,31}$"},
            "id": {"type": "integer", "minimum": 1, "maximum": 65535},
            "name": s(),
            "pronouns": {"type": "string", "pattern": "^[^/\\n]+/[^\\n]+$"},
            "age": {"type": "integer", "minimum": 18, "maximum": 80},
            "hometown": s(),
            "department": {"type": "string", "enum": depts},
            "role": {"type": "string", "enum": roles},
            "title": s(),
            "seniority": {"type": "string", "enum": ["junior", "mid", "senior", "star"]},
            "salary_eur_month": {"type": "integer", "minimum": 1},
            "languages": strs(1),
            "affinities": strs(1),
            "pitch": {"type": "string", "minLength": 1, "maxLength": 160},
            "birthday": {"type": "string", "pattern": "^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$"},
            "name_day": {"type": "string", "pattern": "^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$"},
            "family": {
                "type": "object", "additionalProperties": false,
                "required": ["household", "key_people"],
                "properties": {"household": s(), "key_people": strs(0)}
            },
            "traditions": {
                "type": "object",
                "additionalProperties": {"type": "string", "minLength": 1}
            },
            "bio": s(),
            "cv": {
                "type": "object", "additionalProperties": false,
                "required": ["education", "experience", "skills", "awards"],
                "properties": {
                    "education": {"type": "array", "minItems": 1, "items": {
                        "type": "object", "additionalProperties": false,
                        "required": ["years", "what", "where"],
                        "properties": {"years": s(), "what": s(), "where": s()}
                    }},
                    "experience": {"type": "array", "minItems": 2, "items": {
                        "type": "object", "additionalProperties": false,
                        "required": ["years", "role", "org", "highlights"],
                        "properties": {"years": s(), "role": s(), "org": s(), "highlights": strs(1)}
                    }},
                    "skills": strs(1),
                    "awards": strs(0)
                }
            },
            "life": {
                "type": "object", "additionalProperties": false,
                "required": ["hobbies", "interests", "quirks", "likes", "dislikes", "work_style", "values"],
                "properties": {
                    "hobbies": strs(1), "interests": strs(1), "quirks": strs(1),
                    "likes": strs(1), "dislikes": strs(1), "work_style": s(),
                    "values": {"type": "array", "minItems": 2, "maxItems": 4,
                               "items": {"type": "string", "minLength": 1}}
                }
            },
            "world": {
                "type": "object", "additionalProperties": false,
                "required": ["news_interest", "topics", "tone_on_current_events"],
                "properties": {
                    "news_interest": {"type": "string", "enum": ["low", "medium", "high"]},
                    "topics": strs(1),
                    "tone_on_current_events": s()
                }
            },
            "traits": {
                "type": "object", "additionalProperties": false,
                "required": ["rigor", "speed", "creativity", "sociability", "resilience", "ambition"],
                "properties": {
                    "rigor": pct(), "speed": pct(), "creativity": pct(),
                    "sociability": pct(), "resilience": pct(), "ambition": pct()
                }
            },
            "writing_style": {
                "type": "object", "additionalProperties": false,
                "properties": {
                    "tone": opt_s(), "vocabulary_level": opt_s(), "sentence_length": opt_s(),
                    "formality": opt_s(), "humor": opt_s(), "emoji_usage": opt_s(),
                    "perspective": opt_s(), "descriptive_style": opt_s(),
                    "voice": strs(0),
                    "preferences": {
                        "type": "object", "additionalProperties": false,
                        "required": ["opening_style", "structure_preference", "closing_style",
                                     "favorite_topics", "avoid_topics"],
                        "properties": {
                            "opening_style": s(), "structure_preference": s(), "closing_style": s(),
                            "favorite_topics": strs(0), "avoid_topics": strs(0)
                        }
                    },
                    "sample_phrases": {"type": "object", "additionalProperties": strs(1)}
                }
            },
            "relationships": {
                "type": "object", "additionalProperties": false,
                "properties": {"friends": strs(0), "friction": strs(0)}
            },
            "appearance": {
                "type": "object", "additionalProperties": false,
                "required": ["palette", "description"],
                "properties": {
                    "palette": {"type": "string", "pattern": "^#[0-9a-fA-F]{6}$"},
                    "description": s()
                }
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::parse_years;

    #[test]
    fn year_ranges() {
        assert_eq!(parse_years("2005–2008"), Some((2005, 2008)));
        assert_eq!(parse_years("2019-present"), Some((2019, 2026)));
        assert_eq!(parse_years("2012"), Some((2012, 2012)));
        assert_eq!(parse_years("2010–2008"), None);
        assert_eq!(parse_years("since 2010"), None);
        assert_eq!(parse_years("2031"), None);
    }
}
