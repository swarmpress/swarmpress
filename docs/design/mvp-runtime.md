# MVP runtime design: Ternary Bonsai 2 on WebGPU behind `LocalLlm`

> **Superseded (2026-10-05):** the resident model was a no-go on the owner's machine
> ([qualification](../qualification/2026-10-05-bonsai-apple-m3-max-128gb-stability.md)); staff run on
> hosted GPT-6-Luna through the central server ([ADR-0067](../adr/0067-hosted-inference-on-gpt-6-luna.md)).
> The `LocalLlm` contract, the clock hold while the model is away and the bridge's timeouts below
> still apply; the WebGPU engine, the resident lock and the GPU scheduler are not on the MVP path.
> Kept as the record of the design.
> **Status:** design, 2026-10-02. Decided in [ADR-0057](../adr/0057-strict-in-browser-inference-one-resident-model-on-webgpu.md).
> Nothing here is built. Track **R** of [`docs/mvp.md`](../mvp.md).
> **Evidence status:** the demo bundle, the GGUF header, the Hub metadata and this repo were
> read. No browser and no model were run. Every performance number is either third-party or a
> proposed threshold, and is marked as such.
> Requirement source: [`docs/reference/browser-agent-studio.md`](../reference/browser-agent-studio.md)
> sections 10–13, 17–18, 21–24 and 28.

## 0. The decision this implements

All language-model inference in the MVP runs locally **in the browser on WebGPU**:

- **Model:** Ternary-Bonsai-2-27B, packing PTQ1_0, 5.95 GB GGUF
  (`https://huggingface.co/prism-ml/Ternary-Bonsai-2-27B-gguf`).
- **One resident model** shared by all staff, in **one Dedicated Worker**, behind a
  model-independent adapter.
- No inference API, no native model server, no cloud fallback.
- The runtime is obtained by extracting the engine from the public demo at
  `https://huggingface.co/spaces/webml-community/ternary-bonsai-2-webgpu-kernels`.
- It is **proven by a benchmark report before anything is built on it** (the concept document's
  Phase A).
- Chrome's Prompt API (Gemini Nano) is prototyped as a second, separately labelled local adapter
  on the same task fixtures.
- Qualification machine: Apple M3 Max, 128 GB, macOS 26.4, Chrome 154.0.8037.95.

## 1. Findings that shape the design

- **This repo is GPL-3.0 and public** (`LICENSE.md`). An unlicensed bundle cannot be committed.
- **The demo bundle already contains a clean ES module.** The second inline script is the
  engine and ends in
  `export{Cl as DEFAULT_GGUF_FILE,Ri as DEFAULT_MODEL_ID,zl as TernaryBonsai2,Pm as createAssistantMarkdown,mx as default,Em as formatBytes,jm as initKernelsOverlay};`.
  The 14.5 KB demo UI follows it. One cut, no patches.
- **`generate()` throws whenever a system message is present.** The private `#m` renders the
  leading system messages alone, and the model's chat template then raises
  `No user query found in messages.`. The demo never sends a system message; the game always
  does.
- **Decoding is greedy only.** `X0` throws `V1 only supports greedy decoding`. There is no
  temperature, top-k, top-p or repetition penalty. The GGUF carries
  `top_k=20, top_p=0.95, temp=1.0`, which the runtime ignores.
