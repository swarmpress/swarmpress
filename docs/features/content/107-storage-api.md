---
id: FEAT-107
title: "The storage API and the WordPress fork's storage seams"
status: in-progress
importance: high
paths:
  - crates/storage-api/src/lib.rs
  - crates/storage-api/src/translate.rs
  - crates/storage-api/src/classify.rs
  - crates/storage-api/src/projection.rs
  - crates/storage-api/src/ddl.rs
  - crates/storage-api/src/objects.rs
  - crates/storage-api/src/host.rs
  - crates/storage-api/tests/host.rs
  - crates/storage-api/src/protocol.rs
  - crates/storage-api/src/derived.rs
  - crates/storage-api/src/bin/swarmpress-storage.rs
  - crates/storage-api/examples/translate.rs
  - crates/storage-api/tests/fixtures/wp-corpus-plugins.jsonl
  - crates/storage-api/examples/host.rs
  - crates/storage-api/tests/replay.rs
  - crates/storage-api/tests/fixtures/wp-corpus.jsonl
  - crates/storage-api/schema/wordpress.sql
  - crates/storage-api/tests/fixtures/wp-expected.json
  - docs/qualification/wp-seam-spike.md
  - crates/storage-api-wasm/src/lib.rs
  - crates/storage-api-wasm/Cargo.toml
  - apps/game/src/php/storage-host.ts
  - apps/game/src/php/storage-host.test.ts
  - apps/game/src/php/storage-client.ts
  - apps/game/src/php/storage-protocol.ts
  - apps/game/src/php/storage-worker.ts
  - apps/game/src/php/storage-wasm-load.ts
  - apps/game/e2e/wordpress.spec.ts
adrs:
  - ADR-0084
  - ADR-0080
---

# The storage API and the WordPress fork's storage seams

The governed side of ADR-0084: the fork's `wpdb` sends MySQL as WordPress wrote it; the storage
API translates it to SQLite, runs it on a branch's projection, and classifies writes as governed
or scratch.

## Built (M0, the spike)

- The translator, for the constructs WordPress uses:
  - backticks and `LIMIT a,b` (SQLite takes them);
  - `SQL_CALC_FOUND_ROWS` / `FOUND_ROWS()`;
  - `ON DUPLICATE KEY UPDATE`, which becomes `ON CONFLICT … DO UPDATE` on the table's unique key;
  - `INSERT IGNORE`, and multi-table `DELETE`;
  - `DESCRIBE`, `SHOW`, and `information_schema.TABLES`;
  - date functions and `DATE_ADD` / `DATE_SUB`;
  - MySQL's backslash escape in `LIKE`.
- The classifier: transients, cron, sessions, edit locks and auto-drafts are scratch; content and
  settings are governed; other tables are unknown.
- The projection on SQLite, with results that keep MySQL's column order.
- A loopback host for the boundary measurement.
- Measured ([write-up](../../qualification/wp-seam-spike.md), `artifacts/bench/wp-seam-core.json`):
  - all 2,020 statements of WordPress 7.1.3's core flows are handled, and the replay ends in the
    same governed state as WordPress's own SQLite integration;
  - the projection takes p50 12 µs per statement;
  - the boundary over loopback HTTP takes p50 118 µs and p95 220 µs;
  - the front page costs about 21 ms of overhead.
- Plugins: Contact Form 7, Yoast SEO and WooCommerce replay with 0.08% unhandled. Their tables go
  to the scratch store through the DDL translator (`ddl.rs`).
- Tests: `crates/storage-api/tests/replay.rs`, and the unit tests in `classify.rs` and `ddl.rs`.

## Built (M3, the governed side)

- **Executor:** the projection runs on any SQLite through `Exec`: rusqlite natively (feature
  `native`), the game's sqlite-wasm in the browser.
- **Projection mapping** (`objects.rs`):
  - posts with their block trees, meta and terms; terms with their taxonomies; settings;
    users without their password hash; comments; links;
  - meta keyed by id, so branches merge it field by field;
  - scratch (auto-drafts, revisions, transients, cron, sessions, edit locks) never becomes an
    object.
- **Change capture:** temporary triggers record the objects each request touched.
- **The host** (`host.rs`):
  - one projection per branch, brought up to its head incrementally;
  - each request's governed changes become one attributed commit;
  - `live` refuses governed writes outside a new company's import phase;
  - AUTOINCREMENT counters start at the repository's high-water marks, so branches never hand
    out the same id.
- **End to end** (`tests/host.rs`), on WordPress's own statements:
  - the install imports onto `live`;
  - every later request commits on a work branch, which reaches WordPress's state;
  - a projection rebuilt from the repository alone holds the same content;
  - the change request merges into `live`, and `live`'s projection follows.

- **The protocol** (`protocol.rs`):
  - the storage channel the fork's seams speak: `query`, `end`, `session`, `asset.put`,
    `asset.get`, `mail`, `http`;
  - the governed API: sessions binding a sandbox to a branch, a signed-in user and an author;
    branches, change requests with their diffs, the merge queue, releases and rollback;
  - commit authors come from the session, never from WordPress.
- **After a merge,** term counts are recomputed from the merged posts (`derived.rs`).
- **A new company's projection starts without tables.** WordPress's installer creates them from
  the governed definitions, as it would on an empty MySQL database.
- **`swarmpress-storage`:** the protocol as a native service, for the runner, the sandbox's Node
  entry and conformance. The repository persists as verified append-only records, assets by
  digest, and mail in an outbox. Outgoing HTTP fails loudly until a fetch proxy is configured.
- **Measured once by hand** with the fork (`swarmpress/wordpress`) on native PHP against
  `swarmpress-storage`, before conformance automates it:
  - WordPress's installer imports onto `live`;
  - a REST post on a work branch becomes a commit attributed to the session's agent, job and
    model;
  - the change request merges, and `live`'s front page shows the post.

## Not built

- The projection built from the repository (FEAT-106), and change sets as commits.
- The fork's seams themselves (`swarmpress/wordpress`, M3).
