use std::sync::Arc;

use agents::meetings::{EndedBy, MeetingError};
use agents::prompts::{templates, Vars};
use agents::{
    resolve, run_meeting, ClaudeLlm, FakeLlm, FakeReply, LlmError, MeetingEvent, MeetingSpec,
    Participant, Persona, PromptLayer, Role, RolesConfig, Seniority,
};
use claude::fake::responses;
use claude::FakeClaude;
use serde_json::{json, Value};

fn participant(name: &str) -> Participant {
    let p = Persona::builtin(&name.to_lowercase()).unwrap();
    let agent = PromptLayer::from_persona(&p, "en");
    let text = resolve(
        &templates::meeting_speaker(),
        None,
        Some(&agent),
        &Vars::new(),
    )
    .unwrap()
    .text;
    Participant {
        id: name.to_lowercase(),
        name: name.into(),
        role: p.role,
        seniority: Some(p.seniority),
        system_prompt: text,
    }
}

fn spec(max_turns: u32) -> MeetingSpec {
    let participants = vec![participant("Giulia"), participant("Isabella")];
    let roster = participants
        .iter()
        .map(|p| format!("- {} ({}, {})", p.id, p.name, p.role))
        .collect::<Vec<_>>()
        .join("\n");
    let runtime: Vars = serde_json::from_value(json!({
        "participants": roster,
        "agenda": "Pitches for the autumn harvest week.",
        "max_turns": max_turns,
        "house_style": "## House Style\n(trimmed)",
        "agent_name": "Chiara"
    }))
    .unwrap();
    let eic = resolve(&templates::editor_in_chief(), None, None, &runtime)
        .unwrap()
        .text;
    MeetingSpec {
        id: "standup-day-12".into(),
        topic: "Daily standup".into(),
        moderator: Participant {
            id: "chiara".into(),
            name: "Chiara".into(),
            role: Role::EditorInChief,
            seniority: Some(Seniority::Senior),
            system_prompt: eic,
        },
        participants,
        max_turns,
        max_tokens_per_turn: 400,
        max_tokens_outcome: 2000,
    }
}

fn pick(next: &str, prompt: &str) -> Value {
    json!({"next": next, "prompt": prompt, "done": false})
}

fn done() -> Value {
    json!({"next": "", "prompt": "", "done": true})
}

fn outcome() -> Value {
    json!({
        "briefs": [{
            "title": "Sciacchetrà harvest on the terraces",
            "angle": "Harvest week from the vineyard rows above Manarola",
            "assignee": "giulia",
            "keywords": ["sciacchetrà", "harvest", "Manarola"],
            "target_words": 1200
        }],
        "decisions": ["Isabella scouts the Volastra path for a follow-up."],
        "escalations": [{"kind": "costly_pitch", "summary": "Isabella wants a boat charter for photos."}]
    })
}

#[tokio::test]
async fn moderated_meeting_streams_turns_and_closes_with_outcome() {
    let llm = FakeLlm::new([
        FakeReply::Json(pick("giulia", "Giulia, what's your pitch?")),
        FakeReply::Text("The Sciacchetrà harvest starts Monday; I want to be on the terraces with the Bonanni family.".into()),
        FakeReply::Json(pick("isabella", "Isabella, can you support that?")),
        FakeReply::Text("Yes. I'll walk the Volastra path at dawn and bring back practical notes.".into()),
        FakeReply::Json(done()),
        FakeReply::Json(outcome()),
    ]);
    let s = spec(6);
    let mut events = Vec::new();
    let result = run_meeting(&llm, &s, &mut |e| events.push(e))
        .await
        .unwrap();

    assert_eq!(result.ended_by, EndedBy::Moderator);
    assert_eq!(result.llm_calls, 6);
    assert_eq!(result.transcript.len(), 2);
    assert_eq!(result.transcript[0].speaker, "giulia");
    assert_eq!(result.transcript[1].seq, 2);
    assert_eq!(result.outcome.briefs[0].assignee, "giulia");
    assert_eq!(result.outcome.escalations[0].kind, "costly_pitch");

    // streaming deltas reassemble each utterance
    for u in &result.transcript {
        let streamed: String = events
            .iter()
            .filter_map(|e| match e {
                MeetingEvent::Delta { seq, text, .. } if *seq == u.seq => Some(text.as_str()),
                _ => None,
            })
            .collect();
        assert_eq!(streamed, u.text);
    }
    assert!(matches!(
        events.first(),
        Some(MeetingEvent::TurnStarted { seq: 1, .. })
    ));
    assert_eq!(events.last(), Some(&MeetingEvent::Closed));

    // each speaker is a separate call with their own system prompt, and sees the transcript
    let calls = llm.calls();
    assert!(calls[1].request.system[0].contains("## Your Identity: Giulia"));
    assert!(calls[3].request.system[0].contains("## Your Identity: Isabella"));
    assert!(calls[3].request.messages[0].text.contains("Bonanni family"));
    assert_eq!(
        calls[3].request.profile.staff_id.as_deref(),
        Some("isabella")
    );
    // moderator decisions are schema-constrained to participant ids
    let schema = calls[0].schema.as_ref().unwrap();
    assert_eq!(
        schema["properties"]["next"]["enum"],
        json!(["giulia", "isabella", ""])
    );
    assert!(calls[0].request.system[0].contains("- giulia (Giulia, writer)"));
}

