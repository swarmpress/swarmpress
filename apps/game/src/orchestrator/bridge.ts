/**
 * JS sides of the orchestrator-wasm bridge (crates/orchestrator-wasm) that do
 * not depend on Vite: the LLM adapters, the job/outcome shapes and the MVP
 * loop driver (the sim's part, until the sim emits `Effect::RequestJob`).
 * Runs in the browser, under Node (vitest) and under Bun.
 */
import type { ChatMessage, LocalLlm, ThinkingMode, Validator } from '../llm/types'
import { StructuredOutputError, StructuredTruncatedError, trimToSentence } from '../llm/structured'
import type { MvpReply } from '../llm/mvp-script'
import { MVP_TEAM } from '../llm/mvp-script'

// ---------------------------------------------------------------- shapes

export type JobKind = 'standup' | 'draft' | 'review' | 'publish'

export interface StaffRef {
  id: string
  persona: string
  role: string
}

/** `orchestrator::JobRequest`; `brief_ref` is a u64 and crosses as a decimal string. */
export interface JobRequest {
  company_id: string
  job_id: number
  kind: JobKind
  project: string
  work_item: string | null
  brief_ref: string | null
  revision: number
  staff: StaffRef[]
}

export interface Digest {
  ok: boolean
  score: number
  words: number
  qa_defects: number
  artifact_sha: string | null
}

export interface BriefOut {
  brief_ref: string
  writer: string
  editor: string
}

/** `orchestrator::Outcome` (externally tagged). */
export type Outcome =
  | { MeetingOutcome: { job_id: number; briefs: BriefOut[] } }
  | { JobCompleted: { job_id: number; digest: Digest } }
  | { DeployLanded: { work_item: string } }

/**
 * The site binding JSON `OrchestratorHandle` takes (`orchestrator::SiteBinding::from_json`).
 * With `knowledge_pack` (the pack JSON text of `GET /api/gateway/knowledge`)
 * the style guide and the writer prompt are the site's own files and the
 * binding carries the site's closed world; `style_guide` and `writer_prompt`
 * are the fallback without a pack (tests, the harness), and without either
 * the house style is empty.
 */
export interface SiteBindingJson {
  site_id: string
  brand_name: string
  language?: string
  knowledge_pack?: string | null
  style_guide?: unknown
  writer_prompt?: unknown
  quality_bar?: number
  simulate_deploy?: boolean
  standup_max_turns?: number
}

/** What `OrchestratorHandle` needs from the wasm module. */
export interface OrchestratorLike {
  run(jobJson: string): Promise<string>
}

/** `agents::LlmRequest` as JSON. */
export interface LlmRequestJson {
  profile: unknown
  system: string[]
  messages: { role: 'user' | 'assistant'; text: string }[]
  max_tokens: number
}

export interface LlmCall {
  kind: 'generate' | 'structured'
  request: LlmRequestJson
  schema?: Record<string, unknown>
}

/** orchestrator-wasm's `OrchestratorLlm`. */
export interface OrchestratorLlm {
  complete(requestJson: string): Promise<string>
  /**
   * Set the validator structured calls repair against. `createOrchestrator`
   * passes the Rust one (`validateJson`) so the browser's repair loop and the
   * Rust re-check agree; without it the subset validator of structured.ts is used.
   */
  useValidator?(validate: Validator): void
}

// ---------------------------------------------------------------- LLM adapters

/** Chat messages for a LocalLlm: the system layers joined, then the conversation. */
export function toChatMessages(req: LlmRequestJson): ChatMessage[] {
  const out: ChatMessage[] = []
  if (req.system.length) out.push({ role: 'system', content: req.system.join('\n\n') })
  for (const m of req.messages) out.push({ role: m.role, content: m.text })
  return out
}

/** How one call uses the model's reasoning and output budget. Adapters without the feature ignore it. */
export interface CallPolicy {
  thinking: ThinkingMode
  /** Cap on reasoning tokens, on top of the answer budget (`max_tokens`). */
  reasoningBudget?: number
  answerPrefix?: string
  stopOnJsonEnd?: boolean
}

