# Extension SDK

> Decisions: [ADR-0042](../adr/0042-extension-sdk-and-the-headless-bun-runner.md) (bundles, the
> QuickJS sandbox, the runner) and
> [ADR-0043](../adr/0043-extension-points-context-publish-challenges-self-authored-props.md)
> (context providers, publish targets, challenges, staff-authored extensions, prop packs).
> Idea catalogue: [What the SDK makes possible](../game-design/sdk-ideas.md). Tutorial:
> [Writing extensions](../guides/extending.md). Features: FEAT-053 to FEAT-058.

Extensions let players, modders and the company's own staff add content and behaviour without
touching the engine. They must not break three invariants:

- **Determinism.** The same seed plus the same command log gives the same `World::hash`
  everywhere (native, wasm in the browser, the Bun runner).
- **Text never enters the sim** (CLAUDE.md rule 2). Extensions reach the sim only through
  validated commands carrying integers and digests.
- **The orchestrator owns transitions** (rule 3). An extension returns artifacts, digests, facts
  or proposals, never a stage change, an approval or a merge decision.

## Packages

| Path | Package | What |
|---|---|---|
| `packages/sdk` | `@simpress/sdk` | zod sources and exported JSON Schemas (`schemas/*.schema.json`), TS types, `define*` helpers, semver |
| `packages/sdk/src/runtime.ts` | `@simpress/sdk/runtime` | what bundles import: `defineSkill`, `defineRule`, `defineContextProvider`, `definePublishTarget`, `jobResult`, pure-JS SHA-256. No zod, safe inside the sandbox |
| `packages/sandbox` | `@simpress/sandbox` | QuickJS in wasm with a Bun-compatible API subset; the same code in the browser and under Bun/Node |
| `packages/runner` | `@simpress/runner` | the `simpress` CLI: `new`, `check`, `build`, `run`, `test`, `pack` |
| `examples/extensions/*` | | one example per implemented kind |

`pnpm test:sdk` runs all three packages' `bun test` suites (JUnit in `packages/*/reports/junit.xml`);
`pnpm --filter @simpress/sandbox test:e2e` runs the browser parity test.

## Kinds

| Kind | Form | Runs | SDK v0 |
|---|---|---|---|
| `content-pack` | JSON or TOML documents: personas, happenings, prompt layers (later: roles, rooms, job kinds, house style, blocks) | nowhere: data | schemas, validation, pack hash. Not yet applied to the world (needs a world-config hook in sim-core) |
| `sim-rule` | bundle with `onStep`, `onDayStart`, `onEvent` | sandbox, deterministic mode, at step boundaries | implemented in the runner; commands are logged as *proposed* |
| `skill` | bundle with `tools` and `jobs` | sandbox (browser Worker / runner) | implemented: FakeLlm, fixture web, in-memory store |
| `context-provider` | bundle with `poll` | sandbox, `web` required | implemented: fixture or live web, cadence enforced |
| `publish-target` | bundle with `openDraft`, `merge`, `status` | sandbox, origin allowlist, credential proxy | implemented against a recorded fake server |
| `panel` | bundle plus a panel manifest | sandboxed iframe in the overlay, `postMessage` | manifest only |
| `challenge` | seed, scenario (packs and rules), `scoreExport`, end condition | runner replay on the central leaderboard | manifest only |
| `prop-pack` | glTF/KTX2 props with id, footprint, slots, lights | renderer resolves ids; sim knows ids and footprints | schema only |

One extension may declare several kinds; all code kinds share one bundle.

## The manifest: `simpress.ext.json`

Schema: [`packages/sdk/schemas/manifest.schema.json`](../../packages/sdk/schemas/manifest.schema.json).

```json
{
  "id": "dev.simpress.examples.ghost-publisher",
  "name": "Ghost publisher",
  "version": "0.1.0",
  "sdk": "^0.1.0",
  "kinds": ["publish-target"],
  "capabilities": ["web"],
  "origins": ["https://demo.ghost.io"],
  "credential": { "kind": "ghost-admin", "scopes": ["posts:write"] },
  "entry": { "bundle": "src/index.ts" },
  "provenance": { "author": { "name": "SimPress examples" } }
}
```

