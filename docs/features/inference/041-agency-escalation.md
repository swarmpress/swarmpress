---
id: FEAT-041
title: "Agency escalation"
status: planned
importance: high
paths:
  - "crates/agents/src/agency/**"
  - crates/sim-core/src/agency.rs
adrs:
  - ADR-0024
  - ADR-0010
---

# Agency escalation

Executor policy per `JobKind` (`Browser | Claude | BrowserThenClaude`, min tier); Claude-backed work
appears as Agency contractors; escalation after 3 rejections, failing schema repair, weak tier or a
CEO "send to agency" ticket.

Decisions: [ADR-0024](../../adr/0024-hybrid-inference-browser-llms-and-claude.md), [ADR-0010](../../adr/0010-claude-over-raw-http.md).

## Acceptance criteria

- [ ] Executor policy table-tested per JobKind.
- [ ] Escalation is visible in the sim (Agency visitor) and costs in-game money.

## Evidence

- `agents/nextest`
- `simpress/nextest`
