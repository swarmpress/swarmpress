# ADR-0034 — Living personas: memories, relationships and recorded conversations

**Status:** Accepted
**Date:** 2026-10-01

## Context

ADR-0030 made each person a rich, static profile (vita, CV, hobbies, personality). The product
owner wants every person's history and personality to be *recorded*, including during
conversations between agents, so that people evolve like real colleagues. Without memory, agents
repeat themselves, relationships never form, and conversations can't be explained or reproduced.

## Decision

- A person is **profile + state + life record**:
  - **Profile:** the versioned persona catalog (ADR-0030).
  - **State:** numbers in the deterministic sim: morale, fatigue, skills, small trait drift,
    stress, tenure, and a pairwise **affinity matrix** that moves on deterministic signals
    (collaboration, reviews, praise, meeting friction, lunch together).
  - **Life record:** text on the server: episodic **memories** (first-person, with valence,
    salience and source), evolving **opinions** with origin memories, life events and a career
    log.
- **Memory formation** runs after conversations, reviews and events (`MemoryFormation`, a cheap
  browser job), with grounding validation: memories may only refer to the source.
- **Recall** is top-k by salience × recency × relevance. **Reflection** periodically compacts
  memories into self-summaries and updates opinions.
- **Every utterance is recorded with its full parameter set:**
  - setting (kind, room, project, items);
  - persona version;
  - sim state at that moment: morale, fatigue, traits, affinities to the participants;
  - memories used;
  - world snapshot items used;
  - executor, model and effort;
  - tags and sentiment.

  Conversations, including informal small talk at the coffee machine or lunch, are therefore
  explainable, reproducible and analysable.
- Seeded, deterministic **life events** (birthdays, leave, sick days, anniversaries, personal
  milestones) feed memories, small talk and occasional Inbox tickets.

## Consequences

- Storage grows with play. Utterances and memories are per company, prunable by retention
  policy, and summaries keep prompts bounded.
- Prompt context gains three bounded sections: memories, relationships, today outside. Prompt
  caching must keep these after the stable prefix.
- The parameter record makes LLM behaviour auditable. It is also data the Data Scientist can
  analyse.
- Grounding validators are needed for memories, so agents can't "remember" things that never
  happened.
