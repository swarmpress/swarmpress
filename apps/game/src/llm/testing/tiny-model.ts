/**
 * A tiny random-weight decoder-only LM ("simpress/tiny-random-llama") built
 * in pure TypeScript: an ONNX graph (protobuf written by hand), a WordPiece
 * tokenizer with a chat template, and a llama config. ~150 kB in total.
 *
 * Why: CI and sandboxes cannot always reach huggingface.co, but we still
 * want to prove the real runtime path end to end (worker → Transformers.js
 * → onnxruntime-web on WebGPU/wasm → KV cache → TextStreamer → RPC deltas).
 * The output is gibberish by design; the plumbing is real.
 *
 * Graph (one "layer", real KV-cache I/O so Transformers.js treats it like
 * any llama export):
 *   x       = E[input_ids] + P[position_ids]
 *   present.0.key   = concat(past.0.key,   heads(x·Wk), axis=2)
 *   present.0.value = concat(past.0.value, heads(x·Wv), axis=2)
 *   ctx     = mean_t(present.0.value)            // cheap stand-in for attention
 *   logits  = (x + flatten(ctx)) · Wout
 */

export const TINY_MODEL_ID = 'simpress/tiny-random-llama'

const HIDDEN = 32
const HEADS = 2
const HEAD_DIM = HIDDEN / HEADS
const MAX_POS = 1024

const SPECIALS = ['<|endoftext|>', '[UNK]', '<|im_start|>', '<|im_end|>'] as const

const WORDS = `the a an and of to in on for with at by from is are was were be it this that newsroom desk editor
writer story draft review headline deadline coffee press copy page print morning evening village coast trail
harbor sea light sunset path stone boat market bread wine lemon olive garden tower church bell square street
quiet busy bright warm cold old new small large first last good great local fresh slow early late today
tomorrow week season summer winter spring autumn walk climb swim read write edit check publish pitch brief
meeting chatter idea plan note photo map guide route view terrace balcony staircase window door train station
ferry ticket hour minute day night we you they she he our their your my not but or so very just also more
most some many few every each one two three four five ok yes no please thanks hello json title body text`
  .split(/\s+/)
  .filter(Boolean)

const PUNCT = ['.', ',', '!', '?', ':', ';', "'", '"', '-', '(', ')', '{', '}', '[', ']', '/', '#', '*', '_', '=', '+', '<', '>', '|', '&', '%', '@']
const LETTERS = 'abcdefghijklmnopqrstuvwxyz0123456789'.split('')

export function tinyVocab(): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const add = (t: string) => {
    if (!seen.has(t)) {
      seen.add(t)
      out.push(t)
    }
  }
  SPECIALS.forEach(add)
  WORDS.forEach(add)
  PUNCT.forEach(add)
  LETTERS.forEach(add)
  LETTERS.forEach((l) => add(`##${l}`))
  return out
}

// ---------------------------------------------------------------------------
// Minimal protobuf writer for the ONNX schema subset we need.

type Chunk = Uint8Array

function concat(chunks: Chunk[]): Uint8Array {
  const n = chunks.reduce((a, c) => a + c.length, 0)
  const out = new Uint8Array(n)
  let o = 0
  for (const c of chunks) {
    out.set(c, o)
    o += c.length
  }
  return out
}

function varint(n: number): Uint8Array {
  if (n < 0 || !Number.isSafeInteger(n)) throw new Error(`varint out of range: ${n}`)
  const bytes: number[] = []
  while (n > 0x7f) {
    bytes.push((n % 128) | 0x80)
    n = Math.floor(n / 128)
  }
  bytes.push(n)
  return Uint8Array.from(bytes)
}

const enc = new TextEncoder()
const key = (field: number, wire: number) => varint(field * 8 + wire)
const fVarint = (field: number, v: number) => concat([key(field, 0), varint(v)])
const fBytes = (field: number, b: Uint8Array) => concat([key(field, 2), varint(b.length), b])
const fString = (field: number, s: string) => fBytes(field, enc.encode(s))
const fMsg = (field: number, parts: Chunk[]) => fBytes(field, concat(parts))

const FLOAT = 1
const INT64 = 7

type Dim = number | string

function tensorType(elem: number, dims: Dim[]): Chunk[] {
  const shape = dims.map((d) => fMsg(1, [typeof d === 'number' ? fVarint(1, d) : fString(2, d)]))
  // TypeProto { tensor_type(1): { elem_type(1), shape(2): { dim(1)* } } }
  return [fMsg(1, [fVarint(1, elem), fMsg(2, shape)])]
}

const valueInfo = (name: string, elem: number, dims: Dim[]) => [fString(1, name), fMsg(2, tensorType(elem, dims))]

function floatTensor(name: string, dims: number[], data: Float32Array): Chunk[] {
  return [...dims.map((d) => fVarint(1, d)), fVarint(2, FLOAT), fString(8, name), fBytes(9, new Uint8Array(data.buffer, data.byteOffset, data.byteLength))]
}

