# Contributing

## Workflow

1. **Read first.** Read the relevant [architecture doc](../architecture/overview.md), the ADRs
   it cites, and the feature file in `docs/features/`.
2. **Decide first.** A change to a decision needs a new ADR, written in Cockpit's dialect
   (`# ADR-NNNN — Title`, Status, Date, Context, Decision, Consequences) and listing the
   alternatives considered. Accepted ADRs are superseded, never rewritten.
3. **Track the feature.** Update the feature file:
   - its `status` (`planned` → `in-progress` → `stable`);
   - its `paths`, for any new code or test files;
   - its acceptance criteria.
4. **Test it.** Write the tests that provide the feature's evidence
   ([testing.md](testing.md)). Critical and high features that are not `planned` need passing
   tests.
5. **Commit.** Mention `FEAT-0xx` and, where relevant, `ADR 0xx` in commit messages.
6. **Gate.** Run the gate locally before pushing:

   ```sh
   cargo fmt --all --check
   cargo clippy --workspace --all-targets -- -D warnings
   cargo nextest run --workspace --profile ci
   pnpm typecheck && pnpm test
   cockpit scan && cockpit validate --strict
   ```

## Branches and PRs

- Work happens on `claude/simpress-babylon` (milestone branches) until the fresh tree replaces
  `main`, by a normal merge and never a force-push.
- Each milestone's PRs include the docs, ADRs and tests for what they change.
- CI must be green: fmt, clippy, tests, wasm, Playwright, schema drift, the frozen-theme build,
  and Cockpit.

## Rules that reviews enforce

| Rule | Where |
|---|---|
| No floats, `HashMap` iteration, system time, threads or I/O in `sim-core` | [sim.md](../architecture/sim.md) |
| Text never enters the sim; only digests do | [ADR-0011](../adr/0011-orchestrator-owns-state-transitions.md) |
| LLMs return artifacts; the orchestrator transitions | [ADR-0011](../adr/0011-orchestrator-owns-state-transitions.md) |
| Transition (with the command-log entry and the job request) commits before any side effect | [ADR-0008](../adr/0008-postgres-only-infrastructure.md) |
| Agents reference indexed ids only | [ADR-0013](../adr/0013-closed-world-knowledge-indexes.md) |
| The renderer draws render state and decides nothing | [ADR-0007](../adr/0007-sim-renderer-render-state-contract.md) |
| Prompt block docs are generated from schemas | [content-model.md](../architecture/content-model.md) |
| Stubs fail loudly (blocked stage + ticket) | [overview.md](../architecture/overview.md#design-rules) |
| Don't touch `packages/site-builder/src/themes/cinque-terre/**` until cutover step 0 or 1 lands | [cutover runbook](../runbooks/cinqueterre-cutover.md) |
| Postgres is the only infrastructure | [ADR-0008](../adr/0008-postgres-only-infrastructure.md) |

## Commit messages

```
feat(sim): integer A* over the room grid (FEAT-004)

Paths are computed in the sim and interpolated by the renderer (ADR 007).
```

End commit messages with any attribution trailers your tooling requires.

## Code style

- **Rust:** `rustfmt` defaults; clippy clean with `-D warnings`; `thiserror` for library errors,
  `anyhow` only in binaries and xtask.
- **TypeScript:** strict mode; Prettier (`.prettierrc`); no default exports in `apps/game/src`
  except Preact components.
- **Markdown:** `.markdownlint.json`; one sentence per line is welcome but not required.
