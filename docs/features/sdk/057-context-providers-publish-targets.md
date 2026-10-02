---
id: FEAT-057
title: "Context providers and publish targets"
status: in-progress
importance: high
paths:
  - packages/runner/src/engine.ts
  - packages/runner/src/fakes.ts
  - packages/runner/test/context.test.ts
  - packages/runner/test/publish.test.ts
  - "examples/extensions/ligurian-ferries/**"
  - "examples/extensions/ghost-publisher/**"
adrs:
  - ADR-0043
---

# Context providers and publish targets

Context providers export `poll({now, region, cursor}) → {cursor, facts[], happenings[]}`; the host
enforces the manifest's cadence and validates facts (kind, source, region, expiry). Publish targets
export `openDraft`, `merge` and `status`; `fetch` is limited to the manifest's `origins`, and the
bundle passes an opaque `credentialRef` that the host's credential proxy swaps for the real secret
outside the sandbox. Examples: Ligurian ferry cancellations and a Ghost Admin API publisher, tested
against fixtures and a recorded fake server.

Decisions: [ADR-0043](../../adr/0043-extension-points-context-publish-challenges-self-authored-props.md).

## Acceptance criteria

- [ ] Invalid facts and facts for another region are rejected; polling faster than the cadence is refused.
- [ ] The secret never enters the sandbox; a bundle setting `Authorization` or fetching another origin fails.
- [ ] The Ghost publisher completes draft → publish → status against the recorded server.

## Evidence

- `runner/bun-test`
