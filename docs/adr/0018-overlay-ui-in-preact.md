# ADR-0018 — Overlay UI in Preact

**Status:** Accepted; amended by ADR-0063 (surfaces open panels)
**Date:** 2026-10-01

## Context

Besides the 3D building, the game has dense, text-heavy UI:
- the Inbox (tickets with options and deadlines);
- the newsroom feed with full transcripts;
- staff cards and hiring;
- build mode palettes;
- the economy HUD;
- a site preview;
- the leaderboard.

This UI needs accessibility (axe), text selection, scrolling, forms, i18n and fast iteration. It
must not cost frame time in the 3D scene.

## Decision

- Render all non-diegetic UI as a **DOM overlay in Preact** (`apps/game/src/ui/`), with
  `@preact/signals` for state derived from render-state and server data.
- The overlay reads the decoded render state and REST data. It never mutates the sim directly:
  every action becomes a `ClientCommand` sent through the protocol layer.
- **Diegetic UI** belongs to Babylon: speech bubbles, alert icons over rooms, and screens showing
  content (mood boards, CI screenshots). Bubbles may use Babylon GUI or DOM overlays positioned
  from projected world coordinates. The choice is made per quality tier.
- Overlay components are tested with vitest and `@testing-library/preact`. Accessibility is
  checked with axe in Playwright.

Alternatives considered:

- **Babylon GUI for everything.** Rejected. Poor accessibility, no native text input or
  selection, and slower iteration.
- **React.** Rejected for the game client. Preact is API-compatible at a fraction of the bundle
  size. React islands remain in site themes.
- **Svelte or Solid.** Viable, but Preact keeps the JSX skills that are shared with site themes
  (Astro and React islands).

## Consequences

- Positive: an accessible, testable UI that costs no frame time when idle.
- Positive: there is one place where server text (transcripts, tickets) is displayed, and it is
  escaped by default.
- Negative: two UI systems (DOM and Babylon GUI) need visual consistency, which design tokens
  shared through CSS variables provide.
- Negative: DOM overlays positioned over the canvas must be updated per frame for diegetic
  anchors. That is limited to bubbles and alerts.
