# ADR-0042 — Extension SDK and the headless Bun runner

**Status:** Accepted
**Date:** 2026-10-01

## Context

The product owner wants SimPress to be extensible from the start: an SDK, plus a runner that
executes the wasm game outside the browser. The game is local-first (ADR-0038), its sim is a
deterministic wasm module (ADR-0002), and its staff work through an orchestrator that is also
compiled to wasm (`docs/mvp.md`).

Extensions must not break three invariants:
- determinism: the same seed plus the same log gives the same hash everywhere;
- "text never enters the sim";
- "the orchestrator owns transitions".

A spike on 2026-10-01: Bun 1.3.14 loaded the unmodified `crates/client-wasm/pkg` (wasm-bindgen
`web` target, `init({module_or_path: bytes})`), ran `Sim.demo(42)`, and advanced one game day
(12,000 steps) in 47 ms.

## Decision

The SDK is `@simpress/sdk` (TypeScript types, manifest schema, helpers) plus the `simpress`
CLI, which runs on Bun.

An extension is a folder with `simpress.ext.json`: id, version, `sdk` semver range,
capabilities requested, and entry points. Extension kinds are tiered by where they run:

| Kind | Form | Runs in | Can touch | Determinism |
|---|---|---|---|---|
| **Content pack** | JSON/TOML validated by SDK schemas: personas, roles, rooms and props, happenings and event cards, job kinds, prompt layers, house-style rules, custom content blocks | loaded into sim config / orchestrator config | data only | yes, the pack hash is part of the world seed config |
| **Sim rule** | a wasm module exporting the hook ABI (`on_step`, `on_day_start`, `on_event`, `score_modifier`), written in any language that targets wasm32 | inside sim-core, through an interpreter with fuel metering (wasmi), behind the `ext-rules` feature | read world view; return commands to validate | yes: integer-only ABI, no host I/O, fuel-bounded, module hash in the world hash |
| **Agent skill / tool** | an ES module (TS compiled by the CLI) exporting `tools` and `jobs` | orchestrator layer: a sandboxed Worker in the browser, a Bun worker in the runner | LLM, web fetch proxy (credits), store; returns **artifacts and digests**, never transitions | no, but it enters the sim only as commands |
| **UI panel** | ES module with a panel manifest | sandboxed iframe in the overlay, `postMessage` API | read-only game views, can propose player commands | n/a |

- **Capabilities are declared and granted.** The player sees the requested capabilities (web,
  credits, LLM tier, store tables) on install. The host enforces them; there is no ambient
  authority.
- **The `simpress` runner (Bun)** is the headless game host:
  - it loads `client-wasm` (and the orchestrator wasm once it ships), a store (in-memory, or
    `@tursodatabase/database` native under Bun, using the same SQL as the browser per
    ADR-0041), FakeLlm or a local or remote LLM adapter, and FakeGitHub or the central gateway;
  - **CLI:** `simpress new <kind>`, `simpress run [--days N] [--seed S] [--ext path…]`,
    `simpress test` (scenario files: seed, commands, expected digests and hashes),
    `simpress check` (manifest, schemas, determinism replay), `simpress pack`.
  - We dogfood it: sim scenarios, the orchestrator loop with FakeLlm, and determinism
    (browser hash = Bun hash = native hash) run under the runner in CI.
- **Versioning:** the SDK follows semver and is tied to `PROTO_VERSION` and the content-schema
  version. Breaking hook-ABI changes bump the major version, and the runner refuses mismatched
  ranges.
- **Distribution:** local folders first (dev), then a marketplace listing priced in Credits
  (ADR-0033, wave 3).

## Consequences

- Modders and our own tests get one headless host, so CI, bots, balance sweeps and
  extension tests need no browser.
- Content packs cover most extension needs with zero runtime risk.
- **Negative:**
  - Sim-rule wasm adds an interpreter to the sim (bundle-size budget, see below) and a
    hook ABI we must keep stable. It ships behind `ext-rules`, with its own size budget, after
    the MVP.
  - Agent skills are untrusted code, so they need sandboxing and capability enforcement in two
    hosts (browser Worker, Bun).
  - Bun is a second JS runtime to support; the runner sticks to web-standard APIs plus a thin
    `Bun.file` shim so it also runs under Node.
- **Alternatives rejected:**
  - JS sim hooks (QuickJS-in-wasm): bigger, and floating-point and Date leakage threaten
    determinism.
  - Server-hosted mods: contradicts local-first.
  - No SDK until later: the extension boundaries would calcify around internals.
