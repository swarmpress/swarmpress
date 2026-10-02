# ADR-0043 — Extension points: context providers, publish targets, challenges, staff-authored extensions, prop packs

**Status:** Accepted (amends ADR-0042)
**Date:** 2026-10-01

## Context

ADR-0042 defined extensions as JS bundles in a QuickJS-wasm sandbox. It named four kinds:
content pack, sim rule, skill and panel. A design pass over what the SDK should enable
(`docs/game-design/sdk-ideas.md`) found five things that must shape the interfaces now. If they
were bolted on later, they would force breaking changes:
- the real world entering the game;
- publishing to targets other than GitHub;
- provable challenge scores;
- the company writing its own tools;
- extending the 3D office.

## Decision

1. **`context-provider`** (new kind).
   - Exports `poll({now, region, cursor}) → {cursor, facts[], happenings[]}`.
   - `facts` are short, typed world-context records (weather, transport, event, closure, news)
     with a source URL and an expiry. `happenings` are candidates the Day Director may pick up
     (ADR-0036/0037).
   - Requires the `web` capability; it runs outside the sim.
   - What enters the sim is only the director's resulting commands; text stays out (rule 2).
   - Polling cadence is declared in the manifest and enforced by the host.
2. **`publish-target`** (new kind).
   - The Gateway that the orchestrator calls becomes an interface with built-in GitHub +
     site-kit, plus extension adapters.
   - Adapter API:
     - `openDraft({contentId, path, page, message}) → {ref, headSha, previewUrl?}`
     - `merge({ref, headSha}) → {mergedSha}`
     - `status({ref}) → {state: open|merged|deployed|failed}`
   - Credentials never enter the sandbox. The adapter calls `fetch` against an allowlisted
     origin, and the central server's credential proxy injects the secret. The bundle sees only
     an opaque `credentialRef`.
   - `DeployLanded` arrives from `status` polling or the central events channel.
3. **`challenge`** (new kind). A challenge bundles:
   - a seed;
   - a scenario (content packs and sim rules);
   - a deterministic `score(worldView) → i64`;
   - an end condition.

   The central leaderboard verifies submissions by replaying the command log in the headless
   runner (ADR-0042) and recomputing the score. A score that doesn't replay is rejected.
4. **Staff-authored extensions** (a flow, not a kind).
   - A job kind `author_extension` lets IT or Front-end staff produce a bundle source plus a
     manifest.
   - The host builds it and runs `swarmpress check/test` in the sandbox, then opens a CEO ticket
     with the diff, the requested capabilities and the test results.
   - Approval installs it. The manifest records provenance (`authoredBy: staff id`, `company`,
     `job id`).
   - The default option on deadline is **reject**.
5. **`prop-pack`** (new kind).
   - glTF/KTX2 props are declared with an id, footprint, interaction slots and light emitters.
   - The sim only knows prop ids and footprints, from the pack hash in world config.
   - The renderer resolves ids to assets.
   - The render-state contract gains `props[]` entries with a `pack` namespace (a change to
     `docs/architecture/render-state.md`).

**SDK v0 scope:**
- implement `context-provider` and `publish-target` (types, manifest, sandbox host, runner
  support, examples);
- types and manifest only for `challenge` and `prop-pack`;
- the staff-authored flow is documented and its manifest provenance fields exist.

## Consequences

- **The world-context service (ADR-0035) gets a pluggable source.** Built-in feeds (weather,
  calendar) use the same interface, so first-party and third-party feeds are equal.
- **swarm.press can drive non-GitHub CMSs.** This opens real editorial teams as users.
- **Leaderboards become trustworthy without server-side simulation.**
- **Negative:**
  - The credential proxy is a new security surface: origin allowlists, per-company secrets,
    and audit logging.
  - Staff-authored code is model-written code. The sandbox limits the blast radius, and
    approval by the player is mandatory, but review fatigue is a real risk.
  - Prop packs extend the render-state contract and the asset budget.
- **Alternatives rejected:**
  - Hard-coding GitHub: locks out the real-CMS use case.
  - Trusting client-submitted scores: makes the leaderboards meaningless.
  - Letting staff-authored extensions auto-install: violates "the CEO has final authority".
