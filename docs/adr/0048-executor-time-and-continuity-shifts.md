# ADR-0048 — Executor time and continuity shifts

**Status:** Accepted (amends ADR-0020, ADR-0038, ADR-0025, ADR-0027 and ADR-0036)
**Date:** 2026-10-02

## Context

ADR-0020 decided real-time ticks: one sim step is 100 ms of real time, one game day is one real
hour on live servers, and there is no pause. ADR-0038 then decided that "time away is replayed,
not simulated live": on reopen the browser fast-forwards to the wall-clock step, with a
deterministic fallback director (ADR-0036) standing in for decisions.

Neither is what the code does. The browser steps from a render-loop accumulator, so a hidden or
closed tab stops the sim. Restore replays to the last logged step and never to "now". There is
no wall-clock fast-forward and no fallback director. Nothing anchors game time to wall time.

Anchoring them would be costly either way:

- **Without a runner**, eight hours away is eight game days: eight payroll settlements and
  eight standups with nobody to run the jobs. Absence is punished and nothing is produced.
- **With a runner**, the same eight hours are eight standups of up to eight briefs each, and
  every staff job runs on a paid remote model because a container has no GPU. Spend is
  unbounded unless something else caps it.

The sim already behaves correctly when nobody answers: a standup times out after 60 game
minutes with no briefs, and every ticket has a `default_option` and a `deadline_step`. No
fallback director is needed for correctness.

We want the company to be able to do real work while the player is away, on the player's own
machine or as a managed service, and to replay to the same hash on any host.

## Decision

1. **Game time is executor time.** The world advances only while an executor (ADR-0045) works
   it. How far a host advances is policy, not state. Wall time never enters the command log:
   the log records `(seq, step, json)` only.

2. **Away without a runner, the company rests.** The current game day may finish; the world
   then stops at night. On return it resumes from where it stopped. No payroll is charged for
   days that were not played, and there is nothing to catch up.

3. **A runner works in bounded shifts.** A shift is one game day:
   1. restore from the last snapshot and log tail (ADR-0046);
   2. advance to the first effect;
   3. run jobs, holding the clock until each outcome arrives;
   4. stop at 22:00, seal and snapshot, release the lease.

   Pacing is a player setting: at most K game days per real day, and a spend limit for managed
   runs (ADR-0052). A run is also capped by wall time, job count and steps. On any cap it
   seals, records the next wake and releases.

4. **Wall-clock triggers wake a shift; they are not sim time.** Deploy events, analytics
   imports, context polling and scheduled publication happen at real times. They arrive through
   the events inbox and enter the sim as commands at the next step boundary, as they do today.

5. **Same hash on any host.** Browser, self-hosted runner and managed runner load the same wasm
   modules. The backup manifest records the sim build and the `SimConfig`; an executor refuses
   a mismatch. Day length is part of the hash, so it is fixed per company at founding.

6. **The continuity runner is the existing headless runner**, extended, not a second
   implementation:
   - the host-agnostic TypeScript moves from `apps/game/src` into a shared package
     (`packages/host`): replay, the orchestration loop, the sync uploader and segments, the
     company store and its driver interface, the central client, the orchestrator bridge
     adapters, and the restore and wiring of the session as an `Executor` class;
   - `packages/runner` gains a `continue` command, the full wasm command and effect exports,
     the orchestrator wasm, a store, a central client with a bearer runner token, and a remote
     model adapter;
   - extensions still run only in the QuickJS sandbox (rule 14).

7. **Self-hosted first, managed second.** A player can run the runner on their own machine or
   CI with their own model key. That path needs no billing, no scheduler and no process
   supervision, and it exercises the whole protocol. The managed runner (ADR-0049) follows.

8. **No silent substitution.** A runner never replaces a local model tier with a cloud model
   unless the player's mandate allows cloud model spend (ADR-0052, ADR-0053). Jobs that need
   the player's GPU wait for the player's return, as the "morning rush" of ADR-0025.

9. **What changes in earlier ADRs:**
   - ADR-0020: "real-time ticks, no pause" no longer holds across absence. A step is still
     100 ms while an executor runs.
   - ADR-0038: "time away is replayed" is replaced by decisions 2 and 3, and "one active
     device" becomes "one active executor". Its catch-up budget is moot (see ADR-0046).
   - ADR-0036: the offline fallback director is optional flavour. If built, it lives in
     sim-core on `World.rng` and needs no log entries.
   - ADR-0025 and ADR-0027: the offline queue remains the free path's mechanic. Job leases and
     re-queueing are replaced by the job ledger of ADR-0045.

Not built: the shared package, the `continue` command, runner tokens, the remote model adapter
and shifts. Increments A5 to A8 of the plan implement them.

## Consequences

- Absence is neutral on the free path and bounded on the paid one. A shift has a known maximum
  cost before it starts.
- The free and paid paths differ only in whether real work happened. Both produce ordinary
  command logs.
- The hardest unbuilt pieces of ADR-0038, wall-clock fast-forward and a wake predictor, are no
  longer needed. sim-core needs `advance_until_effect(max_steps)` and the snapshot calls.
- One runtime in three hosts keeps extension and sim parity testable with goldens.
- **Negative:**
  - The world no longer "lives" by itself. A player who returns after a week without a runner
    finds the same evening they left. The briefing's overnight timeline (19:00 campaign, 09:00
    meeting) only exists with a runner.
  - Game days per real day now differ between players. Anything that compares companies by
    game time has to account for it; leagues are decided in ADR-0055.
  - Real-world content that depends on the date (seasons, events) must come from wall-clock
    context, not from the game calendar.
  - Moving files into a shared package touches most of `apps/game/src` imports.
  - A managed runner makes every staff job a remote model call. Tokens dominate the bill;
    runner seconds are noise.
- **Unverified:** whether the in-memory SQLite driver runs cleanly under Bun; the step cost of
  the 13-person scenario.
- **Alternatives rejected:**
  - *Wall-clock time with fast-forward on return (ADR-0038 as written).* It needs a fallback
    director and a fast replay that do not exist, burns payroll for absent days, and leaves a
    runner facing one standup per real hour.
  - *Wall-clock time with a logged "away" policy* that suspends standups and payroll. It keeps
    ADR-0020 in name, but adds rules to the sim, still needs a wake predictor, and still burns
    game days.
  - *A separate server-side simulation.* ADR-0038 retired server actors; the runner is the same
    code as the browser, under a lease.
