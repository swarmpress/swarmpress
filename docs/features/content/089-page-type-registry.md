---
id: FEAT-089
title: "Page-type registry: page types and their slots as data"
status: planned
importance: high
paths:
  - "crates/content-model/src/page_types.rs"
  - "crates/content-model/src/article_profile.rs"
  - "crates/content-model/tests/page_types.rs"
  - "packages/content-schema/src/page-types.ts"
  - "packages/site-kit/src/routes/plan.ts"
adrs:
  - ADR-0072
  - ADR-0014
  - ADR-0061
---

# Page-type registry: page types and their slots as data

After the MVP, and the first increment of the site blueprint (B-0). Each page type becomes data: id,
label, route and slots (required, allowed and repeated blocks, in order), plus its linking rules.
`check_article_profile()` becomes the check of a page against its type, and the site kit's
`ARTICLE_TYPES` list becomes data too. `page_type` becomes a closed-world id, so an unknown type is a
validation error returned to the model. `BlockMeta` (intent, media and linking rules) moves from Rust
code to data that both Rust and TypeScript read.

Design: [`docs/design/construction-kits.md`](../../design/construction-kits.md) §3.3 (increment B-0).

## Acceptance criteria

- [ ] The `blog-article` profile, expressed as data, accepts and rejects exactly the pages the current
      `check_article_profile()` does (shared fixtures).
- [ ] An unknown `page_type` in a draft is a closed-world issue with the known ids listed.
- [ ] Rust and TypeScript read the same `BlockMeta` data; a drift check fails CI.
- [ ] The frozen theme path is untouched.

## Evidence

- `content/nextest`
- `content-schema/vitest`
- `site-kit/vitest`
