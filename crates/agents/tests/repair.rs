//! `structured_with_repair` (ADR-0058 decision 4, FEAT-032): schema problems
//! from the backend and semantic problems alike get a repair turn that quotes
//! only the stripped answer, capped, never the reasoning; no progress stops
//! the loop; refusals and truncation are not repaired.

use agents::llm::{
    repair_quote, repair_request, strip_reasoning, structured_with_repair, CallProfile, FakeLlm,
    FakeReply, LlmMessage, LlmRequest, LlmRole, REPAIR_MAX_ERRORS, REPAIR_QUOTE_CHARS,
};
use agents::{JobKind, LlmError, Role};
use serde_json::{json, Value};

fn request() -> LlmRequest {
    LlmRequest {
        profile: CallProfile::new(JobKind::Draft, Role::Writer),
        system: vec!["You write sections.".into()],
        messages: vec![LlmMessage::user("## Task: section s1 of 3\nWrite it.")],
        max_tokens: 600,
        reasoning_tokens: Some(2048),
    }
}

fn schema() -> Value {
    json!({"type": "object", "required": ["text"], "additionalProperties": false,
           "properties": {"text": {"type": "string"}}})
}

fn no_bad_word(v: &Value) -> Result<(), Vec<String>> {
    if v["text"].as_str().unwrap_or_default().contains("stunning") {
        Err(vec!["uses the banned phrase \"stunning\"".into()])
    } else {
        Ok(())
    }
}

fn invalid(answer: &str) -> FakeReply {
    FakeReply::Error(LlmError::InvalidOutput {
        errors: vec!["/text: is required".into()],
        answer: Some(answer.into()),
    })
}

