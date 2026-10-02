# ADR-0049 — Managed infrastructure: single-binary control plane, Cloudflare data plane

**Status:** Accepted (amends ADR-0039 and CLAUDE.md rule 13)
**Date:** 2026-10-02

## Context

Rule 13 and ADR-0039 fix the central service as one Rust binary with SQLite, one process, and
no Postgres, Temporal, NATS, Redis or external queues. No hosting target has been named, and
nothing in the repo mentions a cloud provider.

The managed layer needs three things that binary does not have:

- **object storage** for binary media (ADR-0050) and for backup blobs, which ADR-0039 already
  allows "later";
- **delivery** of public media from a CDN;
- **compute** to run the continuity runner (ADR-0048) for players who pay for it.

The briefing behind this ADR sketches the managed layer on Cloudflare: a Worker for the API, a
Durable Object per company as coordinator, Workflows or Queues for jobs, and Containers for the
runner. A Durable Object per company maps neatly onto "one coordinator per company" and scales
to zero. It also moves the control plane.

## Decision

1. **The control plane stays one Rust binary with SQLite.** It owns auth, the executor lease
   and coordinator row (ADR-0045), the gateway, sync, the events inbox, the ledger and the spend
   gate. Rule 13 stands for the control plane: no external queues, no second database.

2. **Cloudflare is the data and compute plane:**
   - **R2** for binary media and for backup blobs (segments, snapshots, text packs);
   - **the CDN**, and optionally Cloudflare Images, for public media delivery;
   - **containers** as one host for the managed runner.

   The server reaches them through narrow interfaces: an object-store trait with a filesystem
   implementation for development and self-hosting, and a runner launcher with a
   child-process implementation.

3. **The coordinator is a row and a timer.** A background task in the server scans
   `next_wake_at` and starts a run. A new event for a company sets its wake. The first
   implementation spawns the runner as a child process under a semaphore; a container launcher
   replaces it behind the same interface.

4. **The runner is an ordinary client.** It talks to the same HTTP API as the browser, with a
   per-run bearer token scoped to one company and one run. It holds no database connection and
   no platform credential beyond that token. Model calls go through a central proxy; web
   fetches go through the existing fetch proxy, so the SSRF guard and metering stay in one
   place.

5. **Rule 13 is reworded** to add: object storage is permitted for binaries and backup blobs;
   the managed runner is a separate process (Bun) started by the server.

6. **Self-hosting stays possible.** The binary, SQLite, a directory for blobs and the runner on
   the same machine are a complete installation. Nothing in the control plane requires
   Cloudflare.

7. **Revisit trigger.** The single process is revisited when one process can no longer carry
   the load. The first step is sharding by company, as ADR-0039 already says.

Not built: there is no object-store trait, no launcher, no hosting configuration and no
production deployment.

## Consequences

- The lease, the head compare-and-swap, the gateway mutex and the ledger share one database
  and one process. The fencing design of ADR-0045 depends on that.
- One thing to operate and to self-host. No vendor in the control plane.
- R2 has no egress fee, which suits public media.
- **Negative:**
  - Bun becomes a dependency of the server host for managed runs.
  - One process is a ceiling. The per-company mutex and in-process timers do not scale out
    without sharding.
  - The server does not scale to zero. An idle platform still costs a small machine.
  - Two vendors' concepts to operate once containers are in use: the server's host and
    Cloudflare.
  - Child-process runs share the server's machine until the container launcher exists.
- **Unverified:** Cloudflare's prices and limits (R2 operations, Images transformations,
  container billing and cold start) are from memory and must be checked before pricing is set
  (ADR-0051).
- **Alternatives rejected:**
  - *Workers plus a Durable Object per company as the control plane.*
    - A second source of truth for the lease. The gateway and the ledger would have to consult
      the Durable Object on every write, so the gateway would have to move too, and then the
      whole server. It is all or nothing.
    - A rewrite: the server is axum, tokio and sqlx on SQLite with blobs on disk, none of which
      runs on Workers as it is.
    - It ties the control plane to one vendor and makes self-hosting impractical, against the
      product's own bring-your-own goal (ADR-0054).
  - *Queues or Workflows for job orchestration.* External queues, which rule 13 forbids, for a
    job the coordinator row and a timer already do.
  - *Decide later, keeping both options open.* Designing the lease and ledger for two control
    planes would cost more than choosing now.
