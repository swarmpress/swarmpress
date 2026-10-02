---
id: FEAT-036
title: "Agent eval harness and pipeline cost"
status: planned
importance: normal
paths:
  - apps/game/eval.html
  - apps/game/src/harness/eval-harness.ts
  - xtask/src/main.rs
adrs:
  - ADR-0022
  - ADR-0026
  - ADR-0057
  - ADR-0058
---

# Agent eval harness and pipeline cost

Opt-in live eval harness with rubric grading; FakeClaude cost/latency reporter emitting
`cockpit.benchmark.v1` (calls, tokens, wall time per article).

Decisions: [ADR-0022](../../adr/0022-testing-strategy-cockpit-evidence-gate.md), [ADR-0026](../../adr/0026-model-registry-webgpu-capability-tiers.md).

## MVP: the eval harness and the "publishable" bar (increment E)

Design: [`docs/design/mvp-pipeline.md`](../../design/mvp-pipeline.md) section 9.

The harness moves from a native binary to a browser page, because the model runs only in the
browser (ADR-0057): `eval.html` + `eval-harness.ts`, with the real model, the orchestrator wasm, an
in-memory store, a local fake gateway and a knowledge pack built by `cargo xtask site-pack`.

- Briefs: the unpublished topics of the site's content calendar. The 19 existing articles calibrate
  the deterministic checks and act as positive controls for the editor.
- Reported: first-try validity and repairs per stage type, truncation rate, tokens and seconds per
  stage and per article, revisions to approval, share blocked, and the deterministic checks.
- The proposed threshold (owner sets the numbers) is in the design document, including the
  editor-discrimination test on seeded-bad drafts and the rehearsal on a fork.

## Acceptance criteria

- [ ] Deterministic FakeClaude run emits stable call and token counts (gating).
- [ ] Live eval results are environment-sensitive (informational).

## Evidence

- `bench/agent-pipeline`
