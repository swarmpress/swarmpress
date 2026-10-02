# MVP: one article, end to end (local-first)

> Architecture: [ADR-0038](adr/0038-local-first-the-browser-is-authoritative-for-a-company.md) (browser
> authoritative), [ADR-0041](adr/0041-turso-in-the-browser-one-sqlite-dialect-everywhere.md) (Turso wasm on OPFS, one SQLite dialect), [ADR-0039](adr/0039-sqlite-is-the-central-database.md) (central SQLite),
> [ADR-0040](adr/0040-web-access-for-local-models-fetch-proxy-and-firecrawl.md) (web access).

The MVP is done when **an automated browser test and a manual run** both show
this loop on the merged tree:

```
Browser (authoritative)                                          Central server (Rust + SQLite)
───────────────────────────────────────────────────────────     ─────────────────────────────────────
dev login ─────────────────────────────────────────────────────► session; company + project row; lease
found company: sim-core scenario "cinqueterre" (13 people)
Turso wasm/OPFS: sim log + snapshots, plan, briefs, artifacts, transcripts
   │
09:00 standup ─ Effect::RequestJob(Standup)
   └─ orchestrator (wasm) ─ LocalLlm (FakeLlm in tests) ─ transcript, briefs
        └─ ServerCommand::MeetingOutcome → sim creates work item
Draft phase ─ RequestJob(Draft) ─ orchestrator: page JSON, validate (content-schema + house style)
   └─ gateway: open draft PR ───────────────────────────────────► POST /api/gateway/draft (PathPolicy:
                                                                   content/** on drafts/*) → GitHub
   └─ plan: minutes, artifact, handoff posts (Turso)               (FakeGitHub in tests/dev)
Review phase ─ RequestJob(Review) ─ verdict/score → plan review post
   └─ JobCompleted{score} → sim: <7 revise, ≥7 publish
Publish ─ RequestJob(Publish) ─ gateway: merge ─────────────────► POST /api/gateway/merge → squash merge
                                                                   deployment_status webhook (or simulated
                                                                   in dev) → offline/online event inbox
   ◄──────────────────────────── event: DeployLanded{work_item} ◄─ GET /api/events (+ push channel)
   └─ ServerCommand::DeployLanded → item Published; plan status post; CEO feed
sync: append log segment + snapshot ───────────────────────────► PUT /api/sync/{company}/… (blobs on disk)
reload / new device: restore from OPFS or sync by replay to the checkpoint, merge inbox events (ADR-0048)
```

## Contracts

**sim ↔ orchestrator** (unchanged):
- `Effect::RequestJob { job_id, kind, project, work_item, brief_ref, revision, staff }`,
  drained with `World::drain_effects()`.
- Results come back as `ServerCommand::{MeetingOutcome, JobCompleted, DeployLanded}`.

In the browser these are *local* commands that the client applies at the next
step boundary and appends to the command log. "Server command" just means
"not a player command".

**`crates/orchestrator`** (wasm-compatible, no tokio or sqlx). Same logic as
the earlier server prototype (`git show f0db482:crates/server/src/orchestrator.rs`):
- `Orchestrator<S: Store, G: Gateway>` with `run(&JobRequest) -> Result<Vec<Outcome>>`.
- `trait Store`: briefs, artifacts, transcripts and plan posts (item text,
  append post), async.
- `trait Gateway`: `open_draft(content_id, path, page, message) -> DraftPr`
  and `merge(pr, head_sha) -> merged_sha`.
- `Llm` is the agents crate trait.
- Implementations:
  - `MemStore` and `FakeGateway` for tests;
  - in the browser: a Turso-wasm-backed store (sqlite-wasm fallback, ADR-0041) and an HTTP gateway (JS bridge,
    `crates/orchestrator-wasm`, a separate module from `client-wasm`; see
    `docs/architecture/browser-runtime.md`);
  - on the server: SQLite store and a direct github gateway, used only for
    Agency jobs later.

**Central HTTP API** (SQLite):

| Area | Endpoints |
|---|---|
| Auth | `POST /auth/dev/login` (only with `SWARMPRESS_DEV_AUTH=1`), GitHub OAuth, `GET /api/me` |
| Company | `POST /api/companies`, `GET /api/companies/me`, `POST /api/companies/{id}/lease` |
| Gateway | `POST /api/gateway/draft`, `POST /api/gateway/merge` (company lease required; PathPolicy) |
| Events | `GET /api/events?after=`, plus a WebSocket push channel (`/ws/events`) |
| Sync | `PUT/GET /api/sync/{company}/log/{segment}`, `PUT/GET /api/sync/{company}/snapshot` |
| Web | `GET /web/fetch?url=`; `POST /web/firecrawl/*` (stubbed: credits wave) |
| Tracker | `/t/s.js`, `/t/e`, `/api/analytics` (from ADR-0032, on SQLite) |

## Executors

| Mode | LLM | GitHub |
|---|---|---|
| test (CI) | scripted `FakeLlm` (Rust tests), scripted fake `LocalLlm` (browser e2e) | `FakeGitHub` in the server |
| dev (manual) | `?llm=fake` scripted, or a real local model once Hugging Face is reachable | `SWARMPRESS_GITHUB=fake` (in-memory, lost on restart) or a sandbox repo |
| live | browser staff, plus Agency (Claude, credits) | GitHub App |

## Acceptance checklist

- [ ] `cargo nextest run --workspace` green (sim, orchestrator with `MemStore`
      covering the full loop, server on SQLite)
- [ ] `cargo build -p orchestrator --target wasm32-unknown-unknown`, and
      `crates/orchestrator-wasm` exports the orchestrator bridge (its own module and size budget)
- [ ] Browser e2e (`apps/game/e2e/mvp.spec.ts`) green:
  - dev login → company founded;
  - fast-forward to 09:00;
  - standup → draft PR → review 6 → revision → review 8 → merge;
  - DeployLanded via the events API → item published;
  - the Plan panel shows the thread;
  - a reload restores everything from OPFS;
  - a fresh browser context restores from central sync.
- [ ] `pnpm -r test`, the Playwright smoke and visual suites, and
      `cockpit validate --strict` green
- [ ] Docs: getting started covers the dev run (server + `pnpm dev`, fake modes)
