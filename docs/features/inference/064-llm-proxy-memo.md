---
id: FEAT-064
title: "Central LLM proxy and memo cache"
status: planned
importance: high
paths:
  - crates/server/src/llm.rs
  - crates/server/src/db/llm.rs
  - crates/server/tests/llm.rs
  - "crates/claude/**"
  - "packages/host/src/llm/**"
adrs:
  - ADR-0051
  - ADR-0045
  - ADR-0024
---

# Central LLM proxy and memo cache

Increment A7. `POST /api/llm/complete` runs a remote model call for the lease-holding executor.
It is the only place a platform model key is used.

- Each call carries the lease epoch and an idempotency key `(company, job_id, call_index)`.
- Responses are memoised by that key, so a job re-run after a handover or crash replays its
  completed calls at no cost. This makes draft and review effectively idempotent.
- The server sets `max_tokens` and the turn cap on the provider request, so the hold is a true
  upper bound (FEAT-070).
- `remoteLlmBridge` implements `OrchestratorLlm.complete` over this route for hosts without a
  local model.

Depends on: FEAT-013, FEAT-069, FEAT-070. FEAT-041 and FEAT-065 depend on it.

## Acceptance criteria

- [ ] A re-run of a completed job makes no provider call and costs zero.
- [ ] A call with a stale epoch gets 409 and places no hold.
- [ ] The settled amount never exceeds the hold, against a fake Claude that returns the maximum.
- [ ] Without a platform key the route fails loudly (rule 11).

## Evidence

- `server/nextest`
- `claude/nextest`
