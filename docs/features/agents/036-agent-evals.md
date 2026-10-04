---
id: FEAT-036
title: "Agent eval harness and pipeline cost"
status: in-progress
importance: normal
paths:
  - apps/game/eval.html
  - apps/game/src/harness/eval-harness.ts
  - apps/game/src/harness/eval/briefs.ts
  - apps/game/src/harness/eval/local.ts
  - apps/game/src/harness/eval/runner.ts
  - apps/game/src/harness/eval/metrics.ts
  - apps/game/src/harness/eval/report.ts
  - apps/game/src/harness/eval/eval.test.ts
  - apps/game/src/harness/fixtures/cinqueterre-mini.eval.json
  - apps/game/e2e/eval.spec.ts
  - apps/game/playwright.eval.config.ts
  - crates/orchestrator/src/eval.rs
  - crates/orchestrator/tests/eval.rs
  - crates/orchestrator/tests/eval_calibration.rs
  - docs/qualification/check-calibration.md
  - crates/knowledge/tests/fixtures/cinqueterre-mini/content/config/content-calendar.json
  - xtask/src/site_pack.rs
  - docs/runbooks/eval.md
adrs:
  - ADR-0022
  - ADR-0026
  - ADR-0057
  - ADR-0058
---

# Agent eval harness and pipeline cost

Opt-in live eval harness with rubric grading; a deterministic run on the scripted model emitting
`cockpit.benchmark.v1` (calls, first-try validity and repairs per stage, wall time and tokens per
article).

Decisions: [ADR-0022](../../adr/0022-testing-strategy-cockpit-evidence-gate.md), [ADR-0026](../../adr/0026-model-registry-webgpu-capability-tiers.md),
[ADR-0057](../../adr/0057-strict-in-browser-inference-one-resident-model-on-webgpu.md), [ADR-0058](../../adr/0058-staged-jobs-on-one-resident-model.md).

## MVP: the eval harness and the "publishable" bar (increment E)

Design: [`docs/design/mvp-pipeline.md`](../../design/mvp-pipeline.md) section 9. Runbook:
[`docs/runbooks/eval.md`](../../runbooks/eval.md).

The harness is a browser page, because the model runs only in the browser (ADR-0057):
`apps/game/eval.html` + `src/harness/eval-harness.ts` (built with `vite build --mode harness`), with
the chosen local model (`?llm=fake|bonsai|chrome`, through the backend selection of
`src/llm/backend.ts`), orchestrator-wasm, an in-memory store and a local gateway that never
writes: nothing leaves the machine.

- **Input.** A site pack built from a local clone by `cargo xtask site-pack <site> --articles`
  (the knowledge pack plus the site's `content/pages/blog/*.json`). The committed fixture is the
  `cinqueterre-mini` one; the owner's real pack is never committed.
- **Briefs.** The first `?n=` unpublished topics of `content-calendar.json` (by priority, then
  calendar order; target lengths clamped to 600–1,200 words), each run through the real staged
  Draft and Review jobs with up to three revisions (the sim's rules: approved at 7).
- **Gateway checks.** Every committed draft is checked with the central gateway's own rules
  (`orchestrator::eval::gateway_checks`: the article profile now lives in
  `content_model::article_profile`, which the server re-exports, plus create-only and the closed
  world), so threshold 1 compares the two validators on the same code.
- **Editor discrimination.** The existing articles, read into parts and re-assembled in the
  article profile (`reference_article`), are positive controls; six seeded-bad drafts made from
  them (`seeded_bad`: block order, banned phrase, unknown entity, too short, raw HTML, duplicate
  slug) must be rejected by the editor and the checks.
- **Reported.** Per brief and in aggregate: approval within three revisions, revisions to
  approval, blocked by reason, first-try validity and repairs per stage type, truncation, wall time
  and tokens per stage, words against target, banned phrases, near-duplicates, heading structure,
  plain text, title and description length, link and media validity; the threshold rows of §9
  with a verdict each; a `cockpit.benchmark.v1` document
  (`artifacts/bench/agent-pipeline-eval-<backend>[.<machine>].json`, evidence
  `bench/agent-pipeline`) and a Markdown record for `docs/qualification/`.
- **The owner's judgement.** The page lists every generated article (title, dek, the text as the
  site shows it, scores, issues, checks) with "would publish / would not publish / factually wrong"
  marks kept in localStorage and exported as JSON; threshold 6 is pending until every approved
  article is marked.

## Acceptance criteria

- [ ] Deterministic scripted-model run emits stable call counts and rejects every seeded-bad
      draft (gating: `apps/game/src/harness/eval/eval.test.ts`, `e2e/eval.spec.ts` project `fake`).
- [ ] Live eval results are environment-sensitive (informational): the owner's run on Bonsai is
      recorded under `docs/qualification/`.

## Evidence

- `bench/agent-pipeline`
