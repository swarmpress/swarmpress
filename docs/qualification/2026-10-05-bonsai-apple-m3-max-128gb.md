# Model qualification: Ternary Bonsai 2 (in-browser WebGPU) on Apple M3 Max, 128 GB

> **Date:** 2026-10-05 · **Verdict:** INCOMPLETE
> Written by `apps/game/src/llm/bench/report.ts` from the raw results listed below. Do not edit the numbers; run the benchmark again (`docs/runbooks/model-qualification.md`).
> Thresholds are the proposals of `docs/design/mvp-runtime.md` section 7 (ADR-0057).

## Go / no-go

| Metric | Go | No-go | Measured | Verdict |
|---|---|---|---|---|
| Warm start to ready | 60 s p50 or less | over 120 s | p50 11.5 s (n=5, max 15.7 s) | **go** |
| Prefill rate | 300 tok/s or more | under 100 tok/s | not measured | not measured |
| Decode rate, scene at medium | 20 tok/s or more | under 10 tok/s | not measured | not measured |
| Short action | p50 under 10 s, p95 under 20 s | p50 over 20 s | not measured | not measured |
| Valid after one repair or fewer | 98% or more, with 90% or more first attempt | under 90% | not measured | not measured |
| Section, about 300 words | p50 60 s or less, 95% valid | – | not measured | not measured |
| Staged article | p50 8 min or less | over 15 min | not measured | not measured |
| Meeting turn | TTFT 3 s or less, total 8 s or less | – | not measured | not measured |
| Frame p95 while generating | 33 ms or less at the scheduler's tier | over 50 ms at low | not measured | not measured |
| Full-suite runs without device loss | 95% or more of 20 | under 80% | not measured | not measured |
| GPU peak at 16K context | 12 GB or less | – | 10.75 GB; GPU process RSS peak 947.5 MB | **go** |
| Equivalence mismatches | 0 | any | not measured | not measured |

- **Warm start to ready:** load() plus the warm-up turn
- **Prefill rate:** no full run
- **Decode rate, scene at medium:** no run with the scene at medium
- **Short action:** fixture a did not run
- **Valid after one repair or fewer:** no structured fixture ran
- **Section, about 300 words:** fixture d did not run
- **Staged article:** fixture e did not run
- **Meeting turn:** fixture f did not run
- **Frame p95 while generating:** no run drew the scene while generating
- **Full-suite runs without device loss:** no pass over the suite
- **GPU peak at 16K context:** GPU buffer bytes the runtime allocated (runtime.host.memory.peakBytes), not the whole process
- **Equivalence mismatches:** the equivalence step did not run

How to read it: one **NO-GO** row decides against this backend on this machine. A row that is not measured or has too little data leaves the decision open (INCOMPLETE). **Conditional** rows miss the go threshold without reaching the no-go one. On a no-go, take the next step of the fallback ladder (`docs/design/mvp-runtime.md` section 7) and run again.

## Environment

|  |  |
|---|---|
| Machine | Apple M3 Max, 128 GB, macos 26.4 aarch64, 16 cores |
| Browser | Chrome 154.0.0.0; cross-origin isolated: yes |
| Backend | Ternary Bonsai 2 (in-browser WebGPU) (`bonsai`) |
| Model | prism-ml/Ternary-Bonsai-2-27B-gguf `Ternary-Bonsai-2-27B-PTQ1_0.gguf` at b072e1d3b35a, sha256 53107f530aa5…, 5.95 GB |
| Engine | sha256 d94c1729d7a7… |
| Context | 16384 tokens |
| Model GPU device | `{"vendor":"apple","architecture":"metal-3","device":"","description":"","isFallbackAdapter":false,"subgroupMinSize":32,"subgroupMaxSize":32,"features":{"shaderF16":true,"subgroups":true,"subgroupMatrix":false,"timestampQuery":true},"decodePipelineDepth":4,"gpuBytes":{"live":10733360872,"peak":10750138088}}` |
| Commit | 483ba01c807352358d08428f80c49d134e168bd7 on main |

| Run | Started | Start | Scene | Scale | Passes | Calls | Complete |
|---|---|---|---|---|---|---|---|
| load-cold | 2026-10-04T18:07:35.259Z | cold | off | 1 | 0 | 0 | yes |
| load-warm | 2026-10-05T06:14:27.864Z | warm | off | 1 | 0 | 0 | yes |

Raw results: `artifacts/bench/raw/bench-bonsai.apple-m3-max-128gb.load-cold.json`, `artifacts/bench/raw/bench-bonsai.apple-m3-max-128gb.load-warm.json` (git-ignored).

## Load stages

| Start | n | Verify | Weights | GPU init | load() total | Warm-up turn | Ready |
|---|---|---|---|---|---|---|---|
| cold | 1 | 372 ms | 17.5 min (5.94 GB of 5.95 GB) | 83.6 s | 18.9 min | 1.4 s | 19.0 min |
| warm | 5 | 179 ms | 3.7 s (5.94 GB of 5.95 GB) | 6.1 s | 10.0 s | 1.4 s | 11.5 s |

Times are p50 over the loads of that kind. Verify is the time before the first progress event (the engine fetch and hash checks for Bonsai). Weights is download on a cold start and the read from the browser cache on a warm one.

## Frame times

The scene was not drawn in these runs.

## Memory

| Run | When | GPU live | GPU peak | Page and workers (measureUserAgentSpecificMemory) |
|---|---|---|---|---|
| load-cold | after load | 10.73 GB | 10.75 GB | 335.4 MB |
| load-warm | after load | 10.73 GB | 10.75 GB | 337.0 MB |

Chrome's GPU process, resident memory peak sampled from outside the browser: 947.5 MB.

## Device loss

The device-loss step did not run.

## What this report does not establish

- Prompt sizes are set with an estimate of four characters per token; the table above shows the estimate next to what the tokenizer counted.
- The section checks are a mirror of the Rust checks without banned phrases, near-duplicates and markup stripping. The schemas are the Rust ones.
- Whether the text is good. This measures speed, validity and stability; the eval harness (track E of `docs/mvp.md`) reads the articles.
