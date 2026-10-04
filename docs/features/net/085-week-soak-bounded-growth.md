---
id: FEAT-085
title: "A week without stalls: bounded growth and the soak test"
status: in-progress
importance: high
paths:
  - apps/game/src/soak/soak.ts
  - apps/game/src/soak/soak.wasm.test.ts
  - apps/game/src/orchestration/sweeper.ts
  - apps/game/src/orchestration/sweeper.test.ts
  - apps/game/src/orchestration/loop.ts
  - apps/game/src/orchestration/loop.test.ts
  - apps/game/src/orchestration/activity.ts
  - apps/game/src/store/company-store.ts
  - apps/game/src/store/company-store.test.ts
  - apps/game/src/session/session.ts
  - apps/game/src/session/recording-gateway.ts
  - apps/game/src/orchestrator/bridge.ts
  - apps/game/src/orchestrator/index.ts
  - apps/game/src/llm/fake-llm.ts
  - crates/sim-core/tests/finance_week.rs
  - crates/server/src/deploys.rs
  - crates/server/tests/deploys.rs
  - crates/server/migrations/0005_redeploy.sql
  - crates/orchestrator/src/run.rs
  - crates/orchestrator/src/gateway.rs
  - crates/orchestrator/tests/redeploy.rs
  - crates/orchestrator-wasm/src/lib.rs
  - crates/orchestrator-wasm/tests/loop.test.ts
  - apps/game/src/net/central.ts
  - apps/game/src/net/central.test.ts
adrs:
  - ADR-0058
  - ADR-0059
  - ADR-0060
  - ADR-0061
---

# A week without stalls: bounded growth and the soak test

Track W of `docs/mvp.md` ("what done means", item 6): a week of game days runs without a stall,
a duplicate or a silent failure. Design: `docs/design/mvp-pipeline.md` §7.

## Bounded growth

Everything the browser keeps per job, per step or per event is capped, swept or justified:

- The orchestration loop (`orchestration/loop.ts`): `jobs` keeps the last 50 finished jobs,
  `errors` the last 50; the de-duplication sets (`seen`, `completed`, `landed`) the newest 4,096
  (a restore re-emits only jobs the sim still waits for, so older ids never come back); the
  per-meeting utterance seq is dropped when the meeting's job closes; held deploy events of a
  closed item are dropped (checked once per applied command, not per step).
- The bridge keeps the newest 20 prompts in the session (`SESSION_LLM_CALLS`), the recording
  gateway 200 calls, the session's received central events 200 (`KEEP_EVENTS`); the `?llm=fake`
  model 20 calls.
- Stage rows (`job_stages`) are swept at boot and at every day start
  (`orchestration/sweeper.ts`): the rows of a job the sim no longer waits for whose item is
  published or cancelled, and of finished standups. A blocked item keeps its rows for `Retry`.
- A standup reads the activity of the newest 30 jobs (`activityPage`), not the whole record.
- Transcripts, plan posts, the activity record and the command log are the company's record
  and grow with the work done (linearly; the soak checks the rate does not climb). Plan items
  are left alone (about 20 a week).
- No full plan parse per step: the clock's hold reads `Sim.next_due_step()`; the soak measures
  about 0.0014 `plan_json()` calls per sim step (one per job intake and per applied deploy).

## Deploy failures

The server's `DeployFailed` event is applied as `DeployFailed{work_item}` once the item waits
for its deploy (`OrchestrationLoop.deployFailed`), which blocks it with a `DeployFailed` ticket.
Before, the session ignored the event and the item waited for a deploy that never came.

**Retry redeploys** (finding 8, closed). The CEO's `Retry` on that ticket requests the Publish
job again (the sim is unchanged). The merge is done, so the job asks the gateway for the merge's
deploy state; when the server reports `failed` it calls `POST /api/gateway/redeploy` instead of
merging, posts "its deploy failed; deploying it again" and completes, and the sim waits for
`DeployLanded` as after a merge (`Orchestrator::redeploy_if_failed`, `crates/orchestrator/src/run.rs`).
The signal is the server's deploy state, not anything in the sim: a run of the same job after a
reload finds the merge `pending` (or `landed`) and calls nothing.

- The server re-runs the failed jobs of the deploy workflow's run (`deploy.yml`) on the commit
  whose deployment failed, a new attempt on the same commit, so the poller and the webhook see
  it like the first; the merge is `pending` again from the request (its age limit restarts).
  Idempotent per failed run attempt; refused for a merge that landed, one with no run to re-run,
  or when GitHub refuses the re-run (the Actions write permission): the job then fails with the
  server's reason in the item's thread, the host reports `JobFailed{Infrastructure}`, and the item
  stays blocked with an escalation ticket (rule 11). See the "Redeploy" section of
  `crates/server/README.md`.
- If the redeploy fails too, the server sends a new `DeployFailed` with a higher `attempt`: a new
  ticket. The loop applies each `(work item, attempt)` once, so the same failure delivered twice
  raises no second ticket.
- The soak's fake central server redeploys the same way, and the soak asserts that the CEO's
  `Retry` redeployed the failed merge and that the item was published.

## The soak

`apps/game/src/soak/soak.ts` runs one company on the real wasm sim and orchestrator, wired as
`session.ts` wires them, with fakes at the edges: the `?llm=fake` model behind a seeded fault
injector (2–40 s per call, 5% invalid answers, 2% hangs until the 120 s stage limit, one model
loss mid-job, one draft that hangs twice and fails with `JobFailed{Timeout}`), a fake central
server (one PR per item, idempotent merges, 1% gateway errors plus one forced error after the
server did the work for a draft and a merge, a deploy per merge 60–240 s later, one deploy
failure and its redeploy), the CEO answering by policy (and absent for one day), and one page reload mid-draft.
Vitest fake timers drive the wall clock: a game day takes about five seconds.

It asserts: every item ends published or killed, or has a pending job, an open ticket or a
deploy in flight; no duplicate PR, merge, post, utterance or outcome; the command log replays to
the live world's hash; the clock never reached the due step of a job whose outcome was not
applied (ADR-0060); no unhandled promise rejection; no finance ticket; the bounded collections
stay within their caps, stage rows are swept, and the heap (after a full collection) stays flat
after day 2.

- Short (CI, in `pnpm --filter @swarm-press/game test`): two game days, about 8 s.
- Full: `SOAK_DAYS=7 SOAK_REPORT=1 pnpm --filter @swarm-press/game exec vitest run src/soak`
  (about 35 s; prints the per-day table).

The finance guard (`crates/sim-core/tests/finance_week.rs`): seven game days with no revenue
raise no finance ticket; the runway after a week is about 59 game days.
