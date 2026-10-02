# ADR-0024 — Hybrid inference: browser LLMs for staff, Claude for agency/heavy tasks

**Status:** Accepted; amended by ADR-0044, ADR-0057, ADR-0058
**Date:** 2026-10-01

## Context

The game has a lot of LLM traffic: meetings turn by turn, chatter, pitches, briefs, drafts,
revisions, reviews, translations, and link and media selection. Running all of it on Claude for
every player is expensive and makes the game's cost scale with idle chatter.

Meanwhile, browsers with WebGPU can now run 4B to 20B-class models at usable speed. Some work
still needs frontier capability:
- research with `web_search`;
- theme design with vision;
- recovering from repeated failure.

## Decision

- **Browser LLMs run the staff.** WebGPU, via **Transformers.js v4** behind our own `LocalLlm`
  adapter, handles:
  - meetings and chatter;
  - pitches and briefs;
  - drafts, revisions and editor reviews;
  - translation;
  - link and media selection.
- **Claude handles the heavy agentic work:**
  - research with `web_search`;
  - themes and design (Art Director, Front-end Dev, vision review);
  - escalations:
    - a draft rejected 3 times;
    - schema repair failing;
    - a device tier too weak for a job kind;
    - a CEO "send to agency" ticket.
- **In game**, Claude-backed work appears as an **external Agency** (contractors visiting the
  building). Star hires may be Agency contracts. Escalating to Claude is a visible, costly
  in-game choice.
- **Each `JobKind` has an executor policy** (`Browser | Claude | BrowserThenClaude`) and a minimum
  device tier.
- **Model choice is tiered auto-detection** ([ADR-0026](0026-model-registry-webgpu-capability-tiers.md)).
  Seniority picks the model within the tier: a Junior gets the small model, a Senior the largest
  that fits.
- **No browser open:**
  - the sim keeps ticking;
  - Claude jobs continue;
  - browser jobs queue for the "morning rush"
    ([ADR-0025](0025-browser-job-worker-protocol.md)).
- **Client-written content is real content.** It goes through the same QA and editor gates, and
  the server validates every artifact.
- **Determinism.** LLM output is nondeterministic per device, and enters the sim only as a
  server-issued command.

Alternatives considered:

- **Claude for everything.** Rejected. Cost grows with every idle meeting. Also possible for
  players without capable GPUs, through the Agency.
- **Server-hosted open models (vLLM).** Rejected. GPU servers are operational weight we avoid
  ([ADR-0008](0008-postgres-only-infrastructure.md)), and the cost shifts to us.
- **WebLLM/MLC as the primary runtime.** Deferred. Transformers.js has broader model coverage and
  ONNX tooling. The `LocalLlm` adapter keeps WebLLM, or a custom ternary kernel, pluggable.

## Consequences

- Positive: the marginal cost of staff chatter is the player's own GPU. Claude spend goes where it
  matters.
- Positive: the in-game Agency makes escalations visible and meaningful.
- Negative: local-model quality varies. The same gates, the escalation after 3 rejections,
  per-tier eligibility and eval-driven defaults mitigate this.
- Negative: multi-GB downloads and VRAM contention with the renderer, mitigated by
  [ADR-0026](0026-model-registry-webgpu-capability-tiers.md) and
  [ADR-0027](0027-gpu-sharing-renderer-and-local-llm.md).
- Negative: Firefox and Safari WebGPU limits. The game stays playable with Agency-only staff.
