//! Briefs per room kind: good plans solve with zero errors, bad plans
//! produce exactly the expected errors, the output is deterministic, and
//! the generated schema and docs match the vocabulary.

mod common;

use std::collections::BTreeSet;

use office_designer::{
    evaluate, layout_context, plan_schema, slice, At, Catalogue, EquipmentDesign, IssueCode, Plan,
};

fn codes(eval: &office_designer::Evaluation) -> Vec<String> {
    let set: BTreeSet<String> = eval.errors().map(|i| i.code.slug()).collect();
    set.into_iter().collect()
}

#[test]
fn good_plans_solve_with_no_errors() {
    let cat = Catalogue::shipped();
    for (name, f) in common::fixtures() {
        let plan = common::plan(&f.good);
        let eval = evaluate(&f.room, &plan, &f.brief, cat);
        assert!(
            eval.ok,
            "{name} ({}): {:#?}",
            f.name,
            eval.errors().collect::<Vec<_>>()
        );
        for r in &eval.requirements {
            assert!(r.have >= r.wanted, "{name}: {r:?}");
        }
        assert!(!eval.items.is_empty(), "{name}");
        assert!(eval.parts > 0, "{name}");
        let price: i64 = eval.items.iter().map(|i| i.design.cost()).sum();
        assert_eq!(eval.cost_cents, price, "{name}");
    }
}

#[test]
fn bad_plans_produce_the_expected_errors() {
    let cat = Catalogue::shipped();
    for (name, f) in common::fixtures() {
        for bad in &f.bad {
            let brief = bad.brief.clone().unwrap_or_else(|| f.brief.clone());
            let plan = common::plan(&bad.plan);
            let eval = evaluate(&f.room, &plan, &brief, cat);
            let got = codes(&eval);
            assert_eq!(
                got,
                bad.codes,
                "{name}: {}: {:#?}",
                bad.why,
                eval.errors().collect::<Vec<_>>()
            );
            assert!(!eval.ok, "{name}: {}", bad.why);
            if let Some(code) = &bad.code {
                assert!(
                    eval.errors()
                        .any(|i| i.code.slug() == *code && i.placement == bad.placement),
                    "{name}: {}: no {code} on placement {:?}: {:#?}",
                    bad.why,
                    bad.placement,
                    eval.issues
                );
            }
            for i in eval.errors() {
                assert!(!i.message.is_empty() && i.id.starts_with('I'));
            }
        }
    }
}

#[test]
fn same_input_same_bytes() {
    let shipped = Catalogue::shipped();
    let fresh = Catalogue::from_kit(kit::Kit::shipped()).unwrap();
    for (name, f) in common::fixtures() {
        let mut plans = vec![f.good.clone()];
        plans.extend(f.bad.iter().map(|b| b.plan.clone()));
        for v in plans {
            let plan = common::plan(&v);
            let a = evaluate(&f.room, &plan, &f.brief, shipped).to_json();
            let b = evaluate(&f.room, &plan, &f.brief, &fresh).to_json();
            let c = evaluate(&f.room, &plan.clone(), &f.brief.clone(), shipped).to_json();
            assert_eq!(a, b, "{name}");
            assert_eq!(a, c, "{name}");
        }
    }
}

#[test]
fn the_newsroom_plan_solves_to_these_positions() {
    // A golden: changes to the solver's geometry show up here first.
    let f = common::fixtures()
        .into_iter()
        .find(|(n, _)| *n == "newsroom")
        .unwrap()
        .1;
    let eval = evaluate(
        &f.room,
        &common::plan(&f.good),
        &f.brief,
        Catalogue::shipped(),
    );
    let floor: Vec<(EquipmentDesign, i32, i32, u8)> = eval
        .items
        .iter()
        .filter_map(|i| match i.at {
            At::Floor { x_mm, z_mm, rot } => Some((i.design, x_mm, z_mm, rot)),
            At::OnDesk { .. } => None,
        })
        .collect();
    assert_eq!(
        floor,
        vec![
            (EquipmentDesign::Desk, 31_500, 9_250, 1),
            (EquipmentDesign::Desk, 31_500, 11_000, 1),
            (EquipmentDesign::Desk, 31_500, 12_750, 1),
            (EquipmentDesign::Plant, 26_375, 8_375, 0),
        ]
    );
    assert_eq!(eval.items.len(), 10);
    assert_eq!(eval.cost_cents, 3 * 40_000 + 3 * 30_000 + 3 * 6_000 + 5_000);
}

fn validator(schema: &serde_json::Value) -> jsonschema::Validator {
    jsonschema::validator_for(schema).expect("schema compiles")
}

