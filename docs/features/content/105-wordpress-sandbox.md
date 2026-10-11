---
id: FEAT-105
title: "The WordPress sandbox and pluggable PHP backends"
status: in-progress
importance: high
paths:
  - docs/design/wordpress-site-engine.md
  - apps/game/src/php/types.ts
  - apps/game/src/php/backend.ts
  - apps/game/src/php/backend.test.ts
  - apps/game/src/php/sandbox-host.ts
  - apps/game/src/php/sandbox-host.test.ts
  - apps/game/src/php/wordpress.ts
  - apps/game/src/harness/wordpress-harness.ts
  - apps/game/wordpress.html
  - apps/game/e2e/wordpress.spec.ts
  - apps/game/playwright.wordpress.config.ts
  - apps/game/vite.config.ts
  - apps/game/src/php/startup.ts
  - apps/game/src/php/startup.test.ts
  - apps/game/src/session/wordpress-runtime.ts
  - apps/game/src/session/wordpress-runtime.test.ts
  - apps/game/src/ui/wordpress-card.ts
  - apps/game/e2e/wp-sandbox.spec.ts
  - packages/runner/src/wordpress.ts
  - packages/runner/test/wordpress.test.ts
  - config/wp-sandbox.toml
  - xtask/src/sandbox.rs
adrs:
  - ADR-0078
  - ADR-0079
  - ADR-0084
---

# The WordPress sandbox and pluggable PHP backends

Milestone M1 of [the build plan](../../design/wordpress-site-engine.md):
- the GPL sandbox artifact (`swarmpress/wp-sandbox`: php-wasm, the fork, pinned plugins, with its
  source offer), loaded from its own origin and reached only by HTTP-shaped messages;
- the `PhpBackend` contract with php-wasm first, and FrankenPHP and rphp registered for later;
- the Node backend for the runner, and the conformance suite.

Open before any public release: a legal review of the channel model (ADR-0078 §3).

Built (M1):
- `cargo xtask sandbox-fetch [--node]` downloads the release pinned in `config/wp-sandbox.toml` into
  the git-ignored `vendor/wp-sandbox/` and checks its sha256; nothing of it is bundled or linked;
- Vite serves its browser entry on its own origin (`:5181`, CORP and COEP) in dev and preview;
- `PhpBackend` and `PhpWasmSandbox`: a hidden cross-origin iframe and one MessagePort carrying
  requests and storage messages; `?php=` and `php.backend.<company>` choose the backend;
- the startup stages (restore the repository, start WordPress, install a new site onto live,
  one qualification request) and the WordPress card; `?site=wordpress` opts a company in and is
  kept as its `site.engine` setting; the repository's records go to the company's text journal;
- the runner's Node backend: the sandbox's Node entry and `swarmpress-storage` as separate
  processes on loopback HTTP, and `swarmpress wp-conformance`, which runs the sandbox's own suite;
- evidence: `e2e/wordpress.spec.ts` (the harness page), `e2e/wp-sandbox.spec.ts` (the game page on
  the central server: install, REST, restore after a reload), `wp-sandbox/conformance`, and the
  CI job `wp-sandbox` (needs the `WP_SANDBOX_TOKEN` secret while the release is private).

Open before any public release: a legal review of the channel model (ADR-0078 §3).
