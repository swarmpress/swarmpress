# Runbook: qualify the article pipeline before going live (the eval)

> **Decides:** whether the staged article pipeline is good enough to write for the live site
> (Milestone B of [`docs/mvp.md`](../mvp.md), track E; FEAT-036). The model itself is qualified
> first, by [`model-qualification.md`](model-qualification.md).
> **Thresholds:** [`docs/design/mvp-pipeline.md`](../design/mvp-pipeline.md) section 9, in
> `apps/game/src/harness/eval/metrics.ts` (`THRESHOLDS`). They are proposals: the owner sets the
> numbers, and the owner's own reading of the articles is part of the bar.
> **Target machine:** Apple M3 Max, 128 GB, macOS 26.4, Chrome 154.

The harness is `apps/game/eval.html` (code in `apps/game/src/harness/eval-harness.ts` and
`apps/game/src/harness/eval/`), driven by `apps/game/e2e/eval.spec.ts` through
`apps/game/playwright.eval.config.ts`. One run:

1. loads a **site pack** built from your local clone of the site (`cargo xtask site-pack`);
2. takes the first *N* **unpublished topics of the content calendar** as briefs (by priority, then
   calendar order; a topic whose slug the site already has is skipped; target lengths are clamped to
   600–1,200 words);
3. runs each brief through the **real staged pipeline** (orchestrator-wasm: draft in stages, review,
   up to three revisions; approved at a score of 7 or above, as the sim decides) on the chosen local
   model, with an in-memory store and a local gateway: **nothing leaves the machine**, no pull
   request is opened, nothing is merged;
4. checks every committed draft with the **gateway's own checks** (`check_draft`: the article
   profile from `content_model::article_profile`, create-only, closed-world links and media);
5. has the editor review the **site's existing articles** (positive controls) and **six
   seeded-bad drafts** made from them (wrong block order, a banned phrase, an unknown village and
   link, far too short, raw HTML, an existing slug), which the editor and the checks must reject;
6. reports a `cockpit.benchmark.v1` document, a record for `docs/qualification/`, and a page that
   lists **every generated article** for you to read and mark.

## Prerequisites

- The model qualification passed (or at least ran) on this machine, so the Bonsai weights are in the
  Chrome profile `apps/game/.bonsai-profile/` and the engine is installed
  (`node apps/game/scripts/bonsai-runtime.mjs --check`).
- Setup, from the repository root:

  ```sh
  pnpm install
  cargo xtask wasm
  ```

- Your clone of the site, up to date, at `cinqueterre.travel/` next to `apps/` (any path works).

## 1. Build the site pack

From the repository root:

```sh
git -C cinqueterre.travel pull --ff-only
cargo xtask site-pack cinqueterre.travel --articles --out /tmp/cinqueterre.eval.json
```

The summary line names the commit, the counts and the articles, e.g.
`site-pack: commit 1a2b… · 9 files (… bytes of text) · 157 pages · 338 media · 19 articles · … bytes`.
The pack is your site: **never commit it** (keep it outside the repository, as above). The commit is
the clone's `HEAD`; a warning says when `content/` has uncommitted changes.

## 2. Run the eval on Bonsai

In `apps/game/`:

```sh
cd apps/game
BONSAI_E2E=1 EVAL_PACK=/tmp/cinqueterre.eval.json \
  pnpm exec playwright test -c playwright.eval.config.ts --project=real
```

Chrome opens (headed, the Bonsai profile), the pack is loaded and the run starts. The terminal prints
each brief and job. Settings, as environment variables in front of the command:

| Variable | Default | |
|---|---|---|
| `EVAL_LLM` | `bonsai` | `chrome` for Chrome's built-in model (labelled separately; it needs a click, which the spec makes) |
| `EVAL_N` | `20` | briefs; §9 needs at least 20 (the real calendar has 20 unpublished topics) |
| `EVAL_JOB_TIMEOUT_MIN` | `60` | a job that takes longer fails threshold 7 (the job is not cut off) |
| `EVAL_TIMEOUT_MIN` | `720` | the test's own limit |
| `BENCH_MACHINE` | from the CPU and memory | the machine's name in the file names |

Expect hours: 20 briefs are about 20 × (outline, about 6 parts, closing, review, often a revision and
a second review) model calls of tens of seconds to minutes each. Keep the window visible and the
machine plugged in. The test fails only when the run did not complete; a failed threshold is a
result.

It writes:

- `artifacts/bench/agent-pipeline-eval-bonsai.<machine>.json`: the Cockpit document (evidence
  `bench/agent-pipeline`, FEAT-036);
