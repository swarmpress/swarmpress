# Browser runtime: store, central client, orchestrator bridge, isolation

> Decisions: [ADR-0038](../adr/0038-local-first-the-browser-is-authoritative-for-a-company.md)
> (the browser is authoritative), [ADR-0041](../adr/0041-turso-in-the-browser-one-sqlite-dialect-everywhere.md)
> (Turso wasm on OPFS, one SQLite dialect), [ADR-0042](../adr/0042-extension-sdk-and-the-headless-bun-runner.md)
> (the same wasm under Bun). Contract: [docs/mvp.md](../mvp.md).

The company lives in the player's browser. Four pieces make that work, next to the sim
(`crates/client-wasm`) and the renderer:

```
apps/game
├ src/store/          CompanyStore: Turso wasm (OPFS) | sqlite-wasm (OPFS SAH pool) | memory
├ src/net/central.ts  CentralClient, LeaseKeeper, centralGateway, EventStream
├ src/orchestrator/   orchestrator-wasm loader, LLM adapters, MVP loop driver
└ src/llm/            LocalLlm runtime; mvp-script.ts = the `?llm=fake` script
crates/orchestrator-wasm   wasm-bindgen bridge: OrchestratorHandle(store, gateway, llm, site)
```

## Data flow of one job

```
Sim.drain_effects_json() ──jobsFromEffects()──► job JSON (company_id, brief_ref as string)
   │                                                     │
   │                                  OrchestratorHandle.run(job) (orchestrator-wasm)
   │                                    ├ OrchestratorStore  → CompanyStore (SQL)
   │                                    ├ OrchestratorGateway → centralGateway → POST /api/gateway/*
   │                                    └ OrchestratorLlm    → localLlmBridge(LocalLlm)
   │                                                     │
Sim.apply_command_json(cmd) ◄──outcomesForSim()── outcomes JSON
   └ CompanyStore.appendCommands(…)                     (DeployLanded later, from EventStream)
```

The sim owns every transition (ADR-0011): the browser only moves job requests in and outcomes
out. `e2e/orchestrator.spec.ts` runs this whole path against the real server, and also a
sim-less variant (`runMvpLoop`, the sim's rules played by JS, as in
`crates/orchestrator/tests/loop.rs`).

## CompanyStore (`apps/game/src/store/`)

One class over a small `SqlDriver` interface (`exec`, `run`, `all`, `batch` = one transaction).
Every engine runs the same migrations (`schema.ts`), written in the SQLite subset Turso also
accepts: no extensions, CHECKs, triggers, AUTOINCREMENT or WITHOUT ROWID; JSON in TEXT, bytes in
BLOB, unix-ms INTEGERs. Applied migrations are recorded in `schema_migrations`.

| Table | Holds |
|---|---|
| `command_log (seq, step, kind, payload BLOB)` | the sim's command log (`appendCommands`, `commandsAfter(step)`, `lastSeq`) |
| `snapshots (step, bytes, hash, created_at)` | world snapshots; `putSnapshot` keeps the newest 3, `latestSnapshot` |
| `briefs (company, brief_ref, record, work_item)` | standup briefs; `claimBrief` sets `work_item` once |
| `artifacts (company, work_item, record)` | the latest page, review, PR and merge of an item (JSON kept verbatim) |
| `transcripts (company, job_id, seq, speaker, text)` | meeting utterances, idempotent on `(job_id, seq)` |
| `plan_items`, `plan_posts` | the plan thread; `plan()` / `planJson()` build publishing-plan.md §7 |
| `kv (key, value)` | device id, company id, the event cursor (`events.cursor.<company>`) |

`CompanyStore` implements the orchestrator's `Store` JSON contract (`OrchestratorStore`):

```ts
putBrief(company, briefRef: string, recordJson): Promise<void>
getBrief(company, briefRef): Promise<string | null>           // work_item overlaid
claimBrief(company, briefRef, workItem): Promise<boolean>     // unknown brief → throws
putArtifact(company, workItem, recordJson): Promise<void>
getArtifact(company, workItem): Promise<string | null>
appendTranscript(company, jobId, seq, speaker, text): Promise<void>
setItemText(company, item, title | null, brief | null): Promise<void>
appendPost(company, item, postJson): Promise<string>           // "post-<n>"; type checked
planJson(company): Promise<string>
// plus
appendCommands(cmds: {seq?, step, kind, payload: Uint8Array}[]): Promise<number[]>
commandsAfter(step): Promise<StoredCommand[]>;  lastSeq(): Promise<number>
putSnapshot(step, bytes, hash, keep = 3); latestSnapshot(): Promise<Snapshot | null>
plan(company): Promise<Plan>;  transcripts(company)
getKv(key); setKv(key, value); deleteKv(key)
```

