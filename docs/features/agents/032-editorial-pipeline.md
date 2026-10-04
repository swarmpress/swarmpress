---
id: FEAT-032
title: "Editorial pipeline (orchestrator)"
status: in-progress
importance: critical
paths:
  - crates/agents/src/pipeline.rs
  - crates/agents/src/article.rs
  - crates/agents/src/llm.rs
  - crates/agents/src/article_prompts.rs
  - crates/agents/src/fake_writer.rs
  - "crates/agents/tests/pipeline*.rs"
  - crates/agents/tests/article.rs
  - crates/agents/tests/repair.rs
  - crates/agents/tests/fake_writer.rs
  - "crates/agents/tests/fixtures/article/**"
  - "crates/orchestrator/**"
  - "crates/agents/prompts/**"
  - crates/orchestrator-wasm/src/lib.rs
  - apps/game/src/store/schema.ts
  - apps/game/src/store/company-store.ts
  - apps/game/src/store/company-store.test.ts
  - apps/game/src/llm/structured.ts
  - apps/game/src/llm/mvp-script.ts
  - apps/game/e2e/mvp.spec.ts
  - apps/game/src/orchestrator/bridge.ts
  - apps/game/src/orchestrator/bridge.test.ts
  - crates/orchestrator-wasm/tests/loop.test.ts
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

What exists today: Standup, Draft, Review and Publish jobs in `crates/orchestrator/src/run.rs`.
The Draft and Review jobs run in bounded stages (`crates/orchestrator/src/staged.rs`, P2 and P3):
context, outline, intro, sections and closing, each a call within the model's `LlmProfile` and
repaired with `structured_with_repair`; the page is assembled for the frozen theme and checked
against the site's closed world (`site_validator_v2`); a failing part alone is fixed; stage results
and posts are stored idempotently; revisions rewrite only the parts the review or the CEO's
send-back note names; the review reads text with part markers, part by part when long. No media,
QA or research stage runs yet; the standup is still the meeting of ADR-0012 (P4).

Built (P6, `crates/orchestrator/tests/timeout.rs`): the browser bridge aborts a model call past
its wall-clock limit (`stageTimeoutMs`, default 20 min, its clock stands still while the model is
not ready) and answers `LlmError::Timeout`; the stage is made once more, then the job ends with
`JobFailed{Timeout}` and keeps its completed stages, which the sim's `Retry` (a new job id) adopts.
`OrchestratorHandle.cancel(reason)` stops the running job between stages and aborts the call in
flight; the loop cancels a job past its own limit. Agent failures are `JobFailed{Model}` and
`JobFailed{InvalidOutput}`; a lost model (`Unavailable`) is not a failure: the run rejects and the
loop runs the job again once the model is back. The draft's hero shortlist leaves out the heroes of
the company's other unmerged articles; the `seo.title` suffix comes from the site's articles (else
the blog's name, else the brand).

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
