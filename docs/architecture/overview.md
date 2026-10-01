# Architecture overview

SimPress has four moving parts:
- a deterministic **simulation** written once in Rust;
- an authoritative **server** that runs it for every company;
- a **browser client** that renders a replica of it;
- the **site repositories** where the staff's real work lands.

Postgres is the only infrastructure ([ADR-0008](../adr/0008-postgres-only-infrastructure.md)).

```
Browser ─────────────────────────────────────────────┐
│ apps/game (TS, Vite)                                │
│  Babylon.js WebGPU scene ◄── render-state ◄── client-wasm (sim-core replica)
│  Preact overlay (Inbox, Feed, Staff, Build, HUD)    │        ▲ commands/hashes/bubbles
│  LocalLlm worker (WebGPU, Transformers.js)  ◄─ job offers / ─► job results
└───────────────────────── WebSocket (postcard) ──────┼────────┘
Rust server (axum, tokio)                              │
│  company actors (authoritative sim-core, 10 Hz) ─ command log + daily snapshots (Postgres)
│  job queue (Postgres SKIP LOCKED) ─► agent runtime (Claude HTTP, meetings, tools, QA gate)
│                                   └► browser job worker protocol (leases, validation)
│  knowledge service (site manifest, entity/media/sitemap indexes, schema registry)
│  GitHub App client ─► site repos (content PRs, theme PRs) ◄─ webhooks (PR, checks, deployment_status)
└─ Postgres (only infra)          Site repo GitHub Actions: site-kit build, PR checks + screenshots, Pages deploy
```

## Responsibilities

| Component | Owns | Never does |
|---|---|---|
| `crates/sim-core` | All gameplay state and rules: building, rooms, devices, staff, projects, economy, events, inbox, `render_state()` | I/O, wall-clock time, floats, LLM text |
| `crates/protocol` | WS frames, `ClientCommand`/`ServerCommand`, snapshots (postcard, versioned) | Game logic |
| `crates/client-wasm` | `wasm-bindgen` facade: `Sim`, apply frames, `validate_command`, render buffers | Rendering |
| `apps/game` | Rendering (Babylon), overlay UI (Preact), input → commands, local LLM worker | Deciding gameplay facts |
| `crates/server` | Company actors, command log, snapshots, lockstep fan-out, job queue, REST, auth, webhooks | Letting an LLM change state |
| `crates/agents` | Roles, personas, prompts, orchestrator-owned pipelines, meetings, QA gate | Merging without a transition |
| `crates/claude` | Messages API: SSE, tool loop, structured output, caching, refusal/fallback, usage | Retrying silently with a weaker prompt |
| `crates/content-model` | Page/Block types, `LocalizedString`, JSON Schema registry (core + custom), validation | Rendering |
| `crates/knowledge` | Site manifest, entity/media/sitemap indexes, closed-world link and media resolution | Inventing ids |
| `crates/github` | App auth, repo-from-template, contents/branches/PRs/checks, webhooks | Holding user tokens |
| `crates/testkit` | FakeClaude, FakeGitHub, FakeBrowserWorker, fixtures, golden-hash helpers, world builders | Shipping in release builds |
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
  server/          axum app: auth, WS, company actors, job queue, REST, migrations (sqlx)
  testkit/         FakeClaude, FakeGitHub, fixtures, golden-hash helpers, world builders
apps/game/         Vite + TS + Babylon.js + Preact overlay (+ src/llm local inference)
packages/site-kit/ Astro integration: manifest routing, content loading, i18n, SEO, sitemap, block registry, collections routes
packages/content-schema/  Zod source of the page schema; exports page.schema.json; conformance-tested against Rust
themes/starter/    starter theme on site-kit (template for new players)
assets/            blender/, kits/ (CC0 sources, LFS), manifest.toml, bake + export scripts, out/ (glTF/KTX2)
docs/              architecture/, game-design/, guides/, runbooks/, adr/, features/
config/            roles.toml, models.toml, economy.toml, events.ron, rooms.ron
packages/site-builder/src/themes/cinque-terre/   FROZEN until cutover step 0 or 1 lands (the live deploy builds it)
```

What exists at M0:
- `crates/{sim-core, protocol, client-wasm, content-schema}`;
- `xtask`;
- `apps/game`;
- `packages/content-schema`;
- the frozen theme.

Everything else is planned. Its paths are already claimed by features in `docs/features/`.

## Design rules

These are the lessons of the legacy stack, turned into rules. `CLAUDE.md` repeats them for
contributors.

1. **LLMs never drive state transitions.** The orchestrator owns them, and LLMs return artifacts
   ([ADR-0011](../adr/0011-orchestrator-owns-state-transitions.md)).
2. **Transition first, then the side effect.** The transition, the command-log entry and the job
   request commit in one transaction. GitHub and Claude calls happen afterwards, idempotently.
3. **One source of truth per entity.** Content lives in the site repo, gameplay state in the
   command log and snapshots, transcripts in Postgres.
4. **Determinism.** `sim-core` uses integers only, ordered collections and the world RNG. Text
   enters the sim only as digests
   ([ADR-0003](../adr/0003-deterministic-lockstep-server-authority.md)).
5. **Closed world.** Agents refer to pages, entities and media by indexed id only
   ([ADR-0013](../adr/0013-closed-world-knowledge-indexes.md)).
6. **Prompt block documentation is generated from the schema**, never written by hand.
7. **Stubs fail loudly.** An unimplemented executor blocks the stage and opens a ticket.
8. **Minimal infrastructure.** Postgres only.

## Data flow: one article

1. The 09:00 standup meeting runs one LLM turn per speaker. Its structured outcome accepts a
   pitch. If the pitch is risky, it becomes a CEO ticket first.
2. The sim transitions the project to Brief and emits `Effect::RequestJob{kind: Brief}`. This
   commits with the command-log entry.
3. The job queue hands the job to the browser worker (a local model) or to Claude (the Agency),
   according to the job kind's executor policy.
4. The artifact (the brief) is validated on the server. The server then injects
   `Cmd::JobCompleted{digest}`.
5. The Draft stage writes the page JSON on branch `drafts/<project>` through the GitHub App and
   opens a PR. Validation covers the schema, closed-world links and media.
6. The Edit stage scores the draft. 7 or above approves. Below 7 loops back, at most 3 times,
   then opens a ticket or escalates to the Agency.
7. The QA gate runs deterministic checks, then an LLM coherence review, with a fix loop.
8. Publish: the orchestrator merges, and the site repo's Actions build and deploy. The
   `deployment_status` webhook becomes `Cmd::DeployLanded`.
9. The nightly SiteAudit sees the page live. `Cmd::SiteSignals` then feeds the economy and the
   leaderboard.
