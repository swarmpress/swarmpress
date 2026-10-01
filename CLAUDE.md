# SimPress: development guide

> **Last updated:** 2026-10-01 · **Milestone:** M0 (Foundations) · **Branch:**
> `claude/simpress-babylon`
> **Legacy:** the TypeScript swarm.press is at tag `legacy-ts` (readable via
> `git show legacy-ts:<path>`). Don't port legacy files; re-specify the concepts.

## What SimPress is

SimPress is a browser **management sim / digital dollhouse**. Each player is the CEO of an AI
publishing house, shown as a detailed isometric 3D building (Babylon.js, WebGPU with a WebGL2
fallback).
- The staff are LLM agents. Their meetings play out as speech bubbles, and their work produces
  **one real website per player**.
- The design department designs and evolves that site's theme.
- The user's own company is the imported, still-live **cinqueterre.travel**.

Full docs: `docs/index.md`. Decisions: `docs/adr/` (ADR-0001…0027). Features and their health:
`docs/features/` plus Cockpit.

## Architecture in one screen

```
apps/game (TS, Vite) ── Babylon scene ◄ render state ◄ client-wasm (sim-core replica)
                     ── Preact overlay · LocalLlm worker (WebGPU) for staff jobs
        │ WebSocket, postcard frames, lockstep + hash checks
crates/server (axum, tokio) ── company actors (authoritative sim-core, 10 Hz)
   ├ command log + daily snapshots (Postgres)
   ├ job queue (Postgres SKIP LOCKED) → crates/agents (pipelines, meetings, QA) → crates/claude
   ├ browser job worker protocol (leases, server-side artifact validation)
   ├ crates/knowledge (closed-world indexes) · crates/content-model (schemas)
   └ crates/github (GitHub App) → one site repo per company ◄ webhooks
Postgres is the ONLY infrastructure. Site repos build with @swarm-press/site-kit on GitHub Actions.
```

| Path | What | Exists at M0 |
|---|---|---|
| `crates/sim-core` | deterministic sim (`World`, clock, hash; later building, staff, projects, economy, events, inbox, `render_state()`) | clock + hash |
| `crates/protocol` | WS frames, commands, snapshots (postcard, `PROTO_VERSION`) | `Hello` |
| `crates/client-wasm` | `wasm-bindgen` facade (`Sim`) | yes |
| `crates/content-schema` | Rust page validator over the exported JSON Schema (→ `content-model` in M3) | yes |
| `crates/{knowledge,claude,agents,github,server,testkit}` | see `docs/architecture/` | being built |
| `apps/game` | Babylon client: engine, iso camera, cutaway, office, lighting, post-FX, HUD | yes |
| `packages/content-schema` | Zod source of the page schema → `page.schema.json` | yes |
| `packages/site-kit`, `themes/starter` | Astro integration + starter theme | planned (M3) |
| `packages/site-builder/src/themes/cinque-terre` | **FROZEN**: the live site builds it | yes (do not touch) |
| `xtask` | `cargo xtask wasm [--release]` | yes |
| `docs/` | architecture, game-design, guides, runbooks, adr, features | yes |

## Critical rules (never break these)

1. **The sim is deterministic.** In `crates/sim-core`:
   - integers and fixed point only: money in cents, stats in permille;
   - `BTreeMap`/`Vec` only, never iterate a `HashMap`;
   - all randomness from `World.rng` (seeded PCG);
   - no `std::time`, no I/O, no threads, no async.

   The same seed plus the same command log must give the same `World::hash` natively and in wasm.
2. **Text never enters the sim.** LLM output, transcripts and page bodies enter only as
   server-issued commands carrying digests: `Cmd::JobCompleted{digest{ok, score, words,
   qa_defects, artifact_sha}}`, `Cmd::Utterance{meeting, seq, speaker, chars}`.
3. **The orchestrator owns transitions; LLMs return artifacts.**
   - No LLM tool can approve, merge, publish or change a stage.
   - Pipelines are Rust state machines. The editor approves at a score of 7 or above, with at
     most 3 revisions, then a ticket.
4. **Transition first, then the side effect.**
   - The state transition, its command-log entry and the `Effect::RequestJob` commit in one
     Postgres transaction.
   - GitHub and Claude calls happen afterwards, idempotently, keyed by job id.
   - Results come back as commands.
5. **Closed world.**
   - Agents refer to pages, entities and media only by ids from the knowledge indexes.
   - Unknown ids are validation errors, returned to the model.
   - Missing knowledge becomes a `NEEDS_PAGE` or `NEEDS_MEDIA` ticket, never an invention.
6. **One source of truth per entity.** Content lives in the site repo; gameplay state in the
   command log and snapshots; transcripts and `llm_calls` in Postgres.
