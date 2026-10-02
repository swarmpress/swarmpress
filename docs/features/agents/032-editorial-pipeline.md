---
id: FEAT-032
title: "Editorial pipeline (orchestrator)"
status: in-progress
importance: critical
paths:
  - crates/agents/src/pipeline.rs
  - crates/agents/src/article.rs
  - crates/agents/src/llm.rs
  - "crates/agents/tests/pipeline*.rs"
  - crates/agents/tests/article.rs
  - "crates/agents/tests/fixtures/article/**"
  - "crates/orchestrator/**"
  - "crates/agents/prompts/**"
  - crates/orchestrator-wasm/src/lib.rs
  - apps/game/src/store/schema.ts
  - apps/game/src/store/company-store.ts
  - apps/game/src/llm/structured.ts
adrs:
  - ADR-0011
  - ADR-0009
  - ADR-0058
  - ADR-0061
---

# Editorial pipeline (orchestrator)

Orchestrator-owned pipeline: standup pitch → brief → draft PR (`drafts/<project>`) → media → editor
review (≥ 7 approves, max 3 revisions) → QA → merge → deploy webhook → published.

Decisions: [ADR-0011](../../adr/0011-orchestrator-owns-state-transitions.md), [ADR-0009](../../adr/0009-site-repo-canonical-github-app.md).

## MVP: a staged pipeline for one bounded local model (ADR-0058)

Design: [`docs/design/mvp-pipeline.md`](../../design/mvp-pipeline.md) sections 1, 4 and 7.

What exists today: Standup, Draft, Review and Publish jobs in `crates/orchestrator/src/run.rs`; the
draft is one structured call with a 16,000-token budget; no media, QA, research or closed-world
checks run in the session path.

- **P1:** article shape for the frozen theme (hero, intro, sections, closing note; plain text;
  localized `seo`), v2 validator plus closed-world link and media checks.
- **P2:** staged draft inside the Draft job: context → outline → one section at a time → closing →
  assemble → validate → fix the failing section only. Flat schemas, `structured_with_repair`, a
  stage store keyed by (job, stage, index), post dedupe.
- **P3:** revisions patch only the sections the editor names; the review is sectioned when long.
- **P6:** timeout and cancel through the bridge; one retry, then `JobFailed{Timeout}`.

MVP acceptance (in addition to the criteria below):

- A failing section costs exactly one extra model call; other sections are not re-requested.
- A killed job resumes from stored stages with one pull request and one post of each kind.
- A revision naming one section changes only that section's bytes.
- Every rendered prompt fits the context ceiling for a 1,500-word article.

## Acceptance criteria

- [ ] FakeClaude scripted transcripts cover approve, revise loop, reject, escalation and QA fix loop.
- [ ] Full pipeline test with FakeClaude + FakeGitHub reaches `published`.
- [ ] Transition is committed before any GitHub side effect.

## Evidence

- `agents/nextest` (includes the `orchestrator` crate: `crates/orchestrator/tests/loop.rs`)
- `server/nextest`
- `bench/agent-pipeline`
