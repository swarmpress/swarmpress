---
id: FEAT-052
title: "Build tooling, CI and the Cockpit evidence gate"
status: in-progress
importance: normal
paths:
  - "xtask/**"
  - cockpit.toml
  - .config/nextest.toml
  - ".github/workflows/**"
  - Cargo.toml
  - rust-toolchain.toml
adrs:
  - ADR-0022
---

# Build tooling, CI and the Cockpit evidence gate

`cargo xtask wasm` builds `client-wasm` with wasm-bindgen; CI runs fmt, clippy, nextest, wasm tests,
vitest, Playwright, schema drift, the frozen-theme build, then `cockpit scan && cockpit validate
--strict`, uploading every report as an artifact.

Decisions: [ADR-0022](../../adr/0022-testing-strategy-cockpit-evidence-gate.md).

## Acceptance criteria

- [ ] `cockpit validate --strict` passes on main.
- [ ] Every suite in `cockpit.toml` is produced by a CI job and uploaded as the named artifact.

## Evidence

- all configured suites
