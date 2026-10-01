# ADR-0003 — Deterministic lockstep with server authority, command log and snapshots

**Status:** Accepted
**Date:** 2026-10-01

## Context

A company is shared state, changed by the player's browsers, the server's agent runtime and the
GitHub webhooks. Several tabs or devices may watch the same company, and companies run 24/7 while
nobody watches.

The browser must render a smooth 10 Hz simulation with interpolation, but it must never decide
gameplay facts such as cash, scores or publish results.

Two obvious designs fail here:
- Shipping full world state every tick is wasteful: hundreds of staff positions, paths and
  devices.
- Pure client authority can't be trusted, because the leaderboard is competitive.

## Decision

- **Authority.** The server runs the authoritative `sim-core::World` for each company inside a
  tokio actor, at a fixed 100 ms step.
- **Commands.** Every state change is a command (`Cmd`) with a step number.
  - Player input arrives as a `ClientCommand`. It is validated by the same `validate_command`
    the client runs, then either scheduled for a future step or rejected.
  - Server-originated facts (`JobCompleted`, `SiteSignals`, `DeployLanded`, `Utterance`) are
    `ServerCommand`s.
- **Command log and snapshots.** The ordered command list is appended to an event-sourced command
  log in Postgres. A snapshot (the postcard-encoded `World`) is written at least daily, at the
  00:00 settlement, so replay stays bounded.
- **Lockstep.** Clients receive a snapshot when they join, then the stream of commands, and apply
  them to their wasm replica at the same steps.
- **Hash checks.** Every N steps (default 50, or 5 s), the server sends `World::hash` (xxh3 over
  postcard).
  - On a mismatch, the client requests a resnapshot.
  - A desync is logged with both hashes and the last 500 commands, for diagnosis.
- **Nondeterministic inputs** (LLM text, wall-clock time, GitHub) never enter the sim directly.
  They enter as server commands carrying small digests.

Alternatives considered:

- **State streaming (the server sends deltas).** Rejected. Bandwidth scales with entity count and
  frame rate, and offline replay and golden tests are harder to express.
- **Client authority with a server audit.** Rejected. It invites cheating on the leaderboard and
  races between tabs.
- **CRDTs.** Rejected. Gameplay rules are invariants, not mergeable data: cash can't go negative
  without a loan ticket, and rooms have a fixed number of seats.

## Consequences

- Positive: bandwidth is tiny (commands plus periodic hashes). Replay, time-travel debugging and
  offline catch-up all fall out of the command log.
- Positive: determinism is testable. A scripted 50k-step log must hash identically natively and
  in wasm.
- Negative: every sim change must stay deterministic forever. `sim-core` bans:
  - floats;
  - `HashMap` iteration;
  - system time;
  - unordered parallelism.

  Clippy lints and review enforce this.
- Negative: a protocol or sim change that alters hashes invalidates stored snapshots. Snapshots
  carry a sim version, and old ones are either re-derived by replay or migrated explicitly.
- Negative: authoritative effects cost one round trip of input latency. The client may show
  optimistic previews (ghost furniture) that the server command then confirms.