function int64Tensor(name: string, values: number[]): Chunk[] {
  const buf = new BigInt64Array(values.map((v) => BigInt(v)))
  return [fVarint(1, values.length), fVarint(2, INT64), fString(8, name), fBytes(9, new Uint8Array(buf.buffer))]
}

type Attr = { name: string; i?: number; ints?: number[] }

function node(op: string, inputs: string[], outputs: string[], attrs: Attr[] = []): Chunk[] {
  const parts: Chunk[] = [...inputs.map((i) => fString(1, i)), ...outputs.map((o) => fString(2, o)), fString(3, `${op}_${outputs[0]}`), fString(4, op)]
  for (const a of attrs) {
    // AttributeProto: name(1) i(3) ints(8) type(20): INT=2, INTS=7
    if (a.ints) parts.push(fMsg(5, [fString(1, a.name), ...a.ints.map((v) => fVarint(8, v)), fVarint(20, 7)]))
    else parts.push(fMsg(5, [fString(1, a.name), fVarint(3, a.i ?? 0), fVarint(20, 2)]))
  }
  return parts
}

/** mulberry32 → Box-Muller normal floats, deterministic per seed. */
function randn(n: number, seed: number, scale: number): Float32Array {
  let s = seed >>> 0
  const rand = () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const u = Math.max(rand(), 1e-9)
    const v = rand()
    out[i] = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * scale
  }
  return out
}

export function buildTinyOnnx(vocabSize: number, seed = 42): Uint8Array {
  const V = vocabSize
  const C = HIDDEN
  const pkv = (kind: 'key' | 'value') => `past_key_values.0.${kind}`
  const present = (kind: 'key' | 'value') => `present.0.${kind}`
  const nodes: Chunk[][] = [
    node('Gather', ['embed', 'input_ids'], ['tok_emb']),
    node('Gather', ['pos_embed', 'position_ids'], ['pos_emb']),
    node('Add', ['tok_emb', 'pos_emb'], ['x']),
  ]
  for (const kind of ['key', 'value'] as const) {
    const w = kind === 'key' ? 'Wk' : 'Wv'
    nodes.push(
      node('MatMul', ['x', w], [`${kind}_proj`]),
      node('Reshape', [`${kind}_proj`, 'shape_bshd'], [`${kind}_bshd`]),
      node('Transpose', [`${kind}_bshd`], [`${kind}_bhsd`], [{ name: 'perm', ints: [0, 2, 1, 3] }]),
      node('Concat', [pkv(kind), `${kind}_bhsd`], [present(kind)], [{ name: 'axis', i: 2 }]),
    )
  }
  nodes.push(
    node('ReduceMean', [present('value')], ['ctx'], [
      { name: 'axes', ints: [2] },
      { name: 'keepdims', i: 1 },
    ]),
    node('Transpose', ['ctx'], ['ctx_b1hd'], [{ name: 'perm', ints: [0, 2, 1, 3] }]),
    node('Reshape', ['ctx_b1hd', 'shape_bsc'], ['ctx_flat']),
    node('Add', ['x', 'ctx_flat'], ['h']),
    node('MatMul', ['h', 'Wout'], ['logits']),
  )

  const initializers = [
    floatTensor('embed', [V, C], randn(V * C, seed, 1)),
    floatTensor('pos_embed', [MAX_POS, C], randn(MAX_POS * C, seed + 1, 0.5)),
    floatTensor('Wk', [C, C], randn(C * C, seed + 2, 1 / Math.sqrt(C))),
    floatTensor('Wv', [C, C], randn(C * C, seed + 3, 1 / Math.sqrt(C))),
    floatTensor('Wout', [C, V], randn(C * V, seed + 4, 2 / Math.sqrt(C))),
    int64Tensor('shape_bshd', [0, 0, HEADS, HEAD_DIM]),
    int64Tensor('shape_bsc', [0, 0, C]),
  ]

  const kvDims = (seq: string): Dim[] => ['batch_size', HEADS, seq, HEAD_DIM]
  const inputs = [
    valueInfo('input_ids', INT64, ['batch_size', 'sequence_length']),
    valueInfo('position_ids', INT64, ['batch_size', 'sequence_length']),
    valueInfo(pkv('key'), FLOAT, kvDims('past_sequence_length')),
    valueInfo(pkv('value'), FLOAT, kvDims('past_sequence_length')),
  ]
  const outputs = [
    valueInfo('logits', FLOAT, ['batch_size', 'sequence_length', V]),
    valueInfo(present('key'), FLOAT, kvDims('total_sequence_length')),
    valueInfo(present('value'), FLOAT, kvDims('total_sequence_length')),
  ]

  // GraphProto: node(1) name(2) initializer(5) input(11) output(12)
  const graph = [
    ...nodes.map((n) => fMsg(1, n)),
    fString(2, 'tiny_random_llama'),
    ...initializers.map((t) => fMsg(5, t)),
    ...inputs.map((v) => fMsg(11, v)),
    ...outputs.map((v) => fMsg(12, v)),
  ]
  // ModelProto: ir_version(1) producer_name(2) graph(7) opset_import(8): { domain(1), version(2) }
  return concat([fVarint(1, 8), fString(2, 'simpress-tiny-model'), fMsg(7, graph), fMsg(8, [fString(1, ''), fVarint(2, 17)])])
}

