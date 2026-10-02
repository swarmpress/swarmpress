---
id: FEAT-054
title: "Extension sandbox (QuickJS in wasm, Bun API subset)"
status: in-progress
importance: high
paths:
  - "packages/sandbox/**"
adrs:
  - ADR-0042
---

# Extension sandbox (QuickJS in wasm, Bun API subset)

`@simpress/sandbox` runs one extension bundle in its own QuickJS-wasm instance
(`quickjs-emscripten-core` 0.32 + the release-sync variant), in the browser and under Bun/Node.
Inside the VM there is only `Bun.file/Bun.write` (capability-scoped store tables and read-only
pack files), `Bun.env = {}`, `fetch` with the `web` capability (origin allowlist), `simpress.llm`
with an `llm:<tier>` capability, and `console`. Memory (hard wasm-memory cap), interrupt (ops) and
wall-time limits fail calls with typed errors. Deterministic mode seeds `Math.random`, pins `Date`
and removes async I/O.

Decisions: [ADR-0042](../../adr/0042-extension-sdk-and-the-headless-bun-runner.md).

## Acceptance criteria

- [ ] Ungranted capabilities are absent or raise `CapabilityError`; store paths outside grants are refused.
- [ ] Memory, ops and wall-time breaches raise `SandboxLimitError` with the right `limit`.
- [ ] Deterministic mode gives identical output for the same seed, twice.
- [ ] Async host functions resolve in order; host rejections are catchable in the guest.
- [ ] The same example bundles give the same result in Chromium as under Bun.

## Evidence

- `sandbox/bun-test`
- `sandbox/playwright`
