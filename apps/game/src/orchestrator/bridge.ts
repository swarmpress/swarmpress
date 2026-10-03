/**
 * JS sides of the orchestrator-wasm bridge (crates/orchestrator-wasm) that do
 * not depend on Vite: the LLM adapters, the job/outcome shapes and the MVP
 * loop driver (the sim's part, until the sim emits `Effect::RequestJob`).
 * Runs in the browser, under Node (vitest) and under Bun.
 */
import type { ChatMessage, LocalLlm, ThinkingMode, Usage, Validator } from '../llm/types'
import { MAX_REPAIR_CHARS, repairQuote, StructuredOutputError, StructuredTruncatedError, trimToSentence } from '../llm/structured'
import type { MvpCall, MvpReply } from '../llm/mvp-script'
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

/** `orchestrator::JobFailure`: why a job cannot finish (the sim's names). */
export type JobFailure = 'Model' | 'InvalidOutput' | 'NeedsMedia' | 'NeedsPage' | 'Timeout' | 'Cancelled' | 'Infrastructure'

/** `orchestrator::Outcome` (externally tagged). */
export type Outcome =
  | { MeetingOutcome: { job_id: number; briefs: BriefOut[] } }
  | { JobCompleted: { job_id: number; digest: Digest } }
  | { JobFailed: { job_id: number; reason: JobFailure } }
  | { DeployLanded: { work_item: string } }

/**
 * `orchestrator::ProgressEvent` (ADR-0058 decision 8: counts, never a
 * percentage): one stage of a job. `stage` is `job` for the job as a whole,
 * else `context`, `outline`, `section` (index 0 is the intro, 1…total the
 * body sections), `closing`, `fix`, `retitle`, `revise`, `review`,
 * `review_section`, `review_summary` or `commit`.
 */
export interface ProgressEvent {
  job_id: number
  kind: JobKind
  revision: number
  work_item: string | null
  staff: string | null
  persona: string | null
  role: string | null
  stage: string
  index: number
  total: number
  state: 'started' | 'done' | 'reused' | 'failed'
  detail: Record<string, unknown> | null
}

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
  /** The model's budget for staged jobs: `local` (default), `fake`, or `{context_tokens, reasoning_tokens, chars_per_token}`. */
  llm_profile?: 'local' | 'fake' | { context_tokens: number; reasoning_tokens: number; chars_per_token: number }
  /** The longest review (estimated tokens) read in one call; longer ones are read part by part. */
  review_single_tokens?: number
  /** What follows " | " in an article's `seo.title` (default: the brand name). */
  seo_suffix?: string
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
  /** The answer budget. */
  max_tokens: number
  /** Reasoning allowed on top of `max_tokens` (a staged call reserves both); 0 = answer directly (repair turns). */
  reasoning_tokens?: number
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
 *
 * A staged call (ADR-0058) says its reasoning allowance itself
 * (`reasoning_tokens`, reserved in its context budget): 0 answers directly,
 * more reasons within exactly that cap. A repair turn (the request quotes an
 * earlier answer) answers directly.
 */
