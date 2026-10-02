---
id: FEAT-080
title: "Game time independent of GPU speed: clock hold and rest"
status: planned
importance: high
paths:
  - apps/game/src/session/clock-driver.ts
  - apps/game/src/session/clock-driver.test.ts
  - apps/game/src/orchestration/loop.ts
  - apps/game/src/orchestration/loop.test.ts
  - apps/game/src/main.ts
  - apps/game/src/ui/hud.tsx
  - crates/client-wasm/src/lib.rs
adrs:
  - ADR-0060
  - ADR-0048
  - ADR-0020
---

# Game time independent of GPU speed: clock hold and rest

Increment T of `docs/mvp.md`. Design:
[`docs/design/mvp-pipeline.md`](../../design/mvp-pipeline.md) section 6, with worked cases.

Today only a pending standup holds the clock, the accumulator in `apps/game/src/main.ts` is
unclamped (a returning hidden tab runs every missed step in one burst), and jobs run first in,
first out. A real local model takes minutes per job, so game outcomes would depend on GPU speed.

- **Hold:** `holdClock` is `halted || modelNotReady || sim.step() >= sim.next_due_step()`. Every
  action costs exactly its phase minimum in game time. The hold is host policy, never sim state.
- **Clamp:** the accumulator never exceeds 500 ms.
- **Queue order:** earliest due step first, ties by job id.
- **Rest:** after 22:00 with nothing in flight the day ends on a card; the next day starts on a
  click or while an "unattended days" counter is positive.
- **Hidden tab:** a 1 Hz worker timer lets work in flight finish; then the rest rule applies.
- **Other holds:** model download, GPU recovery, a halted loop.
- **HUD:** a status chip (Running / Held / Resting / Model loading / Lease lost / Halted), pause
  and speed buttons, a boot screen.

Depends on: FEAT-079 for the `next_due_step` view (no sim state).

## Acceptance criteria

- [ ] `clock-driver` unit tests: clamp, hold, rest, night skip.
- [ ] With fake latencies of 0 s, 60 s and 12 min a phase completes at the same step, and each
      log replays to its hash.
- [ ] Two queued drafts hold, then both advance.
- [ ] A simulated hidden tab produces no burst.

## Evidence

- `game/vitest`
- `game/playwright-mvp`
