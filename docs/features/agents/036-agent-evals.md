---
id: FEAT-036
title: "Agent eval harness and pipeline cost"
status: planned
importance: normal
paths:
  - crates/agents/src/bin/eval.rs
  - "crates/agents/evals/**"
adrs:
  - ADR-0022
  - ADR-0026
---

# Agent eval harness and pipeline cost

Opt-in live eval harness with rubric grading; FakeClaude cost/latency reporter emitting
`cockpit.benchmark.v1` (calls, tokens, wall time per article).

Decisions: [ADR-0022](../../adr/0022-testing-strategy-cockpit-evidence-gate.md), [ADR-0026](../../adr/0026-model-registry-webgpu-capability-tiers.md).

## Acceptance criteria

- [ ] Deterministic FakeClaude run emits stable call and token counts (gating).
- [ ] Live eval results are environment-sensitive (informational).

## Evidence

- `bench/agent-pipeline`
