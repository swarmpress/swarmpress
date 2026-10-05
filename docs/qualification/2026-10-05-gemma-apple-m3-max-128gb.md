# Model qualification: Gemma 4 E4B on llama.cpp (in-browser WebGPU) on Apple M3 Max, 128 GB

> **Date:** 2026-10-05 · **Verdict:** INCOMPLETE
> Written by `apps/game/src/llm/bench/report.ts` from the raw results listed below. Do not edit the numbers; run the benchmark again (`docs/runbooks/model-qualification.md`).
> Thresholds are the proposals of `docs/design/mvp-runtime.md` section 7 (ADR-0057).

## Go / no-go

| Metric | Go | No-go | Measured | Verdict |
|---|---|---|---|---|
| Warm start to ready | 60 s p50 or less | over 120 s | p50 12.9 s (n=1, max 12.9 s) | **go** |
| Prefill rate | 300 tok/s or more | under 100 tok/s | p50 210.8 tok/s (n=61, min 171.5 tok/s) | **conditional** |
| Decode rate, scene at medium | 20 tok/s or more | under 10 tok/s | p50 28.6 tok/s (n=60, min 1.3 tok/s) | **go** |
| Short action | p50 under 10 s, p95 under 20 s | p50 over 20 s | p50 6.7 s, p95 15.1 s (n=10, 0 failed) | **go** |
| Valid after one repair or fewer | 98% or more, with 90% or more first attempt | under 90% | 100.0% after one repair or fewer, 93.8% first attempt (48 and 45 of 48 distinct prompts) | insufficient data |
| Section, about 300 words | p50 60 s or less, 95% valid | – | p50 53.1 s, 80.0% valid (8 of 10) | **conditional** |
| Staged article | p50 8 min or less | over 15 min | p50 6.1 min (1 of 1 completed, max 6.1 min) | **go** |
| Meeting turn | TTFT 3 s or less, total 8 s or less | – | TTFT p50 2.7 s (p95 3.2 s), total p50 4.3 s (p95 4.7 s), n=4, 0 failed | **go** |
| Frame p95 while generating | 33 ms or less at the scheduler's tier | over 50 ms at low | 15.4 ms at medium (idle 9.9 ms, 132620 frames) | **go** |
| Full-suite runs without device loss | 95% or more of 20 | under 80% | 2 of 2 passes (100.0%) | insufficient data |
| GPU peak at 16K context | 12 GB or less | – | not measured | not measured |
| Equivalence mismatches | 0 | any | not measured | n/a |

- **Warm start to ready:** load() plus the warm-up turn
- **Prefill rate:** conditional: requires prefix snapshots and contexts of 4K or less
- **Valid after one repair or fewer:** fewer than 50 distinct prompts in: short-action, context-inspection, section, staged-article, moderator-pick
- **Section, about 300 words:** valid = the schema after one repair or fewer and the mirrored section checks (shape, length band, plain text)
- **Meeting turn:** the threshold names no percentile; judged on p50
- **Frame p95 while generating:** the low tier was not measured, so the no-go threshold was not tested; the GPU scheduler has no renderer hook yet, so "its tier" is the tier of the run
- **Full-suite runs without device loss:** 20 passes are needed; run the soak (BENCH_REPEAT=20)
- **GPU peak at 16K context:** the backend does not report GPU bytes; GPU process RSS peak 2.83 GB
- **Equivalence mismatches:** only the Bonsai backend has an upstream to be equivalent to

How to read it: one **NO-GO** row decides against this backend on this machine. A row that is not measured or has too little data leaves the decision open (INCOMPLETE). **Conditional** rows miss the go threshold without reaching the no-go one. On a no-go, take the next step of the fallback ladder (`docs/design/mvp-runtime.md` section 7) and run again.

## Environment

