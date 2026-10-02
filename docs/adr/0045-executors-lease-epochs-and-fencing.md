# ADR-0045 — Executors, lease epochs and fencing

**Status:** Accepted (amends ADR-0038 and CLAUDE.md rule 7)
**Date:** 2026-10-02

## Context

ADR-0038 made the browser authoritative for its company "under a lease", with one active device
per company. What exists today falls short of that sentence:

- The lease is a random `lease_id` with a 90 s TTL (`SWARMPRESS_LEASE_SECS`). There is no
  counter. A check is a string comparison.
- Only the gateway routes require `x-swarmpress-lease`. The sync routes check the session and
  ownership only, so a device that lost the lease can still upload segments and overwrite the
  snapshot. That contradicts rule 7 ("only the lease holder writes").
- The session always takes the lease with `force: true` and only logs when it loses it. It keeps
  stepping and sealing.
- A device with a stale local store replays its own log and wins over newer central state.
- The gateway checks the lease and then calls GitHub for seconds. GitHub cannot check a token,
  so a takeover during that call lets a stale holder's side effect land unrecorded.
- Draft and review jobs are not idempotent. A second executor that re-runs a job posts twice
  and, once jobs cost money, pays twice.

We also want executors other than a browser tab: a runner the player hosts, and later a managed
runner (ADR-0048). With more than one kind of executor, "which one may write" has to be a
property the server can enforce, not a convention.

## Decision

1. **The lease-holding executor is authoritative.** ADR-0038's "the browser is authoritative"
   becomes "the executor that holds the lease is authoritative". Executor kinds are `browser`,
   `self` (a runner the player hosts) and `cloud` (a managed runner). There is exactly one
   holder per company at any time.

2. **One coordinator row per company** in central SQLite, `company_executors`:
   - `epoch` (monotonic integer, never reset), `holder_kind`, `holder_id`, `lease_id`,
     `acquired_at`, `renewed_at`, `expires_at`;
   - the log head: `head_seq`, `head_step`, `head_segment`, `head_sha`;
   - `events_cursor`;
   - handover: `handover_by`, `handover_deadline`;
   - scheduling: `next_wake_at`, `wake_reason`, `active_run_id`.

   The epoch gives safety. Expiry gives liveness only: an expired lease does not by itself make
   anyone else the holder.

3. **Lease modes** on the existing `POST /api/companies/{id}/lease`:

   | Mode | Rule | Epoch |
   |---|---|---|
   | `renew` | succeeds if the row's `lease_id` matches, even past expiry, if nobody else took it | unchanged |
   | `acquire` | succeeds if the lease is free, expired or released | +1 |
   | `request` | records a handover request and a deadline; answers 409 with the holder | unchanged |
   | `force` | immediate takeover | +1 |

   The reply carries `{epoch, lease_id, ttl_ms, head, handover_requested}`. `ttl_ms` is relative,
   so the client never subtracts its own clock from a server timestamp. Release carries the
   sealed head. `LeaseRevoked` and `HandoverRequested` are pushed on the events channel.

4. **Every write is fenced.** The token is `x-swarmpress-lease: <epoch>.<lease_id>`. It is
   required on:
   - gateway draft and merge;
   - log segment PUT and snapshot or manifest PUT;
   - text packs and job-ledger writes (ADR-0046);
   - paid spend (ADR-0051, ADR-0052);
   - wake scheduling and release.

   Reads are not fenced. The server closes event sockets that belong to a stale epoch.

5. **A per-company mutex closes the gateway race.** `AppState` holds one async mutex per
   company. It is held across the lease check, the external call (GitHub) and the bookkeeping
   write. `acquire` and `force` take the same mutex, so a takeover waits until an in-flight side
   effect has been recorded. This relies on the single server process (ADR-0049).

