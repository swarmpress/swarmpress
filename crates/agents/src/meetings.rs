//! Meetings (ADR-0012, ADR-0062).
//!
//! Two protocols live here:
//!
//! - **The moderated meeting** of ADR-0012 ([`run_meeting`]): the
//!   Editor-in-Chief moderates; each round a structured call returns
//!   `{next, prompt, done}`; the chosen participant then speaks in a separate
//!   call. The meeting closes with a structured outcome `{briefs, decisions,
//!   escalations}`. Kept for a faster model or a cloud tier.
//! - **The pitch round** of ADR-0062, the local tier's standup: a
//!   deterministic cap ([`standup_cap`]); one opening by the moderator
//!   ([`opening_prompt`]); one structured pitch per free writer
//!   ([`pitch_prompt`], [`pitch_schema`]); one commissioning call
//!   ([`commission_prompt`], [`commission_schema`]). The orchestrator drives
//!   it (`crates/orchestrator/src/standup.rs`) with the stage store, the
//!   transcript and de-duplication; this module holds the protocol's pure
//!   parts: schemas, prompts, the cap and [`trim_to_sentence`].
//!
//! The orchestrator owns the loop; the LLM only returns artifacts.

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
///
/// `on_event` has no `Send` bound, so a host can pass a callback that is not
/// `Send` (a JS function on wasm32). The turn's deltas are therefore buffered
/// (the [`crate::llm::DeltaSink`] the backend writes to must be `Send`) and
/// reported when the turn's call returns, before its
/// [`MeetingEvent::TurnFinished`].
pub async fn run_meeting(
    llm: &dyn Llm,
    spec: &MeetingSpec,
    on_event: &mut dyn FnMut(MeetingEvent),
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
            reasoning_tokens: None,
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
            reasoning_tokens: None,
        };
        calls += 1;
        let mut deltas: Vec<String> = Vec::new();
        let mut sink = |d: &str| deltas.push(d.to_owned());
        let text = llm
            .generate(&turn, Some(&mut sink))
            .await
            .map_err(|error| MeetingError::Llm {
                stage: "speaker",
                error,
            })?;
        for text in deltas {
            on_event(MeetingEvent::Delta {
                seq,
                speaker: speaker.id.clone(),
                text,
            });
        }
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
        reasoning_tokens: None,
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

// ---------------------------------------------------------------------------
// The pitch round (ADR-0062; `docs/design/mvp-pipeline.md` section 2)
// ---------------------------------------------------------------------------

/// Commissions one standup makes at most (the sim's `MAX_BRIEFS_PER_STANDUP`).
pub const MAX_COMMISSIONS: usize = 8;
/// Model minutes a game day may spend on articles unless the host says
/// otherwise (design section 2 "Cap"; a setting, unmeasured).
pub const MODEL_MINUTES_PER_DAY: f64 = 45.0;
/// The shortest and longest commission, words.
pub const MIN_TARGET_WORDS: u32 = 500;
pub const MAX_TARGET_WORDS: u32 = 1500;
/// The length of a commission when the commissioning call failed.
pub const DEFAULT_TARGET_WORDS: u32 = 800;
/// Answer budgets of the round's calls, tokens.
pub const OPENING_ANSWER: u32 = 200;
pub const PITCH_ANSWER: u32 = 400;
pub const COMMISSION_ANSWER: u32 = 400;
/// Reasoning a pitch or the commissioning call may use before answering.
pub const PITCH_REASONING: u32 = 512;
/// Added to a turn that was cut off at its token limit, for its one retry.
pub const TWO_SENTENCES: &str = "Keep it short: two sentences at most.";
/// The line of the context pack that states the cap (`… at most 2`).
pub const CAP_LABEL: &str = "Commissions today: at most ";

/// The pitch alias the commissioning call names (`P1`, `P2`, …).
pub fn pitch_alias(index: usize) -> String {
    format!("P{}", index + 1)
}

