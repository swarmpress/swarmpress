# M0: the WordPress storage seam spike (ADR-0084)

**Date:** 2026-10-10
**Plan:** [docs/design/wordpress-site-engine.md](../design/wordpress-site-engine.md) M0
**Status:** core WordPress passes every proposed go criterion. Plugin coverage and the php-wasm transport are still to be measured.

## Question

Under ADR-0084, WordPress's `wpdb` sends every statement across the sandbox boundary to the governed layer. The governed layer translates the MySQL to SQLite and runs it on a branch's projection. Two things decide whether that is viable:
- **Coverage:** can the translator handle what WordPress actually sends?
- **Cost:** what does the boundary cost per page?

## Method

1. **Capture the statements.** WordPress 7.1.3 ran on native PHP 8.5 with WordPress's own SQLite integration. Every statement reaching it was logged while driving these flows:
   - install;
   - the front page;
   - login, the dashboard and the post editor;
   - creating a post through the REST API, editing it, adding a tag and publishing it;
   - the post, tag and archive pages, and wp-admin's post list.

   The corpus has **2,020 statements in 147 distinct shapes** (`crates/storage-api/tests/fixtures/wp-corpus.jsonl`; the two password hashes are scrubbed). WordPress's code is not in this repository: the corpus is statements, and the schema (`wp-schema.sql`) was read from the database WordPress created (rule 16).
2. **Replay it** (`crates/storage-api/tests/replay.rs`): every statement in order, translated and run on an empty projection with that schema.
3. **Check equivalence.** The governed state after the replay (posts, terms and taxonomies, term relationships, key options, users) is compared with what WordPress's own SQLite integration stored for the same statements (`wp-expected.json`).
4. **Measure the boundary.** The projection runs behind a loopback HTTP host (`examples/host.rs`; keep-alive, JSON results). A native PHP client sends every statement with curl, as the forked `wpdb` will, and times each round trip.

## Results (Apple M3 Max, release build)

| Measure | Value |
|---|---|
| Statements handled | **2,020 of 2,020 (0% unhandled)** |
| State after replay | **equal to WordPress's own** on every governed table checked |
| Write classes | 88 governed, 80 scratch, **0 unknown** |
| Projection (translate and execute) per statement | p50 12 µs, p95 51 µs, p99 74 µs |
| Boundary (PHP → HTTP → translate → execute → JSON → PHP) per statement | **p50 118 µs, p95 220 µs, p99 370 µs** |
| Queries per page | front page 165; single post 91; REST post read 118; wp-admin pages 60 to 90 |
| Overhead per front page | about **21 ms**: about 10–15% of a native page, about 3% of a php-wasm page (0.7 s) |

**What the translator needed:**
- **Taken as they are by SQLite:** backticks, `LIMIT a,b`.
- **Translated:**
  - `SQL_CALC_FOUND_ROWS` / `FOUND_ROWS()`;
  - `ON DUPLICATE KEY UPDATE`, which becomes `ON CONFLICT (unique key) DO UPDATE`;
  - `INSERT IGNORE`;
  - the multi-table `DELETE` of expired transients;
  - `DESCRIBE` and `SHOW` introspection, and `information_schema.TABLES`;
  - `YEAR`, `MONTH` and `DAY`, and `DATE_ADD` / `DATE_SUB`.
- **Fixed after equivalence checking:** results now keep MySQL's column order, because `wpdb`'s numeric results depend on it. A sorted map had silently reordered them.
- **A semantic trap coverage counts miss:** MySQL's `LIKE` treats a backslash as the escape character, and WordPress's `esc_like` relies on it. SQLite needs `ESCAPE '\'`, which the translator adds.

## Against the proposed go criteria

| Criterion | Proposed | Measured | Verdict |
|---|---|---|---|
| Front page and wp-admin work | yes | all flows replayed to the same state | go |
| Per-query p95 | < 2 ms | 0.22 ms | go |
| Boundary overhead | ≤ 2× | about 1.1× native, about 1.03× php-wasm | go |
| Unhandled statements | ≤ 1% (core + 3 plugins) | 0% core; plugins not yet measured | go for core; plugins open |

## Open before M0 closes

1. **Plugins.** Measure Yoast SEO, Contact Form 7 and WooCommerce (read-only pages). They create their own tables, so the translator needs MySQL `CREATE TABLE` translated into the scratch store (ADR-0084 §3: unknown plugin tables are scratch).
2. **The php-wasm transport.** In the browser the seam is a message channel between the sandbox's worker and the game, not loopback HTTP. Measure its round trip; JSON encoding dominates either way.
3. **Semantic depth.** Equivalence is checked on the governed tables that matter for the flows above. WordPress's own PHPUnit suite against the fork is the M3 gate (ADR-0084 §7).
4. **The owner confirms the go criteria**, or changes them through an ADR amendment.
