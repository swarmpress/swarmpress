# Getting started

## Prerequisites

| Tool | Version | Why |
|---|---|---|
| Rust | stable via `rust-toolchain.toml` (with `rustfmt`, `clippy`, target `wasm32-unknown-unknown`) | sim, server, wasm |
| wasm-bindgen CLI | **0.2.100** exactly | `cargo install wasm-bindgen-cli --version 0.2.100` |
| Node | ≥ 20 (22 recommended) | client, content schema |
| pnpm | ≥ 8 | workspaces |
| cargo-nextest | latest | test runner, JUnit for Cockpit |
| Cockpit | from `drietsch/cockpit` (Rust 1.98.0) | feature health ([testing.md](testing.md)) |
| Blender | 4.x (only for asset work) | [asset-pipeline.md](asset-pipeline.md) |

## First run: the offline dollhouse

```sh
git clone https://github.com/swarmpress/swarmpress && cd swarmpress
pnpm install
pnpm dev                    # runs `cargo xtask wasm`, then Vite on http://localhost:5173
```

`pnpm dev` builds `crates/client-wasm` for `wasm32-unknown-unknown`, runs `wasm-bindgen` into
`crates/client-wasm/pkg`, and serves `apps/game`.

URL parameters:
- `?renderer=webgl` forces the WebGL2 fallback.
- Quality is auto-detected and can be overridden in the HUD.
- `?central=1` turns on the MVP loop against the server: see
  [One article, from standup to published](#one-article-from-standup-to-published-the-mvp-loop).

At M0 the scene is driven by `demoRenderState`. Server-backed play arrives in M2.

## With the server (M2 onwards)

The central server is one binary with an embedded SQLite database (ADR-0039): no Docker, no
database server.

```sh
cp .env.example .env        # dev defaults: fake GitHub, dev login, SQLite in ./data
set -a && . ./.env && set +a
cargo run -p server --bin swarmpress-server   # creates ./data/swarmpress.db, migrates, listens on :8080
pnpm dev                    # the client must reach /auth, /api, /ws and /web on :8080 (Vite proxy)
```

Dev mode signs in without GitHub (`POST /auth/dev/login {"login":"ada"}` with
`SWARMPRESS_DEV_AUTH=1`) and writes content PRs to an in-memory FakeGitHub
(`SWARMPRESS_GITHUB=fake`), where merges land a simulated `DeployLanded` event.

Environment variables (see `.env.example` for all of them):

| Variable | Used by |
|---|---|
| `DATABASE_URL` | server (sqlx/SQLite), default `sqlite://data/swarmpress.db?mode=rwc` |
| `SWARMPRESS_DATA_DIR` | sync blobs (command-log segments, snapshots), default `./data` |
| `SWARMPRESS_DEV_AUTH`, `SWARMPRESS_GITHUB`, `SWARMPRESS_SIMULATE_DEPLOY` | dev login, fake GitHub, simulated deploys |
| `GITHUB_TOKEN` or `GITHUB_APP_ID` + `GITHUB_APP_PRIVATE_KEY_PATH`, `GITHUB_WEBHOOK_SECRET` | content gateway, deploy webhooks |
| `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET` | GitHub sign-in |
| `GITHUB_SITES_ORG` | owner of default site repos |

## One article, from standup to published (the MVP loop)

The game page runs the MVP loop ([mvp.md](../mvp.md)) only when asked to with `?central=1`.
Without it the page is the offline dollhouse above and never talks to the server.

1. Start the server with the dev defaults from `.env.example` (`SWARMPRESS_DEV_AUTH=1`,
   `SWARMPRESS_GITHUB=fake`, listening on `127.0.0.1:8080`), as shown above.
2. In a second terminal run `pnpm dev`. It builds both wasm modules (`crates/client-wasm` and
   `crates/orchestrator-wasm`) and starts Vite on port 5173. Vite proxies `/auth`, `/api`, `/ws`
   and `/web` to `http://127.0.0.1:8080`; set `SWARMPRESS_CENTRAL_URL` if the server listens
   elsewhere.
3. Open <http://localhost:5173/?central=1&llm=fake&ff=09:00> in Chromium.

What the parameters do (`apps/game/src/session/session.ts`):

| Parameter | Effect |
|---|---|
| `central=1` | Dev login, company (created on first login), lease, company store, restore, orchestration loop, sync. |
| `llm=fake` | The scripted model (`apps/game/src/llm/mvp-script.ts`): one standup, a draft, a review scoring 6, a revision, a review scoring 8. Required today: the session has no real local model yet, and without this every job fails with an error that says so. |
| `ff=HH:MM` | Fast-forward on boot to that time of the current game day. The day starts at 07:00 and the standup is at 09:00, so `ff=09:00` skips the wait. It does nothing if that time has already passed. |
| `login=NAME` | Dev login name, default `ceo`. A new name gives a new company and a new store. |
| `store=turso\|sqlite\|memory` | Store engine, default auto (Turso wasm on OPFS, else sqlite-wasm). |
| `speed=N` | Sim steps per 100 ms, default 1. |

What should happen, in order:
1. The standup runs and produces one brief. The sim creates a work item.
2. The draft opens a pull request through `POST /api/gateway/draft` (on the fake GitHub).
3. The first review scores 6, so the item goes back for a revision. The second review scores 8.
4. Publish merges the pull request through `POST /api/gateway/merge`. The fake GitHub then emits
   a simulated `DeployLanded` event (`SWARMPRESS_SIMULATE_DEPLOY`, on by default with the fake),
   and the item becomes published.

Where to look:
- The **Plan** panel in the overlay shows the work item and its thread.
- The browser console prints `[session] …` lines (restore source, fast-forward, lease).
- `__swarmpress.session` in the console is the same hook the e2e test uses: `.info()`, `.state()`
  (jobs, errors, world hash), `.items()` (work item → status), `.gateway()` (draft and merge
  calls), `.events()`, `await .planText()`, `await .checkpoint()`.

Reload and a second device:
- A reload restores the company from the browser store: the newest world snapshot, then the
  commands logged after it. `&restore=replay` replays the whole log from the seed instead.
- The log is sealed to central sync once per game day and on `pagehide`, or on demand with
  `await __swarmpress.session.checkpoint()`. A fresh browser profile with the same `login` then
  restores from central sync. It takes the lease over from the first one.

Limits of the fake modes:
- The script covers exactly one article. Any model call after it fails loudly
  (`?llm=fake: the MVP script has no reply for call #…`).
- The fake GitHub lives in the server's memory. Restarting the server loses its repos and pull
  requests, while `./data` and the browser store keep the company. To start clean, stop the
  server, delete `./data`, and use a new `login=` (or clear the site data in the browser).

The automated version of this run is `apps/game/e2e/mvp.spec.ts`.

## Everyday commands

```sh
cargo fmt --all && cargo clippy --workspace --all-targets -- -D warnings
cargo nextest run --workspace --profile ci        # Rust tests → target/nextest/ci/junit.xml
pnpm test                                         # content-schema scripts + apps/game vitest
pnpm test:e2e                                     # Playwright (needs `pnpm build` first)
pnpm schema:export && pnpm schema:check           # Zod → page.schema.json, drift check
cargo xtask wasm --release                        # release wasm (opt-level z)
cockpit scan && cockpit status                    # feature health
cockpit validate --strict                         # the gate CI runs
```

## Where to start reading

1. [Architecture overview](../architecture/overview.md)
2. [Simulation](../architecture/sim.md) and the [render-state contract](../architecture/render-state.md)
3. The [ADR index](../adr/README.md)
4. [Testing and evidence](testing.md), before you open a PR
