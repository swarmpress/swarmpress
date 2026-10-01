//! Meetings as streamed multi-agent conversations (ADR-0012).
//!
//! The Editor-in-Chief moderates: each round a structured call returns
//! `{next, prompt, done}`; the chosen participant then speaks in a separate
//! streamed call (deltas surface through the event callback, straight into
//! speech bubbles). The meeting closes with a structured outcome
//! `{briefs, decisions, escalations}`. The orchestrator owns the loop; the
//! LLM only returns artifacts.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::llm::{CallProfile, Llm, LlmError, LlmMessage, LlmRequest};
use crate::roles::{JobKind, Role, Seniority};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Participant {
    /// Staff id; also the value the moderator uses in `next`.
    pub id: String,
    pub name: String,
    pub role: Role,
    pub seniority: Option<Seniority>,
    /// Resolved stable system prompt for this participant.
    pub system_prompt: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MeetingSpec {
    pub id: String,
    pub topic: String,
    pub moderator: Participant,
    pub participants: Vec<Participant>,
    /// Speaking turns (excluding moderator decisions and the closing call).
    pub max_turns: u32,
    pub max_tokens_per_turn: u32,
    pub max_tokens_outcome: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Utterance {
    pub seq: u32,
    pub speaker: String,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ModeratorDecision {
    pub next: String,
    pub prompt: String,
    pub done: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BriefDraft {
    pub title: String,
    pub angle: String,
    pub assignee: String,
    pub keywords: Vec<String>,
    pub target_words: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Escalation {
    pub kind: String,
    pub summary: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MeetingOutcome {
    pub briefs: Vec<BriefDraft>,
    pub decisions: Vec<String>,
    pub escalations: Vec<Escalation>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum EndedBy {
    Moderator,
    MaxTurns,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MeetingResult {
    pub transcript: Vec<Utterance>,
    pub outcome: MeetingOutcome,
    pub ended_by: EndedBy,
    pub llm_calls: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MeetingEvent {
    TurnStarted {
        seq: u32,
        speaker: String,
    },
    Delta {
        seq: u32,
        speaker: String,
        text: String,
    },
    TurnFinished(Utterance),
    Closed,
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum MeetingError {
    #[error("meeting has no participants")]
    NoParticipants,
    #[error("moderator picked unknown speaker {0:?}")]
    UnknownSpeaker(String),
    #[error("outcome brief assigned to unknown participant {0:?}")]
    UnknownAssignee(String),
    #[error("malformed {what}: {detail}")]
    Malformed { what: &'static str, detail: String },
    #[error("llm call failed during {stage}: {error}")]
    Llm {
        stage: &'static str,
        error: LlmError,
    },
}

pub fn escalation_kinds() -> [&'static str; 4] {
    ["costly_pitch", "risky_pitch", "staffing", "policy"]
}

/// Schema for the moderator's per-turn decision; `next` is restricted to the
/// participant ids (or `""` when done).
pub fn moderator_schema(spec: &MeetingSpec) -> Value {
    let mut ids: Vec<Value> = spec.participants.iter().map(|p| json!(p.id)).collect();
    ids.push(json!(""));
    json!({
        "type": "object",
        "properties": {
            "next": {"type": "string", "enum": ids},
            "prompt": {"type": "string"},
            "done": {"type": "boolean"}
        },
        "required": ["next", "prompt", "done"],
        "additionalProperties": false
    })
}

pub fn outcome_schema(spec: &MeetingSpec) -> Value {
    let ids: Vec<Value> = spec.participants.iter().map(|p| json!(p.id)).collect();
    json!({
        "type": "object",
        "properties": {
            "briefs": {"type": "array", "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "minLength": 1},
                    "angle": {"type": "string"},
                    "assignee": {"type": "string", "enum": ids},
                    "keywords": {"type": "array", "items": {"type": "string"}},
                    "target_words": {"type": "integer", "minimum": 100, "maximum": 5000}
                },
                "required": ["title", "angle", "assignee", "keywords", "target_words"],
                "additionalProperties": false
            }},
            "decisions": {"type": "array", "items": {"type": "string"}},
            "escalations": {"type": "array", "items": {
                "type": "object",
                "properties": {
                    "kind": {"type": "string", "enum": escalation_kinds()},
                    "summary": {"type": "string"}
                },
                "required": ["kind", "summary"],
                "additionalProperties": false
            }}
        },
        "required": ["briefs", "decisions", "escalations"],
        "additionalProperties": false
    })
}

fn render_transcript(spec: &MeetingSpec, transcript: &[Utterance]) -> String {
    if transcript.is_empty() {
        return "(nobody has spoken yet)".into();
    }
    transcript
        .iter()
        .map(|u| {
            let name = spec
                .participants
                .iter()
                .find(|p| p.id == u.speaker)
                .map_or(u.speaker.as_str(), |p| p.name.as_str());
            format!("[{}] {} ({}): {}", u.seq, name, u.speaker, u.text)
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn parse<T: serde::de::DeserializeOwned>(v: Value, what: &'static str) -> Result<T, MeetingError> {
    serde_json::from_value(v).map_err(|e| MeetingError::Malformed {
        what,
        detail: e.to_string(),
    })
}

fn profile(p: &Participant) -> CallProfile {
    CallProfile {
        job: JobKind::Standup,
        role: p.role,
        seniority: p.seniority,
        staff_id: Some(p.id.clone()),
    }
}

/// Runs a meeting to completion.
pub async fn run_meeting(
    llm: &dyn Llm,
    spec: &MeetingSpec,
    on_event: &mut (dyn FnMut(MeetingEvent) + Send),
) -> Result<MeetingResult, MeetingError> {
    if spec.participants.is_empty() {
        return Err(MeetingError::NoParticipants);
    }
    let mod_schema = moderator_schema(spec);
    let mut transcript: Vec<Utterance> = Vec::new();
    let mut calls = 0u32;
    let mut ended_by = EndedBy::MaxTurns;

    for _ in 0..spec.max_turns {
        let turns_left = spec.max_turns - transcript.len() as u32;
        let decide = LlmRequest {
            profile: profile(&spec.moderator),
            system: vec![spec.moderator.system_prompt.clone()],
            messages: vec![LlmMessage::user(format!(
                "Meeting: {topic}\n\nTranscript so far:\n{t}\n\n{turns_left} speaking turn(s) left. Decide who speaks next and what you ask them, or set done=true if the agenda is covered.",
                topic = spec.topic,
                t = render_transcript(spec, &transcript),
            ))],
            max_tokens: 512,
        };
        calls += 1;
        let decision: ModeratorDecision = parse(
            llm.structured(&decide, &mod_schema)
                .await
                .map_err(|error| MeetingError::Llm {
                    stage: "moderator",
                    error,
                })?,
            "moderator decision",
        )?;
        if decision.done {
            ended_by = EndedBy::Moderator;
            break;
        }
        let speaker = spec
            .participants
            .iter()
            .find(|p| p.id == decision.next)
            .ok_or_else(|| MeetingError::UnknownSpeaker(decision.next.clone()))?;

        let seq = transcript.len() as u32 + 1;
        on_event(MeetingEvent::TurnStarted {
            seq,
            speaker: speaker.id.clone(),
        });
        let turn = LlmRequest {
            profile: profile(speaker),
            system: vec![speaker.system_prompt.clone()],
            messages: vec![LlmMessage::user(format!(
                "Meeting: {topic}\n\nTranscript so far:\n{t}\n\n{moderator} asks you: {prompt}",
                topic = spec.topic,
                t = render_transcript(spec, &transcript),
                moderator = spec.moderator.name,
                prompt = decision.prompt,
            ))],
            max_tokens: spec.max_tokens_per_turn,
        };
        calls += 1;
        let speaker_id = speaker.id.clone();
        let mut sink = |d: &str| {
            on_event(MeetingEvent::Delta {
                seq,
                speaker: speaker_id.clone(),
                text: d.to_owned(),
            })
        };
        let text = llm
            .generate(&turn, Some(&mut sink))
            .await
            .map_err(|error| MeetingError::Llm {
                stage: "speaker",
                error,
            })?;
        let utterance = Utterance {
            seq,
            speaker: speaker.id.clone(),
            text: text.trim().to_owned(),
        };
        on_event(MeetingEvent::TurnFinished(utterance.clone()));
        transcript.push(utterance);
    }

    let close = LlmRequest {
        profile: profile(&spec.moderator),
        system: vec![spec.moderator.system_prompt.clone()],
        messages: vec![LlmMessage::user(format!(
            "Meeting: {topic}\n\nFull transcript:\n{t}\n\nThe meeting is over. Write the outcome: the briefs you commission, the decisions, and anything that must go to the CEO.",
            topic = spec.topic,
            t = render_transcript(spec, &transcript),
        ))],
        max_tokens: spec.max_tokens_outcome,
    };
    calls += 1;
    let outcome: MeetingOutcome = parse(
        llm.structured(&close, &outcome_schema(spec))
            .await
            .map_err(|error| MeetingError::Llm {
                stage: "outcome",
                error,
            })?,
        "meeting outcome",
    )?;
    for b in &outcome.briefs {
        if !spec.participants.iter().any(|p| p.id == b.assignee) {
            return Err(MeetingError::UnknownAssignee(b.assignee.clone()));
        }
    }
    on_event(MeetingEvent::Closed);
    Ok(MeetingResult {
        transcript,
        outcome,
        ended_by,
        llm_calls: calls,
    })
}
