# ADR-0011 — Orchestrator owns state transitions; LLMs return artifacts

**Status:** Accepted; amended by ADR-0058
**Date:** 2026-10-01

## Context

In the legacy stack, agents moved content between states through tools such as
`submit_for_review`, `approve_content` and `reject_content`. This failed in several ways:
- An LLM that forgot to call the tool stalled a workflow.
- An LLM that called the wrong tool skipped review.
- Actor names (`EditorAgent` vs `Editor`) mismatched the state machine.
- Side effects (merging a PR) sometimes ran before the transition was recorded, which left
  orphans when the transition failed.

## Decision

- **LLMs never drive state transitions.** Every pipeline (article, page refresh, translation,
  redesign, site audit, link pass) is a **deterministic Rust state machine**. It lives in the sim,
  as the project stage, and in `crates/agents`, as the job executor.
- **An LLM job returns an artifact**, validated against a JSON Schema:
  - a brief;
  - a page JSON;
  - a review `{score, verdict, notes}`;
  - a mood board;
  - theme files.

  The orchestrator reads the artifact and decides the transition. For example, an editor score of
  7 or above leads to Approved; a lower score leads to Revise, at most 3 times, and then a ticket.
- **Transition first, then side effect.**
  1. The transition is committed together with the command-log entry and the `Effect::RequestJob`,
     in one Postgres transaction.
  2. Only then are external effects executed by the job runner: a GitHub commit, a merge, a
     Claude call. Each effect is idempotent, keyed by an idempotency key.
  3. The effect's result returns as a `ServerCommand` (`JobCompleted`, `DeployLanded`).
- **Text never enters the sim.** `Cmd::JobCompleted{job_id, digest{ok, score, words, qa_defects,
  artifact_sha}}` carries only a digest. Text lives in the repo (content) or in Postgres
  (meetings).
- **Stubs fail loudly.** An unimplemented stage or executor blocks the project and opens a ticket.
  It never "succeeds" with a placeholder.

Alternatives considered:

- **Agentic orchestration** (an EiC agent decides the next step through tools). Rejected. It is
  nondeterministic, can't be replayed, and is the cause of the legacy stalls.
- **Side effect first, then transition.** Rejected. A crash in between leaves external state
  ahead of ours, as the legacy merged-but-not-approved PRs showed.

## Consequences

- Positive: pipelines are replayable and testable with `FakeClaude`, and every revision loop,
  reject and escalation path has a scripted test.
- Positive: an LLM can't skip QA or editorial review, whatever it outputs.
- Negative: less emergent agent behaviour. Creativity lives inside artifacts, not in process
  choices.
- Negative: each new artifact kind needs a schema, a validator and an orchestrator branch.
