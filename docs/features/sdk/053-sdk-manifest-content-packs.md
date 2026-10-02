---
id: FEAT-053
title: "Extension SDK: manifest, capabilities and content packs"
status: in-progress
importance: high
paths:
  - "packages/sdk/**"
  - "examples/extensions/harvest-season/**"
adrs:
  - ADR-0042
  - ADR-0043
---

# Extension SDK: manifest, capabilities and content packs

`@simpress/sdk` holds the zod sources and exported JSON Schemas for `simpress.ext.json` (id, semver
version, `sdk` range, kinds, capabilities, entry points, provenance) and for content-pack documents:
personas (exactly `agents::Persona`), authored happenings built from the ADR-0037 effect primitives,
and site-level prompt layers. Its `runtime` entry point (`defineSkill`, `defineRule`,
`defineContextProvider`, `definePublishTarget`, `jobResult`, a pure-JS SHA-256) is what bundles
import; it runs inside the sandbox.

Decisions: [ADR-0042](../../adr/0042-extension-sdk-and-the-headless-bun-runner.md), [ADR-0043](../../adr/0043-extension-points-context-publish-challenges-self-authored-props.md).

## Acceptance criteria

- [ ] Every built-in persona in `crates/agents/personas/*.toml` validates unchanged against the persona schema.
- [ ] Manifests are rejected for bad ids, versions, ranges, capabilities, and missing kind-specific fields.
- [ ] No happening primitive can move money; caps on mood, gather and ticket defaults hold.
- [ ] Job results are exactly `{artifact, digest}`; anything else (a stage, an approval) is rejected.
- [ ] `schemas/*.schema.json` match `src/schemas.ts` (drift check).

## Evidence

- `sdk/bun-test`
