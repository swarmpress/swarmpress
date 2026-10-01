# simpress-server

The central SimPress server: GitHub login, one authoritative simulation actor
per company, the lockstep WebSocket, and the Postgres job queue that feeds
browser and Claude workers. Postgres is the only infrastructure.

## Run

```bash
docker compose up -d postgres          # or: eval "$(crates/server/scripts/test-pg.sh start)"
cp .env.example .env && set -a && . ./.env && set +a
cargo run -p server --bin simpress-server
```

Migrations (`crates/server/migrations`) run at startup. Configuration comes
from the environment; see `.env.example` for every variable.

## Modules

| Module | What it does |
|---|---|
| `config` | Environment config. GitHub OAuth endpoints are overridable (tests point them at wiremock). |
| `db` | Users, sessions, companies. Runtime-checked `sqlx::query*` calls, so building needs no database. |
| `auth` | GitHub OAuth web flow (`state` cookie), session rows keyed by sha256(token), and the `CurrentUser` extractor. |
| `sim` | The `Simulation` trait (step / hash / apply / snapshot / restore). It is implemented for `sim_core::World`, where `apply` is a loud stub for now. `LedgerSim` is the deterministic test double. |
| `store` | The command log and snapshots: `PgStore` in production, `MemoryStore` for paused-time actor tests. |
| `actor` | Company actor (fixed 100 ms steps, catch-up budget, command acceptance in the same transaction as the log insert, periodic hashes and snapshots, idle unload) and the `Registry` that loads actors on demand. |
| `wire` | The postcard frames on `/ws` (`ServerFrame`, `ClientFrame`). |
| `ws` | The `/ws` connection: lockstep stream, desync handling and resnapshot, and the browser job-worker protocol. |
| `jobs` | `JobQueue` (SKIP LOCKED claims, leases, backoff, max attempts, idempotency keys), `JobNotifier` (LISTEN/NOTIFY), the reaper, the `ClaudeExecutor` pool, and `ArtifactValidator`. |
| `plan` | Publishing-plan text store (publishing-plan.md §6–7): titles, briefs, todo text, workstream/goal titles and the append-only thread. CEO REST, `PlanService::complete_job_with_ops` for agent plan ops, the `PlanOpValidator` seam and the `PlanHub` that streams `PlanPost` frames. |
| `tracker` | First-party analytics (ADR-0032): projects and tracker keys, the `/t/e` collector, daily salts, the hourly rollup, retention, nightly signals behind the `AnalyticsSignalSink` seam, and `/api/analytics`. |
| `app` | `AppState`, routes, background tasks and graceful shutdown. |

## Endpoints

| Route | Notes |
|---|---|
| `GET /healthz` | `{"status":"ok"}` or 503 when the database is unreachable. |
| `GET /auth/github/login` | Sets the `simpress_oauth_state` cookie and redirects to GitHub. |
| `GET /auth/github/callback` | Verifies the state, exchanges the code, upserts the user and sets the `simpress_session` cookie (HttpOnly, SameSite=Lax, and Secure when `SIMPRESS_PUBLIC_URL` is https). |
| `POST /auth/logout` | Deletes the session and clears the cookie. |
| `GET /api/me` | `{user, company}`. Returns 401 without a session. |
| `GET /api/companies` | The caller's companies (0 or 1). |
| `POST /api/companies` | `{name}` creates the caller's company: 201, or 409 if they already own one. |
| `GET /ws` | Cookie-authenticated WebSocket. 404 until the player has a company. |
| `GET /api/plan` | The company's plan text (§7 PlanStore): `{items:{id:{title,brief}}, todos:{id:text}, workstreams:{id:{title,description}}, goals:{id:{title}}, posts:{item:[post]}}`, with the newest 50 posts per item. |
| `GET /api/plan/items/:id/posts?after=post-N&limit=` | Thread posts with id greater than `after`, oldest first (max 500). |
| `POST /api/plan/items/:id/posts` | CEO post `{type: comment\|decision, text, to?: staff-N, payload?: {}}`: 201 with the post, or 400. |
| `PUT /api/plan/items/:id` | `{title?, brief?}` (CEO). |
| `POST /api/plan/todos` | `{itemId, todoId?, text}` adds todo text and appends a `todo-add` post. Returns 201, or 409 for a duplicate id. |
| `PUT /api/plan/workstreams/:id`, `PUT /api/plan/goals/:id` | Workstream `{title?, description?}` and goal `{title}` text. |
| `GET/POST /api/projects` | The company's projects; `POST {simProjectId, slug, name, domain?, repo?}` mints a public `trackerKey`. Each project comes with its tracker `snippet`. |
| `GET /api/analytics?project=&days=` | Performance panel data for a project (uuid, slug or sim id), last `days` (1–90, default 28). Returns zero-filled `days[{day, sessions, visitors, pageviews, engagedSessions, engagementRate}]`, `totals`, `topPages`, `languages` and `sources`. |
| `GET /t/s.js` | The tracker script (embedded `assets/tracker.min.js`). |
| `POST /t/e` | Tracker collector. No auth; text/plain JSON of at most 2 KB. Returns 204 when stored or silently dropped (bot, `DNT`, `Sec-GPC`, load shedding), 400 for a malformed event, 403 when Origin/Referer is not the project's domain, 404 for an unknown key, 413 when too large, 429 when rate-limited. `OPTIONS` answers preflights for registered domains. |
| `/*` | Static game client from `SIMPRESS_STATIC_DIR` (default `apps/game/dist`), with SPA fallback to `index.html`. |

