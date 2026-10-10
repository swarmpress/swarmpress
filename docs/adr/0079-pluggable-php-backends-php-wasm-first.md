# ADR-0079 — Pluggable PHP backends; php-wasm first

**Status:** Accepted (implements ADR-0078 §1 and §2; keeps ADR-0038's local-first executor and ADR-0045's lease; amends rule 13 with a PHP runtime as a sandboxed data-plane component)
**Date:** 2026-10-10

## Context

ADR-0078 runs each player's WordPress inside a GPL sandbox that is reached only through APIs. The owner wants several engines to be possible, for example php-wasm and FrankenPHP, chosen per deployment. The engine must therefore be a **backend behind one contract**, the way the model already is behind `LocalLlm` (hosted GPT-6-Luna, local Gemma, the scripted fake; ADR-0067, ADR-0066).

The candidates:

| Backend | What it is | Where it runs |
|---|---|---|
| **php-wasm** | the real PHP engine compiled to WebAssembly, the runtime of WordPress Playground (GPL-2.0-or-later) | the browser (in a worker) and Node; runs WordPress 7.1.3 today (measured 2026-10-10) |
| **FrankenPHP** | native PHP 8.x embedded in a Go application server, the pattern guardian-runner rebuilt in Rust | a server or runner container |
| **rphp** | a clean-room PHP 8.5 engine in Rust | anywhere Rust or wasm runs; not able to run WordPress today |

## Decision

1. **The backend contract.** A PHP backend hosts one WordPress sandbox (ADR-0078) and offers:
   - **`boot(sandbox, snapshot?)`:** start WordPress from the sandbox artifact, empty or from a branch snapshot (ADR-0081);
   - **`request(http) → http`:** one HTTP request into WordPress, answered with one response;
   - **`stop()`:** shut it down, and report its health.

   Nothing else crosses the contract: no PHP calls and no file access from outside. Configuration (`wp-config` constants, the connector's endpoint and token) is handed in at boot as data.
2. **php-wasm is the first backend, in the browser.** The player's browser runs the sandbox in a **dedicated worker on its own origin**: a sandbox iframe served from the sandbox's distribution, holding the worker.
   - The game reaches it only with HTTP-shaped messages over a message channel.
   - The worker's file system holds WordPress's working copy (its SQLite database and uploads), persisted in the origin's own storage.
   - This keeps ADR-0038: the executor that holds the lease runs the company, including its WordPress.
3. **php-wasm in Node is the headless runner backend.** The same artifact runs under Node for the Bun/Node runner (ADR-0042), for tests, and for Agency jobs. It answers HTTP on a loopback port.
4. **The sandbox's reach is granted, not assumed.**
   - **Outgoing HTTP:** WordPress may reach only the hosts the company allows, through the platform's fetch proxy and its credits (`/web/request`, ADR-0076).
   - **Mail** goes to the governed layer's outbox as an event, never sent directly.
   - **Cron** runs on the sim's clock, as a request the host makes.
   - **File writes** go only to uploads; the rest is read-only.
5. **Native backends come later, behind the same contract.**
   - **FrankenPHP:** a runner container, for companies whose plugins need native PHP, or for server-side hosting.
   - **rphp:** once it runs WordPress (tracked by a test, not assumed).
   - **Choosing one:** per company, recorded in its settings, like the model backend. All backends run the same sandbox artifact and pass the same conformance suite: install, the REST round trip, the connector's change feed, and the static export.
6. **Version pins.** The sandbox artifact pins WordPress, the PHP version and the connector. A company's WordPress changes version only through a governed change (ADR-0080), never on its own.

## Consequences

- **What it gives:**
  - the game keeps its local-first shape, with the player's browser running the player's WordPress, and its tests run headless on the same artifact;
  - the engine can change without touching the governed layer, the agents or the Studio.
- **Measured cost:** php-wasm in Node answered WordPress requests in about 0.6 to 0.8 s. In the browser, the first boot downloads the runtime and WordPress (tens of MB, then cached), and that needs a loading state like the model's.
- **Negatives:**
  - **Plugins:** php-wasm lacks some PHP extensions and native binaries, so some plugins will not run in the browser. That is the reason for native backends.
  - **Memory:** a WordPress per company in the browser adds memory next to the 3D office.
  - **Storage:** the origin's storage quota limits uploads, and media goes to object storage through the governed layer (ADR-0080 §4).
  - **Isolation:** a separate origin for the sandbox is required by the GPL boundary and by isolation, and costs a message hop per request.
- **Alternatives:**
  - **One fixed engine:** rejected by the owner.
  - **Server-side only** (FrankenPHP as the only backend): drops local-first and puts a PHP runtime per company in the control plane.
  - **WordPress in the game's own worker:** it would bundle GPL code with the game (ADR-0078 §2).
