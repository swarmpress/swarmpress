# ADR-0078 — WordPress is the site engine, sandboxed and reached only through APIs

**Status:** Accepted (supersedes the site-engine half of ADR-0047 and the Astro site kit as the engine of new sites; amends rule 12; the sandbox, backends, repository, seam, agents and publishing follow in ADR-0079 to ADR-0083)
**Date:** 2026-10-10

## Context

### What the owner wants

The owner wants swarm.press to be to WordPress what Guardian is to Pimcore. Guardian (`drietsch/guardian`) keeps Pimcore's model and moves the truth into a governed repository. Every change there is an attributed, reviewable, mergeable commit. Native Pimcore runs on top through guardian-runner, and Pimcore "never owns truth" (guardian-runner ADR-0001, ADR-0026: "replace the kernel").

### What this replaces

Today's sites are JSON blocks in a player-owned GitHub repository (ADR-0047), built by an Astro site kit with agent-written themes. That stack is our own. It is not the ecosystem millions of sites and plugins live in.

### Two facts set the constraints

1. **WordPress is GPL-2.0-or-later.** A program that links WordPress code into itself, or is derived from it, must be distributed under the GPL.
2. **The browser runtime is GPL too.** The runtime that makes WordPress work in the browser is php-wasm (the engine of WordPress Playground). Its packages (`@php-wasm/web`, `@php-wasm/node`, `@php-wasm/universal`, `@wp-playground/*`) are all licensed GPL-2.0-or-later. So the PHP runtime falls on the GPL side of the line as well, not only WordPress.

### The owner's condition

WordPress must stay sandboxed, and every connection from the new governing layer to WordPress must go through APIs.

WordPress was measured on php-wasm on 2026-10-10 (WordPress 7.1.3 with the SQLite drop-in, Playground's CLI in Node):
- the front page, the REST API and wp-admin answer;
- about 0.6 to 0.8 s per request;
- posts come back as Gutenberg block markup.

The same test on rphp (a clean-room PHP engine in Rust) stopped at WordPress's first global variable.

## Decision

1. **A player's site runs on WordPress.** WordPress is unmodified core with its themes, plugins and Gutenberg blocks. It runs on a PHP backend (ADR-0079, php-wasm first).

   For new companies this replaces the Astro site kit and agent-written Astro themes as the site engine. The cinqueterre.travel migration is ADR-0083 §5.
2. **The GPL sandbox.** WordPress, the PHP runtime and every WordPress plugin, the swarm.press connector included (ADR-0081), live together in **one sandbox**:
   - it is built, versioned and distributed **as its own component**, under the GPL;
   - its source is offered with it;
   - nothing in swarm.press's own code (crates, `apps/game`, packages) imports, links, bundles or derives from GPL code.

   The game's bundle loads the sandbox as a separate artifact into an isolated execution context (ADR-0079 §2). It never loads it as a module of its own code.
3. **APIs only, at arm's length.** Everything outside the sandbox talks to WordPress only through APIs:
   - **WordPress's REST API**, under `/wp-json/wp/v2/…`;
   - **the connector's REST API**, under `/wp-json/swarmpress/v1/…` (ADR-0081);
   - the HTTP pages and assets WordPress serves, for previews and the static export (ADR-0083).

   **What travels:** requests and responses are HTTP: method, path, headers and a body of JSON or bytes. That is true whether they travel over a socket, a loopback port or a message channel carrying HTTP-shaped messages.

   **What is not allowed:**
   - shared memory;
   - calls into PHP functions;
   - reading WordPress's database file;
   - hooks registered from outside;
   - in-process plugins written by swarm.press, other than the GPL connector.
4. **WordPress never owns truth.** The governed content repository (ADR-0080) is the source of truth. WordPress is a working copy of one branch, materialized into it and read back from it through the APIs (ADR-0081). Losing a sandbox loses no content.
5. **swarm.press's own code stays outside the sandbox and is not GPL:**
   - the sim, the orchestrator, the agents, the Studio, the repository and the server.

   The agents act on WordPress only through the governed layer's capabilities, which become REST calls (ADR-0082).
6. **Content becomes Gutenberg blocks.** WordPress's block tree replaces the swarm.press JSON block schema as the content model of new sites. It amends rule 12:
   - renderers never parse Markdown;
   - the repository stores blocks parsed, as typed trees (ADR-0080), never as serialized HTML comments;
   - multilingual text comes from the translation layer the repository models, not from `LocalizedString` inside block attributes.

## Consequences

- **What players and the game gain:**
  - players get the WordPress they know: themes, plugins, wp-admin for those who want it, and the REST API;
  - the agents work on a real, widely used CMS;
  - Guardian's governance model applies to WordPress without changing WordPress.
- **The boundary is the architecture.** Every integration (sync, agents, publishing, previews) is an API client. That is slower and coarser than in-process hooks, and it is the price of the licence and of WordPress never owning truth.
- **What becomes legacy:**
  - the Astro site kit (`packages/site-kit`, `themes/starter`);
  - the theme-coding work (ADR-0072 ThemeCode, FEAT-094);
  - the gateway's page profile (ADR-0061, ADR-0070).

  They stay for the cinqueterre.travel path until its migration (ADR-0083). The Brick Studio (ADR-0077) keeps its grammar over WordPress structures (ADR-0082 §4).
- **Negatives:**
  - **Two engines:** for a while there are two site engines, the Astro path for cinqueterre.travel and WordPress for new sites.
  - **Plugin side effects:** plugins with side effects outside WordPress's tables (outgoing mail, remote calls, file writes outside uploads) need the sandbox's capability rules (ADR-0079 §4). Some plugins will not work.
  - **Separate GPL distribution:** the sandbox must be built and distributed separately, with its source and the GPL's obligations, which adds a release pipeline.
  - **Legal review:** whether a given channel (a message channel carrying HTTP) keeps the two works separate is a legal question. This ADR follows the conservative reading (separate programs, communication over a documented protocol, no shared data structures) and needs **legal review before release**.
- **Alternatives:**
  - **Keep the Astro site kit:** our own stack, no WordPress ecosystem; rejected by the owner.
  - **Rebuild WordPress's model natively** ("WordPressOS" without PHP), the way Guardian may rebuild Pimcore: no plugin or theme compatibility; rejected.
  - **Run WordPress in-process**, with hooks or a PHP extension written by swarm.press: it would put swarm.press code on the GPL side; rejected by the owner's condition.
  - **rphp as the engine:** not able to run WordPress today (2026-10-10). It remains a candidate backend for later (ADR-0079).
