# ADR-0022 — Testing strategy, with Cockpit as the evidence and feature-health gate

**Status:** Accepted
**Date:** 2026-10-01

## Context

The legacy project declared features "complete" in `CLAUDE.md` checklists while they were broken
at runtime. That is assertion, not evidence.

swarm.press spans many test technologies:
- Rust unit and property tests;
- wasm tests under node and Chromium;
- vitest with Babylon `NullEngine`;
- Playwright on WebGPU and WebGL2, including visual baselines;
- `sqlx::test` server tests;
- FakeClaude pipeline tests;
- benchmarks (step time, wasm size, frame time, agent cost);
- site CI for themes.

These need one place where health is derived per feature.

## Decision

- **Full suites gate every PR.** The per-subsystem list is in
  [docs/guides/testing.md](../guides/testing.md). Live LLM, live GitHub and real-model WebGPU runs
  happen nightly or on demand.
- **Cockpit** ([drietsch/cockpit](https://github.com/drietsch/cockpit)) is the evidence and
  feature-health gate:
  - Features are `docs/features/<chapter>/NNN-*.md`, with frontmatter `id`, `title`, `status`,
    `importance`, `paths` and `adrs`.
  - ADRs use Cockpit's dialect (`# ADR-NNNN — Title`, Status, Date, Context, Decision,
    Consequences).
  - `cockpit.toml` registers one `[[evidence]]` source per suite:
    - nextest JUnit;
    - vitest JUnit;
    - Playwright JSON (e2e and visual);
    - wasm-bindgen-test JUnit;
    - Criterion;
    - `cockpit.benchmark.v1` documents for wasm size, frame time and agent pipeline cost.

    Each pulls from `ci.yml` artifacts on `main`.
  - Health is Healthy, Needs Attention, Broken or **Unknown**. Missing evidence is Unknown, never
    green.
  - CI runs `cockpit scan && cockpit validate --strict` after the test jobs. Critical and high
    features that are not `planned` must have test evidence.
- **Commit messages** mention `FEAT-0xx` and `ADR 0xx` so Cockpit links changes to features.
- **Site repos reuse the formats.** Theme PR checks emit `cockpit.visual.v1` and Lighthouse
  `cockpit.benchmark.v1`, and the Art Director agent reads the same evidence.

Alternatives considered:

- **Coverage percentage as the gate.** Rejected. Coverage doesn't say whether a feature works,
  only that lines were executed.
- **Checklists in docs.** Rejected. That is the legacy failure mode.
- **A hosted dashboard (Codecov, Allure).** Rejected. Cockpit reads every format we produce,
  including benchmarks and visual diffs, works offline, and its feature model matches ours.

## Consequences

- Positive: "is it done?" has a derived answer per feature, with the evidence behind it.
- Positive: stale evidence (older than the latest implementation change) is visible.
- Negative: every feature needs maintained `paths`, or tests won't link. `cockpit validate`
  reports broken references.
- Negative: Cockpit pins Rust 1.98.0, so CI installs and caches that toolchain separately from
  the workspace toolchain.
- Negative: most features start Unknown and stay that way until their suites exist. That is
  honest, and the headline says so.
