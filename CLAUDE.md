# swarm.press: development guide

> **Last updated:** 2026-10-02 · **Milestone:** the first real MVP: the owner's company for real (`docs/mvp.md`) · **Branch:** `main`
> **Legacy:** the TypeScript swarm.press is at tag `legacy-ts` (`git show legacy-ts:<path>`).
> Don't port legacy files; re-specify the concepts.

## What swarm.press is

swarm.press is a browser **management sim / digital dollhouse**. Each player is the CEO of an AI
publishing house, shown as a detailed isometric 3D building (Babylon.js, WebGPU with a WebGL2
fallback).
- The staff are LLM agents with persistent personas. Their meetings play out as speech bubbles,
  and their work produces **one real website per player**.
- The company is extensible through a JS SDK.
- The user's own company is the imported, still-live **cinqueterre.travel**.

Full docs: `docs/index.md`. Decisions: `docs/adr/` (ADR-0001…0062; ADR-0038 to 0062 define
the current architecture; ADR-0044 to 0062 are decided and mostly not built yet). Features and
their health: `docs/features/` plus Cockpit. The current MVP is `docs/mvp.md` (the owner's
company for real, on one resident in-browser model); its implementation designs are in
`docs/design/`.

## Architecture in one screen (local-first, ADR-0038)

```
Browser (authoritative for its company)
  apps/game (TS, Vite, cross-origin isolated)
    Babylon scene ◄ render state ◄ client-wasm (sim-core, deterministic)
    Preact overlay (Inbox, Plan, Staff, Finance, Performance)
    orchestration loop: sim Effect::RequestJob → orchestrator (wasm) → commands back into the sim
       ├ LocalLlm: one resident model in a Worker for all staff jobs (ADR-0057; decided, NOT
       │   wired yet): Ternary-Bonsai-2 via an extracted WebGPU engine; Transformers.js is the
       │   fallback; no cloud model and no native model server in the MVP
       ├ store: Turso wasm on OPFS (sqlite-wasm fallback), ADR-0041
       └ extensions: JS bundles in a QuickJS-wasm sandbox with a Bun-style API, ADR-0042/0043
        │ HTTPS + WS (dev login / GitHub OAuth, company lease)
crates/server: central Rust service, SQLite (ADR-0039)
  auth · company lease · content gateway (PathPolicy) → GitHub · events inbox (+ webhooks)
  sync (command-log segments + snapshots) · web fetch proxy (Firecrawl later, credits)
  first-party tracker · (wave 3: credits ledger, Agency jobs on Claude)
Site repos build with @swarm-press/site-kit + an agent-authored theme on GitHub Actions.
```

| Path | What |
|---|---|
| `crates/sim-core` | deterministic sim: org, staff, projects, plan, economy, inbox, job contract, `render_state()` |
| `crates/client-wasm` | `wasm-bindgen` facade (`Sim`) used by the browser and the Bun runner |
| `crates/orchestrator` | wasm-compatible job runner: `Orchestrator<Store, Gateway>`, MemStore/FakeGateway/GithubGateway |
| `crates/agents` | roles, personas, prompt layering, meetings, `draft_step`/`review_step`, `Llm` trait |
| `crates/claude` | Messages API client (feature `http`; pure parts compile to wasm) |
| `crates/server` | central service (axum, sqlx-sqlite) |
| `crates/{content-schema,knowledge,github,protocol,testkit}` | page validation, indexes, GitHub client and fakes, wire types, test helpers |
| `apps/game` | Babylon client, overlay UI, local LLM runtime |
| `packages/sdk`, `packages/sandbox`, `packages/runner` | extension SDK, QuickJS sandbox, the `swarmpress` CLI (Bun) |
| `packages/content-schema`, `packages/tracker` | Zod page schema → `page.schema.json`; cookieless tracker |
| `packages/site-kit`, `themes/starter` | Astro integration + starter theme |
| `examples/extensions/*` | SDK examples |
| `packages/site-builder/src/themes/cinque-terre` | **FROZEN**: the live site builds it |
| `xtask` | `cargo xtask wasm [--release]`, `cargo xtask site-pack <site-dir> [--out file]` |

