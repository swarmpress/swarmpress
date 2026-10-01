# ADR-0017 — Asset pipeline: CC0 kits, Blender bake, glTF/KTX2

**Status:** Accepted
**Date:** 2026-10-01

## Context

The dollhouse look needs:
- detailed rooms, props and characters;
- consistent scale;
- baked lighting.

There is no art team, so the assets must be legally clean (no licence ambiguity in a public repo),
reproducible from source, and small enough for browser download on top of multi-GB local models.

## Decision

- **Sources:** CC0 kits only.
  - Kenney (furniture, office props);
  - Quaternius (office and characters);
  - Poly Haven (PBR materials, HDRIs).

  The raw kits live in `assets/kits/` via Git LFS, with a `SOURCES.md` per kit that records the
  URL, version and licence.
- **Assembly** happens in Blender (`assets/blender/`):
  - room modules (walls, floor, windows, built-ins) and props on a **1 m grid**;
  - a consistent origin and scale;
  - names that follow `manifest.toml` ids.
- **Bake.**
  - Each room module gets a lightmap on UV2 (Cycles) plus AO.
  - The bake assumes interior lights on and neutral daylight
    ([ADR-0006](0006-baked-gi-dynamic-lights-day-night.md)).
- **Export:**
  - glTF 2.0 with KTX2/Basis textures (UASTC for normals, ETC1S for albedo) and meshopt
    compression;
  - written to `assets/out/`, a build output that is git-ignored and published as a CI artifact
    and CDN upload.
- **`assets/manifest.toml`** drives export. It lists every module and prop with its source file,
  LOD settings, collision footprint and sim id (Desk, DeskLamp, MoodBoardWall…). An export script
  (Blender in background mode) is invoked by `cargo xtask assets`.
- **Characters:**
  - Mixamo-compatible rigs;
  - shared animation clips: idle, walk, sit, type, talk and carry, plus the listen, think,
    present, sleep, celebrate and frustrated poses;
  - retargeted in Blender.

Alternatives considered:

- **Procedural geometry only** (the M0 placeholder `office.ts`). Kept as the fallback and for
  tests, but it can't reach the target look.
- **Commercial asset stores.** Rejected. Licence terms are incompatible with a public repo and
  redistribution.
- **AI-generated 3D.** Rejected for now. Topology, UVs and licensing are unreliable.

## Consequences

- Positive: legally clean and reproducible. Any contributor with Blender can rebuild every asset.
- Positive: KTX2 and meshopt keep downloads small. Download size is a tracked benchmark.
- Negative: Blender becomes a build dependency for asset work (not for code work, since outputs
  are cached in CI).
- Negative: rebakes are slow. Only changed modules are rebaked, keyed by a source hash in the
  manifest.
- `assets/out/**` is excluded from Cockpit's implementation paths, because generated output must
  not mark features stale.
