---
id: FEAT-086
title: "Hosted inference on GPT-6-Luna"
status: in-progress
importance: high
paths:
  - crates/server/src/llm.rs
  - crates/server/tests/llm.rs
  - crates/server/migrations/0006_llm_jobs.sql
  - crates/server/src/config.rs
  - apps/game/src/llm/hosted-llm.ts
  - apps/game/src/llm/hosted-llm.test.ts
  - apps/game/src/net/central.ts
  - apps/game/src/llm/research.ts
  - crates/server/migrations/0007_llm_searches.sql
  - apps/game/src/orchestrator/bridge.ts
  - apps/game/src/orchestrator/bridge.test.ts
adrs:
  - ADR-0067
  - ADR-0068
---

# Hosted inference on GPT-6-Luna

The central server runs every model turn on GPT-6-Luna through the OpenAI Responses API
(ADR-0067; the owner's [migration document](../../reference/gpt-6-luna-simulation-migration.md)).
`POST /api/llm/generate` takes the conversation, a reasoning effort, a service tier (Flex by
default, Standard where the player waits) and an optional JSON schema, and returns the answer
with its usage and cost.

- Signed-in players with the company's current lease only; the lease lock is not held across
  the provider call.
- The key (`OPENAI_API_KEY`) stays on the server; without it the route answers 503.
- One `llm_jobs` row per call (tokens, cost, tier, attempts, status); a company past its daily
  budget (`LUNA_DAILY_BUDGET_USD`, per UTC day) gets 429.
- A Flex call the provider refuses as busy is retried with backoff, never promoted silently; an
  account without credits is reported as such, not retried.
- The call and its row run on their own task, so a client that goes away mid-call (a reload, a
  lost lease) still has its spend recorded. Rows a restart cut off are marked `abandoned` at
  start and hourly (`llm::sweep_abandoned`); their spend is unknown and counts as zero.

The browser's `luna` backend (`apps/game/src/llm/hosted-llm.ts`) is the default: it implements
`LocalLlm` over that route with the session's lease, maps thinking to reasoning effort, sends the
schema of structured calls, and treats a 503 as the model being unavailable (the clock holds). A
call is interactive (Standard) when the clock holds for a due job as it starts, because the player waits for it;
every other call, including the story director's prefetched chapters, goes on Flex (the bridge's
`interactive` option).

Not built yet: running it in the qualification harness, Batch preparation, and real-world
events for conversations. The story director is FEAT-099.
