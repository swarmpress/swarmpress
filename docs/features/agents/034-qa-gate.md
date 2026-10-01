---
id: FEAT-034
title: "QA gate"
status: planned
importance: critical
paths:
  - "crates/agents/src/qa/**"
adrs:
  - ADR-0011
  - ADR-0013
---

# QA gate

Deterministic checks first (schema, closed-world links and media, banned phrases, length,
localisation completeness), then an LLM coherence review, with fix loops; escapes are counted
against the leaderboard.

Decisions: [ADR-0011](../../adr/0011-orchestrator-owns-state-transitions.md), [ADR-0013](../../adr/0013-closed-world-knowledge-indexes.md).

## Acceptance criteria

- [ ] Deterministic checks reject every invalid fixture with a specific defect code.
- [ ] Fix loop terminates (max 3) and opens a ticket.

## Evidence

- `agents/nextest`
