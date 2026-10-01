---
id: FEAT-032
title: "Editorial pipeline (orchestrator)"
status: planned
importance: critical
paths:
  - "crates/agents/src/pipelines/**"
  - "crates/agents/tests/pipeline*.rs"
  - "crates/server/tests/full_pipeline*.rs"
adrs:
  - ADR-0011
  - ADR-0009
---

# Editorial pipeline (orchestrator)

Orchestrator-owned pipeline: standup pitch → brief → draft PR (`drafts/<project>`) → media → editor
review (≥ 7 approves, max 3 revisions) → QA → merge → deploy webhook → published.

Decisions: [ADR-0011](../../adr/0011-orchestrator-owns-state-transitions.md), [ADR-0009](../../adr/0009-site-repo-canonical-github-app.md).

## Acceptance criteria

- [ ] FakeClaude scripted transcripts cover approve, revise loop, reject, escalation and QA fix loop.
- [ ] Full pipeline test with FakeClaude + FakeGitHub reaches `published`.
- [ ] Transition is committed before any GitHub side effect.

## Evidence

- `agents/nextest`
- `server/nextest`
- `bench/agent-pipeline`
