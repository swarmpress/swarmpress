/**
 * Which model backend a company session uses (ADR-0057, ADR-0066, ADR-0067).
 *
 * One backend per company session, chosen explicitly: by `?llm=` on the URL,
 * else by the choice stored for the company, else the default. The choice is
 * never changed behind the player's back: when the chosen backend cannot run
 * on this device, opening it fails with `BackendUnavailableError` and the
 * session shows that; it does not fall through to another backend, and there
 * is no cloud backend to fall through to.
 */
import type { LocalLlm, RuntimeCapabilities } from './types'

export const BACKEND_IDS = ['fake', 'luna', 'gemma', 'bonsai', 'chrome', 'transformers'] as const
export type BackendId = (typeof BACKEND_IDS)[number]

export interface BackendInfo {
  id: BackendId
  /** Shown to the player. */
  label: string
  /** Where the adapter runs; `server`: the central server calls a hosted model (ADR-0067). */
  runsIn: 'worker' | 'window' | 'memory' | 'server'
  /** Registry id of the model it loads; null when the backend has no registry model. */
  modelId: string | null
  description: string
}

export const BACKENDS: Record<BackendId, BackendInfo> = {
  luna: {
    id: 'luna',
    label: 'GPT-6-Luna (hosted)',
    runsIn: 'server',
    modelId: 'gpt-6-luna',
    description: 'OpenAI’s GPT-6-Luna, called by the game server, which holds the key and the company’s daily budget. Nothing is downloaded.',
  },
  gemma: {
    id: 'gemma',
    label: 'Gemma 4 E4B on llama.cpp (in-browser WebGPU)',
    runsIn: 'worker',
    modelId: 'gemma-4-e4b-it-qat',
    description: 'One Gemma 4 E4B model on upstream llama.cpp’s WebGPU backend, in a worker. About 4.2 GB to download once. An opt-in local experiment (ADR-0067).',
  },
  bonsai: {
    id: 'bonsai',
    label: 'Ternary Bonsai 2 (in-browser WebGPU)',
    runsIn: 'worker',
    modelId: 'ternary-bonsai-2-27b',
    description: 'One 27B model on application-controlled WebGPU kernels, in a worker. About 6 GB to download once. A no-go on the qualification machine (ADR-0066).',
  },
  chrome: {
    id: 'chrome',
    label: 'Chrome built-in AI (browser-managed)',
    runsIn: 'window',
    modelId: null,
    description: "Chrome's own on-device model through the Prompt API. Chrome chooses and updates the model and how it runs.",
  },
  transformers: {
    id: 'transformers',
    label: 'Transformers.js (ONNX Runtime Web)',
    runsIn: 'worker',
    modelId: 'qwen3-4b-q4f16',
    description: 'Smaller ONNX models on onnxruntime-web; the licence-clean fallback.',
  },
  fake: {
    id: 'fake',
    label: 'Scripted model (tests)',
    runsIn: 'memory',
    modelId: null,
    description: 'The scripted replies of the MVP test; no model runs.',
  },
}

export const DEFAULT_BACKEND: BackendId = 'luna'

export function isBackendId(v: unknown): v is BackendId {
  return typeof v === 'string' && (BACKEND_IDS as readonly string[]).includes(v)
}

/** `?llm=fake|luna|gemma|bonsai|chrome|transformers`; null when absent. An unknown value is an error, not a default. */
export function backendFromQuery(search: string): BackendId | null {
  const v = new URLSearchParams(search).get('llm')
  if (v === null || v === '') return null
  if (!isBackendId(v)) throw new Error(`?llm=${v}: unknown backend (use ${BACKEND_IDS.join(', ')})`)
  return v
}

/** The company store's key-value part (apps/game/src/store/company-store.ts). */
export interface BackendChoiceStore {
  getKv(key: string): Promise<string | null>
  setKv(key: string, value: string): Promise<void>
}

export const backendKey = (companyId: string) => `llm.backend.${companyId}`

export interface BackendChoice {
  id: BackendId
  source: 'query' | 'stored' | 'default'
}

/**
 * The backend for this page load. `?llm=` wins and is not stored (a test or a
 * one-off trial must not change the company's setting); otherwise the stored
 * choice; otherwise the default.
 */
export async function chooseBackend(o: { search: string; companyId: string; store?: BackendChoiceStore; fallback?: BackendId }): Promise<BackendChoice> {
  const fromQuery = backendFromQuery(o.search)
  if (fromQuery) return { id: fromQuery, source: 'query' }
  const stored = await o.store?.getKv(backendKey(o.companyId))
  if (stored !== null && stored !== undefined) {
    if (!isBackendId(stored)) throw new Error(`the stored model backend "${stored}" is not one this build knows`)
    return { id: stored, source: 'stored' }
  }
  return { id: o.fallback ?? DEFAULT_BACKEND, source: 'default' }
}

/** Record the player's choice for a company. */
export async function storeBackend(store: BackendChoiceStore, companyId: string, id: BackendId): Promise<void> {
  await store.setKv(backendKey(companyId), id)
}

export class BackendUnavailableError extends Error {
  readonly backend: BackendId
  readonly capabilities: RuntimeCapabilities | null
  constructor(backend: BackendId, reason: string, capabilities: RuntimeCapabilities | null) {
    super(`${BACKENDS[backend].label} cannot be used here: ${reason}`)
    this.name = 'BackendUnavailableError'
    this.backend = backend
    this.capabilities = capabilities
  }
}

export interface OpenedBackend {
  info: BackendInfo
  llm: LocalLlm
  capabilities: RuntimeCapabilities
}

/** How each backend's adapter is constructed; the session supplies these (worker, window API, script). */
export type BackendFactories = { [K in BackendId]?: () => LocalLlm | Promise<LocalLlm> }

/**
 * Construct the chosen backend's adapter and probe it. Does not load a
 * model. A missing factory or a failed probe throws `BackendUnavailableError`;
 * no other backend is tried.
 */
export async function openBackend(id: BackendId, factories: BackendFactories): Promise<OpenedBackend> {
  const info = BACKENDS[id]
  const make = factories[id]
  if (!make) throw new BackendUnavailableError(id, 'this build has no adapter for it', null)
  const llm = await make()
  let capabilities: RuntimeCapabilities
  try {
    capabilities = llm.capabilities
      ? await (llm as LocalLlm & { capabilities(modelId?: string): Promise<RuntimeCapabilities> }).capabilities(info.modelId ?? undefined)
      : {
          backend: id,
          label: info.label,
          webgpu: false,
          supportsConstrainedOutput: false,
          supportsPrefixReuse: false,
          supportsVision: false,
          reasoningModes: ['off'],
          contextTokens: null,
        }
  } catch (e) {
    await llm.dispose().catch(() => undefined)
    throw new BackendUnavailableError(id, e instanceof Error ? e.message : String(e), null)
  }
  if (capabilities.unavailable) {
    await llm.dispose().catch(() => undefined)
    throw new BackendUnavailableError(id, capabilities.unavailable, capabilities)
  }
  return { info, llm, capabilities }
}
