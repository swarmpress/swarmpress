---
id: FEAT-013
title: "Company lease and the browser store (Turso wasm on OPFS)"
status: in-progress
importance: critical
paths:
  - crates/server/src/companies.rs
  - crates/server/src/db/accounts.rs
  - crates/server/tests/lease.rs
  - "apps/game/src/store/**"
  - apps/game/src/net/central.ts
  - apps/game/src/net/central.test.ts
  - apps/game/e2e/orchestrator.spec.ts
  - apps/game/e2e/mvp.spec.ts
adrs:
  - ADR-0038
  - ADR-0041
---

# Company lease and the browser store

Replaces "Company actors, command log and snapshots". The server no longer runs company actors
(ADR-0038).

- **Lease:** one device holds a company's lease at a time (`POST /api/companies/{id}/lease`),
  renewable, expiring after `SWARMPRESS_LEASE_SECS`. Gateway calls require it.
- **Store:** the browser keeps the command log, snapshots, plan, briefs, artifacts and
  transcripts in Turso wasm on OPFS, with an sqlite-wasm fallback, using one migration set
  (ADR-0041).

Acceptance:
- Taking an active lease from another device returns 409 unless forced.
- A reload restores the company from OPFS with an identical world hash.
