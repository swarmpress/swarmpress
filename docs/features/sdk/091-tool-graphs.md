---
id: FEAT-091
title: "Tool graphs: typed workflows compiled to sandboxed skills, and the factory district"
status: in-progress
importance: normal
paths:
  - "packages/toolgraph/**"
  - "crates/blueprint/src/tools.rs"
  - "crates/blueprint/tests/tools.rs"
  - "crates/blueprint/tests/fixtures/site/**"
  - "apps/game/src/ui/components/Tools*.tsx"
  - "apps/game/src/render/bricks/machines.ts"
adrs:
  - ADR-0072
  - ADR-0042
  - ADR-0043
  - ADR-0053
---

# Tool graphs: typed workflows compiled to sandboxed skills, and the factory district

After the MVP (increments T-0 and T-1). A tool (`blueprint/tools/<id>.tool.json`,
`swarmpress.tool.v1`) is a small typed graph over a closed node catalogue: input, output, connector
(`http-get`, `rss`, `web-search`, `knowledge`, `store-read`, `tool`), op, condition, agent and skill.
There is no free-code node.

A graph installs as an SDK `skill` extension:
- its manifest's capabilities, origins and limits are derived from the graph;
- its bundle is one shared interpreter (`packages/toolgraph`);
- it is installed through the CEO's ticket (ADR-0053).

Runs record a trace, and replays reuse recorded connector and agent outputs. In bricks, a tool is a
machine in the factory district: hoppers, dishes, gearboxes, switches, staff workstations and chutes,
joined by tubes with typed couplings. The game must load extensions first.

Design: [`docs/design/construction-kits.md`](../../design/construction-kits.md) §3.4, §4.3, §7.

Depends on: FEAT-054 (sandbox), FEAT-056 (skills).

## Acceptance criteria

- [ ] The derived manifest grants exactly the capabilities and origins the graph's connectors need.
- [ ] A type mismatch on an edge is a checker issue with the edge's id.
- [ ] A run in the sandbox under Bun produces a typed result and a trace; a replay makes no fetch.
- [ ] A graph with an agent step requests a `ToolRun` job, and the staff member's time is spent in the sim.

## Evidence

- `sdk/bun-test`
- `sandbox/bun-test`
- `runner/bun-test`
- `toolgraph/bun-test`
