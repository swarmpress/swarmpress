---
id: FEAT-033
title: "Meetings"
status: planned
importance: high
paths:
  - crates/agents/src/meetings.rs
  - "crates/agents/tests/meeting*.rs"
  - crates/orchestrator/src/run.rs
  - crates/agents/prompts/editor_in_chief.md
  - crates/agents/prompts/meeting_speaker.md
adrs:
  - ADR-0012
  - ADR-0062
  - ADR-0059
---

# Meetings

Standup, pitch and design-crit meetings: moderator picks speakers, each turn a streamed call in
persona, `Cmd::Utterance` into the sim, transcripts in Postgres, structured outcomes.

Decisions: [ADR-0012](../../adr/0012-meetings-streamed-multi-agent-conversations.md).

## MVP: the pitch round (ADR-0062)

Design: [`docs/design/mvp-pipeline.md`](../../design/mvp-pipeline.md) section 2.

What exists today: `run_meeting` in `crates/agents/src/meetings.rs` (moderator rounds, speaker turns,
an outcome call) and the standup job in the orchestrator; transcripts live in the browser store, not
Postgres. A truncated speaker or a moderator slip fails the whole meeting and the day silently gets
no briefs. The code exists; the status stays `planned` until P4 lands with its evidence.

- **P4:** `run_pitch_round`: a deterministic cap; one opening; one structured pitch per free
  writer; one commissioning call. Context pack from the knowledge pack and the plan. Topic
  de-duplication. Slips are repaired or skipped. Total failure sends `JobFailed` and raises a
  `StandupFailed` ticket (ADR-0059).

MVP acceptance: a truncated speaker still yields a brief; a duplicate pitch is repaired then
dropped; a cap of 0 makes zero model calls; a failed commissioning call falls back to the first
valid pitches.

## Acceptance criteria

- [ ] Moderator is deterministic for a given agenda and transcript.
- [ ] Outcome JSON validates; pitches above threshold become CEO tickets.
- [ ] Transcript text never enters the world hash.

## Evidence

- `agents/nextest`
- `server/nextest`
