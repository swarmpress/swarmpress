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
  - "apps/game/src/tools/**"
  - "crates/agents/src/tool_use.rs"
  - "crates/orchestrator/src/tool_facts.rs"
  - "crates/orchestrator/tests/tool_facts.rs"
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

## As built (2026-10-07)

- **Format and checker** (`crates/blueprint/src/tools.rs`): the closed node catalogue, typed
  edges, and a derived manifest with capabilities, origins and limits.
- **Interpreter** (`packages/toolgraph`): it runs a graph inside the QuickJS sandbox under the
  graph's derived manifest. The game ships one bundle, `runtime/toolgraph-runtime.js`, with a
  drift check.
- **In the game** (`apps/game/src/tools/`):
  - `runner.ts` runs a tool with its web traffic through the central fetch proxy and its agent
    step on the hosted model.
  - `host.ts` answers the sim's `ToolRun` jobs. A tool without inputs runs once; a bound tool
    runs once per page of its page type. Every output is written as site data, and the sim gets
    a digest.
  - "Run now" in the Tools tab logs `RunTool`.
  - In the sim, a tool is named by the first 6 bytes of its hash.
- **Agents calling tools** (§7.4):
  - There is no vendor function calling. `agents::tool_use` adds an optional `use_tools` list to
    any structured answer's schema; the host runs the requested tools and returns their results
    as the next message, for at most N rounds. The same loop works on the fake, local and hosted
    models.
  - The Draft pipeline's `tools#0` stage (`crates/orchestrator/src/tool_facts.rs`) runs after
    the web research. It offers the site's on-demand tools that check clean.
  - Each fact the writer states becomes dossier evidence with the source `tool:<id>`, but only
    if that tool actually ran and answered. At most 8 facts are kept, and they are stored like
    every other stage.
  - In the browser, the orchestrator's tool caller runs the tool in the sandbox.

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
