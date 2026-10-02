# ADR-0036 — A Day Director thread steers each day, within sim bounds

**Status:** Accepted
**Date:** 2026-10-01

## Context

Living personas (ADR-0034) and the real world (ADR-0035) provide rich material: histories,
relationships, holidays, weather and news. Deterministic rules alone produce an office that
ticks but doesn't tell a story. The product owner asked for one browser-LLM thread that steers
each day based on the personas, their history and their personality.

An LLM with direct control would break determinism and could override the CEO or the economy.

## Decision

- **One Day Director per company**, a dedicated browser-LLM thread on the leader tab (role
  `director`, the largest model the device tier allows). It runs at fixed points:
  - `DayPlan` at 07:00;
  - an hourly `DayTick`;
  - `DayReact` on notable events;
  - `DayRecap` at 22:00;
  - `WeekArcs` on Mondays.

  Its input is a bounded **DayDigest**: calendar and world, people with mood, schedule, top
  memories and today's traditions, relationship highlights, plan pressure, open arcs, and recent
  events.
- **It only proposes typed intents** (docs/game-design/day-director.md §3): small talk, social
  moments, small mood beats, work focus among already-assigned items, voluntary overtime,
  personal requests as tickets, spotlights, story-arc steps and narration.
- **Every intent is validated twice:** once in the client and once on the server, never trusting
  the client. Checks cover existence, per-type caps, grounding (it must cite digest facts by id)
  and civility. Valid intents are applied as a server-issued `DirectorIntents` sim command, so
  every replica stays identical.
- **Hard limits.** The director can't touch money, budgets, salaries, priorities, hiring, ticket
  answers or publishing. Story arcs come from a workplace-appropriate catalogue.
- **Everything is recorded** (digest, model, output, accepted and rejected intents, resulting
  commands), so every beat can be explained in the UI.
- **Offline:** a deterministic **fallback director** in the server actor uses the same intents
  and caps, without narration. The LLM director resumes with a "while you were away" recap.

## Consequences

- Days become authored and characterful at low cost: a few small structured calls per game day,
  scheduled around job runs.
- The intent catalogue and caps are the game-design surface for tuning how dramatic an office
  is. A per-company "drama" setting can scale the caps later.
- Quality depends on the device tier. Low tiers get a smaller director model, and the fallback
  rules keep a floor.
- Another validator surface (grounding and caps), which needs adversarial tests: invented people,
  excessive mood deltas, out-of-catalogue arcs, attempts to touch money.
