---
id: FEAT-068
title: "Billing crate and pricing v2"
status: planned
importance: critical
paths:
  - "crates/billing/**"
  - config/pricing.toml
adrs:
  - ADR-0051
---

# Billing crate and pricing v2

Increment B2. `crates/billing` is pure integer price arithmetic. It compiles to wasm so the
browser shows estimates with the same code the server charges with.

- The ledger unit is the micro-euro (`i64`); the display unit is the credit, 1 credit = €0.001.
- Usage is accumulated as an integer numerator (tokens × rate), then FX and uplift are applied in
  one `i128` division with a ceiling to 1 µ€. Nothing is rounded per token or per job.
- `config/pricing.toml` v2 publishes EUR list prices derived from USD at a recorded `fx_ppm`,
  with `uplift_bp` globally and per service. A price change is a new `price_version`.
- Every priced result carries provider µ$, `fx_ppm`, `uplift_bp` and the price version.

Depends on: nothing. FEAT-069 and FEAT-070 depend on it.

## Acceptance criteria

- [ ] Property tests: the charge is never below cost × uplift, is monotonic in usage and cannot
      overflow for any accepted input.
- [ ] Golden vectors for a cached review, a draft, a research job, a scrape and a storage day.
- [ ] `cargo build -p billing --target wasm32-unknown-unknown` succeeds.
- [ ] No float appears in the crate's public API.

## Evidence

- `swarmpress/nextest`
