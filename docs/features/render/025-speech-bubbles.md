---
id: FEAT-025
title: "Speech bubbles"
status: planned
importance: normal
paths:
  - "apps/game/src/render/bubbles/**"
  - "apps/game/src/ui/bubbles/**"
  - apps/game/src/orchestration/loop.ts
  - crates/sim-core/src/render_state.rs
adrs:
  - ADR-0012
  - ADR-0018
  - ADR-0062
  - ADR-0059
---

# Speech bubbles

Bubbles anchored to speakers, timed by `Utterance.chars`, text fetched by reference and streamed
from `JobProgress` deltas; layout avoids overlaps.

Decisions: [ADR-0012](../../adr/0012-meetings-streamed-multi-agent-conversations.md), [ADR-0018](../../adr/0018-overlay-ui-in-preact.md).

## MVP: bubbles from meeting turns (ADR-0062; increment U5)

Design: [`docs/design/mvp-pipeline.md`](../../design/mvp-pipeline.md) section 2 ("Bubbles").

Nothing is built. The orchestrator appends a transcript row after each turn and reports it; the
loop applies an `Utterance` command at a step boundary while the meeting is open, and the outcome
last. The sim increment (ADR-0059) adds `speak_from`/`speak_chars` and the render-state `bubbles`
row. Text is fetched from `transcripts` by (job, seq), never from the sim. A Preact layer anchors
the bubble to the speaker with a client-side typewriter effect; streamed deltas are deferred.

## Acceptance criteria

- [ ] Bubble layout never overlaps for up to 8 simultaneous speakers (vitest).
- [ ] Bubble text is escaped and fetched by reference, never from the sim.

## Evidence

- `game/vitest`
