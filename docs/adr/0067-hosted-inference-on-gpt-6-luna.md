# ADR-0067 — Hosted inference on GPT-6-Luna

**Status:** Accepted (supersedes ADR-0057 decision 1 and the local-only parts of ADR-0057 and ADR-0066; amends ADR-0054); rollout in the steps of the migration document
**Date:** 2026-10-05

## Context

ADR-0057 required all inference to run in the browser; ADR-0066 chose Gemma 4 E4B on upstream
llama.cpp after Ternary Bonsai 2 was a no-go. The owner's own measurements on the M3 Max, 128 GB,
on 2026-10-05:

- **Ternary Bonsai 2 27B:** generating made the machine unresponsive until WindowServer restarted
  ([report](../qualification/2026-10-05-bonsai-apple-m3-max-128gb-stability.md)).
- **Chrome built-in AI:** the Prompt API was available, but the model download did not complete in
  the test profile; not measured.
- **Gemma 4 E4B on llama.cpp:** stable, 40 tok/s without the scene. The last sanity pass (a fifth
  of each fixture, scene at medium, grammar-constrained JSON, thinking on) had no failed call and no
  no-go row, 93.8% valid on the first attempt, sections 80% valid, a staged article in 6.1 min.
  Its remaining weaknesses were content: sections too short, list text in the wrong field, wrong
  facts in 2 of 6 short answers and 2 of 10 context inspections.

The owner decided that quality matters more than inference speed, and that making model hardware
qualification the centre of the experience is the wrong priority. Their migration document,
[`docs/reference/gpt-6-luna-simulation-migration.md`](../reference/gpt-6-luna-simulation-migration.md),
sets the new direction. `gpt-6-luna` is a documented OpenAI model (1,050,000-token context, 128,000
output tokens, reasoning `none` to `max`, Responses, Chat Completions and Batch, structured outputs);
prices checked on 2026-10-05: $0.10 input, $0.01 cached input, $0.125 cache writes and $0.50 output
per million tokens on Standard, half that on Flex and Batch.

## Decision

1. **Language-model inference runs on GPT-6-Luna through the OpenAI Responses API, called by the
   central server.** Flex for queued work, Standard where the player waits, Batch for advance
   preparation (the migration document, section 6).
2. **The credential stays on the server.** The browser never holds the OpenAI key (CLAUDE.md
   rule 7 holds); it asks the central server, which authenticates the player, fences by the
   company lease, enforces per-company budgets and keeps a job record per request.
3. **The application keeps its authority.** Model output is a proposal: validated against its
   schema and the deterministic checks, applied by the orchestrator and the sim's state machine,
   never published without the CEO (CLAUDE.md rules 2, 3, 5 and 10 hold). Structured calls use the
   Responses API's JSON-schema output and keep the repair loop for the checks beyond the schema.
4. **The story director and event-grounded conversations** (the migration document, sections 9 to
   11) are part of the direction and come after the inference path (its steps 3 and 4).
5. **Local inference becomes an experiment, not the default.** The Gemma 4 E4B backend
   (ADR-0066) stays in the code as an opt-in backend (`?llm=gemma`) and in the qualification
   harness; Bonsai's backend is retired. `LocalLlm` stays the adapter contract.

## Consequences

- No model download, GPU qualification or WebGPU inference on the player's device; any device that
  runs the game can play.
- The game needs the network for new generation; existing artifacts and state stay usable offline.
- Selected briefs, page content and event context leave the device for OpenAI. The player is told
  so (the migration document, section 14).
- **Negative:**
  - Recurring cost per request and a provider dependency; the server must enforce budgets before
    any player but the owner uses it.
  - Flex can be slow or unavailable; the scheduler needs backoff and a budgeted promotion to
    Standard.
  - The determinism of the sim is unaffected (text never enters the sim), but the same prompt no
    longer gives the same text: evals and the qualification harness compare quality, not tokens.
  - ADR-0054's player-held keys stay out of the MVP; ADR-0051's managed model layer is the place
    for credits once others play.
  - The local-only guard (`apps/game/src/llm/local-only.ts`) and its test describe the old rule;
    they now apply only to the local backends.
- **Alternatives rejected:**
  - *Keep Gemma 4 E4B local as the default.* It qualified on stability and most speed rows, but
    its content errors and the hardware burden on players outweigh it for the owner.
  - *Gemma 4 12B local.* Not measured; the same hardware burden, more of it.
  - *Claude through the existing `crates/claude` client.* The owner chose GPT-6-Luna.
