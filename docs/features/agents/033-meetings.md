---
id: FEAT-033
title: "Meetings"
status: planned
importance: high
paths:
  - "crates/agents/src/meetings/**"
  - crates/sim-core/src/meetings.rs
  - "crates/server/src/meetings/**"
adrs:
  - ADR-0012
---

# Meetings

Standup, pitch and design-crit meetings: moderator picks speakers, each turn a streamed call in
persona, `Cmd::Utterance` into the sim, transcripts in Postgres, structured outcomes.

Decisions: [ADR-0012](../../adr/0012-meetings-streamed-multi-agent-conversations.md).

## Acceptance criteria

- [ ] Moderator is deterministic for a given agenda and transcript.
- [ ] Outcome JSON validates; pitches above threshold become CEO tickets.
- [ ] Transcript text never enters the world hash.

## Evidence

- `agents/nextest`
- `server/nextest`
