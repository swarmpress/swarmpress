---
id: FEAT-058
title: "Challenges, prop packs, panels and staff-authored provenance (manifest only)"
status: in-progress
importance: normal
paths:
  - packages/sdk/src/schemas.ts
  - packages/sdk/schemas/manifest.schema.json
  - packages/sdk/schemas/prop.schema.json
adrs:
  - ADR-0042
  - ADR-0043
---

# Challenges, prop packs, panels and staff-authored provenance (manifest only)

SDK v0 defines and validates these but does not run them: a `challenge` block (seed, scenario packs
and rules, `scoreExport`, end condition), prop documents (glTF, footprint in tiles, slots, at most
two lights), `panel` manifests, and `provenance` (`authoredBy {staffId, company, jobId}` or
`author {name, url?}`). The leaderboard replay, the render-state `props[]` contract change, the
panel iframe host and the `author_extension` job with its CEO approval ticket come later
(`docs/architecture/sdk.md`).

Decisions: [ADR-0042](../../adr/0042-extension-sdk-and-the-headless-bun-runner.md), [ADR-0043](../../adr/0043-extension-points-context-publish-challenges-self-authored-props.md).

## Acceptance criteria

- [ ] Challenge, prop-pack and panel manifests validate, and their required blocks are enforced.
- [ ] Both provenance forms validate; `check` warns that staff-authored extensions need CEO approval.
- [ ] Runtime support: replayed challenge scores, placed props, mounted panels (later).

## Evidence

- `sdk/bun-test` (schema cases)
