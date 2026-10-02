/**
 * Pure helpers of the Bonsai adapter: chat-template arguments for the
 * reasoning modes, the system-prefix cut, incremental detokenisation and the
 * "root JSON value is complete" detector. No GPU, no engine: unit-tested in
 * think.test.ts.
 */
import type { ChatMessage, ThinkingMode } from '../../types'
import type { UpstreamTokenizer } from './upstream'

/**
 * Chat-template arguments for a reasoning mode.
 *
 * `enable_thinking: false` is a hard switch: the generation prompt then ends
 * in an empty think block and the model answers directly. `reasoning_effort`
 * accepts `xhigh` (the template default), `medium` and `low`; `high` raises
 * upstream. `off` and `medium` pass the same effort so that the rendered
 * system block is byte-identical in both modes and the cached system prefix
 * is shared; only the tail of the prompt differs.
 */
export function templateArgs(thinking: ThinkingMode): Record<string, unknown> {
  switch (thinking) {
    case 'off':
      return { enable_thinking: false, reasoning_effort: 'medium' }
    case 'medium':
      return { enable_thinking: true, reasoning_effort: 'medium' }
    case 'xhigh':
      return { enable_thinking: true }
  }
}

/**
 * One merged system message first, then the conversation. The model's
 * template requires the system message to be the first message, and one
 * message keeps the system prefix stable across staff.
 */
export function mergeSystem(messages: ChatMessage[]): ChatMessage[] {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content)
  const rest = messages.filter((m) => m.role !== 'system')
  if (!rest.some((m) => m.role === 'user')) throw new Error('the conversation needs at least one user message')
  return system.length ? [{ role: 'system', content: system.join('\n\n') }, ...rest] : rest
}

/** Where the first user turn starts in a ChatML-rendered prompt. */
export const USER_TURN = '<|im_start|>user'

/**
 * The part of a rendered prompt before the first user turn (the system
 * block), or '' when the prompt has none. Cutting the rendered string, not
 * rendering the system message alone, is deliberate: the template refuses to
 * render a conversation without a user message.
 */
export function systemPrefix(prompt: string): string {
  const i = prompt.indexOf(USER_TURN)
  return i > 0 ? prompt.slice(0, i) : ''
}

/**
 * Token ids of the system prefix, or [] when they are not a strict prefix of
 * the prompt's ids (then nothing is reused: a wrong prefix would corrupt the
 * cache, a missing one only costs time).
 */
export function systemPrefixIds(tokenizer: UpstreamTokenizer, prompt: string, promptIds: number[]): number[] {
  const text = systemPrefix(prompt)
  if (!text) return []
  const ids = tokenizer.encode(text, { add_special_tokens: false }).ids
  if (ids.length === 0 || ids.length >= promptIds.length) return []
  for (let i = 0; i < ids.length; i++) if (ids[i] !== promptIds[i]) return []
  return ids
}

/**
 * Tokens that close an open reasoning block: `</think>` and the blank line
 * the model writes before its answer. Used when our reasoning cap is hit;
 * the engine has no reasoning budget of its own.
 */
export function thinkCloseIds(tokenizer: UpstreamTokenizer, closeId: number): number[] {
  const ids = tokenizer.encode('\n</think>\n\n', { add_special_tokens: false }).ids
  if (ids.includes(closeId)) return ids
  return [closeId, ...tokenizer.encode('\n\n', { add_special_tokens: false }).ids]
}

/**
 * Detokenises a growing token list into text deltas. A token can end in the
 * middle of a multi-byte character; such a tail decodes to U+FFFD and is held
 * back until the next token completes it. The decode window restarts at each
 * newline so the cost stays linear in the output.
 */
export class IncrementalDecoder {
  private window: number[] = []
  private emitted = 0
  text = ''

  constructor(private tokenizer: UpstreamTokenizer) {}

  /** Returns the newly completed text (possibly ''). */
  push(id: number): string {
    this.window.push(id)
    const decoded = this.tokenizer.decode(this.window, { skip_special_tokens: true })
    if (decoded.endsWith('�')) return ''
    const delta = decoded.slice(this.emitted)
    this.emitted = decoded.length
    if (decoded.endsWith('\n')) {
      this.window = []
      this.emitted = 0
    }
    this.text += delta
    return delta
  }
}

/**
 * Tells when the first JSON object or array in a text stream is complete, so
 * generation can stop there instead of running to the token limit. Scalars at
 * the root are not detected (the structured path only asks for objects and
 * arrays). Text before the opening bracket (prose, a code fence) is skipped.
 */
export class JsonBalance {
  private stack: string[] = []
  private inString = false
  private escaped = false
  private started = false
  /** Characters consumed up to and including the closing bracket, once complete. */
  end = -1
  private offset = 0

  get complete(): boolean {
    return this.end >= 0
  }

  /** Feed the next text delta; returns true once the root value has closed. */
  push(delta: string): boolean {
    if (this.end >= 0) return true
    for (let i = 0; i < delta.length; i++) {
      const ch = delta[i]
      this.offset++
      if (!this.started) {
        if (ch === '{' || ch === '[') {
          this.started = true
          this.stack.push(ch === '{' ? '}' : ']')
        }
        continue
      }
      if (this.inString) {
        if (this.escaped) this.escaped = false
        else if (ch === '\\') this.escaped = true
        else if (ch === '"') this.inString = false
        continue
      }
      if (ch === '"') this.inString = true
      else if (ch === '{') this.stack.push('}')
      else if (ch === '[') this.stack.push(']')
      else if (ch === '}' || ch === ']') {
        // A mismatched bracket is malformed JSON: stop tracking, the validator reports it.
        if (this.stack.pop() !== ch) {
          this.stack = []
          this.started = false
          continue
        }
        if (this.stack.length === 0) {
          this.end = this.offset
          return true
        }
      }
    }
    return false
  }
}
