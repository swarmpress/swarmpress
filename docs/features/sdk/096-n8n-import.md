---
id: FEAT-096
title: "n8n workflow import"
status: in-progress
importance: normal
paths:
  - "packages/toolgraph/src/import/n8n.ts"
  - "packages/toolgraph/test/n8n.test.ts"
  - "packages/toolgraph/test/fixtures/n8n/**"
  - "crates/blueprint/tests/n8n.rs"
  - "crates/blueprint/tests/fixtures/n8n/**"
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

## As built (2026-10-06)

`importN8n(workflow, id)` in `packages/toolgraph/src/import/n8n.ts` maps these n8n nodes, without
a model:
- Schedule Trigger and Cron become a schedule; Manual Trigger and Webhook become on-demand (a
  webhook also gets an input);
- HTTP Request (GET) and RSS Read become connectors;
- IF becomes a compare condition;
- Set, Merge, Limit and Sort become ops;
- anything else, Code included, becomes a sealed `skill` step naming `press.swarm.sealed`.

`={{ $json.a.b }}` expressions become paths, or `{a}` URL placeholders. The fields of an HTTP
response's type are inferred from what the workflow reads downstream, and reported as an issue to
check. The import lists the sealed steps and the stub types as issues.

The imported RSS digest checks clean under the Rust checker and runs in the interpreter. The
weather alert is refused only for its sealed Code step (`crates/blueprint/tests/n8n.rs`).

## Acceptance criteria

- [ ] Fixture workflows map to graphs that pass the checker, except where sealed steps are reported.
- [ ] A graph with a sealed step cannot be installed.

## Evidence

- `sdk/bun-test`
