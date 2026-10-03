//! The editorial pipeline: brief → draft → validate (repair loop) → editor
//! review → revision loop (max 3) → approved / rejected / escalated.
//!
//! Pure orchestration over [`Llm`] and [`PageValidator`]: no I/O. It returns
//! the artifacts (drafts, reviews) and the content-state transitions in the
//! order the orchestrator must apply them (state transition first, then the
//! external side effect such as committing the draft or merging the PR).
//! The [`Repo`] trait describes the page storage the server wires around it.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::llm::{CallProfile, Llm, LlmError, LlmMessage, LlmRequest};
use crate::roles::{JobKind, Role, Seniority};
use crate::state::{
    content_transition, Actor, AppliedTransition, ContentEvent, ContentState, TransitionError,
};

/// Page storage (the site repo via the GitHub App on the server; an
/// in-memory map in tests). Defined here, implemented elsewhere.
#[async_trait]
pub trait Repo: Send + Sync {
    async fn read_page(&self, path: &str) -> Result<Option<Value>, RepoError>;
    async fn write_page(&self, path: &str, page: &Value, message: &str) -> Result<(), RepoError>;
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("repo error: {0}")]
pub struct RepoError(pub String);

/// Deterministic page checks (schema, closed-world links and media, house
/// style). Errors are fed back to the writer verbatim.
pub trait PageValidator: Send + Sync {
    fn validate(&self, page: &Value) -> Result<(), Vec<String>>;
}

impl<F> PageValidator for F
where
    F: Fn(&Value) -> Result<(), Vec<String>> + Send + Sync,
{
    fn validate(&self, page: &Value) -> Result<(), Vec<String>> {
        self(page)
    }
}

/// A commissioned piece.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Brief {
    pub content_id: String,
    pub title: String,
    pub slug: String,
    pub angle: String,
    pub keywords: Vec<String>,
    pub target_words: u32,
    pub language: String,
    #[serde(default)]
    pub notes: String,
}

impl Brief {
    /// Repo path of the page (drafts live on a branch, not a path).
    pub fn page_path(&self) -> String {
        format!("content/pages/blog/{}.json", self.slug)
    }

    fn render(&self) -> String {
        format!(
            "## Brief\n- **Content id:** {}\n- **Working title:** {}\n- **Slug:** {}\n- **Language:** {}\n- **Angle:** {}\n- **Keywords:** {}\n- **Target length:** about {} words\n{}",
            self.content_id,
            self.title,
            self.slug,
            self.language,
            self.angle,
            self.keywords.join(", "),
            self.target_words,
            if self.notes.is_empty() {
                String::new()
            } else {
                format!("- **Notes:** {}\n", self.notes)
            }
        )
    }
}

/// Who writes and who edits.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Staffing {
    pub writer_id: String,
    pub writer_seniority: Option<Seniority>,
    /// Resolved writer system prompt (company → site → persona).
    pub writer_system: String,
    pub editor_id: String,
    pub editor_seniority: Option<Seniority>,
    pub editor_system: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PipelineConfig {
    /// Approval bar (7; 8 during a credibility crisis).
    pub approve_threshold: u8,
    /// Revision rounds before escalation.
    pub max_revisions: u8,
    /// Validator repair turns per draft.
    pub max_validation_repairs: u8,
    pub page_schema: Value,
    pub draft_max_tokens: u32,
    pub review_max_tokens: u32,
}

