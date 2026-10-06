---
id: FEAT-096
title: "n8n workflow import"
status: planned
importance: normal
paths:
  - "packages/toolgraph/src/import/n8n.ts"
  - "packages/toolgraph/test/n8n.test.ts"
adrs:
  - ADR-0072
---

# n8n workflow import

After the MVP. n8n workflow JSON is mapped deterministically onto tool-graph nodes:

| n8n node | Tool-graph node |
|---|---|
| HTTP Request | connector |
| IF | condition |
| Set | op map |
| Merge | op merge |
| Schedule | trigger |

Any other node, including Code, becomes a sealed step. A sealed step blocks the tool and opens a
ticket: it never runs as a placeholder. Export to n8n is not planned.

Design: [`docs/design/construction-kits.md`](../../design/construction-kits.md) §8.

Depends on: FEAT-091.

## Acceptance criteria

- [ ] Fixture workflows map to graphs that pass the checker, except where sealed steps are reported.
- [ ] A graph with a sealed step cannot be installed.

## Evidence

- `sdk/bun-test`
