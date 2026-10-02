# ADR-0056 — Work records: a digest-chained, attributable history of agent work

**Status:** Accepted (amends ADR-0046; refines ADR-0045 and ADR-0009); decision 8 narrowed by ADR-0058
**Date:** 2026-10-02

## Context

ADR-0046 made the backup complete: world snapshots, text packs and a mirror to the player's
state repository. It modelled text as mutable rows with a `rowver` column, uploaded as packs of
changed rows, with compaction generations and a mutable `manifest.json`.

Two things argue for a different shape.

**The staff are agents, and their work should be watchable.** The owner wants to monitor what
the agents do, continuously. Today that is not possible from the durable state:
- the log is sealed per game day or per publish, and plan text is not in it at all;
- a logged command does not say which staff member, job or model produced it;
- commits the gateway makes in the site repository carry no such attribution either;
- another device cannot follow a running company until the day is sealed.

A study of Guardian (`drietsch/guardian`, the owner's governed-data platform) showed what
delivers that property there: every change is a commit with an author, a provenance trailer
(agent, run, model version), the operations it applied and the resulting state root, chained to
its parent by digest. The value for monitoring is in that record. It is not in the Merkle state
tree, the branches or the merge engine underneath.

**The row-pack scheme is more machinery than the data needs.** Posts, briefs, artifacts and
transcripts are written once by a job and seldom or never changed. Treating them as mutable
rows forces row versions, upsert ordering, compaction generations and a separate dedupe key to
make re-runs safe. Guardian's rule is simpler: the immutable records are the truth, and
everything queryable is a projection that can be rebuilt from them. Its backup archive
(Guardian ADR-0090) adds two more ideas that fit object storage and a git mirror exactly:
segments are write-once and name their predecessor's digest, and "latest" is the newest key in
a listing, never a pointer that is overwritten.

## Decision

1. **The unit of durable company history is the work record.** One record is committed for
   each completed job, and one for each batch of commands that belong to no job (player
   commands, central events such as `DeployLanded`). Every logged command belongs to exactly
   one record. A record holds:
   - `format` (`swarmpress.record.v1`), its number, and `parent`: the digest of the previous
     record;
   - the executor: lease epoch and kind (ADR-0045);
   - attribution: staff id and role, job id, kind and revision, work item;
   - the model: id, version, tier, and whether it ran locally or through a managed or
     player-supplied service;
   - the commands, with their sequence numbers and steps, as today;
   - the **text records** the job wrote: briefs, the artifact (page JSON and review), plan
     posts, plan item text, transcript, extension rows. Each has a kind, a key and a digest;
   - artifact references when there are any: repository id, path, branch, pull request, head
     and merged commit;
   - the world hash after its last command, and the wall-clock time it was committed.

   Text never enters the sim (rule 2). Records live beside the sim, not in it, and the wall
   clock in a record never reaches the sim.

2. **A record is committed atomically.** The orchestrator's `Store` writes of a job are held as
   that job's pending text. When the job's outcome is logged, one local SQLite transaction
   writes the commands, the text records and the record itself. A job id commits at most once,
   so a re-run can never double-post. This replaces the `dedupe` key on plan posts.

3. **The SQLite tables are a projection.** `plan_items`, `plan_posts`, `briefs`, `artifacts`,
   `transcripts` and extension tables are rebuilt from the record chain, and a test proves the
   rebuilt tables equal the live ones. A value that changes (a plan item's text) is a new text
   record under the same key; the newest in record order wins. There is no `rowver` column and
   no compaction generation.

4. **Digests are cryptographic and domain-separated.** SHA-256, which the server already uses
   for segments and which the browser provides natively, over a domain prefix
   (`swarmpress:record:v1`, `swarmpress:text:v1`, `swarmpress:segment:v1`,
   `swarmpress:base:v1`) and the stored bytes. The stored bytes are the record: they are never
   re-encoded, so no canonical-JSON rule is needed. The sim's own `World::hash` (xxh3) stays as
   the determinism check; it is recorded in each record but is not what the chain trusts.

5. **The backup tree is write-once.** It replaces the tree in ADR-0046 decision 2:

   ```
   log/NNNNNN.jsonl     segment: a header naming the previous segment's digest, then records
   base/<record>.bin    base: world snapshot (ADR-0046 decision 3) plus the projection's rows
   point/<record>.json  point: format, scenario, seed, sim build, SimConfig, head record and
                        digest, the base it needs, cursors, extensions
   ```

   - Nothing in the tree is overwritten. The latest point is the highest key.
   - A segment is sealed when a record is committed, so a job is durable centrally as soon as
     it completes. Seals are coalesced when records arrive faster than the network.
   - Restore is the newest base at or before the target, then the records after it. Each
     record is verified against its digest and its parent on arrival.
   - Retention follows ADR-0046: the last three bases plus one per real week. Segments older
     than the oldest kept base move to the archive tier.
   - An executor may drop local records that are both sealed centrally and covered by a base,
     so the browser store stays within its quota.

6. **The head is one compare-and-swap.** The head of a company is `(record number, digest)`.
   A seal states the head it expects; the server moves it inside the same transaction that
   checks the lease epoch, and answers `head_moved {expected, actual}` otherwise. This is the
   head compare-and-swap of ADR-0045 expressed on records. A writer that finds its next segment
   key already present with other content stops; it never forks the chain.

7. **The mirror writes one git commit per record.** This replaces "one squashed commit per
   day" in ADR-0046 decision 6.
   - The commit's author is the staff persona; the committer is the swarm.press App.
   - Trailers carry the provenance: `Record`, `Job`, `Job-Kind`, `Work-Item`, `Model`,
     `Executor`, `Epoch`, `World-Hash`.
   - The tree holds the record and its text as readable files, so GitHub's commit view shows
     what the agent wrote and its diff against the previous revision.
   - Commits are created per record and pushed in batches with one ref update, to stay inside
     the installation's request budget.
   - Bases live on a separate ref that is replaced, so snapshots do not accumulate in history.
   - The mirror stays opt-in, server-side and off the write path.

8. **Site-repository commits carry the same provenance.** The gateway's draft and merge
   requests gain optional attribution fields. The gateway writes the persona as git author and
   the same trailers. PathPolicy and the lease check are unchanged. (Refines ADR-0009.)

9. **An Activity timeline reads the records.** The game shows the chain as a live feed: who did
   what, in which job, with which model, with the text and the diff, filterable by staff member,
   job and work item. In-flight jobs show their pending text. A device that does not hold the
   lease follows the same records through the events channel, read-only.

10. **One store contract, certified per engine.** The browser's two engines, the in-memory
    driver and the runner's store run one conformance suite against the in-memory driver as the
    oracle: atomic record commit, projection rebuild, reopen, and refusal to acknowledge a
    commit that did not reach stable storage.

11. **Not adopted from Guardian:**
    - the Merkle state tree, branches and three-way merge as the local engine. Company state
      has one writer under a lease and command logs do not merge (ADR-0045). The sim world is
      one value, not elements with fields. Content drafts already have real branches and
      review in the site repository;
    - Guardian's code. Nothing on its main branch builds for the browser, its store trait is
      synchronous, it has no delete or garbage collection, and using it would couple two
      products and overturn ADR-0041.

Nothing here is built. Increment A2 uses the record head; A4 becomes "work records and the
projection"; A9 becomes the per-record mirror; the Activity timeline and gateway attribution
are new increments.

## Consequences

- The agents' work can be watched as it happens, in the game and in GitHub's commit view, with
  attribution to staff member, job and model.
- The history is tamper-evident: a record cannot be altered without breaking every digest
  after it. That is the evidence the leagues of ADR-0055 are decided from.
- A fresh device or a runner restores full fidelity, and follows a running company record by
  record.
- Re-runs are idempotent by construction. The row versions, pack ordering, compaction
  generations and post dedupe key of ADR-0046 are not needed.
- Object storage and the git mirror only ever add keys, which is what both do well.
- **Negative:**
  - More central writes: one seal per job where there was one per game day. They count against
    the sync quota of ADR-0044.
  - Text is stored twice locally (record and projection) until local records are dropped.
  - Text cannot be edited in place. A correction is a new record; the old one stays in the
    history, and in the mirror if the player turned it on. Erasure is deletion of the company's
    chain; removing one record from the middle is not possible.
  - Every job's text is in the state repository's history, including transcripts. The
    repository must be private.
  - A job's `Store` writes are not visible in the tables until the job commits. Views that
    show work in progress must read the pending text.
  - One git commit per record is more GitHub requests than one a day. Batching bounds it, but
    a busy company on a runner needs measuring.
  - Existing browser stores and central sync data are not migrated. That is acceptable before
    release, and needs a migration after it.
- **Unverified:**
  - Record and text volume per game day for the 13-person scenario, and the resulting local
    and central storage.
  - GitHub's limits on content-creating requests, which are from memory.
  - Whether streaming transcript chunks can always be held as pending text until the meeting
    job completes.
- **Alternatives rejected:**
  - *Keep ADR-0046's mutable rows and packs.* It restores a company but gives no attribution
    and no per-job history, and needs the versioning machinery listed above.
  - *Attribution fields on commands only.* Commands carry digests, not text (rule 2), so the
    history would still not show what an agent wrote.
  - *A full commit graph with branches for company state.* See decision 11.
  - *A separate audit log beside the backup.* Two histories that can disagree; the record
    chain is both.
