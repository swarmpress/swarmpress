---
id: FEAT-030
title: "Claude client"
status: planned
importance: critical
paths:
  - "crates/claude/**"
  - "crates/testkit/src/fake_claude*.rs"
adrs:
  - ADR-0010
---

# Claude client

Messages API over reqwest: SSE parser, tool loop, structured outputs, `cache_control` placement,
retries on 429/529/overloaded, refusal/fallback handling, usage capture into `llm_calls`.

Decisions: [ADR-0010](../../adr/0010-claude-over-raw-http.md).

## Acceptance criteria

- [ ] SSE parser fixtures: text, tool_use, refusal, max_tokens, overloaded/429 retry, fallback blocks.
- [ ] Request snapshots: cache_control placement, no forced tool_choice.
- [ ] Refusal fails the job loudly; nothing is invented.

## Evidence

- `claude/nextest`
