# swarm.press documentation

swarm.press is a browser management sim in which each player is the CEO of an AI publishing house.
The house appears as a detailed isometric 3D building rendered with Babylon.js on WebGPU. The
staff are real LLM agents: their meetings play out as speech bubbles, and their work produces
**one real website per player**. The user's own company is the imported, still-live
[cinqueterre.travel](https://cinqueterre.travel).

swarm.press is a greenfield rebuild of the earlier TypeScript swarm.press ([ADR-0001](adr/0001-greenfield-rebuild-legacy-tag.md)).
The legacy TypeScript code is reachable at the git tag `legacy-ts`.

## Where things are

| Section | Contents |
|---|---|
| [Architecture](architecture/overview.md) | System diagram, repo layout, and one document per subsystem |
| [Game design](game-design/overview.md) | Time, staff, rooms and progression, economy, events and inbox, leaderboard |
| [Guides](guides/getting-started.md) | Getting started, testing (Cockpit evidence), asset pipeline, contributing |
| [Runbooks](runbooks/operations.md) | Operations, and the [cinqueterre cutover](runbooks/cinqueterre-cutover.md) |
| [ADRs](adr/README.md) | ADR-0001 to ADR-0064, the decisions and the alternatives we rejected |
| [Features](features/) | FEAT-001 onwards, one file per feature, read by Cockpit to derive health |
| [MVP](mvp.md) | The current MVP: the owner's company for real, on one resident in-browser model |
| [Design](design/mvp-runtime.md) | Implementation designs for the MVP: [runtime](design/mvp-runtime.md), [pipeline, gate, time and site path](design/mvp-pipeline.md), [gap analysis](design/mvp-gap-analysis.md), [brick office](design/brick-office.md) |
| [Reference](reference/browser-agent-studio.md) | The owner's concept document, [Browser Agent Studio](reference/browser-agent-studio.md): the source of the local-inference and agent-loop principles (ADR-0057); the [brick office](reference/brick-office.md) concept with its prototype (ADR-0063) |

### Architecture

- [Overview](architecture/overview.md): diagram, component responsibilities, repo layout, design
  rules
- [Simulation](architecture/sim.md): `sim-core`, determinism, entities, systems, commands and
  effects
- [Protocol](architecture/protocol.md): WebSocket frames, lockstep, snapshots, versioning, REST
- [Render state](architecture/render-state.md): the sim → renderer contract
- [Agents](architecture/agents.md): organisation, roles, personas, prompt layering, pipelines,
  meetings, QA gate
- [Hybrid inference](architecture/hybrid-inference.md): browser LLMs for staff, Claude for the
  Agency (for the MVP, superseded by strictly local inference: ADR-0057 and
  [design/mvp-runtime.md](design/mvp-runtime.md))
- [Content model](architecture/content-model.md): blocks, `LocalizedString`, knowledge indexes
- [Site kit](architecture/site-kit.md): `@swarm-press/site-kit` and agent-authored themes
- [Lighting and rendering](architecture/lighting-and-rendering.md): Babylon/WebGPU, cutaway,
  lighting, quality tiers
- [Extension SDK](architecture/sdk.md): extension kinds, `swarmpress.ext.json`, capabilities, the
  QuickJS sandbox, the `swarmpress` runner, the sim-rule contract
- [Browser runtime](architecture/browser-runtime.md): the company store (Turso wasm / sqlite-wasm
  on OPFS), the central API client, the orchestrator-wasm bridge, cross-origin isolation
- [Commercial model and managed architecture](architecture/commercial-model.md): the free
  baseline, executors and fencing, backup, continuity, pricing and spend control, assets, BYO
  (decided in ADR-0044 to ADR-0056, not built yet)

### Game design

[Overview](game-design/overview.md) · [Staff](game-design/staff.md) ·
[Rooms and progression](game-design/rooms-and-progression.md) · [Economy](game-design/economy.md) ·
[Events and inbox](game-design/events-and-inbox.md) · [Leaderboard](game-design/leaderboard.md) ·
[What the SDK makes possible](game-design/sdk-ideas.md)

### Guides and runbooks

[Getting started](guides/getting-started.md) · [Testing and evidence](guides/testing.md) ·
[Asset pipeline](guides/asset-pipeline.md) · [Writing extensions](guides/extending.md) ·
[Contributing](guides/contributing.md) ·
[Operations](runbooks/operations.md) · [cinqueterre cutover](runbooks/cinqueterre-cutover.md)

## Status (2026-10-01, milestone M0)

Only these exist in code so far:
- the Babylon client's rendering bits (engine, camera, cutaway, procedural office, lighting,
  post-FX);
- the content schema (Zod and the Rust validator);
- the sim clock and world hash.

Everything else is specified here and in the ADRs, and is marked `planned` in `docs/features/`.
Cockpit reports those features as **Unknown** until their test suites exist. That is deliberate
([ADR-0022](adr/0022-testing-strategy-cockpit-evidence-gate.md)): missing evidence is never green.
