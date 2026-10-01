//! Entity state machines ported from legacy
//! `packages/shared/src/state-machines/index.ts`.
//!
//! The orchestrator applies transitions on behalf of an [`Actor`]; LLMs never
//! do. Changes from legacy:
//! - **Bug fix:** legacy allowed *any* actor through any transition whose
//!   allow-list contained `AssignedAgent`. Here [`ActorRule::Assignee`] only
//!   matches the actor whose id equals the entity's assignee, and
//!   [`ActorRule::Originator`] only the ticket's opener. A missing assignee
//!   or originator fails closed.
//! - The legacy blanket "CEO can override any transition" is dropped; the
//!   CEO is listed explicitly where the CEO acts (approve, reject, retire,
//!   cancel, answer). CEO authority over agents is exercised through tickets.
//! - Actor vocabulary is [`Role`]: `ChiefEditor` → `EditorInChief`,
//!   `SEOSpecialist` → `Seo`, `EngineeringAgent` → `System` (publishing is
//!   the orchestrator merging and the deploy webhook), `TechnicalLead` →
//!   `EditorInChief` (unblocking) and dropped from ticket answering.
//! - `brief.created` also allows the `EditorInChief`, who writes briefs from
//!   the standup in SimPress.
//! - Additions marked `SimPress:` below: `System` may block an in-progress
//!   task after a job failure and answer a ticket with its default option
//!   when its deadline passes; the CEO may request changes (editor-deadlock
//!   tickets).

use std::fmt;

use serde::{Deserialize, Serialize};

use crate::roles::Role;

/// Who performs a transition.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Actor {
    pub role: Role,
    /// Staff id (or `"ceo"` / `"system"`).
    pub id: String,
}

