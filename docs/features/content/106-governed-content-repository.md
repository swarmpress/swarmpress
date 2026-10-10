---
id: FEAT-106
title: "The governed content repository"
status: in-progress
importance: high
paths:
  - crates/content-repo/src/lib.rs
  - crates/content-repo/src/blocks.rs
  - crates/content-repo/src/merge.rs
  - crates/content-repo/Cargo.toml
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

## Built

`crates/content-repo`: pure Rust, no clocks or I/O, so it compiles to wasm.
- **Block trees:** Gutenberg's serialization parses into a tree that prints back byte for byte.
  Unbalanced delimiters stay as HTML, so nothing is lost.
- **Commits:** digest-chained with domain-separated SHA-256 (`swarmpress:content:v1`) and
  attributed with author, job and model. `Commit::verify` detects tampering.
- **Branches:** heads move by compare-and-swap. `live` moves only by a merged change request, a
  rollback or an import.
- **Change requests:** a semantic diff down to fields and blocks. An inserted block reads as one
  added block, not as every later block changed.
- **Merges:** three-way at object level. Objects merge field by field. Block lists merge block by
  block: each side is aligned to the base, so an edit next to a deletion lands cleanly. The same
  block changed on both sides merges its attributes and inner blocks. A real conflict is a typed
  `Conflict` with the object, the path and all three values.
- **Releases:** tags on `live`; a rollback is a new commit.
- **Records:** append-only records for the store and the sync segments, verified on apply.

The projection mapping, change capture and the per-branch host that commit WordPress's writes
are in the storage API (FEAT-107).

## Not built

- Persistence in the company store and central sealing in the sync segments.
