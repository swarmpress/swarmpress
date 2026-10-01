---
id: FEAT-037
title: "LocalLlm worker and adapters"
status: planned
importance: high
paths:
  - "apps/game/src/llm/**"
adrs:
  - ADR-0024
---

# LocalLlm worker and adapters

A module Web Worker with its own WebGPU device runs `LocalLlm` (`load`, `generate`/`stream`,
`structured`). `structured` = schema-guided prompting → validation by `content-model` compiled to
wasm → up to N repair turns. Adapters: `TransformersJsLlm` (default), `FakeLlm` (tests).

Decisions: [ADR-0024](../../adr/0024-hybrid-inference-browser-llms-and-claude.md).

## Acceptance criteria

- [ ] Adapter contract tests with `FakeLlm` (vitest).
- [ ] Repair loop converges or fails loudly after N turns.
- [ ] Nightly: a tiny real ONNX model on SwiftShader WebGPU streams into a bubble and returns a validated artifact.

## Evidence

- `game/vitest`
- `game/playwright-e2e` (nightly real-model run)
