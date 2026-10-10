---
id: FEAT-106
title: "The governed content repository"
status: planned
importance: high
paths:
  - docs/design/wordpress-site-engine.md
adrs:
  - ADR-0080
---

# The governed content repository

Milestone M2 of [the build plan](../../design/wordpress-site-engine.md):
- a Guardian-style repository per company (`crates/content-repo`, compiling to wasm), holding
  typed WordPress objects with parsed block trees;
- digest-chained, attributed commits;
- a branch per work item, change requests with a block-level diff, three-way merges at object
  level, releases and rollback;
- local persistence plus central sealing in the sync segments, with heads fenced by the lease.
