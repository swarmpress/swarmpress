---
id: FEAT-018
title: "Orthographic isometric camera"
status: in-progress
importance: high
paths:
  - apps/game/src/render/camera.ts
  - apps/game/src/render/camera-math.ts
  - apps/game/src/render/camera-math.test.ts
adrs:
  - ADR-0005
---

# Orthographic isometric camera

Orthographic `ArcRotateCamera` at true iso elevation with four snapped azimuths, ground-plane pan
and clamped zoom (3–20 m half-extent).

Decisions: [ADR-0005](../../adr/0005-orthographic-iso-dollhouse-camera-and-cutaway.md).

## Acceptance criteria

- [ ] `ISO_BETA` is the true isometric angle; four alphas 90° apart (vitest).
- [ ] Zoom clamps to `[ZOOM_MIN, ZOOM_MAX]`; ortho extents follow aspect ratio.
- [ ] Rotation snaps animate and re-run cutaway selection once per snap.

## Evidence

- `game/vitest` (`camera-math.test.ts`)
