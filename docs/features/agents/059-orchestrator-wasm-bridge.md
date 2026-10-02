---
id: FEAT-059
title: "Orchestrator in the browser (orchestrator-wasm JS bridge)"
status: in-progress
importance: high
paths:
  - "crates/orchestrator-wasm/**"
  - "apps/game/src/orchestrator/**"
  - "apps/game/src/harness/**"
  - apps/game/src/llm/mvp-script.ts
  - apps/game/orchestrator.html
  - apps/game/e2e/orchestrator.spec.ts
  - apps/game/e2e/central-server.mjs
  - apps/game/playwright.orchestrator.config.ts
  - xtask/src/main.rs
adrs:
  - ADR-0011
  - ADR-0038
  - ADR-0042
---

# Orchestrator in the browser (orchestrator-wasm JS bridge)

`crates/orchestrator-wasm` compiles the `orchestrator` crate to its own wasm-bindgen module (the
sim bundle keeps its 400 KiB budget) and implements its `Store`, `Gateway` and `agents::Llm` over
JS objects: the browser's CompanyStore, the central gateway client and a LocalLlm (or the
scripted `?llm=fake` model). `OrchestratorHandle.run(job)` resolves to the outcomes the sim
applies; `jobsFromEffects` / `outcomesForSim` convert between the sim's JSON and the bridge's
without rounding the u64 `brief_ref`. The same `pkg/` runs under Bun.

See [browser-runtime.md](../../architecture/browser-runtime.md).

## Acceptance criteria

- [ ] The MVP loop (standup → draft → review 6 → revision → review 8 → publish) runs through the
  JS bridge under Bun with an in-memory JS store, a fake gateway and the scripted LLM, with the
  same plan thread as `crates/orchestrator/tests/loop.rs`.
- [ ] The same loop runs in Chromium with both store engines, the real central gateway and the
  `?llm=fake` LocalLlm; the server's `DeployLanded` arrives through the events API.
- [ ] Driven by the sim's effects, the loop ends with the item `published`.
- [ ] `orchestrator_wasm_bg.wasm` stays within its gzip budget (CI).

## Evidence

`crates/orchestrator-wasm/tests/loop.test.ts` (bun test), `apps/game/src/orchestrator/bridge.test.ts`
(vitest), `apps/game/e2e/orchestrator.spec.ts` (Playwright), `bundle-size-orchestrator-wasm.json`.