|  |  |
|---|---|
| Machine | Apple M3 Max, 128 GB, macos 26.4 aarch64, 16 cores |
| Browser | Chrome 154.0.0.0; cross-origin isolated: yes |
| Backend | Gemma 4 E4B on llama.cpp (in-browser WebGPU) (`gemma`) |
| Model | unsloth/gemma-4-E4B-it-qat-GGUF `gemma-4-E4B-it-qat-UD-Q4_K_XL.gguf` at 8c5a9e4fd548, sha256 df0fd4ee0707…, 4.22 GB |
| Engine | llama.cpp 8e1642198dcd (WebGPU, wasm64) |
| Context | 16384 tokens |
| Model GPU device | `{"vendor":"apple","architecture":"metal-3","description":"","features":["depth32float-stencil8","rg11b10ufloat-renderable","texture-formats-tier1","bgra8unorm-storage","texture-compression-bc","dual-source-blending","core-features-and-limits","float32-filterable","indirect-first-instance","texture-compression-astc-sliced-3d","float32-blendable","subgroup-size-control","texture-compression-astc","texture-compression-etc2","depth-clip-control","texture-compression-bc-sliced-3d","shader-f16","texture-formats-tier2","clip-distances","timestamp-query","primitive-index","texture-component-swizzle","subgroups"],"runtime":"llama.cpp (ggml WebGPU, wasm64, JSPI)","grammar":"json-schema","mtp":false,"draftMax":null,"mtpDrafted":0,"mtpAccepted":0}` |
| Commit | 300b81bf76050574665c12c1708be85d134ab9f4 (dirty tree) on main |

| Run | Started | Start | Scene | Scale | Passes | Calls | Complete |
|---|---|---|---|---|---|---|---|
| full | 2026-10-05T11:01:43.519Z | cold | off | 0.1 | 1 | 5 | yes |
| full | 2026-10-05T11:56:54.893Z | warm | medium (webgpu) | 0.2 | 1 | 58 | yes |

Raw results: `artifacts/bench/raw/bench-gemma.apple-m3-max-128gb.sanity.json`, `artifacts/bench/raw/bench-gemma.apple-m3-max-128gb.smoke.json` (git-ignored).

## Load stages

| Start | n | Verify | Weights | GPU init | load() total | Warm-up turn | Ready |
|---|---|---|---|---|---|---|---|
| cold | 1 | 794 ms | 4.4 min (4.22 GB of 4.22 GB) | 9.6 s | 4.5 min | 323 ms | 4.6 min |
| warm | 1 | 2 ms | 0 ms (4.22 GB of 4.22 GB) | 12.6 s | 12.6 s | 334 ms | 12.9 s |

Times are p50 over the loads of that kind. Verify is the time before the first progress event (the engine fetch and hash checks for Bonsai). Weights is download on a cold start and the read from the browser cache on a warm one.

## Fixtures

| Fixture | Reasoning, budget | Calls | Failed | Wall p50 | Wall p95 | TTFT p50 | Prefill p50 | Decode p50 | Reasoning tok p50 | First attempt | One repair or fewer | Extra turns | Cut off | Checks failed | Prompt tok est. / counted |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| a short-action | off, 128 out | 10 | 0 | 6.7 s | 15.1 s | 5.0 s | 290.3 tok/s | 35.9 tok/s | – | 70.0% | 100.0% | 3 | 3 | 0 | 1431 / 1473 |
| b short-answer | off, 96 out | 6 | 0 | 9.5 s | 10.9 s | 9.0 s | 251.1 tok/s | 34.2 tok/s | – | – | – | 0 | 0 | 2 | 2034 / 2269 |
| c context-inspection | medium (cap 512), 256 out | 10 | 0 | 67.7 s | 70.0 s | 47.1 s | 206.2 tok/s | 1.9 tok/s | 514 | 100.0% | 100.0% | 0 | 0 | 2 | 8183 / 9711 |
| d section | medium (cap 1500), 540 out | 10 | 0 | 53.1 s | 60.8 s | 4.5 s | 208.5 tok/s | 8.4 tok/s | 862 | 100.0% | 100.0% | 0 | 0 | 2 | 901 / 934 |
| e staged-article | per stage | 8 | 0 | 46.0 s | 64.6 s | 4.7 s | 206.9 tok/s | 8.5 tok/s | 828 | 100.0% | 100.0% | 0 | 0 | 1 | 994 / 1002 |
| f meeting-turn | off, 600 out | 4 | 0 | 4.3 s | 4.7 s | 2.7 s | 188.8 tok/s | 28.9 tok/s | – | – | – | 0 | 0 | 0 | 495 / 507 |
| f moderator-pick | off, 512 out | 10 | 0 | 4.6 s | 5.0 s | 3.2 s | 204.5 tok/s | 29.7 tok/s | – | 100.0% | 100.0% | 0 | 0 | 0 | 602 / 630 |