impl Actor {
    pub fn new(role: Role, id: impl Into<String>) -> Self {
        Self {
            role,
            id: id.into(),
        }
    }
    pub fn ceo() -> Self {
        Self::new(Role::Ceo, "ceo")
    }
    pub fn system() -> Self {
        Self::new(Role::System, "system")
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ActorRule {
    Role(Role),
    /// The agent the task is assigned to.
    Assignee,
    /// The agent who opened the ticket.
    Originator,
}

/// Relationship context for relational actor rules.
#[derive(Debug, Clone, Copy, Default)]
pub struct Parties<'a> {
    pub assignee: Option<&'a str>,
    pub originator: Option<&'a str>,
}

impl ActorRule {
    fn allows(self, actor: &Actor, parties: &Parties<'_>) -> bool {
        match self {
            ActorRule::Role(r) => actor.role == r,
            ActorRule::Assignee => {
                parties.assignee == Some(actor.id.as_str()) && actor.role.is_agent()
            }
            ActorRule::Originator => parties.originator == Some(actor.id.as_str()),
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct Rule<S: 'static, E: 'static> {
    pub from: S,
    pub event: E,
    pub to: S,
    pub actors: &'static [ActorRule],
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum TransitionError {
    #[error("{machine}: cannot transition from terminal state {state}")]
    Terminal {
        machine: &'static str,
        state: String,
    },
    #[error("{machine}: no transition for state={from} event={event}")]
    NoTransition {
        machine: &'static str,
        from: String,
        event: String,
    },
    #[error("{machine}: actor {actor_role}:{actor_id} may not perform {event} in state {from}")]
    ActorNotAllowed {
        machine: &'static str,
        from: String,
        event: String,
        actor_role: Role,
        actor_id: String,
    },
}

pub trait StateMachine {
    type State: Copy + Eq + fmt::Display + 'static;
    type Event: Copy + Eq + fmt::Display + 'static;
    const NAME: &'static str;
    const INITIAL: Self::State;
    const STATES: &'static [Self::State];
    const TERMINAL: &'static [Self::State];
    const RULES: &'static [Rule<Self::State, Self::Event>];

    fn is_terminal(s: Self::State) -> bool {
        Self::TERMINAL.contains(&s)
    }

    /// Validates a transition and returns the next state.
    fn transition(
        from: Self::State,
        event: Self::Event,
        actor: &Actor,
        parties: &Parties<'_>,
    ) -> Result<Self::State, TransitionError> {
        if Self::is_terminal(from) {
            return Err(TransitionError::Terminal {
                machine: Self::NAME,
                state: from.to_string(),
            });
        }
        let rule = Self::RULES
            .iter()
            .find(|r| r.from == from && r.event == event)
            .ok_or_else(|| TransitionError::NoTransition {
                machine: Self::NAME,
                from: from.to_string(),
                event: event.to_string(),
            })?;
        if rule.actors.iter().any(|a| a.allows(actor, parties)) {
            Ok(rule.to)
        } else {
            Err(TransitionError::ActorNotAllowed {
                machine: Self::NAME,
                from: from.to_string(),
                event: event.to_string(),
                actor_role: actor.role,
                actor_id: actor.id.clone(),
            })
        }
    }

    /// Events the actor may perform from `from`.
    fn possible(
        from: Self::State,
        actor: &Actor,
        parties: &Parties<'_>,
    ) -> Vec<(Self::Event, Self::State)> {
        if Self::is_terminal(from) {
            return Vec::new();
        }
        Self::RULES
            .iter()
            .filter(|r| r.from == from && r.actors.iter().any(|a| a.allows(actor, parties)))
            .map(|r| (r.event, r.to))
            .collect()
    }
}

macro_rules! string_enum {
    ($(#[$m:meta])* $name:ident { $($variant:ident => $s:literal),+ $(,)? }) => {
        $(#[$m])*
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
        pub enum $name { $(#[serde(rename = $s)] $variant),+ }
        impl $name {
            pub const ALL: &'static [$name] = &[$($name::$variant),+];
            pub fn as_str(self) -> &'static str { match self { $($name::$variant => $s),+ } }
        }
        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result { f.write_str(self.as_str()) }
        }
    };
}

string_enum!(ContentState {
    Idea => "idea",
    Planned => "planned",
    BriefCreated => "brief_created",
    Draft => "draft",
    InEditorialReview => "in_editorial_review",
    NeedsChanges => "needs_changes",
    Approved => "approved",
    Rejected => "rejected",
    Scheduled => "scheduled",
    Published => "published",
    Archived => "archived",
});

string_enum!(ContentEvent {
    TopicAccepted => "topic.accepted",
    BriefCreated => "brief.created",
    WriterStarted => "writer.started",
    SubmitForReview => "submit_for_review",
    RequestChanges => "request_changes",
    Approve => "approve",
    Reject => "reject",
    RevisionsApplied => "revisions_applied",
    ReadyForPublish => "ready_for_publish",
    DeploySuccess => "deploy_success",
    Retire => "retire",
});

string_enum!(TaskState {
    Planned => "planned",
    InProgress => "in_progress",
    Blocked => "blocked",
    Completed => "completed",
    Cancelled => "cancelled",
});

string_enum!(TaskEvent {
    AgentAccepts => "agent.accepts",
    Error => "error",
    Unblock => "unblock",
    Finish => "finish",
    Cancel => "cancel",
});

string_enum!(TicketState {
    Open => "open",
    Answered => "answered",
    Closed => "closed",
});

string_enum!(TicketEvent {
    AnswerProvided => "answer_provided",
    AgentAcknowledged => "agent_acknowledged",
    InvalidTicket => "invalid_ticket",
});

use ActorRule::{Assignee, Originator, Role as R};

pub struct ContentMachine;

impl StateMachine for ContentMachine {
    type State = ContentState;
    type Event = ContentEvent;
    const NAME: &'static str = "ContentItem";
    const INITIAL: ContentState = ContentState::Idea;
    const STATES: &'static [ContentState] = ContentState::ALL;
    const TERMINAL: &'static [ContentState] = &[ContentState::Archived, ContentState::Rejected];
    const RULES: &'static [Rule<ContentState, ContentEvent>] = {
        use ContentEvent as E;
        use ContentState as S;
        &[
            Rule {
                from: S::Idea,
                event: E::TopicAccepted,
                to: S::Planned,
                actors: &[R(Role::EditorInChief), R(Role::Ceo)],
            },
            Rule {
                from: S::Planned,
                event: E::BriefCreated,
                to: S::BriefCreated,
                actors: &[R(Role::Editor), R(Role::EditorInChief)],
            },
            Rule {
                from: S::BriefCreated,
                event: E::WriterStarted,
                to: S::Draft,
                actors: &[R(Role::Writer)],
            },
            Rule {
                from: S::Draft,
                event: E::SubmitForReview,
                to: S::InEditorialReview,
                actors: &[R(Role::Writer)],
            },
            // SimPress: the CEO may send a deadlocked piece back once more.
            Rule {
                from: S::InEditorialReview,
                event: E::RequestChanges,
                to: S::NeedsChanges,
                actors: &[R(Role::Editor), R(Role::Ceo)],
            },
            Rule {
                from: S::InEditorialReview,
                event: E::Approve,
                to: S::Approved,
                actors: &[R(Role::Editor), R(Role::Ceo)],
            },
            Rule {
                from: S::InEditorialReview,
                event: E::Reject,
                to: S::Rejected,
                actors: &[R(Role::Editor), R(Role::Ceo)],
            },
            Rule {
                from: S::NeedsChanges,
                event: E::RevisionsApplied,
                to: S::Draft,
                actors: &[R(Role::Writer)],
            },
            Rule {
                from: S::Approved,
                event: E::ReadyForPublish,
                to: S::Scheduled,
                actors: &[R(Role::Seo), R(Role::System)],
            },
            Rule {
                from: S::Scheduled,
                event: E::DeploySuccess,
                to: S::Published,
                actors: &[R(Role::System)],
            },
            Rule {
                from: S::Published,
                event: E::Retire,
                to: S::Archived,
                actors: &[R(Role::Ceo)],
            },
        ]
    };
}

pub struct TaskMachine;

impl StateMachine for TaskMachine {
    type State = TaskState;
    type Event = TaskEvent;
    const NAME: &'static str = "Task";
    const INITIAL: TaskState = TaskState::Planned;
    const STATES: &'static [TaskState] = TaskState::ALL;
    const TERMINAL: &'static [TaskState] = &[TaskState::Completed, TaskState::Cancelled];
    const RULES: &'static [Rule<TaskState, TaskEvent>] = {
        use TaskEvent as E;
        use TaskState as S;
        &[
            Rule {
                from: S::Planned,
                event: E::AgentAccepts,
                to: S::InProgress,
                actors: &[Assignee],
            },
            // SimPress: the orchestrator blocks a task when its job fails.
            Rule {
                from: S::InProgress,
                event: E::Error,
                to: S::Blocked,
                actors: &[Assignee, R(Role::System)],
            },
            Rule {
                from: S::Blocked,
                event: E::Unblock,
                to: S::InProgress,
                actors: &[Assignee, R(Role::EditorInChief)],
            },
            Rule {
                from: S::InProgress,
                event: E::Finish,
                to: S::Completed,
                actors: &[Assignee],
            },
            Rule {
                from: S::Planned,
                event: E::Cancel,
                to: S::Cancelled,
                actors: &[R(Role::Ceo), R(Role::EditorInChief)],
            },
            Rule {
                from: S::InProgress,
                event: E::Cancel,
                to: S::Cancelled,
                actors: &[R(Role::Ceo)],
            },
        ]
    };
}

pub struct TicketMachine;

impl StateMachine for TicketMachine {
    type State = TicketState;
    type Event = TicketEvent;
    const NAME: &'static str = "QuestionTicket";
    const INITIAL: TicketState = TicketState::Open;
    const STATES: &'static [TicketState] = TicketState::ALL;
    const TERMINAL: &'static [TicketState] = &[TicketState::Closed];
    const RULES: &'static [Rule<TicketState, TicketEvent>] = {
        use TicketEvent as E;
        use TicketState as S;
        &[
            // SimPress: System answers with the ticket's default option at its deadline.
            Rule {
                from: S::Open,
                event: E::AnswerProvided,
                to: S::Answered,
                actors: &[R(Role::Ceo), R(Role::EditorInChief), R(Role::System)],
            },
            Rule {
                from: S::Answered,
                event: E::AgentAcknowledged,
                to: S::Closed,
                actors: &[Originator, R(Role::Ceo)],
            },
            Rule {
                from: S::Open,
                event: E::InvalidTicket,
                to: S::Closed,
                actors: &[R(Role::Ceo)],
            },
        ]
    };
}

/// Shorthand for the content machine (no relational rules).
pub fn content_transition(
    from: ContentState,
    event: ContentEvent,
    actor: &Actor,
) -> Result<ContentState, TransitionError> {
    ContentMachine::transition(from, event, actor, &Parties::default())
}

pub fn task_transition(
    from: TaskState,
    event: TaskEvent,
    actor: &Actor,
    assignee: Option<&str>,
) -> Result<TaskState, TransitionError> {
    TaskMachine::transition(
        from,
        event,
        actor,
        &Parties {
            assignee,
            originator: None,
        },
    )
}

pub fn ticket_transition(
    from: TicketState,
    event: TicketEvent,
    actor: &Actor,
    originator: Option<&str>,
) -> Result<TicketState, TransitionError> {
    TicketMachine::transition(
        from,
        event,
        actor,
        &Parties {
            assignee: None,
            originator,
        },
    )
}

/// A transition the orchestrator should apply (state change first, then
/// side effects).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AppliedTransition {
    pub from: ContentState,
    pub event: ContentEvent,
    pub to: ContentState,
    pub actor: Role,
}
