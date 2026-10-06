//! The architects' edit operations (FEAT-095): parsed from a flat answer,
//! applied by stable ids, unknown targets as issues with paths into the edit
//! list, and the answer schemas closed over the block catalogue.

use std::collections::BTreeMap;

use blueprint::edit::{block_ids, MAX_EDITS, OPS};
use blueprint::site::SiteContext;
use blueprint::{
    apply_edits, check, diff, parse_edits, proposal_schema, tool_proposal_schema, Blueprint,
    ChangeKind, CheckContext, Edit, IssueCode, Subject,
};
use serde_json::{json, Value};

fn mini() -> (Blueprint, BTreeMap<String, Value>) {
    let v: Value =
        serde_json::from_str(include_str!("fixtures/cinqueterre-mini.blueprint.json")).unwrap();
    (
        Blueprint::from_value(&v["blueprint"]).unwrap(),
        serde_json::from_value(v["types"].clone()).unwrap(),
    )
}

fn ctx(types: &BTreeMap<String, Value>, custom: &[&str]) -> CheckContext {
    SiteContext {
        custom_blocks: custom.iter().map(|s| (*s).to_string()).collect(),
        sections: [
            "blog",
            "hikes",
            "itinerary",
            "restaurants",
            "transportation",
        ]
        .map(String::from)
        .to_vec(),
        collections: ["hikes", "restaurants"].map(String::from).to_vec(),
    }
    .check_context(types, BTreeMap::new())
    .unwrap()
}

/// What the fake architect answers: an author page type linked from articles.
fn author_answer() -> Value {
    json!({
        "summary": "Adds author pages and links every article to its author.",
        "edits": [
            { "op": "add-page-type", "id": "author", "label": "Author", "route": "/{lang}/authors/{slug}",
              "slots": [{ "id": "profile", "blocks": ["team-grid"], "min": 1, "max": 1 }],
              "page_type": null, "slot": null },
            { "op": "add-relationship", "from": "blog-article", "to": "author", "kind": "written-by",
              "cardinality": "many-to-one", "via": "metadata.author", "id": null }
        ]
    })
}

#[test]
fn an_author_page_type_is_a_valid_diff() {
    let (base, types) = mini();
    let edits = parse_edits(&author_answer()).unwrap();
    assert_eq!(edits.len(), 2);
    assert_eq!(edits[0].op(), "add-page-type");
    let next = apply_edits(&base, &edits).unwrap();
    assert_eq!(check(&next, &ctx(&types, &[])), vec![], "the result checks");
    let changes = diff(&base, &next);
    assert_eq!(changes.len(), 2, "{changes:?}");
    assert!(changes.iter().any(|c| c.kind == ChangeKind::Added
        && c.subject == Subject::PageType
        && c.id == "author"));
    assert!(changes.iter().any(|c| c.kind == ChangeKind::Added
        && c.subject == Subject::Relationship
        && c.id == "blog-article>author:written-by"));
    // The base is untouched.
    assert!(base.page_type("author").is_none());
}

#[test]
fn unknown_block_ids_come_back_as_checker_issues() {
    let (base, types) = mini();
    let mut answer = author_answer();
    answer["edits"][0]["slots"][0]["blocks"] = json!(["team-grids"]);
    let next = apply_edits(&base, &parse_edits(&answer).unwrap()).unwrap();
    let issues = check(&next, &ctx(&types, &[]));
    assert_eq!(issues.len(), 1, "{issues:?}");
    assert_eq!(issues[0].code, IssueCode::UnknownBlock);
    assert!(issues[0].message.contains("team-grids"));
    // A site's custom block is known.
    answer["edits"][0]["slots"][0]["blocks"] = json!(["x:author-card"]);
    let next = apply_edits(&base, &parse_edits(&answer).unwrap()).unwrap();
    assert_eq!(check(&next, &ctx(&types, &["x:author-card"])), vec![]);
}

#[test]
fn unknown_targets_are_issues_at_their_edit() {
    let (base, _) = mini();
    let edits = parse_edits(&json!({ "edits": [
        { "op": "add-slot", "page_type": "nowhere", "slot": "x", "blocks": ["paragraph"] },
        { "op": "remove-slot", "page_type": "blog-article", "slot": "missing" },
        { "op": "add-page-type", "id": "blog-article", "label": "Again" },
        { "op": "remove-relationship", "from": "a", "to": "b", "kind": "c" },
        { "op": "add-slot", "page_type": "blog-index", "slot": "more", "blocks": ["paragraph"], "after": "nope" }
    ]}))
    .unwrap();
    let issues = apply_edits(&base, &edits).unwrap_err();
    let paths: Vec<(&str, IssueCode)> = issues.iter().map(|i| (i.path.as_str(), i.code)).collect();
    assert_eq!(
        paths,
        vec![
            ("/edits/0/page_type", IssueCode::UnknownRef),
            ("/edits/1/slot", IssueCode::UnknownRef),
            ("/edits/2/id", IssueCode::BadId),
            ("/edits/3", IssueCode::UnknownRef),
            ("/edits/4/after", IssueCode::UnknownRef),
        ]
    );
}

