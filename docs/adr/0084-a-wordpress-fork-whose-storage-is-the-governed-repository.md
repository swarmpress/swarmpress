# ADR-0084 — A WordPress fork whose storage is the governed repository

**Status:** Accepted (supersedes ADR-0081; amends ADR-0078 §1 and §4, ADR-0079 §2 and §6, ADR-0080 with a storage API, and ADR-0082 §1; keeps ADR-0078's GPL sandbox and API-only boundary, and ADR-0083)
**Date:** 2026-10-10

## Context

ADR-0081 kept WordPress unmodified and synchronized a working copy (WordPress's own SQLite inside the sandbox) with the governed repository through a connector plugin. The owner decided instead to **fork parts of WordPress so that it talks directly to the governed layer instead of MySQL**. That is guardian-runner's route for Pimcore ("replace the kernel", guardian-runner ADR-0026): native code runs on top, its persistence is redirected to the governed repository, and nothing else is kept as truth.

### Constraints

1. **The GPL boundary stays** (ADR-0078). A fork of WordPress is a GPL derivative, so it lives in the sandbox and is distributed with its source like the rest of it. Its connection to the governed layer is an API: a documented protocol between separate programs, never shared memory or linked code.
2. **WordPress reaches its database in many places.** WordPress 7.1.3's core (`wp-includes` and `wp-admin`) calls `$wpdb` at 1,985 sites, and plugins call it with raw SQL. A fork that replaced the data functions with object calls in one step would break most plugins, and would be very costly to keep current with upstream releases.

## Decision

1. **A minimal, seam-based GPL fork.** `swarmpress/wordpress` is a fork of WordPress core, GPL-2.0-or-later, in its own repository.
   - It changes WordPress only at **named seams**, each a small patch kept as a separate commit.
   - It is rebased onto every upstream release, which ADR-0079 §6 then pins.
   - Everything else is upstream's code, unchanged.
2. **Generation 1, the storage seams.** These are the first increment and are required for a site to run:

   | Seam | Replaced by | Behaviour |
   |---|---|---|
   | **`wpdb`** (`class-wpdb.php` and its drop-in point) | a fork that sends every query to the governed layer's **storage API** (§3) | keeps `wpdb`'s whole public interface: `query`, `prepare`, `get_results`/`get_row`/`get_var`/`get_col`, `insert`/`update`/`replace`/`delete`, transactions, `insert_id`, errors. So core and plugins keep working; WordPress opens no database of its own. |
   | **object cache** (`WP_Object_Cache`) | a request-scoped cache in front of the storage API | nothing persists in the sandbox between requests unless the storage API holds it. |
   | **uploads** (the uploads directory and its `wp_upload_dir` / `wp_handle_upload` paths) | storage-API calls that put bytes into object storage (ADR-0050) | media are objects with sidecars in the repository (ADR-0080 §1); attachment URLs point at the export's asset paths (ADR-0083). |
   | **cron** (`wp-cron`, `spawn_cron`) | runs only when the host asks, on the sim's clock (ADR-0079 §4) | — |
   | **mail** (`wp_mail`) | the governed layer's outbox, as an event (ADR-0079 §4) | — |
   | **outgoing HTTP** (the HTTP API) | the platform's fetch proxy (ADR-0079 §4) | — |
3. **The storage API.** This is the governed layer's side of the boundary: a documented protocol carried as HTTP-shaped messages, either over the message channel to the sandbox's worker or over loopback in the runner. Every request names the **branch** (the sandbox is bound to one at boot) and the **author context** (the job and staff member, the CEO, or a wp-admin session; ADR-0082). For each request it:
   - executes `wpdb`'s SQL against the branch's **relational projection**: WordPress's table schema, held by the governed layer in SQLite (ADR-0041 dialect, translated from MySQL by the governed layer, not inside WordPress);
   - turns writes to **governed tables** (posts, postmeta, terms and taxonomies, term relationships, comments, users and usermeta as authors, and allow-listed options) into **object changes**, in one change set per WordPress request, committed with attribution on the branch (ADR-0080 §2);
   - keeps writes to **scratch tables and keys** (transients, sessions, cron state, caches, logs, unknown plugin tables) in a disposable scratch store per sandbox, never committed (ADR-0080 §1);
   - stores media bytes, returns their URLs, and refuses everything else.

   The projection is rebuilt from the repository and is not a second truth, exactly like the company store's tables (ADR-0056 decision 3).
4. **Generation 2, the object seams.** These are later increments, one ADR or feature each. Core's own data functions move off SQL onto the repository's **object API**, so the repository sees semantic operations rather than reconstructing them from SQL:
   - the post functions (`wp_insert_post`, `wp_update_post`, `get_post`) and the block parser, with block trees stored parsed (ADR-0078 §6);
   - the metadata API;
   - the term API;
   - the main paths of `WP_Query`.

   **Plugins keep Generation 1.** Plugins that use `$wpdb` directly keep working through the SQL path.
5. **WordPress holds no state.** The sandbox holds WordPress's code and a per-request cache, but not its content. This replaces ADR-0079 §2's working copy in the worker's file system, and ADR-0081's materialize, capture and verify:
   - **switching branch:** booting a sandbox on another branch;
   - **a crashed sandbox:** losing it loses only scratch state.
6. **Agents and wp-admin go through WordPress, and persistence ends in the repository.**
   - Agents' capabilities (ADR-0082 §1) still enter as REST calls, so WordPress's own sanitizing, filters and hooks run. Their writes reach the repository through the storage API, attributed to the job.
   - A person in wp-admin on a draft branch writes the same way, attributed to the session.
   - `live` stays read-only (ADR-0081 §4's rule, kept here). The storage API refuses writes to `live` except through a merge.
7. **Conformance.** Every rebase must pass these on every backend before a pin moves:
   - WordPress's own PHPUnit suite, run against the fork with the storage API behind it;
   - the swarm.press conformance suite (ADR-0079 §5): install, REST round trip, attribution, scratch versus governed, export equality.

## Consequences

- **What the governed layer sees:** it sees every write as it happens, inside the request that made it, with the author attached. There is no polling, no echo suppression, no snapshot reconciliation, and no second database to keep in step.
- **Plugins:** most keep working in Generation 1, because `wpdb`'s interface stays. Their own tables are scratch state until a typed mapping governs them.
- **The fork stays small:** only the seams (about six files in Generation 1), so following upstream is a rebase of a small patch set.
- **Negatives:**
  - **Speed:** every database query crosses the boundary. A WordPress page makes dozens of queries, sometimes hundreds, so the storage API must answer in microseconds to low milliseconds, batch where WordPress allows, and cache per request. This needs measuring early: php-wasm already takes about 0.7 s per page in Node before the boundary.
  - **SQL translation:** MySQL-to-SQLite translation in the governed layer has to cover what core and common plugins send. WordPress's own SQLite integration shows it is possible and shows its edges.
  - **Deriving object changes from SQL** (Generation 1) is approximate for complex writes until Generation 2 gives semantic calls; a write the layer cannot classify is refused loudly, not guessed (rule 11).
  - **Upstream risk:** forking means owning a patch set and its rebases on every WordPress release, and a security release must be rebased and pinned promptly.
  - **Licensing:** the fork is GPL and so is its distribution. Whether the storage API keeps the governed layer a separate program is the same legal question ADR-0078 raises, and it needs the same review.
- **Alternatives:**
  - **The connector and sync seam of ADR-0081:** WordPress unmodified, but a second database and a reconciliation loop; superseded by the owner's decision.
  - **Forking WordPress's data functions all at once:** semantic from the start, but it breaks plugins that use `$wpdb` and makes upstream rebases very costly.
  - **A MySQL wire-protocol server** answering an unmodified WordPress: no fork, but it moves the governed layer into a database protocol, and php-wasm has no real sockets.
