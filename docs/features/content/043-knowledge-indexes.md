---
id: FEAT-043
title: "Closed-world knowledge indexes"
status: planned
importance: critical
paths:
  - "crates/knowledge/**"
  - "crates/knowledge/tests/**"
  - crates/knowledge/src/pack.rs
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
the `cinqueterre-mini` fixture, but no crate depends on it, the browser receives no index, and no
closed-world check runs in the session path. The status stays `planned` until K1 lands.

- **K1:** `knowledge::pack::{build, load}`, `KnowledgeBase::from_parts`, `RepoApi::snapshot`, and
  `GET /api/gateway/knowledge` (lease, ETag = base head).
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

- `knowledge/nextest`