export function defaultCallPolicy(call: LlmCall): CallPolicy {
  if (call.kind === 'generate') return { thinking: 'off' }
  const direct: CallPolicy = { thinking: 'off', stopOnJsonEnd: true, ...(call.schema?.type === 'object' ? { answerPrefix: '{' } : {}) }
  const allowance = call.request.reasoning_tokens
  if (call.request.messages.some((m) => m.role === 'assistant')) return direct
  if (typeof allowance === 'number') return allowance > 0 ? { thinking: 'medium', reasoningBudget: allowance, stopOnJsonEnd: true } : direct
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

/** What one bridged call cost (the host's activity log, ADR-0058 decision 9). */
export interface LlmCallRecord {
  kind: 'generate' | 'structured'
  /** The LocalLlm's model id, when it has one. */
  model: string | null
  /** Summed over the model turns of the call (a structured call may repair). */
  promptTokens: number
  completionTokens: number
  reasoningTokens: number
  /** Model turns (1 + the LocalLlm's own repair turns). */
  turns: number
  wallMs: number
  ok: boolean
}

export interface LocalLlmBridgeOptions {
  validate?: Validator
  policy?: (call: LlmCall) => CallPolicy
  /** Calls kept in `calls` (prompts are large); older ones are dropped. Default 200. */
  maxCalls?: number
  /** Hears what every call cost (also settable later as `onCall`). */
  onCall?: (rec: LlmCallRecord) => void
}

/**
 * The LocalLlm with its `generate` metered: every model turn (also those a
 * structured call makes inside the adapter) adds its usage to `sink`. A
 * Proxy, so the adapter's own `structured` (which calls `this.generate`)
 * goes through the meter too.
 */
function metered(llm: LocalLlm, sink: (u: Usage) => void): LocalLlm {
  return new Proxy(llm, {
    get(target, prop, receiver) {
      if (prop === 'generate') {
        return async (messages: ChatMessage[], opts?: Parameters<LocalLlm['generate']>[1]) => {
          const r = await target.generate.call(receiver, messages, opts)
          sink(r.usage)
          return r
        }
      }
      return Reflect.get(target, prop, receiver)
    },
  })
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
export function localLlmBridge(
  local: LocalLlm,
  opts: LocalLlmBridgeOptions = {},
): OrchestratorLlm & { calls: LlmCall[]; onCall?: (rec: LlmCallRecord) => void } {
  const calls: LlmCall[] = []
  const maxCalls = opts.maxCalls ?? 200
  const policy = opts.policy ?? defaultCallPolicy
  let validate = opts.validate
  let turn: Usage[] = []
  const llm = metered(local, (u) => turn.push(u))
  const bridge = {
    calls,
    onCall: opts.onCall,
    useValidator(v: Validator) {
      validate = v
    },
    async complete(requestJson: string): Promise<string> {
      const call = JSON.parse(requestJson) as LlmCall
      calls.push(call)
      if (calls.length > maxCalls) calls.splice(0, calls.length - maxCalls)
      const started = performance.now()
      turn = []
      const out = await answer(call)
      const usage = turn
      bridge.onCall?.({
        kind: call.kind,
        model: local.modelId ?? null,
        promptTokens: usage.reduce((a, u) => a + u.promptTokens, 0),
        completionTokens: usage.reduce((a, u) => a + u.completionTokens, 0),
        reasoningTokens: usage.reduce((a, u) => a + (u.reasoningTokens ?? 0), 0),
        turns: usage.length,
        wallMs: Math.round(performance.now() - started),
        ok: !out.startsWith('{"error"'),
      })
      return out
    },
  }
  async function answer(call: LlmCall): Promise<string> {
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
      // The last answer goes back too, without its reasoning and capped:
      // what agents::structured_with_repair quotes in its repair turn.
      if (e instanceof StructuredOutputError) {
        const quoted = repairQuote(e.lastText, null, MAX_REPAIR_CHARS)
        return JSON.stringify({ error: { InvalidOutput: { errors: e.errors, ...(quoted ? { answer: quoted } : {}) } } })
      }
      return JSON.stringify({ error: { Backend: e instanceof Error ? e.message : String(e) } })
    }
  }
  return bridge
}

/** The fake model's view of a bridged call (`mvp-script.ts`). */
export function mvpCallOf(call: LlmCall): MvpCall {
  return {
    system: call.request.system.join('\n\n'),
    prompt: call.request.messages.find((m) => m.role === 'user')?.text ?? '',
    schema: (call.schema as Record<string, unknown> | undefined) ?? null,
  }
}

/**
 * A scripted `OrchestratorLlm` (no LocalLlm in between), recording calls:
 * replies from `script` first, then from `model` (the brief-driven fake,
 * `createMvpModel()`), if given.
 */
export function scriptedLlm(
  script: MvpReply[],
  model?: { answer(call: MvpCall): MvpReply },
): OrchestratorLlm & { calls: LlmCall[]; remaining(): number } {
  const queue = [...script]
  const calls: LlmCall[] = []
  return {
    calls,
    remaining: () => queue.length,
    async complete(requestJson: string): Promise<string> {
      const call = JSON.parse(requestJson) as LlmCall
      calls.push(call)
      const next = queue.shift() ?? model?.answer(mvpCallOf(call))
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