The OAuth `redirect_uri` is `${SIMPRESS_PUBLIC_URL}/auth/github/callback`. In
development the Vite dev server must proxy `/auth`, `/api` and `/ws` to the
server.

## WebSocket frames (postcard, binary)

Server to client:
- `Hello{proto_version, server_version, company_id, step, next_seq, snapshot}`
- `Commands{from_step, to_step, entries}`
- `Hash{step, h}`, sent every `SIMPRESS_HASH_EVERY_STEPS` (600)
- `Resnapshot{step, next_seq, snapshot}`
- `Ack{client_seq, step, seq}` and `Reject{client_seq, reason}`
- `JobOffer`, `JobLease{job_id, until_ms}`, `JobRevoked`, `JobAccepted`, `JobRejected`
- `Error`
- `PlanPost{item_id, post_json}`, sent to every socket of the company for each appended thread post. Clients fetch `GET /api/plan` first, then apply the stream.

Client to server:
- `Cmd{client_seq, payload}`
- `HashReport{step, h}`
- `RequestResnapshot`
- `WorkerHello{tier}`
- `JobClaim{job_id}`, `JobProgress{job_id, delta}`, `JobResult{job_id, artifact_json}`, `JobFailed{job_id, error}`

Lockstep rules (also documented in `src/wire.rs`):
- A snapshot at `step` already contains that step's commands with `seq < next_seq`.
- Before stepping out of step `t`, apply every entry with `step == t` in `seq` order.
- `Hash` is taken right after stepping into `step`, before that step's commands are applied.
- When a `HashReport` does not match, the server sends a `Resnapshot`. A client that falls behind the broadcast buffer, or whose company actor restarted, also gets a `Resnapshot`.

## Tests

The integration tests need a real Postgres: `#[sqlx::test]` creates and drops
a database per test, using `DATABASE_URL` as the admin connection.

```bash
# Throwaway local cluster (uses /usr/lib/postgresql/*/bin; runs as the
# non-root `postgres` user when invoked as root; port 55432):
eval "$(crates/server/scripts/test-pg.sh start)"

cargo test -p server -p testkit
cargo clippy -p server -p testkit --all-targets --no-deps -- -D warnings

crates/server/scripts/test-pg.sh stop
```

Alternatively, run `docker compose up -d postgres` and use
`DATABASE_URL=postgres://simpress:simpress@localhost:5432/simpress`. That role
needs `CREATEDB`, which the compose superuser has.

