# ADR-0046 — Durable backup: world snapshots, text packs and a state-repo mirror

**Status:** Accepted (amends ADR-0041, ADR-0039 and CLAUDE.md rule 6)
**Date:** 2026-10-02

## Context

ADR-0041 keeps sync "our own: immutable command-log segments plus snapshots", and ADR-0039
stores those blobs as files on disk with an index in SQLite. Three things are wrong with what
that gives us today.

**The backup does not restore a company.** Sync carries the command log and a checkpoint. Plan
text, briefs, artifacts and transcripts live only in the browser store. A new device restores
the sim state with empty plan threads, and a job that was pending at restore fails on an
unknown `brief_ref`. The MVP acceptance test documents this.

**There is no world snapshot.** The "snapshot" is a checkpoint: `{scenario, seed, step, hash,
lastSeq}`. Every restore, including a plain reload from OPFS, replays from the seed. The cost
grows with the age of the company, not with the time away. With the step cost measured in
ADR-0042's spike (47 ms per 12,000 steps under Bun, about 3.9 µs per step) and the live rate of
864,000 steps per real day of stepping:

| History of stepping | Replay from seed |
|---|---|
| 1 real day | about 3.4 s |
| 1 week | about 24 s |
| 1 month | about 100 s |
| 1 year | about 20 min |

ADR-0038 budgeted "under 2 s" for a week. That figure assumed roughly 0.1 µs per step, about 40
times below the measured cost. Replay from the seed also breaks on any change to sim rules; a
snapshot is the only artefact that survives one.

**The player does not hold a copy.** The briefing behind this ADR asks for a private GitHub
repository as the durable, portable home of company state. A browser-side GitHub client is not
possible: rule 7 keeps repository credentials on the server, and ADR-0009 rejected user tokens
for repo writes. The five-method `SyncClient` also cannot express fencing, a compare-and-swap on
the head, or text.

## Decision

1. **Central storage stays the primary backup.** Fencing and the head compare-and-swap of
   ADR-0045 need one SQLite transaction. A GitHub commit cannot be part of it.

2. **One backup tree**, identical in central storage and in any mirror:

   ```
   manifest.json            format, scenario, seed, sim build, SimConfig, epoch, head,
                            snapshot ref, text generation and last pack, cursors, extensions
   log/NNNNNN.json          immutable segments (swarmpress.log.v1 plus a chain header)
   snap/<step>.bin          postcard World plus a header
   text/<gen>/NNNNNN.jsonl  immutable packs of changed rows: {table, key, value}
   ```

3. **A real world snapshot.** `client-wasm` gains `Sim.snapshot()` and `Sim.from_snapshot()`.
   A loaded snapshot is verified against its recorded hash. `World.effects` is not serialised,
   so `reissue_pending_jobs()` rebuilds the pending requests from `plan.jobs` after a load.
   - Retention: the last three snapshots plus one per real week.
   - Restore is snapshot plus the log tail. Log segments older than the oldest kept snapshot
     move to an archive tier: kept for audit and challenge replay, not read on restore.

4. **Text is part of the backup.** The packs carry `briefs`, `artifacts`, `transcripts`,
   `plan_items`, `plan_posts` and extension store tables.
   - The store's text tables gain a `rowver` column. A pack is the rows above the last packed
     `rowver`.
   - Upserts resolve by pack order; appends by their natural key.
   - Compaction writes a full base pack under a new generation and the manifest switches to it.
   - The kv entries that travel are `deploys.pending` and the events cursor. `sync.*` and
     `device.id` stay on the device.

5. **`SyncClient` v2** adds the head compare-and-swap, the manifest and text packs to the
   existing five methods. The 200/201/409 segment contract stays. Implementations:
   - `CentralClient` (browser and runner);
   - `FsSyncClient`, the same tree in a directory, for a self-hosted runner. The player may
     push that directory to any git remote they like.

6. **A mirror to the player's private state repository.** The server mirrors the same tree
   into a private repository on the player's account (ADR-0047), using the GitHub App's
   installation token. It is a background job, about one squashed commit per real day. It is
   not on the write path: a mirror that lags or fails never blocks play.
   - The mirror is an export. Restore reads central storage first and the mirror only when
     central has nothing, for example after an account moved.
   - Old snapshots are replaced, not accumulated, so the repository's size stays bounded by
     the log and text packs.

7. **Rule 6** is reworded: plan text, transcripts and artifacts live in the browser store and
   are backed up centrally as text packs; job outcomes are held centrally until logged
   (ADR-0045).

Nothing here is built. Increments A3 (snapshot), A4 (text packs, with the job ledger) and A9
(mirror) of the plan implement it.

## Consequences

- A fresh device or a runner resumes with full fidelity: sim state, plan threads and pending
  jobs.
- Restore time is bounded by the snapshot interval, not by the age of the company.
- The player holds a readable, portable copy of their company in their own repository.
- **Negative:**
  - Text that rule 6 kept in the browser now has a central copy, and a copy on GitHub. Both
    hold staff transcripts. The state repository must be private, and the mirror is opt-in if a
    player does not want that copy.
  - A snapshot ties a backup to a sim build. The manifest records the build; an executor
    refuses a snapshot from a different build and falls back to replay or a migration.
  - Central storage per company grows with text. A free quota applies (ADR-0044).
  - Two store migrations (`rowver`, post dedupe) and a wider `SyncClient`.
  - Mirror lag: the copy on GitHub can be up to a day behind.
- **Unverified:**
  - The step cost is the ADR-0042 demo spike, not the 13-person scenario in wasm.
  - The serialised size of `World` has not been measured.
  - Whether `plan.jobs` holds every field of `Effect::RequestJob` needed to re-issue a request.
  - GitHub's installation rate limits and its secondary limits on content-creating requests
    are from memory. The mirror is designed for a handful of calls per company per day.
- **Alternatives rejected:**
  - *GitHub as the primary store behind `/api/sync`.* The fencing check and the commit cannot be
    atomic; a crash between the commit and the index needs reconciliation; every seal costs
    several API calls; restore is a listing plus one request per segment.
  - *A second GitHub App whose user token the browser holds, limited to the state repository.*
    It breaks rule 7 and ADR-0009, the server sees no writes and so cannot fence them, and the
    only compare-and-swap is git's fast-forward check.
  - *Log-only backup with replay from the seed.* See the table above.
  - *Turso's sync engine.* Already rejected in ADR-0041; it syncs only with Turso Cloud.
