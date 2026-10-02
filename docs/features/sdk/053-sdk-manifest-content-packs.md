---
id: FEAT-053
title: "Extension SDK: manifest, capabilities and content packs"
status: in-progress
importance: high
paths:
  - "packages/sdk/**"
  - "examples/extensions/harvest-season/**"
  - packages/sandbox/src/index.ts
  - packages/sandbox/test/limits.test.ts
adrs:
  - ADR-0042
  - ADR-0043
  - ADR-0053
---

# Extension SDK: manifest, capabilities and content packs

`@swarm-press/sdk` holds the zod sources and exported JSON Schemas for `swarmpress.ext.json` (id, semver
version, `sdk` range, kinds, capabilities, entry points, provenance) and for content-pack documents:
personas (exactly `agents::Persona`), authored happenings built from the ADR-0037 effect primitives,
and site-level prompt layers. Its `runtime` entry point (`defineSkill`, `defineRule`,
`defineContextProvider`, `definePublishTarget`, `jobResult`, a pure-JS SHA-256) is what bundles
import; it runs inside the sandbox.

Decisions: [ADR-0042](../../adr/0042-extension-sdk-and-the-headless-bun-runner.md), [ADR-0043](../../adr/0043-extension-points-context-publish-challenges-self-authored-props.md).

Placement and limits (increment B9, ADR-0053). The manifest gains:
- `runtime.placement` (`browser`, `cloud`) and `runtime.offline`, saying where a bundle may run.
  UI panels are browser-only; sim rules run anywhere because their output is logged as commands.
- `limits`: maximum fetches per poll, LLM calls per day by tier, credits per day. These are hard
  limits the host enforces, not hints.

The platform derives a cost ceiling from the limits and the price table (FEAT-068) and measures
actuals per extension (FEAT-070). Install raises a ticket with the ceiling and the CFO's note
(FEAT-073), default reject; a version that raises its limits needs re-approval. A cloud run never
serves a local LLM tier with a cloud model unless the player's mandate allows it.

Depends on: FEAT-068, FEAT-070.

## Acceptance criteria

- [ ] Every built-in persona in `crates/agents/personas/*.toml` validates unchanged against the persona schema.
- [ ] Manifests are rejected for bad ids, versions, ranges, capabilities, and missing kind-specific fields.
- [ ] No happening primitive can move money; caps on mood, gather and ticket defaults hold.
- [ ] Job results are exactly `{artifact, digest}`; anything else (a stage, an approval) is rejected.
- [ ] `schemas/*.schema.json` match `src/schemas.ts` (drift check).
- [ ] A manifest without `limits` that requests `web` or `llm:*` with `cloud` placement is rejected.
- [ ] The sandbox stops a bundle at each declared limit (`limits.test.ts`).

## Evidence

- `sdk/bun-test`
