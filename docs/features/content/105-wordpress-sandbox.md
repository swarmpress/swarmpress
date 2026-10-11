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

Built so far (browser side):
- `cargo xtask sandbox-fetch [--node]` downloads the release pinned in `config/wp-sandbox.toml` into
  the git-ignored `vendor/wp-sandbox/` and checks its sha256; nothing of it is bundled or linked;
- Vite serves its browser entry on its own origin (`:5181`, CORP and COEP) in dev and preview;
- `PhpBackend` and `PhpWasmSandbox`: a hidden cross-origin iframe and one MessagePort carrying
  requests and storage messages; `?php=` and `php.backend.<company>` choose the backend;
- `e2e/wordpress.spec.ts` (`playwright.wordpress.config.ts`): the real sandbox in the browser
  installs onto live, commits an agent's REST post on a work branch, refuses a write on live, and
  serves the merged post on live.

Open: the startup stages and WordPress card, `?site=wordpress` in the session, the runner's Node
backend, and the conformance suite as a CI job.

