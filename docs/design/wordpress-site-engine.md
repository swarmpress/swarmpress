# WordPress as the site engine: the build plan (ADR-0078 to ADR-0084)

**Status:** approved by the owner 2026-10-10; M0 (the wpdb seam spike) in progress.

## Context

The owner wants swarm.press to be to WordPress what Guardian is to Pimcore. The decisions are recorded in ADR-0078 to ADR-0084 (2026-10-10; ADR-0081 is superseded by ADR-0084):
- each player's site runs on **WordPress**: a minimal GPL fork whose storage seams call a **storage API** instead of MySQL;
- WordPress runs on a **pluggable PHP backend**, php-wasm first (measured: WordPress 7.1.3 runs on php-wasm in Node at about 0.7 s per page);
- everything runs inside a **GPL sandbox reached only through APIs** (CLAUDE.md rule 16);
- the truth is a **Guardian-style governed content repository**: typed objects, commits, branches, change requests, merges and releases;
- the agents and the Brick Studio work through **capabilities**;
- the public site is a **static export** of `live`;
- cinqueterre.travel migrates last.

**Owner decisions for this plan:**
- the GPL code lives in **new repositories in the swarmpress org**;
- the plan starts with a **measurement spike** (M0) before the first vertical slice (M1 onward).

**What exists to build on** (explored):
- the sim is engine-agnostic: `DeployLanded`, `JobCompleted`, and no GitHub terms in sim-core;
- the `LocalLlm` backend pattern (`apps/game/src/llm/{types,backend,startup}.ts`, `session/model-runtime.ts`, `ui/model-card.ts`, `ui/boot-screen.ts`);
- the worker message protocol (`llm/protocol.ts`, `client.ts`, `worker-host.ts`);
- the QuickJS sandbox and its capability and origin grants (`packages/sandbox`);
- the fetch proxy (`crates/server/src/web.rs` `POST /web/request`);
- write-once sync segments (`sync/segments.ts`, `uploader.ts`, `crates/server/src/sync.rs`);
- the company store with migrations and a journal (`store/company-store.ts`, `schema.ts`);
- the `crates/*-wasm` pipeline (`xtask` `WASM_CRATES`, vite aliases, CI pkg artifacts);
- the PR-shaped `Gateway` trait the jobs call (`crates/orchestrator/src/gateway.rs`, `JsGateway`, `central.ts` `OrchestratorGateway`).

**What is missing:** object storage (ADR-0050), any cross-origin sandbox, any Node test suite feeding Cockpit, and the repository.

## The rules every step follows

- **The GPL line** (rule 16, ADR-0078 §2, §3):
  - no swarm.press repository imports, bundles or links `@php-wasm/*`, `@wp-playground/*`, WordPress or the fork;
  - the main repo downloads the **released sandbox artifact** by version and sha256, and talks to it only with HTTP-shaped messages or loopback HTTP;
  - tests that need php-wasm drive the artifact as a separate process or origin.
- **WordPress never owns truth:** WordPress holds no persistent state; the repository does.
- **Sim rules:** text never enters the sim (rule 2); the orchestrator owns transitions (rule 3); the closed world holds (rule 5); stubs fail loudly (rule 11).
- **The two engines live side by side:** new companies opt in with a flag (`?site=wordpress`, then a company setting) until M8. The Astro path and the frozen theme stay untouched (rule 9).
- **Process:** every milestone ends with tests that are Cockpit evidence, feature files, CI green, and commits to main (explicit paths, the staged diff checked).

## Repositories and artifacts

| Repo (new, swarmpress org, GPL-2.0-or-later) | Holds | Releases |
|---|---|---|
| `swarmpress/wordpress` | the fork: upstream WordPress plus seam patches, one commit per seam (ADR-0084 §1), rebased on every upstream release | tags `wp-<upstream>-sp.<n>` |
| `swarmpress/wp-sandbox` | the sandbox build: php-wasm runtime, the fork, pinned plugins, the browser entry (the iframe and worker that speak the storage and request channels), the Node entry (loopback HTTP), the conformance runner, and the full GPL source offer | `wp-sandbox-<version>.tar` (browser and Node bundles) with sha256, plus source tarballs |

