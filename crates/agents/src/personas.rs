//! Staff personas (data in `crates/agents/personas/*.toml`) and the prompt
//! formatters ported from `formatPersonaForPrompt` /
//! `formatWritingStyleForPrompt` (legacy `agent-personas.ts`).

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::roles::{ConfigError, Role, Seniority, Traits};

const BUILTIN: [(&str, &str); 6] = [
    ("Giulia", include_str!("../personas/giulia.toml")),
    ("Isabella", include_str!("../personas/isabella.toml")),
    ("Lorenzo", include_str!("../personas/lorenzo.toml")),
    ("Sophia", include_str!("../personas/sophia.toml")),
    ("Marco", include_str!("../personas/marco.toml")),
    ("Francesca", include_str!("../personas/francesca.toml")),
];

/// Writing style (legacy `WritingStyle`). Values are the legacy enum strings;
/// unknown values are kept but produce no guideline line (as in legacy).
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WritingStyle {
    pub tone: Option<String>,
    pub vocabulary_level: Option<String>,
    pub sentence_length: Option<String>,
    pub formality: Option<String>,
    pub humor: Option<String>,
    pub emoji_usage: Option<String>,
    pub perspective: Option<String>,
    pub descriptive_style: Option<String>,
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
pub struct Persona {
    pub name: String,
    /// Human-readable role title ("Culinary Expert & Food Writer").
    pub display_role: String,
    /// Organizational role.
    pub role: Role,
    pub seniority: Seniority,
    pub expertise: Vec<String>,
    pub persona: String,
    pub background: String,
    pub voice_characteristics: Vec<String>,
    pub traits: Traits,
    pub writing_style: WritingStyle,
    pub content_preferences: ContentPreferences,
    /// Language code → phrases. `en` is required (fallback language).
    pub sample_phrases: BTreeMap<String, Vec<String>>,
}

impl Persona {
    pub fn from_toml_str(s: &str) -> Result<Self, ConfigError> {
        let p: Persona = toml::from_str(s).map_err(|e| ConfigError::Parse(e.to_string()))?;
        p.traits.validate().map_err(ConfigError::Invalid)?;
        if !p.sample_phrases.contains_key("en") {
            return Err(ConfigError::Invalid(format!(
                "persona {} has no `en` sample phrases",
                p.name
            )));
        }
        Ok(p)
    }

    /// One of the six legacy personas, by name.
    pub fn builtin(name: &str) -> Option<Persona> {
        BUILTIN
            .iter()
            .find(|(n, _)| *n == name)
            .map(|(_, src)| Persona::from_toml_str(src).expect("builtin persona TOML is valid"))
    }

    pub fn builtin_all() -> Vec<Persona> {
        BUILTIN
            .iter()
            .map(|(_, src)| Persona::from_toml_str(src).expect("builtin persona TOML is valid"))
            .collect()
    }

    pub fn phrases(&self, language: &str) -> &[String] {
        self.sample_phrases
            .get(language)
            .or_else(|| self.sample_phrases.get("en"))
            .map(Vec::as_slice)
            .unwrap_or(&[])
    }
}

/// Port of `formatPersonaForPrompt` (same layout, byte for byte).
pub fn format_persona_for_prompt(p: &Persona, language: &str) -> String {
    let bullets = |items: &[String]| {
        items
            .iter()
            .map(|c| format!("- {c}"))
            .collect::<Vec<_>>()
            .join("\n")
    };
    let phrases = p
        .phrases(language)
        .iter()
        .map(|ph| format!("- \"{ph}\""))
        .collect::<Vec<_>>()
        .join("\n");
    let cp = &p.content_preferences;
    format!(
        "\n## Your Identity: {name}\n**Role:** {role}\n**Expertise:** {expertise}\n\n### Your Persona\n{persona}\n\n### Your Background\n{background}\n\n### Your Voice Characteristics\n{voice}\n\n### Your Writing Preferences\n- **Opening Style:** {open}\n- **Structure:** {structure}\n- **Closing Style:** {close}\n- **Favorite Topics:** {fav}\n- **Topics to Avoid:** {avoid}\n\n### Sample Phrases You Use\n{phrases}\n",
        name = p.name,
        role = p.display_role,
        expertise = p.expertise.join(", "),
        persona = p.persona,
        background = p.background,
        voice = bullets(&p.voice_characteristics),
        open = cp.opening_style,
        structure = cp.structure_preference,
        close = cp.closing_style,
        fav = cp.favorite_topics.join(", "),
        avoid = cp.avoid_topics.join(", "),
    )
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