impl PipelineConfig {
    pub fn new(page_schema: Value) -> Self {
        Self {
            approve_threshold: 7,
            max_revisions: 3,
            max_validation_repairs: 2,
            page_schema,
            draft_max_tokens: 16000,
            review_max_tokens: 4096,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReviewDecision {
    Approve,
    NeedsChanges,
    Reject,
}

/// The editor's structured review.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EditorReview {
    pub decision: ReviewDecision,
    pub score: u8,
    pub notes: String,
    pub issues: Vec<String>,
    pub high_risk: Vec<String>,
}

pub fn review_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "decision": {"type": "string", "enum": ["approve", "needs_changes", "reject"]},
            "score": {"type": "integer", "minimum": 1, "maximum": 10},
            "notes": {"type": "string"},
            "issues": {"type": "array", "items": {"type": "string"}},
            "high_risk": {"type": "array", "items": {"type": "string"}}
        },
        "required": ["decision", "score", "notes", "issues", "high_risk"],
        "additionalProperties": false
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Stage {
    Draft,
    Revise,
    Review,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum EscalationReason {
    /// Still not approvable after `max_revisions` rounds (ticket:
    /// editor deadlock; or send to the Agency).
    EditorDeadlock { revisions: u8, last_score: u8 },
    /// The draft could not be made valid (ticket / Agency).
    ValidationFailed { stage: Stage, errors: Vec<String> },
    /// The editor flagged high-risk content (CEO decides).
    HighRisk { flags: Vec<String> },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum PipelineOutcome {
    Approved {
        page: Value,
        review: EditorReview,
    },
    Rejected {
        review: EditorReview,
    },
    /// Needs the CEO. Content stays in its current state; the ticket's
    /// answer drives the next transition.
    Escalated {
        reason: EscalationReason,
        page: Option<Value>,
    },
    /// A call failed (refusal, backend error). The stage blocks and a ticket
    /// opens; refusals are never retried with the same prompt.
    Blocked {
        stage: Stage,
        error: LlmError,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PipelineRun {
    pub outcome: PipelineOutcome,
    pub final_state: ContentState,
    /// In application order.
    pub transitions: Vec<AppliedTransition>,
    /// Every validated draft, in order (the first, then each revision).
    pub drafts: Vec<Value>,
    pub reviews: Vec<EditorReview>,
    pub revisions: u8,
    pub llm_calls: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum PipelineError {
    #[error("brief must be in state brief_created, got {0}")]
    WrongStartState(ContentState),
    #[error(transparent)]
    Transition(#[from] TransitionError),
}

struct Run<'a> {
    llm: &'a dyn Llm,
    validator: &'a dyn PageValidator,
    brief: &'a Brief,
    staff: &'a Staffing,
    cfg: &'a PipelineConfig,
    state: ContentState,
    transitions: Vec<AppliedTransition>,
    drafts: Vec<Value>,
    reviews: Vec<EditorReview>,
    calls: u32,
}

enum DraftResult {
    Ok(Value),
    Invalid(Vec<String>),
    Failed(LlmError),
}

impl Run<'_> {
    fn apply(&mut self, event: ContentEvent, actor: &Actor) -> Result<(), PipelineError> {
        let to = content_transition(self.state, event, actor)?;
        self.transitions.push(AppliedTransition {
            from: self.state,
            event,
            to,
            actor: actor.role,
        });
        self.state = to;
        Ok(())
    }

    fn writer(&self) -> Actor {
        Actor::new(Role::Writer, &self.staff.writer_id)
    }

    fn editor(&self) -> Actor {
        Actor::new(Role::Editor, &self.staff.editor_id)
    }

    /// One structured writer call plus the validator repair loop.
    async fn write(&mut self, job: JobKind, mut messages: Vec<LlmMessage>) -> DraftResult {
        let profile = CallProfile {
            job,
            role: Role::Writer,
            seniority: self.staff.writer_seniority,
            staff_id: Some(self.staff.writer_id.clone()),
        };
        let mut repairs = 0;
        loop {
            let req = LlmRequest {
                profile: profile.clone(),
                system: vec![self.staff.writer_system.clone()],
                messages: messages.clone(),
                max_tokens: self.cfg.draft_max_tokens,
                reasoning_tokens: None,
            };
            self.calls += 1;
            let page = match self.llm.structured(&req, &self.cfg.page_schema).await {
                Ok(p) => p,
                Err(LlmError::InvalidOutput { errors, .. }) => return DraftResult::Invalid(errors),
                Err(e) => return DraftResult::Failed(e),
            };
            match self.validator.validate(&page) {
                Ok(()) => return DraftResult::Ok(page),
                Err(errors) if repairs >= self.cfg.max_validation_repairs => {
                    return DraftResult::Invalid(errors)
                }
                Err(errors) => {
                    repairs += 1;
                    messages.push(LlmMessage::assistant(page.to_string()));
                    messages.push(LlmMessage::user(claude::repair_prompt(&errors)));
                }
            }
        }
    }

    async fn review(&mut self, page: &Value) -> Result<EditorReview, LlmError> {
        let req = LlmRequest {
            profile: CallProfile {
                job: JobKind::EditReview,
                role: Role::Editor,
                seniority: self.staff.editor_seniority,
                staff_id: Some(self.staff.editor_id.clone()),
            },
            system: vec![self.staff.editor_system.clone()],
            messages: vec![LlmMessage::user(format!(
                "{brief}\n## Draft (revision {rev})\n```json\n{page}\n```\n\nReview this draft against the brief, the editorial standards and the house style. The approval bar is {bar}.",
                brief = self.brief.render(),
                rev = self.drafts.len().saturating_sub(1),
                page = serde_json::to_string_pretty(page).unwrap_or_default(),
                bar = self.cfg.approve_threshold,
            ))],
            max_tokens: self.cfg.review_max_tokens,
            reasoning_tokens: None,
        };
        self.calls += 1;
        let v = self.llm.structured(&req, &review_schema()).await?;
        serde_json::from_value(v).map_err(|e| LlmError::invalid(vec![format!("review: {e}")]))
    }

    fn finish(self, outcome: PipelineOutcome) -> PipelineRun {
        PipelineRun {
            outcome,
            final_state: self.state,
            transitions: self.transitions,
            revisions: self.drafts.len().saturating_sub(1) as u8,
            drafts: self.drafts,
            reviews: self.reviews,
            llm_calls: self.calls,
        }
    }
}

/// Runs the pipeline for a brief in state `brief_created`.
pub async fn run_editorial_pipeline(
    llm: &dyn Llm,
    validator: &dyn PageValidator,
    brief: &Brief,
    staff: &Staffing,
    cfg: &PipelineConfig,
    start: ContentState,
) -> Result<PipelineRun, PipelineError> {
    if start != ContentState::BriefCreated {
        return Err(PipelineError::WrongStartState(start));
    }
    let mut run = Run {
        llm,
        validator,
        brief,
        staff,
        cfg,
        state: start,
        transitions: Vec::new(),
        drafts: Vec::new(),
        reviews: Vec::new(),
        calls: 0,
    };

    // Draft.
    run.apply(ContentEvent::WriterStarted, &run.writer())?;
    let first = vec![LlmMessage::user(format!(
        "{}\nWrite the complete page for this brief.",
        brief.render()
    ))];
    let mut page = match run.write(JobKind::Draft, first).await {
        DraftResult::Ok(p) => p,
        DraftResult::Invalid(errors) => {
            return Ok(run.finish(PipelineOutcome::Escalated {
                reason: EscalationReason::ValidationFailed {
                    stage: Stage::Draft,
                    errors,
                },
                page: None,
            }))
        }
        DraftResult::Failed(error) => {
            return Ok(run.finish(PipelineOutcome::Blocked {
                stage: Stage::Draft,
                error,
            }))
        }
    };
    run.drafts.push(page.clone());
    run.apply(ContentEvent::SubmitForReview, &run.writer())?;

    loop {
        let review = match run.review(&page).await {
            Ok(r) => r,
            Err(error) => {
                return Ok(run.finish(PipelineOutcome::Blocked {
                    stage: Stage::Review,
                    error,
                }))
            }
        };
        run.reviews.push(review.clone());

        if !review.high_risk.is_empty() {
            return Ok(run.finish(PipelineOutcome::Escalated {
                reason: EscalationReason::HighRisk {
                    flags: review.high_risk.clone(),
                },
                page: Some(page),
            }));
        }
        match review.decision {
            ReviewDecision::Reject => {
                run.apply(ContentEvent::Reject, &run.editor())?;
                return Ok(run.finish(PipelineOutcome::Rejected { review }));
            }
            // The orchestrator owns the rubric: an "approve" under the bar is
            // treated as a request for changes.
            ReviewDecision::Approve if review.score >= cfg.approve_threshold => {
                run.apply(ContentEvent::Approve, &run.editor())?;
                return Ok(run.finish(PipelineOutcome::Approved { page, review }));
            }
            _ => {}
        }

        let revisions = run.drafts.len() as u8 - 1;
        if revisions >= cfg.max_revisions {
            return Ok(run.finish(PipelineOutcome::Escalated {
                reason: EscalationReason::EditorDeadlock {
                    revisions,
                    last_score: review.score,
                },
                page: Some(page),
            }));
        }
        run.apply(ContentEvent::RequestChanges, &run.editor())?;
        run.apply(ContentEvent::RevisionsApplied, &run.writer())?;
        let msgs = vec![LlmMessage::user(format!(
            "{brief}\n## Your current draft\n```json\n{page}\n```\n\n## Editor feedback (score {score}/10)\n{notes}\n{issues}\nAddress every point and return the complete revised page.",
            brief = brief.render(),
            page = serde_json::to_string_pretty(&page).unwrap_or_default(),
            score = review.score,
            notes = review.notes,
            issues = review.issues.iter().map(|i| format!("- {i}\n")).collect::<String>(),
        ))];
        page = match run.write(JobKind::Revise, msgs).await {
            DraftResult::Ok(p) => p,
            DraftResult::Invalid(errors) => {
                return Ok(run.finish(PipelineOutcome::Escalated {
                    reason: EscalationReason::ValidationFailed {
                        stage: Stage::Revise,
                        errors,
                    },
                    page: Some(page),
                }))
            }
            DraftResult::Failed(error) => {
                return Ok(run.finish(PipelineOutcome::Blocked {
                    stage: Stage::Revise,
                    error,
                }))
            }
        };
        run.drafts.push(page.clone());
        run.apply(ContentEvent::SubmitForReview, &run.writer())?;
    }
}

// ---------------------------------------------------------------------------
// Single-phase steps (docs/mvp.md). The sim owns the article's phases and
// requests one job per phase; these run exactly one phase each and return an
// artifact. State transitions are the sim's (ADR-0011), not done here.
// ---------------------------------------------------------------------------

/// What the writer has to work from in a draft phase.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum DraftInput {
    /// First draft.
    Fresh,
    /// Revision: the previous page and the editor's review of it.
    Revision { page: Value, review: EditorReview },
}

/// Result of one draft (or revision) phase.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum DraftStep {
    /// A schema-valid page that passed the validator.
    Ok { page: Value, llm_calls: u32 },
    /// Still invalid after the repair turns: escalate (ticket / Agency).
    Invalid { errors: Vec<String>, llm_calls: u32 },
    /// The call failed (refusal, backend). Never retried with the same prompt.
    Failed { error: LlmError, llm_calls: u32 },
}

fn step_run<'a>(
    llm: &'a dyn Llm,
    validator: &'a dyn PageValidator,
    brief: &'a Brief,
    staff: &'a Staffing,
    cfg: &'a PipelineConfig,
) -> Run<'a> {
    Run {
        llm,
        validator,
        brief,
        staff,
        cfg,
        state: ContentState::Draft,
        transitions: Vec::new(),
        drafts: Vec::new(),
        reviews: Vec::new(),
        calls: 0,
    }
}

/// Runs one draft or revision phase: a structured writer call plus the
/// validator repair loop.
pub async fn draft_step(
    llm: &dyn Llm,
    validator: &dyn PageValidator,
    brief: &Brief,
    staff: &Staffing,
    cfg: &PipelineConfig,
    input: &DraftInput,
) -> DraftStep {
    let mut run = step_run(llm, validator, brief, staff, cfg);
    let (job, prompt) = match input {
        DraftInput::Fresh => (
            JobKind::Draft,
            format!("{}\nWrite the complete page for this brief.", brief.render()),
        ),
        DraftInput::Revision { page, review } => (
            JobKind::Revise,
            format!(
                "{brief}\n## Your current draft\n```json\n{page}\n```\n\n## Editor feedback (score {score}/10)\n{notes}\n{issues}\nAddress every point and return the complete revised page.",
                brief = brief.render(),
                page = serde_json::to_string_pretty(page).unwrap_or_default(),
                score = review.score,
                notes = review.notes,
                issues = review.issues.iter().map(|i| format!("- {i}\n")).collect::<String>(),
            ),
        ),
    };
    let result = run.write(job, vec![LlmMessage::user(prompt)]).await;
    let llm_calls = run.calls;
    match result {
        DraftResult::Ok(page) => DraftStep::Ok { page, llm_calls },
        DraftResult::Invalid(errors) => DraftStep::Invalid { errors, llm_calls },
        DraftResult::Failed(error) => DraftStep::Failed { error, llm_calls },
    }
}

/// Runs one review phase. The rubric is applied by the caller (the sim
/// compares the score with the company's quality bar); `revision` is the
/// 0-based revision number shown to the editor.
pub async fn review_step(
    llm: &dyn Llm,
    brief: &Brief,
    staff: &Staffing,
    cfg: &PipelineConfig,
    page: &Value,
    revision: usize,
) -> Result<EditorReview, LlmError> {
    let no_validation = |_: &Value| -> Result<(), Vec<String>> { Ok(()) };
    let mut run = step_run(llm, &no_validation, brief, staff, cfg);
    run.drafts = vec![Value::Null; revision + 1];
    run.review(page).await
}
