---
id: FEAT-038
title: "Model registry and capability tiers"
status: planned
importance: high
paths:
  - config/models.toml
  - apps/game/src/llm/registry.ts
  - apps/game/src/llm/capability.ts
  - apps/game/src/llm/download.ts
adrs:
  - ADR-0026
---

# Model registry and capability tiers

Registry of local models with size, hash, limits, VRAM and roles; first-run capability detection
(adapter limits, deviceMemory, 10 s tokens/sec probe); resumable, integrity-checked downloads shown
as "installing the newsroom's brains"; seniority → model within tier.

Decisions: [ADR-0026](../../adr/0026-model-registry-webgpu-capability-tiers.md).

## Acceptance criteria

- [ ] Tier selection table-tested over synthetic adapter limits.
- [ ] Interrupted downloads resume and verify sha256.
- [ ] Eval harness emits one benchmark document per registry model.

## Evidence

- `game/vitest`
- `bench/model-eval`
