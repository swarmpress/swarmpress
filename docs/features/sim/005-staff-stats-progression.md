---
id: FEAT-005
title: "Staff stats, morale, fatigue and promotion"
status: planned
importance: high
paths:
  - crates/sim-core/src/staff/stats.rs
  - crates/sim-core/src/staff/morale.rs
  - crates/sim-core/src/hiring.rs
  - crates/agents/src/prompts/work_style.rs
adrs:
  - ADR-0010
  - ADR-0024
---

# Staff stats, morale, fatigue and promotion

> **Status note (2026-10-02):** Morale, fatigue and promotion exist in `crates/sim-core/src/world.rs`; there are no skills or XP. The status lags because no test file is linked to this feature yet.

Traits drive sim speed and error rate and render into a work-style paragraph in the prompt.
Seniority (Junior/Mid/Senior/Star) picks the model. Skill grows from completed stages and editor
scores; the cap triggers a promotion-request ticket. Fatigue rises with work and doubles after 18:00
(rushed work); morale responds to rejections, crunch, salary, CEO praise and room comfort; low
morale produces a resignation ticket.

Decisions: [ADR-0010](../../adr/0010-claude-over-raw-http.md), [ADR-0024](../../adr/0024-hybrid-inference-browser-llms-and-claude.md).

## Acceptance criteria

- [ ] Fatigue/morale updates are integer permille and covered by table-driven tests.
- [ ] Promotion and resignation tickets fire at the documented thresholds.
- [ ] Work-style paragraph snapshot per trait profile (insta).

## Evidence

- `swarmpress/nextest`
