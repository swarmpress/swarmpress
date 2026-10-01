# Getting started

## Prerequisites

| Tool | Version | Why |
|---|---|---|
| Rust | stable via `rust-toolchain.toml` (with `rustfmt`, `clippy`, target `wasm32-unknown-unknown`) | sim, server, wasm |
| wasm-bindgen CLI | **0.2.100** exactly | `cargo install wasm-bindgen-cli --version 0.2.100` |
| Node | ≥ 20 (22 recommended) | client, content schema |
| pnpm | ≥ 8 | workspaces |
| Docker | any | Postgres (the only infrastructure) |
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

```sh
cp .env.example .env        # DATABASE_URL, GITHUB_APP_*, ANTHROPIC_API_KEY, SESSION_SECRET
docker compose up -d        # Postgres only
cargo run -p server         # applies migrations, listens on :3000
pnpm dev                    # client proxies /api and /ws to :3000
```

Environment variables (see `.env.example`):

| Variable | Used by |
|---|---|
| `DATABASE_URL` | server (sqlx) |
| `ANTHROPIC_API_KEY` | `crates/claude` (Agency jobs). Without it, Claude jobs fail loudly with a ticket |
| `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | `crates/github`, auth |
| `PLATFORM_ORG` | the GitHub org where player site repos are created |
| `SESSION_SECRET` | cookie signing |

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
