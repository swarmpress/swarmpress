---
id: FEAT-056
title: "Agent skills and sim rules"
status: in-progress
importance: high
paths:
  - packages/runner/src/engine.ts
  - packages/runner/src/fakes.ts
  - packages/runner/test/skills.test.ts
  - packages/runner/test/rules.test.ts
  - "examples/extensions/fact-checker/**"
  - "examples/extensions/coffee-machine-rule/**"
adrs:
  - ADR-0042
---

# Agent skills and sim rules

Skills export tools and jobs; a job handler gets capability-gated `{job, store, llm, web}` facades
and returns `{artifact, digest}`, never a transition. The runner validates the result and recomputes
`artifact_sha`. Sim rules export `onStep`/`onDayStart`/`onEvent`, run in deterministic mode at step
boundaries over an integer-only world view, and propose commands that are logged (replay re-applies
the log and never re-runs the JS). Examples: the fact-check desk and the temperamental coffee machine.

Decisions: [ADR-0042](../../adr/0042-extension-sdk-and-the-headless-bun-runner.md).

## Acceptance criteria

- [ ] A job result with extra keys or a wrong `artifact_sha` is rejected.
- [ ] A scripted FakeLlm drives the fact-checker job to a pinned digest; running out of script fails loudly.
- [ ] Rule output for a seed is pinned, replays identically, and float-carrying commands are rejected.

## Evidence

- `runner/bun-test`
