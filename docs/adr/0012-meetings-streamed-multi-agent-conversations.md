# ADR-0012 — Meetings as streamed multi-agent conversations with persisted transcripts

**Status:** Accepted
**Date:** 2026-10-01

## Context

Meetings are the most visible thing the staff do. The 09:00 standup, pitch meetings and design
crits play out as speech bubbles in the MeetingRoom, and they produce the project backlog.

A single LLM call that writes a whole meeting script reads like theatre and hides who decided
what. Meeting text is also large and nondeterministic, so it can't live in the sim state that
lockstep hashes.

## Decision

- **Turn taking.** Each turn is its own LLM call, made in the speaker's persona with the
  transcript so far.
  - A deterministic **moderator** (the EiC role, or rules in `crates/agents/src/meetings/`) picks
    the next speaker. It uses the agenda, who hasn't spoken, and mentions.
  - The meeting ends when the agenda is covered or a turn limit is reached.
- **Streaming.** Turns stream token deltas (`JobProgress`) straight into bubbles and the newsroom
  feed.
- **Into the sim, only the shape enters:** `Cmd::Utterance{meeting, seq, speaker, chars}`.
  - `chars` sets bubble duration.
  - The speaker poses Talk, and listeners pose Listen.
- **Transcripts** persist in Postgres (`meeting_utterances`). Clients fetch them by reference with
  `GET /companies/:id/meetings/:mid/utterances/:seq`. They stay out of the world hash.
- **The closing turn is a structured outcome** (JSON Schema): accepted pitches, assigned owners,
  deadlines, risks. Pitches above a cost or risk threshold become CEO tickets.
- With hybrid inference ([ADR-0024](0024-hybrid-inference-browser-llms-and-claude.md)), meeting
  turns are `Browser` jobs on the local model. Without a capable browser, they queue or fall back
  to the Chatter role on Claude, per policy.

Alternatives considered:

- **One call that generates the whole meeting.** Rejected. It has no real perspective per persona
  and no streaming per speaker, and the result feels scripted.
- **Free-running agent chat.** Rejected. It is unbounded in cost and time and nondeterministic in
  length. The moderator bounds it.
- **Storing text in the sim.** Rejected. It would bloat snapshots and hashes and make replay
  depend on LLM output.

## Consequences

- Positive: players watch real conversations unfold and can read the full transcripts.
- Positive: outcomes are structured data that the orchestrator acts on
  ([ADR-0011](0011-orchestrator-owns-state-transitions.md)).
- Negative: N turns means N calls, which costs more latency and money than one call.
  Prompt-caching the shared prefix offsets part of that.
- Negative: replaying a company recreates bubble timing but not the text. Text comes from storage.
