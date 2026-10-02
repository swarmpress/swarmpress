//! Exhaustive state-machine tests: every (state, event) pair is either a
//! listed transition or rejected, and actor rules hold for every role.

use agents::state::{
    content_transition, task_transition, ticket_transition, ContentMachine, Parties, TaskMachine,
    TicketMachine, TransitionError,
};
use agents::{
    Actor, ContentEvent as CE, ContentState as CS, Role, StateMachine, TaskEvent as TE,
    TaskState as TS, TicketEvent as KE, TicketState as KS,
};

fn actor(role: Role) -> Actor {
    Actor::new(role, format!("{role}-1"))
}

/// Expected legal content transitions with the roles allowed.
fn content_table() -> Vec<(CS, CE, CS, Vec<Role>)> {
    use Role::*;
    vec![
        (
            CS::Idea,
            CE::TopicAccepted,
            CS::Planned,
            vec![EditorInChief, Ceo],
        ),
        (
            CS::Planned,
            CE::BriefCreated,
            CS::BriefCreated,
            vec![Editor, EditorInChief],
        ),
        (CS::BriefCreated, CE::WriterStarted, CS::Draft, vec![Writer]),
        (
            CS::Draft,
            CE::SubmitForReview,
            CS::InEditorialReview,
            vec![Writer],
        ),
        (
            CS::InEditorialReview,
            CE::RequestChanges,
            CS::NeedsChanges,
            vec![Editor, Ceo],
        ),
        (
            CS::InEditorialReview,
            CE::Approve,
            CS::Approved,
            vec![Editor, Ceo],
        ),
        (
            CS::InEditorialReview,
            CE::Reject,
            CS::Rejected,
            vec![Editor, Ceo],
        ),
        (
            CS::NeedsChanges,
            CE::RevisionsApplied,
            CS::Draft,
            vec![Writer],
        ),
        (
            CS::Approved,
            CE::ReadyForPublish,
            CS::Scheduled,
            vec![SeoSpecialist, System],
        ),
        (
            CS::Scheduled,
            CE::DeploySuccess,
            CS::Published,
            vec![System],
        ),
        (CS::Published, CE::Retire, CS::Archived, vec![Ceo]),
    ]
}

#[test]
fn content_all_pairs_all_roles() {
    let table = content_table();
    let mut legal = 0;
    for &from in CS::ALL {
        for &event in CE::ALL {
            for &role in Role::ALL {
                let got = content_transition(from, event, &actor(role));
                let expected = table.iter().find(|(f, e, _, _)| *f == from && *e == event);
                match (expected, got) {
                    (_, Err(TransitionError::Terminal { .. })) => {
                        assert!(ContentMachine::is_terminal(from), "{from} not terminal")
                    }
                    (Some((_, _, to, roles)), Ok(next)) => {
                        assert!(
                            roles.contains(&role),
                            "{role} allowed {from} --{event}--> {next}"
                        );
                        assert_eq!(next, *to);
                        legal += 1;
                    }
                    (Some((_, _, _, roles)), Err(TransitionError::ActorNotAllowed { .. })) => {
                        assert!(
                            !roles.contains(&role),
                            "{role} wrongly denied {from} --{event}"
                        )
                    }
                    (None, Err(TransitionError::NoTransition { .. })) => {}
                    (exp, got) => {
                        panic!("{from} --{event}--> by {role}: expected {exp:?}, got {got:?}")
                    }
                }
            }
        }
    }
    let expected_legal: usize = table.iter().map(|t| t.3.len()).sum();
    assert_eq!(legal, expected_legal);
    assert_eq!(ContentMachine::RULES.len(), table.len());
}

#[test]
fn content_terminal_states() {
    for s in [CS::Rejected, CS::Archived] {
        for &e in CE::ALL {
            assert!(matches!(
                content_transition(s, e, &Actor::ceo()),
                Err(TransitionError::Terminal { .. })
            ));
        }
        assert!(ContentMachine::possible(s, &Actor::ceo(), &Parties::default()).is_empty());
    }
    assert_eq!(ContentMachine::INITIAL, CS::Idea);
}

#[test]
fn ceo_has_no_blanket_override() {
    // legacy let the CEO perform any transition; now only listed ones
    let err = content_transition(CS::BriefCreated, CE::WriterStarted, &Actor::ceo()).unwrap_err();
    assert!(matches!(err, TransitionError::ActorNotAllowed { .. }));
    assert_eq!(
        err.to_string(),
        "ContentItem: actor ceo:ceo may not perform writer.started in state brief_created"
    );
}

#[test]
fn full_happy_path_and_revision_loop() {
    let w = actor(Role::Writer);
    let e = actor(Role::Editor);
    let mut s = CS::Idea;
    for (ev, a) in [
        (CE::TopicAccepted, actor(Role::EditorInChief)),
        (CE::BriefCreated, actor(Role::EditorInChief)),
        (CE::WriterStarted, w.clone()),
        (CE::SubmitForReview, w.clone()),
        (CE::RequestChanges, e.clone()),
        (CE::RevisionsApplied, w.clone()),
        (CE::SubmitForReview, w.clone()),
        (CE::Approve, e.clone()),
        (CE::ReadyForPublish, Actor::system()),
        (CE::DeploySuccess, Actor::system()),
        (CE::Retire, Actor::ceo()),
    ] {
        s = content_transition(s, ev, &a).unwrap();
    }
    assert_eq!(s, CS::Archived);
}

