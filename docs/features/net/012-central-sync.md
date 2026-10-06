---
id: FEAT-012
title: "Central sync: command-log segments and snapshots"
status: in-progress
importance: critical
paths:
  - crates/server/src/sync.rs
  - crates/server/src/db/sync.rs
  - crates/server/tests/sync.rs
  - crates/server/migrations/0002_executor.sql
  - apps/game/src/session/session.ts
  - apps/game/e2e/takeover.spec.ts
  - "apps/game/src/sync/**"
  - apps/game/src/net/central.ts
  - apps/game/src/net/central.test.ts
  - apps/game/e2e/mvp.spec.ts
  - apps/game/src/store/company-store.ts
  - apps/game/src/store/company-store.test.ts
  - apps/game/src/store/schema.ts
adrs:
  - ADR-0075
  - ADR-0038
  - ADR-0039
  - ADR-0045
  - ADR-0046
---

# Central sync: command-log segments and snapshots

Replaces "Lockstep sync and desync recovery" (ADR-0003's server authority was superseded by
ADR-0038).

The browser is authoritative for a company. It uploads **immutable command-log segments** and
the latest **snapshot** to the central server (`PUT /api/sync/{company}/log/{segment}`,
`PUT /api/sync/{company}/snapshot`). A fresh device restores from them and fast-forwards
(FEAT-014).

Acceptance:
- A segment is immutable once written: an identical PUT returns 200, a different one 409.
- Only the owner can read or write.
- A fresh browser context restores the same world hash as the device that wrote it.

## Next: fenced sync and central-first restore (increment A2, ADR-0045, ADR-0046)

Sync routes check ownership only today; the lease is not checked, and the snapshot is
last-writer-wins. A2 fences them and makes a forked log impossible.

- **Fenced writes:** segment and snapshot PUTs require the current epoch (FEAT-013).
- **Head compare-and-swap:** `sync_segments` gains `first_seq`, `last_seq`, `prev_sha` and
  `epoch`. In one `BEGIN IMMEDIATE`, a segment PUT must be the next segment number, start at
  `head_seq + 1` and name the head's sha in `x-swarmpress-prev`. An identical resend still
  returns 200. Two executors appending from the same seq cannot both pass.
- **Snapshot PUT:** `lastSeq <= head_seq` and a monotonic step.
- **The sealed log wins:** an unsealed local tail orphaned by a takeover is discarded. Its player
  commands are re-offered through `validate_command_json` against the new world; those that fail
  are reported.
- **Central-first restore:** `restore()` fetches the central head first. Local state wins only if
  `local.sealed_seq == head_seq` and the sha matches; otherwise the log tables are rebuilt from
  central. This fixes the stale device that overrode newer state.
- `SyncClient` grows to v2 (head, CAS headers). Work records and points come with FEAT-061 (ADR-0056),
  the world snapshot with FEAT-060, the state-repo mirror with FEAT-066.

Acceptance (A2):
- Server test with two writers on the same head: exactly one segment PUT succeeds, the other
  gets 409.
- A sync write with a stale epoch gets 409.
- `uploader.test.ts`: an orphaned tail is discarded and its still-valid player commands are
  re-applied.
- e2e, stale device: a device that returns after another progressed restores the newer state and
  never overwrites it.

Depends on: FEAT-013 (A1).

## Company text (ADR-0075, built)

Segments carry the company store's text journal. Every brief, artifact, transcript line, plan item
text, post and story line is journalled in its own write's transaction and sealed after
`sync.sealed_text`, up to 2 MiB per segment, in text-only segments when needed. A central restore
replays it into the empty store, and a store from before the journal journals its tables once.
Tests:
- `company-store.test.ts` (journal, rebuild, backfill);
- `uploader.test.ts` (text with commands, text-only segments, byte-for-byte resend);
- `e2e/mvp.spec.ts`: the fresh device has the item's thread and title.
