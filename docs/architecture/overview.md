# Architecture overview

SimPress is local-first ([ADR-0038](../adr/0038-local-first-the-browser-is-authoritative-for-a-company.md)).
It has four moving parts:
- a deterministic **simulation** written once in Rust;
- the **browser**, which runs a company authoritatively: the sim, the orchestrator, the staff's
  LLMs, the store and extensions;
- a small **central service** (one Rust binary with SQLite,
  [ADR-0039](../adr/0039-sqlite-is-the-central-database.md)) for what must be shared or must
  hold secrets;
- the **site repositories**, where the staff's real work lands.

```
Browser (authoritative for its company, under a central lease)
│ apps/game (TS, Vite, cross-origin isolated)
│  Babylon.js WebGPU scene ◄── render state ◄── client-wasm (sim-core)
│  Preact overlay (Inbox, Plan, Staff, Finance, Performance)
│  orchestration loop: drain Effect::RequestJob ─► orchestrator (wasm) ─► MeetingOutcome /
│                      JobCompleted / DeployLanded commands ─► sim at the next step boundary
│     ├ LocalLlm worker (Transformers.js, WebGPU) for staff jobs
│     ├ store: Turso wasm on OPFS (sqlite-wasm fallback), ADR-0041
│     └ extensions: JS bundles in a QuickJS-wasm sandbox, ADR-0042/0043
└──────── HTTPS + WebSocket ─────────────────────────────────────────────┐
Central service (crates/server: axum, sqlx-sqlite)                        │
│  auth (dev login, GitHub OAuth) · companies + lease                     │
│  content gateway (PathPolicy) ─► GitHub ◄─ webhooks (deployment_status) │
│  events inbox (poll + /ws/events) · sync (log segments, snapshots)      │
│  web fetch proxy (Firecrawl with credits later) · first-party tracker   │
└─ wave 3: credits ledger, Agency (Claude) jobs, marketplace
Site repo GitHub Actions: site-kit build, PR checks + screenshots, Pages deploy
```

## Responsibilities

| Component | Owns | Never does |
|---|---|---|
| `crates/sim-core` | All gameplay state and rules: building, rooms, devices, staff, projects, economy, events, inbox, `render_state()` | I/O, wall-clock time, floats, LLM text |
| `crates/protocol` | Command/snapshot encodings (postcard, versioned) | Game logic |
| `crates/client-wasm` | `wasm-bindgen` facade: `Sim`, commands, effects, JSON views, render state | Rendering |
| `crates/orchestrator` | Runs jobs (standup, draft, review, publish) through `Store` and `Gateway` traits; wasm-compatible | Changing a stage itself (it returns outcomes) |
| `apps/game` | Rendering (Babylon), overlay UI (Preact), input → commands, local LLM worker, store, orchestration loop | Deciding gameplay facts |
| `crates/server` | Auth, companies and leases, content gateway, events, webhooks, sync blobs, web fetch proxy, tracker | Running company sims; exposing credentials to browsers |
| `crates/agents` | Roles, personas, prompts, orchestrator-owned pipelines, meetings, QA gate | Merging without a transition |
| `crates/claude` | Messages API: SSE, tool loop, structured output, caching, refusal/fallback, usage | Retrying silently with a weaker prompt |
| `crates/content-model` | Page/Block types, `LocalizedString`, JSON Schema registry (core + custom), validation | Rendering |
| `crates/knowledge` | Site manifest, entity/media/sitemap indexes, closed-world link and media resolution | Inventing ids |
| `crates/github` | App auth, repo-from-template, contents/branches/PRs/checks, webhooks | Holding user tokens |
| `crates/testkit` | FakeClaude, FakeGitHub, fixtures, golden-hash helpers, world builders | Shipping in release builds |
| `packages/sdk`, `packages/sandbox`, `packages/runner` | Extension SDK, QuickJS-wasm sandbox, `simpress` CLI on Bun (headless game host) | Running extensions outside the sandbox |
| `packages/site-kit` | Astro 5 integration: routing, content, i18n, SEO, block registry, `kit` CLI | Presentation |
| `themes/starter` | The template theme for new players | Data loading |
| Site repo `theme/` | Agent-authored presentation | fs/node access, remote scripts |

## Repo layout