**Engines** (`openCompanyStore({name?, engine?})`):

| Engine | Package | Where it runs | Persistence |
|---|---|---|---|
| `turso` | `@tursodatabase/database-wasm@0.8.1` (`/vite` export) | engine on the page's thread; the package spawns its own OPFS worker | OPFS; needs `crossOriginIsolated` (SharedArrayBuffer) |
| `sqlite` | `@sqlite.org/sqlite-wasm` 3.53.4 | our dedicated worker (`sqlite-worker.ts`) | OPFS SAH pool (no isolation needed); in memory if OPFS is unavailable (`persistent: false`, `fallbackReason` says why) |
| `memory` | `@sqlite.org/sqlite-wasm` | the calling thread | none (tests, Node) |

`auto` (the default) picks Turso when the page is cross-origin isolated and Turso opens, else
sqlite, else memory, and records the reason in `store.fallbackReason`. `?store=turso|sqlite|memory`
forces an engine; a forced engine that fails is an error, not a silent fallback. Both database
packages are excluded from Vite's dependency pre-bundling (they locate their wasm and workers
relative to their own modules). Turso's wasm is about 11 MB (3.9 MB gzip) and is loaded lazily
by `openCompanyStore`.

**u64 ids.** `brief_ref` is a u64 (`xxh3 & i64::MAX`), above 2^53. It crosses the bridge as a
decimal string, the store keys it as TEXT, and artifact records (which contain it as a number)
are stored as the exact JSON text the orchestrator wrote. Never round-trip those records through
`JSON.parse`.

## Central client (`apps/game/src/net/central.ts`)

```ts
new CentralClient({ baseUrl?: string /* '' = same origin */, fetch? })
devLogin(login): Promise<{ user }>            me(): Promise<Me | null>      logout()
createCompany({ name, site_repo?, base_branch? }): Promise<Company>
myCompany(): Promise<Company | null>
acquireLease(companyId, deviceId, force?): Promise<Lease>   releaseLease(companyId, leaseId)
draft(leaseId, { content_id, path, page, message, work_item? }): Promise<DraftResult>
merge(leaseId, number, headSha): Promise<{ merged_sha }>
events(after?, limit?): Promise<{ events, last_seq }>
putLogSegment(companyId, segment, bytes): Promise<{ segment, sha256, size, status: 200 | 201 }>
getLogSegment(companyId, segment): Promise<Uint8Array | null>   listLogSegments(companyId)
putSnapshot(companyId, step, bytes)          getSnapshot(companyId): Promise<{ step, sha256, bytes } | null>

new LeaseKeeper(client, companyId, deviceId, { force?, onLost? })   // start() renews at 1/3 of the TTL; stop() releases
centralGateway(client, () => leaseId): OrchestratorGateway          // x-swarmpress-lease on draft/merge
new EventStream(client, companyId, kv, onEvent, { pollMs?, WebSocket? })
```

Errors are `CentralError {status, body}` with the server's `{error}` text. `EventStream`
catches up with `GET /api/events?after=<cursor>`, then goes live on `/ws/events?after=`; when the
socket closes it polls every 2 s and retries the socket every 5 polls. It delivers in `seq`
order, drops duplicates and other companies' events, and advances the cursor in the store's kv
only after the handler resolves, so a reload neither replays nor loses an event.

In dev and preview, Vite proxies `/auth`, `/api`, `/ws` (WebSocket) and `/web` to the central
server: `SWARMPRESS_CENTRAL_URL`, default `http://127.0.0.1:8080` (the server's `SWARMPRESS_BIND`
default). Cookies stay same-origin.

## The orchestrator bridge (`crates/orchestrator-wasm`)

A separate wasm-bindgen crate, so the sim bundle keeps its own 400 KiB gzip budget. It is
wasm32-only (empty natively) and implements the orchestrator's `Store`, `Gateway` and
`agents::Llm` traits over JS objects (`js_sys::Function` + Promises, `?Send` futures).

