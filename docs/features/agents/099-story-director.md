---
id: FEAT-099
title: "The story director"
status: in-progress
importance: medium
paths:
  - crates/sim-core/src/remarks.rs
  - crates/sim-core/tests/remarks.rs
  - apps/game/src/story/director.ts
  - apps/game/src/story/context.ts
  - apps/game/src/story/director.test.ts
  - apps/game/src/ui/bubbles/BubbleLayer.tsx
adrs:
  - ADR-0074
  - ADR-0067
  - ADR-0062
---

# The story director

Studio life between meetings ([ADR-0074](../../adr/0074-the-story-director.md)). Every ten
minutes of running clock, the hosted model writes a chapter of short scenes between the people on
site, grounded in the plan. The host plays it as remarks: speech bubbles outside meetings. The
words stay in the company store's kv, never in the sim.

## Built

- **Sim:** `ServerCommand::Remark{speaker, listener, seq, chars}`. The sim checks that it is the
  next seq, 1..=600 characters, and that both people are on site and not in a meeting. A remark
  sets the talk and listen poses and adds a `remarks[]` entry to the render state; world format 6.
  Test: `crates/sim-core/tests/remarks.rs`.
- **Host:** `apps/game/src/story/`.
  - The chapter prompt and schema.
  - Validation: known people only, plain short lines, no production claims the events don't
    back.
  - Prefetch at 420 seconds, and quiet when a chapter is late.
  - Playback that ends a scene the sim refuses, and persistence across reloads.
  - Remark bubbles in the bubble layer, and the fake model's chapter.
  - Test: `apps/game/src/story/director.test.ts`.
- On by default with the hosted model; `?story=on|off` overrides it.

## Not built

- Per-scene conditions, references and fallbacks.
- Player interactions.
- Real-world events.
- A dedicated studio event stream.
- A lead time measured from latency.
- The Flex service tier.