| Field | Rule |
|---|---|
| `id` | reverse-DNS, `^[a-z0-9-]+(\.[a-z0-9-]+)+$` |
| `version` | semver |
| `sdk` | semver range; the runner refuses an extension whose range does not accept its `SDK_VERSION` |
| `kinds` | one or more of the kinds above, unique |
| `capabilities` | `web`, `credits`, `ui`, `llm:<low\|mid\|high\|agency>`, `store:<table>` |
| `entry.bundle` | source entry (TS or JS) for every code kind |
| `entry.content` | `personas`, `happenings`, `prompt_layers`, `props`: lists of `.json`/`.toml` files |
| `rule.stepInterval` | `sim-rule`: steps between `onStep` calls (12,000 steps per game day, so 500 = one game hour) |
| `poll` | `context-provider`: `cadenceMinutes` (≥ 5) and `regions[]` |
| `origins` | the only origins `fetch` may reach; required for `publish-target` |
| `credential` | `publish-target`: `{kind: bearer\|basic\|header\|ghost-admin, header?, scopes[]}` |
| `panel`, `challenge` | the manifest-only kinds' blocks |
| `provenance` | `{authoredBy: {staffId, company, jobId}}` or `{author: {name, url?}}` |

Cross-field rules (enforced by the schema): code kinds need `entry.bundle`; a content pack needs at
least one content file; context providers and publish targets need `web`; panels need `ui`;
`llm:agency` needs `credits`; sim rules and challenges cannot request `web`, `credits` or `llm:*`.

## Capabilities

Capabilities are declared, shown to the player on install, and **enforced by the host**, outside
the VM. There is no ambient authority.

| Capability | Grants inside the sandbox | Enforced where |
|---|---|---|
| (none) | `Bun.file("pack/…")` read-only access to the extension's own text files; `console` | sandbox path check |
| `store:<table>` | `Bun.file/Bun.write("store/<table>/…")`; the SDK's `store.table(name)` facade | sandbox path check (no `..`, no absolute paths, other tables refused) |
| `web` | `fetch` (only to `origins` when declared) through `host.web`: the central fetch proxy in the browser (ADR-0040), fixtures or the network in the runner | sandbox origin check, then the host |
| `credits` | paid web calls (Firecrawl) and `llm:agency` | the central service (not in v0) |
| `llm:<tier>` | `simpress.llm.complete({tier, system?, prompt})` for granted tiers | sandbox tier check |
| `ui` | a panel iframe | the overlay (not in v0) |

Ungranted globals are simply absent (`typeof fetch === "undefined"`); an ungranted path, origin or
tier raises `CapabilityError`.

## The sandbox

`createSandbox({capabilities, limits, deterministic?, origins?, host: {store, web, llm, log}})`
returns `{load(bundleJs), call(exportPath, arg, {seed?, nowMs?}), exports(), dispose()}`.

- **Engine.** `quickjs-emscripten-core` 0.32 with the `@jitl/quickjs-wasmfile-release-sync`
  variant (bellard/quickjs 2025-09-13), about 230 KB gzipped. Each sandbox instantiates its own
  QuickJS wasm instance from one cached compiled module (a few ms).
- **Globals.** `Bun.file(path).text()/json()/exists()`, `Bun.write(path, string)`, `Bun.env = {}`,
  `fetch` (with `web`; the response has `status`, `ok`, `headers.get()`, `text()`, `json()`),
  `simpress.llm.complete` (with `llm:*`), `console.*` → `host.log`. Nothing else: no `process`,
  `require`, timers, `std`/`os`, filesystem or network. The raw host functions are captured by a
  prelude closure and deleted from the global object before the bundle runs.
