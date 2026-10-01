//! Wire protocol between the SimPress server and browser client.
//! Frames are postcard-encoded; bump [`PROTO_VERSION`] on any breaking change.
//!
//! Command types are defined in `sim-core` (the sim must apply them) and
//! re-exported here so every wire user depends on one definition.

#![forbid(unsafe_code)]

use serde::{Deserialize, Serialize};

pub use sim_core::commands::{
    AutonomyPolicy, Command, DemolishTarget, Input, JobDigest, OvertimePolicy, Placement, Policy,
    ServerCommand, SiteSignals,
};
pub use sim_core::inbox::{DelegationPolicy, FollowUpTopic, SecretaryTaskKind, TicketOption};
pub use sim_core::projects::ProjectStatus;
pub use sim_core::roles::{Department, Role};

/// v3: organization commands (projects, staffing, Inbox, delegation),
/// `ServerCommand::AnalyticsSignals`, the extended `Role` set.
/// v2: command frames (M1 sim commands).
pub const PROTO_VERSION: u16 = 3;

/// First frame the server sends after a client connects.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Hello {
    pub proto_version: u16,
    pub server_version: String,
}

/// An input stamped with its place in the authoritative order. Replicas
/// `World::enqueue(step, seq, input)` it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Stamped {
    pub step: u64,
    pub seq: u32,
    pub input: Input,
}

/// Client → server.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum ClientFrame {
    /// A player command; the server validates, stamps and broadcasts it.
    /// Clients may never send [`ServerCommand`]s.
    Command { client_seq: u32, command: Command },
    /// Periodic lockstep check.
    Hash { step: u64, hash: u64 },
}

/// Server → client.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum ServerFrame {
    Hello(Hello),
    /// Inputs to apply, in order.
    Inputs(Vec<Stamped>),
    /// The server is at `step`; replicas may simulate up to it.
    Advance {
        step: u64,
    },
    /// A client command was refused (reason for display).
    Rejected {
        client_seq: u32,
        reason: String,
    },
}

pub fn encode<T: Serialize>(value: &T) -> Result<Vec<u8>, postcard::Error> {
    postcard::to_allocvec(value)
}

pub fn decode<'a, T: Deserialize<'a>>(bytes: &'a [u8]) -> Result<T, postcard::Error> {
    postcard::from_bytes(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sim_core::ids::{MeetingId, ProjectId, StaffId, TicketId};

    #[test]
    fn hello_round_trips() {
        let hello = Hello {
            proto_version: PROTO_VERSION,
            server_version: "0.2.0".into(),
        };
        let bytes = encode(&hello).unwrap();
        assert_eq!(decode::<Hello>(&bytes).unwrap(), hello);
    }

    #[test]
    fn frames_round_trip() {
        let frames = vec![
            ServerFrame::Inputs(vec![
                Stamped {
                    step: 10,
                    seq: 0,
                    input: Input::Player(Command::SetPolicy(Policy::QualityBar(8))),
                },
                Stamped {
                    step: 10,
                    seq: 1,
                    input: Input::Server(ServerCommand::Utterance {
                        meeting: MeetingId(1),
                        seq: 0,
                        speaker: StaffId(2),
                        chars: 64,
                    }),
                },
            ]),
            ServerFrame::Advance { step: 11 },
            ServerFrame::Rejected {
                client_seq: 3,
                reason: "not enough cash".into(),
            },
        ];
        for f in frames {
            assert_eq!(decode::<ServerFrame>(&encode(&f).unwrap()).unwrap(), f);
        }
        let c = ClientFrame::Command {
            client_seq: 1,
            command: Command::Fire { staff: StaffId(4) },
        };
        assert_eq!(decode::<ClientFrame>(&encode(&c).unwrap()).unwrap(), c);
        let org = [
            Command::AssignToProject {
                staff: StaffId(1),
                project: ProjectId(1),
                allocation_pct: 60,
            },
            Command::AnswerTicket {
                ticket: TicketId(2),
                option: TicketOption::ArrangeHiring,
            },
            Command::Delegate {
                task: SecretaryTaskKind::ArrangeHiring {
                    role: Role::Photographer,
                    project: Some(ProjectId(1)),
                },
            },
            Command::SetDelegation {
                policy: DelegationPolicy::LowAndMedium,
            },
        ];
        for command in org {
            let c = ClientFrame::Command {
                client_seq: 2,
                command,
            };
            assert_eq!(decode::<ClientFrame>(&encode(&c).unwrap()).unwrap(), c);
        }
        let a = ServerFrame::Inputs(vec![Stamped {
            step: 99,
            seq: 0,
            input: Input::Server(ServerCommand::AnalyticsSignals {
                project: ProjectId(1),
                day: 2,
                sessions: 10,
                visitors: 8,
                pageviews: 30,
                engagement_pm: 500,
                top_pages_digest: 1,
            }),
        }]);
        assert_eq!(decode::<ServerFrame>(&encode(&a).unwrap()).unwrap(), a);
    }

    #[test]
    fn stamped_inputs_replay_into_a_world() {
        let mut w = sim_core::scenarios::demo_office(1);
        let s = Stamped {
            step: 3,
            seq: 0,
            input: Input::Player(Command::SetPolicy(Policy::Overtime(OvertimePolicy::Never))),
        };
        let s: Stamped = decode(&encode(&s).unwrap()).unwrap();
        w.enqueue(s.step, s.seq, s.input).unwrap();
        for _ in 0..4 {
            w.step();
        }
        assert_eq!(w.company.policies.overtime, OvertimePolicy::Never);
    }
}