/// How many articles a standup may commission (ADR-0062 decision 3): the
/// smallest of the free writers, the room under the work-in-progress limit
/// (`None`: the host did not say; the sim still enforces it), the model's
/// throughput for a game day and [`MAX_COMMISSIONS`].
///
/// Throughput is `⌊model_minutes_per_day ÷ minutes_per_article⌋`, at least
/// 1, and 1 until the host has measured an article (`None`). Host policy,
/// never sim state: floating point is fine here.
#[allow(clippy::float_arithmetic)]
pub fn standup_cap(
    free_writers: usize,
    room: Option<usize>,
    minutes_per_article: Option<f64>,
    model_minutes_per_day: f64,
) -> usize {
    let throughput = match minutes_per_article {
        Some(m) if m.is_finite() && m > 0.0 => {
            let n = (model_minutes_per_day.max(0.0) / m).floor();
            if n >= MAX_COMMISSIONS as f64 {
                MAX_COMMISSIONS
            } else {
                // 0 ≤ n < MAX_COMMISSIONS: the cast is exact.
                #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
                let n = n as usize;
                n.max(1)
            }
        }
        _ => 1,
    };
    free_writers
        .min(room.unwrap_or(usize::MAX))
        .min(throughput)
        .min(MAX_COMMISSIONS)
}

/// One writer's pitch: what they say aloud (the speech bubble) and the
/// article they propose.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Pitch {
    pub say: String,
    pub title: String,
    pub angle: String,
    pub keywords: Vec<String>,
}

/// The schema of a pitch: flat, with keywords the browser's subset
/// validator supports.
pub fn pitch_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["say", "title", "angle", "keywords"],
        "properties": {
            "say": {"type": "string", "minLength": 20, "maxLength": 400},
            "title": {"type": "string", "minLength": 10, "maxLength": 70},
            "angle": {"type": "string", "minLength": 10, "maxLength": 240},
            "keywords": {"type": "array", "minItems": 2, "maxItems": 6,
                         "items": {"type": "string", "minLength": 2, "maxLength": 40}}
        }
    })
}

/// One commission: a pitch by alias and its length.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Commission {
    pub pitch: String,
    pub target_words: u32,
}

/// The commissioning call's answer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CommissionDecision {
    pub commission: Vec<Commission>,
    #[serde(default)]
    pub decisions: Vec<String>,
    #[serde(default)]
    pub escalations: Vec<Escalation>,
}

/// The schema of the commissioning call over `pitches` pitches with at most
/// `cap` commissions (at least one: the round only asks when it has a pitch
/// and room).
pub fn commission_schema(pitches: usize, cap: usize) -> Value {
    let aliases: Vec<Value> = (0..pitches.max(1)).map(|i| json!(pitch_alias(i))).collect();
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["commission", "decisions", "escalations"],
        "properties": {
            "commission": {"type": "array", "minItems": 1, "maxItems": cap.max(1), "items": {
                "type": "object",
                "additionalProperties": false,
                "required": ["pitch", "target_words"],
                "properties": {
                    "pitch": {"type": "string", "enum": aliases},
                    "target_words": {"type": "integer", "minimum": MIN_TARGET_WORDS, "maximum": MAX_TARGET_WORDS}
                }
            }},
            "decisions": {"type": "array", "maxItems": 5,
                          "items": {"type": "string", "minLength": 1, "maxLength": 200}},
            "escalations": {"type": "array", "maxItems": 3, "items": {
                "type": "object",
                "additionalProperties": false,
                "required": ["kind", "summary"],
                "properties": {
                    "kind": {"type": "string", "enum": escalation_kinds()},
                    "summary": {"type": "string", "minLength": 1, "maxLength": 300}
                }
            }}
        }
    })
}

/// A pitch as the prompts list it.
#[derive(Debug, Clone, Copy)]
pub struct PitchLine<'a> {
    pub alias: &'a str,
    /// The writer's name and staff id.
    pub name: &'a str,
    pub id: &'a str,
    pub pitch: &'a Pitch,
}

