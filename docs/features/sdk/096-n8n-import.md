---
id: FEAT-096
title: "n8n workflows run as tools"
status: in-progress
importance: normal
paths:
  - "packages/toolgraph/src/import/n8n.ts"
  - "packages/toolgraph/src/n8n/**"
  - "packages/toolgraph/test/n8n.test.ts"
  - "packages/toolgraph/test/fixtures/n8n/**"
  - "crates/blueprint/tests/n8n.rs"
  - "crates/blueprint/tests/fixtures/n8n/**"
  - "apps/game/src/ui/blueprint/N8nImport.tsx"
  - "apps/game/src/ui/blueprint/Credentials.tsx"
  - "apps/game/src/ui/blueprint/n8n.test.tsx"
  - "apps/game/src/tools/credentials.ts"
  - "apps/game/src/tools/credentials.test.ts"
adrs:
  - ADR-0072
  - ADR-0076
  - ADR-0054
---

# n8n workflows run as tools

The owner's requirement (2026-10-08): **the tools are compatible with n8n, so existing n8n flows can
be reused.** Import only; n8n Code nodes run in the sandbox. Decision: ADR-0076, which supersedes
ADR-0072's "no free-code node" rule and its 12-node limit.

Design: [`docs/design/construction-kits.md`](../../design/construction-kits.md) §8 and §12.

Depends on: FEAT-091 (tool graphs), FEAT-054 (sandbox).

## As built (2026-10-08)

- **Import** (`packages/toolgraph/src/import/n8n.ts`): node for node, without a model.
  - Each node of the 26 supported types becomes an `n8n` node with its name, type, version and
    parameters unchanged.
  - Triggers become the tool's triggers; a webhook becomes the `request` input.
  - Loop Over Items is flattened, and several connections into one input get an Append merge.
  - Disabled nodes pass their items through; sticky notes and model sub-nodes are dropped.
  - What cannot run stays in the graph as a sealed step, with its reason.
  - The import reports `mapping` (how each node was taken) and `issues` (`sealed`,
    `needs-credential`, `needs-tool`, `note`).
- **Run** (`packages/toolgraph/src/n8n/`): n8n's item semantics in the interpreter.
  - **Expressions** (`expr.ts`): field reads are native; everything else goes to the code sandbox,
    in one call per node.
  - **Prelude** (`prelude.ts`): `$json`, `$input`, `$('Node')`, a UTC subset of Luxon `DateTime`,
    and n8n's helper methods.
  - **Nodes** (`nodes.ts`): the HTTP Request versions with their query, header and body shapes;
    IF, Filter and Switch, v1 and v2 conditions; the Merge modes; and the list nodes.
- **The `code` capability** (`packages/sandbox`, `packages/sdk`): a nested QuickJS sandbox with no
  capabilities, under the caller's limits.
- **Requests:** `POST /web/request` (`crates/server/src/web.rs`) takes any method with headers and a
  body, under the SSRF guard, and answers raw.
- **The checker** (`crates/blueprint/src/tools.rs`):
  - the `n8n` kind, `N8N_TYPES` (compared with the TypeScript catalogue), and the unsupported shapes;
  - URL origins: literal, or "any website" for a computed host;
  - Execute Workflow must name a site tool, and a graph holds at most 40 nodes;
  - the manifest grants `code`, `web` with its origins, and `llm:mid`.
- **In the game:**
  - The Tools tab imports a workflow (`N8nImport.tsx`): a file or pasted JSON, the mapping, the
    manifest and issues from blueprint-wasm, and Install as the CEO's edit.
  - It lists and sets up credentials (`Credentials.tsx`). They live in this browser only
    (`tools/credentials.ts`), and the runner signs requests outside the sandbox.
  - n8n nodes stand as the machine of what they do, on the canvas and in the 3D factory district.
- **Tested** with real-shaped exports (`packages/toolgraph/test/fixtures/n8n/`): an RSS digest, a
  weather alert with Code, a webhook lead intake and a trail roundup with a loop, an LLM chain and
  Code. They run under Bun, in the browser runner and in replays. A sealed mix (Python, Slack) is
  refused by both checkers.

## Acceptance criteria

- [ ] Fixture workflows import node for node and pass the Rust checker, except for the steps reported
      as sealed.
- [ ] Imported workflows run with n8n's item semantics: expressions, Code, IF branches, merges, loops.
- [ ] Code reaches nothing beyond its items, and a runaway loop is stopped by the budget.
- [ ] A graph with a sealed step cannot be installed.
- [ ] A request that names a credential is signed outside the sandbox, or fails when the credential
      is missing.

## Evidence

- `sdk/bun-test`
- `toolgraph/bun-test`
- `sandbox/bun-test`
- `game/vitest`
