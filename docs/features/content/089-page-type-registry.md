---
id: FEAT-089
title: "Page-type registry: page types and their slots as data"
status: in-progress
importance: high
paths:
  - "crates/content-model/src/page_types.rs"
  - "crates/content-schema/schema/page-types.json"
  - "crates/content-schema/schema/page-types.schema.json"
  - "crates/knowledge/tests/page_types.rs"
  - "packages/content-schema/src/page-types.ts"
  - "packages/content-schema/test/page-types.test.ts"
  - "packages/site-kit/test/unit/page-types.test.ts"
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

## As built (2026-10-06)

- **The registry and the core types.** The format (`swarmpress.page-types.v1`) and the core types
  (`blog-article` with its aliases `blog-post` and `article`, and `blog-index`) are Zod in
  `packages/content-schema/src/page-types.ts`. `pnpm schema:export` writes them to
  `crates/content-schema/schema/page-types{.schema,}.json`, and `pnpm schema:check` catches drift.
- **Body checks.** `content_model::page_types` parses a registry, merges a site's
  `content/config/page-types.json` (a site may not reuse a core id or alias), and checks a body
  against its type: unknown blocks, slot counts, the opening and closing slot, slot order, required
  blocks, and raw HTML in theme-printed fields.
- **What reads the article type from the registry:**
  - the gateway's article profile (`check_article_profile`), for the body and the route; its
    constants are tested against the registry;
  - the pipeline's `ARTICLE_BLOCKS`, through a cross-check test;
  - the site kit's `isArticle`.
- **Closed world.** The knowledge base reports an unknown `page_type` as a `page_type` issue, before
  links and media. A type is known if the site declares it, or if one of its pages already uses it,
  so existing sites stay valid until they declare their types. The pack carries the site's registry.
- **Not yet done:** moving `BlockMeta` to shared data.

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
