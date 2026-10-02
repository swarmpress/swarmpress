---
id: FEAT-080
title: "Game time independent of GPU speed: clock hold and rest"
status: in-progress
importance: high
paths:
  - apps/game/src/session/clock-driver.ts
  - apps/game/src/session/clock-driver.test.ts
  - apps/game/src/session/tick-timer.ts
  - apps/game/src/session/tick-worker.ts
  - apps/game/src/session/session.ts
  - apps/game/src/orchestration/loop.ts
  - apps/game/src/orchestration/loop.test.ts
  - apps/game/src/orchestration/due-step.ts
  - apps/game/src/orchestration/due-step.test.ts
  - apps/game/src/orchestration/game-time.test.ts
  - apps/game/src/main.ts
  - apps/game/src/ui/hud.tsx
  - apps/game/src/ui/hud.css
  - apps/game/src/ui/hud.test.tsx
  - apps/game/src/ui/boot-screen.ts
  - apps/game/src/ui/boot-screen.css
  - apps/game/src/ui/boot-screen.test.ts
  - apps/game/e2e/mvp.spec.ts
  - crates/client-wasm/src/lib.rs
adrs:
  - ADR-0060
  - ADR-0048
  - ADR-0020
---

# Game time independent of GPU speed: clock hold and rest

Increment T of `docs/mvp.md`. Design:
[`docs/design/mvp-pipeline.md`](../../design/mvp-pipeline.md) section 6, with worked cases.

A real local model takes minutes per job, so game outcomes would depend on GPU speed if the
clock ran on. The clock is therefore host policy (`apps/game/src/session/clock-driver.ts`):
nothing of it is in the sim state or the command log.

- **Hold:** the clock holds while the loop is halted, the model is not ready, or a pending job
  is due. Every action costs exactly its phase minimum in game time.
  - `World::step()` increments the step and then completes the phases whose minimum-done step
    is reached. The clock therefore stops **one step short** of the due step
    (`sim.step() + 1 >= dueStep`): the outcome is applied at `due - 1` and the phase completes
    at `due`, as it does when the outcome arrived early. Holding at `due` itself would make a
    slow model cost one step more than a fast one.
- **Due steps:** behind `DueStepSource` (`apps/game/src/orchestration/due-step.ts`). The sim's
  view (`Sim.next_due_step()`, `dueStep` in `plan_json`, FEAT-079) is used when the wasm build
  exports it; until then the host derives the same numbers (`HostDueSteps`: request step plus
  draft 120, review 60, publish 15, standup 30 game minutes).
- **Clamp:** the accumulator never exceeds 500 ms, so a returning hidden tab never bursts.
- **Queue order:** earliest due step first, ties by job id.
- **Rest:** at or after 22:00 with no pending job and no queued command the day ends on a card;
  the next day starts on a click or while the "unattended days" counter (a setting, kept in the
  store's kv) is positive. The night is skipped by fast stepping to 07:00.
- **Hidden tab:** a 1 Hz timer in a dedicated worker ticks the clock (through the same clamp)
  when the render loop does not, so work in flight can finish; then the rest rule applies.
- **Other holds:** model download or GPU recovery (`setModelStatus`; the scripted `?llm=fake`
  model is ready), a halted loop.
- **HUD:** a status chip showing one of Running / Held / Resting / Model loading / Lease lost /
  Halted / Paused, pause and speed buttons, the day-done card, loop errors as a toast and a mark
  on the chip; a boot screen with the boot stages and a visible error state.
- **Job limits:** a wall-clock limit per job; a job past it is given up on and reported through
  the failure path. Cancelling the model call is increment P6.

Depends on: FEAT-079 for the `next_due_step` view (no sim state).

## Acceptance criteria

- [ ] `clock-driver` unit tests: clamp, hold, pause, speed, rest, night skip, unattended days.
- [ ] With fake latencies of 0 s, 60 s and 12 min a phase completes at the same step, and each
      log replays to its hash.
- [ ] Two queued drafts hold, then both advance.
- [ ] A simulated hidden tab produces no burst.
- [ ] The HUD chip shows each of its seven states.

## Evidence

- `game/vitest`
- `game/playwright-mvp`
