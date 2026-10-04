---
id: FEAT-038
title: "Model registry and capability tiers"
status: in-progress
importance: high
paths:
  - config/models.toml
  - apps/game/src/llm/registry.ts
  - apps/game/src/llm/registry.test.ts
  - apps/game/src/llm/registry.drift.test.ts
  - apps/game/src/llm/capabilities.ts
  - apps/game/src/llm/capabilities.test.ts
  - apps/game/src/llm/download.ts
  - apps/game/src/llm/download.test.ts
  - apps/game/src/llm/registry.default.ts
  - "apps/game/src/llm/runtime/bonsai/manifest/**"
  - apps/game/src/llm/runtime/bonsai/manifest.test.ts
  - apps/game/src/llm/runtime/bonsai/runtime.lock.json
  - apps/game/src/llm/bench/report.ts
  - apps/game/src/llm/bench/report.test.ts
  - crates/agents/src/models.rs
  - crates/agents/tests/config.rs
adrs:
  - ADR-0026
  - ADR-0057
---

# Model registry and capability tiers

Registry of local models with size, hash, limits, VRAM and roles; first-run capability detection
(adapter limits, deviceMemory, 10 s tokens/sec probe); resumable, integrity-checked downloads shown
as "installing the newsroom's brains"; seniority → model within tier.

Decisions: [ADR-0026](../../adr/0026-model-registry-webgpu-capability-tiers.md).

## MVP: a pinned manifest for the resident model (ADR-0057)

Design: [`docs/design/mvp-runtime.md`](../../design/mvp-runtime.md) (weight caching, `config/models.toml`).

- The `ternary-bonsai-2-27b` registry entry gets real values on its existing keys only (`hf_repo`,
  `dtype = "PTQ1_0"`, `size_bytes`, `sha256`, `context = 16384`); the Rust `ModelEntry` rejects
  unknown fields, so everything else lives in the manifest JSON.
- The model is pinned by Hub revision and whole-file sha256; one HEAD check compares
  `x-linked-etag` and `x-linked-size` with the manifest.
- Phase A keeps the engine's own IndexedDB chunk cache (Range, per-chunk resume). An OPFS chunk
  store with per-chunk hashes comes after the go decision.
- Tier selection is unused in the MVP: one model serves every role. The code exists with unit
  tests (registry, capabilities, download, manifest), so the feature is `in-progress`; it is not
  `stable` until R7 produces the eval evidence (`bench/model-eval`).

## Acceptance criteria

- [ ] Tier selection table-tested over synthetic adapter limits.
- [ ] Interrupted downloads resume and verify sha256.
- [ ] Eval harness emits one benchmark document per registry model.

## Evidence

- `game/vitest`
- `bench/model-eval`
