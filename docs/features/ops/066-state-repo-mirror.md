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
  - ADR-0046
  - ADR-0047
---

# State-repo mirror

Increment A9. Central sync stays the primary backup, because only it can fence writes and
prevent a forked log atomically. The server mirrors the identical tree (`manifest.json`,
`log/`, `snap/`, `text/`) into a private state repository in the player's own account, with the
GitHub App installation token. The browser never holds a repository credential.

- One squashed commit per sealed day; snapshots beyond the retention window are dropped from the
  tree.
- The mirror is opt-in and lags; a failed mirror never blocks a seal.
- Import: a company can be restored from a state repo into an empty central record.

Depends on: FEAT-061, FEAT-046 (player-owned repositories).

## Acceptance criteria

- [ ] After a seal, the `FakeGitHub` tree equals the central tree byte for byte.
- [ ] A mirror failure leaves sync intact and is retried.
- [ ] Restore from the mirror reproduces the head hash.
- [ ] Mirror writes stay within the per-installation request budget (one tree commit per seal).

## Evidence

- `server/nextest`
- `github/nextest`
