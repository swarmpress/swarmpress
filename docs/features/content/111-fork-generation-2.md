---
id: FEAT-111
title: "The WordPress fork's Generation 2: the object seams"
status: in-progress
importance: high
paths:
  - crates/storage-api/src/object_api.rs
  - crates/storage-api/tests/host.rs
  - packages/runner/src/wordpress.ts
  - config/wp-sandbox.toml
adrs:
  - ADR-0084
---

# The WordPress fork's Generation 2: the object seams

Milestone M7 of [the build plan](../../design/wordpress-site-engine.md). Core's own data functions
call the storage API's object operations instead of sending SQL a statement at a time (ADR-0084 §4).
Plugins keep Generation 1: every seam steps aside, back to WordPress's own SQL, while a plugin
filters what it would bypass (`query`, the term-query filters, `update_post_metadata_cache`); core's
own callbacks on those filters do not count.

## Built

- **The object API** (`crates/storage-api/src/object_api.rs`), read from the branch's projection so
  Generation 1 SQL and the object seams see one state:
  - `options.all`: every option and its autoload flag;
  - `posts.prime {ids, meta, taxonomies}`: posts with their meta and their terms;
  - `posts.query {sql, …}`: `WP_Query`'s own final SQL, its found rows, and the posts primed;
  - `meta.load {type, ids}` and `terms.of {ids, taxonomies}`: the metadata and term APIs;
  - `post.save {data, id?}`: the row `wp_insert_post()` / `wp_update_post()` save.
- **The seams** (`swarmpress/wordpress` at `wp-7.1.3-sp.3`, one commit each): options (`option.php`),
  posts with their meta and terms (`post.php`), the metadata API (`meta.php`), the term API
  (`taxonomy.php`), `WP_Query`'s main path (`class-wp-query.php`, with `FOUND_ROWS()` answered
  without a message), post saves (`post.php`).
- **Readers keep their scratch:** a reader's request that changed nothing governed keeps its caches
  and transients; one that did is rolled back whole.
- **Measured** (the sandbox's `conformance/queries.mjs` on a seeded site, through
  `swarmpress wp-conformance`, evidence `bench/wp-seam`), storage messages per page:

  | page | before | readers keep scratch | Generation 2 | budget |
  |---|---|---|---|---|
  | front page | 75 | 26 | 15 | 18 |
  | single post | 83 | 34 | 22 | 27 |
  | category archive | 79 | 30 | 19 | 23 |
  | tag archive | 77 | 28 | 17 | 21 |
  | REST posts | 70 | 25 | 13 | 16 |

- **Exit gate:** WordPress's PHPUnit subset (option, post, meta, term: 2,116 tests) passes on the
  fork with Generation 2; the sandbox's conformance suite passes (7/7); the WordPress e2e tests pass
  in the browser (sandbox 0.4.0). Boundary p95 per message 1.15 ms with a release build of
  `swarmpress-storage`.

## Not built yet

- Typed mappings that would let plugins' own data leave Generation 1 (their tables stay scratch).
