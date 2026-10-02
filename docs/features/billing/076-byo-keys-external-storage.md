---
id: FEAT-076
title: "Bring your own: provider keys and external storage"
status: planned
importance: normal
paths:
  - "apps/game/src/byo/**"
  - apps/game/src/sync/segments.test.ts
  - "crates/claude/**"
  - crates/server/src/assets.rs
adrs:
  - ADR-0054
  - ADR-0050
---

# Bring your own: provider keys and external storage

Increment C2. A player can avoid managed costs with their own services.

- **LLM key in the browser:** stored on the device, wrapped by a non-extractable WebCrypto key.
  It never enters the sim, the command log, sync, the sandbox or central logs. Calls go straight
  to the provider. The platform cannot meter this spend; local budgets are advisory.
- **Unattended use:** the self-hosted runner (FEAT-063) reads the key from the player's own
  environment. Central custody of player keys is not offered.
- **External storage:** a storage class with a public base URL that central verifies by hash at
  merge. No bucket credentials are held.
- The browser still never holds platform credentials (rule 7, as amended by ADR-0054).

Depends on: FEAT-075 for external storage; FEAT-063 for unattended use.

## Acceptance criteria

- [ ] The key is absent from sync segments, snapshots, text packs and the sandbox's globals.
- [ ] A job with a player key places no hold and writes no ledger entry.
- [ ] An external asset whose bytes do not match the sidecar hash blocks the merge.
- [ ] Removing the key returns jobs to the local model or the managed route, never silently.

## Evidence

- `game/vitest`
- `server/nextest`