**In the main repo:**
- `config/wp-sandbox.toml`: the pinned version, URL, sha256 and size, following the `config/models.toml` pattern with a drift test;
- `xtask sandbox-fetch`: downloads and verifies the artifact into `vendor/wp-sandbox/`, which is git-ignored;
- CI caches it by sha256.

## Milestones

### M0: the spike, measuring the wpdb seam (go/no-go)

**Goal:** prove that the storage-API boundary is fast enough and covers the SQL WordPress sends, before building on it.

**GPL side** (`swarmpress/wordpress`, branch `spike/wpdb`): a forked `class-wpdb.php` that sends `query`, `get_results`, `insert` and the rest as JSON messages to a host endpoint (loopback HTTP in Node), keeping `wpdb`'s public interface.

**Main repo:**
- `crates/storage-api` (new; `spike` feature): a MySQL-to-SQLite translator for the statements WordPress sends;
- a SQLite projection with WordPress's schema;
- a classifier that sorts writes into governed tables, scratch tables and unknown;
- one change set per WordPress request.

**The measurement** (in `wp-sandbox`'s runner, against a local storage-API process):
- install; the front page; a single post; wp-admin login, the dashboard, and a post edited and saved;
- the REST `posts` round trip;
- 3 common plugins (e.g. Yoast SEO, Contact Form 7, WooCommerce read-only pages).

**Reports:**
- queries per page;
- boundary latency at p50 and p95;
- page time against plain php-wasm with SQLite;
- untranslated or unclassified statements.

The reports go to `artifacts/bench/wp-seam*.json` (`cockpit.benchmark.v1`), with a write-up in `docs/qualification/wp-seam-spike.md`.

**Go criteria** (proposed; the owner confirms):
- the front page and wp-admin work;
- boundary overhead is no more than 2× plain php-wasm, with p95 per query under 2 ms;
- no more than 1% of the statements of core and the 3 plugins are unhandled, each one listed.

**No-go:** revisit with a batching or prefetch design, or a deeper Generation 2 seam first, through an ADR.

### M1: the sandbox and the backend contract (ADR-0079)

**`swarmpress/wp-sandbox`:**
- the browser entry: an iframe page that starts php-wasm in a worker and exposes **two message channels**:
  - **request:** game to WordPress, HTTP-shaped;
  - **storage:** WordPress's seams to the game's storage API;
- the Node entry: the same two channels as loopback HTTP;
- CI that builds and releases with a source offer.

**Main repo, `apps/game/src/php/` (new):**
- `types.ts`: `PhpBackend { boot(artifact, config), request(http), stop(), health() }` and the typed errors (`PhpUnavailableError`, as `LlmUnavailableError`);
- `backend.ts`: `PHP_BACKEND_IDS = ['php-wasm', 'fake', 'frankenphp']` (`frankenphp` registered as unavailable for now), `?php=` and the kv key `php.backend.<company>`, following `llm/backend.ts`;
- `sandbox-host.ts`: the cross-origin iframe on a **separate sandbox origin**, the MessageChannel bridge and an id-correlated protocol (reusing the shape of `llm/protocol.ts`), plus a `fake` backend for unit tests;
- startup stages (download, verify sha, boot, qualify: one REST request) reusing the shape of `llm/startup.ts`, shown by a WordPress card built from `ui/boot-screen.ts`.

**Origins and isolation:**
- dev: a second static server port for `vendor/wp-sandbox/browser` with the CORP and COEP headers the isolated game needs (`vite.config.ts`);
- prod: a sandbox origin on the static data plane.

**Runner:** `packages/runner` gains a Node backend that spawns the sandbox's Node entry as a separate process and talks loopback HTTP.

**Conformance suite** (in `wp-sandbox`, driven from the main repo through the artifact): install, request round trip, storage channel round trip.
- New Cockpit evidence: `wp-sandbox/conformance` (JUnit from the runner);
- a CI job `wp-sandbox` that fetches the artifact and runs it.

**Features:** FEAT-105 (the sandbox and PHP backends), status in-progress.

### M2: the governed content repository (ADR-0080)

**`crates/content-repo` (new; compiles to wasm) with `crates/content-repo-wasm`** (the facade, as `kit-wasm`):
- **objects:** post and page with a parsed block tree; media sidecar plus hash; term and taxonomy; menu; template and template part; allow-listed option; author; theme and plugin pins;
- **commits:** a parent digest, domain-separated SHA-256 (`swarmpress:content:v1`), author, job and model, message;
- **branches and heads:** `live` plus one branch per work item; heads are compare-and-swap;
- **change requests:** a semantic diff down to blocks and fields, policy checks, review state;
- **merges:** a three-way merge at object level; a conflict on the same field or block becomes a typed conflict, never a silent choice;
- **releases:** tagged states of `live`, and rollback as a new commit;
- **JSON shapes:** mirrored in `apps/game/src/content/types.ts`.

**Persistence:**
- company store migration v5 (tables `repo_objects`, `repo_commits`, `repo_refs`, `repo_change_requests`, in the plain SQLite subset);
- central sealing: commits travel in sync segments next to the text journal (`encodeSegment` gains `commits`, kept byte-identical without them), and heads are fenced by the lease epoch;
- restore replays commits into the empty store, like ADR-0075's texts.

**Sim digests** (rule 2):
- `ServerCommand::ChangeRequestOpened{work_item, changes}` and `Merged{work_item, release}` only if the sim needs them;
- otherwise the existing `JobCompleted` and `DeployLanded` suffice (decide in M4; a format bump if added).

**Tests:**
- Rust unit and property tests: commit and digest determinism; merge (clean, conflict, three-way on blocks); rollback;
- the projection-rebuild equality test.

**Feature:** FEAT-106.

### M3: the storage API and fork Generation 1 (ADR-0084 §2, §3)

**`crates/storage-api`** (from M0's spike, hardened; compiles to wasm and native):
- the translator;
- the **projection per branch**, built from `content-repo` and cached;
- the classifier;
- request-scoped change sets that become commits through `content-repo`, with author context from the channel;
- the scratch store per sandbox;
- a refusal for writes to `live`.

**Hosting:**
- browser: in the game's store worker (`store/sqlite-worker.ts` pattern) behind the storage channel;
- runner and server: native.

**Media:**
- an `ObjectStore` trait in `crates/server` (ADR-0050), with a filesystem implementation first and keys `c/{company}/sha256/{hash}`;
- lease-checked uploads through `/api/assets` (new).

**Fork seams** (`swarmpress/wordpress`; one commit each):
- **`wpdb`:** the full interface, sent over the storage channel;
- **object cache:** request-scoped;
- **uploads:** bytes to the storage API, then object storage;
- **cron:** host-driven only;
- **`wp_mail`:** to the outbox;
- **the HTTP API:** through the platform fetch proxy. `web.rs` gains a per-company grant record and binary content types for media fetches.

**Conformance gains:**
- WordPress's own PHPUnit suite (a core subset first) against the fork plus the storage API;
- attribution;
- governed against scratch;
- a branch switch, meaning a fresh boot with identical content.

**Feature:** FEAT-107.

### M4: agents through capabilities (ADR-0082 §1 to §3)

**`crates/orchestrator`:**
- a new port **`SiteEngine`** beside `Gateway`, selected per company by engine:
  - `branch_for(work_item)`;
  - capability writes (draft post, update listed blocks, add term, set menu item), executed as REST calls into the branch's sandbox;
  - `open_change_request`, `merge(change_request)` (the merge queue), `release_status`;
- `JsSiteEngine` in `crates/orchestrator-wasm`, mirroring `JsGateway`;
- `wpSiteEngine` in `apps/game/src/net/` and `session/`, over the sandbox host and the repository.

**Re-targeting the jobs:**
- `staged.rs` drafts **Gutenberg block trees**:
  - the block schemas in `crates/agents/src/article.rs` and `article_prompts.rs` are generated from the site's block registry;
  - `measured_checks` and `SiteValidatorV2` are re-pointed at trees;
- `maintain.rs` (refresh, fix, translation) works on objects at `live` and writes through capabilities;
- `run.rs` publish becomes `merge`; `analysis.rs`, `board` and `standup` are unchanged.

**Knowledge:** the knowledge pack is built from WordPress's registries through REST (blocks, terms, media, pages), reusing the `crates/knowledge` indexes, with `site-knowledge.ts` refetching after a merge.

**The slice's end-to-end flow** (flagged company): board, then standup, then draft on a branch, then review of the diff and preview, then the CEO's Publish, then the merge into `live`.

**Feature:** FEAT-108.

### M5: publishing (ADR-0083)

**`crates/site-export` (new)**, run by the governed layer:
- checks out `live` into a sandbox and crawls its URLs over HTTP (published URLs, sitemap, feeds, referenced assets);
- writes a content-addressed **release**;
- does incremental exports from the semantic diff, plus a full export on theme or plugin changes.

**Deploy:** `deploys.rs` keeps `land` and `fail` and the `DeployLanded` and `DeployFailed` events, and gains an export deploy to the static data plane (Cloudflare Pages or R2). The GitHub check-run parts stay only for the Astro path.

**Dynamic features:** static search index; forms and comments go to platform endpoints as inbox events.

**Previews:** a branch rendered in its sandbox, shown in the review UI and the booklet as data.

**Feature:** FEAT-109.

### M6: the Brick Studio over WordPress (ADR-0082 §4, ADR-0077)

| Workbench | Shows | Edits |
|---|---|---|
| Town | post types and templates | — |
| Building | a post type's block template (locked and repeatable regions as storeys) | that template |
| Paint shop | `theme.json` (palette, fonts, spacing) | `theme.json` |
| Factory | tools feeding blocks through bindings | — |

- Every edit is a commit on a branch. The **booklet** reads `content-repo` change requests (`ui/studio/steps.ts` re-pointed at object diffs).
- Plugins appear as **sets**, with a "not governed" badge for unmodelled types.
- wp-admin on a draft branch opens in the sandbox origin, and its writes are captured (ADR-0082 §5).

**Feature:** FEAT-104 (Paint shop) plus FEAT-110.

### M7: fork Generation 2, the object seams (ADR-0084 §4)

Core data functions move onto the repository's **object API**, one seam each:
- `wp_insert_post`, `wp_update_post` and the block parser (trees stored parsed);
- the metadata API;
- the term API;
- `WP_Query`'s main paths.

Plugins keep the Generation 1 SQL path. The exit gate is conformance plus a lower query count. **Feature:** FEAT-111.

### M8: migrating cinqueterre.travel (ADR-0083 §5)

1. Import the site's JSON pages, terms, menus and media sidecars into `content-repo` as WordPress objects, with a block mapping (`crates/content-import-wp`, reusing `crates/blueprint/src/import.rs`'s readers).
2. Build a block theme that matches the frozen theme's look (`swarmpress/wp-sandbox` themes, or a theme package), reviewed in the Studio.
3. Export, then compare **URL by URL** with the live site: content, links, status codes. `docs/runbooks/cinqueterre-cutover.md` is rewritten for this.
4. Switch the deploy. Rule 9 ends, and the legacy modules retire: `GithubGateway`, PathPolicy uses, `check_draft`, `finalize.rs`, `site-kit`, `themes/starter`, the frozen theme.

**Feature:** FEAT-112.

## Cross-cutting

- **Legal review gate:** before any public release, counsel reviews the channel model (ADR-0078 §3, ADR-0084). It is listed as an open item in FEAT-105 and blocks an external release, not internal development.
- **CI:**
  - the GPL repos have their own CI;
  - the main repo gains `wp-sandbox` (artifact fetch plus conformance), `content-repo` wasm tests, and size budgets for the new wasm packages;
  - the new wasm packages get `upload-artifact` and `download-artifact` steps in the web and browser-runtime jobs, as `blueprint-wasm` has.
- **Cockpit:** features FEAT-105 to FEAT-112 (check the highest free id at each milestone, since the other session adds features), evidence ids per suite, and `docs/test-map.yaml` for `lib.rs` tests.
- **Docs:** an ADR whenever a milestone changes a decision (for example M0's go criteria, or sim digests in M2 and M4), and CLAUDE.md updated as each piece lands.

## Critical files

**New:**
- the repos `swarmpress/wordpress` and `swarmpress/wp-sandbox`;
- `crates/{storage-api,content-repo,content-repo-wasm,site-export,content-import-wp}`;
- `apps/game/src/php/{types,backend,sandbox-host,startup}.ts`, `apps/game/src/content/types.ts`;
- `config/wp-sandbox.toml`, `xtask sandbox-fetch`, `docs/qualification/wp-seam-spike.md`.

**Re-targeted:**
- `crates/orchestrator/src/{gateway,run,staged,maintain,site,article}.rs` and `crates/orchestrator-wasm/src/lib.rs`;
- `crates/agents/src/{article,article_prompts,qa}.rs`;
- `apps/game/src/{net/central.ts,session/session.ts,session/site-knowledge.ts,store/schema.ts,sync/segments.ts}`;
- `crates/server/src/{web,deploys,app}.rs` (plus an `ObjectStore` module);
- `apps/game/src/ui/studio/*`;
- `packages/runner`.

**Untouched until M8:** `packages/site-kit`, `themes/starter`, `packages/site-builder/src/themes/cinque-terre`, `crates/server/src/{gateway,finalize}.rs`.

## Verification (per milestone, and end to end)

| Milestone | Verified by |
|---|---|
| M0 | the benchmark JSON and the write-up; the go/no-go decision recorded by the owner (an ADR amendment if the criteria change) |
| M1 | unit tests with the fake backend; the conformance suite in CI against the pinned artifact; a Playwright test that the game boots a sandbox on its own origin and gets a REST response (`e2e/wp-sandbox.spec.ts` in the MVP config) |
| M2 | Rust unit and property tests (digests, merges, conflicts, rollback, projection equality); store migration tests; segments byte-identical without commits |
| M3 | conformance with WordPress's PHPUnit subset over the storage API; attribution and governed-against-scratch tests; a branch switch with identical content |
| M4 | an orchestrator test with a fake `SiteEngine`; vitest for `wpSiteEngine`; a Playwright test: a flagged company where the fake model drafts an article, it is reviewed, and the CEO publishes it into `live` |
| M5 | site-export unit tests (incremental URL sets); an e2e test: publish, then a release, then `DeployLanded`, then the exported HTML contains the article |
| M6 | Studio vitest plus e2e over WordPress structures; booklet steps from repository diffs |
| M7 | conformance with fewer queries; plugin compatibility unchanged |
| M8 | the URL-by-URL comparison is green before the switch, then a rehearsal on a fork of the site repo before the live switch (owner's OK) |

**At every milestone:** `cargo fmt/clippy/nextest`, `pnpm typecheck`, `pnpm test`, `pnpm test:sdk`, the MVP e2e, CI green, and `cockpit validate --strict`.
