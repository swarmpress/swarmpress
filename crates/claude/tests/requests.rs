//! Request JSON snapshots: cache_control placement, tool_choice auto only,
//! effort always set, fallback header + body field.

use claude::{
    models, CustomTool, Effort, HttpClaude, HttpConfig, Message, MessagesRequest, SystemBlock, Tool,
};
use serde_json::json;

fn client(fallback: bool) -> HttpClaude {
    let mut cfg = HttpConfig::new("sk-test");
    cfg.server_side_fallback = fallback;
    HttpClaude::new(cfg).unwrap()
}

fn writer_request() -> MessagesRequest {
    MessagesRequest::new(models::OPUS, 8000, Effort::Medium)
        .with_system_layers(
            &[
                "# Company baseline\nAll writers fact-check.",
                "# Site: Cinque Terre Dispatch\nWarm, specific, honest.",
                "# Persona: Isabella\nAdventure travel writer.",
            ],
            Some("Today is day 12, 09:40."),
        )
        .with_tools(vec![
            Tool::custom(CustomTool::strict(
                "find_media",
                "Search the closed media index",
                json!({"type":"object","properties":{"village":{"type":"string"}},"required":["village"],"additionalProperties":false}),
            )),
            Tool::web_search(3),
        ])
        .with_user("Write the brief 'Last light on Sentiero Azzurro'.")
}

#[test]
fn writer_request_snapshot() {
    let prepared = client(true)
        .prepare(&writer_request(), false)
        .unwrap()
        .redacted();
    insta::assert_json_snapshot!("writer_request", prepared);
}

#[test]
fn streaming_structured_request_snapshot() {
    let req = MessagesRequest::new(models::HAIKU, 1024, Effort::Low)
        .with_system_layers(&["You moderate the standup."], None)
        .with_json_schema(
            json!({"type":"object","properties":{"next":{"type":"string"}},"required":["next"]}),
        )
        .with_user("Who speaks next?");
    let prepared = client(false).prepare(&req, true).unwrap().redacted();
    insta::assert_json_snapshot!("structured_stream_request", prepared);
}

#[test]
fn cache_control_on_last_stable_block_only() {
    let req = writer_request();
    let cached: Vec<bool> = req.system.iter().map(SystemBlock::is_cached).collect();
    assert_eq!(cached, [false, false, true, false]);
}

#[test]
fn no_forced_tool_choice_and_no_thinking_field() {
    let body = client(true).prepare(&writer_request(), false).unwrap().body;
    assert_eq!(body["tool_choice"], json!({"type": "auto"}));
    assert!(body.get("thinking").is_none());
    assert!(body.get("temperature").is_none());
    assert_eq!(body["output_config"]["effort"], "medium");
    assert_eq!(body["fallbacks"], "default");
    // forced choices are not representable: deserializing one fails
    assert!(serde_json::from_value::<claude::ToolChoice>(json!({"type":"any"})).is_err());
    assert!(
        serde_json::from_value::<claude::ToolChoice>(json!({"type":"tool","name":"x"})).is_err()
    );
}

#[test]
fn effort_is_always_serialized() {
    for effort in [
        Effort::Low,
        Effort::Medium,
        Effort::High,
        Effort::Xhigh,
        Effort::Max,
    ] {
        let req = MessagesRequest::new(models::OPUS, 10, effort).with_user("hi");
        let v = serde_json::to_value(&req).unwrap();
        assert_eq!(v["output_config"]["effort"], effort.as_str());
    }
}

#[test]
fn fallback_disabled_sends_neither_header_nor_field() {
    let p = client(false).prepare(&writer_request(), false).unwrap();
    assert!(p.headers.iter().all(|(k, _)| k != "anthropic-beta"));
    assert!(p.body.get("fallbacks").is_none());
}

#[test]
fn assistant_prefill_is_rejected_locally() {
    let req = MessagesRequest::new(models::OPUS, 10, Effort::Low)
        .with_user("hi")
        .with_message(Message::assistant_text("{"));
    let err = client(true).prepare(&req, false).unwrap_err();
    assert!(matches!(err, claude::ClaudeError::InvalidRequest(_)));
}
