---
id: FEAT-029
title: "Asset pipeline"
status: planned
importance: normal
paths:
  - assets/manifest.toml
  - "assets/blender/**"
  - "assets/scripts/**"
  - xtask/src/assets.rs
adrs:
  - ADR-0017
---

# Asset pipeline

> **Superseded in part by ADR-0063:** rooms and props are procedural bricks (FEAT-081), so the CC0 kits and Blender bake are no longer on the critical path.

CC0 kits → Blender room modules and props on a 1 m grid → Cycles lightmap (UV2) + AO bake → glTF
with KTX2/Basis and meshopt, driven by `assets/manifest.toml`.

Decisions: [ADR-0017](../../adr/0017-asset-pipeline-cc0-blender-gltf.md).

## Acceptance criteria

- [ ] `cargo xtask assets` rebuilds only changed modules (source hash).
- [ ] Every manifest entry has a licence record in `assets/kits/*/SOURCES.md`.
- [ ] Total download size tracked as a deterministic benchmark.

## Evidence

- `bench/bundle-size`
