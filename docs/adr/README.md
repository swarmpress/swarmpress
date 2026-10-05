# Architecture Decision Records

swarm.press ADRs are written in [Cockpit](https://github.com/drietsch/cockpit)'s dialect:

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
| [0003](0003-deterministic-lockstep-server-authority.md) | Deterministic lockstep with server authority, command log and snapshots | Superseded in part |
| [0004](0004-babylonjs-webgpu-webgl2-fallback.md) | Babylon.js with WebGPU, WebGL2 fallback | Superseded in part by ADR-0064 |
| [0005](0005-orthographic-iso-dollhouse-camera-and-cutaway.md) | Orthographic iso dollhouse camera and cutaway | Accepted |
| [0006](0006-baked-gi-dynamic-lights-day-night.md) | Baked static GI plus dynamic gameplay lights; lighting as sim state; day/night | Accepted |
| [0007](0007-sim-renderer-render-state-contract.md) | Sim→renderer render-state contract | Accepted |
| [0008](0008-postgres-only-infrastructure.md) | Postgres as the only infrastructure (state, queue, notify) | Superseded in part |
| [0009](0009-site-repo-canonical-github-app.md) | Site repo canonical; one repo per company in the platform org via a GitHub App | Accepted |
| [0010](0010-claude-over-raw-http.md) | Claude over raw HTTP; per-role model and effort; structured outputs; refusal policy | Accepted |
| [0011](0011-orchestrator-owns-state-transitions.md) | Orchestrator owns state transitions; LLMs return artifacts | Accepted |
| [0012](0012-meetings-streamed-multi-agent-conversations.md) | Meetings as streamed multi-agent conversations with persisted transcripts | Accepted |
| [0013](0013-closed-world-knowledge-indexes.md) | Closed-world knowledge indexes | Accepted |
| [0014](0014-content-model-json-blocks-localizedstring.md) | Content model: JSON blocks, LocalizedString, core plus custom block schemas | Accepted |
| [0015](0015-agent-authored-themes-on-site-kit.md) | Agent-authored themes on a platform site kit with a PR and visual-review gate | Accepted |
| [0016](0016-site-kit-distribution-via-npm.md) | Site-kit distribution via npm; remove MONOREPO_PAT | Accepted |
| [0017](0017-asset-pipeline-cc0-blender-gltf.md) | Asset pipeline: CC0 kits, Blender bake, glTF/KTX2 | Superseded in part by ADR-0063 |
| [0018](0018-overlay-ui-in-preact.md) | Overlay UI in Preact | Accepted |
| [0019](0019-auth-github-oauth-cookie-sessions.md) | Auth: GitHub OAuth and cookie sessions | Accepted |
| [0020](0020-real-time-ticks-offline-catch-up.md) | Real-time ticks and offline catch-up | Superseded in part |
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
| [0042](0042-extension-sdk-and-the-headless-bun-runner.md) | Extension SDK and the headless Bun runner | Accepted |
| [0043](0043-extension-points-context-publish-challenges-self-authored-props.md) | Extension points: context providers, publish targets, challenges, staff-authored extensions, prop packs | Accepted |
| [0044](0044-commercial-principle-free-baseline-and-quotas.md) | Commercial principle, free baseline and quotas | Accepted |
| [0045](0045-executors-lease-epochs-and-fencing.md) | Executors, lease epochs and fencing | Accepted |
| [0046](0046-durable-backup-snapshots-text-packs-state-repo-mirror.md) | Durable backup: snapshots, text packs, state-repo mirror | Accepted |
| [0047](0047-player-owned-repositories.md) | Player-owned repositories | Accepted |
| [0048](0048-executor-time-and-continuity-shifts.md) | Executor time and continuity shifts | Accepted |
| [0049](0049-managed-infrastructure-single-binary-control-plane-cloudflare-data-plane.md) | Managed infrastructure: single-binary control plane, Cloudflare data plane | Accepted |
| [0050](0050-binary-assets-content-addressed-object-storage.md) | Binary assets: content-addressed object storage, sidecars in the site repo | Accepted |
| [0051](0051-ledger-unit-pricing-buckets-and-top-ups.md) | Ledger unit, pricing, buckets and top-ups | Accepted |
| [0052](0052-spend-requests-budgets-and-the-cfo.md) | Spend requests, budgets and the CFO | Accepted |
| [0053](0053-extension-placement-and-limits.md) | Extension placement and limits | Accepted |
| [0054](0054-byo-infrastructure-and-player-held-secrets.md) | Bring your own infrastructure, and player-held secrets | Accepted |
| [0055](0055-leagues-and-the-in-game-currency-symbol.md) | Leagues and the in-game currency symbol | Accepted |
| [0056](0056-work-records-a-digest-chained-history-of-agent-work.md) | Work records: a digest-chained, attributable history of agent work | Accepted |
| [0057](0057-strict-in-browser-inference-one-resident-model-on-webgpu.md) | Strict in-browser inference: one resident model on WebGPU | Accepted |
| [0058](0058-staged-jobs-on-one-resident-model.md) | Staged jobs on one resident model | Accepted |
| [0059](0059-publish-gate-and-failure-commands.md) | The CEO publish gate, and failures the sim can see | Accepted |
| [0060](0060-game-time-is-independent-of-gpu-speed.md) | Game time is independent of GPU speed | Accepted |
| [0061](0061-knowledge-pack-and-gateway-read-finalise-close.md) | Knowledge pack; gateway read, finalise and close; create-only article paths | Accepted |
| [0062](0062-local-standup-protocol-the-pitch-round.md) | Local standup protocol: the pitch round | Accepted |
| [0063](0063-brick-office-and-live-information-surfaces.md) | The brick office and live information surfaces | Accepted |
| [0064](0064-webgpu-only.md) | WebGPU only | Accepted |
| [0065](0065-the-construction-kit.md) | The construction kit | Accepted |
| [0066](0066-gemma-4-e4b-with-mtp-on-upstream-llama-cpp-webgpu.md) | Gemma 4 E4B with MTP on upstream llama.cpp (WebGPU) | Accepted |
