//! The publishing plan as agents see it (ADR-0031): context formatting, the
//! plan-op schema and RBAC validation (role × op enumeration).

use agents::plan::{
    format_plan_context, plan_ops_schema, validate_plan_ops, ItemStatus, LinkedItem, Phase,
    PhaseState, PlanContext, PlanOp, PlanPost, PostKind, Priority, Relation, TeamMember, Todo,
    Verdict, WorkItem, PLAN_OP_KINDS,
};
use agents::Role;
use serde_json::json;

fn ctx(actor: &str) -> PlanContext {
    PlanContext {
        item: WorkItem {
            id: "work-item-4".into(),
            kind: "article".into(),
            title: "Harvest week in Manarola".into(),
            brief: "The Sciacchetrà harvest on the Volastra terraces: who picks, when, and where visitors can taste it.".into(),
            project: "cinqueterre-travel".into(),
            workstream: Some("Autumn harvest season".into()),
            goal: Some("Grow cinqueterre.travel to 40k monthly readers".into()),
            status: ItemStatus::InProgress,
            priority: Priority::High,
            owner: Some("staff-5".into()),
            phase: Some(Phase {
                kind: "draft".into(),
                assignee: Some("staff-1".into()),
                state: PhaseState::Working,
            }),
            reviewers: vec!["staff-5".into()],
            due_day: Some(12),
            publish_day: Some(14),
            keywords: vec!["sciacchetrà harvest".into(), "manarola vineyards".into()],
            targets: vec!["content/pages/blog/harvest-week-manarola.json".into()],
        },
        team: vec![
            TeamMember { id: "staff-1".into(), name: "Giulia Rossi".into(), role: Role::Writer },
            TeamMember { id: "staff-4".into(), name: "Sophia Lanza".into(), role: Role::EditorInChief },
            TeamMember { id: "staff-5".into(), name: "Marco Vitali".into(), role: Role::Editor },
            TeamMember { id: "staff-6".into(), name: "Francesca De Luca".into(), role: Role::Photographer },
        ],
        todos: vec![
            Todo { id: "todo-9".into(), text: "Three photos of the Volastra terraces at golden hour".into(), assignee: Some("staff-6".into()), done: false },
            Todo { id: "todo-10".into(), text: "Confirm Sciacchetrà harvest dates".into(), assignee: None, done: true },
        ],
        thread: (1..=14)
            .map(|i| PlanPost {
                id: format!("post-{i}"),
                kind: if i == 14 { PostKind::Handoff } else { PostKind::Comment },
                author: if i % 2 == 0 { "staff-1".into() } else { "staff-5".into() },
                day: 10 + i / 8,
                minute: 540 + i * 15,
                text: if i == 14 { "Draft is in; need 2 harvest photos.".into() } else { format!("Note {i}.") },
                to: if i == 14 { Some("staff-6".into()) } else { None },
            })
            .collect(),
        thread_summary: Some("Marco and Giulia agreed the angle: the people who pick, not the wine list.".into()),
        linked: vec![LinkedItem {
            id: "work-item-7".into(),
            relation: Relation::Blocks,
            title: "Harvest week (DE translation)".into(),
            status: ItemStatus::Backlog,
        }],
        actor_id: actor.into(),
        persona: Some("giulia".into()),
    }
}

#[test]
fn plan_context_prompt_snapshot() {
    insta::assert_snapshot!(
        "plan_context_giulia",
        format_plan_context(&ctx("staff-1"), 5)
    );
}

fn sample_ops() -> Vec<PlanOp> {
    vec![
        PlanOp::Comment {
            text: "Looks good.".into(),
            mentions: vec!["staff-6".into()],
        },
        PlanOp::Handoff {
            to: "staff-6".into(),
            notes: "Over to photos.".into(),
        },
        PlanOp::TodoAdd {
            text: "Caption the terraces".into(),
            assignee: Some("staff-6".into()),
        },
        PlanOp::TodoDone {
            todo: "todo-9".into(),
        },
        PlanOp::Question {
            text: "Can we name the grower?".into(),
            escalate: false,
        },
        PlanOp::Review {
            verdict: Verdict::Approve,
            score: 8,
            notes: "Ready.".into(),
        },
        PlanOp::Decision {
            text: "We cut the restaurant list to 8.".into(),
        },
        PlanOp::Proposal {
            kind: "article".into(),
            title: "Where to taste Sciacchetrà".into(),
            brief: "A follow-up on tasting rooms.".into(),
            workstream: Some("Autumn harvest season".into()),
        },
        PlanOp::RequestHelp {
            role: Role::SeoSpecialist,
            text: "Keywords for the follow-up?".into(),
        },
    ]
}

#[test]
fn plan_ops_schema_accepts_every_op_and_rejects_strangers() {
    let v = claude::SchemaValidator::new(&plan_ops_schema()).unwrap();
    let ops = serde_json::to_value(sample_ops()).unwrap();
    v.validate(&ops).unwrap();
    let kinds: Vec<&str> = sample_ops().iter().map(PlanOp::kind).collect();
    assert_eq!(kinds, PLAN_OP_KINDS);
    assert_eq!(ops[2]["op"], "todo-add");
    // serde round trip
    let back: Vec<PlanOp> = serde_json::from_value(ops).unwrap();
    assert_eq!(back, sample_ops());
    // optional fields as null deserialize
    let op: PlanOp =
        serde_json::from_value(json!({"op": "todo-add", "text": "x", "assignee": null})).unwrap();
    assert_eq!(
        op,
        PlanOp::TodoAdd {
            text: "x".into(),
            assignee: None
        }
    );
    for bad in [
        json!([{"op": "status", "text": "published"}]),
        json!([{"op": "review", "verdict": "approve", "score": 11, "notes": "x"}]),
        json!([{"op": "request-help", "role": "ceo", "text": "x"}]),
        json!([{"op": "comment", "text": "x", "mentions": [], "extra": 1}]),
    ] {
        assert!(v.validate(&bad).is_err(), "{bad}");
    }
}

