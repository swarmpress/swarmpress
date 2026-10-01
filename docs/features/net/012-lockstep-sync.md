---
id: FEAT-012
title: "Lockstep sync and desync recovery"
status: planned
importance: critical
paths:
  - "crates/server/src/ws/**"
  - "crates/server/tests/ws*.rs"
  - "crates/client-wasm/src/**"
  - "apps/game/src/net/**"
adrs:
  - ADR-0003
---

# Lockstep sync and desync recovery

Clients receive a snapshot on join, then the command stream, and apply it to their wasm replica at
the same steps. Hash checks every 50 steps; mismatch → resnapshot; desyncs are logged with both
hashes and recent commands.

Decisions: [ADR-0003](../../adr/0003-deterministic-lockstep-server-authority.md).

## Acceptance criteria

- [ ] Two clients connected to one company stay hash-identical for 1 simulated hour (tokio-tungstenite integration test).
- [ ] An injected desync triggers resnapshot and recovers.
- [ ] Reconnect resumes from the latest snapshot plus log tail.

## Evidence

- `server/nextest`
- `game/playwright-e2e` (two browsers in sync)
