# ADR-0050 — Binary assets: content-addressed object storage, sidecars in the site repo

**Status:** Accepted (amends ADR-0013's media index and CLAUDE.md rule 6)
**Date:** 2026-10-02

## Context

The home of binary bytes was never decided. In practice the live site hot-links third parties:
335 of the 338 entries in `content/config/media-index.json` are `images.unsplash.com` URLs.
`MediaEntry` (`crates/knowledge/src/media.rs`) carries an id, a URL and descriptive fields, but
no hash, size or MIME type, and site-kit's `resolveMedia` returns the URL unchanged. The legacy
TypeScript system had R2 storage with presigned URLs; none of it was carried forward.

Staff roles such as Photographer and VideoProducer, generated images and player uploads all
need a place for bytes that is not Git. Git stays the right home for text, code, metadata and
history. It is the wrong home for large binaries.

Three constraints shape the design:
- The gateway is the only writer to a site repo, and `PathPolicy` lets content agents write only
  under `content/**` (`crates/github/src/policy.rs`).
- The browser must not hold platform storage credentials (rule 7).
- Storing and serving bytes for a player is a managed resource, so it is metered above a free
  allowance (ADR-0044).

## Decision

1. **Bytes live in object storage; the site repo holds the manifest.**
   - Object storage is Cloudflare R2 (ADR-0049), behind an `ObjectStore` trait with a filesystem
     implementation for tests and local development.
   - Each asset has one sidecar file in the site repo: `content/media/{id}.json`, with `sha256`,
     `bytes`, `mime`, `dimensions`, `alt` (a `LocalizedString`), `license`, `photographer`,
     `storage` (`managed` | `external`) and `variants`.
   - `crates/knowledge` builds the closed media index from the sidecars plus the legacy
     `content/config/media-index.json`. Content keeps referring to assets as `media:<id>`
     (ADR-0013); pages never carry hashes or storage URLs.
   - Sidecars sit under `content/**`, so `PathPolicy` does not change. The gateway's draft
     endpoint gains a validation branch for media sidecars.
   - A Git commit therefore names exactly which immutable objects belong to that version of the
     site.

2. **Keys are content-addressed and namespaced per company.**
   - Private staging: `c/{company}/sha256/{hash}`.
   - Public: `p/{project}/{hash}.{ext}`.
   - Objects are immutable. A changed image is a new hash and a sidecar edit.

3. **Uploads go from the browser straight to storage.**
   - The browser computes the SHA-256, strips EXIF and produces the variant ladder (fixed
     widths, WebP). This is local work and therefore free.
   - It asks the central service for an upload. Central checks the lease epoch (ADR-0045), the
     quota and the spend policy (ADR-0052), then returns a short-lived presigned PUT with the
     length, content type and checksum signed in.
   - On completion central verifies size and checksum, sniffs the magic bytes against an
     allowlist (no SVG) and marks the asset staged.
   - The central server never proxies the bytes. A presigned URL is a scoped, expiring
     capability, not a credential.
   - The game page is cross-origin isolated, so staged objects are served with a
     `Cross-Origin-Resource-Policy` header.

4. **Promotion happens at merge.** The gateway's merge handler:
   - collects the hashes that the PR head's sidecars reference;
   - refuses with 409 if any managed asset is missing or blocked;
   - copies staging to public, idempotently;
   - only then merges at the exact head SHA.

   A failed merge leaves unreferenced public objects, which garbage collection removes.

5. **Garbage collection is mark and sweep with a retention window.**
   - Mark from `main`, open gateway PRs and the deploys of the last 30 days.
   - Sweep objects that have been unreferenced for 30 days.
   - Git history older than that may name objects that no longer exist. A revert goes through the
     same merge check and asks for a re-upload.
   - Takedown and erasure delete immediately and tombstone the hash.

6. **Variants are made in the browser at upload.** Cloudflare Images is a later, paid option and
   only with signed or allowlisted sizes. Build-time variants are not used.

7. **Metering.** Storage is billed as byte-days from the central `assets` table, above the free
   allowance. Uploads carry a small fixed price. Reads are not metered (R2 has no egress charge)
   and are served with immutable cache headers.

8. **The free path stays.** A player who uses no managed storage can keep external URLs as
   today, or use the `external` storage class: a public base URL of their own bucket, which
   central verifies by hash at merge. No credentials are held for it (ADR-0054).

Alternatives considered:

- **Binaries in Git or Git LFS.** Rejected. Repos grow without bound and LFS has its own quota
  and billing.
- **Global deduplication across companies.** Rejected. It creates a cross-tenant existence
  oracle, and makes billing, takedown and erasure ambiguous. The saving is small.
- **Extending `media-index.json` with hashes.** Rejected. Every draft branch would edit the same
  file and conflict.
- **A new top-level `assets/manifest.json`.** Rejected. It is outside `PathPolicy`'s content
  root and has the same single-file conflict problem.
- **Proxying uploads through the central server.** Rejected. It moves large bodies through the
  one process that must stay small.
- **Build-time image variants.** Rejected. They spend the player's Actions minutes on every
  build.

## Consequences

- Positive: a site version is reproducible from a commit plus immutable objects.
- Positive: the closed-world rule extends to bytes. A page cannot merge with a missing asset.
- Positive: per-company keys make billing, deletion and takedown simple.
- Negative: object storage is a new piece of infrastructure (ADR-0049 amends rule 13 for it).
- Negative: old Git history can outlive its objects after the retention window.
- Negative: browser-made variants depend on the player's device, and a re-encode is not
  byte-stable across browsers. Variants are therefore addressed by their own hash.
- Negative: serving public user media makes swarm.press a hosting provider. These items are open
  and need legal advice before managed media is offered:
  - notice-and-action and a point of contact;
  - blocking of known illegal content by hash;
  - a required licence field, an uploader attestation and a repeat-infringer policy;
  - processor terms with the storage provider, and erasure on account deletion;
  - labelling of AI-generated images.
- Not verified: whether an R2 presigned PUT enforces the signed checksum. If it does not, the
  completion check is the only integrity gate, which is sufficient but later.
