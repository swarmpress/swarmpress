//! Tool loop and structured output driven by FakeClaude.

use async_trait::async_trait;
use claude::fake::responses;
use claude::{
    models, run_tool_loop, structured_output, structured_output_with, ClaudeApi, ClaudeError,
    ContentBlock, CustomTool, Effort, FakeClaude, MessagesRequest, OutputFormat, Role, Scripted,
    StopReason, StreamEvent, Tool, ToolExecutor,
};
use serde_json::{json, Value};

struct Tools;

#[async_trait]
impl ToolExecutor for Tools {
    async fn execute(&self, name: &str, input: &Value) -> Result<String, String> {
        match name {
            "find_media" => Ok(format!(
                "[\"img-{}-01\"]",
                input["village"].as_str().unwrap_or("?")
            )),
            "list_pages" => Err("index offline".into()),
            _ => unreachable!(),
        }
    }
}

fn tool_req() -> MessagesRequest {
    let schema = json!({"type":"object","properties":{},"additionalProperties":true});
    MessagesRequest::new(models::OPUS, 500, Effort::Medium)
        .with_tools(vec![
            Tool::custom(CustomTool::strict("find_media", "media", schema.clone())),
            Tool::custom(CustomTool::strict("list_pages", "pages", schema)),
        ])
        .with_user("pick an image")
}

#[tokio::test]
async fn tool_loop_returns_all_results_in_one_user_message() {
    let fake = FakeClaude::with_script([
        responses::tool_uses(vec![
            ("t1", "find_media", json!({"village":"vernazza"})),
            ("t2", "list_pages", json!({})),
            ("t3", "delete_repo", json!({})),
        ]),
        responses::text("Using img-vernazza-01."),
    ]);
    let out = run_tool_loop(&fake, tool_req(), &Tools, 5).await.unwrap();
    assert_eq!(out.calls, 2);
    assert_eq!(out.response.text(), "Using img-vernazza-01.");
    let second = &fake.requests()[1];
    let last = second.messages.last().unwrap();
    assert_eq!(last.role, Role::User);
    assert_eq!(
        last.content,
        vec![
            ContentBlock::tool_result("t1", "[\"img-vernazza-01\"]", false),
            ContentBlock::tool_result("t2", "index offline", true),
            ContentBlock::tool_result("t3", "unknown tool \"delete_repo\"", true),
        ]
    );
    assert_eq!(second.messages[1].role, Role::Assistant);
    assert_eq!(out.usage.input_tokens, 200);
    // the final transcript ends with the assistant reply
    assert_eq!(out.messages.last().unwrap().role, Role::Assistant);
}

#[tokio::test]
async fn tool_loop_refusal_is_an_error_and_not_retried() {
    let fake = FakeClaude::with_script([responses::refusal("violence", "no")]);
    let err = run_tool_loop(&fake, tool_req(), &Tools, 5)
        .await
        .unwrap_err();
    assert!(err.is_refusal());
    assert_eq!(fake.requests().len(), 1);
}

#[tokio::test]
async fn tool_loop_max_tokens_returns_to_caller() {
    let fake = FakeClaude::with_script([responses::max_tokens("partial")]);
    let out = run_tool_loop(&fake, tool_req(), &Tools, 5).await.unwrap();
    assert_eq!(out.response.stop_reason, Some(StopReason::MaxTokens));
}

#[tokio::test]
async fn tool_loop_exhaustion() {
    let fake = FakeClaude::new();
    for i in 0..3 {
        fake.push(responses::tool_use(
            &format!("t{i}"),
            "find_media",
            json!({"village":"x"}),
        ));
    }
    let err = run_tool_loop(&fake, tool_req(), &Tools, 3)
        .await
        .unwrap_err();
    assert_eq!(err, ClaudeError::ToolLoopExhausted(3));
}

fn brief_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "title": {"type": "string", "minLength": 3},
            "words": {"type": "integer", "minimum": 300}
        },
        "required": ["title", "words"],
        "additionalProperties": false
    })
}

