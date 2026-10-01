# SimPress documentation

SimPress is a browser management sim in which each player is the CEO of an AI publishing house.
The house appears as a detailed isometric 3D building rendered with Babylon.js on WebGPU. The
staff are real LLM agents: their meetings play out as speech bubbles, and their work produces
**one real website per player**. The user's own company is the imported, still-live
[cinqueterre.travel](https://cinqueterre.travel).

SimPress is a greenfield rebuild of swarm.press ([ADR-0001](adr/0001-greenfield-rebuild-legacy-tag.md)).
The legacy TypeScript code is reachable at the git tag `legacy-ts`.

## Where things are

| Section | Contents |
|---|---|
| [Architecture](architecture/overview.md) | System diagram, repo layout, and one document per subsystem |
| [Game design](game-design/overview.md) | Time, staff, rooms and progression, economy, events and inbox, leaderboard |
| [Guides](guides/getting-started.md) | Getting started, testing (Cockpit evidence), asset pipeline, contributing |
| [Runbooks](runbooks/operations.md) | Operations, and the [cinqueterre cutover](runbooks/cinqueterre-cutover.md) |
| [ADRs](adr/README.md) | ADR-0001 to ADR-0027, the decisions and the alternatives we rejected |
| [Features](features/) | FEAT-001 onwards, one file per feature, read by Cockpit to derive health |

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
  Agency
- [Content model](architecture/content-model.md): blocks, `LocalizedString`, knowledge indexes
- [Site kit](architecture/site-kit.md): `@swarm-press/site-kit` and agent-authored themes
- [Lighting and rendering](architecture/lighting-and-rendering.md): Babylon/WebGPU, cutaway,
  lighting, quality tiers

### Game design

[Overview](game-design/overview.md) · [Staff](game-design/staff.md) ·
[Rooms and progression](game-design/rooms-and-progression.md) · [Economy](game-design/economy.md) ·
[Events and inbox](game-design/events-and-inbox.md) · [Leaderboard](game-design/leaderboard.md) ·
[What the SDK makes possible](game-design/sdk-ideas.md)

### Guides and runbooks

[Getting started](guides/getting-started.md) · [Testing and evidence](guides/testing.md) ·
[Asset pipeline](guides/asset-pipeline.md) · [Contributing](guides/contributing.md) ·
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
