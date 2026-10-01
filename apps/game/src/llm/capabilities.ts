/**
 * Device capability detection and model selection.
 *
 * `detectCapabilities()` reads what the browser exposes (WebGPU adapter
 * limits/info/features, navigator.deviceMemory). WebGPU does not expose VRAM,
 * and Chrome caps deviceMemory at 8, so the VRAM budget is a heuristic:
 * player settings (`vramHintBytes`, `memoryHintGb`) win, then a small table of
 * known discrete GPUs, then vendor/architecture defaults. A tokens/sec probe
 * (`probeTokensPerSec`) can veto a model that loads but is too slow.
 *
 * `chooseModels()` is pure and unit-tested with fixture profiles.
 */
import { TIERS, tierRank, type DeviceTier, type ModelEntry, type ModelRegistry, type Tier } from './registry'
import type { LocalLlm } from './types'

const GiB = 1024 ** 3

export interface AdapterInfoLite {
  vendor: string
  architecture: string
  device: string
  description: string
  isFallbackAdapter: boolean
}

export interface Capabilities {
  webgpu: boolean
  adapter?: AdapterInfoLite
  limits?: { maxBufferSize: number; maxStorageBufferBindingSize: number }
  /** GPU features, e.g. "shader-f16". Undefined = unknown (don't filter). */
  features?: string[]
  /** navigator.deviceMemory (GB, Chrome caps at 8). */
  deviceMemoryGb?: number
  /** Player/settings hint: total system (or unified) memory, GB. */
  memoryHintGb?: number
  /** Player/settings hint: dedicated VRAM, bytes. */
  vramHintBytes?: number
  /** Results of tokens/sec probes keyed by model id. */
  probes?: Record<string, number>
}

export interface SelectionOverrides {
  /** Force a device tier (settings). Models above it are not used. */
  tier?: DeviceTier
  /** Pin a model per role (settings / debug). Ignored if the model is unknown. */
  modelByRole?: Record<string, string>
  vramBudgetBytes?: number
  /** Allow registry entries the eval has not confirmed. Default false. */
  allowEvalPending?: boolean
  /** Minimum acceptable decode speed when a probe exists. Default 4 tok/s. */
  minTokensPerSec?: number
}

export interface ModelSelection {
  tier: DeviceTier
  budgetBytes: number
  /** Eligible models, smallest tier first. */
  eligible: ModelEntry[]
  /** Default model id per role (largest eligible serving that role), null → Agency. */
  byRole: Record<string, string | null>
  /** Why each excluded model was excluded. */
  excluded: Record<string, string>
}

/** Known dedicated-VRAM sizes (GB). Matched against adapter description/device. */
const KNOWN_GPUS: Array<[RegExp, number]> = [
  [/rtx\s*5090/i, 32],
  [/rtx\s*5080/i, 16],
  [/rtx\s*4090/i, 24],
  [/rtx\s*4080/i, 16],
  [/rtx\s*4070\s*ti\s*super/i, 16],
  [/rtx\s*4070/i, 12],
  [/rtx\s*4060\s*ti/i, 8],
  [/rtx\s*4060/i, 8],
  [/rtx\s*3090/i, 24],
  [/rtx\s*3080/i, 10],
  [/rtx\s*3070/i, 8],
  [/rtx\s*3060/i, 12],
  [/rx\s*7900\s*xtx/i, 24],
  [/rx\s*7900/i, 20],
  [/rx\s*7800/i, 16],
  [/arc\s*a770/i, 16],
]

export function isAppleSilicon(a?: AdapterInfoLite): boolean {
  if (!a) return false
  return a.vendor.toLowerCase() === 'apple' || /^(metal|apple)/i.test(a.architecture)
}