export const TINY_CHAT_TEMPLATE =
  "{% for message in messages %}<|im_start|>{{ message['role'] }}\n{{ message['content'] }}<|im_end|>\n{% endfor %}{% if add_generation_prompt %}<|im_start|>assistant\n{% endif %}"

/** All files of the tiny model, keyed by repo-relative path. */
export function tinyModelFiles(seed = 42): Record<string, Uint8Array> {
  const vocab = tinyVocab()
  const ids = Object.fromEntries(vocab.map((t, i) => [t, i]))
  const eos = ids['<|im_end|>']
  const json = (v: unknown) => enc.encode(JSON.stringify(v, null, 1))
  const tokenizer = {
    version: '1.0',
    truncation: null,
    padding: null,
    added_tokens: SPECIALS.map((content) => ({
      id: ids[content],
      content,
      single_word: false,
      lstrip: false,
      rstrip: false,
      normalized: false,
      special: true,
    })),
    normalizer: { type: 'Lowercase' },
    pre_tokenizer: { type: 'Whitespace' },
    post_processor: null,
    decoder: { type: 'WordPiece', prefix: '##', cleanup: true },
    model: { type: 'WordPiece', unk_token: '[UNK]', continuing_subword_prefix: '##', max_input_chars_per_word: 100, vocab: ids },
  }
  const tokenizerConfig = {
    tokenizer_class: 'PreTrainedTokenizer',
    chat_template: TINY_CHAT_TEMPLATE,
    eos_token: '<|im_end|>',
    unk_token: '[UNK]',
    pad_token: '<|endoftext|>',
    bos_token: null,
    add_bos_token: false,
    add_eos_token: false,
    model_max_length: MAX_POS,
    clean_up_tokenization_spaces: true,
  }
  const config = {
    architectures: ['LlamaForCausalLM'],
    model_type: 'llama',
    hidden_size: HIDDEN,
    intermediate_size: HIDDEN * 2,
    num_attention_heads: HEADS,
    num_key_value_heads: HEADS,
    head_dim: HEAD_DIM,
    num_hidden_layers: 1,
    vocab_size: vocab.length,
    max_position_embeddings: MAX_POS,
    bos_token_id: null,
    eos_token_id: eos,
    pad_token_id: ids['<|endoftext|>'],
    use_cache: true,
    'transformers.js_config': { dtype: 'fp32' },
  }
  return {
    'config.json': json(config),
    'generation_config.json': json({ eos_token_id: eos, pad_token_id: ids['<|endoftext|>'] }),
    'tokenizer.json': json(tokenizer),
    'tokenizer_config.json': json(tokenizerConfig),
    'onnx/model.onnx': buildTinyOnnx(vocab.length, seed),
  }
}

/**
 * A `fetch` wrapper that serves the tiny model for any URL containing
 * `/simpress/tiny-random-llama/` (Hub URL or local model path) and defers
 * everything else to `inner`. Install as Transformers.js `env.fetch`.
 */
export function tinyModelFetch(inner: typeof fetch, seed = 42): typeof fetch {
  let files: Record<string, Uint8Array> | null = null
  const marker = `/${TINY_MODEL_ID}/`
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const at = url.indexOf(marker)
    if (at < 0) return inner(input, init)
    files ??= tinyModelFiles(seed)
    // Hub URLs look like .../simpress/tiny-random-llama/resolve/main/<file>
    const rest = url.slice(at + marker.length).replace(/^resolve\/[^/]+\//, '').split('?')[0]
    const body = files[rest]
    if (!body) return new Response('not found', { status: 404, statusText: 'Not Found' })
    const headers = { 'content-length': String(body.length), 'content-type': rest.endsWith('.json') ? 'application/json' : 'application/octet-stream' }
    if (init?.method === 'HEAD') return new Response(null, { status: 200, headers })
    return new Response(body.slice(), { status: 200, headers })
  }) as typeof fetch
}

export const TINY_MODEL_ENTRY = {
  id: 'tiny-random-llama',
  description: 'Test fixture: random weights, gibberish output; proves the runtime path offline.',
  hfRepo: TINY_MODEL_ID,
  dtype: 'fp32',
  sizeBytes: 160_000,
  context: MAX_POS,
  minMaxBufferSize: 0,
  minStorageBufferBindingSize: 0,
  approxVramBytes: 4 * 1024 * 1024,
  tier: 'tiny' as const,
  roles: ['chatter'],
  evalPending: false,
}
