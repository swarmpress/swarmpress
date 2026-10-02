# ADR-0060 — Game time is independent of GPU speed

**Status:** Accepted (amends ADR-0048 and ADR-0020)
**Date:** 2026-10-02

## Context

One sim step is 100 ms and a local game day is twenty real minutes. The browser steps the sim
from a render-loop accumulator. A real local model takes tens of seconds to minutes per call
(ADR-0057), and one resident model serves every staff member in turn.

Today only a pending standup holds the clock. A draft that takes twelve real minutes spans most
of a game day; the next day's standup queues behind yesterday's work; a slower GPU changes what
the company achieves. The accumulator is unclamped, so returning to a hidden tab runs every
missed step in one synchronous burst: an hour away is three game days and three payrolls.

ADR-0048 decided that the clock advances only while an executor works the company. The concept
document adds the rule for a local model: assign game-time costs by action type, apply them when
an action commits, and pause the clock while downloading, recovering the GPU or waiting.

Detail: [`docs/design/mvp-pipeline.md`](../design/mvp-pipeline.md) section 6.

## Decision

1. **The clock holds while any pending job is due.** A work-item job is due when its phase
   minimum has elapsed; a standup thirty game minutes after it was requested. Every action then
   costs exactly its phase minimum in game time, on any GPU.
2. **The hold is host policy, never sim state.** The command log still records only
   `(seq, step, json)`; replay applies each outcome at its logged step.
3. **The accumulator is clamped.** A returning tab never bursts.
4. **Jobs run earliest-due first.**
5. **Rest.** After 22:00 with nothing in flight, the day ends on a card. The next day starts on
   a click, or automatically while an "unattended days" counter is positive. Deadlines burn only
   played time.
6. **Hidden tab.** A slow worker timer lets work in flight finish; then the rest rule applies.
   The game does not promise overnight operation in a browser tab.
7. **Other holds:** model download, GPU recovery and a halted loop. An open approval ticket does
   not hold the clock while other work is in flight.
8. **The player always sees the state:** running, held (with who is doing what), resting, model
   loading, lease lost, or halted; with pause and speed controls.
9. **Day length stays twenty real minutes.** It is part of the hash, and with holds a longer day
   only adds idle clock.

Nothing here is built. Increment T of `docs/mvp.md` implements it.

## Consequences

- Game outcomes do not depend on hardware. Two writers "work in parallel" in game time while the
  model serves them in turn.
- A game day's wall time is dominated by inference (estimated 40 to 70 minutes with two
  articles; unmeasured).
- **Negative:**
  - The office visibly pauses during long generations. The status chip and what-each-person-is
    doing labels explain it.
  - Runs with different latencies produce different logs and transient hashes, though the same
    state at each phase boundary. If identical logs across machines matter later, outcomes can
    be applied exactly at the due step.
  - Real-time ticks (ADR-0020) no longer hold in the browser: the clock is the executor's.
- **Alternatives rejected:**
  - *A longer game day.* It only adds idle time and still ties outcomes to speed.
  - *Letting slow jobs span game days.* A slower GPU would then publish less and miss deadlines.
  - *Applying game-time cost as a jump at commit.* The sim's phases already have minimum
    durations; holding at the due step reaches the same result without a new sim rule.