export function isIntegrated(a?: AdapterInfoLite): boolean {
  if (!a) return true
  const vendor = a.vendor.toLowerCase()
  const text = `${a.description} ${a.device}`.toLowerCase()
  if (vendor === 'nvidia') return false
  if (vendor === 'intel') return !/\barc\b/.test(text) && !/xe-hpg/i.test(a.architecture)
  if (vendor === 'amd') return /radeon\(tm\) graphics|radeon graphics|vega \d+ graphics|780m|680m|890m/.test(text) || (!/rx\s*\d/.test(text) && !text.trim())
  return true // qualcomm, arm, unknown
}

/** Best-effort bytes of GPU memory we may use for model weights + KV cache. */
export function estimateVramBudget(caps: Capabilities): number {
  if (!caps.webgpu) return 0
  if (caps.vramHintBytes) return caps.vramHintBytes * 0.85
  const a = caps.adapter
  if (a?.isFallbackAdapter) return 0.5 * GiB // software rasteriser (SwiftShader/WARP)
  if (isAppleSilicon(a)) {
    const mem = caps.memoryHintGb ?? caps.deviceMemoryGb ?? 8
    return mem * 0.55 * GiB // unified memory; leave room for the OS, the browser and Babylon
  }
  const text = `${a?.description ?? ''} ${a?.device ?? ''}`
  for (const [re, gb] of KNOWN_GPUS) if (re.test(text)) return gb * 0.8 * GiB
  if (!isIntegrated(a)) return 8 * 0.8 * GiB // unknown discrete GPU: assume 8 GB
  const mem = caps.memoryHintGb ?? caps.deviceMemoryGb ?? 4
  return mem * 0.35 * GiB // integrated GPU shares system RAM
}

function exclusionReason(m: ModelEntry, caps: Capabilities, budget: number, o: SelectionOverrides): string | null {
  if (!caps.webgpu && m.device !== 'wasm') return 'no WebGPU'
  if (m.evalPending && !o.allowEvalPending) return 'eval pending'
  if (o.tier && tierRank(m.tier) > tierRank(o.tier)) return `above forced tier ${o.tier}`
  if (caps.limits) {
    if (m.minMaxBufferSize > caps.limits.maxBufferSize) return 'maxBufferSize too small'
    if (m.minStorageBufferBindingSize > caps.limits.maxStorageBufferBindingSize) return 'maxStorageBufferBindingSize too small'
  }
  if (caps.features && /f16/.test(m.dtype) && !caps.features.includes('shader-f16')) return 'no shader-f16'
  if (m.approxVramBytes > budget) return 'exceeds VRAM budget'
  const tps = caps.probes?.[m.id]
  if (tps !== undefined && tps < (o.minTokensPerSec ?? 4)) return `too slow (${tps.toFixed(1)} tok/s)`
  return null
}

export function chooseModels(caps: Capabilities, registry: ModelRegistry, overrides: SelectionOverrides = {}): ModelSelection {
  const budgetBytes = overrides.vramBudgetBytes ?? estimateVramBudget(caps)
  const excluded: Record<string, string> = {}
  const eligible: ModelEntry[] = []
  for (const m of registry.models) {
    const why = exclusionReason(m, caps, budgetBytes, overrides)
    if (why) excluded[m.id] = why
    else eligible.push(m)
  }
  // A slow probe on a tier vetoes every model at or above that tier.
  const slowTiers = registry.models.filter((m) => excluded[m.id]?.startsWith('too slow')).map((m) => tierRank(m.tier))
  if (slowTiers.length) {
    const cap = Math.min(...slowTiers)
    for (let i = eligible.length - 1; i >= 0; i--) {
      if (tierRank(eligible[i].tier) >= cap) {
        excluded[eligible[i].id] = 'tier vetoed by tokens/sec probe'
        eligible.splice(i, 1)
      }
    }
  }
  eligible.sort((a, b) => tierRank(a.tier) - tierRank(b.tier) || a.approxVramBytes - b.approxVramBytes)

  let tier: DeviceTier = 'agency-only'
  for (const m of eligible) if (tierRank(m.tier) > tierRank(tier)) tier = m.tier

  const roles = new Set(registry.models.flatMap((m) => m.roles))
  const byRole: Record<string, string | null> = {}
  for (const role of roles) {
    const pinned = overrides.modelByRole?.[role]
    if (pinned && registry.models.some((m) => m.id === pinned && m.roles.includes(role))) {
      byRole[role] = pinned
      continue
    }
    const serving = eligible.filter((m) => m.roles.includes(role))
    byRole[role] = serving.length ? serving[serving.length - 1].id : null
  }
  return { tier, budgetBytes, eligible, byRole, excluded }
}

