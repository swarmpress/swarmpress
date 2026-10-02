# ADR-0025 — Browser job worker protocol, leases, leader election, server-side artifact validation

**Status:** Accepted
**Date:** 2026-10-01

## Context

With hybrid inference ([ADR-0024](0024-hybrid-inference-browser-llms-and-claude.md)), a player's
browser executes LLM jobs for their company. Browsers are untrusted, can close at any moment, may
have several tabs open, and must never hold GitHub credentials. The server must stay
authoritative.

## Decision

1. **Executor policy.** Every `JobKind` declares `Browser | Claude | BrowserThenClaude` and a
   minimum device tier. The server queues browser jobs in the same Postgres job table
   ([ADR-0008](0008-postgres-only-infrastructure.md)).
2. **One worker per company.** A connected client acts as the company's worker. Across multiple
   tabs, the **Web Locks API** (`navigator.locks.request('swarmpress-worker-<company>')`) elects a
   single leader. Other tabs only render.
3. **WebSocket frames:**
   - `JobOffer{job_id, kind, inputs_ref, schema_ref, min_tier}`
   - → `JobClaim{job_id}`, answered with a `lease_until`
   - → `JobProgress{job_id, token deltas}`, streamed straight into speech bubbles and the feed,
     and renewing the lease
   - → `JobResult{job_id, artifact}` or `JobFailed{job_id, reason}`
4. **The server validates every artifact:**
   - the JSON Schema;
   - closed-world links and media
     ([ADR-0013](0013-closed-world-knowledge-indexes.md));
   - size and safety limits;
   - prompt-injection hygiene (artifacts are data, never instructions to later prompts).

   Then the server stores the text (Postgres for meetings, the repo via PR for content) and
   injects `Cmd::JobCompleted{digest}`. **The server commits and merges**, never the browser.
5. **Re-queue.** An expired lease (no progress for 60 s) or a disconnect re-queues the job.
   Attempts count toward a retry limit. After that, `BrowserThenClaude` jobs escalate and
   `Browser` jobs open a ticket.
6. **Morning rush.** On reconnect, the client drains the queue by priority. In game, staff who
   were "waiting" start working.

Alternatives considered:

- **The browser commits to GitHub directly.** Rejected. It would leak credentials and bypass
  validation.
- **A BroadcastChannel-based election.** Rejected. Web Locks give exclusive, crash-safe ownership
  without heartbeats between tabs.
- **Trusting client validation** (the wasm validator). Rejected. The client runs it to save round
  trips, and the server repeats it.

## Consequences

- Positive: a modified client can at worst submit bad artifacts, and the server rejects them. The
  leaderboard counts only SiteAudit facts.
- Positive: the protocol is testable with a `FakeBrowserWorker` (claim, lease expiry, re-queue,
  invalid artifact rejection, reconnect drain), and multi-tab election is tested with Playwright.
- Negative: job latency depends on the player's presence. Offline companies accumulate a queue,
  which is a deliberate game mechanic.
- Negative: the server must hold enough context (inputs by reference) for jobs to resume on a
  different device.
