# swarmpress-server

The central swarm.press server in the local-first architecture
([ADR-0038](../../docs/adr/0038-local-first-the-browser-is-authoritative-for-a-company.md)):
the company itself (sim, plan, orchestrator, local LLM staff) runs in the
player's browser, and this server keeps only what must be shared, secret or
trusted: accounts, the company row and its device lease, the content gateway
to GitHub, the offline event inbox, sync blobs, the web fetch proxy and the
analytics tracker. One binary, one process, embedded SQLite
([ADR-0039](../../docs/adr/0039-sqlite-is-the-central-database.md)).

## Run

```bash
cp .env.example .env && set -a && . ./.env && set +a
cargo run -p server --bin swarmpress-server
```

`DATABASE_URL` defaults to `sqlite://data/swarmpress.db?mode=rwc`; the file and
its directory are created on first start and `migrations/` run at startup.
Sync blobs go under `SWARMPRESS_DATA_DIR` (default `./data`). For local
development set `SWARMPRESS_DEV_AUTH=1` and `SWARMPRESS_GITHUB=fake` (both are in
`.env.example`).

## Environment

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | `sqlite://data/swarmpress.db?mode=rwc` | `sqlite::memory:` works for throwaway runs |
| `SWARMPRESS_DATA_DIR` | `data` | sync blobs (`sync/{company}/log/*.bin`, `snapshot.bin`) |
| `SWARMPRESS_BIND` | `127.0.0.1:8080` | |
| `SWARMPRESS_PUBLIC_URL` | `http://localhost:5173` | OAuth redirect base; `https` makes cookies `Secure` |
| `SWARMPRESS_STATIC_DIR` | `apps/game/dist` | built client served at `/` (empty = off) |
| `SWARMPRESS_SESSION_TTL_SECS` | 2592000 | |
| `SWARMPRESS_DEV_AUTH` | off | `1` enables `POST /auth/dev/login`. Never in production |
| `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET` | | GitHub sign-in (`GITHUB_OAUTH_AUTHORIZE_URL`, `GITHUB_OAUTH_TOKEN_URL`, `GITHUB_API_URL` override endpoints) |
| `SWARMPRESS_GITHUB` | real | `fake` = in-memory `github::FakeGitHub` (repos created on demand; state is lost on restart) |
| `GITHUB_TOKEN` | | real gateway with a static token |
| `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY_PATH` | | real gateway as the GitHub App (installation per repo). Without a token or App, gateway calls answer 503 |
| `GITHUB_SITES_ORG` | `swarmpress-sites` | owner of the default site repo `{org}/{login}-site` |
| `GITHUB_WEBHOOK_SECRET` | | `POST /webhooks/github` (503 when unset) |
| `SWARMPRESS_SIMULATE_DEPLOY` | on with `fake`, else off | emit `DeployLanded` right after a gateway merge |
| `SWARMPRESS_LEASE_SECS` | 90 | company lease length |
| `SWARMPRESS_SYNC_MAX_BYTES` | 67108864 | largest sync upload |
| `SWARMPRESS_WEB_FETCH_RATE_PER_MIN`, `SWARMPRESS_WEB_FETCH_BURST` | 30, 10 | per-user token bucket for `/web/fetch` |
| `SWARMPRESS_TRACKER_*` | | see `.env.example` |
| `RUST_LOG` | `info,sqlx=warn` | |

## Routes

