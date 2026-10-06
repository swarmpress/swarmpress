# ADR-0075 — Company text travels with the log segments

**Status:** Accepted (a first increment of ADR-0056's work records; ADR-0056 stays the target)
**Date:** 2026-10-06

## Context

Central sync carries the command log and the world snapshot. Everything the staff wrote stays in
the browser store and never leaves the device:
- briefs, artifacts (page JSON and reviews), transcripts, plan item text, plan posts, and the
  story director's lines.

So a device that takes the company over has the sim without its text. The Plan panel shows items
without titles or threads, transcripts are empty, and the next job that needs a brief or the
artifact of a work item in flight cannot find it. ADR-0056 decides the full answer: per-job work
records in a digest chain with attribution, a projection rebuilt from them, a write-once backup
tree and a git mirror. None of it is built, and it is weeks of work. Meanwhile, every takeover
loses the company's text.

## Decision

1. **A text journal in the company store** (migration 4, `text_journal(n, kind, key, value,
   created_at)`).
   - Every text write appends a journal row in the same transaction:
     - `brief`, `brief-claim`;
     - `artifact`;
     - `transcript` (`job:seq`);
     - `item` (title and brief);
     - `post`;
     - `kv` (only `story.line.*`).
   - A first-write-wins write that changes nothing (a re-run job's brief or transcript line)
     writes no row.
   - This is ADR-0056 decision 3's shape: the newest text of a key wins, and the tables can be
     rebuilt from the journal.
2. **Segments carry the journal.**
   - A `swarmpress.log.v1` segment gains an optional `texts` array of `{n, kind, key, value}`:
     the rows after `sync.sealed_text`, up to 2 MiB per segment.
   - A seal may add segments that hold only text.
   - Without texts, a segment's bytes are exactly those of a segment before this ADR, so older
     segments and devices are unaffected.
   - Recovery works as for commands. A planned segment names its text range in
     `sync.pending_segment` and is sent again byte for byte. A 409 adopts the remote texts only
     when they are this journal's own.
   - The server is unchanged: segments are opaque bytes to it.
3. **A central restore replays the texts** into the empty store through the same writes, so they
   are journalled there too, and marks them as sealed.
4. **A store from before the journal journals its tables once** when it opens with an empty
   journal, so the next seal carries the company's existing text.

## Consequences

- A device restored from central (a takeover, a cleared browser) has the company's text as of
  the last seal: the threads, titles, briefs, artifacts and transcripts. The MVP e2e now asserts
  this.
- Text written after the last seal is lost with the device, exactly like commands. Seals stay
  per game day and per publish.
- **Negatives:**
  - The journal keeps every version of a mutable text, so the store holds text twice (as in
    ADR-0056), and artifacts with many revisions grow it. Nothing prunes it yet.
  - Sync volume grows by the text written, against ADR-0044's sync quota.
  - Stage rows, the activity record and per-device kv (the story director's playback state)
    are not synced. A new device re-runs a job in flight without its finished stages and shows
    an empty Activity history.
  - A post without a dedupe key replayed twice would appear twice. Replay happens only into
    an empty store.
  - No attribution, digest chain, per-job atomic commit or mirror: those remain ADR-0056 work.
- **Alternatives:**
  - Build ADR-0056 now. Rejected for this increment because of its size. The journal is its
    projection's input and moves into records later.
  - Full text dumps with each snapshot. Rejected: the cost grows with the company's whole
    history at every seal.
  - Per-table watermarks instead of a journal. Rejected: plan items and transcripts have no
    change order, and updates in place would be missed.