export type Seniority = 'junior' | 'mid' | 'senior' | 'star'

/**
 * Seniority → local model within the device tier (plan D): Junior gets the
 * smallest eligible model for the role, Senior/Star the largest that fits,
 * Mid the one in between.
 */
export function modelForSeniority(sel: ModelSelection, role: string, seniority: Seniority): string | null {
  const serving = sel.eligible.filter((m) => m.roles.includes(role))
  if (!serving.length) return null
  if (seniority === 'junior') return serving[0].id
  if (seniority === 'mid') return serving[Math.floor((serving.length - 1) / 2)].id
  return serving[serving.length - 1].id
}

export function tierAtLeast(t: DeviceTier, min: Tier): boolean {
  return tierRank(t) >= tierRank(min)
}

export { TIERS }

// ---------------------------------------------------------------------------
// Browser detection (not unit-testable without a GPU; covered by e2e).

interface GpuAdapterLike {
  info?: Partial<AdapterInfoLite>
  isFallbackAdapter?: boolean
  limits: { maxBufferSize: number; maxStorageBufferBindingSize: number }
  features: { forEach(cb: (f: string) => void): void }
  requestAdapterInfo?: () => Promise<Partial<AdapterInfoLite>>
}

export async function detectCapabilities(
  hints: Pick<Capabilities, 'memoryHintGb' | 'vramHintBytes'> = {},
  nav: Navigator = navigator,
): Promise<Capabilities> {
  const deviceMemoryGb = (nav as Navigator & { deviceMemory?: number }).deviceMemory
  const gpu = (nav as Navigator & { gpu?: { requestAdapter(o?: object): Promise<GpuAdapterLike | null> } }).gpu
  const base: Capabilities = { webgpu: false, deviceMemoryGb, ...hints }
  if (!gpu) return base
  let adapter: GpuAdapterLike | null = null
  try {
    adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' })
  } catch {
    adapter = null
  }
  if (!adapter) return base
  const info: Partial<AdapterInfoLite> = adapter.info ?? (await adapter.requestAdapterInfo?.().catch(() => ({}))) ?? {}
  const features: string[] = []
  adapter.features.forEach((f) => features.push(f))
  return {
    ...base,
    webgpu: true,
    adapter: {
      vendor: info.vendor ?? '',
      architecture: info.architecture ?? '',
      device: info.device ?? '',
      description: info.description ?? '',
      isFallbackAdapter: Boolean(info.isFallbackAdapter ?? adapter.isFallbackAdapter),
    },
    limits: {
      maxBufferSize: Number(adapter.limits.maxBufferSize),
      maxStorageBufferBindingSize: Number(adapter.limits.maxStorageBufferBindingSize),
    },
    features,
  }
}

/**
 * Quick decode-speed probe: generate for up to `seconds` and report tok/s.
 * Run once per model on first use; store the result in Capabilities.probes.
 */
export async function probeTokensPerSec(llm: LocalLlm, seconds = 10, maxTokens = 128): Promise<number> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), seconds * 1000)
  try {
    const res = await llm.generate(
      [{ role: 'user', content: 'Describe a busy newsroom morning in a few sentences.' }],
      { maxTokens, temperature: 0, signal: ac.signal },
    )
    return res.usage.tokensPerSec
  } finally {
    clearTimeout(timer)
  }
}
