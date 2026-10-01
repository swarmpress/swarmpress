# SimPress

**An isometric publishing-house management game in which the staff are AI agents and the output
is a real website.**

You are the CEO of a small publishing house, shown as a detailed digital dollhouse rendered with
Babylon.js on WebGPU. You hire writers and editors, build rooms, set policy and answer your
Inbox. Your staff hold their 09:00 standup in speech bubbles, draft articles, argue in review,
and publish to **your own live site**. The design department even redesigns that site's theme,
through pull requests you approve.

The first company is real: [cinqueterre.travel](https://cinqueterre.travel).

SimPress is the greenfield rebuild of swarm.press. The legacy TypeScript platform is preserved
at the git tag `legacy-ts`.

## How it works

```
Browser: Babylon.js scene ◄─ render state ◄─ wasm replica of the Rust sim
         Preact overlay (Inbox, Feed, Staff, Build, HUD) · local LLM worker (WebGPU)
            │  WebSocket (postcard, lockstep, hash checks)
Rust server: company actors (authoritative sim, 10 Hz) · command log + snapshots
             Postgres job queue → agents (local-model staff, Claude "Agency") · QA gate
             GitHub App → one site repo per company (content PRs, theme PRs) ◄ webhooks
Site repo:   @swarm-press/site-kit + agent-authored theme → GitHub Actions → GitHub Pages
```

- **Deterministic sim** in Rust, compiled natively for the server and to wasm for the browser.
- **Server authority with lockstep:** commands, periodic hashes, resnapshot on desync.
- **Hybrid inference:** in-browser LLMs run the staff, and Claude handles research, design and
  escalations, shown in game as an external Agency.
- **Repo-canonical content:** JSON block pages with `LocalizedString`, one PR per piece, merged by
  the orchestrator, never by an LLM.
- **Postgres is the only infrastructure.**

## Quick start

```sh
pnpm install
pnpm dev                     # builds the wasm sim (cargo xtask wasm) and serves the client
cargo nextest run --workspace --profile ci
pnpm test
```

See [Getting started](docs/guides/getting-started.md) for prerequisites (Rust, wasm-bindgen
0.2.100, Node 20+, pnpm) and the server setup.

## Status

Milestone **M0, Foundations**. What exists today:
- the Babylon client: WebGPU/WebGL2 engine, iso camera, dollhouse cutaway, a procedural office
  lit from the sim clock, quality tiers;
- the sim clock and world hash;
- the wire protocol handshake;
- the content schema (Zod plus the Rust validator).

Everything else is specified in [docs/](docs/index.md) and tracked feature by feature with
[Cockpit](https://github.com/drietsch/cockpit):

```sh
cockpit scan && cockpit status      # per-feature health derived from tests, never asserted
```

## Documentation

- [Architecture overview](docs/architecture/overview.md)
- [Game design](docs/game-design/overview.md)
- [Architecture Decision Records](docs/adr/README.md) (ADR-0001 to ADR-0027)
- [Testing and evidence](docs/guides/testing.md)
- [cinqueterre.travel cutover runbook](docs/runbooks/cinqueterre-cutover.md)

## Repository layout

```
crates/      sim-core · protocol · client-wasm · content-schema (→ content-model) · knowledge ·
             claude · agents · github · server · testkit
apps/game/   Vite + TypeScript + Babylon.js + Preact
packages/    content-schema (Zod) · site-kit · site-builder/src/themes/cinque-terre (FROZEN until cutover)
docs/        architecture · game-design · guides · runbooks · adr · features
```

## License

MIT. See [LICENSE.md](LICENSE.md). 3D assets come from CC0 kits only.
