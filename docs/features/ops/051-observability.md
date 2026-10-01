---
id: FEAT-051
title: "Observability"
status: planned
importance: normal
paths:
  - "crates/server/src/telemetry/**"
adrs:
  - ADR-0008
  - ADR-0010
---

# Observability

tracing spans per company and job, metrics (step lag, queue depth, job latency, desyncs), and the
`llm_calls` audit (tokens, cost, latency per company and job).

Decisions: [ADR-0008](../../adr/0008-postgres-only-infrastructure.md), [ADR-0010](../../adr/0010-claude-over-raw-http.md).

## Acceptance criteria

- [ ] Every LLM call writes exactly one `llm_calls` row.
- [ ] Desyncs and blocked stages raise metrics with company ids.

## Evidence

- `server/nextest`
