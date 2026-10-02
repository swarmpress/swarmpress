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

Spikes on 2026-10-01:
- Bun 1.3.14 loaded the unmodified `crates/client-wasm/pkg` (wasm-bindgen
`web` target, `init({module_or_path: bytes})`), ran `Sim.demo(42)`, and advanced one game day
(12,000 steps) in 47 ms.
- Under Bun, `quickjs-emscripten` 0.32 ran an extension bundle through a Bun-style
  `Bun.file(...).json()` facade backed by a host store, in 11 ms:
  - seeded `Math.random`, pinned `Date`;
  - `while(true){}` was interrupted;
  - `fetch`, `require` and `process` were undefined.

## Decision

The SDK is `@simpress/sdk` (TypeScript types, manifest schema, helpers) plus the `simpress`
CLI, which runs on Bun.

An extension is a folder with `simpress.ext.json`: id, version, `sdk` semver range,
capabilities requested, and entry points. Extension kinds are tiered by where they run:

**Extensions are JavaScript bundles run in a wasm sandbox, client-side.** Bun has no wasm build,
so the sandbox is **QuickJS compiled to wasm** (`quickjs-emscripten`, about 230 KB gzipped,
lazy-loaded in a Worker), with a **Bun-compatible API subset**. Authors write and test in real
Bun, and the identical bundle runs in the browser.

- **Bundling:** `simpress build` bundles TS/JS with `Bun.build` into one script that assigns
  `globalThis.ext`.
- **The globals inside the sandbox are only what the host grants:**
  - `Bun.file(path).text()/json()` and `Bun.write`, mapped to capability-scoped store tables and
    pack files;
  - `fetch`, only with the `web` capability, through the central fetch proxy, with credits for
    Firecrawl;
  - `console`, routed to the extension log;
  - `Bun.env` is empty, and there is no `process`, `require`, filesystem or network otherwise.
- **Limits:** a memory cap, an interrupt budget (ops) and a wall-time budget per call. A breach
  fails the call loudly and opens a ticket.
- **Deterministic mode** (used for sim rules): `Math.random` is seeded from the world RNG stream,
  `Date` is pinned to the sim clock, and there is no async I/O.

| Kind | Form | Can touch | Determinism |
|---|---|---|---|
| **Content pack** | JSON/TOML validated by SDK schemas: personas, roles, rooms and props, happenings and event cards, job kinds, prompt layers, house-style rules, custom content blocks | data only | yes, the pack hash is part of the world config |
| **Sim rule** | JS bundle, hooks `onStep`/`onDayStart`/`onEvent` returning proposed commands | a read-only world view (JSON) | yes: it runs in deterministic mode at step boundaries, and the commands it emits are validated by `validate_command` and **appended to the command log**, so replay re-applies logged commands and never re-executes the JS |
| **Agent skill / tool** | JS bundle exporting `tools` and `jobs` | LLM, web (capability), store; returns **artifacts and digests**, never transitions | no, but it enters the sim only as commands |
| **UI panel** | JS bundle plus a panel manifest | sandboxed iframe in the overlay, `postMessage` API, read-only views, can propose player commands | n/a |

- **Capabilities are declared and granted.** The player sees the requested capabilities (web,
  credits, LLM tier, store tables) on install. The host enforces them; there is no ambient
  authority.
- **The `simpress` runner (Bun)** is the headless game host:
  - it loads `client-wasm` (and the orchestrator wasm once it ships), **the same QuickJS sandbox the browser uses** (extensions never run natively in Bun, so there is parity), a store (in-memory, or
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
  - QuickJS is slower than a native JIT. That's acceptable for hooks and skills, whose real cost
    is LLM latency. Hot paths stay in Rust.
  - The Bun API subset is ours to keep compatible. We document exactly what it covers, and
    anything outside it is undefined.
  - Agent skills are untrusted code, so they need sandboxing and capability enforcement in two
    hosts (browser Worker, Bun).
  - Bun is a second JS runtime to support; the runner sticks to web-standard APIs plus a thin
    `Bun.file` shim so it also runs under Node.
- **Alternatives rejected:**
  - Native Bun or Worker execution of extensions: no memory or interrupt limits, ambient
    APIs, and different behaviour in the browser and the runner.
  - A wasm interpreter (wasmi) inside sim-core for sim rules: it busts the sim bundle budget and
    forces modders into non-JS toolchains. Logging rule output as commands gives the same
    determinism.
  - Server-hosted mods: contradicts local-first.
  - No SDK until later: the extension boundaries would calcify around internals.
