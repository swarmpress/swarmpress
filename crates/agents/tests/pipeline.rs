//! Editorial pipeline driven by FakeLlm scripts and by ClaudeLlm over
//! FakeClaude: approve, needs_changes loop, reject, escalation after 3
//! revisions, validation repair loop, refusal.

use std::sync::Arc;

use agents::pipeline::{EscalationReason, PipelineError, ReviewDecision, Stage};
use agents::state::AppliedTransition;
use agents::{
    run_editorial_pipeline, Brief, ClaudeLlm, ContentEvent as E, ContentState as S, FakeLlm,
    FakeReply, LlmError, PageValidator, PipelineConfig, PipelineOutcome, Role, RolesConfig,
    Seniority, Staffing, StyleGuide,
};
use claude::fake::responses;
use claude::{FakeClaude, OutputFormat};
use serde_json::{json, Value};

fn page_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "id": {"type": "string"},
            "slug": {"type": "object", "properties": {"en": {"type": "string"}}, "required": ["en"]},
            "title": {"type": "object", "properties": {"en": {"type": "string"}}, "required": ["en"]},
            "page_type": {"const": "blog-article"},
            "body": {"type": "array", "minItems": 1, "items": {
                "type": "object",
                "properties": {"type": {"type": "string"}},
                "required": ["type"]
            }}
        },
        "required": ["id", "slug", "title", "page_type", "body"]
    })
}

fn page(text: &str) -> Value {
    json!({
        "id": "c-42",
        "slug": {"en": "/en/blog/last-light-on-sentiero-azzurro"},
        "title": {"en": "Last light on Sentiero Azzurro"},
        "page_type": "blog-article",
        "body": [{"type": "paragraph", "markdown": text}]
    })
}

fn review(decision: &str, score: u8, notes: &str) -> Value {
    json!({"decision": decision, "score": score, "notes": notes, "issues": [format!("issue: {notes}")], "high_risk": []})
}

fn brief() -> Brief {
    Brief {
        content_id: "c-42".into(),
        title: "Last light on Sentiero Azzurro".into(),
        slug: "last-light-on-sentiero-azzurro".into(),
        angle: "Walking Vernazza to Monterosso in the last hour of light".into(),
        keywords: vec!["Sentiero Azzurro".into(), "sunset hike".into()],
        target_words: 900,
        language: "en".into(),
        notes: String::new(),
    }
}

fn staff() -> Staffing {
    Staffing {
        writer_id: "isabella".into(),
        writer_seniority: Some(Seniority::Senior),
        writer_system: "WRITER SYSTEM".into(),
        editor_id: "marco".into(),
        editor_seniority: Some(Seniority::Mid),
        editor_system: "EDITOR SYSTEM".into(),
    }
}

fn style() -> StyleGuide {
    StyleGuide::from_json_str(
        &std::fs::read_to_string(format!(
            "{}/tests/fixtures/style-guide.json",
            env!("CARGO_MANIFEST_DIR")
        ))
        .unwrap(),
    )
    .unwrap()
}

/// House style + closed-world links: markdown may only link to known pages.
fn validator() -> impl PageValidator {
    let style = style();
    move |page: &Value| {
        let mut errors = style.banned_phrase_errors(page);
        if let Some(body) = page["body"].as_array() {
            for (i, b) in body.iter().enumerate() {
                let md = b["markdown"].as_str().unwrap_or("");
                if md.contains("](http") {
                    errors.push(format!(
                        "/body/{i}/markdown: external or unknown link (closed world)"
                    ));
                }
            }
        }
        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors)
        }
    }
}

fn cfg() -> PipelineConfig {
    PipelineConfig::new(page_schema())
}

fn events(ts: &[AppliedTransition]) -> Vec<E> {
    ts.iter().map(|t| t.event).collect()
}

async fn run(llm: &FakeLlm) -> agents::PipelineRun {
    run_editorial_pipeline(
        llm,
        &validator(),
        &brief(),
        &staff(),
        &cfg(),
        S::BriefCreated,
    )
    .await
    .unwrap()
}

