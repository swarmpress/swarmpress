/**
 * Structured output for small local models: schema-guided prompt → JSON
 * extraction → validation → repair turns.
 *
 * Small models wrap JSON in prose, code fences or <think> blocks, leave
 * trailing commas, or stop mid-object. `extractJson` handles the first
 * three; a truncated object is reported as an error so the repair turn can
 * ask for a complete one.
 */
import type {
  ChatMessage,
  GenerateOptions,
  GenerateResult,
  JsonSchema,
  StructuredOptions,
  StructuredResult,
  Usage,
  ValidationResult,
} from './types'

export class StructuredOutputError extends Error {
  constructor(
    message: string,
    readonly attempts: number,
    readonly lastText: string,
    readonly errors: string[],
  ) {
    super(message)
    this.name = 'StructuredOutputError'
  }
}

export type ExtractResult = { ok: true; value: unknown; raw: string } | { ok: false; error: string }

/** Remove reasoning blocks emitted by Qwen3/gpt-oss style models. */
export function stripReasoning(text: string): string {
  let out = text.replace(/<think>[\s\S]*?<\/think>/gi, '')
  // An unterminated <think> means the model never left reasoning mode.
  const open = out.search(/<think>/i)
  if (open >= 0) out = out.slice(0, open)
  return out
}

/**
 * Find the first balanced JSON object/array in `text` that parses.
 * Prefers a ```json fenced block when present. Tolerates trailing commas.
 */
export function extractJson(text: string): ExtractResult {
  const cleaned = stripReasoning(text)
  const candidates: string[] = []
  const fence = /```(?:json|JSON)?\s*\n?([\s\S]*?)```/g
  for (let m = fence.exec(cleaned); m; m = fence.exec(cleaned)) candidates.push(m[1])
  candidates.push(cleaned)

  let sawOpen = false
  for (const c of candidates) {
    for (let start = 0; start < c.length; start++) {
      const ch = c[start]
      if (ch !== '{' && ch !== '[') continue
      sawOpen = true
      const end = findBalancedEnd(c, start)
      // Unbalanced from here on: truncated output. Don't return a nested fragment.
      if (end < 0) break
      const raw = c.slice(start, end + 1)
      const parsed = tryParse(raw)
      if (parsed.ok) return { ok: true, value: parsed.value, raw }
      // Malformed span: skip it entirely rather than returning an inner fragment.
      start = end
    }
  }
  return { ok: false, error: sawOpen ? 'JSON is incomplete or malformed' : 'no JSON object found in the response' }
}

function findBalancedEnd(s: string, start: number): number {
  const stack: string[] = []
  let inStr = false
  let esc = false
  for (let i = start; i < s.length; i++) {
    const ch = s[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === '{') stack.push('}')
    else if (ch === '[') stack.push(']')
    else if (ch === '}' || ch === ']') {
      if (stack.pop() !== ch) return -1
      if (stack.length === 0) return i
    }
  }
  return -1
}

function tryParse(raw: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(raw) }
  } catch {
    // Trailing commas are the most common small-model slip.
    try {
      return { ok: true, value: JSON.parse(raw.replace(/,(\s*[}\]])/g, '$1')) }
    } catch {
      return { ok: false }
    }
  }
}

/**
 * Minimal JSON-Schema subset validator (type, required, properties,
 * additionalProperties=false, enum, const, items, minItems/maxItems,
 * minLength/maxLength, minimum/maximum). It does NOT check `anyOf`, `oneOf`,
 * `allOf`, `pattern` or `$ref`. It is the fallback for callers without the
 * wasm module; the orchestrator bridge injects the Rust validator
 * (`validateJson` of orchestrator-wasm, see orchestrator/index.ts), which is
 * the one the Rust side applies to every structured answer.
 */
export function validateJsonSchema(value: unknown, schema: JsonSchema, path = '$'): ValidationResult {
  const errors: string[] = []
  walk(value, schema, path, errors)
  return errors.length ? { ok: false, errors } : { ok: true }
}

function typeOf(v: unknown): string {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'array'
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number'
  return typeof v
}

