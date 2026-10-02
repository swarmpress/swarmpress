---
id: FEAT-055
title: "swarmpress headless runner and determinism evidence"
status: in-progress
importance: high
paths:
  - packages/runner/package.json
  - packages/runner/src/cli.ts
  - packages/runner/src/commands.ts
  - packages/runner/src/extension.ts
  - packages/runner/src/host.ts
  - packages/runner/src/index.ts
  - packages/runner/src/tar.ts
  - packages/runner/src/templates.ts
  - packages/runner/src/wasm.ts
  - packages/runner/test/cli.test.ts
  - packages/runner/test/golden.test.ts
  - packages/runner/test/pack.test.ts
  - packages/runner/test/helpers.ts
  - "packages/runner/test/fixtures/**"
  - crates/client-wasm/tests/runner_golden.rs
adrs:
  - ADR-0042
---

# swarmpress headless runner and determinism evidence

`@swarm-press/runner` is the `swarmpress` CLI (Bun first, Node 22+ too): `new`, `check`, `build`, `run`,
`test` and `pack`. It loads the unmodified `crates/client-wasm/pkg`, fast-forwards the sim and prints
per-day hashes, and drives every extension through `@swarm-press/sandbox`, never natively.
`packages/runner/test/fixtures/golden.json` pins world hashes after N days; the same file is asserted
natively and under wasm-bindgen-test (`crates/client-wasm/tests/runner_golden.rs`) and under Bun.

Decisions: [ADR-0042](../../adr/0042-extension-sdk-and-the-headless-bun-runner.md).

## Acceptance criteria

- [ ] Bun hash = native hash = wasm hash for every golden case.
- [ ] All examples pass `swarmpress check` and `swarmpress test`; every `swarmpress new` scaffold passes both.
- [ ] `check` refuses mismatched `sdk` ranges and reports schema errors per file.
- [ ] `pack` writes a reproducible tar.gz with a sha256 integrity file.
- [ ] A missing client-wasm build says to run `cargo xtask wasm`.

## Evidence

- `runner/bun-test`
- `net/nextest` (`runner_golden_hashes_match`)
