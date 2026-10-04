---
id: FEAT-033
title: "Meetings"
status: in-progress
importance: high
paths:
  - crates/agents/src/meetings.rs
  - "crates/agents/tests/meeting*.rs"
  - crates/orchestrator/src/run.rs
  - crates/orchestrator/src/standup.rs
  - crates/orchestrator/tests/standup.rs
  - crates/agents/src/fake_writer.rs
  - apps/game/src/llm/mvp-script.ts
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

What exists today (P4): the standup is the pitch round in `crates/orchestrator/src/standup.rs`, with
its pure parts (cap, schemas, prompts, `trim_to_sentence`) in `crates/agents/src/meetings.rs`; both
fakes (`agents::fake_writer`, `mvp-script.ts`) answer it. Every stage is stored, so a re-run repeats
no call; every turn is a transcript row followed by a `turn` progress event (FEAT-025 plays it as a
speech bubble). `run_meeting` (ADR-0012's moderated meeting) remains for a faster tier; its callback
has no `Send` bound. Transcripts live in the browser store, not Postgres.

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

- `agents/nextest` (includes the `orchestrator` crate: `crates/orchestrator/tests/standup.rs`)
- `orchestrator-wasm/bun-test`
- `server/nextest`
