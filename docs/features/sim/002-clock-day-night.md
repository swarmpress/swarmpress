---
id: FEAT-002
title: "Sim clock, day phases and day/night"
status: in-progress
importance: high
paths:
  - crates/sim-core/src/lib.rs
  - crates/sim-core/src/clock.rs
  - apps/game/src/render/daylight.ts
  - apps/game/src/render/daylight.test.ts
adrs:
  - ADR-0006
  - ADR-0020
---

# Sim clock, day phases and day/night

Integer clock derived from the step counter: `minute = start + step × 1440 / steps_per_day`,
`day_real_minutes` configurable (60 on live servers, 20 in sandboxes). Day phases (Night 22–06,
Arrival 06–09, Standup 09:00, Work, Lunch, Work, Evening/overtime 18–22) gate staff behaviour. The
renderer's pure `daylight(minute)` model turns the sim minute into sun/moon, sky and clear colours.
Exists today: `World::clock()` with tests and `daylight.ts` with tests; phases and the sim-side
sun/sky fields in render state are planned.

Decisions: [ADR-0006](../../adr/0006-baked-gi-dynamic-lights-day-night.md), [ADR-0020](../../adr/0020-real-time-ticks-offline-catch-up.md).

## Acceptance criteria

- [ ] `World::clock()` advances exactly one day per `steps_per_day()` and wraps at midnight (unit tests).
- [ ] `Clock.phase` returns the documented phase for every minute boundary.
- [ ] `daylight()` is continuous across sunrise/sunset and the key light is the moon at night (vitest).
- [ ] Render state carries step, day, minute, phase, sun elevation/azimuth, sky tint, weather.

## Evidence

- `simpress/nextest`
- `game/vitest` (`daylight.test.ts`)
