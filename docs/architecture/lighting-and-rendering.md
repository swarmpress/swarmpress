# Lighting and rendering

The client renders the company as a detailed, lit digital dollhouse with Babylon.js. WebGPU is
preferred and WebGL2 is the fallback. Lighting is gameplay information, so it always comes from
the sim.

Decisions: [ADR-0004](../adr/0004-babylonjs-webgpu-webgl2-fallback.md),
[ADR-0005](../adr/0005-orthographic-iso-dollhouse-camera-and-cutaway.md),
[ADR-0006](../adr/0006-baked-gi-dynamic-lights-day-night.md),
[ADR-0007](../adr/0007-sim-renderer-render-state-contract.md),
[ADR-0027](../adr/0027-gpu-sharing-renderer-and-local-llm.md).
Features: FEAT-017 to FEAT-029.

## Engine

`createEngine(canvas, forceWebgl)` (`apps/game/src/render/engine.ts`):
1. If WebGPU is supported, create a `WebGPUEngine` (antialias, `adaptToDeviceRatio`) and
   `initAsync()`.
2. If that fails, or `?renderer=webgl` is set, create a WebGL2 `Engine` with a stencil buffer.

`window.__swarmpress.renderer` reports `webgpu` or `webgl2` for tests. Playwright runs two
projects: `webgpu` (`--enable-unsafe-webgpu --use-angle=swiftshader
--enable-features=Vulkan`) and `fallback`.

## Scene structure

```
scene
├─ camera (orthographic ArcRotate, iso)          camera.ts / camera-math.ts
├─ sun: DirectionalLight + ShadowGenerator (PCF)  lighting.ts
├─ sky: HemisphericLight                          lighting.ts
├─ office root                                    office.ts (procedural today, glTF room modules in M9)
│  ├─ floor, exterior/interior walls (cutaway-tagged by side), window openings
│  ├─ rooms[]: ceiling PointLights (includedOnlyMeshes = room meshes + staff), emissive panels
│  ├─ desks[]: monitor (emissive screen material), desk lamp PointLight (scoped), lamp shade
│  └─ staff[] (placeholder capsules today; skinned glTF characters later)
└─ post: DefaultRenderingPipeline (+ SSAO2 on high)  postfx.ts
```

## Camera and cutaway

- **True isometric elevation:** `ISO_BETA = π/2 − atan(1/√2)`, about 35.26° above the horizon.
- **Four snapped azimuths** (`ISO_ALPHAS`: −π/4, π/4, 3π/4, 5π/4). The default view is from the
  south-east.
- **Orthographic zoom** is a half-extent clamped to `[3, 20]` m. The extents follow the aspect
  ratio (`orthoExtents`).
- **Cutaway** (`isCutAway(side, alpha)`): a wall is hidden when
  `n.x·cos α + n.z·sin α > 0`, meaning its outward normal faces the camera.
  - It is recomputed per snap, not per frame.
  - On high quality, cut walls fade to a low-height stub instead of disappearing.
  - With several floors, the floors above the selected one are cut away entirely.

## Lighting model

| Layer | What | Driven by |
|---|---|---|
| Baked | Lightmap (UV2, Cycles) and AO per room module | the asset pipeline (offline), scaled by room `light` state at night |
| Sun / moon | `DirectionalLight` direction, colour and intensity; PCF shadows | `daylight(minute)` from the sim clock |
| Sky | `HemisphericLight` sky and ground colour; clear colour | `daylight(minute)` |
| Ceiling lights | `PointLight`s per room, scoped with `includedOnlyMeshes`; emissive panels | `Room.light` (Off/Dim/On) |
| Desk lamps | `PointLight` per desk, scoped | `Device.state` of the DeskLamp |
| Screens | Emissive monitor materials (Idle/Typing/Review/Code/Screenshot/Error textures later) | `Device.screen` |
| Contact shading | SSAO2 (high), contact shadows | quality tier |

**The `daylight(minute)` model** (pure, unit-tested):
- sunrise at 06:00 and sunset at 20:00, with a maximum elevation of 58°;
- the azimuth sweeps from east to west;
- the key light is warm at low sun, neutral at noon, and switches to a cool, dim moon at night;
- the sky and ground colours and the clear colour follow;
- a `daylightFactor` from 0 to 1 tells the sim and the demo state when interior lights are
  needed.

**Day/night is sim state.** The renderer never decides that it is evening. It reads the minute
and the light states from the render state. Visual baselines are therefore taken at frozen sim
times: **08:00, 13:00, 19:30 and 23:00**, each from all four camera angles.

## Light budget

- Babylon limits the lights per material (4 by default). Interior materials raise it to
  `MAX_LIGHTS_PER_MATERIAL = 12` (`office.ts`). Scoping every interior light to its room's
  meshes keeps each material under the limit.
- At most **about 16 dynamic lights are visible at once**. Lights in rooms outside the camera
  frustum, or on cut-away floors, are disabled (`setEnabled(false)`), not just dimmed.
- Staff meshes are included in every room light and every lamp (they move between rooms). This
  is the one exception to strict room scoping. Its cost is bounded by the staff count per floor.
- A NullEngine vitest asserts the per-room light count and the scoping.

## Post-processing and quality tiers

`QUALITY` in `apps/game/src/render/postfx.ts`:

| Tier | Shadows | Shadow map | SSAO2 | Bloom | MSAA | FXAA |
|---|---|---|---|---|---|---|
| low | off | 1024 | off | off | 1 | on |
| medium | on | 2048 | off | on | 2 | off |
| high | on | 4096 | on | on | 4 | off |

All tiers use ACES tone mapping (exposure 1.1, contrast 1.1). Bloom uses threshold 0.85, weight
0.25 and kernel 48, which catches screens and lamps. SSAO2 uses radius 0.6, strength 1.2 and 16
samples. Depth of field is optional, and planned for photo mode only.

**Tier selection:**
- Auto-detected on first run, from adapter limits and a short frame-time probe.
- Overridable in settings.
- Lowered by one tier, with FPS capped at 30, while the local LLM generates (the GPU scheduler).
  Restored when it is idle.

## Characters and animation (planned, FEAT-024)

- Skinned glTF characters with Mixamo-compatible rigs.
- An animation state machine maps sim poses to clips: Walk, Sit, Type, Talk, Listen, Think,
  Present, Sleep, Celebrate, Frustrated, plus carry and idle variations.
- Clips cross-fade over 0.2 s.
- Walking follows the sim path ([render-state.md](render-state.md#interpolation)).

## Bubbles (planned, FEAT-025)

- Speech bubbles are anchored above the speaker's head. On high quality they are drawn with
  Babylon GUI; otherwise they are DOM overlays positioned from projected coordinates.
- Their duration comes from `Utterance.chars`, and their text from token deltas while a turn
  streams.
- A greedy layout avoids overlaps for up to 8 simultaneous speakers.

## Testing

- **vitest:** the pure maths (`camera-math`, `cutaway`, `daylight`, `render-state`).
- **vitest + Babylon `NullEngine`:**
  - scene construction;
  - per-room light budgets;
  - material setup;
  - device toggles from render state;
  - shadows per quality tier.
- **Playwright, under both `webgpu` and `fallback`:**
  - boot;
  - no shader or pipeline errors;
  - visual regression at the frozen sim times × 4 angles, with a fixed seed and a deterministic
    render mode;
  - a frame-time budget smoke test;
  - axe on the overlay.
- **Benchmarks:**
  - wasm bundle size (deterministic, budgeted);
  - frame time and draw calls per scene and tier (environment-sensitive, informational).