- **Limits** (`SandboxLimitError.limit`):
  - `memory`: the instance's `WebAssembly.Memory` has a hard `maximum` of the 16 MiB base heap
    plus `memoryBytes` (default 32 MiB). QuickJS's own `setMemoryLimit` is also set, but in this
    build it under-counts large blocks (emscripten has no `malloc_usable_size`), so the wasm cap is
    the real limit;
  - `ops`: the interrupt handler counts polls (QuickJS polls about every 10,000 operations) against
    `interruptOps` (default 1e8);
  - `wall`: `wallMs` per call (default 5 s), including the time spent awaiting host I/O;
  - `stack`: `stackBytes` (default 512 KiB).
  A breached sandbox is unusable afterwards (calls fail) and is dropped, not freed.
- **Async.** Host functions return guest promises (`vm.newPromise`); when the host I/O settles,
  the sandbox resolves the deferred and runs `executePendingJobs`. `call()` awaits the result via
  `vm.resolvePromise`, and fails loudly when the promise can never settle.
- **Deterministic mode** (sim rules, challenge scores): `Math.random` is a seeded mulberry32,
  `Date`/`Date.now()` are pinned, and `fetch`, `simpress.llm` and store writes are unavailable.
  `call(…, {seed, nowMs})` reseeds per call, so a hook's output depends only on its input and seed,
  not on call history.
- **Parity.** `packages/sandbox/e2e/parity.spec.ts` runs the fact-checker and coffee-machine
  bundles in headless Chromium and asserts the same JSON (including `Math.random` draws and the
  artifact SHA) as the Bun run (`test/fixtures/parity.expected.json`).

In the browser the sandbox runs inside a dedicated Worker (one per extension); the Worker host and
its message protocol are not part of v0.

## Content packs

| Document | Schema | Shape |
|---|---|---|
| persona | `persona.schema.json` | exactly `agents::Persona` v2 (`crates/agents/src/personas.rs`, `deny_unknown_fields`; [organization.md §3](../game-design/organization.md)): `slug`, `id`, `name`, `pronouns` (stated), `age`, `hometown`, `department`, `role` (a kebab-case staff role, which must be in that department), `title`, `seniority`, `salary_eur_month`, `languages`, `affinities`, `pitch`, `birthday`/`name_day` (`MM-DD`), `bio`, `cv` (education, ≥2 experience entries with highlights, skills, awards), `life` (hobbies, interests, quirks, likes, dislikes, `work_style`, 2–4 `values`), `traits` (0..100), optional `writing_style` (required for writers and editors; `voice`, `preferences`, `sample_phrases` with `en`), optional `relationships`, `family`, `traditions`, `world`, `appearance`. TOML files use the same keys as `crates/agents/personas/*.toml`; the SDK tests validate those files unchanged, and `crates/agents/tests/personas.rs` fails when the exported schema's keys or enums drift from the Rust one. The host still applies the Rust-only rules on load (salary band, CV year ranges, non-partisan `world`, relationship targets) |
| happening | `happening.schema.json` | an authored event card: `id`, `title`/`story` (`LocalizedString`), `trigger` (`roll` with `permille_per_day`, `day`, or `every`), `cooldown_days`, and 2–12 `primitives` from the ADR-0037 toolbox: `gather`, `emote`, `prop`, `guest`, `ambience`, `memory`, `mood`, `affinity` (\|delta\| ≤ 30 ‰), `proposal`, `ticket` (with `default_option` and `deadline_days`), `spotlight`, `narration`. No primitive moves money, hires, answers tickets or publishes |
| prompt layer | `prompt-layer.schema.json` | a level-2 (site) layer over a company template (`writer`, `editor`, `editor_in_chief`, `meeting_speaker`, `qa_coherence`): `template_additions`, `examples`, `variables`. No `template_override`, and reserved variables (`persona_block`, `house_style`, `block_docs`, …) cannot be set |
| prop | `prop.schema.json` | see prop packs below |

The **pack hash** is SHA-256 over the canonical JSON of every validated document, sorted by section
and file. It is meant to become part of the world config, so two players with the same packs get the
same world; until sim-core has that hook, `simpress run` reports packs without applying them.

## Agent skills

