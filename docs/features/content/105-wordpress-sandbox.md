---
id: FEAT-105
title: "The WordPress sandbox and pluggable PHP backends"
status: planned
importance: high
paths:
  - docs/design/wordpress-site-engine.md
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
