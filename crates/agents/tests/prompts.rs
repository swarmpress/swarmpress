use agents::house_style::format_house_style;
use agents::prompts::{merge_value, render, templates, PromptError, Vars};
use agents::{
    resolve, CompanyPrompt, PageValidator, Persona, PromptLayer, SiteContext, StyleGuide,
};
use serde_json::{json, Value};

fn fixture(name: &str) -> String {
    std::fs::read_to_string(format!(
        "{}/tests/fixtures/{name}",
        env!("CARGO_MANIFEST_DIR")
    ))
    .unwrap()
}

fn vars(v: Value) -> Vars {
    match v {
        Value::Object(m) => m,
        _ => panic!(),
    }
}

fn company() -> CompanyPrompt {
    CompanyPrompt {
        id: "writer".into(),
        version: "1.0.0".into(),
        template: "Tone: {{tone}}. Brand: {{brand}}. Brief: {{brief}}. Keywords: {{keywords}}."
            .into(),
        examples: vec![json!({"id": "c1"})],
        default_variables: vars(json!({
            "tone": "neutral", "brand": "Company", "brief": "none",
            "keywords": ["travel"], "style": {"a": 1, "nested": {"x": 1, "y": 1}}
        })),
    }
}

#[test]
fn variable_priority_runtime_agent_site_company() {
    let site = PromptLayer {
        source: "site:ct@1".into(),
        variables: vars(json!({"tone": "casual", "brand": "Dispatch", "keywords": ["liguria"]})),
        examples: vec![json!({"id": "s1"})],
        ..Default::default()
    };
    let agent = PromptLayer {
        source: "agent:isabella".into(),
        variables: vars(json!({"tone": "enthusiastic", "keywords": ["hiking"]})),
        ..Default::default()
    };
    let runtime = vars(json!({"brief": "Sentiero Azzurro", "tone": "urgent"}));
    let r = resolve(&company(), Some(&site), Some(&agent), &runtime).unwrap();
    assert_eq!(
        r.text,
        "Tone: urgent. Brand: Dispatch. Brief: Sentiero Azzurro. Keywords: travel, liguria, hiking."
    );
    assert_eq!(
        r.resolution_path,
        [
            "company:writer@1.0.0",
            "site:ct@1",
            "agent:isabella",
            "runtime"
        ]
    );
    // examples: company first, then site
    assert_eq!(r.examples, vec![json!({"id": "c1"}), json!({"id": "s1"})]);

    // without runtime, agent wins over site
    let r = resolve(&company(), Some(&site), Some(&agent), &Vars::new()).unwrap();
    assert!(r
        .text
        .starts_with("Tone: enthusiastic. Brand: Dispatch. Brief: none."));
}

#[test]
fn merge_rules_arrays_concat_objects_deep_merge_null_inherits() {
    let lower =
        json!({"a": 1, "arr": [1], "obj": {"x": 1, "deep": {"p": 1, "q": 1}}, "keep": "yes"});
    let higher = json!({"a": 2, "arr": [2, 3], "obj": {"y": 2, "deep": {"q": 2}}, "keep": null, "new": true});
    assert_eq!(
        merge_value(&lower, &higher),
        json!({"a": 2, "arr": [1, 2, 3], "obj": {"x": 1, "y": 2, "deep": {"p": 1, "q": 2}}, "keep": "yes", "new": true})
    );
    // scalar replaced by a different type
    assert_eq!(merge_value(&json!([1]), &json!("s")), json!("s"));
}

#[test]
fn site_additions_append_and_override_replaces() {
    let mut c = company();
    c.template = "BASE {{tone}}".into();
    let add = PromptLayer {
        source: "site:a".into(),
        template_additions: Some("SITE EXTRA".into()),
        ..Default::default()
    };
    let r = resolve(&c, Some(&add), None, &Vars::new()).unwrap();
    assert_eq!(r.text, "BASE neutral\n\nSITE EXTRA\n");
    let ov = PromptLayer {
        source: "site:b".into(),
        template_override: Some("OVERRIDE {{brand}}".into()),
        template_additions: Some("ignored".into()),
        ..Default::default()
    };
    assert_eq!(
        resolve(&c, Some(&ov), None, &Vars::new()).unwrap().text,
        "OVERRIDE Company"
    );
}

#[test]
fn agent_layer_cannot_change_template() {
    let agent = PromptLayer {
        source: "agent:x".into(),
        template_additions: Some("sneaky".into()),
        ..Default::default()
    };
    assert_eq!(
        resolve(&company(), None, Some(&agent), &Vars::new()).unwrap_err(),
        PromptError::AgentTemplateChange("agent:x".into())
    );
}

#[test]
fn render_is_strict() {
    let err = render(
        "t",
        "Hi {{a}} and {{b}} and {{ a }} {{c}}",
        &vars(json!({"a": "x"})),
    )
    .unwrap_err();
    assert_eq!(
        err,
        PromptError::MissingVariables {
            template: "t".into(),
            missing: vec!["b".into(), "c".into()]
        }
    );
    assert!(matches!(
        render("t", "oops {{a", &Vars::new()),
        Err(PromptError::Unterminated { .. })
    ));
    assert_eq!(
        render(
            "t",
            "{{n}} {{b}} {{o}}",
            &vars(json!({"n": 7, "b": true, "o": {"k": 1}}))
        )
        .unwrap(),
        "7 true {\"k\":1}"
    );
}

