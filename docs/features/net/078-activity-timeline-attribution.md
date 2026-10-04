---
id: FEAT-078
title: "Activity timeline and commit attribution"
status: in-progress
importance: high
paths:
  - apps/game/src/orchestration/activity.ts
  - apps/game/src/orchestration/activity.test.ts
  - apps/game/src/store/company-store.test.ts
  - crates/server/src/gateway.rs
  - crates/server/tests/gateway.rs
  - crates/orchestrator/src/gateway.rs
  - "crates/github/**"
  - apps/game/src/store/schema.ts
  - apps/game/src/store/company-store.ts
  - apps/game/src/orchestrator/bridge.ts
  - apps/game/src/ui/activity-source.ts
  - apps/game/src/ui/activity-source.test.ts
  - apps/game/src/ui/components/Activity.tsx
  - apps/game/src/ui/activity.test.tsx
  - apps/game/src/ui/fixtures/activity.ts
  - apps/game/src/ui/hud.tsx
  - apps/game/src/orchestrator/bridge.test.ts
  - apps/game/src/orchestration/approver.ts
  - apps/game/src/orchestration/approver.test.ts
  - apps/game/src/session/recording-gateway.ts
  - apps/game/src/session/recording-gateway.test.ts
  - crates/server/tests/attribution.rs
  - crates/orchestrator/tests/loop.rs
  - crates/orchestrator-wasm/tests/loop.test.ts
  - apps/game/e2e/mvp.spec.ts
adrs:
  - ADR-0056
  - ADR-0045
  - ADR-0009
  - ADR-0058
---

# Activity timeline and commit attribution

Increment A10. The owner wants to watch the agents work, continuously. Work records (FEAT-061)
hold who did what, in which job and with which model; this feature shows them.

- **Activity timeline:** a panel that lists the record chain as a live feed, filterable by
  staff member, job and work item. Each entry shows the text the job wrote and its diff
  against the previous revision. A job in flight shows its pending text.
- **Following from another device:** a device that does not hold the lease receives the same
  records through the events channel and shows them read-only.
- **Site-repository attribution:** the gateway's draft and merge requests gain optional
  attribution fields. The gateway writes the staff persona as git author, the swarm.press App
  as committer, and the same provenance trailers as the state-repo mirror. PathPolicy and the
  lease check are unchanged.

Depends on: FEAT-061 (work records), FEAT-013 (read-only mode for the non-holder).

## MVP: the lean version (ADR-0058; increments P5, U4, G6)

Design: [`docs/design/mvp-pipeline.md`](../../design/mvp-pipeline.md) section 8.

The MVP does not wait for work records (FEAT-061):

- **P5:** an `activity` table in the browser store, one row per stage attempt and one per job
  (staff, role, model, tokens, wall time, game step, result, references), written from orchestrator
  progress events. Shaped so ADR-0056 work records can absorb it.
- **U4:** the Activity panel lists jobs newest first with expandable stages, filters by staff, work
  item and kind, and pins the job in flight; a "Now" strip in the HUD.
- **G6:** attribution lands before the first live merge. Draft-branch commits carry the persona as
  author. The squash commit keeps the platform as author (the merge API has no author field) and
  carries `Co-authored-by` plus provenance trailers; this narrows ADR-0056 decision 8.
- Revision diffs and following from another device stay with FEAT-061.

Built (P5): the `activity` table (store migration 3) and `ActivityRecorder`
(`apps/game/src/orchestration/activity.ts`), written from the orchestrator's progress events and
the LLM bridge's per-call usage; the session's hook exposes the rows and the HUD chip reads
"Giulia · draft · section 3 of 5".

Built (U4): the Activity panel (`components/Activity.tsx`, toolbar entry after the Inbox, key A)
reads the record through the data source (`activity-source.ts`, `CompanyStore.activityPage`): the
newest 200 jobs, older ones on "load older", re-read only when the recorder has written a row. Each
job shows who, what (kind and work item, which opens in the Plan), model, wall time, tokens, game
time, result and its pull request; it expands to its stages and attempts. The job in flight is
pinned on top from progress events ("section 3 of 5 · 1:42"); filters by person, work item and
kind. The HUD's "Now" strip says what runs now and opens the panel on that job; while the clock is
held for that job the status chip already says it, so the chip becomes the click target instead
(no second line). Frozen `?t=` pages show neither. Not built: the label above the working person.

Built (G6, wiring): the staged Draft job sends the writer's attribution with its commit
(`staff_id`, `name`, `persona`, `role`, `job_id`, `job_kind`, `revision`, `work_item`, the model
id the bridge reports, and the session's `executor`); the Publish job sends the writer as author,
`reviewed_by` (the editor) and `approved_by`. The approver is filled in by the host at job time
(`apps/game/src/orchestration/approver.ts`): the CEO who answered the item's `PublishApproval`
ticket with `Publish` (from `Sim.inbox_json()`), named as the signed-in player; no name enters the
sim. `JsGateway` passes the attribution to the central gateway; the session's recording gateway
forwards and records it. The MVP suite reads the commits back from the server's fake GitHub
(`GET /api/dev/github/commit/{sha}`, fake GitHub only).

## Acceptance criteria

- [ ] After the MVP loop, the timeline lists one entry per job with staff member, job kind and
      model, and the revision diff between the two drafts.
- [ ] A second context without the lease sees new entries appear without a reload.
- [ ] The draft and merge commits in the fake GitHub carry the persona as author and the
      provenance trailers.
- [ ] A request whose attribution names a staff member not in the company is refused.

## Evidence

- `game/vitest`
- `game/playwright-mvp`
- `server/nextest`
