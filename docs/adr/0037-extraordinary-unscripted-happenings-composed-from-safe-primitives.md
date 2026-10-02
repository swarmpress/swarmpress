# ADR-0037 — Extraordinary, unscripted happenings, composed from safe primitives

**Status:** Accepted
**Date:** 2026-10-01

## Context

The Day Director (ADR-0036) steers ordinary days with a bounded intent catalogue. The product
owner wants the magic of the unexpected: people suddenly doing something extraordinary that
nobody pre-defined, directed by AI, not scripted. A fixed catalogue can't produce that.
Unbounded LLM control would break determinism and authority, and could be unsafe.

## Decision

- Separate **story** from **mechanics**:
  - **The story is free.** The director invents the happening (title, narrative, why now),
    grounded in at least two digest facts: one about the people, one about the moment.
  - **The mechanics are composed** from a small set of **effect primitives**:
    - gather, emote, temporary prop, a fictional or role-described guest, ambience;
    - shared memory, mood and affinity deltas within the usual caps;
    - a plan **proposal**, an Inbox ticket, spotlight and narration, a novel multi-day arc.

  Each primitive is validated (existence, caps, grounding, civility) and applied as
  deterministic sim commands, client and server alike.
- **Emergent work becomes real only through the normal gates.** A happening can propose new work
  items. Real content results only after CEO or EiC acceptance and the editorial and QA gates.
- **Rarity and novelty.**
  - A wonder budget: at most one per real day, scaled by the CEO's "magic" setting (off,
    rare, lively).
  - Server-side novelty checks against past happenings (embedding similarity and primitive
    patterns), so they don't repeat.
- **The same hard limits apply as to all director intents:** no money, hiring, priorities,
  ticket answers or publishing, and no real private persons.
- **Everything is recorded and explainable**, and lingering effects can be dismissed.
- Unknown props render as labelled placeholders. Later, they can be generated through the Agency
  from a parametric asset kit, metered in credits, so the office's possibilities grow from its
  own history.

## Consequences

- Players get genuine surprises, some of which turn into real articles or series on their live
  site.
- The primitive set is the main design lever. Adding a primitive is an ADR-level change with
  tests. Adding stories requires nothing.
- Novelty checks need embeddings, computed on the server for happening titles and summaries.
  That's cheap, and is noted for the model registry.
- More validator surface means more adversarial tests:
  - ungrounded happenings;
  - repeated ones;
  - attempts to use primitives to move money;
  - real people as guests;
  - over-budget sequences.
