# swarm.press

**An isometric publishing-house management game in which the staff are AI agents and the output
is a real website.**

You are the CEO of a small publishing house, shown as a detailed digital dollhouse rendered with
Babylon.js on WebGPU. You hire writers and editors, build rooms, set policy and answer your
Inbox. Your staff hold their 09:00 standup in speech bubbles, draft articles, argue in review,
and publish to **your own live site**. The design department even redesigns that site's theme,
through pull requests you approve.

The first company is real: [cinqueterre.travel](https://cinqueterre.travel).

swarm.press is the greenfield rebuild of swarm.press. The legacy TypeScript platform is preserved
at the git tag `legacy-ts`.

## How it works

```
Browser (authoritative for your company, local-first)
  Babylon.js scene ◄─ render state ◄─ deterministic Rust sim (wasm)
  Preact overlay (Inbox, Plan, Staff, Finance, Performance)
  orchestrator (Rust → wasm) runs staff jobs with in-browser LLMs (WebGPU)
  Turso wasm on OPFS stores the company · extensions run in a QuickJS-wasm sandbox
     │ HTTPS/WS
Central Rust service (one binary, SQLite)
  auth · company lease · content gateway → GitHub · events + webhooks · sync · web fetch · tracker
Site repo: @swarm-press/site-kit + agent-authored theme → GitHub Actions → GitHub Pages
```

- **Deterministic sim** in Rust: the same hash natively, in the browser and under Bun.
- **Local-first:** the browser runs your company. It fast-forwards when you return, and syncs
  its command log centrally.
- **Hybrid inference:** in-browser LLMs run the staff, and Claude handles research, design and
  escalations, shown in game as an external Agency paid in Credits.
- **Repo-canonical content:** JSON block pages with `LocalizedString`, one PR per piece, merged
  by the orchestrator, never by an LLM.
- **Extensible:** JS bundles (content packs, skills, sim rules, panels, real-world feeds,
  publish targets) run in a sandbox, with a Bun-powered `swarmpress` CLI to build and test them.

## Quick start

```sh
pnpm install
pnpm dev                     # builds the wasm sim (cargo xtask wasm) and serves the client
cargo nextest run --workspace --profile ci
pnpm test
```

See [Getting started](docs/guides/getting-started.md) for prerequisites (Rust, wasm-bindgen
0.2.100, Node 20+, pnpm, Bun) and the central server (one binary, SQLite, dev login and fake
GitHub out of the box).

## Status

Working toward the local-first MVP ([docs/mvp.md](docs/mvp.md)). One article goes end to end
in the browser:

> standup → draft PR → review → revision → merge → deploy

Built so far:
- the Babylon client;
- the sim with its org layer;
- the wasm orchestrator;
- the SQLite central service;
- the extension SDK, sandbox and runner.

Health is tracked per feature with [Cockpit](https://github.com/drietsch/cockpit), derived from
tests and never asserted:

```sh
cockpit scan && cockpit status
```

## Documentation

- [Architecture overview](docs/architecture/overview.md)
- [Game design](docs/game-design/overview.md)
- [Architecture Decision Records](docs/adr/README.md) (ADR-0001 to ADR-0043)
- [Extending swarm.press (SDK)](docs/guides/extending.md)
- [Testing and evidence](docs/guides/testing.md)
- [cinqueterre.travel cutover runbook](docs/runbooks/cinqueterre-cutover.md)

## Repository layout

```
crates/      sim-core · client-wasm · orchestrator · agents · claude · server · content-schema ·
             knowledge · github · protocol · testkit
apps/game/   Vite + TypeScript + Babylon.js + Preact
packages/    sdk · sandbox · runner · content-schema · tracker · site-kit ·
             site-builder/src/themes/cinque-terre (FROZEN until cutover)
examples/    extensions/* (SDK examples)
docs/        architecture · game-design · guides · runbooks · adr · features
```

## License

MIT. See [LICENSE.md](LICENSE.md). 3D assets come from CC0 kits only.
