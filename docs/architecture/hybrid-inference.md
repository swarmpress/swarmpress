# Hybrid inference

> **Local-first update ([ADR-0038](../adr/0038-local-first-the-browser-is-authoritative-for-a-company.md)):**
> there is no server job queue or browser-worker protocol any more.
> - The browser drains the sim's job effects and runs them through the wasm `orchestrator` with
>   local LLMs.
> - Artifacts are validated in the browser by the same Rust validators, then again at the
>   central gateway (PathPolicy, schema).
> - Text is kept in the browser store, not in Postgres.
>
> The model tiers, GPU sharing and the Agency below still apply.

**In-browser LLMs run the staff; Claude does the heavy agentic work.**

Decisions: [ADR-0024](../adr/0024-hybrid-inference-browser-llms-and-claude.md),
[ADR-0025](../adr/0025-browser-job-worker-protocol.md),
[ADR-0026](../adr/0026-model-registry-webgpu-capability-tiers.md),
[ADR-0027](../adr/0027-gpu-sharing-renderer-and-local-llm.md).
Features: FEAT-037 to FEAT-041.

## Who runs what

| Work | Executor policy | Notes |
|---|---|---|
| Meeting turns, chatter | `Browser` (Chatter role on Claude only if the policy allows) | Streamed into bubbles |
| Pitches, briefs | `BrowserThenClaude` | |
| Drafts, revisions | `BrowserThenClaude`, min tier `laptop` | Escalates after 3 rejections |
| Editor reviews | `BrowserThenClaude`, min tier `laptop` | The same rubric (≥ 7) |
| Translation | `BrowserThenClaude`, min tier `high` | |
| Link and media selection | `Browser` | Closed world, so cheap to validate |
| Research | `Claude` | Needs `web_search` |
| Themes and design (Art Director, Front-end Dev, vision review) | `Claude` | Needs vision and strong coding |
| Critic review event | `Claude` | Reads the real site |
| Escalations | `Claude` | Three rejections, schema repair failing, tier too weak, or a CEO "send to agency" ticket |
| SiteAudit | none (deterministic) | No LLM |

In game, Claude-backed work appears as an **external Agency**: contractors visit the building,
sit at a guest desk, and send an invoice. Star hires may be Agency contracts. Escalating is a
visible, costly choice. When no browser is open, the sim keeps ticking, Claude jobs continue,
and browser jobs queue.

## Runtime (`apps/game/src/llm/`)

```
main thread                               module Web Worker (own GPUDevice)
┌──────────────────────────┐   postMessage   ┌──────────────────────────────┐
│ worker-client.ts          │ ─────────────► │ LocalLlm                      │
│  leader.ts (Web Locks)    │ ◄───────────── │  TransformersJsLlm | FakeLlm  │
│  scheduler.ts (GPU)       │   token deltas │  structured(): prompt → gen → │
│  registry/capability/     │                │   validate (content-model.wasm)│
│  download.ts              │                │   → repair ≤ N                │
└──────────────────────────┘                └──────────────────────────────┘
```

```ts
interface LocalLlm {
  load(modelId: string, onProgress?: (p: Progress) => void): Promise<void>
  generate(messages: Msg[], opts: { maxTokens: number; temperature?: number; stop?: string[] }): Promise<string>
  stream(messages: Msg[], opts: GenOpts): AsyncIterable<string>
  structured<T>(messages: Msg[], jsonSchema: JsonSchema, opts?: { repairTurns?: number }): Promise<T>
}
```

- **`structured`** works in three steps:
  1. Schema-guided prompting: the schema and an example go in the prompt.
  2. The output is validated by **`content-model` compiled to wasm**. This is the same Rust
     validator the server uses, plus closed-world link and media checks against the indexes the
     server ships with the job inputs.
  3. Up to N (default 2) repair turns, each quoting the validation errors.
- **Adapters:**
  - `TransformersJsLlm` (default; Transformers.js v4, WebGPU backend, q4f16 where available);
  - `FakeLlm` (tests: scripted outputs, configurable latency and failures).

  WebLLM/MLC or a custom ternary kernel can be added behind the same interface.

## Model registry and tiers

`config/models.toml`, served at `GET /config/models.toml`:

```toml
[[model]]
id = "qwen-4b-q4f16"
hf_repo = "onnx-community/…"
dtype = "q4f16"
download_bytes = 2_600_000_000
sha256 = "…"
context_length = 32768
min_max_buffer_size = 1_073_741_824
min_max_storage_buffer_binding_size = 1_073_741_824
approx_vram_bytes = 3_200_000_000
roles_allowed = ["chatter", "writer", "editor", "eic", "media", "linker"]
tier = "laptop"
```

