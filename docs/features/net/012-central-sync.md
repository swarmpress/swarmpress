---
id: FEAT-012
title: "Central sync: command-log segments and snapshots"
status: in-progress
importance: critical
paths:
  - crates/server/src/sync.rs
  - crates/server/src/db/sync.rs
  - crates/server/tests/sync.rs
  - "apps/game/src/sync/**"
  - apps/game/src/net/central.ts
  - apps/game/src/net/central.test.ts
  - apps/game/e2e/mvp.spec.ts
adrs:
  - ADR-0038
  - ADR-0039
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
