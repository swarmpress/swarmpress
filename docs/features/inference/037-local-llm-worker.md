---
id: FEAT-037
title: "LocalLlm worker and adapters"
status: in-progress
importance: high
paths:
  - "apps/game/src/llm/**"
  - "apps/game/src/llm/runtime/bonsai/**"
  - "apps/game/src/llm/bench/**"
  - apps/game/src/llm/chrome-prompt-llm.ts
  - apps/game/src/llm/backend.ts
  - apps/game/scripts/bonsai-runtime.mjs
  - apps/game/bonsai.html
  - apps/game/src/harness/bonsai-harness.ts
  - apps/game/src/session/model-runtime.ts
  - apps/game/src/session/model-runtime.test.ts
  - apps/game/src/ui/model-card.ts
  - apps/game/src/ui/model-card.test.ts
  - apps/game/e2e/mvp-bonsai.spec.ts
  - apps/game/playwright.bonsai.config.ts
  - apps/game/e2e/bonsai-fixture.ts
  - apps/game/e2e/bonsai.spec.ts
  - apps/game/e2e/bonsai-equivalence.spec.ts
  - apps/game/e2e/bonsai-equivalence.goldens.json
  - apps/game/e2e/bonsai-bench.spec.ts
  - apps/game/bench.html
  - crates/agents/tests/bench_schemas.rs
  - apps/game/e2e/llm.spec.ts
  - crates/orchestrator-wasm/src/lib.rs
  - crates/orchestrator-wasm/tests/validate.test.ts
  - crates/claude/tests/schema_validator.rs
adrs:
  - ADR-0024
  - ADR-0057
---

# LocalLlm worker and adapters

A module Web Worker with its own WebGPU device runs `LocalLlm` (`load`, `generate`/`stream`,
`structured`). `structured` = schema-guided prompting → validation by `content-model` compiled to
wasm → up to N repair turns. Adapters: `TransformersJsLlm` (default), `FakeLlm` (tests).

Decisions: [ADR-0024](../../adr/0024-hybrid-inference-browser-llms-and-claude.md).

## MVP: one resident model (ADR-0057)

Design: [`docs/design/mvp-runtime.md`](../../design/mvp-runtime.md). Track R of `docs/mvp.md`.

R8 wires the runtime into the game session (`apps/game/src/session/model-runtime.ts`; the old
`unwiredLlm()` is gone): `?llm=bonsai|chrome|transformers`, else the company's stored choice, else
Bonsai; `?llm=fake` stays the scripted model. The real model has not been run in the game yet: the
gated e2e (`e2e/mvp-bonsai.spec.ts`, `BONSAI_E2E=1`) and the go/no-go report of R7 are the owner's.

- **R1:** extraction tooling for the Ternary-Bonsai-2 WebGPU engine: `runtime/bonsai/extract.ts`,
  `runtime.lock.json`, `upstream.d.ts`, `scripts/bonsai-runtime.mjs` into a git-ignored folder. The
  engine is never committed.
- **R2:** `bonsai-llm.ts`, `prefix-ledger.ts`, `think.ts` behind `LocalLlm`; protocol gains `probe`,
  `bench`, `resetSession`, usage timings and a device-loss event.
- **R3:** upstream equivalence on five fixed prompts (zero mismatched token ids).
- **R4:** the Rust validator exported as `validateJson` and injected into `runStructured`; repair
  turns send only the stripped answer; truncation never yields a partial success.
- **R5:** `chrome-prompt-llm.ts` and `backend.ts`; one backend per company session, never switched
  silently.
- **R6–R7:** qualification harness (`bench.html`, `src/llm/bench/*`) and the benchmark report under
  `docs/qualification/`. How to run it: `docs/runbooks/model-qualification.md`.
- **R8:** session wiring (`session/model-runtime.ts`), the startup of §22 (`llm/startup.ts`: explain
  once, probe WebGPU and limits, storage estimate and persistence, verify, download with bytes and
  `fromCache`, load, warm-up, a qualification turn that must validate; only then is the model
  ready and the clock runs), the origin-wide resident lock (`electResident`: a second tab waits
  and offers to take over), device loss (status `lost`, the call in flight discarded and run again
  after the reload; `BonsaiLlm` no longer hangs its reload on a lost generation), the model card
  (`ui/model-card.ts`), a debug-only `destroyDevice` worker command, and `localOnlyFetch`: a
  backend fetches only this origin and GET/HEAD weight downloads from the Hugging Face Hub.
- `job-runner.ts` (the retired offer/claim protocol) is deleted.

## Acceptance criteria

- [ ] Adapter contract tests with `FakeLlm` (vitest).
- [ ] Repair loop converges or fails loudly after N turns.
- [ ] Nightly: a tiny real ONNX model on SwiftShader WebGPU streams into a bubble and returns a validated artifact.

## Evidence

- `game/vitest`
- `game/playwright-e2e` (nightly real-model run)
