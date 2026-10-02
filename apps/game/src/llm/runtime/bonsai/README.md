# Bonsai WebGPU runtime

The in-browser model runtime of the MVP (ADR-0057, FEAT-037/038): Ternary Bonsai 2 27B
(`prism-ml/Ternary-Bonsai-2-27B-gguf`, PTQ1_0) on application-controlled WebGPU kernels, in the
LLM worker, behind the `LocalLlm` interface (`../../types.ts`).

## The engine is not in this repository

The engine comes from the demo Space `webml-community/ternary-bonsai-2-webgpu-kernels`, which
ships one minified `index.html`. It carries **no licence**, and this repository is public, so the
engine is never committed. What is committed:

| File | What |
|---|---|
| `runtime.lock.json` | Pins: Space commit, page hash, engine hash, model revision and file hash |
| `extract.ts` | The cut: the module script up to the `export{… as TernaryBonsai2 …}` statement, verified against the lock |
| `../../../../scripts/bonsai-runtime.mjs` | Fetches the pinned page and writes `public/vendor/bonsai/engine.mjs` (git-ignored) |
| `upstream.d.ts` | Hand-written types of the engine surface we use, read from its code |

```sh
pnpm --filter @swarm-press/game bonsai:runtime              # fetch, verify, write (about 1.5 MB)
pnpm --filter @swarm-press/game bonsai:runtime -- --check   # verify what is on disk
```

Vite copies `public/` into the build, so a build made on a machine where the engine was fetched
serves it at `/vendor/bonsai/engine.mjs`. That is fine on your own machine. Publishing such a
build redistributes the engine and needs a licence from upstream first.

At load the worker fetches that URL, checks its sha256 against the manifest and imports the bytes
it hashed (`importVerifiedEngine`). The weights (5.95 GB) are fetched by the engine itself with
Range requests into IndexedDB; one HEAD request checks the Hub's sha256 and size for the pinned
revision first (`verifyRemoteFile`).

## How the adapter drives the engine

`bonsai-llm.ts` never calls the engine's `generate()`: it throws when a system message is present
and has no reasoning budget or stop conditions. The adapter uses
`renderPrompt` → `tokenizer.encode` → `streamTokens` and keeps its own account of the generation
cache:

- **`think.ts`**: chat-template arguments per reasoning mode (`off`, `medium`, `xhigh`), the
  system-prefix cut, incremental detokenising, and the "root JSON value is complete" detector.
- **`prefix-ledger.ts`**: the cache can only return to 0, stay, or go back to one rewind point
  (the model's linear-attention layers carry recurrent state). The ledger decides per prompt:
  continue, rewind to the system prefix, import a remembered prefix snapshot, prime a new prefix,
  or reset. Reuse is decided by token content, never by a label.
- **Reasoning cap**: the engine has none. At `reasoningBudget` the adapter stops the stream and
  prefills the tokens that close the think block; the model then answers.
- **Decoding is greedy**: the engine has no sampling. `temperature` is ignored and a repeated
  prompt gives the same output.
- **No constrained decoding**: structured output is prompt-and-repair (`../../structured.ts`)
  against the Rust validator (`validateJson` of orchestrator-wasm).

## Tests

| Test | Runs | What |
|---|---|---|
| `*.test.ts` here | vitest, always | Extraction, ledger, think helpers, the adapter against `testing/fake-session.ts`, manifest and lock agreement |
| `e2e/bonsai.spec.ts` | `BONSAI_E2E=1`, headed Chrome | Load in the worker, stream a turn with a system message, prefix reuse, cancel, reasoning |
| `e2e/bonsai-equivalence.spec.ts` | `BONSAI_E2E=1` | The worker adapter generates the same token ids as upstream on the main thread, on five fixed prompts |

```sh
BONSAI_E2E=1 pnpm --filter @swarm-press/game exec playwright test -c playwright.bonsai.config.ts
```

The gated specs need a GPU and download the weights on first run; they are not part of CI.

## Bumping the pin

1. Change `runtime.lock.json` (and the manifest under `manifest/`, which must agree with it).
2. `bonsai:runtime`, then read the new engine for surface changes and update `upstream.d.ts`.
3. Re-run the equivalence spec (zero mismatches is the gate) and the qualification benchmark.