#[tokio::test]
async fn approve_on_first_review() {
    let llm = FakeLlm::new([
        FakeReply::Json(page("The path out of Vernazza climbs fast.")),
        FakeReply::Json(review("approve", 8, "Strong.")),
    ]);
    let r = run(&llm).await;
    assert!(matches!(r.outcome, PipelineOutcome::Approved { .. }));
    assert_eq!(r.final_state, S::Approved);
    assert_eq!(
        events(&r.transitions),
        [E::WriterStarted, E::SubmitForReview, E::Approve]
    );
    assert_eq!(r.transitions[2].actor, Role::Editor);
    assert_eq!(r.llm_calls, 2);
    assert_eq!(r.revisions, 0);
    let calls = llm.calls();
    assert_eq!(calls[0].request.system, ["WRITER SYSTEM"]);
    assert_eq!(calls[0].request.profile.job, agents::JobKind::Draft);
    assert_eq!(calls[0].schema.as_ref(), Some(&page_schema()));
    assert!(calls[1].request.messages[0]
        .text
        .contains("The path out of Vernazza"));
    assert!(calls[1].request.messages[0]
        .text
        .contains("The approval bar is 7"));
}

#[tokio::test]
async fn needs_changes_loop_then_approve() {
    let llm = FakeLlm::new([
        FakeReply::Json(page("Draft one.")),
        FakeReply::Json(review(
            "needs_changes",
            5,
            "Add the trail fee and the closing time",
        )),
        FakeReply::Json(page("Draft two, with the trail fee.")),
        FakeReply::Json(review("approve", 9, "Good.")),
    ]);
    let r = run(&llm).await;
    assert!(
        matches!(r.outcome, PipelineOutcome::Approved { ref page, .. } if page["body"][0]["markdown"] == "Draft two, with the trail fee.")
    );
    assert_eq!(
        events(&r.transitions),
        [
            E::WriterStarted,
            E::SubmitForReview,
            E::RequestChanges,
            E::RevisionsApplied,
            E::SubmitForReview,
            E::Approve
        ]
    );
    assert_eq!(r.revisions, 1);
    assert_eq!(r.drafts.len(), 2);
    let revise = &llm.calls()[2].request;
    assert_eq!(revise.profile.job, agents::JobKind::Revise);
    assert!(revise.messages[0].text.contains("Draft one."));
    assert!(revise.messages[0].text.contains("score 5/10"));
    assert!(revise.messages[0]
        .text
        .contains("- issue: Add the trail fee"));
}

#[tokio::test]
async fn approval_under_the_bar_is_a_request_for_changes() {
    let llm = FakeLlm::new([
        FakeReply::Json(page("One.")),
        FakeReply::Json(review("approve", 6, "Fine I guess")),
        FakeReply::Json(page("Two.")),
        FakeReply::Json(review("approve", 7, "Now good")),
    ]);
    let r = run(&llm).await;
    assert!(matches!(r.outcome, PipelineOutcome::Approved { .. }));
    assert_eq!(r.revisions, 1);

    // credibility crisis: bar 8
    let llm = FakeLlm::new([
        FakeReply::Json(page("One.")),
        FakeReply::Json(review("approve", 7, "ok")),
    ]);
    let mut c = cfg();
    c.approve_threshold = 8;
    c.max_revisions = 0;
    let r = run_editorial_pipeline(&llm, &validator(), &brief(), &staff(), &c, S::BriefCreated)
        .await
        .unwrap();
    assert!(matches!(
        r.outcome,
        PipelineOutcome::Escalated {
            reason: EscalationReason::EditorDeadlock {
                revisions: 0,
                last_score: 7
            },
            ..
        }
    ));
}

#[tokio::test]
async fn reject() {
    let llm = FakeLlm::new([
        FakeReply::Json(page("Off-brief.")),
        FakeReply::Json(review("reject", 2, "Off brief")),
    ]);
    let r = run(&llm).await;
    match &r.outcome {
        PipelineOutcome::Rejected { review } => assert_eq!(review.decision, ReviewDecision::Reject),
        other => panic!("{other:?}"),
    }
    assert_eq!(r.final_state, S::Rejected);
    assert_eq!(
        events(&r.transitions),
        [E::WriterStarted, E::SubmitForReview, E::Reject]
    );
}