function walk(v: unknown, s: JsonSchema, path: string, errors: string[]) {
  const t = s.type as string | string[] | undefined
  if (t) {
    const allowed = Array.isArray(t) ? t : [t]
    const actual = typeOf(v)
    const ok = allowed.some((a) => a === actual || (a === 'number' && actual === 'integer'))
    if (!ok) {
      errors.push(`${path}: expected ${allowed.join('|')}, got ${actual}`)
      return
    }
  }
  if ('const' in s && JSON.stringify(v) !== JSON.stringify(s.const)) errors.push(`${path}: must equal ${JSON.stringify(s.const)}`)
  if (Array.isArray(s.enum) && !s.enum.some((e) => JSON.stringify(e) === JSON.stringify(v))) {
    errors.push(`${path}: must be one of ${s.enum.map((e) => JSON.stringify(e)).join(', ')}`)
  }
  if (typeof v === 'string') {
    if (typeof s.minLength === 'number' && v.length < s.minLength) errors.push(`${path}: shorter than ${s.minLength} characters`)
    if (typeof s.maxLength === 'number' && v.length > s.maxLength) errors.push(`${path}: longer than ${s.maxLength} characters`)
  }
  if (typeof v === 'number') {
    if (typeof s.minimum === 'number' && v < s.minimum) errors.push(`${path}: must be >= ${s.minimum}`)
    if (typeof s.maximum === 'number' && v > s.maximum) errors.push(`${path}: must be <= ${s.maximum}`)
  }
  if (Array.isArray(v)) {
    if (typeof s.minItems === 'number' && v.length < s.minItems) errors.push(`${path}: needs at least ${s.minItems} items`)
    if (typeof s.maxItems === 'number' && v.length > s.maxItems) errors.push(`${path}: allows at most ${s.maxItems} items`)
    if (s.items && typeof s.items === 'object') v.forEach((item, i) => walk(item, s.items as JsonSchema, `${path}[${i}]`, errors))
  }
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const obj = v as Record<string, unknown>
    const props = (s.properties ?? {}) as Record<string, JsonSchema>
    for (const key of (s.required as string[] | undefined) ?? []) {
      if (!(key in obj)) errors.push(`${path}.${key}: is required`)
    }
    for (const [key, sub] of Object.entries(props)) {
      if (key in obj) walk(obj[key], sub, `${path}.${key}`, errors)
    }
    if (s.additionalProperties === false) {
      for (const key of Object.keys(obj)) if (!(key in props)) errors.push(`${path}.${key}: is not allowed`)
    }
  }
}

/** The system instruction appended for schema-guided prompting. */
export function schemaInstruction(schema: JsonSchema): string {
  return [
    'Respond with a single JSON value that conforms to this JSON Schema.',
    'Output ONLY the JSON: no prose, no explanation, no code fences.',
    'JSON Schema:',
    JSON.stringify(schema),
  ].join('\n')
}

/** Prepend/merge the schema instruction into the system message. */
export function withSchemaPrompt(messages: ChatMessage[], schema: JsonSchema): ChatMessage[] {
  const instr = schemaInstruction(schema)
  if (messages[0]?.role === 'system') {
    return [{ role: 'system', content: `${messages[0].content}\n\n${instr}` }, ...messages.slice(1)]
  }
  return [{ role: 'system', content: instr }, ...messages]
}

export function repairMessage(errors: string[]): ChatMessage {
  return {
    role: 'user',
    content: [
      'Your previous response was not valid. Problems:',
      ...errors.slice(0, 12).map((e) => `- ${e}`),
      'Reply again with ONLY the corrected JSON value, complete and conforming to the schema.',
    ].join('\n'),
  }
}

function addUsage(a: Usage, b: Usage): Usage {
  const completionTokens = a.completionTokens + b.completionTokens
  const durationMs = a.durationMs + b.durationMs
  const sum = (x: number | undefined, y: number | undefined) => (x === undefined && y === undefined ? undefined : (x ?? 0) + (y ?? 0))
  const out: Usage = {
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens,
    durationMs,
    tokensPerSec: durationMs > 0 ? (completionTokens * 1000) / durationMs : 0,
  }
  // The optional timings and counts are kept only when an adapter reports them.
  const prefillMs = sum(a.prefillMs, b.prefillMs)
  const reasoningTokens = sum(a.reasoningTokens, b.reasoningTokens)
  const cachedPromptTokens = sum(a.cachedPromptTokens, b.cachedPromptTokens)
  const ttftMs = a.ttftMs ?? b.ttftMs
  if (prefillMs !== undefined) out.prefillMs = prefillMs
  if (reasoningTokens !== undefined) out.reasoningTokens = reasoningTokens
  if (cachedPromptTokens !== undefined) out.cachedPromptTokens = cachedPromptTokens
  if (ttftMs !== undefined) out.ttftMs = ttftMs
  return out
}

export const ZERO_USAGE: Usage = { promptTokens: 0, completionTokens: 0, durationMs: 0, tokensPerSec: 0 }

export type GenerateFn = (messages: ChatMessage[], opts: GenerateOptions) => Promise<GenerateResult>

/** The answer still hit the token limit after the one retry: there is no complete value to return. */
export class StructuredTruncatedError extends StructuredOutputError {
  constructor(attempts: number, partial: string) {
    super('structured output was cut off at the token limit', attempts, partial, ['the output hit the token limit'])
    this.name = 'StructuredTruncatedError'
  }
}

/** Default cap on the previous answer quoted back in a repair turn, characters. */
export const MAX_REPAIR_CHARS = 6000

/**
 * What a repair turn quotes back as the model's previous answer: the answer
 * only, never the reasoning (a model that reasons at length would otherwise
 * fill its context with its own reasoning on the first repair), and capped.
 */
export function repairQuote(text: string, raw: string | null, maxChars: number): string {
  const answer = (raw ?? stripReasoning(text)).trim()
  if (answer.length <= maxChars) return answer
  return `${answer.slice(0, Math.max(0, maxChars))}\n[... cut: the previous answer was ${answer.length} characters long]`
}

/**
 * Cut free text at its last complete sentence (a turn that hit the token
 * limit). Returns '' when there is no complete sentence.
 */
