# Architecture Decision Records

SimPress ADRs are written in [Cockpit](https://github.com/drietsch/cockpit)'s dialect:

```markdown
# ADR-NNNN — Title

**Status:** Accepted
**Date:** YYYY-MM-DD

## Context
## Decision
## Consequences
```

Feature files link ADRs with `adrs: [ADR-0004]`, and commit messages mention `ADR 004` so Cockpit
can correlate changes with decisions. A new ADR takes the next free number. A changed decision
gets a new ADR that supersedes the old one (add `**Superseded by:** ADR-NNNN` to the old one).
Accepted ADRs are never rewritten.

| # | Decision | Status |
|---|---|---|
| [0001](0001-greenfield-rebuild-legacy-tag.md) | Greenfield rebuild, legacy tag | Accepted |
| [0002](0002-rust-server-and-sim-core-wasm-client.md) | Rust server and sim core, wasm client | Accepted |
| [0003](0003-deterministic-lockstep-server-authority.md) | Deterministic lockstep with server authority, command log and snapshots | Accepted |
| [0004](0004-babylonjs-webgpu-webgl2-fallback.md) | Babylon.js with WebGPU, WebGL2 fallback | Accepted |
| [0005](0005-orthographic-iso-dollhouse-camera-and-cutaway.md) | Orthographic iso dollhouse camera and cutaway | Accepted |
| [0006](0006-baked-gi-dynamic-lights-day-night.md) | Baked static GI plus dynamic gameplay lights; lighting as sim state; day/night | Accepted |
| [0007](0007-sim-renderer-render-state-contract.md) | Sim→renderer render-state contract | Accepted |
| [0008](0008-postgres-only-infrastructure.md) | Postgres as the only infrastructure (state, queue, notify) | Accepted |
| [0009](0009-site-repo-canonical-github-app.md) | Site repo canonical; one repo per company in the platform org via a GitHub App | Accepted |
| [0010](0010-claude-over-raw-http.md) | Claude over raw HTTP; per-role model and effort; structured outputs; refusal policy | Accepted |
| [0011](0011-orchestrator-owns-state-transitions.md) | Orchestrator owns state transitions; LLMs return artifacts | Accepted |
| [0012](0012-meetings-streamed-multi-agent-conversations.md) | Meetings as streamed multi-agent conversations with persisted transcripts | Accepted |
| [0013](0013-closed-world-knowledge-indexes.md) | Closed-world knowledge indexes | Accepted |
| [0014](0014-content-model-json-blocks-localizedstring.md) | Content model: JSON blocks, LocalizedString, core plus custom block schemas | Accepted |
| [0015](0015-agent-authored-themes-on-site-kit.md) | Agent-authored themes on a platform site kit with a PR and visual-review gate | Accepted |
| [0016](0016-site-kit-distribution-via-npm.md) | Site-kit distribution via npm; remove MONOREPO_PAT | Accepted |
| [0017](0017-asset-pipeline-cc0-blender-gltf.md) | Asset pipeline: CC0 kits, Blender bake, glTF/KTX2 | Accepted |
| [0018](0018-overlay-ui-in-preact.md) | Overlay UI in Preact | Accepted |
| [0019](0019-auth-github-oauth-cookie-sessions.md) | Auth: GitHub OAuth and cookie sessions | Accepted |
| [0020](0020-real-time-ticks-offline-catch-up.md) | Real-time ticks and offline catch-up | Accepted |
| [0021](0021-economy-tied-to-real-site-signals.md) | Economy tied to real site signals | Accepted |
| [0022](0022-testing-strategy-cockpit-evidence-gate.md) | Testing strategy, with Cockpit as the evidence and feature-health gate | Accepted |
| [0023](0023-cinqueterre-migration-and-cutover.md) | cinqueterre migration and cutover | Accepted |
| [0024](0024-hybrid-inference-browser-llms-and-claude.md) | Hybrid inference: browser LLMs for staff, Claude for agency/heavy tasks | Accepted |
| [0025](0025-browser-job-worker-protocol.md) | Browser job worker protocol, leases, leader election, server-side artifact validation | Accepted |
| [0026](0026-model-registry-webgpu-capability-tiers.md) | Model registry and WebGPU capability tiers | Accepted |
| [0027](0027-gpu-sharing-renderer-and-local-llm.md) | GPU sharing between renderer and local LLM | Accepted |
| [0028](0028-organization-model-executive-office-and-departments.md) | Organization model: CEO, executive office and departments | Accepted |
| [0029](0029-a-company-runs-several-projects-each-with-its-own-team.md) | A company runs several projects, each with its own team | Accepted |
| [0030](0030-personas-are-a-data-catalog-with-cv-hobbies-and-interests.md) | Personas are a data catalog with CV, hobbies and interests | Accepted |
| [0031](0031-the-publishing-plan-is-the-shared-workspace-for-ceo-and-agents.md) | The publishing plan is the shared workspace for CEO and agents | Accepted |
| [0032](0032-first-party-analytics-tracker-owned-by-the-data-scientist.md) | First-party analytics tracker, owned by the data scientist | Accepted |
| [0033](0033-credits-a-closed-loop-platform-currency-separate-from-in-game-cash.md) | Credits: a closed-loop platform currency, separate from in-game cash | Accepted |
| [0034](0034-living-personas-memories-relationships-and-recorded-conversations.md) | Living personas: memories, relationships and recorded conversations | Accepted |
| [0035](0035-the-real-world-enters-through-a-world-context-service.md) | The real world enters through a World Context Service | Accepted |
| [0036](0036-a-day-director-thread-steers-each-day-within-sim-bounds.md) | A Day Director thread steers each day, within sim bounds | Accepted |
| [0037](0037-extraordinary-unscripted-happenings-composed-from-safe-primitives.md) | Extraordinary, unscripted happenings, composed from safe primitives | Accepted |
| [0038](0038-local-first-the-browser-is-authoritative-for-a-company.md) | Local-first: the browser is authoritative for a company | Accepted |
| [0039](0039-sqlite-is-the-central-database.md) | SQLite is the central database | Accepted |
| [0040](0040-web-access-for-local-models-fetch-proxy-and-firecrawl.md) | Web access for local models: fetch proxy and Firecrawl | Accepted |
| [0041](0041-turso-in-the-browser-one-sqlite-dialect-everywhere.md) | Turso in the browser; one SQLite dialect everywhere | Accepted |
