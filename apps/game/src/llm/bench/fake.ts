/**
 * The scripted backend of `bench.html?llm=fake` (ADR-0057, FEAT-037): it
 * answers every fixture prompt with the answer the fixture expects, and gets
 * a fixed, known set of prompts wrong in known ways. No model runs.
 *
 * It exists to prove the harness, not a model: with it the run is the same on
 * every machine, so the unit tests and the CI run can assert exact counts of
 * calls, repairs, cut-off answers, failed checks and failures (`FAKE_FAULTS`).
 * Its timings mean nothing and the reports mark them so.
 */
import { FakeLlm, type FakeResponse } from '../fake-llm'
import { runStructured, streamFromGenerate } from '../structured'
import type { ChatMessage, GenerateOptions, GenerateResult, JsonSchema, LoadProgress, LocalLlm, RuntimeCapabilities, StructuredOptions } from '../types'
import { caseKeyOf, type FixtureId, type Suite } from './fixtures'

export const BENCH_FAKE_MODEL = 'scripted'
export const BENCH_FAKE_BYTES = 64 * 1024 * 1024

export type Fault =
  /** The first answer breaks the schema; the repair turn is valid. */
  | 'repair-once'
  /** Two answers break the schema; the second repair turn is valid. */
  | 'repair-twice'
  /** Every answer breaks the schema: the call fails. */
  | 'never-valid'
  /** The first answer is cut off at the token limit; the retry is valid. */
  | 'truncate-once'
  /** A valid answer wrapped in prose and a code fence. */
  | 'fenced'
  /** Valid by the schema, wrong by the fixture's deterministic check. */
  | 'wrong'
  /** Free text that ends at the token limit. */
  | 'length'
  /** The backend throws. */
  | 'throw'

/** Which prompts the scripted backend gets wrong, by index inside the fixture (or `article/stage`). */
export const FAKE_FAULTS: Record<FixtureId, Record<string, Fault>> = {
  'short-action': { '3': 'repair-once', '13': 'repair-once', '7': 'repair-twice', '41': 'never-valid', '19': 'truncate-once', '29': 'fenced', '11': 'wrong' },
  'short-answer': { '17': 'wrong', '5': 'length' },
  'context-inspection': { '3': 'repair-once', '32': 'repair-twice', '19': 'truncate-once', '11': 'wrong', '21': 'wrong' },
  section: { '3': 'repair-once', '23': 'repair-once', '41': 'never-valid', '11': 'wrong', '29': 'fenced' },
  'staged-article': { '2/section-3': 'repair-once', '4/outline': 'never-valid', '5/section-2': 'wrong' },
  'meeting-turn': { '5': 'length', '13': 'throw' },
  'moderator-pick': { '7': 'repair-twice', '11': 'wrong', '43': 'repair-once' },
}

export function faultOf(key: string): Fault | null {
  const [fixture, ...rest] = key.split('/')
  return FAKE_FAULTS[fixture as FixtureId]?.[rest.join('/')] ?? null
}

const INVALID = JSON.stringify({ oops: true })

function wrong(fixture: string, stage: string | undefined, expected: unknown): unknown {
  switch (fixture) {
    case 'short-action':
      return { ...(expected as object), target: 'item-000-x' }
    case 'context-inspection':
      return { ...(expected as object), slug: 'not-a-page-0000' }
    case 'moderator-pick':
      return { next: '', prompt: 'Anyone?', done: false }
    case 'section':
      return { blocks: [{ type: 'paragraph', text: 'Too short to pass.', items: [] }] }
    case 'staged-article':
      return stage?.startsWith('section') ? { blocks: [{ type: 'paragraph', text: 'Too short to pass.', items: [] }] } : expected
    default:
      return 'I do not know.'
  }
}

export interface BenchFakeOptions {
  /** Delay before the first token of every generation, ms. Default 0. */
  firstTokenMs?: number
  /** Simulated load time, ms. Default 0. */
  loadMs?: number
  onEvent?: (e: { kind: 'device-lost' | 'gpu-error'; message: string }) => void
}

/** The scripted backend. `loseDevice()` is its test hook for the device-loss fixture. */
export class BenchFakeLlm implements LocalLlm {
  modelId: string | null = null
  private inner: FakeLlm
  private lost = false
  /** Keys whose first answer was already cut off. */
  private truncated = new Set<string>()

  constructor(
    private suite: Suite,
    private o: BenchFakeOptions = {},
  ) {
    this.inner = this.build()
  }

