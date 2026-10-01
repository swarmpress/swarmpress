/**
 * Model registry: which local models exist, what they need from the device,
 * and which staff roles they may serve.
 *
 * The canonical source is `config/models.toml` (served to clients). Until it
 * is served, `DEFAULT_REGISTRY` (registry.default.ts) has the same shape.
 *
 * TOML shape accepted (snake_case or camelCase keys, `[[model]]` or `[[models]]`):
 *
 *   [[model]]
 *   id = "qwen3-4b-q4f16"
 *   hf_repo = "onnx-community/Qwen3-4B-ONNX"
 *   dtype = "q4f16"
 *   size_bytes = 2_800_000_000
 *   context = 32768
 *   min_max_buffer_size = 1_073_741_824
 *   min_max_storage_buffer_binding_size = 1_073_741_824   # or min_storage_buffer_binding_size
 *   approx_vram_mb = 4200                                  # or approx_vram_bytes
 *   tier = "large"                                         # tiny|small|large|xl (or low|mid|high)
 *   roles = ["writer", "editor"]
 *   eval_pending = false
 *   sha256 = "..."                                         # optional
 */
import { parse as parseToml } from 'smol-toml'

export const TIERS = ['tiny', 'small', 'large', 'xl'] as const
export type Tier = (typeof TIERS)[number]
/** No usable local model: every job goes to the external Agency (Claude). */
export type DeviceTier = Tier | 'agency-only'

/** Legacy/server tier names (config/models.toml from the Rust side) → client tiers. */
const TIER_ALIASES: Record<string, Tier> = { low: 'small', mid: 'large', high: 'xl' }

export function tierRank(t: DeviceTier): number {
  return t === 'agency-only' ? -1 : TIERS.indexOf(t)
}

export function normalizeTier(t: string): Tier {
  if ((TIERS as readonly string[]).includes(t)) return t as Tier
  const alias = TIER_ALIASES[t]
  if (alias) return alias
  throw new Error(`unknown tier "${t}"`)
}

export interface ModelEntry {
  id: string
  hfRepo: string
  /** transformers.js dtype (q4f16, q4, fp16, fp32, q8 ...). */
  dtype: string
  /** Total download bytes for the chosen dtype (weights + tokenizer + config). */
  sizeBytes: number
  /** Usable context length, tokens. */
  context: number
  /** Required GPUAdapter limits.maxBufferSize, bytes. */
  minMaxBufferSize: number
  /** Required GPUAdapter limits.maxStorageBufferBindingSize, bytes. */
  minStorageBufferBindingSize: number
  approxVramBytes: number
  tier: Tier
  /** Staff roles (and "chatter") this model may serve. */
  roles: string[]
  /** True until our eval harness confirms the entry; such models are not auto-selected by default. */
  evalPending: boolean
  sha256?: string
  description?: string
  /** Device override; default 'webgpu'. 'wasm' only for test fixtures. */
  device?: 'webgpu' | 'wasm'
}

export interface ModelRegistry {
  models: ModelEntry[]
}

export function findModel(registry: ModelRegistry, id: string): ModelEntry | undefined {
  return registry.models.find((m) => m.id === id)
}

function pick(o: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) if (o[k] !== undefined) return o[k]
  return undefined
}

function num(o: Record<string, unknown>, field: string, ...keys: string[]): number {
  const v = pick(o, ...keys)
  const n = typeof v === 'bigint' ? Number(v) : v
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) throw new Error(`model ${String(o.id)}: ${field} must be a non-negative number`)
  return n
}

function str(o: Record<string, unknown>, field: string, ...keys: string[]): string {
  const v = pick(o, ...keys)
  if (typeof v !== 'string' || !v) throw new Error(`model ${String(o.id)}: ${field} must be a non-empty string`)
  return v
}