```ts
import { defineSkill, jobResult } from "@simpress/sdk/runtime";
export default defineSkill({
  tools: { name: { description, input /* JSON Schema */, run(input, ctx) } },
  jobs: { kind: { description, example?, async handler({ job, store, llm, web, log }) {
    return jobResult(artifact, { ok, score, qa_defects }); // → { artifact, digest }
  } } },
});
```

- The handler gets capability-gated facades: `store.table(name).get/put`, `llm.complete`,
  `web.fetch`, `log`.
- It returns exactly `{artifact: {kind, content}, digest: {ok, score 0..10, words, qa_defects,
  artifact_sha}}`. Any other key is rejected, and the host recomputes `artifact_sha` as
  `sha256(canonicalJson(artifact))` and rejects a mismatch.
- The digest becomes `Cmd::JobCompleted{digest}` (the sim keeps the first 16 bytes of the SHA). The
  artifact goes to the store and through the normal gates; the skill never transitions anything.

## Sim rules: the hook contract

ADR-0042 first sketched sim rules as wasm modules inside sim-core (wasmi, an integer ABI, fuel).
That design was dropped: rules are JS bundles in deterministic mode, and their output is logged.

| Hook | Called | Argument | Returns |
|---|---|---|---|
| `onDayStart(view)` | at every runner day boundary (each `steps_per_day` from the start; 07:00 in the demo office) | `WorldView` | `ProposedCommand[]` |
| `onStep(view)` | every `rule.stepInterval` steps | `WorldView` | `ProposedCommand[]` |
| `onEvent({view, event})` | reserved: sim events are not exposed to rules yet | | `ProposedCommand[]` |

- **World view** (JSON, integers and strings only): `seed` (decimal string), `step`, `day`,
  `minute`, `cash_cents`, `rooms[] {id, kind, light, occupancy, capacity}`,
  `devices[] {id, kind, state, room}`, `staff[] {id, name, role, activity, fatigue, morale}`
  (permille). It is derived from `render_state_json()`.
- **Commands** are `{type, …}` objects with integer, string or boolean fields (floats are
  rejected), at most 64 per call.
- **Seeding.** Each call is reseeded from `"<world seed>:<extension id>:<step>:<hook>"` and
  `Date` is pinned to the sim clock (day 0 = 2026-01-01T00:00Z plus the in-game minute). In the
  browser the seed will come from the world RNG stream.
- **Validation and replay.** The host validates every proposed command with `validate_command`
  and appends the accepted ones to the command log. **Replay re-applies the logged commands and
  never re-executes the JS**, so a rule cannot desynchronise a replay even if its code changes.
  In SDK v0 the wasm `Sim` only takes postcard-encoded commands, so the runner logs rule output with
  `status: "proposed"` and does not apply it; a JSON command entry point in `client-wasm` (or an
  SDK-side postcard encoder) closes that gap.
- Rule calls run in extension-id order after the sim steps. `simpress check` runs a rule twice
  over one day and fails if the proposed commands differ.

## Context providers

```ts
defineContextProvider({ async poll({ now, region, cursor }, ctx) {
  return { cursor, facts: Fact[], happenings: HappeningCandidate[] };
} });
```

- `Fact`: `kind` (`weather | transport | event | closure | news`), `title`, `summary`,
  `source_url`, `region`, `valid_from`, `expires_at` (RFC 3339, after `valid_from`).
- `HappeningCandidate`: `title`, `hook`, `involves_roles[]` (agent roles), `urgency` 0–3,
  `expires_at`. The Day Director (ADR-0036/0037) may pick it up; only the director's resulting
  commands reach the sim.
- The host enforces `poll.cadenceMinutes` per region, rejects regions not in `poll.regions`, and
  rejects facts for another region.

## Publish targets

```ts
definePublishTarget({
  openDraft({contentId, path, page, message}, ctx) → {ref, headSha, previewUrl?},
  merge({ref, headSha}, ctx) → {mergedSha},
  status({ref}, ctx) → {state: open | merged | deployed | failed},
});
```

- `ctx.web.fetch` adds `X-SimPress-Credential: <credentialRef>`. The **credential proxy** (the
  central server in production, `FakeHttpServer` in the runner) removes that header, looks the
  reference up, and sets the real `Authorization` (`Bearer`, `Basic`, `Ghost <token>`, or a custom
  header). The secret never enters the sandbox, and a bundle that sets `Authorization` itself is
  refused.
