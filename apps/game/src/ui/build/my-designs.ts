/**
 * The company's designs as Build mode places them (K-4, ADR-0065 §4): each design compiled once
 * by the kit (content-addressed, so per hash for the page's life), its summary turned into the
 * `PlaceObject` the sim validates and prices, and the placed objects of a room listed by their
 * designs. Floor designs the kit builds stand in a room; surface designs go on a desk
 * (`PlaceObjectOnDesk`, ADR-0088); ceiling designs cannot be placed yet.
 */
import { useEffect, useState } from 'preact/hooks'
import type { CompanyDesign } from './company-designs'
import { designColour } from './company-designs'
import { compileDesign, getDesignKit, type EditorKit, type KitSummary } from './design-kit'
import type { DesignJson } from './design-model'
import { deskTopOf } from '../../render/bricks/objects'
import { deskSlotOf, objectSummary, onDeskDesign, placeable, quarter, type CatalogueItem, type PlacedObjectLayout } from './types'
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

/** The company's designs as catalogue tiles: those the kit builds that stand on the floor or on a desk; how many others were left out. */
export function myDesignItems(kit: EditorKit, designs: readonly CompanyDesign[]): { items: CatalogueItem[]; left: number } {
  const items: CatalogueItem[] = []
  let left = 0
  for (const d of designs) {
    const f = factsOf(kit, d.hash, d.design)
    if (!f.ok || !f.summary || !placeable(f.summary)) {
      left++
      continue
    }
    const summary = objectSummary(f.summary)
    const onDesk = onDeskDesign(f.summary)
    items.push({
      kind: designKind(d.hash),
      slug: '',
      name: d.design.name,
      colour: designColour(d.design),
      onDesk,
      ...(onDesk ? { deskSlot: deskSlotOf(summary) } : {}),
      hash: d.hash,
      design: JSON.stringify(d.design),
      summary,
      parts: f.summary.parts,
    })
  }
  return { items, left }
}

/** Why a desk-top object has no Move (ADR-0088 decision 3). */
export const MOVES_WITH_DESK = 'It moves with its desk: move the desk instead.'

/**
 * A placed object of the layout as the list and the commands need it; its design resolved by hash
 * when at hand. A desk-top object is on its desk (no Move, no Turn); a workstation object says who
 * calls it home (`assignedTo`, when the layout says).
 */
export function placedObject(o: PlacedObjectLayout, design: object | null | undefined): Placed {
  const d = design as DesignJson | null | undefined
  const top = deskTopOf(o)
  return {
    id: o.id,
    kind: designKind(o.design),
    name: d?.name ?? (d === undefined ? 'A design (being read)' : 'A design the company does not have'),
    colour: d ? designColour(d) : 'grey-light',
    x: o.x,
    z: o.z,
    rot: quarter(o.rot),
    on: top?.desk ?? null,
    removable: true,
    target: 'object',
    ...(top ? { fixed: MOVES_WITH_DESK } : {}),
    ...(o.summary?.workstation && !top ? { workstation: true, home: typeof o.assignedTo === 'string' ? o.assignedTo : null } : {}),
    ...(d ? { design: JSON.stringify(d) } : {}),
  }
}
