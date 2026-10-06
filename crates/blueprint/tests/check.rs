//! The checker's closed world and the semantic diff (FEAT-090).

use std::collections::{BTreeMap, BTreeSet};

use blueprint::{
    apply, check, diff, Blueprint, ChangeKind, CheckContext, IssueCode, Subject, ToolSig, TypeExpr,
    TypeRegistry,
};
use serde_json::{json, Value};

fn bp(v: Value) -> Blueprint {
    Blueprint::from_value(&v).unwrap()
}

fn base() -> Value {
    json!({
        "format": "swarmpress.blueprint.v1",
        "globals": { "header": { "block": "x:site-header" }, "footer": { "block": "newsletter" } },
        "page_types": [
            { "id": "home", "label": { "en": "Home" }, "route": "/{lang}", "source": { "kind": "page" },
              "slots": [
                { "id": "hero", "blocks": ["hero-section"], "min": 1, "max": 1 },
                { "id": "weather", "blocks": ["weather-live"], "max": 1,
                  "source": { "tool": "get-weather", "inputs": { "city": "site.city" }, "accepts": "WeatherCard" } },
                { "id": "stories", "blocks": ["latest-stories"] }
              ],
              "uses": ["header", "footer"] },
            { "id": "author", "label": { "en": "Author" }, "route": "/{lang}/authors/{slug}", "source": { "kind": "page" },
              "slots": [{ "id": "profile", "blocks": ["team-grid"], "min": 1, "max": 1 }],
              "linking": { "min_links": 1, "targets": ["home"] } }
        ],
        "collections": [{ "id": "latest", "type": "Article", "from": "page_type:home", "limit": 6 }],
        "relationships": [{ "from": "author", "to": "home", "kind": "features", "cardinality": "one-to-many" }],
        "navigation": [{ "page_type": "home" }, { "section": "villages" }],
        "intent": { "keywords": ["editorial", "image-heavy"] }
    })
}

fn ctx() -> CheckContext {
    let types: BTreeMap<String, Value> = serde_json::from_value(json!({
        "Weather": { "type": "object", "additionalProperties": false, "required": ["temperature"],
            "properties": { "temperature": { "type": "integer" }, "condition": { "type": "string" } } },
        "WeatherCard": { "type": "object", "additionalProperties": false, "required": ["temperature"],
            "properties": { "temperature": { "type": "number" } } }
    }))
    .unwrap();
    let tool = ToolSig {
        inputs: BTreeMap::from([("city".to_string(), TypeExpr::parse("string").unwrap())]),
        outputs: BTreeMap::from([("weather".to_string(), TypeExpr::parse("Weather").unwrap())]),
    };
    CheckContext {
        types: TypeRegistry::with_site(&types).unwrap(),
        custom_blocks: BTreeSet::from(["x:site-header".to_string()]),
        tools: BTreeMap::from([("get-weather".to_string(), tool)]),
        sections: BTreeSet::from(["villages".to_string()]),
        manifest_collections: BTreeSet::new(),
    }
}

fn codes(v: Value) -> Vec<(IssueCode, String)> {
    check(&bp(v), &ctx())
        .into_iter()
        .map(|i| (i.code, i.path))
        .collect()
}

#[test]
fn a_sound_blueprint_has_no_issues() {
    assert_eq!(check(&bp(base()), &ctx()), vec![]);
}

#[test]
fn closed_ids() {
    let mut v = base();
    v["page_types"][0]["slots"][2]["blocks"] = json!(["latest-storeys"]);
    v["page_types"][0]["uses"] = json!(["header", "sidebar"]);
    v["navigation"][1]["section"] = json!("beaches");
    v["relationships"][0]["to"] = json!("topic");
    v["collections"][0]["type"] = json!("Story");
    let c = codes(v);
    for want in [
        (IssueCode::UnknownBlock, "/page_types/0/slots/2/blocks/0"),
        (IssueCode::UnknownRef, "/page_types/0/uses/1"),
        (IssueCode::UnknownRef, "/navigation/1"),
        (IssueCode::UnknownRef, "/relationships/0/to"),
        (IssueCode::UnknownType, "/collections/0/type"),
    ] {
        assert!(
            c.contains(&(want.0, want.1.to_string())),
            "{want:?} not in {c:?}"
        );
    }
}