## Critical rules (never break these)

1. **The sim is deterministic.** In `crates/sim-core`:
   - integers and fixed point only: money in cents, stats in permille;
   - `BTreeMap`/`Vec` only, never iterate a `HashMap`;
   - all randomness from `World.rng` (seeded PCG);
   - no `std::time`, no I/O, no threads, no async.

   The same seed plus the same command log gives the same `World::hash` natively, in wasm in the
   browser, and under Bun. Goldens live in sim-core and `packages/runner/test/fixtures/golden.json`.
2. **Text never enters the sim.** LLM output, transcripts and page bodies stay in the store and
   the site repo. They enter the sim only as commands carrying digests:
   `JobCompleted{digest{ok, score, words, qa_defects, artifact_sha}}`, `MeetingOutcome{briefs}`,
   `JobFailed{job_id, reason}` (the reason is an enum), `DeployLanded{work_item}`,
   `DeployFailed{work_item}`, `Utterance{meeting, seq, speaker, chars}`.
3. **The orchestrator owns transitions; LLMs return artifacts.**
   - No LLM tool or extension can approve, merge, publish or change a stage.
   - The sim's state machine decides: the editor approves at a score of 7 or above, with at most
     3 revisions, then Blocked with a ticket. An approved article then waits at the CEO's publish
     gate under `AutonomyPolicy` (ADR-0059): with the default `ApproveAll` it is published only
     on the CEO's `Publish` answer to a `PublishApproval` ticket, which the Secretary can never
     answer and whose default never publishes.
4. **Transition first, then the side effect.** The sim emits `Effect::RequestJob` as part of the
   transition. The orchestrator then does the GitHub and LLM work idempotently, keyed by job id,
   and the results come back as commands appended to the command log.
5. **Closed world.** Agents refer to pages, entities and media only by ids from the knowledge
   indexes. Unknown ids are validation errors returned to the model. Missing knowledge becomes a
   `NEEDS_PAGE` or `NEEDS_MEDIA` ticket.
6. **One source of truth per entity.**
   - Content lives in the site repo, which the player owns (ADR-0047). Asset bytes live in object
     storage; each asset's sidecar lives in the site repo (ADR-0050).
   - Company state is the executor's chain of work records (commands plus the text each job
     wrote, with attribution) and its snapshots, synced centrally as write-once segments
     (ADR-0056).
   - Plan text, transcripts and artifacts are text records in that chain; the store's tables
     are a projection rebuilt from it.
   - Accounts, leases and epochs, the log head, the job ledger, events and the billing ledger
     live in central SQLite.
   - Asset storage, work records, the job ledger and the billing ledger are decided and not built
     yet (build order in `docs/architecture/commercial-model.md`).
7. **The lease-holding executor is authoritative for its company.**
   - An executor is a browser or a runner. Only the lease holder writes, and the lease epoch
     fences every write: gateway, sync, job ledger and paid spend (ADR-0045).
   - The browser never holds platform credentials: the central gateway and credential proxy do.
     A player may hold their own provider keys on their own device (ADR-0054).
   - Epochs and fencing are decided and not built yet: today the lease is a random id, checked
     on gateway routes only.
   - Leaderboards trust only facts that replay (challenges) or are audited from the live site.
8. **The render-state contract.** The renderer draws exactly `render_state()` and decides
   nothing. New visual facts need a contract change (`docs/architecture/render-state.md`).
9. **The frozen theme path.** `packages/site-builder/src/themes/cinque-terre/**`, its glob in
   `pnpm-workspace.yaml` and its `pnpm-lock.yaml` entries stay byte-identical until cutover step
   0 or step 1 lands (`docs/runbooks/cinqueterre-cutover.md`). Lockfile changes must be purely
   additive for existing importers.