```ts
import init, { OrchestratorHandle, jobsFromEffects, outcomesForSim, version } from 'orchestrator-wasm'
new OrchestratorHandle(store: OrchestratorStore, gateway: OrchestratorGateway,
                       llm: OrchestratorLlm, siteJson: string)
run(jobJson: string): Promise<string>     // outcomes JSON; rejects on store/gateway/invalid-job errors
jobsFromEffects(effectsJson: string, companyId: string): string[]
outcomesForSim(outcomesJson: string): string[]
```

- JS methods may return values or Promises; a rejection becomes `StoreError`/`GatewayError`
  (the job can be retried) or `LlmError::Backend`.
- `OrchestratorGateway.openDraft` receives the job's `work_item` as a fifth argument, so the
  server can echo it in `DeployLanded`.
- `OrchestratorLlm.complete(json)` gets `{kind: 'generate' | 'structured', request: LlmRequest,
  schema?}` and answers `{text}`, `{value}` or `{error: LlmError}`. Structured answers are
  validated again in Rust against the full JSON Schema (the browser's validator is a subset).
  `localLlmBridge(LocalLlm)` adapts the browser model runtime; `scriptedLlm(script)` is the test
  double.
- Site binding JSON: `{site_id, brand_name, language?, style_guide, writer_prompt?,
  quality_bar? = 7, simulate_deploy? = false, standup_max_turns? = 4}`.
- Jobs must not overlap on one handle (the gateway's work item is per handle).

`cargo xtask wasm [--release] [--only <crate>]` builds `client-wasm` and `orchestrator-wasm`
into their `pkg/` directories. The orchestrator module is about 4.7 MB raw and 1.06 MB gzip
(release); CI checks it against its own budget (`bundle-size-orchestrator-wasm.json`).

**`?llm=fake`.** `fakeMvpLlm()` is a `FakeLlm` (a `LocalLlm`) scripted with the MVP replies
(`src/llm/mvp-script.ts`, the port of `script()` in `crates/orchestrator/tests/loop.rs`):
standup (moderator, pitch, close, outcome), draft, review 6, revision, review 8. It goes
through the real `LocalLlm` structured-output path, so e2e runs are deterministic. Past the
script every call fails loudly.

## Cross-origin isolation

The Vite dev and preview servers send `Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: credentialless` (`SWARMPRESS_COEP=require-corp` switches to the
strict form). Effects measured on 2026-10-02:

- the game (Babylon, WebGPU and WebGL2), the LLM harness, the module workers and the
  self-hosted onnxruntime files load unchanged; the smoke and visual suites pass;
- Hugging Face model downloads are CORS `fetch`es and are not affected by COEP;
- the game loads no cross-origin fonts, images or iframes today. A future embed (ADR-0035's TV
  and radio) needs `<iframe credentialless>` or CORP;
- Safari does not support `credentialless`: there the page is not isolated, and `auto` selects
  the sqlite-wasm store;
- the central server's own static hosting (`SWARMPRESS_STATIC_DIR`) does not send these headers
  yet. Until it does, a build served from there runs on sqlite-wasm.

## Tests

| Suite | What |
|---|---|
| `apps/game/src/store/company-store.test.ts` (vitest) | migrations, the Store contract (u64 refs, claims, verbatim artifacts, idempotent transcripts, the plan view), command log atomicity, snapshots, kv: memory engine in Node |
| `apps/game/src/net/central.test.ts` (vitest) | every client call against a mocked fetch, lease renewal and loss, events polling, socket, dedupe, fallback |
| `apps/game/src/orchestrator/bridge.test.ts` (vitest) | the MVP loop through orchestrator-wasm with CompanyStore and the `?llm=fake` LocalLlm |
| `crates/orchestrator-wasm/tests/loop.test.ts` (`bun test`) | the MVP loop through the JS bridge with an in-memory JS store, a JS fake gateway and the scripted LLM; error mapping |
| `apps/game/e2e/orchestrator.spec.ts` (Playwright, `-c playwright.orchestrator.config.ts`) | per engine (turso, sqlite): real `swarmpress-server` + Vite preview of the harness build (`vite build --mode harness`, not in the production build); login → company → lease → loop → `DeployLanded` via the events API → sync round trip → reload from OPFS; the sim-driven loop; `auto` picks Turso |
