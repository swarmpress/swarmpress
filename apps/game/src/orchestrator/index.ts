/**
 * The orchestrator in the browser (docs/architecture/browser-runtime.md):
 * orchestrator-wasm (lazy-loaded, its own module and size budget) wired to
 * the CompanyStore, the central gateway and a LocalLlm.
 *
 * ```ts
 * const store = await openCompanyStore()
 * const orch = await createOrchestrator({ store, gateway: centralGateway(client, () => lease.leaseId), llm: localLlmBridge(llmFromQuery()), site })
 * const outcomes = JSON.parse(await orch.run(JSON.stringify(job)))
 * ```
 */
import type { OrchestratorGateway } from '../net/central'
import type { OrchestratorStore } from '../store/company-store'
import { FakeLlm } from '../llm/fake-llm'
import type { LocalLlm, Validator } from '../llm/types'
import { mvpScriptText } from '../llm/mvp-script'
import { rustValidator, type OrchestratorLike, type OrchestratorLlm, type SiteBindingJson } from './bridge'

export * from './bridge'

type WasmModule = typeof import('orchestrator-wasm')

let wasm: Promise<WasmModule> | null = null

/** Loads and initialises orchestrator-wasm once. */
export function loadOrchestratorWasm(): Promise<WasmModule> {
  wasm ??= import('orchestrator-wasm').then(async (m) => {
    await m.default()
    return m
  })
  return wasm
}

export interface CreateOrchestratorOptions {
  store: OrchestratorStore
  gateway: OrchestratorGateway
  llm: OrchestratorLlm
  site: SiteBindingJson
}

export async function createOrchestrator(o: CreateOrchestratorOptions): Promise<OrchestratorLike & { free(): void }> {
  const m = await loadOrchestratorWasm()
  // The browser's repair loop validates with the validator the Rust side
  // re-checks with, so a value never passes here and fails there unrepaired.
  o.llm.useValidator?.(rustValidator(m.validateJson))
  return new m.OrchestratorHandle(o.store, o.gateway, o.llm, JSON.stringify(o.site))
}

/** The Rust schema validator as a `Validator` (loads orchestrator-wasm). */
export async function loadRustValidator(): Promise<Validator> {
  return rustValidator((await loadOrchestratorWasm()).validateJson)
}

/**
 * The sim's `drain_effects_json()` → job request JSON texts for `run()`
 * (`company_id` added, `brief_ref` as a string; split in wasm so no JS
 * `JSON.parse` rounds the u64).
 */
export async function jobsFromEffects(effectsJson: string, companyId: string): Promise<string[]> {
  return (await loadOrchestratorWasm()).jobsFromEffects(effectsJson, companyId)
}

/** `run()`'s outcomes → one server-command JSON text each, for `Sim.apply_command_json`. */
export async function outcomesForSim(outcomesJson: string): Promise<string[]> {
  return (await loadOrchestratorWasm()).outcomesForSim(outcomesJson)
}

export type LlmMode = 'fake' | 'local'

/** `?llm=fake` → the scripted MVP model; anything else → a real local model (not wired here). */
export function llmModeFromQuery(search: string): LlmMode {
  return new URLSearchParams(search).get('llm') === 'fake' ? 'fake' : 'local'
}

/**
 * The scripted LocalLlm of `?llm=fake`: the MVP script (standup 4 replies,
 * draft, review 6, revision draft, review 8) as model text, so e2e runs are
 * deterministic. Once the script is exhausted every call fails loudly.
 */
export function fakeMvpLlm(): FakeLlm {
  return new FakeLlm({
    script: mvpScriptText(),
    responder: (_m, _o, call) => new Error(`?llm=fake: the MVP script has no reply for call #${call + 1}`),
  })
}

/** The LocalLlm for the current page: `?llm=fake` or `fallback` (the real model runtime, ADR-0024). */
export function llmFromQuery(search: string, fallback: () => LocalLlm): LocalLlm {
  return llmModeFromQuery(search) === 'fake' ? fakeMvpLlm() : fallback()
}
