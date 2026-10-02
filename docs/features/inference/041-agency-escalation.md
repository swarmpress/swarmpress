---
id: FEAT-041
title: "Agency escalation"
status: planned
importance: high
paths:
  - "crates/agents/src/agency/**"
  - crates/sim-core/src/agency.rs
  - crates/agents/src/roles.rs
  - crates/orchestrator/src/run.rs
adrs:
  - ADR-0024
  - ADR-0010
  - ADR-0051
  - ADR-0052
---

# Agency escalation

Executor policy per `JobKind` (`Browser | Claude | BrowserThenClaude`, min tier); Claude-backed work
appears as Agency contractors; escalation after 3 rejections, failing schema repair, weak tier or a
CEO "send to agency" ticket.

Decisions: [ADR-0024](../../adr/0024-hybrid-inference-browser-llms-and-claude.md), [ADR-0010](../../adr/0010-claude-over-raw-http.md).

Increment B5: an Agency job is real spend. It runs through the central LLM proxy (FEAT-064) as
a spend request: quote → policy → hold at a true maximum → settle the actual cost (FEAT-070). The
in-game Agency fee stays a game-balance number in the game currency and is independent of the
real charge. A local job never moves to a cloud model without the player's policy or mandate
allowing it; with no balance the job stays on the browser route.

Depends on: FEAT-064, FEAT-069, FEAT-070.

## Acceptance criteria

- [ ] Executor policy table-tested per JobKind.
- [ ] Escalation is visible in the sim (Agency visitor) and costs in-game money.
- [ ] Against a fake Claude that returns the maximum, the settled amount never exceeds the hold.
- [ ] With an empty balance or a policy that forbids it, the job is not sent to the Agency.

## Evidence

- `agents/nextest`
- `swarmpress/nextest`
