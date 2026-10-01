# ADR-0035 — The real world enters through a World Context Service

**Status:** Accepted
**Date:** 2026-10-01

## Context

SimPress is connected to the live internet: its output is real websites, and its staff should
live in the real present. That means knowing today's date and holidays, the real weather at the
office and at each project's location, and current events, including politics. It should show
up in small talk, editorial decisions and timely content. Unbounded web access in every prompt
would be costly, ungrounded and a prompt-injection risk. Uncurated political talk would be a
brand and safety risk.

## Decision

- A server **World Context Service** with pluggable providers:
  - **date and holidays:** the HQ timezone plus a holiday calendar;
  - **weather:** Open-Meteo, keyless: current conditions, daily forecast, sea temperature,
    sunset, per HQ and per project location;
  - **news:** curated RSS/Atom feeds per company locale, refreshed hourly;
  - optional Agency `web_search` for deep research, metered in credits per ADR-0033.

  Every provider is behind a trait with recorded fixtures for tests. The sandbox used for
  development has no egress to these hosts, so tests never depend on the network.
- **Determinism:** only compact integer signals enter the sim, as server-issued commands
  (`WorldSignals`, `ProjectWeather`). They drive visual weather in the office and morale nudges.
  Headlines and other text stay server-side.
- **Prompts** get an hourly `WorldSnapshot` (date, weather, 5–10 attributed headlines).
  Utterances record which snapshot items they used.
- **Dates and time shape life in the office.** A `CalendarSignals` command carries the real
  date, holiday and festive-season state. It drives:
  - seasonal decorations;
  - leave and capacity patterns around holidays;
  - morale nudges;
  - office events (end-of-year party, Secret Santa, birthdays, name days);
  - seasonal workstreams in the plan.

  Personas have `[family]` and `[traditions]` profile sections, so holiday talk is personal ("how
  I celebrate Christmas with my family"). Religious and cultural holidays are treated as
  personal traditions, never assumed to be shared.
- **The real day versus the game clock:** the outside world is always the real current day. An
  optional real-time mode aligns game days with real days in the HQ timezone.
- **Guardrails for current events and politics:**
  - personas may only reference events present in the snapshot or a cited search result;
  - personas may react in character, civilly, but don't campaign, endorse parties or
    candidates, or attack groups;
  - published content follows editorial policy, and political or controversial angles are
    high-risk and go to the CEO;
  - feed text is quoted data, never instructions;
  - a per-company setting `world.news = off | headlines | full` controls news (weather and date
    are always on).

## Consequences

- The production server needs egress to the weather API and the configured feeds. Feed lists
  are configuration, reviewed for reliability and licensing (headline and link use only, with
  attribution).
- Grounding and civility validators are added to small-talk and meeting outputs. Failures are
  dropped or regenerated, never published.
- Visual weather and "today" make the office feel alive. Real-time mode is the most immersive,
  but it is opt-in because it slows progression.
