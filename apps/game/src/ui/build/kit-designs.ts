/**
 * The kit's designs (`kit/designs/*.json`) as the Build catalogue shows them: each design's name
 * and its main colour (the first colour parameter's default, else the first colour its bricks
 * use). Data from the kit, never a colour picked here.
 */
interface DesignJson {
  id: string
  name: string
  params?: Record<string, { type: string; default?: unknown }>
  ops?: unknown
}

const files = import.meta.glob<DesignJson>('../../../../../kit/designs/*.json', { eager: true, import: 'default' })

function firstColour(ops: unknown): string | null {
  if (Array.isArray(ops)) {
    for (const o of ops) {
      const c = firstColour(o)
      if (c) return c
    }
  } else if (ops && typeof ops === 'object') {
    const o = ops as Record<string, unknown>
    if (typeof o.colour === 'string' && !o.colour.startsWith('$')) return o.colour
    if (o.ops) return firstColour(o.ops)
  }
  return null
}

export interface KitDesign {
  name: string
  colour: string
}

const designs: Record<string, KitDesign> = {}
for (const d of Object.values(files)) {
  const param = Object.values(d.params ?? {}).find((p) => p.type === 'colour' && typeof p.default === 'string')
  designs[d.id] = { name: d.name, colour: (param?.default as string | undefined) ?? firstColour(d.ops) ?? 'grey-light' }
}

export default designs
