//! House style from a site's `content/config/style-guide.json` (legacy
//! `editorial-config-loader.ts`): prompt formatting plus a deterministic
//! banned-phrase check used by validators and the QA gate.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::roles::ConfigError;

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Personality {
    pub traits: Vec<String>,
    pub speaking_style: String,
    pub perspective: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Formatting {
    pub headings: String,
    pub lists: String,
    pub paragraphs: String,
    pub numbers: String,
    pub times: String,
    pub prices: String,
    pub distances: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Vocabulary {
    pub preferred: Vec<String>,
    pub avoid: Vec<String>,
    pub replacements: BTreeMap<String, String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Guideline {
    pub principle: String,
    pub examples: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct StructurePattern {
    pub opening: String,
    pub body: String,
    pub close: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct StyleExamples {
    pub good: Vec<String>,
    pub bad: Vec<String>,
}

/// `style-guide.json`. Every field is optional so partial guides load.
/// Maps use `BTreeMap`, so sections render in key order.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct StyleGuide {
    pub voice: String,
    pub persona: String,
    pub tone: String,
    pub personality: Personality,
    pub formatting: Formatting,
    pub vocabulary: Vocabulary,
    pub content_guidelines: BTreeMap<String, Guideline>,
    pub structure_patterns: BTreeMap<String, StructurePattern>,
    pub examples: StyleExamples,
    pub seo_guidelines: BTreeMap<String, String>,
}

impl StyleGuide {
    pub fn from_json_str(s: &str) -> Result<Self, ConfigError> {
        serde_json::from_str(s).map_err(|e| ConfigError::Parse(format!("style-guide.json: {e}")))
    }

    /// Banned phrases (`vocabulary.avoid`).
    pub fn banned_phrases(&self) -> &[String] {
        &self.vocabulary.avoid
    }

    /// Banned phrases found in `text` (case-insensitive, whole words).
    pub fn banned_phrase_hits(&self, text: &str) -> Vec<String> {
        let hay = text.to_lowercase();
        self.vocabulary
            .avoid
            .iter()
            .filter(|p| contains_phrase(&hay, &p.to_lowercase()))
            .cloned()
            .collect()
    }

    /// Banned phrases anywhere in the string values of a JSON document, as
    /// `"<json pointer>: banned phrase \"x\""` errors.
    pub fn banned_phrase_errors(&self, doc: &Value) -> Vec<String> {
        let mut out = Vec::new();
        walk_strings(doc, String::new(), &mut |path, s| {
            for hit in self.banned_phrase_hits(s) {
                out.push(format!("{path}: banned phrase \"{hit}\" (house style)"));
            }
        });
        out
    }
}

fn contains_phrase(hay: &str, needle: &str) -> bool {
    if needle.is_empty() {
        return false;
    }
    let is_word = |c: char| c.is_alphanumeric();
    let mut start = 0;
    while let Some(i) = hay[start..].find(needle) {
        let at = start + i;
        let end = at + needle.len();
        let before_ok = hay[..at].chars().next_back().is_none_or(|c| !is_word(c));
        let after_ok = hay[end..].chars().next().is_none_or(|c| !is_word(c));
        if before_ok && after_ok {
            return true;
        }
        start = at + needle.chars().next().map_or(1, char::len_utf8);
    }
    false
}

fn walk_strings(v: &Value, path: String, f: &mut dyn FnMut(&str, &str)) {
    match v {
        Value::String(s) => f(if path.is_empty() { "/" } else { &path }, s),
        Value::Array(a) => {
            for (i, x) in a.iter().enumerate() {
                walk_strings(x, format!("{path}/{i}"), f);
            }
        }
        Value::Object(o) => {
            for (k, x) in o {
                walk_strings(x, format!("{path}/{k}"), f);
            }
        }
        _ => {}
    }
}

fn split_camel(s: &str) -> String {
    let mut out = String::new();
    for (i, c) in s.chars().enumerate() {
        if c.is_uppercase() && i > 0 {
            out.push(' ');
        }
        out.push(c);
    }
    out
}

/// Formats the house style as a prompt section (port of the style parts of
/// `formatEditorialPrompt`). Empty sections are omitted.
pub fn format_house_style(g: &StyleGuide) -> String {
    let mut s = String::from("## House Style\n");
    if !g.voice.is_empty() {
        s.push_str(&format!("**Voice:** {}\n", g.voice));
    }
    if !g.tone.is_empty() {
        s.push_str(&format!("**Tone:** {}\n", g.tone));
    }
    if !g.personality.perspective.is_empty() {
        s.push_str(&format!("**Perspective:** {}\n", g.personality.perspective));
    }
    if !g.personality.speaking_style.is_empty() {
        s.push_str(&format!(
            "**Speaking style:** {}\n",
            g.personality.speaking_style
        ));
    }
    if !g.personality.traits.is_empty() {
        s.push_str("\n### Publication Personality\n");
        for t in &g.personality.traits {
            s.push_str(&format!("- {t}\n"));
        }
    }

    let f = &g.formatting;
    let fmt_rows = [
        ("Headings", &f.headings),
        ("Paragraphs", &f.paragraphs),
        ("Lists", &f.lists),
        ("Numbers", &f.numbers),
        ("Times", &f.times),
        ("Prices", &f.prices),
        ("Distances", &f.distances),
    ];
    if fmt_rows.iter().any(|(_, v)| !v.is_empty()) {
        s.push_str("\n### Formatting\n");
        for (label, v) in fmt_rows {
            if !v.is_empty() {
                s.push_str(&format!("- **{label}:** {v}\n"));
            }
        }
    }

    let voc = &g.vocabulary;
    if !voc.preferred.is_empty() || !voc.avoid.is_empty() || !voc.replacements.is_empty() {
        s.push_str("\n### Vocabulary\n");
        if !voc.preferred.is_empty() {
            s.push_str(&format!(
                "**Use these words:** {}\n",
                voc.preferred.join(", ")
            ));
        }
        if !voc.avoid.is_empty() {
            s.push_str(&format!(
                "**NEVER use these words (drafts containing them are rejected automatically):** {}\n",
                voc.avoid.join(", ")
            ));
        }
        if !voc.replacements.is_empty() {
            s.push_str("**Replacements:**\n");
            for (bad, good) in &voc.replacements {
                s.push_str(&format!("- \"{bad}\" → \"{good}\"\n"));
            }
        }
    }

    if !g.content_guidelines.is_empty() {
        s.push_str("\n### Writing Principles\n");
        for gl in g.content_guidelines.values() {
            s.push_str(&format!("**{}**\n", gl.principle));
            for ex in &gl.examples {
                s.push_str(&format!("- {ex}\n"));
            }
        }
    }

    if !g.examples.good.is_empty() {
        s.push_str("\n### Good Writing Examples\n");
        let quoted: Vec<String> = g
            .examples
            .good
            .iter()
            .map(|ex| format!("> \"{ex}\""))
            .collect();
        s.push_str(&quoted.join("\n\n"));
        s.push('\n');
    }
    if !g.examples.bad.is_empty() {
        s.push_str("\n### Bad Writing Examples (NEVER write like this)\n");
        let quoted: Vec<String> = g
            .examples
            .bad
            .iter()
            .map(|ex| format!("> BAD: \"{ex}\""))
            .collect();
        s.push_str(&quoted.join("\n\n"));
        s.push('\n');
    }

    if !g.structure_patterns.is_empty() {
        s.push_str("\n### Content Structure Patterns\n");
        for (name, p) in &g.structure_patterns {
            let mut title = split_camel(name);
            if let Some(first) = title.get_mut(..1) {
                first.make_ascii_uppercase();
            }
            s.push_str(&format!(
                "**{title}**\n- **Opening:** {}\n- **Body:** {}\n- **Close:** {}\n",
                p.opening, p.body, p.close
            ));
        }
    }

    if !g.seo_guidelines.is_empty() {
        s.push_str("\n### SEO\n");
        for v in g.seo_guidelines.values() {
            s.push_str(&format!("- {v}\n"));
        }
    }
    s
}

/// The house style as a deterministic page check (banned phrases).
impl crate::pipeline::PageValidator for StyleGuide {
    fn validate(&self, page: &Value) -> Result<(), Vec<String>> {
        let errors = self.banned_phrase_errors(page);
        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors)
        }
    }
}
