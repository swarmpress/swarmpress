import { describe, expect, it, vi } from 'vitest'
import { FakeLlm } from './fake-llm'
import { GpuScheduler } from './gpu-scheduler'
import { JobRunner, type JobClaim, type JobFailure, type JobOffer, type JobResult, type JobRunnerEvent, type JobTransport } from './job-runner'

/** Fake WS transport: records every frame the runner sends. */
class FakeTransport implements JobTransport {
  handler: ((o: JobOffer) => void) | null = null
  frames: string[] = []
  deltas: Record<string, string> = {}
  results: Record<string, JobResult> = {}
  failures: Record<string, JobFailure> = {}
  declined: Record<string, string> = {}
  claimResponse: (jobId: string) => JobClaim = () => ({ granted: true, leaseMs: 60_000 })

  onOffer(h: (o: JobOffer) => void) {
    this.handler = h
    return () => (this.handler = null)
  }
  async claim(jobId: string) {
    this.frames.push(`claim:${jobId}`)
    return this.claimResponse(jobId)
  }
  progress(jobId: string, delta: string) {
    if (!this.deltas[jobId]) this.frames.push(`progress:${jobId}`)
    this.deltas[jobId] = (this.deltas[jobId] ?? '') + delta
  }
  result(jobId: string, r: JobResult) {
    this.frames.push(`result:${jobId}`)
    this.results[jobId] = r
  }
  fail(jobId: string, f: JobFailure) {
    this.frames.push(`fail:${jobId}:${f.code}`)
    this.failures[jobId] = f
  }
  decline(jobId: string, reason: string) {
    this.frames.push(`decline:${jobId}`)
    this.declined[jobId] = reason
  }
  emit(o: JobOffer) {
    this.handler?.(o)
  }
}

const PITCH_SCHEMA = {
  type: 'object',
  required: ['headline', 'angle'],
  properties: { headline: { type: 'string', minLength: 5 }, angle: { type: 'string' } },
}

const offer = (over: Partial<JobOffer> = {}): JobOffer => ({
  jobId: 'j1',
  kind: 'meeting_line',
  role: 'writer',
  messages: [{ role: 'user', content: 'Say something at standup.' }],
  minTier: 'small',
  maxTokens: 64,
  ...over,
})

function setup(llm: FakeLlm, opts: Partial<ConstructorParameters<typeof JobRunner>[0]> = {}) {
  const transport = new FakeTransport()
  const events: JobRunnerEvent[] = []
  const runner = new JobRunner({ transport, llm, tier: 'large', onEvent: (e) => events.push(e), ...opts })
  runner.start()
  return { transport, runner, events }
}