- **Reasoning effort.** The chat template accepts `xhigh` (default), `medium` and `low`; `high`
  raises. `medium` simply omits the instruction text. `low` barely shortens reasoning
  (the model's `KNOWN_ISSUES.md`). `enable_thinking: false` is a hard switch: the prompt then
  ends `<think>\n\n</think>\n\n`.
- **Licence status is unresolved upstream.** Discussion #4 on the Gemma sibling Space
  ("Licensing / reuse of your gemma-4-e2b.js") has been open since 2026-06-19 with three
  requests and no author reply.
- **Three public projects already extract this exact module into a Worker:**
  `NakliTechie/LocalMind`, `xen0bit/smolbox`, `fstandhartinger/bonsai-swarm`. smolbox measured,
  on an RTX 4070 Ti SUPER without `shader-f16`: load 31–37 s from disk, decode 40–47 tok/s,
  prefill only 37–51 tok/s. (Third-party numbers, not ours.)
- **Repo gaps:**
  - `GpuScheduler` (`apps/game/src/llm/gpu-scheduler.ts`) has no renderer hook: scene quality is
    fixed at scene creation in `apps/game/src/main.ts`.
  - FEAT-038 and FEAT-040 `paths` named files that do not exist (`capability.ts`,
    `scheduler.ts`); the files are `capabilities.ts` and `gpu-scheduler.ts`.
  - The Rust `ModelEntry` (`crates/agents/src/models.rs`) is `deny_unknown_fields`, so new
    `config/models.toml` keys break it.
  - Nothing in `apps/game/src/llm/` is imported by the game session except types, `FakeLlm`,
    `StructuredOutputError` and the MVP script. `apps/game/src/session/session.ts` wires
    `unwiredLlm()`, which fails every call unless `?llm=fake`.

## 2. Bundle architecture

### Pins (computed at Space sha `94320c9da2b7aeac5b5807c9e61d696a3c09edb5`, last modified 2026-09-17)

| Item | Value |
|---|---|
| `index.html` | 1,553,969 bytes, sha256 `4422addfa476ebd81195a77cd259038c4c5d56c87fc053c2387de02e065f1918` |
| Engine slice | 1,429,458 bytes, sha256 `d94c1729d7a7f084d2a2887f39487f3d27e6e296dea93def54495a5d1b9c29f6` |
| Model revision | `b072e1d3b35a0a630cece372c2127528e0994386` |
| PTQ1_0 file `Ternary-Bonsai-2-27B-PTQ1_0.gguf` | 5,946,648,928 bytes, sha256 `53107f530aa52eb00912263ab1ee29bd199261c87cd7b4ad4ca1318c1fe33ee3` |

The Space holds only `.gitattributes`, `README.md` (no `license` field) and `index.html`. Fetch
with `curl -sL https://huggingface.co/spaces/webml-community/ternary-bonsai-2-webgpu-kernels/resolve/<sha>/index.html`.

### Module boundaries (read in code)

- **Script 1 (79 KB)** is the landing animation. It owns its own `requestDevice()` and publishes
  `window.PrismBootReady`.
- **Script 2** is the engine, then the UI. The UI tail starts `const Dm=zl,…`, awaits
  `window.PrismBootReady` and calls `document.getElementById` at top level, so the whole script
  cannot load in a Worker.
- **The engine slice** has no static imports, no `eval`, no `import.meta`, no `localStorage`.
  All `document` uses sit inside the exported UI helpers (`createAssistantMarkdown`,
  `initKernelsOverlay`).
- Inside the engine: a device/limits normaliser, a Jinja engine, a tokenizer, a GGUF reader, a
  kernel library of 99 `.wgsl.jinja` templates (for example
  `ops/_shared/reduce-arg-axis-split-combine.wgsl.jinja`), and a graph runtime labelled
  `webgpu-ml-runtime`. Ops are namespaced `com.xenova.*`, `co.huggingface.*`, `ai.onnx.*`.
- The model class is `Qwen3_5` (`static MODEL_NAME="Qwen3_5"`); `forward()` throws and only the
  token path exists.

### Public surface (read in code)

- `TernaryBonsai2.checkAvailability(id, opts)` and `TernaryBonsai2.load(id, opts)`.
- **Load options:** `file`, `revision` (default `"main"`), `accessToken`, `fetch`, `signal`,
  `cache`, `force`, `cacheName`, `maxLength`, `chatTemplateArgs`, `primeSystemPrompt`,
  `prefixSnapshotStore`, `decodePipelineDepth`, `runtime`, `runtimeOptions`, `onProgress`.
- **Progress events:**
  `{status:'init'|'tokenizer'|'weights'|'ready', kind:'bytes'|'tensors', loaded, total, fromCache, message}`.
- **Session fields:** `model`, `tokenizer`, `eosTokenIds`, `generationState`,
  `chatTemplateArgs`, `runtime`, `thinkOpenTokenId`, `thinkCloseTokenId`, `contextLength`,
  `contextFull`, `lastAssistantContent`.
- **Session methods:** `renderPrompt`, `encodePrompt`,
  `generate(messages, {maxNewTokens, eosTokenId, signal})` yielding `{token, delta, text}`,
  `complete`, `streamTokens({suffixIds, maxNewTokens, eosTokenId, stopOnEos})`,
  `primeSystemPrefix`, `tuneDecodePipeline`, `benchmark`, `benchmarkFixedTokenIds` (returns
  `{ttftMs, decodeTps, tokens, ids}`), `deviceInfo`, `reset`, `resetCache`, `dispose`,
  `acquireGenerationLease`.
- **Defaults:** context `px=16384`, max new tokens `hx=4096`.
- `renderPrompt` hard-codes `tools:null`. Not a problem for JSON output.

### Thinking, budget, stop, abort (read in code)

- Thinking is controlled only through `chatTemplateArgs`, which is spread into the template
  render. `reasoning_effort` passes through the same way.
- There are no stop strings; stopping is by EOS ids and `maxNewTokens`.
- Abort is checked between yielded tokens (`if(t.signal?.aborted)return`). The `finally` then
  calls `resetCache()`, so an abort discards the whole cache. A pipelined GPU batch already
  queued still completes.
- Decode is pipelined: steps are queued with the next input taken from the previous step's
  on-GPU argmax (`submitStep(G===0?R:null, …)`). Depth is calibrated at load, between `Au=4` and
  `du=64`.

### Cache behaviour (read in code)

- The cache has one rewind point. `canTruncateTo(t)` is true only for 0, the current length, or
  `rewindPointLength`, because the linear-attention layers carry recurrent state.
- `captureRewindPoint`, `exportPrefixSnapshot` and `importPrefixSnapshot` are public on
  `generationState.cache`.

### Weights (read in code; sizes from the GGUF header parse)

- Fetch uses Range requests (`Range: bytes=${f}-${p-1}`), coalesced to at most 24 MiB (`Y1`)
  with a 1 MiB gap (`J1`), a 96 MiB in-flight budget (`e3`) and concurrency 32 (`t3`).
- Chunks are cached in IndexedDB `gguf-cache-v1` (stores `chunks`, `meta`) as Blobs keyed
  `[url, begin, end]`. The header goes to Cache Storage `gguf-v1-headers`.
- Staleness is checked by ETag or by the 40-hex revision in the URL (`resourceIdentity`).
- Large tensors use "direct destinations": a `mappedAtCreation` buffer filled straight from the
  response body, so there is no full-file `ArrayBuffer`.
- Weights are sharded by `min(maxBufferSize, maxStorageBufferBindingSize)`.
- The runtime tracks GPU bytes: `runtime.host.memory.{liveBytes, peakBytes}`.
- **Header facts:** 851 tensors, 64 blocks (16 full-attention, 48 linear), hidden 5120, vocab
  248,320, context 262,144. The largest tensors are `output.weight` and `token_embd.weight` at
  278 MB each; the header itself is 11.1 MB.
- **Inferred transient peaks:** about 278 MB of host memory on a cached read of those two
  tensors, plus roughly one shard of mapped memory.
- **Inferred KV cache at 16K context:** about 1.1 GB at f16 or 2.1 GB at f32. The dtype was not
  confirmed.

### Device (read in code)

- `requestAdapter({powerPreference:'high-performance'})`, then every available feature from
  `["shader-f16","subgroups","subgroup-size-control","chromium-experimental-subgroup-matrix","timestamp-query",…]`.
- It requests adapter-maximum `maxBufferSize`, `maxStorageBufferBindingSize`,
  `maxStorageBuffersPerShaderStage` and `maxComputeWorkgroupStorageSize`.
- Device loss is reported only through an optional `runtimeOptions.diagnosticSink`; there is no
  recovery. The raw device is reachable as `session.runtime.host.device`.
- The fastest prefill kernels declare
  `requires:{features:["shader-f16","subgroups","chromium-experimental-subgroup-matrix"]}`.
  Others need only `shader-f16`.

### Worker compatibility

- The engine slice evaluates without DOM (read), and three third-party Workers run it.
- `Ai()` yields with `requestAnimationFrame` when it is a function. Dedicated Workers have rAF,
  and it could not be confirmed that it fires while the tab is hidden. **Set
  `self.requestAnimationFrame = undefined` before import** to force the `setTimeout` path.
- Tuning flags are read from `globalThis.process.env` (`he()`), some at module init. **Define
  `process = {env:{…}}` with no `versions` before import.**

### Sibling modules

- `gemma-4-e2b.js` (Space `webml-community/gemma-4-webgpu-kernels`, about 552 KB, with
  `index.html` and `landing.js`) is the same family ("Gemma-4 E2B (QAT mobile) WebGPU chat
  bundle. Import { Gemma4Mobile } from this file."). It has no GGUF loader and no `qwen35` code.
- The other Spaces follow the same pattern (`Lfm2Mobile`, `Bonsai27B`, `MuseGlimmer30B`):
  `lfm2-webgpu-kernels`, `muse-glimmer-webgpu-kernels`, `bonsai-webgpu-kernels`,
  `bonsai-ternary-webgpu`.
- A GitHub fork of the Gemma Space exists (`willaaam/gemma-4-E2B-webgpu-vision`, claims MIT for
  its own repo) and builds a multi-app workstation on the kernel, including staged
  "JSON outline → one bounded section at a time" generation.
- **No standalone Bonsai module exists anywhere:** not in the Space file lists, not in
  `@huggingface/transformers` 4.3.0 `dist` (zero hits for `webgpu-ml-runtime`, `wgsl.jinja`,
  `com.xenova`), and on GitHub only as third-party extractions.

## 3. Licence and redistribution (not legal advice)

- **Bundle and Spaces:** zero occurrences of licence, copyright or SPDX text; the README has no
  `license` field.
- **Model:** Apache-2.0, with a NOTICE asking for attribution ("Created using Bonsai by Prism
  ML.") and crediting Qwen3.8-27B.
- **Hub terms:** a public repo grants each User a licence to use, reproduce, distribute and make
  derivative works "through our Services and functionalities". That does not extend to a GitHub
  repo or a deployed site.
- **Embedded libraries:** the bundle visibly embeds Hugging Face Jinja and tokenizers code with
  notices stripped.

**Decision (ADR-0057):**

1. **Do not commit the engine.** Commit only our own extractor, a lock file with the hashes
   above, and a hand-written `.d.ts`.
2. **Fetch at setup into a git-ignored directory.** This is enough for Phase A on the owner's
   machine.
3. **Do not reimplement:** 99 kernels and ternary packing are months of work.
4. **Fallback if no licence arrives:** the Transformers.js path (Apache-2.0).

**Open decisions for the owner (later, not now):**

- Whether a deployed build may serve the file. Serving it is redistribution.
- The alternative is to have the player's browser fetch the pinned Space page and cut it
  client-side. This is technically feasible: the pinned `resolve/<sha>` URL echoes the request
  Origin in `Access-Control-Allow-Origin`, and the cut is hash-verified before `import()`.
- Whether GPL-3.0 plus an unlicensed runtime dependency is acceptable for release.

**Ask upstream** (Xenova, via discussion #4 on the Gemma Space and a new one on the Bonsai 2
Space):

- A licence, MIT or Apache-2.0.
- A standalone versioned module.
- Three hooks: a soft-fail in `#m`; pass-through of `source`/`chunkCache` in `load`; a
  logits-bias input before ArgMax.

## 4. Extraction design

| Option | Verdict |
|---|---|
| (a) Unmodified page in a hidden iframe | Rejected. It runs on the main thread, starts a third WebGPU device for the animation, needs a hold gesture and has no `postMessage`. |
| (b) Mechanical split | **Chosen.** One cut at the export statement. |
| (c) Rebuild on the sibling module | Not possible; it does not support Bonsai. |

### The cut

Anchor on the exported name, not on minified identifiers:
`/export\{[^}]*\bas TernaryBonsai2\b[^}]*\};/` must match exactly once. Reject the result if it
contains a static import or `PrismBootReady`, or if the hash differs from the lock.

### No patches

Drive the public low-level surface instead of `generate()`:

- `renderPrompt` → `tokenizer.encode` → `streamTokens`, with our own prefix ledger.
- This avoids the `#m` throw, gives stop handling and thinking control, and survives rebuilds
  better than marker patches.
- LocalMind's one-line `try/catch` patch is the fallback.

### Prefix reuse

- Send one merged system message, identical across staff where possible.
- Compute the system prefix by string-cutting a full render at `<|im_start|>user`.
- Prefill it once, call `captureRewindPoint()`, and keep two or three `exportPrefixSnapshot()`
  results in Worker memory keyed by prefix hash.
- Estimated snapshot size: about 150 MB of recurrent state plus about 64 KB per prefix token
  (inferred from the header dimensions).
- Always pass `reasoning_effort:'medium'` when thinking is on, so the prefix is byte-identical in
  both modes.
- Pass `prefixSnapshotStore:null` and a pinned `decodePipelineDepth`.

### Files (all under `apps/game/`)

- `src/llm/runtime/bonsai/extract.ts`, `runtime.lock.json`, `upstream.d.ts`
- `src/llm/runtime/bonsai/bonsai-llm.ts`, `prefix-ledger.ts`, `think.ts`
- `src/llm/runtime/bonsai/manifest/ternary-bonsai-2-27b-ptq1_0.json`
- `scripts/bonsai-runtime.mjs`, writing to git-ignored `public/vendor/bonsai/`
- The Worker loads it with `import(/* @vite-ignore */ url)`.

### Upstream tracking

- The lock holds the Space sha, the HTML sha256, the engine sha256 and the model revision. A
  bump is a change that re-runs the equivalence test and the benchmark.
- **Equivalence test:** a main-thread reference page calls upstream's own
  `benchmarkFixedTokenIds` on five fixed prompts for 64 tokens. The Worker adapter must return
  identical ids.
- Goldens are keyed by adapter and feature set, because kernel variants differ per GPU.
- On each pin bump, run the same check once by hand on the real demo page through
  `window.__bonsai2`.

### Protocol changes (`protocol.ts`, `worker-host.ts`, `client.ts`, `worker.ts`, `types.ts`)

- `ModelSpec.adapter` gains `'bonsai-kernels'`, plus `file`, `revision`, `sha256`, `context` and
  `runtime:{url, sha256}`.
- `WireGenerateOptions` gains `thinking:'off'|'medium'|'xhigh'`, `reasoningBudget`,
  `answerPrefix`, `stopOnJsonEnd`, `prefixKey`.
- `Usage` gains `prefillMs`, `ttftMs`, `reasoningTokens`, `cachedPromptTokens`.
- New commands: `probe`, `bench`, `resetSession`.
- New unsolicited event: `{type:'event', kind:'device-lost'|'gpu-error'}`.
- Deltas are batched to 50 ms or more.
- `build(spec)` lazy-imports the adapter so the Bonsai Worker never loads onnxruntime.
- `LocalLlm` (`apps/game/src/llm/types.ts`) gains optional `capabilities()` (with
  `supportsConstrainedOutput:false`) and `resetSession()`. No rename to the concept document's
  `LocalAgentRuntime` yet.

### Weight caching

- **Phase A:** keep the bundle's IndexedDB cache. It already does Range, per-chunk resume and
  identity checks.
- Add a pinned `revision` and one HEAD check that `x-linked-etag` equals the manifest sha256 and
  `x-linked-size` matches. Both headers are exposed cross-origin (checked).
- **Post-go (concept document Phase D):** an OPFS store of 64 MiB chunk files with per-chunk
  sha256 from our own manifest, since the Hub publishes only a whole-file hash.
- Feed it to the engine with no patch: `cache:false` plus a custom `fetch` that answers HEAD and
  returns a 206 backed by `file.slice().stream()`.

### `config/models.toml`

Update only existing keys on `ternary-bonsai-2-27b`: real `hf_repo`, `dtype="PTQ1_0"`,
`size_bytes`, `sha256`, `context=16384`. Everything else lives in the manifest JSON (the Rust
`ModelEntry` rejects unknown fields).

### Single-tab ownership

`electLeader` (`apps/game/src/llm/leader.ts`) locks per company. Model residency is per origin,
so add an origin-wide lock (`companyId:'__resident__'` or a `lockName` option).

### Device loss

Listen on `session.runtime.host.device.lost`. Reject in-flight calls as `Unavailable`, dispose,
and reload on demand.

### Coexistence with Babylon

- Two devices are fine: Babylon on the main thread, the engine in the Worker.
- Pacing between tokens does not free a queue that is already pipelined. The lever is pipeline
  depth.
- `RendererHooks` needs a real implementation before `GpuScheduler` can act. Phase A only
  measures, at fixed `?quality=` tiers (`apps/game/src/render/postfx.ts`: low, medium, high).

## 5. Structured output without constrained decoding

The seam: `OrchestratorLlm.complete(requestJson)` via `localLlmBridge(llm: LocalLlm)` in
`apps/game/src/orchestrator/bridge.ts`. Request contract:

```
{kind:'generate'|'structured',
 request:{profile:{job,role,seniority,staff_id}, system:string[],
          messages:[{role:'user'|'assistant', text}], max_tokens},
 schema?}
→ {text} | {value} | {error:{Refusal|Truncated|InvalidOutput|Unavailable|Backend}}
```

### Thinking and budgets (max tokens from `crates/agents` and `crates/orchestrator`)

| Call | Rust `max_tokens` | Thinking | Reasoning cap | Notes |
|---|---|---|---|---|
| Moderator pick | 512 | off | – | Answer prefix `{` |
| Meeting turn | 600 | off | – | – |
| Meeting outcome | 2000 | medium | 1024 | – |
| Review | 4096 | medium | 2048 | – |
| Draft | 16000 | medium | 1500 | Does not fit a 16K context; needs staging ([mvp-pipeline.md](mvp-pipeline.md) §1) |

- Effective `maxNewTokens` is the reasoning cap plus the answer budget.
- At the cap, stop the stream and resume with `suffixIds` that inject `</think>\n\n`. The bundle
  has no reasoning budget of its own.
- This needs a test of the cache state on early stop: smolbox reports the last yielded token is
  not fed back at a stop.

### Answer extraction

Split on `thinkCloseTokenId`, not on text. The output starts inside the think block with no
opening tag, so `stripReasoning` in `apps/game/src/llm/structured.ts` never matches.

### Stops

- Use the EOS ids, the existing `applyStop`, and an early stop when the root JSON value balances.
- After an early stop or a cancel, truncate to the rewind point.

### Answer prefix

Appending `{` to the prompt tokens forces an object start. For flat schemas, alternate forced
literals and free spans. This gives structural validity with no kernel change. Inferred; needs
measuring.

### Validator gap

- The current article schema uses `anyOf` for body blocks (`crates/orchestrator/src/article.rs`).
  The TypeScript subset validator in `structured.ts` ignores it, so a bad block passes the
  JavaScript repair loop and then fails in Rust with no repair turn.
- **Fix:** export the Rust validator from `crates/orchestrator-wasm/src/lib.rs` and inject it as
  `StructuredOptions.validate` through `localLlmBridge`:
  `#[wasm_bindgen(js_name = validateJson)] pub fn validate_json(schema_json: &str, value_json: &str) -> Result<Vec<String>, JsError>`
- Prefer this to adding `anyOf` in TypeScript: one validator and the same error text.

### Repairs and truncation

- Repair turns run with thinking off and `preserve_thinking` true, so the rendered history
  extends the cache and only the repair message is prefilled.
- Repair turns send back only the stripped answer, never the reasoning (the current
  `structured.ts` appends the whole previous output, which overflows an 8–16K context on the
  first repair).
- If the answer hits the length limit, retry once with thinking off, then return
  `{error:{Truncated:{partial}}}`. Never report success with a partial.
- `temperature` is ignored by this backend. Repeats are deterministic, so validity must be
  measured over distinct prompts.

### Logit masking (not Phase A)

- The insertion point exists. The GGUF lists `output.weight` in `prism.hadamard.weight_names`,
  so the head path in `ki` is a matmul into a `[1, vocabSize]` float32 logits tensor, then
  `ai.onnx.ArgMax`.
- It would need a patch to minified graph emission (or an upstream hook), a per-step mask
  upload, pipeline depth 1, and a token-level JSON automaton over 248K tokens.
- Estimate: one to two weeks, and fragile.

## 6. Chrome Prompt API adapter

- **File:** `apps/game/src/llm/chrome-prompt-llm.ts`, implementing `LocalLlm` on the main thread
  (the API is unavailable in Workers).
- **Load:** `LanguageModel.availability(opts)`, then
  `create({initialPrompts:[{role:'system',…}], monitor})`. Creation needs a user gesture when a
  download is pending.
- **Sessions:** keep two or three base sessions keyed by system-prompt hash. `clone()` per call
  and destroy afterwards.
- **Structured:** `prompt(messages, {responseConstraint: schema, signal})`, then the same Rust
  validator. On an unsupported schema, fall back to `runStructured`.
- **Limits:** read the session's reported quota and usage. Feature-detect both the
  `inputQuota`/`measureInputUsage` and the `contextWindow`/`measureContextUsage` names; which
  one Chrome 154 ships was not confirmed.
- **Over-quota:** fail loudly with `Backend("context window exceeded …")`. The 8K fixture will
  likely report this for Nano.
- **Output cap:** there is no output-token option. Enforce by abort and report `length`.
- **Labelling:** backend id `chrome-prompt-api`, shown as "Chrome built-in AI (browser-managed)",
  recorded with the Chrome version.
- **Selection:** `apps/game/src/llm/backend.ts` reads `?llm=fake|bonsai|chrome|transformers` or
  the company's stored choice. One backend per company session. A failed probe opens a blocking
  notice and **never switches backend**.

## 7. Qualification harness and report

### Harness

- `apps/game/bench.html` with `apps/game/src/llm/bench/{harness,fixtures,report}.ts`.
- `apps/game/e2e/bonsai-bench.spec.ts` with `playwright.bonsai.config.ts`: `channel:'chrome'`,
  headed, persistent profile, gated by `BONSAI_E2E=1`.
- Output: `artifacts/bench/model-eval-<backend>.<machine>.json` and
  `frame-time-llm-<tier>.json`, in this repo's `cockpit.benchmark.v1` format (see
  `docs/guides/testing.md` and `cockpit.toml`; both match the existing `bench/model-eval` and
  `bench/frame-time` globs).
- `artifacts/` is git-ignored. **Frozen qualification reports are committed under
  `docs/qualification/`.**

### Fixtures (at least 50 distinct prompts each for validity)

- Short structured action, 1–2K in, 128 out or fewer.
- 2K prompt with a short answer.
- 8K context inspection.
- One section, about 300 words as JSON blocks.
- Staged article: outline, five sections, review.
- Meeting turn.
- Device loss, by `device.destroy()` and by `chrome://gpucrash`.

### Metrics

- Load stages, separately for cold and warm.
- TTFT, prefill and decode tok/s, reasoning tokens.
- First-attempt and after-repair validity; repairs per call.
- `host.memory.peakBytes`, `performance.measureUserAgentSpecificMemory()` (the page is
  cross-origin isolated), and GPU-process RSS sampled from Node.
- Frame p50/p95 per quality tier, idle and generating, and against pipeline depth.
- Equivalence mismatches (deterministic, gating). Timing metrics are environment-sensitive.

### Go/no-go thresholds for the M3 Max (**proposed, unmeasured**)

| Metric | Go | No-go |
|---|---|---|
| Warm start to ready | 60 s p50 or less | over 120 s |
| Prefill rate | 300 tok/s or more | under 100 tok/s |
| Decode rate, scene at medium | 20 tok/s or more | under 10 tok/s |
| Short action | p50 under 10 s, p95 under 20 s | p50 over 20 s |
| Valid after one repair or fewer | 98% or more, with 90% or more first attempt | under 90% |
| Section, about 300 words | p50 60 s or less, 95% valid | – |
| Staged article | p50 8 min or less | over 15 min |
| Meeting turn | TTFT 3 s or less, total 8 s or less | – |
| Frame p95 while generating | 33 ms or less at the scheduler's tier | over 50 ms at low |
| Full-suite runs without device loss | 95% or more of 20 | under 80% |
| GPU peak at 16K context | 12 GB or less | – |
| Equivalence mismatches | 0 | any |

A prefill rate between 100 and 300 tok/s is conditional: it requires prefix snapshots and
contexts of 4K or less.

### Fallback ladder

1. Same model, retuned: 8K context, thinking off, pinned depth, `QWEN35_NO_PREFILL_GRAPH`,
   Chrome flags (labelled as required).
2. PQ2_0 through the same module. The code handles `PRISM_PQ2_0`; untested.
3. A smaller `qwen35`-architecture GGUF through the same module. Inferred from the format
   tables; untested.
4. Gemma-4 E2B or LFM2 need their own modules with the same licence problem, and LFM2 is too
   small for articles.
5. The existing Transformers.js Qwen3-4B path (`apps/game/src/llm/transformers-llm.ts`), which is
   licence-clean.
6. Chrome Prompt API as a labelled mode.

## 8. Increments (track R of `docs/mvp.md`)

Sizes: S is up to a day, M two to four days, L one to two weeks. The review's own numbering
(A0–A8) maps to the plan's R ids as shown.

| Plan id | Review id | Increment | Files | Proof | Size |
|---|---|---|---|---|---|
| Z3 | A0 | Pins, ADR, cleanup | ADR-0057 (amends 0024, 0026, 0027, 0054); delete `apps/game/src/llm/job-runner.ts` and its test, drop the export in `index.ts`; fix FEAT-038/040 paths; `runtime.lock.json`; upstream licence request | vitest, `cockpit validate --strict` | S |
| R1 | A1 | Extraction tooling | `extract.ts`, `scripts/bonsai-runtime.mjs`, `.gitignore`, `upstream.d.ts`, `runtime.lock.json` | `extract.test.ts` on synthetic HTML; script reproduces the hashes above | S |
| R2 | A2 | Worker adapter and protocol | `bonsai-llm.ts`, `prefix-ledger.ts`, `think.ts`, the protocol/client/worker files, `config/models.toml`, `registry.default.ts` | Unit tests against a fake session; gated e2e: load, stream, cancel in a Worker | M |
| R3 | A3 | Upstream equivalence | Reference page and spec | Zero mismatched ids on five prompts | S |
| R4 | A4 | Structured policy | `validateJson` in `crates/orchestrator-wasm`, `structured.ts`, `bridge.ts` | Rust and vitest: an `anyOf` violation now repairs; reasoning-cap test | M |
| R5 | A5 | Chrome adapter | `chrome-prompt-llm.ts`, `backend.ts` | Contract tests with a fake `LanguageModel`; manual run | S–M |
| R6 | A6 | Harness and reporters | `bench.html`, `src/llm/bench/*`, Playwright config, `cockpit.toml` | Documents appear in `cockpit doctor` | L |
| R7 | A7 | Run and decide | Benchmark documents, report under `docs/qualification/`, ADR update, `eval_pending=false`, FEAT-037/038 to in-progress | Thresholds table filled with measurements | S |
| R8 | A8 | On go: session wiring | `session.ts` (`unwiredLlm` → backend), startup flow (explain, probe, storage check, download, verify, warm up, qualification turn), origin-wide lock, loss surface, real `RendererHooks` | The MVP e2e with `?llm=bonsai` (gated) | M |

**Reuse, do not redesign:** `apps/game/src/llm/{types,client,worker,protocol,worker-host,registry,registry.default,capabilities,gpu-scheduler,leader,download,structured}.ts`,
the harness page `apps/game/llm.html` with `e2e/llm.spec.ts` (tiny random model, gated by
`LLM_E2E=1`).

**Retired:** `apps/game/src/llm/job-runner.ts` (dead code from the offer/claim/lease protocol
that ADR-0038 retired).

**Deferred past the go decision:** the OPFS chunk store, tab takeover, logit masking.

## 9. Main risks, highest first

1. Prefill speed on Chrome/Metal, and whether `chromium-experimental-subgroup-matrix` is exposed
   without flags.
2. Licence.
3. Thinking latency against small budgets.
4. Greedy-only looping.
5. The 16K context against a 16,000-token draft budget (resolved by staging).
6. Upstream rebuilds changing minified names (mitigated by the name anchor, the lock and the
   equivalence test).
7. Transient memory during upload.
8. Worker rAF while the tab is hidden.

## 10. Unverified assumptions

- M3 Max feature exposure in Chrome 154.
- KV dtype and all memory estimates.
- Cache consistency after an early stop.
- The `responseConstraint` schema subset and the Prompt API property names.
- That a hidden tab keeps the WebGPU Worker running at useful speed.
- All thresholds in §7 are proposals until R7 fills them with measurements.

## 11. Model card facts worth keeping at hand

From `prism-ml/Ternary-Bonsai-2-27B-gguf` (read 2026-10-02):

- Base Qwen3.8-27B; 27.36B parameters (24.35B backbone in 64 blocks + 2.54B embedding/head);
  hybrid attention (about 75% linear, 25% full), SwiGLU, RoPE, RMSNorm; context 262K.
- Files: `PTQ1_0` 5.95 GB (1.75 bits/weight), `PQ2_0` 7.21 GB (2.13), `F16` 53.8 GB; vision
  projector `mmproj` 629–931 MB (not used).
- "Stock llama.cpp will not run these files." The supported native runtimes are the
  PrismML-Eng llama.cpp fork (Metal, CUDA) and MLX. **A native server is not an option here**
  (ADR-0057).
- Known issues relevant to us: the model reasons at length before answering and needs large
  output budgets; tool calls can be malformed or loop; a system message must come first.
- Native throughput figures on the card (about 47 tok/s on an M5 Max) are **not** browser
  forecasts.
