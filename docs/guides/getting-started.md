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

At M0 the scene is driven by `demoRenderState`. Server-backed play arrives in M2.

## With the server (M2 onwards)

The central server is one binary with an embedded SQLite database (ADR-0039): no Docker, no
database server.

```sh
cp .env.example .env        # dev defaults: fake GitHub, dev login, SQLite in ./data
set -a && . ./.env && set +a
cargo run -p server --bin simpress-server   # creates ./data/simpress.db, migrates, listens on :8080
pnpm dev                    # the client must reach /auth, /api, /ws and /web on :8080 (Vite proxy)
```

Dev mode signs in without GitHub (`POST /auth/dev/login {"login":"ada"}` with
`SIMPRESS_DEV_AUTH=1`) and writes content PRs to an in-memory FakeGitHub
(`SIMPRESS_GITHUB=fake`), where merges land a simulated `DeployLanded` event.

Environment variables (see `.env.example` for all of them):

| Variable | Used by |
|---|---|
| `DATABASE_URL` | server (sqlx/SQLite), default `sqlite://data/simpress.db?mode=rwc` |
| `SIMPRESS_DATA_DIR` | sync blobs (command-log segments, snapshots), default `./data` |
| `SIMPRESS_DEV_AUTH`, `SIMPRESS_GITHUB`, `SIMPRESS_SIMULATE_DEPLOY` | dev login, fake GitHub, simulated deploys |
| `GITHUB_TOKEN` or `GITHUB_APP_ID` + `GITHUB_APP_PRIVATE_KEY_PATH`, `GITHUB_WEBHOOK_SECRET` | content gateway, deploy webhooks |
| `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET` | GitHub sign-in |
| `GITHUB_SITES_ORG` | owner of default site repos |

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
