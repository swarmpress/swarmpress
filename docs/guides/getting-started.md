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
- The renderer is WebGPU only (ADR-0064): without WebGPU the page says so and names the browsers
  that work.
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
| `SWARMPRESS_STATIC_DIR`, `SWARMPRESS_PUBLIC_URL` | the built game the server serves, and the origin players open (the server's own: `http://localhost:8080`) |
| `SWARMPRESS_DEFAULT_SITE_REPO`, `SWARMPRESS_DEFAULT_BASE_BRANCH`, `SWARMPRESS_ALLOWED_SITE_REPOS` | which repository a new company writes to, and the only ones any company may (required with a real GitHub) |
| `GITHUB_TOKEN` or `GITHUB_APP_ID` + `GITHUB_APP_PRIVATE_KEY_PATH`, `GITHUB_WEBHOOK_SECRET` | content gateway, deploy webhooks |
| `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET` | GitHub sign-in |
| `GITHUB_SITES_ORG` | owner of default site repos when no default repository is set |

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
| `llm=fake` | The scripted model (`apps/game/src/llm/mvp-script.ts`): one standup, a draft, a review scoring 6, a revision, a review scoring 8. Ready at once; the e2e suites use it. |
| `llm=luna\|gemma\|bonsai\|chrome\|transformers` | The model backend. Without `llm=` the company's stored choice, else `luna`: GPT-6-Luna, called by the central server (ADR-0067), which needs `OPENAI_API_KEY` in its environment (with credits on the account) and spends at most `LUNA_DAILY_BUDGET_USD` per company and day. `gemma` is the opt-in local model in this browser (ADR-0066; about 4.2 GB the first time; [the qualification runbook](../runbooks/model-qualification.md)). The office opens at once and the clock holds until the model is ready. |
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

## The built game on one origin (no Vite)

The way the owner runs the company (increment G2): `pnpm build` writes the game to
`apps/game/dist`, and the server serves it next to the API on one origin, cross-origin isolated
(COOP `same-origin`, COEP `credentialless`) with a fallback to the page for deep links. Nothing
is proxied, so `/webhooks` and `/t` work too.

```sh
cp .env.example .env              # once; SWARMPRESS_PUBLIC_URL is the server's own http://localhost:8080
scripts/run-local.sh --build      # checks, prints the binding, pnpm build, builds and starts the server
# then open http://localhost:8080/?central=1&llm=fake&ff=09:00
```

`scripts/run-local.sh` (see `--help`) loads `.env` (or `--env FILE`), checks the prerequisites
(cargo, curl; with `--build` pnpm, node, `node_modules` and wasm-bindgen 0.2.100; without it a
built `apps/game/dist`) and the settings the server would refuse, and prints:

- the URL to open;
- whether GitHub is the fake (nothing leaves the machine) or real;
- the repository a new company writes to (`SWARMPRESS_DEFAULT_SITE_REPO`, base branch) and the
  allow-list;
- every company already in the database with its own binding, marked when it is outside the
  allow-list or not the default.

With a real GitHub it asks before it starts (`--yes` skips the question) and refuses the live
site's repository without `--live-site`. `--check` starts the server, checks the page's
isolation headers, the deep-link fallback and the API on the same origin, and stops it again.

The game shows the same binding: on the boot screen from the moment the company is known
("Writes to owner/name · base main"), then in the HUD, linked to the repository. It is read
only. A company keeps the binding it was founded with; `scripts/rebind-company.sh owner/name`
moves it (`PATCH /api/companies/me`, with the company lease, refused while its pull requests are
open), and the game shows the new one after a reload.

## Against a real repository

Token mode (`SWARMPRESS_GITHUB=real`, `GITHUB_TOKEN`, `SWARMPRESS_ALLOWED_SITE_REPOS`) writes
real pull requests. Start from `.env.rehearsal.example` and follow
[the fork rehearsal](../runbooks/fork-rehearsal.md): a fork of the site under your account
first, the live repository only for the first live article (Milestone C). The token's
permissions and the settings the server refuses in real mode are in `crates/server/README.md`
("Token mode").

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