#[tokio::test]
async fn a_semantic_problem_gets_one_repair_turn_with_the_answer_and_no_reasoning() {
    let llm = FakeLlm::new([
        FakeReply::Json(json!({"text": "A stunning view."})),
        FakeReply::Json(json!({"text": "A wide view over the terraces."})),
    ]);
    let out = structured_with_repair(&llm, &request(), &schema(), &no_bad_word, 2)
        .await
        .unwrap();
    assert_eq!(out.value["text"], "A wide view over the terraces.");
    assert_eq!((out.calls, out.repairs), (2, 1));

    let calls = llm.calls();
    let repair = &calls[1].request;
    // The original turn, the answer as JSON, the problems; reasoning off.
    assert_eq!(repair.messages.len(), 3);
    assert_eq!(repair.messages[0], request().messages[0]);
    assert_eq!(repair.messages[1].role, LlmRole::Assistant);
    assert_eq!(repair.messages[1].text, r#"{"text":"A stunning view."}"#);
    assert!(repair.messages[2]
        .text
        .contains("banned phrase \"stunning\""));
    assert_eq!(repair.reasoning_tokens, Some(0));
    assert_eq!(repair.max_tokens, 600);
}

#[tokio::test]
async fn invalid_output_from_the_bridge_is_repaired_without_its_reasoning() {
    let reasoning = "<think>Let me think at length about the terraces. ".repeat(200) + "</think>";
    let answer = format!("{reasoning}{{\"txt\": \"The terraces.\"}}");
    let llm = FakeLlm::new([
        invalid(&answer),
        FakeReply::Json(json!({"text": "The terraces."})),
    ]);
    let out = structured_with_repair(&llm, &request(), &schema(), &no_bad_word, 2)
        .await
        .unwrap();
    assert_eq!((out.calls, out.repairs), (2, 1));
    let repair = &llm.calls()[1].request;
    assert_eq!(repair.messages[1].text, r#"{"txt": "The terraces."}"#);
    for m in &repair.messages {
        assert!(!m.text.contains("<think>") && !m.text.contains("think at length"));
    }
    assert!(repair.messages[2].text.contains("/text: is required"));

    // An unterminated reasoning block leaves nothing to quote: the problems
    // go into the user turn instead, still without the reasoning.
    let llm = FakeLlm::new([
        invalid("<think>still thinking when the budget ran out"),
        FakeReply::Json(json!({"text": "ok"})),
    ]);
    structured_with_repair(&llm, &request(), &schema(), &no_bad_word, 2)
        .await
        .unwrap();
    let repair = &llm.calls()[1].request;
    assert_eq!(repair.messages.len(), 1);
    assert!(repair.messages[0]
        .text
        .starts_with("## Task: section s1 of 3"));
    assert!(repair.messages[0].text.contains("/text: is required"));
    assert!(!repair.messages[0].text.contains("still thinking"));
}

#[tokio::test]
async fn repair_turns_are_size_bounded() {
    let huge = format!("{{\"txt\": \"{}\"}}", "x".repeat(50_000));
    let many: Vec<String> = (0..40)
        .map(|i| format!("problem {i}: {}", "y".repeat(900)))
        .collect();
    let llm = FakeLlm::new([
        FakeReply::Error(LlmError::InvalidOutput {
            errors: many,
            answer: Some(huge),
        }),
        FakeReply::Json(json!({"text": "ok"})),
    ]);
    structured_with_repair(&llm, &request(), &schema(), &no_bad_word, 2)
        .await
        .unwrap();
    let repair = &llm.calls()[1].request;
    let quote = &repair.messages[1].text;
    assert!(
        quote.chars().count() <= REPAIR_QUOTE_CHARS + 80,
        "{}",
        quote.len()
    );
    assert!(quote.contains("cut: the previous answer was"));
    let turn = &repair.messages[2].text;
    assert_eq!(
        turn.lines().filter(|l| l.starts_with("- problem")).count(),
        REPAIR_MAX_ERRORS
    );
    assert!(turn.contains("and 28 more"));
    assert!(turn.chars().count() < 6_000);

    // Each repair starts again from the original request: the second repair
    // carries one answer, not two.
    let llm = FakeLlm::new([
        FakeReply::Json(json!({"text": "stunning one"})),
        FakeReply::Json(json!({"text": "stunning two"})),
        FakeReply::Json(json!({"text": "fine"})),
    ]);
    let out = structured_with_repair(&llm, &request(), &schema(), &no_bad_word, 2)
        .await
        .unwrap();
    assert_eq!((out.calls, out.repairs), (3, 2));
    let second = &llm.calls()[2].request;
    assert_eq!(second.messages.len(), 3);
    assert!(second.messages[1].text.contains("stunning two"));
    assert!(!second.messages[1].text.contains("stunning one"));
}

#[tokio::test]
async fn an_unchanged_answer_after_a_repair_stops_the_loop() {
    let same = || FakeReply::Json(json!({"text": "A stunning view."}));
    let llm = FakeLlm::new([same(), same(), same(), same()]);
    let err = structured_with_repair(&llm, &request(), &schema(), &no_bad_word, 3)
        .await
        .unwrap_err();
    assert!(err.no_progress);
    assert_eq!((err.calls, err.repairs), (2, 1));
    assert_eq!(err.errors(), ["uses the banned phrase \"stunning\""]);
    assert_eq!(llm.remaining(), 2, "no third call");
}

#[tokio::test]
async fn repairs_run_out_and_other_errors_are_not_repaired() {
    let llm = FakeLlm::new([
        FakeReply::Json(json!({"text": "stunning 1"})),
        FakeReply::Json(json!({"text": "stunning 2"})),
        FakeReply::Json(json!({"text": "stunning 3"})),
    ]);
    let err = structured_with_repair(&llm, &request(), &schema(), &no_bad_word, 2)
        .await
        .unwrap_err();
    assert!(!err.no_progress);
    assert_eq!((err.calls, err.repairs), (3, 2));
    assert!(matches!(
        err.error,
        LlmError::InvalidOutput { answer: Some(ref a), .. } if a.contains("stunning 3")
    ));

    // max 0: one call, no repair.
    let llm = FakeLlm::new([FakeReply::Json(json!({"text": "stunning"}))]);
    let err = structured_with_repair(&llm, &request(), &schema(), &no_bad_word, 0)
        .await
        .unwrap_err();
    assert_eq!(err.calls, 1);

    for e in [
        LlmError::Refusal {
            category: None,
            explanation: None,
        },
        LlmError::Truncated {
            partial: "{\"text\": \"cut".into(),
        },
        LlmError::Backend("gone".into()),
    ] {
        let llm = FakeLlm::new([
            FakeReply::Error(e.clone()),
            FakeReply::Json(json!({"text": "x"})),
        ]);
        let err = structured_with_repair(&llm, &request(), &schema(), &no_bad_word, 2)
            .await
            .unwrap_err();
        assert_eq!((err.error, err.calls), (e, 1));
    }
}

#[test]
fn reasoning_is_stripped_and_quotes_are_capped() {
    assert_eq!(strip_reasoning("<think>a</think> {\"x\":1}"), "{\"x\":1}");
    assert_eq!(
        strip_reasoning("<THINK>a</THINK>{}<think>b</think>[]"),
        "{}[]"
    );
    assert_eq!(strip_reasoning("{} <think>never closed"), "{}");
    assert_eq!(strip_reasoning("plain"), "plain");
    assert_eq!(repair_quote("<think>x</think>short"), "short");
    let long = repair_quote(&"z".repeat(REPAIR_QUOTE_CHARS * 2));
    assert!(long.starts_with(&"z".repeat(REPAIR_QUOTE_CHARS)));
    assert!(long.chars().count() < REPAIR_QUOTE_CHARS + 80);

    // A request built for a repair never grows past one answer and one turn.
    let r = repair_request(&request(), Some("{}"), &["e".into()]);
    assert_eq!(r.messages.len(), 3);
    assert_eq!(r.reasoning_tokens, Some(0));
}