Wall time covers the whole call, repair turns included, and counts failed calls too. Rates are per generation; a prefill rate needs at least 64 uncached prompt tokens and a decode rate at least 16 generated tokens.

### Staged articles

1 of 1 completed. Wall p50 6.1 min, max 6.1 min; words p50 907.

| Stage | Calls | Failed | Wall p50 | Wall p95 | First attempt | Checks failed |
|---|---|---|---|---|---|---|
| outline | 1 | 0 | 61.5 s | 61.5 s | 100.0% | 0 |
| section | 5 | 0 | 45.6 s | 56.5 s | 100.0% | 1 |
| closing | 1 | 0 | 6.4 s | 6.4 s | 100.0% | 0 |
| review | 1 | 0 | 66.3 s | 66.3 s | 100.0% | 0 |

### Failures

No call failed.

### Answers that failed a deterministic check

- `short-answer/0`: the answer does not give 17:10
- `short-answer/5`: the answer does not give 17:11
- `context-inspection/5`: slug is "riomaggiore-train-1275", the page is riomaggiore-festivals-1779; words is 735, the page has 903
- `context-inspection/8`: slug is "vernazza-train-1845", the page is vernazza-trains-1845
- `section/2`: shape: block 2 (list) must leave "text" empty; put the words in "items"; too_short: has 176 words; about 300 were asked for (180 to 420 is accepted)
- `section/4`: shape: block 4 (list) must leave "text" empty; put the words in "items"
- `staged-article/0/section-2`: too_short: has 102 words; about 198 were asked for (118 to 277 is accepted)

## Frame times

| Run | Tier | Renderer | Model is | Frames | p50 ms | p95 ms | Max ms |
|---|---|---|---|---|---|---|---|
| full | medium | webgpu | idle-unloaded | 1832 | 8.3 | 10.4 | 194.8 |
| full | medium | webgpu | loading | 1512 | 8.3 | 10.3 | 351.7 |
| full | medium | webgpu | idle | 7811 | 8.3 | 9.9 | 13.2 |
| full | medium | webgpu | generating | 132620 | 8.6 | 15.4 | 271.4 |

The scene alone, without the HUD and the overlay. Intervals are between rendered frames, so the display refresh rate is the floor.

## Memory

| Run | When | GPU live | GPU peak | Page and workers (measureUserAgentSpecificMemory) |
|---|---|---|---|---|
| full | after load | not measured | not measured | not measured: performance.measureUserAgentSpecificMemory() did not answer within 25 s |
| full | after short-action | not measured | not measured | not measured |
| full | after short-answer | not measured | not measured | not measured |
| full | after context-inspection | not measured | not measured | not measured |
| full | after section | not measured | not measured | not measured |
| full | after staged-article | not measured | not measured | not measured |
| full | after meeting-turn | not measured | not measured | not measured |
| full | after moderator-pick | not measured | not measured | not measured |
| full | after the suite | not measured | not measured | not measured: performance.measureUserAgentSpecificMemory() did not answer within 25 s |
| full | after load | not measured | not measured | not measured: performance.measureUserAgentSpecificMemory() did not answer within 25 s |
| full | after short-action | not measured | not measured | not measured |
| full | after the suite | not measured | not measured | 2.57 GB |

Chrome's GPU process, resident memory peak sampled from outside the browser: 2.83 GB.

## Device loss

The device-loss step did not run.

### Runtime events

- full at 12.9 s: gpu-error: set_abort_callback: call
- full at 4.5 min: gpu-error: set_abort_callback: call

## What this report does not establish

- Prompt sizes are set with an estimate of four characters per token; the table above shows the estimate next to what the tokenizer counted.
- The section checks are a mirror of the Rust checks without banned phrases, near-duplicates and markup stripping. The schemas are the Rust ones.
- Whether the text is good. This measures speed, validity and stability; the eval harness (track E of `docs/mvp.md`) reads the articles.
- Upstream equivalence and GPU bytes exist only for the Bonsai backend.