6. **The log cannot fork.** A segment PUT is a compare-and-swap on the head, in one
   `BEGIN IMMEDIATE` transaction. It requires the current epoch, `segment == head_segment + 1`
   (or an identical resend, which answers 200), `first_seq == head_seq + 1`, and the previous
   segment's sha. Two executors appending from the same seq cannot both pass.
   - The sealed log wins. A local tail that was never sealed is discarded after a takeover.
   - Player commands in a discarded tail are offered again through `validate_command_json`
     against the adopted world. Those that no longer validate are reported to the player.
   - Command logs are not merged. Commands are step-stamped and job ids are sequential, so two
     histories do not commute.

7. **Restore is central-first.** On boot an executor reads the central head before it trusts
   local state. Local state wins only if its sealed seq and sha equal the head. Otherwise the
   local log tables are rebuilt from central.

8. **Jobs survive a handover through a central job ledger**, `job_runs`, keyed by
   `(company_id, job_id, fingerprint)` where the fingerprint is the sha256 of the effect JSON.
   The order is: claim, run, complete with the outcome and its text, and only then apply the
   outcome to the sim. The browser's local outcome cache stays as a cache.

   | Ledger state at takeover | Action |
   |---|---|
   | done | adopt the outcome |
   | claimed, graceful handover | the outgoing executor finishes it, then seals |
   | claimed, forced or crashed: publish | re-run; publish is already idempotent |
   | claimed, forced or crashed: draft or review | re-run; paid model calls are replayed from a cache keyed by `(company, job_id, call_index)` |
   | standup | re-run only if the sim still waits for it |
   | late completion by a fenced executor | 409 |

   Plan posts get a dedupe key (`job_id:n`), so a re-run does not post twice.

9. **Handover protocol.**
   - *A browser returns while a runner holds the lease:* the browser sends `request` and shows
     the last sealed state read-only, with a "take over now" control that sends `force`. The
     runner sees `handover_requested` in its next renew reply, stops taking new jobs, finishes
     the job in flight within a bound, seals and releases. The browser then acquires.
   - *A runner wants to start while a tab is open:* a runner never forces a live browser lease.
     A hidden tab holds the lease without stepping, so with continuity enabled the browser seals
     and releases after it has been hidden for some minutes with no job running.
   - *Forced takeover or crash:* the epoch rises; the old holder's next fenced call gets 409.

10. **An executor that loses the lease halts.** It stops its loop and its clock and goes
    read-only. Logging and carrying on is a defect.

11. **CLAUDE.md rule 7** is reworded: the lease-holding executor is authoritative for its
    company, and every write carries the lease epoch.

Nothing in this ADR is built yet. The lease table has no epoch, sync is unfenced, and there is
no job ledger. Increments A1, A2 and A4 of the plan implement it, in that order.

## Consequences

- Rule 7 becomes enforceable by the server, for any kind of executor.
- The stale-device and lease-loss defects are closed by construction, not by a client patch.
- A handover never bills a job twice once the job ledger and the call cache exist.
- The coordinator is a row and a mutex. No new infrastructure.
- **Negative:**
  - The mutex serialises GitHub calls per company and assumes one server process. Scaling out
    means sharding by company, or moving the mutex into the database.
  - Job outcomes and their text are held centrally for a while. That is a new copy of text
    outside the browser store (rule 6 is amended by ADR-0046).
  - An unsealed tail can be lost on a forced takeover. Sealing on every job outcome and on
    `visibilitychange` keeps the tail short; it cannot make it empty.
  - The protocol has more states than a TTL lease. The handover and crash paths need their own
    tests: two writers on the server, and two browser contexts end to end.
  - A fenced executor's late job completion is sunk cost: the spend happened, the result is
    cached, and the new holder replays it.
- **Alternatives rejected:**
  - *Keep the random lease id and add a lease check to sync.* It closes the unfenced route but
    not the gateway race, and gives no order between holders.
  - *Fence with expiry alone.* Clocks and pauses (laptop sleep, a paused debugger) make a holder
    believe it still holds an expired lease.
  - *Merge divergent logs.* Not possible for this command log; see decision 6.
  - *A Durable Object per company as coordinator.* A second source of truth for the lease,
    apart from the SQLite that the gateway and ledger use (ADR-0049).
