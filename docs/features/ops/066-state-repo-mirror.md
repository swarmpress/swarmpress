---
id: FEAT-066
title: "State-repo mirror"
status: planned
importance: normal
paths:
  - crates/server/src/mirror.rs
  - crates/server/tests/mirror.rs
  - "crates/github/**"
adrs:
  - ADR-0056
  - ADR-0046
  - ADR-0047
---

# State-repo mirror

Increment A9. Central sync stays the primary backup, because only it can fence writes and
prevent a forked chain atomically. The server mirrors the company's history into a private
state repository in the player's own account, with the GitHub App installation token. The
browser never holds a repository credential.

- One git commit per work record (ADR-0056): the author is the staff persona, the committer is
  the swarm.press App, and trailers carry `Record`, `Job`, `Job-Kind`, `Work-Item`, `Model`,
  `Executor`, `Epoch` and `World-Hash`. The tree holds the record and its text as readable
  files, so the commit view shows what the agent wrote.
- Commits are created per record and pushed in batches with one ref update.
- Bases live on a separate ref that is replaced, so snapshots do not accumulate in history.
- The mirror is opt-in and lags; a failed mirror never blocks a seal.
- Import: a company can be restored from a state repo into an empty central record.

Depends on: FEAT-061, FEAT-046 (player-owned repositories).

## Acceptance criteria

- [ ] After a seal, the `FakeGitHub` history has one commit per record, with the persona as
      author and the provenance trailers.
- [ ] A mirror failure leaves sync intact and is retried.
- [ ] Restore from the mirror reproduces the head digest.
- [ ] Mirror writes stay within the per-installation request budget (batched ref updates).

## Evidence

- `server/nextest`
- `github/nextest`