/// The text up to its last complete sentence (a sentence ends with `.`, `!`,
/// `?` or `…`, closing quotes and brackets included, before whitespace or the
/// end), trimmed; empty when there is none. The twin of `trimToSentence` in
/// `apps/game/src/llm/structured.ts`.
pub fn trim_to_sentence(text: &str) -> String {
    const ENDS: [char; 4] = ['.', '!', '?', '…'];
    const CLOSERS: [char; 7] = ['"', '\'', ')', ']', '»', '”', '’'];
    let t = text.trim_end();
    let chars: Vec<(usize, char)> = t.char_indices().collect();
    let mut cut = None;
    let mut i = 0;
    while i < chars.len() {
        if !ENDS.contains(&chars[i].1) {
            i += 1;
            continue;
        }
        let mut j = i + 1;
        while j < chars.len() && CLOSERS.contains(&chars[j].1) {
            j += 1;
        }
        match chars.get(j) {
            None => cut = Some(t.len()),
            Some(&(at, c)) if c.is_whitespace() => cut = Some(at),
            Some(_) => {}
        }
        i = j;
    }
    cut.map(|end| t[..end].trim().to_string())
        .unwrap_or_default()
}

/// The opening call's user turn: the moderator opens over the context pack.
pub fn opening_prompt(context: &str, writers: &[&str]) -> String {
    let pitching = if writers.is_empty() {
        "(nobody)".to_string()
    } else {
        writers.join(", ")
    };
    format!(
        "## Task: standup opening\nPitching: {pitching}\n\n{context}\n\n\
Open the standup in two or three sentences, in your own voice: say what the publication needs \
today and how many new articles we can take on. Plain text only: no lists, no names of people \
who are not here, no stage directions."
    )
}

fn pitch_lines(lines: &[PitchLine<'_>], with_angle: bool) -> String {
    if lines.is_empty() {
        return "(none yet)".into();
    }
    lines
        .iter()
        .map(|l| {
            let angle = if with_angle {
                format!(" — angle: {}", l.pitch.angle)
            } else {
                String::new()
            };
            format!(
                "- {} {} ({}): «{}»{angle} — keywords: {}",
                l.alias,
                l.name,
                l.id,
                l.pitch.title,
                l.pitch.keywords.join(", ")
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// The user turn of one writer's pitch: the context, the opening and the
/// pitches made before it.
pub fn pitch_prompt(
    context: &str,
    writer_name: &str,
    writer_id: &str,
    opening: Option<&str>,
    earlier: &[PitchLine<'_>],
) -> String {
    format!(
        "## Task: pitch\nWriter: {writer_name} ({writer_id})\n\n{context}\n\nOpening: {opening}\n\
Pitches so far:\n{earlier}\n\n\
Pitch one article you could write well, as yourself. Do not pitch anything that is published, \
in flight or already pitched above, and invent no facts, people or businesses.\n\
Answer with JSON only:\n\
- say: what you say aloud in the meeting, one to three sentences in the first person;\n\
- title: the working title, 10 to 70 characters;\n\
- angle: what the article is about and for whom, in one sentence;\n\
- keywords: 2 to 6 search phrases.",
        opening = opening.unwrap_or("(none)"),
        earlier = pitch_lines(earlier, false),
    )
}

/// The user turn of the commissioning call.
pub fn commission_prompt(context: &str, pitches: &[PitchLine<'_>]) -> String {
    format!(
        "## Task: commission\n\n{context}\n\nPitches:\n{pitches}\n\n\
Commission the strongest pitches, as many as today allows and no more, each with a target length \
between {MIN_TARGET_WORDS} and {MAX_TARGET_WORDS} words. Also give the short decisions the \
meeting made and anything that must go to the CEO (escalations: {kinds}). Answer with JSON only.",
        pitches = pitch_lines(pitches, true),
        kinds = escalation_kinds().join(", "),
    )
}
