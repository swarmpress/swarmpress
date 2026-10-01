---
id: FEAT-043
title: "Closed-world knowledge indexes"
status: planned
importance: critical
paths:
  - "crates/knowledge/**"
  - "crates/testkit/fixtures/cinqueterre-mini/**"
adrs:
  - ADR-0013
---

# Closed-world knowledge indexes

Entity, media, sitemap and schema indexes built from the site repo at a SHA; link and media
resolution for `write_page` and server-side artifact validation; NEEDS_PAGE / NEEDS_MEDIA tickets
instead of inventions.

Decisions: [ADR-0013](../../adr/0013-closed-world-knowledge-indexes.md).

## Acceptance criteria

- [ ] Index builders run against `cinqueterre-mini` and match golden output.
- [ ] Unknown link or media id is a validation error returned to the model.
- [ ] Indexes rebuild on push to main and record the SHA.

## Evidence

- `knowledge/nextest`
