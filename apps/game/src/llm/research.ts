/** Every string under a `url` key of a research answer, without duplicates (ADR-0068). */
export function urlsIn(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) for (const x of v) urlsIn(x, out)
  else if (v && typeof v === 'object')
    for (const [k, x] of Object.entries(v)) {
      if (k === 'url' && typeof x === 'string') {
        if (!out.includes(x)) out.push(x)
      } else urlsIn(x, out)
    }
  return out
}