#[test]
fn schemas_accept_the_good_plans_and_close_the_vocabulary() {
    let cat = Catalogue::shipped();
    let generic = validator(&plan_schema(&EquipmentDesign::ALL, None));
    for (name, f) in common::fixtures() {
        let designs = slice(f.room.kind, &f.brief, cat);
        let closed = validator(&plan_schema(&designs, Some(&f.room)));
        assert!(generic.is_valid(&f.good), "{name}");
        assert!(
            closed.is_valid(&f.good),
            "{name}: the good plan leaves the slice"
        );
        for bad in &f.bad {
            assert!(generic.is_valid(&bad.plan), "{name}: {}", bad.why);
        }
        // closed to the room: no window or door it does not have
        let w = serde_json::json!({"placements": [{"design": "plant", "anchor": format!("window:{}", f.room.windows.len())}]});
        assert!(!closed.is_valid(&w), "{name}");
        let d = serde_json::json!({"placements": [{"design": "plant", "anchor": format!("door:{}", f.room.doors.len())}]});
        assert!(!closed.is_valid(&d), "{name}");
    }
    for bad in [
        serde_json::json!({"placements": [{"design": "sofa", "anchor": "wall:north"}]}),
        serde_json::json!({"placements": [{"design": "desk", "anchor": "wall:up"}]}),
        serde_json::json!({"placements": [{"design": "desk", "anchor": "wall:north", "count": 0}]}),
        serde_json::json!({"placements": [{"design": "desk", "anchor": "wall:north", "colour": "red"}]}),
        serde_json::json!({"placements": [{"design": "desk"}]}),
        serde_json::json!({"items": []}),
    ] {
        assert!(!generic.is_valid(&bad), "{bad}");
        assert!(Plan::from_value(&bad).is_err(), "the parser agrees: {bad}");
    }
}

#[test]
fn the_schema_and_the_parser_share_one_vocabulary() {
    let schema = plan_schema(&EquipmentDesign::ALL, None);
    let p = &schema["properties"]["placements"]["items"]["properties"];
    let designs: Vec<String> = p["design"]["enum"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap().to_owned())
        .collect();
    for d in &designs {
        let json = format!(r#"{{"placements":[{{"design":"{d}","anchor":"wall:north"}}]}}"#);
        assert!(Plan::from_json(&json).is_ok(), "{d}");
    }
    assert_eq!(designs.len(), EquipmentDesign::ALL.len());
    for f in p["facing"]["enum"].as_array().unwrap() {
        let json =
            format!(r#"{{"placements":[{{"design":"desk","anchor":"wall:north","facing":{f}}}]}}"#);
        assert!(Plan::from_json(&json).is_ok(), "{f}");
    }
    let fields: BTreeSet<&str> = p.as_object().unwrap().keys().map(String::as_str).collect();
    let full = r#"{"design":"desk","anchor":"wall:north","from":"wall:west","side":"south","gap":1,"offset":2,"facing":"away","count":2,"spacing":3}"#;
    let parsed: office_designer::Placement = serde_json::from_str(full).unwrap();
    let back = serde_json::to_value(&parsed).unwrap();
    let keys: BTreeSet<&str> = back
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    assert_eq!(fields, keys);
}

#[test]
fn slices_and_docs_are_generated_from_the_kit() {
    let cat = Catalogue::shipped();
    for (name, f) in common::fixtures() {
        let designs = slice(f.room.kind, &f.brief, cat);
        assert!(designs.contains(&EquipmentDesign::CeilingLight), "{name}");
        for d in &designs {
            assert!(d.allowed_in(f.room.kind));
        }
        let text = layout_context(&f.room, &f.brief, cat);
        for d in &designs {
            let info = cat.info(*d);
            let line = format!(
                "- {}: {}. {} × {} studs",
                d.slug(),
                info.name,
                info.footprint[0],
                info.footprint[1]
            );
            assert!(text.contains(&line), "{name}: {line}\n{text}");
        }
        for (i, _) in f.room.windows.iter().enumerate() {
            assert!(text.contains(&format!("window:{i} from")), "{name}");
        }
        for e in &f.room.equipment {
            assert!(text.contains(&format!("equipment:{}", e.id)), "{name}");
        }
        assert!(text.contains("placement:N"));
    }
    // the slice follows the brief and the room
    let meeting = office_designer::RoomKind::MeetingRoom;
    let brief = office_designer::Brief {
        workstations: 2,
        ..Default::default()
    };
    let s = slice(meeting, &brief, cat);
    assert!(s.contains(&EquipmentDesign::Desk) && s.contains(&EquipmentDesign::Monitor));
    assert!(
        !s.contains(&EquipmentDesign::CameraRig) && !s.contains(&EquipmentDesign::ArchiveShelf)
    );
    let s = slice(
        office_designer::RoomKind::PhotoStudio,
        &Default::default(),
        cat,
    );
    assert!(s.contains(&EquipmentDesign::CameraRig));
    let desk = office_designer::design_doc(EquipmentDesign::Desk, cat);
    assert!(
        desk.contains("Counts as workstations once a screen is on it"),
        "{desk}"
    );
    assert!(
        desk.contains("Its chair stands 0.75 m (12 studs) in front"),
        "{desk}"
    );
    assert!(desk.contains("€400.00"), "{desk}");
}

#[test]
fn parse_errors_name_the_placement_and_the_vocabulary() {
    let issues = Plan::from_json(
        r#"{"placements":[{"design":"desk","anchor":"wall:north"},{"design":"sofa","anchor":"wall:north"}]}"#,
    )
    .unwrap_err();
    assert_eq!(issues.len(), 1);
    assert_eq!(issues[0].code, IssueCode::BadPlan);
    assert_eq!(issues[0].placement, Some(1));
    assert!(
        issues[0].message.contains("expected one of"),
        "{}",
        issues[0].message
    );
    let issues = Plan::from_json("not json").unwrap_err();
    assert!(issues[0].message.contains("not valid JSON"));
}
