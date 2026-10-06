//! World snapshots (ADR-0046, FEAT-060): the whole [`World`] as bytes, so a
//! restore costs the commands logged after the snapshot instead of a replay
//! from the seed.
//!
//! Layout (little endian), [`HEADER_LEN`] bytes of header and then the body:
//!
//! ```text
//! 0   magic            4  b"SPWS"
//! 4   snapshot format  2  SNAPSHOT_FORMAT
//! 6   world format     4  WORLD_FORMAT (the "sim build" the body was written by)
//! 10  day_real_minutes 8  SimConfig
//! 18  start_minute     8  SimConfig
//! 26  step             8  World::step
//! 34  hash             8  World::hash
//! 42  body                postcard(World), the bytes World::hash is taken over
//! ```
//!
//! The body is exactly what [`World::hash`] hashes, so the header's hash
//! checks the bytes before they are decoded, and the decoded world must hash
//! to the same value again. postcard is not self-describing: a body written
//! by another world layout decodes to garbage or not at all, which is why the
//! world format is checked first.
//!
//! Effects are an outbox, not state (`World.effects` is skipped by serde). A
//! restored world therefore starts with none; [`World::reissue_pending_jobs`]
//! rebuilds the requests of the jobs the sim still waits for.

use thiserror::Error;

use crate::clock::SimConfig;
use crate::world::World;

/// First bytes of every snapshot.
pub const SNAPSHOT_MAGIC: [u8; 4] = *b"SPWS";
/// Version of the header layout above.
pub const SNAPSHOT_FORMAT: u16 = 1;
/// Version of the world's encoding and step rules: the "sim build" a snapshot
/// belongs to. **Bump it by one whenever the golden hash changes** (a field
/// added to the world, a rule changed): snapshots of the older build are then
/// refused instead of being decoded into a wrong world. This line is the only
/// change needed in `src`; `tests/snapshot.rs`
/// (`world_format_names_the_current_world`) fails until it is done and says
/// what else to update.
///
/// - 1: the first snapshot format (FEAT-060).
/// - 2: the publish gate and the failure commands (FEAT-079, ADR-0059):
///   `Meeting.speak_from/speak_chars`, `Ticket.failure`,
///   `WorkItem.escalations`, new ticket kinds and options, and new rules (a
///   standup nobody answers raises a ticket; a passing review parks the item
///   under `ApproveAll`).
pub const WORLD_FORMAT: u32 = 4;
/// Bytes before the body.
pub const HEADER_LEN: usize = 42;

/// Why a snapshot was refused. Nothing is restored on any of them.
#[derive(Clone, Debug, PartialEq, Eq, Error)]
pub enum SnapshotError {
    #[error("the snapshot is truncated ({0} bytes, the header alone is {HEADER_LEN})")]
    Truncated(usize),
    #[error("not a world snapshot (bad magic)")]
    BadMagic,
    #[error("snapshot format {found} is not supported (this build reads {SNAPSHOT_FORMAT})")]
    Format { found: u16 },
    #[error("the snapshot was written by sim build {found}, this is sim build {expected}")]
    Build { found: u32, expected: u32 },
    #[error("the snapshot's config ({found:?}) is not the expected one ({expected:?})")]
    Config {
        found: SimConfig,
        expected: SimConfig,
    },
    #[error("the snapshot is corrupt: its bytes hash to {found:#018x}, the header says {expected:#018x}")]
    Hash { found: u64, expected: u64 },
    #[error("the snapshot's world does not decode: {0}")]
    Decode(String),
    #[error("the snapshot's header does not describe its world ({0})")]
    Inconsistent(&'static str),
}

/// What a snapshot says about itself, readable without decoding the world.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SnapshotHeader {
    pub format: u16,
    pub world_format: u32,
    pub config: SimConfig,
    pub step: u64,
    pub hash: u64,
}

fn u64_at(bytes: &[u8], at: usize) -> u64 {
    let mut b = [0u8; 8];
    b.copy_from_slice(&bytes[at..at + 8]);
    u64::from_le_bytes(b)
}