fn sreq() -> MessagesRequest {
    MessagesRequest::new(models::SONNET, 500, Effort::Low).with_user("brief please")
}

#[tokio::test]
async fn structured_output_repairs_until_valid() {
    let fake = FakeClaude::with_script([
        responses::text("not json at all"),
        responses::json(&json!({"title": "Hi", "words": 100})),
        responses::json(&json!({"title": "Last light", "words": 900})),
    ]);
    let out = structured_output(&fake, sreq(), &brief_schema(), 2)
        .await
        .unwrap();
    assert_eq!(out.attempts, 3);
    assert_eq!(out.value["words"], 900);
    let reqs = fake.requests();
    assert_eq!(
        reqs[0].output_config.format,
        Some(OutputFormat::JsonSchema {
            schema: brief_schema()
        })
    );
    // repair turn: assistant output echoed, then a user message listing errors
    let repair = &reqs[2].messages;
    assert_eq!(repair.len(), 5);
    let ContentBlock::Text { text, .. } = &repair[4].content[0] else {
        panic!()
    };
    assert!(text.contains("/title"), "{text}");
    assert!(text.contains("/words"), "{text}");
}

#[tokio::test]
async fn structured_output_gives_up_after_max_repairs() {
    let fake = FakeClaude::with_script([
        responses::json(&json!({"title": 1})),
        responses::json(&json!({"title": 2})),
    ]);
    let err = structured_output(&fake, sreq(), &brief_schema(), 1)
        .await
        .unwrap_err();
    match err {
        ClaudeError::SchemaValidation {
            attempts, errors, ..
        } => {
            assert_eq!(attempts, 2);
            assert!(!errors.is_empty());
        }
        other => panic!("{other:?}"),
    }
}

#[tokio::test]
async fn structured_output_semantic_check_feeds_back() {
    let fake = FakeClaude::with_script([
        responses::json(&json!({"title": "Hidden gem of Manarola", "words": 400})),
        responses::json(&json!({"title": "Manarola at dusk", "words": 400})),
    ]);
    let check = |v: &Value| {
        if v["title"]
            .as_str()
            .unwrap_or("")
            .to_lowercase()
            .contains("hidden gem")
        {
            Err(vec!["banned phrase: hidden gem".to_owned()])
        } else {
            Ok(())
        }
    };
    let out = structured_output_with(&fake, sreq(), &brief_schema(), 2, &check)
        .await
        .unwrap();
    assert_eq!(out.value["title"], "Manarola at dusk");
}

#[tokio::test]
async fn structured_output_refusal_and_truncation() {
    let fake = FakeClaude::with_script([responses::refusal("other", "no")]);
    let err = structured_output(&fake, sreq(), &brief_schema(), 3)
        .await
        .unwrap_err();
    assert!(err.is_refusal());
    assert_eq!(fake.requests().len(), 1, "refusals are never retried");

    let fake = FakeClaude::with_script([responses::max_tokens("{\"title\":")]);
    let err = structured_output(&fake, sreq(), &brief_schema(), 3)
        .await
        .unwrap_err();
    assert!(matches!(err, ClaudeError::MaxTokens { .. }));
}

#[tokio::test]
async fn fake_streams_scripted_responses_and_fails_loudly_when_exhausted() {
    let fake = FakeClaude::with_script([Scripted::Response(responses::text(
        "Ciao a tutti, standup time.",
    ))]);
    let mut deltas = String::new();
    let mut sink = |e: &StreamEvent| {
        if let Some(t) = e.text_delta() {
            deltas.push_str(t);
        }
    };
    let msg = fake.stream(&sreq(), &mut sink).await.unwrap();
    assert_eq!(deltas, "Ciao a tutti, standup time.");
    assert_eq!(msg.text(), deltas);
    let err = fake.create(&sreq()).await.unwrap_err();
    assert!(matches!(err, ClaudeError::ScriptExhausted(_)));
}
