//! The repair loop driver: which placements a `fix#i` call may change, and
//! applying the model's answer.

mod common;

use office_designer::{
    apply_fix, evaluate, fix_schema, next_step, Catalogue, EquipmentDesign, IssueCode, PlanFix,
    Step, MAX_REPAIR_ROUNDS,
};

fn fixture(name: &str) -> common::Fixture {
    common::fixtures()
        .into_iter()
        .find(|(n, _)| *n == name)
        .unwrap()
        .1
}

#[test]
fn a_bad_newsroom_is_repaired_in_one_round() {
    let f = fixture("newsroom");
    let cat = Catalogue::shipped();
    let plan = common::plan(&f.bad[0].plan); // desks turned to the wall
    let eval = evaluate(&f.room, &plan, &f.brief, cat);
    let Step::Repair(task) = next_step(&eval, 0, MAX_REPAIR_ROUNDS) else {
        panic!("expected a repair");
    };
    assert_eq!(task.round, 1);
    assert_eq!(task.fix, vec![0]);
    let prompt = task.prompt(&plan);
    assert!(prompt.contains("[into-wall]"), "{prompt}");
    assert!(
        prompt.contains(
            r#"0: {"design":"desk","anchor":"window:0","facing":"toward","count":3,"spacing":4}"#
        ),
        "{prompt}"
    );
    let answer = r#"{"replace": [{"index": 0, "placement": {"design": "desk", "anchor": "window:0", "count": 3, "spacing": 4}}]}"#;
    let fix = PlanFix::from_json(answer).unwrap();
    let fixed = apply_fix(&plan, &task, &fix).unwrap();
    let eval = evaluate(&f.room, &fixed, &f.brief, cat);
    assert_eq!(next_step(&eval, task.round, MAX_REPAIR_ROUNDS), Step::Done);
    // the fixed plan validates against the fix schema too
    let schema = fix_schema(&EquipmentDesign::ALL, Some(&f.room));
    let v = jsonschema::validator_for(&schema).unwrap();
    assert!(v.is_valid(&serde_json::from_str(answer).unwrap()));
}

#[test]
fn a_fix_may_only_touch_the_named_placements() {
    let f = fixture("newsroom");
    let plan = common::plan(&f.bad[0].plan);
    let eval = evaluate(&f.room, &plan, &f.brief, Catalogue::shipped());
    let Step::Repair(task) = next_step(&eval, 0, MAX_REPAIR_ROUNDS) else {
        panic!("expected a repair");
    };
    let fix = PlanFix::from_json(
        r#"{"replace": [{"index": 2, "placement": {"design": "plant", "anchor": "wall:south"}}], "remove": [0, 0]}"#,
    )
    .unwrap();
    let issues = apply_fix(&plan, &task, &fix).unwrap_err();
    let text: Vec<&str> = issues.iter().map(|i| i.message.as_str()).collect();
    assert_eq!(
        text,
        vec![
            "placement 2 was not named for repair; change only placements 0",
            "placement 0 is changed twice; replace or remove it once",
            "placement 1 refers to placement 0, which this fix removes",
        ]
    );
}

#[test]
fn removals_renumber_references_and_refuse_dangling_ones() {
    let f = fixture("newsroom");
    let plan = common::plan(&f.good);
    let task = office_designer::RepairTask {
        round: 1,
        fix: vec![0, 3],
        issues: vec![],
    };
    // removing the plant (3) keeps the references to the desks (0)
    let fixed = apply_fix(
        &plan,
        &task,
        &PlanFix {
            remove: vec![3],
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(fixed.placements.len(), 3);
    // removing the desks leaves the monitors and lamps without a desk
    let issues = apply_fix(
        &plan,
        &task,
        &PlanFix {
            remove: vec![0],
            ..Default::default()
        },
    )
    .unwrap_err();
    assert_eq!(issues.len(), 2);
    assert!(issues[0]
        .message
        .contains("refers to placement 0, which this fix removes"));
    // with a removal before it, a later reference moves down
    let mut p = plan.clone();
    for q in &mut p.placements {
        if let office_designer::Anchor::Placement(n) = q.anchor {
            q.anchor = office_designer::Anchor::Placement(n + 1);
        }
    }
    p.placements.insert(
        0,
        office_designer::Placement::new(
            EquipmentDesign::Plant,
            office_designer::Anchor::Wall(office_designer::Side::South),
        ),
    );
    let t = office_designer::RepairTask {
        round: 1,
        fix: vec![0],
        issues: vec![],
    };
    let fixed = apply_fix(
        &p,
        &t,
        &PlanFix {
            remove: vec![0],
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(fixed, plan);
}

#[test]
fn the_loop_stops_at_the_limit_and_on_rooms_too_small() {
    let f = fixture("kitchen");
    let cat = Catalogue::shipped();
    let small = &f.bad[1];
    let eval = evaluate(
        &f.room,
        &common::plan(&small.plan),
        small.brief.as_ref().unwrap(),
        cat,
    );
    assert!(eval.errors().any(|i| i.code == IssueCode::RoomTooSmall));
    assert!(matches!(
        next_step(&eval, 0, MAX_REPAIR_ROUNDS),
        Step::GiveUp { .. }
    ));
    let eval = evaluate(&f.room, &common::plan(&f.bad[0].plan), &f.brief, cat);
    assert!(matches!(
        next_step(&eval, 0, MAX_REPAIR_ROUNDS),
        Step::Repair(_)
    ));
    assert!(matches!(
        next_step(&eval, MAX_REPAIR_ROUNDS, MAX_REPAIR_ROUNDS),
        Step::GiveUp { .. }
    ));
}

#[test]
fn a_missing_requirement_asks_for_additions() {
    let f = fixture("newsroom");
    let cat = Catalogue::shipped();
    let plan = common::plan(&f.bad[1].plan); // desks without screens
    let eval = evaluate(&f.room, &plan, &f.brief, cat);
    let Step::Repair(task) = next_step(&eval, 0, MAX_REPAIR_ROUNDS) else {
        panic!("expected a repair");
    };
    assert!(task.fix.is_empty());
    assert!(task.prompt(&plan).contains("add placements"));
    let fix =
        PlanFix::from_json(r#"{"add": [{"design": "monitor", "anchor": "placement:0"}]}"#).unwrap();
    let fixed = apply_fix(&plan, &task, &fix).unwrap();
    assert!(evaluate(&f.room, &fixed, &f.brief, cat).ok);
    // a bad addition is a validation error for the model
    let issues = PlanFix::from_json(r#"{"add": [{"design": "sofa", "anchor": "placement:0"}]}"#)
        .unwrap_err();
    assert!(issues[0].message.starts_with("added placement 0"));
}
