# Runtime spike: Gemma 4 E4B on upstream llama.cpp (WebGPU) in Chrome, Apple M3 Max, 128 GB

> **Date:** 2026-10-05 · **Gate of:** ADR-0066 decision 6 · **Result:** passed for plain decoding; MTP not ready
> **Written by hand** from the spike page's log (`apps/game/llama-spike.html`). This is not the
> qualification report: the harness (`BENCH_LLM=gemma`) and its thresholds come next.

## Setup

| | |
|---|---|
| Machine | Apple M3 Max, 128 GB, macOS 26.4 |
| Browser | Chrome 154.0.8037.95, headed, its own profile on the internal SSD |
| Runtime | upstream llama.cpp `8e164219` built by `scripts/llama-runtime.mjs`: ggml WebGPU through emdawnwebgpu `v20260908.214631`, wasm64, JSPI, wasm exceptions, pthreads; `llama.wasm` 6.4 MB |
| Model | `unsloth/gemma-4-E4B-it-qat-GGUF` at `8c5a9e4f`: `UD-Q4_K_XL` (4.22 GB) and the Q4_0 MTP drafter (59.7 MB), from OPFS through WORKERFS |
| Settings | context 8192, greedy, flash attention off, thinking off, draft max 4 |
| Prompt | a 300-word travel article (41 prompt tokens) |

## Results

| Turn | Tokens | Target steps | TTFT | Decode | Drafts accepted | Page frames p95 / worst |
|---|---|---|---|---|---|---|
| Without MTP, 64 | 64 | 64 | 0.38 s | 38.2 tok/s | – | 9 / 9 ms |
| With MTP, 64 | 64 | 34 | 0.70 s | 7.1 tok/s | 22% of 134 | 9 / 116 ms |
| Without MTP, 400 | 380 (end of turn) | 380 | 0.34 s | **40.7 tok/s** | – | 9 / 9 ms |
| With MTP, 400 | 350 (end of turn) | 201 | 0.69 s | 6.6 tok/s | 19% of 804 | 9 / 117 ms |

- **The machine stayed responsive** in every turn: page frames at p95 9 ms, no stall, no fan
  storm reported, no logout. This is the failure that ruled out Bonsai.
- **Loading:** target and drafter ready in 17.8 s from OPFS (the weights' upload itself about
  4 s). GPU: 2.49 GB of weights plus a 207 MB compute buffer. The per-layer embeddings
  (1.87 GB) stay on the CPU side, in wasm memory, which wasm64 allows.
- **Quality, by eye:** a coherent 380-token article in about 10 seconds.

## Findings

1. **Plain decoding is fast enough to qualify:** 40.7 tok/s is above the go threshold of 20 tok/s
   for decode, but the design measures that with the office scene drawing, which this spike did
   not do.
2. **MTP is a net loss in the browser today:** a sixth of the speed, with 19 to 22% of drafts
   accepted (upstream reports about 48% on a phone and 60% on the 31B). With greedy decoding the
   two paths must give the same tokens; they did not (380 against 350 tokens), so the
   speculative path in our shim or upstream's E4B drafter path is not correct yet. **MTP stays
   off** until the equivalence holds and it is faster; ADR-0066 decision 3 (on by default) waits
   on that.
3. **Build facts** (all within upstream, nothing patched): upstream's common logger starts a
   thread, so the build needs pthreads (`-pthread`, a pool of 4; the CPU backend runs on one
   thread); C++ exceptions need `-fwasm-exceptions` to be catchable; wasm64 hands pointers to JS
   as BigInt.
4. **Downloads drop:** Hugging Face's CDN closed the 4.22 GB stream twice; the download resumes
   with Range requests from the bytes already in OPFS. The files are checked by size; the sha256
   check is not wired yet.

## What this does not establish

- Frame times with the office scene drawing while the model generates.
- Prefill rate on long prompts (2K, 8K), structured-output validity, the staged article, meeting
  turns, device loss: the qualification harness measures those.
- Any other machine.

## Next

1. A `gemma` backend for the qualification harness behind `LocalLlm`, with MTP switchable and
   off by default; then the smoke run and the full suite of the runbook.
2. MTP: find why greedy outputs differ (our loop against upstream's `llama-server` path), then
   measure again with draft max 2 and 3.