#[test]
fn slots_are_added_in_place_replaced_and_removed() {
    let (base, _) = mini();
    let first = base.page_types[0].clone();
    let slots: Vec<String> = first
        .slots
        .as_ref()
        .unwrap()
        .iter()
        .map(|s| s.id.clone())
        .collect();
    assert!(slots.len() >= 2, "{slots:?}");
    let t = first.id.clone();
    let edits = vec![
        Edit::AddSlot {
            page_type: t.clone(),
            slot: "byline".into(),
            blocks: vec!["editor-note".into()],
            min: 0,
            max: Some(1),
            after: Some(slots[0].clone()),
        },
        Edit::SetSlot {
            page_type: t.clone(),
            slot: slots[1].clone(),
            blocks: vec!["paragraph".into()],
            min: 0,
            max: None,
        },
    ];
    let next = apply_edits(&base, &edits).unwrap();
    let ids: Vec<&str> = next.page_types[0]
        .slots
        .as_ref()
        .unwrap()
        .iter()
        .map(|s| s.id.as_str())
        .collect();
    assert_eq!(ids[0], slots[0]);
    assert_eq!(ids[1], "byline");
    assert_eq!(
        next.page_types[0].slots.as_ref().unwrap()[2].blocks,
        vec!["paragraph".to_string()]
    );
    let removed = apply_edits(
        &next,
        &[Edit::RemoveSlot {
            page_type: t,
            slot: "byline".into(),
        }],
    )
    .unwrap();
    assert_eq!(
        removed.page_types[0].slots.as_ref().unwrap().len(),
        slots.len()
    );
}

#[test]
fn removing_a_page_type_takes_its_relationships_and_navigation() {
    let (base, types) = mini();
    let with = apply_edits(&base, &parse_edits(&author_answer()).unwrap()).unwrap();
    let mut nav = with.navigation.clone();
    nav.push(blueprint::format::NavItem {
        page_type: Some("author".into()),
        section: None,
    });
    let with = apply_edits(&with, &[Edit::SetNavigation { items: nav }]).unwrap();
    let without = apply_edits(
        &with,
        &[Edit::RemovePageType {
            id: "author".into(),
        }],
    )
    .unwrap();
    assert_eq!(without, base);
    assert_eq!(check(&without, &ctx(&types, &[])), vec![]);
}

#[test]
fn intent_keywords_are_set_sorted_and_once() {
    let (base, _) = mini();
    let edits = parse_edits(&json!([
        { "op": "set-intent", "keywords": ["minimal", "editorial", "minimal"] }
    ]))
    .unwrap();
    let next = apply_edits(&base, &edits).unwrap();
    let k = serde_json::to_value(&next.intent.keywords).unwrap();
    assert_eq!(k, json!(["editorial", "minimal"]));
    assert_eq!(diff(&base, &next)[0].subject, Subject::Intent);
}

#[test]
fn malformed_edits_are_issues_too() {
    let issues = parse_edits(&json!({ "edits": [
        { "op": "paint-it-red" },
        { "op": "remove-slot", "page_type": "home" }
    ]}))
    .unwrap_err();
    assert_eq!(issues.len(), 2);
    assert_eq!(issues[0].path, "/edits/0");
    assert_eq!(issues[1].path, "/edits/1");
    assert!(issues.iter().all(|i| i.code == IssueCode::BadFormat));
    assert!(parse_edits(&json!({"summary": "no edits"})).is_err());
    let many: Vec<Value> = (0..=MAX_EDITS)
        .map(|_| json!({"op": "set-intent", "keywords": []}))
        .collect();
    assert_eq!(
        parse_edits(&Value::Array(many)).unwrap_err()[0].code,
        IssueCode::OverBudget
    );
}

#[test]
fn edits_round_trip_in_their_wire_shape() {
    for e in parse_edits(&author_answer()).unwrap() {
        let v = serde_json::to_value(&e).unwrap();
        assert_eq!(v["op"], e.op());
        assert!(OPS.contains(&e.op()));
        assert_eq!(serde_json::from_value::<Edit>(v).unwrap(), e);
    }
}

/// The keywords `apps/game/src/llm/structured.ts` validates; anything else
/// (`anyOf`, `oneOf`, `$ref`, patterns) the browser's validator ignores.
fn assert_subset(v: &Value, path: &str) {
    const KNOWN: [&str; 13] = [
        "type",
        "enum",
        "const",
        "minLength",
        "maxLength",
        "minimum",
        "maximum",
        "minItems",
        "maxItems",
        "items",
        "properties",
        "required",
        "additionalProperties",
    ];
    let Some(o) = v.as_object() else { return };
    for (k, x) in o {
        assert!(KNOWN.contains(&k.as_str()), "{path}: {k}");
        match k.as_str() {
            "properties" => {
                for (name, sub) in x.as_object().unwrap() {
                    assert_subset(sub, &format!("{path}.{name}"));
                }
            }
            "items" => assert_subset(x, &format!("{path}[]")),
            _ => {}
        }
    }
}

#[test]
fn the_answer_schemas_are_flat_and_closed_over_the_catalogue() {
    let (_, types) = mini();
    let blocks = block_ids(&ctx(&types, &["x:ferry-times"]));
    assert!(blocks.contains(&"team-grid".to_string()));
    assert!(blocks.contains(&"x:ferry-times".to_string()));
    let schema = proposal_schema(&blocks);
    assert_subset(&schema, "$");
    let item_blocks =
        &schema["properties"]["edits"]["items"]["properties"]["blocks"]["items"]["enum"];
    assert_eq!(item_blocks.as_array().unwrap().len(), blocks.len());
    assert_eq!(
        schema["properties"]["edits"]["items"]["properties"]["op"]["enum"],
        json!(OPS)
    );
    // The fake's answer fits it (the flat shape's nulls included).
    let compiled = jsonschema::validator_for(&schema).unwrap();
    assert!(compiled.is_valid(&author_answer()));
    let tool = tool_proposal_schema();
    assert_subset(&tool, "$");
    let ferry: Value = serde_json::from_str(include_str!(
        "fixtures/site/blueprint/tools/ferry-times.tool.json"
    ))
    .unwrap();
    let compiled = jsonschema::validator_for(&tool).unwrap();
    assert!(compiled.is_valid(&json!({"summary": "Ferry departures per village.", "graph": ferry})));
}