| Tier | Candidate | Typical device | Allowed |
|---|---|---|---|
| `chatter` | tiny model (~0.5–1B) | integrated GPUs, low memory | chatter, bubbles, media picks |
| `laptop` | ~4B Qwen-class | modern laptops | + meetings, briefs, drafts, reviews |
| `high` | GPT-OSS-20B q4f16 | discrete GPUs, 16 GB+ | + translation, long drafts |
| `frontier-local` | 27–30B class (Ternary Bonsai 2, Muse Glimmer) | only if **our eval** confirms the vendor claims | everything local |
| `agency-only` | none | no usable WebGPU | everything goes to the Agency |

**First-run capability detection:**
1. Request a WebGPU adapter and read its `limits`.
2. Read `navigator.deviceMemory`.
3. Download the smallest model and run a **10-second tokens-per-second probe**.

This picks the tier, and players can override it in settings. Within the tier, **seniority picks
the model**: a Junior gets the smallest allowed, a Senior or Star the largest that fits the VRAM
budget.

**Downloads:**
- stored in Cache Storage (or OPFS for large shards);
- resumable via range requests;
- `sha256` verified;
- shown in game as **"installing the newsroom's brains"**, with a progress bar on the ServerRoom
  rack.

## Browser job worker protocol

1. Each `JobKind` has an executor policy and a minimum tier. The server queues browser jobs in the
   ordinary `jobs` table.
2. One tab per company is the worker, elected with
   `navigator.locks.request('swarmpress-worker-<company>', …)`. The lock is released automatically
   if the tab dies.
3. The frames are `JobOffer` → `JobClaim` → `JobLease{lease_until}` → `JobProgress{delta}`… →
   `JobResult{artifact}` or `JobFailed`. Progress deltas stream into speech bubbles and the
   feed, and renew the lease. See [protocol.md](protocol.md).
4. **The server validates every artifact:**
   - schema;
   - closed-world links and media;
   - size and safety limits;
   - prompt-injection hygiene. Artifacts are data: when quoted into later prompts, they sit in
     delimited data sections, with an instruction to ignore embedded instructions.

   The server stores the text (Postgres for meetings, the repo via PR for content) and injects
   `Cmd::JobCompleted{digest}`. **The browser never holds GitHub credentials; the server commits
   and merges.**
5. A lease expires after 60 s without progress, or on disconnect, and the job is re-queued. After
   the retry limit, a `BrowserThenClaude` job escalates to the Agency, and a `Browser` job opens a
   ticket.
6. **Morning rush:** on reconnect, the worker drains the queue by priority. In game, staff who
   were "waiting" at their desks start typing.

## GPU sharing

- The renderer and the LLM use **separate WebGPU devices** (the main thread and the worker).
- `scheduler.ts` watches the frame-time p95. While the LLM generates, it drops the render quality
  one tier (high→medium→low) and caps FPS at 30. It restores both after 2 s idle. If p95 still
  exceeds 50 ms, it asks the worker to yield between decode steps.
- LLM jobs pause while the tab is hidden **only if the player opts in**.
- **VRAM budget:** the model's `approx_vram_bytes` plus the renderer's tier estimate must fit the
  detected budget. Otherwise a smaller model is chosen.

## Trust and determinism

- Client-written content is real content, and passes the same QA and editor gates.
- The leaderboard counts only SiteAudit-verified facts, so a modified client cannot inflate
  scores.
- LLM output is nondeterministic per device. It enters the sim only as a server-issued command
  carrying a digest, so lockstep replicas stay identical.

## Testing

- **vitest:**
  - adapter contracts with `FakeLlm`;
  - structured-output repair loops;
  - the GPU scheduler over synthetic frame-time series;
  - tier selection;
  - download resume.
- **Playwright:** leader election across multiple pages.
- **Server:** `FakeBrowserWorker` tests for claim, lease expiry, re-queue, invalid artifact
  rejection and reconnect drain.
- **Nightly Playwright:** a **tiny real ONNX model on WebGPU (SwiftShader)**, end to end: offer →
  stream → bubble → validated artifact.
- **Model eval harness:** the same job set on every registry model, scored by the editor rubric
  with Claude as judge, plus tokens per second. It emits `cockpit.benchmark.v1` per model
  (`bench/model-eval`), and registry defaults change only through PRs that cite it.