#[test]
fn task_assignee_rule_is_not_a_wildcard() {
    // Legacy bug: 'AssignedAgent' in the allow-list let ANY actor through.
    let assignee = Actor::new(Role::Writer, "isabella");
    let other_writer = Actor::new(Role::Writer, "giulia");
    let a = Some("isabella");
    assert_eq!(
        task_transition(TS::Planned, TE::AgentAccepts, &assignee, a),
        Ok(TS::InProgress)
    );
    for intruder in [
        other_writer.clone(),
        Actor::ceo(),
        Actor::system(),
        actor(Role::EditorInChief),
    ] {
        assert!(matches!(
            task_transition(TS::Planned, TE::AgentAccepts, &intruder, a),
            Err(TransitionError::ActorNotAllowed { .. })
        ));
    }
    // no assignee recorded: fail closed
    assert!(task_transition(TS::Planned, TE::AgentAccepts, &assignee, None).is_err());
    // a human/system actor can't satisfy the assignee rule even with a matching id
    assert!(task_transition(
        TS::Planned,
        TE::AgentAccepts,
        &Actor::new(Role::Ceo, "isabella"),
        a
    )
    .is_err());
}

#[test]
fn task_all_pairs() {
    use Role::*;
    // (from, event, to, roles, assignee_allowed)
    let table: Vec<(TS, TE, TS, Vec<Role>, bool)> = vec![
        (TS::Planned, TE::AgentAccepts, TS::InProgress, vec![], true),
        (TS::InProgress, TE::Error, TS::Blocked, vec![System], true),
        (
            TS::Blocked,
            TE::Unblock,
            TS::InProgress,
            vec![EditorInChief],
            true,
        ),
        (TS::InProgress, TE::Finish, TS::Completed, vec![], true),
        (
            TS::Planned,
            TE::Cancel,
            TS::Cancelled,
            vec![Ceo, EditorInChief],
            false,
        ),
        (TS::InProgress, TE::Cancel, TS::Cancelled, vec![Ceo], false),
    ];
    for &from in TS::ALL {
        for &event in TE::ALL {
            let row = table.iter().find(|r| r.0 == from && r.1 == event);
            for &role in Role::ALL {
                // non-assignee
                let a = Actor::new(role, "someone-else");
                let got = task_transition(from, event, &a, Some("assigned-one"));
                match row {
                    _ if TaskMachine::is_terminal(from) => {
                        assert!(matches!(got, Err(TransitionError::Terminal { .. })))
                    }
                    None => assert!(matches!(got, Err(TransitionError::NoTransition { .. }))),
                    Some(r) if r.3.contains(&role) => assert_eq!(got, Ok(r.2)),
                    Some(_) => assert!(matches!(got, Err(TransitionError::ActorNotAllowed { .. }))),
                }
                // assignee
                if role.is_agent() {
                    let me = Actor::new(role, "assigned-one");
                    let got = task_transition(from, event, &me, Some("assigned-one"));
                    if let Some(r) = row {
                        if !TaskMachine::is_terminal(from) {
                            assert_eq!(
                                got.is_ok(),
                                r.4 || r.3.contains(&role),
                                "{from} {event} {role}"
                            );
                        }
                    }
                }
            }
        }
    }
}

#[test]
fn ticket_all_pairs_and_originator_rule() {
    use Role::*;
    let table: Vec<(KS, KE, KS, Vec<Role>)> = vec![
        (
            KS::Open,
            KE::AnswerProvided,
            KS::Answered,
            vec![Ceo, EditorInChief, Secretary, System],
        ),
        (KS::Answered, KE::AgentAcknowledged, KS::Closed, vec![Ceo]),
        (KS::Open, KE::InvalidTicket, KS::Closed, vec![Ceo]),
    ];
    for &from in KS::ALL {
        for &event in KE::ALL {
            let row = table.iter().find(|r| r.0 == from && r.1 == event);
            for &role in Role::ALL {
                let got = ticket_transition(from, event, &Actor::new(role, "x"), Some("opener"));
                match row {
                    _ if TicketMachine::is_terminal(from) => {
                        assert!(matches!(got, Err(TransitionError::Terminal { .. })))
                    }
                    None => assert!(matches!(got, Err(TransitionError::NoTransition { .. }))),
                    Some(r) if r.3.contains(&role) => assert_eq!(got, Ok(r.2)),
                    Some(_) => assert!(matches!(got, Err(TransitionError::ActorNotAllowed { .. }))),
                }
            }
        }
    }
    let opener = Actor::new(Role::Writer, "opener");
    assert_eq!(
        ticket_transition(KS::Answered, KE::AgentAcknowledged, &opener, Some("opener")),
        Ok(KS::Closed)
    );
    assert!(ticket_transition(
        KS::Answered,
        KE::AgentAcknowledged,
        &actor(Role::Writer),
        Some("opener")
    )
    .is_err());
    assert!(ticket_transition(KS::Answered, KE::AgentAcknowledged, &opener, None).is_err());
}

#[test]
fn states_serialize_as_legacy_strings() {
    assert_eq!(
        serde_json::to_string(&CS::InEditorialReview).unwrap(),
        "\"in_editorial_review\""
    );
    assert_eq!(
        serde_json::to_string(&CE::TopicAccepted).unwrap(),
        "\"topic.accepted\""
    );
    assert_eq!(
        serde_json::to_string(&TE::AgentAccepts).unwrap(),
        "\"agent.accepts\""
    );
}