/// Expected acceptance per op (in [`PLAN_OP_KINDS`] order) for an actor who
/// is on the team but is neither the owner, a reviewer nor the phase
/// assignee.
fn expected_plain_member(role: Role) -> [bool; 9] {
    let lead = matches!(role, Role::EditorInChief | Role::Ceo);
    match role {
        Role::System => [false; 9],
        //       comment handoff todo+ todo✓ question review decision proposal help
        _ => [true, false, true, true, true, lead, lead, true, true],
    }
}

#[test]
fn rbac_role_by_op_enumeration() {
    // a plain team member
    let c = ctx("staff-99");
    for &role in Role::ALL {
        let got = validate_plan_ops(sample_ops(), role, true, &c);
        let accepted: Vec<&str> = got.accepted.iter().map(PlanOp::kind).collect();
        let expected: Vec<&str> = PLAN_OP_KINDS
            .iter()
            .zip(expected_plain_member(role))
            .filter(|(_, ok)| *ok)
            .map(|(k, _)| *k)
            .collect();
        assert_eq!(accepted, expected, "{role}");
        assert_eq!(got.accepted.len() + got.rejected.len(), 9);
    }

    // not on the team: nothing but the CEO
    for &role in Role::ALL {
        let got = validate_plan_ops(sample_ops(), role, false, &ctx("staff-42"));
        if role == Role::Ceo {
            assert_eq!(got.rejected.len(), 1, "CEO only lacks handoff");
        } else {
            assert!(got.accepted.is_empty(), "{role}");
            if role != Role::System {
                assert!(got.rejected[0]
                    .reason
                    .contains("not on the cinqueterre-travel team"));
            }
        }
    }

    // the owner (Marco, editor, also the reviewer) may decide and approve
    let got = validate_plan_ops(sample_ops(), Role::Editor, true, &ctx("staff-5"));
    let rejected: Vec<&str> = got.rejected.iter().map(|r| r.op.kind()).collect();
    assert_eq!(rejected, ["handoff"]);

    // the phase assignee (Giulia, writer) may hand off but never approve or
    // decide, even if listed as reviewer
    let mut c = ctx("staff-1");
    c.item.reviewers.push("staff-1".into());
    let got = validate_plan_ops(sample_ops(), Role::Writer, true, &c);
    let rejected: Vec<(&str, &str)> = got
        .rejected
        .iter()
        .map(|r| (r.op.kind(), r.reason.as_str()))
        .collect();
    assert_eq!(
        rejected,
        [
            ("review", "writers cannot approve"),
            (
                "decision",
                "only the item owner, the Editor-in-Chief or the CEO can decide"
            )
        ]
    );
    // a writer-reviewer may still ask for changes
    let got = validate_plan_ops(
        vec![PlanOp::Review {
            verdict: Verdict::Changes,
            score: 5,
            notes: "More on the pickers.".into(),
        }],
        Role::Writer,
        true,
        &c,
    );
    assert_eq!(got.accepted.len(), 1);
}

#[test]
fn rbac_contextual_rules() {
    let c = ctx("staff-1");
    let check = |op: PlanOp, role: Role| {
        let r = validate_plan_ops(vec![op], role, true, &c);
        r.rejected.first().map(|x| x.reason.clone())
    };
    // mentions must be team members
    assert!(check(
        PlanOp::Comment {
            text: "cc".into(),
            mentions: vec!["staff-77".into()]
        },
        Role::Writer
    )
    .unwrap()
    .contains("not a team member"));
    // handoff to self or outside the team
    assert!(check(
        PlanOp::Handoff {
            to: "staff-1".into(),
            notes: "x".into()
        },
        Role::Writer
    )
    .unwrap()
    .contains("yourself"));
    assert!(check(
        PlanOp::Handoff {
            to: "staff-77".into(),
            notes: "x".into()
        },
        Role::Writer
    )
    .unwrap()
    .contains("not a team member"));
    // todos must exist and be open
    assert!(check(
        PlanOp::TodoDone {
            todo: "todo-404".into()
        },
        Role::Writer
    )
    .unwrap()
    .contains("unknown todo"));
    assert!(check(
        PlanOp::TodoDone {
            todo: "todo-10".into()
        },
        Role::Writer
    )
    .unwrap()
    .contains("already done"));
    // approval needs the rubric's bar
    assert!(check(
        PlanOp::Review {
            verdict: Verdict::Approve,
            score: 6,
            notes: "ok".into()
        },
        Role::EditorInChief
    )
    .unwrap()
    .contains("at least 7"));
    // empty text
    assert!(check(
        PlanOp::Question {
            text: "  ".into(),
            escalate: true
        },
        Role::Writer
    )
    .is_some());
    // help only from staff roles
    assert!(check(
        PlanOp::RequestHelp {
            role: Role::System,
            text: "x".into()
        },
        Role::Writer
    )
    .is_some());
    // rejection notes for a repair turn
    let r = validate_plan_ops(
        vec![PlanOp::Decision { text: "x".into() }],
        Role::Writer,
        true,
        &c,
    );
    assert_eq!(
        r.rejection_notes(),
        ["decision rejected: only the item owner, the Editor-in-Chief or the CEO can decide"]
    );
}
