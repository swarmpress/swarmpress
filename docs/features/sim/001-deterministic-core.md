---
id: FEAT-001
title: "Deterministic sim core"
status: in-progress
importance: critical
paths:
  - crates/sim-core/src/lib.rs
  - crates/sim-core/src/world.rs
  - crates/sim-core/src/rng.rs
  - crates/sim-core/src/command.rs
  - "crates/sim-core/tests/determinism*.rs"
  - "crates/sim-core/tests/proptest*.rs"
  - "crates/sim-core/benches/**"
  - "crates/client-wasm/tests/**"
  - "crates/testkit/src/golden*.rs"
adrs:
  - ADR-0002
  - ADR-0003
---

# Deterministic sim core

The `World` type: a fixed 100 ms step, a seeded PCG (`rand_pcg::Pcg32`), `u32` newtype ids in
`BTreeMap`s, money in cents, stats in permille, and `World::hash` (xxh3 over postcard). Commands are
the only way to change state; `validate_command` is shared by server and client. Today the world has
the step counter, seed, config, RNG and hash; the systems below are added on top.

Decisions: [ADR-0002](../../adr/0002-rust-server-and-sim-core-wasm-client.md), [ADR-0003](../../adr/0003-deterministic-lockstep-server-authority.md).

## Acceptance criteria

- [ ] Same seed + same ordered command log gives the same `World::hash` (unit test, 1 000 steps).
- [ ] Golden determinism: a scripted 50 000-step log hashes identically natively and in wasm (node and headless Chromium via wasm-bindgen-test).
- [ ] proptest invariants: cash conserved across settlement, no staff inside walls, every command validates or rejects, no panics.
- [ ] No floats, no `HashMap` iteration, no system time in `sim-core` (clippy `float_arithmetic` + review).
- [ ] criterion step benchmark stays inside its budget (`artifacts/bench` + `target/criterion`).

## Evidence

- `swarmpress/nextest` (unit, `crates/sim-core/src/lib.rs` today)
- `swarmpress/wasm-bindgen-test` (golden hash in wasm)
- `swarmpress/criterion` (step time)