- `artifacts/bench/raw/eval-bonsai.<machine>.json`: every result, every article, every stage;
- `docs/qualification/<date>-eval-bonsai-<machine>.md`: the record, verdict **pending** until you
  have read the articles.

The same page works by hand: `pnpm exec vite build --mode harness && pnpm exec vite preview --mode
harness --port 4179`, then open `http://localhost:4179/eval.html?llm=bonsai&n=20`, choose the pack
with **Load a site pack or exported results…** and press **Start**.

## 3. Read the articles and mark them

1. Serve the harness build (`pnpm exec vite preview --mode harness --port 4179` in `apps/game/`,
   after a `vite build --mode harness`) and open `http://localhost:4179/eval.html`.
2. **Load a site pack or exported results…** → choose
   `artifacts/bench/raw/eval-bonsai.<machine>.json`.
3. Read every article under **Generated articles**: title, dek, the text as the site would show it,
   the editor's scores, notes and issues, and the measured checks. For each approved one tick
   **would publish** or **would not publish**, and **factually wrong** if it says anything untrue.
   The marks are saved in this browser (localStorage, per site commit and per article text) and the
   threshold table above updates as you mark.
4. **Export JSON (results and your marks)** downloads `eval-bonsai-<commit>.json`.

Also look at the **site's own articles** (what the editor thought of articles you published) and
the **seeded-bad drafts** (which faults the editor saw by itself).

## 4. Record the result

In `apps/game/`, rebuild the document and the record with your marks (no browser):

```sh
EVAL_REPORT_ONLY=1 EVAL_RESULTS=~/Downloads/eval-bonsai-<commit>.json \
  pnpm exec playwright test -c playwright.eval.config.ts --project=real
```

It prints every threshold row and the verdict and rewrites
`docs/qualification/<date>-eval-bonsai-<machine>.md`. Commit the record (and only the record):

```sh
git add docs/qualification/*-eval-bonsai-*.md
git commit -m "docs(qualification): pipeline eval on Bonsai, <verdict> (FEAT-036, ADR 057, ADR 058)"
```

## Reading the verdict

| # | Row | Bar (proposed) | If it fails |
|---|---|---|---|
| 1 | committed drafts passing the gateway's `check_draft` | 100% | the orchestrator's validator and the gateway disagree: a code bug, not a model problem |
| 2 | approved within 3 revisions; median revisions | ≥ 80%; ≤ 1 | the "Blocked or failed" line says why (score, cap, a draft that could not be made valid) |
| 3 | first-try validity per stage; mean repairs; truncation | ≥ 90%; ≤ 0.3; ≤ 2% | the per-stage table names the stage: prompts, answer budgets or the model's context |
| 4 | approved articles within ±25% of target, no banned phrase, no near-duplicate paragraph | all | the checks column of each article |
| 5 | editor rejects ≥ 5 of 6 seeded-bad; scores ≥ 7 on ≥ 80% of the existing articles | | an editor that cannot tell good from bad cannot be the only gate before the CEO |
| 6 | you would publish ≥ 80% of the approved articles, none factually wrong | | your marks; **pending** until every approved article is marked |
| 7 | no job over its timeout | 0 | the longest job is reported; median minutes per article is informational |

Plus at least 20 briefs. The **calibration** line lists the checks the site's own articles fail
(create-only aside): a check that fails many accepted articles is miscalibrated, not the articles
(for example a banned phrase that the style guide lists and a live article uses).

A pass here, with the rehearsal on a fork (`fork-rehearsal.md`), is Milestone B.

## The scripted run (CI-able)

The same harness on the scripted model, the committed `cinqueterre-mini` pack
(`apps/game/src/harness/fixtures/cinqueterre-mini.eval.json`) and three briefs, in headless
Chromium, about a minute plus the harness build:

```sh
cd apps/game
pnpm exec playwright test -c playwright.eval.config.ts --project=fake
```

It asserts the document's shape, stable counts and that every seeded-bad draft is rejected, and
writes `artifacts/bench/agent-pipeline-eval-fake.json`. Its verdict is FAIL by design (three briefs,
a scripted editor). The fixture is regenerated with

```sh
cargo xtask site-pack crates/knowledge/tests/fixtures/cinqueterre-mini --commit 3f2a9c1d5e7b4a6f8091a2b3c4d5e6f708192a3b --articles --out apps/game/src/harness/fixtures/cinqueterre-mini.eval.json
```

and `cargo test -p xtask` fails when it is stale.
