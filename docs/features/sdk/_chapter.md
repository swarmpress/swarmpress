---
title: Extension SDK
group: sdk
order: 8
---
# Extension SDK

`@swarm-press/sdk`, the QuickJS-wasm sandbox and the headless `swarmpress` runner (ADR-0042, ADR-0043):
content packs, sim rules, agent skills, context providers and publish targets, plus the manifest-only
kinds (panels, challenges, prop packs). Architecture: [`docs/architecture/sdk.md`](../../architecture/sdk.md).
Tutorial: [`docs/guides/extending.md`](../../guides/extending.md).

| Feature | Title | Status | Importance |
|---|---|---|---|
| [FEAT-053](053-sdk-manifest-content-packs.md) | Extension SDK: manifest, capabilities and content packs | in-progress | high |
| [FEAT-054](054-extension-sandbox.md) | Extension sandbox (QuickJS in wasm, Bun API subset) | in-progress | high |
| [FEAT-055](055-swarmpress-runner.md) | `swarmpress` headless runner and determinism evidence | in-progress | high |
| [FEAT-056](056-skills-and-sim-rules.md) | Agent skills and sim rules | in-progress | high |
| [FEAT-057](057-context-providers-publish-targets.md) | Context providers and publish targets | in-progress | high |
| [FEAT-058](058-challenges-props-provenance.md) | Challenges, prop packs, panels and staff-authored provenance (manifest only) | in-progress | normal |
| [FEAT-063](063-self-hosted-continuity.md) | Self-hosted continuity runner (swarmpress continue) | planned | high |
