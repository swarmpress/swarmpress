# Runbook: qualify a local model backend

> **Decides:** go or no-go for the resident in-browser model (ADR-0057; increment R7 of track R in
> [`docs/mvp.md`](../mvp.md)). The harness is increment R6.
> **Thresholds:** [`docs/design/mvp-runtime.md`](../design/mvp-runtime.md) section 7. They are
> proposals until the first report fills them in.
> **Target machine:** Apple M3 Max, 128 GB, macOS 26.4, Chrome 154.0.8037.95.

The harness is `apps/game/bench.html` (code in `apps/game/src/llm/bench/`), driven by
`apps/game/e2e/bonsai-bench.spec.ts` through `playwright.bonsai.config.ts`. One run opens one
backend, loads its model, runs the fixtures, optionally with the office scene drawing beside it,
and writes the reports. A run never switches to another backend: if the chosen one cannot start,
the run fails and says why.

## Prerequisites

- **Chrome** installed (Playwright launches the `chrome` channel, headed). WebGPU is on by default
  on macOS. No flags are needed to run. Whether Chrome 154 exposes
  `chromium-experimental-subgroup-matrix` (the fastest prefill kernels) without a flag is not
  known; the run records the adapter's features, so look at "Model GPU device" in the report. If
  you try a flag, pass it with `BONSAI_CHROME_ARGS` and give the run its own machine name
  (`BENCH_MACHINE=apple-m3-max-128gb-flags`) so its report stays separate and is labelled.
- **Disk:** about 6 GB for the Bonsai weights, kept in the Chrome profile
  `apps/game/.bonsai-profile/` (IndexedDB, git-ignored). The Chrome backend needs Chrome's own
  on-device model; Chrome decides where it goes and how much free space it wants.
- **Network:** only for the first Bonsai load (5.95 GB from huggingface.co, pinned by revision and
  sha256) and the engine fetch below. Nothing is sent anywhere during a run.
- **Setup**, from the repository root:

  ```sh
  pnpm install
  cargo xtask wasm                                   # client-wasm and orchestrator-wasm (the Rust validator)
  node apps/game/scripts/bonsai-runtime.mjs          # fetch the pinned engine into apps/game/public/vendor/bonsai/ (git-ignored)
  node apps/game/scripts/bonsai-runtime.mjs --check  # verify it against runtime.lock.json
  ```

  The engine is unlicensed upstream and is **never committed**; check
  `git ls-files apps/game/public/vendor` is empty before any commit.