/**
 * The default policy for a model without constrained decoding (ADR-0057):
 * free text and short structured picks answer directly; larger structured
 * calls may reason first, within a cap of half their answer budget (at most
 * 2048 tokens). A short pick whose schema is an object is forced to start at
 * `{`. Structured calls stop as soon as their root JSON value is complete.
 */
export function defaultCallPolicy(call: LlmCall): CallPolicy {
  if (call.kind === 'generate') return { thinking: 'off' }
  const max = call.request.max_tokens
  if (max <= 600) {
    return { thinking: 'off', stopOnJsonEnd: true, ...(call.schema?.type === 'object' ? { answerPrefix: '{' } : {}) }
  }
  return { thinking: 'medium', reasoningBudget: Math.min(2048, Math.max(256, Math.round(max / 2))), stopOnJsonEnd: true }
}

/** The Rust schema validator (`validateJson` of orchestrator-wasm) as a `Validator`. */
export function rustValidator(validateJson: (schemaJson: string, valueJson: string) => string[]): Validator {
  return (value, schema) => {
    const errors = validateJson(JSON.stringify(schema), JSON.stringify(value))
    return errors.length ? { ok: false, errors } : { ok: true }
  }
}

export interface LocalLlmBridgeOptions {
  validate?: Validator
  policy?: (call: LlmCall) => CallPolicy
  /** Calls kept in `calls` (prompts are large); older ones are dropped. Default 200. */
  maxCalls?: number
}

/**
 * `agents::Llm` over a LocalLlm (a browser model, or the scripted FakeLlm of
 * `?llm=fake`). Structured calls go through the LocalLlm's own repair loop
 * with the injected validator; the Rust side validates the result against the
 * same JSON Schema again.
 *
 * A free-text turn that hits the token limit is not a failure: it is cut at
 * its last complete sentence and returned (`truncated: true`). Only a turn
 * with no complete sentence at all is `Truncated`.
 */
export function localLlmBridge(llm: LocalLlm, opts: LocalLlmBridgeOptions = {}): OrchestratorLlm & { calls: LlmCall[] } {
  const calls: LlmCall[] = []
  const maxCalls = opts.maxCalls ?? 200
  const policy = opts.policy ?? defaultCallPolicy
  let validate = opts.validate
  return {
    calls,
    useValidator(v: Validator) {
      validate = v
    },
    async complete(requestJson: string): Promise<string> {
      const call = JSON.parse(requestJson) as LlmCall
      calls.push(call)
      if (calls.length > maxCalls) calls.splice(0, calls.length - maxCalls)
      const messages = toChatMessages(call.request)
      const maxTokens = call.request.max_tokens
      const p = policy(call)
      try {
        if (call.kind === 'generate') {
          const r = await llm.generate(messages, { maxTokens, thinking: p.thinking, reasoningBudget: p.reasoningBudget })
          if (r.finishReason === 'length') {
            const text = trimToSentence(r.text)
            if (!text) return JSON.stringify({ error: { Truncated: { partial: r.text } } })
            return JSON.stringify({ text, truncated: true })
          }
          return JSON.stringify({ text: r.text })
        }
        const value = await llm.structured(messages, call.schema ?? {}, {
          maxTokens,
          thinking: p.thinking,
          reasoningBudget: p.reasoningBudget,
          answerPrefix: p.answerPrefix,
          stopOnJsonEnd: p.stopOnJsonEnd,
          ...(validate ? { validate } : {}),
        })
        return JSON.stringify({ value })
      } catch (e) {
        if (e instanceof StructuredTruncatedError) return JSON.stringify({ error: { Truncated: { partial: e.lastText } } })
        if (e instanceof StructuredOutputError) return JSON.stringify({ error: { InvalidOutput: { errors: e.errors } } })
        return JSON.stringify({ error: { Backend: e instanceof Error ? e.message : String(e) } })
      }
    },
  }
}

