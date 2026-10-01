//! Browser LLM model registry (`config/models.toml`, plan D / ADR-0026).

use serde::{Deserialize, Serialize};

use crate::roles::{ConfigError, Role, Seniority, Tier};

pub const MODELS_TOML: &str = include_str!("../../../config/models.toml");

/// Prefix marking an unverified placeholder value.
pub const TODO_PREFIX: &str = "TODO";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ModelEntry {
    pub id: String,
    #[serde(default)]
    pub description: String,
    pub hf_repo: String,
    pub dtype: String,
    pub size_bytes: u64,
    pub sha256: String,
    pub context: u32,
    pub min_max_buffer_size: u64,
    pub min_max_storage_buffer_binding_size: u64,
    pub approx_vram_mb: u32,
    pub tier: Tier,
    pub roles: Vec<Role>,
    #[serde(default)]
    pub eval_pending: bool,
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum RegistryError {
    #[error("model {id}: sha256 is an unverified placeholder ({value:?}); refusing to load")]
    UnverifiedChecksum { id: String, value: String },
    #[error("model {id}: hf_repo is an unverified placeholder ({value:?})")]
    UnknownRepo { id: String, value: String },
}

impl ModelEntry {
    /// The checksum to verify downloads against. A placeholder is an error:
    /// a client must never load unverified weights.
    pub fn verified_sha256(&self) -> Result<&str, RegistryError> {
        let ok = self.sha256.len() == 64 && self.sha256.chars().all(|c| c.is_ascii_hexdigit());
        if ok {
            Ok(&self.sha256)
        } else {
            Err(RegistryError::UnverifiedChecksum {
                id: self.id.clone(),
                value: self.sha256.clone(),
            })
        }
    }

    pub fn verified_repo(&self) -> Result<&str, RegistryError> {
        if self.hf_repo.starts_with(TODO_PREFIX) {
            Err(RegistryError::UnknownRepo {
                id: self.id.clone(),
                value: self.hf_repo.clone(),
            })
        } else {
            Ok(&self.hf_repo)
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawRegistry {
    model: Vec<ModelEntry>,
}

#[derive(Debug, Clone)]
pub struct ModelRegistry {
    models: Vec<ModelEntry>,
}

impl ModelRegistry {
    pub fn builtin() -> Self {
        Self::from_toml_str(MODELS_TOML).expect("config/models.toml is valid")
    }

    pub fn from_toml_str(s: &str) -> Result<Self, ConfigError> {
        let raw: RawRegistry = toml::from_str(s).map_err(|e| ConfigError::Parse(e.to_string()))?;
        let mut seen = std::collections::BTreeSet::new();
        for m in &raw.model {
            if !seen.insert(m.id.clone()) {
                return Err(ConfigError::Invalid(format!(
                    "duplicate model id {:?}",
                    m.id
                )));
            }
            if m.roles.is_empty() {
                return Err(ConfigError::Invalid(format!(
                    "model {:?} has no roles",
                    m.id
                )));
            }
            if m.size_bytes == 0 || m.context == 0 {
                return Err(ConfigError::Invalid(format!(
                    "model {:?} has zero size/context",
                    m.id
                )));
            }
        }
        Ok(Self { models: raw.model })
    }

    pub fn models(&self) -> &[ModelEntry] {
        &self.models
    }

    pub fn get(&self, id: &str) -> Option<&ModelEntry> {
        self.models.iter().find(|m| m.id == id)
    }

    /// Every entry that is not shippable yet (placeholder checksum or repo),
    /// with the reason. Used by CI and the startup log so stubs stay loud.
    pub fn unverified(&self) -> Vec<RegistryError> {
        let mut out = Vec::new();
        for m in &self.models {
            if let Err(e) = m.verified_sha256() {
                out.push(e);
            }
            if let Err(e) = m.verified_repo() {
                out.push(e);
            }
        }
        out
    }

    /// Picks the local model for a staff member: eligible models allow the
    /// role, are not `eval_pending`, need at most the device tier, and are at
    /// least the job's minimum tier. Junior gets the smallest, Mid the middle,
    /// Senior/Star the largest that fits.
    pub fn select(
        &self,
        device: Tier,
        job_min_tier: Tier,
        role: Role,
        seniority: Seniority,
    ) -> Option<&ModelEntry> {
        let mut eligible: Vec<&ModelEntry> = self
            .models
            .iter()
            .filter(|m| {
                !m.eval_pending
                    && m.tier <= device
                    && m.tier >= job_min_tier
                    && m.roles.contains(&role)
            })
            .collect();
        if eligible.is_empty() {
            return None;
        }
        eligible.sort_by_key(|m| m.size_bytes);
        let idx = match seniority {
            Seniority::Junior => 0,
            Seniority::Mid => (eligible.len() - 1) / 2,
            Seniority::Senior | Seniority::Star => eligible.len() - 1,
        };
        Some(eligible[idx])
    }
}
