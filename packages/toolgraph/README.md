# @swarm-press/toolgraph

The interpreter for `swarmpress.tool.v1` tool graphs (FEAT-091, ADR-0072, design
`docs/design/construction-kits.md` §3.4 and §7). A tool is a small typed graph over a closed node
catalogue (input, output, connector, op, condition, agent, skill). It installs as an SDK `skill`
extension whose bundle is this one shared interpreter, so graphs are data and the code is reviewed once.

The Rust crate `blueprint` (`crates/blueprint/src/tools.rs`, `types.rs`) is the source of truth for
the format, the checker and the derived manifest. This package runs what the checker accepted.

| File | What |
|---|---|
| `src/graph.ts` | Zod schema mirroring the Rust serde shapes (`.strict()`, Rust defaults); `parseToolGraph` throws `ToolGraphParseError` |
| `src/types.ts` | the type subset at runtime: built-ins plus site types, `validate` with field-path issues, `jsonSchema`, the path language (`$`, `$.a.b`, `$.items[0]`, `$.items[]`) |
| `src/interpret.ts` | `runGraph(graph, types, input, host, opts?)` → `{ ok, outputs, trace, recorded, error?, issues?, keepLast? }` |
| `src/skill.ts` | `toolSkill(graph, types)`: the SDK skill (one tool named after the graph) over `HostContext` |
| `src/compile.ts` | `toolEntrySource(graph, types)`: the bundle entry `swarmpress build` bundles |

`skill.ts`, `interpret.ts` and `types.ts` are sandbox-safe (no Zod, no `crypto`, no Node or Bun
modules); bundles import `@swarm-press/toolgraph/skill`. The manifest comes from Rust
(`blueprint::tools::manifest`) and is not built here.

## Semantics in brief

- Nodes run in Rust `topo()` order (a FIFO ready queue seeded in declaration order).
- A condition writes only its taken outlet. A node with a connected inlet that received nothing is
  `not-taken`. A declared output nobody wrote fails the run with `no-output:<port>` (rule 11).
- Connector, agent and skill results are validated against their declared types and recorded by node
  id. `opts.replay` (a previous `recorded`) reuses them with no host call: the "test" button.
- Agents get the instruction, the input as canonical JSON and the output type's JSON Schema. One
  repair turn follows an invalid reply, carrying the validation errors.
- `failure.retries` retries connector and agent errors. A limit of 0 is derived: connectors ×
  (1 + retries) for fetches, agents × (1 + retries) × 2 for LLM calls. Exceeding a limit fails the run.
- The sandbox's `CapabilityError` is never caught: it reaches the host unchanged.
- `on_error: keep-last` is reported as `keepLast: true` on a failed run. Writing is the caller's job.
- Each trace entry holds `{node, state, in_sha, out_sha, ms, outlet?, error?, issues?}`. The hashes are
  sha256 of canonical JSON. `ms` comes from `opts.clock`, which defaults to 0.

## Tests

`bun test` (or `pnpm test`, which writes `reports/junit.xml` for Cockpit's `toolgraph/bun-test`).
The tests use the shared fixture site in `crates/blueprint/tests/fixtures/site` and the recorded
responses in `test/fixtures`. `test/sandbox.test.ts` bundles a tool with the runner's `buildBundle` and runs it in
the real QuickJS sandbox, with the origins from the Rust golden manifest.
