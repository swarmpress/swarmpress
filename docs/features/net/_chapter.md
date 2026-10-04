---
title: Server and networking
group: net
order: 2
---
# Server and networking

Local-first networking (ADR-0038): the central Rust service (`crates/server`, SQLite) for auth, company leases, the content gateway, events and sync, plus the browser store, catch-up and the browser orchestration loop.

| Feature | Title | Status | Importance |
|---|---|---|---|
| [FEAT-011](011-protocol-frames.md) | Wire protocol and versioning | in-progress | high |
| [FEAT-012](012-central-sync.md) | Central sync: command-log segments and snapshots | in-progress | critical |
| [FEAT-013](013-company-lease-browser-store.md) | Company lease and the browser store (Turso wasm on OPFS) | in-progress | critical |
| [FEAT-014](014-offline-catch-up.md) | Offline catch-up: restore and resume | in-progress | high |
| [FEAT-015](015-browser-orchestration-loop.md) | Browser orchestration loop | in-progress | critical |
| [FEAT-016](016-auth-sessions.md) | Auth: GitHub OAuth and cookie sessions | in-progress | high |
| [FEAT-060](060-world-snapshot.md) | World snapshot and pending-job re-issue | in-progress | critical |
| [FEAT-061](061-text-packs-job-ledger.md) | Backup completeness: work records, the projection and the job ledger | planned | critical |
| [FEAT-062](062-host-package.md) | Shared executor host package (packages/host) | planned | high |
| [FEAT-078](078-activity-timeline-attribution.md) | Activity timeline and commit attribution | in-progress | high |
| [FEAT-080](080-game-time-hold-and-rest.md) | Game time independent of GPU speed: clock hold and rest | in-progress | high |
