# ADR-0006 — Baked static GI plus dynamic gameplay lights; lighting as sim state; day/night

**Status:** Accepted
**Date:** 2026-10-01

## Context

Light is gameplay information in swarm.press. Many facts are readable at a glance only if the
lighting tells the truth:
- the office fills in the morning;
- a lamp on at 21:00 means overtime;
- a dark room means it is unused;
- a glowing monitor means someone is typing.

Real-time GI for a whole building is out of reach in the browser, especially on WebGL2 or while a
local LLM shares the GPU. Unlimited dynamic lights in Babylon cost one shader permutation and one
pass per light per material. Babylon also enforces a per-material light limit (four by default).

## Decision

- **Static indirect light is baked.** Each room module carries a Cycles-baked lightmap (UV2) and
  AO in its glTF ([ADR-0017](0017-asset-pipeline-cc0-blender-gltf.md)). The bake assumes "lights
  on". Night variants are approximated by scaling lightmap intensity with the room's light state.
- **Gameplay lights are dynamic and scoped.**
  - Each room's ceiling lights and each desk lamp is a Babylon light whose `includedOnlyMeshes`
    is limited to that room's meshes (plus staff meshes).
  - At most about 16 dynamic lights are visible at once. Lights outside the view or in cut-away
    floors are disabled.
- **Lighting is sim state.**
  - The sim decides `Room.light ∈ {Off, Dim, On}`, `Device.state` and screen modes.
  - The renderer maps that state to intensities (`CEILING_INTENSITY`, `LAMP_INTENSITY`) and to
    emissive materials.
  - The renderer never decides whether a light is on
    ([ADR-0007](0007-sim-renderer-render-state-contract.md)).
- **Day and night come from the sim clock.**
  - `daylight(minute)` (`apps/game/src/render/daylight.ts`) is a pure function. From the minute
    it derives:
    - sun elevation and azimuth;
    - key-light colour and intensity (sun by day, moon by night);
    - hemispheric sky and ground colour;
    - clear colour;
    - a `daylightFactor`.
  - Sunrise is at 06:00 and sunset at 20:00, with a maximum elevation of 58°.
  - Sun and moon shadows use a `ShadowGenerator` with PCF.
- **Post-processing by quality tier.** ACES tone mapping, subtle bloom (screens and lamps), and
  SSAO2 for contact shading.

Alternatives considered:

- **Fully dynamic lighting with clustered lights.** Rejected. It is too costly on WebGL2 and
  low-tier GPUs, and it competes with the local LLM for the GPU.
- **Fully baked lighting.** Rejected. Lights could no longer switch with gameplay.
- **Light probes and IBL only.** Rejected. Too flat for interior night scenes.
- **The renderer picks lights from time of day.** Rejected. It hides gameplay facts in the
  renderer, and two clients could disagree.

## Consequences

- Positive: lighting tells the truth about the sim and is deterministic per sim time. That makes
  frozen-time visual regression (08:00, 13:00, 19:30, 23:00) possible.
- Positive: per-room light scoping keeps shader cost bounded. A NullEngine test asserts the light
  budget per room.
- Negative: rebaking is needed whenever room module geometry changes. The bake is part of the
  asset pipeline and runs offline.
- Negative: dimming a baked lightmap only approximates the night look. Moving furniture does not
  update the bake, and dynamic AO (SSAO) covers part of the gap.
