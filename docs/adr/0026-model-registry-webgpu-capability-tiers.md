# ADR-0026 — Model registry and WebGPU capability tiers

**Status:** Accepted
**Date:** 2026-10-01

## Context

Browser GPUs range from integrated laptop chips with 2 GB of shared memory to discrete cards with
24 GB. WebGPU adapter limits (`maxBufferSize`, `maxStorageBufferBindingSize`) vary by browser and
driver. Vendor claims about small models (ternary 27–30B "fits in 8 GB") are unverified.

Choosing a model per device by hand is not something players can or should do.

## Decision

- **A model registry**, `config/models.toml`, is served to clients. Each entry has:
  - `id`, `hf_repo`, `dtype`;
  - `download_bytes`, `sha256`;
  - `context_length`;
  - minimum `maxBufferSize` and `maxStorageBufferBindingSize`;
  - `approx_vram_bytes`;
  - `roles_allowed`;
  - `tier`.
- **Initial candidates:**

  | Tier | Model class | Use |
  |---|---|---|
  | `chatter` | tiny (~0.5–1B) | low-end devices: chatter and bubbles only |
  | `laptop` | ~4B Qwen-class | meetings, briefs, short drafts |
  | `high` | GPT-OSS-20B q4f16 | drafts, reviews, translation |
  | `frontier-local` | 27–30B class (Ternary Bonsai 2, Muse Glimmer) | **only if our eval confirms the vendor claims** |

- **Capability detection on first run:**
  1. Request a WebGPU adapter and read its limits.
  2. Read `navigator.deviceMemory`.
  3. Run a **10-second tokens-per-second probe** on the smallest model.

  This picks the tier. Players can override it in settings, down to "Agency only".
- **Downloads** go into Cache Storage or OPFS. They are resumable (HTTP range requests) and checked
  against `sha256`. In game they show as **"installing the newsroom's brains"**, with progress.
- **Seniority maps to a model within the tier.** A Junior gets the tier's smallest allowed model,
  a Senior or Star the largest that fits the VRAM budget.
- **Defaults are eval-driven.** The model eval harness runs the same job set on every registry
  model:
  - meetings, briefs, drafts and reviews;
  - scored by the editor rubric, with Claude as judge;
  - plus tokens per second.

  It emits `cockpit.benchmark.v1` per model. Registry defaults change only through a PR that
  cites the eval.

Alternatives considered:

- **A single model for everyone.** Rejected. It would be too large for most devices or too weak
  for good ones.
- **The player picks from a list.** Rejected as the default, because it is jargon-heavy. It is
  kept as an override.
- **Trusting vendor benchmarks.** Rejected, since editorial quality on our tasks is what matters.

## Consequences

- Positive: every device gets the best model it can run, and weak devices still play, with
  Agency-backed staff.
- Positive: model upgrades are data changes (registry plus eval), not code changes.
- Negative: the eval harness costs Claude tokens to judge. It runs nightly or on demand, not per
  PR.
- Negative: storage quota prompts and multi-GB downloads are friction on first run. The default
  tier errs small.
