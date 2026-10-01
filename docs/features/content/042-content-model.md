---
id: FEAT-042
title: "Content model and validators"
status: in-progress
importance: critical
paths:
  - "crates/content-schema/**"
  - "crates/content-model/**"
  - "packages/content-schema/**"
adrs:
  - ADR-0014
---

# Content model and validators

Page/Block types and `LocalizedString` (en required). Zod is the source in `packages/content-
schema`; `page.schema.json` is exported and embedded by the Rust crate (`crates/content-schema`
today, `crates/content-model` from M3) which validates with `jsonschema`. Shared fixtures keep both
validators in agreement; the Rust validator also ships to the browser in wasm.

Decisions: [ADR-0014](../../adr/0014-content-model-json-blocks-localizedstring.md).

## Acceptance criteria

- [ ] Valid fixtures pass and invalid fixtures fail in both Rust and Zod.
- [ ] Committed `page.schema.json` matches the Zod export (schema drift check in CI).
- [ ] Every block type has a renderer in the frozen theme (block-coverage test).

## Evidence

- `content/nextest` (`crates/content-schema`)
- `content-schema/vitest` (once its tsx test scripts run under vitest)
