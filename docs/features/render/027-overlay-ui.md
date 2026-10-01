---
id: FEAT-027
title: "Overlay UI (Inbox, Feed, Staff, Build, HUD)"
status: planned
importance: high
paths:
  - "apps/game/src/ui/**"
adrs:
  - ADR-0018
---

# Overlay UI (Inbox, Feed, Staff, Build, HUD)

Preact DOM overlay: Inbox, Newsroom feed with transcripts, Staff/Hire, Build palette, Economy HUD,
Site preview, Leaderboard. A placeholder clock HUD (`hud.tsx`) exists; the panels are planned.

Decisions: [ADR-0018](../../adr/0018-overlay-ui-in-preact.md).

## Acceptance criteria

- [ ] Components tested with @testing-library/preact.
- [ ] axe reports 0 serious violations on every panel (Playwright).
- [ ] Every action produces a `ClientCommand`; nothing mutates the replica directly.

## Evidence

- `game/vitest`
- `game/playwright-e2e`