  private build(): FakeLlm {
    return new FakeLlm({
      responder: (messages) => this.reply(messages),
      firstTokenMs: this.o.firstTokenMs ?? 0,
      perTokenMs: 0,
      loadSteps: 4,
      loadMs: this.o.loadMs ?? 0,
      sizeBytes: BENCH_FAKE_BYTES,
    })
  }

  private reply(messages: ChatMessage[]): FakeResponse {
    const key = caseKeyOf(messages)
    // Prompts outside the fixtures: the warm-up turn and the turn after a recovery.
    if (!key) return 'OK.'
    const expected = this.suite.expected(key)
    if (expected === undefined) return new Error(`the scripted backend has no answer for ${key}`)
    const [fixture, , stage] = key.split('/')
    const fault = faultOf(key)
    const valid = typeof expected === 'string' ? expected : JSON.stringify(expected)
    // Each repair turn adds the previous answer and a correction request to the conversation.
    const attempt = messages.filter((m) => m.role === 'assistant').length
    switch (fault) {
      case 'repair-once':
        return attempt < 1 ? INVALID : valid
      case 'repair-twice':
        return attempt < 2 ? INVALID : valid
      case 'never-valid':
        return INVALID
      case 'truncate-once':
        if (this.truncated.has(key)) return valid
        this.truncated.add(key)
        return { text: valid.slice(0, Math.max(8, Math.floor(valid.length / 2))), finishReason: 'length' }
      case 'fenced':
        return `Here is the answer.\n\`\`\`json\n${valid}\n\`\`\`\nThat is all.`
      case 'wrong': {
        const w = wrong(fixture, stage, expected)
        return typeof w === 'string' ? w : JSON.stringify(w)
      }
      case 'length':
        return { text: valid.split(' ').slice(0, 6).join(' '), finishReason: 'length' }
      case 'throw':
        return new Error('the scripted backend failed this call on purpose')
      default:
        return valid
    }
  }

  async load(modelId: string, onProgress?: (p: LoadProgress) => void): Promise<void> {
    if (this.inner.disposed) this.inner = this.build()
    await this.inner.load(modelId, onProgress)
    this.lost = false
    this.modelId = modelId
  }

  /** Test hook: the device is gone until the next `load`. Calls fail, and the page is told, as a real backend would. */
  loseDevice(message = 'the GPU device was lost (simulated)'): void {
    this.lost = true
    this.modelId = null
    this.o.onEvent?.({ kind: 'device-lost', message })
  }

  async generate(messages: ChatMessage[], opts: GenerateOptions = {}): Promise<GenerateResult> {
    if (this.lost) throw new Error('the GPU device was lost (simulated); reload the model')
    if (!this.modelId) throw new Error('no model loaded')
    const started = performance.now()
    let first = 0
    const res = await this.inner.generate(messages, {
      ...opts,
      onDelta: (d) => {
        if (!first) first = performance.now()
        opts.onDelta?.(d)
      },
    })
    if (this.lost) throw new Error('the GPU device was lost (simulated); reload the model')
    return { ...res, usage: { ...res.usage, ttftMs: first ? first - started : res.usage.durationMs } }
  }

  stream(messages: ChatMessage[], opts: Omit<GenerateOptions, 'onDelta'> = {}): AsyncIterable<string> {
    return streamFromGenerate((m, o) => this.generate(m, o), messages, opts)
  }

  async structured<T>(messages: ChatMessage[], schema: JsonSchema, opts: StructuredOptions = {}): Promise<T> {
    return (await runStructured<T>((m, o) => this.generate(m, o), messages, schema, opts)).value
  }

  async capabilities(): Promise<RuntimeCapabilities> {
    return {
      backend: 'fake',
      label: 'Scripted model (tests)',
      webgpu: false,
      supportsConstrainedOutput: false,
      supportsPrefixReuse: false,
      supportsVision: false,
      reasoningModes: ['off', 'medium', 'xhigh'],
      contextTokens: this.modelId ? 16384 : null,
      // Fixed numbers, so the report's memory rows have something to carry in a scripted run.
      device: this.modelId ? { scripted: true, gpuBytes: { live: BENCH_FAKE_BYTES, peak: 2 * BENCH_FAKE_BYTES } } : { scripted: true },
    }
  }

  async resetSession(): Promise<void> {
    this.truncated.clear()
  }

  async dispose(): Promise<void> {
    await this.inner.dispose()
    this.modelId = null
  }
}