```
Cargo.toml  rust-toolchain.toml  .cargo/config.toml  xtask/
crates/
  sim-core/        deterministic sim: building, rooms, devices, staff, projects, economy, events, inbox, render_state()
  protocol/        WS frames, Command/ServerCommand, snapshots (postcard, versioned)
  client-wasm/     wasm-bindgen facade: Sim, apply frames, validate_command, render buffers
  content-schema/  Rust page validator over the exported JSON Schema (becomes content-model in M3)
  content-model/   Page/Block types, LocalizedString, JSON Schema registry (core + site custom), validation
  knowledge/       site manifest, entity/media/sitemap indexes, link/media resolution (closed world)
  claude/          Messages API client (SSE, tool loop, structured output, caching, refusal/fallback, usage)
  agents/          org/roles/personas/prompts, orchestrator-owned pipelines, meetings, tools, QA gate
  github/          GitHub App auth, repo-from-template, contents/branches/PRs/checks, webhooks
  orchestrator/    wasm-compatible job runner (Store + Gateway traits)
  server/          central service: auth, leases, gateway, events, sync, web fetch, tracker (sqlx-sqlite)
  testkit/         FakeClaude, FakeGitHub, fixtures, golden-hash helpers, world builders
apps/game/         Vite + TS + Babylon.js + Preact overlay (+ src/llm local inference)
packages/site-kit/ Astro integration: manifest routing, content loading, i18n, SEO, sitemap, block registry, collections routes
packages/sdk, sandbox, runner/  extension SDK, QuickJS-wasm sandbox, simpress CLI (Bun)
packages/content-schema/  Zod source of the page schema; exports page.schema.json; conformance-tested against Rust
themes/starter/    starter theme on site-kit (template for new players)
assets/            blender/, kits/ (CC0 sources, LFS), manifest.toml, bake + export scripts, out/ (glTF/KTX2)
docs/              architecture/, game-design/, guides/, runbooks/, adr/, features/
config/            roles.toml, models.toml, economy.toml, events.ron, rooms.ron
packages/site-builder/src/themes/cinque-terre/   FROZEN until cutover step 0 or 1 lands (the live deploy builds it)
```

Feature-by-feature status is in `docs/features/` and Cockpit; `docs/mvp.md` is the current
milestone contract.

## Design rules

These are the lessons of the legacy stack, turned into rules. `CLAUDE.md` repeats them for
contributors.

1. **LLMs never drive state transitions.** The orchestrator owns them, and LLMs return artifacts
   ([ADR-0011](../adr/0011-orchestrator-owns-state-transitions.md)).
2. **Transition first, then the side effect.** The transition emits the job request. GitHub and
   LLM calls happen afterwards, idempotently by job id, and their results come back as commands.
3. **One source of truth per entity.** Content lives in the site repo, company state in the
   command log and snapshots (browser, synced centrally), text in the browser store, and
   accounts and ledgers in central SQLite.
4. **Determinism.** `sim-core` uses integers only, ordered collections and the world RNG. Text
   enters the sim only as digests
   ([ADR-0003](../adr/0003-deterministic-lockstep-server-authority.md)).
5. **Closed world.** Agents refer to pages, entities and media by indexed id only
   ([ADR-0013](../adr/0013-closed-world-knowledge-indexes.md)).
6. **Prompt block documentation is generated from the schema**, never written by hand.
7. **Stubs fail loudly.** An unimplemented executor blocks the stage and opens a ticket.
8. **Minimal infrastructure.** Turso wasm in the browser and one Rust binary with SQLite
   centrally ([ADR-0041](../adr/0041-turso-in-the-browser-one-sqlite-dialect-everywhere.md)).

## Data flow: one article

This is the MVP loop, [docs/mvp.md](../mvp.md):

1. At 09:00 the sim emits `Effect::RequestJob{Standup}`. The orchestrator runs the meeting, with
   one LLM turn per speaker, and returns `MeetingOutcome{briefs}`. Transcripts go to the browser
   store.
2. The sim creates a work item and requests a Draft. The orchestrator writes the page JSON,
   validates it (schema, house style, closed-world ids) and opens a draft PR through the central
   gateway. The plan thread gets minutes, artifact and handoff posts.
3. The Review job scores the draft and returns `JobCompleted{digest}`. The sim decides: 7 or
   above publishes, below 7 revises, at most 3 times, and then the item is Blocked with a ticket.
4. Publish: the gateway squash-merges. The site repo's Actions build and deploy, and the
   `deployment_status` webhook becomes an event the browser reads. The browser applies
   `DeployLanded`, and the item is Published.
5. The command log is appended and synced as immutable segments. Reopening restores from OPFS
   or from central sync, then fast-forwards.
6. Later: the nightly SiteAudit sees the page live, and `SiteSignals` feeds the economy and the
   leaderboard.