#[test]
fn builtin_templates_parse() {
    for (t, id) in [
        (templates::writer(), "writer"),
        (templates::editor(), "editor"),
        (templates::editor_in_chief(), "editor_in_chief"),
        (templates::meeting_speaker(), "meeting_speaker"),
        (templates::qa_coherence(), "qa_coherence"),
    ] {
        assert_eq!(t.id, id);
        assert!(!t.template.starts_with("+++"));
    }
    assert_eq!(
        templates::editor().default_variables["approve_threshold"],
        json!(7)
    );
}

#[test]
fn house_style_from_cinqueterre_fixture() {
    let g = StyleGuide::from_json_str(&fixture("style-guide.json")).unwrap();
    assert!(g.banned_phrases().iter().any(|p| p == "hidden gem"));
    assert_eq!(g.vocabulary.replacements["tourist"], "visitor");
    insta::assert_snapshot!("house_style_cinqueterre", format_house_style(&g));

    assert_eq!(
        g.banned_phrase_hits("A Hidden Gem with a STUNNING view, not a gemstone"),
        vec!["hidden gem".to_string(), "stunning".to_string()]
    );
    assert!(
        g.banned_phrase_hits("amazingly ordinary").is_empty(),
        "whole words only"
    );
    let page = json!({"title": {"en": "Riomaggiore"}, "body": [{"type": "paragraph", "markdown": "A must-see village."}]});
    assert_eq!(
        g.validate(&page).unwrap_err(),
        vec!["/body/0/markdown: banned phrase \"must-see\" (house style)".to_string()]
    );
}

#[test]
fn partial_style_guide_loads() {
    let g = StyleGuide::from_json_str(r#"{"voice": "dry"}"#).unwrap();
    assert_eq!(format_house_style(&g), "## House Style\n**Voice:** dry\n");
    assert!(StyleGuide::from_json_str("[1]").is_err());
}

fn cinqueterre_site() -> SiteContext {
    let g = StyleGuide::from_json_str(&fixture("style-guide.json")).unwrap();
    let wp: Value = serde_json::from_str(&fixture("writer-prompt.json")).unwrap();
    SiteContext::new("cinqueterre", g, Some(&wp)).unwrap()
}

#[test]
fn site_layer_from_writer_prompt_json() {
    let site = cinqueterre_site();
    assert_eq!(site.layer.source, "site:cinqueterre@1.0.0");
    assert_eq!(site.layer.variables["brand_name"], "Cinque Terre Dispatch");
    assert!(site
        .layer
        .template_additions
        .as_deref()
        .unwrap()
        .contains("Cinque Terre Dispatch Editorial Voice"));
    assert_eq!(site.layer.examples.len(), 1);
    assert!(site.variables_only().template_additions.is_none());
}

#[test]
fn resolved_writer_prompt_snapshot() {
    let site = cinqueterre_site();
    let persona = Persona::builtin("Isabella").unwrap();
    let agent = PromptLayer::from_persona(&persona, "en");
    let runtime =
        vars(json!({"block_docs": "- paragraph: { markdown }\n- heading: { text, level }"}));
    let r = resolve(
        &templates::writer(),
        Some(&site.layer),
        Some(&agent),
        &runtime,
    )
    .unwrap();
    assert_eq!(
        r.resolution_path,
        [
            "company:writer@1.0.0",
            "site:cinqueterre@1.0.0",
            "agent:isabella",
            "runtime"
        ]
    );
    insta::assert_snapshot!("resolved_writer_isabella_cinqueterre", r.text);
}

#[test]
fn writer_prompt_without_block_docs_fails_loudly() {
    let site = cinqueterre_site();
    let err = resolve(&templates::writer(), Some(&site.layer), None, &Vars::new()).unwrap_err();
    assert_eq!(
        err,
        PromptError::MissingVariables {
            template: "writer".into(),
            missing: vec!["block_docs".into()]
        }
    );
}

#[test]
fn resolved_editor_prompt_snapshot() {
    let site = cinqueterre_site();
    let persona = Persona::builtin("Marco").unwrap();
    let agent = PromptLayer::from_persona(&persona, "en");
    let r = resolve(
        &templates::editor(),
        Some(&site.variables_only()),
        Some(&agent),
        &Vars::new(),
    )
    .unwrap();
    assert!(r.text.contains("The approval bar is currently **7**"));
    insta::assert_snapshot!("resolved_editor_marco_cinqueterre", r.text);
    // credibility crisis: runtime raises the bar
    let r = resolve(
        &templates::editor(),
        Some(&site.variables_only()),
        Some(&agent),
        &vars(json!({"approve_threshold": 8})),
    )
    .unwrap();
    assert!(r.text.contains("The approval bar is currently **8**"));
}