| Route | Notes |
|---|---|
| `GET /healthz` | `{"status":"ok"}`, or 503 when the database is unavailable |
| `GET /auth/github/login`, `GET /auth/github/callback` | GitHub OAuth web flow (state cookie, code exchange, `/user`), sets `swarmpress_session` (HttpOnly, SameSite=Lax, Secure on https) |
| `POST /auth/dev/login` | `{login}` (1–39 of `[A-Za-z0-9_-]`) creates or fetches the dev user and signs in; 404 unless `SWARMPRESS_DEV_AUTH=1` |
| `POST /auth/logout` | deletes the session, clears the cookie |
| `GET /api/me` | `{user, company}`; 401 without a session |
| `POST /api/companies` | `{name, site_repo?, base_branch?}` → 201 company; 409 when the caller already owns one |
| `GET /api/companies/me` | the caller's company, or 404 |
| `POST /api/companies/{id}/lease` | `{device_id, mode?, kind?}` → `{epoch, lease_id, token, holder, holder_kind, ttl_ms, renewed, handover_requested, handover_by, head}` (ADR-0045). `mode`: `acquire` (default; a free, expired, released or own lease, epoch + 1), `renew` (with `x-swarmpress-lease`; epoch unchanged, works past expiry if nobody took the lease), `request` (as `acquire`, and a 409 records a handover request and publishes `HandoverRequested`), `force` (takeover, epoch + 1, publishes `LeaseRevoked`). Another executor's unexpired lease answers 409 `{error, epoch, holder, holder_kind, ttl_ms, handover_requested}`. `kind`: `browser` (default) or `self`. The epoch is never reset |
| `DELETE /api/companies/{id}/lease` | with `x-swarmpress-lease`: release (204), 409 if not held. The epoch stays |
| `x-swarmpress-lease` | the fencing token `<epoch>.<lease_id>` (the lease reply's `token`). A fenced route answers 428 without it and 409 when the epoch or the lease id is not the company's current, unexpired one. A lease grant and every fenced write hold a per-company mutex, so a takeover waits for an in-flight write to be recorded |
| `POST /api/gateway/draft` | lease required. `{content_id, path, page, message, work_item?}` → `{number, branch, head_sha, created_pr, committed}` |
| `POST /api/gateway/merge` | lease required. `{number, head_sha}` → `{merged_sha}`; only PRs this company opened through the gateway; 409 if the head moved |
| `GET /api/events?after=&limit=` | `{events: [{seq, company_id, kind, payload, created_at}], last_seq}` (oldest first, max 500) |
| `GET /ws/events?after=` | WebSocket (cookie auth): backlog after `after`, then live events, one JSON text frame each |
| `POST /webhooks/github` | HMAC-verified (`X-Hub-Signature-256`), deduped by `X-GitHub-Delivery`. `deployment_status` success → `DeployLanded`, failure/error → `DeployFailed`, in every company bound to the repo |
| `PUT /api/sync/{company}/log/{segment}` | raw bytes; 201 stored, 200 identical, 409 different bytes (immutable) |
| `GET /api/sync/{company}/log/{segment}` | the bytes (`x-swarmpress-sha256`) |
| `GET /api/sync/{company}/log` | `{segments: [{segment, sha256, size, created_at}]}` |
| `PUT /api/sync/{company}/snapshot` | raw bytes, `x-swarmpress-step` required; replaces the latest snapshot |
| `GET /api/sync/{company}/snapshot` | the bytes with `x-swarmpress-step` and `x-swarmpress-sha256`; 404 before the first |
| `GET /web/fetch?url=` | `{url, status, content_type, text}`; see below |
| `POST /web/firecrawl/{*rest}` | 501 `{"error":"firecrawl requires credits (wave 3)"}` |
| `GET/POST /api/projects` | the company's publications; `POST {simProjectId, slug, name, domain?, repo?}` mints a public `trackerKey` |
| `GET /api/analytics?project=&days=` | Performance panel data (ADR-0032) |
| `GET /t/s.js`, `POST /t/e` | tracker script and collector (no auth; see `src/tracker.rs`) |
| `/*` | static game client with SPA fallback |

Sync routes are owner-only: 401 without a session, 403 for another player's
company, 404 for an unknown company.

### Content gateway rules

The browser's orchestrator opens and merges content PRs through the server,
which holds the GitHub credentials. Drafts are written as a content agent
through `github::GuardedRepo` + `PathPolicy`: only `content/**`, only on
`drafts/content-{content_id}`, never platform files (`package.json`,
`.github/**`, ...); paths with `..`, a leading `/`, empty segments,
backslashes or NUL are refused (400), paths outside `content/` are refused
(403), and the page must be a JSON object in a `.json` file of at most
256 KiB (413). Merges are squash merges at the exact reviewed head.

### Web fetch rules (ADR-0040)

`http`/`https` only, no URL credentials; the host is resolved and every
address must be public (loopback, private, link-local, CGNAT, multicast,
documentation, reserved and their IPv6 forms, incl. v4-mapped, NAT64 and
6to4, are refused with 403). The connection is pinned to the checked address,
redirects are followed by hand (max 5) and re-checked, no proxy, 10 s timeout
(504), HTML/text/JSON only (415), 2 MiB cap (413). HTML is reduced to text.
Fetched text is untrusted data.

## Storage

`src/db/` holds every SQL statement (repository functions; handlers never
write SQL), in the plain SQLite subset Turso also accepts (ADR-0041): no
extensions, virtual tables, FTS, generated columns or triggers. Conventions:
TEXT uuid ids, INTEGER unix-ms instants, TEXT `YYYY-MM-DD` days, JSON as TEXT
checked by `json_valid`.

Concurrency: a writer pool with exactly one connection (the write queue) and a
read-only reader pool, WAL, `foreign_keys=ON`, `synchronous=NORMAL`, 5 s busy
timeout. `Db::begin_immediate` opens a `BEGIN IMMEDIATE` transaction for
read-check-write sequences (the lease takeover today, the credits ledger
later).

## Modules

| Module | What it does |
|---|---|
| `config` | Environment config. |
| `db` | `Db` (writer/reader pools, migrations, `begin_immediate`) and the repositories: `accounts` (users, sessions, companies, leases), `events`, `gateway` (gateway PRs, webhook deliveries), `sync`, `tracker`. |
| `auth` | GitHub OAuth, dev login, session rows keyed by sha256(token), the `CurrentUser` extractor. |
| `companies` | Company create/read, lease acquire/renew/release, `require_lease`. |
| `gateway` | `RepoBackend` (fake, token, App, unconfigured), draft and merge handlers, `PathPolicy` checks. |
| `events` | `EventHub` (tokio broadcast), `publish`, `/api/events`, `/ws/events`. |
| `webhooks` | GitHub webhook receiver (`github::webhooks::WebhookHandler` + SQLite dedupe). |
| `sync` | Sync blob handlers (temp file + rename, index rows). |
| `web` | Fetch proxy, SSRF guard, HTML → text, Firecrawl stub. |
| `tracker` | First-party analytics (ADR-0032): collector, salts, rollup (computed in Rust), retention, nightly signals, `/api/projects`, `/api/analytics`. |
| `app` | `AppState`, routes, background tasks. |

## Tests

No external services: every integration test gets a fresh temp-file SQLite
database (WAL, both pools) and every unit test an in-memory one.

```bash
export CARGO_TARGET_DIR=...   # optional
cargo nextest run -p server
cargo clippy -p server -p testkit --all-targets -- -D warnings
```

| Suite | Covers |
|---|---|
| unit (`src/**`) | DB pools (WAL, FKs, read-only readers, `BEGIN IMMEDIATE`), accounts and leases, dev-login validation, gateway path policy and repo parsing, SSRF IP/URL checks (incl. resolving `localhost`), HTML → text, tracker helpers. |
| `tests/http.rs` | Schema, healthz, OAuth flow (state/code errors, cookie attributes, hashed sessions, logout, expiry via the manual clock), dev login on and off, one company per user, repo binding, static/SPA serving. |
| `tests/lease.rs` | Acquire, renew, conflict (409 with holder), force takeover, expiry, configurable TTL, release, ownership. |
| `tests/gateway.rs` | Draft + revision + merge against FakeGitHub, stale-head 409, idempotent merge, one simulated `DeployLanded`, PathPolicy rejections (nothing written), lease required (428/409, takeover, expiry), merging only own PRs, `deployment_status` webhook (bad HMAC, dedupe, success, failure, other repos). |
| `tests/events.rs` | Polling with `after`/`limit`, per-company scoping, WebSocket backlog + live push. |
| `tests/sync.rs` | Segment immutability (201/200/409), list, bytes on disk, snapshot with step, owner-only access. |
| `tests/web.rs` | SSRF refusals and bad URLs, per-user 429, Firecrawl 501, HTML reduction, JSON, redirects, 415 and 413 against a local wiremock. |
| `tests/tracker.rs` | Projects and keys, `/t/s.js`, collector checks, per-IP 429, salt rotation, no IP/UA columns, rollup, retention, nightly signals, `/api/analytics`, hashed sessions. |

## Tracker script drift check

The collector serves `assets/tracker.min.js`, a committed build of
`packages/tracker`. After changing the tracker source, run
`pnpm --filter tracker sync` and commit both. The unit test
`tracker::tests::assets_match_built_tracker` fails whenever
`packages/tracker/dist` exists and differs from the embedded copy.

## Known stubs and limits

- `POST /web/firecrawl/*` answers 501 until credits ship (wave 3).
- The fetch proxy does not read robots.txt or cache yet (ADR-0040 asks for both).
- `SWARMPRESS_GITHUB=fake` keeps repos in memory only.
- `PendingSignalSink` leaves nightly analytics signals `pending`; delivering them to the
  browser (as inbox events) is still to come.