#[tokio::test]
async fn escalation_after_three_revisions() {
    let mut script = vec![FakeReply::Json(page("v0"))];
    for i in 1..=3 {
        script.push(FakeReply::Json(review("needs_changes", 5, "still flat")));
        script.push(FakeReply::Json(page(&format!("v{i}"))));
    }
    script.push(FakeReply::Json(review("needs_changes", 6, "still flat")));
    let llm = FakeLlm::new(script);
    let r = run(&llm).await;
    match &r.outcome {
        PipelineOutcome::Escalated {
            reason:
                EscalationReason::EditorDeadlock {
                    revisions,
                    last_score,
                },
            page,
        } => {
            assert_eq!(*revisions, 3);
            assert_eq!(*last_score, 6);
            assert_eq!(page.as_ref().unwrap()["body"][0]["markdown"], "v3");
        }
        other => panic!("{other:?}"),
    }
    // the piece waits in review for the CEO's ticket answer
    assert_eq!(r.final_state, S::InEditorialReview);
    assert_eq!(r.reviews.len(), 4);
    assert_eq!(r.drafts.len(), 4);
    assert_eq!(r.transitions.len(), 2 + 3 * 3);
    assert_eq!(r.llm_calls, 8);
    assert_eq!(llm.remaining(), 0);
}

#[tokio::test]
async fn validation_repair_loop() {
    let llm = FakeLlm::new([
        FakeReply::Json(page("A hidden gem! See [map](https://example.com).")),
        FakeReply::Json(page(
            "A lesser-known favorite, with the map on our Vernazza page.",
        )),
        FakeReply::Json(review("approve", 8, "ok")),
    ]);
    let r = run(&llm).await;
    assert!(matches!(r.outcome, PipelineOutcome::Approved { .. }));
    assert_eq!(r.drafts.len(), 1, "only validated drafts are artifacts");
    let repair = &llm.calls()[1].request;
    assert_eq!(repair.messages.len(), 3);
    assert!(repair.messages[1].text.contains("A hidden gem!"));
    assert!(repair.messages[2]
        .text
        .contains("banned phrase \"hidden gem\""));
    assert!(repair.messages[2].text.contains("closed world"));
}

#[tokio::test]
async fn validation_repair_exhausted_escalates() {
    let llm = FakeLlm::new([
        FakeReply::Json(page("stunning")),
        FakeReply::Json(page("still stunning")),
        FakeReply::Json(page("so stunning")),
    ]);
    let r = run(&llm).await;
    match &r.outcome {
        PipelineOutcome::Escalated {
            reason: EscalationReason::ValidationFailed { stage, errors },
            page,
        } => {
            assert_eq!(*stage, Stage::Draft);
            assert!(errors[0].contains("stunning"));
            assert!(page.is_none());
        }
        other => panic!("{other:?}"),
    }
    assert_eq!(r.final_state, S::Draft);
    assert_eq!(r.llm_calls, 3);
}

#[tokio::test]
async fn backend_schema_failure_escalates() {
    // FakeLlm validates against the page schema: missing body
    let llm = FakeLlm::new([FakeReply::Json(json!({"id": "x"}))]);
    let r = run(&llm).await;
    assert!(matches!(
        r.outcome,
        PipelineOutcome::Escalated {
            reason: EscalationReason::ValidationFailed {
                stage: Stage::Draft,
                ..
            },
            ..
        }
    ));
}

#[tokio::test]
async fn high_risk_goes_to_the_ceo() {
    let llm = FakeLlm::new([
        FakeReply::Json(page("The cliff-jumping spot is safe for everyone.")),
        FakeReply::Json(
            json!({"decision": "approve", "score": 9, "notes": "", "issues": [], "high_risk": ["Unverified safety claim"]}),
        ),
    ]);
    let r = run(&llm).await;
    assert!(matches!(
        r.outcome,
        PipelineOutcome::Escalated { reason: EscalationReason::HighRisk { ref flags }, .. } if flags[0] == "Unverified safety claim"
    ));
    assert_eq!(r.final_state, S::InEditorialReview);
}