#[tokio::test]
async fn max_turns_ends_the_meeting() {
    let llm = FakeLlm::new([
        FakeReply::Json(pick("isabella", "Quick status?")),
        FakeReply::Text("On track.".into()),
        FakeReply::Json(json!({"briefs": [], "decisions": [], "escalations": []})),
    ]);
    let r = run_meeting(&llm, &spec(1), &mut |_| {}).await.unwrap();
    assert_eq!(r.ended_by, EndedBy::MaxTurns);
    assert_eq!(r.transcript.len(), 1);
    assert_eq!(llm.remaining(), 0);
}

#[tokio::test]
async fn moderator_picking_a_stranger_is_rejected() {
    let llm = FakeLlm::new([FakeReply::Json(pick("lorenzo", "Lorenzo?"))]);
    let err = run_meeting(&llm, &spec(3), &mut |_| {}).await.unwrap_err();
    assert!(
        matches!(
            err,
            MeetingError::Llm {
                stage: "moderator",
                error: LlmError::InvalidOutput { .. }
            }
        ),
        "{err:?}"
    );
}

#[tokio::test]
async fn speaker_refusal_surfaces_as_error() {
    let llm = FakeLlm::new([
        FakeReply::Json(pick("giulia", "Pitch?")),
        FakeReply::Error(LlmError::Refusal {
            category: Some("other".into()),
            explanation: None,
        }),
    ]);
    let err = run_meeting(&llm, &spec(3), &mut |_| {}).await.unwrap_err();
    assert!(matches!(
        err,
        MeetingError::Llm {
            stage: "speaker",
            error: LlmError::Refusal { .. }
        }
    ));
}

#[tokio::test]
async fn meeting_on_claude_backend_streams_via_fake_claude() {
    let fake = Arc::new(FakeClaude::with_script([
        responses::json(&pick("giulia", "Giulia?")),
        responses::text("Harvest week, terraces above Manarola."),
        responses::json(&done()),
        responses::json(&outcome()),
    ]));
    let llm = ClaudeLlm::new(fake.clone(), RolesConfig::builtin());
    let mut deltas = String::new();
    let r = run_meeting(&llm, &spec(4), &mut |e| {
        if let MeetingEvent::Delta { text, .. } = e {
            deltas.push_str(&text);
        }
    })
    .await
    .unwrap();
    assert_eq!(deltas, "Harvest week, terraces above Manarola.");
    assert_eq!(r.outcome.briefs.len(), 1);
    let reqs = fake.requests();
    assert_eq!(reqs.len(), 4);
    // moderator: EiC role, senior → opus, effort high, structured output
    assert_eq!(reqs[0].model, claude::models::OPUS);
    assert_eq!(reqs[0].output_config.effort, claude::Effort::High);
    assert!(reqs[0].output_config.format.is_some());
    // speaker: writer, effort medium, free text, cached system prompt
    assert_eq!(reqs[1].output_config.effort, claude::Effort::Medium);
    assert!(reqs[1].output_config.format.is_none());
    assert!(reqs[1].system.last().unwrap().is_cached());
}

#[tokio::test]
async fn meeting_refusal_from_claude_maps_to_llm_refusal() {
    let fake = Arc::new(FakeClaude::with_script([responses::refusal(
        "violence", "no",
    )]));
    let llm = ClaudeLlm::new(fake, RolesConfig::builtin());
    let err = run_meeting(&llm, &spec(2), &mut |_| {}).await.unwrap_err();
    match err {
        MeetingError::Llm {
            stage: "moderator",
            error: LlmError::Refusal { category, .. },
        } => assert_eq!(category.as_deref(), Some("violence")),
        other => panic!("{other:?}"),
    }
}
