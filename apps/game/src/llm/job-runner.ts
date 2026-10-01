/**
 * Browser job worker (plan D, "Browser job worker protocol").
 *
 * Consumes JobOffers from an injected transport (the WS protocol lives
 * elsewhere), declines offers above this device's tier, claims the rest one
 * at a time (one GPU), streams token deltas to `progress` (speech bubbles,
 * the feed), validates structured output with an injected validator (later:
 * content-model compiled to wasm) with repair turns, and reports a result or
 * a failure. The server stays authoritative and re-validates every artifact.
 *
 * Only the leader tab (leader.ts) should run a JobRunner.
 */
import { tierRank, type DeviceTier, type Tier } from './registry'
import { runStructured, StructuredOutputError, validateJsonSchema } from './structured'
import type { ChatMessage, JsonSchema, LocalLlm, Usage, ValidationResult } from './types'

export interface JobOffer {
  jobId: string
  kind: string
  /** Staff role whose model should run the job (selects the model via `modelFor`). */
  role?: string
  messages: ChatMessage[]
  /** Present → structured JSON artifact; absent → text artifact. */
  schema?: JsonSchema
  minTier: Tier
  maxTokens: number
  temperature?: number
  /** Higher first. Default 0. */
  priority?: number
}

export interface JobClaim {
  granted: boolean
  leaseMs?: number
  reason?: string
}

export type JobArtifact = { kind: 'text'; text: string } | { kind: 'json'; value: unknown }

export interface JobResult {
  artifact: JobArtifact
  modelId: string | null
  usage: Usage
  repairs: number
}

export type JobFailCode = 'repair_exhausted' | 'generation_error' | 'cancelled' | 'model_unavailable'

export interface JobFailure {
  code: JobFailCode
  message: string
  /** Last raw model output, for the server log (never trusted as content). */
  lastText?: string
}

/** Implemented by the WS client (another module). */
export interface JobTransport {
  /** Subscribe to offers; returns an unsubscribe function. */
  onOffer(handler: (offer: JobOffer) => void): () => void
  claim(jobId: string): Promise<JobClaim>
  progress(jobId: string, delta: string): void
  result(jobId: string, result: JobResult): Promise<void> | void
  fail(jobId: string, reason: JobFailure): Promise<void> | void
  /** Optional: tell the server this client will not take the job (e.g. tier too low). */
  decline?(jobId: string, reason: string): void
}

/** Validates a structured artifact for a job kind. Default: JSON-Schema subset. */
export type JobValidator = (kind: string, value: unknown, schema: JsonSchema) => ValidationResult

export interface SchedulerLike {
  begin(id: string): void
  end(id: string): void
  waitUntilRunnable(): Promise<void>
}

export type JobRunnerEvent =
  | { type: 'declined'; jobId: string; reason: string }
  | { type: 'claim_rejected'; jobId: string; reason?: string }
  | { type: 'started'; jobId: string; modelId: string | null }
  | { type: 'delta'; jobId: string; delta: string }
  | { type: 'repair'; jobId: string; attempt: number; errors: string[] }
  | { type: 'completed'; jobId: string; result: JobResult }
  | { type: 'failed'; jobId: string; failure: JobFailure }

export interface JobRunnerOptions {
  transport: JobTransport
  llm: LocalLlm
  tier: DeviceTier
  /** Pick the model for an offer (e.g. from chooseModels().byRole). null → decline. Omit to use whatever is loaded. */
  modelFor?: (offer: JobOffer) => string | null
  validator?: JobValidator
  maxRepairs?: number
  scheduler?: SchedulerLike
  onEvent?: (e: JobRunnerEvent) => void
}

export class JobRunner {
  private queue: JobOffer[] = []
  private running = false
  private unsubscribe: (() => void) | null = null
  private current: { jobId: string; abort: AbortController } | null = null
  private idleWaiters: Array<() => void> = []
  private stopped = false

  constructor(private o: JobRunnerOptions) {}

  start() {
    this.stopped = false
    this.unsubscribe ??= this.o.transport.onOffer((offer) => this.offer(offer))
  }

  /** Stop listening and cancel the in-flight job (reported as `cancelled`). */
  stop() {
    this.stopped = true
    this.unsubscribe?.()
    this.unsubscribe = null
    this.queue = []
    this.current?.abort.abort()
  }

  get busy(): boolean {
    return this.running
  }

  get pending(): number {
    return this.queue.length
  }

  /** Resolves when the queue is drained and nothing is running. */
  idle(): Promise<void> {
    if (!this.running && this.queue.length === 0) return Promise.resolve()
    return new Promise((r) => this.idleWaiters.push(r))
  }