7. **The server is authoritative.**
   - Clients send `ClientCommand`s, which are validated by the shared `validate_command`.
   - The browser never holds GitHub credentials, and the server validates every browser-produced
     artifact (schema, links and media, size, injection hygiene).
8. **The render-state contract.**
   - The renderer draws exactly `render_state()` and decides nothing: lights, monitors, poses,
     positions and time of day.
   - Paths are computed in the sim, and the renderer only interpolates.
   - New visual facts need a contract change (`docs/architecture/render-state.md`).
9. **The frozen theme path.** `packages/site-builder/src/themes/cinque-terre/**`, its glob in
   `pnpm-workspace.yaml` and its lockfile entries stay byte-identical until cutover step 0 (pin
   `ref: legacy-final`) or step 1 lands. The live cinqueterre.travel deploy checks out this repo.
   See `docs/runbooks/cinqueterre-cutover.md`.
10. **QuestionTickets are the only channel to the CEO.** Every ticket has a `default_option` and a
    `deadline_step`.
11. **Stubs fail loudly.** An unimplemented executor or stage blocks the project and opens a
    ticket. It never "succeeds" with a placeholder.
12. **Content is JSON blocks with `LocalizedString` (`en` required).**
    - Read values through `localize()` / `getLocalizedValue()`.
    - Renderers never parse Markdown.
    - Prompt block docs are generated from the schemas.
13. **Postgres only.** No Temporal, NATS, Redis or queues beyond the `jobs` table with `SKIP
    LOCKED` and `LISTEN/NOTIFY`.
14. **Decisions change through ADRs.** Write a new ADR in Cockpit's dialect: `# ADR-NNNN —
    Title`, `**Status:**`, `**Date:**`, then Context, Decision and Consequences, including the
    alternatives and the negatives. Accepted ADRs are superseded, never rewritten.

## Testing and evidence (Cockpit)

Health is derived, never declared. Don't tick boxes in docs. Write tests that Cockpit can link.

- Every feature is a file at `docs/features/<chapter>/NNN-slug.md`, with frontmatter `id`
  (`FEAT-NNN`), `title`, `status` (planned / in-progress / stable), `importance`, `paths` and
  `adrs`. Its `paths` must cover the code **and the test files**. Rust unit tests in `src/lib.rs`
  are mapped in `docs/test-map.yaml`.
- `cockpit.toml` registers every suite: nextest JUnit (split per crate), wasm-bindgen-test,
  vitest, Playwright e2e and visual, Criterion, and `cockpit.benchmark.v1` documents in
  `artifacts/bench/`.
- **Critical and high features that are not `planned` must have passing test evidence.** `cockpit
  validate --strict` is the CI gate.
- Commit messages mention `FEAT-0xx` (and `ADR 0xx`).
- When you start implementing a planned feature, switch it to `in-progress` in the same PR that
  adds its tests.

## Commands

```sh
# setup
pnpm install
cargo install cargo-nextest --locked
cargo install wasm-bindgen-cli --version 0.2.100
rustup toolchain install 1.98.0 --profile minimal
cargo +1.98.0 install --git https://github.com/drietsch/cockpit --locked --root ~/.local   # cockpit

# dev
pnpm dev                                      # cargo xtask wasm + Vite (apps/game)
cargo xtask wasm --release

# checks
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo nextest run --workspace --profile ci    # → target/nextest/ci/junit.xml
pnpm typecheck
pnpm test                                     # content-schema scripts + apps/game vitest
pnpm schema:check                             # Zod ↔ committed page.schema.json drift
pnpm --filter @swarm-press/game build && pnpm test:e2e     # Playwright (webgpu + fallback)
(cd apps/game && pnpm exec vitest run --reporter=default --reporter=junit \
   --outputFile.junit=test-results/vitest-junit.xml)       # run AFTER Playwright (it empties test-results/)

# evidence gate
cockpit scan && cockpit status
cockpit validate --strict
cockpit serve --watch                         # http://127.0.0.1:4747
```

## Where to look

| Topic | Doc |
|---|---|
| System, data flow, design rules | `docs/architecture/overview.md` |
| Sim entities, systems, commands, pipeline stages | `docs/architecture/sim.md` |
| Frames, lockstep, REST | `docs/architecture/protocol.md` |
| Render state | `docs/architecture/render-state.md` |
| Roles, personas, prompts, pipelines, meetings, QA | `docs/architecture/agents.md` |
| Local LLMs and the Agency | `docs/architecture/hybrid-inference.md` |
| Blocks, LocalizedString, indexes | `docs/architecture/content-model.md` |
| Site kit and themes | `docs/architecture/site-kit.md` |
| Babylon, cutaway, lighting, tiers | `docs/architecture/lighting-and-rendering.md` |
| Game rules and numbers | `docs/game-design/` |
| Tests and Cockpit | `docs/guides/testing.md` |
| Live-site migration | `docs/runbooks/cinqueterre-cutover.md` |
