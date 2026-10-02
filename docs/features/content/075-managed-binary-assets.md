---
id: FEAT-075
title: "Managed binary assets"
status: planned
importance: high
paths:
  - crates/server/src/assets.rs
  - crates/server/src/db/assets.rs
  - crates/server/src/object_store.rs
  - crates/server/tests/assets.rs
  - crates/server/src/gateway.rs
  - crates/server/tests/gateway.rs
  - crates/knowledge/src/media.rs
  - crates/content-model/src/media.rs
  - packages/site-kit/src/resolve.ts
  - "apps/game/src/assets/**"
adrs:
  - ADR-0050
  - ADR-0013
---

# Managed binary assets

Increment C1. Git stays canonical for text and metadata; binary bytes live in object storage.

- **Keys:** `c/{company}/sha256/{hash}` in private staging, `p/{project}/{hash}.{ext}` in the
  public bucket. No deduplication across companies.
- **Metadata:** one sidecar per asset, `content/media/{id}.json` (sha256, bytes, mime,
  dimensions, licence, storage class, variants). `crates/knowledge` builds the media index from
  the sidecars plus the legacy `media-index.json`. PathPolicy is unchanged.
- **Upload:** the browser hashes the file, strips EXIF and makes WebP variants; central returns a
  presigned PUT with signed length, type and checksum, then verifies size, checksum and magic
  bytes (no SVG).
- **Promotion:** the gateway merge refuses with 409 if a referenced asset is missing or blocked,
  copies staging to public idempotently, then merges at the exact head SHA.
- **GC:** mark from `main`, open gateway PRs and 30 days of deploys; sweep what stayed
  unreferenced for 30 days. Takedown deletes at once and tombstones the hash.
- **Free path:** external URLs as today, the 1 GB allowance (FEAT-067), or the external storage
  class (FEAT-076). Storage above the allowance is metered in byte-days (FEAT-070).
- The object store is a trait with a filesystem fake first; R2 is one implementation.

Depends on: FEAT-039, FEAT-043; FEAT-070 for metering.

## Acceptance criteria

- [ ] A merge whose head references a missing or blocked asset is refused.
- [ ] Promotion is idempotent; a failed merge leaves only unreferenced public objects.
- [ ] An upload with a wrong checksum, length or type is rejected and never staged.
- [ ] GC keeps everything reachable from `main`, open PRs and recent deploys.
- [ ] A sidecar with an unknown hash is a validation error returned to the model (rule 5).

## Evidence

- `server/nextest`
- `knowledge/nextest`
- `content/nextest`
- `site-kit/vitest`