#[test]
fn slot_rules_and_core_types() {
    let mut v = base();
    v["page_types"][0]["slots"][2]["blocks"] = json!(["hero-section"]);
    v["page_types"][1]["slots"][0]["max"] = json!(0);
    let c = codes(v);
    assert!(
        c.contains(&(IssueCode::BadSlot, "/page_types/0/slots/2".into())),
        "{c:?}"
    );
    assert!(
        c.contains(&(IssueCode::BadSlot, "/page_types/1/slots/0".into())),
        "{c:?}"
    );
    // The core article keeps the platform's slots.
    let mut v = base();
    v["page_types"][1]["id"] = json!("blog-article");
    let c = codes(v);
    assert!(
        c.contains(&(IssueCode::BadSlot, "/page_types/1/slots".into())),
        "{c:?}"
    );
    // Two types with one name, via an alias.
    let mut v = base();
    v["page_types"][1]["aliases"] = json!(["home"]);
    assert!(codes(v).iter().any(|(c, _)| *c == IssueCode::BadId));
}

#[test]
fn bindings_are_typed() {
    let mut v = base();
    v["page_types"][0]["slots"][1]["source"]["accepts"] = json!("Article");
    let issues = check(&bp(v), &ctx());
    assert_eq!(issues.len(), 1, "{issues:?}");
    assert_eq!(issues[0].code, IssueCode::TypeMismatch);
    assert!(
        issues[0]
            .message
            .contains("get-weather.weather (Weather) does not fit Article"),
        "{}",
        issues[0].message
    );

    let mut v = base();
    v["page_types"][0]["slots"][1]["source"]["inputs"] = json!({ "town": "visitor.city" });
    let c = codes(v);
    assert!(
        c.contains(&(
            IssueCode::UnknownPort,
            "/page_types/0/slots/1/source/inputs/town".into()
        )),
        "{c:?}"
    );
    assert!(
        c.contains(&(
            IssueCode::BadContextPath,
            "/page_types/0/slots/1/source/inputs/town".into()
        )),
        "{c:?}"
    );
    assert!(
        c.contains(&(
            IssueCode::UnknownPort,
            "/page_types/0/slots/1/source/inputs".into()
        )),
        "{c:?}"
    );

    let mut v = base();
    v["page_types"][0]["slots"][1]["source"]["tool"] = json!("get-tides");
    assert_eq!(
        codes(v),
        vec![(
            IssueCode::UnknownTool,
            "/page_types/0/slots/1/source/tool".into()
        )]
    );
}

#[test]
fn diffs_name_what_changed_and_apply_back() {
    let old = bp(base());
    let mut v = base();
    v["page_types"][1]["label"]["en"] = json!("Writer");
    v["page_types"][0]["slots"]
        .as_array_mut()
        .unwrap()
        .remove(1);
    v["page_types"].as_array_mut().unwrap().push(json!({
        "id": "topic", "label": { "en": "Topic" }, "source": { "kind": "page" },
        "slots": [{ "id": "feed", "blocks": ["latest-stories"] }]
    }));
    v["globals"].as_object_mut().unwrap().remove("footer");
    v["intent"]["keywords"] = json!(["minimal"]);
    let new = bp(v);
    let changes = diff(&old, &new);
    let summary: Vec<(ChangeKind, Subject, &str)> = changes
        .iter()
        .map(|c| (c.kind, c.subject, c.id.as_str()))
        .collect();
    assert_eq!(
        summary,
        vec![
            (ChangeKind::Changed, Subject::PageType, "author"),
            (ChangeKind::Changed, Subject::PageType, "home"),
            (ChangeKind::Added, Subject::PageType, "topic"),
            (ChangeKind::Removed, Subject::Slot, "home/weather"),
            (ChangeKind::Removed, Subject::Global, "footer"),
            (ChangeKind::Changed, Subject::Intent, "intent"),
        ]
    );
    assert_eq!(changes[0].fields, ["label"]);
    assert_eq!(changes[1].fields, ["slots"]);
    assert_eq!(apply(&old, &new, &changes), new);
    // Applying a part keeps the rest of the base.
    let only_topic: Vec<_> = changes
        .iter()
        .filter(|c| c.id == "topic")
        .cloned()
        .collect();
    let partial = apply(&old, &new, &only_topic);
    assert!(partial.page_type("topic").is_some());
    assert_eq!(partial.page_type("author"), old.page_type("author"));
    assert!(partial.globals.contains_key("footer"));
    assert!(diff(&old, &old).is_empty());
}
