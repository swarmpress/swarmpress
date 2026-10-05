# Model qualification reports

Frozen go/no-go reports of the local model backends (ADR-0057; increment R7 of track R in
[`docs/mvp.md`](../mvp.md)). One file per backend and machine and day:
`<date>-<backend>-<machine>.md`, for example `2026-10-03-bonsai-apple-m3-max-128gb.md`.

- A report is **generated**, not written: `apps/game/e2e/bonsai-bench.spec.ts` writes it from the
  raw results of every run kept for that backend on that machine (`artifacts/bench/raw/`,
  git-ignored). Do not edit the numbers; run the benchmark again. How to run it:
  [`docs/runbooks/model-qualification.md`](../runbooks/model-qualification.md).
- The one exception is a run that takes the machine down: it writes no raw results, so its
  finding is written by hand in a file of its own (`<date>-<backend>-<machine>-<topic>.md`), says
  so at the top, and states what it does not establish.
- The thresholds are those of [`docs/design/mvp-runtime.md`](../design/mvp-runtime.md) section 7.
- Commit a report when it decides something, the no-go ones included, together with the ADR update
  that records the decision. The `cockpit.benchmark.v1` documents of the same runs stay in
  `artifacts/bench/` and reach Cockpit as CI or local evidence.
- Reports of the scripted backend (`?llm=fake`) never land here; they go to
  `artifacts/bench/qualification/`.