/** Normalise one raw entry (TOML/JSON, snake_case or camelCase) into a ModelEntry. Throws on invalid input. */
export function normalizeEntry(raw: Record<string, unknown>): ModelEntry {
  const id = str(raw, 'id', 'id')
  const vramBytes = pick(raw, 'approx_vram_bytes', 'approxVramBytes')
  const approxVramBytes =
    vramBytes !== undefined ? num(raw, 'approxVramBytes', 'approx_vram_bytes', 'approxVramBytes') : num(raw, 'approx_vram_mb', 'approx_vram_mb', 'approxVramMb') * 1024 * 1024
  const roles = pick(raw, 'roles')
  if (!Array.isArray(roles) || !roles.every((r) => typeof r === 'string')) throw new Error(`model ${id}: roles must be a string array`)
  const device = pick(raw, 'device')
  const entry: ModelEntry = {
    id,
    hfRepo: str(raw, 'hfRepo', 'hf_repo', 'hfRepo'),
    dtype: str(raw, 'dtype', 'dtype'),
    sizeBytes: num(raw, 'sizeBytes', 'size_bytes', 'sizeBytes'),
    context: num(raw, 'context', 'context'),
    minMaxBufferSize: num(raw, 'minMaxBufferSize', 'min_max_buffer_size', 'minMaxBufferSize'),
    minStorageBufferBindingSize: num(
      raw,
      'minStorageBufferBindingSize',
      'min_storage_buffer_binding_size',
      'min_max_storage_buffer_binding_size',
      'minStorageBufferBindingSize',
      'minMaxStorageBufferBindingSize',
    ),
    approxVramBytes,
    tier: normalizeTier(str(raw, 'tier', 'tier')),
    roles: roles as string[],
    evalPending: Boolean(pick(raw, 'eval_pending', 'evalPending') ?? false),
  }
  const sha = pick(raw, 'sha256')
  if (typeof sha === 'string') entry.sha256 = sha
  const desc = pick(raw, 'description')
  if (typeof desc === 'string') entry.description = desc
  if (device === 'wasm' || device === 'webgpu') entry.device = device
  return entry
}

export function validateRegistry(registry: ModelRegistry): ModelRegistry {
  const seen = new Set<string>()
  for (const m of registry.models) {
    if (seen.has(m.id)) throw new Error(`duplicate model id "${m.id}"`)
    seen.add(m.id)
  }
  return registry
}

export function parseRegistryToml(text: string): ModelRegistry {
  const doc = parseToml(text) as Record<string, unknown>
  const list = (doc.model ?? doc.models) as unknown
  if (!Array.isArray(list)) throw new Error('models.toml: expected [[model]] tables')
  return validateRegistry({ models: list.map((m) => normalizeEntry(m as Record<string, unknown>)) })
}

export function parseRegistryJson(value: unknown): ModelRegistry {
  const list = Array.isArray(value) ? value : (value as { models?: unknown })?.models
  if (!Array.isArray(list)) throw new Error('registry JSON: expected { models: [...] }')
  return validateRegistry({ models: list.map((m) => normalizeEntry(m as Record<string, unknown>)) })
}

export interface LoadRegistryOptions {
  /** Where the server serves models.toml. */
  url?: string
  fetchImpl?: typeof fetch
  fallback?: ModelRegistry
  onWarning?: (msg: string) => void
}

/**
 * Fetch and parse `config/models.toml`; fall back to the bundled default on
 * any error (missing file, offline, invalid TOML) with a warning.
 */
export async function loadRegistry(opts: LoadRegistryOptions = {}): Promise<{ registry: ModelRegistry; source: 'remote' | 'default' }> {
  const { DEFAULT_REGISTRY } = await import('./registry.default')
  const fallback = opts.fallback ?? DEFAULT_REGISTRY
  const url = opts.url ?? '/config/models.toml'
  const f = opts.fetchImpl ?? (typeof fetch === 'function' ? fetch.bind(globalThis) : undefined)
  if (!f) return { registry: fallback, source: 'default' }
  try {
    const res = await f(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const text = await res.text()
    const registry = url.endsWith('.json') ? parseRegistryJson(JSON.parse(text)) : parseRegistryToml(text)
    return { registry, source: 'remote' }
  } catch (e) {
    opts.onWarning?.(`model registry: using bundled default (${url}: ${(e as Error).message})`)
    return { registry: fallback, source: 'default' }
  }
}
