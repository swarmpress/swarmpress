---
id: FEAT-078
title: "Activity timeline and commit attribution"
status: planned
importance: high
paths:
  - apps/game/src/ui/components/Activity.tsx
  - apps/game/src/ui/components/Activity.test.tsx
  - apps/game/src/ui/activity-source.ts
  - apps/game/e2e/activity.spec.ts
  - crates/server/src/gateway.rs
  - crates/server/tests/gateway.rs
  - crates/orchestrator/src/gateway.rs
  - "crates/github/**"
adrs:
  - ADR-0056
  - ADR-0045
  - ADR-0009
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
