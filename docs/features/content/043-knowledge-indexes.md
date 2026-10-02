---
id: FEAT-043
title: "Closed-world knowledge indexes"
status: in-progress
importance: critical
paths:
  - "crates/knowledge/**"
  - "crates/knowledge/tests/**"
  - crates/knowledge/src/pack.rs
  - crates/github/src/snapshot.rs
  - crates/github/tests/snapshot.rs
  - xtask/src/site_pack.rs
  - crates/orchestrator/src/article.rs
  - crates/server/src/gateway.rs
adrs:
  - ADR-0013
  - ADR-0061
---

# Closed-world knowledge indexes

Entity, media, sitemap and schema indexes built from the site repo at a SHA; link and media
resolution for `write_page` and server-side artifact validation; NEEDS_PAGE / NEEDS_MEDIA tickets
instead of inventions.

Decisions: [ADR-0013](../../adr/0013-closed-world-knowledge-indexes.md).

## MVP: the knowledge pack (ADR-0061; increments K1, K2)

Design: [`docs/design/mvp-pipeline.md`](../../design/mvp-pipeline.md) section 3.

What exists today: `crates/knowledge` builds the indexes from a `SiteSource` and has tests against
the `cinqueterre-mini` fixture. The crate half of K1 is built: the pack, the repository snapshot
and `cargo xtask site-pack`. No route serves the pack yet, the orchestrator does not depend on
`knowledge`, the browser receives no index, and no closed-world check runs in the session path.

- **K1, built:**
  - `knowledge::pack::{build, load}`. A pack is `{commit, files, manifest, pages}`:
    - `files` holds, verbatim, the eight `content/config` files (`entity-index`, `media-index`,
      `sitemap-index`, `style-guide`, `writer-prompt`, `content-calendar`, `linking-policy`,
      `media-guidelines`, all `.json`) and `content/pages/blog-index.json`. A file the site does
      not have is left out.
    - `manifest` is the site manifest. It is carried because a site without `site.manifest.json`
      infers it from files the pack does not hold, and link resolution depends on its languages
      and base URL.
    - `pages` is the routed page list (`PageEntry`), not the page bodies.
  - `Pack::to_json` is deterministic, so the same tree at the same commit gives the same bytes.
  - `load` needs no `SiteSource` and compiles to wasm (`KnowledgeBase::from_parts`,
    `PageRegistry::from_entries`). The loaded base answers link, media and page-registry
    questions as one built from the tree does. It has no collection index and lists no stray
    copies, which articles do not need.
  - `RepoApi::snapshot(repo, ref, prefix)` returns the text files under a prefix at one commit.
    `HttpGitHub` decodes the repository tarball as it downloads, with size caps; `FakeGitHub`
    enumerates its tree. `Snapshot` implements `SiteSource`.
  - `cargo xtask site-pack <site-dir> [--out file] [--commit sha]` builds the pack of a local
    clone. On cinqueterre.travel at `2d5683c` the pack is 384 kB, 48 kB gzipped.
- **K1, open:** `GET /api/gateway/knowledge` (lease, ETag = base head), which builds the pack
  from a snapshot of `content/`.
- **K2:** `knowledge` compiled into `orchestrator`; the browser caches the pack by commit and
  refetches before each standup and after each merge; `SiteBinding` is built from the real style
  guide and writer prompt.
- Unknown link or media ids come back to the model as section-scoped validation errors; an empty
  hero shortlist raises a `NeedsMedia` ticket.

## Acceptance criteria

- [ ] Index builders run against `cinqueterre-mini` and match golden output.
- [ ] Unknown link or media id is a validation error returned to the model.
- [ ] Indexes rebuild on push to main and record the SHA.

## Evidence

- `knowledge/nextest`, `github/nextest`