10. **QuestionTickets are the only channel to the CEO.** Every ticket has a `default_option` and a
    `deadline_step`.
11. **Stubs fail loudly.** An unimplemented executor or stage blocks the project and opens a
    ticket. It never "succeeds" with a placeholder.
12. **Content is JSON blocks with `LocalizedString` (`en` required).** Renderers never parse
    Markdown. Prompt block docs are generated from the schemas.
13. **Minimal infrastructure.**
    - In the browser: Turso wasm (sqlite-wasm fallback).
    - Centrally: one Rust binary with SQLite is the whole control plane.
    - Object storage and runner containers are allowed as the data and compute plane (ADR-0049).
    - SQL is written in the plain SQLite subset Turso also accepts (ADR-0041): no extensions,
      FTS, virtual tables or generated columns.
    - No Postgres, Temporal, NATS, Redis or external queues.
14. **Extensions run only in the sandbox.**
    - JS bundles execute inside QuickJS-wasm with granted capabilities only, in the browser and in
      the runner alike.
    - Sim-rule output is logged as commands, so replay never re-executes JS.
15. **Decisions change through ADRs.** Write a new ADR in Cockpit's dialect: `# ADR-NNNN —
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

# dev (see docs/guides/getting-started.md)
cp .env.example .env && set -a && . ./.env && set +a
cargo run -p server --bin swarmpress-server    # central service, SQLite in ./data, fake GitHub + dev login
pnpm dev                                      # cargo xtask wasm + Vite (apps/game)
pnpm swarmpress run --days 3                    # headless game on Bun (SDK runner)
cargo xtask wasm --release

# checks
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo nextest run --workspace --profile ci    # → target/nextest/ci/junit.xml
pnpm typecheck
pnpm test                                     # content-schema scripts + apps/game vitest
pnpm test:sdk                                 # sdk, sandbox, runner (bun test)
cargo build -p orchestrator --target wasm32-unknown-unknown
pnpm schema:check                             # Zod ↔ committed page.schema.json drift
pnpm --filter @swarm-press/game build && pnpm test:e2e     # Playwright (webgpu + fallback)
(cd apps/game && pnpm exec vitest run --reporter=default --reporter=junit \
   --outputFile.junit=reports/vitest-junit.xml)            # → apps/game/reports/ (Cockpit evidence)

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
| The current MVP: milestones, tracks, increments, what "done" means | `docs/mvp.md` |
| MVP implementation designs (runtime, pipeline, publish gate, game time, site path, gap analysis) | `docs/design/`, ADR-0057…0062 |
| Local-inference and agent-loop principles (the owner's concept document) | `docs/reference/browser-agent-studio.md` |
| Stage 0 contract, central HTTP API | `docs/mvp.md` (Stage 0), `crates/server/README.md` |
| Local-first, storage, SDK | ADR-0038…0043, `docs/architecture/sdk.md`, `docs/guides/extending.md` |
| Commercial model, executors, continuity, pricing, assets (decided, not built) | ADR-0044…0056, `docs/architecture/commercial-model.md` |
| Render state | `docs/architecture/render-state.md` |
| Roles, personas, prompts, pipelines, meetings, QA | `docs/architecture/agents.md` |
| Local LLMs and the Agency | `docs/architecture/hybrid-inference.md` |
| Blocks, LocalizedString, indexes | `docs/architecture/content-model.md` |
| Site kit and themes | `docs/architecture/site-kit.md` |
| Babylon, cutaway, lighting, tiers | `docs/architecture/lighting-and-rendering.md` |
| Game rules and numbers | `docs/game-design/` |
| Tests and Cockpit | `docs/guides/testing.md` |
| Live-site migration | `docs/runbooks/cinqueterre-cutover.md` |