impl SnapshotHeader {
    /// Reads the header. Checks the length and the magic only; the versions
    /// are for the caller (or [`World::from_snapshot`]) to judge.
    pub fn parse(bytes: &[u8]) -> Result<SnapshotHeader, SnapshotError> {
        if bytes.len() < HEADER_LEN {
            return Err(SnapshotError::Truncated(bytes.len()));
        }
        if bytes[0..4] != SNAPSHOT_MAGIC {
            return Err(SnapshotError::BadMagic);
        }
        Ok(SnapshotHeader {
            format: u16::from_le_bytes([bytes[4], bytes[5]]),
            world_format: u32::from_le_bytes([bytes[6], bytes[7], bytes[8], bytes[9]]),
            config: SimConfig {
                day_real_minutes: u64_at(bytes, 10),
                start_minute: u64_at(bytes, 18),
            },
            step: u64_at(bytes, 26),
            hash: u64_at(bytes, 34),
        })
    }
}

impl World {
    /// The whole world as bytes (see the module docs for the layout). Pending
    /// effects are not included.
    pub fn snapshot(&self) -> Vec<u8> {
        let body = postcard::to_allocvec(self).expect("world serializes");
        let hash = xxhash_rust::xxh3::xxh3_64(&body);
        let mut out = Vec::with_capacity(HEADER_LEN + body.len());
        out.extend_from_slice(&SNAPSHOT_MAGIC);
        out.extend_from_slice(&SNAPSHOT_FORMAT.to_le_bytes());
        out.extend_from_slice(&WORLD_FORMAT.to_le_bytes());
        out.extend_from_slice(&self.config.day_real_minutes.to_le_bytes());
        out.extend_from_slice(&self.config.start_minute.to_le_bytes());
        out.extend_from_slice(&self.step.to_le_bytes());
        out.extend_from_slice(&hash.to_le_bytes());
        debug_assert_eq!(out.len(), HEADER_LEN);
        out.extend_from_slice(&body);
        out
    }

    /// Rebuilds a world from [`World::snapshot`] bytes. Refuses another
    /// snapshot or world format, a config other than `expect` (when given),
    /// bytes that do not hash to the header's hash, and a world that does not
    /// hash back to it. The restored world has no pending effects: call
    /// [`World::reissue_pending_jobs`] to get the open job requests back.
    pub fn from_snapshot(bytes: &[u8], expect: Option<&SimConfig>) -> Result<World, SnapshotError> {
        let header = SnapshotHeader::parse(bytes)?;
        if header.format != SNAPSHOT_FORMAT {
            return Err(SnapshotError::Format {
                found: header.format,
            });
        }
        if header.world_format != WORLD_FORMAT {
            return Err(SnapshotError::Build {
                found: header.world_format,
                expected: WORLD_FORMAT,
            });
        }
        if let Some(expected) = expect {
            if &header.config != expected {
                return Err(SnapshotError::Config {
                    found: header.config,
                    expected: expected.clone(),
                });
            }
        }
        let body = &bytes[HEADER_LEN..];
        let found = xxhash_rust::xxh3::xxh3_64(body);
        if found != header.hash {
            return Err(SnapshotError::Hash {
                found,
                expected: header.hash,
            });
        }
        let (world, rest): (World, &[u8]) =
            postcard::take_from_bytes(body).map_err(|e| SnapshotError::Decode(e.to_string()))?;
        if !rest.is_empty() {
            return Err(SnapshotError::Decode(format!(
                "{} bytes after the world",
                rest.len()
            )));
        }
        if world.config != header.config {
            return Err(SnapshotError::Inconsistent("config"));
        }
        if world.step != header.step {
            return Err(SnapshotError::Inconsistent("step"));
        }
        // The decoded world must encode to the same bytes again: a body that
        // decodes but is not what this build would write is another build's.
        let again = world.hash();
        if again != header.hash {
            return Err(SnapshotError::Hash {
                found: again,
                expected: header.hash,
            });
        }
        Ok(world)
    }
}