| Suite | Covers |
|---|---|
| unit (`src/**`) | Actors under `tokio::time::pause` (10 Hz stepping, bounded catch-up, ack/reject, lockstep replica vs. the hash stream, restart and identical hash, storage failure, idle unload), wire round-trips, backoff, artifact checks, and the sim adapters. |
| `tests/http.rs` | Migrations and constraints, healthz, the OAuth flow against a wiremock GitHub (state/code errors, cookie attributes, hashed sessions, logout, expiry), one company per user, and static/SPA serving. |
| `tests/actor_pg.rs` | Command-log ordering and persistence, crash rebuild and clean restart with identical hashes, wall-clock fast-forward, and the registry. |
| `tests/ws.rs` | Hello, command ack/reject, periodic hash checks against a client replica, desync leading to resnapshot, reconnect snapshot, resync after an actor restart, multiple tabs, and garbage frames. |
| `tests/jobs.rs` | Priority claims, concurrent claims that never double-claim, tier and company filters, idempotency, lease expiry leading to requeue with fencing, backoff leading to a dead job, NOTIFY wakeups, the Claude pool, and the loud stub. |
| `tests/plan.rs` | Plan tables; append-only posts (UPDATE, DELETE and TRUNCATE raise, while company deletion still cascades); REST auth and company scoping; CEO post validation and `after` paging; agent ops with a fake RBAC validator (accepted/rejected split, todo text); ops committed with the job result in one transaction (a lost lease writes nothing); `PlanPost` to both sockets of a company and none of another's; a browser job whose `planOps` are streamed. |
| `tests/tracker.rs` | Projects and keys; `/t/s.js`; collector results (stored, 403 wrong or missing origin, 404 key, 413, 400, bot/DNT/GPC dropped, preflight); per-IP 429; salt rotation (stable within a day, different after rotation, shared across processes, old salt deleted); no IP/UA columns in `information_schema`; rollup correctness and idempotence on a fixture; retention; nightly signal determinism and sink marking; `/api/analytics` shape and scoping; hashed sessions. |
| `tests/browser_jobs.rs` | `FakeBrowserWorker`: offer, claim, lease, progress, result; a single winner per claim; invalid, oversized and non-JSON artifacts rejected and re-queued; lease expiry handing the job to another tab; progress extending the lease; disconnect leading to requeue and a drain on reconnect; device tiers. |

Shared helpers live in `crates/testkit`: the test DB URL, `FakeGitHub`
(wiremock), `WsClient` (tokio-tungstenite + postcard), and world builders.

## Tracker script drift check

The collector serves `assets/tracker.min.js`, a committed build of
`packages/tracker`. After changing the tracker source, run
`pnpm --filter tracker sync` and commit both. CI should run
`pnpm --filter tracker check-drift`. In addition, the unit test
`tracker::tests::assets_match_built_tracker` fails whenever
`packages/tracker/dist` exists and differs from the embedded copy.

## Known stubs (they fail loudly)

- `Simulation::apply` for `sim_core::World` returns `Err("not implemented")` and logs an error, so every player command is rejected until sim-core gains commands. The tests use `LedgerSim` instead.
- `UnconfiguredClaude` fails every Claude job. Jobs retry with backoff and then go `dead`.
- `PermissiveValidator` accepts any artifact that passes the structural checks (size, valid JSON, object) and logs a warning every time. Per-kind schema and closed-world validation is still to come.
- After a browser job is accepted, no `JobCompleted{digest}` command is injected into the sim yet; the server logs a warning instead.
- `JobProgress` deltas extend the lease but are not yet fanned out to other tabs.
- `PermissivePlanOpValidator` runs only the structural plan-op checks (types, text, `to`, review verdict/score, todo ids) and logs a warning for every op. RBAC comes from the agents crate (`validate_plan_ops`) through `AppState::with_plan_validator`.
- `PendingSignalSink` leaves nightly analytics signals as `pending` rows in `analytics_signals`. Once sim-core and protocol carry `Cmd::AnalyticsSignals`, the company actor implements `AnalyticsSignalSink`, and `AppState::with_signal_sink` swaps it in. Pending rows are re-offered every hour.
- No `PlanOpsApplied{item, ops_digest}` sim command is injected yet. `PlanOpsOutcome::ops_digest` is computed and stored in the job result.