export function trimToSentence(text: string): string {
  const t = text.trimEnd()
  const m = /^[\s\S]*[.!?…]["')\]»”’]*(?=\s|$)/.exec(t)
  return m ? m[0].trimEnd() : ''
}

/**
 * Run the prompt → extract → validate → repair loop on top of any generate
 * function. Total attempts = 1 + maxRepairs, plus at most one retry when an
 * answer is cut off at the token limit. Throws StructuredOutputError when
 * the repairs are exhausted and StructuredTruncatedError when the retry is
 * cut off as well; a cut-off answer is never returned as a value.
 * Cancellation errors from `generate` propagate unchanged.
 *
 * Repair turns and the truncation retry run with reasoning off: the model has
 * already reasoned about the task, and reasoning is what eats the budget.
 */
export async function runStructured<T>(
  generate: GenerateFn,
  messages: ChatMessage[],
  schema: JsonSchema,
  opts: StructuredOptions = {},
): Promise<StructuredResult<T>> {
  const { validate = validateJsonSchema, maxRepairs = 2, maxRepairChars = MAX_REPAIR_CHARS, onAttempt, ...genOpts } = opts
  const convo = withSchemaPrompt(messages, schema)
  let usage = ZERO_USAGE
  let lastText = ''
  let lastErrors: string[] = []
  let attempts = 0
  let truncationRetried = false
  let reasoningOff = false
  for (let attempt = 0; attempt <= maxRepairs; attempt++) {
    const res = await generate(convo, { temperature: 0.2, ...genOpts, ...(reasoningOff ? { thinking: 'off' as const, reasoningBudget: undefined } : {}) })
    attempts++
    usage = addUsage(usage, res.usage)
    lastText = res.text
    if (res.finishReason === 'cancelled') throw new StructuredOutputError('cancelled', attempts, res.text, ['cancelled'])
    const ex = extractJson(res.text)
    let errors: string[]
    if (!ex.ok) {
      if (res.finishReason === 'length') {
        // Cut off before the value was complete: one retry with reasoning off, then give up.
        onAttempt?.({ attempt, text: res.text, errors: [`${ex.error} (the output hit the token limit)`] })
        if (truncationRetried) throw new StructuredTruncatedError(attempts, stripReasoning(res.text))
        truncationRetried = true
        reasoningOff = true
        attempt--
        continue
      }
      errors = [ex.error]
    } else {
      const v = validate(ex.value, schema)
      if (v.ok) {
        onAttempt?.({ attempt, text: res.text, errors: [] })
        return { value: ex.value as T, repairs: attempt, text: res.text, usage }
      }
      errors = v.errors
    }
    lastErrors = errors
    onAttempt?.({ attempt, text: res.text, errors })
    convo.push({ role: 'assistant', content: repairQuote(res.text, ex.ok ? ex.raw : null, maxRepairChars) }, repairMessage(errors))
    reasoningOff = true
  }
  throw new StructuredOutputError(
    `structured output failed after ${maxRepairs + 1} attempts: ${lastErrors.join('; ')}`,
    maxRepairs + 1,
    lastText,
    lastErrors,
  )
}

/** Adapt a callback-style generate into an AsyncIterable of deltas. */
export function streamFromGenerate(
  generate: GenerateFn,
  messages: ChatMessage[],
  opts: Omit<GenerateOptions, 'onDelta'> = {},
): AsyncIterable<string> {
  return {
    [Symbol.asyncIterator]() {
      const queue: string[] = []
      let done = false
      let error: unknown = null
      let wake: (() => void) | null = null
      const notify = () => {
        wake?.()
        wake = null
      }
      const ac = new AbortController()
      const onOuterAbort = () => ac.abort()
      opts.signal?.addEventListener('abort', onOuterAbort, { once: true })
      generate(messages, {
        ...opts,
        signal: ac.signal,
        onDelta: (d) => {
          queue.push(d)
          notify()
        },
      }).then(
        () => {
          done = true
          notify()
        },
        (e) => {
          error = e
          done = true
          notify()
        },
      )
      return {
        async next(): Promise<IteratorResult<string>> {
          for (;;) {
            if (queue.length) return { value: queue.shift()!, done: false }
            if (error) throw error
            if (done) {
              opts.signal?.removeEventListener('abort', onOuterAbort)
              return { value: undefined, done: true }
            }
            await new Promise<void>((r) => (wake = r))
          }
        },
        async return(): Promise<IteratorResult<string>> {
          // Consumer broke out of the loop: cancel the generation.
          ac.abort()
          done = true
          return { value: undefined, done: true }
        },
      }
    },
  }
}

/** Apply stop sequences to accumulated text; returns the trimmed text when one matched. */
export function applyStop(text: string, stop: string[] | undefined): { text: string; stopped: boolean } {
  if (!stop?.length) return { text, stopped: false }
  let cut = -1
  for (const s of stop) {
    if (!s) continue
    const i = text.indexOf(s)
    if (i >= 0 && (cut < 0 || i < cut)) cut = i
  }
  return cut >= 0 ? { text: text.slice(0, cut), stopped: true } : { text, stopped: false }
}
