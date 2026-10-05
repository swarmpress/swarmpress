# ADR-0057 — Strict in-browser inference: one resident model on WebGPU

**Status:** Accepted (amends ADR-0024, ADR-0026, ADR-0027 and ADR-0054); amended by ADR-0066 (the model, the runtime and the fallback ladder); decision 1 superseded by ADR-0067 (hosted inference on GPT-6-Luna)
**Date:** 2026-10-02

## Context

ADR-0024 split inference between small browser models for routine staff work and Claude for the
heavy work. ADR-0026 described a registry of ONNX models loaded through Transformers.js.
ADR-0054 allowed a player to hold their own provider key. None of the local-model code is wired
into the game session: without the scripted fake model, every standup silently yields nothing.

The owner's concept document
([`docs/reference/browser-agent-studio.md`](../reference/browser-agent-studio.md)) sets a
stricter requirement for the first real MVP: all language-model inference runs locally in the
browser. The game needs neither an inference API nor a local native model server, and an
unavailable local backend is never replaced by cloud inference without an explicit change of
requirement.

The chosen model is Ternary-Bonsai-2-27B (PTQ1_0, 5.95 GB). Stock llama.cpp, Transformers.js and
ONNX Runtime cannot load it. A public WebGPU demo by webml-community can, and its bundle contains
a clean engine module. That module carries no licence, and this repository is public and
GPL-3.0.

Detail: [`docs/design/mvp-runtime.md`](../design/mvp-runtime.md).

## Decision

1. **All inference in the MVP runs in the browser on WebGPU.** No inference API, no native model
   server (including a local llama server), no cloud fallback.
2. **One resident model shared by all staff**, in one Dedicated Worker, one turn at a time:
   `prism-ml/Ternary-Bonsai-2-27B-gguf`, packing PTQ1_0, pinned by revision and sha256.
   Hiring more staff does not load more models.
3. **The runtime is obtained by extraction.** The engine module is cut out of the pinned demo
   page (one cut at the `TernaryBonsai2` export, no patches) and driven through its low-level
   calls behind the existing `LocalLlm` interface.
4. **The engine is not committed.** The repository holds our extractor, a lock file with the
   hashes and a hand-written type declaration. A setup script fetches the pinned page into a
   git-ignored directory. A licence is requested upstream.
5. **The runtime is proven before anything depends on it.** A qualification harness produces a
   benchmark report on the owner's machine; the report decides go or no-go against thresholds
   stated in advance.
6. **Fallback ladder if Bonsai misses the thresholds:** retune the same model (8K context,
   thinking off); PQ2_0 through the same module; a smaller model of the same architecture; the
   existing Transformers.js path (licence-clean); Chrome's Prompt API as the labelled mode.
7. **Chrome's Prompt API is a second, separately labelled local adapter**, qualified on the same
   fixtures. One backend per company session. A failed probe blocks with a notice; the backend
   is never switched silently.
8. **Structured output is prompt-and-repair, validated twice by one validator.** The runtime has
   no constrained decoding and decodes greedily. The Rust JSON-Schema validator is exported to
   the browser so the repair loop and the orchestrator agree.
9. **Model output is untrusted.** The engine validates every action; a partial or truncated
   answer never mutates state.
10. **Out of the MVP, not withdrawn:** ADR-0054's player-held provider keys, ADR-0024's Claude
    route (`browser_then_claude`, `claude` executors), and the managed model layer of ADR-0051
    and ADR-0052.

Nothing here is built. Track R of `docs/mvp.md` implements it.

## Consequences

- The game is free to run and private by construction: briefs, drafts and inference stay on the
  device until the player publishes.
- One model does every job, including the editor's review of its own writing. Deterministic
  checks, a seeded-bad editor test and the CEO's approval (ADR-0059) compensate.
- The pipeline must fit a bounded context and a slow, reasoning-heavy model (ADR-0058), and game
  time must not depend on GPU speed (ADR-0060).
- **Negative:**
  - A roughly 6 GB download and a capable GPU are required. The first audience is desktop users
    with enough memory.
  - The engine has no licence. It is fine to fetch and run on the owner's machine; serving it to
    other players is redistribution and needs a licence or an explicit owner decision.
  - Upstream can rebuild the demo at any time. The hash lock, the export-name anchor and an
    output-equivalence test on fixed prompts guard each pin bump.
  - Greedy decoding can loop or repeat. Bounded stages, a no-progress stop and repair turns with
    thinking off are the guards.
  - The tier vocabulary and per-role model selection of ADR-0026 are unused in the MVP.
- **Unverified:** WebGPU feature exposure and speed in Chrome on the qualification machine;
  memory use; cache consistency after an early stop; the Prompt API's schema subset. All
  thresholds are proposals until measured.
- **Alternatives rejected:**
  - *A native model server on the player's machine* (PrismML's llama.cpp fork). It runs the
    model well, but it is not in-browser inference and adds an install step.
  - *The player's own Claude key for harder jobs.* It contradicts the local-only requirement.
  - *Reimplementing the WebGPU kernels.* Ninety-nine kernels and ternary packing are months of
    work.
  - *Running the unmodified demo page in a hidden frame.* It runs on the main thread, starts a
    third GPU device and has no message interface.
