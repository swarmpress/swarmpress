//! 3-level prompt layering (legacy `specs/prompting.md`):
//!
//! 1. **company** baseline per role (`crates/agents/prompts/*.md`),
//! 2. **site** extension (e.g. `writer-prompt.json`'s `website_prompt_template`):
//!    appends instructions, adds examples, overrides variables, or (rarely)
//!    replaces the template,
//! 3. **agent** binding (persona): variables only.
//!
//! Variable priority: runtime > agent > site > company. Merge rules:
//! scalars are replaced, arrays concatenate (lower level first), objects
//! deep-merge, and `null` means "no override" (inherit).
//!
//! Rendering is strict: `{{name}}` with no value is an error, never an empty
//! string (stubs fail loudly).

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::house_style::{format_house_style, StyleGuide};
use crate::personas::{
    format_persona_for_prompt, format_work_style, format_writing_style_for_prompt, Persona,
};
use crate::roles::ConfigError;

pub type Vars = Map<String, Value>;

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum PromptError {
    #[error("prompt {template}: missing variables {missing:?}")]
    MissingVariables {
        template: String,
        missing: Vec<String>,
    },
    #[error("prompt {template}: unterminated `{{{{` at byte {at}")]
    Unterminated { template: String, at: usize },
    #[error("agent layer {0} tried to change the template; agent bindings are variables only")]
    AgentTemplateChange(String),
    #[error("{0}")]
    Config(String),
}

/// Level 1: a company baseline template.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CompanyPrompt {
    pub id: String,
    pub version: String,
    pub template: String,
    #[serde(default)]
    pub examples: Vec<Value>,
    #[serde(default)]
    pub default_variables: Vars,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct FrontMatter {
    id: String,
    version: String,
    #[serde(default)]
    default_variables: toml::Table,
}

impl CompanyPrompt {
    /// Parses a template file: `+++` TOML front matter (`id`, `version`,
    /// `[default_variables]`) followed by the Markdown template.
    pub fn parse(src: &str) -> Result<Self, ConfigError> {
        let rest = src.strip_prefix("+++\n").ok_or_else(|| {
            ConfigError::Parse("template must start with +++ front matter".into())
        })?;
        let end = rest
            .find("\n+++\n")
            .ok_or_else(|| ConfigError::Parse("unterminated +++ front matter".into()))?;
        let fm: FrontMatter =
            toml::from_str(&rest[..end]).map_err(|e| ConfigError::Parse(e.to_string()))?;
        let default_variables = match serde_json::to_value(fm.default_variables) {
            Ok(Value::Object(m)) => m,
            _ => {
                return Err(ConfigError::Parse(
                    "default_variables must be a table".into(),
                ))
            }
        };
        Ok(Self {
            id: fm.id,
            version: fm.version,
            template: rest[end + 5..].trim_start_matches('\n').to_owned(),
            examples: Vec::new(),
            default_variables,
        })
    }
}

/// The built-in company templates.
pub mod templates {
    use super::CompanyPrompt;

    pub const WRITER: &str = include_str!("../prompts/writer.md");
    pub const EDITOR: &str = include_str!("../prompts/editor.md");
    pub const EDITOR_IN_CHIEF: &str = include_str!("../prompts/editor_in_chief.md");
    pub const MEETING_SPEAKER: &str = include_str!("../prompts/meeting_speaker.md");
    pub const QA_COHERENCE: &str = include_str!("../prompts/qa_coherence.md");

    pub fn writer() -> CompanyPrompt {
        CompanyPrompt::parse(WRITER).expect("prompts/writer.md")
    }
    pub fn editor() -> CompanyPrompt {
        CompanyPrompt::parse(EDITOR).expect("prompts/editor.md")
    }
    pub fn editor_in_chief() -> CompanyPrompt {
        CompanyPrompt::parse(EDITOR_IN_CHIEF).expect("prompts/editor_in_chief.md")
    }
    pub fn meeting_speaker() -> CompanyPrompt {
        CompanyPrompt::parse(MEETING_SPEAKER).expect("prompts/meeting_speaker.md")
    }
    pub fn qa_coherence() -> CompanyPrompt {
        CompanyPrompt::parse(QA_COHERENCE).expect("prompts/qa_coherence.md")
    }
}

