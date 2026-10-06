---
id: FEAT-092
title: "Block-to-tool bindings at build time"
status: planned
importance: normal
paths:
  - "crates/blueprint/src/bindings.rs"
  - "crates/orchestrator/src/tools.rs"
adrs:
  - ADR-0072
---

# Block-to-tool bindings at build time

After the MVP (increment X-1). A blueprint slot can take its data from a tool. Its inputs are paths
into a closed context (`page.*`, `item.*`, `site.*`), and the type it accepts must fit the tool's
output. In v1 the tool runs when a page is drafted or refreshed, or on the tool's schedule. The
orchestrator commits the typed output to `content/data/<tool>/<key>.json`, and the block reads it.
Running a tool per visitor needs hosted compute and a separate ADR.

The first real binding is cinqueterre.travel's ferry times. In bricks, it is a tube from the machine's
chute into the storey.

Design: [`docs/design/construction-kits.md`](../../design/construction-kits.md) §3.5, §7.3.

Depends on: FEAT-090, FEAT-091.

## Acceptance criteria

- [ ] A binding whose types do not fit is rejected by the checker.
- [ ] A scheduled run writes validated data through the gateway as a content write, and its digest
      reaches the sim as `ToolRunCompleted`.
- [ ] A failed run keeps the last good data and opens no placeholder (`on_error: keep-last`).

## Evidence

- `agents/nextest`
- `github/nextest`
