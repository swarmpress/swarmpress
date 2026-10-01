---
id: FEAT-011
title: "Wire protocol and versioning"
status: in-progress
importance: high
paths:
  - "crates/protocol/**"
adrs:
  - ADR-0003
  - ADR-0025
---

# Wire protocol and versioning

postcard-encoded WebSocket frames: `Hello{proto_version}`, snapshots,
`ClientCommand`/`ServerCommand` with steps, hash checks, resnapshot requests, bubble references and
the browser job frames (`JobOffer`, `JobClaim`, `JobProgress`, `JobResult`, `JobFailed`).
`PROTO_VERSION` bumps on any breaking change. Exists today: `Hello` and encode/decode with a round-
trip test.

Decisions: [ADR-0003](../../adr/0003-deterministic-lockstep-server-authority.md), [ADR-0025](../../adr/0025-browser-job-worker-protocol.md).

## Acceptance criteria

- [ ] Every frame round-trips (unit tests).
- [ ] `insta` snapshots of encodings detect accidental wire changes.
- [ ] Version-compatibility tests: a client with an older `PROTO_VERSION` is refused with a clear error.
- [ ] `cargo-fuzz` on frame decoding runs nightly without crashes.

## Evidence

- `net/nextest` (`crates/protocol/src/lib.rs`)
