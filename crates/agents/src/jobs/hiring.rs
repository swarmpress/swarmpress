//! `CandidateGeneration` (ADR-0030): an LLM writes a hiring candidate in the
//! persona schema; the candidate is validated against the persona rules and
//! the catalog (no duplicate id/slug/name, relationships to existing people,
//! requested role and seniority) before it enters the pool.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::{run_structured, JobCtx};
use crate::llm::{Llm, LlmError};
use crate::personas::{persona_json_schema, Catalog, Persona};
use crate::plan::{with_plan_ops, PlanOp};
use crate::roles::{JobKind, Role, Seniority};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Colleague {
    pub slug: String,
    pub name: String,
    pub role: Role,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SalaryBand {
    pub min: u32,
    pub max: u32,
}

/// What the hiring desk asks for.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CandidateRequest {
    pub role: Role,
    pub department: String,
    pub seniority: Seniority,
    /// The id the candidate must use (next free pool id).
    pub id: u16,
    pub salary_band_eur_month: SalaryBand,
    pub taken_slugs: Vec<String>,
    pub taken_names: Vec<String>,
    /// Existing people the candidate may know (relationships).
    pub colleagues: Vec<Colleague>,
    /// Optional steer ("speaks German", "knows Liguria").
    #[serde(default)]
    pub notes: Option<String>,
}

impl CandidateRequest {
    /// A request for `role`/`seniority` against `catalog`. Panics for
    /// non-staff roles (CEO, System).
    pub fn new(catalog: &Catalog, role: Role, seniority: Seniority, notes: Option<String>) -> Self {
        let (min, max) = role
            .salary_band_eur_month()
            .expect("candidates are for staff roles");
        Self {
            role,
            department: role.department().expect("staff role").as_str().into(),
            seniority,
            id: catalog.next_pool_id(),
            salary_band_eur_month: SalaryBand { min, max },
            taken_slugs: catalog.all().iter().map(|p| p.slug.clone()).collect(),
            taken_names: catalog.all().iter().map(|p| p.name.clone()).collect(),
            colleagues: catalog
                .staff()
                .map(|p| Colleague {
                    slug: p.slug.clone(),
                    name: p.name.clone(),
                    role: p.role,
                })
                .collect(),
            notes,
        }
    }
}

/// The job's output: the candidate (a persona in JSON form) plus plan ops.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CandidateOutput {
    pub candidate: Persona,
    pub plan_ops: Vec<PlanOp>,
}

pub fn candidate_schema() -> Value {
    with_plan_ops(json!({
        "type": "object",
        "properties": { "candidate": persona_json_schema() },
        "required": ["candidate"],
        "additionalProperties": false
    }))
}

/// Validates a generated candidate: persona rules, the requested role,
/// seniority and id, and catalog uniqueness/relationships.
pub fn candidate_check(
    catalog: &Catalog,
    req: &CandidateRequest,
    out: &Value,
) -> Result<(), Vec<String>> {
    let Some(c) = out.get("candidate") else {
        return Err(vec!["missing candidate".into()]);
    };
    let p = Persona::from_json_value(c)?;
    let mut e = Vec::new();
    if p.role != req.role {
        e.push(format!(
            "/candidate/role: requested {}, got {}",
            req.role, p.role
        ));
    }
    if p.seniority != req.seniority {
        e.push(format!(
            "/candidate/seniority: requested {}, got {}",
            req.seniority.as_str(),
            p.seniority.as_str()
        ));
    }
    if p.id != req.id {
        e.push(format!("/candidate/id: use the given id {}", req.id));
    }
    if let Err(more) = catalog.admit(&p) {
        e.extend(more.into_iter().map(|m| format!("/candidate: {m}")));
    }
    super::finish(e)
}

/// Generates one candidate and validates it against `catalog`.
pub async fn generate_candidate(
    llm: &dyn Llm,
    ctx: JobCtx<'_>,
    catalog: &Catalog,
    req: &CandidateRequest,
) -> Result<CandidateOutput, LlmError> {
    let check = |out: &Value| candidate_check(catalog, req, out);
    run_structured(
        llm,
        JobKind::CandidateGeneration,
        ctx,
        "Write one hiring candidate for the requested role and seniority, in the persona schema.",
        req,
        &candidate_schema(),
        &check,
    )
    .await
}
