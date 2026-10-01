# ADR-0002 — Rust server and sim core, wasm client

**Status:** Accepted
**Date:** 2026-10-01

## Context

The game needs one simulation that runs in two places:
- **On the server, authoritatively.** Companies keep running while their players are offline.
- **In the browser, as a replica.** This gives smooth, predictive, zero-latency rendering at
  60 fps.

Both copies must produce bit-identical state from the same command log. Otherwise lockstep
([ADR-0003](0003-deterministic-lockstep-server-authority.md)) can neither detect nor repair
desyncs.

The server also hosts:
- long-running per-company actors;
- a Postgres job queue;
- a Claude HTTP client with SSE streaming;
- a GitHub App client;
- a WebSocket fan-out.

That is classic async I/O backend work.

## Decision

- **`crates/sim-core`** is a pure Rust library. It has no I/O, no clocks and no threads. It uses
  only integer and fixed-point math, ordered collections and a seeded PCG. It compiles natively
  for the server and to `wasm32-unknown-unknown` for the browser.
- **`crates/client-wasm`** is a thin `wasm-bindgen` facade: `Sim`, apply frames,
  `validate_command`, render buffers. `cargo xtask wasm` builds it, and `apps/game` consumes it.
- **`crates/server`** uses axum, tokio and sqlx (for Postgres). It depends on `sim-core`,
  `protocol`, `content-model`, `knowledge`, `claude`, `agents` and `github`.
- **The browser client (`apps/game`)** is TypeScript with Vite, Babylon.js and Preact. It renders
  and collects input, and holds no gameplay rules beyond what wasm exposes.

Alternatives considered:

- **TypeScript everywhere (a Node server and a shared TS sim).** Rejected. JS numbers are doubles,
  float determinism across engines is not guaranteed, and integer discipline can't be enforced at
  scale. It would also lose the type-level guarantees we want around the sim.
- **A Rust server with a separate TS client sim.** Rejected. Two implementations of every rule
  drift apart, and golden-hash tests would only detect divergence, never prevent it.
- **A Go or C# server.** Rejected. Neither has a first-class wasm target for the same code, so the
  sim would still be written twice.
- **A Bevy or fully Rust client.** Rejected. Babylon.js already provides a mature WebGPU PBR
  renderer, GUI and tooling ([ADR-0004](0004-babylonjs-webgpu-webgl2-fallback.md)). The overlay
  UI is better served by the web platform.

## Consequences

- Positive: the same code and the same `World::hash` run natively and in wasm, and a golden test
  proves it on every PR.
- Positive: the server is a single static binary whose only dependency is Postgres.
- Negative: there are two toolchains (cargo and pnpm), and every client dev loop has a wasm build
  step (`pnpm dev` runs `cargo xtask wasm` first).
- Negative: `wasm-bindgen-cli` must exactly match the `wasm-bindgen` crate version (0.2.100).
- Negative: contributors need to read both Rust and TypeScript. The boundary between them, the
  render-state contract ([ADR-0007](0007-sim-renderer-render-state-contract.md)), is kept small on
  purpose.
