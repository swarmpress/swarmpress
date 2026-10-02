// `validateJson`: the Rust schema validator exported to JS, under Bun. The
// browser's structured-output loop repairs against it (ADR-0057), so it must
// report what `Llm::structured` would reject, including `anyOf` branches the
// TypeScript subset validator cannot check.
//
//   cargo xtask wasm && bun test crates/orchestrator-wasm/tests
import { beforeAll, describe, expect, test } from 'bun:test'
import init, { validateJson } from '../pkg/orchestrator_wasm.js'
import { localLlmBridge, rustValidator } from '../../../apps/game/src/orchestrator/bridge'
import { FakeLlm } from '../../../apps/game/src/llm/fake-llm'

const SCHEMA = {
  type: 'object',
  required: ['body'],
  additionalProperties: false,
  properties: {
    body: {
      type: 'array',
      minItems: 1,
      items: {
        anyOf: [
          {
            type: 'object',
            required: ['type', 'markdown'],
            additionalProperties: false,
            properties: { type: { const: 'paragraph' }, markdown: { type: 'string', minLength: 1 } },
          },
          {
            type: 'object',
            required: ['type', 'items'],
            additionalProperties: false,
            properties: { type: { const: 'list' }, items: { type: 'array', minItems: 1, items: { type: 'string' } } },
          },
        ],
      },
    },
  },
}

beforeAll(async () => {
  const wasm = await Bun.file(new URL('../pkg/orchestrator_wasm_bg.wasm', import.meta.url)).arrayBuffer()
  await init({ module_or_path: wasm })
})

describe('validateJson', () => {
  test('a valid value has no errors', () => {
    const value = { body: [{ type: 'paragraph', markdown: 'Terraces.' }, { type: 'list', items: ['one'] }] }
    expect(validateJson(JSON.stringify(SCHEMA), JSON.stringify(value))).toEqual([])
  })

  test('a block that matches no anyOf branch is reported with its path', () => {
    const value = { body: [{ type: 'paragraph', markdown: 'ok' }, { type: 'list', items: [] }] }
    const errors = validateJson(JSON.stringify(SCHEMA), JSON.stringify(value))
    expect(errors).toHaveLength(1)
    expect(errors[0].startsWith('/body/1: ')).toBe(true)
  })

  test('top-level problems are reported at the root', () => {
    const errors = validateJson(JSON.stringify(SCHEMA), JSON.stringify({ body: [], extra: 1 }))
    expect(errors.some((e) => e.startsWith('/body: '))).toBe(true)
    expect(errors.some((e) => e.startsWith('(root): '))).toBe(true)
  })

  test('a bad schema or unparsable input throws instead of passing', () => {
    expect(() => validateJson('{"type": "no-such-type"}', '{}')).toThrow(/bad schema/)
    expect(() => validateJson('not json', '{}')).toThrow(/schema JSON/)
    expect(() => validateJson('{}', '{oops')).toThrow(/value JSON/)
  })

  test('the bridge repairs an anyOf violation with it', async () => {
    const bad = '{"body": [{"type": "list", "items": []}]}'
    const good = '{"body": [{"type": "list", "items": ["Vernazza"]}]}'
    const local = new FakeLlm({ script: [bad, good] })
    const llm = localLlmBridge(local, { validate: rustValidator(validateJson) })
    const request = { profile: {}, system: ['s'], messages: [{ role: 'user', text: 'write' }], max_tokens: 4096 }
    const out = JSON.parse(await llm.complete(JSON.stringify({ kind: 'structured', request, schema: SCHEMA })))
    expect(out.value.body[0].items).toEqual(['Vernazza'])
    expect(local.calls).toHaveLength(2)
  })
})