/** A scripted `OrchestratorLlm` (no LocalLlm in between), recording calls. */
export function scriptedLlm(script: MvpReply[]): OrchestratorLlm & { calls: LlmCall[]; remaining(): number } {
  const queue = [...script]
  const calls: LlmCall[] = []
  return {
    calls,
    remaining: () => queue.length,
    async complete(requestJson: string): Promise<string> {
      const call = JSON.parse(requestJson) as LlmCall
      calls.push(call)
      const next = queue.shift()
      if (!next) return JSON.stringify({ error: { Backend: `script exhausted at call #${calls.length}` } })
      if (call.kind === 'generate') return JSON.stringify({ text: 'text' in next ? next.text : JSON.stringify(next.json) })
      return JSON.stringify('json' in next ? { value: next.json } : { text: next.text })
    },
  }
}

// ---------------------------------------------------------------- the MVP loop (sim side)

export interface MvpLoopStep {
  job: JobRequest
  outcomes: Outcome[]
}

export interface MvpLoopResult {
  briefRef: string
  workItem: string
  steps: MvpLoopStep[]
  /** The merged sha of the publish job. */
  mergedSha: string
}

function completed(out: Outcome[]): Digest {
  const o = out[0]
  if (!o || !('JobCompleted' in o)) throw new Error(`expected JobCompleted, got ${JSON.stringify(out)}`)
  return o.JobCompleted.digest
}

/**
 * Plays the sim's side of the MVP loop (docs/mvp.md) the way
 * `crates/orchestrator/tests/loop.rs` does: standup → work item → draft →
 * review → (score < 7: revision → review) → publish. The quality bar and the
 * revision cap are the sim's rules (ADR-0011); here they are fixed at 7 and 3.
 */
export async function runMvpLoop(
  orch: OrchestratorLike,
  opts: { company: string; workItem?: string; project?: string; staff?: StaffRef[]; onStep?: (s: MvpLoopStep) => void },
): Promise<MvpLoopResult> {
  const workItem = opts.workItem ?? 'work-item-1'
  const steps: MvpLoopStep[] = []
  let jobId = 0
  const job = (kind: JobKind, briefRef: string | null, revision: number): JobRequest => ({
    company_id: opts.company,
    job_id: ++jobId,
    kind,
    project: opts.project ?? 'project-1',
    work_item: kind === 'standup' ? null : workItem,
    brief_ref: briefRef,
    revision,
    staff: opts.staff ?? MVP_TEAM,
  })
  const run = async (j: JobRequest) => {
    const outcomes = JSON.parse(await orch.run(JSON.stringify(j))) as Outcome[]
    const step = { job: j, outcomes }
    steps.push(step)
    opts.onStep?.(step)
    return outcomes
  }

  const standup = await run(job('standup', null, 0))
  const meeting = standup[0]
  if (!meeting || !('MeetingOutcome' in meeting) || meeting.MeetingOutcome.briefs.length === 0) {
    throw new Error(`standup produced no brief: ${JSON.stringify(standup)}`)
  }
  const briefRef = meeting.MeetingOutcome.briefs[0].brief_ref

  for (let revision = 0; ; revision++) {
    const d = completed(await run(job('draft', briefRef, revision)))
    if (!d.ok) throw new Error(`draft ${revision} failed`)
    const r = completed(await run(job('review', briefRef, revision)))
    if (!r.ok) throw new Error(`review ${revision} was not ok`)
    if (r.score >= 7) break
    if (revision >= 3) throw new Error('revision cap reached')
  }
  const last = steps[steps.length - 1].job.revision
  const pub = await run(job('publish', briefRef, last))
  const merged = completed(pub)
  if (!merged.ok || !merged.artifact_sha) throw new Error(`publish failed: ${JSON.stringify(pub)}`)
  return { briefRef, workItem, steps, mergedSha: merged.artifact_sha }
}