#[tokio::test]
async fn refusal_blocks_the_stage_without_retry() {
    let llm = FakeLlm::new([
        FakeReply::Json(page("ok")),
        FakeReply::Error(LlmError::Refusal {
            category: Some("other".into()),
            explanation: Some("no".into()),
        }),
    ]);
    let r = run(&llm).await;
    assert!(matches!(
        r.outcome,
        PipelineOutcome::Blocked {
            stage: Stage::Review,
            error: LlmError::Refusal { .. }
        }
    ));
    assert_eq!(r.llm_calls, 2);
    assert_eq!(llm.remaining(), 0);
}

#[tokio::test]
async fn wrong_start_state() {
    let llm = FakeLlm::new([]);
    let err = run_editorial_pipeline(&llm, &validator(), &brief(), &staff(), &cfg(), S::Draft)
        .await
        .unwrap_err();
    assert_eq!(err, PipelineError::WrongStartState(S::Draft));
}

// ---- Claude backend via FakeClaude --------------------------------------

fn claude_llm(fake: &Arc<FakeClaude>) -> ClaudeLlm {
    ClaudeLlm::new(fake.clone(), RolesConfig::builtin())
}

#[tokio::test]
async fn claude_backend_approve_with_schema_repair() {
    let fake = Arc::new(FakeClaude::with_script([
        // first structured reply violates the schema (no body); ClaudeLlm repairs
        responses::json(&json!({"id": "c-42"})),
        responses::json(&page("The path out of Vernazza climbs fast.")),
        responses::json(&review("approve", 8, "Strong.")),
    ]));
    let llm = claude_llm(&fake);
    let r = run_editorial_pipeline(
        &llm,
        &validator(),
        &brief(),
        &staff(),
        &cfg(),
        S::BriefCreated,
    )
    .await
    .unwrap();
    assert!(matches!(r.outcome, PipelineOutcome::Approved { .. }));
    let reqs = fake.requests();
    assert_eq!(reqs.len(), 3);
    // writer: senior → opus, writer effort medium, schema format, cached system
    assert_eq!(reqs[0].model, claude::models::OPUS);
    assert_eq!(reqs[0].output_config.effort, claude::Effort::Medium);
    assert_eq!(
        reqs[0].output_config.format,
        Some(OutputFormat::JsonSchema {
            schema: page_schema()
        })
    );
    assert!(reqs[0].system[0].is_cached());
    assert!(reqs[0].tool_choice.is_none());
    // repair turn inside ClaudeLlm
    assert_eq!(reqs[1].messages.len(), 3);
    // editor: mid seniority → sonnet
    assert_eq!(reqs[2].model, claude::models::SONNET);
    assert_eq!(reqs[2].messages.len(), 1);
}

#[tokio::test]
async fn claude_backend_refusal_blocks_draft() {
    let fake = Arc::new(FakeClaude::with_script([responses::refusal(
        "cyber",
        "Not appropriate",
    )]));
    let llm = claude_llm(&fake);
    let r = run_editorial_pipeline(
        &llm,
        &validator(),
        &brief(),
        &staff(),
        &cfg(),
        S::BriefCreated,
    )
    .await
    .unwrap();
    match r.outcome {
        PipelineOutcome::Blocked {
            stage: Stage::Draft,
            error:
                LlmError::Refusal {
                    category,
                    explanation,
                },
        } => {
            assert_eq!(category.as_deref(), Some("cyber"));
            assert_eq!(explanation.as_deref(), Some("Not appropriate"));
        }
        other => panic!("{other:?}"),
    }
    assert_eq!(fake.requests().len(), 1, "refusals are never retried");
    assert_eq!(r.final_state, S::Draft);
}

#[tokio::test]
async fn claude_backend_full_revision_loop_and_reject() {
    let fake = Arc::new(FakeClaude::with_script([
        responses::json(&page("v0")),
        responses::json(&review("needs_changes", 4, "thin")),
        responses::json(&page("v1")),
        responses::json(&review("reject", 2, "unsalvageable")),
    ]));
    let llm = claude_llm(&fake);
    let r = run_editorial_pipeline(
        &llm,
        &validator(),
        &brief(),
        &staff(),
        &cfg(),
        S::BriefCreated,
    )
    .await
    .unwrap();
    assert!(matches!(r.outcome, PipelineOutcome::Rejected { .. }));
    assert_eq!(r.final_state, S::Rejected);
    assert_eq!(fake.remaining(), 0);
}
