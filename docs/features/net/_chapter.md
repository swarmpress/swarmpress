---
title: Server and networking
group: net
order: 2
---
# Server and networking

The authoritative Rust server (`crates/server`), the wire protocol and lockstep sync, persistence, catch-up, the job queue and auth.

| Feature | Title | Status | Importance |
|---|---|---|---|
| [FEAT-011](011-protocol-frames.md) | Wire protocol and versioning | in-progress | high |
| [FEAT-012](012-lockstep-sync.md) | Lockstep sync and desync recovery | planned | critical |
| [FEAT-013](013-company-actors-persistence.md) | Company actors, command log and snapshots | planned | critical |
| [FEAT-014](014-offline-catch-up.md) | Offline catch-up and fast-forward | planned | high |
| [FEAT-015](015-job-queue.md) | Postgres job queue | planned | critical |
| [FEAT-016](016-auth-sessions.md) | Auth: GitHub OAuth and cookie sessions | planned | high |
