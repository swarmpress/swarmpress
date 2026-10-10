# M0: the WordPress storage seam spike (ADR-0084)

**Date:** 2026-10-10
**Plan:** [docs/design/wordpress-site-engine.md](../design/wordpress-site-engine.md) M0
**Status:** core WordPress and three common plugins pass every proposed go criterion, and php-wasm's PHP-to-JavaScript call is fast enough for the browser transport. The fork's `wpdb` seam itself is measured end to end in M3.

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

   The corpus has **2,020 statements in 147 distinct shapes** (`crates/storage-api/tests/fixtures/wp-corpus.jsonl`; the two password hashes are scrubbed). WordPress's code is not in this repository: the corpus is statements, and the schema (`crates/storage-api/schema/wordpress.sql`) was read from the database WordPress created (rule 16).
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
| Plugin statements handled (Contact Form 7, Yoast SEO, WooCommerce) | **3,874 of 3,877 (0.08% unhandled)**; the 3 are Yoast reading tables before creating them, which MySQL answers with the same error |
| php-wasm `post_message_to_js` round trip (Node, PHP 8.4 asyncify) | synchronous listener p50 20 µs, p95 51 µs; **asynchronous listener p50 70 µs, p95 608 µs** |

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

**Plugins** (captured after core: activating each through REST, then the front page, a Contact Form 7 page, the shop, a product created through WooCommerce's REST API, their wp-admin screens and a post edited with Yoast active):
- **DDL in the scratch store** (`src/ddl.rs`). The plugins' `CREATE TABLE`, `ALTER TABLE`, `CREATE INDEX`, `DROP` and `TRUNCATE` become SQLite for their own tables:
  - types map to SQLite affinities;
  - `AUTO_INCREMENT` keys become `INTEGER PRIMARY KEY AUTOINCREMENT`;
  - keys become indexes named per table, without MySQL's prefix lengths;
  - charset and engine options are dropped.
  Core tables accept only DDL that changes no content: an index, or a type change.
- **Also translated:**
  - `UPDATE`/`DELETE … ORDER BY … LIMIT` and WooCommerce's multi-table `UPDATE … JOIN`, as rowid subqueries;
  - row locks (`FOR UPDATE SKIP LOCKED`) and `FROM DUAL`, removed;
  - `CHAR_LENGTH`, `IF`, `GREATEST`/`LEAST`, `FROM_UNIXTIME`, `UNIX_TIMESTAMP(x)`;
  - string literals holding NUL bytes (MySQL's `\0`), which SQLite would read as the end of the statement.
- **Outgoing HTTP:** some plugin pages took minutes in the capture because the plugins call external services. The HTTP API seam (ADR-0084 §2) sends those through the platform's fetch proxy with a timeout.

**The browser transport.** In php-wasm, PHP's `post_message_to_js` blocks until the JavaScript listener's promise resolves, so the fork's seam can wait for an asynchronous answer from the game's storage API across a message channel. A round trip of p95 608 µs plus the projection's 51 µs stays inside the 2 ms criterion.

## Against the proposed go criteria

| Criterion | Proposed | Measured | Verdict |
|---|---|---|---|
| Front page and wp-admin work | yes | all flows replayed to the same state | go |
| Per-query p95 | < 2 ms | 0.22 ms | go |
| Boundary overhead | ≤ 2× | about 1.1× native, about 1.03× php-wasm | go |
| Unhandled statements | ≤ 1% (core + 3 plugins) | 0% core, 0.08% plugins | go |

## Verdict and what carries forward

**Go**, on the proposed criteria; the owner can still change them through an ADR amendment. Carried into later milestones:
1. **Semantic depth.** Equivalence is checked on the governed tables the flows touch. WordPress's own PHPUnit suite against the fork is the M3 gate (ADR-0084 §7).
2. **The seam end to end.** The forked `wpdb` talking to the storage API, in php-wasm, measured per page (M3).
