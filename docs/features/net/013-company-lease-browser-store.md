---
id: FEAT-013
title: "Company lease and the browser store (Turso wasm on OPFS)"
status: in-progress
importance: critical
paths:
  - crates/server/src/companies.rs
  - crates/server/src/db/accounts.rs
  - crates/server/tests/lease.rs
  - crates/server/migrations/0002_executor.sql
  - crates/server/src/app.rs
  - apps/game/src/session/session.ts
  - apps/game/e2e/takeover.spec.ts
  - "apps/game/src/store/**"
  - apps/game/src/net/central.ts
  - apps/game/src/net/central.test.ts
  - apps/game/e2e/orchestrator.spec.ts
  - apps/game/e2e/mvp.spec.ts
adrs:
  - ADR-0038
  - ADR-0041
  - ADR-0045
---

# Company lease and the browser store

Replaces "Company actors, command log and snapshots". The server no longer runs company actors
(ADR-0038).

- **Lease:** one executor holds a company's lease at a time (`POST /api/companies/{id}/lease`),
  renewable, expiring after `SWARMPRESS_LEASE_SECS`, with a fencing epoch (see below). Gateway
  calls require it.
- **Store:** the browser keeps the command log, snapshots, plan, briefs, artifacts and
  transcripts in Turso wasm on OPFS, with an sqlite-wasm fallback, using one migration set
  (ADR-0041).

Acceptance:
- Taking an active lease from another device returns 409 unless forced.
- A reload restores the company from OPFS with an identical world hash.

## Executor lease with epochs (increment A1, ADR-0045)

The lease becomes the company's **executor** record: `company_executors` (migration
`0002_executor.sql`) with a monotonic `epoch`, the holder kind (`browser`, `cloud`, `self`), the
lease id and expiry. The epoch gives safety; expiry gives liveness only.

- `POST /api/companies/{id}/lease` takes a `mode`: `renew` (epoch unchanged), `acquire` (+1),
  `request` (asks the holder to hand over; 409 with holder info), `force` (+1).
  - `acquire` by the executor that already holds the lease (a page reload) is a new holder
    instance: a new lease id at epoch + 1, which fences out the old instance.
  - `request` on a free lease takes it.
- The reply carries `{epoch, lease_id, token, ttl_ms, head, handover_requested}`. The relative
  TTL replaces the absolute `expires_at` that `LeaseKeeper` compared with the client clock.
  `head` is `{number, digest}` and stays at `{0, null}` until fenced sync moves it (FEAT-012).
- The token is the header `x-swarmpress-lease: <epoch>.<lease_id>`. The gateway replaces
  `require_lease` with the fenced check.
- A per-company mutex in `AppState` is held across the lease check, the GitHub call and the
  bookkeeping write. Acquire and force take the same mutex, so a takeover waits for an in-flight
  side effect to be recorded.
- A session that loses the lease halts its loop, stops the clock and goes read-only. It no longer
  force-takes the lease on every boot: it acquires, and when another executor holds the lease it
  starts read-only with a notice whose "Take over here" control reloads with `takeover=1`.
- `LeaseRevoked` and `HandoverRequested` go out on `/ws/events`. Both name the epoch they are
  about; an executor acts only on its own.

Not in A1:
- The server does not yet close event sockets of a stale epoch.
- A browser that is asked to hand over shows a notice; it does not seal and release by itself.
- Release does not carry the sealed head, and sync writes are not fenced (FEAT-012).
- `kind: cloud` is refused on this route; managed runs will get their lease from the coordinator
  (FEAT-065).

Acceptance (A1):
- The epoch rises on every change of holder and never on a renew; it is never reset.
- A gateway call with a stale epoch gets 409, including one that raced a takeover (mutex test).
- Playwright, two contexts (`takeover.spec.ts`): the second takes over, the first goes read-only
  and its next gateway call gets 409.
- A renew past expiry succeeds only if nobody else took the lease.

Later increments that build on this: FEAT-012 (fenced sync), FEAT-061, FEAT-063, FEAT-065.
