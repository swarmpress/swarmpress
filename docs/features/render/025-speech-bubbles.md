---
id: FEAT-025
title: "Speech bubbles"
status: planned
importance: normal
paths:
  - "apps/game/src/render/bubbles/**"
  - "apps/game/src/ui/bubbles/**"
adrs:
  - ADR-0012
  - ADR-0018
---

# Speech bubbles

Bubbles anchored to speakers, timed by `Utterance.chars`, text fetched by reference and streamed
from `JobProgress` deltas; layout avoids overlaps.

Decisions: [ADR-0012](../../adr/0012-meetings-streamed-multi-agent-conversations.md), [ADR-0018](../../adr/0018-overlay-ui-in-preact.md).

## Acceptance criteria

- [ ] Bubble layout never overlaps for up to 8 simultaneous speakers (vitest).
- [ ] Bubble text is escaped and fetched by reference, never from the sim.

## Evidence

- `game/vitest`
