---
id: FEAT-092
title: "Block-to-tool bindings at build time"
status: in-progress
importance: normal
paths:
  - "crates/blueprint/src/check.rs"
  - "crates/server/src/site_data.rs"
  - "crates/server/tests/site_data.rs"
  - "packages/site-kit/src/content/load.ts"
  - "packages/site-kit/test/unit/tool-data.test.ts"
  - "apps/game/src/tools/**"
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

## As built (2026-10-06)

- **Checking a binding:** `blueprint::check` checks a slot's `source` binding: the tool exists,
  the output's type fits the slot's `accepts` type, the inputs exist, and the context paths are
  closed.
- **Writing the data:** `PUT /api/site/data` validates a run's output against the tool's output
  type, then commits it to `content/data/<tool>/<key>.json` as a content write. The same value
  again changes nothing.
- **Reading the data:** the site kit loads `content/data/**` into `LoadedSite.data`, and a theme
  block reads it with `ctx.toolData(tool)`: the page's own key first, then `latest`.
- **Running in the browser:** the game runs the tool in the sandbox (`apps/game/src/tools/runner.ts`).

## Acceptance criteria

- [ ] A binding whose types do not fit is rejected by the checker.
- [ ] A scheduled run writes validated data through the gateway as a content write, and its digest
      reaches the sim as `ToolRunCompleted`.
- [ ] A failed run keeps the last good data and opens no placeholder (`on_error: keep-last`).

## Evidence

- `agents/nextest`
- `github/nextest`
