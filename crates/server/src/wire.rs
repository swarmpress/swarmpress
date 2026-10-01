//! Server-side WebSocket frames (postcard, binary messages).
//!
//! These live in the server crate until the shared `protocol` crate absorbs
//! them; the version field reuses [`protocol::PROTO_VERSION`].
//!
//! ## Lockstep contract
//! - `Hello`/`Resnapshot` carry a snapshot of the world at `step`. The snapshot
//!   already includes the commands of `step` with `seq < next_seq`.
//! - `Commands { from_step, to_step, entries }`: the client may advance from
//!   `from_step` to `to_step`. Before stepping out of step `t` it applies every
//!   entry with `entry.step == t` in `seq` order (skipping those already in its
//!   snapshot per `next_seq`).
//! - `Hash { step, h }`: hash of the world right after stepping into `step`,
//!   before that step's commands are applied. Clients may report their own
//!   hash with `ClientFrame::HashReport`; a mismatch triggers `Resnapshot`.
//!
//! JSON values (job payloads, artifacts) travel as JSON text because postcard
//! is not self-describing.

use serde::{Deserialize, Serialize};

/// One accepted player command in the authoritative log.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CommandEntry {
    pub step: u64,
    pub seq: u32,
    pub payload: Vec<u8>,
}

/// Server → client.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum ServerFrame {
    Hello {
        proto_version: u16,
        server_version: String,
        company_id: String,
        step: u64,
        next_seq: u32,
        snapshot: Vec<u8>,
    },
    Commands {
        from_step: u64,
        to_step: u64,
        entries: Vec<CommandEntry>,
    },
    Hash {
        step: u64,
        h: u64,
    },
    /// Full resync (desync detected, or the client fell behind the stream).
    Resnapshot {
        step: u64,
        next_seq: u32,
        snapshot: Vec<u8>,
    },
    /// `Cmd` accepted and logged; it executes at (`step`, `seq`).
    Ack {
        client_seq: u32,
        step: u64,
        seq: u32,
    },
    Reject {
        client_seq: u32,
        reason: String,
    },
    /// A browser job this connection may claim (sent only after `WorkerHello`).
    JobOffer {
        job_id: String,
        kind: String,
        min_tier: u8,
        priority: i32,
        attempt: u32,
        payload_json: String,
    },
    /// The lease the worker holds on a job (on claim and on every extension).
    /// `until_ms` is unix epoch milliseconds.
    JobLease {
        job_id: String,
        until_ms: i64,
    },
    /// The job is no longer this worker's (claim lost, lease expired, etc.).
    JobRevoked {
        job_id: String,
        reason: String,
    },
    /// The artifact was validated and stored.
    JobAccepted {
        job_id: String,
    },
    /// The artifact failed validation; the job was re-queued or is dead.
    JobRejected {
        job_id: String,
        reason: String,
    },
    Error {
        message: String,
    },
}

/// Client → server.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum ClientFrame {
    Cmd {
        client_seq: u32,
        payload: Vec<u8>,
    },
    HashReport {
        step: u64,
        h: u64,
    },
    RequestResnapshot,
    /// This tab is the company's elected job worker at device tier `tier`.
    WorkerHello {
        tier: u8,
    },
    JobClaim {
        job_id: String,
    },
    /// Streamed token delta; also extends the lease.
    JobProgress {
        job_id: String,
        delta: String,
    },
    JobResult {
        job_id: String,
        artifact_json: String,
    },
    JobFailed {
        job_id: String,
        error: String,
    },
}

pub fn encode<T: Serialize>(frame: &T) -> Vec<u8> {
    postcard::to_allocvec(frame).expect("frames always serialize")
}

pub fn decode<'a, T: Deserialize<'a>>(bytes: &'a [u8]) -> Result<T, postcard::Error> {
    postcard::from_bytes(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frames_round_trip() {
        let frames = vec![
            ServerFrame::Hello {
                proto_version: protocol::PROTO_VERSION,
                server_version: "x".into(),
                company_id: "c".into(),
                step: 9,
                next_seq: 2,
                snapshot: vec![1, 2, 3],
            },
            ServerFrame::Commands {
                from_step: 1,
                to_step: 3,
                entries: vec![CommandEntry {
                    step: 1,
                    seq: 0,
                    payload: b"hi".to_vec(),
                }],
            },
            ServerFrame::Hash {
                step: 600,
                h: u64::MAX,
            },
            ServerFrame::JobLease {
                job_id: "j".into(),
                until_ms: -5,
            },
        ];
        for f in frames {
            assert_eq!(decode::<ServerFrame>(&encode(&f)).unwrap(), f);
        }
        let c = ClientFrame::JobResult {
            job_id: "j".into(),
            artifact_json: "{\"a\":1}".into(),
        };
        assert_eq!(decode::<ClientFrame>(&encode(&c)).unwrap(), c);
    }

    #[test]
    fn garbage_does_not_panic() {
        assert!(decode::<ClientFrame>(&[0xff, 0xff, 0xff]).is_err());
        assert!(decode::<ClientFrame>(&[]).is_err());
    }
}
