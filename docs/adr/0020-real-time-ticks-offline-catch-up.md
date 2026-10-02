# ADR-0020 — Real-time ticks and offline catch-up

**Status:** Superseded in part by [ADR-0038](0038-local-first-the-browser-is-authoritative-for-a-company.md) / [ADR-0039](0039-sqlite-is-the-central-database.md); amended by ADR-0048, ADR-0060
**Date:** 2026-10-01

## Context

The work in swarm.press is real: an LLM pipeline from brief to merged PR takes 10 to 40 minutes of
wall time, and a deploy takes minutes. The game clock must make that feel natural.

Players are offline most of the time, and the company has to keep running. A server can't afford
to step thousands of idle companies at 10 Hz, and players who return expect to see what happened
overnight.

## Decision

- **Real-time ticks.** One sim step is 100 ms of real time.
  - Live servers run `day_real_minutes = 60` (one game day per real hour), so a pipeline spans one
    to two game days. Local sandboxes default to 20.
  - There is no pause in multiplayer. The single-player sandbox may pause.
- **Day phases:**

  | Phase | Time |
  |---|---|
  | Night | 22:00–06:00 |
  | Arrival | 06:00–09:00 |
  | Standup | 09:00 |
  | Work | until lunch |
  | Lunch | midday |
  | Work | until 18:00 |
  | Evening / overtime | 18:00–22:00 |

- **Active companies** (a client connected, or jobs in flight) step at full rate in their actor.
- **Idle companies** are not stepped every tick. When an event is due, their actor wakes and
  **fast-forwards coarsely**:
  - It applies whole-step batches up to the next scheduled event: a job result, a ticket deadline,
    a day boundary, a meeting.
  - It uses the same deterministic `tick()`, so the result is identical to having stepped in real
    time.
  - Hashes still agree with replay.
- **Ticket defaults.** Each ticket has a `default_option` and a `deadline_step`, so an offline
  company never stalls waiting for the CEO.
- **Morning rush.** Browser-executed jobs queued while the player was away run when they
  reconnect ([ADR-0025](0025-browser-job-worker-protocol.md)).

Alternatives considered:

- **Turn-based or player-driven time.** Rejected. Real LLM latency doesn't fit discrete turns, and
  companies couldn't run offline.
- **Accelerated time with LLM jobs completing instantly in game time.** Rejected. It breaks the
  link between what you see and real work.
- **Stepping every company continuously.** Rejected. Wasteful, since cost scales with registered
  rather than active companies.

## Consequences

- Positive: watching the office feels live, and coming back shows a believable night and morning.
- Positive: server cost scales with activity.
- Negative: fast-forward must be fast. The `criterion` step benchmark and a load test (200
  companies, one simulated hour) guard it.
- Negative: day length is a world constant, and changing it for a live world needs a migration.
