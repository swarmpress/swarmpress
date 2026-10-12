/**
 * The company's designs as Build mode places them (K-4, ADR-0065 §4): each design compiled once
 * by the kit (content-addressed, so per hash for the page's life), its summary turned into the
 * `PlaceObject` the sim validates and prices, and the placed objects of a room listed by their
 * designs. Only floor-mounted designs the kit builds can be placed.
 */
import { useEffect, useState } from 'preact/hooks'
import type { CompanyDesign } from './company-designs'
import { designColour } from './company-designs'
import { compileDesign, getDesignKit, type EditorKit, type KitSummary } from './design-kit'
import type { DesignJson } from './design-model'
import { objectSummary, placeable, quarter, type CatalogueItem, type PlacedObjectLayout } from './types'
import type { Placed } from './Placer'

/** The kit, loaded when `enabled` (the page's lazily loaded module, or the one tests inject). */
export function useEditorKit(enabled: boolean): { kit: EditorKit | null; error: string | null } {
  const [kit, setKit] = useState<EditorKit | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!enabled || kit) return
    let live = true
    getDesignKit().then(
      (k) => live && setKit(k),
      (e: unknown) => live && setError(e instanceof Error ? e.message : String(e)),
    )
    return () => {
      live = false
    }
  }, [enabled, kit])
  return { kit, error }
}

interface Facts {
  ok: boolean
  summary: KitSummary | null
}
const facts = new Map<string, Facts>()

/** The kit's verdict and summary of a design, once per hash. */
export function factsOf(kit: EditorKit, hash: string, design: DesignJson): Facts {
  let f = facts.get(hash)
  if (!f) {
    try {
      const c = compileDesign(kit, design)
      f = { ok: c.ok, summary: c.summary }
    } catch {
      f = { ok: false, summary: null }
    }
    facts.set(hash, f)
  }
  return f
}

/** The catalogue kind of a design of the player's own (`design:<hash>`). */
export const designKind = (hash: string) => `design:${hash}`

/** The company's designs as catalogue tiles: those the kit builds and that stand on the floor; how many others were left out. */
export function myDesignItems(kit: EditorKit, designs: readonly CompanyDesign[]): { items: CatalogueItem[]; left: number } {
  const items: CatalogueItem[] = []
  let left = 0
  for (const d of designs) {
    const f = factsOf(kit, d.hash, d.design)
    if (!f.ok || !f.summary || !placeable(f.summary)) {
      left++
      continue
    }
    items.push({
      kind: designKind(d.hash),
      slug: '',
      name: d.design.name,
      colour: designColour(d.design),
      onDesk: false,
      hash: d.hash,
      design: JSON.stringify(d.design),
      summary: objectSummary(f.summary),
      parts: f.summary.parts,
    })
  }
  return { items, left }
}

/** A placed object of the layout as the list and the commands need it; its design resolved by hash when at hand. */
export function placedObject(o: PlacedObjectLayout, design: object | null | undefined): Placed {
  const d = design as DesignJson | null | undefined
  return {
    id: o.id,
    kind: designKind(o.design),
    name: d?.name ?? (d === undefined ? 'A design (being read)' : 'A design the company does not have'),
    colour: d ? designColour(d) : 'grey-light',
    x: o.x,
    z: o.z,
    rot: quarter(o.rot),
    on: null,
    removable: true,
    target: 'object',
    ...(d ? { design: JSON.stringify(d) } : {}),
  }
}
