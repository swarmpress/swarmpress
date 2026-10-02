# Writing extensions

This tutorial takes one extension from scaffold to package: `new → check → run → test → pack`.
The reference is [Extension SDK](../architecture/sdk.md); the decisions are
[ADR-0042](../adr/0042-extension-sdk-and-the-headless-bun-runner.md) and
[ADR-0043](../adr/0043-extension-points-context-publish-challenges-self-authored-props.md).

## Setup

You need Bun 1.3, and, for anything that runs the sim, the client-wasm build:

```sh
pnpm install
cargo xtask wasm            # writes crates/client-wasm/pkg (the runner tells you if it is missing)
alias swarmpress="bun $PWD/packages/runner/src/cli.ts"   # or: pnpm swarmpress <command> …
swarmpress help
```

The runner also runs under Node 22+ (`node packages/runner/src/cli.ts …`), except `build`, which
needs `Bun.build`.

## 1. Scaffold

```sh
swarmpress new skill extensions/headline-doctor
```

Kinds with templates: `content-pack`, `skill`, `sim-rule`, `context-provider`, `publish-target`.
The skill template creates:

```
extensions/headline-doctor/
  swarmpress.ext.json              # id, version, sdk range, kinds, capabilities, entry
  src/index.ts                   # defineSkill({ tools, jobs })
  test/summarize.scenario.json   # a passing scenario
```

Edit `swarmpress.ext.json`: pick a reverse-DNS `id` you own, and request only the capabilities you
use. Players see them on install.

```json
{
  "id": "org.example.headline-doctor",
  "name": "Headline doctor",
  "version": "0.1.0",
  "sdk": "^0.1.0",
  "kinds": ["skill"],
  "capabilities": ["llm:low", "store:notes"],
  "entry": { "bundle": "src/index.ts" }
}
```

## 2. Write the code

Import from `@swarm-press/sdk/runtime` (it is bundled into your extension and runs in the sandbox):

```ts
import { defineSkill, jobResult } from "@swarm-press/sdk/runtime";

export default defineSkill({
  jobs: {
    "headline-review": {
      description: "Scores a headline and suggests a better one.",
      example: { input: { headline: "Things to do" }, llm: ["5|Seven quiet things to do in Vernazza at dawn"] },
      async handler({ job, llm, store }) {
        const { headline } = job.input as { headline: string };
        const r = await llm.complete({ tier: "low", prompt: `Score 0-10 and improve: ${headline}` });
        const [score, better] = r.text.split("|");
        await store.table("notes").put(job.job_id, { headline, better });
        return jobResult({ kind: "headline-review", content: { headline, better } }, { ok: true, score: Number(score) });
      },
    },
  },
});
```

Rules of the road:
- Return `{artifact, digest}` (use `jobResult`). Never a stage, an approval or a merge: the
  orchestrator decides those.
- Inside the sandbox you have `Bun.file`/`Bun.write` (your granted `store/<table>/…` paths and your
  own files under `pack/…`), `fetch` (with `web`), `swarmpress.llm` (with `llm:<tier>`) and `console`.
  Nothing else: no `process`, `require`, timers or filesystem.
- Calls have a memory cap, an operation budget and a wall-time budget; a breach fails the call.
- Sim rules run in deterministic mode: `Math.random` is seeded and `Date` is pinned, and their
  commands carry integers only.

Content packs have no code: add persona, happening and prompt-layer files and list them under
`entry.content` (see `examples/extensions/harvest-season`). Personas use the same keys as
`crates/agents/personas/*.toml`, in TOML or JSON.

## 3. Check

```sh
swarmpress check extensions/headline-doctor
```

`check` validates the manifest and every content file against the SDK schemas, checks that the
`sdk` range accepts the runner's SDK version, warns about capabilities that look wrong, builds the
bundle, loads it in the sandbox and checks its exports per kind. For sim rules it runs one day
twice and fails if the proposed commands differ. Fix every `error:` line; `warning:` lines are
advice.

## 4. Run

```sh
swarmpress run --seed 42 --days 3 --ext extensions/headline-doctor
```

The runner loads the same wasm sim the browser runs, fast-forwards it, and prints one line per
game day with its step and world hash. Then it drives your extension through the sandbox:

- skills: each job's `example` input, with the example's scripted FakeLlm replies;
- sim rules: hooks at day starts and every `rule.stepInterval` steps, printing proposed commands;
- context providers: one poll per region, with the web fixtures of your first scenario, or the real
  network with `--web live`;
- publish targets: draft → merge → status against the recorded server of your first scenario;
- content packs: the documents and the pack hash.

Add `--json` for a machine-readable report. Load several extensions with repeated `--ext`.

## 5. Test

```sh
swarmpress test extensions/headline-doctor
```

`test` runs every `*.scenario.json` under the folder
([schema](../../packages/sdk/schemas/scenario.schema.json)). A scenario can pin:

```json
{
  "name": "headline review",
  "seed": 42,
  "days": 1,
  "expect": { "hash": "replay", "day": 1 },
  "jobs": [{
    "kind": "headline-review",
    "input": { "headline": "Things to do" },
    "llm": ["5|Seven quiet things to do in Vernazza at dawn"],
    "expect": { "digest": { "ok": true, "score": 5 }, "artifactKind": "headline-review" }
  }]
}
```

- `expect.hash`: an exact `0x…` world hash after `days`, or `"replay"` (run twice, every per-day
  hash must match). Prefer `"replay"` in extensions: exact hashes change when the game changes.
- `jobs[]`: input, scripted `llm` replies (running out fails the job loudly), `web` fixtures by URL
  (`body` or `file`), and the expected digest subset, artifact kind or `error`.
- `tools[]`, `rules.expect.commands` (exact list or `"replay"`), `polls[]` (facts, happenings,
  cursor) and `publish` (credential, draft, recorded `server` exchanges with expected headers and
  bodies, expected state).

`test` exits non-zero on any failure and prints what differed.

## 6. Pack

```sh
swarmpress pack extensions/headline-doctor
# ✓ extensions/headline-doctor/dist/org.example.headline-doctor-0.1.0.swarmpress.tgz: 5 files, …, sha256 …
```

`pack` refuses an extension that fails `check`, builds the bundle, and writes a reproducible
tar.gz with the manifest, sources, `dist/ext.bundle.js` and `swarmpress.integrity.json` (a SHA-256 per
file plus the pack hash). That archive is what a future marketplace listing (ADR-0033) and the
staff-authored approval flow consume.

## Examples

| Example | Kind | Shows |
|---|---|---|
| `examples/extensions/harvest-season` | content pack | a TOML persona, two happenings (a roll and a recurring card with a ticket), a prompt layer |
| `examples/extensions/fact-checker` | skill | a tool, a job using `web` + `llm:low` + a store table, a digest with QA defects |
| `examples/extensions/coffee-machine-rule` | sim rule | seeded randomness, `onDayStart` + `onStep`, pinned command output |
| `examples/extensions/ligurian-ferries` | context provider | parsing an HTML timetable, a transport fact, a happening candidate, cursors |
| `examples/extensions/ghost-publisher` | publish target | page blocks → Ghost Admin API HTML, the credential proxy, a recorded server |

Each one passes `swarmpress check` and `swarmpress test`; `pnpm test:sdk` runs them in CI.
