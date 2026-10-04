---
id: FEAT-034
title: "QA gate"
status: planned
importance: critical
paths:
  - crates/agents/src/qa.rs
adrs:
  - ADR-0011
  - ADR-0013
---

# QA gate

Deterministic checks first (schema, closed-world links and media, banned phrases, length,
localisation completeness), then an LLM coherence review, with fix loops; escapes are counted
against the leaderboard.

Decisions: [ADR-0011](../../adr/0011-orchestrator-owns-state-transitions.md), [ADR-0013](../../adr/0013-closed-world-knowledge-indexes.md).

> **Status note (2026-10-04):** Still planned. `crates/agents/src/qa.rs` holds the LLM coherence
> review's schema and call, but nothing calls it and no test covers it. The deterministic article
> checks that exist today belong to the editorial pipeline and the evals (FEAT-032, FEAT-036).

## Acceptance criteria

- [ ] Deterministic checks reject every invalid fixture with a specific defect code.
- [ ] Fix loop terminates (max 3) and opens a ticket.

## Evidence

- `agents/nextest`
