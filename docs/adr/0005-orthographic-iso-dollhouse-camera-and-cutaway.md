# ADR-0005 — Orthographic iso dollhouse camera and cutaway

**Status:** Accepted
**Date:** 2026-10-01

## Context

Management sims (The Sims, Theme Hospital, Two Point) read best from a fixed, elevated angle that
keeps every room visible and lets furniture snap to a grid. Perspective cameras distort grid
alignment and make picking imprecise. And the walls between the camera and the interior hide
exactly what the player wants to see.

## Decision

- **Camera.** An orthographic `ArcRotateCamera` at true isometric elevation,
  `β = π/2 − atan(1/√2)` (about 35.26° above the horizon).
  - It has four snapped azimuths: NE, SE, SW and NW (`ISO_ALPHAS` in
    `apps/game/src/render/camera-math.ts`).
  - Rotation animates between snaps. Free rotation is not offered.
- **Pan and zoom.** Pan moves along the ground plane. Zoom changes the orthographic half-extent,
  clamped between `ZOOM_MIN = 3` and `ZOOM_MAX = 20` metres.
- **Dollhouse cutaway.** A wall is hidden when its outward normal points towards the camera:
  `dot(n, (cos α, sin α)) > 0`. On high quality it is faded instead of hidden.
  - The rule is the pure function `isCutAway`, and it is unit-tested.
  - Interior walls use the same rule per face.
  - Upper floors can be cut away entirely (the "floor cut-away"), so lower floors stay visible.
- Cutaway selection is recomputed only when the camera snaps, not every frame.

Alternatives considered:

- **Perspective camera.** Rejected. Grid placement and picking get harder, and the dollhouse look
  is lost.
- **Free orbit.** Rejected. Cutaway combinations become unbounded, visual regression testing gets
  harder, and gameplay gains nothing.
- **Always-transparent walls or an X-ray shader.** Rejected. They are visually noisy and costly.
  Hiding walls is cheaper and clearer.

## Consequences

- Positive: four angles × fixed sim times give a finite visual-regression matrix.
- Positive: cutaway is a pure function of camera angle, so it is cheap and testable without a
  GPU.
- Negative: orthographic projection needs explicit depth cues (SSAO and contact shadows), or
  objects appear to float.
- Negative: windows on cut-away walls disappear. Daylight must still enter, so sun direction and
  window light are kept independent of wall visibility.
