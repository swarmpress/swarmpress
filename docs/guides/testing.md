# Testing and evidence (Cockpit)

SimPress doesn't declare features done. It **derives** their health from evidence. CI runs every
suite on every PR. [Cockpit](https://github.com/drietsch/cockpit) then reads the reports, the
feature files, the ADRs and git history, and gives each feature a state: **Healthy**, **Needs
Attention**, **Broken** or **Unknown**. Missing evidence is Unknown, never green
([ADR-0022](../adr/0022-testing-strategy-cockpit-evidence-gate.md)).

## Install Cockpit

Cockpit pins Rust **1.98.0**. Install that toolchain alongside the workspace toolchain:

```sh
rustup toolchain install 1.98.0 --profile minimal
cargo +1.98.0 install --git https://github.com/drietsch/cockpit --locked --root ~/.local
# or, from a local clone:
cargo +1.98.0 install --path /path/to/cockpit --locked --root ~/.local
export PATH="$HOME/.local/bin:$PATH"
cockpit --version          # cockpit 0.1.0
cargo install cargo-nextest --locked
```

## Produce evidence, then gate

These are the exact commands used to bring the M0 tree to a green `validate --strict`, run from
the repo root:

```sh
# 1. Rust (sim-core, protocol, content-schema, client-wasm …) → target/nextest/ci/junit.xml
cargo nextest run --workspace --profile ci

# 2. Playwright first: it empties apps/game/test-results/ before it runs
pnpm --filter @swarm-press/game build
cd apps/game
CI=1 PLAYWRIGHT_JSON_OUTPUT_NAME=test-results/playwright.json \
  pnpm exec playwright test --reporter=json,list
#    (in this sandbox, Chromium comes from PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers)

# 3. vitest with JUnit → apps/game/test-results/vitest-junit.xml
pnpm exec vitest run --reporter=default --reporter=junit \
  --outputFile.junit=test-results/vitest-junit.xml
cd ../..

# 4. Cockpit
cockpit scan
cockpit status
cockpit validate --strict
```

Expected result at M0:
- `validate --strict` prints `0 errors, 0 warnings → exit 0`.
- `cockpit status` lists 9 Healthy features (from the existing Rust and vitest suites) and 42
  Unknown features (planned, no suites yet).
- FEAT-017 (WebGPU engine and fallback) depends on the Playwright smoke test. That test is
  currently failing and shows the feature as **Broken**: see "Known failing evidence" below.

Other useful commands:

```sh
cockpit serve --watch                         # dashboard on http://127.0.0.1:4747
cockpit feature FEAT-001                      # definition of done + evidence for one feature
cockpit attention                             # ranked list of what needs looking at
cockpit query 'state = unknown and importance in (critical, high)'
cockpit pull                                  # fetch the newest CI artifacts per [evidence.github]
cockpit doctor                                # which evidence sources have files
```

## Suites and where their evidence goes

| Suite (`cockpit.toml` id) | Command | Report |
|---|---|---|
| `simpress/nextest`, split into `server/`, `agents/`, `claude/`, `github/`, `knowledge/`, `content/`, `net/nextest` | `cargo nextest run --workspace --profile ci` | `target/nextest/ci/junit.xml` (`.config/nextest.toml`) |
| `simpress/wasm-bindgen-test` | `cargo xtask wasm-test` (node and headless Chromium) | `target/wasm-test/junit.xml` |
| `game/vitest` | `vitest run --reporter=junit --outputFile.junit=test-results/vitest-junit.xml` | `apps/game/test-results/vitest-junit.xml` |
| `content-schema/vitest` | same, in `packages/content-schema` (its tests are tsx scripts today, so this source is unfed) | `packages/content-schema/test-results/vitest-junit.xml` |
| `site-kit/vitest`, `site-kit/playwright` | in `packages/site-kit` | `packages/site-kit/test-results/…` |
| `game/playwright-e2e` | `playwright test --reporter=json` | `apps/game/test-results/playwright.json` |
| `game/playwright-visual` | visual project (frozen sim times × 4 angles) | `apps/game/test-results/playwright-visual.json` |
| `simpress/criterion` | `cargo bench -p sim-core` | `target/criterion/**/new/estimates.json` |
| `bench/bundle-size`, `bench/frame-time`, `bench/agent-pipeline` | small reporters (below) | `artifacts/bench/<name>*.json` |
| `bench/server-load`, `bench/model-eval` | nightly | `artifacts/bench/<name>*.json` |

In CI, each job uploads its report as the artifact named in that source's `[evidence.github]`.
The final job runs `cockpit scan && cockpit validate --strict`. Locally, `cockpit pull` downloads
those artifacts into `.cockpit/evidence/` (git-ignored).

## How tests link to features

Precedence (Cockpit ADR-0010): an explicit tag in the test → `docs/test-map.yaml` → `paths:`
ownership in the feature file.

- **vitest:** the source path is `apps/game/<classname>`, for example
  `apps/game/src/render/cutaway.test.ts`. List the test file in the feature's `paths`.
- **Playwright:** the spec file (`apps/game/e2e/smoke.spec.ts`).
- **nextest:**
  - A test in a module resolves to that module's file (`crates/sim-core/src/clock.rs`), so the
    feature's `paths` cover it.
  - A test in `src/lib.rs`'s `mod tests` resolves to the crate's `src` directory, which every
    feature of that crate would own. Map it in [`docs/test-map.yaml`](../test-map.yaml) instead,
    by `classname` (the Cargo package) and a `title` substring.
- **Explicit:** a JUnit `<property name="feature" value="FEAT-012"/>`, or the lowercase, underscored suffix `__feat__feat_012` in
  a test name.

## Add a feature

1. Pick the chapter (`docs/features/{sim,net,render,agents,inference,content,ops}/`) and the next
   free id (`cockpit query 'features' --format ids`).
2. Create `docs/features/<chapter>/NNN-short-slug.md`:

   ```markdown
   ---
   id: FEAT-053
   title: "Weather from the region's real forecast"
   status: planned            # planned | in-progress | stable | deprecated
   importance: normal         # critical | high | normal | low
   paths:
     - crates/sim-core/src/weather.rs
     - crates/server/src/weather/**
     - apps/game/src/render/weather.test.ts
   adrs:
     - ADR-0006
   ---

   # Weather from the region's real forecast

   What it is, in two or three sentences.

   ## Acceptance criteria

   - [ ] A checkable statement, ideally one per test.

   ## Evidence

   - `simpress/nextest`, `game/vitest`
   ```

3. Add a row to the chapter's `_chapter.md` table.
4. Run `cockpit scan && cockpit validate --strict`. Broken ADR references and bad frontmatter
   are errors.

Rules:
- `planned` features are exempt from evidence requirements.
- Once a feature is `in-progress` or `stable`, **critical and high features need passing test
  evidence** (`[health] required_evidence`). Under `--strict`, a high feature with no evidence at
  all is an error.
- Mention `FEAT-0xx` (and `ADR 0xx`) in commit messages.

## Add a test suite

1. Make the runner write a machine-readable report: JUnit, Playwright JSON, Criterion, or a
   `cockpit.benchmark.v1` or `cockpit.visual.v1` document.
2. Add an `[[evidence]]` entry to `cockpit.toml`:

   ```toml
   [[evidence]]
   id = "server/loadtest"           # <source>/<suite>
   title = "server load test"
   format = "junit"                 # junit | playwright | criterion | cockpit-benchmark | cockpit-visual
   kind = "integration"             # unit | integration | e2e | visual | benchmark | conformance
   path = [".cockpit/evidence/server__loadtest/**/*.xml", "target/loadtest/junit.xml"]
   component = "server"
   [evidence.github]
   repo = "swarmpress/swarmpress"
   workflow = "ci.yml"
   artifact = "server-loadtest-junit"
   branch = "main"
   ```

3. In `.github/workflows/ci.yml`, upload the report with `actions/upload-artifact` under exactly
   that artifact name.
4. Make sure the test files sit under some feature's `paths`, or add test-map entries.
5. Run `cockpit doctor` to confirm the source finds its files.

## Add a benchmark document

Reporters write `cockpit.benchmark.v1` JSON to `artifacts/bench/`. Example: the wasm bundle size
reporter (`artifacts/bench/bundle-size.json`):

```json
{
  "schema": "cockpit.benchmark.v1",
  "name": "bundle-size",
  "feature_ids": ["FEAT-017"],
  "component": "render",
  "provenance": {
    "commit": "<git rev-parse HEAD>",
    "branch": "main",
    "dirty": false,
    "generated_at": "2026-10-01T12:00:00Z",
    "tool": { "name": "xtask-bundle-size", "version": "0.2.0" }
  },
  "build": { "profile": "wasm-release" },
  "machine": { "os": "linux", "arch": "x86_64", "runner": "github-actions" },
  "workload": { "target": "wasm32-unknown-unknown" },
  "metrics": [
    { "name": "wasm.bytes", "subject": "client_wasm_bg.wasm", "unit": "bytes", "value": 412345,
      "determinism": "deterministic", "direction": "lower_is_better", "budget": { "max": 3145728 } },
    { "name": "js.gzip_bytes", "subject": "index.js", "unit": "bytes", "value": 1558810,
      "determinism": "deterministic", "direction": "lower_is_better" }
  ]
}
```

Determinism classes decide gating:
- **deterministic** metrics (sizes, call and token counts from FakeClaude runs) regress at 0%
  noise and gate.
- **semi-deterministic** metrics gate at 10%.
- **environment-sensitive** metrics (frame time, live LLM latency, tokens/sec) are informational
  only.

Defaults per metric name live in `[[performance.metrics]]` in `cockpit.toml`.

Planned reporters:

| Document | Metrics | Class |
|---|---|---|
| `bundle-size` | `wasm.bytes`, `js.gzip_bytes`, `assets.download_bytes` | deterministic |
| `frame-time` | `frame.p95_ms`, `draw_calls` per scene × quality tier | environment-sensitive |
| `agent-pipeline` | `claude.calls`, `tokens.in`, `tokens.out`, `wall_ms` per article (FakeClaude: deterministic; live: environment-sensitive) | mixed |
| `server-load` | `companies_per_core`, `step_lag_p99_ms` | environment-sensitive |
| `model-eval` | `rubric.score`, `tokens_per_sec` per registry model | environment-sensitive |

## Test inventory by subsystem

| Subsystem | Tests |
|---|---|
| sim-core | Unit tests per system; `proptest` invariants (cash conserved, no staff in walls, commands validate or reject, no panics); golden determinism (scripted 50k-step log, same hash natively and in wasm); criterion step and pathfinding with budgets; `cargo-fuzz` on command decoding (nightly) |
| protocol | Round-trips; `insta` snapshots of encodings; version compatibility |
| content-model, knowledge | Zod/Rust conformance on shared fixtures; link and media resolution; index builders on `crates/testkit/fixtures/cinqueterre-mini` |
| claude | SSE fixtures (text, tool_use, refusal, max_tokens, overloaded/429 retry, fallback); request snapshots (cache_control, no forced tool_choice) |
| agents | Prompt-resolution snapshots; schema-generated block docs; FakeClaude-driven pipelines and meetings (revision loops, rejects, escalations, QA fix loops); opt-in live evals |
| github | FakeGitHub; wiremock contract tests on recorded responses; webhook HMAC |
| server | `sqlx::test` with real Postgres; actor tests under `tokio::time::pause`; job queue lease, crash, retry, idempotency; WS integration (lockstep, desync → resnapshot, reconnect); fake OAuth; **full pipeline** with fakes (standup → brief → draft PR → review → merge → deploy webhook → published); offline catch-up; load test (200 companies, 1 h) |
| client TS | vitest for daylight, camera maths, cutaway, render-state → scene, bubble layout, overlay components (@testing-library/preact); Babylon **NullEngine** for scene construction, light budgets, materials, device toggles |
| client WebGPU/WebGL2 | Playwright (Chromium): boot on WebGPU (SwiftShader/Vulkan) and WebGL2; shader errors fail; visual regression at 08:00/13:00/19:30/23:00 × 4 angles; placement round-trip; inbox flow; axe; frame-time smoke; bundle size |
| local LLM | vitest with `FakeLlm` (contracts, repair loops, GPU scheduler, leader election); server `FakeBrowserWorker`; nightly tiny real ONNX model on SwiftShader WebGPU; model eval harness |
| site-kit and themes | Fixture-site build, block coverage, schema conformance, screenshots, Lighthouse and a11y budgets; cinqueterre parity (page list and HTML structure, old vs new build) |
| live E2E (nightly or manual) | Real Claude and a sandbox org repo: publish one article and one theme tweak; assert HTTP 200 |

## Known failing evidence (M0)

`apps/game/e2e/smoke.spec.ts` fails in both projects. FEAT-017 is therefore **Broken** in
`cockpit status`, while `validate --strict` passes:

- The `fallback` project asserts `renderer === 'webgl'`, but `createEngine()` reports `'webgl2'`.
  The assertion dates from the Pixi prototype.
- The `webgpu` project hits a SwiftShader limit in Babylon's WebGPU engine:
  `createBuffer failed, size (65536) is too large for the implementation when mappedAtCreation
  == true`.

Fixing them is client work tracked under FEAT-017. Cockpit is doing its job by showing the
breakage.