- **Keep the browser profile on the internal SSD.** The default profile is inside the repository;
  if the repository is on an external disk, every warm start reads the 6 GB of weights from it (on
  the owner's USB volume: 4.0 min to ready instead of 11.5 s). Point `BONSAI_PROFILE` at an
  internal path, for example `BONSAI_PROFILE=$HOME/Library/Caches/swarmpress-bonsai-profile`, and
  use it for every run.
- Close other GPU-heavy apps, plug the machine in, and keep the Chrome window visible: a hidden tab
  stops the scene's frames (they are not counted) and may slow the worker.
- **Smoke-test every backend before a long run:**
  `BENCH_QUALITY=off BENCH_FIXTURES=a BENCH_SCALE=0.1 BENCH_LABEL=smoke bench` (with that backend's
  `BENCH_LLM`). On the owner's M3 Max, generating with Ternary Bonsai 2 made the machine stop
  responding until WindowServer restarted and ended the login session
  ([`2026-10-05-bonsai-apple-m3-max-128gb-stability.md`](../qualification/2026-10-05-bonsai-apple-m3-max-128gb-stability.md)).
  Save open work first.

## The runs

Every command runs in `apps/game/` and calls the qualification spec, written `bench` below (a shell
function; the settings are environment variables in front of it, which works in zsh and bash). The
terminal prints each stage and every fifth call. The test fails only when a run did not complete; a
no-go is a result, not a failure.

```sh
cd apps/game
bench() { pnpm exec playwright test -c playwright.bonsai.config.ts --project=bonsai e2e/bonsai-bench.spec.ts "$@"; }
```

### Ternary Bonsai 2 (`BENCH_LLM=bonsai`, the default)

| # | Run | Command | Expected time |
|---|---|---|---|
| 1 | Cold start: empty profile, the weights download | `rm -rf .bonsai-profile && BONSAI_E2E=1 BENCH_SUITE=load BENCH_START=cold bench` | the download (5.95 GB at your bandwidth: about 1 min at 1 Gbit/s, 8 min at 100 Mbit/s) plus about 1 min of GPU load |
| 2 | Warm start: five loads from the browser cache | `BONSAI_E2E=1 BENCH_SUITE=load BENCH_START=warm BENCH_RELOADS=4 bench` | about 5 min |
| 3 | The full suite, scene at medium, two more warm loads | `BONSAI_E2E=1 BENCH_SUITE=full BENCH_QUALITY=medium BENCH_RELOADS=2 bench` | about 4 h at the go thresholds, about 9 h at the no-go ones |
| 4 | Frame times at the other tiers | `BONSAI_E2E=1 BENCH_SUITE=frames BENCH_QUALITY=low bench`, then `BENCH_QUALITY=high` | 10 to 25 min each |
| 5 | Device loss and recovery | `BONSAI_E2E=1 BENCH_SUITE=load BENCH_LOSS=manual bench` | about 5 min |
| 6 | Soak: 20 passes for the device-loss row | `BONSAI_E2E=1 BENCH_REPEAT=20 BENCH_SCALE=0.1 BENCH_QUALITY=medium bench` | 9 to 20 h (overnight) |
| 7 | The equivalence gate | `BONSAI_E2E=1 pnpm exec playwright test -c playwright.bonsai.config.ts --project=bonsai e2e/bonsai-equivalence.spec.ts` | about 10 min |

- Before run 3, a quick sanity pass catches problems in an hour or two:
  `BONSAI_E2E=1 BENCH_SCALE=0.2 BENCH_LABEL=sanity bench`. Its validity row says "insufficient data"
  (fewer than 50 prompts per fixture); that is expected.
- Run 5 needs the GPU process to crash. The spec opens `chrome://gpucrash` in a second tab; whether
  automation is allowed to open that page is not verified. If nothing happens, open
  `chrome://gpucrash` in the test's Chrome window yourself: the page waits three minutes.
  `BENCH_LOSS=hook` destroys the model's GPU device from the page instead: the harness then starts
  the worker in debug mode, and the worker's `destroyDevice` command (honoured only in that mode)
  destroys the Bonsai engine's device the way a loss would take it. It works for the scripted and
  the Bonsai backends; a destroyed device is not a GPU-process crash, so the manual step stays the
  one that measures that.
- Run 6 defines a "full-suite run" as every fixture at a tenth of its prompts (one staged article,
  five sections, and so on): 20 passes of the whole suite would take days. That is a choice of this
  harness, not of the design; say so when you read the row.
- Long runs: `BENCH_TIMEOUT_MIN` (default 720) is the test's limit; one call gives up after
  `BENCH_CALL_TIMEOUT_S` (default 900) and is recorded as a timeout. A backend that does not answer
  even a cancel stops the run; what it measured until then is written anyway.
- The equivalence step inside run 3 compares the adapter with upstream's own benchmark, both in the
  worker, and checks the recorded golden for this GPU. The main-thread reference is run 7; the row
  needs both at zero.

### Chrome built-in AI (`BENCH_LLM=chrome`)

Chrome manages this model; the report labels it "Chrome built-in AI (browser-managed)".

| Run | Command |
|---|---|
| Cold start (Chrome has not got its model; the spec clicks Start, which is the gesture the download needs) | `BONSAI_E2E=1 BENCH_LLM=chrome BENCH_SUITE=load BENCH_START=cold bench` |
| Warm start | `BONSAI_E2E=1 BENCH_LLM=chrome BENCH_SUITE=load BENCH_START=warm BENCH_RELOADS=4 bench` |
| Full suite, scene at medium | `BONSAI_E2E=1 BENCH_LLM=chrome BENCH_QUALITY=medium bench` |
| Frames at low and high | `BONSAI_E2E=1 BENCH_LLM=chrome BENCH_SUITE=frames BENCH_QUALITY=low bench` (then `high`) |

- For the Chrome backend the spec drops Playwright's `--disable-background-networking` and
  `--disable-component-update`, which would keep Chrome from fetching its model. Whether the Prompt
  API is available to web pages in Chrome 154 without a flag or an origin trial is not verified: the
  probe says so, and the run then fails with the reason.
- The 8K context fixture is expected to exceed this model's context; those calls are recorded as
  failures ("context window exceeded"). Equivalence and GPU bytes do not apply (n/a, not measured).
- Its timings are unknown; expect the full suite in one to three hours.

### The Transformers.js fallback (`BENCH_LLM=transformers`)

Step 5 of the fallback ladder: Qwen3-4B q4f16 on onnxruntime-web (about 2.8 GB on first load).
The same commands with `BENCH_LLM=transformers`. The adapter reports no prefill time and no
reasoning tokens, so those rows read "not measured".

### Retuning the same model (step 1 of the fallback ladder)

`BENCH_CONTEXT=8192`, `BENCH_THINKING=off` and `BENCH_DEPTH=<n>` change the run without changing
code. Give a retuned run its own machine name (`BENCH_MACHINE=apple-m3-max-128gb-8k-nothink`) so
its report does not mix with the default one.

## Where the files land

| File | What | Committed |
|---|---|---|
| `artifacts/bench/raw/bench-<backend>.<machine>.<label>.json` | Everything one run measured, every call | no (`artifacts/` is ignored) |
| `artifacts/bench/model-eval-<backend>.<machine>.json` (full run) and `….<label>.json` (others) | `cockpit.benchmark.v1`, evidence source `bench/model-eval` | no |
| `artifacts/bench/frame-time-llm-<tier>.json` (Bonsai), `frame-time-llm-<tier>.<backend>.json` (others) | `cockpit.benchmark.v1`, evidence source `bench/frame-time` | no |
| `docs/qualification/<date>-<backend>-<machine>.md` | The go/no-go report over every raw run kept for that backend on that machine | **yes**, once frozen |

`<machine>` is the CPU and memory (`apple-m3-max-128gb`) unless `BENCH_MACHINE` says otherwise;
`<label>` is `load-cold`, `load-warm`, `full`, `frames-<tier>`, `device-loss`, `soak` or
`BENCH_LABEL`. A run with the same label replaces the earlier one. Every run rewrites the day's
report from all the raw files; to rewrite it without a browser:

```sh
BONSAI_E2E=1 BENCH_REPORT_ONLY=1 BENCH_LLM=bonsai bench
```

After the runs, `cockpit scan && cockpit doctor` (from the repository root) lists the documents
under `bench/model-eval` and `bench/frame-time`.

## Reading the report

The table at the top is the one of the design document, with what was measured and a verdict per
row:

- **go:** meets the go threshold. **NO-GO:** past the no-go threshold. **conditional:** between
  the two (prefill between 100 and 300 tok/s is go only with prefix snapshots and contexts of 4K or
  less). **insufficient data:** too few samples to decide (validity needs 50 distinct prompts per
  structured fixture; device loss needs 20 passes). **not measured:** the run that measures it was
  not made, or the backend does not report it. **n/a:** the row does not apply to this backend.
- The overall verdict: one NO-GO decides; any row not measured or with too little data leaves it
  INCOMPLETE; otherwise conditional rows make it CONDITIONAL; otherwise GO.
- Notes under the table say what a row was read from. The sections below it give the load stages,
  each fixture's percentiles and failures (every failed call is listed by kind, never dropped),
  frame times per tier and phase, memory samples, the device-loss record and the runtime events.
- Timings are environment-sensitive: run on a quiet machine, plugged in, and compare like with like.

## On a no-go

1. Read the failing rows and the failures section. A validity no-go with one dominant failure kind
   is often a prompt or budget problem, not the model; a speed no-go is not.
2. Take the next step of the fallback ladder (`docs/design/mvp-runtime.md` section 7), and run the
   same commands for it:
   1. the same model retuned: 8K context, thinking off, a pinned pipeline depth,
      `QWEN35_NO_PREFILL_GRAPH`, Chrome flags (labelled as required);
   2. PQ2_0 through the same engine;
   3. a smaller model of the same architecture through the same engine;
   4. Gemma-4 E2B or LFM2 (their own modules, the same licence problem; LFM2 is too small for
      articles);
   5. the Transformers.js Qwen3-4B path (licence-clean);
   6. Chrome's Prompt API as a labelled mode.
3. Commit the report of every candidate you measured under `docs/qualification/`, including the
   no-go ones, and record the decision in ADR-0057 (increment R7).

Steps 2 to 4 need a new manifest under `apps/game/src/llm/runtime/bonsai/manifest/` (and, for 4,
a new adapter); they are not a setting of this harness.

## The game on the real model (increment R8)

The game page runs on the backend the URL names (`?llm=bonsai|chrome|transformers`), else the
company's stored choice, else Bonsai; `?llm=fake` is the scripted model of the e2e suites. A backend
that cannot run on the device blocks with a notice and is never swapped for another one; the notice
offers the other local backends as an explicit choice for the company (it applies on the next page
load, without `?llm=`).

```sh
pnpm --filter @swarm-press/game bonsai:runtime      # once: the pinned engine into apps/game/public/vendor/bonsai/ (git-ignored)
cp .env.example .env && set -a && . ./.env && set +a
cargo run -p server --bin swarmpress-server        # the central server on 127.0.0.1:8080 (docs/guides/getting-started.md)
pnpm dev                                           # in a second terminal; then open in Chrome:
# http://localhost:5173/?central=1&llm=bonsai&ff=09:00
```

- The office opens at once with the clock held ("Model loading" on the HUD chip). A card in the
  bottom right corner shows the stages: about the model (the first time on this browser: what runs
  where and the download size; nothing is fetched before "Start the model"), check WebGPU, check
  storage (free space, what is cached, whether the browser granted persistence), verify, download
  (bytes; "reading the browser cache" on a warm start), load onto the GPU, warm-up, and a
  qualification turn (one structured action that must validate with the game's validator). Only
  then is the model ready and the clock runs.
- The weights are cached **per origin** (scheme, host and port): the dev server, `vite preview`, the
  harness and the single-origin server each download them once.
- One model per browser: a second tab of the same origin does not load another one. It says "the
  model is running in another tab", runs no model work (its clock holds) and offers "Take over
  here"; the first tab then frees its model and waits in line.
- A lost GPU device holds the clock ("GPU device lost: reload the model"); the call in flight is
  discarded and runs again after "Reload the model". `?llmdebug=1` turns on the test hook
  `__swarmpress.session.destroyModelDevice()`.
- Gated e2e (never in CI): `BONSAI_E2E=1 pnpm --filter @swarm-press/game exec playwright test -c playwright.mvp.config.ts --project=bonsai`
  boots `/?central=1&llm=bonsai` against the MVP suite's servers in installed Chrome and waits for
  the model to become ready.

## The scripted backend (CI-safe)

`bench.html?llm=fake` runs the same harness against a scripted backend that answers every fixture
and gets a fixed set of prompts wrong on purpose. It needs no GPU and no network, and proves that
the harness, the counts and the reports work:

```sh
CI=1 PW_JSON=reports/playwright-bench.json pnpm exec playwright test -c playwright.bonsai.config.ts --project=scripted
```

Its reports go to `artifacts/bench/` (`model-eval-fake.<machine>.json`,
`frame-time-llm-low.fake.json`) and its Markdown to `artifacts/bench/qualification/`, never to
`docs/qualification/`. Its timings are marked inconclusive.