/// Level 2 or 3 layer.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct PromptLayer {
    /// For the resolution path, e.g. `"site:cinqueterre@1.1.0"`.
    pub source: String,
    /// Complete template replacement (site only, rarely used).
    #[serde(default)]
    pub template_override: Option<String>,
    /// Appended to the company template (site only).
    #[serde(default)]
    pub template_additions: Option<String>,
    #[serde(default)]
    pub examples: Vec<Value>,
    #[serde(default)]
    pub variables: Vars,
}

impl PromptLayer {
    /// Site layer from a `writer-prompt.json` document
    /// (`website_prompt_template.{template_additions, variables_override,
    /// examples_override, version}`).
    pub fn from_site_writer_prompt(site: &str, doc: &Value) -> Result<Self, ConfigError> {
        let t = doc.get("website_prompt_template").ok_or_else(|| {
            ConfigError::Invalid("writer-prompt.json: no website_prompt_template".into())
        })?;
        let version = t.get("version").and_then(Value::as_str).unwrap_or("0");
        let variables = match t.get("variables_override") {
            Some(Value::Object(m)) => m.clone(),
            None | Some(Value::Null) => Vars::new(),
            Some(_) => {
                return Err(ConfigError::Invalid(
                    "variables_override must be an object".into(),
                ))
            }
        };
        let examples = match t.get("examples_override") {
            Some(Value::Array(a)) => a.clone(),
            _ => Vec::new(),
        };
        Ok(Self {
            source: format!("site:{site}@{version}"),
            template_override: None,
            template_additions: t
                .get("template_additions")
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())
                .map(str::to_owned),
            examples,
            variables,
        })
    }

    /// Agent layer from a persona: variables only.
    pub fn from_persona(p: &Persona, language: &str) -> Self {
        let mut v = Vars::new();
        v.insert("agent_name".into(), Value::String(p.name.clone()));
        v.insert("agent_role".into(), Value::String(p.display_role.clone()));
        v.insert(
            "persona_block".into(),
            Value::String(format_persona_for_prompt(p, language)),
        );
        v.insert(
            "writing_style_block".into(),
            Value::String(format_writing_style_for_prompt(&p.writing_style)),
        );
        v.insert(
            "work_style".into(),
            Value::String(format_work_style(&p.traits, p.seniority)),
        );
        Self {
            source: format!("agent:{}", p.name.to_lowercase()),
            variables: v,
            ..Default::default()
        }
    }
}

/// Merges `higher` over `lower` per the spec's conflict rules.
pub fn merge_value(lower: &Value, higher: &Value) -> Value {
    match (lower, higher) {
        (l, Value::Null) => l.clone(),
        (Value::Array(a), Value::Array(b)) => Value::Array(a.iter().chain(b).cloned().collect()),
        (Value::Object(a), Value::Object(b)) => {
            let mut out = a.clone();
            for (k, hv) in b {
                let merged = match a.get(k) {
                    Some(lv) => merge_value(lv, hv),
                    None => hv.clone(),
                };
                out.insert(k.clone(), merged);
            }
            Value::Object(out)
        }
        (_, h) => h.clone(),
    }
}