  /** Accept an offer (also callable directly, e.g. when draining after reconnect). */
  offer(offer: JobOffer) {
    if (this.stopped) return
    const why = this.declineReason(offer)
    if (why) {
      this.o.transport.decline?.(offer.jobId, why)
      this.emit({ type: 'declined', jobId: offer.jobId, reason: why })
      return
    }
    this.queue.push(offer)
    this.queue.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
    void this.pump()
  }

  private declineReason(offer: JobOffer): string | null {
    if (tierRank(this.o.tier) < tierRank(offer.minTier)) return `device tier ${this.o.tier} below required ${offer.minTier}`
    if (this.o.modelFor && this.o.modelFor(offer) === null) return `no local model for role ${offer.role ?? offer.kind}`
    return null
  }

  private async pump() {
    if (this.running) return
    this.running = true
    try {
      while (this.queue.length && !this.stopped) {
        await this.o.scheduler?.waitUntilRunnable()
        const offer = this.queue.shift()
        if (!offer || this.stopped) break
        await this.runOne(offer)
      }
    } finally {
      this.running = false
      if (this.queue.length === 0) this.idleWaiters.splice(0).forEach((r) => r())
    }
  }

  private async runOne(offer: JobOffer) {
    const { transport, llm } = this.o
    let claim: JobClaim
    try {
      claim = await transport.claim(offer.jobId)
    } catch (e) {
      claim = { granted: false, reason: (e as Error).message }
    }
    if (!claim.granted) {
      this.emit({ type: 'claim_rejected', jobId: offer.jobId, reason: claim.reason })
      return
    }

    const abort = new AbortController()
    this.current = { jobId: offer.jobId, abort }
    try {
      const wanted = this.o.modelFor?.(offer) ?? null
      if (wanted && llm.modelId !== wanted) {
        try {
          await llm.load(wanted)
        } catch (e) {
          await this.failJob(offer.jobId, { code: 'model_unavailable', message: `could not load ${wanted}: ${(e as Error).message}` })
          return
        }
      }
      this.o.scheduler?.begin(offer.jobId)
      this.emit({ type: 'started', jobId: offer.jobId, modelId: llm.modelId })
      const onDelta = (delta: string) => {
        transport.progress(offer.jobId, delta)
        this.emit({ type: 'delta', jobId: offer.jobId, delta })
      }
      const gen = { maxTokens: offer.maxTokens, temperature: offer.temperature, signal: abort.signal, onDelta }

      if (offer.schema) {
        const validator = this.o.validator ?? ((_k: string, v: unknown, s: JsonSchema) => validateJsonSchema(v, s))
        const res = await runStructured((m, o) => llm.generate(m, o), offer.messages, offer.schema, {
          ...gen,
          maxRepairs: this.o.maxRepairs ?? 2,
          validate: (v, s) => validator(offer.kind, v, s),
          onAttempt: ({ attempt, errors }) => {
            if (errors.length) this.emit({ type: 'repair', jobId: offer.jobId, attempt, errors })
          },
        })
        await this.complete(offer.jobId, { artifact: { kind: 'json', value: res.value }, modelId: llm.modelId, usage: res.usage, repairs: res.repairs })
      } else {
        const res = await llm.generate(offer.messages, gen)
        if (res.finishReason === 'cancelled') {
          await this.failJob(offer.jobId, { code: 'cancelled', message: 'cancelled', lastText: res.text })
          return
        }
        await this.complete(offer.jobId, { artifact: { kind: 'text', text: res.text }, modelId: llm.modelId, usage: res.usage, repairs: 0 })
      }
    } catch (e) {
      if (abort.signal.aborted) {
        await this.failJob(offer.jobId, { code: 'cancelled', message: 'cancelled' })
      } else if (e instanceof StructuredOutputError) {
        await this.failJob(offer.jobId, { code: 'repair_exhausted', message: e.message, lastText: e.lastText })
      } else {
        await this.failJob(offer.jobId, { code: 'generation_error', message: (e as Error)?.message ?? String(e) })
      }
    } finally {
      this.o.scheduler?.end(offer.jobId)
      this.current = null
    }
  }

  private async complete(jobId: string, result: JobResult) {
    await this.o.transport.result(jobId, result)
    this.emit({ type: 'completed', jobId, result })
  }

  private async failJob(jobId: string, failure: JobFailure) {
    try {
      await this.o.transport.fail(jobId, failure)
    } finally {
      this.emit({ type: 'failed', jobId, failure })
    }
  }

  private emit(e: JobRunnerEvent) {
    this.o.onEvent?.(e)
  }
}