- `fetch` reaches only `origins`.
- The orchestrator's Gateway becomes an interface with GitHub + site-kit built in and extension
  adapters beside it; `DeployLanded` comes from `status` polling or the central events channel.

## Challenges, prop packs and panels (manifest only)

- **Challenge:** `challenge: {title, seed, scenario: {base, packs[], rules[]}, scoreExport, end:
  {day, bankrupt}}`. The leaderboard will verify a submission by replaying its command log in the
  runner and recomputing `score(worldView) → integer` in deterministic mode; a score that does not
  replay is rejected.
- **Prop pack:** props with `id`, `name`, `gltf`, `textures[]` (KTX2), `footprint {w, h}` in whole
  tiles, `slots[] {id, kind: sit|stand|use|look, at, facing?}` and at most two `lights[]`. The sim
  will know only ids and footprints (via the pack hash); the render-state contract gains `props[]`
  with a `pack` namespace (a change to [render-state.md](render-state.md), not made yet).
- **Panel:** `panel: {title, slot}` plus the `ui` capability; a sandboxed iframe with a
  `postMessage` API, read-only views, and proposed player commands.

## Staff-authored extensions (flow, not implemented)

1. A job of kind `author_extension` (IT or front-end staff) returns a bundle source and a manifest
   as its artifact, with `provenance.authoredBy = {staffId, company, jobId}`.
2. The host builds it and runs `simpress check` and `simpress test` in the sandbox.
3. A CEO ticket shows the diff, the requested capabilities and the test results. Options: install,
   reject. **The default on deadline is reject.**
4. Approval installs it; the manifest keeps the provenance. `simpress check` warns on
   `authoredBy` that installation needs this approval.

## The runner

| Command | Does |
|---|---|
| `simpress new <kind> <dir>` | scaffolds `content-pack`, `skill`, `sim-rule`, `context-provider` or `publish-target`, with a passing scenario |
| `simpress check <dir>` | manifest and content schemas, `sdk` range, capability sanity, builds the bundle, checks its exports per kind, determinism replay for rules |
| `simpress build <dir>` | `Bun.build` → `dist/ext.bundle.js` (one IIFE that assigns `globalThis.ext`, no externals; `@simpress/sdk` always resolves to the runner's runtime) plus its SHA-256 |
| `simpress run [--seed S] [--days N] [--ext dir…] [--world demo\|empty] [--web fixtures\|live] [--json]` | loads `crates/client-wasm/pkg`, fast-forwards, prints per-day step and hash, runs rules, demo jobs, polls and the publish cycle through the sandbox |
| `simpress test <dir>` | runs every `*.scenario.json` ([schema](../../packages/sdk/schemas/scenario.schema.json)): seed, days, expected hash (`0x…` or `"replay"`), rule commands, job digests, tool outputs, polls, publish cycles |
| `simpress pack <dir> [--out f]` | refuses a failing check; writes a reproducible `<id>-<version>.simpress.tgz` with `simpress.integrity.json` (SHA-256 per file, pack hash, bundle path) |

The runner uses web-standard APIs plus a thin file shim, so it also runs under Node 22+ (type
stripping); building bundles needs Bun, and Node reuses a prebuilt `dist/ext.bundle.js`.

**Determinism evidence.** `packages/runner/test/fixtures/golden.json` pins world hashes after N
days. The same file is asserted natively and under wasm-bindgen-test by
`crates/client-wasm/tests/runner_golden.rs`, and under Bun by
`packages/runner/test/golden.test.ts`: native = wasm = Bun. When sim-core changes the world on
purpose, regenerate the hashes there (instructions in the file).

## Versioning

`SDK_VERSION` (0.1.0) follows semver and is tied to `PROTO_VERSION` (the runner checks the
client-wasm `version()` string at start-up) and to the content-schema version. Breaking changes to
the hook, skill or adapter contracts, or to the sandbox's Bun subset, bump the major version.