pub fn merge_vars(lower: &Vars, higher: &Vars) -> Vars {
    match merge_value(
        &Value::Object(lower.clone()),
        &Value::Object(higher.clone()),
    ) {
        Value::Object(m) => m,
        _ => unreachable!(),
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ResolvedPrompt {
    pub text: String,
    pub variables: Vars,
    pub examples: Vec<Value>,
    pub resolution_path: Vec<String>,
}

/// Resolves company → site → agent (+ runtime) into the final prompt text.
pub fn resolve(
    company: &CompanyPrompt,
    site: Option<&PromptLayer>,
    agent: Option<&PromptLayer>,
    runtime: &Vars,
) -> Result<ResolvedPrompt, PromptError> {
    let mut path = vec![format!("company:{}@{}", company.id, company.version)];
    let mut template = company.template.clone();
    let mut examples = company.examples.clone();
    let mut vars = company.default_variables.clone();

    if let Some(site) = site {
        path.push(site.source.clone());
        if let Some(o) = &site.template_override {
            template = o.clone();
        } else if let Some(add) = &site.template_additions {
            template = format!("{}\n\n{}\n", template.trim_end(), add.trim_end());
        }
        examples.extend(site.examples.iter().cloned());
        vars = merge_vars(&vars, &site.variables);
    }
    if let Some(agent) = agent {
        if agent.template_override.is_some() || agent.template_additions.is_some() {
            return Err(PromptError::AgentTemplateChange(agent.source.clone()));
        }
        path.push(agent.source.clone());
        examples.extend(agent.examples.iter().cloned());
        vars = merge_vars(&vars, &agent.variables);
    }
    if !runtime.is_empty() {
        path.push("runtime".into());
        vars = merge_vars(&vars, runtime);
    }
    let text = render(&company.id, &template, &vars)?;
    Ok(ResolvedPrompt {
        text,
        variables: vars,
        examples,
        resolution_path: path,
    })
}

fn display_value(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Array(a) if a.iter().all(Value::is_string) => a
            .iter()
            .filter_map(Value::as_str)
            .collect::<Vec<_>>()
            .join(", "),
        Value::Null => String::new(),
        other => other.to_string(),
    }
}

/// Strict `{{name}}` substitution. Every placeholder must have a value.
pub fn render(template_id: &str, template: &str, vars: &Vars) -> Result<String, PromptError> {
    let mut out = String::with_capacity(template.len());
    let mut missing = Vec::new();
    let mut rest = template;
    let mut offset = 0;
    while let Some(i) = rest.find("{{") {
        out.push_str(&rest[..i]);
        let after = &rest[i + 2..];
        let end = after.find("}}").ok_or(PromptError::Unterminated {
            template: template_id.into(),
            at: offset + i,
        })?;
        let name = after[..end].trim();
        match vars.get(name) {
            Some(v) => out.push_str(&display_value(v)),
            None => {
                if !missing.iter().any(|m| m == name) {
                    missing.push(name.to_owned());
                }
            }
        }
        let consumed = i + 2 + end + 2;
        offset += consumed;
        rest = &rest[consumed..];
    }
    out.push_str(rest);
    if missing.is_empty() {
        Ok(out)
    } else {
        Err(PromptError::MissingVariables {
            template: template_id.into(),
            missing,
        })
    }
}

/// A site's prompt inputs: name, house style and its writer-prompt layer.
#[derive(Debug, Clone)]
pub struct SiteContext {
    pub site_id: String,
    pub style_guide: StyleGuide,
    pub layer: PromptLayer,
}

impl SiteContext {
    /// Builds the site layer: writer-prompt.json overrides plus the formatted
    /// house style as the `house_style` variable.
    pub fn new(
        site_id: &str,
        style_guide: StyleGuide,
        writer_prompt: Option<&Value>,
    ) -> Result<Self, ConfigError> {
        let mut layer = match writer_prompt {
            Some(doc) => PromptLayer::from_site_writer_prompt(site_id, doc)?,
            None => PromptLayer {
                source: format!("site:{site_id}"),
                ..Default::default()
            },
        };
        layer.variables.insert(
            "house_style".into(),
            Value::String(format_house_style(&style_guide)),
        );
        Ok(Self {
            site_id: site_id.into(),
            style_guide,
            layer,
        })
    }

    /// Same site, without the template additions (they are writer-specific).
    pub fn variables_only(&self) -> PromptLayer {
        PromptLayer {
            template_override: None,
            template_additions: None,
            examples: Vec::new(),
            ..self.layer.clone()
        }
    }
}