describe('JobRunner', () => {
  it('claim → progress → result for a text job, streaming deltas', async () => {
    const llm = new FakeLlm({ script: ['Morning team, the harbor piece is nearly done.'] })
    const { transport, runner, events } = setup(llm)
    transport.emit(offer())
    await runner.idle()
    expect(transport.frames).toEqual(['claim:j1', 'progress:j1', 'result:j1'])
    expect(transport.deltas.j1).toBe('Morning team, the harbor piece is nearly done.')
    expect(transport.results.j1.artifact).toEqual({ kind: 'text', text: 'Morning team, the harbor piece is nearly done.' })
    expect(events.filter((e) => e.type === 'delta').length).toBeGreaterThan(3)
    expect(llm.calls[0].opts.maxTokens).toBe(64)
  })

  it('structured job: valid JSON on the first try', async () => {
    const llm = new FakeLlm({ script: ['{"headline": "Last light on the Sentiero Azzurro", "angle": "guide"}'] })
    const { transport, runner } = setup(llm)
    transport.emit(offer({ kind: 'pitch', schema: PITCH_SCHEMA }))
    await runner.idle()
    expect(transport.results.j1).toMatchObject({ artifact: { kind: 'json', value: { headline: 'Last light on the Sentiero Azzurro', angle: 'guide' } }, repairs: 0 })
  })

  it('invalid JSON → repair turn → success', async () => {
    const llm = new FakeLlm({ script: ['Sure! {"headline": "Hi"', '```json\n{"headline": "Harbor at dawn", "angle": "story"}\n```'] })
    const { transport, runner, events } = setup(llm)
    transport.emit(offer({ kind: 'pitch', schema: PITCH_SCHEMA }))
    await runner.idle()
    expect(transport.results.j1.repairs).toBe(1)
    expect(transport.results.j1.artifact).toEqual({ kind: 'json', value: { headline: 'Harbor at dawn', angle: 'story' } })
    expect(events.some((e) => e.type === 'repair')).toBe(true)
    expect(llm.calls).toHaveLength(2)
  })

  it('uses the injected validator (content-model stand-in) per job kind', async () => {
    const llm = new FakeLlm({ script: ['{"headline": "Harbor at dawn", "angle": "rant"}', '{"headline": "Harbor at dawn", "angle": "story"}'] })
    const validator = vi.fn((kind: string, v: unknown) =>
      kind === 'pitch' && (v as { angle: string }).angle === 'rant' ? { ok: false as const, errors: ['angle: rants are off-brand'] } : { ok: true as const },
    )
    const { transport, runner } = setup(llm, { validator })
    transport.emit(offer({ kind: 'pitch', schema: PITCH_SCHEMA }))
    await runner.idle()
    expect(validator).toHaveBeenCalledWith('pitch', expect.anything(), PITCH_SCHEMA)
    expect(llm.calls[1].messages.at(-1)!.content).toContain('rants are off-brand')
    expect(transport.results.j1.repairs).toBe(1)
  })

  it('repairs exhausted → fail(repair_exhausted)', async () => {
    const llm = new FakeLlm({ responder: () => 'I would rather not.' })
    const { transport, runner } = setup(llm, { maxRepairs: 2 })
    transport.emit(offer({ kind: 'pitch', schema: PITCH_SCHEMA }))
    await runner.idle()
    expect(transport.frames).toEqual(['claim:j1', 'progress:j1', 'fail:j1:repair_exhausted'])
    expect(transport.failures.j1.lastText).toBe('I would rather not.')
    expect(llm.calls).toHaveLength(3)
  })

  it('tier too low → decline without claiming', async () => {
    const llm = new FakeLlm()
    const { transport, runner, events } = setup(llm, { tier: 'small' })
    transport.emit(offer({ jobId: 'draft-1', kind: 'draft', minTier: 'large' }))
    await runner.idle()
    expect(transport.frames).toEqual(['decline:draft-1'])
    expect(transport.declined['draft-1']).toMatch(/small below required large/)
    expect(events).toEqual([{ type: 'declined', jobId: 'draft-1', reason: expect.any(String) }])
    expect(llm.calls).toHaveLength(0)
  })

  it('agency-only devices decline everything', async () => {
    const { transport, runner } = setup(new FakeLlm(), { tier: 'agency-only' })
    transport.emit(offer({ minTier: 'tiny' }))
    await runner.idle()
    expect(transport.frames).toEqual(['decline:j1'])
  })

  it('claim not granted (another worker won) → skip quietly', async () => {
    const llm = new FakeLlm()
    const { transport, runner, events } = setup(llm)
    transport.claimResponse = () => ({ granted: false, reason: 'leased' })
    transport.emit(offer())
    await runner.idle()
    expect(transport.frames).toEqual(['claim:j1'])
    expect(events).toEqual([{ type: 'claim_rejected', jobId: 'j1', reason: 'leased' }])
    expect(llm.calls).toHaveLength(0)
  })

  it('runs one job at a time, highest priority first', async () => {
    const llm = new FakeLlm({ responder: (m) => `done ${m.at(-1)!.content}`, perTokenMs: 2 })
    const { transport, runner } = setup(llm)
    transport.emit(offer({ jobId: 'a', messages: [{ role: 'user', content: 'a' }] }))
    await vi.waitFor(() => expect(transport.frames).toContain('claim:a'))
    transport.emit(offer({ jobId: 'low', priority: 0, messages: [{ role: 'user', content: 'low' }] }))
    transport.emit(offer({ jobId: 'high', priority: 5, messages: [{ role: 'user', content: 'high' }] }))
    await runner.idle()
    expect(transport.frames.filter((f) => f.startsWith('result'))).toEqual(['result:a', 'result:high', 'result:low'])
    // never two generations at once
    expect(transport.frames.filter((f) => /^(claim|result)/.test(f))).toEqual(['claim:a', 'result:a', 'claim:high', 'result:high', 'claim:low', 'result:low'])
  })

  it('loads the model chosen for the role, declines roles without a local model', async () => {
    const llm = new FakeLlm({ script: ['ok'] })
    const { transport, runner } = setup(llm, { modelFor: (o) => (o.role === 'writer' ? 'qwen3-4b-q4f16' : null) })
    transport.emit(offer({ role: 'translator', jobId: 't' }))
    transport.emit(offer())
    await runner.idle()
    expect(transport.frames).toEqual(['decline:t', 'claim:j1', 'progress:j1', 'result:j1'])
    expect(llm.loads).toEqual(['qwen3-4b-q4f16'])
    expect(transport.results.j1.modelId).toBe('qwen3-4b-q4f16')
  })

  it('generation errors → fail(generation_error)', async () => {
    const llm = new FakeLlm({ script: [new Error('GPU device lost')] })
    const { transport, runner } = setup(llm)
    transport.emit(offer())
    await runner.idle()
    expect(transport.failures.j1).toEqual({ code: 'generation_error', message: 'GPU device lost' })
  })

  it('stop() cancels the in-flight job → fail(cancelled)', async () => {
    const llm = new FakeLlm({ script: ['one two three four five six seven eight'], perTokenMs: 20 })
    let runnerRef: JobRunner | null = null
    const { transport, runner } = setup(llm, { onEvent: (e) => e.type === 'delta' && runnerRef?.stop() })
    runnerRef = runner
    transport.emit(offer())
    await vi.waitFor(() => expect(transport.failures.j1?.code).toBe('cancelled'))
    expect(transport.results.j1).toBeUndefined()
    expect(transport.deltas.j1).toBe('one ')
  })

  it('drives the GPU scheduler and waits while paused (hidden tab)', async () => {
    const quality: number[] = []
    const scheduler = new GpuScheduler({ setQualityDrop: (n) => quality.push(n), setFpsCap: () => {} }, { restoreDelayMs: 0 })
    scheduler.setHidden(true)
    const llm = new FakeLlm({ script: ['hi'] })
    const { transport, runner } = setup(llm, { scheduler })
    transport.emit(offer())
    await new Promise((r) => setTimeout(r, 10))
    expect(transport.frames).toEqual([]) // paused: not even claimed
    scheduler.setHidden(false)
    await runner.idle()
    expect(transport.frames).toEqual(['claim:j1', 'progress:j1', 'result:j1'])
    expect(quality).toEqual([1])
    await new Promise((r) => setTimeout(r, 5))
    expect(quality).toEqual([1, 0])
  })
})
