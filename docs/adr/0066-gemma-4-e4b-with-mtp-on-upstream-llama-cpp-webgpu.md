# ADR-0066 — Gemma 4 E4B with MTP on upstream llama.cpp (WebGPU)

**Status:** Accepted (amends ADR-0057: the model, the runtime and the fallback ladder); rollout gated by the runtime spike
**Date:** 2026-10-05

## Context

ADR-0057 chose Ternary-Bonsai-2-27B, run by an engine extracted from a public demo page. On the
owner's M3 Max with 128 GB, generating with it made the whole machine stop responding until
WindowServer restarted and ended the login session, on every attempt
([`docs/qualification/2026-10-05-bonsai-apple-m3-max-128gb-stability.md`](../qualification/2026-10-05-bonsai-apple-m3-max-128gb-stability.md)).
That is a no-go on the strongest machine the MVP's audience can have. The engine also carries no
licence, so it could never be served to other players.

The owner's concept for the replacement is a capable small model, aggressively quantized, with
speculative decoding, on an upstream runtime instead of a private one:

- **Gemma 4 E4B** (4.5B effective parameters, 128K context, Apache 2.0), instruction-tuned.
- **Unsloth's QAT GGUF**, `UD-Q4_K_XL` (4.22 GB), and the **MTP drafter** of the same repository
  (`mtp-gemma-4-E4B-it.gguf`, Q4_0, 59.7 MB). The drafter proposes several tokens; the target
  verifies them and shares its KV cache, so the output equals the target's own.
- **Upstream llama.cpp** with its **ggml WebGPU backend**, compiled to WebAssembly with Emscripten
  and Dawn's `emdawnwebgpu` bindings. Gemma 4 MTP is merged upstream (PR 23398, 2026-06-07; E2B
  and E4B in PR 24282), wired into `common/speculative` and `llama-server`.

## Decision

1. **The resident model is Gemma 4 E4B with its MTP drafter**: `unsloth/gemma-4-E4B-it-qat-GGUF`,
   `UD-Q4_K_XL` plus the Q4_0 drafter, both pinned by revision and sha256. Target and drafter are
   one resident model in the sense of ADR-0057 decision 2: one Worker, one turn at a time, shared
   by all staff.
2. **The runtime is upstream llama.cpp, built by us**, pinned by commit, with the WebGPU backend,
   for the browser (wasm64 for the 4.22 GB file, JSPI). Our code is a thin C shim (load, tokenize,
   prefill, stream with MTP, cancel, free) and the Worker adapter behind the existing `LocalLlm`
   interface. We do not write tensor code, and we do not patch llama.cpp; a fix goes upstream.
   This replaces the extraction of ADR-0057 decisions 3 and 4: the build is reproducible and
   licence-clean (MIT and Apache 2.0), so the built wasm may be served to players.
3. **MTP is on by default and switchable.** The run records the acceptance rate. A turn without
   the drafter gives the same tokens, slower; that is the equivalence check.
4. **Device tiers keep one agent API.** High end: E4B with MTP and the largest context the device
   allows. Mid range: E4B with MTP and a smaller context. Low memory: Gemma 4 E2B with its
   drafter. The tier is chosen once per company and shown; it never changes silently (ADR-0057
   decision 7 still holds).
5. **The agent layer stays as it is.** The concept's agent loop is the orchestrator: models
   return structured artifacts and tool calls, the runtime validates them, and the sim's state
   machine owns every transition (CLAUDE.md rules 2, 3 and 5). The concept's generic tools
   (web search, file access, browser automation) are not part of the MVP; web reads go through
   the central fetch proxy, as before.
6. **The rollout is gated by a spike.** Before anything depends on it, a page in `apps/game` loads
   the pinned build and model in Chrome on the owner's machine, streams a long answer with and
   without MTP, and must keep the machine responsive. Only then does the qualification harness
   (`BENCH_LLM=gemma`) run the full suite against the thresholds of
   `docs/design/mvp-runtime.md` section 7.
7. **The fallback ladder becomes:** E4B retuned (context, drafter length, MTP off); E4B at a
   smaller quantization (`UD-Q2_K_XL`, 3.22 GB); E2B with MTP; Chrome's Prompt API as the
   labelled mode. Bonsai and the extracted engine leave the ladder.

## Consequences

- The download drops from 5.95 GB to about 4.3 GB, and GPU memory with it.
- The licence problem of ADR-0057 is gone: the runtime and the weights may be served to players.
- Upstream fixes and kernels arrive by bumping one pin, guarded by the equivalence check.
- **Negative:**
  - A 4.5B-effective model is weaker than a 27B one at long articles and at reviewing its own
    writing. The section and staged-article fixtures, the evals of track E and the CEO's publish
    gate decide whether that is good enough.
  - We own a WebAssembly build of a C++ code base: Emscripten, `emdawnwebgpu` in step with the
    pinned Dawn, wasm64 and JSPI (Chrome only; Safari would need Asyncify). The browser build is
    not an upstream-supported product, and the upstream docs give no browser flags.
  - Upstream's MTP is ready in `llama-server`, not in every path (`llama-speculative` and
    `llama-bench` failed with E2B and E4B). Our shim has to drive `common/speculative` the way the
    server does.
  - Gemma 4's E models keep their per-layer embeddings outside the main weights; where llama.cpp
    places them in a browser build (wasm memory or GPU) is not known yet and decides the memory
    budget.
  - The work of track R on the Bonsai adapter (extraction, lock file, prefix snapshots) is
    retired. The harness, the fixtures, the reports and the Chrome adapter stay.
- **Unverified:** that the browser build loads a 4.22 GB GGUF; decode and prefill rates on
  ggml-webgpu in Chrome; the MTP acceptance rate on our prompts; whether the machine stays
  responsive while it generates (the reason Bonsai failed). The spike answers the first and the
  last; the qualification run answers the rest.
- **Alternatives rejected:**
  - *Gemma 4 12B through a community ONNX build on Transformers.js.* It is stronger, but the only
    browser build is a one-person export capped at 8K context, with an 8.2 GB download.
  - *Chrome's built-in Gemma 4 (`#gemma4-for-built-in-ai`).* It is the 2B model, behind a flag,
    and Chrome decides the version; it stays the labelled last step of the ladder.
  - *A ready-made llama.cpp browser library* (for example `paulrobello/webllm`, MIT). It carries
    its own wasm build and does not expose MTP; we would depend on a third party between us and
    upstream. It stays a reference for the build.
  - *Keeping Bonsai with a pinned pipeline depth of 1.* Untested, but the engine cannot be changed
    and cannot be served to players either way.
